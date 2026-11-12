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
      mode: 'payment', integration_identifier: 'summit-club-direct-piupqwpg',
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
    return this.call('checkout/sessions', fields, 'summit-checkout-v2-' + booking.id);
  }
  retrieve(id) { return this.call('checkout/sessions/' + encodeURIComponent(id)); }
  expire(id) { return this.call('checkout/sessions/' + encodeURIComponent(id) + '/expire', {}, 'summit-expire-' + id); }
}

export class EmailGateway {
  constructor(options, fetcher = fetch) { this.options = options; this.fetcher = (...args) => fetcher(...args); }
  async send(message, booking) {
    const { from, ownerEmail, apiKey } = this.options;
    const { isOwner, subject, text, html } = bookingEmailContent(message, booking, ownerEmail);
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': 'summit-' + message.id },
      body: JSON.stringify({ from, to: [isOwner ? ownerEmail : booking.data.contact.email], reply_to: ownerEmail, subject, text, html }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error('Email delivery failed.');
    return result.id;
  }
}

const emailColours = { paper: '#121812', panel: '#1A221A', ink: '#EEEBE3', soft: '#BDBFB2', rule: '#2C362C', pine: '#0C110C', gold: '#D2B78F' };
const emailSans = 'Arial, Helvetica, sans-serif';
const emailSerif = "Georgia, 'Times New Roman', serif";
function emailEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function emailDate(value) {
  const date = new Date(value + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
function emailBed(value) { return value === 'twin' ? 'Twin beds' : 'King bed'; }
function emailDetail(label, value) {
  return `<tr><td valign="top" width="32%" style="padding:13px 12px 13px 0;border-bottom:1px solid ${emailColours.rule};font:13px/21px ${emailSans};color:${emailColours.soft};">${emailEscape(label)}</td><td valign="top" style="padding:13px 0;border-bottom:1px solid ${emailColours.rule};font:14px/21px ${emailSans};color:${emailColours.ink};">${emailEscape(value)}</td></tr>`;
}

// Inline styles, presentation tables and system fonts keep the core design
// readable when an email client removes the optional mobile style block.
export function bookingEmailContent(message, booking, ownerEmail) {
  const q = booking.quote, contact = booking.data.contact, s = q.selection;
  const isOwner = message.kind.startsWith('owner') || message.kind === 'review';
  const cancelled = message.kind.includes('cancelled'), review = message.kind === 'review';
  const test = booking.data.paymentMode === 'test';
  const subject = (test ? '[TEST] ' : '') + 'Summit Club · ' + (review ? 'Booking needs review' : cancelled ? 'Booking cancelled' : 'Booking confirmed');
  const heading = review ? 'A booking needs review.' : cancelled ? (isOwner ? 'A stay has been cancelled.' : 'Your booking is cancelled.') : isOwner ? 'A new stay is booked.' : 'Your stay is booked.';
  const introduction = review ? 'Please review this payment and its date reservation in the owner dashboard before confirming the stay.' : cancelled ? (isOwner ? contact.name + '’s booking has been cancelled.' : 'Your Summit Club booking has been cancelled. Reply to this email if you have any questions.') : isOwner ? contact.name + ' has booked a stay at Summit Club. The booking details are below.' : 'Thank you, ' + contact.name + '. We look forward to welcoming you to the Mournes.';
  const room = s.bedrooms === 1 ? 'One bedroom · second bedroom is closed' : 'Two bedrooms · full lodge';
  const beds = 'Bedroom one: ' + emailBed(s.bedroomOne) + (s.bedrooms === 1 ? '' : '; bedroom two: ' + emailBed(s.bedroomTwo));
  const sofa = s.sofaBed === true || q.sofaBedPence > 0 ? 'Reserved for children' : 'Not reserved';
  const extras = q.hamperName ? q.hamperName + ' × ' + s.hamperQuantity : 'None selected';
  const guests = s.adults + ' ' + (s.adults === 1 ? 'adult' : 'adults') + ' · ' + s.children + ' ' + (s.children === 1 ? 'child' : 'children');
  const text = [
    test ? 'TEST BOOKING — no real payment was taken.' : '',
    review ? 'Please review this payment and date reservation in the owner screen.' : cancelled ? 'This booking has been cancelled.' : 'Your Summit Club booking is confirmed.',
    introduction, '', 'Reference: ' + booking.id,
    q.lodge.name + ': ' + booking.check_in + ' to ' + booking.check_out + ' (' + q.nights + ' nights)',
    'Guests: ' + guests, room, beds, 'Sofa bed: ' + sofa[0].toLowerCase() + sofa.slice(1) + '.', 'Breakfast hamper: ' + extras,
    (cancelled ? 'Original booking total: ' : review ? 'Booking total to review: ' : 'Total for your stay: ') + pricing.money(q.totalPence),
    !cancelled && !review ? 'Check-in from 3pm; check-out by 11am.' : '',
    isOwner ? 'Guest: ' + contact.name + ' · ' + contact.email + (contact.phone ? ' · ' + contact.phone : '') : '',
    '', 'Questions or a change of plan? Reply to this email.', 'Contact: ' + ownerEmail, 'Summit Club · Your place in the Mournes.'
  ].filter(Boolean).join('\n');
  const c = emailColours;
  const testNotice = test ? `<tr><td class="email-pad" style="padding:0 40px 26px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="${c.panel}" style="padding:14px 16px;border:1px solid ${c.gold};background-color:${c.panel};color:${c.gold};font:12px/19px ${emailSans};"><strong style="letter-spacing:1.6px;font-size:10px;">TEST BOOKING</strong><br>No real payment was taken.</td></tr></table></td></tr>` : '';
  const details = [emailDetail('Guests', guests), emailDetail('Bedrooms', room), emailDetail('Bed setup', beds), emailDetail('Sofa bed', sofa), emailDetail('Breakfast hamper', extras)].join('');
  const guestDetails = isOwner ? `<tr><td class="email-pad" style="padding:28px 40px 0;"><p style="margin:0 0 12px;font:600 10px/16px ${emailSans};letter-spacing:2.3px;color:${c.gold};">GUEST DETAILS</p><p style="margin:0;font:14px/23px ${emailSans};color:${c.ink};">${emailEscape(contact.name)}<br><a href="mailto:${emailEscape(encodeURIComponent(contact.email))}" style="color:${c.ink};text-decoration:underline;word-break:break-all;">${emailEscape(contact.email)}</a>${contact.phone ? '<br>' + emailEscape(contact.phone) : ''}</p></td></tr>` : '';
  const arrivalNote = !cancelled && !review ? `<tr><td class="email-pad" style="padding:24px 40px 0;"><p style="margin:0;font:13px/22px ${emailSans};color:${c.soft};">Check-in from 3pm. Check-out by 11am.</p></td></tr>` : '';
  const totalLabel = cancelled ? 'Original booking total' : review ? 'Booking total to review' : 'Total for your stay';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${emailEscape(subject)}</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}table{border-collapse:collapse}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}@media only screen and (max-width:480px){.email-wrap{padding:16px 10px!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.email-title{font-size:36px!important;line-height:40px!important}.email-total{font-size:30px!important}}</style></head>
<body style="margin:0;padding:0;width:100%;background-color:${c.pine};color:${c.ink};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${emailEscape((test ? 'TEST BOOKING · ' : '') + heading + ' ' + q.lodge.name + ' · ' + emailDate(booking.check_in) + '–' + emailDate(booking.check_out))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.pine}" style="width:100%;background-color:${c.pine};"><tr><td align="center" class="email-wrap" style="padding:36px 16px;">
<!--[if mso]><table role="presentation" width="640" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.paper}" style="width:100%;max-width:640px;background-color:${c.paper};border:1px solid ${c.rule};border-top:3px solid ${c.gold};">
<tr><td class="email-pad" style="padding:38px 40px 30px;"><p style="margin:0;font:600 12px/18px ${emailSans};letter-spacing:4px;color:${c.gold};">SUMMIT CLUB</p><p style="margin:9px 0 0;font:12px/18px ${emailSans};color:${c.soft};">Your place in the Mournes.</p></td></tr>
${testNotice}
<tr><td class="email-pad" style="padding:0 40px 28px;"><h1 class="email-title" style="margin:0 0 18px;font:normal 44px/49px ${emailSerif};letter-spacing:-1px;color:${c.ink};">${emailEscape(heading)}</h1><p style="margin:0;font:15px/25px ${emailSans};color:${c.soft};">${emailEscape(introduction)}</p></td></tr>
<tr><td class="email-pad" style="padding:0 40px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:22px 0 20px;border-top:1px solid ${c.rule};"><p style="margin:0 0 9px;font:600 10px/16px ${emailSans};letter-spacing:2.3px;color:${c.gold};">${cancelled ? 'ORIGINAL STAY' : review ? 'STAY TO REVIEW' : 'YOUR STAY'}</p><h2 style="margin:0;font:normal 27px/34px ${emailSerif};color:${c.ink};">${emailEscape(q.lodge.name)}</h2><p style="margin:6px 0 0;font:13px/20px ${emailSans};color:${c.soft};">${q.nights} ${q.nights === 1 ? 'night' : 'nights'} · ${emailEscape(room)}</p></td></tr></table></td></tr>
<tr><td class="email-pad" style="padding:0 40px 20px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.panel}" style="background-color:${c.panel};"><tr><td width="50%" valign="top" style="padding:18px 16px;border:1px solid ${c.rule};"><p style="margin:0 0 7px;font:600 10px/16px ${emailSans};letter-spacing:1.6px;color:${c.gold};">ARRIVAL</p><p style="margin:0;font:normal 20px/27px ${emailSerif};color:${c.ink};">${emailEscape(emailDate(booking.check_in))}</p></td><td width="50%" valign="top" style="padding:18px 16px;border:1px solid ${c.rule};"><p style="margin:0 0 7px;font:600 10px/16px ${emailSans};letter-spacing:1.6px;color:${c.gold};">DEPARTURE</p><p style="margin:0;font:normal 20px/27px ${emailSerif};color:${c.ink};">${emailEscape(emailDate(booking.check_out))}</p></td></tr></table></td></tr>
<tr><td class="email-pad" style="padding:0 40px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${details}</table></td></tr>
<tr><td class="email-pad" style="padding:26px 40px 0;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${c.gold}" style="background-color:${c.gold};"><tr><td style="padding:18px 20px;font:14px/21px ${emailSans};color:${c.paper};">${emailEscape(totalLabel)}<br><span style="font-size:11px;">GBP${test ? ' · test payment' : ''}</span></td><td align="right" class="email-total" style="padding:18px 20px;font:normal 34px/38px ${emailSerif};color:${c.paper};white-space:nowrap;">${emailEscape(pricing.money(q.totalPence))}</td></tr></table></td></tr>
${arrivalNote}${guestDetails}
<tr><td class="email-pad" style="padding:26px 40px 28px;"><p style="margin:0 0 7px;font:600 10px/16px ${emailSans};letter-spacing:2px;color:${c.soft};">BOOKING REFERENCE</p><p style="margin:0;font:12px/20px ${emailSans};color:${c.soft};word-break:break-all;">${emailEscape(booking.id)}</p></td></tr>
<tr><td class="email-pad" style="padding:25px 40px 32px;border-top:1px solid ${c.rule};"><p style="margin:0 0 8px;font:normal 22px/29px ${emailSerif};color:${c.ink};">${isOwner ? 'All the details, in one place.' : 'Questions or a change of plan?'}</p><p style="margin:0 0 22px;font:13px/22px ${emailSans};color:${c.soft};">${isOwner ? 'This is the owner copy of the booking update. Guest contact details are shown above.' : 'Reply to this email and we’ll help.'}</p><a href="https://summitclub.co" style="font:600 10px/18px ${emailSans};letter-spacing:2px;color:${c.gold};text-decoration:underline;">SUMMITCLUB.CO</a></td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { isOwner, subject, text, html };
}
