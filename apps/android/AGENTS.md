# Tuner by LumaNest TV: notes for coding agents

IPTV player for Android TV / Google TV. Kotlin, Jetpack Compose (no tv-material), Media3 ExoPlayer, OkHttp, Coil 2. Single activity, no DI, no Room.

## Build and test (PowerShell, from this folder)

Use JDK 17 and Android SDK platform 35. Set `JAVA_HOME` and `ANDROID_HOME`, or keep the SDK path in ignored `local.properties`. The checked-in wrapper uses Gradle 8.11.1.

    .\gradlew.bat assembleRelease        # app\build\outputs\apk\release\app-release.apk (release-key signed when the external key is available)
    .\gradlew.bat testDebugUnitTest      # parsers, name matching, Robolectric screenshots -> app\build\screens

Signing configuration is private. `-PtunerSigningProperties` takes precedence over `TUNER_SIGNING_DIR`, followed by the ignored repository-root `signing/android/keystore.properties`. Without the existing release key, release builds remain unsigned. Never create a replacement release key or commit signing properties, certificates, or SDK paths.

Install on a test TV after its owner pairs wireless debugging:

    & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" connect <TV-IP>:<DEBUG-PORT>
    & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\release\app-release.apk

The connect port changes if wireless debugging is toggled; `adb mdns services` lists the current one.

## Layout (app/src/main/java/tv/lumanest/tuner)

- `data/Repo.kt`: single source of truth. Loads the active source, holds StateFlows for channels, VOD, series, trending; guide data keyed by Channel.key; logo fallback index.
- `data/Xtream.kt`: player_api.php client and streaming JSON parsers. Providers repeat items once per category, so parsers merge by id into `categoryIds`. Prefers `direct_source` URLs.
- `data/M3u.kt`, `data/Xmltv.kt`: streaming parsers. XMLTV keeps only wanted channels inside a time window.
- `data/ChannelMatch.kt`: fuzzy name keys ("US: CNN HD" == "CNN") for guide and logo matching.
- `data/FreeEpg.kt`: epgshare01 regional guides used to fill channels the provider guide misses.
- `data/PhoneSetup.kt`: tiny LAN web form (port 8686) served while the add-playlist screen is open.
- `player/PlayerHolder.kt`: one shared ExoPlayer; guide preview and full screen reuse it.
- `ui/Guide.kt`: cable-style grid. One focusable grid with custom D-pad handling (not per-cell focus) for speed with 17k channels. Key handling reads state, not the last composition.
- `ui/Browse.kt`, `ui/Details.kt`: Movies / Series rows and detail pages. `ui/Player.kt`: live + VOD player.
- `ui/TvTextField.kt`: opens a native AlertDialog EditText. Compose text fields were unreliable with the Google TV remote keyboard.
- `ui/Common.kt`: `Palette` (theme-aware, snapshot state), `Themes`, `FocusBox` (the standard D-pad target).

## Gotchas

- Every Lazy list key must be unique. Duplicate provider ids crashed Movies in 1.0.1; keep merging in the parsers.
- Clickable is only focusable in keyboard input mode. Tests force `InputMode.Keyboard` to match a TV.
- Example provider: Xtream API at https://mybunny.tv, streams served from turbobunny.net (about 17k live, 17.6k movies, 3.8k series).
- No em dashes in user-facing text or docs.
