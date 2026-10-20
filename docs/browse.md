# Movies & Series browsing (all Tuner apps)

This is the shared design for how every Tuner app (Android TV / Fire TV, Samsung, LG, Roku, Apple TV) presents movies and series. Each app implements it in its own UI toolkit and keeps its platform's remote conventions. Live TV keeps its guide and is not part of this change.

Subtitles from OpenSubtitles, the Trailer button and the hidden "Most watched now" live category are specified in [`extras.md`](extras.md), with their shared cases in `docs/extras-cases.json`.

## Navigation

Top-level sections, in this order: **Home**, **Live TV**, **Discover**, **Library**, **Search**, **Settings** (plus **Multi View** where the app has it). Home is the first section a returning customer lands on, unless the app's existing "start on Live TV" behaviour is kept as a setting.

### Home

A vertical list of horizontal poster rows. Each row has a title and ends with a **See all** tile that opens Discover pre-filtered to that row's list.

Row order (a row appears only if it has at least 5 playable titles):

1. **Continue watching** (movies in progress and the next episode of series in progress)
2. **Popular – Movies**, **Popular – Series**
3. **Featured – Movies**, **Featured – Series** (trending this week)
4. One pair per streaming service, in this order: **Netflix**, **Disney+**, **Max**, **Prime Video**, **Apple TV+**, **Hulu**, **Paramount+**, **Peacock** (for example "Netflix – Movies", "Netflix – Series")
5. **Recently added – Movies**, **Recently added – Series**
6. **Top rated – Movies**, **Top rated – Series**

Rows show up to 20 titles. Posters are 2:3. A small check badge marks titles in the customer's Library (favorite) and a progress bar marks titles in progress.

### Discover

Three filters at the top and a poster grid below:

- **Type:** Movies or Series.
- **List:** Popular, Featured, Top rated, Recently added, A–Z, and one entry per streaming service above.
- **Genre:** All (default) or one genre.

The grid pages or scrolls without limit. See all on Home opens Discover with Type and List set.

### Library

Continue watching, Favorite movies, Favorite series, and Recently watched. Favorites use each app's existing favorites store.

## Which titles appear

- **Only playable titles.** The customer's own catalogue (the Xtream `get_vod_streams` / `get_series` lists) is the only source of titles. Popularity lists only order and pick from it; a title that isn't in the catalogue is never shown.
- **USA only by default.** A Settings switch, "Movies & Series: USA only / All", defaults to USA only (separate from the existing live-channel switch). With it on:
  - a title matched to TMDB is shown only if its provider category passes the category filter below **and** its `origin` countries include `US` (see Origin countries below: `US`, `us` and ` US` count, `USA` does not). When `origin` holds no country (`[]` because TMDB gave none, or only entries such as `USA` that are not one), the countries are unknown, so the category filter alone decides. The category check keeps out US titles filed in foreign-language categories, which are usually dubbed copies;
  - an unmatched title is shown only if its provider category passes the category filter;
  - a title's categories are the `category_id` and `category_ids` of every provider row with its id (for an M3U entry, its group: see M3U playlists). Ids missing from the provider's category list are left out. The category passes when no category is left or at least one of them is not foreign.
- **Adult content** follows the existing rules (hidden by default, passcode unlock on sideload builds, never shown in store builds).

### Spaces and letter case

Two rules hold for everything below: the category filter, origin countries, normalize and years.

- **Unicode spaces.** Before a rule reads a text (a category name, an `origin` entry, a title's name or a provider's year field), each of these characters in it is replaced with a space (U+0020): U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF. They are the characters beyond ASCII that `\s` matches in JavaScript or ICU but not in Java or PCRE. Once they are replaced, `\s` in the patterns below matches the same characters in every engine: tab, line feed, vertical tab, form feed, carriage return and space. No other character is a space, for example U+200B (zero width space) or U+180E.
- **Letter case.** A rule that ignores case ignores it for the ASCII letters only: `A` to `Z` equal `a` to `z`, and no other character equals an ASCII letter or falls inside `[A-Za-z]`, whatever Unicode case mapping relates it to one. `ſ` (U+017F) is not `s`, the Kelvin sign (U+212A) is not `k`, and `İ` (U+0130) and `ı` (U+0131) are not `i`. So `portugueſe Movies` passes, and `FRENCHſ Movies` is foreign because `ſ` is not an ASCII letter touching `french`.

### The category filter

A category name is foreign when any of these four rules matches. The rules run on the name with the Unicode spaces replaced. "Whole word" means the characters just before and just after are not ASCII letters or digits (or are the start or end of the name).

