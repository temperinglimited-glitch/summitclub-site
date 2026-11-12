import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { policyDocuments, readiness } from '../server/policies.mjs';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function buildPolicies() {
  const docs = policyDocuments(), business = readiness().business;
  for (const [file, title, sections] of [['booking-terms.html', 'Booking terms', docs.terms], ['privacy.html', 'Privacy notice', docs.privacy]]) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} · Summit Club</title><link rel="stylesheet" href="assets/site.css"><link rel="stylesheet" href="assets/booking.css?v=20261112-3"></head><body><main class="policy-card"><a href="index.html" class="label">SUMMIT CLUB</a><h1>${title}</h1><p class="booking-help">Version ${escape(docs.version)}</p>${docs.draft ? '<p class="booking-notice">Private testing draft. Company details and legal/privacy review must be completed before live bookings open.</p>' : ''}${sections.map(([h, p]) => '<section><h2>' + escape(h) + '</h2><p>' + escape(p) + '</p></section>').join('')}<p>Contact <a href="mailto:${escape(business.contactEmail)}">${escape(business.contactEmail)}</a>.</p><nav><a href="booking-terms.html">Booking terms</a> · <a href="privacy.html">Privacy notice</a> · <a href="index.html">Back to Summit Club</a></nav></main></body></html>`;
    writeFileSync(new URL('../public/' + file, import.meta.url), html + '\n');
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) buildPolicies();
