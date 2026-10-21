# Tuner by LumaNest TV

IPTV player for Android TV and Google TV. Cable-style Live TV guide, live preview, movies, series, search, and themes. Version 1.6.1 shows the full lineup chosen in the LumaNest customer hub, with a one-press "USA channels only" switch and a Category order setting (Featured, customer hub order, or A to Z) in Settings, plus a "Setting up your library" banner while a new playlist loads for the first time. Version 1.6.0 added LumaNest branding and pairing with your phone (scan a QR code on lumanest.tv/pair), and removes Torrentio. Version 1.5.3 expanded two-channel Multi View to the full screen, with controls that hide while you watch. Fast saved-library startup, a True Black theme, personal Most Watched, labelled navigation, Favorites, unrestricted movie and series audio, and native Android Picture-in-Picture remain available.

The [Samsung Tizen TV app](../tizen/README.md) provides Live TV, Movies, Series, Search, a black theme, and two-channel side-by-side or in-app Picture in Picture. It is built and signed separately from the Android APK using a Samsung TV certificate.

## Install on Google TV

1. On the TV: Settings > System > About, click "Android TV OS build" 7 times to unlock Developer options.
2. Settings > System > Developer options: turn on USB debugging (and Network debugging if listed).
3. Find the TV's IP under Settings > Network & Internet.
4. From Windows PowerShell, with the Android platform tools installed:

```powershell
adb connect <TV-IP>:<DEBUG-PORT>
adb install -r .\Tuner-1.6.1.apk
```

Accept the debugging prompt on the TV the first time. Tuner shows up in your Apps row.

No PC handy? Install the "Downloader" app on the TV, or use "Send Files to TV", and open the APK from there.

## First run

Choose **Xtream Codes** and enter the server URL, username and password from your provider. Tuner signs in, shows your account status, and loads channels, the guide, movies and series.

If you only have a link like `http://host:port/get.php?username=...&password=...&type=m3u_plus`, pick **M3U URL** and paste it. Tuner spots the credentials and switches to Xtream mode so you still get movies and series. Plain M3U links work too.

## Remote controls

The main controls match the onn 4K remote: the directional pad, center OK, Back, and Channel +/−. Use Left / Right in the top navigation, then OK to open Home, Live TV, Discover, Library, Multi View, Search, or Settings. Moving across the navigation keeps the current page open until you select a destination. Back from a section focuses its tab while keeping your place; a second Back returns to the section Tuner opens on (Home, or Live TV when Settings > **Start on** says so). Returning from details or the player restores your place. Settings includes **onn 4K remote**. Other remotes can also use Menu to focus navigation.

### Movies & Series

Movies and series follow the shared design in [docs/browse.md](../../docs/browse.md):

- **Home**: rows of posters (Continue watching, Popular, Featured, one pair per streaming service, Recently added, Top rated; movies before series). A row needs at least 5 titles, shows up to 20, and ends with **See all**, which opens Discover with that row's Type and List; Back returns to the tile.
- **Discover**: Type (Movies or Series), List (Popular, Featured, Top rated, Recently added, A–Z, and each service) and Genre filters over a poster grid without a length limit. Up from the grid reaches the filters; OK opens a filter's choices.
- **Library**: Continue watching, Favorite movies, Favorite series and Recently watched. **Add to Library** on a title's page, or hold OK on its poster, saves it; saved titles show a check badge, titles in progress a progress bar. A finished episode leaves its series in Continue watching as the next episode. Continue watching's **See all** opens the Library, and Back returns to that tile. A film the provider uploads again keeps its Library entry, history and saved position.
- Popularity comes from `https://lumanest.tv/api/catalog/rows?v=1`, cached for 12 hours (a stale copy is kept when the request fails; a failed request is tried again after 5 minutes, backing off to hourly, and when Tuner returns to the foreground). It only orders and picks titles from your own playlist. Titles match by the provider's TMDB id, otherwise by cleaned-up title and year (±1); a title without a year matches only a name that is unique in the lists. Without TMDB data Popular and Featured are hidden, service rows come from provider categories named after the service, and Recently added and Top rated use the provider's dates and ratings.
- Settings > **Movies & Series**: USA only (default) or All, separate from the Channels switch. USA only keeps titles whose provider category carries no other country or language tag and, when matched to TMDB, whose origin includes the US. It applies to Home, Discover and Search; the Library keeps what you saved.
- Settings > About shows the TMDB notice while TMDB data is in use.
- The store edition (`-Pstore=true`) shows no rows or lists named after streaming services.

