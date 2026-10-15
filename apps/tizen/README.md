# Tuner for Samsung Tizen TV

This is the Samsung TV web application in the LumaNest TV monorepo, separate from `../android` and `../webos`. It provides Live TV with a guide and preview, Movies, Series, Search, Favorites and Settings, using a directional pad, OK and Back. The application/package IDs are `TunerTv001.Tuner` / `TunerTv001`; version is 1.4.9.

The runtime uses ES5 JavaScript, local HTML/CSS and Samsung's built-in AVPlay. HTTP(S) provider requests and artwork are allowed; scripts are restricted to the packaged application and the TV's local WebAPI library. No remote scripts, inline script handlers or eval are permitted. Provider accounts are entered on the device and must never be embedded in a widget or committed to source.

The first load of a new playlist downloads and prepares the provider's catalogs. Live TV, Movies and Series load independently, so each section becomes available when it finishes. Later launches restore the finished catalogs from the TV's private storage, without repeating their parsing and filtering. Fresh saved catalogs skip provider list requests for two hours for Live TV and twelve hours for Movies and Series. Older catalogs remain available while updates run in the background; guide listings load separately.

Changing the account, local ZIP or live stream format selects a separate cache. Refresh requests new provider lists while keeping the saved library available. Storage failures fall back to provider loading, with a bounded saved Live TV catalog where local storage permits it. The cache speeds up repeat launches; the first provider load still depends on the network and provider response. Cache identity metadata uses a SHA-256 digest of the account and lineup configuration.

## Prepare and check the widget

Use Node.js 18 or newer on the development PC. From the repository root, run `cd apps/tizen`, then:

```powershell
npm install --no-package-lock --ignore-scripts
npm run check
npm test
npm run build
```

The build copies only `config.xml`, `index.html`, `css/app.css`, the three runtime JavaScript files, and `assets/icon.png`. Tools, tests, node_modules, provider exports, preferences and certificates are excluded. Outputs go to the repository's ignored `output/tizen` directory (`../../output/tizen` from here). Every build creates clean staging, validates ES5 syntax, application identifiers, privileges, CSP and ZIP checksums, and produces `Tuner-1.4.9-tizen-UNSIGNED.wgt`. Pass an output folder to `node tools/build.js <output-folder>` or use the PowerShell packager's `-OutputDirectory` option to choose another location.

**The unsigned widget is a staging artifact. It cannot be installed on a physical Samsung TV.** It needs a Samsung author/distributor certificate profile containing the target TV's DUID.

For a local browser preview:

```powershell
npm run serve
```

Open `http://127.0.0.1:8181`. This preview uses HTML video when available; it does not simulate or validate Samsung AVPlay, TV codecs, device privileges or certificate installation. The server serves only runtime assets and never exposes private account or certificate files.

## Connect the TV

Samsung's [TV device setup](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html) requires Developer Mode:

1. Open the TV's Apps screen and enter **12345** using the remote's number panel.
2. Turn Developer Mode on and enter the development PC's current local IPv4 address.
3. Restart the TV as the setup screen instructs. The PC and TV must share the local network.

Find the TV address in its network settings. The included read-only discovery tool checks Samsung SSDP responses and known local neighbor addresses; it does not scan a subnet, wake a TV, pair a remote, launch apps or change settings:

```powershell
.\tools\Discover-Tv.ps1
# Or supply an address you already know:
.\tools\Discover-Tv.ps1 -KnownAddress <TV-IP>
```

It reports the TV's name, model and developer-port status. A closed port 26101 means the SDK cannot connect yet. Discovery metadata alone does not prove the device supports installing this widget.

## SDK and Samsung signing

