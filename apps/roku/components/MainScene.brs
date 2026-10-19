' Tuner for Roku. The top menu is Home, Live TV, Discover, Library, Search and Settings (docs/browse.md).
' The saved LumaNest line lives in the "tuner" registry section; settings and the Library sit beside it.
' Each screen has its own file in components/scene; the browsing rules are in source/lib/BrowseLogic.brs.

sub init()
    m.reg = CreateObject("roRegistrySection", "tuner")
    m.rx = browseRx()
    m.pairView = m.top.findNode("pair")
    m.shell = m.top.findNode("shell")
    m.nav = m.top.findNode("nav")
    m.status = m.top.findNode("status")
    m.hint = m.top.findNode("hint")
    m.qr = m.top.findNode("qr")
    m.pairCode = m.top.findNode("pairCode")
    m.pairStatus = m.top.findNode("pairStatus")

    m.homeView = m.top.findNode("homeView")
    m.homeRows = m.top.findNode("homeRows")
    m.homeTitle = m.top.findNode("homeTitle")
    m.homeMeta = m.top.findNode("homeMeta")
    m.liveView = m.top.findNode("liveView")
    m.cats = m.top.findNode("cats")
    m.items = m.top.findNode("items")
    m.discoverView = m.top.findNode("discoverView")
    m.filters = m.top.findNode("filters")
    m.discoverGrid = m.top.findNode("discoverGrid")
    m.discoverTitle = m.top.findNode("discoverTitle")
    m.discoverMeta = m.top.findNode("discoverMeta")
    m.discoverEmpty = m.top.findNode("discoverEmpty")
    m.libraryView = m.top.findNode("libraryView")
    m.libraryRows = m.top.findNode("libraryRows")
    m.libraryTitle = m.top.findNode("libraryTitle")
    m.libraryMeta = m.top.findNode("libraryMeta")
    m.libraryEmpty = m.top.findNode("libraryEmpty")
    m.searchView = m.top.findNode("searchView")
    m.keyboard = m.top.findNode("keyboard")
    m.searchGrid = m.top.findNode("searchGrid")
    m.searchTitle = m.top.findNode("searchTitle")
    m.searchMeta = m.top.findNode("searchMeta")
    m.searchEmpty = m.top.findNode("searchEmpty")
    m.settingsView = m.top.findNode("settingsView")
    m.settingsList = m.top.findNode("settingsList")
    m.settingsInfo = m.top.findNode("settingsInfo")

    m.details = m.top.findNode("details")
    m.detailsBackdrop = m.top.findNode("detailsBackdrop")
    m.detailsPoster = m.top.findNode("detailsPoster")
    m.detailsTileName = m.top.findNode("detailsTileName")
    m.detailsTitle = m.top.findNode("detailsTitle")
    m.detailsMeta = m.top.findNode("detailsMeta")
    m.detailsPlot = m.top.findNode("detailsPlot")
    m.detailsActions = m.top.findNode("detailsActions")
    m.episodesTitle = m.top.findNode("episodesTitle")
    m.detailsEpisodes = m.top.findNode("detailsEpisodes")
    m.detailsHint = m.top.findNode("detailsHint")
    m.picker = m.top.findNode("picker")
    m.pickerTitle = m.top.findNode("pickerTitle")
    m.pickerList = m.top.findNode("pickerList")

    m.video = m.top.findNode("video")
    m.subs = m.top.findNode("subs")
    m.subsNote = m.top.findNode("subsNote")
    m.subsList = m.top.findNode("subsList")
    m.toast = m.top.findNode("toast")
    m.toastBg = m.top.findNode("toastBg")

    m.tasks = {}
    m.catalog = invalid
    ' Bumped by every catalogue load and by Pair again, so an older load that finishes late is dropped.
    m.catalogToken = 0
    m.rowsSource = "none"
    m.statusText = ""
    m.settings = loadSettings()
    ' Adult categories start hidden every time the app opens; the passcode unlocks them for this session.
    m.adultUnlocked = false
    m.library = libraryNew("")
    libraryIndex()

    m.sections = ["home", "live", "discover", "library", "search", "settings"]
    m.views = {home: m.homeView, live: m.liveView, discover: m.discoverView, library: m.libraryView, search: m.searchView, settings: m.settingsView}
    m.section = ""
    m.nav.labels = ["Home", "Live TV", "Discover", "Library", "Search", "Settings"]
    m.nav.observeField("focusIndex", "onNavFocus")
    m.nav.observeField("chosen", "onNavChosen")

    m.toastTimer = CreateObject("roSGNode", "Timer")
    m.toastTimer.duration = 3
    m.toastTimer.observeField("fire", "hideToast")

    initPairing()
    initBrowse()
    initDetails()
    initLive()
    initPlayer()
    initSettings()

    saved = m.reg.Read("account")
    m.account = invalid
    if saved <> "" then m.account = ParseJson(saved)
    if m.account <> invalid then enterApp() else showPair()
    ' The first screen (Home, Live TV or pairing) is up and takes the remote (Roku certification).
    m.top.signalBeacon("AppLaunchComplete")
