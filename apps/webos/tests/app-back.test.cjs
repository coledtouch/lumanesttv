"use strict";
// Runs the shipped data.js, player.js, webos-platform.js and app.js, in index.html's
// order, against a minimal DOM. It checks LG remote Back (keyCode 461) handling and the
// exit path. No provider account is configured, so no network requests are made.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scripts = ["data.js", "player.js", "webos-platform.js", "app.js"]
    .map(name => [name, fs.readFileSync(path.join(__dirname, "..", "js", name), "utf8")]);

function harness(options = {}) {
    const documentEvents = {}, windowEvents = {};
    const document = {hidden: false};
    class Element {
        constructor(tag) {
            this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
            this.className = ""; this.id = ""; this.style = {}; this.attributes = {};
            this.value = ""; this.disabled = false; this.scrollLeft = 0; this.scrollTop = 0; this._text = "";
            this.listeners = {};
        }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        insertBefore(child) { return this.appendChild(child); }
        removeChild(child) { this.children = this.children.filter(node => node !== child); child.parentNode = null; return child; }
        set textContent(value) {
            if (this.contains(document.activeElement)) document.activeElement = document.body;
            this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = String(value);
        }
        get textContent() { return this._text + this.children.map(child => child.textContent).join(""); }
        set innerHTML(value) { this.textContent = value; }
        get firstChild() { return this.children[0] || null; }
        contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
        removeAttribute(name) { delete this.attributes[name]; }
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
        removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(entry => entry !== fn); }
        focus() { document.activeElement = this; if (this.onfocus) this.onfocus({target: this}); }
        blur() { if (document.activeElement === this) document.activeElement = document.body; }
        click() { if (!this.disabled && this.onclick) this.onclick({target: this, preventDefault() {}}); }
        scrollIntoView() {}
        load() {}
        pause() {}
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
        getBoundingClientRect() { return {left: 0, top: 0, width: 200, height: 60, right: 200, bottom: 60}; }
        get classList() {
            const element = this;
            const list = () => element.className.split(/\s+/).filter(Boolean);
            return {
                contains: name => list().includes(name),
                add: (...names) => { element.className = [...new Set([...list(), ...names])].join(" "); },
                remove: (...names) => { element.className = list().filter(name => !names.includes(name)).join(" "); },
                toggle: (name, force) => {
                    const on = force === undefined ? !list().includes(name) : !!force;
                    element.className = (on ? [...new Set([...list(), name])] : list().filter(entry => entry !== name)).join(" ");
                    return on;
                }
            };
        }
        querySelectorAll(selector) {
            const parts = selector.split(",").map(value => value.trim()); const results = [];
            function matches(node, value) {
                if (value.startsWith("#")) return node.id === value.slice(1);
                if (value.startsWith(".")) return node.className.split(/\s+/).includes(value.slice(1));
                return node.tagName.toLowerCase() === value.toLowerCase();
            }
            (function visit(node) {
                for (const child of node.children) {
                    if (parts.some(part => matches(child, part))) results.push(child);
                    visit(child);
                }
            })(this);
            return results;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    }
    document.body = new Element("body"); document.activeElement = document.body;
    document.documentElement = document.body;
    document.createElement = tag => new Element(tag);
    document.createTextNode = value => { const node = new Element("#text"); node.textContent = value; return node; };
    document.getElementById = id => document.body.querySelector("#" + id);
    document.querySelector = selector => document.body.querySelector(selector);
    document.querySelectorAll = selector => document.body.querySelectorAll(selector);
    document.addEventListener = (type, fn) => { (documentEvents[type] ||= []).push(fn); };
    for (const [id, tag] of [["background", "div"], ["html-player", "video"], ["app", "div"]]) {
        const node = new Element(tag); node.id = id; document.body.appendChild(node);
    }
    for (const id of ["topbar", "main", "player-overlay", "dialog-layer", "toast"]) {
        const node = new Element(id === "main" ? "main" : "div"); node.id = id;
        if (id !== "topbar" && id !== "main") node.className = "hidden";
        document.getElementById("app").appendChild(node);
    }

    const values = new Map(Object.entries(options.storage || {}));
    const localStorage = {getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key)};
    let palmCloses = 0, windowCloses = 0, xhrs = 0;
    const window = {
        innerWidth: 1920, innerHeight: 1080, localStorage, Promise,
        XMLHttpRequest: function () { xhrs++; throw new Error("No network in this test"); },
        navigator: {userAgent: "Mozilla/5.0 (Web0S; Linux/SmartTV)"},
        PalmSystem: options.palm === false ? undefined : {close() { palmCloses++; }},
        close() { windowCloses++; },
        addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); },
        removeEventListener() {},
        performance: {now: () => 0},
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
        getComputedStyle: () => ({})
    };
    const context = {
        window, document, console, Promise, Date, Math, JSON,
        setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}
    };
    for (const [name, source] of scripts) vm.runInNewContext(source, context, {filename: name});

    function key(code) {
        const event = {keyCode: code, which: code, target: document.activeElement, repeat: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
        (documentEvents.keydown || []).forEach(fn => fn(event));
        (documentEvents.keyup || []).forEach(fn => fn({...event, preventDefault() {}}));
        return event;
    }
    const node = id => document.getElementById(id);
    return {
        document, window, key, node,
        get focused() { return document.activeElement; },
        get dialogOpen() { return !node("dialog-layer").className.split(/\s+/).includes("hidden"); },
        get palmCloses() { return palmCloses; }, get windowCloses() { return windowCloses; }, get xhrs() { return xhrs; }
    };
}

