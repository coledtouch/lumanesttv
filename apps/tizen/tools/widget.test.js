"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const widget = require("./widget");
const manifest = fs.readFileSync(path.join(widget.ROOT, "config.xml"));
const entries = () => widget.FILES.map(name => ({ name, data: name === "config.xml" ? manifest : Buffer.from("fixture " + name) }));

test("unsigned widget archive round-trips exactly the runtime allowlist and validates every CRC", () => {
    const original = entries(), zip = widget.createZip(original), unpacked = widget.readZip(zip);
    assert.deepEqual(unpacked, original);
    assert.equal(unpacked.some(entry => widget.SIGNATURES.includes(entry.name)), false);
    const damaged = Buffer.from(zip);
    damaged.writeUInt32LE(damaged.readUInt32LE(damaged.length - 22 + 16) + 1, damaged.length - 22 + 16);
    assert.throws(() => widget.readZip(damaged), /directory bounds/);
});

test("private exports, certificates and tool scripts can never enter the widget", () => {
    ["prefs.json", "live.json", "author.p12", "tools/build.js", "../signing/profiles.xml"].forEach(name => {
        assert.throws(() => widget.createZip([...entries(), { name, data: Buffer.from("private") }]), /Unexpected/);
    });
    assert.throws(() => widget.createZip(entries().slice(1)), /incomplete/);
    assert.throws(() => widget.createZip([...entries(), entries()[0]]), /duplicate/);
});

test("wrong widget namespaces, privileges and remote-script CSP are rejected", () => {
    const xml = manifest.toString("utf8");
    assert.equal(widget.validateManifest(xml), require("../package.json").version);
    assert.throws(() => widget.validateManifest(xml.replace('xmlns:tizen="http://tizen.org/ns/widgets"', 'xmlns:tizen="https://example.test"')), /namespace/);
    assert.throws(() => widget.validateManifest(xml.replace('tv.inputdevice', 'filesystem.read')), /privileges/);
    assert.throws(() => widget.validateManifest(xml.replace("script-src 'self' file:", "script-src 'self' https:")), /packaged scripts/);
    assert.throws(() => widget.validateManifest(xml.replace("script-src 'self' file:", "script-src 'self' file: 'unsafe-eval'")), /packaged scripts/);
});

test("source validation rejects newer JavaScript, eval and inline remote script handlers", () => {
    const tempRoot = fs.realpathSync(os.tmpdir()), fixture = fs.mkdtempSync(path.join(tempRoot, "tuner-widget-"));
    const html = '<html><script src="$WEBAPIS/webapis/webapis.js"></script><script src="js/data.js"></script><script src="js/player.js"></script><script src="js/app.js"></script></html>';
    try {
        widget.FILES.forEach(name => {
            const target = path.join(fixture, name);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, name === "config.xml" ? manifest : name === "index.html" ? html : name.endsWith(".js") ? "var value = 1;" : "fixture");
        });
        assert.equal(widget.validateSource(fixture), require("../package.json").version);
        fs.writeFileSync(path.join(fixture, "js/app.js"), "const value = 1;");
        assert.throws(() => widget.validateSource(fixture), /keyword|reserved|Unexpected/);
        fs.writeFileSync(path.join(fixture, "js/app.js"), "eval('alert(1)');");
        assert.throws(() => widget.validateSource(fixture), /Dynamic code/);
        fs.writeFileSync(path.join(fixture, "js/app.js"), "var value = 1;");
        fs.writeFileSync(path.join(fixture, "index.html"), html.replace('src="js/app.js"', 'src="https://example.test/app.js"'));
        assert.throws(() => widget.validateSource(fixture), /allowlist/);
        fs.writeFileSync(path.join(fixture, "index.html"), html + '<button onclick="run()">Open</button>');
        assert.throws(() => widget.validateSource(fixture), /inline event/);
    } finally {
        const resolved = fs.realpathSync(fixture);
        if (!resolved.startsWith(tempRoot + path.sep) || !path.basename(resolved).startsWith("tuner-widget-")) throw new Error("Unexpected fixture cleanup path");
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});

test("the trailer's YouTube launch (docs/extras.md) needs the application.launch privilege, and only that one more", () => {
    const xml = manifest.toString("utf8"), line = /\s*<tizen:privilege name="http:\/\/tizen\.org\/privilege\/application\.launch" \/>/;
    assert.match(xml, line);
    assert.throws(() => widget.validateManifest(xml.replace(line, "")), /privileges/);
    assert.throws(() => widget.validateManifest(xml.replace("application.launch", "application.launch\" />\n    <tizen:privilege name=\"http://tizen.org/privilege/appmanager.kill")), /privileges/);
});
