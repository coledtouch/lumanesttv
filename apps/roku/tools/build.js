"use strict";
// Packages the channel as the ZIP that Roku's developer installer and the Developer Dashboard accept.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const channel = require("./channel");
try {
    const { version, files } = channel.validateSource();
    const output = path.resolve(process.argv[2] || path.join(channel.ROOT, "..", "..", "output", "roku"));
    fs.mkdirSync(output, { recursive: true });
    const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(channel.ROOT, name)) }));
    const archive = channel.createZip(entries);
    channel.readZip(archive);
    const filename = path.join(output, "LumaNestTV-" + version + "-roku.zip");
    fs.writeFileSync(filename, archive);
    fs.writeFileSync(path.join(output, "build.json"), JSON.stringify({ version, zip: filename, sha256: crypto.createHash("sha256").update(archive).digest("hex"), files }, null, 2) + "\n");
    console.log("Prepared " + filename + "\nSideload it from the Roku's Development Application Installer, or package it there for the Developer Dashboard.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
