import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import pricing from '../public/assets/pricing.js';
import { BookingError } from './repository-core.mjs';

export function verifyStripeSignature(raw, header, secret, now) {
  if (!secret || typeof header !== 'string') throw new BookingError('Invalid webhook signature.', 400);
  const pairs = header.split(',').map(s => s.trim().split('='));
  const timestamp = Number(pairs.find(p => p[0] === 't')?.[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) throw new BookingError('Invalid webhook timestamp.', 400);
  const expected = createHmac('sha256', secret).update(String(timestamp) + '.').update(raw).digest();
  const valid = pairs.filter(p => p[0] === 'v1').some(([, value]) => {
    if (!/^[0-9a-f]{64}$/i.test(value || '')) return false;
    return timingSafeEqual(expected, Buffer.from(value, 'hex'));
  });
  if (!valid) throw new BookingError('Invalid webhook signature.', 400);
}

export class StripeGateway {
  constructor(key, fetcher = fetch) { this.key = key; this.fetcher = (...args) => fetcher(...args); }
  async call(path, fields = null, idempotencyKey = null) {
    const headers = { Authorization: 'Bearer ' + this.key, 'Stripe-Version': '2026-10-28.endive' };
    if (fields) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const response = await this.fetcher('https://api.stripe.com/v1/' + path, {
      method: fields ? 'POST' : 'GET', headers,
      body: fields ? new URLSearchParams(fields) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new BookingError('The payment provider could not complete this step. Please try again.', 502);
      error.providerCode = body.error?.code || 'provider_error'; throw error;
    }
    return body;
  }
  create(booking, baseUrl, receiptToken) {
    const q = booking.quote;
    const stateUrl = baseUrl + '/booking-status.html?id=' + booking.id + '#token=' + receiptToken;
    const fields = {
      mode: 'payment', 'payment_method_types[0]': 'card',
      client_reference_id: booking.id, customer_email: booking.data.contact.email,
      'metadata[booking_id]': booking.id, 'metadata[source]': 'summit-club',
      success_url: stateUrl, cancel_url: stateUrl,
      expires_at: String(booking.expires_at),
      'adaptive_pricing[enabled]': 'false'
    };
    const items = [
      [q.lodge.name + ' · ' + (q.selection.bedrooms === 1 ? 'one bedroom' : 'two bedrooms') + ' · ' + q.nights + ' nights · ' + q.selection.checkIn + ' to ' + q.selection.checkOut, q.accommodationPence],
      ['Additional guests', q.guestSupplementPence],
      ['Sofa bed for children · per booking', q.sofaBedPence],
      [q.hamperName + (q.selection.hamperQuantity > 1 ? ' × ' + q.selection.hamperQuantity : ''), q.hamperPence]
    ].filter(([, amount]) => amount > 0);
    items.forEach(([name, amount], i) => {
      fields['line_items[' + i + '][price_data][currency]'] = 'gbp';
      fields['line_items[' + i + '][price_data][product_data][name]'] = name;
      fields['line_items[' + i + '][price_data][unit_amount]'] = String(amount);
      fields['line_items[' + i + '][quantity]'] = '1';
    });
    return this.call('checkout/sessions', fields, 'summit-checkout-' + booking.id);
  }
  retrieve(id) { return this.call('checkout/sessions/' + encodeURIComponent(id)); }
  expire(id) { return this.call('checkout/sessions/' + encodeURIComponent(id) + '/expire', {}, 'summit-expire-' + id); }
}

export class EmailGateway {
  constructor(options, fetcher = fetch) { this.options = options; this.fetcher = (...args) => fetcher(...args); }
  async send(message, booking) {
    const { from, ownerEmail, apiKey } = this.options;
    const isOwner = message.kind.startsWith('owner') || message.kind === 'review';
    const cancelled = message.kind.includes('cancelled');
    const review = message.kind === 'review';
    const q = booking.quote, contact = booking.data.contact;
    const subject = review ? 'Booking needs review' : cancelled ? 'Booking cancelled' : 'Booking confirmed';
    const lines = [
      booking.data.paymentMode === 'test' ? 'TEST BOOKING — no real payment was taken.' : '',
      (review ? 'Please review this payment and date reservation in the owner screen.' : cancelled ? 'This booking has been cancelled.' : 'Your Summit Club booking is confirmed.'),
      '', 'Reference: ' + booking.id,
      q.lodge.name + ': ' + booking.check_in + ' to ' + booking.check_out + ' (' + q.nights + ' nights)',
      'Guests: ' + q.selection.adults + ' adults, ' + q.selection.children + ' children',
      q.selection.bedrooms === 1 ? 'One-bedroom stay. Bedroom one: ' + q.selection.bedroomOne + '. The second bedroom is closed.' : 'Two-bedroom stay. Bedroom one: ' + q.selection.bedroomOne + '; bedroom two: ' + q.selection.bedroomTwo,
      (q.selection.sofaBed === true || q.sofaBedPence > 0) ? 'Sofa bed: reserved for children.' : 'Sofa bed: not reserved.',
      q.hamperName ? 'Extras: ' + q.hamperName + ' × ' + q.selection.hamperQuantity : 'No breakfast hamper selected.',
      'Total: ' + pricing.money(q.totalPence),
      '', 'Check-in from 3pm; check-out by 11am.',
      'Questions: ' + ownerEmail,
      isOwner ? 'Guest: ' + contact.name + ' · ' + contact.email + ' · ' + contact.phone : ''
    ].filter(Boolean);
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': 'summit-' + message.id },
      body: JSON.stringify({ from, to: [isOwner ? ownerEmail : contact.email], reply_to: ownerEmail, subject: (booking.data.paymentMode === 'test' ? '[TEST] ' : '') + 'Summit Club · ' + subject, text: lines.join('\n') }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error('Email delivery failed.');
    return result.id;
  }
}
