import test from 'node:test';
import assert from 'node:assert/strict';
import pricing from '../public/assets/pricing.js';
import { seed, selection } from './helpers.mjs';
const quote = (input = {}, settings = seed, extra = {}) => pricing.quote(settings, selection(input), { today: '2026-11-09', ...extra });

test('mixed-season stays charge each occupied night, with exclusive departure', () => {
  const q = quote({ checkIn: '2027-03-31', checkOut: '2027-04-03' }, { ...seed, peakRanges: [] });
  assert.deepEqual(q.daily.map(d => d.basePence), [25000, 36000, 36000]);
  assert.equal(q.totalPence, 97000); assert.equal(q.nights, 3);
});
test('group supplements, sofa bed and hamper quantities have exact integer totals', () => {
  const q = quote({ adults: 2, children: 3, sofaBed: true, hamperId: 'breakfast-family', hamperQuantity: 2 });
  assert.equal(q.accommodationPence, 50000); assert.equal(q.guestSupplementPence, 15000);
  assert.equal(q.sofaBedPence, 3000); assert.equal(q.hamperPence, 11000); assert.equal(q.totalPence, 79000);
  assert.equal(quote({ adults: 1 }).guestSupplementPence, 0);
});
test('peak ranges, summer, weekends and lodge-specific overrides combine correctly', () => {
  const settings = { ...seed, weekendSupplementPence: 1000 };
  assert.equal(pricing.nightlyRate(settings, '2027-02-12', 'lodge-one'), 43000);
  assert.equal(pricing.nightlyRate(settings, '2027-02-15', 'lodge-one'), 25000);
  assert.equal(pricing.nightlyRate(settings, '2027-07-05', 'lodge-one'), 42000);
  assert.equal(pricing.nightlyRate(settings, '2027-04-09', 'lodge-one', [{ lodgeId: 'lodge-one', night: '2027-04-09', pricePence: 30000 }]), 30000);
  assert.equal(pricing.nightlyRate(settings, '2027-04-09', 'lodge-two', [{ lodgeId: 'lodge-one', night: '2027-04-09', pricePence: 30000 }]), 37000);
});
test('UTC date arithmetic crosses UK clock changes and leap days without changing night count', () => {
  assert.equal(quote({ checkIn: '2027-03-27', checkOut: '2027-03-30' }).nights, 3);
  assert.deepEqual(pricing.nights('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29']);
  assert.throws(() => pricing.date('2027-02-29'));
  assert.throws(() => pricing.date('2027-13-01'));
});
test('invalid dates, capacities, quantities and tampered input are rejected', () => {
  for (const input of [
    { checkOut: '2026-12-11' }, { checkOut: '2026-12-10' }, { checkIn: '2026-11-10', checkOut: '2026-11-12' },
    { checkIn: '2028-10-01', checkOut: '2028-10-03' }, { adults: 4, children: 1 }, { adults: '2' },
    { adults: 0 }, { children: -1 }, { lodgeId: 'fake' }, { hamperId: 'fake', hamperQuantity: 1 },
    { hamperId: 'breakfast-two', hamperQuantity: 29 }, { hamperQuantity: 1 }, { bedroomOne: 'fake' }
  ]) assert.throws(() => quote(input), input + ' should be invalid');
  assert.throws(() => pricing.selection(seed, null, '2026-11-09'));
  assert.throws(() => pricing.validateSettings(null));
  assert.throws(() => pricing.validateSettings({ ...seed, winterPence: 10.1 }));
  assert.throws(() => pricing.validateSettings({ ...seed, termsUrl: 'javascript:alert(1)' }));
});