Browsing the guide never changes the channel playing in the preview. The selected row updates the program description while the preview identifies the channel you are watching. Choose Watch or press OK on a current program to change channels. Select the preview to return to the channel already playing, even when browsing a different category or Favorites.

Guide categories begin with All Channels, Favorites, and Most Watched. Most Watched ranks successfully opened live channels for each playlist, with recent viewing breaking ties. Browsing, retries and audio changes do not count as additional watches. Provider picks fill this shortcut until personal history is available. US Sports, USA Premium, US News, US Movies, US Entertainment, and US Documentaries follow in that order, before Local news and the remaining provider groups.

| Where | Key | Does |
|---|---|---|
| Guide | Up / Down | Move between channels (hold to fly) |
| Guide | Left / Right | Move through programs; the grid scrolls in time |
| Guide | OK | Watch now, or show details for a future program |
| Guide | Hold OK | Add or remove the channel from Favorites |
| Guide | Channel +/- | Page up / down |
| Other remotes: Guide | FF / Rewind | Jump the guide 2 hours |
| Guide | Back | Return a future selection to now; from now, focus the Live TV navigation tab |
| Other remotes: Home | Menu | Focus the current navigation tab |
| Other remotes: Guide | 0-9 | Type a channel number |
| Live TV | Up / Down, Channel +/- | Change channel |
| Live TV | OK | Info banner, press again for the channel list |
| Live TV | Left | Channel list |
| Live TV | Right | Focus player actions, including Favorites and Picture-in-Picture |
| Live TV channel list | All / Favorites | Browse either lineup; only OK changes the channel |
| Live TV | Back | Back to the guide (keeps playing in the preview window) |
| Movies / episodes | Left / Right | Seek 10s (hold to go faster) |
| Movies / episodes | OK | Play / pause |
| Movies / episodes | Down | Audio, subtitles, next episode |
| Trailer (movie and series pages) | OK, Play/Pause | Play / pause |
| Trailer | Left / Right | Back or forward 10s |
| Trailer | Back, Stop | Close it and return to the Trailer button (it also closes when the trailer ends) |
| Multi View | OK / arrows / Menu | Reveal controls while watching |
| Multi View | OK on a video with controls visible | Listen to that channel |
| Multi View | Channel +/- | Change the focused channel |
| Multi View | Back | Hide visible controls; press again to stop both and return to Live TV |

## Two-channel Multi View

Open **Multi View**, choose two different channels, then select **Watch both**. The picker offers search, Favorites, Most Watched and suggested sports. Browsing the picker never tunes a channel. During playback, choosing a replacement changes only that slot. Select **Side by side** or **Picture in Picture** to change the layout without reopening either stream. Press OK on a video or use the Audio button to choose the one audible channel. Save Favorites with the picker star or Hold OK.

Playback uses the full screen, without the app navigation or setup dashboard. Controls and channel labels disappear after five seconds; OK, an arrow or Menu brings them back. Picture in Picture fills the screen with the main channel and overlays the second channel in a corner. Side by side uses the full screen width with both pictures centered vertically. The original picture proportions are preserved so football scoreboards are not cropped or stretched. Back hides visible controls first; another Back returns to Live TV and stops both streams.

Multi View uses at most two concurrent live streams. It stops the ordinary guide/full-screen stream before starting. Leaving the page, changing playlists or putting the app in the background closes both connections; returning from the background restores the selected pair. A failed channel can be retried or replaced independently. Picture quality is capped at 1080p per slot to suit TV hardware. Two streams must be available within your provider account limit, including any playback on other devices.

## Picture-in-Picture

Select **Picture-in-Picture** in the full-screen player's actions to keep the video playing in Android's native floating window. Supported devices also enter PiP when you press Home during full-screen playback. The guide preview does not enter PiP. The native window provides play/pause and Android's expand/close controls; reopening Tuner restores the full-screen player and its controls. PiP requires device support and Android's per-app permission. Video keeps playing in PiP; closing the window stops or pauses playback according to the normal live/VOD background behavior. The store edition from Google Play and the Amazon Appstore doesn't offer picture-in-picture, because Google Play's TV rules don't allow it for video.

## Guide data

