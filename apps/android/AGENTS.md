# Tuner by LumaNest TV: notes for coding agents

IPTV player for Android TV / Google TV. Kotlin, Jetpack Compose (no tv-material), Media3 ExoPlayer, OkHttp, Coil 2. Single activity, no DI, no Room.

## Build and test (PowerShell, from this folder)

Use JDK 17 and Android SDK platform 37. Set `JAVA_HOME` and `ANDROID_HOME`, or keep the SDK path in ignored `local.properties`. The checked-in wrapper uses Gradle 9.8.1.

    .\gradlew.bat assembleRelease        # app\build\outputs\apk\release\app-release.apk (release-key signed when the external key is available)
    .\gradlew.bat testDebugUnitTest      # parsers, name matching, Robolectric screenshots -> app\build\screens
    .\gradlew.bat bundleRelease -Pstore=true    # store edition for Google Play -> app\build\outputs\bundle\release\app-store-release.aab
    .\gradlew.bat assembleRelease -Pstore=true  # store edition for Amazon -> app\build\outputs\apk\release\app-store-release.apk

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
- `data/BrowseCatalog.kt`, `data/CatalogRows.kt`, `data/CatalogRowsClient.kt`: Movies & Series browsing (docs/browse.md) in plain Kotlin. The popularity lists from lumanest.tv (12 h disk cache, stale copy on failure), TMDB matching, the "Movies & Series: USA only" rule, genres and every Home/Discover list, indexed off the main thread for `Repo.browse` by `BrowseBuilder`, which reuses the movie or series index whose inputs did not change. `Movie.aliases` (older uploads folded in by `Cleanup.movies`) keep Library keys and saved positions working after a re-upload.
- `ui/Browse.kt` (Home and Library poster rows), `ui/Discover.kt` (filters and grid), `ui/Details.kt` (detail pages, Add to Library). `ui/Player.kt`: live + VOD player.
- `ui/TvTextField.kt`: opens a native AlertDialog EditText. Compose text fields were unreliable with the Google TV remote keyboard.
- `ui/Common.kt`: `Palette` (theme-aware, snapshot state), `Themes`, `FocusBox` (the standard D-pad target).

## Gotchas

- Every Lazy list key must be unique. Duplicate provider ids crashed Movies in 1.0.1; keep merging in the parsers.
- Clickable is only focusable in keyboard input mode. Tests force `InputMode.Keyboard` to match a TV.
- Example provider: Xtream API at https://mybunny.tv, streams served from turbobunny.net (about 17k live, 17.6k movies, 3.8k series).
- No em dashes in user-facing text or docs.
- targetSdk stays 35. Google Play asks TV-only apps (the store edition) for API 34 only, and targeting 36 would let Android 16 ignore `screenOrientation="landscape"` for the lumanest.tv APK on tablets and Chromebooks. Robolectric 4.14 also stops at API 35.
- The store edition never names a streaming service (Netflix, Disney+, Max, Prime Video, Apple TV+, Hulu, Paramount+, Peacock) in Home rows or Discover lists: `StreamingServices.shown(store)`.
- Two editions, one codebase: `Edition.STORE` (`-Pstore=true`) is the Google Play / Amazon build. Keep the direct (lumanest.tv) edition's behaviour unchanged when adding store-only rules; screens and `Prefs` take a `store`/`storeBuild` parameter defaulting to `Edition.STORE`, and `Repo.storeEdition` switches the library rules, so tests cover both (`StoreEditionTest`, `StoreEditionScreensTest`, `StoreEditionLibraryTest`). CI also runs those three classes with `-Pstore=true`, so they must pass explicit edition values (the manifest test reads `Edition.STORE` on purpose); other tests assume the direct edition.
