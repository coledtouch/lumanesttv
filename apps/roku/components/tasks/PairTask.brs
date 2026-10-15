' Mirrors apps/webos/js/pairing.js: the same /api/pair/start and /api/pair/poll calls, with device "roku".

sub init()
    m.top.functionName = "pairDevice"
end sub

sub pairDevice()
    m.api = "https://lumanest.tv/api/pair/"
    m.offline = "Couldn't reach LumaNest TV. Check this Roku's internet connection."
    while not m.top.cancel
        result = pairSession()
        if result = "approved" or result = "cancelled" then return
        if result = "error" and pairWait(10) then return
    end while
end sub

' Runs one code until it is approved, expires or fails. Returns "approved", "expired", "error" or "cancelled".
function pairSession() as String
    m.top.status = "Getting a code…"
    m.top.userCode = "····-····"
    m.top.qr = []
    started = pairPost("start", {device: "roku"})
    if started.error <> "" or type(started.data.qr) <> "roArray" or utilStr(started.data.deviceCode) = ""
        message = started.error
        if message = "" then message = "Pairing isn't available right now."
        m.top.status = message + " Retrying…"
        return "error"
    end if
    data = started.data
    m.top.qr = data.qr
    m.top.userCode = utilStr(data.userCode)
    m.top.status = "Waiting for you to approve on your phone…"
    ' Codes last 10 minutes; refresh a little early so the one on screen always works.
    lifetime = 600
    if data.expiresIn <> invalid then lifetime = data.expiresIn
    lifetime = lifetime - 20
    if lifetime < 60 then lifetime = 60
    interval = 5
    if data.interval <> invalid and data.interval > 0 then interval = data.interval
    clock = CreateObject("roTimespan")
    while true
        if pairWait(interval) then return "cancelled"
        if clock.TotalSeconds() >= lifetime then return "expired"
        polled = pairPost("poll", {deviceCode: data.deviceCode})
        if polled.error <> ""
            m.top.status = polled.error + " Retrying…"
            interval = interval * 2
            if interval > 30 then interval = 30
        else if polled.data.status = "approved"
            source = pairSource(polled.data.account)
            if source = invalid
                m.top.status = "This Roku couldn't use that login. Getting a new code…"
                return "error"
            end if
            m.top.status = "Connected. Loading your channels…"
            m.top.account = source
            return "approved"
        else if polled.data.status = "expired"
            return "expired"
        else
            m.top.status = "Waiting for you to approve on your phone…"
        end if
    end while
    return "expired"
end function

' Converts the server's account into this app's playlist settings, or invalid when it is unusable.
function pairSource(account as Dynamic) as Dynamic
    if type(account) <> "roAssociativeArray" then return invalid
    name = utilStr(account.name)
    if name = "" then name = "LumaNest TV"
    if account.type = "xtream"
        server = utilNormalizeServer(utilStr(account.server))
        if server = "" or utilStr(account.username) = "" then return invalid
        return {type: "xtream", name: name, server: server, username: utilStr(account.username), password: utilStr(account.password)}
    else if account.type = "m3u"
        url = utilStr(account.m3uUrl)
        if not utilStartsWithI(url, "http://") and not utilStartsWithI(url, "https://") then return invalid
        return {type: "m3u", name: name, m3uUrl: url}
    end if
    return invalid
end function

function pairPost(path as String, body as Object) as Object
    response = utilHttp(m.api + path, FormatJson(body), 15000)
    data = ParseJson(response.body)
    if type(data) <> "roAssociativeArray" then data = invalid
    if response.code >= 200 and response.code < 300 and data <> invalid then return {error: "", data: data}
    message = m.offline
    if data <> invalid and type(data.error) = "roAssociativeArray" and utilStr(data.error.message) <> "" then message = data.error.message
    return {error: message, data: {}}
end function

' Sleeps in short steps so Back on the TV stops the task promptly. Returns true when cancelled.
function pairWait(seconds as Integer) as Boolean
    for i = 1 to seconds * 4
        if m.top.cancel then return true
        sleep(250)
    end for
    return m.top.cancel
end function
