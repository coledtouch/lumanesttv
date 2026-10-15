sub init()
    m.qr = m.top.FindNode("qr")
    m.code = m.top.FindNode("code")
    m.status = m.top.FindNode("status")
    m.task = invalid
end sub

sub onActive()
    if m.top.active
        startTask()
    else
        stopTask()
    end if
end sub

sub startTask()
    stopTask()
    drawQr([])
    m.task = CreateObject("roSGNode", "PairTask")
    m.task.ObserveField("qr", "onQr")
    m.task.ObserveField("userCode", "onCode")
    m.task.ObserveField("status", "onStatus")
    m.task.ObserveField("account", "onAccount")
    m.task.control = "run"
end sub

sub stopTask()
    if m.task <> invalid
        m.task.UnobserveField("qr")
        m.task.UnobserveField("userCode")
        m.task.UnobserveField("status")
        m.task.UnobserveField("account")
        m.task.cancel = true
        m.task = invalid
    end if
end sub

sub onQr()
    drawQr(m.task.qr)
end sub

sub onCode()
    m.code.text = m.task.userCode
end sub

sub onStatus()
    m.status.text = m.task.status
end sub

sub onAccount()
    account = m.task.account
    if account = invalid or account.type = invalid then return
    stopTask()
    m.top.paired = account
end sub

' The server sends the QR modules as rows of "0"/"1"; each run of dark modules becomes one rectangle.
sub drawQr(rows as Object)
    m.qr.RemoveChildrenIndex(m.qr.GetChildCount(), 0)
    size = rows.Count()
    if size = 0 then return
    quiet = 3
    px = Int(560 / (size + quiet * 2))
    offset = Int((560 - px * size) / 2)
    for r = 0 to size - 1
        row = rows[r]
        c = 0
        while c < size
            if Mid(row, c + 1, 1) = "1"
                runStart = c
                while c < size and Mid(row, c + 1, 1) = "1"
                    c = c + 1
                end while
                block = m.qr.CreateChild("Rectangle")
                block.color = "0x141224FF"
                block.translation = [offset + runStart * px, offset + r * px]
                block.width = (c - runStart) * px
                block.height = px
            else
                c = c + 1
            end if
        end while
    end for
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return true
    if key = "OK"
        m.code.text = "····-····"
        m.status.text = "Getting a code…"
        startTask()
    else if key = "back"
        stopTask()
        m.top.closed = true
    end if
    return true
end function
