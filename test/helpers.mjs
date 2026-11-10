import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { Repository } from '../server/repository.mjs';
import { createApp } from '../server/app.mjs';

export const seed = JSON.parse(readFileSync(new URL('../config/pricing.json', import.meta.url), 'utf8'));
export const selection = (extra = {}) => ({ lodgeId: 'lodge-one', checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2, children: 0, bedrooms: 2, sofaBed: false, hamperId: '', hamperQuantity: 0, bedroomOne: 'king', bedroomTwo: 'twin', ...extra });
export class FakeStripe {
  sessions = new Map(); ids = new Map(); creates = 0; retrieves = 0; expirations = 0;
  failCreate = 0; failRetrieve = false;
  async create(booking) {
    this.creates++;
    let session = this.sessions.get(this.ids.get(booking.id));
    if (!session) {
      const id = 'cs_test_' + randomUUID().replaceAll('-', '');
      session = { id, url: 'https://checkout.stripe.com/c/pay/' + id, mode: 'payment', status: 'open', payment_status: 'unpaid', currency: booking.quote.currency, amount_total: booking.quote.totalPence, livemode: booking.data.paymentMode === 'live', client_reference_id: booking.id, metadata: { booking_id: booking.id, source: 'summit-club' } };
      this.sessions.set(id, session); this.ids.set(booking.id, id);
    }
    if (this.failCreate-- > 0) throw new Error('Simulated timeout after Stripe created the session');
    return structuredClone(session);
  }
  async retrieve(id) { this.retrieves++; if (this.failRetrieve) throw new Error('Provider unavailable'); if (!this.sessions.has(id)) throw new Error('Not found'); return structuredClone(this.sessions.get(id)); }
  async expire(id) { this.expirations++; const s = this.sessions.get(id); if (s.payment_status !== 'paid') s.status = 'expired'; return structuredClone(s); }
  paid(id) { Object.assign(this.sessions.get(id), { status: 'complete', payment_status: 'paid', payment_intent: 'pi_test_payment' }); }
}
export function fixture(t, options = {}) {
  let time = Date.parse('2026-11-09T12:00:00Z');
  const repo = new Repository(':memory:', seed), stripe = new FakeStripe();
  const sent = [], mailer = { async send(message, booking) { sent.push({ message, booking }); return 'email_' + message.id; } };
  const runtime = { mode: 'test', paymentsEnabled: true, emailEnabled: false, baseUrl: 'http://localhost:3000', adminToken: 'owner-secret-'.repeat(4), receiptSecret: 'receipt-secret-'.repeat(4), webhookSecret: 'whsec_test_fixture', ...options };
  const app = createApp({ repo, stripe, mailer, runtime, clock: () => time });
  t.after(() => repo.close());
  async function call(path, { method = 'GET', value, auth, origin = runtime.baseUrl, raw, headers = {}, ip = '127.0.0.1' } = {}) {
    const response = await app.handle(new Request(runtime.baseUrl + path, {
      method, headers: { Origin: origin, ...(value !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...headers },
      body: raw !== undefined ? raw : value !== undefined ? JSON.stringify(value) : undefined
    }), { ip });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function start(extra = {}) {
    const input = selection(extra), q = await call('/api/quote', { method: 'POST', value: input });
    if (q.status !== 200) throw new Error(JSON.stringify(q.body));
    const value = { ...input, requestKey: randomUUID(), expectedTotalPence: q.body.quote.totalPence, quoteHash: q.body.quote.hash, termsAccepted: true, contact: { name: 'Test Guest', email: 'guest@example.com', phone: '' } };
    return { value, response: await call('/api/checkout', { method: 'POST', value }) };
  }
  async function webhook(sessionId, { type = 'checkout.session.completed', eventId = 'evt_' + randomUUID(), corrupt = false, timestamp = Math.floor(time / 1000), livemode = false, payload = {} } = {}) {
    const raw = JSON.stringify({ id: eventId, type, livemode, data: { object: { id: sessionId, ...payload } } });
    const sig = createHmac('sha256', runtime.webhookSecret).update(timestamp + '.' + raw).digest('hex');
    return call('/api/stripe/webhook', { method: 'POST', raw: corrupt ? raw + ' ' : raw, headers: { 'Stripe-Signature': 't=' + timestamp + ',v1=' + sig } });
  }
  return { repo, stripe, mailer, sent, app, runtime, call, start, webhook, advance: seconds => { time += seconds * 1000; }, now: () => Math.floor(time / 1000) };
}
