"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const channel = require("../tools/channel");

function copySource() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roku-channel-"));
    for (const name of ["manifest", "source", "components", "images"]) fs.cpSync(path.join(channel.ROOT, name), path.join(dir, name), { recursive: true });
    return dir;
}

test("the channel source validates and lists only runtime files", () => {
    const { version, files } = channel.validateSource();
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(files[0], "manifest");
    assert.ok(files.includes("source/main.brs"));
    assert.ok(files.includes("components/MainScene.xml"));
    assert.ok(files.every(name => /^(manifest|(source|components|images)\/.+\.(brs|xml|png|jpg))$/.test(name)), files.join(", "));
    const pkg = JSON.parse(fs.readFileSync(path.join(channel.ROOT, "package.json"), "utf8"));
    assert.equal(pkg.version, version, "package.json and manifest versions must match");
});

test("the archive round-trips with the manifest at its root", () => {
    const { files } = channel.validateSource();
    const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(channel.ROOT, name)) }));
    const archive = channel.createZip(entries);
    const read = channel.readZip(archive);
    assert.deepEqual(read.map(entry => entry.name), files);
    read.forEach((entry, index) => assert.ok(entry.data.equals(entries[index].data)));
    assert.ok(channel.createZip(entries).equals(archive), "builds are deterministic");
});

test("stray files, credentials and bad manifests are rejected", () => {
    const dir = copySource();
    try {
        fs.writeFileSync(path.join(dir, "components", "notes.txt"), "x");
        assert.throws(() => channel.validateSource(dir), /Unexpected file/);
        fs.rmSync(path.join(dir, "components", "notes.txt"));
        fs.writeFileSync(path.join(dir, "components", "Leak.brs"), 'url = "http://h/get.php?username=real&password=secret"\n');
        assert.throws(() => channel.validateSource(dir), /credentials/);
        fs.rmSync(path.join(dir, "components", "Leak.brs"));
        channel.validateSource(dir);
        const manifest = fs.readFileSync(path.join(dir, "manifest"), "utf8");
        fs.writeFileSync(path.join(dir, "manifest"), manifest.replace("supports_input_launch=1\n", ""));
        assert.throws(() => channel.validateSource(dir), /supports_input_launch/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("Roku artwork has the required sizes", () => {
    for (const [file, size] of Object.entries(channel.REQUIRED_IMAGES)) {
        const data = fs.readFileSync(path.join(channel.ROOT, file));
        assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], size, file);
    }
});
