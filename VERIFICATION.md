# Verification

Checked on 9–10 November 2026 with Node.js 24.20.0.

- `npm test`: **59 tests passed; 0 failed**. All 45 previous booking tests still pass after sharing the repository logic between Node and Cloudflare.
- JavaScript source and test syntax checked. No dependency installation is needed for the Node tests or the public/private asset build.
- All local HTML asset references resolve; inline scripts parse; booking, owner and status controls referenced by scripts exist.
- The three replacement photographs are byte-for-byte identical to the final approved JPGs.
- SQLite persistence and the built-in consistent backup were exercised with a temporary disk database.
- Checkout, payment events, retries and email delivery were exercised through the actual request handlers with simulated providers; no real payment or email was made.
- Browser checked at desktop and phone widths: guest form, £30 sofa-bed add-on, four-adult restriction, mandatory sofa selection for two adults and three children, and hidden second-bedroom controls on one-bedroom stays.
- Used the owner browser interface against a temporary local database to open two one-bedroom nights for both lodges at an illustrative test rate. The monthly calendar updated and the guest quote reflected the saved price. These test prices and the temporary database are excluded from the deliverable.
- Tests cover one-bedroom dates closed by default, full-stay eligibility, shared lodge inventory, two-guest capacity, bulk daily-price edits, removing prices, preserved booking totals and upgrades from the previous settings schema.
- Lodge naming update: Lodge 1 — Roscaire and Lodge 2 — Finn. Verified that upgrading placeholder names preserves lodge identifiers, rates and owner-customised names; the full 45-test suite still passes.

Cloudflare preparation checked on 10 November:

- Owner and initial tester are `summit.club.ni@gmail.com`; the earlier mistyped address is not configured.
- Tests sign and verify real RSA JWTs. Missing, altered, expired, premature, wrong-issuer and wrong-audience tokens fail closed; unapproved emails and untrusted team domains are rejected.
- Every private asset and booking API requires verified login. Owner APIs and dashboard routes reject non-owner testers. The gateway supplies the owner credential internally without exposing it to browser responses.
- Only the exact POST webhook endpoint has an interactive-login exception. Its raw body reaches the existing signature verifier. Invalid signatures are rejected.
- Live payment mode and live Stripe keys are refused on the test Worker.
- The Cloudflare-shaped SQL adapter was tested against an in-memory Node SQLite fixture, including atomic rollback, shared lodge inventory, racing checkout requests, persistence across store instances and alarm-driven reconciliation. This fixture is not the deployed Cloudflare runtime.
- A signed owner token was exercised through the gateway into the real booking handler to save one-bedroom rates. An unauthorised request to the same owner API was refused.
- `npm run build:cloudflare` succeeds. Public output contains no booking form, booking script or owner page; private output includes the full application. Static assets are configured to run through the Worker first, and alternate Worker hostnames are rejected.

Still to verify in the deployment environment: Wrangler bundling and the actual Cloudflare Worker runtime, account bindings, DNS, Access email-code login and webhook exception, a connected Stripe test checkout and signed webhook round trip, email-domain verification, actual email delivery and deployment-specific browser behaviour. Wrangler was not installed in the preparation environment. No changes have been deployed to GitHub or Cloudflare. Payments are disabled in the supplied configuration and draft prices are not approved. One-bedroom dates begin closed until the owner opens and prices them.
