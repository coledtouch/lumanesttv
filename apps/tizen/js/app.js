(function (window, document) {
  "use strict";
  var D = window.TunerData,
    store = D.createStore(),
    client = null;
  var tabs = [
    "Live TV",
    "Movies",
    "Series",
    "Search",
    "Settings",
    "Multi View",
  ];
  var S = {
    tab: 0,
    zone: "nav",
    nav: 0,
    category: "__all",
    row: 0,
    offset: 0,
    // Guide time: focusAt null = "now", else the browsed time (ms); viewBase null = follow the current half hour.
    focusAt: null,
    viewBase: null,
    catalogs: { live: [], movies: [], series: [] },
    cats: { live: [], movies: [], series: [] },
    status: {},
    guide: {},
    guidesPending: {},
    guideChecked: {},
    watched: null,
    fullscreen: false,
    controls: true,
    browseCategory: { movies: "__all", series: "__all" },
    cards: { movies: 0, series: 0 },
    query: "",
    detail: null,
    detailInfo: null,
    season: 0,
    dialog: false,
    sourceGeneration: 0,
    focusId: null,
    // Last focused control per page (3 Search, 4 Settings), restored when the page is entered again.
    pageFocus: {},
    // Where full-screen live playback was opened from when that was not the guide (Search).
    playOrigin: null,
    guidePlaced: false,
    guideWaiting: false,
  };
  var topbar = document.getElementById("topbar"),
    main = document.getElementById("main");
  var overlay = document.getElementById("player-overlay"),
    dialogLayer = document.getElementById("dialog-layer");
  var toastTimer,
    overlayTimer,
    searchTimer,
    savedRecentAt = 0,
    currentPlayItem = null;
  // Focus to restore when a dialog closes; unsaved Settings fields; channel surfing; typed channel number.
  var dialogReturn = null,
    sourceDraft = {},
    surfTarget = null,
    surfTimer = null,
    lastSurfKey = 0,
    entry = { digits: "", timer: null };
  var dual = null,
    dualActive = false,
    dualRestarting = false,
    dualAudio = 0,
    dualMode = "split",
    dualControls = true,
    dualFocusId = "dual-pick-0",
    dualControlsTimer,
    dualMenuCodes = [],
    dualChannels = [null, null],
    dualStates = [{ status: "idle" }, { status: "idle" }];
  // The whole logical stage. AVPlay maps it to the panel; the app itself is scaled to fit.
  var FULL_RECT = { left: 0, top: 0, width: 1920, height: 1080 };
  // Provider catalogues before the adult filter. The filter runs whenever they arrive or the lock changes.
  var rawCatalogs = {
      live: { items: [], categories: [] },
      movies: { items: [], categories: [] },
      series: { items: [], categories: [] },
    },
    adultUnlocked = false,
    pin = null,
    subtitleTimer;
  var subtitleLayer = el("div", "subtitle-layer hidden");
  subtitleLayer.id = "subtitle-layer";
  document.getElementById("app").appendChild(subtitleLayer);
  var entryBadge = el("div", "channel-entry hidden");
  entryBadge.id = "channel-entry";
  document.getElementById("app").appendChild(entryBadge);
  var player = window.TunerPlayer.create({
    objectElement: document.getElementById("av-player"),
    videoElement: document.getElementById("html-player"),
    onState: onPlayerState,
    onTime: onPlayerTime,
    onEnded: onPlayerEnded,
    onSubtitle: showSubtitleText,
    subtitles: function () {
      return !!store.settings.subtitles;
    },
    onError: function (message) {
      if (!S.fullscreen) toast(message);
    },
  });

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function image(url, cls, alt) {
    var n = el("img", cls);
    n.alt = alt || "";
    n.src = url || "assets/icon.png";
    n.onerror = function () {
      n.onerror = null;
      n.src = "assets/icon.png";
    };
    return n;
  }
  function button(text, id, action, cls) {
    var n = el("button", cls, text);
    n.type = "button";
    n.id = id;
    n.onclick = action;
    n.onfocus = function () {
      remember(id);
    };
    return n;
  }
  // Focus model: exactly one thing looks focused. Page controls remember themselves so a page restores
  // its last focus when it is entered again; the tab bar, dialogs and the player bar never overwrite it.
  function remember(id) {
    S.focusId = id;
    if (
      id &&
      !S.dialog &&
      !S.fullscreen &&
      !S.detail &&
      !/^(tab-|dialog-|pin-|play-|dual-result-|dual-channel-query)/.test(id)
    ) {
      // Pointer or script focus that lands on a page control leaves the tab bar.
      if (S.zone === "nav" && S.tab >= 3 && !(dualActive && S.tab === 5))
        S.zone = "form";
      if (S.zone !== "nav") {
        if (S.tab === 5) dualFocusId = id;
        else if (S.tab === 3 || S.tab === 4) S.pageFocus[S.tab] = id;
      }
    }
    refreshBrandHint();
  }
  // Focuses a visible, enabled control. Returns false (and changes nothing) when it cannot.
  function focus(id) {
    var n = id && document.getElementById(id);
    if (!n || n.disabled || !(n.offsetWidth > 0)) return false;
    n.focus();
    remember(id);
    if (
      n.parentNode &&
      /chip-row|cards|episodes|search-results|picker-list/.test(
        n.parentNode.className
      )
    )
      scrollToElement(n);
    // Native focus scrolls the nearest scrollable ancestor; the scaled stage itself must never move.
    var root = document.scrollingElement || document.documentElement;
    if (root && root.scrollTop) root.scrollTop = 0;
    if (document.body && document.body.scrollTop) document.body.scrollTop = 0;
    return true;
  }
  function scrollToElement(n) {
    var p = n.parentNode;
    if (n.offsetLeft < p.scrollLeft) p.scrollLeft = n.offsetLeft - 5;
    else if (n.offsetLeft + n.offsetWidth > p.scrollLeft + p.clientWidth)
      p.scrollLeft = n.offsetLeft + n.offsetWidth - p.clientWidth + 6;
    if (/episodes|search-results|picker-list/.test(p.className)) {
      if (n.offsetTop < p.scrollTop) p.scrollTop = n.offsetTop;
      else if (n.offsetTop + n.offsetHeight > p.scrollTop + p.clientHeight)
        p.scrollTop = n.offsetTop + n.offsetHeight - p.clientHeight;
    }
  }
  function focusables(scope) {
    return Array.prototype.slice
      .call(scope.querySelectorAll("button,select,input,.focusable"))
      .filter(function (n) {
        return n.id && !n.disabled && n.offsetWidth > 0;
      });
  }
  // Arrows over explicit rows of ids: Left/Right within a row, Up/Down between rows, no wrap.
  // Returns false at an edge or when focus is not in the rows.
  function moveInRows(rows, code) {
    var cur = document.activeElement && document.activeElement.id,
      list = [],
      r,
      c = -1,
      i,
      t;
    rows.forEach(function (row) {
      var ids = row.filter(function (id) {
        var n = document.getElementById(id);
        return n && !n.disabled && n.offsetWidth > 0;
      });
      if (ids.length) list.push(ids);
    });
    for (r = 0; r < list.length && c < 0; r++) c = list[r].indexOf(cur);
    if (c < 0) return false;
    r--;
    if (code === 37 || code === 39) {
      i = c + (code === 37 ? -1 : 1);
      return i >= 0 && i < list[r].length ? focus(list[r][i]) : false;
    }
    t = r + (code === 38 ? -1 : 1);
    return t >= 0 && t < list.length
      ? focus(list[t][Math.min(c, list[t].length - 1)])
      : false;
  }
  // Arrows on a free 2-D page: the nearest focusable in the arrow's direction, preferring controls in
  // line with the current one.
  // - Left/Right stay on the row: only controls that line up vertically (within a few pixels).
  // - Up/Down leave the line among siblings (a wrapped grid's short row). With nothing in line, they
  //   go to the nearest row above/below in the same column of the page, landing on its first control.
  // - Entering a chip row from above or below lands on its chosen (.active) chip.
  function moveSpatial(scope, code) {
    var cur = document.activeElement,
      nodes = focusables(scope),
      best = null,
      bestScore = 0,
      offLine = [],
      vertical = code === 38 || code === 40,
      a,
      near,
      chosen;
    if (nodes.indexOf(cur) < 0) return false;
    a = cur.getBoundingClientRect();
    nodes.forEach(function (n) {
      if (n === cur) return;
      var b = n.getBoundingClientRect(),
        gap,
        ortho,
        score;
      gap =
        code === 40
          ? b.top - (a.top + a.height)
          : code === 38
            ? a.top - (b.top + b.height)
            : code === 39
              ? b.left - (a.left + a.width)
              : a.left - (b.left + b.width);
      if (gap < -4) return;
      ortho = vertical
        ? Math.max(0, b.left - (a.left + a.width), a.left - (b.left + b.width))
        : Math.max(0, b.top - (a.top + a.height), a.top - (b.top + b.height));
      if (!vertical && ortho > 10) return;
      if (vertical && ortho > 0 && n.parentNode !== cur.parentNode) {
        if (sameColumn(cur, n))
          offLine.push({ n: n, gap: Math.max(0, gap), left: b.left });
        return;
      }
      score = (ortho > 0 ? 100000 : 0) + Math.max(0, gap) + 3 * ortho;
      if (!best || score < bestScore) {
        best = n;
        bestScore = score;
      }
    });
    if (!best && offLine.length) {
      near = Math.min.apply(
        null,
        offLine.map(function (o) {
          return o.gap;
        })
      );
      offLine
        .filter(function (o) {
          return o.gap <= near + 10;
        })
        .forEach(function (o) {
          if (!best || o.left < bestScore) {
            best = o.n;
            bestScore = o.left;
          }
        });
    }
    if (!best) return false;
    if (
      vertical &&
      best.parentNode !== cur.parentNode &&
      /\bchip-row\b/.test(best.parentNode.className)
    ) {
      chosen = best.parentNode.querySelector(".active");
      if (chosen && chosen.id && focus(chosen.id)) return true;
    }
    return focus(best.id);
  }
  // Whether two controls sit in the same column of the page: the branches of their nearest common
  // container overlap horizontally (Settings' form and its side panel do not).
  function sameColumn(a, b) {
    var ca = a,
      cb = b,
      ra,
      rb;
    while (ca.parentNode && !ca.parentNode.contains(b)) ca = ca.parentNode;
    while (cb.parentNode && cb.parentNode !== ca.parentNode) cb = cb.parentNode;
    ra = ca.getBoundingClientRect();
    rb = cb.getBoundingClientRect();
    return rb.left < ra.left + ra.width && ra.left < rb.left + rb.width;
  }
  function toNav() {
    S.zone = "nav";
    S.nav = S.tab;
    render();
  }
  function enterPage() {
    S.focusId = null;
    S.zone = S.tab === 0 ? "grid" : S.tab === 1 || S.tab === 2 ? "cards" : "form";
    render();
  }
  function enterGrid() {
    S.zone = "grid";
    S.focusId = null;
  }
  // Safety net after every key: a zone that needs DOM focus never keeps it on nothing or a hidden node.
  function ensureFocus() {
    var a = document.activeElement,
      first;
    if (window.TunerPairing && window.TunerPairing.isOpen && window.TunerPairing.isOpen())
      return;
    if (a && a !== document.body && a.offsetWidth > 0) return;
    if (S.dialog) {
      first = focusables(dialogLayer)[0];
      if (first) focus(first.id);
      return;
    }
    if (S.fullscreen) {
      if (S.zone === "player-actions") focus("play-toggle");
      return;
    }
    if (dualActive && S.tab === 5) return;
    if (S.zone === "nav") {
      focus("tab-" + S.nav);
      return;
    }
    if (S.tab === 0 && !S.detail) {
      if (S.zone !== "grid" && S.zone !== "video") renderGuide();
      return;
    }
    render();
  }
  function backLabel() {
    if (S.detail)
      return S.detail.origin && S.detail.origin.tab === 3 ? "Search" : "Titles";
    if (S.tab === 0 && S.zone === "grid")
      return S.focusAt !== null ? "Now" : "Categories";
    if (S.tab === 0 && S.zone === "empty") return "Categories";
    return "Tabs";
  }
  function refreshBrandHint() {
    var n = document.getElementById("brand-hint");
    if (n) n.textContent = S.zone === "nav" ? "OK Open" : "Back " + backLabel();
  }
  function toast(message) {
    var n = document.getElementById("toast"),
      a = document.activeElement,
      top = false,
      r;
    // Keep the message away from the focused control: low focus puts it at the top. The guide's list
    // highlight has no DOM focus and its rows fill the lower half, so the toast goes to the top there.
    if (S.tab === 0 && S.zone === "grid" && !S.fullscreen && !S.detail) top = true;
    else if (a && a !== document.body && a.getBoundingClientRect) {
      r = a.getBoundingClientRect();
      top = r.top + r.height / 2 > (window.innerHeight || 1080) / 2;
    }
    n.textContent = message;
    n.className = top ? "top" : "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      n.className = "hidden";
    }, 3500);
  }
  function clock(ms) {
    return new Date(ms).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  function elapsed(ms) {
    var sec = Math.max(0, Math.floor(ms / 1000));
    return (
      (sec >= 3600 ? Math.floor(sec / 3600) + ":" : "") +
      ("0" + (Math.floor(sec / 60) % 60)).slice(-2) +
      ":" +
      ("0" + (sec % 60)).slice(-2)
    );
  }
  function selectedLive() {
    var items = liveItems();
    return items[S.row] || null;
  }
  function liveItems() {
    var items = S.catalogs.live;
    if (S.category === "__fav") {
      var favorites = Object.create(null);
      store.favourites().forEach(function (id) {
        favorites[id] = true;
      });
      return items.filter(function (c) {
        return favorites[c.id] === true;
      });
    }
    if (S.category === "__hot") {
      var ids = store.mostWatched(),
        index = Object.create(null);
      items.forEach(function (channel) {
        index[channel.id] = channel;
      });
      return ids
        .map(function (id) {
          return index[id];
        })
        .filter(Boolean);
    }
    if (S.category !== "__all")
      return items.filter(function (c) {
        return c.categoryIds.indexOf(S.category) >= 0;
      });
    return items;
  }
  function liveCategories() {
    return D.categoryItems
      ? D.categoryItems(S.cats.live, true, store.settings.categoryOrder)
      : [
          { id: "__all", name: "All Channels" },
          { id: "__fav", name: "Favorites" },
          { id: "__hot", name: "Most Watched" },
        ].concat(S.cats.live);
  }
  // cats: liveCategories(), when the caller already has it (it sorts every category).
  function activeChipIndex(cats) {
    return Math.max(
      0,
      (cats || liveCategories())
        .map(function (c) {
          return c.id;
        })
        .indexOf(S.category)
    );
  }
  function categoryName(cats) {
    if (S.category === "__all") return "All channels";
    cats = cats || liveCategories();
    var cat = cats[activeChipIndex(cats)];
    return (cat && cat.name) || "All channels";
  }
  // Guide time model. The window shows two hours from viewStart(); the highlighted block is the one
  // that contains selectedAt(). Right/Left walk program to program (scheduleStep).
  function nowBase() {
    return Math.floor(Date.now() / 1800000) * 1800000;
  }
  function viewStart() {
    return S.viewBase !== null ? S.viewBase : nowBase();
  }
  function selectedAt() {
    return S.focusAt !== null ? S.focusAt : Date.now();
  }
  function listings(c) {
    return (c && S.guide[c.id]) || [];
  }
  // Always returns a block for a channel: a real program, a synthetic "No information" gap (holes under
  // five minutes belong to the next program), or "Schedule unavailable" when the channel has no guide.
  function programAt(c, at) {
    var list = listings(c),
      prev = null,
      next = null,
      i;
    if (!c) return null;
    if (!list.length)
      return {
        title: "Schedule unavailable",
        description: "Watch live",
        start: viewStart(),
        end: viewStart() + 7200000,
        none: true,
      };
    for (i = 0; i < list.length; i++) {
      if (list[i].start <= at && list[i].end > at) return list[i];
      if (list[i].end <= at) prev = list[i];
      else if (!next && list[i].start > at) next = list[i];
    }
    if (next && prev && next.start - prev.end < 300000) return next;
    return {
      title: "No information",
      description: "Watch live",
      start: prev ? prev.end : Math.min(at, viewStart()),
      end: next ? next.start : Math.max(at + 1, viewStart() + 7200000),
      gap: true,
      last: !next,
    };
  }
  function selectedProgram(c) {
    return programAt(c, selectedAt());
  }
  function realProgram(p) {
    return !!(p && !p.gap && !p.none);
  }
  function scheduleStep(code) {
    var c = selectedLive(),
      now = Date.now(),
      p,
      q,
      t;
    if (!c) return;
    p = programAt(c, selectedAt());
    if (code === 39) {
      if (p.none || p.last || p.end > now + 86400000) return;
      t = p.end;
    } else if (p.start <= now) {
      if (S.focusAt === null) return;
      t = null;
    } else {
      q = programAt(c, p.start - 1);
      t = q.start <= now ? null : q.start;
    }
    S.focusAt = t;
    if (t === null) {
      S.viewBase = null;
      return;
    }
    if (S.viewBase === null) S.viewBase = nowBase();
    if (t < S.viewBase || t >= S.viewBase + 5400000)
      S.viewBase = Math.max(nowBase(), Math.floor(t / 1800000) * 1800000);
  }
  // The blocks drawn in one guide row: listings clipped to the two-hour window, holes filled with
  // "No information" (short holes join the next program), or one "Schedule unavailable" block.
  function rowBlocks(c) {
    var start = viewStart(),
      end = start + 7200000,
      list = listings(c),
      out = [],
      cursor = start,
      i,
      q,
      from;
    function gap(a, b) {
      out.push({
        p: { title: "No information", description: "Watch live", start: a, end: b, gap: true },
        from: a,
        to: b,
      });
    }
    if (!list.length)
      return [
        {
          p: { title: "Schedule unavailable", description: "Watch live", start: start, end: end, none: true },
          from: start,
          to: end,
        },
      ];
    for (i = 0; i < list.length && cursor < end; i++) {
      q = list[i];
      if (q.end <= cursor) continue;
      if (q.start >= end) break;
      from = Math.max(q.start, cursor);
      if (from > cursor) {
        if (from - cursor < 300000) from = cursor;
        else gap(cursor, from);
      }
      out.push({ p: q, from: from, to: q.end });
      cursor = q.end;
    }
    if (cursor < end) gap(cursor, end);
    return out;
  }
  function requestGuide(channel) {
    if (
      !channel ||
      !client ||
      S.guidesPending[channel.id] ||
      (S.guide[channel.id] &&
        Date.now() - (S.guideChecked[channel.id] || 0) < 60000)
    )
      return;
    S.guidesPending[channel.id] = true;
    S.guideChecked[channel.id] = Date.now();
    var generation = S.sourceGeneration;
    client.guide(channel).then(
      function (programs) {
        if (generation !== S.sourceGeneration) return;
        S.guide[channel.id] = (programs || []).slice().sort(function (a, b) {
          return a.start - b.start;
        });
        delete S.guidesPending[channel.id];
        if (S.tab === 0 && !S.fullscreen && !S.dialog) renderGuide();
        else if (S.fullscreen && !S.dialog && (surfTarget || S.watched) === channel)
          renderPlayerOverlay();
      },
      function () {
        if (generation === S.sourceGeneration) {
          S.guide[channel.id] = [];
          delete S.guidesPending[channel.id];
        }
      }
    );
  }
  function renderNav() {
    topbar.textContent = "";
    var brand = el("div", "brand");
    brand.appendChild(image("assets/icon.png"));
    var label = el("div");
    label.appendChild(el("strong", "", "tuner"));
    var hint = el("small", "", "");
    hint.id = "brand-hint";
    label.appendChild(hint);
    brand.appendChild(label);
    topbar.appendChild(brand);
    var nav = el("nav");
    nav.setAttribute("aria-label", "Main navigation");
    tabs.forEach(function (name, i) {
      var b = button(
        name,
        "tab-" + i,
        function () {
          openTab(i);
        },
        S.tab === i ? "active" : ""
      );
      b.onfocus = function () {
        S.zone = "nav";
        S.nav = i;
        remember(b.id);
      };
      nav.appendChild(b);
    });
    topbar.appendChild(nav);
    topbar.appendChild(el("div", "clock", clock(Date.now())));
    refreshBrandHint();
  }
  // onNav: stay on the tab bar (Back from another tab's bar lands on Live TV's tab).
  function openTab(i, onNav) {
    if (S.tab === 5 && i !== 5) stopDual();
    if (S.fullscreen) leaveFullscreen();
    closeDialog(false);
    S.detail = null;
    S.detailInfo = null;
    S.tab = i;
    S.nav = i;
    S.focusId = null;
    S.zone = onNav
      ? "nav"
      : i === 0
        ? "grid"
        : i === 1 || i === 2
          ? "cards"
          : "form";
    if (i !== 0) hidePreview();
    render();
    if (i === 0) resumeGuidePreview();
  }
  function resumeGuidePreview() {
    if (
      document.hidden ||
      S.tab !== 0 ||
      S.fullscreen ||
      S.detail ||
      dualActive ||
      player.state.status !== "idle"
    )
      return;
    var last = store.lastWatched(),
      channel =
        S.watched ||
        S.catalogs.live.filter(function (item) {
          return item.id === last;
        })[0];
    if (!channel) return;
    S.watched = channel;
    currentPlayItem = channel;
    player.play({
      url: channel.url,
      backups: channel.backups,
      live: true,
      title: channel.name,
      id: channel.id,
    });
    renderGuide();
  }
  function render() {
    applyTheme();
    renderNav();
    if (S.detail) renderDetail();
    else if (S.tab === 0) renderGuide();
    else if (S.tab === 1 || S.tab === 2) renderBrowse();
    else if (S.tab === 3) renderSearch();
    else if (S.tab === 5) renderMultiView();
    else renderSettings();
  }
  function guideLoading() {
    return (
      !S.catalogs.live.length &&
      !!store.settings.source &&
      (!S.status.live || S.status.live.state === "loading")
    );
  }
  function statusEmpty(kind, text) {
    var box = el("div", "guide-status");
    var status = S.status[kind];
    if (kind === "live" && guideLoading()) {
      // No button while loading: OK must not restart the download.
      box.appendChild(el("h2", "", "Loading your channels"));
      box.appendChild(el("p", "muted", "This takes a few seconds."));
      return box;
    }
    box.appendChild(
      el(
        "h2",
        "",
        status && status.state === "loading"
          ? "Loading your " + text.toLowerCase()
          : "Your " + text.toLowerCase()
      )
    );
    box.appendChild(
      el(
        "p",
        "muted",
        status && status.state === "error"
          ? status.message
          : store.settings.source
            ? "The playlist has no available items here."
            : "Add your playlist to start watching."
      )
    );
    box.appendChild(
      button(
        store.settings.source ? "Refresh playlist" : "Add playlist",
        "empty-action",
        function () {
          if (store.settings.source) connect(true);
          else openTab(4);
        }
      )
    );
    return box;
  }
  function previewHintText(focused) {
    if (S.watched) return focused ? "▶ OK Full screen" : "↑ Select for full screen";
    return focused ? "▶ OK Preview" : "OK on a channel to watch";
  }
  function setPreviewHint(focused) {
    var hint = main.querySelector(".preview-hint"),
      status = player.state && player.state.status;
    if (!hint) return;
    hint.textContent =
      S.watched && status === "loading"
        ? "Connecting…"
        : S.watched && status === "error"
          ? "Playback unavailable · OK Retry"
          : previewHintText(focused);
  }
  function guideHint(p) {
    if (S.zone === "categories")
      return "← → Categories  ·  OK Show channels  ·  ↑ Preview  ·  Back Tabs";
    if (S.zone === "actions")
      return "← → Choose  ·  OK Select  ·  ↓ Categories  ·  Back Tabs";
    if (S.zone === "nav") return "← → Tabs  ·  OK Open  ·  Back Close Tuner";
    if (realProgram(p) && p.start > Date.now())
      return "OK Details  ·  ← → Schedule  ·  Back " + backLabel();
    return (
      "OK Watch  ·  Hold OK Favorite  ·  ← → Schedule  ·  CH +/− Page  ·  Back " +
      backLabel()
    );
  }
  function renderGuide() {
    if (S.fullscreen || S.tab !== 0 || S.detail) return;
    var old = S.focusId;
    main.textContent = "";
    var items = liveItems(),
      cats = liveCategories(),
      chipAt = activeChipIndex(cats),
      catName = categoryName(cats);
    if (guideLoading()) {
      // Loading: focus waits on the categories and moves to the list once channels arrive.
      if (S.zone === "grid" || S.zone === "empty") {
        S.zone = "categories";
        S.guideWaiting = true;
        old = S.focusId = "live-cat-" + chipAt;
      }
    } else if (items.length) {
      if (S.zone === "empty" || (S.guideWaiting && S.zone === "categories"))
        enterGrid();
      S.guideWaiting = false;
      // Only the first guide shown after loading jumps to the channel being watched (or last watched),
      // whichever tab was open when the channels arrived; later visits keep the row.
      if (!S.guidePlaced) {
        var placeId = S.watched ? S.watched.id : store.lastWatched();
        for (var placeAt = 0; placeAt < items.length; placeAt++)
          if (items[placeAt].id === placeId) {
            S.row = placeAt;
            S.offset = Math.max(0, placeAt - 1);
            break;
          }
        S.guidePlaced = true;
      }
    } else if (S.guideWaiting && S.zone === "categories") {
      // Loading ended without channels: focus moves from the categories to the status action.
      S.guideWaiting = false;
      S.zone = "empty";
    }
    S.row = Math.max(0, Math.min(S.row, items.length - 1));
    if (S.row < S.offset) S.offset = S.row;
    if (S.row >= S.offset + 4) S.offset = S.row - 3;
    S.offset = Math.max(0, Math.min(S.offset, Math.max(0, items.length - 4)));
    var c = items[S.row],
      p = selectedProgram(c),
      real = realProgram(p),
      previewFocused =
        S.zone === "actions" && old !== "guide-fav",
      hero = el("section", "hero");
    var copy = el("div", "copy");
    copy.appendChild(
      el(
        "div",
        "eyebrow",
        c ? (c.number || S.row + 1) + "  " + c.name : "Live TV"
      )
    );
    copy.appendChild(
      el("h1", "", real ? p.title : c ? c.name : "Welcome to Tuner")
    );
    var meta = el("div", "metadata");
    if (real) {
      if (p.start <= Date.now() && p.end > Date.now())
        meta.appendChild(el("span", "badge", "ON NOW"));
      meta.appendChild(
        document.createTextNode(clock(p.start) + " – " + clock(p.end))
      );
    } else
      meta.textContent = c
        ? "Live channel · " + (p && p.gap ? "No information" : "Schedule unavailable")
        : "A guide made for your TV";
    copy.appendChild(meta);
    copy.appendChild(
      el(
        "p",
        "description",
        (real && p.description) ||
          (c
            ? S.watched
              ? "Browse channels and programs while " +
                S.watched.name +
                " keeps playing. Press OK to watch."
              : "Browse channels and programs. Press OK to watch."
            : "Live TV, Movies and Series in one simple place.")
      )
    );
    hero.appendChild(copy);
    var preview = el("div", "preview-frame focusable");
    preview.id = "preview-frame";
    preview.setAttribute("role", "button");
    preview.tabIndex = 0;
    preview.onclick = function () {
      if (S.watched) {
        // Back from full screen returns to the preview it was opened from.
        S.playOrigin = { tab: 0, zone: "actions", focus: "preview-frame" };
        enterFullscreen();
      } else if (c) watch(c, false);
    };
    preview.onfocus = function () {
      S.zone = "actions";
      remember(preview.id);
      setPreviewHint(true);
    };
    preview.onblur = function () {
      setPreviewHint(false);
    };
    if (!S.watched)
      preview.appendChild(el("div", "empty-video", "Choose a channel"));
    else
      preview.appendChild(el("div", "watching", "Watching " + S.watched.name));
    preview.appendChild(el("div", "preview-hint", ""));
    hero.appendChild(preview);
    if (c) {
      var actions = el("div", "hero-actions");
      var fav = button(
        store.isFavourite(c.id) ? "★ Saved" : "☆ Favorite",
        "guide-fav",
        function () {
          toggleFavorite(c);
        }
      );
      fav.onfocus = function () {
        S.zone = "actions";
        remember(fav.id);
      };
      actions.appendChild(fav);
      hero.appendChild(actions);
    }
    main.appendChild(hero);
    setPreviewHint(previewFocused);
    var chips = el("div", "chip-row");
    // Jump, do not animate, while the row is rebuilt; smooth scrolling returns at the end.
    chips.style.scrollBehavior = "auto";
    cats.forEach(function (cat, i) {
      var b = button(
        cat.name,
        "live-cat-" + i,
        function () {
          if (S.category !== cat.id) {
            S.category = cat.id;
            S.row = 0;
            S.offset = 0;
          }
          enterGrid();
          renderGuide();
        },
        cat.id === S.category ? "active" : ""
      );
      b.onfocus = function () {
        S.zone = "categories";
        remember(b.id);
      };
      chips.appendChild(b);
    });
    main.appendChild(chips);
    if (!items.length) {
      main.appendChild(
        statusEmpty(
          "live",
          S.category === "__fav"
            ? "Favorites"
            : S.category === "__hot"
              ? "Most Watched"
              : "Channels"
        )
      );
      if (
        !guideLoading() &&
        (S.category === "__fav" || S.category === "__hot")
      ) {
        main.querySelector(".guide-status p").textContent =
          S.category === "__fav"
            ? "Hold OK on a channel, or select ☆ Favorite above the list, to save it here."
            : "Channels you watch will appear here automatically.";
        var emptyAction = document.getElementById("empty-action");
        emptyAction.textContent = "Browse all channels";
        emptyAction.onclick = function () {
          S.category = "__all";
          S.row = Math.max(0, S.catalogs.live.indexOf(S.watched));
          S.offset = Math.max(0, S.row - 1);
          enterGrid();
          renderGuide();
        };
      }
    } else {
      var head = el("div", "time-header"),
        at = selectedAt();
      head.appendChild(
        el(
          "div",
          "today",
          (S.focusAt !== null ? "Schedule" : "Today") + " · " + catName
        )
      );
      var labels = el("div", "timeline-labels");
      for (var t = 0; t < 4; t++)
        labels.appendChild(el("span", "", clock(viewStart() + t * 1800000)));
      head.appendChild(labels);
      main.appendChild(head);
      items.slice(S.offset, S.offset + 4).forEach(function (channel, index) {
        var row = el("div", "guide-row"),
          selectedRow = S.offset + index === S.row;
        var cell = el(
          "div",
          "channel-cell" + (selectedRow ? " selected" : "")
        );
        cell.appendChild(
          el("span", "channel-number", channel.number || S.offset + index + 1)
        );
        cell.appendChild(image(channel.image, "channel-logo"));
        cell.appendChild(el("span", "channel-name", channel.name));
        if (store.isFavourite(channel.id))
          cell.appendChild(el("span", "star", "★"));
        row.appendChild(cell);
        var programs = el("div", "programs"),
          start = viewStart();
        rowBlocks(channel).forEach(function (b) {
          var q = b.p,
            left = Math.max(0, ((b.from - start) / 7200000) * 100),
            right = Math.min(100, ((b.to - start) / 7200000) * 100);
          var selected = selectedRow && b.from <= at && b.to > at;
          var block = el(
            "div",
            "program" + (selected && S.zone === "grid" ? " focused" : "")
          );
          block.style.left = left + "%";
          block.style.width = right - left + "%";
          block.appendChild(el("strong", "", q.title));
          block.appendChild(
            el(
              "span",
              "",
              q.gap || q.none
                ? "Watch live"
                : clock(q.start) + " – " + clock(q.end)
            )
          );
          block.onclick = function () {
            S.row = S.offset + index;
            enterGrid();
            activateChannel(channel, q);
          };
          programs.appendChild(block);
        });
        row.appendChild(programs);
        main.appendChild(row);
        requestGuide(channel);
      });
      var foot = el("div", "guide-footer");
      foot.appendChild(
        el(
          "span",
          "",
          S.row + 1 + " / " + items.length + " channels  ·  " + catName
        )
      );
      foot.appendChild(el("span", "", guideHint(p)));
      main.appendChild(foot);
    }
    if (S.zone === "nav") focus("tab-" + S.nav);
    else if (S.zone === "categories")
      focus(
        old && /^live-cat-/.test(old) && document.getElementById(old)
          ? old
          : "live-cat-" + chipAt
      );
    else if (S.zone === "actions")
      focus(old === "guide-fav" || old === "preview-frame" ? old : "preview-frame") ||
        focus("preview-frame");
    else if (!items.length) {
      S.zone = "empty";
      focus("empty-action");
    } else if (
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement.blur
    )
      document.activeElement.blur();
    // Keep the chosen category in view (a focused chip scrolls itself). Done once the whole guide is
    // built, so a key press lays the page out once.
    if (S.zone !== "categories") {
      var activeChip = document.getElementById("live-cat-" + chipAt);
      if (activeChip) scrollToElement(activeChip);
    }
    chips.style.scrollBehavior = "";
    refreshBrandHint();
    if (S.watched) previewRect();
  }
  function toChips() {
    S.zone = "categories";
    S.focusId = "live-cat-" + activeChipIndex();
    renderGuide();
  }
  function toHero() {
    if (!liveItems().length) return toNav();
    S.zone = "actions";
    S.focusId = "preview-frame";
    renderGuide();
  }
  function guideArrow(code) {
    var items = liveItems(),
      f = document.activeElement;
    if (S.zone === "grid") {
      if (code === 38 && S.row === 0) return toChips();
      if (code === 38 || code === 40)
        S.row = Math.max(
          0,
          Math.min(items.length - 1, S.row + (code === 40 ? 1 : -1))
        );
      else scheduleStep(code);
      renderGuide();
      return;
    }
    if (S.zone === "empty") {
      if (code === 38) toChips();
      return;
    }
    if (S.zone === "actions") {
      if (code === 37 || code === 39)
        moveInRows([["guide-fav", "preview-frame"]], code);
      else if (code === 38) toNav();
      else toChips();
      return;
    }
    // Category chips.
    if (code === 37 || code === 39) {
      moveInRows(
        [
          liveCategories().map(function (cat, i) {
            return "live-cat-" + i;
          }),
        ],
        code
      );
      return;
    }
    if (code === 38) return toHero();
    // Down shows the focused category's channels; on the chosen one it returns to the same row.
    if (f && /^live-cat-/.test(f.id) && !/\bactive\b/.test(f.className))
      f.click();
    else {
      enterGrid();
      renderGuide();
    }
  }
  function activateChannel(c, p) {
    if (realProgram(p) && p.start > Date.now()) {
      showDialog(
        p.title,
        clock(p.start) + " – " + clock(p.end) + "\n" + (p.description || ""),
        [
          {
            text: "Watch channel now",
            run: function () {
              closeDialog(false);
              watch(c, true);
            },
          },
          {
            text: store.isFavourite(c.id) ? "Remove Favorite" : "Save Favorite",
            run: function () {
              toggleFavorite(c);
              closeDialog();
            },
          },
        ]
      );
    } else watch(c, true);
  }
  function toggleFavorite(c) {
    store.toggleFavourite(c.id);
    toast(
      store.isFavourite(c.id)
        ? c.name + " saved to Favorites"
        : c.name + " removed from Favorites"
    );
    if (S.fullscreen) renderPlayerOverlay();
    else if (S.tab === 0) renderGuide();
    else if (S.tab === 3) renderSearch();
  }
  function playLive(c) {
    player.play({
      url: c.url,
      backups: c.backups,
      live: true,
      title: c.name,
      id: c.id,
    });
  }
  // Whether c is the stream already loading or playing (so it must not be tuned again).
  function playingNow(c) {
    var st = player.state;
    return !!(
      c &&
      st &&
      st.request &&
      st.request.id === c.id &&
      /^(loading|playing|paused)$/.test(st.status)
    );
  }
  function watch(c, full) {
    if (!c) return;
    if (dualActive) stopDual();
    if (S.fullscreen) {
      // Channel change while watching: the key already restarted the controls timer.
      clearTimeout(surfTimer);
      surfTimer = null;
      surfTarget = null;
      // The channel already playing (its own number, or a surf that came back to it) is not retuned.
      var retune = !playingNow(c);
      S.watched = currentPlayItem = c;
      if (retune) {
        store.recordWatched(c.id);
        player.setRect(FULL_RECT);
        playLive(c);
      }
      if (!S.playOrigin || S.playOrigin.tab === 0) syncGuideRow(c);
      S.controls = true;
      requestGuide(c);
      renderPlayerOverlay();
      return;
    }
    if (full && S.tab !== 0)
      S.playOrigin = { tab: S.tab, zone: S.zone, focus: S.focusId };
    if (S.tab === 0) {
      S.focusAt = null;
      S.viewBase = null;
      syncGuideRow(c);
    }
    // OK on the channel already playing in the preview opens it without restarting the stream.
    if (full && S.watched && S.watched.id === c.id && playingNow(c)) {
      enterFullscreen();
      return;
    }
    currentPlayItem = c;
    S.watched = c;
    store.recordWatched(c.id);
    // Open a full-screen stream with full-screen geometry, never the guide preview's.
    if (full) player.setRect(FULL_RECT);
    playLive(c);
    if (full) enterFullscreen();
    else renderGuide();
  }
  // Channels CH and Up/Down step through: the guide's list, or every channel when opened from Search.
  function surfList() {
    var list =
      S.playOrigin && S.playOrigin.tab !== 0 ? S.catalogs.live : liveItems();
    return S.watched && list.indexOf(S.watched) >= 0 ? list : S.catalogs.live;
  }
  // The first press tunes at once; rapid or held presses only move the banner and tune 500 ms after the last.
  function changeChannel(delta) {
    var list = surfList(),
      n = list.length,
      from = surfTarget || S.watched,
      i,
      next,
      quick;
    if (!n) return;
    i = list.indexOf(from);
    next = list[i < 0 ? 0 : (i + delta + n) % n];
    if (n === 1 && next === S.watched) {
      // A one-channel list: nothing to change to, so show the banner instead of retuning.
      S.controls = true;
      renderPlayerOverlay();
      toast(
        "No other channels in " +
          (list === S.catalogs.live ? "your playlist" : categoryName())
      );
      return;
    }
    quick = Date.now() - lastSurfKey < 700;
    lastSurfKey = Date.now();
    if (!quick && !surfTarget) {
      watch(next, true);
      return;
    }
    surfTarget = next;
    clearTimeout(surfTimer);
    surfTimer = setTimeout(commitSurf, 500);
    S.controls = true;
    requestGuide(next);
    renderPlayerOverlay();
  }
  function commitSurf() {
    clearTimeout(surfTimer);
    surfTimer = null;
    var c = surfTarget;
    surfTarget = null;
    if (c && S.fullscreen) watch(c, true);
  }
  function syncGuideRow(c, force) {
    var at = liveItems().indexOf(c);
    if (at < 0 && force && c) {
      S.category = "__all";
      at = liveItems().indexOf(c);
    }
    if (at < 0) return;
    S.row = at;
    if (S.row < S.offset || S.row >= S.offset + 4)
      S.offset = Math.max(0, S.row - 1);
  }
  // CH+ pages up (d = -4), CH- pages down (d = 4); the highlight keeps its place in the window.
  function pageGuide(d) {
    var n = liveItems().length;
    if (!n) return;
    S.offset = Math.max(0, Math.min(Math.max(0, n - 4), S.offset + d));
    S.row = Math.max(0, Math.min(n - 1, S.row + d));
    enterGrid();
    render();
  }
  // Number keys: up to four digits, shown in a badge, then tune (full screen) or jump the guide.
  function numberKey(d) {
    clearTimeout(entry.timer);
    entry.digits = (entry.digits + d).slice(0, 4);
    entryBadge.textContent = "CH " + entry.digits + "_";
    entryBadge.appendChild(el("small", "", "OK Go  ·  Back Cancel"));
    entryBadge.className = "channel-entry";
    if (entry.digits.length >= 4) commitNumber();
    else entry.timer = setTimeout(commitNumber, 1500);
  }
  function clearEntry() {
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.digits = "";
    entryBadge.textContent = "";
    entryBadge.className = "channel-entry hidden";
  }
  function commitNumber() {
    var typed = entry.digits,
      n = Number(typed),
      c;
    clearEntry();
    if (!typed || S.dialog) return;
    c = S.catalogs.live.filter(function (x) {
      return Number(x.number) === n;
    })[0];
    if (!c) return toast("No channel " + n);
    if (S.fullscreen) {
      if (player.state.request && player.state.request.live) watch(c, true);
      return;
    }
    if (S.tab !== 0 || S.detail) return;
    if (liveItems().indexOf(c) < 0) S.category = "__all";
    S.row = liveItems().indexOf(c);
    S.offset = Math.max(0, S.row - 1);
    enterGrid();
    render();
  }
  function previewRect() {
    if (S.fullscreen) return;
    var n = document.getElementById("preview-frame");
    if (!n || S.tab !== 0) return hidePreview();
    var scale = window.innerWidth / 1920,
      r = n.getBoundingClientRect();
    player.setRect({
      left: r.left / scale + 2,
      top: r.top / scale + 2,
      width: r.width / scale - 4,
      height: r.height / scale - 4,
    });
  }
  function hidePreview() {
    if (
      player.state &&
      player.state.request &&
      player.state.request.live &&
      !S.fullscreen
    )
      player.stop();
    player.setRect({ left: 0, top: 0, width: 0, height: 0 });
    applyTheme();
  }
  function browseKind() {
    return S.tab === 1 ? "movies" : "series";
  }
  function browseItems(kind) {
    var category = S.browseCategory[kind],
      items = S.catalogs[kind];
    if (category === "__recent" && kind === "movies") {
      var recents = store.recents();
      return recents
        .map(function (r) {
          return items.filter(function (i) {
            return i.id === r.id;
          })[0];
        })
        .filter(Boolean);
    }
    if (category !== "__all")
      items = items.filter(function (i) {
        return i.categoryIds.indexOf(category) >= 0;
      });
    return items;
  }
  function renderBrowse() {
    main.textContent = "";
    var kind = browseKind(),
      items = browseItems(kind);
    S.cards[kind] = Math.max(
      0,
      Math.min(S.cards[kind], Math.max(0, items.length - 1))
    );
    var hero = el("section", "browse-hero");
    hero.id = "browse-hero";
    main.appendChild(hero);
    var chips = el("div", "chip-row"),
      cats = [
        { id: "__all", name: kind === "movies" ? "All Movies" : "All Series" },
      ];
    if (kind === "movies" && store.recents().length)
      cats.push({ id: "__recent", name: "Continue Watching" });
    cats = cats.concat(S.cats[kind]);
    cats.forEach(function (cat, i) {
      var b = button(
        cat.name,
        "browse-cat-" + i,
        function () {
          S.browseCategory[kind] = cat.id;
          S.cards[kind] = 0;
          S.zone = "cards";
          renderBrowse();
        },
        S.browseCategory[kind] === cat.id ? "active" : ""
      );
      b.onfocus = function () {
        S.zone = "categories";
        remember(b.id);
      };
      chips.appendChild(b);
    });
    main.appendChild(chips);
    if (!items.length)
      main.appendChild(
        statusEmpty(kind, kind === "movies" ? "Movies" : "Series")
      );
    else {
      var cards = el("div", "cards");
      var start = Math.max(0, S.cards[kind] - 3),
        visible = items.slice(start, start + 10);
      visible.forEach(function (item, index) {
        var i = start + index,
          card = button(
            "",
            "card-" + i,
            function () {
              openDetail(item, kind);
            },
            "card"
          );
        if (item.image) card.appendChild(image(item.image));
        else
          card.appendChild(
            el("div", "no-poster", item.name.slice(0, 2).toUpperCase())
          );
        if (item.rating)
          card.appendChild(el("span", "rating", "★ " + item.rating));
        card.appendChild(el("span", "card-title", item.name));
        card.onfocus = function () {
          S.zone = "cards";
          S.cards[kind] = i;
          remember(card.id);
          updateBrowseHero(item, kind);
          scrollToElement(card);
        };
        cards.appendChild(card);
      });
      main.appendChild(cards);
      var footer = el("div", "browse-footer");
      footer.appendChild(
        el("span", "", "OK Details  ·  ↑ Categories  ·  Back Tabs")
      );
      footer.appendChild(
        el("span", "", S.cards[kind] + 1 + " / " + items.length + " titles")
      );
      main.appendChild(footer);
    }
    updateBrowseHero(items[S.cards[kind]], kind);
    if (S.zone === "nav") focus("tab-" + S.nav);
    else if (S.zone === "categories")
      focus(
        S.focusId && document.getElementById(S.focusId)
          ? S.focusId
          : "browse-cat-0"
      );
    else focus(items.length ? "card-" + S.cards[kind] : "empty-action");
  }
  function updateBrowseHero(item, kind) {
    var hero = document.getElementById("browse-hero");
    if (!hero) return;
    hero.textContent = "";
    hero.appendChild(
      el("div", "eyebrow", kind === "movies" ? "Movies" : "Series")
    );
    hero.appendChild(
      el("h1", "", item ? item.name : "Your next favorite is here")
    );
    if (item) {
      hero.appendChild(
        el(
          "div",
          "metadata muted",
          [item.year, item.rating ? "★ " + item.rating : ""]
            .filter(Boolean)
            .join("  ·  ")
        )
      );
      if (item.image) hero.appendChild(image(item.image, "backdrop"));
    }
    hero.appendChild(
      el(
        "p",
        "description",
        (item && item.plot) ||
          "Choose a title for details and playback. Your place is saved when you return."
      )
    );
  }
  function openDetail(item, kind) {
    var origin =
      S.detail && S.detail.item.id === item.id
        ? S.detail.origin
        : { tab: S.tab, zone: S.zone, focus: S.focusId };
    S.detail = { item: item, kind: kind, origin: origin };
    S.detailInfo = null;
    S.season = 0;
    S.zone = "detail";
    renderNav();
    renderDetail();
    var generation = S.sourceGeneration,
      result =
        kind === "series" ? client.seriesInfo(item) : client.movieInfo(item);
    result.then(
      function (info) {
        if (
          generation === S.sourceGeneration &&
          S.detail &&
          S.detail.item.id === item.id
        ) {
          S.detailInfo = info;
          if (!S.fullscreen && !S.dialog) renderDetail();
        }
      },
      function () {
        if (
          generation === S.sourceGeneration &&
          S.detail &&
          S.detail.item.id === item.id
        ) {
          S.detailInfo = { error: true };
          if (!S.fullscreen && !S.dialog) renderDetail();
        }
      }
    );
  }
  function renderDetail() {
    main.textContent = "";
    var detail = S.detail,
      item = detail.item,
      info = S.detailInfo,
      layout = el("section", "detail-layout");
    layout.appendChild(image(item.image, "detail-poster"));
    var copy = el("div", "detail-copy");
    copy.appendChild(
      el("div", "eyebrow", detail.kind === "movies" ? "Movie" : "Series")
    );
    copy.appendChild(el("h1", "", item.name));
    copy.appendChild(
      el(
        "p",
        "muted",
        [item.year, item.rating ? "★ " + item.rating : ""]
          .filter(Boolean)
          .join("  ·  ")
      )
    );
    copy.appendChild(
      el(
        "p",
        "description",
        (info && info.plot) || item.plot || "Details provided by your playlist."
      )
    );
    copy.appendChild(
      button(
        detail.origin && detail.origin.tab === 3
          ? "← Back to search"
          : "← Back to titles",
        "detail-back",
        backDetail
      )
    );
    if (detail.kind === "movies") {
      var recent = store.recents().filter(function (r) {
        return r.id === item.id;
      })[0];
      copy.appendChild(
        button(
          recent ? "Resume movie" : "Play movie",
          "detail-play",
          function () {
            playVod(item, (recent && recent.position) || 0);
          }
        )
      );
      if (recent)
        copy.appendChild(
          button("Start over", "detail-restart", function () {
            playVod(item, 0);
          })
        );
    } else if (!info)
      copy.appendChild(el("div", "loading", "Loading episodes…"));
    else if (info.error)
      copy.appendChild(
        button("Retry episodes", "detail-retry", function () {
          openDetail(item, "series");
        })
      );
    else {
      var seasons = info.seasons || [];
      if (seasons.length) {
        var seasonRow = el("div", "chip-row");
        seasons.forEach(function (season, i) {
          var b = button(
            "Season " + season.number,
            "season-" + i,
            function () {
              S.season = i;
              detail.lastEpisodeFocus = null;
              renderDetail();
            },
            S.season === i ? "active" : ""
          );
          seasonRow.appendChild(b);
        });
        copy.appendChild(seasonRow);
        var episodes = el("div", "episodes");
        ((seasons[S.season] && seasons[S.season].episodes) || []).forEach(
          function (episode, i) {
            var resume = store.recents().filter(function (r) {
              return r.id === episode.id;
            })[0];
            var b = button(
              "",
              "episode-" + i,
              function () {
                detail.lastEpisodeFocus = "episode-" + i;
                playVod(episode, (resume && resume.position) || 0);
              },
              "episode"
            );
            b.appendChild(
              el("span", "", "E" + episode.episode + "  " + episode.name)
            );
            var duration = episode.duration
              ? Math.max(1, Math.round(Number(episode.duration) / 60)) + " min"
              : "";
            if (resume || duration)
              b.appendChild(
                el("small", "", (resume ? "Resume · " : "") + duration)
              );
            episodes.appendChild(b);
          }
        );
        copy.appendChild(episodes);
      } else
        copy.appendChild(
          el("p", "muted", "No episodes are available for this series.")
        );
    }
    layout.appendChild(copy);
    main.appendChild(layout);
    focus(
      detail.kind === "movies"
        ? "detail-play"
        : detail.lastEpisodeFocus &&
            document.getElementById(detail.lastEpisodeFocus)
          ? detail.lastEpisodeFocus
          : document.getElementById("episode-0")
            ? "episode-0"
            : "detail-back"
    );
  }
  function backDetail() {
    var origin = S.detail && S.detail.origin;
    S.detail = null;
    S.detailInfo = null;
    S.tab = origin ? origin.tab : S.tab;
    S.nav = S.tab;
    S.zone = origin ? origin.zone : "cards";
    S.focusId = origin ? origin.focus : null;
    render();
  }
  function playVod(item, position) {
    if (dualActive) stopDual();
    currentPlayItem = item;
    S.watched = null;
    player.setRect(FULL_RECT);
    player.play({
      url: item.url,
      backups: item.backups || [],
      live: false,
      startPosition: position || 0,
      title: item.name,
      id: item.id,
    });
    enterFullscreen();
  }
  function enterFullscreen() {
    S.fullscreen = true;
    S.controls = true;
    S.zone = "video";
    S.focusId = null;
    // The page behind the player is hidden; nothing there may keep DOM focus.
    if (
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement.blur
    )
      document.activeElement.blur();
    applyTheme();
    overlay.className = "";
    player.setRect(FULL_RECT);
    if (
      player.state &&
      (player.state.status === "paused" || player.state.status === "error")
    )
      player.resume();
    renderPlayerOverlay();
    scheduleHideControls();
  }
  // Returns to where playback was opened: the detail page (VOD), the Search result, the guide's
  // preview, or the guide row of the channel being watched. The guide always shows that channel's row,
  // switching to All channels when it is outside the chosen category (e.g. tuned by number).
  function leaveFullscreen() {
    clearTimeout(surfTimer);
    surfTimer = null;
    surfTarget = null;
    var o = S.playOrigin;
    S.playOrigin = null;
    S.fullscreen = false;
    if (S.detail) {
      S.zone = "detail";
      S.focusId = null;
    } else if (o && o.tab !== 0) {
      S.tab = S.nav = o.tab;
      S.zone = o.zone;
      S.focusId = o.focus;
      if (o.tab === 3 || o.tab === 4) S.pageFocus[o.tab] = o.focus;
    } else {
      if (o && S.tab === 0) {
        S.zone = o.zone;
        S.focusId = o.focus;
      } else enterGrid();
      syncGuideRow(S.watched, true);
    }
    applyTheme();
    overlay.className = "hidden";
    clearTimeout(overlayTimer);
    overlayTimer = null;
    showSubtitleText("", 0);
    if (player.state && player.state.request && !player.state.request.live) {
      saveRecent();
      player.stop();
    } else if (S.tab === 0) {
      player.setRect({ left: 1398, top: 145, width: 466, height: 263 });
    } else hidePreview();
    render();
  }
  function onPlayerState(state) {
    applyTheme();
    if (S.fullscreen) {
      renderPlayerOverlay();
      if (S.controls && !overlayTimer) scheduleHideControls();
    } else if (S.tab === 0 && S.watched)
      setPreviewHint(
        !!document.activeElement && document.activeElement.id === "preview-frame"
      );
  }
  function onPlayerTime(position, duration) {
    var fill = document.getElementById("play-progress"),
      time = document.getElementById("play-time");
    if (fill)
      fill.style.width =
        (duration > 0 ? Math.min(100, (position / duration) * 100) : 0) + "%";
    if (time) time.textContent = elapsed(position) + " / " + elapsed(duration);
    if (Date.now() - savedRecentAt > 10000) saveRecent();
  }
  function saveRecent() {
    if (
      currentPlayItem &&
      player.state &&
      player.state.request &&
      !player.state.request.live &&
      player.state.duration > 0
    ) {
      store.saveRecent(
        currentPlayItem,
        player.state.position,
        player.state.duration
      );
      savedRecentAt = Date.now();
    }
  }
  function onPlayerEnded() {
    if (S.fullscreen) {
      S.controls = true;
      renderPlayerOverlay();
    }
    saveRecent();
  }
  function playerIsLive() {
    return !!(player.state && player.state.request && player.state.request.live);
  }
  // Hint for the state the next key acts on: INFO (banner only), CONTROLS (a bar button focused) or error.
  function playerHint() {
    var state = player.state || {},
      live = playerIsLive(),
      origin = S.playOrigin && S.playOrigin.tab === 3 ? "Search" : "Guide",
      a = document.activeElement && document.activeElement.id;
    if (live && surfTarget)
      return (
        "OK Watch now  ·  ↑ ↓ Channel  ·  Back " +
        (S.zone === "player-actions" ? "Hide controls" : origin)
      );
    if (state.status === "error")
      return live
        ? "OK Retry  ·  ↑ ↓ Other channel  ·  Back " + origin
        : "OK Retry  ·  Back Details";
    if (S.zone === "player-actions") {
      if (live)
        return "← → Choose  ·  OK Select  ·  ↑ ↓ Channel  ·  Back Hide controls";
      return a === "play-seek"
        ? "← → Seek 10 seconds  ·  ↓ Buttons  ·  Back Hide controls"
        : "← → Choose  ·  ↑ Seek  ·  OK Select  ·  Back Hide controls";
    }
    return live
      ? "OK Controls  ·  ↑ ↓ Channel  ·  0–9 Number  ·  Yellow Subtitles  ·  Back " +
          origin
      : (state.status === "paused" ? "OK Play" : "OK Pause") +
          "  ·  ← → Seek 10 seconds  ·  Yellow Subtitles  ·  Back Details";
  }
  function refreshPlayerHint() {
    var n = document.getElementById("player-hint");
    if (n) n.textContent = playerHint();
  }
  function surfListName() {
    return surfList() === S.catalogs.live ? "All channels" : categoryName();
  }
  // Live banner: number and name, the programme on now, and the list Up/Down and CH step through.
  function playerBanner(state) {
    var top = el("div", "player-top"),
      c = surfTarget || S.watched,
      p;
    if (!playerIsLive() || !c) {
      top.appendChild(
        el("div", "banner-title", (state.request && state.request.title) || "Tuner")
      );
      return top;
    }
    top.appendChild(
      el("div", "banner-title", (c.number ? c.number + "  " : "") + c.name)
    );
    if (!S.guide[c.id]) requestGuide(c);
    p = programAt(c, Date.now());
    top.appendChild(
      el(
        "div",
        "banner-program",
        realProgram(p)
          ? p.title + "  ·  " + clock(p.start) + " – " + clock(p.end)
          : p && p.gap
            ? "No information"
            : "Schedule unavailable"
      )
    );
    top.appendChild(el("div", "banner-list", surfListName()));
    if (surfTarget) top.appendChild(el("div", "banner-surf", "OK Watch now"));
    return top;
  }
  function renderPlayerOverlay() {
    if (!S.fullscreen) return;
    var state = player.state || {},
      live = playerIsLive(),
      error = state.status === "error",
      old = S.focusId;
    // A failed stream always shows the controls with Retry focused.
    if (error && !S.dialog && S.zone !== "player-actions") {
      S.zone = "player-actions";
      S.focusId = old = "play-toggle";
      S.controls = true;
    }
    var bar = S.zone === "player-actions";
    overlay.textContent = "";
    if (subtitleLayer.className.indexOf("hidden") < 0)
      subtitleLayer.className = "subtitle-layer" + (S.controls ? " raised" : "");
    if (S.controls || bar) {
      overlay.appendChild(playerBanner(state));
      var bottom = el("div", "player-bottom");
      if (!live) {
        var time = el(
          "span",
          "time-text",
          elapsed(state.position || 0) + " / " + elapsed(state.duration || 0)
        );
        time.id = "play-time";
        bottom.appendChild(time);
        var track = el("div", "progress-track focusable"),
          fill = el("div", "progress-fill");
        track.id = "play-seek";
        track.tabIndex = 0;
        track.setAttribute("role", "slider");
        track.onclick = function () {
          player.toggle();
        };
        track.onfocus = function () {
          remember(track.id);
          refreshPlayerHint();
        };
        fill.id = "play-progress";
        fill.style.width =
          (state.duration ? (state.position / state.duration) * 100 : 0) + "%";
        track.appendChild(fill);
        bottom.appendChild(track);
      }
      if (bar) {
        var actions = el("div", "player-actions");
        actions.appendChild(
          button(
            error ? "↻ Retry" : state.status === "paused" ? "▶ Play" : "Ⅱ Pause",
            "play-toggle",
            function () {
              var now = player.state || {};
              if (now.status === "error") {
                if (now.request) player.play(now.request);
              } else player.toggle();
            }
          )
        );
        if (live && S.watched)
          actions.appendChild(
            button(
              store.isFavourite(S.watched.id) ? "★ Saved" : "☆ Favorite",
              "play-fav",
              function () {
                toggleFavorite(S.watched);
              }
            )
          );
        actions.appendChild(
          button("CC Subtitles", "play-subtitles", subtitleDialog)
        );
        actions.appendChild(button("Audio", "play-tracks", audioDialog));
        actions.appendChild(
          button("Back", "play-back", function () {
            leaveFullscreen();
          })
        );
        bottom.appendChild(actions);
      }
      var hint = el("div", "player-hint", "");
      hint.id = "player-hint";
      bottom.appendChild(hint);
      overlay.appendChild(bottom);
      if (bar && !S.dialog)
        focus(document.getElementById(old) ? old : "play-toggle");
      hint.textContent = playerHint();
    }
    if (state.status === "loading" || error) {
      var status = el("div", "player-status");
      status.appendChild(
        el("h2", "", error ? "Playback unavailable" : "Connecting…")
      );
      status.appendChild(
        el(
          "p",
          "muted",
          error
            ? state.error || "Try another stream or retry."
            : "Preparing the stream on your TV"
        )
      );
      overlay.appendChild(status);
    }
  }
  // Reveals the player bar with one of its buttons focused.
  function showPlayerControls(id) {
    S.controls = true;
    S.zone = "player-actions";
    S.focusId = id || "play-toggle";
    renderPlayerOverlay();
    focus(S.focusId);
    refreshPlayerHint();
  }
  function playerArrow(code) {
    var live = playerIsLive(),
      bar = ["play-toggle", "play-fav", "play-subtitles", "play-tracks", "play-back"],
      a = document.activeElement && document.activeElement.id;
    if (live) {
      // Up/Down change channel in every state, like the guide list: Down is the next (higher) channel.
      if (code === 38 || code === 40) changeChannel(code === 40 ? 1 : -1);
      else if (S.zone === "player-actions") {
        moveInRows([bar], code);
        refreshPlayerHint();
      } else showPlayerControls("play-toggle");
      return;
    }
    if (S.zone === "player-actions") {
      if (a === "play-seek" && (code === 37 || code === 39)) {
        player.seek(code === 37 ? -10000 : 10000);
        return;
      }
      moveInRows([["play-seek"], bar], code);
      refreshPlayerHint();
      return;
    }
    if (code === 37 || code === 39) {
      player.seek(code === 37 ? -10000 : 10000);
      S.controls = true;
      renderPlayerOverlay();
      return;
    }
    showPlayerControls("play-toggle");
  }
  // One timer hides the playback controls 5 seconds after the last remote key or state change.
  // It re-arms itself while a dialog is open, playback is paused or failed, so it can never be lost.
  function scheduleHideControls() {
    clearTimeout(overlayTimer);
    overlayTimer = null;
    if (!S.fullscreen) return;
    overlayTimer = setTimeout(hideControlsWhenIdle, 5000);
  }
  function hideControlsWhenIdle() {
    overlayTimer = null;
    if (!S.fullscreen || !S.controls) return;
    var status = player.state && player.state.status;
    if (S.dialog || status === "paused" || status === "error") {
      scheduleHideControls();
      return;
    }
    S.controls = false;
    S.zone = "video";
    renderPlayerOverlay();
  }
  function showSubtitleText(text, duration) {
    clearTimeout(subtitleTimer);
    var clean = String(text || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/^\s+|\s+$/g, "");
    subtitleLayer.textContent = "";
    if (!clean || !S.fullscreen) {
      subtitleLayer.className = "subtitle-layer hidden";
      return;
    }
    subtitleLayer.appendChild(el("span", "", clean));
    subtitleLayer.className = "subtitle-layer" + (S.controls ? " raised" : "");
    subtitleTimer = setTimeout(function () {
      subtitleLayer.className = "subtitle-layer hidden";
      subtitleLayer.textContent = "";
    }, duration > 0 ? Math.min(duration, 15000) + 200 : 8000);
  }
  function trackName(track, fallback) {
    return track.label || track.language || track.name || fallback + " " + (track.index + 1);
  }
  function subtitleDialog() {
    var tracks = player.tracks().subtitles || [],
      on = !!(player.subtitlesShowing && player.subtitlesShowing()),
      selected = 0;
    if (!tracks.length) {
      showDialog("Subtitles", "No subtitles in this stream.", []);
      return;
    }
    var actions = [
      {
        text: (on ? "" : "✓ ") + "Off",
        run: function () {
          player.selectTrack("TEXT", -1);
          closeDialog();
          toast("Subtitles off");
        },
      },
    ];
    tracks.forEach(function (track, i) {
      var name = trackName(track, "Subtitles");
      if (on && track.selected) selected = i + 1;
      actions.push({
        text: (on && track.selected ? "✓ " : "") + name,
        run: function () {
          player.selectTrack("TEXT", track.index);
          closeDialog();
          toast("Subtitles: " + name);
        },
      });
    });
    showDialog(
      "Subtitles",
      "Choose subtitles or captions for this stream.",
      actions,
      { list: true, focus: selected }
    );
  }
  function audioDialog() {
    var tracks = player.tracks().audio || [],
      actions = [],
      selected = 0;
    tracks.forEach(function (track, i) {
      var name = trackName(track, "Audio");
      if (track.selected) selected = i;
      actions.push({
        text: (track.selected ? "✓ " : "") + name,
        run: function () {
          player.selectTrack("AUDIO", track.index);
          closeDialog();
        },
      });
    });
    showDialog(
      "Audio",
      tracks.length > 1
        ? "Choose an audio track. All available languages are allowed."
        : "This stream does not offer other audio tracks.",
      tracks.length > 1 ? actions : [],
      { list: true, focus: selected }
    );
  }
  // opts.list: a vertical list (Up/Down); otherwise a button row (Left/Right). opts.focus: first focused
  // action; opts.closeText / opts.focusClose: the close button's label and whether it starts focused.
  function showDialog(title, text, actions, opts) {
    opts = opts || {};
    actions = actions || [];
    if (!S.dialog) dialogReturn = { id: S.focusId, zone: S.zone };
    S.dialog = true;
    dialogLayer.className = "";
    dialogLayer.textContent = "";
    var box = el("div", opts.list ? "dialog choices" : "dialog");
    box.appendChild(el("h2", "", title));
    box.appendChild(el("p", "", text));
    actions.forEach(function (action, i) {
      box.appendChild(
        button(action.text, "dialog-" + i, function () {
          action.run();
        })
      );
    });
    box.appendChild(
      button(opts.closeText || "Close", "dialog-close", function () {
        closeDialog();
      })
    );
    dialogLayer.appendChild(box);
    focus(
      opts.focusClose || !actions.length
        ? "dialog-close"
        : "dialog-" + Math.max(0, Math.min(actions.length - 1, opts.focus || 0))
    );
  }
  // Closes the dialog and, unless restore is false, puts focus back on the control that opened it.
  function closeDialog(restore) {
    var ret =
      pin && pin.returnFocus ? { id: pin.returnFocus, zone: S.zone } : dialogReturn;
    dialogReturn = null;
    if (pin) {
      clearTimeout(pin.timer);
      pin = null;
    }
    S.dialog = false;
    dialogLayer.className = "hidden";
    dialogLayer.textContent = "";
    if (restore !== false) {
      if (ret) {
        S.zone = ret.zone;
        S.focusId = ret.id;
      }
      if (S.fullscreen) {
        S.controls = true;
        if (S.zone !== "player-actions") S.zone = "video";
        renderPlayerOverlay();
        scheduleHideControls();
      } else {
        render();
        if (ret && ret.id && S.zone !== "grid" && S.zone !== "nav") focus(ret.id);
      }
    }
    if (dualActive && S.tab === 5) scheduleDualControls();
  }
  // Dialog arrows: list dialogs move with Up/Down, button rows with Left/Right; nothing wraps.
  function dialogArrow(code) {
    var box = dialogLayer.querySelector(".dialog"),
      ids = focusables(dialogLayer).map(function (n) {
        return n.id;
      });
    if (box && /\bchoices\b/.test(box.className)) {
      if (code === 38 || code === 40)
        moveInRows(
          ids.map(function (id) {
            return [id];
          }),
          code
        );
    } else if (code === 37 || code === 39) moveInRows([ids], code);
  }
  // CH+/CH- in the Multi View channel list jumps eight channels.
  function pickerPage(d) {
    var a = document.activeElement,
      list =
        a && a.parentNode && /picker-list/.test(a.parentNode.className)
          ? focusables(a.parentNode)
          : null,
      i;
    if (!list || !list.length) return;
    i = list.indexOf(a);
    focus(list[Math.max(0, Math.min(list.length - 1, i + d))].id);
  }
  function renderSearch() {
    main.textContent = "";
    main.appendChild(el("h1", "page-title", "Find something to watch"));
    var input = el("input", "search-bar");
    input.id = "search-input";
    input.type = "search";
    input.placeholder = "Press OK to type a channel, movie or series";
    input.value = S.query;
    input.oninput = function () {
      S.query = input.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderSearchResults, 180);
    };
    makeTextField(input);
    main.appendChild(input);
    main.appendChild(
      el("p", "muted search-hint", "OK Type  ·  ↓ Results  ·  Back Tabs")
    );
    var results = el("div", "search-results");
    results.id = "search-results";
    main.appendChild(results);
    renderSearchResults();
    if (S.zone === "nav") focus("tab-" + S.nav);
    else focus(S.pageFocus[3]) || focus("search-input");
  }
  function renderSearchResults() {
    var results = document.getElementById("search-results");
    if (!results) return;
    var active = document.activeElement;
    var previous =
      active && results.contains(active)
        ? { key: active.getAttribute("data-result-key"), id: active.id }
        : null;
    var restored = null;
    results.textContent = "";
    var q = S.query.toLowerCase().trim();
    if (!q) {
      results.appendChild(el("p", "muted", "Enter a title or channel name."));
      return;
    }
    var found = [];
    ["live", "movies", "series"].forEach(function (kind) {
      S.catalogs[kind].some(function (item) {
        if (item.name.toLowerCase().indexOf(q) >= 0)
          found.push({ item: item, kind: kind });
        return found.length >= 60;
      });
    });
    found.slice(0, 60).forEach(function (entry, i) {
      var b = button(
        "",
        "result-" + i,
        function () {
          if (entry.kind === "live") watch(entry.item, true);
          else {
            openDetail(entry.item, entry.kind);
          }
        },
        "search-result"
      );
      var key = entry.kind + ":" + entry.item.id;
      b.setAttribute("data-result-key", key);
      if (previous && previous.key === key) restored = b;
      b.appendChild(image(entry.item.image));
      var text = el("span", "", entry.item.name);
      text.appendChild(
        el(
          "small",
          "",
          entry.kind === "live"
            ? "Live TV"
            : entry.kind === "movies"
              ? "Movie"
              : "Series"
        )
      );
      b.appendChild(text);
      if (entry.kind === "live" && store.isFavourite(entry.item.id))
        b.appendChild(el("span", "star", "★"));
      results.appendChild(b);
    });
    if (!found.length)
      results.appendChild(
        el("p", "muted", "No matching titles. Try a shorter name.")
      );
    if (previous)
      focus(
        restored
          ? restored.id
          : document.getElementById(previous.id)
            ? previous.id
            : found.length
              ? "result-0"
              : "search-input"
      );
  }
  function field(label, id, value, type) {
    var wrap = el("div", "field");
    var l = el("label", "", label);
    l.htmlFor = id;
    var input = el("input");
    input.id = id;
    input.type = type || "text";
    input.value = value || "";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.oninput = function () {
      sourceDraft[id] = input.value;
    };
    makeTextField(input);
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }
  // Text fields are focusable but read-only until OK, so arrows and Back always work on them and the
  // TV keyboard opens only on request. While editing, Done/Enter, Cancel, Back or Up/Down end it.
  function makeTextField(input) {
    input.readOnly = true;
    input.onfocus = function () {
      remember(input.id);
    };
    input.onblur = function () {
      if (!input.readOnly) stopEditing(input, "blur");
    };
    input.onclick = function () {
      if (input.readOnly) startEditing(input, true);
    };
    return input;
  }
  function startEditing(f, reopen) {
    // Blur first so onblur cannot reset readOnly; focusing the editable field opens the TV keyboard.
    if (reopen) f.blur();
    f.readOnly = false;
    f.className = f.className.replace(/\s*\bediting\b/g, "") + " editing";
    if (reopen) f.focus();
    try {
      f.setSelectionRange(f.value.length, f.value.length);
    } catch (e) {}
  }
  function stopEditing(f, how) {
    var nodes, i;
    f.readOnly = true;
    f.className = f.className.replace(/\s*\bediting\b/g, "");
    if (how !== "done") return;
    if (f.id === "search-input") focus("result-0");
    else if (f.id === "dual-channel-query") focus("dual-result-0");
    else {
      nodes = focusables(document.getElementById("source-form") || main);
      i = nodes.indexOf(f);
      if (i >= 0 && nodes[i + 1]) focus(nodes[i + 1].id);
    }
  }
  function renderSettings() {
    main.textContent = "";
    main.appendChild(
      el(
        "h1",
        "page-title",
        store.settings.source ? "Settings" : "Welcome to Tuner"
      )
    );
    if (window.TunerPairing) {
      var pairRow = el("div", "pair-entry");
      pairRow.appendChild(
        el(
          "p",
          "",
          store.settings.source
            ? "Switching lines? Pair with your phone instead of typing."
            : "LumaNest TV customer? Scan a code with your phone and this TV sets itself up. No typing."
        )
      );
      pairRow.appendChild(button("Pair with your phone", "pair-phone", openPairing, "primary-button"));
    }
    var grid = el("div", "settings-grid"),
      form = el("form", "settings-main");
    form.id = "source-form";
    form.noValidate = true;
    var source = store.settings.source || {},
      mode = el("div", "field"),
      modeLabel = el("label", "", "Playlist type");
    // A button that switches the type on OK: arrows always move focus, never change the choice.
    var typeButton = button(
      "",
      "source-type",
      function () {
        var had = document.activeElement === typeButton;
        sourceDraft.type = currentSourceType() === "xtream" ? "m3u" : "xtream";
        setTypeButton();
        renderFields();
        if (had) focus("source-type");
      },
      "field-toggle"
    );
    function setTypeButton() {
      var type = currentSourceType();
      typeButton.value = type;
      typeButton.textContent = "";
      typeButton.appendChild(
        el("span", "", type === "xtream" ? "Xtream Codes" : "M3U playlist")
      );
      typeButton.appendChild(el("small", "", "OK to switch"));
    }
    setTypeButton();
    modeLabel.htmlFor = "source-type";
    mode.appendChild(modeLabel);
    mode.appendChild(typeButton);
    form.appendChild(mode);
    var fields = el("div");
    fields.id = "source-fields";
    form.appendChild(fields);
    function draft(id, saved) {
      return sourceDraft[id] !== undefined ? sourceDraft[id] : saved;
    }
    function renderFields() {
      fields.textContent = "";
      if (currentSourceType() === "xtream") {
        fields.appendChild(
          field("Server URL", "source-server", draft("source-server", source.server), "url")
        );
        var row = el("div", "field-row");
        row.appendChild(
          field("Username", "source-user", draft("source-user", source.username))
        );
        row.appendChild(
          field(
            "Password",
            "source-password",
            draft("source-password", source.password),
            "password"
          )
        );
        fields.appendChild(row);
      } else {
        fields.appendChild(
          field("Playlist URL", "source-m3u", draft("source-m3u", source.m3uUrl), "url")
        );
        fields.appendChild(
          field(
            "Guide URL (optional)",
            "source-epg",
            draft("source-epg", source.epgUrl),
            "url"
          )
        );
      }
    }
    renderFields();
    var actions = el("div", "settings-actions");
    var save = button("Save and connect", "save-source", saveSource);
    save.type = "submit";
    save.onclick = null;
    actions.appendChild(save);
    if (store.settings.source)
      actions.appendChild(button("Refresh", "refresh-source", function () { connect(true); }));
    form.appendChild(actions);
    form.onsubmit = function (e) {
      e.preventDefault();
      saveSource();
    };
    var extras = el("div", "settings-extras");
    extras.appendChild(el("h2", "", "Playback and privacy"));
    var extraRow = el("div", "settings-extra-row");
    extraRow.appendChild(
      button(
        "Subtitles: " + (store.settings.subtitles ? "On" : "Off"),
        "subtitles-setting",
        function () {
          store.saveSettings({ subtitles: !store.settings.subtitles });
          renderSettings();
          focus("subtitles-setting");
          toast(
            store.settings.subtitles
              ? "Subtitles start automatically when a stream has them."
              : "Subtitles are off. Turn them on while watching with CC Subtitles."
          );
        },
        "extra-button"
      )
    );
    extraRow.appendChild(
      button(
        "Adult content: " + (adultUnlocked ? "Unlocked" : "Locked"),
        "adult-setting",
        toggleAdult,
        "extra-button"
      )
    );
    if (store.adultLock && store.adultLock.hasPasscode())
      extraRow.appendChild(
        button(
          "Change passcode",
          "adult-passcode",
          function () {
            openPasscode("change");
          },
          "extra-button"
        )
      );
    extras.appendChild(extraRow);
    form.appendChild(extras);
    grid.appendChild(form);
    var side = el("aside", "settings-side");
    side.appendChild(el("h2", "", "Your local lineup"));
    side.appendChild(
      el(
        "p",
        "",
        "Keep cable and sports. Limit local stations to Boston, Worcester and nearby New Hampshire."
      )
    );
    side.appendChild(
      button(
        store.settings.zip
          ? "ZIP 01608 · Nearby local stations"
          : "All U.S. local stations",
        "local-setting",
        function () {
          store.saveSettings({ zip: store.settings.zip ? "" : "01608" });
          connect();
          renderSettings();
        },
        "local-button"
      )
    );
    side.appendChild(
      button(
        store.settings.usOnly ? "Channels: USA only" : "Channels: All",
        "lineup-setting",
        function () {
          store.saveSettings({ usOnly: !store.settings.usOnly });
          connect();
          renderSettings();
          focus("lineup-setting");
          toast(store.settings.usOnly ? "Showing USA channels only." : "Showing all channels on your line.");
        },
        "local-button"
      )
    );
    side.appendChild(
      button(
        "Category order: " +
          (store.settings.categoryOrder === "provider"
            ? "Customer hub"
            : store.settings.categoryOrder === "az"
            ? "A to Z"
            : "Featured"),
        "category-order-setting",
        function () {
          var order = store.settings.categoryOrder;
          store.saveSettings({
            categoryOrder: order === "provider" ? "az" : order === "az" ? "featured" : "provider",
          });
          renderSettings();
          focus("category-order-setting");
        },
        "local-button"
      )
    );
    side.appendChild(
      button(
        "Theme: " +
          (store.settings.theme === "black" ? "Black" : "LumaNest"),
        "theme-setting",
        function () {
          store.saveSettings({
            theme: store.settings.theme === "black" ? "midnight" : "black",
          });
          render();
        },
        "local-button"
      )
    );
    side.appendChild(el("h2", "", "Samsung remote"));
    side.appendChild(
      el(
        "p",
        "",
        "Arrows move. OK selects; on a text field OK opens the keyboard. Back goes up one level. In the guide: Hold OK saves a Favorite, ← → browse the schedule, Channel +/− pages, number keys jump to a channel."
      )
    );
    side.appendChild(
      button("About Tuner", "about-tuner", function () {
        showDialog(
          "Tuner for Samsung TV",
          "Version 1.4.13 · Samsung TV\nLive TV, guide, movies, series and Favorites. Two-channel PiP works on supported TVs and playlists. Embedded torrent playback is not available on Samsung.",
          []
        );
      })
    );
    grid.appendChild(side);
    // The pairing row heads the form column, so the side panel lines up with it.
    if (pairRow) form.insertBefore(pairRow, form.firstChild);
    main.appendChild(grid);
    if (S.zone === "nav") focus("tab-" + S.nav);
    else
      focus(S.pageFocus[4]) ||
        focus(!store.settings.source && window.TunerPairing ? "pair-phone" : "source-type");
  }
  function currentSourceType() {
    return (
      sourceDraft.type ||
      (store.settings.source && store.settings.source.type) ||
      "xtream"
    );
  }
  function openPairing() {
    window.TunerPairing.open({
      device: "samsung",
      onSource: function (source) {
        if (!store.saveSettings({ source: source }))
          return toast(store.lastError || "The playlist could not be saved.");
        sourceDraft = {};
        connect();
        openTab(0);
        toast("Paired with LumaNest TV. Loading your channels.");
      },
      onClose: function () { focus("pair-phone"); }
    });
  }
  function saveSource() {
    var type = currentSourceType(),
      source = { type: type, name: "My playlist" };
    if (type === "xtream") {
      source.server = document
        .getElementById("source-server")
        .value.trim()
        .replace(/\/+$/, "");
      source.username = document.getElementById("source-user").value.trim();
      source.password = document.getElementById("source-password").value;
      if (
        !/^https?:\/\//i.test(source.server) ||
        !source.username ||
        !source.password
      )
        return toast("Enter the server URL, username and password.");
    } else {
      source.m3uUrl = document.getElementById("source-m3u").value.trim();
      source.epgUrl = document.getElementById("source-epg").value.trim();
      if (source.epgUrl && !/^https?:\/\//i.test(source.epgUrl))
        return toast("Use an HTTP or HTTPS guide URL.");
      if (!/^https?:\/\//i.test(source.m3uUrl))
        return toast("Enter an HTTP or HTTPS playlist URL.");
    }
    if (!store.saveSettings({ source: source }))
      return toast(store.lastError || "The playlist could not be saved.");
    sourceDraft = {};
    connect();
    openTab(0);
    toast("Playlist saved. Loading your channels.");
  }
  function applyAdultFilter(kind) {
    var source = rawCatalogs[kind],
      shown =
        adultUnlocked || !D.adultFilter
          ? source
          : D.adultFilter(source.items, source.categories);
    S.catalogs[kind] = shown.items;
    S.cats[kind] = shown.categories;
  }
  function setAdultUnlocked(value) {
    adultUnlocked = !!value;
    ["live", "movies", "series"].forEach(applyAdultFilter);
    if (adultUnlocked) return;
    // Nothing that is now hidden may stay selected, saved for the guide preview or playing.
    var request = player.state && player.state.request;
    if (S.watched && S.catalogs.live.indexOf(S.watched) < 0) S.watched = null;
    if (
      request &&
      request.live &&
      !S.catalogs.live.some(function (c) {
        return c.id === request.id;
      })
    )
      player.stop();
    if (
      !liveCategories().some(function (cat) {
        return cat.id === S.category;
      })
    )
      S.category = "__all";
    ["movies", "series"].forEach(function (kind) {
      if (
        !S.cats[kind].some(function (cat) {
          return cat.id === S.browseCategory[kind];
        })
      )
        S.browseCategory[kind] = "__all";
    });
    S.row = 0;
    S.offset = 0;
    S.cards = { movies: 0, series: 0 };
  }
  function toggleAdult() {
    if (adultUnlocked) {
      setAdultUnlocked(false);
      renderSettings();
      focus("adult-setting");
      toast("Adult content is locked and hidden.");
      return;
    }
    if (!store.adultLock) return;
    openPasscode(store.adultLock.hasPasscode() ? "unlock" : "create", function () {
      setAdultUnlocked(true);
      renderSettings();
      focus("adult-setting");
      toast("Adult content unlocked until you lock it or restart Tuner.");
    });
  }
  // Passcode pad: remote number keys, or the on-screen digits with the arrows and OK.
  var PIN_KEYS = [
    ["1", "2", "3"],
    ["4", "5", "6"],
    ["7", "8", "9"],
    ["del", "0", "cancel"],
  ];
  function openPasscode(mode, onSuccess) {
    pin = {
      mode: mode,
      step: mode === "create" ? "new" : "current",
      digits: "",
      first: "",
      message: "",
      error: false,
      onSuccess: onSuccess,
      returnFocus: S.focusId,
      timer: null,
    };
    renderPasscode();
  }
  function passcodeWait() {
    return pin && pin.step === "current" ? store.adultLock.waitRemaining() : 0;
  }
  function renderPasscode() {
    if (!pin) return;
    clearTimeout(pin.timer);
    var old = S.focusId,
      wait = passcodeWait(),
      title =
        pin.mode === "change"
          ? "Change passcode"
          : pin.mode === "create"
            ? "Create a passcode"
            : "Unlock adult content",
      prompt =
        pin.step === "current"
          ? pin.mode === "change"
            ? "Enter your current 4-digit passcode."
            : "Enter your 4-digit passcode to show adult categories."
          : pin.step === "new"
            ? pin.mode === "change"
              ? "Enter a new 4-digit passcode."
              : "Choose a 4-digit passcode. You need it each time you unlock adult content."
            : "Enter the same passcode again.";
    S.dialog = true;
    dialogLayer.className = "";
    dialogLayer.textContent = "";
    var box = el("div", "dialog passcode-dialog");
    box.appendChild(el("h2", "", title));
    box.appendChild(el("p", "", prompt));
    var dots = el("div", "pin-dots");
    dots.id = "pin-dots";
    for (var i = 0; i < 4; i++)
      dots.appendChild(
        el("span", i < pin.digits.length ? "filled" : "", i < pin.digits.length ? "●" : "○")
      );
    box.appendChild(dots);
    var message = el(
      "p",
      "pin-message" + (pin.error || wait ? " error" : ""),
      wait
        ? "Too many wrong tries. Try again in " + Math.ceil(wait / 1000) + " s."
        : pin.message || "Use the number keys or choose the digits below."
    );
    message.id = "pin-message";
    box.appendChild(message);
    var pad = el("div", "pin-pad");
    PIN_KEYS.forEach(function (row) {
      row.forEach(function (key) {
        var b = button(
          key === "del" ? "⌫ Delete" : key === "cancel" ? "Cancel" : key,
          "pin-" + key,
          function () {
            if (key === "cancel") closeDialog();
            else if (key === "del") {
              if (pin.digits) pin.digits = pin.digits.slice(0, -1);
              renderPasscode();
            } else passcodeDigit(key);
          },
          key === "del" || key === "cancel" ? "pin-key pin-word" : "pin-key"
        );
        b.disabled = !!wait && key !== "cancel";
        pad.appendChild(b);
      });
    });
    box.appendChild(pad);
    box.appendChild(
      el("p", "pin-note", "Forgot the passcode? Remove and reinstall the app, or clear its data.")
    );
    dialogLayer.appendChild(box);
    var target = old && /^pin-/.test(old) ? document.getElementById(old) : null;
    focus(target && !target.disabled ? old : wait ? "pin-cancel" : "pin-1");
    if (wait)
      pin.timer = setTimeout(function () {
        if (pin) renderPasscode();
      }, Math.min(1000, wait));
  }
  function passcodeDigit(digit) {
    if (!pin || passcodeWait() || pin.digits.length >= 4) return;
    pin.digits += digit;
    pin.error = false;
    pin.message = "";
    if (pin.digits.length === 4) submitPasscode();
    else renderPasscode();
  }
  function submitPasscode() {
    var entered = pin.digits;
    pin.digits = "";
    if (pin.step === "current") {
      var result = store.adultLock.verify(entered);
      if (result.ok) {
        if (pin.mode !== "change") return finishPasscode();
        pin.step = "new";
      } else {
        pin.error = true;
        pin.message = result.wait
          ? ""
          : "Wrong passcode. " + result.left + (result.left === 1 ? " try" : " tries") + " left.";
      }
    } else if (pin.step === "new") {
      pin.first = entered;
      pin.step = "confirm";
    } else if (entered === pin.first) {
      if (!store.adultLock.setPasscode(entered)) {
        closeDialog();
        toast("The passcode could not be saved on this TV.");
        return;
      }
      return finishPasscode();
    } else {
      pin.first = "";
      pin.step = "new";
      pin.error = true;
      pin.message = "The passcodes did not match. Choose a passcode again.";
    }
    renderPasscode();
  }
  function finishPasscode() {
    var mode = pin.mode,
      done = pin.onSuccess;
    closeDialog(false);
    if (done) done();
    else if (mode === "change") {
      renderSettings();
      focus("adult-passcode");
      toast("Passcode changed.");
    }
  }
  function passcodeArrow(code) {
    var id = (document.activeElement && document.activeElement.id) || "",
      r = 0,
      c = 0,
      i,
      j;
    for (i = 0; i < PIN_KEYS.length; i++)
      for (j = 0; j < 3; j++)
        if ("pin-" + PIN_KEYS[i][j] === id) {
          r = i;
          c = j;
        }
    for (i = 0; i < 4; i++) {
      if (code === 37) c = (c + 2) % 3;
      else if (code === 39) c = (c + 1) % 3;
      else if (code === 38) r = (r + 3) % 4;
      else r = (r + 1) % 4;
      var n = document.getElementById("pin-" + PIN_KEYS[r][c]);
      if (n && !n.disabled) return focus(n.id);
    }
  }
  function connect(force) {
    if (!store.settings.source) return;
    var sameCatalog = client && client.catalogIdentity === D.catalogIdentity(store.settings.source, { zip: store.settings.zip, usOnly: !!store.settings.usOnly });
    stopDual();
    player.stop();
    S.watched = null;
    S.sourceGeneration++;
    if (client) client.cancel();
    S.category = "__all";
    S.focusAt = null;
    S.viewBase = null;
    S.guidePlaced = false;
    S.playOrigin = null;
    S.detail = null;
    S.detailInfo = null;
    dualChannels = [null, null];
    currentPlayItem = null;
    S.status = {};
    if (!sameCatalog) {
      S.catalogs = { live: [], movies: [], series: [] };
      S.cats = { live: [], movies: [], series: [] };
      rawCatalogs = {
        live: { items: [], categories: [] },
        movies: { items: [], categories: [] },
        series: { items: [], categories: [] },
      };
    }
    S.guide = {};
    S.guidesPending = {};
    S.guideChecked = {};
    S.row = 0;
    S.offset = 0;
    client = D.createClient(store.settings.source, {
      zip: store.settings.zip,
      usOnly: !!store.settings.usOnly,
      onCatalog: function (kind, items, categories) {
        rawCatalogs[kind] = { items: items || [], categories: categories || [] };
        applyAdultFilter(kind);
        if (S.tab === 3 && !S.fullscreen && !S.dialog) renderSearchResults();
        if (kind === "live") resumeGuidePreview();
        if (
          !S.fullscreen &&
          !S.dialog &&
          ((S.tab === 0 && kind === "live") ||
            (S.tab === 1 && kind === "movies") ||
            (S.tab === 2 && kind === "series"))
        )
          render();
      },
      onStatus: function (kind, status) {
        S.status[kind] = status;
        if (
          !S.fullscreen &&
          !S.dialog &&
          ((S.tab === 0 && kind === "live") ||
            (S.tab === 1 && kind === "movies") ||
            (S.tab === 2 && kind === "series"))
        )
          render();
      },
    });
    client.load(force === true);
  }
  // Back goes up exactly one level and lands where the user came from.
  function back() {
    if (entry.digits) {
      clearEntry();
      return;
    }
    if (S.dialog) {
      closeDialog();
      return;
    }
    if (dualActive && S.tab === 5) {
      if (dualControls) hideDualControls();
      else {
        // Back to the setup screen with both channels still chosen.
        stopDual();
        dualFocusId = "dual-start";
        S.zone = "form";
        render();
      }
      return;
    }
    if (S.fullscreen) {
      if (
        S.zone === "player-actions" &&
        !(player.state && player.state.status === "error")
      ) {
        S.zone = "video";
        S.controls = false;
        S.focusId = null;
        renderPlayerOverlay();
      } else leaveFullscreen();
      return;
    }
    if (S.detail) {
      backDetail();
      return;
    }
    if (S.tab === 0 && S.zone !== "nav") {
      if (S.zone === "grid" && S.focusAt !== null) {
        S.focusAt = null;
        S.viewBase = null;
        renderGuide();
      } else if (S.zone === "grid" || S.zone === "empty") toChips();
      else toNav();
      return;
    }
    if (S.zone !== "nav") {
      toNav();
      return;
    }
    if (S.tab !== 0) {
      openTab(0, true);
      return;
    }
    showDialog("Close Tuner?", "Your Favorites and settings are saved.", [
      {
        text: "Exit",
        run: function () {
          player.stop();
          try {
            window.tizen.application.getCurrentApplication().exit();
          } catch (e) {
            closeDialog();
            toast("Use the TV Home button to leave Tuner.");
          }
        },
      },
    ], { closeText: "Cancel", focusClose: true });
  }
  function handleArrow(code) {
    S.guideWaiting = false;
    if (S.dialog) {
      if (pin) passcodeArrow(code);
      else dialogArrow(code);
      return;
    }
    if (dualActive && S.tab === 5) {
      if (!dualControls) showDualControls();
      else {
        if (code === 37 || code === 39)
          moveInRows(
            [["dual-pick-0", "dual-pick-1", "dual-layout", "dual-audio-0", "dual-audio-1", "dual-stop"]],
            code
          );
        scheduleDualControls();
      }
      return;
    }
    if (S.fullscreen) return playerArrow(code);
    if (S.zone === "nav") {
      if (code === 37 || code === 39) {
        S.nav = Math.max(
          0,
          Math.min(tabs.length - 1, S.nav + (code === 37 ? -1 : 1))
        );
        focus("tab-" + S.nav);
      } else if (code === 40) {
        if (S.nav !== S.tab) openTab(S.nav);
        else enterPage();
      }
      return;
    }
    if (S.detail) {
      moveSpatial(main, code);
      return;
    }
    if (S.tab === 0) return guideArrow(code);
    if (S.tab === 1 || S.tab === 2) {
      var kind = browseKind();
      if (S.zone === "cards") {
        if (code === 38) {
          S.zone = "categories";
          focus("browse-cat-0");
        } else if (code === 37 || code === 39) {
          S.cards[kind] = Math.max(
            0,
            Math.min(
              browseItems(kind).length - 1,
              S.cards[kind] + (code === 37 ? -1 : 1)
            )
          );
          renderBrowse();
        }
        return;
      }
      if (code === 40) {
        S.zone = "cards";
        renderBrowse();
      } else if (code === 38) toNav();
      else {
        var parent = document.activeElement && document.activeElement.parentNode;
        if (parent)
          moveInRows(
            [
              focusables(parent).map(function (n) {
                return n.id;
              }),
            ],
            code
          );
      }
      return;
    }
    if (S.tab === 5) {
      if (
        !moveInRows(
          [
            ["dual-pick-0", "dual-pick-1", "dual-layout", "dual-start"],
            ["dual-audio-0", "dual-audio-1"],
          ],
          code
        ) &&
        code === 38
      )
        toNav();
      return;
    }
    if (!moveSpatial(main, code) && code === 38) toNav();
  }
  function stopDual() {
    clearTimeout(dualControlsTimer);
    if (dual) dual.stop();
    dualActive = false;
    dualControls = true;
    dualStates = [{ status: "idle" }, { status: "idle" }];
    if (document.activeElement === main) main.blur();
    applyTheme();
  }
  function scheduleDualControls() {
    clearTimeout(dualControlsTimer);
    if (!dualActive || !dualControls || S.dialog || document.hidden) return;
    dualControlsTimer = setTimeout(function () {
      if (dualActive && S.tab === 5 && !S.dialog) hideDualControls();
    }, 5000);
  }
  function hideDualControls() {
    clearTimeout(dualControlsTimer);
    if (!dualActive || S.dialog) return;
    dualControls = false;
    S.zone = "dual-video";
    renderMultiView();
  }
  function showDualControls() {
    if (!dualActive || S.tab !== 5) return;
    dualControls = true;
    S.zone = "dual-controls";
    renderMultiView();
    scheduleDualControls();
  }
  function dualNeedsMainAudio() {
    return !!(dual && dual.capability && dual.capability.requiresMainAudio);
  }
  function playDualChannel(slot) {
    var c = dualChannels[slot];
    return dual.play(slot, {
      url: c.url,
      backups: c.backups,
      live: true,
      title: c.name,
      id: c.id,
    });
  }
  function playDualChannels() {
    // Finish SUB's synchronous mute/resource setup before MAIN opens with
    // its default audio. Neither stream waits for the other's preparation.
    var first = dual.capability && dual.capability.native ? 1 : 0;
    var firstStarted = playDualChannel(first);
    var secondStarted = playDualChannel(1 - first);
    return firstStarted !== false && secondStarted !== false;
  }
  function promoteDualChannel(slot) {
    if (!dualActive || !dual || dualRestarting || !dualChannels[0] || !dualChannels[1]) return false;
    dualRestarting = true;
    clearTimeout(dualControlsTimer);
    var success = false;
    try {
      // Close both streams before either channel is reopened in its new role.
      // The retained player resets its audio route to the default MAIN surface.
      dual.stop();
      if (slot === 1) dualChannels = [dualChannels[1], dualChannels[0]];
      dualAudio = 0;
      dualStates = [{ status: "loading" }, { status: "loading" }];
      applyDualRects();
      if (!playDualChannels())
        throw new Error("DualRestartFailed");
      success = true;
    } catch (error) {
      stopDual();
      toast("The channels could not restart. Try Watch both again.");
    }
    dualRestarting = false;
    renderMultiView();
    scheduleDualControls();
    return success;
  }
  function selectDualAudio(slot) {
    if (!dualActive || !dual) {
      if (dualNeedsMainAudio() && slot === 1) {
        dualChannels = [dualChannels[1], dualChannels[0]];
        dualAudio = 0;
      } else dualAudio = slot;
      return true;
    }
    if (dualNeedsMainAudio()) {
      if (slot === 0 && dualAudio === 0) return true;
      return promoteDualChannel(slot);
    }
    if (dual.selectAudio(slot) === true) {
      dualAudio = slot;
      return true;
    }
    return dualNeedsMainAudio() ? promoteDualChannel(slot) : false;
  }
  function dualAudioButton(slot) {
    return button(
      dualAudio === slot ? "🔊 Audio " + (slot + 1) : dualNeedsMainAudio() ? "Make main" : "Listen to " + (slot + 1),
      "dual-audio-" + slot,
      function () {
        if (!selectDualAudio(slot)) {
          if (dualActive) toast("Audio could not switch on this TV.");
          return;
        }
        renderMultiView();
        scheduleDualControls();
      },
      dualAudio === slot ? "active" : ""
    );
  }
  function renderMultiView() {
    applyTheme();
    main.textContent = "";
    if (!dualActive) {
      main.appendChild(el("h1", "page-title", "Two games. One screen."));
      main.appendChild(
        el("p", "multiview-subtitle", "Watch two channels together. Choose the channel you want to hear.")
      );
    }
    var controls = el("div", "dual-controls");
    controls.id = "dual-controls";
    [0, 1].forEach(function (slot) {
      controls.appendChild(
        button(
          slot +
            1 +
            ": " +
            (dualChannels[slot] ? dualChannels[slot].name : "Choose a channel"),
          "dual-pick-" + slot,
          function () {
            pickDualChannel(slot);
          },
          "dual-picker"
        )
      );
    });
    controls.appendChild(
      button(
        dualMode === "split" ? "Side by side" : "Picture in Picture",
        "dual-layout",
        function () {
          dualMode = dualMode === "split" ? "pip" : "split";
          renderMultiView();
          scheduleDualControls();
        }
      )
    );
    if (dualActive) {
      controls.appendChild(dualAudioButton(0));
      controls.appendChild(dualAudioButton(1));
      controls.appendChild(
        button("Stop", "dual-stop", function () {
          stopDual();
          dualFocusId = "dual-start";
          S.zone = "form";
          renderMultiView();
        })
      );
    } else controls.appendChild(button("Watch both", "dual-start", startDual));
    var tray = dualActive ? el("div", "dual-tray" + (dualControls ? "" : " hidden")) : main;
    if (dualActive) tray.id = "dual-tray";
    tray.appendChild(controls);
    var frames = el(
      "div",
      "dual-frames " + (dualMode === "pip" ? "pip" : "split") +
        (dualActive ? (dualControls ? " controls-visible" : " controls-hidden") : "")
    );
    frames.onclick = function () {
      if (dualActive && !dualControls && !S.dialog) showDualControls();
    };
    [0, 1].forEach(function (slot) {
      var slotStatus = dualStates[slot].status;
      var hasPicture = slotStatus === "playing" || slotStatus === "paused";
      var frame = el("div", "dual-frame" + (hasPicture ? " has-picture" : "") +
        (dualActive && !dualControls && !hasPicture ? " hidden" : ""));
      frame.id = "dual-frame-" + slot;
      frame.appendChild(
        el(
          "div",
          "dual-label" + (dualActive && !dualControls ? " hidden" : ""),
          (dualAudio === slot ? "🔊 " : "") + (dualChannels[slot] ? dualChannels[slot].name : "Channel " + (slot + 1))
        )
      );
      if (!dualActive || !hasPicture) {
        var message = el(
          "div",
          "dual-message",
          slotStatus === "error"
            ? dualStates[slot].error || "This stream could not start"
            : slotStatus === "loading"
              ? "Connecting…"
              : dualActive
                ? "This channel has stopped. Choose a channel above."
                : dualChannels[0] && dualChannels[1]
                  ? "Ready. Select Watch both to start."
                  : "Choose a channel above, then Watch both."
        );
        frame.appendChild(message);
      }
      if (!dualActive) frame.appendChild(dualAudioButton(slot));
      frames.appendChild(frame);
    });
    main.appendChild(frames);
    tray.appendChild(
      el(
        "p",
        "dual-footer",
        dualActive
          ? "← → Choose  ·  OK Select  ·  Back Hide controls, then stop"
          : "Uses both playlist streams. Stop this playlist on other TVs first.  ·  ↑ Tabs  ·  OK Choose  ·  Back Tabs  ·  Leaving stops both games"
      )
    );
    if (dualActive) {
      main.appendChild(tray);
      applyDualRects();
      if (dualControls) {
        S.zone = "dual-controls";
        focus(document.getElementById(dualFocusId) ? dualFocusId : "dual-pick-0");
      } else {
        main.tabIndex = -1;
        main.focus();
        S.focusId = null;
      }
    } else if (S.zone === "nav") focus("tab-" + S.nav);
    else focus(dualFocusId) || focus("dual-pick-0");
  }
  // Multi View channel list: every channel (Favorites first) or the channels matching the search,
  // with numbers. Up/Down walk it, CH+/CH- jump eight, Back or Cancel return to the slot's button.
  function pickDualChannel(slot) {
    clearTimeout(dualControlsTimer);
    if (!S.dialog) dialogReturn = { id: "dual-pick-" + slot, zone: S.zone };
    S.dialog = true;
    dialogLayer.className = "";
    dialogLayer.textContent = "";
    var box = el("div", "dialog choices");
    box.appendChild(el("h2", "", "Choose channel " + (slot + 1)));
    var input = el("input", "search-bar");
    input.id = "dual-channel-query";
    input.type = "search";
    input.placeholder = "Press OK to search a channel or team";
    makeTextField(input);
    box.appendChild(input);
    var results = el("div", "picker-list"),
      current = -1;
    box.appendChild(results);
    function update() {
      results.textContent = "";
      current = -1;
      var q = input.value.toLowerCase().trim(),
        favourites = Object.create(null),
        items = S.catalogs.live.filter(function (c) {
          return !q || c.name.toLowerCase().indexOf(q) >= 0;
        });
      store.favourites().forEach(function (id) {
        favourites[id] = true;
      });
      if (!q)
        items = items
          .filter(function (c) {
            return favourites[c.id] === true;
          })
          .concat(
            items.filter(function (c) {
              return favourites[c.id] !== true;
            })
          )
          .slice(0, 100);
      else items = items.slice(0, 60);
      items.forEach(function (c, i) {
        if (dualChannels[slot] && dualChannels[slot].id === c.id) current = i;
        results.appendChild(
          button(
            (c.number ? c.number + "  " : "") + c.name,
            "dual-result-" + i,
            function () {
              if (dualChannels[1 - slot] && dualChannels[1 - slot].id === c.id)
                return toast("Choose a different channel for the second game.");
              var previous = dualChannels[slot];
              dualChannels[slot] = c;
              closeDialog(false);
              dualFocusId = dualActive
                ? "dual-pick-" + slot
                : !dualChannels[1 - slot]
                  ? "dual-pick-" + (1 - slot)
                  : "dual-start";
              if (dualActive && dual && (!previous || previous.id !== c.id || previous.url !== c.url))
                playDualChannel(slot);
              renderMultiView();
              scheduleDualControls();
            },
            "episode"
          )
        );
      });
      if (!items.length)
        results.appendChild(el("p", "muted", "No matching channels."));
    }
    input.oninput = update;
    update();
    box.appendChild(
      button("Cancel", "dialog-close", function () {
        closeDialog();
      })
    );
    dialogLayer.appendChild(box);
    focus(current >= 0 ? "dual-result-" + current : "dual-result-0") ||
      focus("dual-channel-query");
  }
  function startDual() {
    if (!dualChannels[0] || !dualChannels[1])
      return toast("Choose two channels first.");
    if (dualChannels[0].id === dualChannels[1].id)
      return toast("Choose two different channels.");
    player.stop();
    S.watched = null;
    if (dual) dual.stop();
    if (!window.TunerPlayer.createDual)
      return toast("The two-channel player is unavailable.");
    try {
      if (!dual)
        dual = window.TunerPlayer.createDual({
          objectElements: [
            document.getElementById("dual-object-0"),
            document.getElementById("dual-object-1"),
          ],
          videoElements: [
            document.getElementById("dual-video-0"),
            document.getElementById("dual-video-1"),
          ],
          onState: function (slot, state) {
            var previousStatus = dualStates[slot].status;
            dualStates[slot] = state;
            var other = 1 - slot;
            if (!dualRestarting && dualActive && dual && state.status === "error" && previousStatus !== "error" &&
                slot === dualAudio && dualStates[other].status === "playing")
              selectDualAudio(other);
            if (!dualRestarting && S.tab === 5 && !S.dialog) renderMultiView();
          },
        });
      if (dualAudio === 1 && (dualNeedsMainAudio() || dual.capability && dual.capability.native)) {
        dualChannels = [dualChannels[1], dualChannels[0]];
        dualAudio = 0;
      }
      dualActive = true;
      dualControls = true;
      dualFocusId = "dual-pick-0";
      dualStates = [{ status: "loading" }, { status: "loading" }];
      renderMultiView();
      playDualChannels();
      if (!dualNeedsMainAudio() && !(dual.capability && dual.capability.native))
        dual.selectAudio(dualAudio);
      applyDualRects();
      scheduleDualControls();
    } catch (e) {
      stopDual();
      toast("Two-channel playback is not supported by this TV.");
      renderMultiView();
    }
  }
  function applyDualRects() {
    if (!dual || !dualActive || S.tab !== 5) return;
    // The app stage is always logical 1920x1080, independent of CSS scale or controls.
    // AVPlay LETTER_BOX preserves each stream's own aspect ratio inside these bounds.
    dual.setRects(dualMode === "pip"
      ? [{ left: 0, top: 0, width: 1920, height: 1080 }, { left: 1312, top: 32, width: 576, height: 324 }]
      : [{ left: 0, top: 270, width: 960, height: 540 }, { left: 960, top: 270, width: 960, height: 540 }]);
  }
  function applyTheme() {
    var nativeVisible =
      window.webapis &&
      window.webapis.avplay &&
      (dualActive ||
        (player &&
          player.state &&
          /loading|playing|paused/.test(player.state.status)));
    document.body.className =
      (store.settings.theme === "black" ? "black" : "") +
      (S.fullscreen ? " fullscreen" : "") +
      (dualActive && S.tab === 5 ? " multiview-fullscreen" : "") +
      (nativeVisible ? " native-video" : "");
  }
  function canHoldFavorite() {
    return (
      !S.dialog &&
      !surfTarget &&
      ((S.tab === 0 && !S.fullscreen && !S.detail && S.zone === "grid") ||
        (S.fullscreen && S.zone !== "player-actions" && S.watched))
    );
  }
  var enterDown = 0,
    enterHeld = false,
    FIELD_PASS_KEYS = [
      458, 427, 428, 33, 34, 10252, 179, 415, 19, 412, 417, 413, 403, 404, 405,
      406, 10221, 460,
    ];
  function keyDown(e) {
    var code = e.keyCode || e.which,
      tag = e.target && e.target.tagName,
      i;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      var field = e.target,
        editing = !field.readOnly;
      if (code === 10009 || code === 27) {
        e.preventDefault();
        if (editing) stopEditing(field, "cancel");
        else if (S.dialog) closeDialog();
        else {
          field.blur();
          toNav();
        }
      } else if (code === 13 || code === 65376 || code === 65385) {
        // OK/Enter, the TV keyboard's Done (65376) and Cancel (65385).
        e.preventDefault();
        if (!editing) {
          if (code === 13) startEditing(field, true);
        } else stopEditing(field, code === 65385 ? "cancel" : "done");
      } else if (code >= 37 && code <= 40) {
        if (editing && (code === 37 || code === 39)) return; // move the caret
        e.preventDefault();
        if (editing) stopEditing(field, "move");
        if (S.dialog) dialogArrow(code);
        else handleArrow(code);
      } else if (
        !editing &&
        e.key &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        // Typing (number keys, a PC keyboard) starts editing; the character is still inserted.
        startEditing(field, false);
        return;
      }
      // A field that is not being edited passes remote keys on: Guide, CH, media and color keys.
      if (editing || FIELD_PASS_KEYS.indexOf(code) < 0) return;
    }
    if (code === 10009 || code === 27 || code === 8) {
      e.preventDefault();
      if (!e.repeat) back();
      return;
    }
    // Any remote key while watching restarts the single controls timer.
    if (S.fullscreen) scheduleHideControls();
    var digit =
      code >= 48 && code <= 57 ? code - 48 : code >= 96 && code <= 105 ? code - 96 : -1;
    if (pin && S.dialog && digit >= 0) {
      e.preventDefault();
      if (!e.repeat) passcodeDigit(String(digit));
      return;
    }
    // Number keys jump the guide to a channel, or tune it while watching live.
    if (
      digit >= 0 &&
      !S.dialog &&
      !dualActive &&
      ((S.tab === 0 && !S.detail && !S.fullscreen) ||
        (S.fullscreen && playerIsLive()))
    ) {
      e.preventDefault();
      if (!e.repeat) numberKey(String(digit));
      return;
    }
    // Subtitles: the CC/Caption key (Samsung 10221, LG 460) or the yellow key while watching.
    if (code === 10221 || code === 460 || code === 405) {
      e.preventDefault();
      if (S.fullscreen && !S.dialog && !e.repeat) {
        S.controls = true;
        renderPlayerOverlay();
        subtitleDialog();
      }
      return;
    }
    if (dualActive && S.tab === 5 && dualMenuCodes.indexOf(code) >= 0) {
      e.preventDefault();
      showDualControls();
      return;
    }
    if (code === 13) {
      e.preventDefault();
      if (entry.digits) {
        // OK confirms a typed channel number at once; its keyup does nothing more.
        if (!e.repeat) commitNumber();
        return;
      }
      if (dualActive && dualControls && !S.dialog) scheduleDualControls();
      if (!enterDown) {
        enterDown = Date.now();
        enterHeld = false;
      }
      if (Date.now() - enterDown >= 650 && !enterHeld) {
        var c = S.fullscreen ? S.watched : selectedLive();
        if (c && canHoldFavorite()) {
          enterHeld = true;
          toggleFavorite(c);
        }
      }
      return;
    }
    if (code >= 37 && code <= 40) {
      e.preventDefault();
      handleArrow(code);
      return;
    }
    // Channel up/down (Samsung 427/428, LG 33/34).
    if (code === 427 || code === 428 || code === 33 || code === 34) {
      e.preventDefault();
      var up = code === 427 || code === 33;
      if (S.dialog) pickerPage(up ? -8 : 8);
      else if (S.fullscreen) {
        if (playerIsLive()) changeChannel(up ? 1 : -1);
      } else if (dualActive && S.tab === 5) return;
      else if (S.tab === 0 && !S.detail) pageGuide(up ? -4 : 4);
      else if (
        S.tab === 3 &&
        !S.detail &&
        document.activeElement &&
        /^result-/.test(document.activeElement.id)
      )
        // Page five rows within the results; paging stops at the first or last row.
        for (i = 0; i < 5; i++)
          if (!moveSpatial(document.getElementById("search-results"), up ? 38 : 40))
            break;
      return;
    }
    if (code === 10252 || code === 179 || code === 415 || code === 19) {
      e.preventDefault();
      if (S.fullscreen) {
        if (code === 415) player.resume();
        else if (code === 19) player.pause();
        else player.toggle();
        S.controls = true;
        renderPlayerOverlay();
        scheduleHideControls();
      }
      return;
    }
    // Rewind / Fast forward seek 30 seconds in movies and episodes.
    if (code === 412 || code === 417) {
      e.preventDefault();
      if (S.fullscreen && !S.dialog && !playerIsLive() && player.state.request) {
        player.seek(code === 412 ? -30000 : 30000);
        S.controls = true;
        renderPlayerOverlay();
      }
      return;
    }
    if (code === 413) {
      e.preventDefault();
      if (S.fullscreen && !S.dialog) leaveFullscreen();
      return;
    }
    if (code === 458) {
      e.preventDefault();
      if (S.dialog) return;
      if (!S.fullscreen) openTab(0);
      else if (playerIsLive()) {
        // Guide: back to the guide on the channel being watched, wherever playback was opened.
        S.playOrigin = null;
        S.tab = S.nav = 0;
        leaveFullscreen();
      } else leaveFullscreen();
    }
  }
  document.addEventListener("keydown", function (e) {
    keyDown(e);
    ensureFocus();
  });
  document.addEventListener("keyup", function (e) {
    if ((e.keyCode || e.which) !== 13 || !enterDown) return;
    var alreadyHandled = enterHeld;
    var held = enterHeld || Date.now() - enterDown >= 650;
    enterDown = 0;
    enterHeld = false;
    var c = S.fullscreen ? S.watched : selectedLive();
    if (held && c && canHoldFavorite()) {
      if (!alreadyHandled && !S.dialog) toggleFavorite(c);
      return;
    }
    if (S.dialog) {
      if (document.activeElement && document.activeElement.click)
        document.activeElement.click();
      return;
    }
    if (dualActive && S.tab === 5) {
      if (!dualControls) showDualControls();
      else {
        if (document.activeElement && document.activeElement.click)
          document.activeElement.click();
        scheduleDualControls();
      }
      return;
    }
    if (S.fullscreen) {
      if (surfTarget) {
        commitSurf();
        return;
      }
      if (
        S.zone === "player-actions" &&
        document.activeElement &&
        document.activeElement !== document.body &&
        document.activeElement.click
      )
        document.activeElement.click();
      else {
        if (player.state.request && !player.state.request.live) player.toggle();
        showPlayerControls("play-toggle");
        scheduleHideControls();
      }
      return;
    }
    if (S.tab === 0 && S.zone === "grid" && !S.detail) {
      if (c) activateChannel(c, selectedProgram(c));
    } else if (
      document.activeElement &&
      document.activeElement !== document.body &&
      document.activeElement.click
    )
      document.activeElement.click();
    ensureFocus();
  });
  window.addEventListener("blur", function () {
    enterDown = 0;
    enterHeld = false;
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      saveRecent();
      clearTimeout(dualControlsTimer);
      if (dualActive && dual) dual.suspend();
      else player.suspend();
    } else {
      if (dualActive && dual) {
        dual.restore();
        scheduleDualControls();
      }
      else {
        player.restore();
        resumeGuidePreview();
      }
    }
  });
  window.addEventListener("beforeunload", function () {
    saveRecent();
    stopDual();
    player.stop();
    if (client) client.cancel();
  });
  function resize() {
    // Scale by width only: the TV's on-screen keyboard shortens the window's height while it is open, and
    // scaling by height would shrink the whole app into a corner until the keyboard closes.
    document.getElementById("app").style.transform =
      "scale(" + window.innerWidth / 1920 + ")";
    if (S.fullscreen) player.setRect(FULL_RECT);
    else if (dualActive) applyDualRects();
    else previewRect();
  }
  window.addEventListener("resize", resize);
  try {
    var supported = window.tizen.tvinputdevice.getSupportedKeys();
    [
      "ChannelUp",
      "ChannelDown",
      "MediaPlayPause",
      "MediaPlay",
      "MediaPause",
      "MediaStop",
      "MediaRewind",
      "MediaFastForward",
      "Guide",
      "ColorF0Red",
      "ColorF2Yellow",
      "Caption",
      "Menu",
      "Tools",
      "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
    ].forEach(function (name) {
      if (
        supported.some(function (k) {
          return k.name === name;
        })
      )
        {
          window.tizen.tvinputdevice.registerKey(name);
          if (name === "Menu" || name === "Tools") {
            var menuKey = supported.filter(function (k) { return k.name === name; })[0];
            dualMenuCodes.push(menuKey.code);
          }
        }
    });
  } catch (e) {}
  setInterval(function () {
    if (!S.fullscreen && !S.dialog) {
      var n = topbar.querySelector(".clock");
      if (n) n.textContent = clock(Date.now());
    }
  }, 15000);
  setInterval(function () {
    if (S.tab === 0 && !S.fullscreen && !S.dialog) renderGuide();
  }, 60000);
  S.tab = store.settings.source ? 0 : 4;
  S.nav = S.tab;
  S.zone = store.settings.source ? "grid" : "form";
  render();
  resize();
  if (store.settings.source) connect();
})(window, document);
