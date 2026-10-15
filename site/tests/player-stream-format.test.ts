import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPlayerStreamFormat, PLAYER_STREAM_FORMAT_PREFIX_LIMIT} from '../lib/player-stream-format.ts';

function box(type: string, size = 16) {
  const bytes = new Uint8Array(Math.max(size, 8));
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(type), 4);
  return bytes;
}

test('recognizes ISO-BMFF initialization and media box headers without MIME metadata', () => {
  for (const type of ['ftyp', 'styp', 'moov', 'moof']) assert.equal(detectPlayerStreamFormat(box(type)), 'file', type);
  assert.equal(detectPlayerStreamFormat(box('moof', 8)), 'file');
  assert.equal(detectPlayerStreamFormat(box('ftyp', 8)), null);
  const extended = new Uint8Array(16);
  new DataView(extended.buffer).setUint32(0, 1);
  extended.set(new TextEncoder().encode('moov'), 4);
  new DataView(extended.buffer).setUint32(12, 1024);
  assert.equal(detectPlayerStreamFormat(extended), 'file');
  assert.equal(detectPlayerStreamFormat(extended.subarray(0, 12)), null);
});

test('recognizes HLS only from a complete first identifier line', () => {
  for (const text of ['#EXTM3U\n#EXT-X-VERSION:3', '#EXTM3U\r\n', '\ufeff#EXTM3U\n', ' \r\n#EXTM3U\n']) assert.equal(detectPlayerStreamFormat(new TextEncoder().encode(text)), 'hls');
  for (const text of ['#EXTM3', '#EXTM3U', '#EXTM3UBAD\n', '<html>#EXTM3U\n', '#extm3u\n']) assert.equal(detectPlayerStreamFormat(new TextEncoder().encode(text)), null);
});

test('skips complete padding boxes but does not search arbitrary MPEG-TS, FLV or unknown bytes', () => {
  const padded = new Uint8Array(24);
  padded.set(box('free', 8)); padded.set(box('ftyp'), 8);
  assert.equal(detectPlayerStreamFormat(padded), 'file');
  const ts = new Uint8Array(512).fill(0x47);
  ts.set(box('ftyp'), 188);
  assert.equal(detectPlayerStreamFormat(ts), null);
  assert.equal(detectPlayerStreamFormat(new TextEncoder().encode('FLV\x01\x05\x00\x00\x00\x09')), null);
  assert.equal(detectPlayerStreamFormat(new Uint8Array()), null);
});

test('does not inspect beyond the bounded prefix or accept malformed box sizes', () => {
  assert.equal(PLAYER_STREAM_FORMAT_PREFIX_LIMIT, 512);
  const beyond = new Uint8Array(528);
  beyond.set(box('free', 512)); beyond.set(box('ftyp'), 512);
  assert.equal(detectPlayerStreamFormat(beyond), null);
  const malformed = box('moov'); new DataView(malformed.buffer).setUint32(0, 4);
  assert.equal(detectPlayerStreamFormat(malformed), null);
});
