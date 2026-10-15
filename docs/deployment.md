# Architecture and deployment

## Website

`site/` contains the first-party landing page, plans and app downloads, PayPal checkout, customer renewal screens, owner console, web player and PWA assets. React routes and server handlers build with Vinext/Vite for Cloudflare Workers.

The checked-in `.openai/hosting.json` declares the `DB` and `BUCKET` bindings without an existing hosting project identity. The maintained `site/build/` sources are required by the build. Keep them when copying or deploying the site.

Production moved to the independent Cloudflare resources below on October 15, 2026. The complete database, migration history, runtime settings and both Android installers were transferred and verified before the domain switched. The former managed host has no runtime service keys; its APIs are retired and safe legacy links redirect to LumaNest. Its private database remains a recovery copy. A GitHub push alone does not deploy this application.

| Resource | Configuration |
| --- | --- |
| Main website Worker | `lumanest-tv`; production custom domain `lumanest.tv`; `workers.dev` and preview URLs disabled |
| D1 database | `lumanest-tv-production`, ID `226b9f80-d3c9-471d-b5b4-c4a0c17f9e9d`, binding `DB` |
| R2 downloads bucket | `lumanest-tv-downloads`, binding `BUCKET` |
| Portal PWA overlay | Existing `lumanest-app-support` Worker on `portal.lumanest.tv/*` and `tv.lumanest.tv/*` |
| Stream relay | Existing `lumanest-stream-relay` Worker at `streams.lumanest.tv` |

