# Tuner website (tunertv.app)

The public website for the **Tuner by LumaNest TV** app, published by **LumaNest TV**. It exists so every app store has a stable home page, privacy policy, terms, support page and data-deletion page for Tuner, separate from the lumanest.tv shop.

- **Address:** `https://tunertv.app` (with `www.tunertv.app` redirecting to it). Short, matches the app's name, and `.app` is HTTPS-only: every browser refuses plain `http://` for it, so there's nothing to misconfigure.
- **Hosting:** a Cloudflare Worker named `tuner-site` that only serves static files. No Worker script, no build step, no JavaScript, no cookies, no analytics, self-hosted fonts.
- **Contact:** `support@lumanest.tv`, set once in `site.config.json`.

| Path | What it is |
| --- | --- |
| `public/index.html` | Home: what Tuner is, supported TVs, setup with a phone, "subscription required, no channels included" |
| `public/privacy.html` | Privacy policy for every Tuner app and this site |
| `public/terms.html` | Terms of use for the app |
| `public/support.html` | Help, FAQ and contact |
| `public/delete.html` | Deleting Tuner's data on each TV, and asking LumaNest TV to delete account data |
| `public/404.html` | Served with a 404 status for any unknown address |
| `public/styles.css` | The only stylesheet; light and dark themes follow the device |
| `public/_headers` | Security headers (Content-Security-Policy, HSTS and others) and caching |
| `public/assets/`, `public/fonts/` | Images resized from `docs/store/`, and the DM Sans and Manrope fonts (SIL Open Font License, licence files included). The TV image is the Samsung and LG app's pairing screen. In the phone image, "Samsung TV" was re-rendered as "LG TV", in the pair page's own font and size, while the Samsung app is unavailable; redo both from fresh captures when convenient. |
| `site.config.json` | Domain, publisher name and support email |
| `tools/site.mjs` | Checks links, anchors, images, the contact email, the sitemap, `wrangler.jsonc` and that the pinned Wrangler and html-validate versions agree; also rewrites the email |
| `wrangler.jsonc` | Cloudflare deployment configuration |

## Which URL goes in which store field

