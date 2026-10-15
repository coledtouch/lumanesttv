# Tuner by LumaNest TV

IPTV player for Android TV and Google TV. Cable-style Live TV guide, live preview, movies, series, search, and themes. Version 1.5.3 expands two-channel Multi View to the full screen, with controls that hide while you watch. Fast saved-library startup, a True Black theme, personal Most Watched, labelled navigation, Favorites, unrestricted movie and series audio, native Android Picture-in-Picture, and the integrated Streaming tab remain available.

The [Samsung Tizen TV app](../tizen/README.md) provides Live TV, Movies, Series, Search, a black theme, and two-channel side-by-side or in-app Picture in Picture. It is built and signed separately from the Android APK using a Samsung TV certificate.

## Install on Google TV

1. On the TV: Settings > System > About, click "Android TV OS build" 7 times to unlock Developer options.
2. Settings > System > Developer options: turn on USB debugging (and Network debugging if listed).
3. Find the TV's IP under Settings > Network & Internet.
4. From Windows PowerShell, with the Android platform tools installed:

```powershell
adb connect <TV-IP>:<DEBUG-PORT>
adb install -r .\Tuner-1.5.3.apk
```

Accept the debugging prompt on the TV the first time. Tuner shows up in your Apps row.

No PC handy? Install the "Downloader" app on the TV, or use "Send Files to TV", and open the APK from there.

## First run

Choose **Xtream Codes** and enter the server URL, username and password from your provider. Tuner signs in, shows your account status, and loads channels, the guide, movies and series.

If you only have a link like `http://host:port/get.php?username=...&password=...&type=m3u_plus`, pick **M3U URL** and paste it. Tuner spots the credentials and switches to Xtream mode so you still get movies and series. Plain M3U links work too.

## Remote controls

The main controls match the onn 4K remote: the directional pad, center OK, Back, and Channel +/−. Use Left / Right in the top navigation, then OK to open Live TV, Movies, Series, Multi View, Streaming, Search, or Settings. Moving across the navigation keeps the current page open until you select a destination. Back from Movies or Series focuses its tab while keeping your place; a second Back returns to Live TV. Select a category shortcut to jump straight to its titles; returning from details restores your place. Settings includes **onn 4K remote**. Other remotes can also use Menu to focus navigation.

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
| Multi View | OK / arrows / Menu | Reveal controls while watching |
| Multi View | OK on a video with controls visible | Listen to that channel |
| Multi View | Channel +/- | Change the focused channel |
| Multi View | Back | Hide visible controls; press again to stop both and return to Live TV |

## Two-channel Multi View

Open **Multi View**, choose two different channels, then select **Watch both**. The picker offers search, Favorites, Most Watched and suggested sports. Browsing the picker never tunes a channel. During playback, choosing a replacement changes only that slot. Select **Side by side** or **Picture in Picture** to change the layout without reopening either stream. Press OK on a video or use the Audio button to choose the one audible channel. Save Favorites with the picker star or Hold OK.

Playback uses the full screen, without the app navigation or setup dashboard. Controls and channel labels disappear after five seconds; OK, an arrow or Menu brings them back. Picture in Picture fills the screen with the main channel and overlays the second channel in a corner. Side by side uses the full screen width with both pictures centered vertically. The original picture proportions are preserved so football scoreboards are not cropped or stretched. Back hides visible controls first; another Back returns to Live TV and stops both streams.

Multi View uses at most two concurrent live streams. It stops the ordinary guide/full-screen stream before starting. Leaving the page, changing playlists or putting the app in the background closes both connections; returning from the background restores the selected pair. A failed channel can be retried or replaced independently. Picture quality is capped at 1080p per slot to suit TV hardware. Two streams must be available within your provider account limit, including any playback on other devices.

## Picture-in-Picture

Select **Picture-in-Picture** in the full-screen player's actions to keep the video playing in Android's native floating window. Supported devices also enter PiP when you press Home during full-screen playback. The guide preview does not enter PiP. The native window provides play/pause and Android's expand/close controls; reopening Tuner restores the full-screen player and its controls. PiP requires device support and Android's per-app permission. Video keeps playing in PiP, including the embedded torrent player; closing the window stops or pauses playback according to the normal live/VOD background behavior.