Run the normal build, then `npm run cloudflare:prepare -- --database-id 226b9f80-d3c9-471d-b5b4-c4a0c17f9e9d` from `site/`. This generates a standalone config beside the built server with real resource bindings and no production route. `npm run cloudflare:deploy -- --dry-run` validates it. Runtime secrets/settings are supplied privately and preserved with `--keep-vars`. The `--production` preparation flag is the explicit step that selects the apex custom domain; it does not change portal or relay routes. See [`site/README.md`](../site/README.md#direct-cloudflare-deployment) for staging, cutover, and rollback commands. The framework's original `dist/server/wrangler.json` remains local/managed build configuration with placeholder bindings; use the separate generated `wrangler-cloudflare.json` for direct hosting.

**Routine production deploy** (from `site/`, after the cutover):

```
npm ci
npm run build
npm run cloudflare:prepare -- --database-id 226b9f80-d3c9-471d-b5b4-c4a0c17f9e9d --production
npx wrangler d1 migrations apply lumanest-tv-production --remote --config dist/server/wrangler-cloudflare.json
npm run cloudflare:deploy
```

Always pass `--production` for a live deploy: without it the generated config enables the `workers.dev` address. Apply migrations only when the list shows new files from this checkout. On Windows on ARM, run these with x64 Node 22, because `workerd` has no Windows ARM build.

Existing customer/order records and owner password hashes live in D1. App downloads may live in R2. Neither is included in this repository. Any production data move needs a private backup, restore and verification process. Do not put database exports, payment details or credentials into GitHub.

The approved Android R2 object is `Tuner-1.6.0.apk`, with the size/checksum and custom metadata required by `site/lib/tuner.ts`. Deploy the site change first, then upload the APK from the owner console's Downloads page, which accepts only the file `lib/tuner.ts` names. Android 1.5.3 and 1.5.2 remain archived in R2. LG's IPK ships with the website's public assets. Native applications continue to run on customers' devices; their full first-party sources remain in `apps/` on GitHub.

## Database transfer and migration bookkeeping

Preserve all imported application tables, the source host's `__appgarden_migrations` journal, and its sequence state. A fresh schema is not a substitute for the existing owner password, recurring-billing credentials, order history, or payment deduplication records. Preserve the existing `PLAYER_COOKIE_KEY` and PayPal merchant configuration; changing the encryption key can make stored billing credentials unreadable.

The imported source journal and Wrangler's migration journal are separate formats. Wrangler defaults to a table named `d1_migrations`, with columns `id INTEGER PRIMARY KEY AUTOINCREMENT`, `name TEXT UNIQUE`, and `applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL`. It recognizes an applied migration by the exact SQL filename relative to `migrations_dir`, including `.sql`. Copying `__appgarden_migrations` alone does not tell Wrangler that the initial schema has already run.

All nine existing SQL files, **0000 through 0008**, were compared with the imported schema and source journal, then adopted into `d1_migrations` without executing their SQL again. The original names and execution timestamps were copied from `__appgarden_migrations`, which remains unchanged as migration evidence. Never mark an unverified migration as applied. The generated direct config points `migrations_dir` to the checkout's `drizzle/` directory. Future changes belong in new migration files; do not edit an already-applied baseline.

After adoption, `wrangler d1 migrations list lumanest-tv-production --remote --config dist/server/wrangler-cloudflare.json` from `site/` should report no pending migration for this baseline. Read the stored migration filenames and inspect schema/index definitions to confirm coverage; compare private table counts and copied journal/sequence values without printing customer rows. Do not run `migrations apply` merely to test the transfer. A temporary deployment artifact outside the source checkout may omit `drizzle/`; use a prepared source checkout when managing future migrations.

## Owner access

The live owner console uses LumaNest email/password sign-in at `/manage/login`. Existing owner credentials and recovery information are in the live database. A clean source checkout does not recreate them.

The legacy first-owner bootstrap relies on the managed host's verified identity dispatch. Keep `ADMIN_USER_ID` and `OWNER_SETUP_TOKEN` unset on independent Cloudflare hosting. The standalone entry removes client-supplied `oai-authenticated-*` headers before invoking the application. Privately migrate existing owner credentials instead of enabling a fresh bootstrap or generating a replacement password. Ordinary owner sign-in remains independent of ChatGPT.

## TV provider

The provider maintains customer lines, playlists, channel selection and the hosted customer portal. Its source code is external to this project. The main website calls its API using a private reseller key.

The `lumanest-app-support` Worker adds installable PWA support to the two provider portal domains. Its configuration is in `site/cloudflare/wrangler.jsonc`. Separate Cloudflare redirect rules direct renewals to the first-party website; those rules remain external configuration. The Worker never edits the provider's Content-Security-Policy. If a header or `<meta>` policy would block the injected script, service worker, stylesheet or manifest, it leaves the page unchanged and logs a `pwa_injection_skipped` event naming the blocking directive. The service worker is served at `/sw.js`, whose default maximum scope is already `/`. The portal needs that root scope for its offline fallback across all pages, so the Worker sends no `Service-Worker-Allowed` header.

The `lumanest-stream-relay` Worker supports approved upstream streams through `streams.lumanest.tv`. Its configuration is in `site/cloudflare/stream-relay.wrangler.jsonc`. The main application and relay share a private authentication key, stored as `PLAYER_STREAM_RELAY_KEY` and `STREAM_RELAY_KEY` respectively. Neither key is in Git.

The `STREAM_RELAY_ALLOWED_HOSTS` variable lists the approved provider addresses, as exact public IPv4 addresses and `a.b.c.0/24` networks. Private, loopback, link-local and other reserved ranges are always refused. An invalid list makes the relay answer 503. The main `lumanest-tv` Worker validates relay sources with the same parser, so set the same `STREAM_RELAY_ALLOWED_HOSTS` value on both Workers; when unset, both use the same built-in default. The optional `RELAY_LIMITER` rate limiting binding caps relay requests per Cloudflare location and returns 429 when exceeded. The configuration comments explain the chosen limit.

The checked-in portal/relay configurations omit account IDs; authenticate to the intended LumaNest account and supply `CLOUDFLARE_ACCOUNT_ID` through the deployment environment when maintaining those services. The main preparation script selects the migration account explicitly. Review the generated domain routes and bindings before deploying. Preserve domain registration, email routing and existing provider DNS settings during the website cutover.

## Payments

PayPal order capture, subscription billing and verified webhooks run in server routes. Webhooks are deduplicated by event ID in D1. Records that need review are reconciled from the owner console instead of with manual database edits. Housekeeping runs without cron triggers; see `site/README.md`. The imported baseline must already include `drizzle/0008_chief_barracuda.sql`; do not execute it again on an imported schema. Preserving `lumanest.tv` keeps existing webhook and return URLs. Merchant credentials, webhook registration, product/plan IDs and existing billing agreements remain private runtime state. Automated tests use fixtures and mocked services, without charging a card or spending the reseller wallet.

## TV applications

Android, Tizen and webOS clients are independently built from `apps/`. They use the configured TV service and catalog integrations. Android release signing uses externally supplied key material. Samsung installation requires the appropriate signing identity and TV configuration. Never generate a replacement release key as part of a source migration: it would break update compatibility.

CI validates source and creates development build artifacts. CI does not deploy production, charge customers, install on TVs or obtain private signing keys.

### Pair with your phone

The TV apps set themselves up through `lumanest.tv/pair`, modelled on the OAuth device flow. A TV calls `POST /api/pair/start` and shows the returned QR code and 8-letter code. The customer signs in to the web player on their phone and approves it via `/api/player/pair`. The TV then collects its playlist login once from `POST /api/pair/poll`. Codes expire after 10 minutes. D1 stores only a hash of the TV's device code, and the login stays sealed with `PLAYER_COOKIE_KEY` until the TV collects it, which deletes the row. `/api/pair/*` allows any origin because TV apps are not pages on this site, and it never reads cookies.

The pairing table arrives in migration `0009_device_pairings.sql`. Apply it before deploying the code that uses it: `npx wrangler d1 migrations apply lumanest-tv-production --remote --config dist/server/wrangler-cloudflare.json` from a prepared `site/` checkout.

By default a paired TV receives the same M3U URL the web player loads (`<portal>/m3u?u=…&p=…`). If the TV service exposes an Xtream Codes API, set `TV_APP_XTREAM_SERVER` to its base URL (for example `https://tv.lumanest.tv`; a bare host such as `tv.lumanest.tv` means HTTPS). Paired TVs then use Xtream mode, which adds Movies and Series.
