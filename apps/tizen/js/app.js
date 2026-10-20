(function (window, document) {
  "use strict";
  var D = window.TunerData,
    B = D.browse,
    store = D.createStore(),
    client = null;
  // Sections. The numbers are stable ids (tab-N, saved focus, origins); the tab bar shows them in tabOrder.
  var LIVE = 0,
    DISCOVER = 1,
    LIBRARY = 2,
    SEARCH = 3,
    SETTINGS = 4,
    MULTI = 5,
    HOME = 6;
  var tabs = [
    "Live TV",
    "Discover",
    "Library",
    "Search",
    "Settings",
    "Multi View",
    "Home",
  ];
  var tabOrder = [HOME, LIVE, DISCOVER, LIBRARY, SEARCH, SETTINGS, MULTI];
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
    // Home and Library: the focused row (by id) and, per row, the focused tile, its title and the first tile
    // in view. fromHome: Library was opened by Continue watching's See all, so Back returns to Home.
    shelf: { home: { rowId: null, rows: {} }, library: { rowId: null, rows: {}, fromHome: false } },
    // Discover: its filters, the focused poster, the first grid row in view, the last focused filter, and
    // whether a See all tile on Home opened it.
    discover: { type: "movies", list: null, genre: "", focus: 0, top: 0, filter: "discover-list", fromHome: false },
    query: "",
    detail: null,
    detailInfo: null,
    season: 0,
    dialog: false,
    sourceGeneration: 0,
    focusId: null,
    // Last focused control per page (Search, Settings), restored when the page is entered again.
    pageFocus: {},
    // Where full-screen live playback was opened from when that was not the guide (Search).
    playOrigin: null,
    guidePlaced: false,
    guideWaiting: false,
    // Home or Library had nothing to focus (titles loading or being prepared): focus waits on the section's
    // tab and moves to the rows once they arrive, unless a key moved it meanwhile.
    shelfWaiting: false,
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
    externalSubtitles: outsideSubtitles,
    onExternalSubtitles: autoOutside,
    onError: function (message) {
      if (!S.fullscreen) toast(message);
    },
  });
  // Subtitles and trailers through lumanest.tv (docs/extras.md; js/data.js, TunerData.extras).
  var extras =
      D.extras && D.extras.createClient
        ? D.extras.createClient({ XMLHttpRequest: window.XMLHttpRequest })
        : null,
    SUBTITLES_CREDIT = "Subtitles provided by OpenSubtitles.com",
    // Settings > About Tuner shows these at all times (YouTube API Services Developer Policies III.A: the privacy
    // policy easily accessible, and a link to the YouTube Terms of Service while trailers play in YouTube's player).
    PRIVACY_NOTICE = "Privacy policy: tunertv.app/privacy",
    YOUTUBE_TERMS_NOTICE =
      "Trailers play in YouTube's embedded player (YouTube API Services). By using Tuner, you agree to the YouTube Terms of Service: www.youtube.com/t/terms",
    CHECK = "\u2713 ";

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
      if (S.zone === "nav" && S.tab >= SEARCH && S.tab <= MULTI && !(dualActive && S.tab === 5))
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
    S.zone = pageZone(S.tab);
    render();
  }
  // The zone a section starts in: the guide list, a shelf's rows, Discover's posters, or a form.
  function pageZone(tab) {
    return tab === LIVE
      ? "grid"
      : tab === HOME || tab === LIBRARY
        ? "rows"
        : tab === DISCOVER
          ? "posters"
          : "form";
  }
  // The section Tuner opens on, and the one Back from another section's tab returns to.
  function startTab() {
    return store.settings.startOn === "live" ? LIVE : HOME;
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
    if (S.detail) return sectionName(S.detail.origin ? S.detail.origin.tab : HOME);
    if (S.tab === 0 && S.zone === "grid")
      return S.focusAt !== null ? "Now" : "Categories";
    if (S.tab === 0 && S.zone === "empty") return "Categories";
    if (S.zone !== "nav" && S.tab === DISCOVER)
      return S.discover.fromHome ? "Home" : S.zone === "posters" ? "Filters" : "Tabs";
    if (S.zone !== "nav" && S.tab === LIBRARY && S.shelf.library.fromHome) return "Home";
    return "Tabs";
  }
  function sectionName(tab) {
    return tab === SEARCH ? "Search" : tabs[tab] || "Home";
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
    tabOrder.forEach(function (i) {
      var b = button(
        tabs[i],
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
  // onNav: stay on the tab bar (Back from another tab's bar lands on the start section's tab).
  function openTab(i, onNav) {
    S.discover.fromHome = false;
    S.shelf.library.fromHome = false;
    showSection(i, onNav);
  }
  // openTab without forgetting that Discover or Library was opened from Home.
  function showSection(i, onNav) {
    if (S.tab === 5 && i !== 5) stopDual();
    if (S.fullscreen) leaveFullscreen();
    closeDialog(false);
    S.detail = null;
    S.detailInfo = null;
    S.tab = i;
    S.nav = i;
    S.focusId = null;
    S.zone = onNav ? "nav" : pageZone(i);
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
    else if (S.tab === LIVE) renderGuide();
    else if (S.tab === HOME) renderShelfPage("home");
    else if (S.tab === LIBRARY) renderShelfPage("library");
    else if (S.tab === DISCOVER) renderDiscover();
    else if (S.tab === SEARCH) renderSearch();
    else if (S.tab === MULTI) renderMultiView();
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
  // Movies & Series (docs/browse.md). Home and Library are shelves of horizontal poster rows; Discover is a
  // filtered poster grid. Each catalogue is indexed once by js/data.js (in steps on a large catalogue, so keys
  // stay responsive); rows and grids are cut from the index when shown. Only the focused shelf row and the one
  // below it, or three grid rows, are in the DOM, and posters load as they come into view.
  var POSTER = 210, // a shelf tile's pitch in stage pixels (188 px poster + gap)
    SHELF_SLOTS = 8, // shelf tiles fully in view
    SHELF_ROWS = 2, // shelf rows in the DOM: the focused one and the one below (the screen shows 1.7 rows)
    GRID_COLS = 8,
    GRID_ROWS = 2, // grid rows fully in view
    GRID_PAGE = 96, // titles the grid computes at a time as it scrolls
    SYNC_INDEX = 3000, // catalogues up to this size are indexed at once; larger ones in slices of about
    INDEX_SLICE = 30, // this many milliseconds, between key presses
    TMDB_NOTICE = "This product uses the TMDB API but is not endorsed or certified by TMDB.";
  var browse = {
    index: { movies: null, series: null },
    pending: { movies: null, series: null },
    stale: { movies: false, series: false }, // the catalogue changed since its index was built
    rows: null, // the catalog rows (TMDB lists) in use, or null
    rowsClient: null,
    home: null, // Home's rows after Continue watching, until the index or the USA setting changes
    results: null, // Discover's titles for its current filters
  };
  // The shelf on screen ({ name, rows, nodes, marks, box }) and every poster's title by id (Hold OK).
  var shelfView = null,
    tileTitles = {};
  function vodUsOnly() {
    return store.settings.vodUsOnly !== false;
  }
  function isBrowseTab(tab) {
    return tab === HOME || tab === DISCOVER || tab === LIBRARY;
  }
  function withTmdb() {
    return !!browse.rows && B.hasTmdb(browse.rows);
  }
  // Rows come from the saved copy at once; a stale or missing copy is refreshed in the background.
  function refreshRows() {
    if (!browse.rowsClient) {
      var storage = null;
      try {
        storage = window.localStorage || null;
      } catch (e) {}
      browse.rowsClient = B.createRowsClient({
        storage: storage,
        XMLHttpRequest: window.XMLHttpRequest,
      });
      browse.rows = browse.rowsClient.peek();
    }
    if (!store.settings.source) return;
    browse.rowsClient.refresh(function (rows) {
      browse.rows = rows;
      // Indexes match the new rows (a running job restarts its matching); the screen keeps the old
      // matches until the new ones are complete.
      ["movies", "series"].forEach(function (kind) {
        var job = browse.pending[kind];
        if (job && !job.builder) {
          job.matcher = B.createMatcher(job.index, rows);
          job.warm = null;
        } else if (!job && browse.index[kind] && !browse.stale[kind] && startIndexJob(kind, browse.index[kind])) {
          browse.home = null;
          browse.results = null;
        }
      });
      browseChanged();
    });
  }
  // Whether both catalogues are indexed. Starts what is missing; a large catalogue is indexed in steps
  // between key presses and the page redraws when it is ready.
  function browseReady() {
    refreshRows();
    var movies = indexReady("movies"),
      series = indexReady("series");
    return movies && series;
  }
  // Ready when indexed (a re-match after new rows keeps the old matches meanwhile); otherwise starts indexing.
  function indexReady(kind) {
    if (browse.index[kind]) {
      // A catalogue delivered again: the old index stays on screen while the new one is built.
      if (browse.stale[kind] && !browse.pending[kind]) startIndexJob(kind, null);
      return true;
    }
    return !browse.pending[kind] && startIndexJob(kind, null);
  }
  // Indexes one catalogue (index null) or matches an index to new rows. A small catalogue is done at once
  // (returns true); a large one in slices of INDEX_SLICE ms with the page redrawn when it is done.
  function startIndexJob(kind, index) {
    if (!index) browse.stale[kind] = false;
    var job = {
      builder: index ? null : B.createIndexBuilder(kind, S.catalogs[kind], S.cats[kind]),
      index: index,
      matcher: index ? B.createMatcher(index, browse.rows) : null,
      warm: null,
      timer: null,
    };
    browse.pending[kind] = job;
    if (S.catalogs[kind].length <= SYNC_INDEX) {
      runIndexJob(job, true);
      finishIndexJob(kind, job);
      return true;
    }
    // The first slice too waits for the current key or render to finish, so it never redraws the page
    // while that render is still building it.
    function next() {
      if (browse.pending[kind] !== job) return;
      if (!runIndexJob(job, false)) {
        job.timer = setTimeout(next, 0);
        return;
      }
      finishIndexJob(kind, job);
      browseChanged();
    }
    job.timer = setTimeout(next, 0);
    return false;
  }
  // One slice: titles first, then matching, then the lists Home sorts (one list per round). Returns true when done.
  function runIndexJob(job, whole) {
    var until = Date.now() + INDEX_SLICE,
      rounds = 0;
    while (whole || (rounds++ < 40 && Date.now() <= until)) {
      if (job.builder) {
        if (job.builder.step(whole ? 0 : 150)) {
          job.index = job.builder.index;
          job.builder = null;
          job.matcher = B.createMatcher(job.index, browse.rows);
        }
      } else if (job.matcher) {
        if (job.matcher.step(whole ? 0 : 800)) {
          job.matcher.apply();
          job.matcher = null;
          job.warm = whole
            ? []
            : ["recent", "rated", "popular", "featured", "az"].concat(
                B.SERVICES.map(function (service) {
                  return service.key;
                })
              );
        }
      } else if (job.warm && job.warm.length) B.listOf(job.index, job.warm.shift());
      else return true;
    }
    return false;
  }
  function finishIndexJob(kind, job) {
    browse.pending[kind] = null;
    browse.index[kind] = job.index;
    browse.home = null;
    browse.results = null;
  }
  // The titles shown changed at once (adult lock, another playlist): the index is dropped and rebuilt when
  // next shown.
  function invalidateBrowse(kind) {
    if (browse.pending[kind]) clearTimeout(browse.pending[kind].timer);
    browse.pending[kind] = null;
    browse.index[kind] = null;
    browse.stale[kind] = false;
    browse.home = null;
    browse.results = null;
  }
  // The provider delivered a catalogue again (the saved copy, then the network; Refresh): the index on
  // screen stays, with focus, until the new one is ready (a large catalogue is indexed in slices).
  function catalogueRedelivered(kind) {
    // An index of no titles (built while the catalogue was still loading) is not worth keeping.
    if (!browse.index[kind] || !browse.index[kind].titles.length) return invalidateBrowse(kind);
    if (browse.pending[kind]) clearTimeout(browse.pending[kind].timer);
    browse.pending[kind] = null;
    browse.stale[kind] = true;
  }
  function browseChanged() {
    if (S.detail || S.fullscreen || S.dialog) return;
    if (isBrowseTab(S.tab)) render();
    // Search applies Movies & Series: USA only from the index.
    else if (S.tab === SEARCH) renderSearchResults();
  }
  function findTitle(kind, id) {
    var index = browse.index[kind],
      at = index ? index.byId[id] : undefined;
    return at === undefined ? null : index.titles[at].item;
  }
  // Favorites (check badge) and how far each movie or series is watched (progress bar).
  function libraryMarks() {
    var marks = { fav: {}, progress: {} };
    store.favourites().forEach(function (id) {
      marks.fav[id] = true;
    });
    store.recents().forEach(function (r) {
      var key = r.seriesId || r.id;
      if (r.duration > 0 && marks.progress[key] === undefined)
        marks.progress[key] = Math.max(0, Math.min(1, r.position / r.duration));
    });
    return marks;
  }
  function continueTiles() {
    return B.continueWatching(store.recents(), store.upNext(), findTitle);
  }
  // Home: Continue watching, then the rows of docs/browse.md that have at least 5 titles. Each ends in See all.
  function homeRows() {
    var usOnly = vodUsOnly(),
      rows = [],
      resume = continueTiles();
    if (!browse.home || browse.home.usOnly !== usOnly)
      browse.home = {
        usOnly: usOnly,
        rows: B.homeRows(browse.index, { usOnly: usOnly, withTmdb: withTmdb() }),
      };
    if (resume.length >= 5)
      rows.push({ id: "continue", title: "Continue watching", tiles: resume.slice(0, 20), more: { library: true } });
    browse.home.rows.forEach(function (row) {
      var index = browse.index[row.kind];
      rows.push({
        id: row.id,
        title: row.title,
        tiles: row.positions.map(function (p) {
          return { kind: row.kind, item: index.titles[p].item };
        }),
        more: { kind: row.kind, list: row.list },
      });
    });
    return rows;
  }
  // Library: Continue watching, Favorite movies, Favorite series and Recently watched (rows with titles only).
  function libraryRows() {
    var rows = [],
      movies = [],
      series = [],
      seen = [];
    function add(id, title, tiles) {
      if (tiles.length) rows.push({ id: id, title: title, tiles: tiles.slice(0, 60) });
    }
    function title(id) {
      var movie = findTitle("movies", id),
        show = movie ? null : findTitle("series", id);
      return movie ? { kind: "movies", item: movie } : show ? { kind: "series", item: show } : null;
    }
    store.favourites().slice().reverse().forEach(function (id) {
      var t = title(id);
      if (t) (t.kind === "movies" ? movies : series).push(t);
    });
    store.seen().forEach(function (r) {
      var t = title(r.id);
      if (t) seen.push(t);
    });
    add("continue", "Continue watching", continueTiles());
    add("fav-movies", "Favorite movies", movies);
    add("fav-series", "Favorite series", series);
    add("seen", "Recently watched", seen);
    return rows;
  }
  function shelfPrefix(name) {
    return name === "home" ? "home-" : "lib-";
  }
  function tileCount(row) {
    return row.tiles.length + (row.more ? 1 : 0);
  }
  function shelfSpot(state, row) {
    return state.rows[row.id] || (state.rows[row.id] = { focus: 0, scroll: 0, itemId: null });
  }
  function shelfRowIndex(state, rows) {
    for (var i = 0; i < rows.length; i++) if (rows[i].id === state.rowId) return i;
    return 0;
  }
  // Keeps the focused tile in view with at least one more tile showing after it.
  function keepInView(spot, count) {
    spot.focus = Math.max(0, Math.min(spot.focus, count - 1));
    if (spot.focus < spot.scroll) spot.scroll = spot.focus;
    if (spot.focus > spot.scroll + SHELF_SLOTS - 2) spot.scroll = spot.focus - SHELF_SLOTS + 2;
    spot.scroll = Math.max(0, Math.min(spot.scroll, count - SHELF_SLOTS));
  }
  // Posters get their image only once in or near view.
  function loadPosters(nodes, from, to) {
    for (var i = Math.max(0, from); i < Math.min(nodes.length, to); i++) {
      var img = nodes[i].querySelector("img"),
        src = img && img.getAttribute("data-src");
      if (src) {
        img.setAttribute("data-src", "");
        img.src = src;
      }
    }
  }
  function posterTile(id, tile, marks, onFocus) {
    var item = tile.item,
      b = button(
        "",
        id,
        function () {
          openTile(tile);
        },
        "poster"
      ),
      art = el("div", "poster-art"),
      progress = tile.next ? 0 : tile.progress !== undefined ? tile.progress : marks.progress[item.id] || 0,
      img,
      bar,
      fill;
    art.appendChild(el("span", "poster-name", item.name));
    if (item.image) {
      img = el("img", "poster-img");
      img.alt = "";
      img.setAttribute("data-src", item.image);
      img.onerror = function () {
        img.onerror = null;
        img.className = "poster-img hidden";
      };
      art.appendChild(img);
    }
    if (marks.fav[item.id]) art.appendChild(el("span", "poster-check", "✓"));
    if (progress > 0) {
      bar = el("div", "poster-progress");
      fill = el("span");
      fill.style.width = Math.max(4, Math.round(progress * 100)) + "%";
      bar.appendChild(fill);
      art.appendChild(bar);
    }
    if (tile.next) art.appendChild(el("span", "poster-next", "Next episode"));
    b.appendChild(art);
    b.appendChild(el("span", "poster-title", item.name));
    b.onfocus = onFocus;
    tileTitles[id] = tile;
    return b;
  }
  function openTile(tile) {
    if (S.tab === HOME) S.shelf.home.touched = true;
    else if (S.tab === LIBRARY) S.shelf.library.touched = true;
    openDetail(tile.item, tile.kind, tile.resume || tile.next ? { resume: tile.resume, next: tile.next } : null);
  }
  // See all: Discover with the row's type and list (Continue watching: the Library). Back returns here.
  function seeAll(row) {
    if (row.more.library) {
      S.shelf.home.touched = true;
      S.shelf.library.rowId = "continue";
      S.shelf.library.touched = true;
      S.shelf.library.rows.continue = { focus: 0, scroll: 0, itemId: null };
      S.shelf.library.fromHome = true;
      showSection(LIBRARY);
    } else {
      var d = S.discover;
      S.shelf.home.touched = true;
      d.type = row.more.kind;
      d.list = row.more.list;
      d.genre = "";
      resetDiscoverGrid();
      d.fromHome = true;
      showSection(DISCOVER);
    }
  }
  function backHome() {
    S.discover.fromHome = false;
    S.shelf.library.fromHome = false;
    showSection(HOME);
  }
  function shelfRowNode(r) {
    var view = shelfView,
      row = view.rows[r],
      node = el("section", "shelf"),
      strip = el("div", "shelf-strip"),
      prefix = shelfPrefix(view.name) + r + "-",
      all;
    node.appendChild(el("h2", "shelf-title", row.title));
    row.tiles.forEach(function (tile, t) {
      strip.appendChild(
        posterTile(prefix + t, tile, view.marks, function () {
          shelfFocused(view, r, t);
        })
      );
    });
    if (row.more) {
      all = button(
        "",
        prefix + row.tiles.length,
        function () {
          seeAll(row);
        },
        "poster see-all"
      );
      all.appendChild(el("div", "poster-art", "See all"));
      all.appendChild(el("span", "poster-title", row.title));
      all.onfocus = function () {
        shelfFocused(view, r, row.tiles.length);
      };
      strip.appendChild(all);
    }
    node.appendChild(strip);
    return { node: node, strip: strip };
  }
  function placeStrip(strip, spot) {
    var x = "translateX(" + -spot.scroll * POSTER + "px)";
    strip.style.transform = x;
    strip.style.webkitTransform = x;
    loadPosters(strip.children, spot.scroll - 1, spot.scroll + SHELF_SLOTS + 2);
  }
  // Draws the focused row and the one below it (rows already built are reused).
  function drawShelfRows() {
    var view = shelfView,
      state = S.shelf[view.name],
      r = shelfRowIndex(state, view.rows),
      i;
    view.box.textContent = "";
    for (i = r; i < Math.min(view.rows.length, r + SHELF_ROWS); i++) {
      if (!view.nodes[i]) view.nodes[i] = shelfRowNode(i);
      view.box.appendChild(view.nodes[i].node);
      placeStrip(view.nodes[i].strip, shelfSpot(state, view.rows[i]));
    }
  }
  function focusShelf() {
    var view = shelfView,
      state = S.shelf[view.name],
      r = shelfRowIndex(state, view.rows),
      spot = shelfSpot(state, view.rows[r]);
    return focus(shelfPrefix(view.name) + r + "-" + spot.focus);
  }
  function shelfFocused(view, r, t) {
    var state = S.shelf[view.name],
      row = view.rows[r],
      spot = shelfSpot(state, row);
    S.zone = "rows";
    state.rowId = row.id;
    spot.focus = t;
    spot.itemId = t < row.tiles.length ? row.tiles[t].item.id : null;
    remember(shelfPrefix(view.name) + r + "-" + t);
    showTileInfo(row, t);
  }
  // The title line above the rows describes the focused poster.
  function showTileInfo(row, t) {
    var tile = row.tiles[t],
      item = tile && tile.item,
      marks = shelfView ? shelfView.marks : { fav: {}, progress: {} },
      meta = [];
    if (!document.getElementById("shelf-name")) return;
    document.getElementById("shelf-eyebrow").textContent = row.title;
    if (!item) {
      document.getElementById("shelf-name").textContent = "See all";
      document.getElementById("shelf-meta").textContent = row.more && row.more.library ? "Open your Library" : "Open Discover with this list";
      document.getElementById("shelf-plot").textContent = "";
      return;
    }
    meta.push(tile.kind === "series" ? "Series" : "Movie");
    if (item.year) meta.push(item.year);
    if (item.rating) meta.push("★ " + item.rating);
    if (marks.fav[item.id]) meta.push("✓ In your Library");
    if (tile.next) meta.push("Next episode ready");
    else if ((tile.progress || marks.progress[item.id]) > 0) meta.push("In progress");
    document.getElementById("shelf-name").textContent = item.name;
    document.getElementById("shelf-meta").textContent = meta.join("  ·  ");
    document.getElementById("shelf-plot").textContent = item.plot || "";
  }
  function shelfHero() {
    var hero = el("section", "shelf-hero"),
      parts = [
        ["div", "eyebrow", "shelf-eyebrow"],
        ["h1", "", "shelf-name"],
        ["div", "metadata", "shelf-meta"],
        ["p", "description", "shelf-plot"],
      ];
    parts.forEach(function (part) {
      var n = el(part[0], part[1], "");
      n.id = part[2];
      hero.appendChild(n);
    });
    return hero;
  }
  // Loading, empty and failure states shared by Home, Library and Discover. Returns the box.
  function browseStatus(page, ready) {
    var box = el("div", "guide-status browse-status"),
      movies = S.status.movies || {},
      series = S.status.series || {},
      hasTitles = S.catalogs.movies.length || S.catalogs.series.length,
      title,
      text,
      action = null;
    if (!store.settings.source) {
      title = "Movies & Series";
      text = "Add your playlist to start watching.";
      action = ["Add playlist", function () { openTab(SETTINGS); }];
    } else if (!hasTitles && (movies.state === "loading" || series.state === "loading" || !movies.state || !series.state)) {
      title = "Loading your movies and series";
      text = "This takes a few seconds.";
    } else if (!ready) {
      title = "Preparing your movies and series";
      text = "Sorting your titles. This happens once after each playlist update.";
    } else if (!hasTitles) {
      title = "Movies & Series";
      text = movies.state === "error" ? movies.message : series.state === "error" ? series.message : "The playlist has no movies or series.";
      // A live-only playlist: the way on is Live TV, not another download of the same playlist.
      action =
        movies.state !== "error" && series.state !== "error" && S.catalogs.live.length
          ? ["Open Live TV", function () { openTab(LIVE); }]
          : ["Refresh playlist", function () { connect(true); }];
    } else if (page === "library") {
      title = "Your Library is empty";
      text = "Titles you watch appear here. To save one, choose + Add to Library on its details, or hold OK on its poster.";
      action = ["Browse Discover", function () { openTab(DISCOVER); }];
    } else if (page === "home") {
      title = "Browse your movies and series";
      text = vodUsOnly()
        ? "No list has enough titles that pass Movies & Series: USA only. Open Discover, or show all titles with Settings › Movies & Series."
        : "Discover lists every title by type, list and genre.";
      action = ["Open Discover", function () { openTab(DISCOVER); }];
    } else {
      title = "No titles here";
      text = vodUsOnly()
        ? "Nothing in this list matches. Choose another list or genre, or show all titles with Settings › Movies & Series."
        : "Nothing in this list matches. Choose another list or genre.";
    }
    box.appendChild(el("h2", "", title));
    box.appendChild(el("p", "muted", text));
    if (action) box.appendChild(button(action[0], "empty-action", action[1]));
    return box;
  }
  function footerText() {
    var back = "Back " + backLabel();
    if (S.tab === DISCOVER)
      return S.zone === "filters"
        ? "← → Filters  ·  OK Choose  ·  ↓ Titles  ·  " + back
        : "OK Details  ·  Hold OK Library  ·  ↑ Filters  ·  CH +/− Page  ·  " + back;
    return "OK Open  ·  Hold OK Library  ·  ↑ ↓ Rows  ·  CH +/− Page  ·  " + back;
  }
  function browseFooter() {
    var footer = el("div", "browse-footer"),
      hint = el("span", "", "");
    hint.id = "browse-hint";
    footer.appendChild(hint);
    return footer;
  }
  function refreshFooter() {
    var n = document.getElementById("browse-hint");
    if (n) n.textContent = footerText();
  }
  // Home and Library.
  function renderShelfPage(name) {
    main.textContent = "";
    tileTitles = {};
    var ready = browseReady(),
      rows = ready && store.settings.source ? (name === "home" ? homeRows() : libraryRows()) : [],
      state = S.shelf[name],
      r;
    shelfView = { name: name, rows: rows, nodes: [], marks: libraryMarks(), box: null };
    if (!rows.length) {
      main.appendChild(browseStatus(name, ready));
      // Loading ended with nothing to show: focus moves from the tab to the status action.
      if (S.shelfWaiting && S.zone === "nav" && S.nav === S.tab && document.getElementById("empty-action")) {
        S.shelfWaiting = false;
        S.zone = "rows";
      }
      if (S.zone === "nav") focus("tab-" + S.nav);
      else if (!focus("empty-action")) {
        S.shelfWaiting = true;
        focus("tab-" + S.tab);
      }
      refreshBrandHint();
      return;
    }
    if (S.shelfWaiting && S.zone === "nav" && S.nav === S.tab) S.zone = "rows";
    S.shelfWaiting = false;
    // The remembered row and tile, found again by title when the rows changed. Until the customer moves
    // on the shelf it stays at the top, also when rows arrive above (Continue watching, a late catalogue).
    if (!state.touched) state.rowId = rows[0].id;
    r = shelfRowIndex(state, rows);
    state.rowId = rows[r].id;
    rows.forEach(function (row) {
      var spot = state.rows[row.id],
        i;
      if (!spot) return;
      if (spot.itemId && (!row.tiles[spot.focus] || row.tiles[spot.focus].item.id !== spot.itemId))
        for (i = 0; i < row.tiles.length; i++)
          if (row.tiles[i].item.id === spot.itemId) spot.focus = i;
      keepInView(spot, tileCount(row));
    });
    main.appendChild(shelfHero());
    shelfView.box = el("div", "shelf-rows");
    shelfView.box.id = "shelf-rows";
    main.appendChild(shelfView.box);
    main.appendChild(browseFooter());
    drawShelfRows();
    showTileInfo(rows[r], shelfSpot(state, rows[r]).focus);
    if (S.zone === "nav") focus("tab-" + S.nav);
    else {
      S.zone = "rows";
      focusShelf();
    }
    refreshFooter();
    refreshBrandHint();
  }
  // Arrows on a shelf: Left/Right along the row, Up/Down to the tile in the same screen column of the next
  // row (Up from the first row reaches the tabs). No wrapping.
  function shelfArrow(code) {
    var view = shelfView,
      state,
      r,
      row,
      spot,
      target,
      next;
    if (!view || !view.rows.length || !view.box) {
      if (code === 38) toNav();
      return;
    }
    state = S.shelf[view.name];
    state.touched = true;
    r = shelfRowIndex(state, view.rows);
    row = view.rows[r];
    spot = shelfSpot(state, row);
    if (code === 37 || code === 39) {
      target = spot.focus + (code === 37 ? -1 : 1);
      if (target < 0 || target >= tileCount(row)) return;
      spot.focus = target;
      keepInView(spot, tileCount(row));
      if (view.nodes[r]) placeStrip(view.nodes[r].strip, spot);
      focusShelf();
      return;
    }
    target = r + (code === 38 ? -1 : 1);
    if (target < 0) return toNav();
    if (target >= view.rows.length) return;
    moveShelfRow(view, spot.focus - spot.scroll, target);
  }
  function moveShelfRow(view, slot, target) {
    var state = S.shelf[view.name],
      row = view.rows[target],
      spot = shelfSpot(state, row);
    spot.focus = spot.scroll + slot;
    keepInView(spot, tileCount(row));
    state.rowId = row.id;
    drawShelfRows();
    focusShelf();
  }
  // CH+/CH- on a shelf: two rows up or down, stopping at the first and last row.
  function pageShelf(d) {
    var view = shelfView,
      state,
      r,
      spot;
    if (!view || !view.rows.length || !view.box) return;
    state = S.shelf[view.name];
    state.touched = true;
    r = shelfRowIndex(state, view.rows);
    spot = shelfSpot(state, view.rows[r]);
    moveShelfRow(view, spot.focus - spot.scroll, Math.max(0, Math.min(view.rows.length - 1, r + 2 * d)));
  }
  // Discover.
  function resetDiscoverGrid() {
    S.discover.focus = 0;
    S.discover.top = 0;
    browse.results = null;
  }
  function discoverIndex() {
    return browse.index[S.discover.type === "series" ? "series" : "movies"];
  }
  // Genres some visible title has (USA only hides genres whose titles are all hidden).
  function discoverGenres(index) {
    return vodUsOnly() ? index.usGenres : index.genres;
  }
  function discoverListName(key) {
    var found = B.discoverLists(withTmdb()).filter(function (list) {
      return list.key === key;
    })[0];
    return found ? found.name : "";
  }
  // Puts the filters back on choices that exist: a list this catalogue offers, a genre it has.
  function fixDiscoverFilters(index) {
    var d = S.discover,
      lists = B.discoverLists(withTmdb()),
      opts = { usOnly: vodUsOnly(), genre: "" };
    if (!lists.some(function (list) { return list.key === d.list; })) {
      d.list = "az";
      ["popular", "recent"].some(function (key) {
        if (key === "popular" && !withTmdb()) return false;
        if (B.pick(index, key, opts, 0, 1).picked.length) {
          d.list = key;
          return true;
        }
        return false;
      });
      resetDiscoverGrid();
    }
    if (d.genre && !discoverGenres(index).some(function (genre) { return genre.key === d.genre; })) {
      d.genre = "";
      resetDiscoverGrid();
    }
  }
  // The grid's titles for the current filters, computed GRID_PAGE at a time until need titles are known.
  function discoverResults(need) {
    var d = S.discover,
      index = discoverIndex(),
      usOnly = vodUsOnly(),
      key = [d.type, d.list, d.genre, usOnly].join("|"),
      res = browse.results,
      picked;
    if (!res || res.key !== key || res.index !== index)
      res = browse.results = { key: key, index: index, positions: [], cursor: 0, done: false, opts: { usOnly: usOnly, genre: d.genre, seen: {} } };
    while (!res.done && res.positions.length < need) {
      picked = B.pick(index, d.list, res.opts, res.cursor, GRID_PAGE);
      res.positions = res.positions.concat(picked.picked);
      res.cursor = picked.cursor;
      res.done = picked.done;
    }
    return res;
  }
  function filterButton(id, label, value, run) {
    var b = button("", id, run);
    b.appendChild(el("span", "filter-label", label + ": "));
    b.appendChild(el("strong", "", value));
    b.onfocus = function () {
      S.zone = "filters";
      S.discover.filter = id;
      remember(id);
      refreshFooter();
      refreshBrandHint();
    };
    return b;
  }
  function discoverCount() {
    var res = browse.results,
      n = document.getElementById("discover-count");
    if (!n || !res) return;
    n.textContent = res.positions.length
      ? Math.min(S.discover.focus + 1, res.positions.length) + " / " + res.positions.length + (res.done ? "" : "+") + " titles"
      : "";
  }
  function renderDiscover() {
    main.textContent = "";
    tileTitles = {};
    var d = S.discover,
      ready = browseReady(),
      index = discoverIndex(),
      head = el("div", "discover-head"),
      filters = el("div", "filter-row"),
      genre = null,
      count = el("div", "discover-count", ""),
      res = null,
      grid,
      marks,
      row,
      line,
      c,
      n;
    if (ready && store.settings.source) {
      fixDiscoverFilters(index);
      genre = discoverGenres(index).filter(function (g) { return g.key === d.genre; })[0];
      res = discoverResults((d.top + GRID_ROWS + 3) * GRID_COLS);
    }
    filters.appendChild(filterButton("discover-type", "Type", d.type === "series" ? "Series" : "Movies", chooseType));
    filters.appendChild(filterButton("discover-list", "List", res ? discoverListName(d.list) : "…", chooseList));
    filters.appendChild(filterButton("discover-genre", "Genre", genre ? genre.name : "All", chooseGenre));
    head.appendChild(filters);
    count.id = "discover-count";
    head.appendChild(count);
    main.appendChild(head);
    if (!res || !res.positions.length) {
      main.appendChild(browseStatus("discover", ready));
      if (S.zone === "posters") S.zone = "filters";
    } else {
      d.focus = Math.max(0, Math.min(d.focus, res.positions.length - 1));
      row = Math.floor(d.focus / GRID_COLS);
      if (row < d.top) d.top = row;
      if (row > d.top + GRID_ROWS - 1) d.top = row - GRID_ROWS + 1;
      res = discoverResults((d.top + GRID_ROWS + 3) * GRID_COLS);
      marks = libraryMarks();
      grid = el("div", "poster-grid");
      grid.id = "discover-grid";
      for (row = d.top; row < d.top + GRID_ROWS + 1; row++) {
        line = el("div", "grid-row");
        for (c = 0; c < GRID_COLS; c++) {
          n = row * GRID_COLS + c;
          if (n >= res.positions.length) break;
          line.appendChild(discoverTile(n, { kind: d.type, item: index.titles[res.positions[n]].item }, marks));
        }
        if (!line.children.length) break;
        // The third row only peeks in; its posters load when it scrolls into view.
        if (row < d.top + GRID_ROWS) loadPosters(line.children, 0, GRID_COLS);
        grid.appendChild(line);
      }
      main.appendChild(grid);
    }
    main.appendChild(browseFooter());
    discoverCount();
    if (S.zone === "nav") focus("tab-" + S.nav);
    else if (S.zone === "posters") focus("card-" + d.focus);
    else {
      S.zone = "filters";
      focus(d.filter) || focus("discover-list");
    }
    refreshFooter();
    refreshBrandHint();
  }
  function discoverTile(n, tile, marks) {
    var id = "card-" + n;
    return posterTile(id, tile, marks, function () {
      S.zone = "posters";
      S.discover.focus = n;
      remember(id);
      discoverCount();
      refreshFooter();
      refreshBrandHint();
    });
  }
  // Arrows in Discover: the filters are one row (Up: tabs, Down: the grid); the grid moves by poster without
  // wrapping, Up from its first row reaches the last focused filter, Down from a column past a short last row
  // lands on its last poster. More titles are computed as the grid scrolls.
  function discoverArrow(code) {
    var d = S.discover,
      res = browse.results,
      n = d.focus,
      col = n % GRID_COLS;
    if (S.zone === "filters") {
      if (code === 37 || code === 39) moveInRows([["discover-type", "discover-list", "discover-genre"]], code);
      else if (code === 38) toNav();
      else if (res && res.positions.length) {
        S.zone = "posters";
        renderDiscover();
      }
      return;
    }
    if (!res || !res.positions.length) {
      if (code === 38) {
        S.zone = "filters";
        renderDiscover();
      }
      return;
    }
    if (code === 37) {
      if (col > 0) moveDiscover(n - 1);
    } else if (code === 39) {
      if (col < GRID_COLS - 1 && n + 1 < res.positions.length) moveDiscover(n + 1);
    } else if (code === 38) {
      if (n < GRID_COLS) {
        S.zone = "filters";
        renderDiscover();
      } else moveDiscover(n - GRID_COLS);
    } else {
      res = discoverResults(n + GRID_COLS * (GRID_ROWS + 3));
      if (n + GRID_COLS < res.positions.length) moveDiscover(n + GRID_COLS);
      else if (Math.floor((res.positions.length - 1) / GRID_COLS) > Math.floor(n / GRID_COLS))
        moveDiscover(res.positions.length - 1);
    }
  }
  function moveDiscover(n) {
    var d = S.discover,
      row = Math.floor(n / GRID_COLS);
    d.focus = n;
    if (row < d.top || row > d.top + GRID_ROWS - 1) {
      d.top = row < d.top ? row : row - GRID_ROWS + 1;
      renderDiscover();
    } else focus("card-" + n);
  }
  // CH+/CH- in the grid: two rows up or down, keeping the column where it can.
  function pageDiscover(d) {
    var res = browse.results,
      n = S.discover.focus,
      target;
    if (!res || !res.positions.length) return;
    if (d > 0) res = discoverResults(n + GRID_COLS * (GRID_ROWS * 2 + 3));
    target = Math.max(0, Math.min(res.positions.length - 1, n + d * GRID_ROWS * GRID_COLS));
    if (target < n && n - target < GRID_COLS * GRID_ROWS) target = n % GRID_COLS;
    if (target !== n) moveDiscover(target);
  }
  // The filter choosers: list dialogs on the current choice; choosing one returns focus to its filter.
  function chooser(title, text, choices, current, apply) {
    var focusAt = 0;
    showDialog(
      title,
      text,
      choices.map(function (choice, i) {
        if (choice.key === current) focusAt = i;
        return {
          text: (choice.key === current ? "✓ " : "") + choice.name,
          run: function () {
            if (choice.key !== current) {
              apply(choice.key);
              resetDiscoverGrid();
            }
            closeDialog();
          },
        };
      }),
      { list: true, focus: focusAt }
    );
  }
  function chooseType() {
    chooser("Type", "Show movies or series.", [{ key: "movies", name: "Movies" }, { key: "series", name: "Series" }], S.discover.type, function (key) {
      S.discover.type = key;
      S.discover.genre = "";
    });
  }
  function chooseList() {
    if (!discoverIndex()) return;
    chooser("List", "Choose which titles to show and their order.", B.discoverLists(withTmdb()), S.discover.list, function (key) {
      S.discover.list = key;
    });
  }
  function chooseGenre() {
    var index = discoverIndex();
    if (!index) return;
    chooser("Genre", "Show one genre, or all of them.", [{ key: "", name: "All" }].concat(discoverGenres(index)), S.discover.genre, function (key) {
      S.discover.genre = key;
    });
  }
  // Adds a movie or series to the Library or removes it (the check badge on its posters).
  function toggleTitleFavorite(item) {
    store.toggleFavourite(item.id);
    toast(
      store.isFavourite(item.id)
        ? item.name + " added to your Library"
        : item.name + " removed from your Library"
    );
    if (S.detail) {
      S.detail.keepFocus = "detail-fav";
      renderDetail();
    } else render();
  }
  // The title a held OK saves to or removes from the Library: a focused poster on Home, Discover or Library.
  function heldTitle() {
    var a = document.activeElement;
    if (S.dialog || S.fullscreen || S.detail || !a || !isBrowseTab(S.tab)) return null;
    return (a.id && tileTitles[a.id]) || null;
  }
  // hint (series): { resume: episode id } or { next: { season, episode } } picks the episode focused first.
  function openDetail(item, kind, hint) {
    var origin =
      S.detail && S.detail.item.id === item.id
        ? S.detail.origin
        : { tab: S.tab, zone: S.zone, focus: S.focusId };
    S.detail = {
      item: item,
      kind: kind,
      origin: origin,
      resume: (hint && hint.resume) || null,
      next: (hint && hint.next) || null,
    };
    S.detailInfo = null;
    S.season = 0;
    S.zone = "detail";
    renderNav();
    renderDetail();
    requestTrailer(S.detail);
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
        detail.origin && detail.origin.tab === SEARCH
          ? "← Back to search"
          : "← Back to " + sectionName(detail.origin ? detail.origin.tab : HOME),
        "detail-back",
        backDetail
      )
    );
    var favButton = button(
      store.isFavourite(item.id) ? "✓ In Library" : "+ Add to Library",
      "detail-fav",
      function () {
        toggleTitleFavorite(item);
      }
    );
    // Trailer follows Add to Library wherever that is, and only once a trailer was found.
    function addFav() {
      copy.appendChild(favButton);
      if (detail.trailer) copy.appendChild(trailerButton(detail.trailer));
    }
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
      addFav();
    } else if (!info) {
      addFav();
      copy.appendChild(el("div", "loading", "Loading episodes…"));
    } else if (info.error) {
      addFav();
      copy.appendChild(
        button("Retry episodes", "detail-retry", function () {
          openDetail(item, "series");
        })
      );
    } else {
      var seasons = info.seasons || [];
      addFav();
      // Opened from Continue watching: the episode being watched, or the one after the finished one.
      if (seasons.length && (detail.resume || detail.next)) {
        var opening = B.episodeToOpen(seasons, detail.resume, detail.next);
        // The finished episode was the last one: the series leaves Continue watching.
        if (!opening && detail.next && !detail.resume && store.clearUpNext) store.clearUpNext(item.id);
        detail.resume = detail.next = null;
        if (opening) {
          S.season = opening.season;
          detail.lastEpisodeFocus = "episode-" + opening.episode;
        }
      }
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
                playVod(episodeOf(item, episode), (resume && resume.position) || 0);
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
    var keep = detail.keepFocus;
    detail.keepFocus = null;
    if (keep && focus(keep)) return;
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
  // An episode as played and saved: it names its series, so Continue watching can offer the series.
  function episodeOf(series, episode) {
    var result = {},
      key;
    for (key in episode)
      if (Object.prototype.hasOwnProperty.call(episode, key)) result[key] = episode[key];
    result.seriesId = series.id;
    result.seriesName = series.name;
    return result;
  }
  function backDetail() {
    var origin = S.detail && S.detail.origin;
    S.detail = null;
    S.detailInfo = null;
    S.tab = origin ? origin.tab : S.tab;
    S.nav = S.tab;
    S.zone = origin ? origin.zone : pageZone(S.tab);
    S.focusId = origin ? origin.focus : null;
    render();
  }
  function playVod(item, position) {
    if (dualActive) stopDual();
    store.recordSeen(item.seriesId || item.id);
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
    startOutside(item);
    enterFullscreen();
  }

  // ---------------------------------------------------------------- subtitles and trailers (docs/extras.md)
  // What a lookup names a movie or series by (Which ids an app sends): the provider's TMDB id, else the one the title
  // matched in the catalog rows, else its name and year (js/data.js leaves out a title with neither).
  function titleRef(kind, item) {
    var index = browse.index[kind],
      at = index && item ? index.byId[item.id] : undefined,
      entry = at === undefined ? null : index.titles[at];
    if (!item) return null;
    return {
      tmdb: item.tmdb ? String(item.tmdb) : (entry && entry.tmdb) || "",
      name: item.name,
      year: entry ? entry.year : B.titleYear(item),
    };
  }
  // The OpenSubtitles tracks of the movie or episode playing: looked up when it starts, listed in the subtitle chooser
  // after the stream's own tracks and drawn here at the player's position, as plain text (textContent, never markup).
  // A file is fetched only when its track is shown, and the stream's own subtitles are off meanwhile. Live channels
  // never look up. outside: { id, state: "pending" or "ready", tracks, credit, showing (a track or -1), picked
  // (the viewer chose a track), failed (the automatic choice could not load), cues, timer }.
  var outside = null;
  function startOutside(item) {
    var record, series, ref;
    stopOutside();
    if (!extras || !item || !item.id) return;
    if (item.seriesId) {
      // An episode: its series' TMDB id (or name and year), with the season and episode numbers.
      series =
        S.detail && S.detail.item && S.detail.item.id === item.seriesId
          ? S.detail.item
          : findTitle("series", item.seriesId);
      ref = series ? titleRef("series", series) : null;
      if (ref) {
        ref.type = "episode";
        ref.season = item.season;
        ref.episode = item.episode;
      }
    } else {
      ref = titleRef("movies", item);
      if (ref) ref.type = "movie";
    }
    record = outside = {
      id: item.id,
      state: "pending",
      tracks: [],
      credit: "",
      showing: -1,
      picked: false,
      failed: false,
      cues: null,
      timer: null,
    };
    extras.subtitles(ref, function (answer) {
      if (outside !== record) return;
      record.state = "ready";
      record.tracks = (answer && answer.tracks) || [];
      record.credit = (answer && answer.credit) || "";
      if (player.refreshSubtitles) player.refreshSubtitles();
    });
  }
  // The record of the movie or episode the player has now, or null.
  function currentOutside() {
    var request = player.state && player.state.request;
    return outside && request && !request.live && request.id === outside.id ? outside : null;
  }
  // For the player's automatic choice (js/player.js): "showing", "available", "pending" or "".
  function outsideSubtitles() {
    var o = currentOutside();
    if (!o) return "";
    if (o.showing >= 0) return "showing";
    if (o.picked || o.failed) return "";
    if (o.state === "pending") return "pending";
    return o.tracks.length ? "available" : "";
  }
  // The player's automatic choice is the first OpenSubtitles track.
  function autoOutside() {
    var o = currentOutside();
    if (o && o.showing < 0 && o.tracks.length) showOutside(0, false);
  }
  // Shows track index; picked: the viewer chose it in the menu (a failure then says so and leaves subtitles off).
  function showOutside(index, picked) {
    var o = currentOutside(),
      track = o && o.tracks[index];
    if (!track) return;
    hideOutside();
    o.showing = index;
    if (picked) o.picked = true;
    extras.file(track.vtt, function (cues) {
      if (currentOutside() !== o || o.showing !== index || o.cues) return;
      if (!cues) {
        o.showing = -1;
        if (picked) toast("These subtitles couldn't be loaded.");
        else o.failed = true;
        return;
      }
      o.cues = cues;
      o.timer = setInterval(outsideTick, 200);
      outsideTick();
    });
  }
  function hideOutside() {
    var o = outside;
    if (!o) return;
    if (o.timer !== null) clearInterval(o.timer);
    o.timer = null;
    o.cues = null;
    if (o.showing >= 0) {
      o.showing = -1;
      drawOutside("");
    }
  }
  function stopOutside() {
    hideOutside();
    outside = null;
  }
  // The cues at the player's position, five times a second, at once after a seek (onPlayerTime) and unchanged while
  // paused; nothing outside full-screen playback.
  function outsideTick() {
    var o = currentOutside();
    if (!o) {
      if (outside && outside.timer !== null) stopOutside();
      return;
    }
    if (o.showing < 0 || !o.cues) return;
    drawOutside(
      S.fullscreen
        ? D.extras.vttTextAt(o.cues, player.currentTime ? player.currentTime() : player.state.position)
        : ""
    );
  }
  function drawOutside(value) {
    var shown = subtitleLayer.className.indexOf("hidden") < 0 ? subtitleLayer.textContent : "";
    if (value === shown) return;
    clearTimeout(subtitleTimer);
    subtitleLayer.textContent = "";
    if (!value) {
      subtitleLayer.className = "subtitle-layer hidden";
      return;
    }
    subtitleLayer.appendChild(el("span", "", value));
    subtitleLayer.className = "subtitle-layer" + (S.controls ? " raised" : "");
  }
  // The Trailer button (docs/extras.md, The Trailer button): looked up once when a movie or series page opens, and
  // added after Add to Library only when a trailer was found, in place and without taking focus.
  function requestTrailer(detail) {
    var ref;
    if (!extras || !detail || detail.trailerAsked) return;
    detail.trailerAsked = true;
    ref = titleRef(detail.kind, detail.item);
    if (ref) ref.type = detail.kind === "series" ? "tv" : "movie";
    extras.trailer(ref, function (answer) {
      var fav = document.getElementById("detail-fav"),
        trailer = answer && answer.trailer;
      if (S.detail !== detail || !trailer || detail.trailer) return;
      detail.trailer = trailer;
      if (!fav || !fav.parentNode || document.getElementById("detail-trailer")) return;
      if (fav.nextSibling) fav.parentNode.insertBefore(trailerButton(trailer), fav.nextSibling);
      else fav.parentNode.appendChild(trailerButton(trailer));
    });
  }
  function trailerButton(trailer) {
    return button("\u25b6 Trailer", "detail-trailer", function () {
      playTrailer(trailer);
    });
  }
  // The YouTube app, then the QR code when it does not open, unless the viewer has moved on meanwhile.
  function trailerElsewhere(trailer) {
    openYouTube(trailer.key, function () {
      if (S.detail && S.detail.trailer === trailer && !S.fullscreen && !S.dialog) trailerDialog(trailer);
    });
  }
  // The trailer player (docs/extras.md, The trailer player): the trailer plays in Tuner, full screen over the details
  // page, in lumanest.tv's player page (an iframe; js/data.js, TunerData.extras, has its address, messages and keys).
  // Back closes it and focus returns to Trailer. A player error, no "ready" within 12 seconds or a frame that cannot
  // load closes it and opens the YouTube app instead, then the QR dialog. The keys stay in this document (the frame
  // never keeps focus); a key that reaches the frame anyway comes back as a message. The app's own lines (loading,
  // "Press OK to play", the key hint) sit in a bar above the frame, never over the player (YouTube's Required Minimum
  // Functionality forbids anything in front of an embedded player). TRAILER_IN_APP false: Trailer goes straight to
  // the YouTube app, as before 1.6.1.
  var TRAILER_IN_APP = true,
    TRAILER_READY_WAIT = 12000,
    // After "ready", a trailer that has not started within this time waits for OK (autoplay refused).
    TRAILER_PROMPT_WAIT = 3000,
    TRAILER_HINT = "OK pause/play \u00b7 Left/Right 10 s \u00b7 Back close",
    trailerPlay = null;
  function playTrailer(trailer) {
    var X = D.extras,
      url = TRAILER_IN_APP && X && X.trailerFrameUrl ? X.trailerFrameUrl(trailer.key) : "",
      t,
      layer,
      bar,
      stage,
      frame;
    if (!url) return trailerElsewhere(trailer);
    closeTrailer(false);
    layer = el("div", "trailer-layer");
    layer.id = "trailer-layer";
    layer.setAttribute("tabindex", "-1");
    frame = el("iframe", "trailer-frame");
    frame.id = "trailer-frame";
    frame.setAttribute("tabindex", "-1");
    frame.setAttribute("allow", "autoplay; encrypted-media");
    // No popups and no top-level navigation from the frame or the YouTube player inside it (its "Watch on YouTube"
    // and end-screen links): Tizen's runtime would stack such a window over Tuner, with none of Tuner's keys.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    frame.setAttribute("title", "Trailer");
    t = trailerPlay = {
      trailer: trailer,
      layer: layer,
      frame: frame,
      status: el("p", "trailer-status", "Loading " + trailer.name + "\u2026"),
      ready: false,
      started: false,
      timer: null,
      promptTimer: null,
    };
    frame.onerror = function () {
      if (trailerPlay === t) trailerFailed();
    };
    bar = el("div", "trailer-bar");
    bar.appendChild(t.status);
    bar.appendChild(el("p", "trailer-hint", TRAILER_HINT));
    stage = el("div", "trailer-stage");
    stage.appendChild(frame);
    layer.appendChild(bar);
    layer.appendChild(stage);
    frame.src = url;
    document.body.appendChild(layer);
    layer.focus();
    t.timer = setTimeout(function () {
      if (trailerPlay === t) trailerFailed();
    }, TRAILER_READY_WAIT);
  }
  // Closes the trailer at once (the frame goes, so its sound stops); restore false leaves focus where it is.
  function closeTrailer(restore) {
    var t = trailerPlay;
    if (!t) return false;
    trailerPlay = null;
    clearTimeout(t.timer);
    clearTimeout(t.promptTimer);
    t.frame.onerror = null;
    try {
      t.frame.src = "about:blank";
    } catch (e) {}
    if (t.frame.parentNode) t.frame.parentNode.removeChild(t.frame);
    if (t.layer.parentNode) t.layer.parentNode.removeChild(t.layer);
    if (restore !== false && !focus("detail-trailer")) ensureFocus();
    return true;
  }
  // In-app playback failed: the YouTube app instead, then the QR dialog.
  function trailerFailed() {
    var t = trailerPlay;
    if (!t) return;
    closeTrailer(true);
    trailerElsewhere(t.trailer);
  }
  function trailerSend(action) {
    var t = trailerPlay,
      command = D.extras.trailerCommand(action),
      target = t && t.frame.contentWindow;
    if (!command || !target || !t.ready) return;
    try {
      target.postMessage(command, D.extras.FRAME_ORIGIN);
    } catch (e) {}
  }
  // The status line: text, or hidden when empty.
  function trailerStatus(text) {
    var t = trailerPlay;
    if (!t) return;
    t.status.textContent = text;
    t.status.className = "trailer-status" + (text ? "" : " hidden");
  }
  // An action of the remote or the frame (TunerData.extras.trailerKeyAction / trailerMessageAction). repeat: a held
  // key's repeats, which never close.
  function trailerAction(action, repeat) {
    var t = trailerPlay;
    if (!t || !action) return;
    if (action === "close") {
      if (!repeat) closeTrailer(true);
    } else if (action === "fallback") trailerFailed();
    else if (action === "stop") {
      trailerSend("stop");
      closeTrailer(true);
    } else if (action === "ready") {
      t.ready = true;
      clearTimeout(t.timer);
      clearTimeout(t.promptTimer);
      trailerStatus("");
      t.promptTimer = setTimeout(function () {
        if (trailerPlay === t && !t.started) trailerStatus("Press OK to play");
      }, TRAILER_PROMPT_WAIT);
    } else if (/^(toggle|play|pause|rewind|forward)$/.test(action)) {
      // Until the trailer has played, OK and Play/Pause send "play": a toggle would pause a trailer that is still
      // loading ("Press OK to play" can show while it is), and it would never start.
      if (!(repeat && action === "toggle")) trailerSend(action === "toggle" && !t.started ? "play" : action);
    } else if (action === "playing") {
      t.started = true;
      trailerStatus("");
    } else if (t.ready && !t.started && action !== "buffering" && action !== "unstarted") {
      // Paused or cued before the trailer ever played: autoplay was refused, so it waits for OK. "Unstarted" is also
      // how a trailer that will autoplay begins (buffering follows), so a refusal that only says that is left to the
      // prompt timer set on "ready".
      trailerStatus("Press OK to play");
    }
  }
  // Frame messages: only from lumanest.tv, only from this overlay's frame, only in the documented shape.
  function trailerMessage(event) {
    var t = trailerPlay,
      X = D.extras;
    if (!t || !event || event.origin !== X.FRAME_ORIGIN || !event.source || event.source !== t.frame.contentWindow)
      return;
    trailerAction(X.trailerMessageAction(X.parseFrameMessage(event.data)), false);
  }
  window.addEventListener("message", trailerMessage);
  // The frame took focus (a click, its own player): focus comes back here, so the remote's keys reach this document.
  function trailerRefocus() {
    var t = trailerPlay;
    if (t && document.activeElement !== t.layer) t.layer.focus();
  }
  // Samsung: the YouTube app opened on the video by an application control (docs/extras.md, Trailer, Samsung), each
  // known YouTube app id in turn; onFail (the QR dialog) when none opens or the TV lacks the API. Samsung does not
  // document this payload: if a TV opens YouTube's home page instead, set YOUTUBE_LAUNCH to false (QR dialog only).
  var YOUTUBE_LAUNCH = true,
    YOUTUBE_APPS = ["111299001912", "9Ur5IzDKqV.TizenYouTube"];
  function openYouTube(key, onFail) {
    var tizen = window.tizen,
      at = 0,
      finished = false;
    function fail() {
      if (finished) return;
      finished = true;
      onFail();
    }
    function attempt() {
      var id = YOUTUBE_APPS[at++],
        settled = false;
      function failed() {
        if (settled || finished) return;
        settled = true;
        if (at < YOUTUBE_APPS.length) attempt();
        else fail();
      }
      try {
        tizen.application.launchAppControl(
          new tizen.ApplicationControl("http://tizen.org/appcontrol/operation/view", null, null, null, [
            new tizen.ApplicationControlData("PAYLOAD", [JSON.stringify({ values: "v=" + key })]),
          ]),
          id,
          function () {
            settled = finished = true;
          },
          failed
        );
      } catch (e) {
        failed();
      }
    }
    if (
      !YOUTUBE_LAUNCH ||
      !/^[A-Za-z0-9_-]{11}$/.test(key) ||
      !tizen ||
      !tizen.application ||
      typeof tizen.application.launchAppControl !== "function" ||
      typeof tizen.ApplicationControl !== "function" ||
      typeof tizen.ApplicationControlData !== "function"
    )
      return fail();
    attempt();
  }
  // The QR dialog: the trailer on a phone (https://youtu.be/<key>), drawn as the pairing code is. Close returns to
  // Trailer.
  function trailerDialog(trailer) {
    showDialog("Watch the trailer on your phone", "Scan the code with your phone's camera.", [], {
      qr: trailer.qr,
      qrText: trailer.short,
    });
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
      stopOutside();
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
    if (outside && outside.cues) outsideTick();
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
  // The stream's own cues (AVPlay's onsubtitlechange). An OpenSubtitles track keeps the layer while it is shown.
  function showSubtitleText(text, duration) {
    var o = currentOutside();
    if (o && o.showing >= 0) return;
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
  // Off, the stream's tracks, then the title's OpenSubtitles tracks with the credit under them (not a choice).
  function subtitleDialog() {
    var tracks = player.tracks().subtitles || [],
      o = currentOutside(),
      extra = o ? o.tracks : [],
      outsideOn = !!o && o.showing >= 0,
      on = !outsideOn && !!(player.subtitlesShowing && player.subtitlesShowing()),
      selected = 0;
    if (!tracks.length && !extra.length) {
      showDialog(
        "Subtitles",
        o && o.state === "pending"
          ? "Looking for subtitles for this title. Try again in a moment."
          : "No subtitles in this stream.",
        []
      );
      return;
    }
    // A choice here is the viewer's: the automatic choice no longer changes it for this title.
    function choose() {
      if (o) o.picked = true;
      hideOutside();
    }
    var actions = [
      {
        text: (on || outsideOn ? "" : CHECK) + "Off",
        run: function () {
          choose();
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
          choose();
          player.selectTrack("TEXT", track.index);
          closeDialog();
          toast("Subtitles: " + name);
        },
      });
    });
    extra.forEach(function (track, i) {
      var chosen = outsideOn && o.showing === i;
      if (chosen) selected = actions.length;
      actions.push({
        text: (chosen ? CHECK : "") + track.label,
        run: function () {
          // The stream's own subtitles go off while an OpenSubtitles track is shown.
          player.selectTrack("TEXT", -1);
          closeDialog();
          toast("Subtitles: " + track.label);
          showOutside(i, true);
        },
      });
    });
    showDialog(
      "Subtitles",
      "Choose subtitles or captions for this " + (extra.length ? "title." : "stream."),
      actions,
      { list: true, focus: selected, footnote: extra.length ? o.credit || SUBTITLES_CREDIT : "" }
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
  // action; opts.closeText / opts.focusClose: the close button's label and whether it starts focused;
  // opts.note: a smaller line under the text; opts.footnote: one under the actions; opts.qr / opts.qrText: a QR
  // code (rows of 0 and 1 from lumanest.tv) and the text under it, between the title and the text.
  function showDialog(title, text, actions, opts) {
    opts = opts || {};
    actions = actions || [];
    if (!S.dialog) dialogReturn = { id: S.focusId, zone: S.zone };
    S.dialog = true;
    dialogLayer.className = "";
    dialogLayer.textContent = "";
    var box = el("div", (opts.list ? "dialog choices" : "dialog") + (opts.qrText ? " qr-dialog" : ""));
    box.appendChild(el("h2", "", title));
    if (opts.qrText) box.appendChild(qrBlock(opts.qr, opts.qrText));
    box.appendChild(el("p", "", text));
    if (opts.note) box.appendChild(el("p", "dialog-note", opts.note));
    actions.forEach(function (action, i) {
      box.appendChild(
        button(action.text, "dialog-" + i, function () {
          action.run();
        })
      );
    });
    if (opts.footnote) box.appendChild(el("p", "dialog-note footnote", opts.footnote));
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
  // A QR code drawn as the pairing code is (js/pairing.js), with its text under it. Without the rows, the text alone.
  function qrBlock(rows, caption) {
    var block = el("div", "dialog-qr"),
      code,
      canvas;
    if (rows && window.TunerPairing && typeof window.TunerPairing.drawQr === "function") {
      code = el("div", "dialog-qr-code");
      canvas = el("canvas");
      canvas.width = 360;
      canvas.height = 360;
      code.appendChild(canvas);
      try {
        window.TunerPairing.drawQr(canvas, rows);
        block.appendChild(code);
      } catch (e) {}
    }
    block.appendChild(el("p", "dialog-qr-text", caption));
    return block;
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
  // Whether USA only shows a movie or series: its index entry decides; until the catalogue is indexed (a
  // large one is prepared in slices) the category check alone does.
  var searchCategoryCheck = { movies: null, series: null };
  function searchFilter(kind) {
    var index = browse.index[kind],
      check = searchCategoryCheck[kind];
    if (!check || check.cats !== S.cats[kind])
      check = searchCategoryCheck[kind] = { cats: S.cats[kind], passes: B.categoryCheck(S.cats[kind]) };
    return function (item) {
      var at = index ? index.byId[item.id] : undefined;
      return at !== undefined ? index.titles[at].us : check.passes(item);
    };
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
    var found = [],
      usOnly = vodUsOnly();
    // Movies & Series: USA only applies here as on Home and Discover (the channels have their own switch).
    if (usOnly) browseReady();
    ["live", "movies", "series"].forEach(function (kind) {
      var shows = kind === "live" || !usOnly ? null : searchFilter(kind);
      S.catalogs[kind].some(function (item) {
        if (item.name.toLowerCase().indexOf(q) >= 0 && (!shows || shows(item)))
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
    extras.appendChild(el("h2", "", "Playback, privacy and start"));
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
              ? "Subtitles start automatically when a stream has them, or from OpenSubtitles for movies and episodes."
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
    extraRow.appendChild(
      button(
        "Open on: " + (startTab() === LIVE ? "Live TV" : "Home"),
        "start-setting",
        function () {
          store.saveSettings({ startOn: startTab() === LIVE ? "home" : "live" });
          renderSettings();
          focus("start-setting");
          toast(startTab() === LIVE ? "Tuner opens on Live TV." : "Tuner opens on Home.");
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
        vodUsOnly() ? "Movies & Series: USA only" : "Movies & Series: All",
        "vod-region-setting",
        function () {
          store.saveSettings({ vodUsOnly: !vodUsOnly() });
          browse.home = null;
          browse.results = null;
          renderSettings();
          focus("vod-region-setting");
          toast(
            vodUsOnly()
              ? "Movies & Series: showing USA titles only."
              : "Movies & Series: showing every title on your line."
          );
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
        "Arrows move, OK selects, Back goes up a level. Hold OK saves a channel or a title. Guide: ← → schedule, CH +/− pages, numbers jump to a channel."
      )
    );
    side.appendChild(
      button("About Tuner", "about-tuner", function () {
        showDialog(
          "Tuner for Samsung TV",
          "Version 1.6.1 · Samsung TV\nLive TV, guide, movies, series and Favorites. Two-channel PiP works on supported TVs and playlists. Embedded torrent playback is not available on Samsung.",
          [],
          {
            note:
              (withTmdb() ? TMDB_NOTICE + "\n" : "") +
              SUBTITLES_CREDIT +
              "\n" +
              PRIVACY_NOTICE +
              (TRAILER_IN_APP ? "\n" + YOUTUBE_TERMS_NOTICE : ""),
          }
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
        openTab(startTab());
        toast(
          startTab() === LIVE
            ? "Paired with LumaNest TV. Loading your channels."
            : "Paired with LumaNest TV. Loading your playlist."
        );
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
    openTab(startTab());
    toast(
      startTab() === LIVE
        ? "Playlist saved. Loading your channels."
        : "Playlist saved. Loading your playlist."
    );
  }
  // redelivered: the provider sent the catalogue again (the lock did not change).
  function applyAdultFilter(kind, redelivered) {
    var source = rawCatalogs[kind],
      shown =
        adultUnlocked || !D.adultFilter
          ? source
          : D.adultFilter(source.items, source.categories);
    S.catalogs[kind] = shown.items;
    S.cats[kind] = shown.categories;
    if (kind === "live") return;
    if (redelivered) catalogueRedelivered(kind);
    else invalidateBrowse(kind);
  }
  function setAdultUnlocked(value) {
    adultUnlocked = !!value;
    // The titles shown change at once: each index is dropped, not kept while it is rebuilt.
    ["live", "movies", "series"].forEach(function (kind) {
      applyAdultFilter(kind, false);
    });
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
    S.row = 0;
    S.offset = 0;
    resetDiscoverGrid();
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
    stopOutside();
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
    if (!sameCatalog) {
      invalidateBrowse("movies");
      invalidateBrowse("series");
      S.shelf.home = { rowId: null, rows: {} };
      S.shelf.library = { rowId: null, rows: {}, fromHome: false };
      S.discover.list = null;
      S.discover.genre = "";
      resetDiscoverGrid();
    }
    client = D.createClient(store.settings.source, {
      zip: store.settings.zip,
      usOnly: !!store.settings.usOnly,
      onCatalog: function (kind, items, categories) {
        rawCatalogs[kind] = { items: items || [], categories: categories || [] };
        applyAdultFilter(kind, true);
        if (kind === "live" && S.tab === 3 && !S.fullscreen && !S.dialog) renderSearchResults();
        if (kind === "live") resumeGuidePreview();
        if (!S.fullscreen && !S.dialog && S.tab === 0 && kind === "live") render();
        else if (kind !== "live") browseChanged();
      },
      onStatus: function (kind, status) {
        S.status[kind] = status;
        if (!S.fullscreen && !S.dialog && S.tab === 0 && kind === "live") render();
        else if (kind !== "live") browseChanged();
      },
    });
    client.load(force === true);
  }
  // Back goes up exactly one level and lands where the user came from.
  function back() {
    S.shelfWaiting = false;
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
    if (S.zone !== "nav" && S.tab === DISCOVER) {
      if (S.discover.fromHome) backHome();
      else if (S.zone === "posters") {
        S.zone = "filters";
        renderDiscover();
      } else toNav();
      return;
    }
    if (S.zone !== "nav" && S.tab === LIBRARY && S.shelf.library.fromHome) {
      backHome();
      return;
    }
    if (S.zone !== "nav") {
      toNav();
      return;
    }
    if (S.tab !== startTab()) {
      openTab(startTab(), true);
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
    S.shelfWaiting = false;
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
        S.nav =
          tabOrder[
            Math.max(
              0,
              Math.min(tabOrder.length - 1, tabOrder.indexOf(S.nav) + (code === 37 ? -1 : 1))
            )
          ];
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
    if (S.tab === HOME || S.tab === LIBRARY) return shelfArrow(code);
    if (S.tab === DISCOVER) return discoverArrow(code);
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
    // The trailer player takes every key while it is open (and ignores those it has no use for). A PC keyboard's Tab
    // (9) does nothing either: it would move focus to the page behind the overlay.
    if (trailerPlay) {
      var action = D.extras.trailerKeyAction(code);
      if (action || code === 9) e.preventDefault();
      trailerAction(action, !!e.repeat);
      return;
    }
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
        var c = S.fullscreen ? S.watched : selectedLive(),
          title = heldTitle();
        if (c && canHoldFavorite()) {
          enterHeld = true;
          toggleFavorite(c);
        } else if (title) {
          enterHeld = true;
          toggleTitleFavorite(title.item);
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
      else if (S.tab === DISCOVER && !S.detail && S.zone === "posters") pageDiscover(up ? -1 : 1);
      else if ((S.tab === HOME || S.tab === LIBRARY) && !S.detail && S.zone === "rows") pageShelf(up ? -1 : 1);
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
    // OK's keydown set enterDown; while the trailer player is open it takes OK's keydown, so its release does nothing.
    if ((e.keyCode || e.which) !== 13 || !enterDown) return;
    var alreadyHandled = enterHeld;
    var held = enterHeld || Date.now() - enterDown >= 650;
    enterDown = 0;
    enterHeld = false;
    // The hold already ran its action while the key was down (it may have moved focus, such as to the
    // empty Library's button): the release does nothing more.
    if (alreadyHandled) return;
    var c = S.fullscreen ? S.watched : selectedLive(),
      title = held ? heldTitle() : null;
    if (held && c && canHoldFavorite()) {
      if (!S.dialog) toggleFavorite(c);
      return;
    }
    if (title) {
      toggleTitleFavorite(title.item);
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
    if (trailerPlay) setTimeout(trailerRefocus, 0);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      // Leaving the app (Home, Source) ends the trailer; it does not play on behind another app.
      closeTrailer(true);
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
    closeTrailer(false);
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
  // Open on Home, or on Live TV for customers who already watch channels here (decided once, then a setting).
  if (store.settings.startOn !== "home" && store.settings.startOn !== "live")
    store.saveSettings({
      startOn:
        store.settings.source && (store.lastWatched() || store.mostWatched().length)
          ? "live"
          : "home",
    });
  S.tab = store.settings.source ? startTab() : SETTINGS;
  S.nav = S.tab;
  S.zone = store.settings.source ? pageZone(S.tab) : "form";
  render();
  resize();
  if (store.settings.source) connect();
})(window, document);
