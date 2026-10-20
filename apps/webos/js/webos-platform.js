/* LG webOS platform layer, loaded after js/player.js and before js/app.js (both generated from the Samsung app by
 * tools/sync-from-tizen.js). ES5 only. It selects the TV's HTML video player instead of Samsung AVPlay, removes the
 * Samsung dual-player entry point, and gives app.js the LG ways to exit and to open YouTube. */
(function (root) {
  "use strict";
  var YOUTUBE_KEY = /^[A-Za-z0-9_-]{11}$/,
    LAUNCH_WAIT = 5000,
    // Bridges waiting for their reply stay referenced until it comes, as LG's webOSTV.js keeps them.
    calls = [];

  function exit() {
    if (root.PalmSystem && typeof root.PalmSystem.close === "function") {
      root.PalmSystem.close();
      return true;
    }
    root.close();
    return false;
  }

  // The YouTube app on the video (docs/extras.md, Trailer, LG): luna://com.webos.applicationManager/launch through
  // PalmServiceBridge, which LG's webOSTV.js uses inside. onFail runs (once) when there is no bridge, the call throws,
  // the reply is not returnValue true (errorCode -101: YouTube is not installed) or no reply comes within 5 seconds;
  // app.js then shows the QR dialog. Returns whether the launch was asked for.
  function openYouTube(key, onFail) {
    var Bridge = root.PalmServiceBridge,
      done = false,
      timer = null,
      entry = {};
    function settle(opened) {
      var index = calls.indexOf(entry);
      if (done) return;
      done = true;
      if (timer !== null && root.clearTimeout) root.clearTimeout(timer);
      if (index >= 0) calls.splice(index, 1);
      if (!opened && typeof onFail === "function") onFail();
    }
    if (typeof key !== "string" || !YOUTUBE_KEY.test(key) || typeof Bridge !== "function") {
      settle(false);
      return false;
    }
    try {
      entry.bridge = new Bridge();
      calls.push(entry);
      entry.bridge.onservicecallback = function (message) {
        var reply = null;
        try {
          reply = typeof message === "string" ? JSON.parse(message) : message;
        } catch (ignore) {}
        settle(!!reply && reply.returnValue === true);
      };
      if (root.setTimeout) timer = root.setTimeout(function () { settle(false); }, LAUNCH_WAIT);
      entry.bridge.call(
        "luna://com.webos.applicationManager/launch",
        JSON.stringify({ id: "youtube.leanback.v4", params: { contentTarget: "https://www.youtube.com/tv?v=" + key } })
      );
    } catch (error) {
      settle(false);
      return false;
    }
    return true;
  }

  root.TunerWebOS = { exit: exit, openYouTube: openYouTube };

  var create = root.TunerPlayer.create;
  root.TunerPlayer.create = function (options) {
    options = options || {};
    options.nativePlayer = null;
    return create(options);
  };
  root.TunerPlayer.createDual = null;
}(window));
