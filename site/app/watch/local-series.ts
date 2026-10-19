// Series made from an M3U playlist's episode entries ("Show S01E02"): one poster per show, with its episodes listed
// locally (the playlist has no series details to load). Pure, so tests run it directly.
import {titleFromM3u, titleYearOf, type BrowseTitle} from '../../lib/browse.ts';
import type {EpisodeInfo, SeasonInfo} from '../../lib/player-vod-data.ts';

/** An episode; `channel` is the playlist entry that plays an M3U episode. */
export type Episode = EpisodeInfo & {season: number; label: string; index: number; channel?: string};
/** A series grouped from playlist entries, as the details screen lists it. */
export type LocalSeries = {key: string; seasons: SeasonInfo[]; episodes: Episode[]};
/** A playlist movie or series entry (a channel of kind movie or series, with a token). */
export type PlaylistEntry = {id: string; name: string; group: string; logo: string; ext: string};

const EPISODE_NAME = /^(.*?)[\s._|:-]*\bS(\d{1,3})[\s._-]*E(\d{1,4})(?![0-9])[\s._|:-]*(.*)$/i;

/** "Show S01E02 Title" -> {show: "Show", season: 1, episode: 2, title: "Title"}, or null when the name has no SxxEyy. */
export function parseEpisodeName(name: string): {show: string; season: number; episode: number; title: string} | null {
  const match = EPISODE_NAME.exec(name.trim());
  if (!match) return null;
  const show = match[1].replace(/[\s._|:-]+$/, '').trim();
  if (!show) return null;
  return {show, season: Number(match[2]), episode: Number(match[3]), title: match[4].trim()};
}

/** A stable Library key for a show: "s~" and 24 hex digits of FNV-1a hashes of its category and name. */
export function showKey(group: string, show: string) {
  const text = group.trim().toLowerCase() + '\n' + show.trim().toLowerCase();
  let out = '';
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9]) {
    let hash = seed >>> 0;
    for (let i = 0; i < text.length; i++) {hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0;}
    out += hash.toString(16).padStart(8, '0');
  }
  return 's~' + out;
}

/**
 * The playlist's series entries as titles: entries named "Show SxxEyy" become one series per show and category,
 * with its episodes in season and episode order; other entries stay single episodes that play on their own.
 */
export function groupPlaylistSeries(entries: PlaylistEntry[]): {titles: BrowseTitle[]; series: LocalSeries[]} {
  const titles: BrowseTitle[] = [];
  const shows = new Map<string, {title: BrowseTitle; episodes: Episode[]}>();
  for (const entry of entries) {
    const parsed = parseEpisodeName(entry.name);
    if (!parsed) {titles.push(titleFromM3u('episode', entry.id, entry.name, entry.logo, entry.group, entry.ext)); continue;}
    const key = showKey(entry.group, parsed.show);
    let show = shows.get(key);
    if (!show) {
      const title: BrowseTitle = {kind: 'series', key, id: '', name: parsed.show, cat: entry.group || 'Other', adult: false, year: titleYearOf(parsed.show), rating: 0, hint: '', genre: '', poster: entry.logo, ext: '', added: 0};
      shows.set(key, show = {title, episodes: []});
      titles.push(title);
    }
    if (!show.title.poster && entry.logo) show.title.poster = entry.logo;
    show.episodes.push({id: entry.id, episode: parsed.episode, title: parsed.title, ext: entry.ext || 'mp4', season: parsed.season, label: `S${parsed.season} E${parsed.episode}`, index: 0, channel: entry.id});
  }
  const series: LocalSeries[] = [];
  for (const {title, episodes} of shows.values()) {
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    episodes.forEach((episode, index) => {episode.index = index;});
    const seasons: SeasonInfo[] = [];
    for (const episode of episodes) {
      let season = seasons[seasons.length - 1];
      if (!season || season.season !== episode.season) seasons.push(season = {season: episode.season, name: episode.season ? 'Season ' + episode.season : 'Specials', episodes: []});
      season.episodes.push({id: episode.id, episode: episode.episode, title: episode.title, ext: episode.ext});
    }
    series.push({key: title.key, seasons, episodes});
  }
  return {titles, series};
}
