' Shared helpers for the scene and its tasks. Provider logins live only in this Roku's registry.

function utilRegistry() as Object
    return CreateObject("roRegistrySection", "tuner")
end function

' Returns the saved playlist settings, or invalid when this Roku has none.
function utilLoadSource() as Dynamic
    reg = utilRegistry()
    if not reg.Exists("source") then return invalid
    source = ParseJson(reg.Read("source"))
    if type(source) <> "roAssociativeArray" then return invalid
    if source.type = "xtream" and utilStr(source.server) <> "" and utilStr(source.username) <> "" then return source
    if source.type = "m3u" and utilStr(source.m3uUrl) <> "" then return source
    return invalid
end function

sub utilSaveSource(source as Object)
    reg = utilRegistry()
    reg.Write("source", FormatJson(source))
    reg.Flush()
end sub

sub utilClearSource()
    reg = utilRegistry()
    reg.Delete("source")
    reg.Flush()
end sub

' Provider JSON mixes numbers, strings and nulls for the same field; this always returns a trimmed string.
function utilStr(value as Dynamic) as String
    if value = invalid then return ""
    t = type(value)
    if t = "roString" or t = "String" then return value.Trim()
    if t = "roInt" or t = "Integer" or t = "roInteger" or t = "LongInteger" or t = "roLongInteger" then return value.ToStr()
    if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double" then return Str(value).Trim()
    if t = "roBoolean" or t = "Boolean" then
        if value then return "true"
        return "false"
    end if
    return ""
end function

function utilStartsWithI(value as String, prefix as String) as Boolean
    return LCase(Left(value, Len(prefix))) = LCase(prefix)
end function

' Accepts "host:port", "http://host:port/" or a full player_api.php/get.php link; returns "scheme://host:port".
function utilNormalizeServer(raw as String) as String
    s = raw.Trim()
    if s = "" then return ""
    if not utilStartsWithI(s, "http://") and not utilStartsWithI(s, "https://") then s = "http://" + s
    for each marker in ["/player_api.php", "/get.php", "/xmltv.php"]
        at = Instr(1, LCase(s), marker)
        if at > 0 then s = Left(s, at - 1)
    end for
    while Right(s, 1) = "/"
        s = Left(s, Len(s) - 1)
    end while
    return s
end function

' Recognises "http://host:port/get.php?username=..&password=.." playlist links as an Xtream login.
function utilFromGetPhp(url as String) as Dynamic
    lower = LCase(url)
    if Instr(1, lower, "/get.php?") = 0 then return invalid
    query = Mid(url, Instr(1, lower, "/get.php?") + 9)
    params = {}
    xfer = CreateObject("roUrlTransfer")
    for each pair in query.Split("&")
        eq = Instr(1, pair, "=")
        if eq > 1 then params[LCase(Left(pair, eq - 1))] = xfer.Unescape(Mid(pair, eq + 1))
    end for
    if utilStr(params.username) = "" or utilStr(params.password) = "" then return invalid
    return {type: "xtream", name: "LumaNest TV", server: utilNormalizeServer(url), username: params.username, password: params.password}
end function

function utilEscape(value as String) as String
    return CreateObject("roUrlTransfer").Escape(value)
end function

function utilXtreamApi(source as Object, action as String) as String
    url = source.server + "/player_api.php?username=" + utilEscape(source.username) + "&password=" + utilEscape(source.password)
    if action <> "" then url = url + "&action=" + action
    return url
end function

' Stream paths keep the login unescaped, matching the Xtream URL scheme the other Tuner apps use.
function utilXtreamStream(source as Object, kind as String, id as String, ext as String) as String
    return source.server + "/" + kind + "/" + source.username + "/" + source.password + "/" + id + "." + ext
end function

' Maps a file extension or URL to a Roku streamFormat; "" lets the player detect it.
function utilStreamFormat(urlOrExt as String) as String
    lower = LCase(urlOrExt)
    q = Instr(1, lower, "?")
    if q > 0 then lower = Left(lower, q - 1)
    if Right(lower, 4) = "m3u8" then return "hls"
    if Right(lower, 3) = "mp4" or Right(lower, 3) = "m4v" or Right(lower, 3) = "mov" then return "mp4"
    if Right(lower, 3) = "mkv" then return "mkv"
    if Right(lower, 3) = "mpd" then return "dash"
    return ""
end function

' Plain HTTP request with Roku's CA bundle. Returns {code, body}; code is negative when no response arrived.
function utilHttp(url as String, body as Dynamic, timeoutMs as Integer) as Object
    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    xfer.SetMessagePort(port)
    xfer.SetUrl(url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.EnableEncodings(true)
    xfer.RetainBodyOnError(true)
    ' Several IPTV panels refuse unknown players; the Android app sends the same VLC agent.
    xfer.AddHeader("User-Agent", "VLC/3.0.21 LibVLC/3.0.21")
    if body <> invalid
        ' text/plain keeps the LumaNest pairing API a simple request.
        xfer.AddHeader("Content-Type", "text/plain;charset=UTF-8")
        started = xfer.AsyncPostFromString(body)
    else
        started = xfer.AsyncGetToString()
    end if
    if not started then return {code: -1, body: ""}
    msg = wait(timeoutMs, port)
    if type(msg) = "roUrlEvent" then return {code: msg.GetResponseCode(), body: msg.GetString()}
    xfer.AsyncCancel()
    return {code: -2, body: ""}
end function
