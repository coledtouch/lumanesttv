# LumaNest TV website

The first-party LumaNest TV application: landing page, app downloads and setup, customer checkout and renewals, optional recurring billing, owner console, and browser player. It uses React, Vinext/Vite, Cloudflare Workers, D1, and R2. The `cloudflare/` directory also contains the customer portal PWA overlay and the authenticated stream relay.

GitHub Actions validates changes without deploying, processing payments, renewing lines, or connecting to production accounts. Direct Cloudflare deployment is an explicit operator action described below. GitHub Pages cannot run this application's server routes, database, or stream proxy.

The customer portal and channel selector at the provider's white-label service are external software. Their proprietary source is not included here. The PWA worker adds installation metadata to that existing service; it does not replace it.

## Install and preview

Run these commands from `site/` with Node.js 24 and npm:

```sh
npm run install:ci
npm run dev
```

The portable preview starts on loopback at port 5173. A clean clone defaults to the portable execution profile, including on Linux. Do not copy `.sites-runtime/` from another checkout. `npm run install:ci` installs the locked development and optional dependencies, including the native test/build runtimes.

On Windows on ARM, use an x64 Node.js process and install dependencies using that same process. Workerd/Miniflare tests require a supported native runtime; the CI workflow uses Ubuntu x64 with Node.js 24. Server-side features also require local bindings and private configuration; public pages can be developed without production credentials.

## Check and build

```sh
npm run typecheck
npm test
npm run build
```

The test runner discovers the TypeScript and JavaScript tests in `tests/` without relying on shell wildcard expansion. Tests use synthetic identities and fake provider/PayPal responses. Runtime tests bundle Workers with esbuild and run them in Miniflare/D1. They do not require production credentials or authorize financial transactions.

The production build writes `dist/client/`, `dist/server/`, and `dist/.openai/`. To preview that built Worker locally:

```sh
npm start
```

`npm start` runs Wrangler locally, keeps disposable data in `.wrangler/state`, and does not deploy. Use the URL it prints. Local authentication/bootstrap helpers simulate a hosting identity only on loopback development requests; they are not a production identity provider.

## Configuration and private state

`.openai/hosting.json` retains the portable `DB` and `BUCKET` binding declarations. No live Sites project ID is included. Vite imports this file and the maintained Sites build plugin copies it into the build, so keep it when building this snapshot.

The following environment variable names describe the runtime contract. Supply real values privately in the target hosting environment or an ignored local configuration file. Never commit environment files, credentials, owner recovery codes, provider playlists, customer exports, database dumps, or signing material.

