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
    m.settings = {usOnly: m.reg.Read("usOnly") = "1", order: m.reg.Read("order"), subtitles: m.reg.Read("subtitles") = "1", subLang: m.reg.Read("subLang")}
    if m.settings.order = "" then m.settings.order = "featured"
    ' Adult categories start hidden every time the app opens; the passcode unlocks them for this session.
    m.adultUnlocked = false
    m.adultRe = CreateObject("roRegex", "(^|[^a-z0-9])(xxx|adults?|18\+|porn)([^a-z0-9]|$)", "i")
    m.adultSwimRe = CreateObject("roRegex", "adult\s*swim", "i")
    m.subs = m.top.findNode("subs")
    m.subsNote = m.top.findNode("subsNote")
    m.subsList = m.top.findNode("subsList")
    m.subsList.observeField("itemSelected", "onSubtitleChosen")
    m.subOptions = []
    m.subPicked = false

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
    m.video.observeField("availableSubtitleTracks", "onSubtitleTracks")

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
        ' Adult categories stay hidden until Settings -> Adult content is unlocked with the passcode.
        hidden = not m.adultUnlocked and isAdultCategory(cat)
        if not hidden and (key <> "live" or not m.settings.usOnly or isUsCategory(cat.name))
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

' Adult = flagged is_adult by the Xtream server, or named XXX / Adult(s) / 18+ / Porn (but not Adult Swim).
function isAdultCategory(cat as object) as boolean
    if isTrue(cat.adult) then return true
    name = cat.name
    if m.adultSwimRe.IsMatch(name) then return false
    return m.adultRe.IsMatch(name)
end function

function isAdultItem(item as object) as boolean
    return isTrue(item.adult)
end function

function isTrue(v as dynamic) as boolean
    t = type(v)
    if t = "Boolean" or t = "roBoolean" then return v
    return false
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
    if not m.adultUnlocked
        visible = []
        for each item in list
            if not isAdultItem(item) then visible.Push(item)
        end for
        list = visible
    end if
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
    m.subPicked = false
    applyCaptionMode()
    m.video.content = content
    m.video.visible = true
    m.video.control = "play"
    m.video.setFocus(true)
end sub

sub stopVideo()
    closeSubtitleMenu(false)
    m.video.control = "stop"
    m.video.visible = false
    m.items.setFocus(true)
end sub

' ------------------------------------------------------------------ subtitles
' Live HLS channels usually carry CEA-608 captions (tracks named "eia608/1" and so on), which Roku
' draws itself when globalCaptionMode is On. Movies and episodes can carry text subtitle tracks.

sub applyCaptionMode()
    ' Never suppress captions; whether they show is decided by globalCaptionMode and subtitleTrack.
    m.video.suppressCaptions = false
    if m.settings.subtitles
        m.video.globalCaptionMode = "On"
    else
        m.video.globalCaptionMode = "Off"
    end if
end sub

function subtitleTracks() as object
    tracks = m.video.availableSubtitleTracks
    if type(tracks) <> "roArray" then return []
    return tracks
end function

' Picks a track once the stream reports its tracks: the language chosen last time, then English, then the first.
sub onSubtitleTracks()
    if not m.settings.subtitles or m.subPicked then return
    track = preferredTrack(subtitleTracks())
    if track <> invalid then m.video.subtitleTrack = trackName(track)
    if m.subs.visible then showSubtitleMenu()
end sub

function preferredTrack(tracks as object) as dynamic
    if tracks.Count() = 0 then return invalid
    if m.settings.subLang <> ""
        for each track in tracks
            if LCase(trackField(track, "Language")) = m.settings.subLang then return track
        end for
    end if
    for each track in tracks
        if isEnglish(trackField(track, "Language")) then return track
    end for
    return tracks[0]
end function

function isEnglish(code as string) as boolean
    lower = LCase(code)
    return lower = "en" or lower = "eng" or Left(lower, 3) = "en-" or Left(lower, 3) = "en_" or lower = "english"
end function

function trackField(track as object, name as string) as string
    v = track[name]
    if v = invalid then return ""
    if type(v) = "roString" or type(v) = "String" then return v
    return ""
end function

function trackName(track as object) as string
    return trackField(track, "TrackName")
end function