1. **A country or language code in upper case**, as a whole word anywhere in the name: `FR`, `DE`, `ES`, `LAT`, `MX`, `BR`, `PT`, `TR`, `AR`, `PK`, `NL`, `PL`, `RO`, `RU`, `UK`, `CA`, `AF`. This covers the usual tag shapes: `FR | Films`, `|DE| Action`, `TR: Diziler`, `ES - Comedia`, `VOD - TR`, `Movies CA`, `4K-FR Movies`, `AF| AFRICAN`. Lower- or mixed-case letters never count under this rule (`Brain Games`, `De Niro Collection`), and neither does a code inside a longer word (`CAR CHASES`, `UKRAINE War`, `LATEST RELEASES`).
2. **`IN` and `IT` in upper case, only as a tag**: a whole word followed, after optional spaces, by one of `|` `:` `[` `]` `(` `)` `-` `–` `/` or by the end of the name (`IN | Movies`, `IT: Drama`, `Movies (IN)`, `Serie IT`, `IN-Hindi Dubbed`). Anywhere else they are English words: `MOVIES IN 4K`, `IN THEATERS`, `EN | IN THEATERS`, `IT CHAPTER TWO`.
3. **A rule 1 code in any ASCII letter case, written as a tag**: at the start of the name (after optional characters that are not ASCII letters or digits) and followed, after optional spaces, by one of `|` `:` `-` `–` `]` `)` `/`; or enclosed as `|xx|`, `[xx]` or `(xx)`, spaces allowed inside. Examples: `Fr | Films`, `De: Filme`, `(Pt) Novelas`, `[ru] Kino`. `IN` and `IT` are not part of this rule.
4. **A country or language written out**, in any ASCII letter case, with no ASCII letter just before or after it (a digit may touch it: `FRENCH4K`): french, france, german, germany, deutsch, italian, italiano, italia, italy, spanish, espanol, español, spain, castellano, latino, latina, latam, mexico, mexican, brazil, brasil, brazilian, portuguese, portugal, turkish, turkey, arab, arabic, india, indian, hindi, bollywood, tamil, telugu, malayalam, kannada, bengali, punjabi, pakistan, pakistani, urdu, dutch, netherlands, polish, poland, polska, romanian, romania, russian, russia, british, canada, canadian, quebec, korean, japanese, chinese, filipino, vietnamese, thai, persian, farsi, greek, albanian, kurdish. Longer words do not match (`Indiana Jones Collection`, `Arabian Nights`, `AFRICAN AMERICAN CINEMA`).

Everything else passes, for example `EN | Movies`, `|US| NETFLIX MOVIES`, `EN - 4K MOVIES`, `Movies In 4K`, `Adult Swim`, `Anime`, `Pinoy Classics` and an empty name.

Every app writes the rules as these regular expressions (`–` is U+2013, the en dash):

```
CODES = FR|DE|ES|LAT|MX|BR|PT|TR|AR|PK|NL|PL|RO|RU|UK|CA|AF
WORDS = the rule 4 list joined with "|", with espanol and español written as espa(n|ñ|Ñ)ol

1  (^|[^A-Za-z0-9])(CODES)([^A-Za-z0-9]|$)                                    case-sensitive
2  (^|[^A-Za-z0-9])(IN|IT)\s*([|:\[\]()/-]|–|$)                               case-sensitive
3  ^[^A-Za-z0-9]*(CODES)\s*([|:\])/-]|–)|\|\s*(CODES)\s*\||\[\s*(CODES)\s*\]|\(\s*(CODES)\s*\)
                                                                              ASCII case-insensitive
4  (^|[^A-Za-z])(WORDS)([^A-Za-z]|$)                                          ASCII case-insensitive
```

### Origin countries

An `origin` entry is a country when, with the Unicode spaces replaced, it is two ASCII letters with nothing but `\s` characters (space, tab, line feed, vertical tab, form feed, carriage return) around them: `COUNTRY` under "Patterns for titles, years and countries" below, `^\s*([A-Za-z]{2})\s*$`. The country is those two letters in upper case (ASCII). Every other entry is ignored, for example `USA`, `U.S.`, `U S`, `""`, `uſ`, a fullwidth `ＵＳ` or a value that is not a string. So `[" US"]` and `["us"]` are the US, `["USA"]` is unknown (as `[]` is), and `["USA", "GB"]` is Great Britain alone.

## Popularity data: the catalog rows endpoint

The apps never call TMDB's API. The website serves the lists, so the TMDB key stays on the server and lists are cached once for everyone. The only requests to TMDB a viewer's device makes are the web player's poster images, loaded from TMDB's image CDN (`image.tmdb.org`) by the lists' `poster` paths.

`GET https://lumanest.tv/api/catalog/rows?v=1` (public, no login; `Cache-Control: public, max-age=3600`)

```json
{
  "v": 1,
  "source": "tmdb",
  "generated": "2026-10-19T00:00:00Z",
  "movie": {
    "popular": [Item],
    "featured": [Item],
    "top_rated": [Item],
    "services": {"netflix": [Item], "disney": [Item], "max": [Item], "prime": [Item], "apple": [Item], "hulu": [Item], "paramount": [Item], "peacock": [Item]}
  },
  "tv": { "...same keys as movie..." },
  "genres": {"movie": [{"id": 28, "name": "Action"}], "tv": [{"id": 10759, "name": "Action & Adventure"}]}
}
```