Tuner saves the finished channel lineup, movie and series libraries, provider Most Watched, and current guide in private storage. Reopening restores these directly, skipping repeated provider parsing, country filtering and duplicate cleanup. Fresh channel snapshots last two hours, provider Most Watched twenty minutes, and movie/series snapshots twelve hours. Older saved libraries remain usable during a background refresh. Current and upcoming guide listings restore first while the full three-day guide loads separately.

Snapshots belong to the exact provider account and relevant format/market settings, and damaged snapshots are ignored. First setup or an edited provider still requires an initial download and preparation. Refresh preserves usable content; Clear cache removes both raw downloads and prepared snapshots. Clearing runs in the background and invalidates queued snapshot saves so canceled loads cannot recreate the cleared catalogs.

1. Your provider's XMLTV guide (or the EPG URL you set).
2. Free regional guides from epgshare01.online for any channel still missing listings, matched by channel name. Pick regions in Settings > Guide. Defaults: US national and US sports.
3. Xtream's per-channel short EPG for anything left, fetched as rows scroll into view.

## Content and Favorites

Live TV keeps U.S. channels using provider country labels, category labels, tagged names and U.S. EPG identifiers. Unknown or conflicting countries are hidden. Movies and series have their own switch (see Movies & Series above); with All, they show the complete provider library, including foreign and unlabelled titles. Audio language never blocks playback; English is preferred when available and other supported tracks remain selectable.

Settings > Guide > **Local stations** optionally limits local affiliates to Boston, Worcester and New Hampshire while preserving national cable, sports, events and entertainment. The supported market uses ZIP 01608 for Worcester; blank means all U.S. local markets. Nearby news stations appear in the **Local news** guide category. Filtering uses station identifiers and regional news brands before duplicate folding, so an outside-market affiliate cannot become a local station's backup. Movies and Series are unaffected. This setting is stored privately on the device and survives app updates.

Save channels with the guide Favorite button, Hold OK in the guide, a program's detail dialog, the Search result star, the full-screen player star or Hold OK, and the in-player channel list. The saved state updates immediately everywhere and persists separately for each playlist. Removing a Favorite preserves focus on a nearby channel in the Favorites list.

Continue Watching matches saved entries to the current movie or its playback backups and uses the current movie URL when reopening them. Duplicate channel copies are folded into one entry with playback backups, retaining Favorites and guide data. Empty and out-of-window event slots are hidden. Channels that fail on every backup with a missing-channel response are hidden for three days; Settings can restore them immediately. Authentication, connection-limit and provider-outage responses do not hide channels. Reuploaded movies with matching titles and years are merged into their newest copy, keeping earlier uploads as playback alternatives.

## Logos

Every channel shows a logo. Tuner tries the provider's logo, then the guide's icon, then the iptv-org open logo database, and finally draws a lettered tile.

## Settings

Themes (True Black, Midnight, Carbon, Ocean, Ember, Cable Blue, Daylight), multiple playlists, live format (TS or HLS), guide preview on/off, free guide regions, local stations, onn remote help, refresh, clear cache. In the theme picker, arrows preview a theme, OK saves it, and Back cancels the preview.

## Build

Both build types use the LumaNest application ID `tv.lumanest.tuner` (the store edition below uses `app.tunertv`). Debug builds are always signed with the standard Android debug key, so a debug build cannot replace an installed release; uninstall the release first when testing a debug build on the same device. Install the signed release APK for normal use.

Build from `apps/android` with JDK 17, the Android SDK (platform 37), and the checked-in Gradle 9.8.1 wrapper. Set `JAVA_HOME` to your JDK and `ANDROID_HOME` to your SDK. Alternatively, create an ignored `local.properties` in this folder containing `sdk.dir` for your SDK location. Do not commit local SDK paths.

```powershell
cd apps/android
.\gradlew.bat assembleRelease
```

On macOS or Linux, run `./gradlew assembleRelease` from the same folder. The wrapper downloads its pinned Gradle distribution when it is not cached; no global Gradle installation is required.

Output: `app\build\outputs\apk\release\app-release.apk` when the external release key is available. Without that key, Gradle produces `app-release-unsigned.apk`; CI never invents a replacement release key.

### Store edition (Google Play and Amazon Appstore)

