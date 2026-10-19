// The web player's screen logic: arrow-key focus moves (app/watch/spatial.ts), screens in the address
// (app/watch/watch-route.ts) and how a movie's container plays in a browser (app/watch/vod-format.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {gridWindow, intersects, keepsKey, navigate, nextInDirection, type Box, type NavGroup, type NavItem} from '../app/watch/spatial.ts';
import {normalizeRoute, parseRoute, posterFocusKey, routeHref, routeLabel, sameRoute, sectionOf, seeAllRoute, startRoute, type Route} from '../app/watch/watch-route.ts';
import {playFormat, resumable, vodPlan} from '../app/watch/vod-format.ts';
import {stageKey} from '../app/watch/player-keys.ts';
import {groupPlaylistSeries, parseEpisodeName, showKey} from '../app/watch/local-series.ts';
import {LIBRARY_KEY, libraryRecordProgress, libraryNew} from '../lib/browse.ts';

const box = (left: number, top: number, width = 100, height = 150): Box => ({left, top, right: left + width, bottom: top + height});

// A grid of 3 rows x 4 posters, 100x150 with 20 px gaps, starting at (200, 100).
const grid = Array.from({length: 12}, (_, i) => box(200 + (i % 4) * 120, 100 + Math.floor(i / 4) * 170));

test('arrows move through a grid in four directions and stop at its edges', () => {
  assert.equal(nextInDirection(grid[5], grid, 'right'), 6);
  assert.equal(nextInDirection(grid[5], grid, 'left'), 4);
  assert.equal(nextInDirection(grid[5], grid, 'down'), 9);
  assert.equal(nextInDirection(grid[5], grid, 'up'), 1);
  assert.equal(nextInDirection(grid[3], grid, 'right'), -1, 'nothing further right');
  assert.equal(nextInDirection(grid[0], grid, 'up'), -1);
  assert.equal(nextInDirection(grid[11], grid, 'down'), -1);
});

test('a box in the same row or column wins over a nearer one on a diagonal', () => {
  const from = box(0, 0);
  const diagonal = box(110, 160, 100, 150); // just right and below
  const sameRow = box(400, 10, 100, 150); // far right, same row
  assert.equal(nextInDirection(from, [diagonal, sameRow], 'right'), 1);
  // Without an aligned one, the nearest wins, counting the gap across twice.
  assert.equal(nextInDirection(from, [box(150, 400), box(300, 170)], 'right'), 1);
  // Equal scores keep document order.
  assert.equal(nextInDirection(from, [box(200, 0), box(200, 0)], 'right'), 0);
});

test('a scaled focused card does not trap focus, and empty boxes are ignored', () => {
  // The focused poster grows 5% (7 px of 150) past its neighbours' edges; they are still reachable.
  const focused = {left: 317, top: 96, right: 423, bottom: 254};
  assert.equal(nextInDirection(focused, grid, 'right'), 2);
  assert.equal(nextInDirection(focused, grid, 'left'), 0);
  assert.equal(nextInDirection(focused, [box(0, 0, 0, 0), box(500, 100)], 'right'), 1);
});

test('the navigation rail and the content: right from the rail reaches the content, left comes back', () => {
  const rail = [box(0, 100, 160, 48), box(0, 160, 160, 48), box(0, 220, 160, 48)];
  const content = [box(220, 140, 100, 150), box(340, 140, 100, 150)];
  const all = [...rail, ...content];
  assert.equal(nextInDirection(rail[1], all, 'right'), 3, 'the poster level with Live TV');
  // Back to the rail: of the items level with the poster, the one whose centre is nearest (the hook then prefers the
  // current section's item).
  assert.equal(nextInDirection(content[0], all, 'left'), 2);
  assert.equal(nextInDirection(box(220, 150, 100, 40), all, 'left'), 1);
  assert.equal(nextInDirection(rail[0], all, 'down'), 1, 'down the rail');
  assert.ok(intersects(box(0, 0), box(50, 50)));
  assert.ok(!intersects(box(0, 0), box(200, 0)));
});

