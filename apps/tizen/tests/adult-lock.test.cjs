'use strict';
// Adult category detection and the passcode lock in the shipped js/data.js.
// The same file runs in the Samsung and LG apps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const sourceText = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const LOCK = 'tuner.tv.adultlock.v1';

function memoryStorage() {
    const values = new Map();
    return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)) };
}
function load(extra = {}) {
    const window = Object.assign({ Promise, XMLHttpRequest: function () {}, localStorage: memoryStorage(), setTimeout, clearTimeout }, extra);
    vm.runInNewContext(sourceText, { window, console });
    return window.TunerData;
}

test('adult categories match standalone XXX, adult(s), 18+ and porn tokens but not Adult Swim', () => {
    const data = load();
    for (const name of ['XXX', 'xxx movies', 'Adult', 'ADULTS ONLY', 'US| Adult', 'VOD - 18+', '18+ Channels', 'Porn HD', 'adult_xxx', 'Adult Swim | XXX'])
        assert.equal(data.adultName(name), true, name);
    for (const name of ['Adult Swim', 'ADULT SWIM HD', 'adult-swim', 'Adultswim', 'Young Adulthood', 'XXXL Sports', 'Sussex', 'Sports 18', 'Pornography history', 'Kids', ''])
        assert.equal(data.adultName(name), false, name);
    assert.equal(data.isAdultCategory({ id: '1', name: 'Late Night', adult: true }), true);
    assert.equal(data.isAdultCategory({ id: '1', name: 'Late Night' }), false);
});

test('the Xtream is_adult flag marks categories and streams; it accepts 1, "1" and true only', () => {
    const data = load();
    const cats = data.parseCategories([
        { category_id: '1', category_name: 'Late Night', is_adult: 1 },
        { category_id: '2', category_name: 'Movies', is_adult: '0' },
        { category_id: '3', category_name: 'Night', is_adult: '1' },
        { category_id: '4', category_name: 'Other', is_adult: true },
        { category_id: '5', category_name: 'News', is_adult: 'true' }
    ]);
    assert.deepEqual(plain(cats.map(cat => !!cat.adult)), [true, false, true, true, false]);
    assert.deepEqual(plain(cats[1]), { id: '2', name: 'Movies' }, 'ordinary categories keep their shape');
    const source = { type: 'xtream', server: 'http://example.invalid', username: 'u', password: 'p' };
    const items = data.parseXtream([
        { stream_id: 10, name: 'Flagged', category_id: '2', is_adult: 1 },
        { stream_id: 11, name: 'Plain', category_id: '2', is_adult: 0 },
        { stream_id: 12, name: 'Repeated', category_id: '2' },
        { stream_id: 12, name: 'Repeated', category_id: '5', is_adult: '1' }
    ], 'movies', source);
    assert.deepEqual(plain(items.map(item => !!item.adult)), [true, false, true]);
});

test('the adult filter removes adult categories and every item in one, wherever else it is listed', () => {
    const data = load();
    const categories = [{ id: 'news', name: 'News' }, { id: 'swim', name: 'Adult Swim' }, { id: 'x', name: 'XXX' }, { id: 'f', name: 'Late', adult: true }];
    const items = [
        { id: 'a', name: 'CNN', categoryIds: ['news'] },
        { id: 'b', name: 'Cartoons', categoryIds: ['swim'] },
        { id: 'c', name: 'Night', categoryIds: ['news', 'x'] },
        { id: 'd', name: 'Flagged item', categoryIds: ['news'], adult: true },
        { id: 'e', name: 'Flagged category', categoryIds: ['f'] }
    ];
    const shown = data.adultFilter(items, categories);
    assert.deepEqual(plain(shown.items.map(item => item.id)), ['a', 'b']);
    assert.deepEqual(plain(shown.categories.map(cat => cat.id)), ['news', 'swim']);
    assert.equal(items.length, 5, 'the provider catalogue itself is unchanged');
});

test('passcodes are stored only as a salted SHA-256 digest and verified', () => {
    const storage = memoryStorage();
    const data = load({ localStorage: storage, crypto: { getRandomValues(values) { for (let i = 0; i < values.length; i++) values[i] = i * 17 % 256; return values; } }, Uint8Array });
    const lock = data.createPasscodeLock(storage, () => 1000);
    assert.equal(lock.hasPasscode(), false);
    assert.equal(lock.verify('1234').ok, false);
    assert.equal(lock.setPasscode('12a4'), false);
    assert.equal(lock.setPasscode('123'), false);
    assert.equal(lock.setPasscode('2580'), true);
    assert.equal(lock.hasPasscode(), true);
    const saved = JSON.parse(storage.getItem(LOCK));
    assert.match(saved.salt, /^[0-9a-f]{32}$/);
    assert.match(saved.hash, /^[0-9a-f]{64}$/);
    assert.ok(!storage.getItem(LOCK).includes('2580'), 'the digits are never stored');
    // The digest is SHA-256 over the salt and passcode, iterated.
    let expected = crypto.createHash('sha256').update('tuner-adult-lock:' + saved.salt + ':2580').digest('hex');
    for (let i = 1; i < 64; i++) expected = crypto.createHash('sha256').update(saved.salt + ':' + expected).digest('hex');
    assert.equal(saved.hash, expected);
    assert.equal(data.hashPasscode('2580', saved.salt), expected);
    assert.notEqual(data.hashPasscode('2580', 'ff' + saved.salt.slice(2)), expected, 'the salt changes the digest');
    assert.equal(lock.verify('2580').ok, true);
    assert.equal(lock.verify('0000').ok, false);
    // Another passcode gets a new random salt when crypto is unavailable too.
    const fallback = load({ localStorage: memoryStorage() });
    const other = memoryStorage(), second = fallback.createPasscodeLock(other);
    assert.equal(second.setPasscode('2580'), true);
    assert.notEqual(JSON.parse(other.getItem(LOCK)).hash, saved.hash);
});

test('five wrong passcodes impose a 60 second wait that survives a restart', () => {
    const storage = memoryStorage(), data = load({ localStorage: storage });
    let now = 5000;
    const lock = data.createPasscodeLock(storage, () => now);
    lock.setPasscode('1357');
    assert.deepEqual(plain([1, 2, 3, 4].map(() => lock.verify('0000').left)), [4, 3, 2, 1]);
    const fifth = lock.verify('0000');
    assert.equal(fifth.ok, false); assert.equal(fifth.wait, 60000);
    const restarted = data.createPasscodeLock(storage, () => now);
    assert.equal(restarted.verify('1357').ok, false, 'the right passcode waits too');
    now += 30000; assert.equal(restarted.waitRemaining(), 30000);
    now += 30001; assert.equal(restarted.waitRemaining(), 0);
    assert.equal(restarted.verify('1357').ok, true);
    assert.equal(restarted.verify('0000').left, 4, 'a correct passcode resets the count');
});

test('corrupt saved lock data is ignored instead of unlocking', () => {
    const storage = memoryStorage(), data = load({ localStorage: storage });
    storage.setItem(LOCK, JSON.stringify({ salt: 'x', hash: 'y' }));
    const lock = data.createPasscodeLock(storage);
    assert.equal(lock.hasPasscode(), false);
    assert.equal(lock.verify('1234').ok, false);
    storage.setItem(LOCK, '{not json');
    assert.equal(data.createPasscodeLock(storage).hasPasscode(), false);
});
