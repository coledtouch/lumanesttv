import {extras, optionsAnswer, withoutBody} from '../../../../lib/extras-service';
import {extrasDeps} from '../../../../lib/extras-route';

// English subtitles for a movie or an episode, from OpenSubtitles (docs/extras.md). Public: no login, no cookies,
// any origin (the TV apps are not pages on this site). Without OPENSUBTITLES_API_KEY it answers "not_configured".
export function OPTIONS() {return optionsAnswer();}
export function GET(req: Request) {return extras.subtitles(req, extrasDeps());}
export async function HEAD(req: Request) {return withoutBody(await extras.subtitles(req, extrasDeps()));}