function languageName(code as string) as string
    names = {en: "English", eng: "English", es: "Spanish", spa: "Spanish", fr: "French", fre: "French", fra: "French", de: "German", ger: "German", deu: "German", it: "Italian", ita: "Italian", pt: "Portuguese", por: "Portuguese", ar: "Arabic", ara: "Arabic", ru: "Russian", rus: "Russian", tr: "Turkish", tur: "Turkish", nl: "Dutch", dut: "Dutch", nld: "Dutch", pl: "Polish", pol: "Polish", hi: "Hindi", hin: "Hindi", zh: "Chinese", chi: "Chinese", zho: "Chinese", ja: "Japanese", jpn: "Japanese", ko: "Korean", kor: "Korean"}
    lower = LCase(code)
    if names.DoesExist(lower) then return names[lower]
    if isEnglish(lower) then return "English"
    return code
end function

function trackLabel(track as object, index as integer) as string
    name = trackName(track)
    lower = LCase(name)
    lang = languageName(trackField(track, "Language"))
    desc = trackField(track, "Description")
    label = lang
    if desc <> "" and LCase(desc) <> LCase(lang)
        if label = "" then label = desc else label = label + " · " + desc
    end if
    if Left(lower, 7) = "eia608/" or Left(lower, 7) = "eia708/"
        cc = "CC" + Mid(name, 8)
        if label = "" then label = cc else label = label + " (" + cc + ")"
    end if
    if label = "" then label = "Track " + (index + 1).ToStr()
    return label
end function

sub showSubtitleMenu()
    tracks = subtitleTracks()
    current = m.video.subtitleTrack
    captionsOn = m.video.globalCaptionMode <> "Off"
    m.subOptions = [{action: "off"}]
    labels = ["Off"]
    if not captionsOn then labels[0] = "Off (current)"
    if tracks.Count() = 0
        m.subsNote.text = "No subtitles in this stream. Broadcast captions (CC), if the channel sends them, show when you turn them on."
        m.subOptions.Push({action: "on"})
        if captionsOn then labels.Push("On: broadcast captions (current)") else labels.Push("On: broadcast captions")
    else
        m.subsNote.text = "Choose a subtitle track."
        for i = 0 to tracks.Count() - 1
            track = tracks[i]
            label = trackLabel(track, i)
            if captionsOn and trackName(track) = current then label = label + " (current)"
            m.subOptions.Push({action: "track", track: track})
            labels.Push(label)
        end for
    end if
    setList(m.subsList, labels)
    m.subs.visible = true
    m.subsList.setFocus(true)
end sub

sub closeSubtitleMenu(refocus as boolean)
    if not m.subs.visible then return
    m.subs.visible = false
    if refocus and m.video.visible then m.video.setFocus(true)
end sub

sub onSubtitleChosen()
    if not m.subs.visible then return
    index = m.subsList.itemSelected
    if index < 0 or index >= m.subOptions.Count() then return
    option = m.subOptions[index]
    m.subPicked = true
    if option.action = "off"
        setSubtitles(false)
        showToast("Subtitles off.")
    else if option.action = "on"
        setSubtitles(true)
        showToast("Captions on. They appear when the channel sends them.")
    else
        setSubtitles(true)
        m.video.subtitleTrack = trackName(option.track)
        lang = LCase(trackField(option.track, "Language"))
        if lang <> ""
            m.settings.subLang = lang
            m.reg.Write("subLang", lang)
            m.reg.Flush()
        end if
        showToast("Subtitles: " + trackLabel(option.track, index - 1) + ".")
    end if
    closeSubtitleMenu(true)
end sub

sub setSubtitles(enabled as boolean)
    m.settings.subtitles = enabled
    if enabled then m.reg.Write("subtitles", "1") else m.reg.Write("subtitles", "0")
    m.reg.Flush()
    applyCaptionMode()
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

' Each row has an id so rows can come and go (Change passcode only appears once a passcode exists).
function settingsRows() as object
    lineup = "Channels: All"
    if m.settings.usOnly then lineup = "Channels: USA only"
    order = "Category order: Featured"
    if m.settings.order = "provider" then order = "Category order: Customer hub"
    if m.settings.order = "az" then order = "Category order: A to Z"
    subtitles = "Subtitles: Off"
    if m.settings.subtitles then subtitles = "Subtitles: On"
    adult = "Adult content: Locked"
    if m.adultUnlocked then adult = "Adult content: Unlocked"
    rows = [{id: "lineup", label: lineup}, {id: "order", label: order}, {id: "subtitles", label: subtitles}, {id: "adult", label: adult}]
    if hasPasscode() then rows.Push({id: "changePin", label: "Change passcode"})
    rows.Push({id: "refresh", label: "Refresh library"})
    rows.Push({id: "pair", label: "Pair again"})
    return rows
