' Settings, About and the adult-content passcode.

sub initSettings()
    m.settingsList.observeField("itemSelected", "onSettingChosen")
    m.settingsList.observeField("itemFocused", "onSettingFocused")
end sub

' Movies & Series USA only is on unless the customer turned it off (separate from the Channels switch).
function loadSettings() as object
    s = {usOnly: m.reg.Read("usOnly") = "1", order: m.reg.Read("order"), subtitles: m.reg.Read("subtitles") = "1", subLang: m.reg.Read("subLang"), vodUsOnly: m.reg.Read("vodUsOnly") <> "0", startOn: m.reg.Read("startOn")}
    if s.order = "" then s.order = "featured"
    if s.startOn <> "live" then s.startOn = "home"
    return s
end function

sub saveSetting(key as string, value as string)
    m.reg.Write(key, value)
    m.reg.Flush()
end sub

sub showSettingsView()
    refreshSettings(m.settingsList.itemFocused)
end sub

' Each row has an id so rows can come and go (Change passcode only appears once a passcode exists).
function settingsRows() as object
    vod = "Movies & Series: All"
    if m.settings.vodUsOnly then vod = "Movies & Series: USA only"
    lineup = "Channels: All"
    if m.settings.usOnly then lineup = "Channels: USA only"
    order = "Category order: Featured"
    if m.settings.order = "provider" then order = "Category order: Customer hub"
    if m.settings.order = "az" then order = "Category order: A to Z"
    start = "Open on: Home"
    if m.settings.startOn = "live" then start = "Open on: Live TV"
    subtitles = "Subtitles: Off"
    if m.settings.subtitles then subtitles = "Subtitles: On"
    adult = "Adult content: Locked"
    if m.adultUnlocked then adult = "Adult content: Unlocked"
    rows = [{id: "vod", label: vod}, {id: "lineup", label: lineup}, {id: "order", label: order}, {id: "start", label: start}, {id: "subtitles", label: subtitles}, {id: "adult", label: adult}]
    if hasPasscode() then rows.Push({id: "changePin", label: "Change passcode"})
    rows.Push({id: "refresh", label: "Refresh library"})
    rows.Push({id: "pair", label: "Pair again"})
    rows.Push({id: "about", label: "About"})
    return rows
end function

function settingText(id as string) as string
    if id = "vod" then return "USA only shows movies and series from the United States: titles whose category has no other country or language tag (such as FR, DE, LAT or HINDI) and, when TMDB knows where a title was made, only those made in the US. All shows every movie and series on your line."
    if id = "lineup" then return "USA only keeps live categories labelled US, USA or United States, or named after a US sports league. All shows every category on the line, as chosen in the customer hub."
    if id = "order" then return "The order of live categories: Featured (Sports, Premium and News first), the customer hub's order, or A to Z."
    if id = "start" then return "The section Tuner opens on: Home, with movies and series, or Live TV."
    if id = "subtitles" then return "When on, Tuner turns on captions and picks the subtitle language you chose last, then English. Movies and episodes without English subtitles of their own get them from OpenSubtitles.com. Press * while watching to choose a track."
    if id = "adult" then return "Adult categories stay hidden until you unlock them with your 4-digit passcode. Tuner locks them again each time it opens." + Chr(10) + Chr(10) + forgotText()
    if id = "changePin" then return "Asks for the current passcode, then a new one."
    if id = "refresh" then return "Loads your channels, movies and series again, with fresh Popular and streaming-service lists."
    if id = "pair" then return "Forgets this line on the TV and shows a new pairing code."
    if id = "about" then return aboutText()
    return ""
end function

function aboutText() as string
    text = "Tuner by LumaNest TV" + Chr(10) + "Version " + CreateObject("roAppInfo").GetVersion() + Chr(10) + Chr(10)
    if m.rowsSource = "tmdb"
        text = text + "Popular, Featured and streaming-service lists come from TMDB and only ever show titles on your line." + Chr(10) + Chr(10) + "This product uses the TMDB API but is not endorsed or certified by TMDB."
    else
        text = text + "Movies & Series lists come from your line's own categories, dates and ratings."
    end if
    ' Shown whatever the OpenSubtitles plan, so a plan change needs no app update (docs/extras.md).
    text = text + Chr(10) + Chr(10) + extrasCredit()
    return text
