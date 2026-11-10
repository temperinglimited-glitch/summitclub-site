import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pricing from '../public/assets/pricing.js';
import { Repository } from '../server/repository.mjs';
import { EmailGateway, StripeGateway } from '../server/providers.mjs';
import { fixture, seed, selection } from './helpers.mjs';
const q = (extra = {}) => pricing.quote(seed, selection(extra), { today: '2026-11-09' });

test('four adults are accepted alone and rejected with any children or sofa bed', () => {
  assert.equal(q({ adults: 4 }).selection.adults, 4);
  for (const children of [1,2,3]) assert.throws(() => q({ adults: 4, children, sofaBed: true }));
  assert.throws(() => q({ adults: 5 })); assert.throws(() => q({ adults: 4, sofaBed: true }));
});
test('families explicitly choose sofa preparation; £30 is charged once per booking', () => {
  for (const children of [1,2]) {
    const without = q({ children }), withSofa = q({ children, sofaBed: true });
    assert.equal(without.sofaBedPence, 0); assert.equal(withSofa.sofaBedPence, 3000);
    assert.equal(withSofa.totalPence - without.totalPence, 3000);
  }
  assert.equal(q({ children: 1, sofaBed: true, checkOut: '2026-12-15' }).sofaBedPence, 3000);
  assert.throws(() => q({ sofaBed: true })); assert.throws(() => q({ children: 1, sofaBed: 'true' }));
});
test('two adults and three children must reserve the sofa; other five-person combinations are rejected', () => {
  assert.throws(() => q({ children: 3 }));
  assert.equal(q({ children: 3, sofaBed: true }).sofaBedPence, 3000);
  assert.throws(() => q({ adults: 3, children: 2, sofaBed: true }));
  assert.equal(q({ adults: 3, children: 1, sofaBed: true }).sofaBedPence, 3000);
});
test('one bedroom allows at most two guests and normalises the second bedroom to closed', () => {
  const one = pricing.selection(seed, selection({ bedrooms: 1 }), '2026-11-09');
  assert.equal(one.bedroomTwo, 'closed'); assert.equal(one.bedrooms, 1);
  assert.equal(pricing.selection(seed, selection({ bedrooms: 1, adults: 1, children: 1 }), '2026-11-09').children, 1);
  assert.throws(() => pricing.selection(seed, selection({ bedrooms: 1, children: 1 }), '2026-11-09'));
  assert.throws(() => pricing.selection(seed, selection({ bedrooms: 1, adults: 1, children: 1, sofaBed: true }), '2026-11-09'));
  assert.throws(() => pricing.selection(seed, selection({ bedrooms: '1' }), '2026-11-09'));
});
test('one-bedroom dates start closed; every occupied night must be explicitly priced', async t => {
  const f = fixture(t), value = selection({ bedrooms: 1 });
  assert.equal((await f.call('/api/quote', { method: 'POST', value })).status, 409);
  f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-11', 19000, 1);
  assert.equal((await f.call('/api/quote', { method: 'POST', value })).status, 409);
  f.repo.setOverride('lodge-one', '2026-12-11', '2026-12-12', 21000, 1);
  const quoted = await f.call('/api/quote', { method: 'POST', value });
  assert.equal(quoted.status, 200); assert.equal(quoted.body.quote.totalPence, 40000);
  assert.deepEqual(quoted.body.quote.daily.map(d => d.basePence), [19000, 21000]);
  assert.equal(quoted.body.quote.selection.bedroomTwo, 'closed');
});
test('any-lodge selection can find one-bedroom dates on the second lodge only', async t => {
  const f = fixture(t); f.repo.setOverride('lodge-two', '2026-12-10', '2026-12-12', 20000, 1);
  const quote = f.app.findQuote(selection({ bedrooms: 1, lodgeId: 'any' }));
  assert.equal(quote.lodge.id, 'lodge-two'); assert.equal(quote.totalPence, 40000);
});
test('one-bedroom reservations lock the entire lodge against both booking options', async t => {
  const f = fixture(t); f.repo.setOverride('both', '2026-12-10', '2026-12-12', 20000, 1);
  const started = await f.start({ bedrooms: 1 }); assert.equal(started.response.status, 200);
  for (const bedrooms of [1,2]) assert.equal((await f.call('/api/quote', { method: 'POST', value: selection({ bedrooms }) })).status, 409);
  assert.equal(f.app.findQuote(selection({ bedrooms: 1, lodgeId: 'lodge-two' })).totalPence, 40000);
});
test('daily editing works for both lodges and bedroom options; clearing one-bedroom prices closes only that option', async t => {
  const f = fixture(t), auth = f.runtime.adminToken;
  for (const [bedrooms, pricePence] of [[1,18000],[2,28000]]) assert.equal((await f.call('/api/admin/rates', { method: 'PUT', auth, value: { lodgeId: 'both', bedrooms, from: '2026-12-10', to: '2026-12-12', pricePence } })).status, 200);
  for (const lodgeId of ['lodge-one','lodge-two']) {
    assert.equal(f.app.findQuote(selection({ lodgeId, bedrooms: 1 })).totalPence, 36000);
    assert.equal(f.app.findQuote(selection({ lodgeId })).totalPence, 56000);
  }
  const calendar = await f.call('/api/admin/calendar?from=2026-12-10&to=2026-12-12', { auth });
  assert.equal(calendar.body.days[0].lodges[0].oneBedroomPence, 18000);
  assert.equal(calendar.body.days[0].lodges[0].twoBedroomPence, 28000);
  f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-12', null, 1);
  assert.throws(() => f.app.findQuote(selection({ bedrooms: 1 })));
  assert.equal(f.app.findQuote(selection()).totalPence, 56000);
  f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-12', null, 2);
  assert.equal(f.app.findQuote(selection()).totalPence, 50000);
});
test('public availability distinguishes closed one-bedroom dates from the two-bedroom calendar', async t => {
  const f = fixture(t);
  let one = await f.call('/api/availability?from=2026-12-10&to=2026-12-12&bedrooms=1');
  assert.ok(one.body.days.every(d => !d.available && d.basePence === null));
  f.repo.setOverride('lodge-two', '2026-12-10', '2026-12-12', 19900, 1);
  one = await f.call('/api/availability?from=2026-12-10&to=2026-12-12&bedrooms=1');
  assert.deepEqual(one.body.days[0].availableLodges, ['lodge-two']); assert.equal(one.body.days[0].basePence, 19900);
  assert.equal((await f.call('/api/availability?from=2026-12-10&to=2026-12-12&bedrooms=2')).body.days[0].basePence, 25000);
});
test('editing daily prices does not alter an existing checkout or confirmed quote', async t => {
  const f = fixture(t); f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-12', 18000, 1);
  const { value, response } = await f.start({ bedrooms: 1 }); assert.equal(response.status, 200);
  const booking = f.repo.list()[0]; f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-12', 22000, 1);
  assert.equal(f.repo.get(booking.id).quote.totalPence, 36000);
  assert.equal((await f.call('/api/checkout', { method: 'POST', value })).status, 200);
  f.stripe.paid(booking.stripe_session_id); await f.webhook(booking.stripe_session_id);
  assert.equal(f.repo.get(booking.id).quote.totalPence, 36000);
});
test('Stripe and confirmation email carry the selected bedroom plan and sofa choice', async t => {
  const f = fixture(t); f.repo.setOverride('lodge-one', '2026-12-10', '2026-12-12', 18000, 1);
  await f.start({ bedrooms: 1 }); const booking = f.repo.list()[0]; let stripeFields, email;
  const stripe = new StripeGateway('sk_test_fake', async (_, options) => { stripeFields = options.body; return new Response('{}'); });
  await stripe.create(booking, f.runtime.baseUrl, 'token');
  assert.match(stripeFields.get('line_items[0][price_data][product_data][name]'), /one bedroom/);
  const mailer = new EmailGateway({ apiKey: 'fake', from: 'test@example.com', ownerEmail: 'owner@example.com' }, async (_, options) => { email = JSON.parse(options.body); return new Response('{"id":"ok"}'); });
  await mailer.send({ id: 'test', kind: 'owner' }, booking);
  assert.match(email.text, /second bedroom is closed/); assert.match(email.text, /Sofa bed: not reserved/);
});
test('upgrading old settings applies the new £30 rule while preserving recorded booking quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'summit-migrate-')), path = join(dir, 'db.sqlite'); let repo;
  try {
    repo = new Repository(path, seed);
    const old = { ...seed, sofaBedPerStayPence: 2500, pricesApproved: true }; delete old.bookingRulesVersion;
    const snapshot = q(); const booking = repo.reserve({ quote: snapshot, data: { paymentMode: 'test' }, now: 1000 });
    repo.db.prepare('UPDATE settings SET json=?').run(JSON.stringify(old)); repo.close();
    repo = new Repository(path, seed);
    assert.equal(repo.settings().sofaBedPerStayPence, 3000); assert.equal(repo.settings().pricesApproved, false);
    assert.equal(repo.settings().bookingRulesVersion, 2); assert.equal(repo.get(booking.id).quote.totalPence, snapshot.totalPence);
    assert.deepEqual(repo.oneBedroomRates('2026-12-10','2026-12-12'), []);
  } finally { if (repo) repo.close(); rmSync(dir, { force: true, recursive: true }); }
});