| Names | Purpose |
| --- | --- |
| `MYBUNNY_API_KEY` | Server-side upstream reseller API access. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID` | PayPal account, environment, and verified payment events. |
| `CHECKOUT_ENABLED` | Explicit gate for customer payment checkout. |
| `TRIALS_ENABLED` | Explicit gate for free 24-hour trial requests (`/trial`): `true` offers them once `MYBUNNY_API_KEY`, `CUSTOMER_PORTAL_URL` and `PLAYER_COOKIE_KEY` are set. Apply migration `0011_trial_requests.sql` first. Each request waits for the owner's approval in `/manage`. See [`docs/trials.md`](../docs/trials.md). |
| `CUSTOMER_PORTAL_URL`, `CUSTOMER_PORTAL_PRIMARY_URL` | Public hub and primary provider connection. |
| `SUPPORT_EMAIL` | Customer support destination displayed by the application. |
| `PLAYER_COOKIE_KEY` | Root secret for player sessions, media tokens, renewal sessions and renewal quotes, and the keyed hashes of trial requesters' emails and networks; requires 64 lowercase hexadecimal characters. Each token type uses its own HKDF-derived AES-GCM key and authenticated purpose label. |
| `PLAYER_ALLOWED_HOSTS`, `PLAYER_ALLOWED_HTTP_HOSTS`, `PLAYER_STREAM_ORIGIN_MAP` | Restricted provider stream origins and optional approved origin aliases. |
| `PLAYER_STREAM_RELAY_URL`, `PLAYER_STREAM_RELAY_KEY` | First-party stream bridge endpoint and shared authentication secret. |
| `STREAM_RELAY_KEY` | Matching shared secret on the separate relay Worker; requires 64 lowercase hexadecimal characters. |
| `CAST_RECEIVER_APP_ID` | Google Cast custom receiver app ID; leave unset to use Google's Default Media Receiver. Set only after the receiver app is published (unpublished apps run only on registered test devices). See [`docs/casting.md`](../docs/casting.md). |
| `TMDB_API_KEY` | TMDB v3 API key or v4 API Read Access Token for the Tuner apps' Movies & Series rows (`/api/catalog/rows`). Leave it unset until LumaNest has TMDB's commercial terms, because the free key is for non-commercial use only. While it is unset, the endpoint answers `source: "none"`. See [`docs/deployment.md`](../docs/deployment.md#movies--series-rows-tmdb). |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Private operator configuration when deploying the standalone Cloudflare workers. |
| `ADMIN_USER_ID` | Legacy hosting-owned bootstrap identity only. Keep unset on a standalone deployment; ordinary owner sign-in uses its private D1 credential record. |
| `OWNER_SETUP_TOKEN` | One-time secret (at least 32 random characters) required by `/manage/setup` to create the first owner login. Without it, first-owner setup is disabled (503). Remove it after setup; it has no effect once owner credentials exist. |

The application expects D1 binding `DB` and R2 binding `BUCKET`. Production D1 contains owner credentials/sessions, order and subscription state, payment deduplication, and rate limits. Its contents are not part of this repository. Recurring PayPal agreements and the merchant catalog are external state as well. Preserve or migrate these privately before a hosting cutover; an empty database is not a working replacement for the current owner account or billing records.

First-time owner setup requires both the original hosting service's trusted bootstrap identity and the `OWNER_SETUP_TOKEN` secret, entered on the setup form. A new standalone deployment still needs a trusted identity source or a private credential migration. Never accept a visitor-supplied identity header as proof of ownership.

## Direct Cloudflare deployment

The main website runs as a Worker with static assets, D1 binding `DB`, and R2 binding `BUCKET`. The Cloudflare preparation step uses the normal production build; it does not modify the managed Sites configuration or create resources. Run from `site/`:

```sh
npm run build
npm run cloudflare:prepare -- --database-id D1_UUID
npm run cloudflare:deploy -- --dry-run
```

Replace `D1_UUID` with the actual destination database ID. The defaults target Worker `lumanest-tv`, database `lumanest-tv-production`, and bucket `lumanest-tv-downloads` in the LumaNest Cloudflare account. Override these with `--worker-name`, `--database-name`, `--bucket-name`, or `--account-id` when preparing. This creates ignored `dist/server/wrangler-cloudflare.json` and `dist/server/cloudflare-entry.mjs` beside the generated Vinext modules. Always build again after source changes, then repeat preparation.

Preparation without `--production` configures a `workers.dev` address and **no production domain or route**. The website is public at that staging address if deployed; owner/customer authentication remains required for private actions. Version preview URLs are disabled. Review the dry run before `npm run cloudflare:deploy`, which publishes that prepared Worker. Deployment uses `--keep-vars` and does not put runtime secrets into source or generated configuration. Transfer existing runtime variables and secrets privately before functional testing. Leave `ADMIN_USER_ID` and `OWNER_SETUP_TOKEN` unset; the standalone entry strips every `oai-authenticated-*` header and preserves the existing password owner login.

Never point production at a fresh, empty database. Transfer the complete existing database privately, including owner credentials, billing and subscription state, webhook/payment deduplication, and migration history. Verify the imported owner record and table counts without exposing customer rows. Preserve `PLAYER_COOKIE_KEY` exactly: stored recurring-billing credentials depend on it. Preserve the PayPal merchant configuration and the stream relay key pairing. Do not apply the schema's initial migrations again to an imported database. The preparation command only selects a database; it does not import data or certify its contents.

Copy the approved Android APK to R2 object `Tuner-1.6.1.apk` with the checksum and version custom metadata required by `lib/tuner.ts` and content type `application/vnd.android.package-archive`. Keep the approved Android version unchanged unless a separate release is authorized. LG's download is part of the static assets. Native app source remains in the GitHub monorepo; Cloudflare hosts their web services and approved download artifacts.

After staging passes, pause checkout/enrollment writes briefly on the old host and allow in-flight payments to settle. Take the final private database snapshot, import and verify it, then prepare the production domain explicitly:

```sh
npm run cloudflare:prepare -- --database-id D1_UUID --production
npm run cloudflare:deploy -- --dry-run
npm run cloudflare:deploy
```

`--production` configures only custom domain `lumanest.tv` and disables `workers.dev`. It does not touch `portal.lumanest.tv`, `tv.lumanest.tv`, or `streams.lumanest.tv`. Preserve their existing Workers and provider configuration. Keeping the apex domain also preserves the PayPal webhook/return URLs. Verify `X-LumaNest-Hosting: cloudflare` on a dynamic page, owner sign-in, customer sign-in, renewal options, Android download integrity, and channel switching before reopening checkout. No recurring agreement or paid checkout should be created just to test hosting. No cron trigger is introduced; existing opportunistic cleanup remains available.

Invocation logs and tracing are disabled because their automatic request URLs can include sealed media tokens or payment identifiers. The pinned Wrangler version does not configure Cloudflare's separate `observability.redact_query_string` API setting. After publishing, set that value to `true` through the Cloudflare Worker settings API while preserving disabled invocation logs/traces, then read the settings back and verify it. Recheck after subsequent deployments; a successful dry run is not proof that this API-only setting was applied. The wrapper logs only a fixed failure tag, never URLs, cookies, request bodies, or raw exceptions. Existing app diagnostic logs remain available; do not add request dumps or enable unredacted URL capture while troubleshooting. Static assets retain their generated cache headers.

Keep the managed deployment, private backup, and prior DNS/domain configuration available for rollback until the new host is verified. A rollback after production writes resume requires reconciling or transferring the newer database state first; routing back to an old snapshot alone can lose payment deduplication and billing changes. Restoring the managed domain route must not alter the provider portal or relay routes. GitHub pushes continue to validate only unless a separate Cloudflare deployment workflow is configured.

## Payment review and housekeeping

The owner console lists orders and auto-renew agreements that need review. **Re-check with PayPal** reads the PayPal order or agreement and continues only safe steps:

- It captures an approved order that was never captured.
- It activates a verified completed capture whose activation was never attempted.
- It syncs and closes agreements.

An order whose provider activation was already attempted is never charged against the wallet again. Check the line, then mark the order resolved with a required note. PayPal webhooks are deduplicated by event ID. Business conflicts during webhook processing are recorded for review and acknowledged so PayPal does not keep retrying them.

Cleanup is idempotent and does not depend on cron triggers. It removes expired owner sessions, rate-limit rows, revoked player sessions, billing locks and webhook IDs older than 30 days. It also closes checkouts and enrollments that stayed in `creating` for over an hour without a PayPal ID. It records free trials past their expiry as ended, and deletes declined and resolved trial requests 30 days after the decision and ended trials 180 days after they ended (see [`docs/trials.md`](../docs/trials.md)). It runs when the review queue or the trial queue loads, from **Run cleanup**, and at most every 15 minutes per isolate alongside `/api/availability`.

## Database schema changes

Edit `db/schema.ts`, then generate migrations:

```sh
npm run db:generate
```

Keep `drizzle/` SQL, snapshots, and its journal together. For a local preview, build first and apply each pending SQL migration in journal order to the local database. For example, the first migration is:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_mature_donald_blake.sql
```