function findByText(root, text) {
    if (root.textContent === text && root.tagName === "BUTTON") return root;
    for (const child of root.children) { const found = findByText(child, text); if (found) return found; }
    return null;
}

test("first launch opens Settings and the platform has replaced dual playback", () => {
    const h = harness();
    assert.equal(h.window.TunerPlayer.createDual, null);
    assert.equal(typeof h.window.TunerWebOS.exit, "function");
    assert.match(h.node("tab-4").className, /\bactive\b/);
    assert.match(h.node("main").textContent, /Welcome to Tuner/);
    assert.equal(h.focused.id, "source-type", "The account form receives focus");
    assert.equal(h.xhrs, 0);
});

test("LG Back (461) walks Settings -> navigation -> Live TV -> exit prompt", () => {
    const h = harness();
    const event = h.key(461);
    assert.equal(event.defaultPrevented, true, "Back must not reach the webOS system handler");
    assert.equal(h.focused.id, "tab-4", "Back from the Settings form moves focus to its tab");
    h.key(461);
    assert.equal(h.focused.id, "tab-0", "Back from another tab returns to Live TV");
    assert.equal(h.dialogOpen, false);
    h.key(461);
    assert.equal(h.dialogOpen, true, "Back on Live TV asks before closing");
    assert.match(h.node("dialog-layer").textContent, /Close Tuner\?/);
    assert.equal(h.palmCloses, 0);
});

test("Back closes the exit prompt without leaving the app", () => {
    const h = harness();
    h.key(461); h.key(461); h.key(461);
    assert.equal(h.dialogOpen, true);
    h.key(461);
    assert.equal(h.dialogOpen, false);
    assert.equal(h.palmCloses, 0);
    assert.equal(h.windowCloses, 0);
});

test("choosing Exit closes the app through PalmSystem", () => {
    const h = harness();
    h.key(461); h.key(461); h.key(461);
    const exit = findByText(h.node("dialog-layer"), "Exit");
    assert.ok(exit, "The exit prompt has an Exit button");
    exit.click();
    assert.equal(h.palmCloses, 1);
    assert.equal(h.windowCloses, 0);
});

test("Exit falls back to window.close where PalmSystem is unavailable", () => {
    const h = harness({palm: false});
    h.key(461); h.key(461); h.key(461);
    findByText(h.node("dialog-layer"), "Exit").click();
    assert.equal(h.windowCloses, 1);
});

test("the Tizen Return key code (10009) and Escape behave like LG Back", () => {
    for (const code of [10009, 27]) {
        const h = harness();
        assert.equal(h.key(code).defaultPrevented, true);
        assert.equal(h.focused.id, "tab-4");
    }
});
