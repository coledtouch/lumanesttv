# App releases

The initial source migration includes these existing installers as GitHub Release assets:

| Installer | Version | Purpose |
| --- | --- | --- |
| `Tuner-1.5.3.apk` | 1.5.3, Android version code 14 | Signed Android TV / Google TV app |
| `Tuner-1.4.8-tizen-UNSIGNED.wgt` | 1.4.8 | Samsung development widget; requires signing before TV installation |
| `tv.lumanest.tuner_1.0.1_all.ipk` | 1.0.1 | LG webOS development installer |

Later releases:

| Installer | Version | Purpose |
| --- | --- | --- |
| `Tuner-1.6.0.apk` | 1.6.0, Android version code 15 | Signed Android TV / Google TV / Fire TV app: LumaNest branding, phone pairing, Torrentio removed |
| `Tuner-1.6.1.apk` | 1.6.1, Android version code 16 | Lineup chosen in the customer hub, USA-only switch, category order, first-load banner |
| `Tuner-1.6.2.apk` | 1.6.2, Android version code 17 | Subtitles for live, movies and series; passcode-locked adult categories |
| `Tuner-1.6.3.apk` | 1.6.3, Android version code 18 | Live channels reconnect in the background when the provider's connection goes quiet or drops, instead of freezing |
| `tuner-roku-1.0.1.zip` | 1.0.1 | Roku app ZIP for developer-mode sideloading, served from the website's public downloads directory; built with `npm run build` in `apps/roku` |
| `tv.lumanest.tuner_1.0.4_all.ipk` | 1.0.4 | LG development IPK made with `ares-package`, served from the website's downloads: subtitles, passcode-locked adult categories, player controls that always hide |
| `tuner-roku-1.0.2.zip` | 1.0.2 | Roku sideload ZIP served from the website's downloads: subtitles and passcode-locked adult categories |
| `tv.lumanest.tuner_1.0.5_all.ipk` | 1.0.5 | LG development IPK served from the website's downloads: remote navigation overhaul (guide focus and placement, channel keys and number entry, Multi View, Search and Settings arrows, dialogs) |
| `tuner-roku-1.0.3.zip` | 1.0.3 | Roku sideload ZIP served from the website's downloads: Home, Discover, Library and Search for movies and series, USA-only Movies & Series by default, popularity rows from lumanest.tv |
| `tv.lumanest.tuner_1.1.0_all.ipk` | 1.1.0 | LG development IPK served from the website's downloads: Home, Discover and Library for movies and series, USA-only Movies & Series by default, popularity rows from lumanest.tv |
| `Tuner-1.7.1.apk` | 1.7.1, Android version code 20 | Home, Discover and Library for movies and series with popularity rows from lumanest.tv, and Movies & Series USA only matching the other apps (docs/browse.md). 1.7.0 (version code 19) was never offered: it crashed at launch on devices |
| `tv.lumanest.tuner_1.1.1_all.ipk` | 1.1.1 | LG development IPK served from the website's downloads: Movies & Series USA only and title matching follow the same rules as every other app (docs/browse.md); names ending in many quality tags no longer stall the app; M3U titles keep their commas and old-Mac (CR-only) playlists load; saved catalogues reload once after updating. An M3U series named by a `series-name` (or a title-less `tvg-name`) that contains a quote mark now gets its full name and a new id, so favourites saved under the old, cut-off name drop out |
| `tuner-roku-1.0.4.zip` | 1.0.4 | Roku sideload ZIP served from the website's downloads: Movies & Series USA only and title matching follow the same rules as every other app; M3U titles with commas keep their whole name ("Crazy, Stupid, Love"), old-Mac (CR-only) playlists load, groups and ids that differ only in letter case stay apart, and names ending in many quality tags no longer stall the app |
| `tv.lumanest.tuner_1.2.0_all.ipk` | 1.2.0 | LG development IPK served from the website's downloads: English subtitles from OpenSubtitles.com for movies and episodes (through lumanest.tv; shown with Subtitles On and listed in the subtitle menu), a Trailer button on details pages that opens the YouTube app (a QR code otherwise), and the provider's "Most watched now" live category hidden (docs/extras.md) |
| `tuner-roku-1.1.0.zip` | 1.1.0 | Roku sideload ZIP served from the website's downloads: English subtitles from OpenSubtitles.com for movies and episodes (through lumanest.tv), a Trailer button on details pages that shows a QR code for the trailer, and the provider's "Most watched now" live category hidden (docs/extras.md) |
| `Tuner-1.8.0.apk` | 1.8.0, Android version code 21 | Never offered: superseded before release by 1.8.1 (version code 22), after testing on an onn 4K Pro showed the Trailer button appearing only seconds after a details page opened and the trailer opening in the YouTube app, from which Back didn't return to Tuner. It had English subtitles from OpenSubtitles.com for movies and episodes (through lumanest.tv), the Trailer button, the provider's "Most watched now" live category hidden (docs/extras.md), and a player that opens only web links and its own subtitle files. Its checksum stays in `SHA256SUMS` as a record |
| `tv.lumanest.tuner_1.2.1_all.ipk` | 1.2.1 | LG development IPK served from the website's downloads: the trailer plays inside Tuner (YouTube's embedded player on a lumanest.tv page, `/embed/trailer`) and Back returns to the details page; the YouTube app and then a QR code remain as fallbacks (docs/extras.md); Settings > About Tuner shows the privacy policy and YouTube Terms of Service addresses. Samsung 1.6.1 has the same change |
| `Tuner-1.8.1.apk` | 1.8.1, Android version code 22 | Never offered: superseded before release by 1.8.2 (version code 23) because its in-app trailer showed a black screen on an onn 4K Pro. It played trailers inside Tuner in YouTube's embedded player (Back returned to the details page; the YouTube app, then a QR code, when a video couldn't play there), showed the Trailer button sooner (lookups start when a poster keeps the focus), and showed the privacy policy and YouTube's terms in Settings > About in both editions; plus 1.8.0's English subtitles from OpenSubtitles.com, the Trailer button and the hidden "Most watched now" category (docs/extras.md). Its checksum stays in `SHA256SUMS` as a record |
| `Tuner-1.8.2.apk` | 1.8.2, Android version code 23 | Never offered: superseded before release by 1.8.3 (version code 24) because its in-app trailer still showed a black screen on an onn 4K Pro. Its log showed the trailer playing in a frame 960 pixels wide and 0 high: the player's WebView had no layout params, so its height wrapped its content and came out as zero. It laid the player page out at the screen's own width, sent a trailer that didn't start, or whose time stopped, to the YouTube app and then a QR code, and logged the trailer player's diagnostics under the tag `TunerTrailer`. Its checksum stays in `SHA256SUMS` as a record |
| `Tuner-1.8.3.apk` | 1.8.3, Android version code 24 | Trailers play full screen inside Tuner in YouTube's embedded player: the player's WebView fills the screen, the page sizes the player from the window, and a trailer that plays in a frame with no size goes to the YouTube app, then a QR code. Tested on an onn 4K Pro: 960×540 CSS pixels (the whole 1920×1080 screen) at 1080p, and Back returns to the details page. Includes 1.8.2's start and stall fallbacks and `TunerTrailer` diagnostics, 1.8.1's in-app trailers, sooner Trailer button and Settings > About rows (privacy policy, YouTube's terms), and 1.8.0's English subtitles from OpenSubtitles.com, the Trailer button and the hidden "Most watched now" category (docs/extras.md) |

[`SHA256SUMS`](SHA256SUMS) records the installer checksums. GitHub also generates a source archive for each tagged release; it contains the website and all three app source trees.

Keep private keys, certificates and signing profiles outside the repository. Android updates must keep the existing application ID and release signing key. Unsigned Samsung packages are not ready to install on a television.

## Cutting a release

Each app has its own version, so each release has its own tag: `android-v<version>`, `tizen-v<version>` or `webos-v<version>` (for example `android-v1.6.0`). The version must match the app source: `versionName` in `apps/android/app/build.gradle.kts`, the widget version in `apps/tizen/config.xml` and `apps/tizen/package.json`, or `apps/webos/appinfo.json` and `apps/webos/package.json`.

Pushing the tag runs [`.github/workflows/release.yml`](../.github/workflows/release.yml). It runs that app's checks, builds its installer, writes a `SHA256SUMS` file for the files it built and creates a **draft** GitHub release with those files attached. Nothing is published until the owner reviews the draft and publishes it.

| Tag | CI attaches | Before publishing |
| --- | --- | --- |
| `android-v*` | `Tuner-<version>-UNSIGNED.apk` | The owner builds or signs `Tuner-<version>.apk` with the existing release key on their own machine, uploads it to the draft, and adds its SHA-256 to the release notes and to this folder's `SHA256SUMS`. |
| `tizen-v*` | `Tuner-<version>-tizen-UNSIGNED.wgt` | Optional: attach a Samsung-signed widget made with the private certificate profile. |
| `webos-v*` | `tv.lumanest.tuner_<version>_all.ipk` | Development IPK made with LG's `ares-package`; install-test it on a TV. |

Signing keys, keystore passwords and certificate profiles are never stored in GitHub secrets or given to CI, so an Android build from CI is always unsigned. Android TV will not install an unsigned APK over the signed app, so only the owner-signed APK should be offered to users. Record the checksum of every installer that is offered for download in `SHA256SUMS`; existing entries stay unchanged.