## Guide data

Tuner saves the finished channel lineup, movie and series libraries, provider Most Watched, and current guide in private storage. Reopening restores these directly, skipping repeated provider parsing, country filtering and duplicate cleanup. Fresh channel snapshots last two hours, provider Most Watched twenty minutes, and movie/series snapshots twelve hours. Older saved libraries remain usable during a background refresh. Current and upcoming guide listings restore first while the full three-day guide loads separately.

Snapshots belong to the exact provider account and relevant format/market settings, and damaged snapshots are ignored. First setup or an edited provider still requires an initial download and preparation. Refresh preserves usable content; Clear cache removes both raw downloads and prepared snapshots. Clearing runs in the background and invalidates queued snapshot saves so canceled loads cannot recreate the cleared catalogs.

1. Your provider's XMLTV guide (or the EPG URL you set).
2. Free regional guides from epgshare01.online for any channel still missing listings, matched by channel name. Pick regions in Settings > Guide. Defaults: US national and US sports.
3. Xtream's per-channel short EPG for anything left, fetched as rows scroll into view.

## Content and Favorites

Live TV keeps U.S. channels using provider country labels, category labels, tagged names and U.S. EPG identifiers. Unknown or conflicting countries are hidden. Movies and Series show the complete provider library, including foreign and unlabelled titles. Audio language never blocks playback; English is preferred when available and other supported tracks remain selectable.

Settings > Guide > **Local stations** optionally limits local affiliates to Boston, Worcester and New Hampshire while preserving national cable, sports, events and entertainment. The supported market uses ZIP 01608 for Worcester; blank means all U.S. local markets. Nearby news stations appear in the **Local news** guide category. Filtering uses station identifiers and regional news brands before duplicate folding, so an outside-market affiliate cannot become a local station's backup. Movies and Series are unaffected. This setting is stored privately on the device and survives app updates.

Save channels with the guide Favorite button, Hold OK in the guide, a program's detail dialog, the Search result star, the full-screen player star or Hold OK, and the in-player channel list. The saved state updates immediately everywhere and persists separately for each playlist. Removing a Favorite preserves focus on a nearby channel in the Favorites list.

Continue Watching matches saved entries to the current movie or its playback backups and uses the current movie URL when reopening them. Duplicate channel copies are folded into one entry with playback backups, retaining Favorites and guide data. Empty and out-of-window event slots are hidden. Channels that fail on every backup with a missing-channel response are hidden for three days; Settings can restore them immediately. Authentication, connection-limit and provider-outage responses do not hide channels. Reuploaded movies with matching titles and years are merged into their newest copy, keeping earlier uploads as playback alternatives.

## Logos

Every channel shows a logo. Tuner tries the provider's logo, then the guide's icon, then the iptv-org open logo database, and finally draws a lettered tile.

## Settings

Themes (True Black, Midnight, Carbon, Ocean, Ember, Cable Blue, Daylight), multiple playlists, live format (TS or HLS), guide preview on/off, free guide regions, local stations, onn remote help, refresh, clear cache. In the theme picker, arrows preview a theme, OK saves it, and Back cancels the preview.

## Build

The **Streaming** tab, Settings > Torrentio, and the add-playlist screen all open the same integrated player. Paste the configured manifest link copied from Torrentio once. It is encrypted with an Android Keystore key and persists across app restarts. Movies and series discovery rows load automatically through JustWatch, with Cinemeta providing search, title details and episode metadata. Browse poster cards or search by title. Select a card to see its description, year, rating, runtime, genres and cast when available, then choose Play movie or an episode; IMDb IDs and manual stream choice are available under Advanced options but are not required.

Tuner tries the addon's streams in configured order and automatically moves to the next candidate on playback failure, preserving the playback position. The configured sort, quality exclusions and size limits apply. Stream lookups are cached in memory for five minutes, and signed stream URLs are not written to Continue Watching. Returning from playback restores the selected title, episode, search and scroll position.