`Item`: `{"id": 12345, "title": "…", "original_title": "…", "year": "2025", "origin": ["US"], "lang": "en", "genres": [28, 12], "popularity": 123.4, "poster": "/abc123.jpg"}`

`poster` is TMDB's `poster_path`, sent only when it is `/` followed by a plain file name of 1 to 100 letters, digits, `_` or `-` with a `.jpg`, `.jpeg`, `.png` or `.webp` extension; otherwise the key is left out. It was added within `v=1`: apps ignore keys they don't know and treat a missing `poster` as none. The image is `https://image.tmdb.org/t/p/<size><poster>` (the web player uses `w342`). No backdrops are sent.

`origin` is TMDB's countries of origin. TMDB's lists give them for series; for movies the server looks them up in each movie's details, a few hundred titles per refresh, so a movie's `origin` can be `[]` (unknown) until the next refresh.

- Lists are `en-US`, up to 100 items each. Movie Popular and Top rated use TMDB's US region. Popular – Series is TMDB discover for series that stream in the US (subscription, free or with ads), by popularity, because TMDB's own series Popular list is worldwide. Featured is TMDB trending (week) and Top rated – Series is TMDB's top-rated series list; both are worldwide, as TMDB offers no region for them. Service lists use TMDB discover with the service's US watch-provider id, sorted by popularity.
- When the server has no TMDB key, it answers `{"v": 1, "source": "none", "movie": {}, "tv": {}, "genres": {}}` with HTTP 200 and the apps fall back (below). Apps must treat any missing list as empty.
- When TMDB fails and the server has no copy yet, it answers HTTP 503 with `Cache-Control: no-store` and `Retry-After: 300`. This is a failed request: apps keep their copy (or fall back when they have none) and never store it.
- Apps cache the response for 12 hours and keep using a stale copy when the request fails.

## Matching catalogue titles to TMDB

1. **Provider TMDB id.** The keys `tmdb`, `tmdb_id`, `info.tmdb_id` and `info.tmdb` of the provider's row are read in this order (the last two only when `info` is a JSON object), and the first whose value gives an id gives the title's TMDB id:
   - A JSON string gives an id when, with its ends trimmed as a provider field (tab, line feed, vertical tab, form feed, carriage return, space and the Unicode spaces, nothing else; see Trimming), it matches `TMDB_ID`, `^([0-9]{1,12})(\.0)?$`, in ASCII digits only. The id is group 1 without its leading zeros; all zeros is no id. ` 0123 `, `123.0` and U+00A0 `123` give `123`; `123 .0`, `123.00`, `+123`, `1e3`, Arabic-Indic digits (U+0661 U+0662 U+0663), U+200B `123` and U+001F `123` give none.
   - A JSON number gives an id when it is a whole number from 1 to 999999999999, read as a 64-bit floating-point number (as JavaScript reads it); the id is that number in decimal digits. `123`, `123.0` and `1e3` give `123`, `123` and `1000`; `1.5`, `-5`, `0` and `1e12` give none.
   - Any other value (an array such as `["123"]`, an object, `true`, `false` or `null`) and a missing key give none, and the next key is read.

   Keys match exactly, letter case included: `TMDB`, `Tmdb_Id` and `INFO` are other keys, never read, so `{"TMDB":"5"}` gives none and `{"TMDB":"5","tmdb":"6"}` gives `6`.

   A title with an id matches the TMDB title with that id in the lists, or nothing; it never falls back to its name.
2. **Otherwise title and year.** Each catalogue title is matched on its own, so several copies can match one TMDB title (see Copies of one title).
   - The TMDB titles of the type (movie or tv) in every list (Popular, Featured, Top rated, then the services in Home order; an id counts once, where it first appears) are looked up under their normalized `title` and their normalized `original_title`.
   - A provider title is looked up under its normalized name and, when that finds no match, under its name normalized without removing leading and trailing tags (normalize steps 3.1, 3.2 and 3.4): `CSI: Miami` is tried as `miami`, then as `csi miami`.
   - With a year, the first TMDB title under the key with the same year matches, else the first one whose year differs by 1. Without a year, a title matches only when exactly one TMDB title is under the key.
3. **Year of a provider title**, read with the Unicode spaces replaced. The first of `year`, `releaseDate`, `release_date` and `releasedate` that starts, after optional spaces, with a year from 1800 to 2099 not followed by another digit (`YEAR_FIELD`). Otherwise from the name, with its ends trimmed as in normalize step 1:
   - the first year in brackets, `YEAR_BRACKETS`: `(2021)`, `[ 2021 ]`, and also the mixed `(2021]` and `[2021)`, because every app writes the brackets as the classes `[(\[]` and `[)\]]`;
   - else the year among the trailing tags of normalize step 3.2: taking trailing tags off the end of the name one at a time, the first one that is a year. `YEAR_END` finds it in one match, as its group 2: `EN | Wonka | 2023`, `Heat - 1995`, `Heat - 1995 - 4K`, `2012 | 1999 | EN` (1999), `EN | 1984 | 2010` (2010).

   A number that ends a name without a space and `|`, `-` or `–` before it is part of the title (`Blade Runner 2049`, `Wonder Woman 1984`, `Heat-1995`). A TMDB item's year is the first four digits of its `year`.
