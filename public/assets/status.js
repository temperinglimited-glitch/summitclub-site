(function() {
  'use strict';
  var id = new URLSearchParams(location.search).get('id');
  var token = new URLSearchParams(location.hash.slice(1)).get('token');
  var storageKey = 'summit-receipt-' + id;
  try { if (token) sessionStorage.setItem(storageKey, token); else token = sessionStorage.getItem(storageKey); } catch (_) {}
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  var attempts = 0, get = function(key) { return document.getElementById(key); };
  function line(text) { var p = document.createElement('p'); p.textContent = text; get('stay-details').appendChild(p); }
  async function check() {
    try {
      if (!id || !token) throw new Error('Open the private booking-status link from your checkout.');
      var response = await fetch('/api/booking-status?id=' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
      var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Please try again.');
      var confirmed = data.status === 'confirmed', cancelled = data.status === 'cancelled', expired = data.status === 'expired', review = data.status === 'review';
      get('stay-heading').textContent = confirmed ? 'Your stay is booked.' : cancelled ? 'Booking cancelled.' : expired ? 'Your checkout has expired.' : review ? 'Your payment needs a quick check.' : 'Your booking is not confirmed yet.';
      get('stay-message').textContent = confirmed ? 'Thank you, ' + data.guestName + '. ' + (data.mode === 'test' ? 'This is a test booking; no real payment was taken.' : 'Your payment was received and your dates are reserved.') :
        review ? 'Please contact us with the reference below. Please do not make another payment while we check.' :
        cancelled ? 'The dates have been released. Any applicable refund is handled separately.' :
        expired ? 'No booking was confirmed. Return to the website to choose your dates again.' :
        'If you have paid, we are waiting for confirmation from Stripe. Otherwise you can resume your checkout while the dates remain reserved.';
      get('stay-details').replaceChildren();
      line(data.quote.lodge.name + ' · ' + data.quote.selection.checkIn + ' to ' + data.quote.selection.checkOut);
      line(data.quote.selection.adults + ' adults · ' + data.quote.selection.children + ' children · ' + window.SummitPricing.money(data.quote.totalPence));
      line(data.quote.selection.bedrooms === 1 ? 'One bedroom · second bedroom closed' : 'Two bedrooms');
      line(data.quote.selection.sofaBed === true || data.quote.sofaBedPence > 0 ? 'Sofa bed reserved for children' : 'Sofa bed not reserved');
      if (data.quote.hamperName) line(data.quote.hamperName + ' × ' + data.quote.selection.hamperQuantity);
      line('Reference: ' + data.id);
      if (confirmed && data.registrationUrl) {
        var registration = new URL(data.registrationUrl);
        if (registration.origin === location.origin && registration.pathname === '/guest-registration.html') {
          var register = document.createElement('a'); register.className = 'btn'; register.textContent = 'Complete guest registration'; register.href = registration.href; get('stay-details').appendChild(register);
        }
      }
      if (data.checkoutUrl) {
        var link = document.createElement('a'); link.textContent = 'Resume secure checkout'; link.className = 'btn dark';
        var destination = new URL(data.checkoutUrl);
        if (destination.origin === 'https://checkout.stripe.com') { link.href = destination.href; get('stay-details').appendChild(link); }
      }
      if (!confirmed && !cancelled && !expired && !review && ++attempts < 20) setTimeout(check, 3000);
    } catch (error) { get('stay-heading').textContent = 'We couldn’t check your booking yet.'; get('stay-message').textContent = error.message + ' If you have paid, please contact us before paying again.'; }
  }
  check();
})();
