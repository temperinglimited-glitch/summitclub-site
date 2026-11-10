(function() {
  'use strict';
  var P = window.SummitPricing, settings = window.SUMMIT_BOOKING_DEFAULTS;
  var dialog = document.getElementById('booking-dialog'), form = document.getElementById('booking-form');
  var get = function(id) { return document.getElementById(id); };
  var connected = false, mode = 'off', paymentsEnabled = false, quote = null, sequence = 0;
  var days = [], requestKey = null, lastSubmission = null, working = false;
  var currentDay = P.today(), first = settings.openingDate > currentDay ? settings.openingDate : currentDay;
  var month = first.slice(0, 7) + '-01';
  var priceFields = ['booking-lodge', 'booking-bedrooms', 'booking-sofa', 'booking-in', 'booking-out', 'booking-adults', 'booking-children', 'booking-bedroom-one', 'booking-bedroom-two', 'booking-hamper', 'booking-hamper-quantity'];
  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function message(text) { get('booking-error').textContent = text || ''; get('booking-error').hidden = !text; }
  function selection() {
    return {
      lodgeId: get('booking-lodge').value,
      checkIn: get('booking-in').value, checkOut: get('booking-out').value,
      adults: Number(get('booking-adults').value), children: Number(get('booking-children').value),
      bedrooms: Number(get('booking-bedrooms').value), sofaBed: get('booking-sofa').checked,
      bedroomOne: get('booking-bedroom-one').value, bedroomTwo: get('booking-bedroom-two').value,
      hamperId: get('booking-hamper').value,
      hamperQuantity: get('booking-hamper').value ? Number(get('booking-hamper-quantity').value) : 0
    };
  }
  async function api(path, data) {
    var response = await fetch(path, {
      method: data ? 'POST' : 'GET',
      headers: data ? { 'Content-Type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(12000)
    });
    var result; try { result = await response.json(); } catch (_) { throw new Error('Booking is temporarily unavailable. Please try again.'); }
    if (!response.ok) throw new Error(result.error || 'Please try again.');
    return result;
  }
  function option(select, value, label) { var o = node('option', label); o.value = value; select.appendChild(o); }
  function syncGuestOptions() {
    var bedrooms = Number(get('booking-bedrooms').value), adults = Number(get('booking-adults').value);
    var maxChildren = bedrooms === 1 ? Math.max(0, 2 - adults) : adults === 2 ? 3 : Math.max(0, 4 - adults);
    Array.from(get('booking-adults').options).forEach(function(o) { o.disabled = bedrooms === 1 && Number(o.value) > 2; });
    Array.from(get('booking-children').options).forEach(function(o) { o.disabled = Number(o.value) > maxChildren; });
    if (Number(get('booking-children').value) > maxChildren) get('booking-children').value = String(maxChildren);
    var children = Number(get('booking-children').value), sofaEligible = children > 0 && bedrooms === 2;
    get('booking-bedrooms').querySelector('option[value="1"]').disabled = adults + children > 2;
    get('booking-bedroom-two-field').hidden = bedrooms === 1;
    get('booking-bedroom-two').disabled = bedrooms === 1;
    get('booking-sofa-option').hidden = !sofaEligible;
    get('booking-sofa').disabled = !sofaEligible;
    if (!sofaEligible) get('booking-sofa').checked = false;
    get('booking-sofa').required = adults === 2 && children === 3;
    get('booking-sofa-help').textContent = adults === 2 && children === 3 ? 'Please reserve the sofa bed for your party of five. It is prepared for the children.' : 'Please select this in advance if your children will use the sofa bed.';
    get('booking-bedroom-help').textContent = bedrooms === 1 ? 'For up to two guests on selected low-season dates. The second bedroom remains closed.' : 'One-bedroom stays are available on selected low-season dates for up to two guests.';
    get('booking-capacity-help').textContent = bedrooms === 1 ? 'One bedroom: maximum two guests. The sofa bed is available on two-bedroom family bookings.' : adults === 4 ? 'Four adults maximum. Children cannot be added to a four-adult booking.' : 'Four guests per lodge. Two adults and three children can stay with the sofa bed reserved.';
  }
  function configure() {
    var lodge = get('booking-lodge'), previousLodge = lodge.value;
    lodge.replaceChildren(); option(lodge, 'any', 'Best available lodge');
    settings.lodges.forEach(function(l) { option(lodge, l.id, l.name); });
    lodge.value = settings.lodges.some(function(l) { return l.id === previousLodge; }) ? previousLodge : 'any';
    var hampers = get('booking-hamper'), previousHamper = hampers.value;
    hampers.replaceChildren(); option(hampers, '', 'No breakfast hamper');
    settings.hampers.forEach(function(h) { option(hampers, h.id, h.name + ' · ' + P.money(h.pricePence)); });
    hampers.value = settings.hampers.some(function(h) { return h.id === previousHamper; }) ? previousHamper : '';
    get('booking-hamper-quantity').disabled = !hampers.value;
    ['booking-in', 'booking-out'].forEach(function(id) { get(id).min = settings.openingDate > currentDay ? settings.openingDate : currentDay; get(id).max = P.addDays(currentDay, settings.horizonDays + (id === 'booking-out' ? 1 : 0)); });
    get('booking-terms-link').href = settings.termsUrl; get('booking-privacy-link').href = settings.privacyUrl;
    document.querySelectorAll('[data-policy]').forEach(function(link) { link.href = settings[link.dataset.policy === 'terms' ? 'termsUrl' : 'privacyUrl']; });
    var rateDescription = get('page-rate-description');
    if (rateDescription) rateDescription.textContent = 'Starting nightly rates for ' + settings.baseGuests + ' guests. Choose your dates, party size and extras for a full quote. Cleaning included.';
    get('page-sofa-price').textContent = P.money(settings.sofaBedPerStayPence);
    get('page-sofa-list-price').textContent = P.money(settings.sofaBedPerStayPence);
    get('booking-sofa-price').textContent = P.money(settings.sofaBedPerStayPence) + ' per booking';
    get('page-minimum-stay').textContent = settings.minNights + (settings.minNights === 1 ? ' night.' : ' nights.');
    get('booking-notice').textContent = !connected ? 'Booking preview · Example prices. Availability and payment will be checked when online booking opens.' :
      mode === 'test' ? 'Test booking · No real payment will be taken. Draft prices are for review.' :
      paymentsEnabled ? (settings.pricesApproved ? 'Book direct · Full payment secures your stay.' : 'Draft prices · Online booking is not open yet.') :
      'Booking preview · Online payment is not open yet. You can explore your stay below.';
    get('calendar-note').textContent = 'Choose arrival, then departure. Nightly prices shown are for ' + settings.baseGuests + ' guests.';
    document.querySelectorAll('[data-base-rate]').forEach(function(element) { element.textContent = P.money(settings[element.dataset.baseRate]); });
    var notice = get('page-pricing-note');
    if (notice) notice.textContent = settings.pricesApproved ? 'Choose dates and guest numbers for your full quote. Cleaning included.' : 'Draft rates for review. Guest supplements and hamper prices are illustrative and will be confirmed before bookings open.';
    syncGuestOptions(); updatePay();
  }
  var ready = (async function() {
    if (location.protocol !== 'file:') {
      try {
        var result = await api('/api/config');
        settings = result.settings; currentDay = result.today; mode = result.mode;
        connected = true; paymentsEnabled = result.paymentsEnabled;
      } catch (_) { connected = false; }
    }
    configure();
  })();
  function nextMonth(value, delta) {
    var d = new Date(P.date(value)); d.setUTCMonth(d.getUTCMonth() + delta);
    return d.toISOString().slice(0, 10);
  }
  function drawCalendar() {
    var grid = get('booking-calendar-grid'); grid.replaceChildren();
    var heading = new Date(P.date(month)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    get('calendar-heading').textContent = heading;
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function(day) { grid.appendChild(node('span', day, 'booking-dow')); });
    var offset = (new Date(P.date(month)).getUTCDay() + 6) % 7;
    for (var i = 0; i < offset; i++) grid.appendChild(node('span'));
    var a = get('booking-in').value, b = get('booking-out').value;
    days.forEach(function(day) {
      var button = node('button', null, 'booking-day'); button.type = 'button';
      var rate = day.basePence == null ? 'Closed' : P.money(day.basePence);
      button.append(node('b', String(Number(day.date.slice(8)))), node('small', rate));
      var closed = day.date < currentDay || day.date < settings.openingDate || day.date > P.addDays(currentDay, settings.horizonDays);
      var canDepart = a && !b && day.date > a && day.date <= P.addDays(currentDay, settings.horizonDays + 1);
      button.disabled = closed || (!day.available && !canDepart);
      button.classList.toggle('is-unavailable', !day.available);
      button.classList.toggle('is-end', day.date === a || day.date === b);
      button.classList.toggle('is-between', !!(a && b && day.date > a && day.date < b));
      button.setAttribute('aria-label', day.date + ' · ' + rate + (!day.available ? ' · unavailable night' : ''));
      button.addEventListener('click', function() {
        if (!a || b || day.date <= a) { get('booking-in').value = day.date; get('booking-out').value = ''; }
        else get('booking-out').value = day.date;
        changed();
      });
      grid.appendChild(button);
    });
    var earliest = (settings.openingDate > currentDay ? settings.openingDate : currentDay).slice(0, 7) + '-01';
    get('calendar-prev').disabled = month <= earliest;
    get('calendar-next').disabled = nextMonth(month, 1) > P.addDays(currentDay, settings.horizonDays).slice(0, 7) + '-01';
  }
  var calendarSequence = 0;
  async function loadCalendar() {
    var run = ++calendarSequence;
    var to = nextMonth(month, 1), dates = P.nights(month, to, 32);
    if (connected) {
      try {
        var result = await api('/api/availability?from=' + month + '&to=' + to + '&lodgeId=' + encodeURIComponent(get('booking-lodge').value) + '&bedrooms=' + get('booking-bedrooms').value);
        if (run !== calendarSequence) return;
        days = result.days;
      } catch (error) { if (run === calendarSequence) { days = []; message(error.message); } }
    } else {
      days = dates.map(function(date) { var full = get('booking-bedrooms').value === '2'; return { date: date, available: full, basePence: full ? P.nightlyRate(settings, date, settings.lodges[0].id, []) : null }; });
    }
    if (run === calendarSequence) drawCalendar();
  }
  function updatePay() {
    var button = get('booking-pay');
    button.disabled = !quote || !paymentsEnabled || working;
    button.textContent = working ? 'Opening secure payment…' : !quote ? 'Choose your dates' : !paymentsEnabled ? 'Online booking opens soon' : mode === 'test' ? 'Continue to test payment · ' + P.money(quote.totalPence) : 'Continue to payment · ' + P.money(quote.totalPence);
    get('booking-payment-note').textContent = !paymentsEnabled ? 'This is a booking preview. No payment will be taken.' : mode === 'test' ? 'Stripe test checkout. No real money will be charged.' : 'Full payment is taken securely by Stripe. Your booking is confirmed after successful payment.';
  }
  function renderQuote() {
    var area = get('booking-quote'); area.replaceChildren();
    if (!quote) { area.appendChild(node('p', 'Choose your dates to see the total for your stay.')); updatePay(); return; }
    area.appendChild(node('p', quote.lodge.name + ' · ' + quote.nights + ' nights', 'booking-quote-heading'));
    area.appendChild(node('p', quote.selection.bedrooms === 1 ? 'One bedroom · second bedroom closed' : 'Two bedrooms', 'booking-help'));
    function row(label, amount, total) {
      var line = node('div', null, 'booking-price-row' + (total ? ' booking-price-total' : ''));
      line.append(node('span', label), node('span', P.money(amount))); area.appendChild(line);
    }
    row('Accommodation', quote.accommodationPence);
    if (quote.guestSupplementPence) row('Additional guests', quote.guestSupplementPence);
    if (quote.sofaBedPence) row('Sofa bed for children · per booking', quote.sofaBedPence);
    if (quote.hamperPence) row(quote.hamperName + ' × ' + quote.selection.hamperQuantity, quote.hamperPence);
    row('Total for your stay', quote.totalPence, true);
    var details = node('details'); details.appendChild(node('summary', 'View nightly prices'));
    quote.daily.forEach(function(day) { details.appendChild(node('p', day.date + ' · ' + P.money(day.totalPence))); });
    area.appendChild(details);
    if (!settings.pricesApproved) area.appendChild(node('p', 'Illustrative pricing for review.', 'booking-help'));
    updatePay();
  }
  async function refreshQuote() {
    var run = ++sequence; quote = null; renderQuote(); message('');
    if (!get('booking-in').value || !get('booking-out').value) return;
    try {
      var input = selection(); P.selection(settings, input, currentDay);
      var result = connected ? (await api('/api/quote', input)).quote : P.quote(settings, input, { today: currentDay });
      if (run !== sequence) return;
      quote = result; renderQuote();
    } catch (error) { if (run === sequence) { quote = null; renderQuote(); message(error.message); } }
  }
  function changed() {
    requestKey = null; lastSubmission = null;
    syncGuestOptions();
    get('booking-hamper-quantity').disabled = !get('booking-hamper').value;
    if (get('booking-in').value) get('booking-out').min = P.addDays(get('booking-in').value, settings.minNights);
    drawCalendar(); refreshQuote();
  }
  priceFields.forEach(function(id) { get(id).addEventListener('change', function() {
    if (id === 'booking-in' && get(id).value) month = get(id).value.slice(0, 7) + '-01';
    changed(); if (id === 'booking-lodge' || id === 'booking-in' || id === 'booking-bedrooms') loadCalendar();
  }); });
  ['booking-name', 'booking-email', 'booking-phone', 'booking-terms'].forEach(function(id) { get(id).addEventListener('input', function() { requestKey = null; lastSubmission = null; }); });
  get('calendar-prev').addEventListener('click', function() { month = nextMonth(month, -1); loadCalendar(); });
  get('calendar-next').addEventListener('click', function() { month = nextMonth(month, 1); loadCalendar(); });
  document.querySelectorAll('[data-open-dates]').forEach(function(button) {
    button.addEventListener('click', async function() {
      if (!dialog.open) dialog.showModal();
      await ready; await loadCalendar(); get('booking-lodge').focus();
    });
  });
  get('booking-close').addEventListener('click', function() { dialog.close(); });
  dialog.addEventListener('click', function(event) { if (event.target === dialog) { var rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
  form.addEventListener('submit', async function(event) {
    event.preventDefault(); if (!quote || !connected || !paymentsEnabled || working || !form.reportValidity()) return;
    working = true; message(''); updatePay();
    try {
      if (!requestKey) requestKey = crypto.randomUUID();
      if (!lastSubmission) lastSubmission = Object.assign({}, selection(), {
        contact: { name: get('booking-name').value, email: get('booking-email').value, phone: get('booking-phone').value },
        requestKey: requestKey, termsAccepted: get('booking-terms').checked,
        expectedTotalPence: quote.totalPence, quoteHash: quote.hash
      });
      var response = await api('/api/checkout', lastSubmission);
      var destination = new URL(response.url);
      if (destination.origin !== location.origin && destination.hostname !== 'checkout.stripe.com') throw new Error('The payment page could not open.');
      location.assign(destination.href);
    } catch (error) { message(error.message); working = false; updatePay(); }
  });
})();
