' Tuner for Roku. The saved LumaNest line lives in the "tuner" registry section; settings sit beside it.

sub init()
    m.reg = CreateObject("roRegistrySection", "tuner")
    m.pairView = m.top.findNode("pair")
    m.homeView = m.top.findNode("home")
    m.qr = m.top.findNode("qr")
    m.pairCode = m.top.findNode("pairCode")
    m.pairStatus = m.top.findNode("pairStatus")
    m.status = m.top.findNode("status")
    m.nav = m.top.findNode("nav")
    m.cats = m.top.findNode("cats")
    m.items = m.top.findNode("items")
    m.video = m.top.findNode("video")
    m.toast = m.top.findNode("toast")
    m.toastBg = m.top.findNode("toastBg")
    m.tasks = {}
    m.catalog = invalid
    m.currentItems = []
    m.seriesItems = invalid
    m.settings = {usOnly: m.reg.Read("usOnly") = "1", order: m.reg.Read("order")}
    if m.settings.order = "" then m.settings.order = "featured"

    m.pollTimer = CreateObject("roSGNode", "Timer")
    m.pollTimer.repeat = false
    m.pollTimer.observeField("fire", "doPoll")
    m.refreshTimer = CreateObject("roSGNode", "Timer")
    m.refreshTimer.repeat = false
    m.refreshTimer.observeField("fire", "startPair")
    m.toastTimer = CreateObject("roSGNode", "Timer")
    m.toastTimer.duration = 3
    m.toastTimer.observeField("fire", "hideToast")

    m.nav.observeField("itemFocused", "onNavFocused")
    m.cats.observeField("itemFocused", "onCategoryFocused")
    m.cats.observeField("itemSelected", "onCategorySelected")
    m.items.observeField("itemSelected", "onItemSelected")
    m.video.observeField("state", "onVideoState")

    saved = m.reg.Read("account")
    m.account = invalid
    if saved <> "" then m.account = ParseJson(saved)
    if m.account <> invalid then showHome() else showPair()
end sub

' ------------------------------------------------------------------ tasks and toasts

sub runTask(request as object, handler as string)
    task = CreateObject("roSGNode", "ApiTask")
    task.observeField("response", handler)
    task.request = request
    task.control = "RUN"
    m.tasks[request.mode] = task
end sub

sub showToast(message as string)
    m.toast.text = message
    m.toastBg.visible = true
    m.toastTimer.control = "start"
end sub

sub hideToast()
    m.toastBg.visible = false
end sub

' ------------------------------------------------------------------ pairing

sub showPair()
    m.homeView.visible = false
    m.pairView.visible = true
    m.pairView.setFocus(true)
    startPair()
end sub

sub startPair()
    m.pollTimer.control = "stop"
    m.refreshTimer.control = "stop"
    m.pairCode.text = "····-····"
    m.pairStatus.text = "Getting a code…"
    m.qr.removeChildrenIndex(m.qr.getChildCount(), 0)
    runTask({mode: "pairStart"}, "onPairStart")
end sub

sub onPairStart(event as object)
    r = event.getData()
    if not r.ok
        m.pairStatus.text = r.error + " Retrying…"
        m.refreshTimer.duration = 15
        m.refreshTimer.control = "start"
        return
    end if
    drawQr(r.data.qr)
    m.pairCode.text = r.data.userCode
    m.pairStatus.text = "Waiting for you to approve on your phone…"
    m.deviceCode = r.data.deviceCode
    m.interval = 5
    if r.data.interval <> invalid then m.interval = r.data.interval
    ' Codes last 10 minutes; take a fresh one a little early so the one on screen always works.
    m.refreshTimer.duration = 580
    if r.data.expiresIn <> invalid and r.data.expiresIn > 80 then m.refreshTimer.duration = r.data.expiresIn - 20
    m.refreshTimer.control = "start"
    m.pollTimer.duration = m.interval
    m.pollTimer.control = "start"
end sub

' Draws the server's QR rows ("0"/"1" per module) as squares on the white box, with a quiet zone.
sub drawQr(rows as object)
    m.qr.removeChildrenIndex(m.qr.getChildCount(), 0)
    size = rows.Count()
    if size = 0 then return
    cell = Int(520 / (size + 6))
    offset = Int((520 - cell * size) / 2)
    for r = 0 to size - 1
        row = rows[r]
        c = 0
        while c < size
            if Mid(row, c + 1, 1) = "1"
                ' Join a horizontal run of dark modules into one rectangle to keep the node count low.
                start = c
                while c < size and Mid(row, c + 1, 1) = "1"
                    c = c + 1
                end while
                block = m.qr.createChild("Rectangle")
                block.color = "0x141224FF"
                block.translation = [offset + start * cell, offset + r * cell]
                block.width = (c - start) * cell
                block.height = cell
            else
                c = c + 1
            end if
        end while
    end for
end sub

