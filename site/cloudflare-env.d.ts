declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Plain variable: "true" offers free 24-hour trial requests (/trial) once MYBUNNY_API_KEY, CUSTOMER_PORTAL_URL and PLAYER_COOKIE_KEY are set and migration 0011 is applied; anything else hides them (docs/trials.md). */
    TRIALS_ENABLED?: string;
    /** Google Cast custom receiver app ID (public/cast/receiver.html); unset uses Google's Default Media Receiver. */
    CAST_RECEIVER_APP_ID?: string;
    /** TMDB v3 API key or v4 read access token for /api/catalog/rows; unset answers source "none". Needs TMDB's commercial terms first (docs/deployment.md). */
    TMDB_API_KEY?: string;
    /** Web player poster requests per line (scripts/prepare-cloudflare.mjs); optional. */
    PLAYER_LIMITER?: RateLimit;
    /** OpenSubtitles.com consumer API key for /api/extras/subtitles; unset answers "not_configured". Needs a paid plan first (docs/deployment.md). */
    OPENSUBTITLES_API_KEY?: string;
    /** Optional OpenSubtitles user login; leave unset on a paid plan (docs/extras.md, Read first). */
    OPENSUBTITLES_USERNAME?: string;
    OPENSUBTITLES_PASSWORD?: string;
    /** Optional plain variable (not a secret): OpenSubtitles downloads a day for all clients together, a positive whole number; unset or invalid means 1800 (docs/extras.md). */
    OPENSUBTITLES_DAILY_DOWNLOADS?: string;
    /** Subtitle and trailer lookups per client (an IPv4 address or an IPv6 /64), and upstream searches per service, 120 a minute (scripts/prepare-cloudflare.mjs); optional. */
    EXTRAS_LIMITER?: RateLimit;
    /** Subtitle file downloads per client (an IPv4 address or an IPv6 /64) and uncached lookups per client and per IPv6 /48, 12 a minute each (scripts/prepare-cloudflare.mjs); optional. */
    SUBTITLE_FILE_LIMITER?: RateLimit;
  }
}
