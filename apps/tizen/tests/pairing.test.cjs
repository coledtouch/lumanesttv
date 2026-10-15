'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const pairingText = fs.readFileSync(path.join(__dirname, '../js/pairing.js'), 'utf8');
const dataText = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');

function load() {
    const window = { localStorage: { getItem: () => null, setItem() {} } };
    window.window = window;
    vm.createContext(window);
    vm.runInContext(dataText, window);
    vm.runInContext(pairingText, window);
    return window.TunerPairing;
}

test('paired accounts become playlist settings the app accepts', () => {
    const pairing = load();
    assert.deepEqual(JSON.parse(JSON.stringify(pairing.toSource({ type: 'm3u', name: 'LumaNest TV', m3uUrl: 'https://tv.lumanest.tv/m3u?u=a&p=b' }))),
        { type: 'm3u', name: 'LumaNest TV', m3uUrl: 'https://tv.lumanest.tv/m3u?u=a&p=b', epgUrl: '' });
    assert.deepEqual(JSON.parse(JSON.stringify(pairing.toSource({ type: 'xtream', server: 'https://x.lumanest.tv', username: 'u', password: 'p' }))),
        { type: 'xtream', name: 'LumaNest TV', server: 'https://x.lumanest.tv', username: 'u', password: 'p' });
    assert.equal(pairing.toSource({ type: 'm3u', m3uUrl: 'javascript:alert(1)' }), null);
    assert.equal(pairing.toSource({ type: 'xtream', server: 'https://x.lumanest.tv', username: '', password: 'p' }), null);
    assert.equal(pairing.toSource({ type: 'other' }), null);
    assert.equal(pairing.toSource(null), null);
});

test('Samsung and LG ship the same pairing script', () => {
    assert.equal(fs.readFileSync(path.join(__dirname, '../../webos/js/pairing.js'), 'utf8'), pairingText);
});
