"use strict";
// Behaviour of the shipped js/webos-platform.js, loaded as the TV loads it: after
// js/player.js, in a plain window object. No browser or TV runtime is involved.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = name => fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8");
const platformSource = read("webos-platform.js");
const playerSource = read("player.js");

function stubWindow(extra = {}) {
    const calls = [];
    const dual = () => "dual";
    const window = Object.assign({
        TunerPlayer: {create(options) { calls.push(options); return {options}; }, createDual: dual},
        close() { window.closed = (window.closed || 0) + 1; }
    }, extra);
    vm.runInNewContext(platformSource, {window}, {filename: "webos-platform.js"});
    return {window, calls, dual};
}

test("TunerPlayer.create always selects the HTML video player and keeps other options", () => {
    const {window, calls} = stubWindow();
    const onState = () => {};
    const video = {id: "html-player"};
    const created = window.TunerPlayer.create({nativePlayer: {open() {}}, videoElement: video, onState, mute: true});
    assert.equal(calls.length, 1);
    assert.equal(created.options, calls[0]);
    assert.equal(calls[0].nativePlayer, null);
    assert.equal(calls[0].videoElement, video);
    assert.equal(calls[0].onState, onState);
    assert.equal(calls[0].mute, true);
});

test("TunerPlayer.create without options still disables the native player", () => {
    const {window, calls} = stubWindow();
    window.TunerPlayer.create();
    window.TunerPlayer.create(undefined);
    assert.equal(calls.length, 2);
    for (const options of calls) assert.equal(options.nativePlayer, null);
});

test("the Samsung dual-player entry point is removed", () => {
    const {window, dual} = stubWindow();
    assert.notEqual(window.TunerPlayer.createDual, dual);
    assert.equal(window.TunerPlayer.createDual, null);
});

test("exit closes through PalmSystem when webOS provides it", () => {
    let palmCloses = 0;
    const {window} = stubWindow({PalmSystem: {close() { palmCloses++; }}});
    assert.equal(window.TunerWebOS.exit(), true);
    assert.equal(palmCloses, 1);
    assert.equal(window.closed, undefined);
});

test("exit falls back to window.close and reports that PalmSystem was unavailable", () => {
    for (const PalmSystem of [undefined, {}, {close: "not a function"}]) {
        const {window} = stubWindow(PalmSystem === undefined ? {} : {PalmSystem});
        assert.equal(window.TunerWebOS.exit(), false);
        assert.equal(window.closed, 1);
    }
});

// The real player.js with a Samsung-style AVPlay object present: the webOS patch
// must route playback to the <video> element and never touch AVPlay.
function realPlayer() {
    const avplayCalls = [];
    const avplay = new Proxy({}, {get(target, name) { return (...args) => { avplayCalls.push(name); return name === "getState" ? "NONE" : undefined; }; }});
    const style = () => ({});
    const video = {
        style: style(), attributes: {}, listeners: [], loads: 0, paused: true,
        addEventListener(type, fn) { this.listeners.push([type, fn]); },
        removeEventListener(type, fn) { this.listeners = this.listeners.filter(entry => entry[0] !== type || entry[1] !== fn); },
        removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; },
        load() { this.loads++; },
        play() { this.paused = false; return Promise.resolve(); },
        pause() { this.paused = true; }
    };
    const object = {style: style()};
    const window = {
        webapis: {avplay}, Promise, performance: {now: () => 0},
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, close() {}
    };
    const context = {window, Date, Math, JSON, Promise, setTimeout: window.setTimeout, clearTimeout: window.clearTimeout};
    vm.runInNewContext(playerSource, context, {filename: "player.js"});
    vm.runInNewContext(platformSource, context, {filename: "webos-platform.js"});
    return {window, avplayCalls, video, object};
}

test("with the real player, AVPlay is ignored and the stream goes to the HTML video element", () => {
    const {window, avplayCalls, video, object} = realPlayer();
    const states = [];
    const player = window.TunerPlayer.create({objectElement: object, videoElement: video, onState: state => states.push(state.status)});
    player.play({id: "live:1", url: "http://example.invalid/live/1.m3u8", live: true});
    assert.deepEqual(avplayCalls, []);
    assert.equal(video.src, "http://example.invalid/live/1.m3u8");
    assert.ok(video.loads >= 1);
    assert.equal(video.style.display, "block");
    assert.equal(object.style.display, "none");
    assert.ok(states.includes("loading"));
    player.stop();
    assert.deepEqual(avplayCalls, []);
    assert.equal(video.src, "");
    assert.equal(window.TunerPlayer.createDual, null);
});