4. **Normalize** in this order. Steps 2 and 3 are case-sensitive and run before lower-casing.
   1. Replace the Unicode spaces with spaces, then remove `[ \t\n\x0B\f\r]` (space, tab, line feed, vertical tab, form feed and carriage return) from both ends. A name made only of tags then gives one result whether or not the provider trimmed it: ` - 1999` is read as `- 1999`, which is `1999` with no year (no space comes before its `-`), and ` | EN` as `| EN`, which is `en`.
   2. Replace with a space each match of `BRACKETS`: every `[...]` and `{...}`, a year in parentheses, and a short upper-case tag in parentheses (`(US)`, `(U.S.)`, `(MULTI)`).
   3. Remove tags at the ends and between pipes, in this order:
      1. Remove a leading tag, up to three times: `LEADING`, which is a short upper-case tag between pipes (`|US| `, `| EN | `) or a short upper-case code followed by `|`, `:` or a dash (`US - `, `EN| `, `NF: `, `4K-NF - `, `4K-NF-EN | `). A year is never such a code: `2012 | 1999 | EN` keeps `2012`, while `EN | 300` and `US | 1984` lose `EN` and `US`.
      2. Remove trailing tags, the last one first, for as long as one ends the name: `TRAILING`, which is a `|`, `-` or `–` with a space before it, then a short upper-case code or one of the quality words of step 9 in any ASCII letter case (` | EN`, ` - 4K`, ` | 1999`, ` – 1080p`). `|US| 1984` has none: no space comes before its last `|`.
      3. Replace with a space each match of `PIPES`, a short upper-case tag between pipes (`|US|`, `| 4K |`, but not `| The Matrix |`).
      4. Do 1 and 2 again (`|US| EN - Heat` → `Heat`, `Dune - EN |4K|` → `Dune`).

      The trailing tags go before the tags between pipes, so `Dune | 4K | EN` loses ` | EN` and then ` | 4K` (removing `| 4K |` first would leave `EN`); the leading tags go first, so `EN | 300` keeps `300`.
   4. Lower-case, independent of the device locale.
   5. Replace `&` with ` and `.
   6. Delete the apostrophes `'`, `` ` ``, `´` and `’`.
   7. Fold accents: Unicode NFKD, then remove exactly the characters U+0300 to U+036F, then `æ` → `ae`, `œ` → `oe`, `ø` → `o`, `ß` → `ss`, `đ` → `d`, `ł` → `l`, `ð` → `d`, `þ` → `th`. Other combining marks stay (for example U+0483, U+0903, U+1AB0, U+1DC4, U+20D7 and U+FE20), so step 8 turns them into a space: `Mi` U+FE20 `ami` → `mi ami`.
   8. Turn every run of characters other than `a`-`z` and `0`-`9` into one space and split into words.
   9. Drop the quality words 4k, 8k, uhd, fhd, hd, sd, hdr, hdr10, 1080p, 720p and 2160p.
   10. Drop a leading `the` when other words follow, and join the words with single spaces.

   For example: `EN | The Matrix | 1999` → `matrix` (year 1999), `4K | NF | Stranger Things - EN` → `stranger things`, `EN| Spider-Man: No Way Home [FHD]` → `spider man no way home`, `Æon Flux (2005)` → `aeon flux`, `IT - Gomorra` → `gomorra`, `Dune | 4K | EN` → `dune`, `|US| 1984` → `1984`, `2012 | 1999 | EN` → `2012` (year 1999).
5. Unmatched titles still appear in Recently added, Top rated, A–Z, genre filters and category-based rows.

### Patterns for titles, years and countries

Every app writes these as given (`–` is U+2013, and `(TAG)` stands for `TAG` in parentheses). All are case-sensitive: `TAG` spells out the letter cases it accepts. `TAG` is a short upper-case code, or a quality word where no short upper-case code followed by a space or the end fits (`hd`, `HDR10`, `1080p`; `4K`, `HD` and `UHD` are codes), so every tag matches in one way only and `YEAR_END` takes time in proportion to the name. With two ways for `4K`, `HD`, `SD`, `UHD`, `FHD` and `HDR`, each further tag doubled the time `YEAR_END` took to give up on a name such as `Movie - 1999 - 4K - … - 4K - Extended`: a tenth of a second at 20 tags in JavaScript, about a second in PCRE.

```
BRACKETS       \[[^\]]*\]|\{[^}]*\}|\(\s*(18|19|20)[0-9]{2}\s*\)|\([A-Z0-9 +.]{1,6}\)
LEADING        ^\s*(\|\s*[A-Z0-9+]{1,6}\s*\|\s*|(?!(18|19|20)[0-9]{2}([^A-Z0-9+]|$))[A-Z0-9+]{2,4}(\s*[-_]\s*[A-Z0-9+]{2,4})*\s*(\|\s*|([:-]|–)\s+))
TAG            [A-Z0-9+]{2,4}|(?![A-Z0-9+]{2,4}(\s|$))([48][Kk]|[UuFf]?[Hh][Dd]|[Ss][Dd]|[Hh][Dd][Rr](10)?|(1080|720|2160)[Pp])
TRAILING       \s(\||-|–)\s*(TAG)\s*$
PIPES          \|\s*[A-Z0-9+]{1,6}\s*\|
YEAR_FIELD     ^\s*((18|19|20)[0-9]{2})([^0-9]|$)                                     year: group 1
YEAR_BRACKETS  [(\[]\s*((18|19|20)[0-9]{2})\s*[)\]]                                   year: group 1
YEAR_END       \s(\||-|–)\s*((18|19|20)[0-9]{2})(\s+(\||-|–)\s*(?!(18|19|20)[0-9]{2}(\s|$))(TAG))*\s*$
                                                                                      year: group 2
