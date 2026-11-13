import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import details from '../public/assets/booking-details.js';
import pricing from '../public/assets/pricing.js';
import { EmailGateway, StripeGateway, bookingEmailContent } from '../server/providers.mjs';
import { policySnapshot, POLICY_VERSION } from '../server/policies.mjs';
import { CoreRepository } from '../server/repository-core.mjs';
import { fixture, selection, guestFields, seed } from './helpers.mjs';

function checkoutValue(f, extra = {}) {
  const input = selection(extra), q = f.app.findQuote(input);
  return { ...input, ...guestFields(input), termsAccepted: true, requestKey: randomUUID(), quoteHash: q.hash, expectedTotalPence: q.totalPence };
}
async function confirm(f, value) {
  assert.equal((await f.call('/api/checkout', { method: 'POST', value })).status, 200);
  const booking = f.repo.byRequest(value.requestKey); f.stripe.paid(booking.stripe_session_id); await f.webhook(booking.stripe_session_id); return f.repo.get(booking.id);
}
function registerValue(booking) {
  const count = booking.quote.selection.adults + booking.data.details.childAges.filter(a => a >= 16).length;
  return { accuracyConfirmed: true, guests: Array.from({ length: count }, (_, i) => ({ name: i ? 'Guest ' + (i + 1) : booking.data.contact.name, nationality: 'Irish', address: booking.data.contact.address, travelDetailsRequired: false })) };
}

