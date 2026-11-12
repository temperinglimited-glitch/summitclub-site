import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bookingEmailContent } from '../server/providers.mjs';
import pricing from '../public/assets/pricing.js';
import { policySnapshot, hamperInfo, POLICY_VERSION } from '../server/policies.mjs';

// Synthetic examples only. This script renders files and never sends email.
const destination = resolve(process.argv[2] || 'email-previews');
const settings = JSON.parse(await readFile(new URL('../config/pricing.json', import.meta.url), 'utf8'));
const selection = { lodgeId: 'lodge-two', checkIn: '2027-01-08', checkOut: '2027-01-10', adults: 2, children: 2, bedrooms: 2, bedroomOne: 'king', bedroomTwo: 'twin', sofaBed: false, hamperId: 'breakfast-family', hamperQuantity: 1 };
const booking = {
  id: 'preview-2027-0108-summit-club', check_in: selection.checkIn, check_out: selection.checkOut,
  data: { paymentMode: 'test', termsVersion: POLICY_VERSION, termsAcceptedAt: 1794484800, policySnapshot: policySnapshot(), hamperInformation: hamperInfo(selection.hamperId), details: { childAges: [8, 6], hamperFulfilment: 'before-arrival', requests: '' }, contact: { name: 'Example Guest', email: 'guest@example.com', phone: '+44 7700 900123' } },
  quote: pricing.quote(settings, selection, { today: '2026-11-12' })
};
const context = { registrationUrl: 'https://test.summitclub.co/guest-registration.html?id=synthetic-preview#token=example-only' };
await mkdir(destination, { recursive: true });
for (const [name, kind] of [['index', 'guest'], ['owner', 'owner'], ['cancelled', 'guest_cancelled'], ['owner-cancelled', 'owner_cancelled'], ['review', 'review']]) {
  const content = bookingEmailContent({ kind }, booking, 'owner@example.com', context);
  await writeFile(resolve(destination, name + '.html'), content.html);
  await writeFile(resolve(destination, name + '.txt'), content.text);
}
const oneBedroom = structuredClone(booking);
Object.assign(oneBedroom.quote.selection, { adults: 2, children: 0, bedrooms: 1, bedroomTwo: 'closed' });
oneBedroom.quote.hamperName = ''; oneBedroom.quote.selection.hamperQuantity = 0;
delete oneBedroom.data.hamperInformation; oneBedroom.data.details = { childAges: [], requests: '' };
oneBedroom.quote.totalPence = oneBedroom.quote.accommodationPence;
await writeFile(resolve(destination, 'one-bedroom.html'), bookingEmailContent({ kind: 'guest' }, oneBedroom, 'owner@example.com').html);
console.log('Email previews: ' + destination);
