# Tuner for Apple TV

Tuner by LumaNest TV for Apple TV: live TV with a guide, movies and series, for LumaNest TV subscribers, sold through the App Store. tvOS 17 and later, SwiftUI, no third-party code.

- **Bundle ID:** `app.tunertv` (the tests: `app.tunertv.tests`).
- **One edition, made for App Review:** adult categories, channels and titles are never shown and there is no unlock; no Home rows or Discover lists are named after streaming services; nothing in the app sells or links to plans. The app names only `tunertv.app/privacy` and `tunertv.app/support` (the privacy policy is on the Welcome, Sign in, Pair and Settings screens). Manual sign-in takes a server login only; playlist links arrive only through pairing.
- **Store listing, privacy answers and review notes:** [`docs/store-listings.md`](../../docs/store-listings.md#apple-tv-app-store).

| Path | What it is |
| --- | --- |
| `project.yml` | The Xcode project, as an [XcodeGen](https://github.com/yonaskolb/XcodeGen) spec. `Tuner.xcodeproj` and `Tuner/Info.plist` are generated from it and not committed. |
| `Config/Tuner.xcconfig` | Includes `Config/Signing.local.xcconfig` (gitignored), where your team ID goes. |
| `TunerCore/` | Swift package with everything that doesn't need UIKit, AVFoundation or Network.framework: provider API and playlist parsing, the adult filter, catalogue cache, guide, browse rows, pairing, library storage, and the MPEG-TS → HLS repackager behind playback. Builds and tests on Linux and macOS. |
| `Tuner/App` | The app, the app model, routes. |
| `Tuner/Services` | The local HTTP server, the player controller and full-screen player, Keychain, QR codes, pairing. |
| `Tuner/Views` | Home, Live TV, Discover, Library, Search, Settings, detail pages, pairing and sign-in. |
| `Tuner/Resources` | The asset catalog (icons, Top Shelf, colours) and the privacy manifest. |
| `TunerTests/` | Unit tests that run inside the app on the tvOS Simulator. |
| `tools/make_assets.py` | Redraws every icon and Top Shelf image (Python 3 with Pillow). |

## What you need

- A Mac with **Xcode 26.6** (needs macOS Tahoe 26.2 or later) or **Xcode 27** (macOS Tahoe 26.6 or later), from the Mac App Store. Open Xcode once and install the **tvOS** platform when it asks (or Xcode → Settings → Components).
- [Homebrew](https://brew.sh), for XcodeGen.
- The **Apple Developer Program** (US$99 a year), needed to run on your own Apple TV for more than a few days and to publish. Enroll as an **organization** (LumaNest TV), which needs a free D-U-N-S number; the App Store shows the organization's legal name as the seller.
- An Apple TV HD or Apple TV 4K on the same network as the Mac, for testing on a real TV.

From **April 2027**, App Store uploads must be built with the tvOS 27 SDK, that is Xcode 27. The GitHub build (below) uses Xcode 26.6 because the runner image has no Xcode 27 yet; build releases on your Mac with Xcode 27 from then on.

## Set up the project (once)

```sh
brew install xcodegen
cd apps/tvos
xcodegen generate
open Tuner.xcodeproj
```

Then set your team, once:

1. Find your **Team ID**: developer.apple.com/account → Membership details (10 characters, such as `ABCDE12345`).
2. Create `apps/tvos/Config/Signing.local.xcconfig` with this one line (the file is gitignored):
   ```
   DEVELOPMENT_TEAM = ABCDE12345
   ```
3. In Xcode, select the **Tuner** target → Signing & Capabilities and check that "Automatically manage signing" is on and your team shows. Xcode registers the bundle ID `app.tunertv` for you the first time it signs.

Run `xcodegen generate` again whenever `project.yml` changes or files are added or removed (Xcode reloads the project). Edits inside existing files don't need it.

## Run it

**In the Simulator:** choose the **Tuner** scheme and an "Apple TV 4K (3rd generation)" simulator, then Product → Run (⌘R). Use the arrow keys and Return (Escape is Back), or the Simulator's on-screen Apple TV Remote from its Window menu.

**On your Apple TV, over the network:**

1. On the Apple TV: Settings → Remotes and Devices → Remote App and Devices, and leave that screen open.
2. In Xcode: Window → Devices and Simulators. The Apple TV appears under Discovered; choose **Pair** and type the code the TV shows.
3. If the Apple TV asks for Developer Mode, turn it on (Settings → Privacy & Security → Developer Mode) and let it restart.
4. Choose the Apple TV as the run destination and Product → Run (⌘R). Tuner stays installed on the TV afterwards.

**Sign in:** scan the QR code with your phone and approve at lumanest.tv/pair (this needs the site change that adds the `appletv` device to be deployed), or choose "Sign in with your login instead" and type the server address, username and password with the remote.

**Tests:**

```sh
cd apps/tvos/TunerCore && swift test     # TunerCore, on the Mac (or Linux)
```

and Product → Test (⌘U) in Xcode for the app's tests on the Simulator. The Keychain test is skipped on unsigned builds.

TunerCore's tests also run the `live_category` and `vtt_cues` cases of [`docs/extras-cases.json`](../../docs/extras-cases.json) (the hidden live category and the WebVTT reader) from a copy in `TunerCore/Tests/TunerCoreTests/Fixtures/extras-cases.json`, checked against the repository's file the same way; after changing those cases:

```sh
cp docs/extras-cases.json apps/tvos/TunerCore/Tests/TunerCoreTests/Fixtures/extras-cases.json
```

TunerCore's tests run every case in [`docs/browse-cases.json`](../../docs/browse-cases.json), the Movies & Series cases all Tuner apps share (category filter, title normalization, USA only, the provider TMDB id, each `tmdb` row read by the catalogue's own JSON reader, and the name and group of every M3U playlist entry, each `m3u` playlist read by `M3UParser`), from a copy in `TunerCore/Tests/TunerCoreTests/Fixtures/browse-cases.json`. A test fails when the copy differs from the repository's file, or when a case has a kind `BrowseCasesTests` doesn't run, so after changing the cases, copy them again:

```sh
cp docs/browse-cases.json apps/tvos/TunerCore/Tests/TunerCoreTests/Fixtures/browse-cases.json
```

## Release to TestFlight and the App Store

1. In `project.yml`, raise `CURRENT_PROJECT_VERSION` (every upload needs a new build number), and `MARKETING_VERSION` for a new version (`1.0.1`, `1.1.0`, …). Run `xcodegen generate`.
2. First release only: App Store Connect → Apps → + → New App, platform **tvOS**, name "Tuner by LumaNest TV", bundle ID `app.tunertv`, SKU `tuner-appletv`.
3. In Xcode, choose **Any tvOS Device (arm64)** as the destination, then Product → **Archive**.
4. The Organizer opens. Select the archive → **Distribute App** → **App Store Connect** → **Upload**, keep the defaults (automatic signing) and upload.
5. After processing (usually 10 to 30 minutes), App Store Connect → TestFlight: add yourself as an internal tester, install **TestFlight** from the App Store on the Apple TV and test the build. Go through the device checks below.
6. App Store tab: fill in the listing, App Privacy, age rating, content rights and App Review Information from [`docs/store-listings.md`](../../docs/store-listings.md#apple-tv-app-store), select the build, then **Add for Review** → **Submit to App Review**.

Before the first submission: deploy the site change that adds the `appletv` pairing device, give lumanest.tv/pair a header and footer without the Plans, Renew and customer hub links (the QR code leads there), deploy `tuner-site/` (its privacy policy covers the Apple TV app), and give the reviewers a server login whose server address works and whose lineup Apple TV can play (see the listing doc).

## How playback works

- **Live TV.** The provider sends live channels as endless MPEG-TS over plain HTTP, which AVPlayer can't open. TunerCore's `LiveChannelSession` holds the line's single connection, waits out the provider's "line busy" clip, rejoins when the stream goes quiet for 8 seconds and splices the new connection in (an error answer while rejoining is retried, then the channel's backup addresses; a channel that was playing is never hidden for it), and cuts the stream into 2- to 6-second HLS segments (pass-through MPEG-TS, no transcoding) under a 12-second target duration, which gives AVPlayer 18 seconds before it gives up on a playlist that stopped changing while a connection is replaced. `LoopbackServer` serves them to AVPlayer from `http://127.0.0.1:<port>`, listening on the loopback interface only, with a port the system picks. The guide preview and the full-screen player share one AVPlayer, so going full screen never opens a second connection. Channel up/down in full screen goes through AVKit's channel-skip delegate.
- **What plays:** H.264 video with AAC, AC-3, E-AC-3 or MP3 sound. Channels with MPEG Layer II or LATM sound play without sound after a first try, with a message. HEVC and MPEG-2 channels show "This channel uses a video format Apple TV can't play from your provider." (A later version can add an fMP4 writer for them.)
- **Movies and episodes.** MP4, M4V and MOV files play through the same local server as a byte-range proxy (still one connection; a newer request or Back cancels an older one that is still waiting for the line). Titles the provider serves as HLS (`.m3u8`) go to AVPlayer directly. MKV, AVI, TS and similar uploads aren't offered on Apple TV: movies are left out, and episodes show "Not available on Apple TV".
- **Captions and subtitles.** Closed captions (CEA-608, declared for every H.264 channel so they appear even when a channel is tuned during an ad without them) in live channels and subtitles inside a file follow Settings → Playback → Subtitles (Automatic follows the Apple TV's own setting). A title's separate subtitle files (SRT, WebVTT, SSA, TTML) are in the player's "Subtitle files" menu.
- **English subtitles from OpenSubtitles** ([`docs/extras.md`](../../docs/extras.md)). When a movie or episode starts, Tuner asks lumanest.tv (`/api/extras/subtitles`, with the title's TMDB id, the series' id with the season and episode, or the name and year) which OpenSubtitles files exist, and lists up to three in "Subtitle files" after the provider's, with the line "Subtitles provided by OpenSubtitles.com" under them (also in Settings → About). A file is downloaded only when it is shown: picked in the menu, or picked by Subtitles On (or Automatic with the Apple TV's captions on) when the stream and the provider have no English subtitles. Tuner draws the cues itself, as plain text in a label over the video, following the player's position. Files are kept in Caches/Subtitles for 7 days (at most 20); lookups are kept in memory for the session. Without the lumanest.tv secrets the lookup finds nothing and the menu looks as before.
- **Trailers.** Movie and series pages ask lumanest.tv (`/api/extras/trailer`) for the title's YouTube trailer and show **Trailer** after Add to Library only when there is one. It opens the YouTube app (`youtube://watch/<key>`); without the YouTube app, a QR code for a phone.
- **"Most watched now".** The provider's rotating "Most watched now" live category is hidden by its name (`isHiddenLiveCategory`, docs/extras.md), with the channels listed only there; Tuner's own Most Watched stays.
- **Storage.** Settings, Favorites, history and resume points are in UserDefaults (tvOS's small persistent store); line passwords are in the Keychain; catalogues, the guide and artwork are in Caches, which tvOS may clear at any time (Tuner downloads them again).

## Checks on a real Apple TV

The Simulator can't stand in for these:

- Time to first picture after Select (aim for 2 to 5 seconds) and fast channel flipping in full screen.
- A single-connection line: the busy message, and that going full screen or flipping never opens a second connection.
- Pull the network cable mid-channel and plug it back: the channel rejoins (within about 15 seconds the picture continues without AVPlayer restarting the item).
- "Watch full screen" from a channel's long-press menu and "Watch live" from a programme's details sheet open the player (it waits for the menu or sheet to close).
- Channels with AC-3, E-AC-3, MPEG Layer II and HEVC; closed captions on a channel that has them.
- A movie: resume point, Start over, sidecar subtitles; a series: Resume, the next episode playing on its own.
- Home button and back: live stops (the line is freed) and comes back; a movie resumes where it was.
- An IPv6-only network (NAT64), which App Review uses: on the Mac, System Settings → General → Sharing, hold Option and open Internet Sharing's settings (ⓘ) to turn on "Create NAT64 Network", and join the Apple TV to that Wi-Fi.
- Memory after an hour of live TV (Xcode → Debug Navigator).
- Trailer: on an Apple TV with YouTube installed, the YouTube app opens on the video (the `youtube://watch/<key>` link comes from community code, not Apple or Google docs); without YouTube, the QR sheet appears and Close returns to Trailer.
- OpenSubtitles (once the lumanest.tv secrets are set): the tracks and the dimmed credit line in "Subtitle files"; cues in step with the picture after seeking and while paused; choosing a subtitle track in the player's own menu turns the file off; Subtitles On picks the first OpenSubtitles track for a title with no English subtitles.

## Artwork

```sh
cd apps/tvos
python3 tools/make_assets.py Tuner/Resources/Assets.xcassets   # needs: pip install Pillow
```

It redraws the layered Home Screen icon (400×240 and 800×480), the layered App Store icon (1280×768), Top Shelf (1920×720, 3840×1440), Top Shelf Wide (2320×720, 4640×1440) and the colour sets, from the brand colours (#141224, #7C3AED, #AB73EF and white). Commit the results.

## Automatic checks

`.github/workflows/tvos.yml` runs on every change under `apps/tvos`:

- **TunerCore on Linux** with the Swift versions of Xcode 26.6 (6.3.3) and Xcode 27 (6.4.1).
- **The app on macOS** (Xcode 26.6): XcodeGen 2.46.0 (checksum pinned), a check of the generated Info.plist, the app's tests on the tvOS 26.5 Simulator, an unsigned Release build for devices (even when the tests failed), then TunerCore's tests on macOS. Nothing is signed or uploaded there.
- Code outside TunerCore that names TunerCore's `Category` type must write `TunerCore.Category`: on Apple platforms Foundation also brings in the Objective-C runtime's `Category`, so a bare `[Category]` doesn't compile there (Linux doesn't notice).

When a newer XcodeGen is released (2.46.0 has a fix pending for Xcode 27.2), update `XCODEGEN_VERSION` and `XCODEGEN_SHA256` in the workflow together. If the app's tests ever fail with "No such module 'TunerCore'", the test target's `SWIFT_INCLUDE_PATHS` in `project.yml` is the place to look.