end function

sub refreshSettings(focusIndex as integer)
    labels = []
    for each row in settingsRows()
        labels.Push(row.label)
    end for
    setList(m.settingsList, labels)
    if focusIndex < 0 then focusIndex = 0
    if focusIndex >= labels.Count() then focusIndex = labels.Count() - 1
    m.settingsList.jumpToItem = focusIndex
    showSettingText(focusIndex)
end sub

sub onSettingFocused()
    showSettingText(m.settingsList.itemFocused)
end sub

sub showSettingText(index as integer)
    rows = settingsRows()
    if index < 0 or index >= rows.Count() then index = 0
    m.settingsInfo.text = settingText(rows[index].id)
end sub

sub onSettingChosen()
    choice = m.settingsList.itemSelected
    rows = settingsRows()
    if choice < 0 or choice >= rows.Count() then return
    id = rows[choice].id
    if id = "vod"
        m.settings.vodUsOnly = not m.settings.vodUsOnly
        if m.settings.vodUsOnly then saveSetting("vodUsOnly", "1") else saveSetting("vodUsOnly", "0")
        markBrowseDirty()
        if m.settings.vodUsOnly then showToast("Movies & Series: USA titles only.") else showToast("Movies & Series: every country on your line.")
    else if id = "lineup"
        m.settings.usOnly = not m.settings.usOnly
        if m.settings.usOnly then saveSetting("usOnly", "1") else saveSetting("usOnly", "0")
        m.liveDirty = true
        m.searchDirty = true
        if m.settings.usOnly then showToast("Showing USA channels only.") else showToast("Showing all channels on your line.")
    else if id = "order"
        if m.settings.order = "featured"
            m.settings.order = "provider"
        else if m.settings.order = "provider"
            m.settings.order = "az"
        else
            m.settings.order = "featured"
        end if
        saveSetting("order", m.settings.order)
        m.liveDirty = true
        m.searchDirty = true
    else if id = "start"
        if m.settings.startOn = "live" then m.settings.startOn = "home" else m.settings.startOn = "live"
        saveSetting("startOn", m.settings.startOn)
    else if id = "subtitles"
        setSubtitles(not m.settings.subtitles)
        if m.settings.subtitles then showToast("Subtitles on. Press * while watching to pick a track.") else showToast("Subtitles off.")
    else if id = "adult"
        if m.adultUnlocked
            ' Locking never needs the passcode.
            setAdultUnlocked(false)
            showToast("Adult content locked.")
        else if hasPasscode()
            startPinFlow("unlock")
        else
            startPinFlow("create")
        end if
    else if id = "changePin"
        startPinFlow("changeOld")
    else if id = "refresh"
        loadCatalog(true)
        showToast("Refreshing your library.")
    else if id = "pair"
        m.reg.Delete("account")
        m.reg.Flush()
        m.account = invalid
        m.catalogToken = m.catalogToken + 1
        m.catalog = invalid
        m.section = ""
        showPair()
        return
    end if
    refreshSettings(choice)
end sub

sub setAdultUnlocked(unlocked as boolean)
    m.adultUnlocked = unlocked
    markBrowseDirty()
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
    m.settingsList.setFocus(true)
end sub

sub onPinClosed()
    ' Back on the dialog cancels the flow.
    if m.pinDialog = invalid then return
    m.pinDialog = invalid
    m.settingsList.setFocus(true)
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
            setAdultUnlocked(true)
            showToast("Passcode set. Adult content unlocked.")
        else
            showToast("Passcode changed.")
        end if
        refreshSettings(m.settingsList.itemFocused)
    else if stage = "unlock" or stage = "changeOld"
        result = checkPin(pin)
        if result = "ok"
            closePinDialog()
            if stage = "unlock"
                setAdultUnlocked(true)
                showToast("Adult content unlocked until you lock it or close the app.")
                refreshSettings(m.settingsList.itemFocused)
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
