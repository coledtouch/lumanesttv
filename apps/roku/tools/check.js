"use strict";
// Validates the channel layout and manifest, then compiles every BrightScript and SceneGraph file with BrighterScript.
const path = require("node:path");
const { ProgramBuilder, DiagnosticSeverity } = require("brighterscript");
const channel = require("./channel");

(async () => {
    const { version, files } = channel.validateSource();
    const builder = new ProgramBuilder();
    await builder.run({ project: path.join(channel.ROOT, "bsconfig.json"), cwd: channel.ROOT, createPackage: false, copyToStaging: false, watch: false, logLevel: "error" });
    const diagnostics = builder.getDiagnostics();
    const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
    for (const d of diagnostics) {
        const file = path.relative(channel.ROOT, d.file.srcPath || d.file.pathAbsolute || "");
        console.log((d.severity === DiagnosticSeverity.Error ? "error " : "warning ") + file + ":" + (d.range.start.line + 1) + " " + d.message);
    }
    if (errors.length) throw new Error(errors.length + " BrightScript error(s)");
    console.log("Roku channel " + version + " checked: " + files.length + " files, " + diagnostics.length + " warning(s).");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