end function

function settingsLabels() as object
    labels = []
    for each row in settingsRows()
        labels.Push(row.label)
    end for
    return labels
end function

sub refreshSettings(focusIndex as integer)
    if sectionKey() <> "settings" then return
    setList(m.cats, settingsLabels())
    m.cats.jumpToItem = focusIndex
end sub

sub onCategorySelected()
    if sectionKey() <> "settings" then
        m.items.setFocus(true)
        return
    end if
    choice = m.cats.itemSelected
    rows = settingsRows()
    if choice < 0 or choice >= rows.Count() then return
    id = rows[choice].id
    if id = "lineup"
        m.settings.usOnly = not m.settings.usOnly
        if m.settings.usOnly then m.reg.Write("usOnly", "1") else m.reg.Write("usOnly", "0")
        m.reg.Flush()
        if m.settings.usOnly then showToast("Showing USA channels only.") else showToast("Showing all channels on your line.")
    else if id = "order"
        if m.settings.order = "featured"
            m.settings.order = "provider"
        else if m.settings.order = "provider"
            m.settings.order = "az"
        else
            m.settings.order = "featured"
        end if
        m.reg.Write("order", m.settings.order)
        m.reg.Flush()
    else if id = "subtitles"
        setSubtitles(not m.settings.subtitles)
        if m.settings.subtitles then showToast("Subtitles on. Press * while watching to pick a track.") else showToast("Subtitles off.")
    else if id = "adult"
        if m.adultUnlocked
            ' Locking never needs the passcode.
            m.adultUnlocked = false
            showToast("Adult content locked.")
        else if hasPasscode()
            startPinFlow("unlock")
        else
            startPinFlow("create")
        end if
    else if id = "changePin"
        startPinFlow("changeOld")
    else if id = "refresh"
        loadCatalog()
        showToast("Refreshing your library.")
    else if id = "pair"
        m.reg.Delete("account")
        m.reg.Flush()
        m.account = invalid
        m.catalog = invalid
        showPair()
        return
    end if
    refreshSettings(choice)
end sub

' ------------------------------------------------------------------ adult passcode
' Only a salted SHA-256 hash of the 4-digit passcode is kept, in the app's registry section. Roku clears an
' app's registry when the app is removed, so removing and reinstalling the app is the reset for a forgotten passcode.

function forgotText() as string
    return "Forgot the passcode? Remove Tuner from your Roku, reinstall it and pair again."
end function

function hasPasscode() as boolean
    return m.reg.Read("adultHash") <> "" and m.reg.Read("adultSalt") <> ""
end function

function hashPin(salt as string, pin as string) as string
    bytes = CreateObject("roByteArray")
    bytes.FromAsciiString(salt + pin)
    digest = CreateObject("roEVPDigest")
    digest.Setup("sha256")
    return LCase(digest.Process(bytes))
end function

sub savePasscode(pin as string)
    salt = CreateObject("roDeviceInfo").GetRandomUUID()
    m.reg.Write("adultSalt", salt)
    m.reg.Write("adultHash", hashPin(salt, pin))
    m.reg.Write("pinFails", "0")
    m.reg.Flush()
end sub

function nowSeconds() as integer
    return CreateObject("roDateTime").AsSeconds()
end function

' Seconds left on the 60-second wait after five wrong tries; 0 when the passcode may be tried.
function pinWaitLeft() as integer
    waitUntil = Int(Val(m.reg.Read("pinUntil")))
    remaining = waitUntil - nowSeconds()
    if remaining > 60 then remaining = 60
    if remaining < 0 then remaining = 0
    return remaining
end function

' Returns "ok", "wrong" or "blocked" and keeps the count of wrong tries in the registry.
function checkPin(pin as string) as string
    if hashPin(m.reg.Read("adultSalt"), pin) = m.reg.Read("adultHash")
        m.reg.Write("pinFails", "0")
        m.reg.Flush()
        return "ok"
    end if
    fails = Int(Val(m.reg.Read("pinFails"))) + 1
    if fails >= 5
        m.reg.Write("pinFails", "0")
        m.reg.Write("pinUntil", (nowSeconds() + 60).ToStr())
        m.reg.Flush()
        return "blocked"
    end if
    m.reg.Write("pinFails", fails.ToStr())
    m.reg.Flush()
    m.pinTriesLeft = 5 - fails
    return "wrong"
