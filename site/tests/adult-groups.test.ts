import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPasscode, isAdultGroup} from '../lib/player-data.ts';

test('adult categories are recognised by a standalone XXX, adult, 18+ or porn token', () => {
  for (const name of ['XXX', 'xxx', 'FR | XXX', 'XXX: Movies', 'Adult', 'ADULTS', 'Adults Only', 'For adults', '18+', 'UK 18+ Channels', 'VIP |18+|', '+18 Live', 'Porn', 'porn hd', 'Adult Swim | XXX'])
    assert.equal(isAdultGroup(name), true, name);
});

test('ordinary categories, Adult Swim and words that merely contain the tokens stay visible', () => {
  for (const name of ['Adult Swim', 'adult swim', 'US | Adult Swim HD', 'AdultSwim', 'Adultos Mayores', 'XXXL Sports', 'Sports', 'Kids', 'News 18', '118+ Channels', 'Pornography Documentaries', 'Movies 2018', ''])
    assert.equal(isAdultGroup(name), false, name);
});

test('passcode hashes are salted SHA-256 hex digests', async () => {
  const hash = await hashPasscode('1234', 'salt-a');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, await hashPasscode('1234', 'salt-a'));
  assert.notEqual(hash, await hashPasscode('1234', 'salt-b'));
  assert.notEqual(hash, await hashPasscode('1235', 'salt-a'));
});
