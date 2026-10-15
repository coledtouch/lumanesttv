# Store listings: Fire TV, Samsung, LG and Roku

Ready-to-paste listing text, the artwork in [`docs/store/`](store/), and a submission checklist for each store. The same app ("Tuner by LumaNest TV") ships in every store; only the package differs.

## Before you submit anywhere

1. **Content rights.** Every store reviews streaming apps for piracy. Tuner contains no channels itself, but its purpose is to play LumaNest TV subscriptions. Reviewers can ask you to show that LumaNest TV is licensed to distribute the channels it sells. Have that answer ready before submitting. Without it, expect rejection and, on some stores, removal of the developer account.
2. **A reviewer line.** Create a free line in your reseller panel just for reviewers, valid for at least 60 days. Give its username and password only in each store's private "notes to reviewer" field. Never put them in public listing text, and never in this repository.
3. **Public pages that must stay online:** `https://lumanest.tv/privacy` (privacy policy), `https://lumanest.tv/terms` (terms), `https://lumanest.tv/apps` (support and setup) and the support email `support@lumanest.tv`.
4. **Screenshots from a real TV.** [`docs/store/`](store/) has the pairing and Settings screens. Stores also want playback screens: take 2 or 3 from your TV with the reviewer line, on a channel or film whose artwork you're allowed to show.

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

## Amazon Fire TV (Amazon Appstore)

- **Account:** Amazon Developer, at developer.amazon.com. It's free.
- **Package:** the signed Android release APK, the same file as the lumanest.tv download, currently Android 1.6.1. Amazon allows sideload builds and Appstore builds to share a signing key.
- **Device targeting:** select every Fire TV model. Keep phones and tablets off unless you also want the phone layout reviewed.
- **Assets:**
  - **App icons:** [`icon-512.png`](store/icon-512.png) (512×512) and [`icon-114.png`](store/icon-114.png) (114×114).
  - **Fire TV app banner:** [`banner-1280x720.png`](store/banner-1280x720.png) (1280×720).
  - **Background image (optional):** [`background-1920x1080.png`](store/background-1920x1080.png).
  - **Screenshots:** 3 to 10 at 1920×1080: [`screenshot-1-pair-tv.png`](store/screenshot-1-pair-tv.png), [`screenshot-2-settings.png`](store/screenshot-2-settings.png), plus playback captures from a TV.
- **What Amazon checks:**
  - The D-pad reaches everything.
  - Back exits from the home screen.
  - The app runs without Google Play Services. Tuner doesn't use them.
  - The privacy policy URL is present.
- **Steps:**
  1. Create a new Android app and fill in the shared text.
  2. Upload the APK.
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

Store versions follow the app versions in this repo. Update the store's package whenever the site's download changes. For Android, that's `site/lib/tuner.ts`. For LG, it's `site/app/apps/setup.tsx`. Bump the version before every store upload; stores reject a version number they've already seen.