HTTP(S) streams use your optional debrid account. With Debrid Provider set to None, the embedded jlibtorrent engine downloads the requested torrent file progressively into private temporary storage. Only verified pieces are passed to Media3; seek positions get priority over intervening pieces. Free playback depends on available peers and requires enough storage for the selected file plus a 512MB reserve. The torrent pauses in the background, and exiting playback stops it and removes temporary files. External links and streams requiring custom headers are excluded. Untagged and foreign audio are allowed without a verification step. Provider outages, absent peers, unsupported device codecs and unavailable streams can still prevent playback; Retry and available backups provide recovery.

Both build types use the LumaNest application ID `tv.lumanest.tuner`. Debug builds use the shared release key when available so device tests can update the same installation without clearing its data. Install the signed release APK for normal use. jlibtorrent JNI libraries for ARM, ARM64, x86 and x86_64 are obtained from FrostWire's official Maven repository and unpacked automatically during the build.

Build from `apps/android` with JDK 17, the Android SDK (platform 35), and the checked-in Gradle 8.11.1 wrapper. Set `JAVA_HOME` to your JDK and `ANDROID_HOME` to your SDK. Alternatively, create an ignored `local.properties` in this folder containing `sdk.dir` for your SDK location. Do not commit local SDK paths.

```powershell
cd apps/android
.\gradlew.bat assembleRelease
```

On macOS or Linux, run `./gradlew assembleRelease` from the same folder. The wrapper downloads its pinned Gradle distribution when it is not cached; no global Gradle installation is required.

Output: `app\build\outputs\apk\release\app-release.apk` when the external release key is available. Without that key, Gradle produces `app-release-unsigned.apk`; CI never invents a replacement release key.

Keep the existing release key and signing properties private. Gradle checks signing configuration in this order: `-PtunerSigningProperties=/absolute/path/keystore.properties`, the `keystore.properties` file in `TUNER_SIGNING_DIR`, then `signing/android/keystore.properties` at the repository root. The repository-root `signing` directory is ignored by Git. For signing material stored elsewhere, set `TUNER_SIGNING_DIR` to its directory before building. A relative `storeFile` resolves beside the properties file; the required properties are `storeFile`, `keyAlias`, `storePassword`, and `keyPassword`. Never put passwords on the command line or include signing files in source archives.

The release certificate SHA-256 is `EC:6F:ED:26:F3:B6:88:C4:6A:CB:1A:55:2B:D0:B9:EE:8C:E8:C9:62:BA:B4:DB:74:51:DF:3F:35:A3:95:45:86`. Keep a private backup of the signing material; all future release updates must use this key. An APK signed with another key cannot update the installed release.

Tests (parsers, content policy, name matching, remote navigation, and Robolectric screenshots written to `app\build\screens`):

```powershell
.\gradlew.bat testDebugUnitTest
```

Screenshot coverage includes Live TV, Movies, Series, playback controls, themes, and a compact 720 × 405 dp layout. Robolectric's native dependencies require a supported host architecture; on Windows ARM, use an x64 JDK under Windows emulation for these tests.

## Notes

- Playlist logins are stored in the app's private storage on the TV.
- Most IPTV servers use plain http, so cleartext traffic is allowed.
- Built with Kotlin, Jetpack Compose, Media3 ExoPlayer, OkHttp and Coil.

Torrentio debrid status videos are detected before playback. A blocked AllDebrid connection shows account/email approval instructions instead of looping through audio checks; downloading and expired-account notices are also explained.

The Streaming page has separate Movies and Series views with automatic US discovery rows: New Releases (recent films newly added to subscription streaming in the past seven days), New Series, New Episodes, Popular Now, and Top Netflix, Paramount+, AMC+, Prime Video, Disney+, HBO Max, Hulu, Apple TV+ and Peacock. Provider names are resolved from JustWatch's current US provider list, and Top means JustWatch popularity within the provider catalog, not the provider's official viewing chart. New Episodes uses Cinemeta air dates for recently added and popular US series, excludes future/undated episodes, and links directly to the correct episode. Discovery listings do not guarantee a working Torrentio stream.

Rows refresh every six hours while browsing, and expired rows refresh when the page opens. Public catalog metadata is cached in private cache storage so returning to the page is fast. Each row shows its update time, stale data is marked Cached, failed updates show a retry message, and Refresh requests fresh data. Discovery calls never include the Torrentio manifest or debrid key. The public JustWatch GraphQL service is undocumented and may change; errors are surfaced rather than replaced with fabricated lists.
