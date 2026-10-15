"use strict";
const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");

const ROOT = path.resolve(__dirname, "..");
const FILES = Object.freeze([
    "appinfo.json", "index.html", "assets/icon.png", "css/app.css",
    "js/data.js", "js/player.js", "js/webos-platform.js", "js/app.js"
]);
const SCRIPTS = Object.freeze(["js/data.js", "js/player.js", "js/webos-platform.js", "js/app.js"]);

function validateSource(root = ROOT) {
    FILES.forEach(name => {
        const file = path.join(root, name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("Required app file is missing: " + name);
        const parts = name.split("/");
        for (let count = 1; count <= parts.length; count++) {
            if (fs.lstatSync(path.join(root, ...parts.slice(0, count))).isSymbolicLink()) throw new Error("App files must not use symbolic links: " + name);
        }
    });
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "appinfo.json"), "utf8"));
    if (manifest.id !== "tv.lumanest.tuner" || manifest.vendor !== "LumaNest TV" || manifest.type !== "web" ||
        manifest.main !== "index.html" || manifest.icon !== "assets/icon.png" || !/^\d+\.\d+\.\d+$/.test(manifest.version || "")) throw new Error("Unexpected webOS application manifest");
    if (!Array.isArray(manifest.requiredACG) || manifest.requiredACG.length) throw new Error("Unexpected webOS privileged capabilities");
    SCRIPTS.forEach(name => {
        const ast = acorn.parse(fs.readFileSync(path.join(root, name), "utf8"), {ecmaVersion: 5});
        function walk(node) {
            if (!node || typeof node !== "object") return;
            if ((node.type === "CallExpression" || node.type === "NewExpression") && node.callee.type === "Identifier" && ["eval", "Function"].includes(node.callee.name)) throw new Error("Dynamic code execution is forbidden: " + name);
            Object.values(node).forEach(value => {if (Array.isArray(value)) value.forEach(walk); else if (value && typeof value === "object") walk(value);});
        }
        walk(ast);
    });
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    const scripts = tags.map(match => {
        if (match[2].trim()) throw new Error("Only packaged script files may execute");
        return match[1].match(/\bsrc=["']([^"']+)["']/)?.[1];
    });
    if (JSON.stringify(scripts) !== JSON.stringify(SCRIPTS)) throw new Error("Unexpected script files or loading order");
    if (/\son[a-z]+\s*=/i.test(html) || /javascript:/i.test(html)) throw new Error("Inline script handlers are forbidden");
    const policy = html.match(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"[^>]*>/i)?.[1];
    if (!policy || policy.split(";").find(part => part.trim().startsWith("script-src "))?.trim() !== "script-src 'self'" || /unsafe-eval/.test(policy)) throw new Error("Packaged local-script CSP is required");
    const icon = fs.readFileSync(path.join(root, "assets/icon.png"));
    if (icon.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("The app icon must be PNG");
    return manifest;
}

function stageSource(output, root = ROOT) {
    const manifest = validateSource(root);
    const destination = path.resolve(output);
    const relative = path.relative(path.resolve(root), destination);
    if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Build output must stay outside the app source folder");
    fs.mkdirSync(destination, {recursive: true});
    const staging = fs.mkdtempSync(path.join(destination, "app-"));
    FILES.forEach(name => {
        const target = path.join(staging, name);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(path.join(root, name), target);
    });
    validateSource(staging);
    const build = {version: manifest.version, applicationId: manifest.id, staging, files: FILES};
    fs.writeFileSync(path.join(destination, "build.json"), JSON.stringify(build, null, 2) + "\n");
    return build;
}

module.exports = {ROOT, FILES, SCRIPTS, validateSource, stageSource};
