/*
 * Pair with your phone: the TV shows a QR code and a short code from lumanest.tv, the customer approves it
 * on their phone, and the TV receives its LumaNest playlist login. Shared by the Samsung and LG apps.
 * ES5 only; no third-party code. The server sends the QR modules, so no QR encoder lives on the TV.
 */
(function (root) {
  "use strict";
  var API = "https://lumanest.tv/api/pair/";
  var BACK = [10009, 461, 27, 8];
  var active = null;

  function el(tag, cls, txt) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (txt !== undefined) node.textContent = txt;
    return node;
  }

  function post(path, body, done) {
    var xhr = new XMLHttpRequest(), finished = false;
    function finish(error, data) {
      if (finished) return;
      finished = true;
      done(error, data);
    }
    xhr.open("POST", API + path, true);
    // text/plain keeps this a simple CORS request, so the TV sends no preflight.
    xhr.setRequestHeader("Content-Type", "text/plain;charset=UTF-8");
    xhr.timeout = 15000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && data) finish(null, data);
      else finish((data && data.error && data.error.message) || "Couldn't reach LumaNest TV. Check the TV's internet connection.", null);
    };
    xhr.ontimeout = function () { finish("Couldn't reach LumaNest TV. Check the TV's internet connection.", null); };
    xhr.send(JSON.stringify(body));
  }

  function drawQr(canvas, rows) {
    var size = rows.length, quiet = 3, total = size + quiet * 2, px = Math.floor(canvas.width / total), offset, ctx, r, c;
    ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    offset = Math.floor((canvas.width - px * size) / 2);
    ctx.fillStyle = "#141224";
    for (r = 0; r < size; r++)
      for (c = 0; c < size; c++) if (rows[r].charAt(c) === "1") ctx.fillRect(offset + c * px, offset + r * px, px, px);
  }

  /** Converts the server's account into the app's playlist settings, or returns null if it is unusable. */
  function toSource(account) {
    var source;
    if (!account) return null;
    if (account.type === "xtream") source = { type: "xtream", name: account.name || "LumaNest TV", server: account.server, username: account.username, password: account.password };
    else if (account.type === "m3u") source = { type: "m3u", name: account.name || "LumaNest TV", m3uUrl: account.m3uUrl, epgUrl: "" };
    else return null;
    try {
      if (root.TunerData && root.TunerData.normalizeSource) root.TunerData.normalizeSource(source);
    } catch (_) {
      return null;
    }
    return source;
  }

  /**
   * options.device: "samsung" or "lg"; options.onSource(source) receives the paired playlist settings;
   * options.onClose() runs when the customer backs out.
   */
  function open(options) {
    if (active) return;
    var host = document.getElementById("app") || document.body,
      layer = el("div", "pair-layer"),
      card = el("div", "pair-panel"),
      qrBox = el("div", "pair-qr"),
      canvas = el("canvas"),
      side = el("div", "pair-side"),
      code = el("div", "pair-code", "····-····"),
      status = el("p", "pair-status", "Getting a code…"),
      actions = el("div", "pair-actions"),
      fresh = el("button", "", "New code"),
      cancel = el("button", "", "Cancel"),
      timer = null,
      expiry = null,
      session = 0,
      previousFocus = document.activeElement;
    canvas.width = 480;
    canvas.height = 480;
    qrBox.appendChild(canvas);
    side.appendChild(el("p", "pair-eyebrow", "PAIR WITH YOUR PHONE"));
    side.appendChild(el("h2", "", "Scan to connect this TV"));
    side.appendChild(el("p", "pair-steps", "1. Point your phone's camera at the code.\n2. Sign in with your LumaNest TV line login.\n3. Tap Connect my TV. Your channels load here automatically."));
    side.appendChild(el("p", "pair-or", "No camera? Go to lumanest.tv/pair and enter:"));
    side.appendChild(code);
    side.appendChild(status);
    fresh.type = cancel.type = "button";
    actions.appendChild(fresh);
    actions.appendChild(cancel);
    side.appendChild(actions);
    card.appendChild(qrBox);
    card.appendChild(side);
    layer.appendChild(card);
    host.appendChild(layer);

    function stopTimers() {
      if (timer) clearTimeout(timer);
      if (expiry) clearTimeout(expiry);
      timer = expiry = null;
    }
    function close(paired) {
      if (!active) return;
      session++;
      stopTimers();
      root.removeEventListener("keydown", onKeyDown, true);
      root.removeEventListener("keyup", onKeyUp, true);
      if (layer.parentNode) layer.parentNode.removeChild(layer);
      active = null;
      if (!paired) {
        if (previousFocus && previousFocus.focus) try { previousFocus.focus(); } catch (_) {}
        if (options.onClose) options.onClose();
      }
    }
    function poll(id, deviceCode, interval) {
      timer = setTimeout(function () {
        post("poll", { deviceCode: deviceCode }, function (error, data) {
          if (id !== session) return;
          if (error) {
            status.textContent = error + " Retrying…";
            return poll(id, deviceCode, interval * 2 > 30 ? 30 : interval * 2);
          }
          if (data.status === "approved") {
            var source = toSource(data.account);
            if (!source) {
              status.textContent = "This TV couldn't use that login. Choose New code to try again.";
              return;
            }
            close(true);
            options.onSource(source);
          } else if (data.status === "expired") {
            start();
          } else {
            status.textContent = "Waiting for you to approve on your phone…";
            poll(id, deviceCode, interval);
          }
        });
      }, interval * 1000);
    }
    function start() {
      var id = ++session;
      stopTimers();
      code.textContent = "····-····";
      status.textContent = "Getting a code…";
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      post("start", { device: options.device }, function (error, data) {
        if (id !== session) return;
        if (error || !data.qr || !data.deviceCode) {
          status.textContent = (error || "Pairing isn't available right now.") + " Choose New code to try again.";
          return;
        }
        drawQr(canvas, data.qr);
        code.textContent = data.userCode;
        status.textContent = "Waiting for you to approve on your phone…";
        // Codes last 10 minutes; refresh a little early so the one on screen always works.
        expiry = setTimeout(function () { if (id === session) start(); }, Math.max(60, data.expiresIn - 20) * 1000);
        poll(id, data.deviceCode, data.interval || 5);
      });
    }
    function onKeyDown(e) {
      var key = e.keyCode || e.which;
      e.stopPropagation();
      e.preventDefault();
      if (BACK.indexOf(key) >= 0) close(false);
      else if (key === 37) fresh.focus();
      else if (key === 39) cancel.focus();
    }
    function onKeyUp(e) {
      var key = e.keyCode || e.which;
      e.stopPropagation();
      e.preventDefault();
      if (key === 13 && (document.activeElement === fresh || document.activeElement === cancel)) document.activeElement.click();
    }
    fresh.onclick = function () { start(); };
    cancel.onclick = function () { close(false); };
    root.addEventListener("keydown", onKeyDown, true);
    root.addEventListener("keyup", onKeyUp, true);
    active = { close: close };
    cancel.focus();
    start();
  }

  root.TunerPairing = { open: open, toSource: toSource, isOpen: function () { return !!active; } };
})(window);
