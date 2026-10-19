' Pairing with a phone through lumanest.tv/pair: a QR code and an 8-letter code, then polling until approved.

sub initPairing()
    m.pollTimer = CreateObject("roSGNode", "Timer")
    m.pollTimer.repeat = false
    m.pollTimer.observeField("fire", "doPoll")
    m.refreshTimer = CreateObject("roSGNode", "Timer")
    m.refreshTimer.repeat = false
    m.refreshTimer.observeField("fire", "startPair")
end sub

sub showPair()
    m.shell.visible = false
    m.details.visible = false
    m.picker.visible = false
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
    finishTask(event)
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
    finishTask(event)
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
        enterApp()
        showToast("Paired with LumaNest TV. Loading your channels.")
    else if r.data.status = "expired"
        startPair()
    else
        m.pollTimer.duration = m.interval
        m.pollTimer.control = "start"
    end if
end sub
