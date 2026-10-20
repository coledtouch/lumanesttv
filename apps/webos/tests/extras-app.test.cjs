"use strict";
// docs/extras.md on LG: the shipped data.js, player.js, webos-platform.js, pairing.js and app.js, in index.html's order,
// against a small DOM, the TV's HTML video element (a stub), a fake lumanest.tv and a stub PalmServiceBridge. Only the
// provider catalogue is a fixture. Trailer plays in Tuner in lumanest.tv's player page (an iframe overlay; a recording
// frame window stands in for the page); when that fails, the YouTube app through the application manager, or the QR dialog;
// with Subtitles On, a movie with no English stream track shows its first OpenSubtitles track, drawn as plain text at
// the video's currentTime, with the stream's own text tracks disabled.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scripts = ["data.js", "player.js", "webos-platform.js", "pairing.js", "app.js"]
    .map(name => [name, fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8")]);
const API = "https://lumanest.tv/api/extras/";
const KEY = "vKQi3bBA1y8";
const QR = Array.from({length: 21}, (_, r) => Array.from({length: 21}, (_, c) => String((r * c) % 2)).join(""));
const TRACK = {id: "11-aaaaaaaaaaaaaaaaaaaaaa", lang: "en", label: "English (OpenSubtitles)", hi: false,
    vtt: API + "subtitles/file/11-aaaaaaaaaaaaaaaaaaaaaa.vtt", srt: API + "subtitles/file/11-aaaaaaaaaaaaaaaaaaaaaa.srt"};

function harness(options = {}) {
    let now = 1000, timerId = 0;
    const timers = new Map(), documentEvents = {}, windowEvents = {};
    const document = {hidden: false};
    class Element {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
            this.className = ""; this.id = ""; this.style = {}; this.attributes = {};
            this.value = ""; this.disabled = false; this.scrollLeft = 0; this.scrollTop = 0; this._text = ""; this.listeners = {};
        }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        insertBefore(child, before) {
            const at = this.children.indexOf(before);
            if (at < 0) return this.appendChild(child);
            child.parentNode = this; this.children.splice(at, 0, child); return child;
        }
        removeChild(child) { this.children = this.children.filter(node => node !== child); child.parentNode = null; return child; }
        get nextSibling() { if (!this.parentNode) return null; const list = this.parentNode.children; return list[list.indexOf(this) + 1] || null; }
        set textContent(value) {
            if (this.contains(document.activeElement)) document.activeElement = document.body;
            this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = String(value);
        }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
        set innerHTML(value) { throw new Error("innerHTML used: " + value); }
        get firstChild() { return this.children[0] || null; }
        contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
        removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(entry => entry !== fn); }
        dispatch(type) { (this.listeners[type] || []).slice().forEach(fn => fn({type})); }
        focus() { document.activeElement = this; if (this.onfocus) this.onfocus({target: this}); }
        blur() { if (document.activeElement === this) document.activeElement = document.body; }
        click() { if (!this.disabled && this.onclick) this.onclick({target: this, preventDefault() {}}); }
        load() {}
        play() { return {then() {}}; }
        pause() {}
        getContext() { const element = this; return {fillStyle: "", fillRect(...box) { (element.fills ||= []).push([this.fillStyle, ...box]); }, clearRect() {}}; }
        get offsetWidth() {
            for (let node = this; node; node = node.parentNode) {
                if (node.className.split(/\s+/).includes("hidden") || node.style.display === "none") return 0;
            }
            return 200;
        }
        get offsetHeight() { return this.offsetWidth ? 60 : 0; }
        get offsetLeft() { return 0; }
        get offsetTop() { return 0; }
        get clientWidth() { return 1920; }
        get clientHeight() { return 1080; }
        getBoundingClientRect() { return {left: 0, top: 0, width: 200, height: 60}; }
        querySelectorAll(selector) {
            const parts = selector.split(",").map(value => value.trim()); const results = [];
            function matches(node, value) {
                if (value.startsWith("#")) return node.id === value.slice(1);
                if (value.startsWith(".")) return node.className.split(/\s+/).includes(value.slice(1));
                return node.tagName.toLowerCase() === value.toLowerCase();
            }
            (function visit(node) { for (const child of node.children) { if (parts.some(part => matches(child, part))) results.push(child); visit(child); } })(this);
            return results;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    }
    document.body = new Element("body"); document.activeElement = document.body;
    document.documentElement = document.body;
    document.createElement = tag => new Element(tag);
    document.getElementById = id => document.body.querySelector("#" + id);
    document.addEventListener = (type, fn) => { (documentEvents[type] ||= []).push(fn); };
    for (const [id, tag] of [["background", "div"], ["html-player", "video"], ["app", "div"]]) {
        const node = new Element(tag); node.id = id; document.body.appendChild(node);
    }
    for (const id of ["topbar", "main", "player-overlay", "dialog-layer", "toast"]) {
        const node = new Element(id === "main" ? "main" : "div"); node.id = id;
        if (id !== "topbar" && id !== "main") node.className = "hidden";
        document.getElementById("app").appendChild(node);
    }
    const video = document.getElementById("html-player");
    Object.assign(video, {currentTime: 0, duration: NaN, textTracks: options.textTracks || [], audioTracks: []});

    const values = new Map([["tuner.tv.settings.v1", JSON.stringify({
        source: {type: "xtream", server: "https://fixture.invalid", username: "u", password: "p"}, zip: "", startOn: "live", subtitles: !!options.subtitles})]]);
    const localStorage = {getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
    const requests = [];
    class FakeXhr {
        constructor() { requests.push(this); this.readyState = 0; }
        open(method, url) { this.method = method; this.url = url; }
        send() {}
        abort() {}
    }
    const bridges = [];
    function PalmServiceBridge() { this.calls = []; bridges.push(this); }
    PalmServiceBridge.prototype.call = function (uri, payload) { this.calls.push([uri, JSON.parse(payload)]); };
    const fakeTimers = {
        setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, at: now + (delay || 0)}); return id; },
        clearTimeout(id) { timers.delete(id); },
        setInterval(fn, delay) { const id = ++timerId; timers.set(id, {fn, at: now + delay, every: delay}); return id; },
        clearInterval(id) { timers.delete(id); }
    };
    const window = Object.assign({
        innerWidth: 1920, innerHeight: 1080, localStorage, Promise, XMLHttpRequest: FakeXhr, PalmServiceBridge,
        navigator: {userAgent: "Mozilla/5.0 (Web0S; Linux/SmartTV)"}, PalmSystem: {close() {}}, close() {},
        addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }, removeEventListener() {},
        performance: {now: () => now}, getComputedStyle: () => ({})
    }, fakeTimers);
    const context = Object.assign({window, document, console, Promise, Date, Math, JSON}, fakeTimers);
    const movie = {id: "m:1", name: "The Matrix", categoryId: "films", categoryIds: ["films"], url: "https://fixture.invalid/m1.mp4", backups: [], year: "1999", rating: "8", added: 1, tmdb: "603", genre: ""};
    for (const [name, source] of scripts) {
        vm.runInNewContext(source, context, {filename: name});
        // The provider is the only fixture: the catalogue arrives as the real client delivers it.
        if (name === "data.js") window.TunerData.createClient = (source, clientOptions) => ({
            catalogIdentity: window.TunerData.catalogIdentity(source, {zip: clientOptions.zip, usOnly: clientOptions.usOnly}),
            cancel() {}, guide() { return {then() {}}; }, movieInfo() { return {then() {}}; }, seriesInfo() { return {then() {}}; },
            load() {
                clientOptions.onCatalog("live", [], []); clientOptions.onStatus("live", {state: "ready"});
                clientOptions.onCatalog("movies", [movie], [{id: "films", name: "Films"}]); clientOptions.onStatus("movies", {state: "ready"});
                clientOptions.onCatalog("series", [], []); clientOptions.onStatus("series", {state: "ready"});
            }
        });
    }
    function advance(ms) {
        const end = now + ms;
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            now = next[1].at;
            if (next[1].every) next[1].at += next[1].every; else timers.delete(next[0]);
            next[1].fn();
        }
        now = end;
    }
    function answer(prefix, status, body) {
        const request = requests.find(r => !r.done && r.url.startsWith(prefix));
        assert.ok(request, "a request to " + prefix);
        request.done = true; request.status = status; request.readyState = 4;
        request.responseText = typeof body === "string" ? body : JSON.stringify(body);
        request.onreadystatechange();
    }
    const node = id => document.getElementById(id);
    return {
        document, video, bridges, answer, advance, node,
        get dialogOpen() { return !node("dialog-layer").className.split(/\s+/).includes("hidden"); },
        get focused() { return document.activeElement.id; },
        get pending() { return requests.filter(r => !r.done && r.url.startsWith(API)).map(r => r.url); },
        // Returns whether the keydown's default was prevented.
        key(code) {
            const event = {keyCode: code, which: code, target: document.activeElement, repeat: false, prevented: false, preventDefault() { this.prevented = true; }};
            (documentEvents.keydown || []).forEach(fn => fn(event));
            const prevented = event.prevented;
            (documentEvents.keyup || []).forEach(fn => fn(event));
            return prevented;
        },
        // The trailer player's frame, a frame window that records what the app posts, and a frame message.
        get frame() { return node("trailer-frame"); },
        frameWindow() { const win = {posted: [], postMessage(data, origin) { win.posted.push([data, origin]); }}; node("trailer-frame").contentWindow = win; return win; },
        message(value, from = {}) {
            const event = {data: JSON.stringify({tuner: "trailer", v: 1, ...value}), origin: from.origin || "https://lumanest.tv", source: from.source || node("trailer-frame").contentWindow};
            (windowEvents.message || []).forEach(fn => fn(event));
        },
        openMovie() {
            node("tab-3").click();
            const input = node("search-input"); input.value = "matrix"; input.oninput(); advance(200);
            node("result-0").click();
        },
        layer() { const layer = node("subtitle-layer"); return layer.className.includes("hidden") ? null : layer.textContent; }
    };
}

