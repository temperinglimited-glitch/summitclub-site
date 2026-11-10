import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { StripeGateway, EmailGateway, verifyStripeSignature } from '../server/providers.mjs';

test('only a verified, matching Stripe payment confirms and queues one pair of emails', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0];
  assert.equal((await f.webhook(b.stripe_session_id)).status, 200); assert.equal(f.repo.get(b.id).status, 'checkout');
  assert.equal(f.repo.outbox().length, 0);
  f.stripe.paid(b.stripe_session_id);
  assert.equal((await f.webhook(b.stripe_session_id, { eventId: 'evt_same' })).status, 200);
  assert.equal(f.repo.get(b.id).status, 'confirmed'); assert.equal(f.repo.outbox().length, 2);
  await f.webhook(b.stripe_session_id, { eventId: 'evt_same' }); await f.webhook(b.stripe_session_id);
  assert.equal(f.repo.outbox().length, 2);
});
test('bad signatures, stale timestamps and wrong payment mode cannot mutate bookings', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0]; f.stripe.paid(b.stripe_session_id);
  assert.equal((await f.webhook(b.stripe_session_id, { corrupt: true })).status, 400);
  assert.equal((await f.webhook(b.stripe_session_id, { timestamp: f.now() - 301 })).status, 400);
  assert.equal((await f.webhook(b.stripe_session_id, { livemode: true })).status, 400);
  assert.equal(f.repo.get(b.id).status, 'checkout'); assert.equal(f.repo.outbox().length, 0);
});
test('webhook re-reads current Stripe state instead of trusting a reordered event snapshot', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0]; f.stripe.paid(b.stripe_session_id);
  await f.webhook(b.stripe_session_id, { type: 'checkout.session.expired', payload: { status: 'expired', payment_status: 'unpaid', amount_total: 1 } });
  assert.equal(f.repo.get(b.id).status, 'confirmed'); assert.equal(f.repo.available(b.lodge_id, b.check_in, b.check_out), false);
});
test('amount, currency, reference and mode mismatches require review and retain dates', async t => {
  for (const altered of [{ amount_total: 1 }, { currency: 'eur' }, { client_reference_id: 'wrong' }, { livemode: true }]) {
    const f = fixture(t); await f.start(); const b = f.repo.list()[0]; f.stripe.paid(b.stripe_session_id);
    Object.assign(f.stripe.sessions.get(b.stripe_session_id), altered);
    assert.equal((await f.webhook(b.stripe_session_id)).status, 200);
    assert.equal(f.repo.get(b.id).status, 'review'); assert.equal(f.repo.outbox()[0].kind, 'review');
    assert.equal(f.repo.available(b.lodge_id, b.check_in, b.check_out), false);
  }
});
test('a late paid event after an owner release raises review instead of confirming missing inventory', async t => {
  const f = fixture(t); f.stripe.failCreate = 1; await f.start(); let b = f.repo.list()[0];
  f.advance(3901); f.repo.releaseUnresolved(b.id, f.now(), true);
  const id = f.stripe.ids.get(b.id); f.stripe.paid(id); await f.webhook(id);
  b = f.repo.get(b.id); assert.equal(b.status, 'review'); assert.equal(f.repo.outbox()[0].kind, 'review');
});
test('queued confirmation emails retry delivery without duplicate logical messages', async t => {
  const f = fixture(t, { emailEnabled: true }); await f.start(); const b = f.repo.list()[0]; f.stripe.paid(b.stripe_session_id); await f.webhook(b.stripe_session_id);
  const original = f.mailer.send; let fail = true;
  f.mailer.send = async (...args) => { if (fail) throw new Error('Offline'); return original(...args); };
  await f.app.maintenance(); assert.ok(f.repo.outbox().every(m => m.status === 'pending' && m.attempts === 1));
  fail = false; f.advance(31); await f.app.maintenance(); await f.app.maintenance();
  assert.equal(f.sent.length, 2); assert.ok(f.repo.outbox().every(m => m.status === 'sent'));
});
test('Stripe payload uses server totals, fixed expiry and stable idempotency key', async t => {
  const f = fixture(t); await f.start({ children: 1, hamperId: 'breakfast-two', hamperQuantity: 2 }); const b = f.repo.list()[0];
  const calls = [], gateway = new StripeGateway('sk_test_fake', async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ id: 'cs_test_fake' }), { status: 200 }); });
  await gateway.create(b, f.runtime.baseUrl, 'private-token'); await gateway.create(b, f.runtime.baseUrl, 'private-token');
  const fields = calls[0].options.body, amounts = [...fields.entries()].filter(([key]) => /\[unit_amount\]$/.test(key)).reduce((sum, [, value]) => sum + Number(value), 0);
  assert.equal(amounts, b.quote.totalPence); assert.equal(fields.get('expires_at'), String(b.expires_at));
  assert.equal(fields.get('payment_method_types[0]'), 'card'); assert.ok(fields.get('success_url').endsWith('#token=private-token'));
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.equal(fields.get('client_reference_id'), b.id);
});
test('signature rotation accepts any valid v1 signature but not altered raw bytes', () => {
  const raw = Buffer.from('{"hello":"world"}'), secret = 'whsec_test', now = 1900000000;
  const sig = createHmac('sha256', secret).update(now + '.').update(raw).digest('hex');
  assert.doesNotThrow(() => verifyStripeSignature(raw, 't=' + now + ',v1=' + '0'.repeat(64) + ',v1=' + sig, secret, now));
  assert.throws(() => verifyStripeSignature(Buffer.from('{ "hello":"world"}'), 't=' + now + ',v1=' + sig, secret, now));
});
test('test-mode emails are clearly identified and use delivery idempotency', async t => {
  const f = fixture(t); await f.start(); const b = f.repo.list()[0]; let captured;
  const mailer = new EmailGateway({ apiKey: 'fake', from: 'Summit <test@example.com>', ownerEmail: 'owner@example.com' }, async (url, options) => { captured = options; return new Response('{"id":"email_ok"}'); });
  assert.equal(await mailer.send({ id: 'msg-1', kind: 'guest' }, b), 'email_ok');
  const body = JSON.parse(captured.body); assert.ok(body.subject.startsWith('[TEST]')); assert.ok(body.text.includes(b.id));
  assert.equal(captured.headers['Idempotency-Key'], 'summit-msg-1'); assert.deepEqual(body.to, ['guest@example.com']);
});
