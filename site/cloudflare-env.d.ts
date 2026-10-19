declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Google Cast custom receiver app ID (public/cast/receiver.html); unset uses Google's Default Media Receiver. */
    CAST_RECEIVER_APP_ID?: string;
    /** TMDB v3 API key or v4 read access token for /api/catalog/rows; unset answers source "none". Needs TMDB's commercial terms first (docs/deployment.md). */
    TMDB_API_KEY?: string;
    /** Web player poster requests per line (scripts/prepare-cloudflare.mjs); optional. */
    PLAYER_LIMITER?: RateLimit;
  }
}