COUNTRY        ^\s*([A-Za-z]{2})\s*$                                                  country: group 1
TMDB_ID        ^([0-9]{1,12})(\.0)?$                                                  id: group 1
```

### Copies of one title

- **Re-uploads.** Apps that fold re-uploads of a movie into one entry with backups (Android, Samsung and LG, Apple TV) treat uploads as one movie when their names are equal once lower-cased and stripped of everything but `a`-`z` and `0`-`9`, except that uploads listed only in foreign categories (every known category fails the filter) fold among themselves and never into the others. Each group keeps its newest upload (largest `added`; on a tie, the first in catalogue order); the others become its backups, newest first, and their ids its aliases; the group's categories are merged; a missing TMDB id, year or genre comes from the newest copy that has one. A dubbed copy is therefore never a backup of the US copy, and USA only can still hide it.
- **In lists**, catalogue titles matched to the same TMDB title are one poster. Its copies rank: those that pass USA only first, then the newest `added`, then catalogue order. The poster stands where its first visible copy stands in the list and opens its best-ranked visible copy (visible: allowed by the USA switch, the genre filter and the adult rules).
- `added` (movies) and `last_modified` (series) are Unix seconds; a value above 100000000000 is in milliseconds and is divided by 1000.

### M3U playlists

An app whose catalogue is an M3U playlist reads the name and the group of each entry this way. Live TV comes from the same reader, so its channels are named the same way.

- **Lines.** Split the playlist at every CR LF, CR and LF, whichever the file uses (Windows, Unix, old Mac or a mix), and nowhere else: U+0085, U+2028 and U+2029 are Unicode spaces here, not line ends. Trim each line as a provider field (see Trimming), which also takes a byte order mark (U+FEFF) off the start of the file, and skip the lines left empty. An app that refuses a playlist without the `#EXTM3U` header looks for it at the start of the first line left, in any ASCII letter case.
- **Entries.** Read the lines in order. A line that starts with `#EXTINF`, in any ASCII letter case, replaces the pending `#EXTINF` line and clears the pending group line. A line that starts with `#EXTGRP:`, in any ASCII letter case, becomes the pending group line. Any other line that starts with `#` is skipped. Every other line is a URL: it makes an entry of the pending lines and clears them. So a `#EXTGRP:` line counts only after the entry's `#EXTINF` line, a second `#EXTINF` line replaces the first, and a URL without an `#EXTINF` line before it is an entry without a title.
- **Values and title.** Read an `#EXTINF` line from its start, one character at a time:
  - A key is a run of ASCII letters, digits, `_` and `-`, taken whole: a key never starts right after one of these characters. When the key is followed by `=`, with any number of spaces (U+0020) before and after the `=`, then by `"` or `'`, and the same quote character comes again later on the line, the text between the two quotes is the key's value, and reading goes on after the closing quote. Otherwise reading goes on after the key.
  - The first `,` reached is the name comma. The text after it, trimmed as a provider field, is the title, and reading stops there, so nothing after the name comma is a value.
  - Any other character is passed over, a quote that starts no value too.

  Keys ignore ASCII letter case (`GROUP-TITLE` is `group-title`), and a key given twice keeps its first value. A comma, or a quote of the other kind, inside a value is part of the value.
- **Name.** The title. If it is empty (no name comma, or nothing after it), the `tvg-name` value trimmed as a provider field. If that is empty too, `Channel N`, where N is the entry's number in the playlist: entries are counted from 1, and the ones an app leaves out (a URL it cannot play, a repeated one) count too.
- **Group.** The `group-title` value trimmed as a provider field. If it is empty, the text after `#EXTGRP:` in the entry's group line, trimmed the same way. If that is empty too, the entry has no group and each app shows its own label for it ("Uncategorized", or "Other" in the web player and on Roku). The group is the entry's category for USA only.