Use these after the [verify step](#5-verify) passes. `https://lumanest.tv/privacy` is not a substitute: it covers the lumanest.tv shop and web player, and says nothing about the TV apps, pairing, what Tuner stores on the TV, or the epgshare01 and iptv-org downloads, so it can't serve as Tuner's privacy policy in any store.

| Store | Field | Value |
| --- | --- | --- |
| Google Play | Store presence → Store settings → Store listing contact details → **Website** | `https://tunertv.app` |
| Google Play | Store listing contact details → **Email** | `support@lumanest.tv` |
| Google Play | Policy → App content → **Privacy policy** | `https://tunertv.app/privacy` |
| Google Play | App content → Data safety → data deletion link (optional; Tuner creates no accounts) | `https://tunertv.app/delete` |
| Apple App Store Connect | App Information → **Privacy Policy URL** | `https://tunertv.app/privacy` |
| Apple App Store Connect | Version page → **Support URL** (required) | `https://tunertv.app/support` |
| Apple App Store Connect | Version page → **Marketing URL** (optional) | `https://tunertv.app` |
| Apple App Store Connect | App Privacy → **User Privacy Choices URL** (optional) | `https://tunertv.app/delete` |
| Amazon Appstore | Privacy policy URL | `https://tunertv.app/privacy` |
| Amazon Appstore | Contact: email / website | `support@lumanest.tv` / `https://tunertv.app/support` |
| Samsung Seller Office | Privacy policy URL | `https://tunertv.app/privacy` |
| Samsung Seller Office | Support email / homepage (field names vary by form) | `support@lumanest.tv` / `https://tunertv.app` |
| LG Seller Lounge | Privacy policy URL | `https://tunertv.app/privacy` |
| LG Seller Lounge | Support email / homepage | `support@lumanest.tv` / `https://tunertv.app` |
| Roku Developer Dashboard | Store info: privacy policy URL | `https://tunertv.app/privacy` |
| Roku Developer Dashboard | Terms of use URL, if asked | `https://tunertv.app/terms` |
| Roku Developer Dashboard | Support email / support URL | `support@lumanest.tv` / `https://tunertv.app/support` |

### Blockers before submitting to any store

- **tunertv.app is live**, and both places that still name `lumanest.tv/privacy` point to `https://tunertv.app/privacy`: `docs/store-listings.md` (Google Play → Privacy policy, and "Public pages that must stay online") and the address the Android store edition shows in Settings (`Edition.PRIVACY_NOTICE` in `apps/android`). The listing, the app and this site must agree before submitting to Google Play or Amazon.
- **Publisher name matches the developer account exactly.** The site names "LumaNest TV" (in `site.config.json`, "Who we are" in `public/privacy.html`, and every footer). A Google Play organization account uses the legal name tied to its D-U-N-S number, and Apple shows the account's legal name as the seller. If that name differs, name the legal entity in "Who we are" (for example "LumaNest TV, operated by …") and consider adding a postal address there.
- **The streaming service provider statements hold.** The policy says LumaNest TV's streaming servers are run by its provider, that video streams use plain HTTP, and that the provider is required to use the data only to serve LumaNest TV and protect it as the policy describes (Apple guideline 5.1.1(i)). Confirm all three with the provider; they also decide the Google Play data safety answers ("shared", "encrypted in transit").

## Owner steps (Windows PowerShell)

You need Node.js (the same one used for `site/`) and the Cloudflare account that runs lumanest.tv. Nothing is installed in this folder: `npx` downloads the exact Wrangler (4.149.0) and html-validate (11.16.1) versions used below on demand. This site pins its own versions, independently of `site/package.json`. To change one, change every `wrangler@…` or `html-validate@…` in this README, `wrangler.jsonc` and `.github/workflows/tuner-site.yml` together; `node tools/site.mjs` fails if they disagree.

### 1. Buy tunertv.app in Cloudflare Registrar

1. Sign in at `https://dash.cloudflare.com` with the LumaNest TV account, the one that runs lumanest.tv.
2. Open **Domains** in the menu and choose to register (buy) a new domain.
3. Search for `tunertv.app`, check the price and complete the purchase. Cloudflare Registrar charges the registry's price with no markup, and registrations aren't refundable, so check the spelling first. Your contact details are redacted from public WHOIS.
4. Registration usually completes in under a minute and sends a confirmation email. The domain then appears in the account with Cloudflare DNS already set up.
5. On the domain's management page, turn **Auto-renew** on. The store listings depend on this address, so it must never lapse.


### 2. Check and deploy the site

From the repository root:

```powershell
cd tuner-site
node tools/site.mjs
npx --yes html-validate@11.16.1 "public/**/*.html"
npx --yes wrangler@4.149.0 login
npx --yes wrangler@4.149.0 whoami
npx --yes wrangler@4.149.0 deploy
```

- `login` opens your browser to allow Wrangler; `whoami` should show the LumaNest TV account. If you belong to several accounts, Wrangler asks which one to use, or set it first with `$env:CLOUDFLARE_ACCOUNT_ID = "<account id>"` (shown on the dashboard's account home).
- `deploy` prints `https://tuner-site.<your-subdomain>.workers.dev`. Open it and look through every page. That copy is marked `noindex`, so search engines skip it.

### 3. Attach tunertv.app and www.tunertv.app

The routes for both names are already on in `wrangler.jsonc`, so the deploy in step 2 attaches them: Wrangler creates the DNS records and certificates. The certificates can take a few minutes.

- If Wrangler says a hostname already has a DNS record, delete that `tunertv.app` or `www` record under the zone's **DNS** → **Records** and deploy again.
- Leave the routes in `wrangler.jsonc`: a deploy without them would detach the domain.

### 4. Redirect www to the main address

Cloudflare's own `_redirects` file can't redirect between hostnames, so this is a zone rule:

1. In the dashboard, open the `tunertv.app` zone → **Rules** → **Redirect Rules** → **Create rule** (or start from the "Redirect from WWW to root" template).
2. Rule name: `www to tunertv.app`.
3. **If incoming requests match:** Wildcard pattern. **Request URL:** `https://www.tunertv.app/*`
4. **Then:** **Target URL:** `https://tunertv.app/${1}`, **Status code:** 301, **Preserve query string:** on.
5. Select **Deploy**.

Also turn on **SSL/TLS** → **Edge Certificates** → **Always Use HTTPS** for the zone (browsers already force HTTPS on `.app`; this covers other clients).

### 5. Verify

Use `curl.exe` (in Windows PowerShell plain `curl` is a different command):

```powershell
curl.exe -sI https://tunertv.app/
curl.exe -sI https://tunertv.app/privacy
curl.exe -sI https://tunertv.app/privacy.html
curl.exe -sI https://www.tunertv.app/support
curl.exe -sI https://tunertv.app/no-such-page
```

Expect, in order:

1. `HTTP/1.1 200` (or `HTTP/2 200`) with a `content-security-policy` header.
2. `200` again.
3. A `307` to `/privacy`.
4. A `301` with `location: https://tunertv.app/support`.
5. `404`.

Then open `https://tunertv.app` on a phone and a computer, in light and dark mode, and follow every link in the footer.

### 6. Keep the site's privacy promise

The privacy policy says this site uses no cookies, analytics or trackers. Keep **Web Analytics**, **Zaraz** and **Bot Fight Mode** off for the `tunertv.app` zone. If you ever turn one on, update "This website" in `public/privacy.html` first.

### 7. Optional: support@tunertv.app

Only if you want a Tuner-branded address. The site uses `support@lumanest.tv` until you change it.

1. Zone `tunertv.app` → **Email** → **Email Routing** → **Get started**.
2. Create the custom address `support` and set its destination to the inbox you read. Cloudflare emails that inbox a link to verify it.
3. Let Cloudflare add the MX and TXT (SPF) records it proposes, then enable routing.
4. Send a test message to `support@tunertv.app` and check it arrives.
5. Point the site at it:

   ```powershell
   # In site.config.json, set "supportEmail": "support@tunertv.app", then:
   node tools/site.mjs set-email
   node tools/site.mjs
   npx --yes wrangler@4.149.0 deploy
   ```

6. Update the email fields in each store.

Email Routing only receives and forwards mail. Replies go out from your own mailbox address unless you also set that mailbox up to send as `support@tunertv.app`.

## Changing the site

1. Edit the files in `public/`. Keep text consistent with `docs/store-listings.md`:
   - The same app name, "Tuner by LumaNest TV", and publisher, "LumaNest TV".
   - The same description.
   - "A LumaNest TV subscription is required. Tuner does not include or sell any channels or content."
   - Nothing about adult content.
2. When the policy, terms or deletion steps change, update their "Last updated" date and the `lastmod` dates in `public/sitemap.xml`.
3. Run the checks, then deploy:

   ```powershell
   node tools/site.mjs
   npx --yes html-validate@11.16.1 "public/**/*.html"
   npx --yes wrangler@4.149.0 deploy
   ```

4. To undo a bad deploy: `npx --yes wrangler@4.149.0 rollback`.

GitHub runs the same checks, plus a Wrangler dry run, for every change under `tuner-site/` (`.github/workflows/tuner-site.yml`). A push never deploys.

### When an app changes, re-check the privacy policy

The privacy policy describes what the apps actually do. Re-read these places when an app's storage or network code changes, and update `public/privacy.html` and `public/delete.html` to match:

| Fact in the policy | Where it comes from |
| --- | --- |
| Android permissions: internet and network status only | `apps/android/app/src/main/AndroidManifest.xml` |
| Android login, settings, favorites, history and passcode storage; a separately saved password encrypted with Android Keystore (plain text if the Keystore fails); playlist links and Continue Watching stream addresses unencrypted | `apps/android/.../data/Prefs.kt` (`writeSources`, `sealPassword`, `saveProgress`), `data/KeystoreCrypto.kt` |
| Deleting a playlist removes only its entry, not its favorites, history or Continue Watching | `data/Prefs.kt` (`deleteSource`) |
| Login-bearing stream addresses in saved catalogues | `data/CatalogSnapshots.kt`, `data/Xtream.kt` (`live`, `movie`, `episode`) |
| No cloud backup; settings (shared preferences) excluded from device transfer, saved catalogues under `filesDir` not; system certificates only | `AndroidManifest.xml` (`allowBackup`), `res/xml/data_extraction_rules.xml`, `res/xml/network_security_config.xml` |
| Android catalogue, guide and image caches; Clear cached data | `data/Repo.kt` (`cacheRoot`, `snapshotRoot`, `clearCache`), `TunerApp.kt` (image cache) |
| Free guide fallback (epgshare01.online), on by default in the lumanest.tv APK and off in the store edition | `data/FreeEpg.kt`, `data/Prefs.kt` (`freeEpgRegions`), `data/Repo.kt` (`loadFreeGuides`) |
| Channel logo list from iptv-org.github.io, refreshed weekly | `data/Repo.kt` (`LOGOS_URL`, `loadLogoIndex`) |
| Phone setup page on the local network: while adding or editing a playlist in the lumanest.tv APK, only while editing in the store edition | `data/PhoneSetup.kt`, `ui/EditSource.kt` (`store && existing == null`) |
| Pairing codes are 8 characters (letters and digits 2 to 9); Android and Roku fetch a new code by themselves, Samsung and LG have a New code button | `site/lib/pairing.ts` (`ALPHABET`), `ui/EditSource.kt` (`LumaNestPairPanel`), `apps/roku/components/MainScene.brs`, `apps/tizen/js/pairing.js` |
| Playback timing notes in the TV's system log only | `player/PlaybackLog.kt` |
| Samsung and LG storage: settings and login, favorites, history, catalogue cache, passcode hash | `apps/tizen/js/data.js` (`createStore`, catalogue cache, `createPasscodeLock`); the LG files are generated from it |
| Samsung and LG network: pairing and the line's server only | `apps/tizen/js/pairing.js`, `apps/tizen/js/data.js` (`createClient`), `apps/tizen/config.xml` |
| Roku storage: login, settings, passcode hash; Pair again; no favorites | `apps/roku/components/MainScene.brs` (registry section `tuner`) |
| Roku network: pairing and the line's server over Roku's certificate bundle | `apps/roku/components/ApiTask.brs` |
| What lumanest.tv stores for a pairing, the hashed (unsalted SHA-256, so pseudonymised) network address, expiry and one-time hand-off | `site/lib/pairing.ts`, `site/lib/player-crypto.ts` (`digest`), `site/db/schema.ts` (`device_pairings`) |
| Expired pairing records are deleted only when a TV next starts pairing (`cleanup()` doesn't touch `device_pairings`) | `site/lib/pairing.ts` (`startPairing`), `site/lib/maintenance.ts` |
| Pairing rate limits and their clean-up | `site/lib/pairing.ts` (`approvalLimit`), `site/lib/maintenance.ts` |
| LumaNest TV video streams are plain-HTTP addresses | `site/cloudflare/lumanest-stream-relay.mjs` (`DEFAULT_ALLOWED_HOSTS`, http only) |
| The line login the TV receives | `site/lib/player.ts` (`tvAccount`) |

The Apple TV app (`apps/tvos`) isn't covered yet. Before it's submitted, add what it stores and sends, and remove "isn't released yet" from the privacy policy, the delete page and the home page.
