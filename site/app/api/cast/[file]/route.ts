// Cast links named like files (/api/cast/live.m3u8?t=…, /api/cast/segment.ts?t=…); the name only tells the receiver
// the format, and the token decides what is served.
export {GET, HEAD, OPTIONS} from '../stream/route';
