' Screens: Live TV and Movies (category list + item list), Settings, pairing, and the full-screen player.
' m.zone records which part has the remote: "tabs", "cats", "items", "settings", "pair" or "video".

sub init()
    m.tabs = [m.top.FindNode("tab0"), m.top.FindNode("tab1"), m.top.FindNode("tab2")]
    m.tabsGroup = m.top.FindNode("tabs")
    m.tabBar = m.top.FindNode("tabBar")
    m.browse = m.top.FindNode("browse")
    m.cats = m.top.FindNode("cats")
    m.items = m.top.FindNode("items")
    m.message = m.top.FindNode("message")
    m.settings = m.top.FindNode("settings")
    m.account = m.top.FindNode("account")
    m.settingsList = m.top.FindNode("settingsList")
    m.pair = m.top.FindNode("pair")
    m.video = m.top.FindNode("video")
    m.banner = m.top.FindNode("banner")
    m.bannerNumber = m.top.FindNode("bannerNumber")
    m.bannerTitle = m.top.FindNode("bannerTitle")
    m.bannerDetail = m.top.FindNode("bannerDetail")
    m.bannerTimer = m.top.FindNode("bannerTimer")

    info = CreateObject("roAppInfo")
    m.top.FindNode("version").text = "Tuner for Roku " + info.GetVersion()

    m.cats.ObserveField("itemFocused", "onCategoryFocused")
    m.items.ObserveField("itemSelected", "onItemSelected")
    m.settingsList.ObserveField("itemSelected", "onSettingSelected")
    m.pair.ObserveField("paired", "onPaired")
    m.pair.ObserveField("closed", "onPairClosed")
    m.video.ObserveField("state", "onVideoState")
    m.bannerTimer.ObserveField("fire", "hideBanner")

    m.sections = ["live", "movies"]
    m.content = {}
    m.errors = {}
    m.tasks = {}
    m.tab = 0
    m.zone = "tabs"
    m.entry = invalid
    m.source = utilLoadSource()
    if m.source = invalid
        showSettings()
    else
        selectTab(0)
        loadSection("live")
    end if
end sub

' ---------- Tabs and lists ----------

sub selectTab(index as Integer)
    m.tab = index
    for i = 0 to m.tabs.Count() - 1
        if i = index
            m.tabs[i].color = "0xFFFFFFFF"
        else
            m.tabs[i].color = "0x8F8AA8FF"
        end if
    end for
    m.tabBar.translation = [m.tabs[index].translation[0], 52]
    if index = 2
        showSettings()
    else
        m.settings.visible = false
        m.browse.visible = true
        renderSection()
    end if
    setZone("tabs")
end sub

function currentSection() as String
    if m.tab = 1 then return "movies"
    return "live"
end function

sub renderSection()
    section = currentSection()
    root = m.content[section]
    if root = invalid
        m.cats.content = invalid
        m.items.content = invalid
        if m.errors[section] <> invalid
            m.message.text = m.errors[section]
        else
            if section = "movies"
                m.message.text = "Loading movies…"
            else
                m.message.text = "Loading channels… The first load of a large lineup can take a minute."
            end if
            loadSection(section)
        end if
        return
    end if
    m.message.text = ""
    m.cats.content = root
    showCategory(0)
end sub

sub showCategory(index as Integer)
    root = m.cats.content
    if root = invalid or index < 0 or index >= root.GetChildCount() then return
    m.items.content = root.GetChild(index)
end sub

sub onCategoryFocused()
    showCategory(m.cats.itemFocused)
end sub

sub loadSection(section as String)
    if m.source = invalid or m.tasks[section] <> invalid then return
    task = CreateObject("roSGNode", "CatalogTask")
    task.source = m.source
    task.section = section
    task.ObserveField("content", "onCatalogDone")
    task.ObserveField("error", "onCatalogDone")
    m.tasks[section] = task
    task.control = "run"
end sub

sub onCatalogDone(event as Object)
    task = event.GetRoSGNode()
    for each section in m.sections
        if m.tasks[section] <> invalid and m.tasks[section].IsSameNode(task)
            m.tasks.Delete(section)
            if event.GetField() = "error"
                m.errors[section] = task.error
            else
                m.content[section] = task.content
            end if
            if m.tab < 2 and currentSection() = section and m.zone <> "video" then renderSection()
        end if
    end for
end sub