end function

sub startPinFlow(flow as string)
    if (flow = "unlock" or flow = "changeOld") and pinWaitLeft() > 0
        showToast("Too many wrong tries. Try again in " + pinWaitLeft().ToStr() + " seconds.")
        return
    end if
    m.pinFirst = ""
    if flow = "unlock"
        showPinDialog("unlock", "Unlock adult content", "Enter your 4-digit passcode." + Chr(10) + forgotText())
    else if flow = "create"
        showPinDialog("create", "Create a passcode", "Choose a 4-digit passcode. You'll need it each time you unlock adult categories.")
    else if flow = "changeOld"
        showPinDialog("changeOld", "Change passcode", "Enter your current passcode." + Chr(10) + forgotText())
    end if
end sub

sub showPinDialog(stage as string, title as string, message as string)
    m.pinStage = stage
    dialog = CreateObject("roSGNode", "PinDialog")
    dialog.title = title
    dialog.message = message
    dialog.buttons = ["OK", "Cancel"]
    if dialog.pinPad <> invalid
        dialog.pinPad.pinLength = 4
        dialog.pinPad.secureMode = true
    end if
    dialog.observeField("buttonSelected", "onPinButton")
    dialog.observeField("wasClosed", "onPinClosed")
    m.pinDialog = dialog
    m.top.dialog = dialog
end sub

sub closePinDialog()
    dialog = m.pinDialog
    m.pinDialog = invalid
    if dialog <> invalid
        dialog.unobserveField("buttonSelected")
        dialog.unobserveField("wasClosed")
        dialog.close = true
    end if
    m.cats.setFocus(true)
end sub

sub onPinClosed()
    ' Back on the dialog cancels the flow.
    if m.pinDialog = invalid then return
    m.pinDialog = invalid
    m.cats.setFocus(true)
end sub

function enteredPin(dialog as object) as string
    pin = ""
    if dialog.pin <> invalid then pin = dialog.pin
    if pin = "" and dialog.pinPad <> invalid and dialog.pinPad.pin <> invalid then pin = dialog.pinPad.pin
    return pin
end function

function isFourDigits(pin as string) as boolean
    re = CreateObject("roRegex", "^[0-9]{4}$", "")
    return re.IsMatch(pin)
end function

sub onPinButton()
    dialog = m.pinDialog
    if dialog = invalid then return
    if dialog.buttonSelected <> 0
        closePinDialog()
        return
    end if
    pin = enteredPin(dialog)
    stage = m.pinStage
    if not isFourDigits(pin)
        dialog.message = "Enter exactly 4 digits."
        return
    end if
    if stage = "create" or stage = "changeNew"
        m.pinFirst = pin
        nextStep = "createConfirm"
        if stage = "changeNew" then nextStep = "changeConfirm"
        closePinDialog()
        showPinDialog(nextStep, "Confirm passcode", "Enter the same 4 digits again.")
    else if stage = "createConfirm" or stage = "changeConfirm"
        if pin <> m.pinFirst
            again = "create"
            if stage = "changeConfirm" then again = "changeNew"
            closePinDialog()
            showPinDialog(again, "Passcodes didn't match", "Choose a 4-digit passcode again.")
            return
        end if
        savePasscode(pin)
        m.pinFirst = ""
        closePinDialog()
        if stage = "createConfirm"
            m.adultUnlocked = true
            showToast("Passcode set. Adult content unlocked.")
        else
            showToast("Passcode changed.")
        end if
        refreshSettings(m.cats.itemFocused)
    else if stage = "unlock" or stage = "changeOld"
        result = checkPin(pin)
        if result = "ok"
            closePinDialog()
            if stage = "unlock"
                m.adultUnlocked = true
                showToast("Adult content unlocked until you lock it or close the app.")
                refreshSettings(m.cats.itemFocused)
            else
                showPinDialog("changeNew", "New passcode", "Choose a new 4-digit passcode.")
            end if
        else if result = "blocked"
            closePinDialog()
            showToast("Too many wrong tries. Wait 60 seconds, then try again.")
        else
            tries = " tries left."
            if m.pinTriesLeft = 1 then tries = " try left."
            dialog.message = "Wrong passcode. " + m.pinTriesLeft.ToStr() + tries + Chr(10) + forgotText()
            if dialog.pinPad <> invalid then dialog.pinPad.pin = ""
        end if
    end if
end sub

' ------------------------------------------------------------------ remote

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
