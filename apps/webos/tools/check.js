"use strict";
const app = require("./app");
try {
    const manifest = app.validateSource();
    if (require("../package.json").version !== manifest.version) throw new Error("Tooling and application versions must match");
    console.log("webOS sources validated: " + manifest.id + " " + manifest.version + ", ES5 scripts and local-script CSP.");
} catch (error) {console.error(error.message); process.exitCode = 1;}