sub resetCatalogs()
    for each section in m.sections
        if m.tasks[section] <> invalid
            m.tasks[section].UnobserveField("content")
            m.tasks[section].UnobserveField("error")
            m.tasks[section].control = "stop"
        end if
    end for
    m.tasks = {}
    m.content = {}
    m.errors = {}
end sub

' ---------- Focus ----------

sub setZone(zone as String)
    m.zone = zone
    m.tabBar.opacity = 0.5
    if zone = "tabs"
        m.tabBar.opacity = 1
        m.top.SetFocus(true)
    else if zone = "cats"
        m.cats.SetFocus(true)
    else if zone = "items"
        m.items.SetFocus(true)
    else if zone = "settings"
        m.settingsList.SetFocus(true)
    else if zone = "pair"
        m.pair.SetFocus(true)
    else if zone = "video"
        m.video.SetFocus(true)
    end if
end sub

function hasItems() as Boolean
    return m.items.content <> invalid and m.items.content.GetChildCount() > 0
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if m.zone = "video" then return videoKey(key)
    if m.zone = "tabs"
        if key = "left" and m.source <> invalid and m.tab > 0
            selectTab(m.tab - 1)
        else if key = "right" and m.source <> invalid and m.tab < 2
            selectTab(m.tab + 1)
        else if key = "down" or key = "OK"
            if m.tab = 2
                setZone("settings")
            else if m.cats.content <> invalid and m.cats.content.GetChildCount() > 0
                setZone("cats")
            end if
        else if key = "back"
            m.top.exitApp = true
        else
            return false
        end if
        return true
    else if m.zone = "cats"
        if key = "right" and hasItems()
            setZone("items")
        else if key = "up" or key = "back"
            setZone("tabs")
        else
            return false
        end if
        return true
    else if m.zone = "items"
        if key = "left" or key = "back"
            setZone("cats")
            return true
        end if
    else if m.zone = "settings"
        if key = "back" and m.source = invalid
            m.top.exitApp = true
            return true
        else if key = "up" or key = "back"
            if m.source <> invalid then setZone("tabs")
            return true
        end if
    end if
    return false
end function

' ---------- Settings ----------

sub showSettings()
    m.browse.visible = false
    m.settings.visible = true
    m.tabsGroup.visible = m.source <> invalid
    root = CreateObject("roSGNode", "ContentNode")
    m.settingActions = ["pair", "xtream", "m3u"]
    labels = ["Pair with your phone (recommended)", "Enter line login", "Enter M3U playlist link"]
    if m.source = invalid
        m.account.text = "Welcome to LumaNest TV. Pair this Roku with your phone, or enter the line login from your customer hub's TV/app setup details."
    else
        if m.source.type = "xtream"
            m.account.text = "Signed in as " + m.source.username + " on " + m.source.server
        else
            m.account.text = "Using an M3U playlist link."
        end if
        m.settingActions.Append(["reload", "signout"])
        labels.Append(["Reload channels and movies", "Sign out of this Roku"])
    end if
    for each label in labels
        root.CreateChild("ContentNode").title = label
    end for
    m.settingsList.content = root
    if m.source = invalid then setZone("settings")
end sub

sub onSettingSelected()
    action = m.settingActions[m.settingsList.itemSelected]
    if action = "pair"
        m.pair.visible = true
        m.pair.active = true
        setZone("pair")
    else if action = "xtream"
        server = ""
        if m.source <> invalid and m.source.type = "xtream" then server = m.source.server
        m.entry = {kind: "xtream", step: 0}
        askText("Server address", "The server from your line login, for example http://example.com:8080", server, false)
    else if action = "m3u"
        m.entry = {kind: "m3u", step: 0}
        askText("M3U playlist link", "The full http:// or https:// link to your playlist.", "", false)
    else if action = "reload"
        resetCatalogs()
        selectTab(0)
    else if action = "signout"
        resetCatalogs()
        utilClearSource()
        m.source = invalid
        showSettings()
    end if
end sub

sub useSource(source as Object)
    utilSaveSource(source)
    m.source = source
    resetCatalogs()
    m.tabsGroup.visible = true
    selectTab(0)
    if m.cats.content = invalid then m.message.text = "Connected. Loading channels…"
end sub

sub onPaired()
    m.pair.active = false
    m.pair.visible = false
    useSource(m.pair.paired)
end sub

sub onPairClosed()
    m.pair.active = false
    m.pair.visible = false
    setZone("settings")
end sub

' ---------- Typed logins ----------

