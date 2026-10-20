import {extras, optionsAnswer} from '../../../../../../lib/extras-service';
import {extrasDeps} from '../../../../../../lib/extras-route';

// One subtitle file a lookup offered, as WebVTT (.vtt) or SRT (.srt) (docs/extras.md). Each GET downloads it from
// OpenSubtitles and converts it; nothing is kept on the server. HEAD answers without downloading.
export function OPTIONS() {return optionsAnswer();}
export function GET(req: Request) {return extras.subtitleFile(req, extrasDeps());}
export function HEAD(req: Request) {return extras.subtitleFile(req, extrasDeps(), {head: true});}
