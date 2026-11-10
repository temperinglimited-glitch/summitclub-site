# Summit Club: website with JavaScript booking

This package adds a booking form to your existing Summit Club page and includes the latest three edited photographs. It also provides a small Node.js server, a SQLite booking database, Stripe Checkout integration and an owner screen. It is a working first implementation for testing and configuration; live payments are switched off.

**For your existing Cloudflare website, start with [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md).** It explains how to keep `summitclub.co` public and deploy invite-only booking tests at `test.summitclub.co`. The configured owner and initial tester is **summit.club.ni@gmail.com**. That protection has been prepared but is not yet deployed. The Cloudflare test Worker refuses live Stripe payments.

The lodges are **Lodge 1 — Roscaire** and **Lodge 2 — Finn**. The original placeholder names are updated automatically on an existing database; owner-customised names and historical booking quotes are preserved.

## Preview the website

Open **`public/index.html`** in your browser. Select **Check dates** to explore the calendar, guest numbers, bed layouts and breakfast hampers. Opening the file directly shows example prices and cannot check actual availability or take payment.

To use saved availability and the owner screen, run the server below. The HTML file alone cannot securely handle payment or prevent double bookings.

## Run locally

Install **Node.js 24 LTS, version 24.13 or later within the 24 series** from [nodejs.org](https://nodejs.org/en/download). No third-party JavaScript packages are required.

In Terminal, change into this project folder, then run:

```sh
cp .env.example .env
npm run admin-token
```

Copy the generated value into `ADMIN_TOKEN` in `.env`. Run `npm run admin-token` again and put that second value into `RECEIPT_SECRET`. Keep the two values separate and private.

Then run:

```sh
npm start
```

Open:

- Website: [http://localhost:3000](http://localhost:3000)
- Owner screen: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

Sign in with your `ADMIN_TOKEN`. Payment stays disabled with `PAYMENTS_MODE=off`. Press Control-C in Terminal to stop the server. Restart it after changing `.env`.

## Review these pricing assumptions

The existing page's £250 / £360 / £420 figures have been retained, but the new example pricing model includes two guests in those starting rates. This changes the old page's statement that the rates included four guests. Approve the intended model before accepting bookings.

| Item | Initial setting | Status |
| --- | --- | --- |
| Winter nightly base | £250; November–March | Retained draft rate |
| Standard nightly base | £360; April–June, September–October | Retained draft rate |
| Peak nightly base | £420; July–August and configured peak ranges | Retained draft rate |
| Guests in the base rate | 2 | Illustrative assumption |
| Each additional guest | £25 per night; adults and children charged equally | Illustrative assumption |
| Children’s sofa bed | £30 per booking when requested, in addition to guest supplements | Owner-confirmed rule |
| Breakfast hamper for two | £35 per hamper | Illustrative assumption |
| Family breakfast hamper | £55 per hamper | Illustrative assumption |
| Weekend supplement | £0 per night; configurable for Friday/Saturday | Editable |
| Minimum / maximum stay | 2 / 28 nights | Editable |
| Initial opening date | 1 December 2026 | Draft |
| Booking horizon | 540 days ahead | Editable |

All prices are final guest-facing GBP amounts. The code does not add VAT or calculate tax separately. Confirm the correct advertised totals for your business. Cleaning is included.

Example: two winter nights for two adults and three children, with two family hampers, comes to **£790**: £500 accommodation + £150 additional guests + £30 sofa bed + £110 hampers.

Capacity is four people, with one exception: **two adults and three children** may use the sofa bed. Four adults cannot be combined with any children. The sofa bed is for children only and must be selected in advance; the £30 charge applies once per booking, regardless of nights. It is optional for smaller families and required for two adults and three children. The guest wording asks for advance sofa-bed preparation and does not mention unprovided bedding. Bedroom one and two can each be king or twin. The first version books **one lodge per checkout**; booking both means two bookings.

## One-bedroom stays

The one-bedroom option accommodates **a maximum of two guests**, with bedroom two closed. It is available **only on dates you explicitly open and price** in the owner screen; there are no automatically opened winter dates and no assumed one-bedroom price. You decide which dates count as low season for this offer. Every occupied night must be opened for the same lodge. The guest retains exclusive use of the lodge, kitchen, living area and bathroom.

One-bedroom and two-bedroom bookings share the same lodge inventory: a one-bedroom reservation blocks the entire lodge for those nights. The sofa-bed add-on is available only for families booking two bedrooms. Owner booking records and confirmation emails clearly identify the bedroom option and whether sofa-bed preparation is requested.

Hamper quantity means the number of morning deliveries, up to one hamper per night stayed. This version records the quantity rather than individual delivery dates; agree a delivery schedule with the guest.

The two sample peak periods, 11–14 February 2027 and 25 March–4 April 2027 inclusive, came from the existing page. They are draft business settings, not a verified school holiday calendar. Edit them each year.

## Owner controls

The owner screen lets you:

- Change seasonal prices, weekend supplements, included guests, guest charges, hamper prices, stay limits, lodge names and policy links.
- Add peak periods, one line per range. `2027-02-11 to 2027-02-15` charges peak prices for nights 11–14; departure is excluded.
- View a monthly calendar showing both bedroom prices for each day and whether the lodge is reserved.
- Set a nightly base price for either or both lodges, for one day or a date range. Two-bedroom prices replace the seasonal base and weekend supplement; guest charges and extras are still added. One-bedroom prices open only the chosen lodge-nights at the amount you enter.
- Block dates for your use or an external booking, and release blocks.
- View bookings, guest contact details, bed preferences, extras, payment mode and email delivery status.
- Recheck payments, retry email delivery and resolve interrupted checkouts.

`config/pricing.json` supplies the **initial database settings only**. After the first start, use the owner screen: settings persist in SQLite and are not replaced when you edit that JSON file. Before first use, editing the JSON is fine. `npm run sync-preview` updates the embedded offline example settings from that JSON; it does not change an existing booking database.

For the standalone Node version, the owner password is held in browser memory only; refreshing the owner page signs you out. On the private Cloudflare deployment, the verified owner email grants access instead. Protect private environment files, database files and backups as they contain secrets or guest information.

### Change daily prices without editing code

1. Sign in at `/admin.html` and scroll to **Daily prices & one-bedroom dates**.
2. Choose **One bedroom** or **Two bedrooms** in the bedroom-option field.
3. Select the calendar lodge and month. Click a date to fill a single-night edit, or type the first night and the departure/end date for a longer period.
4. Choose that lodge or **Both lodges**, enter the nightly base price in pounds, and select **Save daily prices**.
5. The calendar updates and new quotes use the new price immediately. Existing reservations and checkout price snapshots keep their agreed total.

For example, to open a one-bedroom offer for nights 10–13 January, select **One bedroom**, first night `2027-01-10`, end date `2027-01-14`, and enter your nightly price. Saving opens only those four nights. The end/departure date is excluded.

To remove a two-bedroom override, leave the price blank and save: seasonal pricing resumes. For one bedroom, blank means **close the one-bedroom option** for those dates. Closing that option does not cancel or change a reservation already made. Seasonal rates and Friday/Saturday supplements remain editable in **Rates & extras**.

### Updating an existing installation

The database upgrade creates a separate one-bedroom price table and moves older settings to the £30 sofa-bed rule. It leaves recorded booking quotes and existing two-bedroom prices intact and resets price approval so the revised rules can be reviewed before taking live bookings. Back up the database before replacing code, restart the server, review settings and approve them again. One-bedroom dates begin closed.

## Connect Stripe in test mode

1. In your Stripe test environment, obtain a **test secret API key**. Put it in `.env`, and set `PAYMENTS_MODE=test`.
2. For local webhook forwarding, follow the official [Stripe CLI testing guide](https://docs.stripe.com/stripe-cli/use-cli). A typical command is:

   ```sh
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

3. Copy the forwarding command's signing secret into `STRIPE_WEBHOOK_SECRET`. Set stable, separate `ADMIN_TOKEN` and `RECEIPT_SECRET` values of at least 32 characters. Restart `npm start`.
4. Make a booking with a Stripe test card, using the official [testing documentation](https://docs.stripe.com/testing). A common successful test card is `4242 4242 4242 4242`, a future expiry and any valid test CVC.
5. Confirm the website shows payment received, the owner screen marks the booking confirmed and a second guest cannot book the same lodge for those nights. Test an abandoned checkout too.

For hosted testing, configure a Stripe webhook destination at `https://YOUR-DOMAIN/api/stripe/webhook`. Subscribe to `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`. Put that endpoint's signing secret in the hosted environment; a CLI forwarding secret is different.

This integration uses Stripe-hosted Checkout with card payments, a fixed GBP total and full payment at booking. It pins REST requests to API version `2026-10-28.endive`. The server verifies the amount, currency, mode and booking reference and checks current Stripe state. A visit to the return page alone never confirms a booking.

No Stripe account was connected during development. A real test-mode checkout, webhook round trip and email delivery must be completed in your environment before going live.

## Confirmation email

The code uses [Resend](https://resend.com/docs/send-with-nodejs) for transactional email. Set up and verify your sending domain, then configure:

```text
EMAIL_DELIVERY=on
RESEND_API_KEY=your_private_key
EMAIL_FROM=Summit Club <bookings@YOUR-VERIFIED-DOMAIN>
OWNER_EMAIL=your_operational_email_address
```

A paid booking queues a guest confirmation and owner notification. Delivery retries after failures. Test bookings are marked `[TEST]`. With delivery off, messages stay queued; switching delivery on sends pending messages. Use controlled test email addresses while testing. The initial `hello@summitclub.co` values are placeholders carried over from your page; verify that mailbox before using it.

Emails include the stay, total, bed layout and extras. They do not send directions or access codes. Add those operational messages separately before opening, or send them manually.

## Holds, cancellations and payment recovery

Each checkout protects the occupied nights for up to one hour. A database transaction and unique lodge/night records prevent overlapping reservations. A departure date is available for another arrival.

The server checks pending checkouts once a minute, on restart and when a guest checks their status. It releases a known checkout only when Stripe reports it expired. If Stripe is unavailable or creation was interrupted, dates remain protected until the result is known.

In the owner screen:

- **Check / close checkout** rechecks a known Stripe session and can close it if still unpaid. A completed payment remains a booking.
- **Link Stripe checkout** lets you recover a missing Checkout Session ID (`cs_…`). Find the booking reference in Stripe's session metadata; the server verifies the match.
- **Release unresolved hold** appears for a missing-session reservation after its expiry plus five minutes. Check the booking reference and guest email in Stripe first and explicitly acknowledge that no payment was received. Prefer linking the session when one exists.
- `review` means the payment details or inventory need attention. Keep the dates protected and investigate the reference in Stripe. A mismatch involving a known session needs technical review before release.

**Refunds are handled in the Stripe Dashboard.** Cancelling in the owner screen releases dates and queues cancellation emails; it does not issue a refund. The screen requires you to acknowledge that any required refund has been handled. The refund terms displayed on your original page have been retained as copy and are not automatically calculated or enforced by this code.

## Alternative: standalone Node hosting and launch

The Cloudflare deployment is described in [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). If using the standalone Node version instead, deploy the whole project to **one persistent Node.js 24 server with durable disk storage**, behind HTTPS. That version needs its own access protection for private testing; it does not inherit Cloudflare Access just by running `npm start`. A static-only host cannot run the booking API, and separate Node servers must not use independent SQLite copies for the same inventory.

Use environment variables rather than uploading a populated `.env` to a public folder. For a typical HTTPS reverse proxy:

```text
HOST=0.0.0.0
PORT=3000
BASE_URL=https://YOUR-DOMAIN
DATABASE_PATH=/YOUR-PERSISTENT-DISK/bookings.sqlite
```

Forward the entire website, including `/api/`, to this Node process. Keep the process running with your host's process manager and preserve the database across deployments. Only `public/` is served; `.env`, server code and database files are outside it. The reverse proxy should provide connection throttling; the included per-IP API limit is a small additional control and uses the direct connection address.

Before live payment:

1. Use a **separate database path** for live bookings so test reservations and queued emails cannot carry over. Start that database with payment off, configure and approve its settings in the owner screen, then stop it.
2. Review the two lodge names, opening date, guest pricing, hampers, holiday ranges and capacity rules. Replace or verify the existing external booking terms and privacy notice links; the package retains the original links as drafts.
3. Configure HTTPS, the live Stripe key, the live webhook signing secret, stable receipt and owner secrets, and verified email delivery. Set `PAYMENTS_MODE=live` and restart. The server rejects a test/live key mismatch and refuses live mode until prices are approved and email is configured.
4. Complete the real Stripe test flow on the intended hosting setup, check confirmation delivery and verify the mobile booking layout in current browsers.

There is **no Airbnb / Booking.com synchronisation or channel manager** in this version. Enter external reservations as owner blocks. Do not rely on this database alone to protect availability on other booking sites. This version also does not include automated refunds, deposits, discount codes, customer accounts, market-driven automatic repricing or multiple-lodge baskets.

## Back up and maintain

For the standalone Node version, run `npm run backup` to make a consistent SQLite snapshot in `backups/`. Store regular backups privately off the server as well. This command does not back up the Cloudflare Durable Object; use Cloudflare's recovery tools for that deployment. Before restoring a backup, stop booking, reconcile any Stripe payments made after that snapshot and only then restore; otherwise recent paid bookings could be lost from inventory.

Keep a secure copy of `RECEIPT_SECRET`: rotating it invalidates existing private status links. A Stripe key or webhook signing-secret change requires a server restart. Back up the database before code changes.

## Tests and project files

Run `npm test`: **59 tests pass**. Tests cover seasonal and guest pricing, invalid input, overlapping reservations, independent lodges, exclusive departure dates, idempotent checkout retries, stale quotes, payment validation, tampered and repeated webhooks, outage handling, expiry races, owner controls, email retries and SQLite persistence/backup. Cloudflare tests also cover RSA Access token verification, approved emails, owner-only routes, the durable-storage adapter and public/private build separation.

The automated suite uses simulated Stripe and email providers; it cannot establish that your Stripe account, DNS, hosting or email domain are correctly configured. The revised guest form and owner workflow were checked in a local browser at desktop and phone widths. Repeat those checks on the actual hosting setup before accepting bookings.

| Path | Purpose |
| --- | --- |
| `CLOUDFLARE_SETUP.md` | Deployment steps for the public brochure and private booking test |
| `wrangler.test.jsonc`, `cloudflare/` | Private Cloudflare Worker and persistent booking adapter |
| `scripts/build-cloudflare.mjs` | Generates separate public Pages and private Worker assets |
| `public/index.html` | Your website with the integrated booking dialog |
| `public/images/` | Website images, including the latest edited photographs |
| `public/assets/booking.js`, `booking.css` | Booking interface and styles |
| `public/assets/pricing.js` | Shared browser/server pricing and validation |
| `public/admin.html` | Owner interface: email access on Cloudflare; password on standalone Node |
| `public/booking-status.html` | Private payment/booking status page |
| `server/` | HTTP server, booking API, SQLite storage and provider adapters |
| `config/pricing.json` | Initial draft settings |
| `.env.example` | Blank private configuration template |
| `test/` | Automated tests; no live payment or email calls |
| `SOURCES.md` | Primary technical documentation |