sub askText(title as String, message as String, initial as String, secure as Boolean)
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = title
    dialog.message = [message]
    dialog.text = initial
    dialog.buttons = ["Continue", "Cancel"]
    if secure and dialog.textEditBox <> invalid then dialog.textEditBox.secureMode = true
    dialog.ObserveField("buttonSelected", "onDialogButton")
    dialog.ObserveField("wasClosed", "onDialogClosed")
    m.top.dialog = dialog
end sub

sub closeDialog()
    dialog = m.top.dialog
    if dialog = invalid then return
    dialog.UnobserveField("buttonSelected")
    dialog.UnobserveField("wasClosed")
    dialog.close = true
end sub

sub onDialogClosed()
    m.entry = invalid
    setZone("settings")
end sub

sub onDialogButton()
    dialog = m.top.dialog
    text = dialog.text.Trim()
    pressed = dialog.buttonSelected
    closeDialog()
    entry = m.entry
    if pressed <> 0 or entry = invalid
        m.entry = invalid
        setZone("settings")
        return
    end if
    if entry.kind = "m3u"
        m.entry = invalid
        login = utilFromGetPhp(text)
        if login <> invalid
            useSource(login)
        else if utilStartsWithI(text, "http://") or utilStartsWithI(text, "https://")
            useSource({type: "m3u", name: "LumaNest TV", m3uUrl: text})
        else
            m.account.text = "That playlist link must start with http:// or https://."
            setZone("settings")
        end if
        return
    end if
    if text = "" and entry.step < 2
        m.entry = invalid
        m.account.text = "The server address and username are required."
        setZone("settings")
        return
    end if
    if entry.step = 0
        login = utilFromGetPhp(text)
        if login <> invalid
            m.entry = invalid
            useSource(login)
            return
        end if
        entry.server = utilNormalizeServer(text)
        entry.step = 1
        askText("Username", "Your line username.", "", false)
    else if entry.step = 1
        entry.username = text
        entry.step = 2
        askText("Password", "Your line password.", "", true)
    else
        m.entry = invalid
        useSource({type: "xtream", name: "LumaNest TV", server: entry.server, username: entry.username, password: text})
    end if
end sub

' ---------- Player ----------

sub onItemSelected()
    m.playList = m.items.content
    m.playIndex = m.items.itemSelected
    m.playCategory = m.cats.content.GetChild(m.cats.itemFocused).title
    startPlayback()
end sub

sub startPlayback()
    item = m.playList.GetChild(m.playIndex)
    if item = invalid then return
    m.video.control = "stop"
    m.video.content = item
    m.video.visible = true
    m.video.control = "play"
    setZone("video")
    if item.live then showBanner("")
end sub

sub stopPlayback()
    m.video.control = "stop"
    m.video.visible = false
    hideBanner()
    m.items.jumpToItem = m.playIndex
    setZone("items")
end sub

sub onVideoState()
    state = m.video.state
    if state = "error"
        detail = m.video.errorMsg
        if detail = "" then detail = "The stream didn't start."
        showBanner("Couldn't play this. " + detail + " Try another channel, or press Back.")
    else if state = "finished"
        item = m.video.content
        if item = invalid or not item.live then stopPlayback()
    else if state = "playing"
        if m.banner.visible then m.bannerTimer.control = "start"
    end if
end sub

function videoKey(key as String) as Boolean
    item = m.video.content
    live = item <> invalid and item.live
    if key = "back"
        stopPlayback()
    else if live and (key = "up" or key = "down")
        count = m.playList.GetChildCount()
        if count > 0
            delta = 1
            if key = "down" then delta = -1
            m.playIndex = (m.playIndex + delta + count) mod count
            startPlayback()
        end if
    else if key = "options" or (live and key = "OK")
        if m.banner.visible
            hideBanner()
        else
            showBanner("")
        end if
    else
        return false
    end if
    return true
end function

sub showBanner(note as String)
    item = m.video.content
    if item = invalid then return
    m.bannerNumber.text = item.ShortDescriptionLine1
    m.bannerTitle.text = item.title
    if note <> ""
        m.bannerDetail.text = note
    else if item.live
        m.bannerDetail.text = m.playCategory + "      ▲▼ Change channel    OK Info    Back Channel list"
    else
        m.bannerDetail.text = m.playCategory + "      Back Movie list"
    end if
    m.banner.visible = true
    m.bannerTimer.control = "stop"
    if note = "" then m.bannerTimer.control = "start"
end sub

sub hideBanner()
    m.bannerTimer.control = "stop"
    m.banner.visible = false
end sub
