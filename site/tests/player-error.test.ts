import test from 'node:test';
import assert from 'node:assert/strict';
import {playerStreamError} from '../lib/player-error.ts';

test('stream failures expose only fixed playback guidance and selected numeric HTTP codes', () => {
  const privateDetail = 'http://private-user:private-password@provider.invalid/line?token=private-token';
  for (const detail of [privateDetail, undefined, {message: privateDetail}, 'Exception', 'FormatUnsupported', 'FormatError', 'CodecUnsupported', 'MediaMSEError']) {
    for (const code of [undefined, 403, 502, 504, 500, -1]) {
      const copy = playerStreamError(detail, code);
      assert.ok(!copy.includes('private-'));
      assert.ok(!copy.includes('provider.invalid'));
      assert.ok(!copy.includes('HTTP 500'));
      assert.ok(!copy.includes('HTTP -1'));
      assert.ok(copy.length < 200);
    }
  }
  assert.match(playerStreamError('CodecUnsupported'), /codec your browser cannot play/);
  assert.match(playerStreamError('FormatError'), /invalid video data/);
});