For example, `#EXTINF:-1 tvg-name="Love" group-title="Movies",Crazy, Stupid, Love (2011)` is named `Crazy, Stupid, Love (2011)`, in the group `Movies`. `#EXTINF:-1 tvg-logo="http://img.invalid/a,b.png" group-title='Kids, Family',Up` is `Up`, in `Kids, Family`. `#EXTINF:-1 tvg-name='Bob's Burgers' group-title='Kids',` is `Bob`, in `Kids`: the value ends at the first `'`. `#EXTINF:-1 tvg-id=Bob's,Heat` is `Heat`, because that `'` starts no value, and so is `#EXTINF:-1 tvg-name="Heat,Heat`, whose `"` has no partner.

Every app reads an `#EXTINF` line in one pass from its start, as above, in time that grows in proportion to the line (a loop over its characters, or patterns that follow the same steps). A pattern run over the whole line instead finds `group-title="…"` written after the name comma too, and the readings the apps had before (only `"…"` values skipped, a quote of either kind opening a value anywhere, the last comma instead of the first, `tvg-name` before the title, lines split at LF alone or at CR LF and LF) each name some of the shared cases differently.

### Test cases

`docs/browse-cases.json` holds the cases every app's tests run. Each entry is one of:

- `{"kind": "category", "name": "EN | IN THEATERS", "foreign": false}`: the category filter.
- `{"kind": "normalize", "input": "EN | The Matrix | 1999", "title": "matrix", "year": "1999"}`: the normalized name, and the year read from the name alone (`""` when there is none).
- `{"kind": "usa", "category": "FR | Films", "origin": ["US"], "expect": false}`: USA only for one title. `category` is a name or, for a title listed in several categories, an array of non-empty names (`""` and `[]` both mean none). `origin` is the matched TMDB title's `origin`, an array of strings; `null` means the title is unmatched.
- `{"kind": "tmdb", "json": "{\"tmdb\":\"\",\"tmdb_id\":\" 0123 \"}", "expect": "123"}`: the provider TMDB id of one row (Matching step 1). `json` is the row as a provider sends it, JSON text; `expect` is the id in decimal digits without leading zeros, or `null` for none. Each app reads `json` with the JSON reader its catalogue goes through and hands the row to the function that reads the TMDB id of a catalogue row, so a case checks both: `{"tmdb":1e3}` holds a number (`1000`) and `{"tmdb":"1e3"}` a string (none).
- `{"kind": "m3u", "text": "#EXTM3U\n#EXTINF:-1 tvg-name=\"Love\" group-title=\"Movies\",Crazy, Stupid, Love (2011)\nhttp://m3u.invalid/live/1.ts\n", "expect": [{"name": "Crazy, Stupid, Love (2011)", "group": "Movies"}]}`: the entries of one whole playlist (M3U playlists). `text` is the playlist as a provider sends it; `expect` lists its entries in playlist order, each with its name and its group (`""`: none). Every URL in these cases is a different `http://` link to a live channel, so each app hands `text` to its M3U reader and compares the live channels it lists, in order, reading its own label for no group as `""`. The cases cover commas in titles and in values, both kinds of quotes, quotes that start no value, missing and empty titles, `tvg-name` and `Channel N`, `#EXTGRP:`, keys in any letter case, Unicode spaces and control characters, a byte order mark, and LF, CR LF and CR line ends.

Characters that are invisible or look like others (Unicode spaces, combining marks, fullwidth letters, the Kelvin sign and the like) are written as `\uXXXX` escapes. Inside a `json` text most of them are escapes of that text, as PHP's `json_encode` writes them (the file shows them as `\\uXXXX`), and a few are escapes of the file itself. In an m3u `text` they are escapes of the file, as its line ends (`\n`, `\r`) are. The cases read years from names only; a provider's year field follows the same Unicode space rule, which each app's own tests check.

Some names in the cases end in 40 quality tags, a few of them followed by a word that is not a tag, so `YEAR_END` tries the whole chain and fails: with a `TAG` that can match a tag in two ways, those cases never finish. Each app's tests also time one such name, `Movie - 1999` followed by ` - 4K` 40 times and ` - Extended`: normalizing it and reading its year take well under 50 ms. They time a name with a long run of spaces inside it too, `A`, 16,000 spaces and `B` (the Roku emulator may use a shorter run): normalizing it and reading its year take well under 50 ms, which a trim written as a pattern does not achieve (see Trimming). The web player's tests also run every normalize case through the catalogue its server sends to the browser (`compactXtream`), whatever the length of the name (see Long names).

### Implementation notes

