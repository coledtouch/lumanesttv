import test from 'node:test';
import assert from 'node:assert/strict';
import {castSource} from '../lib/player-data.ts';

test('cast links ask the provider for HLS, which TV receivers can play', () => {
  assert.equal(castSource('https://tv.lumanest.tv/live/u/p/101.ts?token=x').url, 'https://tv.lumanest.tv/live/u/p/101.m3u8?token=x');
  assert.equal(castSource('https://tv.lumanest.tv/live/u/p/101').url, 'https://tv.lumanest.tv/live/u/p/101.m3u8');
  assert.equal(castSource('https://tv.lumanest.tv/live/u/p/101.m3u8').contentType, 'application/x-mpegURL');
  assert.equal(castSource('http://tv.lumanest.tv/u/p/101').url, 'http://tv.lumanest.tv/live/u/p/101.m3u8');
  assert.equal(castSource('http://tv.lumanest.tv/u/p/101.ts').url, 'http://tv.lumanest.tv/live/u/p/101.m3u8');
  assert.equal(castSource('https://tv.lumanest.tv/series/u/p/9.mkv').url, 'https://tv.lumanest.tv/series/u/p/9.mkv');
  const movie = castSource('https://tv.lumanest.tv/movie/u/p/7.mp4');
  assert.deepEqual([movie.url, movie.contentType, movie.live], ['https://tv.lumanest.tv/movie/u/p/7.mp4', 'video/mp4', false]);
});
