"use strict";
const path = require("node:path");
const app = require("./app");
try {
    const output = process.argv[2] || path.resolve(app.ROOT, "..", "..", "output", "webos");
    const build = app.stageSource(output);
    console.log("Prepared clean webOS staging: " + build.staging + "\nUse the official ares-package command to create a development IPK.");
} catch (error) {console.error(error.message); process.exitCode = 1;}