- Write the patterns exactly as given, in every app. None uses lookbehind, which Samsung and LG TV browsers (ES5) and Safari before 16.4 reject. Lookahead, negative lookahead (`(?!...)`) and capture groups work everywhere.
- Use the ASCII classes as written, not `\w` or `\b`, which differ between Java, ICU (Android devices, Apple TV), PCRE (Roku) and JavaScript.
- **Unicode spaces.** Replace them from an explicit list, never with `\s`, `\p{Z}`, `isWhitespace` or `trim()`, which each cover a different set. JavaScript (ES5 too), TypeScript and Kotlin: the class `[\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]`. Swift: map the string's `unicodeScalars`, or use that class with `NSRegularExpression`. BrightScript: not a character class, since roRegex may match bytes; either `Replace(Chr(code), " ")` for each of them once the text is known to hold a non-ASCII character, or a pattern that alternates the characters themselves, `Chr(133) + "|" + Chr(160) + "|" + ...` (whole UTF-8 characters match alike in byte and character mode). After the replacement `\s` stays `\s` (a PCRE older than 8.34 leaves the vertical tab out of it, the one difference left), except in Samsung and LG: the oldest TV browsers follow a Unicode older than 6.3, in which U+180E is a space, so their `\s` and `trim()` remove it. Samsung and LG write every `\s` of the patterns as `[ \t\n\x0B\f\r]`, and trim provider fields with a loop over the character codes of that class and of the Unicode spaces (codes, because an editor or tool may turn a typed escape into the character itself). In Kotlin and Java, `\v` is every vertical space (U+0085 and U+2028 too), so a vertical tab is `\x0B`.
- **Trimming** (normalize step 1 and the year from a name): once the Unicode spaces are replaced, remove exactly `[ \t\n\x0B\f\r]` from both ends, with a loop over the characters: from the start, then from the end, while the character is one of these six. Not with a pattern such as `^[ \t\n\x0B\f\r]+|[ \t\n\x0B\f\r]+$`: the engine tries `[ \t\n\x0B\f\r]+$` again at every space of a run inside the text, so its time grows with the square of the run (a fifth of a second in V8 for 16,000 spaces between two words, 0.4 s in a Samsung browser, more than half a second in the Roku emulator). Roku, where a loop over the characters of a long text is slow, may instead measure the run at each end with a pattern that takes time in proportion to the text (each run is tried once, from its start), never to the square of a run; its tests also time 16,000 spaces, `A` and 16,000 spaces. Never with the language's `trim()`, `strip()` or `Trim()`, which each remove a different set: Java's `trim()` removes every character up to U+0020, Java's `strip()` and Kotlin's `trim()` also U+001C to U+001F, and the oldest TV browsers' `trim()` also U+180E. An app that trims provider fields as it reads the catalogue (Android, Apple TV, Samsung and LG, and every app's M3U reader) removes these characters and the Unicode spaces, nothing else, with a loop too, or a name such as U+001F followed by ` - 1999` would change.
- **TMDB ids** (Matching step 1): tell a string from a number as the JSON reader gives them, never by turning the value into text first. In JavaScript `String(["123"])` is `123`, and Android's `JsonReader.nextString()` returns a number's text, so the string `"1e3"` (no id) and the number `1e3` (`1000`) would look alike.
  - Strings: trim them as provider fields (Trimming), then match `TMDB_ID` (Kotlin `matchEntire`). Not `trim()`, `.whitespaces`, `isDigit()` or `isNumber`: JavaScript's `trim()` keeps U+0085, Kotlin's removes U+001C to U+001F, Foundation's `.whitespaces` takes U+200B, and `isDigit()` and `isNumber` accept the digits of other scripts.
  - Numbers: JavaScript and TypeScript `typeof value === 'number'`, `Math.floor(value) === value` and `1 <= value <= 999999999999`, written with `String(value)`. Kotlin: keep JSON numbers apart from strings in the reader, and read a number's text with `toDouble()`. Swift: `JSONValue.number(Double)`.
  - BrightScript: `ParseJson` gives a number as an `Integer` or `LongInteger` (exact), or, when it has a fraction or an exponent, as a single-precision `Float`, which keeps about 7 significant digits (every whole number up to 16777216, 2^24, but `16777217.0` reads as 16777216). Roku takes a `Float` as an id only when it is a whole number below 16777216: a number written with a fraction or an exponent above that gives no id there, and from 8388608 (2^23) up a `Float` holds whole numbers only, so one such as `8388608.6` reads as `8388609`. Providers send ids as strings or plain integers, which every app reads exactly, and the cases hold only numbers that every reader reads exactly.
  - Keys, in BrightScript: `ParseJson` without the `i` flag gives associative arrays that keep each key's letter case and look keys up case-sensitively (Roku's documented default), so `{"TMDB":"5","tmdb":"6"}` holds two keys. Read the keys with exact-case brackets on the arrays `ParseJson` gave: `row["tmdb"]`, `row["tmdb_id"]`, `info = row["info"]`, `info["tmdb_id"]`, `info["tmdb"]`. Not with dot lookups (`row.tmdb`), which the emulator (brs-cli) answers ignoring case even in such an array, and never with the `i` flag, which folds `TMDB` and `tmdb` into one key. A row copied into an array made another way (a literal, or `CreateObject("roAssociativeArray")` without `SetModeCaseSensitive()`) ignores case again.