test("LG Trailer plays in Tuner: lumanest.tv's player page full screen; LG Back (461) closes it and focus returns to Trailer", () => {
    const h = harness();
    h.openMovie();
    assert.deepEqual(h.pending, [API + "trailer?v=1&type=movie&tmdb=603"]);
    h.answer(API + "trailer", 200, {v: 1, status: "ok", tmdb: 603, trailer: {key: KEY, name: "Official Trailer", short: "youtu.be/" + KEY, qr: QR}});
    assert.equal(h.focused, "detail-play", "the button appears without taking focus");
    h.node("detail-trailer").focus(); h.key(13);
    const frame = h.frame;
    assert.equal(frame.src, "https://lumanest.tv/embed/trailer?v=1&k=" + KEY);
    assert.equal(frame.getAttribute("allow"), "autoplay; encrypted-media");
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts allow-same-origin allow-presentation", "no popups, no top navigation");
    const layer = h.node("trailer-layer");
    assert.equal(frame.parentNode.parentNode, layer);
    assert.equal(layer.parentNode, h.document.body);
    assert.equal(h.document.activeElement, layer, "focus stays in the app document");
    assert.match(layer.textContent, /^Loading Official Trailer\u2026OK pause\/play \u00b7 Left\/Right 10 s \u00b7 Back close$/);
    assert.equal(h.bridges.length, 0, "not the YouTube app");
    const win = h.frameWindow();
    h.message({type: "ready"});
    // OK before the trailer has played is "play" (a toggle would pause one still loading), then a toggle.
    h.key(13); h.message({type: "state", state: "playing"});
    h.key(13); h.key(37); h.key(39); h.key(412); h.key(417); h.key(415); h.key(19);
    assert.deepEqual(win.posted.map(([data, origin]) => origin + " " + data), [
        '{"tuner":"trailer","v":1,"type":"play"}',
        '{"tuner":"trailer","v":1,"type":"toggle"}', '{"tuner":"trailer","v":1,"type":"seek","by":-10}', '{"tuner":"trailer","v":1,"type":"seek","by":10}',
        '{"tuner":"trailer","v":1,"type":"seek","by":-10}', '{"tuner":"trailer","v":1,"type":"seek","by":10}',
        '{"tuner":"trailer","v":1,"type":"play"}', '{"tuner":"trailer","v":1,"type":"pause"}'].map(data => "https://lumanest.tv " + data));
    h.message({type: "key", key: "back"}, {origin: "https://example.invalid"});
    assert.equal(h.node("trailer-layer") !== null, true, "another origin is ignored");
    // A PC keyboard's Tab (the LG emulator): no focus move behind the overlay, nothing sent.
    assert.equal(h.key(9), true);
    assert.equal(h.document.activeElement, layer); assert.equal(win.posted.length, 8);
    h.key(461);
    assert.equal(h.node("trailer-layer"), null);
    assert.equal(frame.parentNode, null); assert.equal(frame.src, "about:blank");
    assert.equal(h.focused, "detail-trailer");
    // Back forwarded by the frame (a key that reached it) and "ended" close it too.
    h.key(13); h.frameWindow(); h.message({type: "key", key: "back"});
    assert.equal(h.node("trailer-layer"), null); assert.equal(h.focused, "detail-trailer");
    h.key(13); h.frameWindow(); h.message({type: "ready"}); h.message({type: "state", state: "ended"});
    assert.equal(h.node("trailer-layer"), null); assert.equal(h.bridges.length, 0);
});

