declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Google Cast custom receiver app ID (public/cast/receiver.html); unset uses Google's Default Media Receiver. */
    CAST_RECEIVER_APP_ID?: string;
  }
}
