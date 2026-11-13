(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SummitPricing = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  var DAY = 86400000;
  var hamperNotice = 'Breakfast hampers require at least 48 hours’ notice before your 3pm check-in.';
  function fail(message) {
    var error = new Error(message); error.status = 400; throw error;
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Choose valid arrival and departure dates.');
    var time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail('That calendar date does not exist.');
    return time;
  }
  function addDays(value, count) { return new Date(date(value) + count * DAY).toISOString().slice(0, 10); }
  function hamperDeadline(checkIn) {
    // Convert 3pm Europe/London to an instant before subtracting 48 elapsed hours.
    // The afternoon check-in time is unambiguous on both UK clock-change days.
    var guess = date(checkIn) + 15 * 3600000;
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    var localHour = Number(parts.find(function(p) { return p.type === 'hour'; }).value);
    var localMinute = Number(parts.find(function(p) { return p.type === 'minute'; }).value);
    return guess - (localHour * 60 + localMinute - 15 * 60) * 60000 - 2 * DAY;
  }
  function hamperAvailable(checkIn, now) { return (now == null ? Date.now() : now) <= hamperDeadline(checkIn); }
  function nights(from, to, limit) {
    var count = (date(to) - date(from)) / DAY;
    if (!Number.isInteger(count) || count < 1 || count > (limit || 366)) fail('Choose a valid date range.');
    return Array.from({ length: count }, function(_, i) { return addDays(from, i); });
  }
  function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function integer(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail('Check ' + name + '.');
    return value;
  }
  function text(value, min, max, name) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail('Check ' + name + '.');
    return value.trim();
  }
  function validateSettings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Check the pricing settings.');
    var s = {
      brand: text(input.brand, 1, 60, 'business name'), currency: 'gbp',
      pricesApproved: input.pricesApproved === true,
      bookingRulesVersion: 2,
      hamperVersion: 2,
      openingDate: input.openingDate,
      horizonDays: integer(input.horizonDays, 30, 1095, 'booking horizon'),
      minNights: integer(input.minNights, 1, 28, 'minimum stay'),
      maxNights: integer(input.maxNights, 1, 90, 'maximum stay'),
      baseGuests: integer(input.baseGuests, 1, 4, 'included guests'),
      winterPence: integer(input.winterPence, 100, 500000, 'winter price'),
      standardPence: integer(input.standardPence, 100, 500000, 'standard price'),
      peakPence: integer(input.peakPence, 100, 500000, 'peak price'),
      weekendSupplementPence: integer(input.weekendSupplementPence, 0, 100000, 'weekend supplement'),
      extraGuestPerNightPence: integer(input.extraGuestPerNightPence, 0, 100000, 'guest supplement'),
      sofaBedPerStayPence: integer(input.sofaBedPerStayPence, 0, 100000, 'sofa-bed charge'),
      termsVersion: text(input.termsVersion, 1, 80, 'terms version')
    };
    date(s.openingDate);
    if (s.maxNights < s.minNights) fail('The maximum stay must be at least the minimum stay.');
    if (!Array.isArray(input.lodges) || input.lodges.length !== 2) fail('Configure the two lodges.');
    s.lodges = input.lodges.map(function(lodge) {
      if (!lodge || !/^[a-z0-9-]{1,40}$/.test(lodge.id)) fail('Invalid lodge identifier.');
      return { id: lodge.id, name: text(lodge.name, 1, 60, 'lodge name') };
    });
    if (new Set(s.lodges.map(function(l) { return l.id; })).size !== 2) fail('Lodge identifiers must be different.');
    if (!Array.isArray(input.hampers) || input.hampers.length > 8) fail('Check hamper options.');
    s.hampers = input.hampers.map(function(h) {
      if (!h || !/^[a-z0-9-]{1,40}$/.test(h.id)) fail('Invalid hamper identifier.');
      return { id: h.id, name: text(h.name, 1, 80, 'hamper name'), pricePence: integer(h.pricePence, 0, 100000, 'hamper price') };
    });
    if (new Set(s.hampers.map(function(h) { return h.id; })).size !== s.hampers.length) fail('Hamper identifiers must be different.');
    if (!Array.isArray(input.peakRanges) || input.peakRanges.length > 100) fail('Check peak date ranges.');
    s.peakRanges = input.peakRanges.map(function(r) {
      if (!r || typeof r !== 'object') fail('Check peak date ranges.');
      nights(r.from, r.to, 366); return { from: r.from, to: r.to };
    });
    ['termsUrl', 'privacyUrl'].forEach(function(key) {
      if (input[key] === (key === 'termsUrl' ? '/booking-terms.html' : '/privacy.html')) { s[key] = input[key]; return; }
      try {
        var u = new URL(input[key]);
        if (u.protocol !== 'https:') fail('Use an HTTPS link for ' + key + '.');
        s[key] = u.href;
      } catch (_) { fail('Check the ' + key + ' link.'); }
    });
    return s;
  }
  function selection(settings, input, currentDay) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Check your booking selection.');
    var value = {
      lodgeId: input.lodgeId || 'any',
      checkIn: input.checkIn, checkOut: input.checkOut,
      adults: integer(input.adults, 1, 4, 'adults'),
      children: integer(input.children, 0, 3, 'children'),
      bedrooms: integer(input.bedrooms == null ? 2 : input.bedrooms, 1, 2, 'bedrooms'),
      sofaBed: input.sofaBed === true,
      hamperId: input.hamperId || '',
      hamperQuantity: integer(input.hamperQuantity == null ? 0 : input.hamperQuantity, 0, 28, 'hamper quantity'),
      bedroomOne: input.bedroomOne || 'king', bedroomTwo: input.bedroomTwo || 'king'
    };
    if (input.sofaBed != null && typeof input.sofaBed !== 'boolean') fail('Check your sofa-bed selection.');
    if (value.bedrooms === 1) value.bedroomTwo = 'closed';
    if (value.lodgeId !== 'any' && !settings.lodges.some(function(l) { return l.id === value.lodgeId; })) fail('Choose an available lodge.');
    var days = nights(value.checkIn, value.checkOut, settings.maxNights);
    if (days.length < settings.minNights) fail('The minimum stay is ' + settings.minNights + ' nights.');
    var firstDay = currentDay || today();
    if (value.checkIn < settings.openingDate || value.checkIn < firstDay) fail('Choose an arrival after opening and not in the past.');
    if (value.checkOut > addDays(firstDay, settings.horizonDays + 1)) fail('Those dates are beyond the booking calendar.');
    var guests = value.adults + value.children;
    if (value.adults === 4 && value.children > 0) fail('Four adults cannot be combined with children in one lodge.');
    if (value.bedrooms === 1 && guests > 2) fail('The one-bedroom option is for a maximum of two guests. Choose two bedrooms for a larger party.');
    if (value.sofaBed && (value.children === 0 || value.bedrooms !== 2)) fail('The sofa bed can be reserved for children on a two-bedroom booking.');
    var familyOfFive = value.adults === 2 && value.children === 3;
    if (guests > 4 && !familyOfFive) fail('Each lodge sleeps four; the five-person option is for two adults and three children using the sofa bed.');
    if (familyOfFive && !value.sofaBed) fail('Please select the sofa bed for your party of two adults and three children.');
    if (value.hamperId && !settings.hampers.some(function(h) { return h.id === value.hamperId; })) fail('Choose a valid hamper.');
    if ((!value.hamperId && value.hamperQuantity !== 0) || (value.hamperId && value.hamperQuantity < 1)) fail('Check the hamper quantity.');
    ['bedroomOne', 'bedroomTwo'].forEach(function(key) {
      if (!(key === 'bedroomTwo' && value.bedrooms === 1) && !['king', 'twin'].includes(value[key])) fail('Choose king or twin beds for each bedroom.');
    });
    return value;
  }
  function nightlyRate(settings, day, lodgeId, overrides, bedrooms, oneBedroomRates) {
    date(day);
    if (bedrooms === 1) {
      var one = (oneBedroomRates || []).find(function(o) { return o.lodgeId === lodgeId && o.night === day; });
      if (!one) fail('One-bedroom stays are not available for every night of these dates. Choose two bedrooms or different dates.');
      return one.pricePence;
    }
    var override = (overrides || []).find(function(o) { return o.lodgeId === lodgeId && o.night === day; });
    if (override) return override.pricePence;
    var month = Number(day.slice(5, 7));
    var peak = month === 7 || month === 8 || settings.peakRanges.some(function(r) { return day >= r.from && day < r.to; });
    var base = peak ? settings.peakPence : (month <= 3 || month >= 11 ? settings.winterPence : settings.standardPence);
    var weekday = new Date(date(day)).getUTCDay();
    return base + ([5, 6].includes(weekday) ? settings.weekendSupplementPence : 0);
  }
  function quote(settings, input, options) {
    options = options || {};
    var value = selection(settings, input, options.today);
    var days = nights(value.checkIn, value.checkOut, settings.maxNights);
    var lodge = settings.lodges.find(function(l) { return l.id === value.lodgeId; }) || settings.lodges[0];
    var extraGuests = Math.max(0, value.adults + value.children - settings.baseGuests);
    var daily = days.map(function(day) {
      var base = nightlyRate(settings, day, lodge.id, options.overrides, value.bedrooms, options.oneBedroomRates);
      return { date: day, basePence: base, guestSupplementPence: extraGuests * settings.extraGuestPerNightPence, totalPence: base + extraGuests * settings.extraGuestPerNightPence };
    });
    var accommodationPence = daily.reduce(function(sum, row) { return sum + row.basePence; }, 0);
    var guestSupplementPence = daily.reduce(function(sum, row) { return sum + row.guestSupplementPence; }, 0);
    var sofaBedPence = value.sofaBed ? settings.sofaBedPerStayPence : 0;
    var hamper = settings.hampers.find(function(h) { return h.id === value.hamperId; });
    var hamperPence = hamper ? hamper.pricePence * value.hamperQuantity : 0;
    return {
      selection: value, lodge: lodge, nights: days.length, daily: daily,
      accommodationPence: accommodationPence, guestSupplementPence: guestSupplementPence,
      sofaBedPence: sofaBedPence, hamperPence: hamperPence,
      hamperName: hamper ? hamper.name : '',
      totalPence: accommodationPence + guestSupplementPence + sofaBedPence + hamperPence,
      currency: 'gbp', pricesApproved: settings.pricesApproved
    };
  }
  function money(pence) { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: pence % 100 ? 2 : 0 }).format(pence / 100); }
  return { date: date, addDays: addDays, nights: nights, today: today, integer: integer, text: text, validateSettings: validateSettings, selection: selection, nightlyRate: nightlyRate, quote: quote, money: money, hamperNotice: hamperNotice, hamperDeadline: hamperDeadline, hamperAvailable: hamperAvailable };
});
