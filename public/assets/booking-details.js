(function(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SummitDetails = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  var countries = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
  function fail(message) { var error = new Error(message); error.status = 400; throw error; }
  function text(value, max, label, optional, multiline) {
    if (optional && (value == null || value === '')) return '';
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || (multiline ? /[\x00-\x08\x0b-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) fail('Check ' + label + '.');
    return value.trim();
  }
  function address(value) {
    value = value || {};
    var country = text(value.country, 2, 'country');
    if (!countries.includes(country)) fail('Choose a country.');
    var result = {
      line1: text(value.line1, 120, 'address line one'), line2: text(value.line2, 120, 'address line two', true),
      city: text(value.city, 80, 'town or city'), postcode: text(value.postcode, 20, 'postcode', true), country: country
    };
    if (['GB', 'US', 'CA', 'AU'].includes(country) && !result.postcode) fail('Enter your postcode or ZIP code.');
    return result;
  }
  function contact(value) {
    value = value || {};
    var result = { name: text(value.name, 100, 'full name'), email: text(value.email, 254, 'email address').toLowerCase(), phone: text(value.phone, 40, 'phone number'), address: address(value.address) };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) fail('Enter a valid email address.');
    var digits = result.phone.replace(/\D/g, '');
    if (!/^[+\d\s().-]+$/.test(result.phone) || digits.length < 7 || digits.length > 15) fail('Enter a phone number, including the country code.');
    return result;
  }
  function details(value, selection) {
    value = value || {};
    if (value.leadGuest18 !== true) fail('Confirm that the lead guest is at least 18 and will stay at the lodge.');
    if (!Array.isArray(value.childAges) || value.childAges.length !== selection.children || value.childAges.some(function(age) { return !Number.isInteger(age) || age < 0 || age > 17; })) fail('Enter the age on arrival of each child (0–17).');
    var requests = typeof value.requests === 'string' ? value.requests.replace(/\r\n?/g, '\n') : value.requests;
    return { leadGuest18: true, childAges: value.childAges.slice(), hamperFulfilment: selection.hamperId ? 'before-arrival' : '', requests: text(requests, 500, 'special requests', true, true) };
  }
  function registration(value, booking) {
    var s = booking.quote.selection, ages = booking.data.details && booking.data.details.childAges;
    if (s.children && (!Array.isArray(ages) || ages.length !== s.children)) fail('Please contact Summit Club to record the children’s ages before completing registration.');
    var count = s.adults + (ages || []).filter(function(age) { return age >= 16; }).length;
    if (!value || !Array.isArray(value.guests) || value.guests.length !== count) fail('Complete a register entry for each guest aged 16 or over.');
    if (value.accuracyConfirmed !== true) fail('Confirm the details are accurate and you have shared the privacy notice with the other guests.');
    return { guests: value.guests.map(function(g, i) {
      var result = { name: text(g.name, 100, 'guest ' + (i + 1) + ' full name'), nationality: text(g.nationality, 80, 'nationality'), address: address(g.address), travelDetailsRequired: g.travelDetailsRequired };
      if (typeof result.travelDetailsRequired !== 'boolean') fail('Answer the travel-document question for each guest.');
      if (result.travelDetailsRequired) {
        result.documentNumber = text(g.documentNumber, 60, 'passport or travel-document number');
        result.documentIssuePlace = text(g.documentIssuePlace, 100, 'travel-document place of issue');
        result.nextDestination = text(g.nextDestination, 240, 'next destination (or say not yet known)');
      }
      return result;
    }), accuracyConfirmed: true };
  }
  function addressText(value) { return value ? [value.line1, value.line2, value.city, value.postcode, value.country].filter(Boolean).join(', ') : ''; }
  function populateCountries(select, chosen) {
    var names; try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}
    var entries = countries.map(function(code) { return { code: code, name: names ? names.of(code) : code }; }).sort(function(a, b) { return a.name.localeCompare(b.name); });
    entries = [{ code: '', name: 'Choose a country' }, { code: 'GB', name: 'United Kingdom' }, { code: 'IE', name: 'Ireland' }].concat(entries.filter(function(e) { return !['GB', 'IE'].includes(e.code); }));
    select.replaceChildren();
    entries.forEach(function(e) { var o = document.createElement('option'); o.value = e.code; o.textContent = e.name; select.appendChild(o); });
    select.value = chosen || '';
  }
  return { contact: contact, address: address, details: details, registration: registration, addressText: addressText, populateCountries: populateCountries };
});