- **Letter case.** Category rules 3 and 4 ignore case; every other pattern is case-sensitive.
  - JavaScript and TypeScript: the `i` flag without `u` (with `u`, `ſ` matches `s` and the Kelvin sign `k`).
  - Swift: `NSRegularExpression`'s `.caseInsensitive` follows Unicode (ICU). Lower-case only `A` to `Z` in a copy of the name and match lower-case patterns without it.
  - Kotlin: as Swift: lower-case only `A` to `Z` in a copy and match lower-case patterns without a flag. On Android devices `java.util.regex` is ICU, which ignores case the Unicode way under `Pattern.CASE_INSENSITIVE` whether or not `UNICODE_CASE` is set (Kotlin's `RegexOption.IGNORE_CASE` sets both); the JVM that runs unit tests does not, so only a device shows the difference.
  - BrightScript: the same as Swift, without the `i` flag. The emulator's `i` is ASCII-only, but the device's PCRE build decides it there, and `LCase` changes letters beyond ASCII.
  - An `origin` entry: check `COUNTRY` first and upper-case the two ASCII letters it found (`"uſ".toUpperCase()` is `US` in JavaScript and Kotlin, and `UCase` does the same in the BrightScript emulator). Don't trim with the language's `trim()`: Java's and Kotlin's also remove U+001C to U+001F.
- **Long names.** Matching reads a provider's name whole, however long: no app shortens a name before it reads the year (Matching step 3) and the two lookup keys (steps 2 and 4) from it. An app that keeps or sends a shorter copy of a long name to save space reads the year and the keys from the whole name first and keeps them with the copy, and cuts the copy only between whole characters, never inside a UTF-16 surrogate pair.
- Lower-case a title (normalize step 4) without a locale (Kotlin `lowercase(Locale.ROOT)`; a Turkish locale turns `I` into `ı`).
- **Combining marks** (step 7): remove exactly U+0300 to U+036F. JavaScript `/[\u0300-\u036f]/g`, not `\p{M}`; Kotlin `[\u0300-\u036F]`, not `\p{M}` or `\p{Mn}`; Swift a filter on `unicodeScalars`, not `.diacriticInsensitive` or `\p{M}`.
- **Swift strings.** Swift compares `String`s by grapheme cluster, so `replacingOccurrences(of:with:)` does not find `&` or `’` followed by a combining mark, nor a no-break space followed by one. Pass `options: .literal` to every `replacingOccurrences`, or work on `unicodeScalars`, as the other apps work on code units.
- **Without Unicode normalization.** BrightScript has none, and old Samsung and LG browsers lack `String.prototype.normalize`. They fold with a table that gives what steps 4 and 7 give for the letters of Latin-1 and Latin Extended-A and -B, the ligatures U+FB00 to U+FB06, the fullwidth digits and letters (U+FF10 to U+FF19, U+FF21 to U+FF3A, U+FF41 to U+FF5A), the Roman numerals (U+2160 to U+217F) and the circled numbers and letters (U+2460 to U+2473, U+24B6 to U+24E9), in upper and lower case because `LCase` may leave non-ASCII letters alone (`Ⅸ` and `ⅸ` both give `ix`, `①` gives `1`), and they remove U+0300 to U+036F. Any other non-ASCII character stays and becomes a space in step 8. BrightScript keeps `–` and other non-ASCII characters out of character classes, as written above, because roRegex may match bytes.

## Fallback without TMDB

- Popular and Featured rows are hidden.
- Service rows come from provider categories whose names contain the service name (`Netflix`, `Disney`, `HBO`/`Max`, `Prime`/`Amazon`, `Apple`, `Hulu`, `Paramount`, `Peacock`).
- Recently added uses the provider's `added` timestamp (movies) or `last_modified` (series); Top rated uses the provider's `rating`.

## Attribution

When TMDB data is used, Settings → About shows: "This product uses the TMDB API but is not endorsed or certified by TMDB."

## Web player

The web player at `lumanest.tv/watch` follows this design with the same rules as the apps (`site/lib/browse.ts` implements them and runs every case in `docs/browse-cases.json`, as each app's tests do). It works with a mouse, touch and a TV remote's arrow keys. Titles come from the line's Xtream catalogue when `TV_APP_XTREAM_SERVER` is set, otherwise from the movie and series entries of the line's M3U playlist, named as in M3U playlists (series entries named "Show S01E02" are grouped into one series per show and category). The Library and the "Movies & Series: USA only / All" switch are kept in the browser (the Library separately for each line). Movies in a format browsers can't play (MKV, AVI and similar) point to the Tuner app.

Posters, in order: a title matched to a TMDB title of the rows (see Matching) whose item has a `poster` shows TMDB's poster from `image.tmdb.org` (`w342`, loaded directly by the browser); otherwise the line's own poster; otherwise a card with the title's initials. If a picture fails to load, the next one is tried. The browser never loads a poster from a provider host or any other third-party host itself: posters on the provider's hosts and on the line's catalogue image host come through `/api/player/image`, and a catalogue image host poster's link carries a tag so only the posters the catalogue listed can be asked for. The catalogue image host is the one `https` name serving at least 20% and at least 50 of the line's posters; see deployment.md.