test('required contact, lead age, child ages and policy version are checked before reserving or calling Stripe', async t => {
  const f = fixture(t), original = checkoutValue(f, { children: 2 });
  const cases = [
    v => { v.contact.phone = ''; }, v => { v.contact.phone = '123'; }, v => { v.contact.address.line1 = ''; },
    v => { v.contact.address.country = 'ZZ'; }, v => { v.contact.address.postcode = ''; },
    v => { v.details.leadGuest18 = false; }, v => { v.details.childAges = [8]; },
    v => { v.details.childAges = [18, 9]; }, v => { v.details.childAges = [null, 9]; }, v => { v.termsAccepted = false; }
  ];
  for (const mutate of cases) { const value = structuredClone(original); mutate(value); assert.equal((await f.call('/api/checkout', { method: 'POST', value })).status, 400); }
  const stale = { ...original, termsVersion: 'earlier-version' };
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: stale })).status, 409);
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: { ...original, policyHash: 'stale-text-under-same-version' } })).status, 409);
  assert.equal(f.repo.list().length, 0); assert.equal(f.stripe.creates, 0);
  assert.equal(details.address({ ...original.contact.address, country: 'IE', postcode: '' }).postcode, '');
});
test('hamper prices are per hamper, independent of party size and nights, with the agreed before-arrival contents', async t => {
  const f = fixture(t), original = checkoutValue(f, { hamperId: 'breakfast-two', hamperQuantity: 3 });
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: original })).status, 200);
  const booking = f.repo.byRequest(original.requestKey);
  assert.equal(booking.quote.hamperPence, 9000); assert.equal(booking.quote.nights, 2);
  assert.equal(booking.data.details.hamperFulfilment, 'before-arrival');
  assert.deepEqual(booking.data.hamperInformation.items.map(i => i.name), ['Sausages', 'Bacon', 'Eggs', 'Baked beans', 'White bread', 'Butter', 'Jam', 'Milk', 'Orange juice']);
  assert.ok(booking.data.hamperInformation.items.every(i => i.quantity === ''));
  const family = f.app.findQuote(selection({ lodgeId: 'lodge-two', adults: 2, children: 2, hamperId: 'breakfast-family', hamperQuantity: 1 }));
  assert.equal(family.hamperPence, 4500);
  let stripeFields;
  const stripe = new StripeGateway('sk_test_fake', async (_, options) => {
    stripeFields = new URLSearchParams(options.body);
    return new Response('{"id":"cs_test_fake","url":"https://checkout.stripe.com/c/pay/fake"}', { status: 200 });
  });
  await stripe.create(booking, f.runtime.baseUrl, 'test-receipt');
  assert.equal(stripeFields.get('line_items[1][price_data][unit_amount]'), '9000');
  assert.match(stripeFields.get('line_items[1][price_data][product_data][name]'), /Small breakfast hamper/);
  const changed = structuredClone(original); changed.details.requests = 'A different request';
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: changed })).status, 409);
});
test('£30/£45 menus upgrade saved settings once and preserve historical prices and contents', async t => {
  const f = fixture(t), old = structuredClone(f.repo.settings());
  old.hamperVersion = 1; old.winterPence = 32100;
  old.hampers = [{ id: 'breakfast-two', name: 'Breakfast hamper for two', pricePence: 3500 }, { id: 'breakfast-family', name: 'Family breakfast hamper', pricePence: 5500 }];
  f.repo.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(old));
  const booking = await confirm(f, checkoutValue(f, { hamperId: 'breakfast-family', hamperQuantity: 1 }));
  const historicData = { ...booking.data, hamperInformation: { description: 'Earlier hamper contents', items: [{ name: 'Pork sausages', quantity: '8' }], allergens: 'Earlier supplied information', reviewed: false } };
  f.repo.db.prepare('UPDATE bookings SET data_json=? WHERE id=?').run(JSON.stringify(historicData), booking.id);
  const upgraded = new CoreRepository(f.repo.db, seed), settings = upgraded.settings();
  assert.equal(settings.hamperVersion, 2); assert.deepEqual(settings.hampers.map(h => h.pricePence), [3000, 4500]);
  assert.equal(settings.winterPence, 32100);
  const historic = upgraded.get(booking.id);
  assert.equal(historic.quote.hamperPence, 5500); assert.equal(historic.quote.hamperName, 'Family breakfast hamper');
  assert.deepEqual(historic.quote, booking.quote); assert.deepEqual(historic.data, historicData);
  assert.match(bookingEmailContent({ kind: 'guest' }, historic, 'owner@example.com').text, /8 Pork sausages/);
  upgraded.saveSettings({ ...settings, hampers: settings.hampers.map(h => ({ ...h, pricePence: h.pricePence + 100 })) });
  assert.deepEqual(new CoreRepository(f.repo.db, seed).settings().hampers.map(h => h.pricePence), [3100, 4600]);
  // Very early databases also pass through the bedroom-rules upgrade; that must not skip the menu upgrade.
  const early = fixture(t), legacy = { ...old, bookingRulesVersion: 1 }; delete legacy.hamperVersion;
  early.repo.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(legacy));
  assert.deepEqual(new CoreRepository(early.repo.db, seed).settings().hampers.map(h => h.pricePence), [3000, 4500]);
});
test('48-hour hamper notice follows 3pm Northern Ireland check-in and cannot be bypassed at checkout', async t => {
  assert.equal(pricing.hamperDeadline('2026-12-10'), Date.parse('2026-12-08T15:00:00Z'));
  assert.equal(pricing.hamperDeadline('2027-07-05'), Date.parse('2027-07-03T14:00:00Z'));
  assert.equal(pricing.hamperDeadline('2026-10-26'), Date.parse('2026-10-24T15:00:00Z'));
  const f = fixture(t), cutoff = pricing.hamperDeadline('2026-12-10');
  assert.equal(pricing.hamperAvailable('2026-12-10', cutoff), true);
  assert.equal(pricing.hamperAvailable('2026-12-10', cutoff + 1), false);
  f.advance((cutoff - f.now() * 1000) / 1000);
  const { value, response } = await f.start({ hamperId: 'breakfast-two', hamperQuantity: 1 });
  assert.equal(response.status, 200);
  f.advance(1);
  const late = selection({ lodgeId: 'lodge-two', hamperId: 'breakfast-two', hamperQuantity: 1 });
  const quote = await f.call('/api/quote', { method: 'POST', value: late });
  assert.equal(quote.status, 400); assert.match(quote.body.error, /48 hours/);
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: { ...value, lodgeId: 'lodge-two', requestKey: randomUUID() } })).status, 400);
  assert.equal(f.stripe.creates, 1);
  // A request already placed before the cutoff can safely resume its existing checkout.
  assert.equal((await f.call('/api/checkout', { method: 'POST', value })).status, 200);
  assert.equal((await f.call('/api/quote', { method: 'POST', value: selection({ lodgeId: 'lodge-two' }) })).status, 200);
});
test('accepted policy snapshot and paid quote survive later settings changes and registration edits', async t => {
  const f = fixture(t), booking = await confirm(f, checkoutValue(f));
  const snapshot = booking.data.policySnapshot;
  assert.equal(snapshot.sha256, createHash('sha256').update(snapshot.text).digest('hex'));
  assert.equal(snapshot.version, POLICY_VERSION); assert.match(snapshot.text, /each with an en-suite shower room/);
  f.repo.saveSettings({ ...f.repo.settings(), winterPence: 29000 });
  const value = registerValue(booking), path = '/api/guest-registration?id=' + booking.id;
  assert.equal((await f.call(path, { method: 'PUT', auth: f.app.registrationToken(booking.id), value })).status, 200);
  assert.deepEqual(f.repo.get(booking.id).data.policySnapshot, snapshot); assert.deepEqual(f.repo.get(booking.id).quote, booking.quote);
});
test('registration requires its own booking-specific token, confirmation, same origin and an unexpired stay', async t => {
  const f = fixture(t), value = checkoutValue(f), pathFor = id => '/api/guest-registration?id=' + id;
  await f.call('/api/checkout', { method: 'POST', value }); const booking = f.repo.byRequest(value.requestKey), path = pathFor(booking.id), auth = f.app.registrationToken(booking.id);
  assert.equal((await f.call(path)).status, 401);
  assert.equal((await f.call(path, { auth: f.app.token(booking.id) })).status, 401);
  assert.equal((await f.call(path, { auth })).status, 409);
  f.stripe.paid(booking.stripe_session_id); await f.webhook(booking.stripe_session_id);
  assert.equal((await f.call(pathFor(randomUUID()), { auth })).status, 401);
  const entry = registerValue(f.repo.get(booking.id));
  assert.equal((await f.call(path, { method: 'PUT', auth, value: entry, origin: 'https://other.example' })).status, 403);
  const read = await f.call(path, { auth }); assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal(read.body.leadGuest.email, undefined);
  f.advance(40 * 86400); assert.equal((await f.call(path, { auth })).status, 410);
});
test('register includes 16/17-year-olds, validates conditional document fields and excludes younger children', async t => {
  const f = fixture(t), value = checkoutValue(f, { adults: 2, children: 3, sofaBed: true }); value.details.childAges = [8, 16, 17];
  const booking = await confirm(f, value), path = '/api/guest-registration?id=' + booking.id, auth = f.app.registrationToken(booking.id), entry = registerValue(booking);
  assert.equal((await f.call(path, { auth })).body.count, 4);
  entry.guests[1].nationality = 'United States'; entry.guests[1].travelDetailsRequired = true;
  assert.equal((await f.call(path, { method: 'PUT', auth, value: entry })).status, 400);
  Object.assign(entry.guests[1], { documentNumber: 'SYNTHETIC-TEST-ONLY', documentIssuePlace: 'Example city', nextDestination: 'Not yet known' });
  assert.equal((await f.call(path, { method: 'PUT', auth, value: entry })).status, 200);
  const status = await f.call('/api/booking-status?id=' + booking.id, { auth: f.app.token(booking.id) });
  assert.equal(status.body.registration, undefined); assert.ok(!JSON.stringify(status.body).includes('SYNTHETIC-TEST-ONLY'));
  f.repo.cancel(booking.id, f.now(), true); assert.equal((await f.call(path, { auth })).status, 409);
});
test('guest emails attach the exact stored terms and include private registration and hamper contents', async t => {
  const f = fixture(t), booking = await confirm(f, checkoutValue(f, { hamperId: 'breakfast-two', hamperQuantity: 1 }));
  const registrationUrl = f.runtime.baseUrl + '/guest-registration.html?id=' + booking.id + '#token=' + f.app.registrationToken(booking.id);
  let payload;
  const mailer = new EmailGateway({ from: 'Summit Club <bookings@summitclub.co>', ownerEmail: 'owner@example.com', apiKey: 'fake-test-key' }, async (_, options) => { payload = JSON.parse(options.body); return new Response('{"id":"email_fake"}', { status: 200 }); });
  await mailer.send({ id: 'test-message', kind: 'guest' }, booking, { registrationUrl });
  assert.match(payload.html, /COMPLETE GUEST REGISTRATION/); assert.match(payload.text, /Sausages; Bacon; Eggs; Baked beans/); assert.ok(!payload.text.includes('6 Free-range eggs')); assert.match(payload.text, /stocked before arrival/);
  assert.ok(payload.text.includes(registrationUrl));
  assert.match(payload.text, /48 hours/);
  const attachment = Buffer.from(payload.attachments[0].content, 'base64').toString('utf8');
  assert.ok(attachment.endsWith(booking.data.policySnapshot.text)); assert.ok(attachment.includes(booking.id));
  assert.ok(!payload.html.includes('1 Test Street'));
  const old = structuredClone(booking); delete old.data.policySnapshot; delete old.data.details; delete old.data.contact.address;
  const legacy = bookingEmailContent({ kind: 'guest' }, old, 'owner@example.com'); assert.ok(!legacy.text.includes('attached'));
  const cancelled = bookingEmailContent({ kind: 'guest_cancelled' }, booking, 'owner@example.com', { registrationUrl }); assert.ok(!cancelled.text.includes(registrationUrl));
});
test('email diagnostics contain safe categories and the owner sees failed/pending counts', async t => {
  const f = fixture(t), booking = await confirm(f, checkoutValue(f));
  const gateway = new EmailGateway({ from: 'fake', ownerEmail: 'owner@example.com', apiKey: 'fake' }, async () => new Response('{"message":"PRIVATE PROVIDER BODY"}', { status: 403 }));
  let failure; try { await gateway.send({ id: 'fake', kind: 'guest' }, booking); } catch (error) { failure = error; }
  assert.equal(failure.deliveryCode, 'authentication');
  const message = f.repo.outbox()[0]; f.repo.messageFailed(message.id, f.now(), 0, failure.deliveryCode);
  assert.deepEqual({ ...f.repo.emailHealth() }, { pending: 2, failed: 1 }); assert.match(f.repo.outbox()[0].last_error, /authentication/);
  assert.ok(!JSON.stringify(f.repo.outbox()).includes('PRIVATE PROVIDER BODY'));
});
test('incomplete business/legal review blocks live checkout but leaves sandbox testing available', async t => {
  const f = fixture(t, { mode: 'live' }); f.repo.saveSettings({ ...f.repo.settings(), pricesApproved: true });
  assert.equal((await f.call('/api/checkout', { method: 'POST', value: checkoutValue(f) })).status, 503);
  assert.equal(f.stripe.creates, 0); assert.equal(f.repo.list().length, 0);
  assert.ok(policySnapshot().text.includes('DRAFT / PRIVATE TEST'));
});
test('upgrading placeholder policies preserves owner prices, lodge names and historical bookings', async t => {
  const f = fixture(t); const b = await confirm(f, checkoutValue(f));
  f.repo.saveSettings({ ...f.repo.settings(), winterPence: 32100, lodges: [{ id: 'lodge-one', name: 'Owner lodge name' }, seed.lodges[1]], termsVersion: 'draft-2026-11-09', termsUrl: 'https://claude.ai/artifact/XKiY5cFXe3K2sqZ8JmtVn1', privacyUrl: 'https://claude.ai/artifact/GtF9st82U5NJbu3KEPhbeo' });
  const upgraded = new CoreRepository(f.repo.db, seed);
  assert.equal(upgraded.settings().termsUrl, '/booking-terms.html'); assert.equal(upgraded.settings().termsVersion, POLICY_VERSION);
  assert.equal(upgraded.settings().winterPence, 32100); assert.equal(upgraded.settings().lodges[0].name, 'Owner lodge name');
  assert.deepEqual(upgraded.get(b.id).quote, b.quote); assert.deepEqual(upgraded.get(b.id).data.policySnapshot, b.data.policySnapshot);
  upgraded.saveSettings({ ...upgraded.settings(), termsVersion: '2026-11-12-draft-1' });
  const currentDraft = new CoreRepository(f.repo.db, seed);
  assert.equal(currentDraft.settings().termsVersion, POLICY_VERSION);
  assert.deepEqual(currentDraft.get(b.id).data.policySnapshot, b.data.policySnapshot);
  upgraded.saveSettings({ ...upgraded.settings(), termsUrl: 'https://example.com/custom-terms' });
  assert.equal(new CoreRepository(f.repo.db, seed).settings().termsUrl, 'https://example.com/custom-terms');
});