Install the official Tizen SDK Web CLI and SDB, plus Certificate Manager and Samsung Certificate Extension. The application needs no IDE, native compiler or emulator. [Samsung's CLI guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html) documents packaging, installing and launching a TV widget. The official [Tizen SDK installer documentation](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/baseline-sdk/setup/install-sdk.md) documents command-line installation and package management. Retired Eclipse-based Tizen Studio IDE packages are unnecessary.

Windows SDK downloads are x64. Windows on ARM must run those tools through x64 emulation; this project does not claim official ARM host support. SDK tooling is kept outside app source, normally in the repository's ignored `output/tools/tizen/sdk` directory (`../../output/tools/tizen/sdk` from here). Set `TIZEN_SDK` or pass `-SdkPath` for another installation. Node-only validation and unsigned widget builds do not require this SDK.

Samsung's [certificate workflow](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html) includes an interactive Samsung account sign-in. Use Samsung Certificate Extension 2.0.73 or newer; [older versions cannot create certificates after September 2025](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html). Create a **Samsung TV** profile, create or select an author certificate, then issue a Samsung distributor certificate with the connected TV's DUID. Permit application installation for that device if the SDK requests it. A generic Tizen certificate or a self-signed ZIP is insufficient.

Open the standalone Certificate Manager with the included launcher:

```powershell
.\tools\Open-CertificateManager.ps1
```

This standalone Eclipse-based tool requires its bundled x64 Java 8 runtime. The launcher supplies compatible JVM arguments; Java 17 fails because the tool depends on the removed `javax.annotation` classes. This runtime choice applies to the certificate tool, not the web application's TV JavaScript. A different Java 8 installation can be supplied with `-JavaPath` pointing to its `javaw.exe`.

Keep author/distributor certificates, passwords and `profiles.xml` private and out of Git. The default private folder is the repository's ignored `signing/tizen` directory (`../../signing/tizen` from here), with the Certificate Manager workspace under that same private folder. An empty checkout does not reuse certificate profiles from a previous workspace. Preserve the author certificate for future updates. The private certificate profile must reference the actual private certificate paths; do not copy a profile into the widget. Set `TUNER_TIZEN_PROFILES` or pass `-ProfilesFile` to select another profile file, and use `-WorkspacePath` with the Certificate Manager launcher to select another private workspace, including a location outside the checkout. Do not put passwords in command arguments or documentation.

After that one-time profile setup:

```powershell
.\tools\Package-Tizen.ps1 -CertificateProfile TunerTV
.\tools\Install-Tizen.ps1 -TvAddress <TV-IP> -Widget ..\..\output\tizen\Tuner-1.4.9-tizen.wgt -Launch
```

The package script builds fresh staging, invokes the official signer and checks that both widget signature files exist. Their presence does not prove validity: the Samsung CLI and the target TV perform certificate validation. The installer rejects unsigned widgets, checks the developer port, uses an explicit device serial, and only launches Tuner when `-Launch` is supplied. It does not uninstall other applications or reset TV settings.

## Playback and port limits

AVPlay handles supported HTTP(S) live/VOD streams, seeking, available audio/subtitle tracks and fallback stream candidates. All audio languages remain available. Container/codec support, adaptive streaming, network behavior and track controls depend on the TV model, firmware and provider; successful desktop playback cannot establish TV compatibility. [Samsung's AVPlay guide](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html) describes the native player lifecycle and supported features.

Multiview targets **two live channels**, respecting a two-stream provider limit. On supported Tizen 7.0+ devices it uses two native AVPlayStore managers in Samsung's in-app MAIN/SUB multiview mode, with one audible channel. Ordinary single-channel playback remains available when a Samsung device cannot allocate dual players; the app reports the limitation. The browser preview uses two HTML video surfaces for UI checks, which does not verify native dual playback or the M7's decoder resources. A PC bridge is not required by this port. See the [AVPlayStore API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplaystore-api.html) for model-dependent native player support.

Active Multi View fills the viewport and hides the app header and setup dashboard. The main Picture in Picture feed covers the full screen; side-by-side feeds use the full width and preserve their picture proportions. Compact controls and channel labels hide after five seconds. OK, arrows or Menu reveals them without changing either stream. PiP borders hide with the controls, and unavailable slots leave no empty box over the main video. Back hides visible controls first; pressing Back while they are hidden leaves Multi View and stops both channels. Choosing a different layout resizes the same native players without reconnecting.

Native playback also checks for streams that silently stop advancing while AVPlay still reports Playing. After roughly 30 to 35 seconds without progress, only the stalled stream reconnects once, then tries its available backups if another stall occurs. The healthy channel and selected soundtrack are preserved. Recovery uses the same native decoder and closes its old connection first. Paused playback, seeking, background suspension and muted streams whose native clocks still advance do not trigger this recovery.

Audio switches retain both connections when the TV supports changing the active route. If native routing fails, Tuner uses the main picture's default audio instead. Make main promotes the chosen channel to the main picture and restarts both streams: both old connections close before either reopens, and the same two native managers are reused. This TV fallback briefly reloads the pictures when changing the audible channel. Native routing errors are never accepted as success based only on an audio flag. A failed channel remains unavailable for audio selection; recovery to the healthy channel follows the same safe audio path.

The Android embedded jlibtorrent engine is not part of this web widget. Raw magnets, peer-to-peer torrent downloading and Android Picture-in-Picture are unavailable. A direct HTTP(S) stream from a provider or a compatible debrid service is required; the Android Streaming/Torrentio discovery interface is not included in this initial Tizen port. Native DRM systems require an authorized license flow and device support; this widget does not bypass DRM or provide license integration. The guide preview is an in-app player surface, not system Picture-in-Picture.

Samsung runtime storage and network policies differ from Android. Accounts, Favorites and resume points are stored locally by this port; they are not automatically copied from the Android app. Browser tests verify UI/data logic and mocked player behavior, while a signed physical-TV test is still required for installation, playback and remote responsiveness.
