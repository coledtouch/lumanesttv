# Store listings: Google Play, Fire TV, Samsung, LG and Roku

Ready-to-paste listing text, the artwork in [`docs/store/`](store/), and a submission checklist for each store. The same app ("Tuner by LumaNest TV") ships in every store; only the package differs. On Android, Google Play and the Amazon Appstore get the **store edition** (built with `-Pstore=true`, see [Android store edition](#android-store-edition-google-play-and-amazon)); the lumanest.tv download stays the direct APK.

## Before you submit anywhere

1. **Content rights.** Every store reviews streaming apps for piracy. Tuner contains no channels itself, but its purpose is to play LumaNest TV subscriptions. Reviewers can ask you to show that LumaNest TV is licensed to distribute the channels it sells. Have that answer ready before submitting. Without it, expect rejection and, on some stores, removal of the developer account.
2. **A reviewer line.** Create a free line in your reseller panel just for reviewers, with no expiry date. Google Play requires reviewer logins that never expire, and every update is reviewed again, so a lapsed line gets a later update rejected. If the panel can't make a line without an expiry date, renew it before every submission. Keep adult categories off it. Give its username and password only in each store's private "notes to reviewer" field. Never put them in public listing text, and never in this repository.
3. **Public pages that must stay online:** the Tuner website at `https://tunertv.app` (source in [`tuner-site/`](../tuner-site/)): `https://tunertv.app/privacy` (privacy policy), `https://tunertv.app/terms` (terms), `https://tunertv.app/support` (support and setup), `https://tunertv.app/delete` (deleting your data), and the support email `support@tunertv.app` (Cloudflare Email Routing forwards it). [`tuner-site/README.md`](../tuner-site/README.md) lists which URL goes in which field of each store.
4. **A privacy policy that covers the TV apps.** `https://tunertv.app/privacy` describes each app's own data handling (pairing, what is stored on the TV, what is sent where, no ads or analytics), as Google Play's User Data policy and Amazon's review require; `lumanest.tv/privacy` covers only the website, so don't use it for the apps. Keep the Data safety answers below in line with it, and update both before shipping a change in what an app stores or sends (the Apple TV app is added before its submission).
5. **Screenshots from a real TV.** [`docs/store/`](store/) has the pairing and Settings screens. Stores also want playback screens: take 2 or 3 from your TV with the reviewer line, on a channel or film whose artwork you're allowed to show.

## Shared listing text

**App name:** Tuner by LumaNest TV

**Short description (80 characters):**
Watch your LumaNest TV live channels, movies and series. Set up with your phone.

**Long description:**
> Tuner is the TV app for LumaNest TV subscribers. Watch your live channels with a full TV guide, and browse movies and series, all from your sofa.
>
> Setup takes seconds. Open Tuner, scan the code on screen with your phone, sign in to your LumaNest TV account and tap Connect my TV. There's no typing with the remote.
>
> • Live TV with an on-screen guide, Favorites and Most Watched
> • Movies and series with episode lists
> • Choose your channels and categories in your LumaNest TV customer hub; Tuner shows exactly your lineup
> • One-press "USA channels only" filter and category sorting (Featured, your hub's order, or A to Z)
> • Your phone pairs the TV, so your login never has to be typed
>
> A LumaNest TV subscription is required. Tuner does not include or sell any channels or content. Plans and setup help: lumanest.tv

**Keywords:** live TV, TV guide, streaming, movies, series, LumaNest

**Category:** Entertainment (Roku: Movies & TV)

**Content rating:** rate for the most mature content a line can carry. Most stores' questionnaires reach "Teen" or "Mature" for unfiltered live TV. Answer truthfully. Tuner itself has no ads, purchases or chat.

**In-app purchases:** none. Subscriptions are sold on lumanest.tv, not in the app.

**Privacy summary for data-safety forms:**
- **Data on the TV:** the line login (stored on the TV), favorites and settings.
- **Data the app sends:** pairing requests go to lumanest.tv, and channel and catalogue requests go to the LumaNest TV service.
- **Not used:** no advertising IDs, analytics, location or contacts.

**Notes to reviewer (adjust and paste; the login goes only in the private reviewer field):**
> Tuner plays a LumaNest TV subscription. To test, open the app and either scan the QR code with a phone and approve at lumanest.tv/pair using the reviewer line below, or add the playlist manually in Settings with the server and login below. The line includes live channels, movies and series.

## Android store edition (Google Play and Amazon)

Google Play and the Amazon Appstore get the **store edition** of the Android app. It is the same app, package (`tv.lumanest.tuner`), version and signing key as the lumanest.tv APK, built with `-Pstore=true`. It differs only where store reviewers require it:

- **Adult content:** adult categories are always hidden. There is no unlock, passcode or "XXX" text in Settings. Channels and titles with adult names are hidden too, wherever they're listed, and more category spellings are caught (+18, 18 Plus, Adultos, Porno, Erotic).
- **Picture-in-picture:** not offered. Google's TV rules don't allow it for video apps, or starting it automatically on Home.
- **Devices:** Android TV only. Google Play doesn't offer it to phones or tablets.
- **Wording:** "Server login" and "Playlist link" instead of "Xtream Codes" and "M3U", no user-agent field, generic remote help (no onn or Google TV references), and the privacy policy address in Settings.
- **Guide:** the free guide fallback starts off and lists country guides only.
- **Trending:** an optional Trending playlist (Settings) only highlights channels already in the lineup, so it can't bring back a hidden adult channel under another name.
- **Later features:** keep brand-named rows (Netflix, Disney+, Max and other streaming services, as planned in [`deployment.md`](deployment.md)) out of the store edition, and show TMDB's attribution wherever TMDB data appears.

Build it on Windows from `apps/android` (PowerShell):

| For | Command | Upload this file |
|---|---|---|
| Google Play | `.\gradlew.bat bundleRelease -Pstore=true` | `app\build\outputs\bundle\release\app-store-release.aab` |
| Amazon Appstore | `.\gradlew.bat assembleRelease -Pstore=true` | `app\build\outputs\apk\release\app-store-release.apk` |
| lumanest.tv download (unchanged) | `.\gradlew.bat assembleRelease` | `app\build\outputs\apk\release\app-release.apk` |

All three are signed with the existing release key when `TUNER_SIGNING_DIR` (or `-PtunerSigningProperties`) points at it, exactly like today's APK. Without the key, the APKs end in `-unsigned.apk` and the AAB is unsigned; stores reject unsigned files. Store files have their own names, so they can't be mistaken for the lumanest.tv APK. Each `assembleRelease` replaces the APK from the previous one, so upload or copy one APK before building the other. `.\gradlew.bat bundleRelease` without `-Pstore=true` stops with an error, so the direct edition can't reach Google Play by mistake.

Because both editions share the package and key, each can update the other in place. A customer who moves from the lumanest.tv APK to Google Play keeps the pairing, Favorites and settings, but loses picture-in-picture and any adult unlock; moving back to the lumanest.tv APK brings both back.

**Decide before the first Google Play upload: may Google Play update lumanest.tv installs?** Google Play treats an app installed from lumanest.tv as its own when the package and key match. As soon as Google Play publishes a higher `versionCode` than the one on a Google TV, it offers that TV the update, usually installing it automatically. With one rising `versionCode` for both editions, every lumanest.tv install on a TV with Google Play therefore becomes the store edition at the next Google Play release, without the customer choosing it: adult categories lock for good and picture-in-picture disappears. Each later Google Play release does the same to anyone who went back to the lumanest.tv APK. Fire TV is not affected (no Google Play), and Amazon only updates its own installs. Choose one:

- **Accept it:** Google Play takes over lumanest.tv installs on Google TV. Tell customers before the first Google Play release, and point those who want adult categories or picture-in-picture to a TV without Google Play or to turning off auto-update for Tuner in Google Play.
- **Keep the lumanest.tv APK ahead:** give the lumanest.tv APK a `versionCode` that is always higher than anything uploaded to Google Play (for example 1,000,000 plus the release number, while Google Play uploads count up from 19). Google Play then never updates a lumanest.tv install, and the lumanest.tv APK can still replace a Google Play install. This needs a change to how `versionCode` is set in `apps/android/app/build.gradle.kts`, made before the first Google Play upload; this branch doesn't change it.

## Google Play (Android TV)

- **Account:** Google Play Console, at play.google.com/console. One-time fee of US$25, plus a government ID and a payment card in the account holder's name.
  - Choose an **Organization** account for LumaNest TV. It needs a D-U-N-S number, which is free but can take up to 30 days to issue.
  - A **Personal** account created after 13 November 2023 must first run a closed test with at least 12 testers, opted in for 14 days in a row, then apply for production access. For a TV-only app every tester needs a Google TV or Android TV device. New personal accounts must also confirm access to an Android phone (Android 10 or later) in the Play Console app. Organization accounts skip both.
- **Package:** the store edition App Bundle, `app-store-release.aab` (see [Android store edition](#android-store-edition-google-play-and-amazon)). Google Play takes only App Bundles for new apps, and requires them for TV apps.
  - **Target API level:** Tuner targets Android 15 (API 35). Since 31 August 2026 Google Play asks phone apps for API 36, but Android TV apps for API 34 only, and the store edition is TV-only (it requires `android.software.leanback`). Raise the target before ever offering it to phones. The minimum stays Android 6.0.
  - **Version codes:** Play rejects a code it has already seen, so raise it before every upload. Whether Google Play and lumanest.tv share one rising code depends on the decision in [Android store edition](#android-store-edition-google-play-and-amazon).
- **Play App Signing: use the existing key.** Decide this before the first upload, including internal testing. It can't be changed afterwards.
  1. When Play Console asks how to sign the app, choose your own key: **Export and upload a key from Java keystore** (the PEPK tool). Upload the **existing** Tuner release key, the one in `TUNER_SIGNING_DIR`. Never let Google generate a new key.
  2. In Play Console, open **App integrity → Play app signing**. The app signing key certificate's SHA-256 fingerprint must be `EC:6F:ED:26:F3:B6:88:C4:6A:CB:1A:55:2B:D0:B9:EE:8C:E8:C9:62:BA:B4:DB:74:51:DF:3F:35:A3:95:45:86` (the one in `apps/android/README.md`).
  3. An upload key is optional. Without one, you sign uploads with the same existing key, so the build command above is all you need. If you want a separate upload key, create it yourself, outside this repository, and build with `-PtunerSigningProperties=<its keystore.properties>`.
  - **Why the existing key:** Android installs an update only when it's signed with the same key as the installed app. With the existing key, Google Play and lumanest.tv installs update each other, so customers keep their pairing, Favorites and settings when they switch. With a key Google generates, switching means uninstalling and setting up again, and that can never be fixed.
  - **Never use key upgrade** later. Play would sign new installs with a new key, and the lumanest.tv APK could no longer update them.
  - **Leave automatic protection off** (App integrity). It tells people who installed from lumanest.tv to get the app from Google Play instead.
  - Apps using Play App Signing are registered for Android developer verification automatically, which also covers the lumanest.tv APK (same package and key). Check the Play Console home page for the registration task.
- **Android TV form factor:** Test and release → Advanced settings → Form factors → Add form factor → Android TV, then opt in. When asked where to release, keep the main tracks (the same tracks as phones): the bundle is TV-only anyway, and Google says a dedicated Android TV track can't be switched back afterwards. Upload the TV banner and TV screenshots first. Opting in starts Google's TV quality review; the status shows Pending, Approved or Not approved. Mention Android TV in the full description.
- **Assets:**
  - **App icon:** [`icon-512.png`](store/icon-512.png) (512×512, 32-bit PNG).
  - **Feature graphic:** [`feature-graphic-1024x500.png`](store/feature-graphic-1024x500.png) (1024×500, no transparency). Required.
  - **TV banner:** [`banner-1280x720.png`](store/banner-1280x720.png) (1280×720). Required for Android TV.
  - **TV screenshots:** at least 2 and up to 8, 1920×1080 (Google Play needs 2 screenshots in total to publish, and there are no phone screenshots), unedited captures of the store edition on a TV (`adb exec-out screencap -p > shot.png`). Use the reviewer line, on channels and films whose names and artwork you may show. Don't use `screenshot-1-pair-tv.png` or `screenshot-2-settings.png`: they show the Samsung and LG app, not Android.
  - **Phone screenshots:** not needed, because the store edition doesn't install on phones. If Play Console refuses to save the listing without them, stop and check before adding any: a phone screenshot of a TV app misrepresents it.
- **Listing text:** the shared text above, with these changes:
  - End the long description with "Made for Android TV and Google TV. A LumaNest TV subscription is required. Tuner does not include or sell any channels or content. Help: support@tunertv.app". Google Play doesn't allow the listing to point to purchases outside Play, so "Plans" comes out, and so does lumanest.tv/apps: it sells plans and offers the lumanest.tv APK.
  - Keep channel, network, league and brand names out of the title, descriptions and screenshots.
  - Title: "Tuner by LumaNest TV" (20 of 30 characters). Short description: the shared one (80 of 80). Category: Entertainment.
- **App content forms** (Policy → App content):
  - **Privacy policy:** `https://tunertv.app/privacy`. The store edition also shows this address in Settings (a "Privacy policy" row), which Google requires.
  - **App access:** "All or some functionality is restricted". Give the reviewer line and the steps in the notes below. The login must not expire, must work from any country, and must be in English. Google doesn't accept a QR code as the only way to sign in, so always include the manual login.
  - **Ads:** no ads. **Advertising ID:** not used. **Financial features:** none. **Government app:** no. **News app:** no. **Health:** none.
  - **Content rating (IARC):** answer for what a LumaNest line can show in the store edition, and answer accurately; a wrong answer can get the app removed. Unfiltered live TV usually rates Teen or Mature.
  - **Target audience:** 18 and over only. That keeps the app out of Google's Families rules.
  - **Data safety:**
    - **Collected:** User IDs (the line username sent to the LumaNest TV service), for app functionality and account management. Add App activity if the LumaNest TV service records what people watch.
    - **Shared:** if the line's server isn't run by LumaNest TV, the login and viewing requests go to that company: declare it as shared.
    - **Encrypted in transit:** No, unless every line uses https. Provider servers often use plain http, and the app allows it.
    - **Not collected:** Favorites, settings and watch history stay on the TV.
    - **Other services the app contacts:** iptv-org on GitHub for channel logos, the poster and logo addresses in the line's own data, and epgshare01 only if the customer turns on the free guide fallback.
    - **Account deletion:** choose that the app doesn't let people create accounts. Accounts are made on lumanest.tv.
- **Notes to reviewer** (paste in App access; the login goes only there):
  > Tuner by LumaNest TV is the Android TV app for LumaNest TV subscribers and contains no content of its own. To sign in, open the app. On the "Add a playlist" screen, select "Server login", enter the server URL, username and password below, then select "Save and connect". Alternatively, scan the QR code with a phone and approve it at lumanest.tv/pair with the same account. The line includes live channels, movies and series.
- **What Google checks** (the TV quality review):
  - The D-pad reaches everything, and nothing needs a Menu button.
  - Back on the home screen leaves the app.
  - Playback pauses or stops when you leave the app, and the screen stays awake only while playing.
  - No picture-in-picture for video, and the app never opens a web browser.
- **Policies most likely to block the app:**
  - **Intellectual property:** the biggest risk. Google rejects apps when it believes the content they play is unlicensed, and repeated or serious violations can close the developer account and any related accounts. Have the content-rights answer from [Before you submit anywhere](#before-you-submit-anywhere) ready. If you have written permission from rights holders, send it to Google before submitting (the intellectual property "advance notice" form).
  - **Sexual content:** the store edition never shows adult categories. Keep adult channels off the reviewer line too.
  - **Misleading claims:** don't suggest that channels are included, and don't name channels, networks or leagues.
  - **Payments:** nothing is sold in the app, and the app itself names only tunertv.app/privacy. But lumanest.tv/pair, where the QR code leads, currently shows the site header with "Plans" and "Renew", and lumanest.tv/apps sells plans and offers the lumanest.tv APK with Downloader steps. That can count as steering to outside payments, and as promoting a build that isn't on Google Play. Open task before submitting: remove the Plans and Renew links (and any buy buttons) from lumanest.tv/pair, and don't use lumanest.tv/apps as the help or support address anywhere in the Google Play listing.
- **Open owner tasks before the first submission:**
  - The content-rights answer and a reviewer line with no expiry date (see [Before you submit anywhere](#before-you-submit-anywhere)).
  - The TV apps section in the privacy policy.
  - lumanest.tv/pair without Plans, Renew or buy links.
  - The decision on whether Google Play may update lumanest.tv installs (see [Android store edition](#android-store-edition-google-play-and-amazon)).
- **Steps:**
  1. Create and verify the developer account (Organization).
  2. Create the app: name "Tuner by LumaNest TV", type App, Free.
  3. Set up Play App Signing with the existing key, before uploading anything.
  4. Build the store edition AAB and upload it to an **Internal testing** release. Check the update behaviour you chose on a Google TV that has the lumanest.tv APK installed. If Google Play may take over lumanest.tv installs, installing from Google Play should update in place and keep the pairing (Google Play only updates an install whose `versionCode` is lower than the upload). If the lumanest.tv APK stays ahead, Google Play should offer no update, and on a TV that got Tuner from Google Play, the lumanest.tv APK should install over it and keep the pairing.
  5. Fill in the store listing, assets and App content forms.
  6. Opt in to the Android TV form factor.
  7. Personal accounts only: run the closed test (12 testers, 14 days), then apply for production access.
  8. Create a **Production** release with the same AAB and send it for review. The first review, with the TV quality review, can take a week or more.

## Amazon Fire TV (Amazon Appstore)

- **Account:** Amazon Developer, at developer.amazon.com. It's free.
- **Package:** the store edition APK, `app-store-release.apk` (see [Android store edition](#android-store-edition-google-play-and-amazon)). Don't upload the lumanest.tv download: Amazon also bans adult content and rejects apps that mention other platforms, such as Google TV. Use the same version name as the lumanest.tv download, and the same `versionCode` as the Google Play upload.
- **Signing:** Amazon may re-sign the APK with its own key; the upload page shows the "Appstore certificate hashes". If they don't match the Tuner fingerprint in `apps/android/README.md`, Amazon installs and lumanest.tv installs can't update each other, and a customer switching between them has to uninstall first.
- **Device targeting:** select every Fire TV model. Keep phones and tablets off. The store edition requires Android TV support (`android.software.leanback`), which keeps Google Play from offering it to phones. After uploading, check that Amazon lists your Fire TV models as supported; if it marks them unsupported, don't submit. Fire TV models running Vega OS can't run Android apps at all.
- **Assets:**
  - **App icons:** [`icon-512.png`](store/icon-512.png) (512×512) and [`icon-114.png`](store/icon-114.png) (114×114).
  - **Fire TV app banner:** [`banner-1280x720.png`](store/banner-1280x720.png) (1280×720).
  - **Background image (optional):** [`background-1920x1080.png`](store/background-1920x1080.png).
  - **Screenshots:** 3 to 10 at 1920×1080, captured from the store edition on a Fire TV. The Samsung and LG screenshots in `docs/store/` show a different app.
- **What Amazon checks:**
  - The D-pad reaches everything.
  - Back exits from the home screen.
  - The app runs without Google Play Services. Tuner doesn't use them.
  - The privacy policy URL is present.
- **Steps:**
  1. Create a new Android app and fill in the shared text.
  2. Upload the store edition APK.
  3. Target Fire TV devices.
  4. Add the assets.
  5. Complete the content-rating and data-safety forms.
  6. Paste the reviewer notes.
  7. Submit.

  Review usually takes a few days.

## Samsung (Tizen, Samsung Apps TV)

- **Account:** Samsung Apps TV Seller Office, at seller.samsungapps.com/tv. TV publishing needs Samsung partnership approval first. Apply with your business details and the content-rights answer above. Approval can take weeks.
- **Package:** a Tizen widget signed with a Samsung **distributor** certificate for public release. The development certificate used so far only installs on registered TVs. Build with `apps/tizen` (`npm run build`), then sign with the public distributor profile Samsung issues after approval.
- **Assets:**
  - **App icon:** [`icon-512x423.png`](store/icon-512x423.png) (512×423).
  - **Screenshots and banner:** the 1920×1080 screenshots and [`banner-1280x720.png`](store/banner-1280x720.png). Samsung lists exact sizes in Seller Office per launch year. Resize from these masters if they differ.
- **What Samsung checks:**
  - Remote navigation, including Back and the Exit key.
  - Behaviour after suspend and resume.
  - Network-loss handling.
  - Performance on older TV models in the years you target.
- **Steps:**
  1. Seller Office → Application → Create.
  2. Choose TV and the model years.
  3. Upload the signed widget.
  4. Fill in the listing and the reviewer notes.
  5. Submit for the certification test.

## LG (webOS, LG Content Store)

- **Account:** LG Seller Lounge, at seller.lgappstv.com. Register as a company seller. Like Samsung, approval needs business verification.
- **Package:** the IPK built from `apps/webos` (`npm run build`, then `ares-package`). LG signs store apps during publishing, so the Developer Mode IPK on the site is the same build.
- **Assets:**
  - **App icons:** [`icon-80.png`](store/icon-80.png) (80×80) and [`icon-130.png`](store/icon-130.png) (130×130).
  - **Banner and screenshots:** [`banner-1280x720.png`](store/banner-1280x720.png) and 1920×1080 screenshots. Seller Lounge shows the current exact sizes; resize from these masters if needed.
- **What LG checks:**
  - Magic Remote pointer and D-pad both work.
  - The Back key behaves the same on every screen.
  - Back on the home screen asks to exit.
- **Steps:**
  1. Seller Lounge → App → Register.
  2. Upload the IPK.
  3. Fill in the listing, assets and reviewer notes.
  4. Request a QA test.

## Roku (Roku Channel Store)

- **Account:** Roku developer account (done). Enroll in the Roku Partner Payouts program only if you'll ever sell inside the app. Tuner doesn't.
- **Package:** `output/roku/tuner-roku.zip` from `apps/roku` (`npm run build`). Test it in Developer Mode first (see [`apps/roku/README.md`](../apps/roku/README.md)). For the store, upload the same zip. Roku packages and signs it in the dashboard.
- **Assets:**
  - **Channel poster:** [`roku-poster-540x405.jpg`](store/roku-poster-540x405.jpg) (FHD, 540×405) and [`roku-poster-290x218.jpg`](store/roku-poster-290x218.jpg) (HD, 290×218).
  - **Screenshots:** 1920×1080.
- **What Roku checks:**
  - **Startup:** the app reaches a usable screen quickly, with no blank screen.
  - **Back:** Back works everywhere, and Back on the home screen exits.
  - **Playback:** video starts and recovers from errors.
  - **Deep linking:** Tuner declares `supports_input_launch`. Deep links into specific titles aren't implemented, so answer "No" to deep-link support.
- **Steps:**
  1. Developer Dashboard → Manage My Channels → Add Channel → Public channel.
  2. Upload the package.
  3. Fill in the store info, artwork and reviewer notes.
  4. Run the static analysis, then submit.

## Keeping listings current

Store versions follow the app versions in this repo. Update the store's package whenever the site's download changes. For Android, that's `site/lib/tuner.ts`; build the Google Play AAB and the Amazon APK from the same commit as the lumanest.tv APK. For LG, it's `site/app/apps/setup.tsx`. Bump the version before every store upload; stores reject a version number they've already seen.
