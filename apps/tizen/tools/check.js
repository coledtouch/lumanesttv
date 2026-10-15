"use strict";
const fs = require("node:fs");
const widget = require("./widget");
try {
    const requireSigned = process.argv[2] === "--signed";
    const archive = process.argv[requireSigned ? 3 : 2];
    if (requireSigned && !archive) throw new Error("Provide the signed widget path");
    if (archive) {
        const entries = widget.readZip(fs.readFileSync(archive));
        const signed = widget.SIGNATURES.every(name => entries.some(entry => entry.name === name));
        if (requireSigned && !signed) throw new Error("Both Samsung widget signature files are required; this widget is UNSIGNED");
        console.log("Widget archive validated (" + entries.length + " files; " + (signed ? "signature files present, certificate validity requires Samsung CLI/device" : "UNSIGNED; not installable on a physical Samsung TV") + ").");
    } else console.log("Widget sources validated: " + widget.validateSource() + ", ES5 scripts, local-script CSP.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