end sub

' ------------------------------------------------------------------ tasks and toasts

sub runTask(request as object, handler as string)
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", handler)
    task.request = request
    task.control = "RUN"
    m.tasks[request.mode] = task
end sub

' Called first by every task handler: lets the finished task go, so its response (for "catalog", the whole
' catalogue) is not kept in memory beside the copy the handler takes with getData().
sub finishTask(event as object)
    task = event.getRoSGNode()
    if task = invalid then return
    task.unobserveField("response")
    done = []
    for each mode in m.tasks
        if m.tasks[mode] <> invalid and m.tasks[mode].isSameNode(task) then done.Push(mode)
    end for
    for each mode in done
        m.tasks.Delete(mode)
    end for
end sub

sub showToast(message as string)
    m.toast.text = message
    m.toastBg.visible = true
    m.toastTimer.control = "start"
end sub

sub hideToast()
    m.toastBg.visible = false
end sub

sub setList(list as object, labels as object)
    content = CreateObject("roSGNode", "ContentNode")
    for each label in labels
        child = content.createChild("ContentNode")
        child.title = label
    end for
    list.content = content
end sub

function nowSeconds() as integer
    return CreateObject("roDateTime").AsSeconds()
end function

' ------------------------------------------------------------------ the app after pairing

sub enterApp()
    m.pairView.visible = false
    m.details.visible = false
    m.shell.visible = true
    libraryLoad()
    start = "home"
    if m.settings.startOn = "live" then start = "live"
    m.section = ""
    m.nav.focusIndex = sectionIndex(start)
    showSection(start)
    m.nav.setFocus(true)
    updateHint()
    loadCatalog(false)
end sub

' Reads the whole catalogue (and the Movies & Series lists) in ApiTask. refresh skips the 12-hour list cache.
sub loadCatalog(refresh as boolean)
    m.catalogToken = m.catalogToken + 1
    m.catalog = invalid
    m.searchLive = []
    setStatus("Setting up your library… The first load can take a minute or two.")
    markBrowseDirty()
    if m.section <> "" and m.section <> "settings"
        if not m.nav.hasFocus() then m.nav.setFocus(true)
        showSection(m.section)
    end if
    runTask({mode: "catalog", account: m.account, refresh: refresh, token: m.catalogToken}, "onCatalog")
end sub

sub onCatalog(event as object)
    finishTask(event)
    r = event.getData()
    ' A load started before Pair again or before another Refresh library never replaces a newer one.
    if r.token <> m.catalogToken or m.account = invalid then return
    if not r.ok
        setStatus(r.error)
        return
    end if
    m.catalog = r.data
    m.rowsSource = "none"
    if r.data.rows <> invalid and r.data.rows.source = "tmdb" then m.rowsSource = "tmdb"
    setStatus("")
    markBrowseDirty()
    if m.section <> "" then showSection(m.section)
    if m.section = "settings" then refreshSettings(m.settingsList.itemFocused)
end sub

sub setStatus(text as string)
    m.statusText = text
    updateStatus()
end sub

sub updateStatus()
    waiting = m.section <> "settings" and m.catalog = invalid
    m.status.text = m.statusText
    m.status.visible = waiting and m.statusText <> ""
end sub

' ------------------------------------------------------------------ top menu

function sectionIndex(name as string) as integer
    for i = 0 to m.sections.Count() - 1
        if m.sections[i] = name then return i
    end for
    return 0
end function

sub showSection(name as string)
    m.section = name
    m.nav.selectedIndex = sectionIndex(name)
    ready = m.catalog <> invalid or name = "settings"
    for each key in m.views
        m.views[key].visible = key = name and ready
    end for
    if name = "home"
        showHomeView()
    else if name = "live"
        showLiveView()
    else if name = "discover"
        showDiscoverView()
    else if name = "library"
        showLibraryView()
    else if name = "search"
        showSearchView()
    else
        showSettingsView()
    end if
    updateStatus()
    updateHint()
end sub

' Moving along the menu opens each section underneath; the focus stays on the menu.
sub onNavFocus()
    name = m.sections[m.nav.focusIndex]
    if name <> m.section then showSection(name)
end sub

sub onNavChosen()
    focusSection()
end sub

' The control Down (or OK) on the menu moves to, or invalid while the section has nothing to focus.
function sectionFocusTarget() as dynamic
    s = m.section
    if s = "settings" then return m.settingsList
    if m.catalog = invalid then return invalid
    if s = "home" and contentCount(m.homeRows) > 0 then return m.homeRows
    if s = "live" and m.liveCats.Count() > 0 then return m.cats
    if s = "discover" then return m.filters
    if s = "library" and contentCount(m.libraryRows) > 0 then return m.libraryRows
    if s = "search" then return m.keyboard
    return invalid
