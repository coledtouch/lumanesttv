"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const widget = require("./widget");
try {
    const version = widget.validateSource();
    const output = path.resolve(process.argv[2] || path.join(widget.ROOT, "..", "..", "output", "tizen"));
    fs.mkdirSync(output, { recursive: true });
    // Every build gets fresh staging; no stale signatures or private files are reused.
    const staging = fs.mkdtempSync(path.join(output, "widget-"));
    const entries = widget.FILES.map(name => {
        const data = fs.readFileSync(path.join(widget.ROOT, name));
        const target = path.join(staging, name);
        fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
        return { name, data };
    });
    const archive = widget.createZip(entries);
    widget.readZip(archive);
    const filename = path.join(output, "Tuner-" + version + "-tizen-UNSIGNED.wgt");
    fs.writeFileSync(filename, archive);
    fs.writeFileSync(path.join(output, "build.json"), JSON.stringify({ version, applicationId: widget.APPLICATION_ID, packageId: widget.PACKAGE_ID, staging, unsignedWidget: filename, sha256: crypto.createHash("sha256").update(archive).digest("hex"), files: widget.FILES }, null, 2) + "\n");
    console.log("Prepared " + filename + "\nUNSIGNED: use a Samsung certificate for this TV before installing.\nStaging: " + staging);
} catch (error) { console.error(error.message); process.exitCode = 1; }