test("LG Trailer when in-app playback fails: the YouTube app through the application manager; when it is missing, the QR dialog", () => {
    const h = harness();
    h.openMovie();
    h.answer(API + "trailer", 200, {v: 1, status: "ok", tmdb: 603, trailer: {key: KEY, name: "Official Trailer", short: "youtu.be/" + KEY, qr: QR}});
    h.node("detail-trailer").focus(); h.key(13);
    h.frameWindow(); h.message({type: "error", code: 152});
    assert.equal(h.node("trailer-layer"), null, "never a black screen");
    assert.equal(h.bridges.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.bridges[0].calls)), [["luna://com.webos.applicationManager/launch",
        {id: "youtube.leanback.v4", params: {contentTarget: "https://www.youtube.com/tv?v=" + KEY}}]]);
    h.bridges[0].onservicecallback(JSON.stringify({returnValue: true}));
    assert.equal(h.dialogOpen, false);
    // No "ready" within 12 seconds: the YouTube app, missing here (-101): the QR dialog.
    h.key(13); h.advance(11999);
    assert.ok(h.node("trailer-layer")); assert.equal(h.bridges.length, 1);
    h.advance(1);
    assert.equal(h.node("trailer-layer"), null);
    h.bridges[1].onservicecallback(JSON.stringify({returnValue: false, errorCode: -101, errorText: "not installed"}));
    assert.equal(h.dialogOpen, true);
    assert.match(h.node("dialog-layer").textContent, /^Watch the trailer on your phoneyoutu\.be\/vKQi3bBA1y8Scan the code with your phone's camera\./);
    const canvas = h.node("dialog-layer").querySelector("canvas");
    assert.equal(canvas.fills.filter(fill => fill[0] === "#141224").length, QR.join("").split("1").length - 1, "every dark module drawn by pairing.js");
    h.key(461);
    assert.equal(h.dialogOpen, false); assert.equal(h.focused, "detail-trailer");
    // A player error, then no reply from the application manager within 5 seconds: the QR dialog too.
    h.key(13); h.frameWindow(); h.message({type: "error", code: 150}); h.advance(5000);
    assert.equal(h.dialogOpen, true);
});

