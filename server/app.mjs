import { Buffer } from 'node:buffer';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import pricing from '../public/assets/pricing.js';
import { BookingError } from './repository-core.mjs';
import { verifyStripeSignature } from './providers.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
export function quoteHash(quote) { return digest(JSON.stringify(quote)); }

export function createApp({ repo, stripe, mailer, runtime, clock = () => Date.now() }) {
  const now = () => Math.floor(clock() / 1000);
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(clock()));
  const rates = new Map();
  let maintenancePromise = null;
  function token(id) { return createHmac('sha256', runtime.receiptSecret).update('summit-receipt:' + id).digest('base64url'); }
  function statusUrl(id) { return runtime.baseUrl + '/booking-status.html?id=' + id + '#token=' + token(id); }
  function limit(ip, group, max) {
    const key = String(ip || 'unknown') + ':' + group;
    const point = rates.get(key);
    if (!point || point.reset < now()) rates.set(key, { count: 1, reset: now() + 300 });
    else if (++point.count > max) throw new BookingError('Please wait a few minutes before trying again.', 429);
    if (rates.size > 10000) for (const [key, value] of rates) if (value.reset < now()) rates.delete(key);
  }
  async function body(request) {
    const raw = Buffer.from(await request.arrayBuffer());
    if (raw.length > 16384) throw new BookingError('Request too large.', 413);
    if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new BookingError('Use a JSON request.', 415);
    let value;
    try { value = JSON.parse(raw.toString('utf8')); } catch { throw new BookingError('Invalid request.', 400); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BookingError('Use a JSON object.', 400);
    return value;
  }
  function authenticate(request, expected) {
    if (!expected) throw new BookingError('The owner access password has not been configured.', 503);
    if (!equal(request.headers.get('authorization') || '', 'Bearer ' + expected)) throw new BookingError('Please sign in with the owner password.', 401);
  }
  function origin(request) {
    if (request.headers.get('origin') !== new URL(runtime.baseUrl).origin) throw new BookingError('This request must come from the booking website.', 403);
  }
  function findQuote(input) {
    const settings = repo.settings(), normalized = pricing.selection(settings, input, today());
    const oneBedroomRates = repo.oneBedroomRates(normalized.checkIn, normalized.checkOut);
    const nights = pricing.nights(normalized.checkIn, normalized.checkOut);
    const candidates = settings.lodges.filter(l => normalized.lodgeId === 'any' || l.id === normalized.lodgeId)
      .filter(l => repo.available(l.id, normalized.checkIn, normalized.checkOut))
      .filter(l => normalized.bedrooms === 2 || nights.every(night => oneBedroomRates.some(r => r.lodgeId === l.id && r.night === night)))
      .map(l => pricing.quote(settings, { ...normalized, lodgeId: l.id }, { today: today(), overrides: repo.overrides(normalized.checkIn, normalized.checkOut), oneBedroomRates }))
      .sort((a, b) => a.totalPence - b.totalPence || a.lodge.id.localeCompare(b.lodge.id));
    if (!candidates.length) throw new BookingError(normalized.bedrooms === 1 ? 'The one-bedroom option is not available for every night of this stay. Choose two bedrooms or different dates.' : 'No lodge is available for the whole of that stay. Try the other lodge or different dates.', 409);
    return { ...candidates[0], hash: quoteHash(candidates[0]) };
  }
  async function reconcileOne(booking) {
    if (!booking.stripe_session_id || ['confirmed', 'expired', 'cancelled', 'blocked'].includes(booking.status)) return;
    let session = await stripe.retrieve(booking.stripe_session_id);
    if (session.status === 'open' && booking.expires_at <= now()) {
      try { await stripe.expire(session.id); } catch { /* A concurrent payment can complete; retrieve its definitive state. */ }
      session = await stripe.retrieve(session.id);
    }
    repo.applySession(session, now());
  }
  async function maintenance() {
    if (maintenancePromise) return maintenancePromise;
    maintenancePromise = (async () => {
      if (runtime.paymentsEnabled) for (const booking of repo.pending()) {
        try {
          if (booking.status === 'creating' && !booking.stripe_session_id && booking.expires_at > now() + 1810) {
            const session = await stripe.create(booking, runtime.baseUrl, token(booking.id));
            repo.attachSession(booking.id, session, now());
            repo.applySession(session, now());
          } else if (booking.status === 'creating' && !booking.stripe_session_id) {
            repo.recordError(booking.id, 'Checkout creation needs owner review; dates remain protected.', now());
          } else await reconcileOne(booking);
        } catch { repo.recordError(booking.id, 'Could not check payment status; dates remain reserved and will be retried.', now()); }
      }
      if (runtime.emailEnabled && mailer) for (const message of repo.messages(now())) {
        const booking = repo.get(message.booking_id);
        try { repo.sent(message.id, await mailer.send(message, booking)); }
        catch { repo.messageFailed(message.id, now(), message.attempts); }
      }
    })().finally(() => { maintenancePromise = null; });
    return maintenancePromise;
  }
  async function checkout(input) {
    if (!runtime.paymentsEnabled) throw new BookingError('Online booking is not open yet. You can explore dates and prices.', 503);
    const settings = repo.settings();
    if (runtime.mode === 'live' && !settings.pricesApproved) throw new BookingError('Online booking is temporarily unavailable.', 503);
    const selection = pricing.selection(settings, input, today());
    const contact = {
      name: pricing.text(input.contact?.name, 1, 100, 'guest name'),
      email: pricing.text(input.contact?.email, 3, 254, 'email address').toLowerCase(),
      phone: typeof input.contact?.phone === 'string' ? input.contact.phone.trim().slice(0, 40) : ''
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw new BookingError('Enter a valid email address.');
    if (input.termsAccepted !== true) throw new BookingError('Please accept the booking terms and privacy notice.');
    if (!uuid(input.requestKey)) throw new BookingError('Please refresh the booking form and try again.');
    const requestHash = digest(JSON.stringify({ selection, contact, expectedTotalPence: input.expectedTotalPence, quoteHash: input.quoteHash }));
    let booking = repo.byRequest(input.requestKey);
    if (booking) {
      if (booking.request_hash !== requestHash) throw new BookingError('Your selection has changed. Please start a new checkout.', 409);
      if (booking.status === 'confirmed') return { url: statusUrl(booking.id) };
      if (booking.status === 'checkout') {
        await reconcileOne(booking); booking = repo.get(booking.id);
        if (booking.status === 'confirmed') return { url: statusUrl(booking.id) };
        if (booking.status === 'checkout' && booking.expires_at > now()) return { url: booking.checkout_url };
      }
      if (booking.status !== 'creating' || booking.expires_at <= now() + 1810) throw new BookingError('That checkout needs an owner check. Please contact us before starting another payment.', 409);
    } else {
      const quote = findQuote(selection);
      if (input.expectedTotalPence !== quote.totalPence || input.quoteHash !== quote.hash) throw new BookingError('The price or availability has changed. Refresh your quote before paying.', 409);
      const { hash, ...storedQuote } = quote;
      booking = repo.reserve({
        requestKey: input.requestKey, requestHash, quote: storedQuote,
        data: { contact, selection, paymentMode: runtime.mode, termsVersion: settings.termsVersion, termsAcceptedAt: now() },
        now: now()
      });
    }
    try {
      const session = await stripe.create(booking, runtime.baseUrl, token(booking.id));
      if (session.metadata?.booking_id !== booking.id || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) throw new Error('Invalid checkout response');
      repo.attachSession(booking.id, session, now());
      repo.applySession(session, now());
      return { url: repo.get(booking.id).status === 'confirmed' ? statusUrl(booking.id) : session.url };
    } catch {
      repo.recordError(booking.id, 'Checkout creation was interrupted. Retrying the same request is safe; dates remain protected.', now());
      throw new BookingError('Payment checkout could not open. Please retry this same booking; your dates are temporarily reserved.', 502);
    }
  }
  async function handle(request, context = {}) {
    try {
      const url = new URL(request.url), path = url.pathname, method = request.method;
      if (path === '/api/stripe/webhook' && method === 'POST') {
        if (!runtime.paymentsEnabled) throw new BookingError('Payments are disabled.', 503);
        const raw = Buffer.from(await request.arrayBuffer());
        if (raw.length > 1024 * 1024) throw new BookingError('Webhook too large.', 413);
        verifyStripeSignature(raw, request.headers.get('stripe-signature'), runtime.webhookSecret, now());
        let event; try { event = JSON.parse(raw); } catch { throw new BookingError('Invalid webhook payload.'); }
        if (typeof event.id !== 'string' || event.livemode !== (runtime.mode === 'live')) throw new BookingError('Unexpected payment event.');
        const supported = ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'];
        if (!supported.includes(event.type)) return json({ received: true });
        const id = event.data?.object?.id;
        if (typeof id !== 'string' || !id.startsWith('cs_')) throw new BookingError('Invalid checkout event.');
        const session = await stripe.retrieve(id);
        repo.applySession(session, now(), event.id);
        return json({ received: true });
      }
      limit(context.ip, 'read', 300);
      if (method !== 'GET' && method !== 'HEAD') origin(request);
      if (path.startsWith('/api/admin/')) {
        authenticate(request, runtime.adminToken);
        if (path === '/api/admin/settings' && method === 'GET') {
          const settings = repo.settings(); return json({ settings, version: digest(JSON.stringify(settings)) });
        }
        if (path === '/api/admin/settings' && method === 'PUT') {
          const value = await body(request);
          if (value.version !== digest(JSON.stringify(repo.settings()))) throw new BookingError('Settings changed in another window. Refresh before saving.', 409);
          return json({ settings: repo.saveSettings(value.settings) });
        }
        if (path === '/api/admin/bookings' && method === 'GET') return json({ bookings: repo.list(), outbox: repo.outbox(), overrides: repo.overrides(today(), pricing.addDays(today(), 1096)), oneBedroomRates: repo.oneBedroomRates(today(), pricing.addDays(today(), 1096)) });
        if (path === '/api/admin/calendar' && method === 'GET') {
          const from = url.searchParams.get('from'), to = url.searchParams.get('to'), settings = repo.settings();
          const days = pricing.nights(from, to, 62), overrides = repo.overrides(from, to), one = repo.oneBedroomRates(from, to), locks = repo.locked(from, to);
          return json({ days: days.map(night => ({ date: night, lodges: settings.lodges.map(l => ({
            lodgeId: l.id,
            twoBedroomPence: pricing.nightlyRate(settings, night, l.id, overrides),
            oneBedroomPence: one.find(r => r.lodgeId === l.id && r.night === night)?.pricePence ?? null,
            reserved: locks.some(lock => lock.lodgeId === l.id && lock.night === night)
          })) })) });
        }
        if (path === '/api/admin/blocks' && method === 'POST') {
          const value = await body(request), settings = repo.settings();
          const lodge = settings.lodges.find(l => l.id === value.lodgeId);
          if (!lodge) throw new BookingError('Choose a lodge.');
          pricing.nights(value.checkIn, value.checkOut, 366);
          const booking = repo.reserve({ quote: { lodge, selection: { checkIn: value.checkIn, checkOut: value.checkOut } }, data: { note: pricing.text(value.note || 'Owner block', 1, 200, 'block note') }, now: now(), blocked: true });
          return json({ booking }, 201);
        }
        if (path === '/api/admin/rates' && method === 'PUT') {
          const value = await body(request);
          repo.setOverride(value.lodgeId, value.from, value.to, value.pricePence, value.bedrooms == null ? 2 : value.bedrooms);
          return json({ saved: true });
        }
        if (/^\/api\/admin\/bookings\/[0-9a-f-]+\/cancel$/.test(path) && method === 'POST') {
          const value = await body(request);
          return json({ booking: repo.cancel(path.split('/')[4], now(), value.refundAcknowledged) });
        }
        if (/^\/api\/admin\/bookings\/[0-9a-f-]+\/recover$/.test(path) && method === 'POST') {
          if (!runtime.paymentsEnabled) throw new BookingError('Configure Stripe test or live mode first.', 503);
          const value = await body(request), id = path.split('/')[4], booking = repo.get(id);
          if (!booking || !booking.quote) throw new BookingError('Booking not found.', 404);
          if (typeof value.sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(value.sessionId)) throw new BookingError('Enter the Checkout Session ID from Stripe.');
          let session = await stripe.retrieve(value.sessionId);
          if (session.metadata?.booking_id !== id || session.metadata?.source !== 'summit-club' || (booking.stripe_session_id && booking.stripe_session_id !== session.id)) throw new BookingError('That Stripe checkout belongs to a different booking.', 409);
          if (session.status === 'open' && value.expire === true) { await stripe.expire(session.id); session = await stripe.retrieve(session.id); }
          repo.attachSession(id, session, now()); repo.applySession(session, now());
          return json({ booking: repo.get(id) });
        }
        if (/^\/api\/admin\/bookings\/[0-9a-f-]+\/release-unresolved$/.test(path) && method === 'POST') {
          const value = await body(request);
          return json({ booking: repo.releaseUnresolved(path.split('/')[4], now(), value.noPaymentAcknowledged) });
        }
        if (path === '/api/admin/reconcile' && method === 'POST') { await maintenance(); return json({ checked: true }); }
        throw new BookingError('Not found.', 404);
      }
      if (path === '/api/config' && method === 'GET') return json({ settings: repo.settings(), today: today(), mode: runtime.mode, paymentsEnabled: runtime.paymentsEnabled });
      if (path === '/api/availability' && method === 'GET') {
        const settings = repo.settings(), from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const days = pricing.nights(from, to, 62), locks = repo.locked(from, to), overrides = repo.overrides(from, to);
        const bedrooms = pricing.integer(Number(url.searchParams.get('bedrooms') || '2'), 1, 2, 'bedrooms');
        const one = repo.oneBedroomRates(from, to);
        const lodgeId = url.searchParams.get('lodgeId') || 'any';
        const lodges = settings.lodges.filter(l => lodgeId === 'any' || lodgeId === l.id);
        if (!lodges.length) throw new BookingError('Choose a lodge.');
        return json({ days: days.map(night => {
          const eligible = lodges.filter(l => bedrooms === 2 || one.some(r => r.lodgeId === l.id && r.night === night));
          const available = eligible.filter(l => !locks.some(lock => lock.lodgeId === l.id && lock.night === night));
          const closed = night < today() || night < settings.openingDate || night > pricing.addDays(today(), settings.horizonDays);
          const priced = available.length ? available : eligible;
          return { date: night, available: !closed && available.length > 0, availableLodges: closed ? [] : available.map(l => l.id), basePence: priced.length ? Math.min(...priced.map(l => pricing.nightlyRate(settings, night, l.id, overrides, bedrooms, one))) : null };
        }) });
      }
      if (path === '/api/quote' && method === 'POST') return json({ quote: findQuote(await body(request)) });
      if (path === '/api/checkout' && method === 'POST') { limit(context.ip, 'checkout', 12); return json(await checkout(await body(request))); }
      if (path === '/api/booking-status' && method === 'GET') {
        const id = url.searchParams.get('id');
        if (!uuid(id)) throw new BookingError('Booking not found.', 404);
        authenticate(request, token(id));
        let booking = repo.get(id);
        if (!booking || !booking.quote) throw new BookingError('Booking not found.', 404);
        if (runtime.paymentsEnabled) { try { await reconcileOne(booking); booking = repo.get(id); } catch { /* The webhook/background reconciliation remains authoritative. */ } }
        return json({
          id: booking.id, status: booking.status, quote: booking.quote,
          guestName: booking.data.contact.name, expiresAt: booking.expires_at,
          checkoutUrl: booking.status === 'checkout' && booking.expires_at > now() ? booking.checkout_url : null,
          mode: runtime.mode
        });
      }
      throw new BookingError('Not found.', 404);
    } catch (error) {
      const status = error.status || (String(error.code || '').includes('SQLITE_BUSY') ? 503 : 500);
      return json({ error: status === 500 ? 'This step could not be completed. Please try again.' : error.message }, status);
    }
  }
  return { handle, maintenance, token, findQuote };
}
