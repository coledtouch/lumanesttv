import {trailerEmbedResponse} from '../../../lib/trailer-embed';

// The in-app trailer player page for the Samsung and LG apps (docs/extras.md, "Trailer in the app"). Public, no
// cookies, cacheable for a day, and frameable by any parent, including file:// pages.
export function GET(req: Request) {return trailerEmbedResponse(req);}
export function HEAD(req: Request) {return trailerEmbedResponse(req);}