test('screens in the address: parse, build, round trip', () => {
  const routes: Route[] = [
    {view: 'home'}, {view: 'live'}, {view: 'library'}, {view: 'settings'},
    {view: 'discover', type: 'series', list: 'netflix', genre: ''}, {view: 'discover', type: 'movies', list: 'rated', genre: '878'},
    {view: 'search', q: 'dune'}, {view: 'title', key: 'm123'}, {view: 'title', key: 's~' + 'a'.repeat(43)}, {view: 'play', key: 's9', ep: '456'}, {view: 'play', key: 'm1'},
  ];
  for (const route of routes) assert.deepEqual(parseRoute(new URL('https://x' + routeHref(route)).search), route, routeHref(route));
  assert.equal(routeHref({view: 'discover', type: 'movies', list: 'popular', genre: ''}), '/watch?view=discover&type=movies&list=popular');
  assert.ok(sameRoute({view: 'home'}, {view: 'home'}));
  assert.ok(!sameRoute({view: 'home'}, null));
});

test('unknown or invalid screens fall back to the start view', () => {
  const caps = {titles: true, tmdb: true};
  for (const search of ['', '?view=nope', '?view=title&title=../x', '?view=title', '?view=play&title=m12a', '?view=title&title=x1']) {
    assert.equal(parseRoute(search), null, search);
    assert.deepEqual(normalizeRoute(parseRoute(search), caps, 'home'), {view: 'home'});
  }
  assert.deepEqual(parseRoute('?view=discover&type=films&list=bogus&genre=<script>'), {view: 'discover', type: 'movies', list: 'popular', genre: ''});
  assert.deepEqual(parseRoute('?view=play&title=m1&ep=x'), {view: 'play', key: 'm1'});
  assert.equal((parseRoute('?view=search&q=' + 'a'.repeat(300)) as {q: string}).q.length, 100);
  // Without TMDB, Popular and Featured become Top rated.
  assert.deepEqual(normalizeRoute({view: 'discover', type: 'movies', list: 'popular', genre: ''}, {titles: true, tmdb: false}, 'home'), {view: 'discover', type: 'movies', list: 'rated', genre: ''});
  assert.deepEqual(normalizeRoute({view: 'discover', type: 'movies', list: 'featured', genre: ''}, {titles: true, tmdb: true}, 'home').view, 'discover');
  // Without any movies or series, the browse screens lead to Live TV; Search and Settings stay.
  for (const view of ['home', 'library'] as const) assert.deepEqual(normalizeRoute({view}, {titles: false, tmdb: true}, 'home'), {view: 'live'});
  assert.deepEqual(normalizeRoute({view: 'title', key: 'm1'}, {titles: false, tmdb: false}, 'home'), {view: 'live'});
  assert.deepEqual(normalizeRoute({view: 'settings'}, {titles: false, tmdb: false}, 'home'), {view: 'settings'});
  assert.deepEqual(startRoute({titles: true, tmdb: false}, 'live'), {view: 'live'}, 'the Start on setting');
  assert.deepEqual(startRoute({titles: false, tmdb: false}, 'home'), {view: 'live'});
});

test('See all, sections and spoken names', () => {
  assert.deepEqual(seeAllRoute({type: 'series', list: 'netflix'}), {view: 'discover', type: 'series', list: 'netflix', genre: ''});
  assert.deepEqual(seeAllRoute({type: 'library', list: 'continue'}), {view: 'library'});
  assert.equal(sectionOf({view: 'play', key: 'm1'}), 'home');
  assert.equal(sectionOf({view: 'search', q: ''}), 'search');
  // A title opened from Discover (or Search, or the Library) keeps that section highlighted.
  assert.equal(sectionOf({view: 'title', key: 'm1'}, 'discover'), 'discover');
  assert.equal(sectionOf({view: 'play', key: 'm1'}, 'library'), 'library');
  assert.equal(sectionOf({view: 'home'}, 'discover'), 'home');
  assert.equal(routeLabel({view: 'discover', type: 'movies', list: 'popular', genre: ''}, 'Popular'), 'Discover: Movies, Popular');
  assert.equal(routeLabel({view: 'live'}), 'Live TV');
});

