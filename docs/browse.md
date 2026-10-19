# Movies & Series browsing (all Tuner apps)

This is the shared design for how every Tuner app (Android TV / Fire TV, Samsung, LG, Roku, Apple TV) presents movies and series. Each app implements it in its own UI toolkit and keeps its platform's remote conventions. Live TV keeps its guide and is not part of this change.

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
  - a title matched to TMDB is shown only if its `origin` countries include `US` and its provider category also passes the category filter below. An empty `origin` (TMDB gave no country) means unknown, so the category filter alone decides. The category check keeps out US titles filed in foreign-language categories, which are usually dubbed copies;
  - an unmatched title is shown only if its provider category passes the category filter: categories whose names carry a non-US country or language tag (for example `FR`, `DE`, `IT`, `ES`, `LAT`, `MX`, `BR`, `PT`, `TR`, `AR`, `IN`, `HINDI`, `PK`, `NL`, `PL`, `RO`, `RU`, `UK`, `CA` as a whole word or a `XX |` / `|XX|` / `XX:` prefix) are excluded; everything else is kept.
- **Adult content** follows the existing rules (hidden by default, passcode unlock on sideload builds, never shown in store builds).

## Popularity data: the catalog rows endpoint

The apps never call TMDB directly. The website serves the lists, so the TMDB key stays on the server and lists are cached once for everyone.

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

`Item`: `{"id": 12345, "title": "…", "original_title": "…", "year": "2025", "origin": ["US"], "lang": "en", "genres": [28, 12], "popularity": 123.4}`

`origin` is TMDB's countries of origin. TMDB's lists give them for series; for movies the server looks them up in each movie's details, a few hundred titles per refresh, so a movie's `origin` can be `[]` (unknown) until the next refresh.

- Lists are `en-US`, up to 100 items each. Movie Popular and Top rated use TMDB's US region. Popular – Series is TMDB discover for series that stream in the US (subscription, free or with ads), by popularity, because TMDB's own series Popular list is worldwide. Featured is TMDB trending (week) and Top rated – Series is TMDB's top-rated series list; both are worldwide, as TMDB offers no region for them. Service lists use TMDB discover with the service's US watch-provider id, sorted by popularity.
- When the server has no TMDB key, it answers `{"v": 1, "source": "none", "movie": {}, "tv": {}, "genres": {}}` with HTTP 200 and the apps fall back (below). Apps must treat any missing list as empty.
- When TMDB fails and the server has no copy yet, it answers HTTP 503 with `Cache-Control: no-store` and `Retry-After: 300`. This is a failed request: apps keep their copy (or fall back when they have none) and never store it.
- Apps cache the response for 12 hours and keep using a stale copy when the request fails.

## Matching catalogue titles to TMDB

1. If the provider item carries a TMDB id (`tmdb`, `tmdb_id` or `tmdb_id` inside `info`), match on it.
2. Otherwise match on normalized title plus year (year may differ by 1). A title without a year (none in the provider item or its name) matches only when exactly one TMDB title in the lists has that normalized title. Normalize: lowercase; drop a trailing `(YYYY)` and any bracketed or pipe-delimited tags such as `[4K]`, `|US|`, `US -`; drop quality words (4K, UHD, HD, FHD, HDR); `&` → `and`; remove punctuation; collapse spaces; drop a leading `the `.
3. Unmatched titles still appear in Recently added, Top rated, A–Z, genre filters and category-based rows.

## Fallback without TMDB

- Popular and Featured rows are hidden.
- Service rows come from provider categories whose names contain the service name (`Netflix`, `Disney`, `HBO`/`Max`, `Prime`/`Amazon`, `Apple`, `Hulu`, `Paramount`, `Peacock`).
- Recently added uses the provider's `added` timestamp (movies) or `last_modified` (series); Top rated uses the provider's `rating`.

## Attribution

When TMDB data is used, Settings → About shows: "This product uses the TMDB API but is not endorsed or certified by TMDB."
