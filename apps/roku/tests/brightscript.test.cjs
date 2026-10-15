"use strict";
// Runs the channel's parsing and login helpers in brs-node's BrightScript interpreter.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(path.dirname(require.resolve("brs-node/package.json")), "bin", "brs.cli.js");
const SUITES = {
    "util_test.brs": [],
    "catalog_test.brs": ["components/tasks/CatalogTask.brs"],
    "pair_test.brs": ["components/tasks/PairTask.brs"],
};

for (const [suite, extra] of Object.entries(SUITES)) {
    test("BrightScript " + suite, () => {
        const files = ["tests/brs/" + suite, "tests/brs/assert.brs", "components/common/Util.brs", ...extra];
        const run = spawnSync(process.execPath, [CLI, ...files], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
        const output = (run.stdout || "") + (run.stderr || "");
        assert.doesNotMatch(output, /^FAIL /m, output);
        assert.doesNotMatch(output, /Syntax Error|Runtime Error|EXIT_BRIGHTSCRIPT_CRASH/, output);
        const passed = output.match(/^PASSED (\d+)$/m);
        assert.ok(passed && Number(passed[1]) > 0, "suite did not finish:\n" + output);
    });
}