sub doPoll()
    if m.deviceCode = invalid or not m.pairView.visible then return
    runTask({mode: "pairPoll", deviceCode: m.deviceCode}, "onPoll")
end sub

sub onPoll(event as object)
    if not m.pairView.visible then return
    r = event.getData()
    if not r.ok
        m.pairStatus.text = "Can't reach LumaNest TV. Retrying…"
        m.pollTimer.duration = 15
        m.pollTimer.control = "start"
        return
    end if
    if r.data.status = "approved" and r.data.account <> invalid
        m.account = r.data.account
        m.reg.Write("account", FormatJson(m.account))
        m.reg.Flush()
        m.pollTimer.control = "stop"
        m.refreshTimer.control = "stop"
        showHome()
        showToast("Paired with LumaNest TV. Loading your channels.")
    else if r.data.status = "expired"
        startPair()
    else
        m.pollTimer.duration = m.interval
        m.pollTimer.control = "start"
    end if
end sub

' ------------------------------------------------------------------ library

sub showHome()
    m.pairView.visible = false
    m.homeView.visible = true
    m.nav.setFocus(true)
    loadCatalog()
end sub

sub loadCatalog()
    m.catalog = invalid
    setList(m.cats, [])
    setList(m.items, [])
    m.status.text = "Setting up your library… The first load can take a minute or two."
    runTask({mode: "catalog", account: m.account}, "onCatalog")
end sub

sub onCatalog(event as object)
    r = event.getData()
    if not r.ok
        m.status.text = r.error
        return
    end if
    m.catalog = r.data
    m.status.text = ""
    showSection()
end sub

function sectionKey() as string
    index = m.nav.itemFocused
    if index = 0 then return "live"
    if index = 1 then return "movies"
    if index = 2 then return "series"
    return "settings"
end function

sub onNavFocused()
    m.seriesItems = invalid
    showSection()
end sub

sub showSection()
    key = sectionKey()
    if key = "settings"
        m.sectionCats = []
        setList(m.cats, settingsLabels())
        setList(m.items, [])
        return
    end if
    if m.catalog = invalid then return
    m.sectionCats = orderedCategories(key)
    labels = []
    for each cat in m.sectionCats
        labels.Push(cat.name)
    end for
    setList(m.cats, labels)
    if m.sectionCats.Count() = 0
        setList(m.items, ["Nothing here yet"])
        m.currentItems = []
    else
        showCategory(0)
    end if
end sub

' Live TV can be limited to US categories; the order is the customer's choice in Settings.
function orderedCategories(key as string) as object
    data = m.catalog[key]
    result = []
    index = 0
    for each cat in data.categories
        if key <> "live" or not m.settings.usOnly or isUsCategory(cat.name)
            result.Push({id: cat.id, name: cat.name, rank: categoryRank(cat.name), index: index, sortName: LCase(stripLeading(cat.name))})
        end if
        index = index + 1
    end for
    if m.settings.order = "az"
        result.SortBy("sortName")
    else if m.settings.order = "featured"
        for each cat in result
            cat.key = cat.rank * 100000 + cat.index
        end for
        result.SortBy("key")
    end if
    return result
end function

function stripLeading(name as string) as string
    re = CreateObject("roRegex", "^[^A-Za-z0-9]+", "")
    return re.Replace(name, "")
end function

function categoryRank(name as string) as integer
    re = CreateObject("roRegex", "[^A-Z0-9]+", "")
    normalized = re.ReplaceAll(UCase(name), " ").Trim()
    if Left(normalized, 4) = "USA " then normalized = Mid(normalized, 5)
    if Left(normalized, 3) = "US " then normalized = Mid(normalized, 4)
    ranks = ["SPORTS", "PREMIUM", "NEWS", "MOVIES", "ENTERTAINMENT", "DOCUMENTARIES", "LOCAL NEWS"]
    for i = 0 to ranks.Count() - 1
        if ranks[i] = normalized then return i
    end for
    return 7
end function

' A category counts as US programming when it is labelled US/USA/United States or is a US sports league.
function isUsCategory(name as string) as boolean
    upper = UCase(name)
    labelled = CreateObject("roRegex", "(^|[^A-Z])(US|USA|U\.S\.A?\.?|UNITED STATES)([^A-Z]|$)", "")
    leagues = CreateObject("roRegex", "(^|[^A-Z])(NFL|NBA|WNBA|NHL|MLB|MLS|NCAA|ESPN|PPV)([^A-Z]|$)", "")
    return labelled.IsMatch(upper) or leagues.IsMatch(upper)
end function

sub onCategoryFocused()
    if sectionKey() = "settings" or m.catalog = invalid then return
    m.seriesItems = invalid
    showCategory(m.cats.itemFocused)
end sub

sub showCategory(index as integer)
    if index < 0 or index >= m.sectionCats.Count() then return
    list = m.catalog[sectionKey()].byCat[m.sectionCats[index].id]
    if list = invalid then list = []
    m.currentItems = list
    labels = []
    for each item in list
        labels.Push(item.name)
    end for
    setList(m.items, labels)
