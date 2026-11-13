(function() {
  'use strict';
  var D = window.SummitDetails, get = function(id) { return document.getElementById(id); };
  var id = new URLSearchParams(location.search).get('id'), token = new URLSearchParams(location.hash.slice(1)).get('token'), key = 'summit-register-' + id;
  try { if (token) sessionStorage.setItem(key, token); else token = sessionStorage.getItem(key); } catch (_) {}
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  var entries = [], busy = false;
  function node(tag, text) { var e = document.createElement(tag); if (text != null) e.textContent = text; return e; }
  function field(area, title, value, max, optional) {
    var label = node('label', title), input = node('input'); label.className = 'booking-field'; input.value = value || ''; input.maxLength = max; input.required = !optional; label.appendChild(input); area.appendChild(label); return input;
  }
  function addressFields(area, value) {
    value = value || {};
    var fields = { line1: field(area, 'Address line one', value.line1, 120), line2: field(area, 'Address line two (optional)', value.line2, 120, true), city: field(area, 'Town / city', value.city, 80), postcode: field(area, 'Postcode / ZIP / Eircode (Eircode optional)', value.postcode, 20, true) };
    var label = node('label', 'Country'), select = node('select'); label.className = 'booking-field'; select.required = true; D.populateCountries(select, value.country); label.appendChild(select); area.appendChild(label); fields.country = select;
    function postcode() { fields.postcode.required = ['GB', 'US', 'CA', 'AU'].includes(select.value); }
    select.addEventListener('change', postcode); postcode(); return fields;
  }
  function readAddress(fields) { var value = {}; Object.keys(fields).forEach(function(k) { value[k] = fields[k].value; }); return value; }
  function render(data) {
    get('registration-stay').textContent = data.lodge + ' · ' + data.checkIn + ' to ' + data.checkOut;
    if (!data.childAgesKnown) throw new Error('Please contact us with the children’s ages on arrival so we can prepare your register.');
    get('registration-message').textContent = data.registration ? 'Your saved details are below. You can make corrections and save again.' : 'A few details for the visitor register, before you arrive.';
    var existing = data.registration ? data.registration.guests : [];
    for (var i = 0; i < data.count; i++) {
      var value = existing[i] || (i === 0 ? data.leadGuest : {}), area = node('fieldset'); area.className = 'registration-entry';
      area.appendChild(node('legend', i === 0 ? 'Lead guest · 18+' : 'Guest ' + (i + 1) + ' · aged 16 or over'));
      var entry = { name: field(area, 'Full name', value.name, 100), nationality: field(area, 'Nationality', value.nationality, 80) };
      entry.address = addressFields(area, value.address);
      if (i > 0 && data.leadGuest.address) {
        var copy = node('button', 'Use lead guest’s address'); copy.type = 'button'; copy.className = 'btn';
        (function(fields) { copy.addEventListener('click', function() { Object.keys(fields).forEach(function(k) { fields[k].value = entries[0].address[k].value; }); fields.country.dispatchEvent(new Event('change')); }); })(entry.address);
        area.appendChild(copy);
      }
      var label = node('label', 'Is this guest British, Irish, a Commonwealth national, or legally exempt from travel-document registration?'); label.className = 'booking-field';
      entry.travel = node('select'); entry.travel.required = true;
      [['', 'Choose an answer'], ['no', 'Yes — additional document details not required'], ['yes', 'No — provide travel-document details']].forEach(function(pair) { var option = node('option', pair[1]); option.value = pair[0]; entry.travel.appendChild(option); });
      entry.travel.value = typeof value.travelDetailsRequired === 'boolean' ? value.travelDetailsRequired ? 'yes' : 'no' : ''; label.appendChild(entry.travel); area.appendChild(label);
      var help = node('p', 'If unsure, contact us before completing this entry. Document details can be checked with us on arrival.'); help.className = 'booking-help'; area.appendChild(help);
      var extra = node('div');
      entry.documentNumber = field(extra, 'Passport / travel-document number', value.documentNumber, 60);
      entry.documentIssuePlace = field(extra, 'Place of issue', value.documentIssuePlace, 100);
      entry.nextDestination = field(extra, 'Next destination, including address if known (or “not yet known”)', value.nextDestination, 240);
      area.appendChild(extra);
      (function(e, group) {
        function sync() { group.hidden = e.travel.value !== 'yes'; group.querySelectorAll('input').forEach(function(input) { input.disabled = group.hidden; }); }
        e.travel.addEventListener('change', sync); sync();
      })(entry, extra);
      entries.push(entry); get('registration-guests').appendChild(area);
    }
    get('registration-form').hidden = false;
  }
  async function api(method, value) {
    var response = await fetch('/api/guest-registration?id=' + encodeURIComponent(id), { method: method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: value ? JSON.stringify(value) : undefined, signal: AbortSignal.timeout(15000) });
    var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Please try again.'); return data;
  }
  get('registration-form').addEventListener('submit', async function(event) {
    event.preventDefault(); if (busy || !this.reportValidity()) return;
    busy = true; get('registration-save').disabled = true; get('registration-error').hidden = true;
    try {
      var guests = entries.map(function(e) { return { name: e.name.value, nationality: e.nationality.value, address: readAddress(e.address), travelDetailsRequired: e.travel.value === 'yes', documentNumber: e.documentNumber.value, documentIssuePlace: e.documentIssuePlace.value, nextDestination: e.nextDestination.value }; });
      await api('PUT', { guests: guests, accuracyConfirmed: get('registration-accurate').checked });
      get('registration-message').textContent = 'Thank you. Your guest register has been saved. We will check it with you on arrival.'; get('registration-message').scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (error) { get('registration-error').textContent = error.message; get('registration-error').hidden = false; }
    finally { busy = false; get('registration-save').disabled = false; }
  });
  (async function() { try { if (!id || !token) throw new Error('Use the private registration link in your confirmation email.'); render(await api('GET')); } catch (error) { get('registration-message').textContent = error.message; } })();
})();
