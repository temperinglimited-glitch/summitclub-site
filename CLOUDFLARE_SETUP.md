# Summit Club: public website and private booking test

Prepared on 10 November 2026. The initial owner and approved tester is **summit.club.ni@gmail.com**.

This package is prepared for deployment; it has not been uploaded to GitHub or activated in your Cloudflare account. Payments and email delivery start switched off. Cloudflare account access and your Stripe test credentials are still required.

## What goes where

| Address | Service | Who can use it |
| --- | --- | --- |
| `https://summitclub.co` | Existing Cloudflare Pages project, `summitclub-site` | Everyone; booking buttons say “Bookings opening soon” |
| `https://test.summitclub.co` | New Worker, `summitclub-booking-test` | Approved email addresses after Cloudflare Access login |
| `https://test.summitclub.co/admin.html` | Owner calendar and booking dashboard | Only `summit.club.ni@gmail.com` |
| `https://test.summitclub.co/api/stripe/webhook` | Signed Stripe notification endpoint | Stripe can POST without interactive login; signatures and payment mode are checked |

Your [GitHub repository](https://github.com/temperinglimited-glitch/summitclub-site) is the source store. Its deployment check identifies Cloudflare Pages as the existing host. Keep that public Pages project and its current domain connection. Add a separate private Worker for booking tests; no move of the main domain is needed.

The Worker stores booking records in a SQLite-backed Durable Object. This is separate from the optional local Node database. It starts fresh; local test bookings are not imported or uploaded automatically. One-bedroom dates begin closed until you open and price them in the owner screen.

## 1. Prepare the source and public website

Use Node.js 24 LTS, version 24.13 or later within the 24 series. From this unzipped project folder run:

```sh
npm test
npm run build:cloudflare
```

No third-party packages are required for those commands. The build produces two folders: `dist/public` for Pages, and `dist/test` for the private Worker. Both include the updated image files. The public output excludes the booking form, booking scripts and owner dashboard.

In the existing Cloudflare Pages project's build settings set:

| Setting | Value |
| --- | --- |
| Repository | `temperinglimited-glitch/summitclub-site` |
| Production branch | `main` |
| Root directory | Repository root |
| Framework preset | None |
| Build command | `npm run build:cloudflare` |
| Build output directory | `dist/public` |
| Build environment variable | `NODE_VERSION=24.20.0` |

Set these before deploying the new source, so Pages serves only the generated public folder. If making changes through GitHub, upload the **contents of this project folder** into the repository root in one commit, preserving subfolders. Do not upload the ZIP itself or add an extra enclosing project folder. A Git client is the easiest way to include the supplied `.gitignore` and configuration templates.

Keep all real `.env`, `.dev.vars`, database files, backups and private keys off GitHub. The supplied `.env.example` and `.dev.vars.example` contain no credentials. The generated `dist` folder is rebuilt by Cloudflare and need not be committed. The old root `index.html`, `styles.css` and `README.txt` are no longer the published output once Pages uses `dist/public`; they can be removed in the same update if desired.

After deployment, check the main site and its Pages preview address. Both should show the public brochure with “Bookings opening soon”, and neither should expose an owner dashboard or functional booking form.

## 2. Configure the email login

In Cloudflare Zero Trust, enable the **One-time PIN** login method. Then create a **Self-hosted** Access application:

| Setting | Value |
| --- | --- |
| Name | Summit Club booking test |
| Domain | `test.summitclub.co` |
| Path | Blank: protect the whole hostname |
| Policy action | Allow |
| Include rule | Emails: `summit.club.ni@gmail.com` |
| Login method | One-time PIN |
| Session length | For example, 1 hour |

Do not add an Everyone allow rule to this application. Copy the application's **AUD tag** and your Zero Trust **team domain**. The team domain has the form `https://YOUR-TEAM.cloudflareaccess.com`; it is not `test.summitclub.co`.

Create a second, more specific Self-hosted application for the exact path **`test.summitclub.co/api/stripe/webhook`**, with a **Bypass** policy including Everyone. This exception lets Stripe deliver server notifications without receiving an email-login page. It must cover only that webhook path. The Worker independently allows the login exception only for an exact POST to `/api/stripe/webhook`; Stripe signatures remain mandatory.

See [Cloudflare's OTP guide](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) and [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/). Save the whole-host application AUD, not the webhook application's AUD.

## 3. Deploy the private Worker

The supplied `wrangler.test.jsonc` creates the Worker, private static assets, `test.summitclub.co` custom domain and SQLite Durable Object binding. It disables `workers.dev` and preview URLs. Every asset and API request passes through login verification before it is served; the Worker also checks the signed Access token and approved email list itself.

Deploy into the Cloudflare account that manages `summitclub.co`. Do not assign the main domain to this Worker. You can connect the same GitHub repository to a new Worker with these build settings:

| Setting | Value |
| --- | --- |
| Worker name | `summitclub-booking-test` |
| Root directory | Repository root |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npx wrangler deploy --config wrangler.test.jsonc` |
| Build environment variable | `NODE_VERSION=24.20.0` |

Alternatively, from Terminal in this project folder:

```sh
npx wrangler login
npm run build:cloudflare
npx wrangler deploy --config wrangler.test.jsonc
```

Wrangler is Cloudflare's deployment tool; `npx` downloads it if needed. Follow the Cloudflare sign-in in your own browser. A deployment with missing Access settings returns an unavailable response rather than exposing the booking application.

In the Worker's **Settings → Variables and Secrets**, add these text variables:

| Name | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Your full HTTPS Zero Trust team domain |
| `ACCESS_AUD` | AUD tag of the whole-host booking test application |

These two values are account-specific and are deliberately absent from the source configuration. `keep_vars` preserves Dashboard variables on redeployment. The other starting variables, including the corrected owner email, are declared in `wrangler.test.jsonc`; keep changes to those in that file.

Generate two separate random values by running `npm run admin-token` twice. Add the first as an encrypted Worker secret named `ADMIN_TOKEN` and the second as `RECEIPT_SECRET`. Keep them in a password manager. They must each be at least 32 characters and remain stable across deployments. The owner does not type the internal administrator secret into the hosted dashboard: the verified owner email grants access.

If using the CLI, these commands prompt for the values without putting them in command history:

```sh
npx wrangler secret put ADMIN_TOKEN --config wrangler.test.jsonc
npx wrangler secret put RECEIPT_SECRET --config wrangler.test.jsonc
```

Complete any pending variable/secret deployment in the Dashboard. Then visit `https://test.summitclub.co`, request a login code for **summit.club.ni@gmail.com**, and sign in. Open `/admin.html` to review settings and change daily prices. Payments remain disabled at this stage.

## 4. Enable Stripe testing

Use a Stripe test environment. Add these encrypted Worker secrets:

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe test secret API key, starting `sk_test_` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the hosted endpoint, starting `whsec_` |

Create the Stripe webhook destination **`https://test.summitclub.co/api/stripe/webhook`** in the same test environment. Subscribe to:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

The hosted endpoint secret is different from a local Stripe CLI forwarding secret. Set `PAYMENTS_MODE` to `test` in `wrangler.test.jsonc` and redeploy the Worker. Keep the public Pages output as `dist/public`. Do not put Stripe secrets into HTML, browser JavaScript, build variables or GitHub.

This Worker explicitly refuses live mode and live Stripe keys, including accidental live keys while payments are off. Test cards cannot take real money. Use the official [Stripe test card instructions](https://docs.stripe.com/testing).

## 5. Confirmation emails, when ready

Email delivery initially remains off. To test it, verify a sending domain with Resend, add `RESEND_API_KEY` as an encrypted Worker secret, and add `EMAIL_FROM` as a Worker text variable, for example `Summit Club <bookings@YOUR-VERIFIED-DOMAIN>`. The owner notifications go to **summit.club.ni@gmail.com**.

Set `EMAIL_DELIVERY` to `on` in `wrangler.test.jsonc` and redeploy. Use controlled guest email addresses for every test: turning delivery on sends queued pending messages as well as new messages. Test confirmations have `[TEST]` in the subject. No emails have been sent during preparation of this package.

## 6. Prove the restriction and booking flow

Complete these checks on the actual hosted addresses:

1. In a private browser window, the main website opens publicly and has no active booking form.
2. The test address asks for email login. An unapproved email cannot enter. The owner receives a code at the corrected Gmail address.
3. The signed-in owner can open the daily price calendar. Open a short one-bedroom offer, save its nightly price and confirm the guest quote uses it. The second bedroom should be marked closed for that offer.
4. Add an approved tester as described below. They can test a booking but cannot use `/admin.html` or `/api/admin/settings`.
5. Complete a Stripe test checkout and return to the site. Verify the signed webhook succeeds, the booking becomes confirmed, the lodge nights are blocked and the total matches the quote. Test a failed or abandoned checkout too.
6. Verify the four-adult restriction, children-only £30 sofa choice, two-adults/three-children sofa requirement and separate lodge availability.
7. Test on a phone, and check confirmation delivery after email is configured. Dashboard or successful return-page navigation alone is not evidence of a complete payment integration.

If the test site shows 503, check the team domain, AUD, Worker secrets and Durable Object binding. A 403 may mean the address/email is not approved or the Access token is invalid. A Stripe webhook redirected to a login page means the more-specific webhook Access exception needs correcting. Do not loosen the whole-host allow policy to fix a webhook.

## Add or remove testers

Add each exact email to **both** the whole-host Cloudflare Access Allow policy and the comma-separated `TESTER_EMAILS` value in `wrangler.test.jsonc`, then redeploy the Worker. Only `OWNER_EMAIL` can use owner controls; adding a tester does not make them an administrator.

To revoke access, remove the email from both places, deploy the Worker change and revoke that user's Access sessions. Removing only the edge Allow rule may leave an existing session valid until expiry. Never include passwords or secret invitation links in the public source.

## Data, updates and eventual launch

Keep the Worker name, Durable Object migration and the stable storage key in source unchanged when deploying updates. The test database persists separately from static assets. Durable alarms recheck pending payments and retry enabled email delivery. Monitor errors and reconcile any unresolved payment in Stripe before releasing dates.

Use Cloudflare's [SQLite Durable Object recovery guidance](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) for this hosted database. The Node-only `npm run backup` command backs up a local Node SQLite file; it does **not** back up this hosted Durable Object. Arrange and verify recovery before taking real bookings. There is no Airbnb or Booking.com availability synchronisation in this package.

Going live is a separate deployment step. This private test Worker cannot accept real payments. A live service needs a separate database and live environment, approved pricing and policy pages, verified confirmation delivery, real Stripe credentials and a complete hosted checkout/webhook test. Keep public booking disabled until that work is complete.

## What has been verified

All **59 automated tests** pass on Node.js 24.20.0. They include real RSA signature verification of test Access tokens, rejection of unlisted identities and live keys, owner-only APIs, signed-webhook handling, simultaneous booking protection, durable-storage adapter transactions and public/private build separation. Payment and mail providers were simulated.

Wrangler and the actual Cloudflare runtime were not available for execution in the preparation environment. The Worker bundle, account bindings, DNS, email-code login, Stripe test round trip and email delivery must therefore be verified during deployment. The setup above is not a claim that access protection is already active on your domain.

See `README.md` for booking behaviour and the alternative local Node workflow; `SOURCES.md` lists the primary technical references.
