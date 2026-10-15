"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const acorn = require("acorn");

const ROOT = path.resolve(__dirname, "..");
const FILES = Object.freeze(["config.xml", "index.html", "css/app.css", "js/data.js", "js/player.js", "js/app.js", "assets/icon.png"]);
const SIGNATURES = Object.freeze(["author-signature.xml", "signature1.xml"]);
const APPLICATION_ID = "TunerTv001.Tuner";
const PACKAGE_ID = "TunerTv001";

function validateManifest(xml) {
    const requireMatch = (pattern, message) => { if (!pattern.test(xml)) throw new Error(message); };
    requireMatch(/<widget\b[^>]*\bxmlns="http:\/\/www\.w3\.org\/ns\/widgets"/, "Widget XML namespace is missing");
    requireMatch(/<widget\b[^>]*\bxmlns:tizen="http:\/\/tizen\.org\/ns\/widgets"/, "Tizen XML namespace is missing");
    const app = xml.match(/<tizen:application\b[^>]*>/);
    if (!app || !app[0].includes('id="' + APPLICATION_ID + '"') || !app[0].includes('package="' + PACKAGE_ID + '"')) throw new Error("Unexpected application/package ID");
    requireMatch(/<tizen:profile\s+name="tv-samsung"\s*\/>/, "Samsung TV profile is missing");
    requireMatch(/<content\s+src="index\.html"\s*\/>/, "Widget entry point must be index.html");
    requireMatch(/<icon\s+src="assets\/icon\.png"\s*\/>/, "Widget icon must be assets/icon.png");
    const privileges = [...xml.matchAll(/<tizen:privilege\s+name="([^"]+)"\s*\/>/g)].map(match => match[1]).sort();
    const expected = ["http://tizen.org/privilege/internet", "http://tizen.org/privilege/tv.inputdevice"].sort();
    if (JSON.stringify(privileges) !== JSON.stringify(expected)) throw new Error("Unexpected widget privileges");
    const policy = xml.match(/<tizen:content-security-policy>([^<]+)<\/tizen:content-security-policy>/);
    if (!policy) throw new Error("Widget CSP is missing");
    const scriptPolicy = policy[1].split(";").find(part => part.trim().startsWith("script-src "));
    if (!scriptPolicy || scriptPolicy.trim() !== "script-src 'self' file:") throw new Error("Only packaged scripts and the local Samsung SDK may execute");
    if (/unsafe-eval/.test(policy[1])) throw new Error("CSP must not permit eval");
    const version = xml.match(/<widget\b[^>]*\bversion="([0-9]+\.[0-9]+\.[0-9]+)"/);
    if (!version) throw new Error("Widget version is missing");
    return version[1];
}

function validateSource(root = ROOT) {
    FILES.forEach(name => {
        const file = path.join(root, name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("Required widget file is missing: " + name);
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Widget assets must not be symlinks: " + name);
    });
    const version = validateManifest(fs.readFileSync(path.join(root, "config.xml"), "utf8"));
    ["js/data.js", "js/player.js", "js/app.js"].forEach(name => {
        const ast = acorn.parse(fs.readFileSync(path.join(root, name), "utf8"), { ecmaVersion: 5 });
        function walk(node) {
            if (!node || typeof node !== "object") return;
            if (node.type === "CallExpression" && node.callee.type === "Identifier" && ["eval", "Function"].includes(node.callee.name)) throw new Error("Dynamic code execution is forbidden: " + name);
            if (node.type === "NewExpression" && node.callee.type === "Identifier" && node.callee.name === "Function") throw new Error("Dynamic code execution is forbidden: " + name);
            Object.values(node).forEach(value => { if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value); });
        }
        walk(ast);
    });
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    if (scripts.some(match => match[2].trim() || !/\bsrc=["'](?:js\/(?:data|player|app)\.js|\$WEBAPIS\/webapis\/webapis\.js)["']/.test(match[1]))) throw new Error("HTML scripts must use the packaged allowlist or Samsung SDK");
    if (/\son[a-z]+\s*=/i.test(html) || /javascript:/i.test(html)) throw new Error("HTML inline event handlers are forbidden");
    return version;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});
function crc32(data) {
    let value = 0xffffffff;
    for (const byte of data) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
}

function createZip(entries) {
    const locals = [], central = [];
    let offset = 0;
    const seen = new Set();
    for (const entry of entries) {
        if (!FILES.includes(entry.name) || seen.has(entry.name)) throw new Error("Unexpected or duplicate widget member: " + entry.name);
        seen.add(entry.name);
        const filename = Buffer.from(entry.name, "utf8"), data = Buffer.from(entry.data), packed = zlib.deflateRawSync(data), crc = crc32(data);
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
        header.writeUInt16LE(0x21, 12); // Stable 1980-01-01 timestamp.
        header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
        locals.push(header, filename, packed);
        const directory = Buffer.alloc(46);
        directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
        directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(0x21, 14);
        directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(data.length, 24);
        directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
        central.push(directory, filename); offset += header.length + filename.length + packed.length;
    }
    if (seen.size !== FILES.length) throw new Error("Widget archive is incomplete");
    const centralData = Buffer.concat(central), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralData, end]);
}

function readZip(data) {
    const endOffset = data.length - 22;
    if (endOffset < 0 || data.readUInt32LE(endOffset) !== 0x06054b50) throw new Error("Archive has no valid ZIP footer");
    const count = data.readUInt16LE(endOffset + 10), centralSize = data.readUInt32LE(endOffset + 12), start = data.readUInt32LE(endOffset + 16);
    if (start + centralSize !== endOffset) throw new Error("Invalid ZIP directory bounds");
    const entries = [], seen = new Set();
    let cursor = start;
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > endOffset || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP directory entry");
        const nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
        const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
        if (![...FILES, ...SIGNATURES].includes(name) || seen.has(name)) throw new Error("Unexpected or duplicate widget member: " + name);
        seen.add(name);
        const local = data.readUInt32LE(cursor + 42);
        if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid ZIP local header");
        const method = data.readUInt16LE(cursor + 10), size = data.readUInt32LE(cursor + 20);
        const bodyStart = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        if (bodyStart + size > start) throw new Error("Invalid ZIP member bounds");
        const packed = data.subarray(bodyStart, bodyStart + size), body = method === 8 ? zlib.inflateRawSync(packed) : method === 0 ? packed : null;
        if (!body || body.length !== data.readUInt32LE(cursor + 24) || crc32(body) !== data.readUInt32LE(cursor + 16)) throw new Error("Widget member failed CRC/size validation: " + name);
        entries.push({ name, data: body }); cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== endOffset || FILES.some(name => !seen.has(name))) throw new Error("Widget archive is incomplete");
    validateManifest(entries.find(entry => entry.name === "config.xml").data.toString("utf8"));
    return entries;
}

module.exports = { ROOT, FILES, SIGNATURES, APPLICATION_ID, PACKAGE_ID, validateManifest, validateSource, crc32, createZip, readZip };
