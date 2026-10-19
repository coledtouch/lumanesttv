# Store listings: Google Play, Fire TV, Samsung, LG, Roku and Apple TV

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

Google Play and the Amazon Appstore get the **store edition** of the Android app, built with `-Pstore=true` from the same code and version as the lumanest.tv APK. It is a **separate app** with its own package name, **`app.tunertv`** (the lumanest.tv APK stays `tv.lumanest.tuner`). It differs only where store reviewers require it:

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

Because the packages differ, Android treats the two editions as different apps. A store install never updates a lumanest.tv install, or the reverse, and both can be installed on the same TV. A customer moving from the lumanest.tv APK to Google Play or Amazon installs Tuner from the store, pairs it again with the phone (Favorites and settings don't carry over), and can then uninstall the APK. The store edition never has adult categories or picture-in-picture.

## Google Play (Android TV)

- **Account:** Google Play Console, at play.google.com/console. One-time fee of US$25, plus a government ID and a payment card in the account holder's name.
  - Choose an **Organization** account for LumaNest TV. It needs a D-U-N-S number, which is free but can take up to 30 days to issue.
  - A **Personal** account created after 13 November 2023 must first run a closed test with at least 12 testers, opted in for 14 days in a row, then apply for production access. For a TV-only app every tester needs a Google TV or Android TV device. New personal accounts must also confirm access to an Android phone (Android 10 or later) in the Play Console app. Organization accounts skip both.
- **Package:** the store edition App Bundle, `app-store-release.aab` (see [Android store edition](#android-store-edition-google-play-and-amazon)). Google Play takes only App Bundles for new apps, and requires them for TV apps.
  - **Target API level:** Tuner targets Android 15 (API 35). Since 31 August 2026 Google Play asks phone apps for API 36, but Android TV apps for API 34 only, and the store edition is TV-only (it requires `android.software.leanback`). Raise the target before ever offering it to phones. The minimum stays Android 6.0.
  - **Package name:** `app.tunertv`. Play Console fixes it at the first upload, and it can never change afterwards.
  - **Version codes:** Play rejects a code it has already seen, so raise it before every upload. The lumanest.tv APK is a different app, so the two can share the version number in `build.gradle.kts`.
- **Play App Signing:** choose this before the first upload, including internal testing; it can't be changed afterwards.
  1. When Play Console asks how to sign the app, keep the default: **Google generates the app signing key** and keeps it safe. The store edition is a separate app (`app.tunertv`), so it doesn't need the lumanest.tv key.
  2. Sign uploads with an **upload key**. The simplest choice is the existing Tuner release key in `TUNER_SIGNING_DIR`: the build command above already signs with it, and Play Console registers it as the upload key at the first upload. If you'd rather keep it separate, create a new upload key yourself, outside this repository, and build with `-PtunerSigningProperties=<its keystore.properties>`. Never commit either key.
  3. If the upload key is ever lost, request an upload key reset in Play Console (App integrity). The app signing key stays with Google, so the app keeps updating.
  - **Leave automatic protection off** (App integrity) unless you want Google Play to block installs that didn't come from Google Play.
  - Apps using Play App Signing are registered for Android developer verification automatically. The lumanest.tv APK (`tv.lumanest.tuner`) is a different package: when Android developer verification reaches TVs, register it separately with its own key. Check the Play Console home page for the registration task.
- **Android TV form factor:** Test and release → Advanced settings → Form factors → Add form factor → Android TV, then opt in. When asked where to release, keep the main tracks (the same tracks as phones): the bundle is TV-only anyway, and Google says a dedicated Android TV track can't be switched back afterwards. Upload the TV banner and TV screenshots first. Opting in starts Google's TV quality review; the status shows Pending, Approved or Not approved. Mention Android TV in the full description.
- **Assets:**
  - **App icon:** [`icon-512-play.png`](store/icon-512-play.png) (512×512, full square, no transparency). Google Play rounds the corners itself, so don't upload the pre-rounded `icon-512.png` here.
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
- **Steps:**
  1. Create and verify the developer account (Organization).
  2. Create the app: name "Tuner by LumaNest TV", type App, Free.
  3. Accept Play App Signing with a Google-generated app signing key, before uploading anything (package name `app.tunertv`).
  4. Build the store edition AAB and upload it to an **Internal testing** release. On a Google TV that also has the lumanest.tv APK, check that both apps install side by side and that the Google Play one pairs and plays.
  5. Fill in the store listing, assets and App content forms.
  6. Opt in to the Android TV form factor.
  7. Personal accounts only: run the closed test (12 testers, 14 days), then apply for production access.
  8. Create a **Production** release with the same AAB and send it for review. The first review, with the TV quality review, can take a week or more.

## Amazon Fire TV (Amazon Appstore)

- **Account:** Amazon Developer, at developer.amazon.com. It's free.
- **Package:** the store edition APK, `app-store-release.apk` (see [Android store edition](#android-store-edition-google-play-and-amazon)). Don't upload the lumanest.tv download: Amazon also bans adult content and rejects apps that mention other platforms, such as Google TV. Its package is `app.tunertv`, like the Google Play edition. Use the same version name as the lumanest.tv download, and the same `versionCode` as the Google Play upload.
- **Signing:** Amazon may re-sign the APK with its own key; the upload page shows the "Appstore certificate hashes". That's fine: the Amazon install (`app.tunertv`) is a separate app from the lumanest.tv APK either way, and Amazon updates only its own installs.
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

## Apple TV (App Store)

The Apple TV app is in [`apps/tvos`](../apps/tvos/) ("Tuner by LumaNest TV", bundle ID **`app.tunertv`**, tvOS 17 and later). The owner builds, signs and uploads it from a Mac with Xcode; [`apps/tvos/README.md`](../apps/tvos/README.md) has every step. There is only one Apple TV edition, and it is made for App Review:

- **Adult content:** never shown. Adult categories, channels and titles are filtered out before anything is stored, with the same strict rules as the Android store edition. There is no unlock, passcode or setting for it, and no server or hub setting can turn it on (guidelines 1.1.4 and 2.5.19).
- **Streaming service names:** no Home rows or Discover lists named after Netflix, Disney+, Max, Prime Video, Apple TV+, Hulu, Paramount+ or Peacock, as in the Android store edition.
- **Purchases:** none, and nothing in the app links to buying. Tuner is a "reader" app (guidelines 3.1.1 and 3.1.3(a)): customers sign in with a line they already have. The app shows only the privacy policy address (`tunertv.app/privacy`, also as a QR code, on the Welcome, Sign in, Pair and Settings screens) and help (`tunertv.app/support`), never lumanest.tv/apps, which sells plans. Those tunertv.app pages have no plan, renewal or buying links (keep it that way), but they do link to lumanest.tv/apps and lumanest.tv/pair, so the lumanest.tv/pair change below matters.
- **Sign-in:** phone pairing, or a LumaNest TV line's server address, username and password typed with the Siri Remote. There is no "playlist link" field, so the app doesn't look like a player for any playlist (guidelines 4.2, 4.3 and 5.2.3); a playlist link can only arrive through pairing.
- **Wording:** no other platforms are named anywhere in the app or the listing (guideline 2.3.10).

**Listing text** (the shared text without "Plans" and without other platforms):

- **Name:** Tuner by LumaNest TV (20 of 30 characters).
- **Subtitle:** Live TV, movies and series (26 of 30).
- **Promotional text (optional):** Your LumaNest TV channels, guide, movies and series on Apple TV.
- **Description:**
  > Tuner is the Apple TV app for LumaNest TV subscribers. Watch your live channels with a full TV guide, and browse movies and series, all from your sofa.
  >
  > Setup takes seconds. Open Tuner, scan the code on screen with your phone, sign in to your LumaNest TV account and approve your Apple TV. You can also sign in with your login using the Siri Remote.
  >
  > • Live TV with an on-screen guide, Favorites and Most Watched
  > • Movies and series with episode lists, Continue watching and your Library
  > • Search for channels, movies and series
  > • Subtitles and closed captions that follow your Apple TV settings
  > • Choose your channels and categories in your LumaNest TV customer hub; Tuner shows exactly your lineup
  >
  > A LumaNest TV subscription is required. Tuner does not include or sell any channels or content. Help: tunertv.app/support
- **Keywords** (92 of 100 bytes): `live tv,tv guide,epg,channels,movies,series,streaming,favorites,lumanest,subscription,player`. No channel, network, league or other app names.
- **Category:** Entertainment. **Price:** Free. **In-app purchases:** none.
- **URLs:** Support `https://tunertv.app/support` (required), Privacy Policy `https://tunertv.app/privacy`, User Privacy Choices `https://tunertv.app/delete`. Leave Marketing URL empty: the tunertv.app home page has "See LumaNest TV plans" and "Plans and renewals" links (guideline 3.1.1 covers the app's metadata too).
- **Copyright:** "2026 LumaNest TV" (the legal name on the developer account).

**App Privacy** (App Store Connect → App Privacy; it must match `apps/tvos/Tuner/Resources/PrivacyInfo.xcprivacy`):

- **Tracking:** No.
- **Data Linked to You:** Identifiers → **User ID** (the line username, sent to the LumaNest TV service), and Usage Data → **Product Interaction** (the service's servers see which streams are requested). Purpose: **App Functionality** for both. Neither is used for tracking.
- **Not collected:** Favorites, watch history, resume points and settings stay on the Apple TV. No analytics, ads, location or contacts.
- **Apple TV Privacy Policy field:** tvOS apps need the policy's full text in this field as well as the URL. Paste the text of `https://tunertv.app/privacy`, which covers the Apple TV app (deploy `tuner-site/` first, see the tasks below).

**Age rating:** answer the questionnaire for what the reviewer line actually shows, accurately. Answer **No** to Unrestricted Web Access, User-Generated Content, Messaging and Chat, Advertising and Parental Controls. Never select "Graphic Sexual Content and Nudity": the app can't show it, and that answer makes an app "Unrated", which can't be published. Live TV usually lands at 13+ to 18+, depending on how often the line's channels carry violence, language and mature themes.

**Content rights:** App Information → Content Rights → "Yes, it contains, shows, or accesses third-party content" and "I have the necessary rights". Attach LumaNest TV's licence or distribution agreements in App Review Information → Attachment. Saying that the app contains no channels is not enough on its own: Apple asks for documents (guidelines 5.2.1 to 5.2.3), and falsified documents can end the developer account. See [Before you submit anywhere](#before-you-submit-anywhere).

**Assets:**

- **App icon and Top Shelf:** built into the app from `apps/tvos/Tuner/Resources/Assets.xcassets` (layered Home Screen icon 400×240 and 800×480, layered App Store icon 1280×768, Top Shelf 1920×720 and 3840×1440, Top Shelf Wide 2320×720 and 4640×1440, all opaque). `apps/tvos/tools/make_assets.py` redraws them. App Store Connect reads the App Store icon from the uploaded build.
- **Screenshots:** 1 to 10 at 1920×1080 (or 3840×2160), PNG or JPEG without transparency, captured from the app on an Apple TV with the reviewer line (for example Xcode → Window → Devices and Simulators → select the Apple TV → Take Screenshot). Show Home, Live TV with the guide, a movie page and playback, on channels and films whose names and artwork you may show. The pairing screenshots in `docs/store/` show another app; don't use them.
- **App preview (optional):** 15 to 30 seconds, 1920×1080.

**App Review Information:**

- **Sign-in required:** Yes. Username and password: the reviewer line. Use a line that allows at least 2 connections, is valid for 60 days or more, works from the US and over IPv6 (NAT64) networks, and has adult categories turned off.
- **The reviewer line's lineup** (choose it in the hub, then check every channel and title on a real Apple TV with that line before submitting). Reviewers reject an app that lists things it can't play (guideline 2.1), and the line's category names become the guide's chips (guideline 2.3.10):
  - live channels with H.264 video and AAC or AC-3 sound only: HEVC and MPEG-2 channels show an error on Apple TV, and MPEG Layer II channels play without sound;
  - movies and episodes as MP4 (MKV and AVI uploads are left out or shown as "Not available on Apple TV");
  - no category or channel names that name other platforms or services (such as Samsung TV Plus, Pluto TV, The Roku Channel, Netflix or Prime Video), and no adult categories;
  - artwork and names you're allowed to show (they also end up in your screenshots).
- **Notes** (adjust and paste; the server address and login go only in this private field):
  > Tuner by LumaNest TV is the Apple TV app for LumaNest TV subscribers and contains no content of its own. To sign in with the Siri Remote: on the Welcome screen choose "Sign in with your login instead", enter the server address, username and password below and choose Sign In. Alternatively, scan the QR code with a phone and approve the Apple TV at lumanest.tv/pair with the same login. The line includes live channels (Live TV tab), movies and series (Home, Discover, Search). The privacy policy is on the Welcome and Sign in screens and in Settings → About.
  >
  > App Transport Security: NSAllowsArbitraryLoads is set because the app must connect to servers managed by another entity that don't support secure connections. The LumaNest TV streaming servers, run by our upstream provider, serve the account API, guide data, artwork and MPEG-TS/MP4 streams over HTTP only and redirect each stream to a per-session IP address, so the hosts can't be listed in advance. Our own service (lumanest.tv pairing) uses HTTPS only.
  >
  > Playback: the provider sends live channels as continuous MPEG-TS, which AVPlayer can't open directly. Tuner repackages the stream on the device into HLS and serves it to AVPlayer from a small HTTP server on 127.0.0.1 with a system-assigned port. It listens on the loopback interface only and can't be reached from other devices.
  >
  > Tuner never shows adult content and has no setting to enable it. There are no purchases in the app.
- **Contact:** the owner's name, phone and email.

**Export compliance:** `ITSAppUsesNonExemptEncryption` is `NO` in the app's Info.plist (Tuner only uses the encryption built into tvOS), so App Store Connect doesn't ask.

**Availability:**

- **EU:** declare the trader status under the Digital Services Act in App Store Connect; Apple requires it before the app can be offered in EU storefronts.
- **Storefronts:** choose only the countries where LumaNest TV holds the rights to what it sells (start with the United States). The content-rights declaration applies in every storefront you pick.

**Owner tasks before the first submission** (the first three block it):

- Deploy the site with the `appletv` pairing device (`site/lib/pairing.ts`). Until then the Apple TV can't get a pairing code (it keeps showing "Can't reach LumaNest TV. Retrying…"), though signing in with a login works.
- lumanest.tv/pair without purchase links: the QR code on the Apple TV's first screen leads there and reviewers scan it (guidelines 3.1.1 and 3.1.3(a)). Today the page's header and footer (`site/app/site-chrome.tsx`) link to Plans, Renew and the customer hub, and the sign-in step links to the hub (`site/app/pair/pair-flow.tsx`). Give `/pair` a plain header and footer without them, and say "Your line login is in your welcome email" instead of linking.
- Deploy `tuner-site/` (tunertv.app): its privacy policy, support and data-deletion pages now cover the Apple TV app, and the privacy, support and data-deletion pages no longer have Plans, renewal or buying links.
- Apple Developer Program membership as an organization (D-U-N-S number), the content-rights documents and the reviewer line (with the lineup described above).
- Worth considering (lowers the "generic player" risk in review, guidelines 4.2 and 5.2.3): Sign in still accepts any server address. Limiting it to LumaNest TV's own server hosts needs those hosts in the app, or a lumanest.tv endpoint that names the server for a line.

**Steps:**

1. Enroll in the Apple Developer Program as LumaNest TV (US$99 a year).
2. App Store Connect → Apps → + → New App: platform **tvOS**, name "Tuner by LumaNest TV", primary language English (U.S.), bundle ID `app.tunertv`, SKU `tuner-appletv`.
3. Archive and upload from Xcode ([`apps/tvos/README.md`](../apps/tvos/README.md#release-to-testflight-and-the-app-store)), then test the build with TestFlight on an Apple TV.
4. Fill in the listing, App Privacy, age rating, content rights, App Review Information and pricing (Free) above.
5. Select the build and choose Add for Review, then Submit to App Review. Answer reviewer questions in App Store Connect → Messages.

## Keeping listings current

Store versions follow the app versions in this repo. Update the store's package whenever the site's download changes. For Android, that's `site/lib/tuner.ts`; build the Google Play AAB and the Amazon APK from the same commit as the lumanest.tv APK. For LG, it's `site/app/apps/setup.tsx`. Bump the version before every store upload; stores reject a version number they've already seen.
