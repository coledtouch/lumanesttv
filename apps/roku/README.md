# Tuner for Roku

This is the Roku app in the LumaNest TV monorepo. It is a SceneGraph app with the channel ID still to be assigned by the Roku Developer Dashboard. It pairs with a phone through `lumanest.tv/pair`, then shows a menu along the top: **Home**, **Live TV**, **Discover**, **Library**, **Search** and **Settings**. Movies and series follow the shared design in [`docs/browse.md`](../../docs/browse.md).

- **Pairing:** the first screen shows a QR code and an 8-letter code from `https://lumanest.tv/api/pair/` (device `roku`). The customer approves it on their phone, and the TV saves the line in its registry. **Settings → Pair again** forgets it.
- **Home:** rows of 2:3 posters, each ending in a **See all** tile that opens Discover on that list: Continue watching, Popular and Featured (trending this week), one pair of rows per streaming service (Netflix, Disney+, Max, Prime Video, Apple TV+, Hulu, Paramount+, Peacock), Recently added and Top rated, each for Movies and for Series. A row shows only when it has at least 5 titles, and holds up to 20. A check badge marks titles in the Library and a bar shows how far you got.
- **Live TV:** categories on the left and their channels on the right, as before.
- **Discover:** **Type** (Movies or Series), **List** (Popular, Featured, Top rated, Recently added, A–Z or a streaming service) and **Genre** above a poster grid that keeps loading as you scroll. A title's genres come from TMDB, else from the provider's genre field, else from a category named after a genre (such as "EN | Action Movies" or "Kids & Family").
- **Library:** Continue watching, Favorite movies, Favorite series and Recently watched. Press **\*** on any poster (or **Add to Library** on its details) to add or remove a favorite. The Library is kept in the TV's registry for the paired line.
- **Search:** movies, series and live channels whose names contain what you type.
- **Details:** OK on a poster opens Play (or **Resume** and **Play from the start**) and Add to Library. A series lists its episodes; after an episode ends, the next one is **up next** in Continue watching.
- **Playback:** Xtream lines play live channels as HLS (`/live/…/<id>.m3u8`), movies and episodes from `/movie/` and `/series/`. An M3U line is supported too, with Live TV and whatever movies or episodes its links point to. Movie and episode positions are saved when you stop, when a title ends and every two minutes while it plays.
- **Subtitles while watching:** press **\*** (Options) to choose *Off* or a subtitle track by language. When a stream has no subtitle tracks, the menu says so and still offers broadcast captions (CC). **Back** closes the menu.
- **Remote:** **Back** always goes up one level (details or a panel closes, a section returns to the menu, the menu returns to Home, and Back on Home's menu leaves the app). **OK** selects. The focused item is always highlighted.
- **First load:** the app reads the whole catalogue once at start-up. A large line can take a minute or two, and the status line says so.

## Which movies and series appear

- **Only titles on the line.** The line's own lists (`get_vod_streams`, `get_series`) are the only source of titles. The popularity lists only pick and order titles from them.
- **Movies & Series: USA only** (Settings, on by default, separate from the Channels switch). A title is shown only if its provider category has no other country or language tag (`FR`, `DE`, `IT`, `ES`, `LAT`, `MX`, `BR`, `PT`, `TR`, `AR`, `IN`, `HINDI`, `PK`, `NL`, `PL`, `RO`, `RU`, `UK` or `CA` in capitals as a whole word or a `XX |`, `|XX|` or `XX:` prefix, or the country or language written out, such as French, Latino or Tamil) and, when it is matched to TMDB and TMDB gives its countries, only if they include the US. A match with no countries (`"origin": []`) goes by its category alone. `IN` and `IT` count only as a tag (at the start or end of the name or next to `|`, `:`, `-`, `/`, brackets or parentheses), so "MOVIES IN 4K" is kept, the same rule as the Android app. **All** shows every movie and series on the line.
- **Adult content** follows the same rules as Live TV: hidden until unlocked with the passcode.

## Popular, Featured and streaming-service lists

The app reads `GET https://lumanest.tv/api/catalog/rows?v=1` (no login) while the catalogue loads, waiting at most 20 seconds from the start of that request, keeps the answer for 12 hours in `cachefs:` (or `tmp:` on Rokus without it) and uses the older copy when a refresh fails or the server answers anything but 200 (it answers 503 when TMDB fails and it has no lists yet). **Settings → Refresh library** fetches it again. Line titles are matched to TMDB by the TMDB id the provider sends, or else by normalized title and year (a year apart still matches).

TMDB's free API key is for non-commercial use only. LumaNest TV is a business, so the owner must get TMDB's commercial terms before turning the key on for the site. Until then the endpoint answers `"source": "none"`, and the app still works: Popular and Featured rows are hidden, streaming-service rows come from provider categories named after the service (Netflix, Disney, HBO or Max, Prime or Amazon, Apple, Hulu, Paramount, Peacock), Recently added uses the provider's `added` or `last_modified` dates and Top rated uses the provider's ratings. When TMDB lists are in use, **Settings → About** says: "This product uses the TMDB API but is not endorsed or certified by TMDB."

## Settings

- **Movies & Series:** *USA only* (default) or *All*, as above.
- **Channels:** *All* shows every live category on the line, as chosen in the customer hub. *USA only* keeps categories labelled US, USA or United States, or named after a US sports league.
- **Category order:** Featured (Sports, Premium and News first), the customer hub's order, or A to Z.
- **Open on:** *Home* (default) or *Live TV*.
- **Subtitles:** *Off* or *On*, saved on the TV. When on, the app turns on Roku captions for the video (`globalCaptionMode`) and picks the subtitle track in the language chosen last time, then English, then the first track. Live channels usually carry broadcast CEA-608 captions, which Roku draws itself.
- **Adult content:** *Locked* by default. Categories named XXX, Adult, Adults, 18+ or Porn (but not Adult Swim), and anything the Xtream server flags `is_adult`, are hidden in Live TV, Home, Discover, Library and Search. Unlocking asks for a 4-digit passcode; the first time, you create and confirm one. Five wrong tries mean a 60-second wait. Locking needs no passcode, and the app locks again each time it opens. **Change passcode** asks for the current one first. Only a salted SHA-256 hash of the passcode is stored. **Forgot the passcode?** Remove the app from the Roku and reinstall it. Roku deletes an app's saved data when it is removed, so the passcode is cleared and you pair again.
- **Refresh library**, **Pair again** and **About** (version, where the lists come from, TMDB attribution).

## Code

- `source/lib/BrowseLogic.brs`: the browsing rules as plain functions (title normalization, TMDB matching, USA filter, adult names, the rows payload, Home rows, Discover lists, search and the Library store). The catalog task, the screen and the tests all use it.
- `components/ApiTask.brs` and `components/RowsClient.brs`: network work off the render thread (pairing, catalogue, the rows endpoint and its cache, a title's details).
- `components/MainScene.*` and `components/scene/*.brs`: the screens. `PosterItem`, `TileNode` and `ChipBar` are the poster tile, its content and the chip row used for the menu and the Discover filters.

## Check and package

Use Node.js 18 or newer. From the repository root, run `cd apps/roku`, then:

```powershell
npm install --no-package-lock
npm run check
npm run build
```

`check` compiles every BrightScript and SceneGraph file, and the unit tests, with BrighterScript and fails on errors. `build` writes the sideload package to the ignored `output/roku/tuner-roku.zip`.

## Unit tests (on a Roku)

The browsing rules have BrightScript unit tests in `tests/`. They run on a Roku in Developer Mode:

1. `npm run build:tests` writes `output/roku/tuner-roku-tests.zip` (the tests and `source/lib`, without the app's screens).
2. Upload it to the Roku as below, then open a terminal on the same network and run `telnet <roku-ip> 8085` to see the debug console.
3. The TV shows the totals ("N passed, 0 failed"). The console prints `TUNER TESTS PASSED`, or `TUNER TESTS FAILED` with one `FAIL` line per failed check.
4. Install `tuner-roku.zip` again afterwards; the test package replaces the app because a Roku keeps one developer app at a time.

## Install on your Roku for testing

1. Turn on Developer Mode: on the Roku remote press **Home ×3, Up ×2, Right, Left, Right, Left, Right**, accept the agreement and set a developer password. Keep the password private.
2. Open the address the Roku shows, for example `http://192.168.1.50`, in a browser on the same network and sign in as `rokudev` with that password.
3. Upload `tuner-roku.zip` and choose **Install**. The app opens on the TV.

A sideloaded app stays installed until another one replaces it. Only one developer app can be installed at a time.

## Publish

Create the app in the Roku Developer Dashboard, upload the same zip as a package and complete the store listing. See `docs/store-listings.md`. Roku certification tests the pairing flow, playback and the Back button on every screen.
