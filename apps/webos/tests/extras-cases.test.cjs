"use strict";
// docs/extras-cases.json (docs/extras.md, Test cases) against the shipped js/data.js, the file tools/sync-from-tizen.js
// generates and minifies from the Samsung sources: every live_category case (the provider's hidden "Most watched now"
// category) and every vtt_cues case (the WebVTT reader LG draws OpenSubtitles cues with).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourceText = fs.readFileSync(path.join(__dirname, "../js/data.js"), "utf8");
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/extras-cases.json"), "utf8"));
const plain = value => JSON.parse(JSON.stringify(value));

function load() {
    const window = {Promise, XMLHttpRequest: function () {}, localStorage: {getItem: () => null, setItem() {}}, setTimeout, clearTimeout};
    vm.runInNewContext(sourceText, {window, console});
    return window.TunerData;
}

test("docs/extras-cases.json: every live_category and vtt_cues case passes in the shipped LG data.js", () => {
    const D = load(), ran = {live_category: 0, vtt_cues: 0};
    for (const c of cases) {
        if (c.kind === "live_category") {
            assert.equal(D.isHiddenLiveCategory(c.name), c.hidden, JSON.stringify(c.name));
            ran.live_category++;
        } else if (c.kind === "vtt_cues") {
            const cues = D.parseVtt(c.vtt);
            assert.deepEqual(plain(cues), c.cues, c.note);
            for (const [ms, text] of c.at) assert.equal(D.vttTextAt(cues, ms), text, c.note + " at " + ms);
            ran.vtt_cues++;
        }
    }
    assert.ok(ran.live_category >= 30 && ran.vtt_cues >= 6, JSON.stringify(ran));
});

test("the shipped LG catalogue reader drops the hidden live category before the lineup is built", () => {
    const D = load();
    const shown = D.hideLiveCategories([
        {id: "a", categoryId: "1", categoryIds: ["1"]}, {id: "b", categoryId: "1", categoryIds: ["1", "2"]}, {id: "c", categoryId: "2", categoryIds: ["2"]}
    ], [{id: "1", name: "EN: Most Watched Now"}, {id: "2", name: "Sports"}]);
    assert.deepEqual(plain(shown), {items: [{id: "b", categoryId: "2", categoryIds: ["2"]}, {id: "c", categoryId: "2", categoryIds: ["2"]}], categories: [{id: "2", name: "Sports"}]});
});

test("the shipped LG trailer player rules: the frame URL, the frame's messages, LG's keys and the commands", () => {
    const X = load().extras;
    assert.equal(X.trailerFrameUrl("vKQi3bBA1y8"), "https://lumanest.tv/embed/trailer?v=1&k=vKQi3bBA1y8");
    assert.equal(X.trailerFrameUrl("vKQi3bBA1y8&x"), "");
    assert.deepEqual(plain(X.parseFrameMessage('{"tuner":"trailer","v":1,"type":"key","key":"back"}')), {type: "key", key: "back"});
    assert.equal(X.parseFrameMessage('{"tuner":"trailer","v":1,"type":"key","key":"constructor"}'), null);
    // LG Back (461), the LG media keys (Rewind 412 and FastForward 417 step as Left and Right) and the arrows.
    assert.deepEqual([461, 13, 415, 19, 413, 37, 39, 412, 417, 38, 40, 33].map(X.trailerKeyAction), ["close", "toggle", "play", "pause", "stop", "rewind", "forward", "rewind", "forward", "", "", ""]);
    assert.equal(X.trailerMessageAction(X.parseFrameMessage('{"tuner":"trailer","v":1,"type":"error","code":150}')), "fallback");
    assert.equal(X.trailerMessageAction(X.parseFrameMessage('{"tuner":"trailer","v":1,"type":"state","state":"ended"}')), "close");
    assert.equal(X.trailerCommand("rewind"), '{"tuner":"trailer","v":1,"type":"seek","by":-10}');
});
