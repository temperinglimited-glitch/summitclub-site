# Technical sources

Implementation checked against primary documentation on 9–10 November 2026. Business rates, capacity and policy wording come from the supplied Summit Club page; new guest and hamper prices are explicitly illustrative. The owner/tester email is supplied directly by the owner.

- [Stripe Checkout quickstart](https://docs.stripe.com/checkout/quickstart?lang=node): server-created Checkout Sessions and hosted payment.
- [Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create): REST parameters, inline prices, client references, adaptive pricing and the current `2026-10-28.endive` API version.
- [Manage limited inventory](https://docs.stripe.com/payments/checkout/managing-limited-inventory?ui=full-page): session expiration and releasing protected inventory. Stripe allows session expiry between 30 minutes and 24 hours; this implementation uses one hour and stops creation retries before reaching the minimum window.
- [Fulfil orders after payment](https://docs.stripe.com/checkout/fulfillment?ui=full-page): use verified server-side payment state, with repeatable fulfilment.
- [Stripe webhook endpoint management](https://docs.stripe.com/events/manage-webhook-endpoints): raw request signatures, timestamps, duplicate events and retries.
- [Stripe API idempotency](https://docs.stripe.com/api/idempotent_requests): stable keys for repeated create requests.
- [Stripe CLI](https://docs.stripe.com/stripe-cli/use-cli) and [Stripe testing](https://docs.stripe.com/testing): local webhook forwarding and test cards.
- [Node.js 24 SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html): `DatabaseSync` and consistent backups. Executed locally with Node 24.20.0.
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html): immediate write transactions.
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email): transactional message fields and delivery API.

## Cloudflare deployment

- [Existing repository](https://github.com/temperinglimited-glitch/summitclub-site) and [successful deployment check](https://github.com/temperinglimited-glitch/summitclub-site/runs/64067214691): public evidence identifies the existing Pages project as `summitclub-site`.
- [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/): separate build command and published output directory.
- [Worker build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/): Git-connected Worker build and deployment commands.
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/): static asset binding, custom domain, SQLite migrations, compatibility settings and `keep_vars`.
- [Run Worker before static assets](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/): authentication must precede private asset delivery.
- [SQLite Durable Object API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/): synchronous SQL bindings and cursors, `transactionSync` and recovery. SQL `BEGIN` statements are not used by the Cloudflare adapter.
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): persistent maintenance scheduling. Payment fulfilment and logical email messages remain idempotent.
- [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): validate signature, issuer and application audience using the team's trusted signing keys.
- [Access one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/): approved-email login without a shared site password.
- [Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/) and [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/): whole-host protection and a more-specific server webhook exception.

The application and local tests use built-in Node APIs and small REST adapters, so no npm dependency installation is needed for those commands. Cloudflare deployment additionally uses Wrangler. A connected Stripe test environment, actual Cloudflare runtime verification and a verified sending domain remain required for the final hosted integration test.
