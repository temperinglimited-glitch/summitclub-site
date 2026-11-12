(function() {
  'use strict';
  var get = function(id) { return document.getElementById(id); }, password = '', settings, version;
  var P = window.SummitPricing, D = window.SummitDetails, calendarSequence = 0, accessLogin = false;
  get('owner-calendar-month').value = P.today().slice(0, 7);
  var labels = [
    ['winterPence', 'Winter rate £', true], ['standardPence', 'Standard rate £', true], ['peakPence', 'Peak rate £', true],
    ['weekendSupplementPence', 'Friday / Saturday supplement £', true], ['extraGuestPerNightPence', 'Extra guest per night £', true],
    ['sofaBedPerStayPence', 'Children’s sofa bed per booking £', true], ['baseGuests', 'Guests included in base price', false],
    ['minNights', 'Minimum nights', false], ['maxNights', 'Maximum nights', false], ['horizonDays', 'Days ahead guests can book', false]
  ];
  function node(tag, text) { var e = document.createElement(tag); if (text != null) e.textContent = text; return e; }
  function status(text) { get('owner-status').textContent = text; }
  function pounds(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a price with at most two decimal places.');
    var parts = value.split('.'); return Number(parts[0]) * 100 + Number((parts[1] || '').padEnd(2, '0'));
  }
  async function api(path, method, body) {
    var response = await fetch('/api/admin/' + path, {
      method: method || 'GET',
      headers: { Authorization: 'Bearer ' + password, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000)
    });
    var data; try { data = await response.json(); } catch (_) { throw new Error('Start the booking server to use the owner screen.'); }
    if (!response.ok) throw new Error(data.error || 'Please try again.'); return data;
  }
  function inputField(key, label, value, money) {
    var l = node('label', label), input = document.createElement('input');
    input.type = 'number'; input.required = true; input.id = 'rate-' + key; input.step = money ? '.01' : '1'; input.min = '0'; input.value = String(money ? value / 100 : value);
    l.appendChild(input); get('owner-rate-fields').appendChild(l);
  }
  function renderSettings() {
    get('owner-rate-fields').replaceChildren();
    labels.forEach(function(item) { inputField(item[0], item[1], settings[item[0]], item[2]); });
    settings.hampers.forEach(function(h) { inputField('hamper-' + h.id, h.name + ' £', h.pricePence, true); });
    get('owner-opening').value = settings.openingDate; get('owner-approved').checked = settings.pricesApproved;
    get('owner-lodge-one').value = settings.lodges[0].name; get('owner-lodge-two').value = settings.lodges[1].name;
    get('owner-peak').value = settings.peakRanges.map(function(r) { return r.from + ' to ' + r.to; }).join('\n');
    get('owner-terms-url').value = settings.termsUrl; get('owner-privacy-url').value = settings.privacyUrl;
    get('owner-terms-version').value = settings.termsVersion;
    ['block-lodge', 'override-lodge', 'owner-calendar-lodge'].forEach(function(id) {
      var select = get(id), previous = select.value; select.replaceChildren();
      if (id === 'override-lodge') { var both = node('option', 'Both lodges'); both.value = 'both'; select.appendChild(both); }
      settings.lodges.forEach(function(lodge) { var o = node('option', lodge.name); o.value = lodge.id; select.appendChild(o); });
      if (previous && (previous === 'both' || settings.lodges.some(function(l) { return l.id === previous; }))) select.value = previous;
    });
  }
  function money(value) { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100); }
  function renderBookings(bookings, outbox, overrides, oneBedroomRates) {
    var area = get('owner-bookings'); area.replaceChildren();
    bookings.forEach(function(b) {
      var tr = document.createElement('tr'), lodge = settings.lodges.find(function(l) { return l.id === b.lodge_id; });
      tr.appendChild(node('td', b.status + (b.data.paymentMode ? ' · ' + b.data.paymentMode : '')));
      var stay = node('td', lodge ? lodge.name : b.lodge_id); stay.appendChild(node('small', b.check_in + ' → ' + b.check_out)); stay.appendChild(node('small', b.id)); tr.appendChild(stay);
      var guest = node('td', b.data.contact ? b.data.contact.name : 'Owner block');
      if (b.data.contact) { guest.appendChild(node('small', b.data.contact.email)); guest.appendChild(node('small', b.data.contact.phone)); }
      if (b.data.contact && b.data.contact.address) guest.appendChild(node('small', D.addressText(b.data.contact.address)));
      tr.appendChild(guest);
      var detail = node('td', b.data.note || '');
      if (b.quote) {
        detail.appendChild(node('span', b.quote.selection.adults + ' adults, ' + b.quote.selection.children + ' children'));
        detail.appendChild(node('small', b.quote.selection.bedrooms === 1 ? 'ONE BEDROOM · second bedroom closed · ' + b.quote.selection.bedroomOne : 'Two bedrooms · ' + b.quote.selection.bedroomOne + ' / ' + b.quote.selection.bedroomTwo));
        detail.appendChild(node('small', b.quote.selection.sofaBed === true || b.quote.sofaBedPence > 0 ? 'SOFA BED: prepare for children' : 'Sofa bed: not reserved'));
        if (b.quote.hamperName) detail.appendChild(node('small', b.quote.hamperName + ' × ' + b.quote.selection.hamperQuantity));
        if (b.data.details) {
          if (b.data.details.childAges.length) detail.appendChild(node('small', 'Child ages on arrival: ' + b.data.details.childAges.join(', ')));
          if (b.data.details.hamperFulfilment) detail.appendChild(node('small', 'Hamper: stock before arrival; chilled items in fridge.'));
          if (b.data.hamperInformation && b.data.hamperInformation.items) detail.appendChild(node('small', b.data.hamperInformation.items.map(function(i) { return i.quantity + ' ' + i.name; }).join('; ')));
          if (b.data.details.requests) detail.appendChild(node('small', 'Request · not yet agreed: ' + b.data.details.requests));
        }
        if (b.status === 'confirmed') {
          var register = node('details'), registered = b.data.registration;
          register.appendChild(node('summary', registered ? 'Guest register · saved' : 'Guest register · awaiting details'));
          if (registered) registered.guests.forEach(function(g) {
            register.appendChild(node('p', g.name + ' · ' + g.nationality + ' · ' + D.addressText(g.address)));
            if (g.travelDetailsRequired) register.appendChild(node('p', 'Document: ' + g.documentNumber + ' · issued: ' + g.documentIssuePlace + ' · next destination: ' + g.nextDestination));
          });
          else register.appendChild(node('p', 'Check the required details before or on arrival. Older bookings may need a manual register.'));
          detail.appendChild(register);
        }
      }
      if (b.last_error) detail.appendChild(node('small', b.last_error));
      tr.appendChild(detail); tr.appendChild(node('td', b.quote ? money(b.quote.totalPence) : '—'));
      var action = document.createElement('td');
      if (['confirmed', 'blocked', 'expired'].includes(b.status)) {
        var button = node('button', b.status === 'blocked' ? 'Release block' : 'Cancel');
        button.type = 'button'; button.addEventListener('click', async function() {
          var prompt = b.status === 'confirmed' ? 'Arrange any required refund in Stripe first. Confirm that any refund has been handled and release these dates?' : 'Release these dates?';
          if (!window.confirm(prompt)) return;
          try { await api('bookings/' + b.id + '/cancel', 'POST', { refundAcknowledged: b.status === 'confirmed' }); await refresh(); status('Dates released.'); }
          catch (error) { status(error.message); }
        }); action.appendChild(button);
      }
      if (['creating', 'checkout', 'review'].includes(b.status)) {
        var recover = node('button', b.stripe_session_id ? 'Check / close checkout' : 'Link Stripe checkout');
        recover.type = 'button'; recover.addEventListener('click', async function() {
          var sessionId = b.stripe_session_id || window.prompt('In Stripe, find this booking reference in Checkout metadata. Paste its Checkout Session ID (cs_…).');
          if (!sessionId) return;
          var expire = window.confirm('Close this checkout if payment is still pending? OK closes it and checks payment; Cancel only checks payment. A completed payment will be kept.');
          try { await api('bookings/' + b.id + '/recover', 'POST', { sessionId: sessionId.trim(), expire: expire }); await refresh(); status('Stripe checkout checked.'); }
          catch (error) { status(error.message); }
        }); action.appendChild(recover);
        if (!b.stripe_session_id && b.expires_at + 300 < Date.now() / 1000) {
          var release = node('button', 'Release unresolved hold'); release.type = 'button';
          release.addEventListener('click', async function() {
            if (!window.confirm('Check this reference and guest email in Stripe first. Confirm that no payment was received and any checkout has expired before releasing the dates.')) return;
            try { await api('bookings/' + b.id + '/release-unresolved', 'POST', { noPaymentAcknowledged: true }); await refresh(); status('Unresolved hold released after your Stripe check.'); }
            catch (error) { status(error.message); }
          }); action.appendChild(release);
        }
      }
      tr.appendChild(action); area.appendChild(tr);
    });
    if (!bookings.length) { var tr = node('tr'), td = node('td', 'No bookings or blocks yet.'); td.colSpan = 6; tr.appendChild(td); area.appendChild(tr); }
    get('owner-outbox').replaceChildren();
    outbox.forEach(function(m) { get('owner-outbox').appendChild(node('p', m.kind + ' · ' + m.status + ' · ' + m.booking_id + ' · attempts: ' + m.attempts + (m.last_error ? ' · ' + m.last_error : ''))); });
    if (!outbox.length) get('owner-outbox').textContent = 'No confirmation emails queued.';
    get('override-count').textContent = overrides.length + ' two-bedroom nightly overrides · ' + (oneBedroomRates || []).length + ' one-bedroom lodge-nights open.';
  }
  async function loadPriceCalendar() {
    var run = ++calendarSequence, month = get('owner-calendar-month').value;
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    var from = month + '-01', d = new Date(P.date(from)); d.setUTCMonth(d.getUTCMonth() + 1);
    var to = d.toISOString().slice(0, 10);
    get('owner-calendar-note').textContent = 'Loading daily prices…';
    try {
      var result = await api('calendar?from=' + from + '&to=' + to);
      if (run !== calendarSequence || !password) return;
      var grid = get('owner-price-calendar'); grid.replaceChildren();
      ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(day) { grid.appendChild(node('span', day)); });
      var offset = (new Date(P.date(from)).getUTCDay() + 6) % 7;
      for (var i = 0; i < offset; i++) grid.appendChild(node('span'));
      var lodgeId = get('owner-calendar-lodge').value;
      result.days.forEach(function(day) {
        var rate = day.lodges.find(function(l) { return l.lodgeId === lodgeId; });
        var button = node('button'); button.type = 'button'; button.className = 'owner-rate-day';
        button.appendChild(node('b', String(Number(day.date.slice(8)))));
        button.appendChild(node('small', '2 beds ' + money(rate.twoBedroomPence)));
        button.appendChild(node('small', rate.oneBedroomPence == null ? '1 bed closed' : '1 bed ' + money(rate.oneBedroomPence)));
        if (rate.reserved) { button.appendChild(node('small', 'Booked / held')); button.classList.add('is-reserved'); }
        button.setAttribute('aria-label', day.date + ': two bedrooms ' + money(rate.twoBedroomPence) + ', one bedroom ' + (rate.oneBedroomPence == null ? 'closed' : money(rate.oneBedroomPence)));
        button.addEventListener('click', function() {
          get('override-lodge').value = lodgeId;
          get('override-from').value = day.date; get('override-to').value = P.addDays(day.date, 1);
          var amount = get('override-bedrooms').value === '1' ? rate.oneBedroomPence : rate.twoBedroomPence;
          get('override-price').value = amount == null ? '' : (amount / 100).toFixed(2);
          get('override-price').focus(); status('Editing ' + day.date + '. Save daily prices to apply your change.');
        });
        grid.appendChild(button);
      });
      get('owner-calendar-note').textContent = 'Prices shown are nightly base rates. Booked dates keep their agreed booking total.';
    } catch (error) { if (run === calendarSequence) get('owner-calendar-note').textContent = error.message; }
  }
  async function refresh() {
    var results = await Promise.all([api('settings'), api('bookings')]);
    settings = results[0].settings; version = results[0].version;
    renderSettings(); renderBookings(results[1].bookings, results[1].outbox, results[1].overrides, results[1].oneBedroomRates);
    var health = results[1].emailHealth || {}, banner = get('owner-email-alert'); banner.hidden = !health.failed;
    banner.textContent = health.failed + ' email(s) have failed delivery attempts. Check Resend logs and the errors below, then use “Check payments & retry emails”. ' + health.pending + ' email(s) currently pending.';
    var readiness = results[1].readiness; get('owner-readiness').textContent = readiness && !readiness.ready ? readiness.issues.join(' ') : 'Business details reviewed. Complete the launch checks before enabling live payments.';
    get('owner-content').hidden = false; get('owner-login').hidden = true;
    await loadPriceCalendar();
  }
  get('owner-login').addEventListener('submit', async function(e) {
    e.preventDefault(); password = get('owner-password').value;
    try { await refresh(); get('owner-password').value = ''; status('Signed in.'); } catch (error) { password = ''; status(error.message); }
  });
  get('owner-signout').addEventListener('click', function() {
    password = ''; settings = null; calendarSequence++; get('owner-content').hidden = true; get('owner-login').hidden = false; get('owner-bookings').replaceChildren(); get('owner-price-calendar').replaceChildren(); status('Signed out.');
    if (accessLogin) location.assign('/cdn-cgi/access/logout');
  });
  ['owner-calendar-month', 'owner-calendar-lodge'].forEach(function(id) { get(id).addEventListener('change', loadPriceCalendar); });
  get('owner-refresh').addEventListener('click', function() { refresh().then(function() { status('Refreshed.'); }).catch(function(e) { status(e.message); }); });
  get('owner-recovery').addEventListener('click', async function() {
    try { var record = await api('recovery'); get('owner-recovery-result').textContent = record.available ? record.recordedAt + ' · ' + record.bookmark + ' · recovery window: ' + record.retentionDays + ' days. Copy this record to your secure operations notes.' : record.message; }
    catch (error) { get('owner-recovery-result').textContent = error.message; }
  });
  get('owner-reconcile').addEventListener('click', async function() { status('Checking…'); try { await api('reconcile', 'POST', {}); await refresh(); status('Payment states checked and pending email deliveries retried.'); } catch(e) { status(e.message); } });
  get('owner-prices').addEventListener('submit', async function(e) {
    e.preventDefault();
    try {
      var updated = JSON.parse(JSON.stringify(settings));
      labels.forEach(function(item) { updated[item[0]] = item[2] ? pounds(get('rate-' + item[0]).value) : Number(get('rate-' + item[0]).value); });
      updated.hampers.forEach(function(h) { h.pricePence = pounds(get('rate-hamper-' + h.id).value); });
      updated.openingDate = get('owner-opening').value; updated.pricesApproved = get('owner-approved').checked;
      updated.lodges[0].name = get('owner-lodge-one').value; updated.lodges[1].name = get('owner-lodge-two').value;
      updated.termsUrl = get('owner-terms-url').value; updated.privacyUrl = get('owner-privacy-url').value; updated.termsVersion = get('owner-terms-version').value;
      updated.peakRanges = get('owner-peak').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean).map(function(s) {
        var match = s.match(/^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
        if (!match) throw new Error('Use YYYY-MM-DD to YYYY-MM-DD for each peak range.');
        return { from: match[1], to: match[2] };
      });
      await api('settings', 'PUT', { settings: updated, version: version }); await refresh(); status('Settings saved.');
    } catch (error) { status(error.message); }
  });
  get('owner-block').addEventListener('submit', async function(e) {
    e.preventDefault();
    try { await api('blocks', 'POST', { lodgeId: get('block-lodge').value, checkIn: get('block-from').value, checkOut: get('block-to').value, note: get('block-note').value }); await refresh(); status('Dates blocked.'); }
    catch (error) { status(error.message); }
  });
  get('owner-override').addEventListener('submit', async function(e) {
    e.preventDefault();
    try { await api('rates', 'PUT', { lodgeId: get('override-lodge').value, bedrooms: Number(get('override-bedrooms').value), from: get('override-from').value, to: get('override-to').value, pricePence: get('override-price').value === '' ? null : pounds(get('override-price').value) }); await refresh(); status('Daily prices and one-bedroom availability saved. Existing booking totals are unchanged.'); }
    catch (error) { status(error.message); }
  });
  // The Cloudflare gateway authenticates the owner and supplies the backend secret.
  // The existing password screen remains available for the standalone Node version.
  if (location.protocol === 'https:') {
    fetch('/api/access', { signal: AbortSignal.timeout(8000) }).then(async function(response) {
      if (!response.ok) return;
      var identity = await response.json();
      if (identity.owner === true) { accessLogin = true; password = 'cloudflare-access-session'; await refresh(); status('Signed in as ' + identity.email + '.'); }
    }).catch(function() {});
  }
})();
