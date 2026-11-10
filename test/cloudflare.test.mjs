import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyAccess } from '../cloudflare/access.mjs';
import { privateRuntime } from '../cloudflare/runtime.mjs';
import { createPrivateGateway } from '../cloudflare/gateway.mjs';
import { createBookingStore } from '../cloudflare/store.mjs';
import { FakeStripe, selection } from './helpers.mjs';

const owner = 'summit.club.ni@gmail.com';
const env = extra => ({ BASE_URL: 'https://test.summitclub.co', PAYMENTS_MODE: 'off', EMAIL_DELIVERY: 'off', OWNER_EMAIL: owner, TESTER_EMAILS: owner, ADMIN_TOKEN: 'owner-secret-'.repeat(4), RECEIPT_SECRET: 'receipt-secret-'.repeat(4), ...extra });
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function signed(headers, claims) { const text = encode(headers) + '.' + encode(claims); return text + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, Buffer.from(text))).toString('base64url'); }
async function accessFixture(extra = {}, claimChanges = {}, headerChanges = {}) {
  const config = env({ ACCESS_TEAM_DOMAIN: 'https://team-' + randomUUID().replaceAll('-','') + '.cloudflareaccess.com', ACCESS_AUD: 'fixture-audience', ...extra });
  const now = Math.floor(Date.now()/1000), claims = { iss: config.ACCESS_TEAM_DOMAIN, aud: [config.ACCESS_AUD], email: owner, iat: now, exp: now + 3600, ...claimChanges };
  const header = { alg: 'RS256', kid: jwk.kid, ...headerChanges };
  const token = await signed(header, claims), options = { fetcher: async url => { assert.equal(url, config.ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs'); return new Response(JSON.stringify({ keys: [jwk] })); } };
  const request = new Request(config.BASE_URL + '/', { headers: { 'Cf-Access-Jwt-Assertion': token } });
  return { config, request, options, token, claims, header };
}

test('Cloudflare Access accepts the corrected owner email only after verifying an RSA signature', async () => {
  const f = await accessFixture();
  assert.deepEqual(await verifyAccess(f.request, f.config, f.options), { email: owner, owner: true });
});
test('invited testers can authenticate without becoming owners; unlisted emails are refused', async () => {
  const f = await accessFixture({ TESTER_EMAILS: owner + ',tester@example.com' }, { email: 'tester@example.com' });
  assert.deepEqual(await verifyAccess(f.request, f.config, f.options), { email: 'tester@example.com', owner: false });
  const denied = await accessFixture({}, { email: 'outsider@example.com' });
  await assert.rejects(verifyAccess(denied.request, denied.config, denied.options), error => error.status === 403);
});
test('missing Access configuration, missing tokens and tampered signatures fail closed', async () => {
  const f = await accessFixture();
  await assert.rejects(verifyAccess(f.request, env()), e => e.status === 503);
  await assert.rejects(verifyAccess(new Request(f.config.BASE_URL), f.config, f.options), e => e.status === 403);
  const alteredPayload = encode({ ...f.claims, exp: f.claims.exp + 1 });
  const altered = f.token.split('.')[0] + '.' + alteredPayload + '.' + f.token.split('.')[2];
  await assert.rejects(verifyAccess(new Request(f.config.BASE_URL, { headers: { 'Cf-Access-Jwt-Assertion': altered } }), f.config, f.options), e => e.status === 403);
});
test('expired, wrong-audience, wrong-issuer, premature and wrong-algorithm tokens are refused', async () => {
  const now = Math.floor(Date.now()/1000);
  for (const claims of [{ exp: now-1 }, { aud: ['another-app'] }, { iss: 'https://other.cloudflareaccess.com' }, { nbf: now+600 }, { iat: now+600 }]) {
    const f = await accessFixture({}, claims); await assert.rejects(verifyAccess(f.request, f.config, f.options), e => e.status === 403);
  }
  const algorithm = await accessFixture({}, {}, { alg: 'HS256' });
  await assert.rejects(verifyAccess(algorithm.request, algorithm.config, algorithm.options), e => e.status === 403);
});
test('Access verification fails closed during signing-key outages and rejects arbitrary issuer hosts', async () => {
  const f = await accessFixture();
  await assert.rejects(verifyAccess(f.request, f.config, { fetcher: async () => { throw new Error('Offline'); } }), e => e.status === 503);
  for (const domain of ['https://evil.example.com','http://team.cloudflareaccess.com','https://team.cloudflareaccess.com/path']) await assert.rejects(verifyAccess(f.request, { ...f.config, ACCESS_TEAM_DOMAIN: domain }, f.options), e => e.status === 503);
});
test('the private gateway protects every asset and API even if the edge Access policy is absent', async () => {
  const gateway = createPrivateGateway(), f = await accessFixture(); let assetCalls = 0;
  const config = { ...f.config, ASSETS: { fetch: async () => { assetCalls++; return new Response('private'); } } };
  for (const path of ['/','/assets/booking.js','/admin.html','/api/config','/api/checkout']) assert.equal((await gateway(new Request(config.BASE_URL + path), config)).status, 403);
  assert.equal(assetCalls, 0);
  assert.equal((await gateway(new Request('https://alternate.workers.dev/'), config)).status, 403);
});
test('only the owner can reach dashboard routes, including encoded and extensionless forms', async () => {
  const gateway = createPrivateGateway({ verify: async () => ({ email: 'tester@example.com', owner: false }) });
  for (const path of ['/admin','/admin.html','/%61dmin.html','/api/admin/settings']) assert.equal((await gateway(new Request('https://test.summitclub.co' + path), env())).status, 403);
});
test('owner requests receive backend authorisation without exposing the secret to the browser', async () => {
  let received;
  const gateway = createPrivateGateway({ verify: async () => ({ email: owner, owner: true }) });
  const config = env({ BOOKINGS: { idFromName: value => value, get: id => ({ fetch: async request => { assert.equal(id, 'summit-private-test-v1'); received = request; return new Response('{"ok":true}'); } }) } });
  const result = await gateway(new Request(config.BASE_URL + '/api/admin/settings', { headers: { Authorization: 'Bearer user-supplied', 'CF-Connecting-IP': '203.0.113.1' } }), config);
  assert.equal(result.status, 200); assert.equal(received.headers.get('authorization'), 'Bearer ' + config.ADMIN_TOKEN);
  assert.equal(received.headers.get('X-Summit-Client-IP'), '203.0.113.1');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal((await result.text()).includes(config.ADMIN_TOKEN), false);
});
test('only the exact Stripe webhook bypasses interactive login, retains raw bytes and enforces size limits', async () => {
  let bytes, calls = 0;
  const gateway = createPrivateGateway({ verify: async () => { throw Object.assign(new Error('Denied'), { status: 403 }); } });
  const config = env({ BOOKINGS: { idFromName: v => v, get: () => ({ fetch: async request => { calls++; bytes = await request.text(); return new Response('accepted'); } }) } });
  const raw = '{ "event": "raw body" }';
  assert.equal((await gateway(new Request(config.BASE_URL + '/api/stripe/webhook', { method: 'POST', body: raw }), config)).status, 200);
  assert.equal(bytes, raw); assert.equal(calls, 1);
  for (const path of ['/api/stripe/webhook/','/api/stripe/%77ebhook','/api/config']) assert.equal((await gateway(new Request(config.BASE_URL + path, { method: 'POST', body: '{}' }), config)).status, 403);
  assert.equal((await gateway(new Request(config.BASE_URL + '/api/stripe/webhook'), config)).status, 403);
  assert.equal((await gateway(new Request(config.BASE_URL + '/api/stripe/webhook', { method: 'POST', body: 'a'.repeat(1048577) }), config)).status, 413);
});
test('live Stripe mode and live keys are rejected on the private test deployment', () => {
  assert.equal(privateRuntime(env()).mode, 'off');
  assert.equal(privateRuntime(env({ PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' })).mode, 'test');
  for (const change of [{ PAYMENTS_MODE: 'live' }, { STRIPE_SECRET_KEY: 'sk_live_forbidden' }, { PAYMENTS_MODE: 'test' }, { BASE_URL: 'http://test.summitclub.co' }, { ADMIN_TOKEN: 'short' }]) assert.throws(() => privateRuntime(env(change)));
});

class StorageFixture {
  database = new DatabaseSync(':memory:'); alarmTime = null; transactions = 0;
  constructor() {
    this.database.exec('PRAGMA foreign_keys=ON');
    this.sql = { exec: (sql, ...values) => {
      assert.equal(/\bBEGIN\s+(?:TRANSACTION|IMMEDIATE)|\bSAVEPOINT\b/i.test(sql), false, 'Use storage.transactionSync for Cloudflare transactions');
      if (/^\s*CREATE\b/i.test(sql)) { this.database.exec(sql); return { toArray: () => [] }; }
      const statement = this.database.prepare(sql);
      const rows = /^\s*SELECT\b/i.test(sql) ? statement.all(...values) : (statement.run(...values), []);
      return { toArray: () => rows };
    } };
  }
  transactionSync(callback) { this.transactions++; this.database.exec('BEGIN IMMEDIATE'); try { const result=callback(); this.database.exec('COMMIT'); return result; } catch(error) { this.database.exec('ROLLBACK'); throw error; } }
  async getAlarm() { return this.alarmTime; }
  async setAlarm(value) { this.alarmTime = value; }
  close() { this.database.close(); }
}
function storeFixture(t) {
  const storage = new StorageFixture(), stripe = new FakeStripe(); t.after(() => storage.close());
  const config = env({ PAYMENTS_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' });
  const store = createBookingStore({ storage }, config, { stripe, clock: () => Date.parse('2026-11-10T12:00:00Z') });
  return { storage, stripe, store, config };
}
test('Cloudflare SQLite adapter preserves transactions, one-bedroom pricing and rollback', t => {
  const f = storeFixture(t), repo = f.store.repo;
  repo.setOverride('both', '2026-12-10', '2026-12-12', 19000, 1);
  assert.equal(f.store.app.findQuote(selection({ bedrooms: 1 })).totalPence, 38000);
  const before = repo.settings();
  assert.throws(() => repo.transaction(() => { repo.saveSettings({ ...before, winterPence: 10000 }); throw new Error('Rollback'); }));
  assert.equal(repo.settings().winterPence, before.winterPence); assert.ok(f.storage.transactions >= 2);
});
test('Cloudflare storage prevents racing checkouts and schedules durable payment reconciliation', async t => {
  const f = storeFixture(t), q = f.store.app.findQuote(selection());
  const value = { ...selection(), requestKey: randomUUID(), expectedTotalPence: q.totalPence, quoteHash: q.hash, termsAccepted: true, contact: { name: 'Test Guest', email: 'guest@example.com' } };
  const make = value => new Request(f.config.BASE_URL + '/api/checkout', { method: 'POST', headers: { Origin: f.config.BASE_URL, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  const results = await Promise.all([f.store.fetch(make(value)), f.store.fetch(make({ ...value, requestKey: randomUUID() }))]);
  assert.deepEqual(results.map(r=>r.status).sort(), [200,409]); assert.equal(f.store.repo.list().length, 1);
  assert.ok(f.storage.alarmTime > Date.now());
  const booking = f.store.repo.list()[0]; f.stripe.paid(booking.stripe_session_id); f.storage.alarmTime = null;
  await f.store.alarm(); assert.equal(f.store.repo.get(booking.id).status, 'confirmed');
  assert.equal(f.store.repo.outbox().length, 2); assert.equal(f.storage.alarmTime, null);
  const restarted = createBookingStore({ storage: f.storage }, f.config, { stripe: f.stripe, clock: () => Date.parse('2026-11-10T12:00:00Z') });
  assert.equal(restarted.repo.get(booking.id).status, 'confirmed');
});
test('a signed owner login reaches the real booking API while unauthorised callers remain blocked', async t => {
  const f = storeFixture(t), access = await accessFixture();
  const config = { ...access.config, ...f.config, BOOKINGS: { idFromName: value => value, get: () => ({ fetch: request => f.store.fetch(request) }) } };
  const gateway = createPrivateGateway({ verify: (request, env) => verifyAccess(request, env, access.options) });
  const request = new Request(config.BASE_URL + '/api/admin/rates', { method: 'PUT', headers: { Origin: config.BASE_URL, 'Cf-Access-Jwt-Assertion': access.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ lodgeId: 'both', bedrooms: 1, from: '2026-12-10', to: '2026-12-12', pricePence: 18500 }) });
  assert.equal((await gateway(request, config)).status, 200);
  assert.equal(f.store.app.findQuote(selection({ bedrooms: 1 })).totalPence, 37000);
  assert.equal((await gateway(new Request(config.BASE_URL + '/api/admin/settings'), config)).status, 403);
  const badWebhook = new Request(config.BASE_URL + '/api/stripe/webhook', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 'invalid' } });
  assert.equal((await gateway(badWebhook, config)).status, 400);
});
test('Cloudflare build separates the public brochure from private booking and administrator assets', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  execFileSync(process.execPath, ['scripts/build-cloudflare.mjs'], { cwd: root });
  const publicHtml = readFileSync(new URL('../dist/public/index.html', import.meta.url), 'utf8');
  assert.ok(publicHtml.includes('Bookings opening soon')); assert.equal(publicHtml.includes('id="booking-form"'), false);
  assert.equal(publicHtml.includes('assets/booking.js'), false); assert.equal(publicHtml.includes('assets/pricing.js'), false);
  assert.equal(existsSync(new URL('../dist/public/admin.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/public/assets/booking.js', import.meta.url)), false);
  const privateHtml = readFileSync(new URL('../dist/test/index.html', import.meta.url), 'utf8');
  assert.ok(privateHtml.includes('id="booking-form"')); assert.ok(existsSync(new URL('../dist/test/admin.html', import.meta.url)));
  assert.equal(existsSync(new URL('../dist/test/.env', import.meta.url)), false);
  const worker = JSON.parse(readFileSync(new URL('../wrangler.test.jsonc', import.meta.url), 'utf8'));
  assert.equal(worker.assets.run_worker_first, true); assert.equal(worker.workers_dev, false);
  assert.equal(worker.vars.OWNER_EMAIL, owner); assert.equal(worker.vars.TESTER_EMAILS, owner);
});
