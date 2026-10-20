import {extras, optionsAnswer, withoutBody} from '../../../../lib/extras-service';
import {extrasDeps} from '../../../../lib/extras-route';

// A movie's or series' YouTube trailer, found with TMDB (docs/extras.md). Public: no login, no cookies, any origin.
// Without TMDB_API_KEY it answers "not_configured"; the key never leaves the server.
export function OPTIONS() {return optionsAnswer();}
export function GET(req: Request) {return extras.trailer(req, extrasDeps());}
export async function HEAD(req: Request) {return withoutBody(await extras.trailer(req, extrasDeps()));}