`-Pstore=true` builds the store edition, made for Google Play and Amazon Appstore review. It is a separate app with the application ID `app.tunertv` (after tunertv.app), so a store install and the lumanest.tv APK never update each other and can be installed side by side (see [Android store edition](../../docs/store-listings.md#android-store-edition-google-play-and-amazon)). Without the flag nothing changes. The store edition always hides adult categories (no unlock or passcode, and adult channel and title names are hidden too), offers no picture-in-picture, is offered only to TVs in the stores (`android.software.leanback` required; it can still be sideloaded onto a phone), uses neutral setup wording without the user-agent field, has a "Privacy policy" row in Settings, starts with the free guide fallback off, and keeps Trending to channels already in the lineup. See `Edition.kt`.

```powershell
.\gradlew.bat bundleRelease -Pstore=true    # Google Play: app\build\outputs\bundle\release\app-store-release.aab
.\gradlew.bat assembleRelease -Pstore=true  # Amazon Appstore: app\build\outputs\apk\release\app-store-release.apk
.\gradlew.bat assembleRelease               # lumanest.tv download, unchanged: app\build\outputs\apk\release\app-release.apk
```

Store files are signed with the same external key, or left unsigned (`-unsigned` in the APK name) without it. Each `assembleRelease` replaces the previous APK in `apk\release`, so copy one edition's APK before building the other. `bundleRelease` without `-Pstore=true` stops with an error, so the direct edition can't be uploaded to Google Play by mistake. On Google Play, let Play App Signing generate the app signing key and sign uploads with your upload key (the existing release key works); [`docs/store-listings.md`](../../docs/store-listings.md) has the full Google Play and Amazon checklists.

Keep the existing release key and signing properties private. Gradle checks signing configuration in this order: `-PtunerSigningProperties=/absolute/path/keystore.properties`, the `keystore.properties` file in `TUNER_SIGNING_DIR`, then `signing/android/keystore.properties` at the repository root. The repository-root `signing` directory is ignored by Git. For signing material stored elsewhere, set `TUNER_SIGNING_DIR` to its directory before building. A relative `storeFile` resolves beside the properties file; the required properties are `storeFile`, `keyAlias`, `storePassword`, and `keyPassword`. Never put passwords on the command line or include signing files in source archives.

The release certificate SHA-256 is `EC:6F:ED:26:F3:B6:88:C4:6A:CB:1A:55:2B:D0:B9:EE:8C:E8:C9:62:BA:B4:DB:74:51:DF:3F:35:A3:95:45:86`. Keep a private backup of the signing material; all future release updates must use this key. An APK signed with another key cannot update the installed release.

Tests (parsers, content policy, name matching, remote navigation, and Robolectric screenshots written to `app\build\screens`):

```powershell
.\gradlew.bat testDebugUnitTest
```

Screenshot coverage includes Live TV, Home, Discover, Library, playback controls, themes, and a compact 720 × 405 dp layout. Robolectric's native dependencies require a supported host architecture; on Windows ARM, use an x64 JDK under Windows emulation for these tests.

Device tests in `app/src/androidTest` are opt-in through instrumentation arguments so they never disturb a TV's saved playlist by accident. The **Android device tests** workflow runs the self-contained ones nightly (and on demand) on an emulator: `AudioFallbackTest`, `GuideRemoteTest`, `MultiViewFullscreenTest`, `PictureInPictureTest` and `TwoChannelPlaybackTest`, which play the packaged fixture from a loopback server. Suites that need a saved provider account, its cached catalogue or live provider streams, or that change saved settings (`CatalogTimingTest`, `DeviceNavigationTest`, `InstalledCatalogTest`, `StartupSpeedTest`, `TwoChannelProviderTest`) run only on a configured TV. To run the CI set against a connected device or emulator:

```powershell
.\gradlew.bat connectedDebugAndroidTest "-Pandroid.testInstrumentationRunnerArguments.guideRemoteCheck=true" "-Pandroid.testInstrumentationRunnerArguments.multiViewFullscreenCheck=true" "-Pandroid.testInstrumentationRunnerArguments.pictureInPictureCheck=true" "-Pandroid.testInstrumentationRunnerArguments.twoChannelCheck=true"
```

## Notes

- Playlist logins are stored in the app's private storage on the TV. Passwords are encrypted with an Android Keystore key, and app preferences are excluded from cloud backup and device transfer.
- Most IPTV servers use plain http, so cleartext traffic is allowed. User-installed CA certificates are not trusted.
- Built with Kotlin, Jetpack Compose, Media3 ExoPlayer, OkHttp and Coil.
