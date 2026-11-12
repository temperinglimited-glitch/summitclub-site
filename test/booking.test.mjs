import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, selection, guestFields } from './helpers.mjs';

test('preview mode quotes stays but cannot create a payment or reservation', async t => {
  const f = fixture(t, { mode: 'off', paymentsEnabled: false });
  assert.equal((await f.call('/api/quote', { method: 'POST', value: selection() })).status, 200);
  assert.equal((await f.start()).response.status, 503); assert.equal(f.repo.list().length, 0); assert.equal(f.stripe.creates, 0);
});
test('two simultaneous checkouts for the same lodge produce one hold', async t => {
  const f = fixture(t), q = f.app.findQuote(selection());
  const value = { ...selection(), requestKey: randomUUID(), expectedTotalPence: q.totalPence, quoteHash: q.hash, termsAccepted: true, ...guestFields() };
  const results = await Promise.all([value, { ...value, requestKey: randomUUID() }].map(v => f.call('/api/checkout', { method: 'POST', value: v })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.repo.list().length, 1); assert.equal(f.repo.locked('2026-12-10', '2026-12-12').length, 2);
});
test('two lodges can book the same dates; departure and next arrival may share a date', async t => {
  const f = fixture(t);
  assert.equal((await f.start()).response.status, 200);
  assert.equal((await f.start({ lodgeId: 'lodge-two' })).response.status, 200);
  assert.equal((await f.start({ checkIn: '2026-12-12', checkOut: '2026-12-14' })).response.status, 200);
  const noRoom = await f.call('/api/quote', { method: 'POST', value: selection({ lodgeId: 'any' }) });
  assert.equal(noRoom.status, 409); assert.equal(f.repo.list().length, 3);
});
test('any-lodge pricing chooses one available lodge for the entire stay, including date overrides', async t => {
  const f = fixture(t);
  f.repo.setOverride('lodge-two', '2026-12-10', '2026-12-12', 20000);
  let q = f.app.findQuote(selection({ lodgeId: 'any' })); assert.equal(q.lodge.id, 'lodge-two'); assert.equal(q.totalPence, 40000);
  await f.start({ lodgeId: 'lodge-two' });
  q = f.app.findQuote(selection({ lodgeId: 'any' })); assert.equal(q.lodge.id, 'lodge-one');
  f.repo.reserve({ quote: { lodge: { id: 'lodge-one' }, selection: { checkIn: '2026-12-10', checkOut: '2026-12-11' } }, data: { note: 'Owner' }, now: f.now(), blocked: true });
  assert.throws(() => f.app.findQuote(selection({ lodgeId: 'any' })));
});
test('retrying the same checkout reuses the booking and Stripe session; changed request conflicts', async t => {
  const f = fixture(t), { value, response } = await f.start();
  const retry = await f.call('/api/checkout', { method: 'POST', value });
  assert.equal(retry.status, 200); assert.equal(retry.body.url, response.body.url); assert.equal(f.repo.list().length, 1); assert.equal(f.stripe.sessions.size, 1);
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: { ...value, contact: { ...value.contact, name: 'Another guest' } } })).status, 409);
});
test('stale prices and manipulated totals never reach Stripe', async t => {
  const f = fixture(t), q = f.app.findQuote(selection());
  const value = { ...selection(), requestKey: randomUUID(), expectedTotalPence: q.totalPence - 1, quoteHash: q.hash, termsAccepted: true, ...guestFields() };
  assert.equal((await f.call('/api/checkout', { method: 'POST', value })).status, 409);
  f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-12', 30000);
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: { ...value, expectedTotalPence: q.totalPence } })).status, 409);
  assert.equal(f.stripe.creates, 0); assert.equal(f.repo.list().length, 0);
});
test('ambiguous creation failure protects dates and recovers through idempotent retry', async t => {
  const f = fixture(t); f.stripe.failCreate = 1;
  const { value, response } = await f.start(); assert.equal(response.status, 502);
  assert.equal(f.repo.list()[0].status, 'creating'); assert.equal(f.repo.available('lodge-one', value.checkIn, value.checkOut), false);
  const retry = await f.call('/api/checkout', { method: 'POST', value }); assert.equal(retry.status, 200);
  assert.equal(f.repo.list()[0].status, 'checkout'); assert.equal(f.stripe.sessions.size, 1);
});
test('definitively expired checkouts release nights; provider outages retain them', async t => {
  const f = fixture(t); await f.start();
  f.advance(3601); f.stripe.failRetrieve = true; await f.app.maintenance();
  assert.equal(f.repo.list()[0].status, 'checkout'); assert.equal(f.repo.available('lodge-one', '2026-12-10', '2026-12-12'), false);
  f.stripe.failRetrieve = false; await f.app.maintenance();
  assert.equal(f.repo.list()[0].status, 'expired'); assert.equal(f.repo.available('lodge-one', '2026-12-10', '2026-12-12'), true); assert.equal(f.stripe.expirations, 1);
});
test('payment completing during an expiry race remains confirmed and retains nights', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0]; f.advance(3601);
  f.stripe.expire = async id => { f.stripe.paid(id); throw new Error('Already complete'); };
  await f.app.maintenance(); assert.equal(f.repo.get(b.id).status, 'confirmed'); assert.equal(f.repo.locked(b.check_in, b.check_out).length, 2);
});
test('private status requires its signed token; redirect alone never confirms payment', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0];
  assert.equal((await f.call('/api/booking-status?id=' + b.id)).status, 401);
  assert.equal((await f.call('/api/booking-status?id=' + b.id, { auth: f.app.token(b.id) })).body.status, 'checkout');
  f.stripe.paid(b.stripe_session_id);
  const status = await f.call('/api/booking-status?id=' + b.id, { auth: f.app.token(b.id) }); assert.equal(status.body.status, 'confirmed');
  assert.equal(status.headers.get('cache-control'), 'no-store');
});
test('guest validation, same-origin writes, JSON shape and owner authentication are enforced', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/quote', { method: 'POST', value: selection(), origin: 'https://other.example' })).status, 403);
  assert.equal((await f.call('/api/quote', { method: 'POST', value: null })).status, 400);
  assert.equal((await f.call('/api/admin/bookings')).status, 401);
  assert.equal((await f.call('/api/admin/bookings', { auth: f.runtime.adminToken })).status, 200);
  const q = f.app.findQuote(selection()), v = { ...selection(), requestKey: randomUUID(), quoteHash: q.hash, expectedTotalPence: q.totalPence, termsAccepted: false, contact: { name: 'Guest', email: 'invalid' } };
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: v })).status, 400); assert.equal(f.stripe.creates, 0);
});
