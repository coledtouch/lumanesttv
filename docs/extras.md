# Subtitles, trailers and hidden live categories (all Tuner apps and /watch)

This is the shared design for three additions to every Tuner app (Android TV / Google TV / Fire TV, Samsung, LG, Roku, Apple TV) and the web player at `lumanest.tv/watch`:

1. **Subtitles.** The provider's movie and episode files carry no subtitle tracks, so every player also offers English subtitles from OpenSubtitles.com, fetched through lumanest.tv.
2. **Trailer.** Movie and series pages get a **Trailer** button that plays the title's YouTube trailer, found with TMDB through lumanest.tv.
3. **Hidden live category.** The provider's "Most watched now" live category is hidden everywhere; Tuner's own personal **Most Watched** stays.

It builds on [`browse.md`](browse.md) (titles, TMDB ids, Unicode spaces) and shares its test file style: `docs/extras-cases.json` holds the cases every component runs (see Test cases). Each app implements the design in its own UI toolkit and keeps its platform's remote conventions.

## Read first: third-party terms

These decide parts of the design. The owner must act on the first one before setting the OpenSubtitles secrets.

- **OpenSubtitles.** Its [Terms of use for integrators](https://opensubtitles.stoplight.io/docs/opensubtitles-api/f43c0749230b3-terms-of-use-for-integrators) (last updated 13 October 2026) say:
  - One key serving all of a service's users without their own OpenSubtitles accounts needs a **paid plan** (Light or above; Light is 20 USD a month for 2,000 downloads a day). On a paid plan, `/download` needs only the `Api-Key` header. A free key allows 5 downloads per IP address per 24 hours without login, and the Worker's address is Cloudflare's, so a free key alone does not work. Signing in with one user account (`OPENSUBTITLES_USERNAME` and `OPENSUBTITLES_PASSWORD`) makes downloads count against that user's own quota: the terms treat one account serving every customer as shared use, which is the paid plan's case. So the recommended setup is a paid plan with only `OPENSUBTITLES_API_KEY` set; the login stays supported because the owner asked for it.
  - **"Keep a copy on your servers and serve it to your other users: No."** The requested design (each subtitle downloaded once and kept in R2 for every customer) is not allowed. This design therefore keeps subtitle **files** only on the viewer's own device. lumanest.tv keeps **which** file is best for each title (search results, which are metadata), shared by all customers, in R2. Every viewer who shows a title's subtitles costs one download from the plan, unless that device kept the file. A shared file cache needs written permission from OpenSubtitles (their Enterprise arrangement); don't build one without it.
  - Fetching subtitles nobody asked for, to fill a cache, is not allowed. No component prefetches subtitle files.
  - On a free key, the credit "Subtitles provided by OpenSubtitles.com" must show where subtitles are picked and in the store listings. Every app shows it in the player's subtitle menu and in Settings > About whatever the plan, so a plan change needs no app update. Add it to the store listings only while on a free key.
  - Access to the API is not a licence to the subtitles, which are user submissions. Like the TV content itself, the rights are the owner's responsibility. If OpenSubtitles asks for a file to be removed, nothing is stored on our servers to delete: the file's search result expires within 30 days (or delete `extras/v1/subtitles/` objects in R2 at once).
- **TMDB.** Trailers, and the name and year fallback below, use `TMDB_API_KEY`, which stays unset until the owner has TMDB's commercial terms ([deployment.md](deployment.md#movies--series-rows-tmdb)). Without it there are no trailers and no name fallback; subtitles still work for titles that carry a TMDB id from the provider.
- **YouTube.** The TV apps hand the trailer to the YouTube app, or show a QR code for a phone. The web player embeds YouTube's player (privacy-enhanced mode, `youtube-nocookie.com`) only after the viewer chooses Trailer. The embedded player is one of the YouTube API Services, so `/privacy` says so and links YouTube's Terms of Service and Google's Privacy Policy (see Privacy text). The player is shown whole and unmodified, at least 200 by 200 pixels.

## How it fits together

```
TV app / web player --(TMDB id, season, episode)--> lumanest.tv /api/extras/subtitles --search--> OpenSubtitles
TV app / web player <--(up to 3 tracks with file URLs)--
TV app / web player --(file URL, only when shown)--> lumanest.tv /api/extras/subtitles/file/<token>.vtt --download--> OpenSubtitles
TV app / web player <--(WebVTT or SRT, plain text)--
TV app / web player --(TMDB id)--> lumanest.tv /api/extras/trailer --videos--> TMDB
TV app --(YouTube key)--> YouTube app, or a QR code for a phone;  web player --> YouTube embed in a dialog
```

The apps never call OpenSubtitles or TMDB. The keys and the OpenSubtitles login stay on the server. OpenSubtitles and TMDB never see a viewer's IP address or anything about the viewer.

## Endpoints

### Common rules

- Public, no login, no cookies read, any origin: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Max-Age: 86400`; `OPTIONS` answers 204. `HEAD` answers as `GET` without a body. Every answer has `X-Content-Type-Options: nosniff`.
- JSON answers are `Content-Type: application/json` and versioned like the rows: `v=1`. A missing `v` means 1; any other value answers 400 `unsupported_version`. Apps always send `v=1` and ignore keys they don't know.
- Errors are `{"v": 1, "error": {"code": "...", "message": "..."}}` with `Cache-Control: no-store`. Apps treat **any** non-200 answer, a timeout or unreadable JSON as "no subtitles" or "no trailer", silently. They never show these errors, except a short toast when the viewer picked a subtitle track that then fails to load.

| Status | Code | When |
| --- | --- | --- |
| 400 | `bad_request` | A parameter is missing or invalid (rules below). |
| 400 | `unsupported_version` | `v` is not `1`. |
| 404 | `not_found` | File endpoint: the token is malformed or its MAC is wrong. |
| 429 | `rate_limited` | Over a rate limit: `Retry-After: 60`. Over the client's 60 subtitle files of the UTC day, or its IPv6 /48's 240: `Retry-After` until the next midnight UTC. |
| 502 | `unreadable` | File endpoint: the downloaded file had no usable cue. |
| 503 | `unavailable` | OpenSubtitles or TMDB failed or was not asked (over the upstream limit) and there is no stale copy (`Retry-After: 300`); the download quota is used up (the seconds until it resets, at most 86400); the day's download budget is used up (until the next midnight UTC); the daily count could not be kept (D1 failed: `Retry-After: 60`). |

- **Clients.** Limits and the daily count are kept per **client** (`clientPrefix` in `lib/extras.ts`, from `CF-Connecting-IP`): an IPv4 address as it is (/32); an IPv6 address as its /64, written `2001:db8:0:1::/64` after expanding `::` (a phone or a home network gets at least a whole /64, so rotating addresses inside it gains nothing); an IPv4-mapped IPv6 address (`::ffff:192.0.2.1`) as its IPv4 address; anything else as one shared `unknown` client. An IPv6 client also belongs to a wider **network**, its /48 (`clientNetwork`, written `2001:db8:0::/48`): a household is often given a /56 (256 /64s) and a free tunnel a whole /48 (65,536), and a 6to4 address (`2002::/16`) turns one IPv4 address into a /48, so the uncached lookups and the daily downloads are capped per /48 as well. An IPv4 client is its own network. Addresses are never stored or logged.
  - **The /48 cap's cost.** Where an ISP numbers separate customers inside one /48 (mobile carriers, and some large ISPs that give each home a /64 or a /60), those customers share its 240 files a day and 12 uncached lookups a minute. One heavy user there can leave the others with 429 `rate_limited`: for files until midnight UTC, even on their first request of the day; for uncached lookups until the minute ends (fresh and stale copies are still served). So a report that subtitles stopped for an IPv6 viewer can be this. `NETWORK_DAILY_DOWNLOADS` in `lib/extras.ts` sets the cap; only a per-viewer grant would avoid the sharing.
- **Rate limits a minute**, on the two Workers Rate Limiting bindings `scripts/prepare-cloudflare.mjs` creates (no other binding is needed), each key counted on its own. `<client>` is the `clientPrefix` text (`203.0.113.7`, or `2001:db8:0:1::/64` for IPv6):

  | Key | Binding | Limit | Counts |
  | --- | --- | --- | --- |
  | `lookup:<client>` | `EXTRAS_LIMITER` (namespace `1003`, `{limit: 120, period: 60}`) | 120 | Subtitle and trailer lookups together, and `HEAD` of a file. |
  | `upstream:opensubtitles`, `upstream:tmdb` | `EXTRAS_LIMITER` | 120 per service (per Cloudflare location) | Every OpenSubtitles search and every TMDB request a cache miss makes, from all clients together. |
  | `file:<client>` | `SUBTITLE_FILE_LIMITER` (namespace `1004`, `{limit: 12, period: 60}`) | 12 | Subtitle file `GET`s. |
  | `miss:<client hash>`, and for IPv6 `miss:<network hash>` | `SUBTITLE_FILE_LIMITER` | 12 each | A client's lookups that need an upstream request, and all of its /48's together (taken only when a refresh is about to start; joining one already running, a fresh object and a held stale copy cost nothing). Over the limit, an expired copy under 90 days old is served as a stale copy without a refresh; only a title with no such copy answers 429. The hashes are the keyed hashes below. |

  Over `lookup` or `file`: 429 `rate_limited`; over `miss`: a stale copy, else 429 `rate_limited`. Over `upstream`: the request is not made, which is an upstream failure (a stale copy, else 503 `unavailable`; never cached as `none`). The `upstream` tokens are shared by everyone, so about 10 clients (IPv4 addresses, or IPv6 /48s) asking for made-up titles at their full `miss` limit take one service's 120 tokens in a Cloudflare location: for the rest of that minute, lookups there that need that service and have no stale copy answer 503, and the apps show no subtitles or no Trailer button (fresh and stale copies are still served). This is accepted, to keep OpenSubtitles' and TMDB's own limits safe; a run of `lumanest_extras_upstream_limited` shows it. Namespaces must differ from the relay's `1001` and `PLAYER_LIMITER`'s `1002`. Without the bindings, or when one throws, per-isolate fixed one-minute windows with the same limits apply (as `lib/player-vod.ts` does); each kind keeps at most 5,000 of them and drops the oldest when full, never all at once.
- **Daily download budget** (D1, table `extras_download_counts (day, client, count)`, migration `0010_extras_download_counts.sql`): each subtitle file `GET` that passed the MAC check, and the quota check, is counted for the UTC day before the download, in one D1 batch: the client's row (`client` is the base64url HMAC-SHA256 of `extras-client-v1\n<client>` keyed with `PLAYER_COOKIE_KEY`, purpose `extras-client`, never the address); for an IPv6 client, while it is within its cap, its /48's row (the same hash of `extras-client-v1\n<network>`); and, while the client (and its /48) are within their caps, the day's total (`client` `*`). The day's total counts only requests within those caps, so one client, or one /48 spread over many /64s, asking on and on can't use it up for everyone.
  - Over **60 files** for one client in the UTC day, or over **240 files** for all the IPv6 clients of one /48 together: 429 `rate_limited`, `Retry-After` until the next midnight UTC, no download. An isolate that has found a client or a /48 over its cap answers its later requests from memory until the next midnight UTC, without D1, so once it has given that first over-cap answer, new /64s of a full /48 add no rows and no D1 writes there (requests already waiting on D1 before then still write one row each).
  - A download OpenSubtitles answered without a link (an error status: 401, 403, 406, 429, or a 5xx twice), which they don't count, is taken off every row it was counted in again (after the answer, `waitUntil`), so a wrong key or an outage doesn't use up the day. One it may have counted (a link was given, or a request to `/download` got no answer) stays counted.
  - **What this doesn't stop.** Many IPv4 addresses (or many /48s), or a page elsewhere that hotlinks the file URLs so that its many visitors each fetch one, can still use up the day's budget, after which every client waits until midnight UTC. Only a per-viewer grant would stop that; v1 has none (the endpoints need no login).
  - **Shared IPv4.** Customers behind one public IPv4 address (carrier-grade NAT on mobile and fixed-wireless ISPs, iCloud Private Relay in Safari, hotel or campus networks) are one client: they share its 60 files a day (`CLIENT_DAILY_DOWNLOADS` in `lib/extras.ts`), 12 files and 12 uncached lookups a minute and 120 lookups a minute, so a report that subtitles stopped can be this too.
  - Over the **day's budget** for every client together: 503 `unavailable` until the next midnight UTC, no download. An isolate that has answered this offers no tracks either until then (lookups answer `status: "unavailable"`), and answers later file requests 503 without D1. The budget is the optional plain variable `OPENSUBTITLES_DAILY_DOWNLOADS` (a positive whole number, not a secret); unset or anything else means **1800**: below the Light plan's 2,000, which leaves room for the downloads OpenSubtitles counts but this count doesn't (a gone link asked for again is a second download). Set it to about 90% of the plan's daily downloads after a plan change.
  - D1 failing (or no `DB` binding): 503 `unavailable` with `Retry-After: 60` and no download (the count fails closed).
  - Rows older than yesterday are deleted at most once an hour per isolate, after the answer (`waitUntil`), and by the site's maintenance clean-up (`lib/maintenance.ts`).
  - `lumanest_subtitles_budget_low` is logged once a day per isolate when the day's total passes 80% of the budget, and `lumanest_subtitles_budget_used_up` once a day per isolate when it is used up.
- **Logging**: fixed codes and numbers only, never keys, tokens, the OpenSubtitles username, IP addresses or their hashes, titles or URLs: `lumanest_subtitles_search_failed`, `lumanest_subtitles_download` (with the `remaining` quota number), `lumanest_subtitles_download_failed`, `lumanest_subtitles_quota_exhausted`, `lumanest_subtitles_login_rejected` (once per isolate), `lumanest_trailer_tmdb_failed`, `lumanest_extras_resolve_failed`, `lumanest_extras_upstream_limited` (a refresh not made, over `upstream`), `lumanest_subtitles_budget_low`, `lumanest_subtitles_budget_used_up`, `lumanest_subtitles_count_failed` (D1 failed: no download), `lumanest_subtitles_uncount_failed` (a download OpenSubtitles didn't count could not be taken off the counts) and `lumanest_subtitles_count_cleanup_failed`.

### Subtitles lookup: `GET /api/extras/subtitles`

Movie: `/api/extras/subtitles?v=1&type=movie&tmdb=603`
Episode: `/api/extras/subtitles?v=1&type=episode&tmdb=1399&season=1&episode=3` (`tmdb` is the **series'** TMDB id)
Without a TMDB id: `/api/extras/subtitles?v=1&type=movie&name=EN%20%7C%20The%20Matrix&year=1999` (episodes: the series' name and year, plus `season` and `episode`)

| Parameter | Rule |
| --- | --- |
| `type` | `movie` or `episode`. |
| `tmdb` | 1 to 12 ASCII digits without a leading zero, 1 to 999999999999 (the TMDB id of browse.md, Matching step 1, or of the matched rows item). When present, `name` and `year` are ignored. |
| `season` | Episodes only, required: 1 to 4 ASCII digits, 0 to 100 (0 is specials). Leading zeros are allowed and dropped. |
| `episode` | Episodes only, required: 1 to 4 ASCII digits, 1 to 5000. Leading zeros are allowed and dropped. These ranges are narrow on purpose: every made-up number would cost an upstream search. |
| `name` | Only without `tmdb`: the provider's name of the movie or series, as the app reads it (trimmed as a provider field, browse.md Trimming), 1 to 300 UTF-16 code units. |
| `year` | Required with `name`: 4 ASCII digits, 1800 to 2099 (browse.md Matching step 3). |
| `lang` | Optional, `en` only in v1 (another value answers 400). |

Unknown parameters are ignored. Parameter values are UTF-8, percent-encoded; a `+` in a query is a space (`URLSearchParams`). Apps send the parameters in the order above.

200 answer:

```json
{
  "v": 1,
  "status": "ok",
  "tmdb": 603,
  "tracks": [
    {"id": "4486640-kZ0n3x6m1Gm2v5PqLr8sTw", "lang": "en", "label": "English (OpenSubtitles)", "hi": false,
     "vtt": "https://lumanest.tv/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.vtt",
     "srt": "https://lumanest.tv/api/extras/subtitles/file/4486640-kZ0n3x6m1Gm2v5PqLr8sTw.srt"}
  ],
  "credit": "Subtitles provided by OpenSubtitles.com"
}
```

- `status`: `ok` (1 to 3 tracks), `none` (nothing usable for this title), `unmatched` (no TMDB id, and the name fallback found no single TMDB title, or `TMDB_API_KEY` is unset), `not_configured` (`OPENSUBTITLES_API_KEY` or `PLAYER_COOKIE_KEY` is unset), `unavailable` (the download quota is used up until it resets, or this server has seen the day's download budget used up until the next midnight UTC). Every status but `ok` has `"tracks": []`. Apps read only `tracks` (and `credit`) and treat everything else alike.
- `tmdb`: the TMDB id used (given, or found by name), or `null`.
- `tracks`: best first (see Choosing subtitle files). `id` is the file token; `label` is shown as it is, as plain text; `hi` is true for hearing-impaired (SDH) files; `vtt` and `srt` are absolute URLs on the origin the request came to. Apps accept only URLs that start with the origin they called (`https://lumanest.tv/`).
- `Cache-Control`: `ok` `public, max-age=86400`; `none` and `unmatched` `public, max-age=21600`; `not_configured` `public, max-age=600`; `unavailable` `no-store`; a stale copy served after an upstream failure `public, max-age=300`.

### Subtitle file: `GET /api/extras/subtitles/file/<token>.vtt` or `.srt`

- `<token>` is `<file_id>-<mac>`: the OpenSubtitles `file_id` in decimal (1 to 2147483647, no leading zero), `-`, and the first 22 characters of the base64url HMAC-SHA256 of `extras-subtitle-v1\n<file_id>` keyed with `PLAYER_COOKIE_KEY` (add an `extras-subtitle` purpose to `MacPurpose` in `lib/player-crypto.ts`; compare in constant time). The path must match `^/api/extras/subtitles/file/([1-9][0-9]{0,9})-([A-Za-z0-9_-]{22})\.(vtt|srt)$`; anything else is 404. The MAC means only files a lookup offered can be downloaded through our quota.
- Each `GET` is counted for the day (Daily download budget above), then asks OpenSubtitles for that file (one download from the quota), converts it (SRT to WebVTT below) and sends it. **Nothing is stored on the server**: not in R2, not in the Cache API, not in isolate memory; D1 holds only the day's counts. A file with no usable cue answers 502 `unreadable`.
- `HEAD` answers 200 with the headers below and no body, **without** downloading.
- `.vtt`: `Content-Type: text/vtt; charset=utf-8`. `.srt`: `Content-Type: application/x-subrip; charset=utf-8`. Both: `Cache-Control: private, max-age=604800` (the viewer's device or browser may keep it 7 days; no shared cache may), `Content-Security-Policy: sandbox; default-src 'none'`, `Content-Disposition: inline`, `Cross-Origin-Resource-Policy: cross-origin`, and the CORS headers. A `Range` header is ignored (200 with the whole file).
- Not configured: 503 `unavailable`. Quota used up: 503 `unavailable` with `Retry-After` until the reset. Over the client's 60 files, its /48's 240 or the day's budget: 429 or 503 until the next midnight UTC (Daily download budget above).

### Trailer: `GET /api/extras/trailer`

`/api/extras/trailer?v=1&type=movie&tmdb=603`, `/api/extras/trailer?v=1&type=tv&tmdb=1399`, or without a TMDB id `/api/extras/trailer?v=1&type=movie&name=...&year=1999`. `type` is `movie` or `tv`; `tmdb`, `name` and `year` follow the subtitles rules.

```json
{"v": 1, "status": "ok", "tmdb": 603,
 "trailer": {"key": "vKQi3bBA1y8", "name": "Official Trailer", "url": "https://www.youtube.com/watch?v=vKQi3bBA1y8",
             "short": "youtu.be/vKQi3bBA1y8", "qr": ["1111111010...", "..."]}}
```

- `status`: `ok`, `none`, `unmatched` or `not_configured` (`TMDB_API_KEY` unset); `trailer` is `null` unless `ok`. `Cache-Control` as for subtitles.
- `key` matches `^[A-Za-z0-9_-]{11}$` (`YOUTUBE_KEY`); apps check it again before building any link. `name` is TMDB's video name as plain text, at most 100 characters. `url` is the YouTube watch page (shown as a link where a platform offers one); `short` is the text shown under a QR code; `qr` is the QR code of `https://youtu.be/<key>` as rows of `0` and `1` (dark), with no quiet zone, made by `qrRows` in `lib/pairing.ts` exactly as `/api/pair/start` sends it, so the apps draw it with their pairing QR code.

### Name and year fallback

Apps send `name` and `year` only for a title with no TMDB id (none from the provider and no rows match) and a known year. The OpenSubtitles text search is **not** used: it matches release and file names and gives other films' subtitles. The server resolves the name with TMDB instead, strictly:

1. `key = normalizeTitle(name)` and `whole = normalizeTitle(name, true)` from `site/lib/browse.ts` (browse.md Normalize). An empty `key` is `unmatched`.
2. TMDB `GET /3/search/movie?query=<key>&year=<year>&include_adult=false&language=en-US&page=1`, or for series `GET /3/search/tv?query=<key>&first_air_date_year=<year>&include_adult=false&language=en-US&page=1`.
3. A result matches when `normalizeTitle(title)` or `normalizeTitle(original_title)` (series: `name`, `original_name`) equals `key` or `whole`, and the first four characters of `release_date` (series: `first_air_date`) equal `year`.
4. Exactly one distinct id matching is the TMDB id. None, or more than one, is `unmatched`.

## Server behaviour

Pure rules go in `site/lib/extras.ts` (tested with every case of `docs/extras-cases.json`), network and storage in `site/lib/extras-service.ts`, and the routes in `site/app/api/extras/subtitles/route.ts`, `site/app/api/extras/subtitles/file/[file]/route.ts` and `site/app/api/extras/trailer/route.ts`.

### OpenSubtitles requests

- Base `https://api.opensubtitles.com/api/v1`, or the `base_url` host a login returned (only `api.opensubtitles.com` or `vip-api.opensubtitles.com` are accepted). Every request sends `User-Agent: LumaNest TV v1.0` (their API refuses requests without an app name and version) and `Accept: */*` (without it, some errors come back as a bare 406). `Api-Key: <OPENSUBTITLES_API_KEY>`, and `Authorization: Bearer <token>` while a login token is held, go only to the API hosts `api.opensubtitles.com` and `vip-api.opensubtitles.com`: never to the download link (whatever its host) and never after a redirect to another host. Redirects are followed (their docs require it), only to `https` hosts that are `opensubtitles.com` or end in `.opensubtitles.com`. Each request times out after 8 seconds. Every search takes an `upstream:opensubtitles` token first (Rate limits above).
- **Login**, only when `OPENSUBTITLES_USERNAME` and `OPENSUBTITLES_PASSWORD` are both set: `POST /login` with `{"username", "password"}`. Keep the token and `base_url`, sealed with `PLAYER_COOKIE_KEY` (`seal` in `lib/player-crypto.ts`, a new `extras-opensubtitles` purpose), in the R2 state object below, with the time it was made; it is used for 23 hours (tokens last 24), then a new login. A 401 on `/download` with a token: log in again once and retry once. Their login allows 1 request a second, 10 a minute, 30 an hour: never log in more than once a minute (R2 state and isolate memory). A login refused with 401 means wrong credentials: log `lumanest_subtitles_login_rejected`, record the base64url HMAC-SHA256 of `extras-cred-v1\n<username>\n<password>` keyed with `PLAYER_COOKIE_KEY` (purpose `extras-credential`; never a plain hash, which a near miss of the real password could be checked against) as rejected so those credentials are never tried again (new secrets are tried), and go on without `Authorization` (which works on a paid plan). A rejected value in another shape (an older SHA-256) is ignored, which costs one login.
- **Search** (free, unlimited, rate limited at their end to 5 requests a second per IP): parameters in alphabetical order, lower case, defaults left out, as their best practices ask:
  - movie: `GET /subtitles?languages=en&order_by=download_count&order_direction=desc&tmdb_id=603&type=movie`
  - episode: `GET /subtitles?episode_number=3&languages=en&order_by=download_count&order_direction=desc&parent_tmdb_id=1399&season_number=1&type=episode`

  Only the first page is read; the result's `data` array goes to Choosing subtitle files. Machine-translated files are already left out by their default; the other filters are applied by the server.
- **Download**: `POST /download` with `{"file_id": <id>}` (no `sub_format`: SRT is the default, and the server converts it itself), then `GET` the returned `link` (an `https` URL on `opensubtitles.com` or a subdomain, else a failure; sent without `Api-Key` or `Authorization`) with a 10-second timeout, reading at most 2 MB (more is a failure). The link is temporary (3 hours): never stored. A 406 whose body has `remaining` below 0 or `reset_time_utc` means the quota is used up: record `quotaUntil` (that time, at most 24 hours ahead) in the state object, log `lumanest_subtitles_quota_exhausted`, and answer 503 until then without calling OpenSubtitles; lookups answer `status: "unavailable"` meanwhile. A 410 (link gone): ask `/download` again once. A 5xx: retry once after 1 second. A 429: 503 with `Retry-After: 5`. The file is UTF-8 (they convert every file); decode it with replacement characters, never failing.

### Choosing subtitle files

From the search's `data`, an entry is a candidate when its `attributes` object has (`docs/extras-cases.json`, kind `subtitle_pick`):

- `language` a string equal to `en` in any ASCII letter case;
- `machine_translated` not `true` and `foreign_parts_only` not `true` (forced-only files are not full subtitles);
- `files` an array of exactly one object whose `file_id` is a JSON integer from 1 to 2147483647 (multi-CD subtitles are left out);
- `feature_details` (an object, or treated as `{}`): for a movie, `feature_type`, when a string, equals `movie` in any ASCII case, and `tmdb_id`, when an integer, equals the requested id; for an episode, `feature_type`, when a string, equals `episode` in any ASCII case, `season_number` and `episode_number` are integers equal to the requested ones (a missing one rejects the entry), and `parent_tmdb_id`, when an integer, equals the requested series id.

A `file_id` seen before is skipped. Candidates are ordered by, in turn: `ai_translated` not `true` first; `hearing_impaired` not `true` first (SDH only when nothing else is left); larger `download_count` first (a value that is not a JSON number counts as 0); `from_trusted` `true` first; later `upload_date` first (compared as strings; not a string counts as `""`); smaller `file_id` first. The first three become `tracks`, labelled `English (OpenSubtitles)`, then `English (OpenSubtitles 2)` and `English (OpenSubtitles 3)`, with `SDH` after `English` for a hearing-impaired file (`English SDH (OpenSubtitles 2)`). The extra tracks are there for a file that doesn't match the provider's copy in time: the viewer can try another.

### Choosing the trailer

TMDB `GET /3/movie/{id}/videos?language=en-US` or `GET /3/tv/{id}/videos?language=en-US` (same key handling as `lib/catalog.ts`; a 404 is `none`). From `results` (kind `trailer`), a video is a candidate when `site` is exactly `YouTube`, `key` matches `YOUTUBE_KEY`, and `type` is exactly `Trailer` or `Teaser` (never `Clip`, `Featurette`, `Behind the Scenes`, `Bloopers`, `Recap` or other types). Candidates are ordered by, in turn: `iso_639_1` equal to `en` first; `official` `true` first; `Trailer` before `Teaser`; a `published_at` that starts with `YYYY-MM-DDT` before one that doesn't, earlier first (compared as strings); smaller `key` (code unit order). The first is the trailer. So the first official English trailer is chosen, and for a series that is usually the first season's.

The provider's own `youtube_trailer` field (Xtream rows carry one) is not used: it is unchecked and often empty or stale.

### SRT to WebVTT

The server converts every downloaded file the same way (kind `srt_vtt`, which also gives the expected `.srt` output, and kind `cue_text` for step 3 alone). Patterns here run in JavaScript on the server only.

1. **Lines.** Remove a byte order mark (U+FEFF) at the start, then split at every CR LF, CR and LF.
2. **Cues.** Read the lines in order with a current cue (none at first) and an "after a blank line" flag:
   - A line that matches `TIMING`, `^[ \t]*((?:[0-9]{1,3}:)?[0-9]{1,2}:[0-9]{1,2}[,.][0-9]{1,3})[ \t]*-->[ \t]*((?:[0-9]{1,3}:)?[0-9]{1,2}:[0-9]{1,2}[,.][0-9]{1,3})(?:[ \t].*)?$`, ends the current cue and starts a new one. If the current cue was not ended by a blank line and its last text line is only digits (with spaces or tabs around them), that line is removed first: it was the next cue's number in a file without blank lines. Anything after the end stamp (SRT coordinates such as `X1:100`) is ignored.
   - A stamp is `[hours:]minutes:seconds` then `,` or `.` and 1 to 3 digits that are a decimal fraction (`5` and `50` are 500 ms, `005` is 5 ms). Minutes and seconds must be 59 or less, else the whole cue is dropped.
   - A blank line (empty, or only spaces and tabs) sets the flag. Any other line is a text line of the current cue while the flag is not set, and is ignored otherwise (cue numbers, text before the first cue, text after a blank line inside a cue).
   - Cues whose end is not after their start, or whose text is empty after step 3, are dropped. The rest are sorted by start; equal starts keep file order; overlapping cues stay.
3. **Text to plain text**, on the cue's text lines joined with LF:
   1. Replace `\N` and `\n` (a backslash and the letter, as SSA writes line breaks) with a line break, and `\h` with a space.
   2. Decode entities once, left to right: `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` give `& < > " '`, `&nbsp;` gives a space, `&#NNN;` (1 to 7 digits) and `&#xHHH;` (1 to 6 hex digits) give that code point when it is 1 to U+10FFFF and not a surrogate. Any other `&...;` stays as it is. `&amp;lt;` gives the text `&lt;`.
   3. Replace tab and each Unicode space of browse.md (U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF) with a space, and each CR (U+000D; only an entity such as `&#13;` or `&#x0D;` can leave one here) with a line break, like the file's own CR. Then remove U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F, U+007F to U+009F, U+200B, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069, U+FFFE and U+FFFF (controls, zero width space, direction marks, embeddings, overrides and isolates). This comes before the markup steps, so a removed character can't split a tag that would come back together afterwards (`<&#8203;b>`).
   4. Replace each `<br>`, `<br/>` or `<br />` (any ASCII case, spaces or tabs before `/`) with a line break.
   5. Remove every `\{[^{}]*\}` (SSA override blocks such as `{\an8}`), then every `</?[A-Za-z][^<>]*>` (tags such as `<i>`, `</font>`, `<font color="#ff0">`, `<c.yellow>`), and repeat both until nothing changes, at most 10 times. A block or a tag may span lines (`<b` LF `>`, or `{\an8\N}` once `\N` is a line break): a renderer that reads markup treats a line break inside a tag as a space. Removing one block or tag can also join the pieces of another (`<<b>i>` leaves `<i>`, `{\an{x}8}` leaves `{\an8}`). If a block or tag is still left after 10 rounds (nesting no real file has), remove every `<` and `{`. Because entities are decoded first, encoded markup (`&lt;b&gt;`) is removed too: the plain text never holds a tag or a block, not even one split over lines. A `<` not followed by a letter, or by `/` and a letter, is text (`x < y`, `<3`).
   6. Split at line breaks; in each line turn runs of spaces into one and remove spaces at both ends; drop empty lines. Then write each run of two or more `-` followed by `>` as `->`, so no text line can be read as a timing line (an encoded `--&gt;` with `&#10;` around it can't add a cue to the SRT output). The cue's text is the lines left, in order.
4. **WebVTT output**: `WEBVTT` and LF, then for each cue an LF, the timing line `HH:MM:SS.mmm --> HH:MM:SS.mmm` (hours at least two digits) and LF, and each text line followed by LF, with `&`, `<` and `>` written as `&amp;`, `&lt;` and `&gt;`. No cue ids, settings, styles or notes.
5. **SRT output**: blocks joined by one LF; each block is the cue's number from 1, LF, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, LF, and each text line followed by LF. Text is written as it is: after step 3 it holds no tag, no `{...}` block (not even one split over lines), no `-->` and no empty line, so no text line can be read as markup or as the start of another cue.

A file with no cue after this answers 502 `unreadable`. At most 20,000 cues are kept (the first ones in file order).

### Caching

Only metadata is cached, in the existing R2 bucket (binding `BUCKET`, `lumanest-tv-downloads`) under `extras/v1/`, so one search serves every customer in every Cloudflare location:

| Object | Holds | Fresh for |
| --- | --- | --- |
| `extras/v1/subtitles/movie/<tmdb>/en.json` | The chosen files of a movie: `file_id`, `hi` and `label` of each, or none | 30 days with files, 3 days without |
| `extras/v1/subtitles/tv/<tmdb>/s<season>/e<episode>/en.json` | The same for one episode | 30 days with files, 3 days without |
| `extras/v1/trailers/movie/<tmdb>.json`, `extras/v1/trailers/tv/<tmdb>.json` | The chosen key and name, or none | 30 days with a trailer, 7 days without |
| `extras/v1/resolve/movie/<hash>.json`, `extras/v1/resolve/tv/<hash>.json` | The TMDB id found for a name and year, or none; `<hash>` is the hex SHA-256 of `key + "\n" + whole + "\n" + year` | 30 days found, 7 days not found |
| `extras/v1/state/opensubtitles.json` | `quotaUntil`, the sealed login token with its `base_url` and time, the time of the last login attempt, and the keyed hash (`extras-credential`) of rejected credentials | |

- Ids and numbers in keys are canonical decimal (no leading zeros). Each object is JSON with `"v": 1`, `stored` and `expires` (ISO 8601 UTC). File tokens are not stored; the lookup computes them from `file_id`.
- A fresh object is served without calling upstream. An expired one is refreshed while the request waits (at most 8 seconds per upstream request); if the refresh fails, the expired copy is served (if it is under 90 days old) with `Cache-Control: public, max-age=300`, and the next refresh for that object is not tried for 5 minutes (isolate memory). With no copy, a failure answers 503 `unavailable`. Failures are never cached as `none`.
- Each isolate keeps the state object for 60 seconds. Without the `BUCKET` binding (local development) nothing is cached and everything still works.
- Subtitle **files** are never cached on the server (see Read first). Devices keep them (see Apps).
- R2 holds no personal data: only these search results, trailer keys, name resolutions and the OpenSubtitles state. An object is replaced when it is refreshed after it expires; nothing deletes objects on its own (an R2 lifecycle rule could). To drop one bad entry at once (a vandalised TMDB trailer, a wrong subtitle match), delete its object: `deployment.md` lists the keys and the command.
- **Upstream limits.** Each refresh first takes the client's `miss` token, and for IPv6 its /48's (else 429), then the service's `upstream` token before each request (else an upstream failure): see Rate limits.

### Secrets and bindings

| Name | Kind | Purpose |
| --- | --- | --- |
| `OPENSUBTITLES_API_KEY` | secret | The consumer's API key. Unset: subtitles answer `not_configured`. |
| `OPENSUBTITLES_USERNAME`, `OPENSUBTITLES_PASSWORD` | secrets, optional | A user login. Leave unset on a paid plan (see Read first). |
| `TMDB_API_KEY` | secret (exists) | Trailers and the name fallback. |
| `OPENSUBTITLES_DAILY_DOWNLOADS` | plain variable, optional | The day's download budget for every client together, a positive whole number; unset or invalid means 1800. Not a secret. |
| `PLAYER_COOKIE_KEY` | secret (exists) | File token MACs, the clients' keyed hashes, the rejected-credentials hash and the sealed login token. |
| `BUCKET` | R2 (exists) | The `extras/v1/` metadata cache. |
| `DB` | D1 (exists) | The daily download counts, table `extras_download_counts` (migration `0010_extras_download_counts.sql`). |
| `EXTRAS_LIMITER`, `SUBTITLE_FILE_LIMITER` | Workers Rate Limiting (new, free) | The minute limits and upstream keys above; added by `cloudflare:prepare`. No other binding. |

The owner sets the secrets with `npx wrangler secret put OPENSUBTITLES_API_KEY --config dist/server/wrangler-cloudflare.json` (and the same for the two optional ones), as for `TMDB_API_KEY`. Migration `0010_extras_download_counts.sql` must be applied **before** the code is deployed (the file route fails closed without its table): `deployment.md` has the command. `docs/deployment.md` has a "Subtitles and trailers" section with these endpoints, secrets, bindings, the budget, the migration, the terms in Read first, the R2 keys and the log codes; `cloudflare-env.d.ts` declares the new names.

## Apps

### Which ids an app sends

- **Movies**: the movie's TMDB id from browse.md Matching step 1 (provider id), else the TMDB id of the rows item the movie matched (step 2). With neither, `name` (the provider's name) and `year` (step 3) if the year is known; without a year, no request.
- **Episodes**: the **series'** TMDB id found the same way for the series, with the episode's season and episode numbers (Xtream `get_series_info`: the season it is listed under and `episode_num`; M3U: the `S01E02` numbers). A provider id on an episode row is the episode's own TMDB id and is not used. Without a series id: the series' name and year. An episode with no season or episode number gets no request.
- **Trailer**: the movie (`type=movie`) or series (`type=tv`) the same way.

### Subtitles in the player

- **When to look up.** When a movie or episode starts (and when the next episode starts). A movie's details page may look up early. Lookups are cached in memory for the app's session (at most 200 answers, any status). Live channels never look up.
- **Listing.** The player's subtitle menu lists the provider-listed and embedded tracks as today, then the lookup's tracks with their `label`, then, when there is at least one, the line "Subtitles provided by OpenSubtitles.com" (from `credit`; as a note, not a choice). Settings > About also shows "Subtitles provided by OpenSubtitles.com" in every app, next to the TMDB notice.
- **Automatic choice** (Settings > Subtitles On; on Apple TV, On, or Automatic with the system's captions on): an English track the stream carries, else an English track the provider lists, else the **first** OpenSubtitles track, else the app's existing fallback. Roku and the web player, which remember the language the viewer last picked, may first choose the stream's track in that language, before English. Off shows none, as today. A track the viewer picks stays picked for that title until playback ends.
- **Fetch only when shown.** A subtitle file is requested only when its track is about to be shown: chosen in the menu, or picked by the automatic choice. Never prefetch, and never attach a file to a player in a way that downloads it while it isn't shown. Where a platform must attach side-loaded subtitles before playback starts (Android, Roku), attach the first OpenSubtitles track at start only when Subtitles is On, and attach another track when the viewer picks it by reloading the title at the current position. Such platforms wait at most 1.5 seconds for the lookup before starting playback when Subtitles is On, and attach later (reloading at the position) if it answers after that.
- **Device cache.** Keep fetched files so a replay or resume needs no new download where the platform allows: Android and Apple TV on disk in the app's cache folder (at most 20 files; each is used for 7 days and deleted at the next subtitle download after that, when the app's data is cleared, or when the system empties the app's cache); the web player through the browser's HTTP cache (`private, max-age=604800`). Samsung and LG keep the last 4 files in memory until the app closes, and the TV's web engine may keep a file in its HTTP cache for up to 7 days (`private, max-age=604800`). Roku keeps no copy: its player fetches the `srt` URL itself each time the title is loaded (start, resume, a late attach or another track), and each fetch is one download.
- **Safe rendering.** Subtitle text is untrusted. It is shown only as plain text: the platform's own subtitle renderer fed the file (Media3, Roku, the browser's WebVTT renderer), or text views (`textContent`, Compose `Text`, `UILabel`), never HTML (`innerHTML`, `Html.fromHtml`, attributed strings from HTML). Line breaks are kept (`white-space: pre-line` on the web-based apps).
- **In sync.** Cues follow the player's media position, not a wall clock: Media3, Roku and the browser do this themselves; apps that draw cues read the position at least every 250 ms while a track is shown, at once after a seek, and keep the current text while paused. Live playback never shows them. Choosing an OpenSubtitles track turns embedded subtitles off and the other way round.
- **Failure.** If the file fails (non-200, timeout, no cues), the menu choice falls back to Off with a short toast "These subtitles couldn't be loaded."; an automatic choice fails silently.

### Reading WebVTT (apps that draw cues: Samsung, LG, Apple TV)

The server's `.vtt` is simple, but the reader is written for any WebVTT file (kind `vtt_cues`):

1. Remove a leading U+FEFF; split at CR LF, CR and LF. The first line must be `WEBVTT`, alone or followed by a space or tab and anything; otherwise there are no cues.
2. Blocks are runs of non-empty lines after the first line (a line is empty only when it has no character at all). In each block, the timing line is the first or second line that contains `-->`; a block without one (`NOTE`, `STYLE`, `REGION`) is skipped.
3. The timing line must match `^((?:[0-9]{2,}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})[ \t]+-->[ \t]+((?:[0-9]{2,}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3})(?:[ \t].*)?$` (cue settings after it are ignored); minutes and seconds 59 or less; end after start. Otherwise the block is skipped.
4. Each following line of the block: remove every `<[^>]*>`, then decode `&amp;` `&lt;` `&gt;` `&nbsp;` `&quot;` `&apos;` once, left to right (`&nbsp;` is a space), then remove spaces and tabs at both ends; empty lines are dropped. The cue's text is the lines joined with LF; a cue with no text is skipped.
5. Cues sorted by start, equal starts in file order. **The text at time t** (ms) is the text of every cue with `start <= t < end`, in that order, joined with LF; `""` when there is none.

In the JSON cases, times are whole milliseconds; Apple TV's seconds compare after rounding to milliseconds.

### The Trailer button

- **Presence.** Movie and series details pages look up the trailer when they open (one request; cached in memory for the session). The button appears only when the answer has a `trailer`: no button while loading, on any failure or for any other status. It is added after **Add to Library** / **In Library** (movie: Watch Movie or Resume, Add to Library, Trailer; series: its existing buttons, then Trailer), so it never moves the focused button; if the answer arrives while the page is open, the button appears in place without taking focus.
- **Label** "Trailer", with the platform's film or play icon. Adult titles follow the existing adult rules (never shown in store builds, so never looked up there).
- **Opening**, per platform below. If the platform cannot open YouTube (no app, the launch fails or is refused), show the **QR dialog**: title "Watch the trailer on your phone", the QR code from `trailer.qr` (or the platform's own encoder of `https://youtu.be/<key>`), the text `short` under it, "Scan the code with your phone's camera.", and a Close button that returns focus to Trailer.

### Per platform

#### Android TV, Google TV, Fire TV (`apps/android`, both editions)

- **Subtitles.** OpenSubtitles tracks are `ExternalSubtitle`s with the `vtt` URL (`subtitleMimeType` gives `TEXT_VTT`), language `en` and the server's label, marked as OpenSubtitles so the menu can list them before they are attached. `PlayerHolder` adds a `MediaItem.SubtitleConfiguration` only for the OpenSubtitles track being shown (Media3 loads side-loaded files when the item prepares), and reloads the item at the current position, keeping play or pause, when the viewer picks another. The automatic choice order is enforced after `onTracksChanged` with a track selection override, as `subtitleFallback` does. The subtitle dialog shows the credit line. Disk cache: `cacheDir/subtitles/`.
- **Trailer.** In order, `startActivity(Intent(ACTION_VIEW, Uri.parse("https://www.youtube.com/watch?v=<key>")).setPackage(p))` for `p` in `com.google.android.youtube.tv` (Android TV, Google TV), `com.amazon.firetv.youtube` and `com.amazon.firetv.youtube.tv` (Fire TV), `com.google.android.youtube.googletv`, `com.google.android.youtube`; then `Intent(ACTION_VIEW, Uri.parse("vnd.youtube:<key>"))` with no package; catch `ActivityNotFoundException` and `SecurityException` for each and try the next. All fail: the QR dialog (zxing, as the playlist setup page draws its code). No `<queries>` and no permission are needed (the app only starts activities). The same in the store edition (`app.tunertv`).
- **Hidden category**: `isHiddenLiveCategory(name)` in `data/`, a loop over the characters (no regex). Apply it where live categories and channels are read (Xtream and M3U) before `ContentPolicy.live`, and on channels restored from catalogue snapshots saved before this change.
- **Tests**: a test runs every `live_category` case of `docs/extras-cases.json` (path found as `BrowseCasesTest` finds its file), and unit tests cover the intent order with a fake launcher. Any new `Regex` must compile under ICU (no bare `{` or `}`) and goes through `RegexPatternsTest`.

#### Samsung (`apps/tizen`) and LG (`apps/webos`, generated)

- **Shared code.** Pure functions go in `js/data.js` next to the browse rules, on the same global, so both apps' tests run the cases (LG's against the generated file): `isHiddenLiveCategory(name)`, `parseVtt(text)` returning `[{start, end, text}]` in ms, and `vttTextAt(cues, ms)`. ES5 only; character codes, not typed escapes, for any non-ASCII character in a pattern or table (as the Unicode spaces are built today).
- **Subtitles.** Both TVs draw OpenSubtitles cues themselves in the existing `#subtitle-layer`: fetch the `vtt` URL with `XMLHttpRequest` (20-second timeout, as for every app's subtitle file), parse it, and while the track is shown read the player's position every 200 ms (add a `currentTime()` in ms to `js/player.js`: AVPlay `getCurrentTime()`, HTML video `currentTime`). Put the text in with `textContent` (CSS `white-space: pre-line`), not through `showSubtitleText`'s markup clean-up, which is for AVPlay's own events. While an OpenSubtitles track is shown, embedded subtitles are off (`setSilentSubtitle(true)` on AVPlay, every text track `disabled` on LG). LG does not use `<track>`: a track from another origin needs `crossorigin` on the video, which provider streams don't allow. The subtitle dialog lists the OpenSubtitles tracks after the stream's and shows the credit line; it is no longer "No subtitles in this stream" when only OpenSubtitles tracks exist.
- **Trailer, Samsung.** `tizen.application.launchAppControl(new tizen.ApplicationControl("http://tizen.org/appcontrol/operation/view", null, null, null, [new tizen.ApplicationControlData("PAYLOAD", [JSON.stringify({values: "v=" + key})])]), id, onSuccess, onError)` with `id` `111299001912`, then `9Ur5IzDKqV.TizenYouTube` if the first fails (both IDs are in use on Samsung TVs). Both fail, an exception, or no `tizen.application`: the QR dialog. `config.xml` adds `<tizen:privilege name="http://tizen.org/privilege/application.launch" />`, and `tools/widget.js` (and its test) expect it. This deep link is not documented by Samsung: check on a real TV that YouTube opens on the video; if it opens YouTube's home page instead, switch Samsung to the QR dialog (a single constant) before release.
- **Trailer, LG.** `tools/sync-from-tizen.js` gets a port step that replaces the Samsung launcher function with a call to `window.TunerWebOS.openYouTube(key, onFail)`, implemented in `js/webos-platform.js` with `PalmServiceBridge` (what LG's `webOSTV.js` uses inside): call `luna://com.webos.applicationManager/launch` with `{"id": "youtube.leanback.v4", "params": {"contentTarget": "https://www.youtube.com/tv?v=<key>"}}`; a reply with `returnValue` false (for example `errorCode` -101, app not installed), no reply within 5 seconds, or no `PalmServiceBridge`: `onFail`, which shows the QR dialog. `tests/platform.test.cjs` covers it with a stub bridge. No `appinfo.json` permission is needed.
- **QR dialog**: draw `trailer.qr` on a canvas as `js/pairing.js` draws the pairing code (expose its `drawQr` or share it).
- **Hidden category**: applied where live categories are parsed (Xtream and M3U), next to the adult filter.
- **Tests**: Node tests run every `live_category` and `vtt_cues` case of `docs/extras-cases.json` against `js/data.js` in both apps, and app tests cover the button, the menu and the two launchers with stubs.

#### Roku (`apps/roku`)

- **Subtitles.** Roku draws side-loaded subtitles itself, with the viewer's caption style. Use the **`srt`** URL: Roku's side-loaded support for progressive MP4 and MKV is reliable for SRT (its side-loaded WebVTT support is documented for HLS). When shown, set the content node's `SubtitleTracks` to `[{Language: "eng", TrackName: <srt URL>, Description: <label>}]` (ISO 639-2 code), `globalCaptionMode = "On"`, and `subtitleTrack` to the URL once it appears in `availableSubtitleTracks`. Picking another OpenSubtitles track re-sets the content with that track and seeks back to the position. The subtitle menu lists the OpenSubtitles tracks and the credit line.
- **Trailer.** A Roku channel cannot reliably open the YouTube channel on a video (launching another channel from inside a channel is not supported), so Trailer always shows the QR dialog, drawn from `trailer.qr` like the pairing code (`drawQr` in `components/scene/Pairing.brs`, moved where both can use it).
- **Hidden category**: `IsHiddenLiveCategory(name)` in a new `source/lib/ExtrasLogic.brs`, a loop with `Asc` (no `roRegex`, which may match bytes), applied where live categories are read.
- **Tests**: a generator like `tools/browse-cases.mjs` writes `tests/ExtrasCases.brs` from the `live_category` cases (checked by `npm run check`); `tests/ExtrasLogicTests.brs` runs them. Add `source/lib/ExtrasLogic.brs`, `tests/ExtrasCases.brs` and `tests/ExtrasLogicTests.brs` to the `brs-cli` command and `bsconfig.tests.json`.

#### Apple TV (`apps/tvos`)

- **TunerCore** (logic and tests; the app target cannot build here): `Extras.swift` with the response models, a client on the existing HTTP layer with the session cache, `isHiddenLiveCategory(_:)`, and a strict WebVTT reader with `text(at:)` as specified (a new function: the existing `SubtitleParser` stays for provider files, whose overlap rule differs). Tests run the `live_category` and `vtt_cues` cases from `Tests/TunerCoreTests/Fixtures/extras-cases.json`, a copy checked against `docs/extras-cases.json` as `BrowseCasesTests` does. In test files write `TunerCore.Category` in type positions.
- **App target** (small changes): `PlaybackController` adds the OpenSubtitles tracks to its "Subtitle files" menu with the credit, follows the automatic choice, and draws them in the existing overlay with `text(at:)` from its periodic time observer. Disk cache in the Caches folder.
- **Trailer**: `UIApplication.shared.open(URL(string: "youtube://watch/" + key)!, options: [:]) { opened in ... }`; when `opened` is false (YouTube not installed), the QR sheet with `QRImage.make("https://youtu.be/" + key)` and `short`. No `Info.plist` change (`open` needs no `LSApplicationQueriesSchemes`). This is the App Store build: no new permission and no change to `PrivacyInfo.xcprivacy` (the requests carry no user data; lumanest.tv keeps only the daily download count under a keyed hash of the network address, for about two days, an abuse limit like pairing's).
- **Hidden category**: applied where TunerCore builds live categories.

#### Web player (`site/app/watch`)

- **Subtitles.** An OpenSubtitles track becomes a `<track kind="subtitles" srclang="en" label={label} src={vtt}>` on the video element (same origin, so no `crossorigin` is needed) only when it is first shown, and is shown in the same step; any other text track the browser turns on beside it is disabled again. Browsers fetch a track's file once its mode leaves `disabled`, and Chrome turns on subtitle tracks that script has not set yet whenever another one shows, so a `<track>` added before it is chosen could be downloaded without being chosen. The menu lists the lookup's tracks without any `<track>`, so listing costs nothing. `subtitle-controls.tsx` lists them with the stream's tracks, shows the credit line under them, and follows the automatic choice with the existing `lumanest_subtitles` preference. Browsers draw WebVTT cue text as text, not HTML. Casting with subtitles is not part of v1.
- **Trailer.** Trailer opens a dialog with `<iframe src="https://www.youtube-nocookie.com/embed/<key>?autoplay=1&rel=0&playsinline=1" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox">` (YouTube's embed fails without a referrer; the sandbox means the embed can't navigate this page). The iframe is created only when the dialog opens and removed when it closes; Escape, Back on a remote and Close return focus to the button; the key is checked with `YOUTUBE_KEY` before the URL is built. Nothing is loaded from YouTube before the viewer chooses Trailer.
- **Hidden category**: the Live TV categories built for the player (Xtream and M3U groups) use `isHiddenLiveCategory` from `site/lib/extras.ts`.

## Hidden live category

The provider's rotating "Most watched now" list duplicates channels found in its other categories and clashes with Tuner's own **Most Watched**, so it is hidden by name, never by id, which differs from line to line. A live category name is hidden when (kind `live_category`):

1. Each ASCII letter is lower-cased; each ASCII letter or digit is kept; every other character (punctuation, spaces of any kind, emoji, letters beyond ASCII) is a separator.
2. The name is split at separators into words (empty words dropped).
3. One leading word `us`, `usa` or `en` is dropped, then one trailing word `us`, `usa` or `en`.
4. The words left are exactly `most watched now` or `most watched`.

So `Most watched now`, `MOST-WATCHED-NOW`, `|USA| MOST WATCHED NOW`, `EN: Most Watched Now`, `Most Watched Now (US)`, `[US] Most Watched Now` and `Most Watched` are hidden; `Most Watched Movies`, `UK | Most Watched Now`, `MostWatched Now`, `Most Watched Now 4K`, `Trending Now` and a name with a non-ASCII letter inside a word (`Moſt Watched Now`) are not.

Hiding applies to **live** categories only, in every mode (USA only or All), before the USA filter and the folding of copies: the category is removed from the category list, its id is removed from each channel's categories, and a channel left with no category because all of its categories were hidden is dropped (it is a copy of a channel in another category). A channel that had no category at all is unaffected. Movie and series categories are unaffected, and so are Tuner's own Most Watched, Favorites and the Android trending playlist. A favorite or Continue watching entry that pointed at a dropped copy is no longer shown, as for any channel the line removes.

## Privacy text

**`lumanest.tv/privacy`** (`site/app/privacy/page.tsx`), added to "Other services":

- Subtitles: "English subtitles for movies and episodes come from OpenSubtitles.com through this website. When a movie or episode starts, the web player asks this website which subtitles exist, and this website looks them up at OpenSubtitles by the title's TMDB number (with the season and episode). For a title without a TMDB number, this website first sends its name and year to TMDB to find the number. The subtitle file is downloaded from OpenSubtitles and passed to you only when subtitles are shown. OpenSubtitles and TMDB never receive your IP address or anything about you. We don't keep subtitle files; your browser may keep one for up to 7 days."
- Trailers: "When you choose Trailer, the trailer plays in YouTube's embedded player (privacy-enhanced mode, youtube-nocookie.com), which is a YouTube API Service. YouTube (Google) then receives your IP address and browser details, and the [YouTube Terms of Service](https://www.youtube.com/t/terms) and [Google Privacy Policy](https://policies.google.com/privacy) apply. Nothing is loaded from YouTube until you choose Trailer. This website finds the trailer with TMDB without sending anything about you."
- Limits: "To prevent abuse, requests for subtitles and trailers are counted per network address for one minute; the address is not stored. Subtitle downloads are also counted per day: we keep a keyed hash of your network's address (not the address itself) with its number of downloads for the current UTC day. It is kept for that day and the next, then removed by routine clean-up."

**`tunertv.app/privacy`** (`tuner-site/public/privacy.html`; the owner deploys `tuner-site/` separately): a new section under "What Tuner sends, and to whom", "Subtitles and trailers, through lumanest.tv":

> When a movie or episode starts, Tuner asks `lumanest.tv` whether English subtitles exist, sending the title's TMDB number (and the season and episode), or its name and year when it has no TMDB number; lumanest.tv then sends that name and year to TMDB to find the number. lumanest.tv looks the subtitles up at OpenSubtitles.com. Only when you turn subtitles on or pick them does lumanest.tv download the file from OpenSubtitles and pass it to your TV (see what Tuner stores on your TV for how long your TV keeps it). On a movie or series page, Tuner asks lumanest.tv for the title's trailer the same way; lumanest.tv finds it with TMDB. These requests contain no login or other information about you. OpenSubtitles and TMDB never see your TV's IP address. Like any website, lumanest.tv sees your TV's IP address. To limit abuse, it counts requests per network address for one minute without storing the address, and counts subtitle downloads per day under a hashed (pseudonymised) form of your network's address (see how long it's kept).
>
> When you choose Trailer, Tuner opens the YouTube app on your TV with that video (Android TV, Google TV, Fire TV, Samsung, LG and Apple TV), and YouTube's own privacy policy applies to what you watch there. On Roku, or when the YouTube app isn't available, Tuner shows a QR code instead: your phone opens the trailer on YouTube.

Also add **OpenSubtitles** (receives only title numbers from lumanest.tv, never information about you) and **YouTube** (only when you open a trailer, directly from your TV or phone) to "Who we share it with"; say in "How long it's kept" that lumanest.tv's R2 holds only search results and trailer links (replaced when they expire, never subtitle files or personal data) and that the daily download count keeps a keyed hash of the network address for the current UTC day and the next, then removes it by routine clean-up; and update the privacy summary, the Android Data safety note "Other services the app contacts" and the App Privacy notes in `docs/store-listings.md` with lumanest.tv `/api/extras/*` and the YouTube handoff. No new data type is collected: nothing in these requests identifies the viewer, and the daily count is an abuse limit on a pseudonymised network address, kept for about two days, like pairing's rate limits.

## Test cases

`docs/extras-cases.json` holds the cases. Each entry is one of:

- `{"kind": "srt_vtt", "note": "...", "srt": "...", "vtt": "...", "srt_out": "...", "cues": 2}`: one downloaded SRT file (`srt`), its WebVTT output (`vtt`), its SRT output (`srt_out`) and the number of cues. With 0 cues the endpoint answers 502; the outputs are still given (`WEBVTT` and LF, and `""`).
- `{"kind": "cue_text", "input": "...", "text": "..."}`: step 3 of SRT to WebVTT alone: `input` is a cue's text lines joined with LF, `text` the plain lines joined with LF (`""` when none is left).
- `{"kind": "vtt_cues", "note": "...", "vtt": "...", "cues": [{"start": 1000, "end": 2500, "text": "..."}], "at": [[1000, "..."]]}`: Reading WebVTT, and the text at each time in `at`.
- `{"kind": "subtitle_pick", "note": "...", "request": {"type": "movie", "tmdb": 603}, "data": [...], "expect": [{"file_id": 110, "hi": false, "label": "English (OpenSubtitles)"}]}`: Choosing subtitle files from a search's `data` (episode requests also have `season` and `episode`).
- `{"kind": "trailer", "note": "...", "results": [...], "expect": "BdJKm16Co6M"}`: Choosing the trailer from TMDB's `results`; `expect` is the key or `null`.
- `{"kind": "live_category", "name": "|USA| MOST WATCHED NOW", "hidden": true}`: Hidden live category.

| Component | Runs |
| --- | --- |
| Server (`site/lib/extras.ts`) | all kinds except `vtt_cues` |
| Web player | `live_category` (through `site/lib/extras.ts`) |
| Android | `live_category` |
| Samsung and LG (`js/data.js`) | `live_category`, `vtt_cues` |
| Roku | `live_category` |
| Apple TV (TunerCore) | `live_category`, `vtt_cues` |

Characters that are invisible or easily confused are written as `\uXXXX` escapes; the whole file is ASCII. Never type such characters into source: write escapes or character codes, and scan changed files (for example with Python: every character above U+007E, and every control but tab, LF and CR) before committing, since editing tools can turn a typed escape into the character itself.

## Implementation notes

- No component calls OpenSubtitles or TMDB except the server; no key reaches a device or the browser.
- Apps time out lookups after 10 seconds and files after 20, and never retry on their own beyond the next title or the viewer's next choice.
- The endpoint accepts seasons 0 to 100 and episodes 1 to 5000. The web player sends only those; the TV apps still check 0 to 9999 and 1 to 9999 before they ask, and get 400 for a number between, which they treat as "no subtitles", like any other failure.
- Every new pattern in the apps avoids lookbehind and `\w`, `\b` and Unicode classes (browse.md Implementation notes). The hidden-category rule and the WebVTT reader need none beyond the ones written here; Android's must compile under ICU (escape `{` and `}`), Samsung and LG write `[ \t]` rather than `\s`.
- Roku and Samsung/LG keep strings in source ASCII; labels with other characters come from the server's JSON.