test('how each container plays in a browser', () => {
  const chrome = (type: string) => type === 'video/webm' ? 'probably' : '';
  const safari = () => '';
  const cases: [string, ReturnType<typeof vodPlan>, ReturnType<typeof vodPlan>][] = [
    ['mp4', {mode: 'file', castable: true}, {mode: 'file', castable: true}],
    ['M4V', {mode: 'file', castable: true}, {mode: 'file', castable: true}],
    ['mov', {mode: 'file', castable: true}, {mode: 'file', castable: true}],
    ['m3u8', {mode: 'hls', castable: true}, {mode: 'hls', castable: true}],
    ['webm', {mode: 'file', castable: false}, {mode: 'tuner', castable: false}],
    ['ts', {mode: 'mpegts', castable: false}, {mode: 'mpegts', castable: false}],
    ['mkv', {mode: 'maybe', castable: false}, {mode: 'maybe', castable: false}],
    ['avi', {mode: 'tuner', castable: false}, {mode: 'tuner', castable: false}],
    ['flv', {mode: 'tuner', castable: false}, {mode: 'tuner', castable: false}],
    ['wmv', {mode: 'tuner', castable: false}, {mode: 'tuner', castable: false}],
    ['', {mode: 'tuner', castable: false}, {mode: 'tuner', castable: false}],
  ];
  for (const [container, inChrome, inSafari] of cases) {
    assert.deepEqual(vodPlan(container, chrome), inChrome, container + ' in Chrome');
    assert.deepEqual(vodPlan(container, safari), inSafari, container + ' in Safari');
  }
  assert.deepEqual(['file', 'hls', 'mpegts', 'maybe', 'tuner'].map(mode => playFormat(mode as never)), ['file', 'hls', 'mpegts', 'file', 'file']);
});

// ---------------------------------------------------------------- keys and focus (the verifier's walk findings)

// Home: two rows of six 100x150 posters ending in See all (group 0 and 1), a rail on the left, a search field on top.
function homeLayout() {
  const items: NavItem[] = [];
  const rail = [box(0, 100, 160, 48), box(0, 160, 160, 48)];
  for (const railBox of rail) items.push({box: railBox, group: -1, rail: true});
  for (let row = 0; row < 2; row++) for (let i = 0; i < 7; i++) items.push({box: box(220 + i * 120, 120 + row * 220), group: row, rail: false});
  const groups: NavGroup[] = [{box: {left: 200, top: 110, right: 1000, bottom: 280}, remembered: -1}, {box: {left: 200, top: 330, right: 1000, bottom: 500}, remembered: -1}];
  return {items, groups, row: (row: number, i: number) => 2 + row * 7 + i};
}

test('left and right stay in a row: the end of a row goes nowhere, its start leads to the navigation', () => {
  const {items, groups, row} = homeLayout();
  const from = (i: number) => items[i];
  assert.equal(navigate(from(row(0, 3)), items, groups, 'right'), row(0, 4));
  // "See all: Popular – Movies" is the last item of the first row: Right must not jump into the row below.
  assert.equal(navigate(from(row(0, 6)), items, groups, 'right'), -1);
  assert.equal(navigate(from(row(1, 6)), items, groups, 'right'), -1);
  const left = navigate(from(row(1, 0)), items, groups, 'left');
  assert.ok(items[left].rail, 'the first poster of a row leads left into the navigation');
  assert.equal(navigate(from(row(1, 1)), items, groups, 'left'), row(1, 0));
});

