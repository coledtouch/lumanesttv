// Which picture the web player shows for a title (app/watch/poster-choice.ts): TMDB's poster for a title matched to a
// TMDB title of the rows, then the line's own poster (direct, or through /api/player/image for a provider host or the
// line's catalogue image host), then the initials card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {NO_POSTERS, TMDB_POSTER_BASE, posterChoices, posterFailed, providerPosterSrc, shownPoster, tmdbPosters, type PosterSources} from '../app/watch/poster-choice.ts';
import {buildTitleSection, parseRowsPayload, titleFromCompact} from '../lib/browse.ts';

const rowsBody = JSON.stringify({
  v: 1, source: 'tmdb', generated: '2026-10-19T00:00:00Z',
  movie: {
    popular: [
      {id: 438631, title: 'Dune', original_title: 'Dune', year: '2021', origin: ['US'], lang: 'en', genres: [878], popularity: 90, poster: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg'},
      {id: 603, title: 'The Matrix', original_title: 'The Matrix', year: '1999', origin: ['US'], lang: 'en', genres: [28], popularity: 80},
      {id: 27205, title: 'Inception', original_title: 'Inception', year: '2010', origin: ['US'], lang: 'en', genres: [28], popularity: 70, poster: 'https://evil.example/x.jpg'},
    ],
    featured: [{id: 438631, title: 'Dune', original_title: 'Dune', year: '2021', origin: ['US'], lang: 'en', genres: [878], popularity: 90, poster: '/other.jpg'}],
    top_rated: [], services: {netflix: [{id: 512195, title: 'Red Notice', original_title: 'Red Notice', year: '2021', origin: ['US'], lang: 'en', genres: [28], popularity: 50, poster: '/rn.png'}]},
  },
  tv: {popular: [{id: 66732, title: 'Stranger Things', original_title: 'Stranger Things', year: '2016', origin: ['US'], lang: 'en', genres: [18], popularity: 99, poster: '/st.jpg'}], featured: [], top_rated: [], services: {}},
  genres: {movie: [], tv: []},
});

test('TMDB poster paths come from every list of the rows, first one per title, checked again in the browser', () => {
  const posters = tmdbPosters(parseRowsPayload(rowsBody));
  assert.deepEqual([...posters.movies], [['438631', '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg'], ['512195', '/rn.png']]);
  assert.deepEqual([...posters.series], [['66732', '/st.jpg']]);
  assert.equal(tmdbPosters(parseRowsPayload(null)), NO_POSTERS.tmdb, 'no rows');
  assert.equal(tmdbPosters(parseRowsPayload(JSON.stringify({v: 1, source: 'none', movie: {}, tv: {}, genres: {}}))).movies.size, 0, 'no TMDB');
  // Rows from before posters were sent (a copy kept in the browser, an old cache): no TMDB posters, nothing breaks.
  const old = JSON.parse(rowsBody);
  for (const item of old.movie.popular) delete item.poster;
  assert.equal(tmdbPosters(parseRowsPayload(JSON.stringify(old))).movies.get('603'), undefined);
});

test('a poster comes from TMDB first, then the line (provider or catalogue image host, or direct), then the initials card', () => {
  const sources: PosterSources = {bases: ['sealed-provider-dir', 'sealed-host-dir'], tmdb: tmdbPosters(parseRowsPayload(rowsBody))};
  const tmdb = (path: string) => TMDB_POSTER_BASE + path;
  // Matched to a TMDB title with a poster: TMDB first, the line's own poster after it (shown if TMDB's fails to load).
  assert.deepEqual(posterChoices({key: 'm1', tmdb: '438631', poster: '~1:dune.jpg'}, sources),
    [tmdb('/d5NXSklXo0qyIYkgV94XAgMIckC.jpg'), '/api/player/image?t=sealed-host-dir&f=dune.jpg']);
  assert.equal(TMDB_POSTER_BASE, 'https://image.tmdb.org/t/p/w342');
  // Matched, but that TMDB title has no (usable) poster: the line's poster.
  assert.deepEqual(posterChoices({key: 'm2', tmdb: '603', poster: '~0:matrix.jpg'}, sources), ['/api/player/image?t=sealed-provider-dir&f=matrix.jpg']);
  assert.deepEqual(posterChoices({key: 'm3', tmdb: '27205', poster: 'https://image.tmdb.org/t/p/w600/i.jpg'}, sources), ['https://image.tmdb.org/t/p/w600/i.jpg']);
  // Not matched: the line's poster.
  assert.deepEqual(posterChoices({key: 'm4', tmdb: '', poster: '~1:x.jpg'}, sources), ['/api/player/image?t=sealed-host-dir&f=x.jpg']);
  // Nothing: the initials card.
  assert.deepEqual(posterChoices({key: 'm5', tmdb: '', poster: ''}, sources), []);
  assert.deepEqual(posterChoices({key: 'm6', tmdb: '603', poster: '~7:missing-base.jpg'}, sources), [], 'a base the catalogue did not send');
  // Series look in the series lists ("s" keys, M3U episodes included), movies in the movie lists.
  assert.deepEqual(posterChoices({key: 's9', tmdb: '66732', poster: ''}, sources), [tmdb('/st.jpg')]);
  assert.deepEqual(posterChoices({key: 's~abcdefghijklmnopqrstu', tmdb: '66732', poster: ''}, sources), [tmdb('/st.jpg')]);
  assert.deepEqual(posterChoices({key: 'm7', tmdb: '66732', poster: ''}, sources), [], 'a movie with a series id');
  // A series' cover from its details comes after TMDB's poster and before the catalogue's.
  assert.deepEqual(posterChoices({key: 's9', tmdb: '66732', poster: '~0:s.jpg'}, sources, '/api/player/image?t=details&f=c.jpg'),
    [tmdb('/st.jpg'), '/api/player/image?t=details&f=c.jpg', '/api/player/image?t=sealed-provider-dir&f=s.jpg']);
  assert.deepEqual(posterChoices({key: 's8', tmdb: '', poster: '~0:s.jpg'}, NO_POSTERS), [], 'no bases');
});

test('the line poster link: direct https as it is, a sealed base through the image route, nothing else', () => {
  assert.equal(providerPosterSrc('', ['b']), '');
  assert.equal(providerPosterSrc('https://image.tmdb.org/t/p/w600/a.jpg', []), 'https://image.tmdb.org/t/p/w600/a.jpg');
  assert.equal(providerPosterSrc('~0:a b.jpg', ['t+/=']), '/api/player/image?t=t%2B%2F%3D&f=a%20b.jpg');
  assert.equal(providerPosterSrc('~0:', ['t']), '/api/player/image?t=t&f=');
  // A catalogue image host poster carries its path and tag; both go to the image route as they are.
  assert.equal(providerPosterSrc('~1:covers/7/p.jpg!Ab-_9xYz', ['p', 'h']), '/api/player/image?t=h&f=covers%2F7%2Fp.jpg!Ab-_9xYz');
  for (const value of ['http://image.tmdb.org/a.jpg', '~x:a.jpg', '~1:a.jpg', 'javascript:alert(1)', '/api/player/image?t=x']) assert.equal(providerPosterSrc(value, ['t']), '', value);
});

test('titles matched through the browse index get their TMDB poster (by provider TMDB id or by title and year)', () => {
  const rows = parseRowsPayload(rowsBody);
  const titles = [
    titleFromCompact('movie', {id: '1', name: 'Dune (2021)', year: '2021', poster: '~0:dune.jpg'}),
    titleFromCompact('movie', {id: '2', name: 'Red Notice', tmdb: '512195'}),
    titleFromCompact('movie', {id: '3', name: 'The Matrix (1999)', year: '1999', poster: '~0:m.jpg'}),
    titleFromCompact('movie', {id: '4', name: 'Not on TMDB', poster: '~0:n.jpg'}),
    titleFromCompact('movie', {id: '5', name: 'No poster at all'}),
  ];
  const section = buildTitleSection(titles, [], rows.movie, rows.genres.movie);
  const sources: PosterSources = {bases: ['b'], tmdb: tmdbPosters(rows)};
  assert.deepEqual(section.items.map(item => posterChoices(item, sources)[0] || 'initials'), [
    TMDB_POSTER_BASE + '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg', TMDB_POSTER_BASE + '/rn.png', '/api/player/image?t=b&f=m.jpg', '/api/player/image?t=b&f=n.jpg', 'initials',
  ]);
});

test('a picture that fails to load gives way to the next: TMDB, then the line’s poster, then the initials card', () => {
  const sources: PosterSources = {bases: ['sealed-provider-dir', 'sealed-host-dir'], tmdb: tmdbPosters(parseRowsPayload(rowsBody))};
  const srcs = posterChoices({key: 'm1', tmdb: '438631', poster: '~1:dune.jpg!Tag12345'}, sources);
  let failed: readonly string[] = [];
  assert.equal(shownPoster(srcs, failed), TMDB_POSTER_BASE + '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg');
  failed = posterFailed(failed, srcs[0]);
  assert.equal(shownPoster(srcs, failed), '/api/player/image?t=sealed-host-dir&f=dune.jpg!Tag12345', 'TMDB failed: the line’s poster');
  assert.equal(posterFailed(failed, srcs[0]), failed, 'a second error for the same picture changes nothing');
  failed = posterFailed(failed, srcs[1]);
  assert.equal(shownPoster(srcs, failed), undefined, 'both failed: the initials card');
  assert.equal(shownPoster([], []), undefined, 'nothing to try: the initials card');
  assert.equal(shownPoster(['', 'b'], []), 'b', 'empty entries are skipped');
});
