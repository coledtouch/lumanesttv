# Tuner for LG webOS TV

This directory contains the LG webOS application source for Tuner 1.2.1, application ID `tv.lumanest.tuner`. It is separate from the Android app and Samsung Tizen widget. Provider accounts are entered on the device and are stored locally. Do not put provider exports, saved preferences, TV connection details, or private keys in this directory.

The app uses packaged ES5 JavaScript, HTML, CSS and the TV's HTML video player. `js/webos-platform.js` selects that player instead of Samsung AVPlay and disables the Samsung dual-player entry point. Native Android Picture-in-Picture and the Android torrent engine are not included. Supported streams and codecs depend on the TV model and webOS version; desktop checks do not establish physical-TV playback compatibility.

## Shared sources

`js/data.js`, `js/player.js` and `js/app.js` are generated, minified, from the Samsung app in `../tizen/js`; `css/app.css` and `js/pairing.js` are copied from it. Make changes there, then run `npm run sync` here. `tools/sync-from-tizen.js` removes Multi View and the Samsung TV APIs and adds the LG Back key (461), PalmSystem exit, the LG YouTube launch and LG texts. `js/webos-platform.js` is LG's own source. `npm test` fails when the LG files are out of date. Home, Discover and Library for movies and series ([`docs/browse.md`](../../docs/browse.md), described under **Movies and series** in `../tizen/README.md`) come from the same sources. Remote navigation follows the Samsung app's model (see **Remote control** in `../tizen/README.md`); on LG the Back key is 461 everywhere, Channel +/− arrive as 33/34 and number keys as 48–57.

## Subtitles and adult content

Subtitles work for live channels, movies and episodes. While watching, the yellow key, a CC/subtitle key where the remote has one, or the **CC Subtitles** player button opens a chooser with Off and the stream's subtitle and caption tracks (`video.textTracks` of kind `subtitles` or `captions`; the TV's HTML video exposes HLS subtitle renditions and, for live HLS, embedded CEA-608/708 captions when present). The chosen track is set to `showing` and drawn by the TV; the others are `disabled`. Settings → **Subtitles: Off/On** sets the default: when On, each new stream selects an English track, or the first one, including tracks announced after playback starts.

Movies and episodes also get English subtitles from OpenSubtitles.com through lumanest.tv, exactly as in the Samsung app (see **Playback and port limits** in `../tizen/README.md` and [`docs/extras.md`](../../docs/extras.md)): the chooser lists them after the stream's tracks with the line "Subtitles provided by OpenSubtitles.com", and with Subtitles On the first one is shown when the stream has no English track. Tuner draws their cues itself as plain text at the video's `currentTime`, with every text track of the stream `disabled` meanwhile; it does not add a `<track>` element, which would need `crossorigin` on provider streams. A stream with neither shows "No subtitles in this stream".

**Trailer** on movie and series pages plays the trailer inside Tuner (since 1.2.1), as on Samsung: a full-screen overlay with lumanest.tv's trailer player page (`https://lumanest.tv/embed/trailer?v=1&k=<key>`) in an iframe; LG Back (461) closes it and focus returns to **Trailer** (see **Movies and series** in `../tizen/README.md`). `index.html`'s CSP adds `frame-src https://lumanest.tv; child-src https://lumanest.tv`, and `tools/app.js` accepts exactly that. When in-app playback fails (a player error, no "ready" within 12 seconds), Trailer opens the YouTube app on the video through `luna://com.webos.applicationManager/launch` (`youtube.leanback.v4` with `contentTarget` `https://www.youtube.com/tv?v=<key>`), called with `PalmServiceBridge` in `js/webos-platform.js`; `tools/sync-from-tizen.js` routes the Samsung launcher there. When YouTube is not installed (`errorCode` -101), the call is refused or no reply comes within 5 seconds, the TV shows the trailer's QR code for a phone instead. No `appinfo.json` permission is added. The provider's live category "Most watched now" is hidden by name, as on Samsung.

Adult categories are hidden by default across Live TV, Home, Discover, Library, the guide, Search, Favorites, Most Watched and Continue watching. A category is adult when the provider marks it or its streams `is_adult`, or its name contains a standalone XXX, Adult(s), 18+ or Porn (Adult Swim is not adult). Settings → **Adult content: Locked/Unlocked** unlocks them with a 4-digit passcode, created on first use by entering it twice; locking needs no passcode, and the lock returns when Tuner restarts. **Change passcode** asks for the current one. Five wrong entries impose a 60-second wait. Enter digits with the remote's number keys or the on-screen pad with the arrows and OK. Only a random salt and an iterated, salted SHA-256 digest are stored. A forgotten passcode is reset by reinstalling the app or clearing its data.

## Validate and prepare clean staging

Use Node.js 18 or newer. From the repository root, run `cd apps/webos`, then:

```powershell
npm install --no-package-lock --ignore-scripts
npm run check
npm test
npm run build
```

No external TV SDK or connection is needed for these commands. Validation checks the application identity, required assets, ES5 syntax, local script loading order, and content security policy. `npm test` also runs every case of `../../docs/browse-cases.json` against the generated `js/data.js`, with and without `String.prototype.normalize`, and the `live_category` and `vtt_cues` cases of `../../docs/extras-cases.json`. The build copies exactly nine runtime files to a fresh staging folder under the repository's ignored `output/webos` directory. Source tools, tests, dependencies, and account files do not enter that staging folder. To choose another output location, use `node tools/build.js <output-folder>`.

`npm run build` prepares source staging; it does not create or sign an IPK, install an SDK, connect to a TV, or install the app. The generated `build.json` contains the staging location and belongs in ignored output, not Git.

## Create a development IPK

Install the official [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-introduction) separately. The [LG CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide) documents `ares-package` and its `-o` and `--no-minify` options. From this directory, after building:

```powershell
$build = Get-Content ../../output/webos/build.json -Raw | ConvertFrom-Json
ares-package --no-minify -o ../../output/webos $build.staging
```

The expected package name is `tv.lumanest.tuner_1.2.1_all.ipk`. Package the clean staging folder, rather than this development directory, so private files and tooling stay excluded. `--no-minify` preserves the validated runtime files for development and debugging. LG's packager generates the package metadata from `appinfo.json`; no Samsung author/distributor certificate is used by this webOS workflow.

This is a development IPK, not a store-approved or production-signed release. To test on your own TV, follow LG's [Developer Mode setup](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app). Register the TV through the CLI, keep its Developer Mode session active, and use the chosen device name in the official installation and launch commands:

```powershell
ares-install --device myTV ../../output/webos/tv.lumanest.tuner_1.2.1_all.ipk
ares-launch --device myTV tv.lumanest.tuner
```

`myTV` is a placeholder for a device registered privately on your machine. Keep TV SSH keys and connection configuration outside this repository. Packaging does not grant device access, enable Developer Mode, or establish LG Content Store distribution. Validate installation, remote controls, login, channel changes, audio, and playback on the target TV before distributing a new package.
