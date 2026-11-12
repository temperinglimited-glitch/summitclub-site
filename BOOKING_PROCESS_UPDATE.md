# Summit Club booking update — 12 November 2026

Prepared against GitHub main commit `5a10836f54301d1026d4a9be94e5089527182cba`. This is a source update for the existing repository, not a deployment. Keep the existing Cloudflare account, Worker, secrets, Access policy and Durable Object namespace.

## What is included

- Required lead-guest phone and postal address/country. Postcode required for the UK, US, Canada and Australia; Eircode optional for Ireland. The address is a contact/registration address, not an instruction to Stripe to collect card details.
- Lead guest must be 18+ and stay at the lodge. Adults are 18+; children are under 18, with age on arrival recorded. Existing occupancy, sofa-bed and king/twin rules remain. Both bedrooms still have their own en-suite shower room.
- Only Roscaire and Finn in the lodge list. Bedroom-count choice stays hidden and uses the full lodge.
- First-party, branded draft terms/privacy pages. The cancellation summary appears before payment. Each new booking saves its exact accepted terms/privacy text, version, acceptance time and SHA-256 fingerprint; stale forms are refused if the terms text changes even under the same version; the confirmation attaches a plain-text copy with the booking details. Existing bookings keep their recorded prices and policies.
- A private pre-arrival registration link in confirmations and the signed booking-status page. It requires a confirmed booking, uses a separate signed token, and expires after the day following departure. It collects the required information for guests aged 16+, including conditional travel-document fields. Passport images are not requested. Details appear only behind the private registration link or authenticated owner access; they are not in the booking-status response or confirmation email.
- Owner view of registration, address, ages, requests and hamper stocking list. Special requests need written agreement; entering one does not guarantee it.
- Email failure counts, retry attempts and safe diagnostic categories. “Sent” still means accepted by Resend, not proof of inbox delivery. Retry scheduling now checks the whole pending queue.
- Read-only owner check for the deployed Cloudflare Durable Object's current recovery bookmark. This is a reference into Cloudflare's recovery history, not a downloaded backup and not a restore button.

## Breakfast hampers — supplied menu

Each hamper is ingredients for **one generous breakfast**, ready to cook in the lodge. Stock before arrival; chilled items go in the fridge. Charge **per hamper**, never automatically per guest or per night. Quantity defaults to one and can be changed explicitly.

| Item | For two — £35 | Family, serves four — £55 |
|---|---|---|
| Pork sausages | 4 | 8 |
| Back bacon | 4 rashers | 8 rashers |
| Free-range eggs | 6 | 12 |
| Soda farls | 2 | 4 |
| Potato bread | 2 pieces | 4 pieces |
| Tomatoes | 2 | 4 |
| Mushrooms | 150g | 250g |
| Fresh scones or pastries | 2 | 4 |
| Juice | 1 litre | 1 litre |
| Milk | 1 litre | 1 litre |
| Butter | Small pack | Small pack |
| Individual jams | 2 | 4 |
| Fresh fruit | 2 pieces | 4 pieces |

Tea, coffee, cooking oil, salt and pepper are standard lodge essentials. No supplier is named publicly. Contents remain proposed until the supplier/products are confirmed. Do not infer an allergen declaration from this ingredient list: obtain the actual product labels and cross-contact information. Live hamper purchases remain unavailable until the description, allergen information and review flag are complete.

Menu and review information: `config/business.json`. Default prices: `config/pricing.json`. A one-time `hamperVersion: 1` migration applies the supplied £35/£55 prices to the two known hamper options in saved settings; other lodge rates and all historical booking quotes remain unchanged. Subsequent owner price edits are preserved. Form totals, server totals, Stripe line amounts and email totals use the same quote.

## Choices used in the draft terms