test("LG subtitles: with Subtitles On the first OpenSubtitles track is shown at the video's time, the stream's tracks disabled", () => {
    const h = harness({subtitles: true, textTracks: [{kind: "subtitles", language: "fra", label: "Francais", mode: "showing"}]});
    h.openMovie();
    h.answer(API + "trailer", 200, {v: 1, status: "none", trailer: null});
    h.node("detail-play").click();
    assert.equal(h.video.src, "https://fixture.invalid/m1.mp4");
    assert.deepEqual(h.pending, [API + "subtitles?v=1&type=movie&tmdb=603"]);
    h.video.duration = 7200; h.video.dispatch("loadedmetadata");
    assert.equal(h.video.textTracks[0].mode, "showing", "the French track waits for the lookup");
    assert.deepEqual(h.pending, [API + "subtitles?v=1&type=movie&tmdb=603"], "still looking; no file yet");
    h.answer(API + "subtitles", 200, {v: 1, status: "ok", tmdb: 603, tracks: [TRACK], credit: "Subtitles provided by OpenSubtitles.com"});
    assert.equal(h.video.textTracks[0].mode, "disabled", "every text track of the stream is disabled");
    assert.deepEqual(h.pending, [TRACK.vtt], "the file is fetched now that it is shown");
    h.answer(TRACK.vtt, 200, "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>Hello</i> &amp; <b>welcome</b>\n");
    assert.equal(h.layer(), null);
    h.video.currentTime = 1.25; h.advance(200);
    assert.equal(h.layer(), "Hello & welcome");
    h.video.currentTime = 2.5; h.advance(200);
    assert.equal(h.layer(), null);
    // The chooser lists the stream's track, then the OpenSubtitles one (chosen) and the credit.
    h.key(405);
    assert.match(h.node("dialog-layer").textContent, /OffFrancais\u2713 English \(OpenSubtitles\)Subtitles provided by OpenSubtitles\.comClose$/);
});

test("LG Settings > About shows the privacy policy and the YouTube Terms of Service addresses (YouTube API Services III.A)", () => {
    const h = harness();
    h.node("tab-4").click(); h.node("about-tuner").click();
    const text = h.node("dialog-layer").textContent;
    assert.match(text, /^Tuner for LG webOS TV/);
    assert.match(text, /Privacy policy: tunertv\.app\/privacy/);
    assert.match(text, /Trailers play in YouTube's embedded player \(YouTube API Services\)\. By using Tuner, you agree to the YouTube Terms of Service: www\.youtube\.com\/t\/terms/);
});
