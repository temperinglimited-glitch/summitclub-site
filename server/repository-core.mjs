import { randomUUID } from 'node:crypto';
import pricing from '../public/assets/pricing.js';
import { POLICY_VERSION, TERMS_URL, PRIVACY_URL } from './policies.mjs';

export class BookingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class CoreRepository {
  constructor(database, seed) {
    this.db = database;
    this.db.exec([
      'CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);',
      'CREATE TABLE IF NOT EXISTS bookings(',
      'id TEXT PRIMARY KEY, request_key TEXT UNIQUE, request_hash TEXT, status TEXT NOT NULL,',
      'lodge_id TEXT NOT NULL, check_in TEXT NOT NULL, check_out TEXT NOT NULL,',
      'data_json TEXT NOT NULL, quote_json TEXT, created_at INTEGER NOT NULL, expires_at INTEGER,',
      'stripe_session_id TEXT UNIQUE, checkout_url TEXT, payment_intent_id TEXT, last_error TEXT, updated_at INTEGER NOT NULL);',
      'CREATE TABLE IF NOT EXISTS night_locks(lodge_id TEXT NOT NULL, night TEXT NOT NULL,',
      'booking_id TEXT NOT NULL REFERENCES bookings(id), PRIMARY KEY(lodge_id,night));',
      'CREATE INDEX IF NOT EXISTS locks_booking ON night_locks(booking_id);',
      'CREATE TABLE IF NOT EXISTS rate_overrides(lodge_id TEXT NOT NULL,night TEXT NOT NULL,',
      'price_pence INTEGER NOT NULL CHECK(price_pence>0),PRIMARY KEY(lodge_id,night));',
      'CREATE TABLE IF NOT EXISTS one_bedroom_rates(lodge_id TEXT NOT NULL,night TEXT NOT NULL,',
      'price_pence INTEGER NOT NULL CHECK(price_pence>0),PRIMARY KEY(lodge_id,night));',
      'CREATE TABLE IF NOT EXISTS stripe_events(id TEXT PRIMARY KEY, processed_at INTEGER NOT NULL);',
      'CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,booking_id TEXT NOT NULL REFERENCES bookings(id),',
      'kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',attempts INTEGER NOT NULL DEFAULT 0,',
      'next_attempt INTEGER NOT NULL DEFAULT 0,last_error TEXT,provider_id TEXT,UNIQUE(booking_id,kind));'
    ].join('\n'));
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(pricing.validateSettings(seed)));
    const previous = this.settings();
    const previousHamperVersion = previous.hamperVersion || 0;
    if (previous.bookingRulesVersion !== 2) {
      const migrated = pricing.validateSettings({ ...previous, sofaBedPerStayPence: 3000, pricesApproved: false });
      this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(migrated));
    }
    // Upgrade the original placeholder labels while preserving owner-customised names.
    const named = this.settings();
    let renamed = false;
    named.lodges = named.lodges.map(lodge => {
      const oldName = lodge.id === 'lodge-one' ? 'Lodge One' : lodge.id === 'lodge-two' ? 'Lodge Two' : null;
      const configured = seed.lodges.find(l => l.id === lodge.id);
      if (configured && lodge.name === oldName && configured.name !== oldName) { renamed = true; return { ...lodge, name: configured.name }; }
      return lodge;
    });
    if (renamed) this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(named));
    const extras = this.settings();
    if (previousHamperVersion < 2) {
      extras.hampers = extras.hampers.map(h => {
        const configured = seed.hampers.find(item => item.id === h.id);
        return configured && ['breakfast-two', 'breakfast-family'].includes(h.id) ? { ...h, name: configured.name, pricePence: configured.pricePence } : h;
      });
      extras.hamperVersion = 2;
      this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(extras));
    }
    // Only replace the original placeholder links. Do not reset owner pricing or custom policies.
    const policies = this.settings();
    const placeholderPolicies = policies.termsUrl === 'https://claude.ai/artifact/XKiY5cFXe3K2sqZ8JmtVn1' && policies.privacyUrl === 'https://claude.ai/artifact/GtF9st82U5NJbu3KEPhbeo';
    const earlierManagedDraft = policies.termsUrl === TERMS_URL && policies.privacyUrl === PRIVACY_URL && ['2026-11-12-draft-1', '2026-11-12-draft-2'].includes(policies.termsVersion);
    if (placeholderPolicies || earlierManagedDraft) {
      policies.termsUrl = TERMS_URL; policies.privacyUrl = PRIVACY_URL; policies.termsVersion = POLICY_VERSION;
      this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(policies));
    }
  }
  close() { this.db.close(); }
  transaction(fn) {
    if (typeof this.db.transactionSync === 'function') return this.db.transactionSync(fn);
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  settings() { return JSON.parse(this.db.prepare('SELECT json FROM settings WHERE id=1').get().json); }
  saveSettings(value) {
    const next = pricing.validateSettings(value);
    const previous = this.settings();
    if (next.lodges.map(l => l.id).join() !== previous.lodges.map(l => l.id).join()) throw new BookingError('Keep the existing lodge identifiers; their names can be changed.');
    this.db.prepare('UPDATE settings SET json=? WHERE id=1').run(JSON.stringify(next)); return next;
  }
  decode(row) {
    return row ? { ...row, data: JSON.parse(row.data_json), quote: row.quote_json ? JSON.parse(row.quote_json) : null, data_json: undefined, quote_json: undefined } : null;
  }
  get(id) { return this.decode(this.db.prepare('SELECT * FROM bookings WHERE id=?').get(id)); }
  byRequest(key) { return this.decode(this.db.prepare('SELECT * FROM bookings WHERE request_key=?').get(key)); }
  list() { return this.db.prepare('SELECT * FROM bookings ORDER BY created_at DESC LIMIT 1000').all().map(r => this.decode(r)); }
  saveRegistration(id, value, now) {
    return this.transaction(() => {
      const booking = this.get(id);
      if (!booking || booking.status !== 'confirmed') throw new BookingError('The booking is no longer confirmed.', 409);
      const data = { ...booking.data, registration: { ...value, updatedAt: now } };
      this.db.prepare('UPDATE bookings SET data_json=?,updated_at=? WHERE id=?').run(JSON.stringify(data), now, id);
      return this.get(id);
    });
  }
  available(lodgeId, from, to) {
    return !this.db.prepare('SELECT 1 FROM night_locks WHERE lodge_id=? AND night>=? AND night<? LIMIT 1').get(lodgeId, from, to);
  }
  locked(from, to) { return this.db.prepare('SELECT lodge_id AS lodgeId,night FROM night_locks WHERE night>=? AND night<?').all(from, to); }
  overrides(from, to) { return this.db.prepare('SELECT lodge_id AS lodgeId,night,price_pence AS pricePence FROM rate_overrides WHERE night>=? AND night<?').all(from, to); }
  oneBedroomRates(from, to) { return this.db.prepare('SELECT lodge_id AS lodgeId,night,price_pence AS pricePence FROM one_bedroom_rates WHERE night>=? AND night<?').all(from, to); }
  setOverride(lodgeId, from, to, amount, bedrooms = 2) {
    pricing.integer(bedrooms, 1, 2, 'bedrooms');
    const lodges = this.settings().lodges.filter(l => lodgeId === 'both' || l.id === lodgeId);
    if (!lodges.length) throw new BookingError('Choose a lodge.');
    const days = pricing.nights(from, to, 366);
    if (amount !== null) pricing.integer(amount, 100, 500000, 'nightly override');
    const table = bedrooms === 1 ? 'one_bedroom_rates' : 'rate_overrides';
    this.transaction(() => {
      for (const lodge of lodges) for (const night of days) {
        if (amount === null) this.db.prepare('DELETE FROM ' + table + ' WHERE lodge_id=? AND night=?').run(lodge.id, night);
        else this.db.prepare('INSERT INTO ' + table + ' VALUES(?,?,?) ON CONFLICT(lodge_id,night) DO UPDATE SET price_pence=excluded.price_pence').run(lodge.id, night, amount);
      }
    });
  }
  reserve({ requestKey, requestHash, quote, data, now, blocked = false }) {
    return this.transaction(() => {
      const existing = requestKey ? this.byRequest(requestKey) : null;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new BookingError('That checkout attempt belongs to a different selection.', 409);
        return existing;
      }
      if (!this.available(quote.lodge.id, quote.selection.checkIn, quote.selection.checkOut)) throw new BookingError('Those nights have just been reserved. Please choose another lodge or dates.', 409);
      const id = randomUUID(), status = blocked ? 'blocked' : 'creating';
      // Stripe requires at least 30 minutes at creation. One hour leaves room for safe retries.
      const expires = blocked ? null : now + 3600;
      this.db.prepare('INSERT INTO bookings(id,request_key,request_hash,status,lodge_id,check_in,check_out,data_json,quote_json,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, requestKey || null, requestHash || null, status, quote.lodge.id, quote.selection.checkIn, quote.selection.checkOut, JSON.stringify(data), blocked ? null : JSON.stringify(quote), now, expires, now);
      for (const night of pricing.nights(quote.selection.checkIn, quote.selection.checkOut, 366)) {
        this.db.prepare('INSERT INTO night_locks VALUES(?,?,?)').run(quote.lodge.id, night, id);
      }
      return this.get(id);
    });
  }
  attachSession(id, session, now) {
    this.db.prepare("UPDATE bookings SET stripe_session_id=?,checkout_url=?,last_error=CASE WHEN status IN ('creating','checkout') THEN NULL ELSE last_error END,status=CASE WHEN status='creating' THEN 'checkout' ELSE status END,updated_at=? WHERE id=? AND status IN ('creating','checkout','confirmed','review') AND (stripe_session_id IS NULL OR stripe_session_id=?)")
      .run(session.id, session.url || null, now, id, session.id);
    return this.get(id);
  }
  recordError(id, message, now) {
    this.db.prepare('UPDATE bookings SET last_error=?,updated_at=? WHERE id=?').run(String(message).slice(0, 300), now, id);
  }
  pending() { return this.db.prepare("SELECT * FROM bookings WHERE status IN ('creating','checkout','review') ORDER BY created_at LIMIT 100").all().map(r => this.decode(r)); }
  enqueue(id, kind) { this.db.prepare('INSERT OR IGNORE INTO outbox(id,booking_id,kind) VALUES(?,?,?)').run(randomUUID(), id, kind); }
  applySession(session, now, eventId = null) {
    return this.transaction(() => {
      if (eventId && this.db.prepare('SELECT 1 FROM stripe_events WHERE id=?').get(eventId)) return 'duplicate';
      const id = session.metadata?.booking_id;
      const booking = id ? this.get(id) : null;
      let result = 'ignored';
      if (booking && session.metadata?.source === 'summit-club') {
        if (!['cancelled', 'blocked'].includes(booking.status)) {
          const valid = session.mode === 'payment' &&
            session.client_reference_id === booking.id &&
            (!booking.stripe_session_id || booking.stripe_session_id === session.id) &&
            session.livemode === (booking.data.paymentMode === 'live') &&
            session.currency === booking.quote.currency &&
            session.amount_total === booking.quote.totalPence;
          if (!valid) {
            if (booking.status !== 'confirmed') {
              this.db.prepare("UPDATE bookings SET status='review',last_error=?,updated_at=? WHERE id=?").run('Payment details did not match the booking. Inventory retained for owner review.', now, id);
              this.enqueue(id, 'review');
            }
            result = 'review';
          } else if (session.payment_status === 'paid') {
            const locks = this.db.prepare('SELECT COUNT(*) AS n FROM night_locks WHERE booking_id=?').get(id).n;
            if (locks !== booking.quote.nights) {
              this.db.prepare("UPDATE bookings SET status='review',stripe_session_id=?,last_error=?,updated_at=? WHERE id=?").run(session.id, 'Payment received but the date reservation needs owner review.', now, id);
              this.enqueue(id, 'review'); result = 'review';
            } else {
              this.db.prepare("UPDATE bookings SET status='confirmed',stripe_session_id=?,payment_intent_id=?,last_error=NULL,updated_at=? WHERE id=?")
                .run(session.id, typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null, now, id);
              this.enqueue(id, 'guest'); this.enqueue(id, 'owner'); result = 'confirmed';
            }
          } else if (session.status === 'expired' && booking.status !== 'confirmed') {
            this.db.prepare("UPDATE bookings SET status='expired',updated_at=? WHERE id=?").run(now, id);
            this.db.prepare('DELETE FROM night_locks WHERE booking_id=?').run(id); result = 'expired';
          }
        }
      }
      if (eventId) this.db.prepare('INSERT INTO stripe_events VALUES(?,?)').run(eventId, now);
      return result;
    });
  }
  cancel(id, now, refundAcknowledged) {
    return this.transaction(() => {
      const b = this.get(id);
      if (!b) throw new BookingError('Booking not found.', 404);
      if (b.status === 'cancelled') return b;
      if (!['confirmed', 'blocked', 'expired'].includes(b.status)) throw new BookingError('Reconcile this checkout with Stripe before releasing its dates.', 409);
      if (b.status === 'confirmed' && refundAcknowledged !== true) throw new BookingError('Arrange any required refund in Stripe and acknowledge it before releasing the dates.');
      this.db.prepare("UPDATE bookings SET status='cancelled',updated_at=? WHERE id=?").run(now, id);
      this.db.prepare('DELETE FROM night_locks WHERE booking_id=?').run(id);
      this.db.prepare("UPDATE outbox SET status='superseded' WHERE booking_id=? AND kind IN ('guest','owner') AND status='pending'").run(id);
      if (b.status === 'confirmed') { this.enqueue(id, 'guest_cancelled'); this.enqueue(id, 'owner_cancelled'); }
      return this.get(id);
    });
  }
  releaseUnresolved(id, now, acknowledged) {
    return this.transaction(() => {
      const b = this.get(id);
      if (!b || !['creating', 'review'].includes(b.status) || b.stripe_session_id || b.expires_at + 300 > now) throw new BookingError('Use payment reconciliation for a known checkout, or wait until the reservation has expired.', 409);
      if (acknowledged !== true) throw new BookingError('Check Stripe for any completed payment before releasing these dates.');
      this.db.prepare("UPDATE bookings SET status='expired',last_error='Owner verified in Stripe that no payment was received, then released this unresolved reservation.',updated_at=? WHERE id=?").run(now, id);
      this.db.prepare('DELETE FROM night_locks WHERE booking_id=?').run(id);
      return this.get(id);
    });
  }
  messages(now) { return this.db.prepare("SELECT * FROM outbox WHERE status='pending' AND next_attempt<=? ORDER BY rowid LIMIT 20").all(now); }
  outbox() { return this.db.prepare('SELECT * FROM outbox ORDER BY rowid DESC LIMIT 200').all(); }
  emailHealth() { return this.db.prepare("SELECT COUNT(*) AS pending,COALESCE(SUM(CASE WHEN attempts>0 THEN 1 ELSE 0 END),0) AS failed FROM outbox WHERE status='pending'").get(); }
  sent(id, providerId) { this.db.prepare("UPDATE outbox SET status='sent',provider_id=?,last_error=NULL WHERE id=?").run(providerId, id); }
  messageFailed(id, now, attempts, deliveryCode) {
    const safe = ['authentication', 'sender_or_recipient', 'rate_limit', 'provider_unavailable'].includes(deliveryCode) ? deliveryCode : 'connection_or_provider';
    this.db.prepare('UPDATE outbox SET attempts=attempts+1,last_error=?,next_attempt=? WHERE id=?')
      .run('Delivery failed (' + safe + '); retry scheduled.', now + Math.min(3600, 30 * 2 ** Math.min(attempts, 7)), id);
  }
}
