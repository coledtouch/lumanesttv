"use strict";

// Roku channel layout, manifest rules and a dependency-free ZIP writer/reader, mirroring apps/tizen/tools/widget.js.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const DIRECTORIES = Object.freeze({ source: [".brs"], components: [".brs", ".xml"], images: [".png", ".jpg"] });
const REQUIRED_IMAGES = Object.freeze({
    "images/channel-poster_fhd.png": [540, 405],
    "images/channel-poster_hd.png": [290, 218],
    "images/splash_fhd.png": [1920, 1080],
    "images/splash_hd.png": [1280, 720],
});
// Package members larger than this are a sign something private or generated slipped in.
const MAX_MEMBER_BYTES = 2 * 1024 * 1024;

/** The packaged files, sorted: manifest first, then every allowed file under the runtime directories. */
function listFiles(root = ROOT) {
    const files = ["manifest"];
    for (const [dir, extensions] of Object.entries(DIRECTORIES)) {
        const walk = relative => {
            for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const name = relative + "/" + entry.name;
                if (entry.isSymbolicLink()) throw new Error("Channel files must not be symlinks: " + name);
                if (entry.isDirectory()) walk(name);
                else if (extensions.includes(path.extname(entry.name).toLowerCase())) files.push(name);
                else throw new Error("Unexpected file in the channel source: " + name);
            }
        };
        walk(dir);
    }
    return files;
}

function parseManifest(text) {
    const values = {};
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith("#")) continue;
        const at = line.indexOf("=");
        if (at < 1) throw new Error("Malformed manifest line: " + line);
        values[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return values;
}

function validateManifest(text) {
    const values = parseManifest(text);
    for (const key of ["title", "major_version", "minor_version", "build_version", "mm_icon_focus_fhd", "mm_icon_focus_hd", "splash_screen_fhd", "splash_screen_hd", "ui_resolutions"]) {
        if (!values[key]) throw new Error("Manifest is missing " + key);
    }
    for (const key of ["major_version", "minor_version", "build_version"]) {
        if (!/^\d+$/.test(values[key])) throw new Error("Manifest " + key + " must be a number");
    }
    if (values.ui_resolutions !== "fhd") throw new Error("The channel is laid out for FHD only");
    if (values.supports_input_launch !== "1") throw new Error("Roku certification requires supports_input_launch=1");
    for (const key of ["mm_icon_focus_fhd", "mm_icon_focus_hd", "splash_screen_fhd", "splash_screen_hd"]) {
        if (!values[key].startsWith("pkg:/images/")) throw new Error("Manifest " + key + " must point inside pkg:/images/");
    }
    return { values, version: values.major_version + "." + values.minor_version + "." + values.build_version };
}

function pngSize(data) {
    if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) throw new Error("Not a PNG");
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

/** Checks the source tree; returns the manifest version and the list of packaged files. */
function validateSource(root = ROOT) {
    const files = listFiles(root);
    const manifest = validateManifest(fs.readFileSync(path.join(root, "manifest"), "utf8"));
    for (const key of ["mm_icon_focus_fhd", "mm_icon_focus_hd", "splash_screen_fhd", "splash_screen_hd"]) {
        const file = manifest.values[key].slice("pkg:/".length);
        if (!files.includes(file)) throw new Error("Manifest image is missing: " + file);
    }
    for (const [file, size] of Object.entries(REQUIRED_IMAGES)) {
        const actual = pngSize(fs.readFileSync(path.join(root, file)));
        if (actual[0] !== size[0] || actual[1] !== size[1]) throw new Error(file + " must be " + size.join("x") + ", found " + actual.join("x"));
    }
    if (!files.includes("source/main.brs")) throw new Error("source/main.brs is missing");
    for (const file of files) {
        const data = fs.readFileSync(path.join(root, file));
        if (data.length > MAX_MEMBER_BYTES) throw new Error("Unexpectedly large channel file: " + file);
        if (/\.(brs|xml)$/.test(file)) {
            const text = data.toString("utf8");
            // Accounts are added on the TV; no login, playlist link or provider host may be packaged.
            if (/(username|password)=[A-Za-z0-9_%-]{3,}/i.test(text)) throw new Error("Packaged code must not contain account credentials: " + file);
            if (/\b(eval|Run)\s*\(/.test(text)) throw new Error("Dynamic code execution is forbidden: " + file);
        }
    }
    return { version: manifest.version, files };
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

/** Writes a deterministic ZIP with the manifest at the archive root, as Roku's installer expects. */
function createZip(entries) {
    const locals = [], central = [], seen = new Set();
    let offset = 0;
    for (const entry of entries) {
        if (seen.has(entry.name) || entry.name.startsWith("/") || entry.name.includes("..")) throw new Error("Unexpected or duplicate channel member: " + entry.name);
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
        central.push(directory, filename);
        offset += header.length + filename.length + packed.length;
    }
    if (!seen.has("manifest")) throw new Error("Channel archive needs a root manifest");
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
    const entries = [];
    let cursor = start;
    for (let index = 0; index < count; index++) {
        if (cursor + 46 > endOffset || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP directory entry");
        const nameLength = data.readUInt16LE(cursor + 28), extra = data.readUInt16LE(cursor + 30), comment = data.readUInt16LE(cursor + 32);
        const name = data.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
        const local = data.readUInt32LE(cursor + 42);
        if (local + 30 > start || data.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid ZIP local header");
        const method = data.readUInt16LE(cursor + 10), size = data.readUInt32LE(cursor + 20);
        const bodyStart = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
        if (bodyStart + size > start) throw new Error("Invalid ZIP member bounds");
        const packed = data.subarray(bodyStart, bodyStart + size), body = method === 8 ? zlib.inflateRawSync(packed) : method === 0 ? packed : null;
        if (!body || body.length !== data.readUInt32LE(cursor + 24) || crc32(body) !== data.readUInt32LE(cursor + 16)) throw new Error("Channel member failed CRC/size validation: " + name);
        entries.push({ name, data: body });
        cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== endOffset) throw new Error("Trailing data in the ZIP directory");
    const manifest = entries.find(entry => entry.name === "manifest");
    if (!manifest) throw new Error("Channel archive needs a root manifest");
    validateManifest(manifest.data.toString("utf8"));
    return entries;
}

module.exports = { ROOT, REQUIRED_IMAGES, listFiles, parseManifest, validateManifest, validateSource, crc32, createZip, readZip };
