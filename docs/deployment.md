# Architecture and deployment

## Website

`site/` contains the first-party landing page, plans and app downloads, PayPal checkout, customer renewal screens, owner console, web player and PWA assets. React routes and server handlers build with Vinext/Vite for Cloudflare Workers.

The checked-in `.openai/hosting.json` declares the `DB` and `BUCKET` bindings without an existing hosting project identity. The maintained `site/build/` sources are required by the build. Keep them when copying or deploying the site.

The current managed hosting remains the production host. A GitHub push alone does not deploy this application. Continue using the current hosting workflow until a replacement deployment has been configured and verified.

For a separate Cloudflare deployment, create and bind the D1 database and R2 bucket, apply the SQL migrations in order, provision runtime settings through private environment configuration, and configure the application's domain and PayPal webhook. The generated Worker config is not a complete production environment: its local database identifiers and bucket names are placeholders. Configure real bindings in private deployment configuration.

Existing customer/order records and owner password hashes live in D1. App downloads may live in R2. Neither is included in this repository. Any production data move needs a private backup, restore and verification process. Do not put database exports, payment details or credentials into GitHub.

## Owner access

The live owner console uses LumaNest email/password sign-in at `/manage/login`. Existing owner credentials and recovery information are in the live database. A clean source checkout does not recreate them.

The legacy first-owner bootstrap relies on the managed host's verified identity dispatch. A fresh independent deployment must privately migrate the existing owner credentials or implement and test an alternative secure bootstrap before enabling owner access. Do not accept client-supplied identity headers as authentication. Ordinary owner sign-in remains independent of ChatGPT.

## TV provider

The provider maintains customer lines, playlists, channel selection and the hosted customer portal. Its source code is external to this project. The main website calls its API using a private reseller key.

The `lumanest-app-support` Worker adds installable PWA support to the two provider portal domains. Its configuration is in `site/cloudflare/wrangler.jsonc`. Separate Cloudflare redirect rules direct renewals to the first-party website; those rules remain external configuration. The Worker never edits the provider's Content-Security-Policy. If a header or `<meta>` policy would block the injected script, service worker, stylesheet or manifest, it leaves the page unchanged and logs a `pwa_injection_skipped` event naming the blocking directive. The service worker is served at `/sw.js`, whose default maximum scope is already `/`. The portal needs that root scope for its offline fallback across all pages, so the Worker sends no `Service-Worker-Allowed` header.

The `lumanest-stream-relay` Worker supports approved upstream streams through `streams.lumanest.tv`. Its configuration is in `site/cloudflare/stream-relay.wrangler.jsonc`. The main application and relay share a private authentication key, stored as `PLAYER_STREAM_RELAY_KEY` and `STREAM_RELAY_KEY` respectively. Neither key is in Git.

The `STREAM_RELAY_ALLOWED_HOSTS` variable lists the approved provider addresses, as exact public IPv4 addresses and `a.b.c.0/24` networks. Private, loopback, link-local and other reserved ranges are always refused. An invalid list makes the relay answer 503. The main application keeps a matching list in `site/lib/player-relay.ts`; change both together. The optional `RELAY_LIMITER` rate limiting binding caps relay requests per Cloudflare location and returns 429 when exceeded. The configuration comments explain the chosen limit.

The Cloudflare configurations omit account IDs. Authenticate to the intended LumaNest account and supply `CLOUDFLARE_ACCOUNT_ID` through the deployment environment. Review domain routes and bindings before deploying. This source migration does not modify DNS or domain registration.

## Payments

PayPal order capture, subscription billing and verified webhooks run in server routes. Merchant credentials, webhook registration, product/plan IDs and existing billing agreements are runtime state. Keep them in their existing services when adopting this repository. Automated tests use fixtures and mocked services, without charging a card or spending the reseller wallet.

## TV applications

Android, Tizen and webOS clients are independently built from `apps/`. They use the configured TV service and catalog integrations. Android release signing uses externally supplied key material. Samsung installation requires the appropriate signing identity and TV configuration. Never generate a replacement release key as part of a source migration: it would break update compatibility.

CI validates source and creates development build artifacts. CI does not deploy production, charge customers, install on TVs or obtain private signing keys.