end function

sub focusSection()
    target = sectionFocusTarget()
    if target <> invalid then focusOn(target)
end sub

sub focusNav()
    m.nav.focusIndex = sectionIndex(m.section)
    focusOn(m.nav)
end sub

sub focusOn(node as object)
    node.setFocus(true)
    updateHint()
end sub

function contentCount(list as object) as integer
    if list.content = invalid then return 0
    return list.content.getChildCount()
end function

' Goes to a section from inside the app (See all, Library) and focuses its content.
sub goSection(name as string)
    m.nav.focusIndex = sectionIndex(name)
    if m.section <> name then showSection(name)
    focusSection()
end sub

sub updateHint()
    text = ""
    if m.nav.hasFocus()
        text = "Left and Right choose a section  ·  Down or OK opens it  ·  Back "
        if m.section = "home" then text = text + "exits Tuner" else text = text + "goes to Home"
    else if m.section = "live"
        text = "OK opens a category or plays a channel  ·  Back goes up one level"
    else if m.section = "settings"
        text = "OK changes the setting  ·  Back returns to the menu"
    else if m.section = "discover" and m.filters.hasFocus()
        text = "Left and Right choose a filter  ·  OK changes it  ·  Down shows the titles  ·  Back returns to the menu"
    else if m.section = "search" and m.keyboard.isInFocusChain()
        text = "Type to search  ·  Right goes to the results  ·  Back returns to the menu"
    else if m.section <> ""
        text = "OK opens  ·  * adds to or removes from your Library  ·  Back returns to the menu"
    end if
    m.hint.text = text
end sub

' ------------------------------------------------------------------ remote
' Back always goes up one level: details or a panel closes, a section returns to the menu, the menu
' returns to Home, and Back on Home's menu leaves the app. OK selects; * (Options) adds a title to the
' Library, or picks subtitles while watching.

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if m.subs.visible
        if key = "back" or key = "options"
            closeSubtitleMenu(true)
            return true
        end if
        return false
    end if
    if m.video.visible
        if key = "back"
            stopVideo()
            return true
        else if key = "options"
            showSubtitleMenu()
            return true
        end if
        return false
    end if
    if m.pairView.visible then return false
    if m.picker.visible
        if key = "back" or key = "options"
            closePicker()
            return true
        end if
        return false
    end if
    if m.details.visible then return detailsKey(key)
    if not m.shell.visible then return false
    handled = false
    if m.nav.hasFocus()
        handled = navKey(key)
    else if m.section = "live"
        handled = liveKey(key)
    else if m.section = "discover"
        handled = discoverKey(key)
    else if m.section = "search"
        handled = searchKey(key)
    else if m.section = "home" or m.section = "library"
        handled = rowsKey(key)
    else if m.section = "settings"
        if key = "up" or key = "back"
            focusNav()
            handled = true
        end if
    end if
    updateHint()
    return handled
end function

function navKey(key as string) as boolean
    if key = "down"
        focusSection()
        return true
    else if key = "back" and m.section <> "home"
        m.nav.focusIndex = sectionIndex("home")
        if m.section <> "home" then showSection("home")
        return true
    end if
    return false
end function

' Home and Library: Up from the first row and Back go to the menu; * adds to or removes from the Library.
function rowsKey(key as string) as boolean
    list = m.homeRows
    if m.section = "library" then list = m.libraryRows
    if key = "up" or key = "back"
        focusNav()
        return true
    else if key = "options"
        toggleFavoriteTile(tileAt(list, focusedRowItem(list)))
        return true
    end if
    return false
end function

function discoverKey(key as string) as boolean
    if m.filters.hasFocus()
        if key = "up" or key = "back"
            focusNav()
            return true
        else if key = "down" and contentCount(m.discoverGrid) > 0
            focusOn(m.discoverGrid)
            return true
        end if
        return false
    end if
    if key = "up"
        focusOn(m.filters)
        return true
    else if key = "back"
        focusNav()
        return true
    else if key = "options"
        toggleFavoriteTile(gridTile(m.discoverGrid))
        return true
    end if
    return false
end function

function searchKey(key as string) as boolean
    if m.keyboard.isInFocusChain()
        if key = "back" or key = "up"
            focusNav()
            return true
        else if key = "right" and contentCount(m.searchGrid) > 0
            focusOn(m.searchGrid)
            return true
        end if
        return false
    end if
    if key = "left" or key = "back"
        focusOn(m.keyboard)
        return true
    else if key = "up"
        focusNav()
        return true
    else if key = "options"
        toggleFavoriteTile(gridTile(m.searchGrid))
        return true
    end if
    return false
end function
