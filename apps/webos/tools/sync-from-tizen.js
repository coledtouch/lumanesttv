"use strict";
// The LG app shares its runtime with the Samsung app. Its js/data.js, js/player.js and js/app.js are
// generated from ../tizen/js by this tool: app.js loses Multi View and the Samsung TV APIs, and gains the
// LG Back key (461), PalmSystem exit and LG texts. Unused Samsung-only code is removed by the minifier.
// css/app.css and js/pairing.js are copied unchanged. Edit the Samsung sources, then run:
//   npm run sync        (writes the files)
//   npm run sync -- --check   (fails when the shipped files are out of date)
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TIZEN = path.resolve(ROOT, "..", "tizen");
const MINIFY = Object.freeze({ecma: 5, compress: true, mangle: true, output: {comments: false}});

function replaceOnce(source, from, to, label) {
    const index = source.indexOf(from);
    if (index < 0 || source.indexOf(from, index + 1) >= 0) throw new Error("Samsung source changed; update the LG port step: " + label);
    return source.slice(0, index) + to + source.slice(index + from.length);
}
function replaceRange(source, start, end, to, label) {
    const first = source.indexOf(start), last = source.indexOf(end, first + 1);
    if (first < 0 || last < 0) throw new Error("Samsung source changed; update the LG port step: " + label);
    return source.slice(0, first) + to + source.slice(last);
}

function portApp(source, version) {
    source = replaceOnce(source, "var tabOrder = [HOME, LIVE, DISCOVER, LIBRARY, SEARCH, SETTINGS, MULTI];", "var tabOrder = [HOME, LIVE, DISCOVER, LIBRARY, SEARCH, SETTINGS];", "tabs");
    source = replaceRange(source, "  function renderMultiView() {", "  function pickDualChannel(", [
        "  function renderMultiView() {",
        '    main.textContent = "";',
        '    main.appendChild(el("h1", "page-title", "Single-screen playback"));',
        '    main.appendChild(el("p", "multiview-subtitle", "This LG build plays one stream at a time. Choose Live TV, Discover or Library to watch."));',
        "  }",
        ""
    ].join("\n"), "Multi View");
    source = replaceOnce(source, "window.tizen.application.getCurrentApplication().exit();", "window.TunerWebOS.exit();", "exit");
    // Trailer: LG opens the YouTube app through webOS's application manager (js/webos-platform.js), not Samsung's
    // application control; its onFail shows the same QR dialog (docs/extras.md, Trailer, LG).
    source = replaceRange(source, "  // Samsung: the YouTube app opened on the video", "  // The QR dialog: the trailer on a phone", [
        "  function openYouTube(key, onFail) {",
        "    window.TunerWebOS.openYouTube(key, onFail);",
        "  }",
        ""
    ].join("\n"), "YouTube launch");
    source = replaceOnce(source, "if (code === 10009 || code === 27 || code === 8) {", "if (code === 461 || code === 10009 || code === 27 || code === 8) {", "Back key");
    source = replaceOnce(source, "if (code === 10009 || code === 27) {", "if (code === 461 || code === 10009 || code === 27) {", "Back key in text fields");
    source = replaceOnce(source, 'el("h2", "", "Samsung remote")', 'el("h2", "", "LG Magic Remote")', "remote heading");
    source = replaceOnce(source, 'device: "samsung"', 'device: "lg"', "pairing device");
    const about = /"Tuner for Samsung TV",\n(\s*)"Version [^"\n]*",/;
    if (!about.test(source)) throw new Error("Samsung source changed; update the LG port step: About");
    source = source.replace(about, (match, indent) => '"Tuner for LG webOS TV",\n' + indent + JSON.stringify("Version " + version +
        " · LG webOS TV\nLive TV, guide, movies, series and Favorites. Single-stream playback. Formats and audio tracks depend on your TV.") + ",");
    source = replaceRange(source, "  try {\n    var supported = window.tizen.tvinputdevice", "  setInterval(", "", "Samsung key registration");
    if (/\btizen\b|webapis\.avplaystore/.test(source.replace(/\/\/.*$/gm, ""))) throw new Error("A Samsung TV API remains in the LG app");
    return source;
}

async function generate() {
    let terser;
    try { terser = require("terser"); } catch (error) { throw new Error("Install the development tools first: npm install --no-package-lock --ignore-scripts"); }
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, "appinfo.json"), "utf8")).version;
    const read = name => fs.readFileSync(path.join(TIZEN, name), "utf8");
    const scripts = {"js/data.js": read("js/data.js"), "js/player.js": read("js/player.js"), "js/app.js": portApp(read("js/app.js"), version)};
    const files = {};
    for (const [name, source] of Object.entries(scripts)) {
        const result = await terser.minify(source, MINIFY);
        files[name] = result.code;
    }
    files["js/pairing.js"] = read("js/pairing.js");
    files["css/app.css"] = read("css/app.css");
    return files;
}

async function main() {
    const check = process.argv.includes("--check");
    const files = await generate();
    const stale = Object.keys(files).filter(name => {
        const target = path.join(ROOT, name);
        return !fs.existsSync(target) || fs.readFileSync(target, "utf8") !== files[name];
    });
    if (check) {
        if (stale.length) throw new Error("LG files are out of date with the Samsung sources: " + stale.join(", ") + ". Run npm run sync.");
        console.log("LG runtime files match the Samsung sources.");
        return;
    }
    stale.forEach(name => fs.writeFileSync(path.join(ROOT, name), files[name]));
    console.log(stale.length ? "Updated " + stale.join(", ") : "LG runtime files already match the Samsung sources.");
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = {portApp, generate};