- Full payment on booking.
- Cancellation: 30+ days before arrival = full refund; 7–29 days = 50% refund; 0–6 days/no-show = no scheduled refund. Any amount retained is limited to reasonable loss, allowing for savings and re-letting. Calendar days use Northern Ireland local dates. This is the existing policy clarified, not Killyhevlin's deposit policy.
- No fixed damage deposit. Reasonable evidenced damage beyond normal wear and tear is discussed with the guest; no automatic damage charge to a saved card.
- Lead guest and adults 18+. No marketing consent is bundled into booking or the visitor-register declaration.

The draft is not legal sign-off. The older external policy pages could not be read reliably, so this is original wording based on the operating choices and the guidance below; it is not a redline of those pages.

## Upload to the existing GitHub repository

1. Download and unzip `Summit_Club_Booking_Process_Update_v2.zip`.
2. In `temperinglimited-glitch/summitclub-site`, use **Add file → Upload files** at the repository root on `main`.
3. Drag the extracted **config, server, public, cloudflare, scripts and test folders**, plus this guide and the verification manifest, into the upload area. Keep the folder paths. Commit them together, so the new form and validation arrive in one release. Prefer file upload to manually pasting code.
4. Wait for the correct `summitclub-booking-test` Worker build to succeed. Build command remains `npm run build:cloudflare`; deploy command remains `npx wrangler deploy --config wrangler.test.jsonc`.
5. Hard-refresh `https://test.summitclub.co`. Check the form, both policy links, a fresh sandbox booking, the confirmation attachment and its registration link. Check the owner copy and dashboard. Confirm no new email failures appear.

No Wrangler configuration or secrets are in this package. Keep payment mode `test` and email delivery `on` on the active test Worker. Keep `RECEIPT_SECRET` unchanged or older private links will stop working. Do not change the Durable Object namespace or its stable ID. Uploading these files does not open live payments on the public brochure.

Known placeholder policy links in saved settings migrate to `/booking-terms.html` and `/privacy.html`. Custom policy links are preserved for review; checkout refuses to mix custom links with this generated contract snapshot. Contact us to integrate custom wording rather than changing only a URL. Policy fields in the owner screen are now read-only. Bump POLICY_VERSION whenever the terms/privacy content or business identity changes, rebuild the policy pages and test again.

## Information still needed before live bookings

The supplied business details are now entered in `config/business.json`: Tempering NI Limited t/a Summit Club; company NI717654; VAT 478976016; telephone +353 85 712 6407. Registered office and correspondence address: 10C Clontafleece Road, Burren, BT34 3QS. These details were supplied by the owner; registry/VAT verification has not been performed. The current terms version is `2026-11-12-draft-2`; existing managed draft settings upgrade automatically without changing historical bookings. Check that `bookings@summitclub.co` and `hello@summitclub.co` forward and can receive replies. Keep `reviewedForLiveBookings` false until the business details and the actual terms/privacy/provider arrangements are reviewed. Live checkout is blocked while those items remain incomplete; private sandbox testing continues.

Have a Northern Ireland adviser review the cancellation/fair-loss wording, consumer remedies, assistance/access provisions, visitor-register/travel-document requirements and the privacy notice against the real business. Confirm any food-business registration and handling requirements with the local authority, as applicable. Confirm suppliers, cold-chain/storage, use-by instructions and exact allergens; supply allergen information both before purchase and with the hamper. Do not label a hamper allergy-safe or vegetarian without verified products and handling arrangements.

For accounting, agree VAT treatment and compliant invoice/credit-note handling with your accountant, including the mixed hamper contents. No VAT-invoice generator, Stripe Tax switch or automatic tax calculation is enabled by this update. Do not copy the example site's 13.5% VAT wording.

## Practical operating procedure