Apply each migration only once to that database. This command does not migrate production. Do not commit local database files.

## Downloads and additional Workers

The LG package is in `public/downloads/`. The approved Android APK is served by `/api/tuner` from R2; the source manifest in `lib/tuner.ts` verifies its version, size, and checksum. The APK object itself is not stored in this website directory. Application sources live in the monorepo's `apps/` directory. Changing a download manifest requires a matching approved artifact.

`cloudflare/wrangler.jsonc` describes the PWA overlay, and `cloudflare/stream-relay.wrangler.jsonc` describes the separate stream relay. Their private account IDs have been removed. Configure deployment ownership privately and preserve the existing domains/routes until a tested cutover. The relay uses Cloudflare's TCP socket runtime; the main Sites application calls it over HTTPS. Its destination and request restrictions are intentional.

The browser PWA caches only public offline assets and icons. Customer pages, channel lists, checkout requests, and media remain network-only. Preserve the cancellation tests and the `enable_request_signal`/`request_signal_passthrough` compatibility settings when maintaining the streaming path.

## Files to preserve

- `build/`: maintained Vinext/Sites integration and its upstream license, not generated output.
- `scripts/build-privacy.mts`: removes private checkout paths from generated diagnostic metadata and rejects remaining build-path leaks.
- `package-lock.json`, `vendor/`, `drizzle/`, and `tests/`: reproducible dependencies, licenses, schema history, and regression coverage.

Keep generated `dist/`, `.next/`, `.vinext/`, `.wrangler/`, `.sites-runtime/`, `node_modules/`, and TypeScript build-info files out of Git. Do not copy the old checkout's Git history, platform credentials, or generated deployment archives into this repository.
