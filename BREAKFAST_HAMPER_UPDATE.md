# Summit Club breakfast update — £30 / £45 — 13 November 2026

Use this package for the revised hampers and the 48-hour notice. It also includes the latest clean registration completion panel, so the earlier registration-only ZIP is not needed separately.

## New options

- Small breakfast hamper · for two — £30 per hamper: sausages, bacon, eggs, baked beans, white bread, butter, jam, milk and orange juice.
- Large breakfast hamper · for four — £45 per hamper: the small hamper's contents, plus tomatoes and mushrooms.

The public lists have no item quantities. Each hamper is ingredients for one generous breakfast, ready to cook in the lodge; chilled items are stocked in the fridge before arrival. Tea, coffee, cooking oil, salt and pepper remain standard lodge essentials. Exact products and allergens still require supplier confirmation; the existing review flags remain off.

## Advance notice

“Breakfast hampers require at least 48 hours’ notice before your 3pm check-in.”

The deadline uses 3pm Northern Ireland time (Europe/London), including summer-time changes, minus 48 elapsed hours. Hamper options become unavailable within that window; the lodge remains bookable without a hamper. The server checks new quotes and new checkout requests too. A checkout already placed before the deadline can resume safely. Earlier booking prices, contents and accepted terms are preserved.

## Upload

1. Unzip Summit_Club_Breakfast_Update_30_45.zip.
2. Open https://github.com/temperinglimited-glitch/summitclub-site and select main.
3. At the repository root choose Add file → Upload files.
4. Drag the extracted config, public, server and test folders into the upload area, preserving paths. Include the guide/manifest files if keeping the repository documentation current.
5. Commit all updated files together. Wait for the correct summitclub-booking-test Cloudflare build to succeed, then hard-refresh https://test.summitclub.co.

Upload both config and server folders as well as public: the running booking system stores its pricing in a database. This update has a one-time hamperVersion 2 upgrade that replaces the old £35/£55 menu with £30/£45 in saved settings. Changing only the labels or seed JSON is insufficient. Other lodge prices, inventory and historical bookings are preserved. Later intentional owner price edits are not reset on every deployment.

Terms version becomes 2026-11-13-draft-3 to include the notice. Existing managed draft settings upgrade automatically; older accepted contracts remain unchanged. The two generated policy pages and their source are included. Business details, legal-review status, secrets, Access policies, payment mode and Durable Object identifiers are not changed by this package. No live payments are enabled.

## Registration panel

After successful submission, the form, instructions and stay details are replaced with the thank-you message, questions/corrections email and Back to Summit Club button. It returns home after five seconds. Reopened completed registrations show the clean panel without the fields. This carries forward the previously requested update.

## Validation and provenance

78 automated checks passed, including saved-price migration, historical-booking preservation, fixed per-hamper totals, Stripe payload consistency, confirmation contents and the 48-hour boundary in winter/summer and across a UK clock change. Cloudflare asset build passed. Local browser checks confirmed £30/£45 options, short unquantified lists, the notice, disabled options for a short-notice arrival, accommodation still quotable without food, and a four-guest two-night quote of £500 accommodation + £100 additional guests + £45 hamper = £645. Payment/email provider tests are simulated; no real transactions or emails were sent.

Reference pages checked on 13 November 2026:
- https://squirrels-nest.co.uk/product/small-breakfast/
- https://squirrels-nest.co.uk/product/large-breakfast-hamper/

Prepared against GitHub main e9f346a60566fabe832ed4bfb1eba595a3dc2be8, with the prior authorised registration update carried forward. This is a source package only; it has not been uploaded or deployed. Build/deploy commands are unchanged. No database, secrets or Wrangler configuration are included.
