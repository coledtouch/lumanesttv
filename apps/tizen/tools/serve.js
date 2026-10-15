"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const widget = require("./widget");
const port = Number(process.argv[2] || 8181);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };
http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname).replace(/^\//, "") || "index.html"; }
    catch (_) { response.writeHead(400); response.end(); return; }
    if (pathname === "$WEBAPIS/webapis/webapis.js") { response.writeHead(200, { "Content-Type": types[".js"] }); response.end("/* Samsung WebAPI is provided by the TV, not this browser preview. */"); return; }
    if (!widget.FILES.includes(pathname) || pathname === "config.xml") { response.writeHead(404); response.end(); return; }
    const file = path.join(widget.ROOT, pathname);
    if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": types[path.extname(pathname)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log("Browser preview: http://127.0.0.1:" + port + " (native AVPlay requires the TV)."));