test("live HLS captions on the HTML video element follow the Subtitles setting and the chooser", () => {
    const {window, video, object} = realPlayer();
    video.textTracks = [{kind: "metadata", mode: "hidden"}, {kind: "captions", language: "en", label: "CC1", mode: "disabled"}];
    let subtitlesOn = true;
    const player = window.TunerPlayer.create({objectElement: object, videoElement: video, subtitles: () => subtitlesOn});
    player.play({id: "live:1", url: "http://example.invalid/live/1.m3u8", live: true});
    video.listeners.filter(entry => entry[0] === "loadedmetadata").forEach(entry => entry[1]());
    assert.equal(video.textTracks[1].mode, "showing", "On selects the English caption track");
    assert.equal(video.textTracks[0].mode, "hidden", "data tracks are left alone");
    assert.deepEqual(JSON.parse(JSON.stringify(player.tracks().subtitles.map(track => track.label))), ["CC1"]);
    player.selectTrack("TEXT", -1);
    assert.equal(video.textTracks[1].mode, "disabled");
    subtitlesOn = false;
    player.play({id: "live:2", url: "http://example.invalid/live/2.m3u8", live: true});
    video.textTracks[1].mode = "showing";
    video.listeners.filter(entry => entry[0] === "loadedmetadata").forEach(entry => entry[1]());
    assert.equal(video.textTracks[1].mode, "disabled", "Off keeps captions hidden on each new stream");
    video.textTracks = [];
    player.play({id: "live:3", url: "http://example.invalid/live/3.m3u8", live: true});
    video.listeners.filter(entry => entry[0] === "loadedmetadata").forEach(entry => entry[1]());
    assert.equal(player.tracks().subtitles.length, 0);
});

// docs/extras.md, Trailer, LG: the YouTube app through webOS's application manager, with a stub PalmServiceBridge.
function bridgeWindow(behaviour = {}) {
    const bridges = [], timers = new Map();
    let timerId = 0;
    function PalmServiceBridge() {
        if (behaviour.construct) throw new Error("bridge unavailable");
        this.calls = [];
        bridges.push(this);
    }
    PalmServiceBridge.prototype.call = function (uri, payload) {
        this.calls.push([uri, payload]);
        if (behaviour.call) throw new Error("call refused");
        if (behaviour.reply !== undefined) this.onservicecallback(behaviour.reply);
    };
    const extra = {
        setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, ms}); return id; },
        clearTimeout(id) { timers.delete(id); }
    };
    if (!behaviour.noBridge) extra.PalmServiceBridge = PalmServiceBridge;
    const {window} = stubWindow(extra);
    return {window, bridges, timers, fire() { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); }};
}

test("openYouTube launches youtube.leanback.v4 on the video through the application manager", () => {
    const h = bridgeWindow();
    let failed = 0;
    assert.equal(h.window.TunerWebOS.openYouTube("vKQi3bBA1y8", () => failed++), true);
    assert.equal(h.bridges.length, 1);
    assert.deepEqual(h.bridges[0].calls.map(([uri, payload]) => [uri, JSON.parse(payload)]), [["luna://com.webos.applicationManager/launch",
        {id: "youtube.leanback.v4", params: {contentTarget: "https://www.youtube.com/tv?v=vKQi3bBA1y8"}}]]);
    assert.deepEqual([...h.timers.values()].map(timer => timer.ms), [5000]);
    h.bridges[0].onservicecallback(JSON.stringify({returnValue: true, processId: "1001"}));
    assert.equal(failed, 0);
    assert.equal(h.timers.size, 0, "the 5-second wait is cleared");
    h.bridges[0].onservicecallback(JSON.stringify({returnValue: false}));
    assert.equal(failed, 0, "a second reply changes nothing");
});

test("openYouTube calls onFail once: YouTube missing (-101), no reply in 5 s, an unreadable reply, no bridge, a bad key", () => {
    // [stub behaviour, key, bridges made, the label]
    const cases = [
        [{reply: JSON.stringify({returnValue: false, errorCode: -101, errorText: "app not installed"})}, "vKQi3bBA1y8", 1, "not installed"],
        [{reply: "not json"}, "vKQi3bBA1y8", 1, "unreadable reply"],
        [{reply: JSON.stringify({returnValue: "true"})}, "vKQi3bBA1y8", 1, "returnValue not true"],
        [{wait: true}, "vKQi3bBA1y8", 1, "no reply within 5 seconds"],
        [{noBridge: true}, "vKQi3bBA1y8", 0, "no PalmServiceBridge"],
        [{construct: true}, "vKQi3bBA1y8", 0, "the bridge cannot be made"],
        [{call: true}, "vKQi3bBA1y8", 1, "the call throws"],
        [{}, "vKQi3bBA1y", 0, "a key of 10 characters"],
        [{}, "../../x?y=1", 0, "not a YouTube key"]
    ];
    for (const [behaviour, key, bridgesMade, label] of cases) {
        const h = bridgeWindow(behaviour);
        let failed = 0;
        h.window.TunerWebOS.openYouTube(key, () => failed++);
        if (behaviour.wait) {
            assert.equal(failed, 0, "waiting for the reply");
            h.fire();
        }
        assert.equal(failed, 1, label);
        assert.equal(h.bridges.length, bridgesMade, label);
        if (h.bridges[0] && h.bridges[0].onservicecallback) h.bridges[0].onservicecallback(JSON.stringify({returnValue: false}));
        h.fire();
        assert.equal(failed, 1, label + ": never twice");
    }
});
