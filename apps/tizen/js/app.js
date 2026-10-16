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
    minute: 0,
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
      S.focusId = id;
      if (dualActive && S.tab === 5 && !S.dialog) dualFocusId = id;
    };
    return n;
  }
  function focus(id) {
    var n = document.getElementById(id);
    if (n && !n.disabled) {
      n.focus();
      S.focusId = id;
      if (
        n.parentNode &&
        /chip-row|cards|episodes/.test(n.parentNode.className)
      )
        scrollToElement(n);
    }
  }
  function scrollToElement(n) {
    var p = n.parentNode;
    if (n.offsetLeft < p.scrollLeft) p.scrollLeft = n.offsetLeft - 5;
    else if (n.offsetLeft + n.offsetWidth > p.scrollLeft + p.clientWidth)
      p.scrollLeft = n.offsetLeft + n.offsetWidth - p.clientWidth + 6;
    if (p.className === "episodes") {
      if (n.offsetTop < p.scrollTop) p.scrollTop = n.offsetTop;
      else if (n.offsetTop + n.offsetHeight > p.scrollTop + p.clientHeight)
        p.scrollTop = n.offsetTop + n.offsetHeight - p.clientHeight;
    }
  }
  function toast(message) {
    var n = document.getElementById("toast");
    n.textContent = message;
    n.className = "";
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
  function viewStart() {
    return Math.floor(Date.now() / 1800000) * 1800000 + S.minute * 60000;
  }
  function selectedAt() {
    return S.minute === 0 ? Date.now() : viewStart() + 900000;
  }
  function selectedProgram(channel) {
    var programs = (channel && S.guide[channel.id]) || [],
      at = selectedAt();
    return (
      programs.filter(function (p) {
        return p.start <= at && p.end > at;
      })[0] || null
    );
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
        S.guide[channel.id] = programs || [];
        delete S.guidesPending[channel.id];
        if (S.tab === 0 && !S.fullscreen && !S.dialog) renderGuide();
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
    label.appendChild(
      el("small", "", S.zone === "nav" ? "OK Open" : "Back Tabs")
    );
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
        S.focusId = b.id;
      };
      nav.appendChild(b);
    });
    topbar.appendChild(nav);
    topbar.appendChild(el("div", "clock", clock(Date.now())));
  }
  function openTab(i) {
    if (S.tab === 5 && i !== 5) stopDual();
    if (S.fullscreen) leaveFullscreen();
    closeDialog(false);
    S.detail = null;
    S.detailInfo = null;
    S.tab = i;
    S.nav = i;
    S.focusId = null;
    S.zone = i === 0 ? "grid" : i === 1 || i === 2 ? "cards" : "form";
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
  function statusEmpty(kind, text) {
    var box = el("div", "guide-status");
    var status = S.status[kind];
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
  function renderGuide() {
    if (S.fullscreen || S.tab !== 0 || S.detail) return;
    var old = S.focusId;
    main.textContent = "";
    var items = liveItems();
    S.row = Math.max(0, Math.min(S.row, items.length - 1));
    if (S.row < S.offset) S.offset = S.row;
    if (S.row >= S.offset + 4) S.offset = S.row - 3;
    S.offset = Math.max(0, Math.min(S.offset, Math.max(0, items.length - 4)));
    var c = items[S.row],
      p = selectedProgram(c),
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
      el("h1", "", p ? p.title : c ? c.name : "Welcome to Tuner")
    );
    var meta = el("div", "metadata");
    if (p) {
      if (p.start <= Date.now() && p.end > Date.now())
        meta.appendChild(el("span", "badge", "ON NOW"));
      meta.appendChild(
        document.createTextNode(clock(p.start) + " – " + clock(p.end))
      );
    } else
      meta.textContent = c
        ? "Live channel · Schedule unavailable"
        : "A guide made for your TV";
    copy.appendChild(meta);
    copy.appendChild(
      el(
        "p",
        "description",
        (p && p.description) ||
          (c
            ? "Browse channels and programs while the watched channel keeps playing. Press OK to watch."
            : "Live TV, Movies and Series in one simple place.")
      )
    );
    hero.appendChild(copy);
    var preview = el("div", "preview-frame");
    preview.id = "preview-frame";
    preview.setAttribute("role", "button");
    preview.tabIndex = 0;
    preview.onclick = function () {
      if (S.watched) enterFullscreen();
      else if (c) watch(c, false);
    };
    preview.onfocus = function () {
      S.zone = "actions";
      S.focusId = preview.id;
    };
    if (!S.watched)
      preview.appendChild(el("div", "empty-video", "Choose a channel"));
    else
      preview.appendChild(el("div", "watching", "Watching " + S.watched.name));
    preview.appendChild(
      el(
        "div",
        "preview-hint",
        S.watched ? "▶ OK Full screen" : "▶ OK Start preview"
      )
    );
    hero.appendChild(preview);
    if (c) {
      var actions = el("div", "hero-actions");
      actions.appendChild(
        button(
          store.isFavourite(c.id) ? "★ Saved" : "☆ Favorite",
          "guide-fav",
          function () {
            toggleFavorite(c);
          }
        )
      );
      actions.appendChild(
        button("Watch", "guide-watch", function () {
          watch(c, true);
        })
      );
      hero.appendChild(actions);
    }
    main.appendChild(hero);
    var cats = liveCategories(),
      chips = el("div", "chip-row");
    cats.forEach(function (cat, i) {
      var b = button(
        cat.name,
        "live-cat-" + i,
        function () {
          S.category = cat.id;
          S.row = 0;
          S.offset = 0;
          S.zone = "grid";
          renderGuide();
        },
        cat.id === S.category ? "active" : ""
      );
      b.onfocus = function () {
        S.zone = "categories";
        S.focusId = b.id;
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
      if (S.category === "__fav" || S.category === "__hot") {
        main.querySelector(".guide-status p").textContent =
          S.category === "__fav"
            ? "Hold OK on a channel, or choose its star, to save it here."
            : "Channels you watch will appear here automatically.";
        var emptyAction = document.getElementById("empty-action");
        emptyAction.textContent = "Browse all channels";
        emptyAction.onclick = function () {
          S.category = "__all";
          S.row = Math.max(0, S.catalogs.live.indexOf(S.watched));
          S.offset = Math.max(0, S.row - 3);
          S.zone = "grid";
          renderGuide();
        };
      }
    } else {
      var head = el("div", "time-header");
      head.appendChild(el("div", "today", S.minute ? "Schedule" : "Today"));
      var labels = el("div", "timeline-labels");
      for (var t = 0; t < 4; t++)
        labels.appendChild(el("span", "", clock(viewStart() + t * 1800000)));
      head.appendChild(labels);
      main.appendChild(head);
      items.slice(S.offset, S.offset + 4).forEach(function (channel, index) {
        var row = el("div", "guide-row");
        var cell = el(
          "div",
          "channel-cell" + (S.offset + index === S.row ? " selected" : "")
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
          listings = S.guide[channel.id] || [];
        var visible = listings.filter(function (q) {
          return q.end > viewStart() && q.start < viewStart() + 7200000;
        });
        if (!visible.length)
          visible = [
            {
              title: "Schedule unavailable",
              description: "Watch live",
              start: viewStart(),
              end: viewStart() + 7200000,
            },
          ];
        visible.forEach(function (q) {
          var left = Math.max(0, ((q.start - viewStart()) / 7200000) * 100),
            right = Math.min(100, ((q.end - viewStart()) / 7200000) * 100);
          var selected =
            S.offset + index === S.row &&
            q.start <= selectedAt() &&
            q.end > selectedAt();
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
              q.description === "Watch live"
                ? "Watch live"
                : clock(q.start) + " – " + clock(q.end)
            )
          );
          block.onclick = function () {
            S.row = S.offset + index;
            S.zone = "grid";
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
        el("span", "", S.row + 1 + " / " + items.length + " channels")
      );
      foot.appendChild(
        el(
          "span",
          "",
          "OK Watch / details  ·  Hold OK Favorite  ·  ← → Schedule  ·  CH +/− Page  ·  Back Tabs"
        )
      );
      main.appendChild(foot);
    }
    if (S.zone === "nav") focus("tab-" + S.nav);
    else if (S.zone === "categories")
      focus(old && document.getElementById(old) ? old : "live-cat-0");
    else if (S.zone === "actions")
      focus(old && document.getElementById(old) ? old : "preview-frame");
    else if (!items.length) {
      S.zone = "empty";
      focus("empty-action");
    }
    if (S.watched) previewRect();
  }
  function activateChannel(c, p) {
    if (p && p.start > Date.now()) {
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
  function watch(c, full) {
    if (!c) return;
    if (dualActive) stopDual();
    if (S.tab !== 0) {
      S.tab = 0;
      S.nav = 0;
      S.category = "__all";
      S.minute = 0;
      S.row = Math.max(0, S.catalogs.live.indexOf(c));
      S.offset = Math.max(0, S.row - 3);
      S.detail = null;
      S.detailInfo = null;
    }
    currentPlayItem = c;
    S.watched = c;
    store.recordWatched(c.id);
    // Open a full-screen stream with full-screen geometry, never the guide preview's.
    if (full) player.setRect(FULL_RECT);
    player.play({
      url: c.url,
      backups: c.backups,
      live: true,
      title: c.name,
      id: c.id,
    });
    if (full) enterFullscreen();
    else renderGuide();
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
        S.focusId = b.id;
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
          S.focusId = card.id;
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
  function leaveFullscreen() {
    S.fullscreen = false;
    S.zone = S.detail ? "detail" : S.tab === 0 ? "grid" : "form";
    S.focusId = null;
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
    }
    else if (S.tab === 0 && S.watched) {
      var hint = main.querySelector(".preview-hint");
      if (hint)
        hint.textContent =
          state.status === "loading"
            ? "Connecting…"
            : state.status === "error"
              ? "Playback unavailable · OK Retry"
              : "▶ OK Full screen";
    }
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
  function renderPlayerOverlay() {
    if (!S.fullscreen) return;
    var state = player.state || {},
      old = S.focusId;
    overlay.textContent = "";
    if (subtitleLayer.className.indexOf("hidden") < 0)
      subtitleLayer.className = "subtitle-layer" + (S.controls ? " raised" : "");
    if (S.controls || state.status === "error") {
      overlay.appendChild(
        el(
          "div",
          "player-top",
          (state.request && state.request.title) || "Tuner"
        )
      );
      var bottom = el("div", "player-bottom");
      if (!state.request || !state.request.live) {
        var time = el(
          "span",
          "time-text",
          elapsed(state.position || 0) + " / " + elapsed(state.duration || 0)
        );
        time.id = "play-time";
        bottom.appendChild(time);
        var track = el("div", "progress-track"),
          fill = el("div", "progress-fill");
        fill.id = "play-progress";
        fill.style.width =
          (state.duration ? (state.position / state.duration) * 100 : 0) + "%";
        track.appendChild(fill);
        bottom.appendChild(track);
      }
      var actions = el("div", "player-actions");
      actions.appendChild(
        button(
          state.status === "paused" ? "▶ Play" : "Ⅱ Pause",
          "play-toggle",
          function () {
            player.toggle();
          }
        )
      );
      if (state.request && state.request.live && S.watched)
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
      actions.appendChild(button("Back", "play-back", leaveFullscreen));
      bottom.appendChild(actions);
      bottom.appendChild(
        el(
          "div",
          "player-hint",
          state.request && state.request.live
            ? "OK Controls  ·  ↑ ↓ Change channel  ·  Yellow Subtitles  ·  Back Guide"
            : "OK Play / pause  ·  ← → Seek 10 seconds  ·  Yellow Subtitles  ·  Back Titles"
        )
      );
      overlay.appendChild(bottom);
      if (S.zone === "player-actions")
        focus(document.getElementById(old) ? old : "play-toggle");
    }
    if (state.status === "loading" || state.status === "error") {
      var status = el("div", "player-status");
      status.appendChild(
        el(
          "h2",
          "",
          state.status === "loading" ? "Connecting…" : "Playback unavailable"
        )
      );
      status.appendChild(
        el(
          "p",
          "muted",
          state.status === "error"
            ? state.error || "Try another stream or retry."
            : "Preparing the stream on your TV"
        )
      );
      if (state.status === "error")
        status.appendChild(
          button("Retry", "play-retry", function () {
            var r = state.request;
            if (r) player.play(r);
          })
        );
      overlay.appendChild(status);
    }
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
      on = !!(player.subtitlesShowing && player.subtitlesShowing());
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
    tracks.forEach(function (track) {
      var name = trackName(track, "Subtitles");
      actions.push({
        text: (on && track.selected ? "✓ " : "") + name,
        run: function () {
          player.selectTrack("TEXT", track.index);
          closeDialog();
          toast("Subtitles: " + name);
        },
      });
    });
    showDialog("Subtitles", "Choose subtitles or captions for this stream.", actions);
  }
  function audioDialog() {
    var tracks = player.tracks().audio || [],
      actions = [];
    tracks.forEach(function (track) {
      var name = trackName(track, "Audio");
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
      tracks.length > 1 ? actions : []
    );
  }
  function showDialog(title, text, actions) {
    S.dialog = true;
    dialogLayer.className = "";
    dialogLayer.textContent = "";
    var box = el("div", "dialog");
    box.appendChild(el("h2", "", title));
    box.appendChild(el("p", "", text));
    (actions || []).forEach(function (action, i) {
      box.appendChild(
        button(action.text, "dialog-" + i, function () {
          action.run();
        })
      );
    });
    box.appendChild(
      button("Close", "dialog-close", function () {
        closeDialog();
      })
    );
    dialogLayer.appendChild(box);
    focus(actions && actions.length ? "dialog-0" : "dialog-close");
  }
  function closeDialog(restore) {
    var returnFocus = pin && pin.returnFocus;
    if (pin) {
      clearTimeout(pin.timer);
      pin = null;
    }
    S.dialog = false;
    dialogLayer.className = "hidden";
    dialogLayer.textContent = "";
    if (restore !== false) {
      if (S.fullscreen) {
        S.controls = true;
        renderPlayerOverlay();
        scheduleHideControls();
      } else {
        render();
        if (returnFocus && document.getElementById(returnFocus)) focus(returnFocus);
      }
    }
    if (dualActive && S.tab === 5) scheduleDualControls();
  }
  function renderSearch() {
    main.textContent = "";
    main.appendChild(el("h1", "page-title", "Find something to watch"));
    var input = el("input", "search-bar");
    input.id = "search-input";
    input.type = "search";
    input.placeholder = "Search channels, movies and series";
    input.value = S.query;
    input.oninput = function () {
      S.query = input.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderSearchResults, 180);
    };
    main.appendChild(input);
    var results = el("div", "search-results");
    results.id = "search-results";
    main.appendChild(results);
    renderSearchResults();
    if (S.zone === "nav") focus("tab-" + S.nav);
    else
      focus(
        S.focusId && document.getElementById(S.focusId)
          ? S.focusId
          : "search-input"
      );
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
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
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
    var source = store.settings.source || {},
      mode = el("div", "field"),
      modeLabel = el("label", "", "Playlist type"),
      select = el("select");
    select.id = "source-type";
    ["xtream", "m3u"].forEach(function (type) {
      var o = el(
        "option",
        "",
        type === "xtream" ? "Xtream Codes" : "M3U playlist"
      );
      o.value = type;
      select.appendChild(o);
    });
    select.value = source.type || "xtream";
    mode.appendChild(modeLabel);
    mode.appendChild(select);
    form.appendChild(mode);
    var fields = el("div");
    fields.id = "source-fields";
    form.appendChild(fields);
    function renderFields() {
      fields.textContent = "";
      if (select.value === "xtream") {
        fields.appendChild(
          field("Server URL", "source-server", source.server, "url")
        );
        var row = el("div", "field-row");
        row.appendChild(field("Username", "source-user", source.username));
        row.appendChild(
          field("Password", "source-password", source.password, "password")
        );
        fields.appendChild(row);
      } else {
        fields.appendChild(
          field("Playlist URL", "source-m3u", source.m3uUrl, "url")
        );
        fields.appendChild(
          field("Guide URL (optional)", "source-epg", source.epgUrl, "url")
        );
      }
    }
    select.onchange = renderFields;
    renderFields();
    var actions = el("div", "settings-actions");
    var save = button("Save and connect", "save-source", saveSource);
    save.type = "submit";
    save.onclick = null;
    actions.appendChild(save);
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
        "Arrow keys browse. OK opens or watches. Back returns to tabs. Hold OK on a live channel to save a Favorite. Channel +/− pages the guide."
      )
    );
    side.appendChild(
      button("About Tuner", "about-tuner", function () {
        showDialog(
          "Tuner for Samsung TV",
          "Version 1.4.10 · Samsung TV\nLive TV, guide, movies, series and Favorites. Two-channel PiP works on supported TVs and playlists. Embedded torrent playback is not available on Samsung.",
          []
        );
      })
    );
    grid.appendChild(side);
    // The pairing row heads the form column, so the side panel lines up with it.
    if (pairRow) form.insertBefore(pairRow, form.firstChild);
    main.appendChild(grid);
    if (S.zone === "nav") focus("tab-" + S.nav);
    else focus(!store.settings.source && window.TunerPairing ? "pair-phone" : "source-type");
  }
  function openPairing() {
    window.TunerPairing.open({
      device: "samsung",
      onSource: function (source) {
        if (!store.saveSettings({ source: source }))
          return toast(store.lastError || "The playlist could not be saved.");
        connect();
        openTab(0);
        toast("Paired with LumaNest TV. Loading your channels.");
      },
      onClose: function () { focus("pair-phone"); }
    });
  }
  function saveSource() {
    var type = document.getElementById("source-type").value,
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
    S.minute = 0;
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
  function back() {
    if (S.dialog) {
      closeDialog();
      return;
    }
    if (dualActive && S.tab === 5) {
      if (dualControls) hideDualControls();
      else openTab(0);
      return;
    }
    if (S.fullscreen) {
      if (S.zone === "player-actions") {
        S.zone = "video";
        S.controls = false;
        renderPlayerOverlay();
      } else leaveFullscreen();
      return;
    }
    if (S.detail) {
      backDetail();
      return;
    }
    if (S.tab === 0 && S.minute > 0) {
      S.minute = 0;
      renderGuide();
      return;
    }
    if (S.zone !== "nav") {
      S.zone = "nav";
      S.nav = S.tab;
      renderNav();
      focus("tab-" + S.tab);
      return;
    }
    if (S.tab !== 0) {
      openTab(0);
      S.zone = "nav";
      renderNav();
      focus("tab-0");
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
    ]);
  }
  function buttonsIn(parent) {
    return Array.prototype.slice
      .call(parent.querySelectorAll("button,select,input"))
      .filter(function (n) {
        return !n.disabled && n.offsetWidth > 0;
      });
  }
  function moveFocus(parent, delta) {
    var nodes = buttonsIn(parent),
      i = nodes.indexOf(document.activeElement);
    focus(
      (nodes[Math.max(0, Math.min(nodes.length - 1, i + delta))] || nodes[0]).id
    );
  }
  function handleArrow(code) {
    if (S.dialog) {
      if (pin) passcodeArrow(code);
      else moveFocus(dialogLayer, code === 37 || code === 38 ? -1 : 1);
      return;
    }
    if (dualActive && S.tab === 5) {
      if (!dualControls) showDualControls();
      else {
        moveFocus(main, code === 37 || code === 38 ? -1 : 1);
        scheduleDualControls();
      }
      return;
    }
    if (S.fullscreen) {
      var live = player.state.request && player.state.request.live;
      if (S.zone === "player-actions") {
        moveFocus(overlay, code === 37 || code === 38 ? -1 : 1);
        return;
      }
      if (live && (code === 38 || code === 40)) {
        var items = S.catalogs.live,
          i = items.indexOf(S.watched);
        watch(
          items[(i + (code === 40 ? 1 : -1) + items.length) % items.length],
          true
        );
        return;
      }
      if (!live && (code === 37 || code === 39)) {
        player.seek(code === 37 ? -10000 : 10000);
        S.controls = true;
        renderPlayerOverlay();
        scheduleHideControls();
        return;
      }
      S.zone = "player-actions";
      S.controls = true;
      renderPlayerOverlay();
      focus("play-toggle");
      return;
    }
    if (S.zone === "nav") {
      if (code === 37 || code === 39) {
        S.nav = Math.max(
          0,
          Math.min(tabs.length - 1, S.nav + (code === 37 ? -1 : 1))
        );
        focus("tab-" + S.nav);
      } else if (code === 40) {
        S.zone =
          S.tab === 0 ? "grid" : S.tab === 1 || S.tab === 2 ? "cards" : "form";
        render();
      }
      return;
    }
    if (S.detail) {
      moveFocus(main, code === 37 || code === 38 ? -1 : 1);
      return;
    }
    if (S.tab === 0) {
      if (S.zone === "grid") {
        var items = liveItems();
        if (code === 38 && S.row === 0) {
          S.zone = "categories";
          focus(
            "live-cat-" +
              Math.max(
                0,
                liveCategories()
                  .map(function (c) {
                    return c.id;
                  })
                  .indexOf(S.category)
              )
          );
          return;
        }
        if (code === 38 || code === 40)
          S.row = Math.max(
            0,
            Math.min(items.length - 1, S.row + (code === 40 ? 1 : -1))
          );
        else
          S.minute = Math.max(
            0,
            Math.min(1440, S.minute + (code === 37 ? -30 : 30))
          );
        renderGuide();
        return;
      }
      if (code === 40) {
        S.zone = "grid";
        renderGuide();
      } else if (code === 38) {
        S.zone = "nav";
        renderNav();
        focus("tab-0");
      } else {
        var parent =
          document.activeElement && document.activeElement.parentNode;
        moveFocus(parent || main, code === 37 ? -1 : 1);
      }
      return;
    }
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
      } else if (code === 38) {
        S.zone = "nav";
        renderNav();
        focus("tab-" + S.tab);
      } else moveFocus(document.activeElement.parentNode, code === 37 ? -1 : 1);
      return;
    }
    moveFocus(main, code === 37 || code === 38 ? -1 : 1);
  }
  function stopDual() {
    clearTimeout(dualControlsTimer);
    if (dual) dual.stop();
    dualActive = false;
    dualControls = true;
    dualStates = [{ status: "idle" }, { status: "idle" }];
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
          ? "OK / Arrows Controls  ·  Back Hide controls, then leave Multi View"
          : "Uses both playlist streams. Stop this playlist on other TVs first.  ·  Back Tabs  ·  Leaving stops both games"
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
    else
      focus(
        S.focusId && document.getElementById(S.focusId)
          ? S.focusId
          : "dual-pick-0"
      );
  }
  function pickDualChannel(slot) {
    clearTimeout(dualControlsTimer);
    dualFocusId = "dual-pick-" + slot;
    S.dialog = true;
    dialogLayer.className = "";
    dialogLayer.textContent = "";
    var box = el("div", "dialog");
    box.appendChild(el("h2", "", "Choose channel " + (slot + 1)));
    var input = el("input", "search-bar");
    input.id = "dual-channel-query";
    input.type = "search";
    input.placeholder = "Search a channel or team";
    box.appendChild(input);
    var results = el("div");
    box.appendChild(results);
    function update() {
      results.textContent = "";
      var q = input.value.toLowerCase().trim(),
        items = S.catalogs.live.filter(function (c) {
          return q
            ? c.name.toLowerCase().indexOf(q) >= 0
            : /ESPN|NFL|NBC|CBS|FOX|ABC|SPORT|NESN/i.test(c.name);
        });
      items.slice(0, 12).forEach(function (c, i) {
        results.appendChild(
          button(
            c.name,
            "dual-result-" + i,
            function () {
              if (dualChannels[1 - slot] && dualChannels[1 - slot].id === c.id)
                return toast("Choose a different channel for the second game.");
              var previous = dualChannels[slot];
              dualChannels[slot] = c;
              closeDialog(false);
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
      ((S.tab === 0 && !S.fullscreen && S.zone === "grid") ||
        (S.fullscreen && S.zone !== "player-actions" && S.watched))
    );
  }
  var enterDown = 0,
    enterHeld = false;
  document.addEventListener("keydown", function (e) {
    var code = e.keyCode || e.which,
      tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (code === 10009 || code === 27) {
        e.preventDefault();
        if (S.dialog) closeDialog();
        else {
          e.target.blur();
          S.zone = "nav";
          renderNav();
          focus("tab-" + S.tab);
        }
      } else if (code === 38 || code === 40) {
        e.preventDefault();
        var direction = code === 38 ? -1 : 1;
        if (S.dialog) moveFocus(dialogLayer, direction);
        else if (
          code === 40 &&
          S.tab === 3 &&
          document.getElementById("result-0")
        )
          focus("result-0");
        else moveFocus(main, direction);
      }
      return;
    }
    if (code === 10009 || code === 27 || code === 8) {
      e.preventDefault();
      if (!e.repeat) back();
      return;
    }
    // Any remote key while watching restarts the single controls timer.
    if (S.fullscreen) scheduleHideControls();
    if (pin && S.dialog) {
      var digit = code >= 48 && code <= 57 ? code - 48 : code >= 96 && code <= 105 ? code - 96 : -1;
      if (digit >= 0) {
        e.preventDefault();
        if (!e.repeat) passcodeDigit(String(digit));
        return;
      }
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
    if (code === 427 || code === 428) {
      e.preventDefault();
      if (S.fullscreen) handleArrow(code === 427 ? 38 : 40);
      else if (S.tab === 0) {
        S.zone = "grid";
        S.row = Math.max(
          0,
          Math.min(liveItems().length - 1, S.row + (code === 427 ? -4 : 4))
        );
        renderGuide();
      }
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
    if (code === 458) {
      e.preventDefault();
      if (!S.fullscreen) openTab(0);
      else leaveFullscreen();
    }
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
      if (
        S.zone === "player-actions" &&
        document.activeElement &&
        document.activeElement.click
      )
        document.activeElement.click();
      else {
        if (player.state.request && !player.state.request.live) player.toggle();
        S.controls = true;
        S.zone = "player-actions";
        renderPlayerOverlay();
        focus("play-toggle");
        scheduleHideControls();
      }
      return;
    }
    if (S.tab === 0 && S.zone === "grid") {
      if (c) activateChannel(c, selectedProgram(c));
    } else if (document.activeElement && document.activeElement.click)
      document.activeElement.click();
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
