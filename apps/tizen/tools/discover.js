"use strict";
// Read-only Samsung discovery. Never pairs, wakes a TV, sends remote keys or starts an app.
const dgram = require("node:dgram");
const http = require("node:http");
const net = require("node:net");
const privateIp = address => net.isIPv4(address) && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(address) && !/\.(?:0|255)$/.test(address);
function developerPort(address) {
    return new Promise(resolve => {
        const socket = net.connect({ host: address, port: 26101 });
        let done = false;
        const finish = open => { if (done) return; done = true; socket.destroy(); resolve(open); };
        socket.setTimeout(900); socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.once("timeout", () => finish(false));
    });
}
function metadata(address) {
    return new Promise(resolve => {
        const request = http.get({ hostname: address, port: 8001, path: "/api/v2/", timeout: 1500 }, response => {
            let data = "";
            response.setEncoding("utf8");
            response.on("data", chunk => { data += chunk; if (data.length > 262144) { response.destroy(); resolve(null); } });
            response.on("error", () => resolve(null));
            response.on("end", () => {
                try {
                    const device = JSON.parse(data).device;
                    if (!device || !device.modelName || !/tizen/i.test(device.OS || "")) { resolve(null); return; }
                    let name = device.name || "";
                    if (name.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(name)) {
                        const decoded = Buffer.from(name, "base64").toString("utf8");
                        if (!/[\u0000-\u001f\ufffd]/.test(decoded)) name = decoded;
                    }
                    // Only user-facing identity metadata. Never export IDs, MACs, tokens or complete responses.
                    resolve({ address, name, model: device.modelName, platform: device.OS, resolution: device.resolution });
                } catch (_) { resolve(null); }
            });
        });
        request.on("error", () => resolve(null)); request.on("timeout", () => { request.destroy(); resolve(null); });
    });
}
function ssdp() {
    return new Promise(resolve => {
        const socket = dgram.createSocket("udp4"), devices = new Set();
        let done = false;
        const timer = setTimeout(finish, 2600);
        function finish() { if (done) return; done = true; clearTimeout(timer); try { socket.close(); } catch (_) {} resolve([...devices]); }
        socket.on("error", finish);
        socket.on("message", (data, remote) => { if (/samsung/i.test(data.toString()) && privateIp(remote.address) && devices.size < 12) devices.add(remote.address); });
        socket.bind(0, () => {
            const query = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
            if (!done) socket.send(query, 1900, "239.255.255.250", error => { if (error) finish(); });
        });
    });
}
(async () => {
    const provided = process.argv.slice(2);
    if (provided.some(address => !privateIp(address)) || provided.length > 24) throw new Error("Pass up to 24 known local IPv4 addresses; subnet scanning is not supported");
    const addresses = [...new Set([...provided, ...await ssdp()])];
    const results = await Promise.all(addresses.map(async address => {
        const [info, sdbOpen] = await Promise.all([metadata(address), developerPort(address)]);
        return info ? { ...info, developerPortOpen: sdbOpen } : null;
    }));
    const televisions = results.filter(Boolean);
    console.log(JSON.stringify(televisions, null, 2));
    if (!televisions.length) console.log("No awake Samsung Tizen device responded. Supply a known TV address; this tool never wakes devices.");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