1. **Daily and after each booking:** check owner bookings, Resend delivery/bounces, the email-failure warning and Stripe payment exceptions. Reconcile a payment before releasing a disputed hold. Arrange any due refund in Stripe, then cancel/release dates in the owner screen. A dashboard cancellation alone does not refund money.
2. **Before arrival:** verify payment and party/bed choices; complete/check the visitor register. Send the actual address, directions, parking, arrival time/key instructions, a monitored assistance number and relevant site/access information. These practical directions/key instructions are not automatically scheduled or emailed by this update. Stock each purchased hamper from its saved item list; put chilled items in the fridge and include labels/instructions. Record any agreed special request in your operations notes.
3. **On arrival/departure:** check register accuracy; obtain/update any required travel-document and next-destination details. Keep register access restricted. Review extra registration/document data after the 12-month requirement; retain necessary accounting records for the required period. There is no automatic deletion task in this update, so assign a retention review and secure disposal process.
4. **Before using Airbnb/Booking.com:** agree and test one calendar/inventory process. No OTA connection or channel-manager sync is included. Do not sell the same nights through an unsynchronised second calendar.
5. **Before going live:** repeat decline, abandoned checkout, successful payment, duplicate-click/retry, cancellation/refund, overlapping-date, email-failure and registration-link tests in the private sandbox. Use separate live storage and credentials when live deployment is prepared. Confirm Tourism NI certification, insurance and your operating procedures separately.

## Recovery and monitoring

Cloudflare documents a 30-day point-in-time recovery window for SQLite Durable Objects. Record the owner-screen bookmark and deployment commit before changes. A bookmark is not an independent long-term backup. The existing `npm run backup` command covers the local Node SQLite deployment, not the hosted Durable Object.

Agree and rehearse a hosted restore/export procedure on an isolated test namespace before relying on it. Do not run a restore against the active booking store as a trial. Stop new writes during a real recovery, retain the current state, reconcile Stripe payments/holds received after the chosen recovery point, and handle the restored email queue carefully before resuming. Stripe money movements cannot be rolled back by restoring the booking database. No real Cloudflare restore was performed in this update.

The dashboard warnings are visible when the owner opens it; they are not out-of-band incident alerts. Establish who checks them and how a payment/website/email outage is escalated. Provider alerting, long-term encrypted exports and a live restore drill remain operational work.

## Source and validation notes

- [NI business guidance: visitor register](https://www.nibusinessinfo.co.uk/content/keeping-guest-register-your-tourist-accommodation-business) — guest identity/address/nationality, stay dates, secure retention for at least 12 months. The form uses 16+ and includes conditional travel-document fields; confirm the precise obligations for your certified accommodation in the legal review.
- [VisitBritain: registration and data protection](https://www.visitbritain.org/business-advice/pink-book/registration-data-protection-and-surveillance) — additional document/next-destination records for certain nationalities. Its guidance is labelled England; obtain Northern Ireland confirmation before relying on it alone.
- [NI online selling guidance](https://www.nibusinessinfo.co.uk/content/online-selling-rules) and [online contracts](https://www.nibusinessinfo.co.uk/content/information-required-online-contract) — clear business identity, contact address, total charges and contract information.
- [CMA: fair contracts](https://www.gov.uk/guidance/writing-a-fair-contract-for-customers) and [cancellation charges](https://www.gov.uk/government/publications/cancelling-goods-or-services-guide-for-consumers/cancelling-goods-or-services) — transparent terms, proportionate loss and re-selling/savings.
- [Consumer Contracts Regulations, regulation 28](https://www.legislation.gov.uk/uksi/2013/3134/regulation/28) — specified-date accommodation exception to the usual change-of-mind cancellation right.
- [ICO: privacy information](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/) — controller, purposes, lawful bases, recipients/transfers, retention and rights. Guidance is under review following the Data (Use and Access) Act; check the final notice with your adviser.
- [Government food-allergen guidance](https://www.gov.uk/government/publications/food-allergen-labelling-and-information-requirements-technical-guidance/food-allergen-labelling-and-information-requirements-technical-guidance) — allergen information before purchase and at delivery.
- [HMRC: company records](https://www.gov.uk/running-a-limited-company/company-and-accounting-records) — six years from the end of the relevant company financial year, subject to longer requirements.
- [Cloudflare SQLite recovery API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) — recovery bookmarks and the 30-day window.

Validation uses synthetic data and simulated payment/email providers. No real payment or email was sent, and no production settings, bookings, permissions or DNS records were changed. The package manifest records the checks completed for this release.