test('entering a row: the poster last focused there, else from outside any row its first poster in view', () => {
  const {items, groups, row} = homeLayout();
  // A wide search field above both rows, centred over the second poster: Down goes to the first poster.
  const field: NavItem = {box: {left: 200, top: 40, right: 520, bottom: 80}, group: -1, rail: false};
  assert.equal(navigate(field, items, groups, 'down'), row(0, 0));
  // Between rows, the poster below (same column) unless the row remembers one still in view.
  assert.equal(navigate(items[row(0, 3)], items, groups, 'down'), row(1, 3));
  const remembering = groups.map((group, i) => i === 1 ? {...group, remembered: row(1, 5)} : group);
  assert.equal(navigate(items[row(0, 3)], items, remembering, 'down'), row(1, 5));
  // A remembered poster scrolled out of the row's view is not returned to.
  const scrolled = groups.map((group, i) => i === 1 ? {box: {...group.box, right: 500}, remembered: row(1, 5)} : group);
  assert.equal(navigate(items[row(0, 3)], items, scrolled, 'down'), row(1, 3));
  // Up and down skip the rail while anything else is there.
  assert.equal(navigate(items[row(1, 0)], items, groups, 'up'), row(0, 0));
});

test('from the focused video, any arrow first reaches a button over it (Next episode)', () => {
  const video: NavItem = {box: box(200, 100, 800, 450), group: -1, rail: false};
  const next: NavItem = {box: box(500, 300, 200, 48), group: -1, rail: false, inside: true};
  const back: NavItem = {box: box(200, 40, 80, 30), group: -1, rail: false};
  for (const direction of ['up', 'down', 'left', 'right'] as const) assert.equal(navigate(video, [back, next], [], direction), 1, direction);
  assert.equal(navigate(video, [back], [], 'up'), 0);
});

test('a long grid is measured only around the focused poster', () => {
  assert.deepEqual(gridWindow(500, 6000, 48), [[452, 549]]);
  assert.deepEqual(gridWindow(3, 6000, 48), [[0, 52]]);
  assert.deepEqual(gridWindow(-1, 6000, 48), [[0, 48], [5952, 6000]], 'from outside: its first and last posters');
  assert.deepEqual(gridWindow(-1, 60, 48), [[0, 60]]);
  // Every poster one row down (6 columns) is inside the window.
  const columns = 6, at = 1277;
  const [[start, end]] = gridWindow(at, 6000, 48);
  assert.ok(at + columns < end && at - columns >= start);
});

test('a drop-down never keeps an arrow key (a remote would change the category by moving past it)', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) assert.equal(keepsKey('select', key), false, key);
  assert.ok(keepsKey('text', 'ArrowLeft') && keepsKey('text', 'ArrowRight') && !keepsKey('text', 'ArrowDown'));
  assert.ok(keepsKey('range', 'ArrowRight') && !keepsKey('range', 'ArrowUp'));
  assert.ok(keepsKey('media', 'ArrowDown'));
  assert.ok(!keepsKey('toggle', 'ArrowDown') && !keepsKey('other', 'ArrowLeft'));
});

test('the video area: Enter on a button over the video is that button, not play/pause; arrows with nothing focused move focus', () => {
  // Next episode, Send … to your TV and Play … here are buttons over the video.
  assert.equal(stageKey('Enter', 'other', 'play', true), null);
  assert.equal(stageKey(' ', 'other', 'play', true), null);
  assert.equal(stageKey('Enter', 'stage', 'play', true), 'toggle');
  assert.equal(stageKey(' ', 'none', 'play', true), 'toggle');
  assert.equal(stageKey('Enter', 'media', 'play', true), null, 'a focused <video> handles its own keys');
  // Live TV: ↓ changes channel only on the focused video box; with nothing focused, it moves focus (no channel starts).
  assert.equal(stageKey('ArrowDown', 'stage', 'live', false), 'next');
  assert.equal(stageKey('ArrowUp', 'stage', 'live', false), 'previous');
  assert.equal(stageKey('ArrowDown', 'none', 'live', false), null);
  assert.equal(stageKey('ArrowDown', 'other', 'live', false), null);
  assert.equal(stageKey('Enter', 'stage', 'live', false), null);
});

