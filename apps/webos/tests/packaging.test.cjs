"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const app = require("../tools/app");

function fixture(run) {
    const tempRoot = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(tempRoot, "tuner-webos-"));
    const source = path.join(directory, "source");
    try {
        app.FILES.forEach(name => {
            const target = path.join(source, name);
            fs.mkdirSync(path.dirname(target), {recursive: true});
            fs.copyFileSync(path.join(app.ROOT, name), target);
        });
        run({source, output: path.join(directory, "output")});
    } finally {
        const resolved = fs.realpathSync(directory);
        if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith("tuner-webos-")) throw new Error("Unexpected fixture cleanup path");
        fs.rmSync(resolved, {recursive: true, force: true});
    }
}

test("staging copies only exact runtime assets and preserves their bytes", () => fixture(({source, output}) => {
    fs.writeFileSync(path.join(source, "private-account.json"), "private fixture");
    fs.writeFileSync(path.join(source, "device-key.pem"), "private fixture");
    const build = app.stageSource(output, source);
    assert.equal(build.applicationId, "tv.lumanest.tuner");
    assert.deepEqual(build.files, app.FILES);
    assert.equal(fs.existsSync(path.join(build.staging, "private-account.json")), false);
    assert.equal(fs.existsSync(path.join(build.staging, "device-key.pem")), false);
    for (const name of app.FILES) assert.deepEqual(fs.readFileSync(path.join(build.staging, name)), fs.readFileSync(path.join(source, name)));
    assert.equal(app.validateSource(build.staging).version, require("../package.json").version);
}));

test("wrong identity, missing assets, and privileged capabilities fail validation", () => fixture(({source}) => {
    const filename = path.join(source, "appinfo.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    fs.writeFileSync(filename, JSON.stringify({...manifest, id: "unexpected.app"}));
    assert.throws(() => app.validateSource(source), /manifest/);
    fs.writeFileSync(filename, JSON.stringify({...manifest, requiredACG: ["private-capability"]}));
    assert.throws(() => app.validateSource(source), /capabilities/);
    fs.writeFileSync(filename, JSON.stringify(manifest));
    fs.unlinkSync(path.join(source, "assets/icon.png"));
    assert.throws(() => app.validateSource(source), /missing/);
}));

test("new JavaScript syntax and dynamic code execution fail the ES5 check", () => fixture(({source}) => {
    const script = path.join(source, "js/app.js");
    fs.writeFileSync(script, "const value = 1;");
    assert.throws(() => app.validateSource(source), /keyword|reserved|Unexpected/);
    fs.writeFileSync(script, "eval('1');");
    assert.throws(() => app.validateSource(source), /Dynamic code/);
}));

test("remote scripts, altered script order, inline handlers, and relaxed CSP are rejected", () => fixture(({source}) => {
    const filename = path.join(source, "index.html");
    const html = fs.readFileSync(filename, "utf8");
    for (const changed of [
        html.replace("js/app.js", "https://example.invalid/app.js"),
        html.replace("js/webos-platform.js", "js/app.js"),
        html + '<button onclick="run()">Open</button>',
        html.replace("script-src 'self'", "script-src 'self' https:")
    ]) {
        fs.writeFileSync(filename, changed);
        assert.throws(() => app.validateSource(source));
    }
}));

test("build output cannot be the application source or a directory within it", () => fixture(({source}) => {
    assert.throws(() => app.stageSource(source, source), /outside/);
    assert.throws(() => app.stageSource(path.join(source, "output"), source), /outside/);
}));