end sub

sub setList(list as object, labels as object)
    content = CreateObject("roSGNode", "ContentNode")
    for each label in labels
        child = content.createChild("ContentNode")
        child.title = label
    end for
    list.content = content
end sub

sub onItemSelected()
    index = m.items.itemSelected
    if index < 0 or index >= m.currentItems.Count() then return
    item = m.currentItems[index]
    if item.kind = "series"
        m.status.text = "Loading " + item.name + "…"
        m.seriesItems = m.currentItems
        m.seriesIndex = index
        runTask({mode: "seriesInfo", account: m.account, seriesId: item.seriesId}, "onSeriesInfo")
    else
        play(item)
    end if
end sub

sub onSeriesInfo(event as object)
    r = event.getData()
    m.status.text = ""
    if not r.ok or r.data.Count() = 0
        showToast("No episodes are available for this series.")
        m.seriesItems = invalid
        return
    end if
    m.currentItems = r.data
    labels = []
    for each episode in r.data
        labels.Push(episode.name)
    end for
    setList(m.items, labels)
    m.items.jumpToItem = 0
end sub

' ------------------------------------------------------------------ playback

sub play(item as object)
    content = CreateObject("roSGNode", "ContentNode")
    content.url = item.url
    content.title = item.name
    lower = LCase(item.url)
    if lower.InStr(".m3u8") >= 0
        content.streamFormat = "hls"
    else if lower.InStr(".mkv") >= 0
        content.streamFormat = "mkv"
    else if lower.InStr(".ts") >= 0
        content.streamFormat = "ts"
    else
        content.streamFormat = "mp4"
    end if
    if item.kind = "live" then content.live = true
    m.video.content = content
    m.video.visible = true
    m.video.control = "play"
    m.video.setFocus(true)
end sub

sub stopVideo()
    m.video.control = "stop"
    m.video.visible = false
    m.items.setFocus(true)
end sub

sub onVideoState()
    state = m.video.state
    if state = "error"
        message = m.video.errorMsg
        stopVideo()
        showToast("This channel couldn't be played. " + message)
    else if state = "finished"
        stopVideo()
    end if
end sub

' ------------------------------------------------------------------ settings

function settingsLabels() as object
    lineup = "Channels: All"
    if m.settings.usOnly then lineup = "Channels: USA only"
    order = "Category order: Featured"
    if m.settings.order = "provider" then order = "Category order: Customer hub"
    if m.settings.order = "az" then order = "Category order: A to Z"
    return [lineup, order, "Refresh library", "Pair again"]
end function

sub onCategorySelected()
    if sectionKey() <> "settings" then
        m.items.setFocus(true)
        return
    end if
    choice = m.cats.itemSelected
    if choice = 0
        m.settings.usOnly = not m.settings.usOnly
        if m.settings.usOnly then m.reg.Write("usOnly", "1") else m.reg.Write("usOnly", "0")
        m.reg.Flush()
        if m.settings.usOnly then showToast("Showing USA channels only.") else showToast("Showing all channels on your line.")
    else if choice = 1
        if m.settings.order = "featured"
            m.settings.order = "provider"
        else if m.settings.order = "provider"
            m.settings.order = "az"
        else
            m.settings.order = "featured"
        end if
        m.reg.Write("order", m.settings.order)
        m.reg.Flush()
    else if choice = 2
        loadCatalog()
        showToast("Refreshing your library.")
    else if choice = 3
        m.reg.Delete("account")
        m.reg.Flush()
        m.account = invalid
        m.catalog = invalid
        showPair()
        return
    end if
    setList(m.cats, settingsLabels())
    m.cats.jumpToItem = choice
end sub

' ------------------------------------------------------------------ remote

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if m.video.visible
        if key = "back"
            stopVideo()
            return true
        end if
        return false
    end if
    if m.pairView.visible then return false
    if key = "right"
        if m.nav.hasFocus()
            m.cats.setFocus(true)
            return true
        else if m.cats.hasFocus() and m.currentItems.Count() > 0 and sectionKey() <> "settings"
            m.items.setFocus(true)
            return true
        end if
    else if key = "left"
        if m.items.hasFocus()
            m.cats.setFocus(true)
            return true
        else if m.cats.hasFocus()
            m.nav.setFocus(true)
            return true
        end if
    else if key = "back"
        if m.items.hasFocus() and m.seriesItems <> invalid
            ' Back from an episode list returns to the series in that category.
            m.currentItems = m.seriesItems
            m.seriesItems = invalid
            labels = []
            for each item in m.currentItems
                labels.Push(item.name)
            end for
            setList(m.items, labels)
            m.items.jumpToItem = m.seriesIndex
            return true
        else if m.items.hasFocus()
            m.cats.setFocus(true)
            return true
        else if m.cats.hasFocus()
            m.nav.setFocus(true)
            return true
        end if
    end if
    return false
end function