test('posters in several rows have their own focus keys, so Back returns to the row the title was opened from', () => {
  assert.notEqual(posterFocusKey('rated-movies', 'm1011'), posterFocusKey('popular-movies', 'm1011'));
  assert.equal(posterFocusKey('grid', 'm1277'), 'title:grid:m1277');
});

test('genre filters in any language survive a reload; M3U episodes can be named in the address', () => {
  for (const genre of ['Comédie', "Children's", 'Science-Fiction', 'Sci-Fi & Fantasy', '878', 'Action & Adventure', 'Drame']) {
    const route: Route = {view: 'discover', type: 'movies', list: 'az', genre};
    assert.deepEqual(parseRoute(new URL('https://x' + routeHref(route)).search), route, genre);
  }
  for (const genre of ['<script>', ' leading', 'x'.repeat(41), "'quote"]) assert.equal((parseRoute('?view=discover&genre=' + encodeURIComponent(genre)) as {genre: string}).genre, '', genre);
  const ep = 'A'.repeat(43);
  assert.deepEqual(parseRoute('?view=play&title=s~' + 'a'.repeat(24) + '&ep=' + ep), {view: 'play', key: 's~' + 'a'.repeat(24), ep});
});

test('a movie resumes exactly when the Library offers Resume', () => {
  // Saved: 15 s or more and under 95% (libraryRecordProgress). Resumed: the same.
  for (const [at, duration] of [[20, 40], [15, 300], [100, 6000], [5700, 6000], [37, 40], [14, 40], [38, 40], [0, 100]]) {
    const saved = libraryRecordProgress(libraryNew('x'), {k: 'm1', p: at, d: duration}, 1).prog.length > 0;
    assert.equal(resumable(at, duration), saved, `${at} of ${duration}`);
  }
  assert.ok(!resumable(20, Number.NaN));
});

test('M3U series entries become one series per show with its episodes', () => {
  assert.deepEqual(parseEpisodeName('Stranger Things S01E02'), {show: 'Stranger Things', season: 1, episode: 2, title: ''});
  assert.deepEqual(parseEpisodeName('The Bear - S2 E10 - Fishes'), {show: 'The Bear', season: 2, episode: 10, title: 'Fishes'});
  assert.deepEqual(parseEpisodeName('Lupin.S03E01.720p'), {show: 'Lupin', season: 3, episode: 1, title: '720p'});
  for (const name of ['S01E02', 'Dune (2021)', 'Season 1 Episode 2', 'Seasons01E02']) assert.equal(parseEpisodeName(name), null, name);
  const entry = (id: string, name: string, group = 'VOD | Series') => ({id: id.repeat(43).slice(0, 43), name, group, logo: '', ext: 'mp4'});
  const {titles, series} = groupPlaylistSeries([
    entry('a', 'Dark S01E02'), entry('b', 'Dark S01E01'), entry('c', 'dark s02e01 Return'), entry('d', 'Bluey S01E01'), entry('e', 'One-off special'), entry('f', 'Dark S01E01', 'Other group'),
  ]);
  assert.deepEqual(titles.map(title => [title.kind, title.name]), [['series', 'Dark'], ['series', 'Bluey'], ['episode', 'One-off special'], ['series', 'Dark']]);
  const dark = series.find(item => item.key === titles[0].key)!;
  assert.deepEqual(dark.episodes.map(episode => [episode.label, episode.index, episode.channel![0]]), [['S1 E1', 0, 'b'], ['S1 E2', 1, 'a'], ['S2 E1', 2, 'c']]);
  assert.deepEqual(dark.seasons.map(season => [season.season, season.name, season.episodes.length]), [[1, 'Season 1', 2], [2, 'Season 2', 1]]);
  assert.equal(dark.episodes[2].title, 'Return');
  for (const title of titles) assert.ok(LIBRARY_KEY.test(title.key), title.key);
  assert.notEqual(titles[0].key, titles[3].key, 'the same name in another category is another show');
  assert.equal(showKey('VOD | Series', 'Dark'), showKey('vod | series', 'DARK'), 'stable across case');
});
