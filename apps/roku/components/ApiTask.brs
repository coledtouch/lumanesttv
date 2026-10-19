' Network work for MainScene. request.mode is one of: pairStart, pairPoll, catalog, seriesInfo, vodInfo.
' The response is {mode, ok, data, error, token}; token is copied from the request.

sub init()
    m.top.functionName = "execute"
end sub

function pairApi() as string
    return "https://lumanest.tv/api/pair/"
end function

sub execute()
    req = m.top.request
    if req = invalid then return
    mode = req.mode
    result = {mode: mode, ok: false, data: invalid, error: "", token: req.token}
    if mode = "pairStart"
        r = http(pairApi() + "start", FormatJson({device: "roku"}))
        data = jsonOf(r)
        if data <> invalid and data.qr <> invalid and data.deviceCode <> invalid
            result.ok = true
            result.data = data
        else
            result.error = errorOf(r, data, "Pairing isn't available right now.")
        end if
    else if mode = "pairPoll"
        r = http(pairApi() + "poll", FormatJson({deviceCode: req.deviceCode}))
        data = jsonOf(r)
        if data <> invalid and data.status <> invalid
            result.ok = true
            result.data = data
        else
            result.error = errorOf(r, data, "Can't reach LumaNest TV.")
        end if
    else if mode = "catalog"
        account = req.account
        ' The Movies & Series lists download while the catalogue loads.
        rows = rowsBegin(isTrueValue(req.refresh))
        if account <> invalid and account.type = "xtream"
            result.data = xtreamCatalog(account, rows)
        else if account <> invalid and account.type = "m3u"
            result.data = m3uCatalog(account, rows)
        end if
        if result.data <> invalid
            result.ok = true
        else
            result.error = "Your channels couldn't be loaded. Check the TV's internet connection, then choose Refresh library in Settings."
        end if
    else if mode = "seriesInfo"
        result.data = seriesEpisodes(req.account, req.seriesId)
        result.ok = result.data <> invalid
        if not result.ok then result.error = "This series couldn't be loaded."
    else if mode = "vodInfo"
        result.data = movieInfo(req.account, req.streamId)
        result.ok = result.data <> invalid
    end if
    m.top.response = result
end sub

' ------------------------------------------------------------------ HTTP

function http(url as string, body as dynamic) as object
    transfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    transfer.SetMessagePort(port)
    transfer.SetUrl(url)
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.EnableEncodings(true)
    transfer.RetainBodyOnError(true)
    transfer.AddHeader("User-Agent", "LumaNestTuner/Roku")
    if body <> invalid
        ' text/plain keeps the pairing request a simple request, the same as the other TV apps.
        transfer.AddHeader("Content-Type", "text/plain;charset=UTF-8")
        started = transfer.AsyncPostFromString(body)
    else
        started = transfer.AsyncGetToString()
    end if
    if not started then return {code: -1, body: ""}
    msg = wait(60000, port)
    if type(msg) = "roUrlEvent" then return {code: msg.GetResponseCode(), body: msg.GetString()}
    transfer.AsyncCancel()
    return {code: -1, body: ""}
end function

function jsonOf(r as object) as dynamic
    if r.body = invalid or r.body = "" then return invalid
    return ParseJson(r.body)
end function

function errorOf(r as object, data as dynamic, fallback as string) as string
    if data <> invalid and data.error <> invalid and data.error.message <> invalid then return data.error.message
    return fallback
end function

' ------------------------------------------------------------------ Xtream

function xtreamBase(account as object) as object
    escaper = CreateObject("roUrlTransfer")
    server = account.server
    while Right(server, 1) = "/"
        server = Left(server, Len(server) - 1)
    end while
    return {server: server, user: escaper.Escape(account.username), pass: escaper.Escape(account.password)}
end function

function xtreamGet(base as object, action as string) as dynamic
    url = base.server + "/player_api.php?username=" + base.user + "&password=" + base.pass + "&action=" + action
    r = http(url, invalid)
    if r.code < 200 or r.code >= 300 then return invalid
    return jsonOf(r)
end function

function categoriesOf(rows as dynamic) as object
    result = []
    if type(rows) <> "roArray" then return result
    for each row in rows
        id = asText(row.category_id)
        if id <> "" then result.Push({id: id, name: asText(row.category_name), adult: isFlagOn(row.is_adult)})
    end for
    return result
end function

' Groups live channels by category so the screen never filters a 17,000-item list on the render thread.
function grouped(categories as object, items as object) as object
    byCat = {}
    for each item in items
        list = byCat[item.cat]
        if list = invalid
            list = []
            byCat[item.cat] = list
        end if
        list.Push(item)
    end for
    used = []
    for each cat in categories
        if byCat[cat.id] <> invalid then used.Push(cat)
    end for
    if byCat["__other"] <> invalid then used.Push({id: "__other", name: "Other", adult: false})
    return {categories: used, byCat: byCat}
end function

function xtreamCatalog(account as object, rowsJob as object) as dynamic
    base = xtreamBase(account)
    liveRows = xtreamGet(base, "get_live_streams")
    if type(liveRows) <> "roArray" then return invalid
    live = []
    for each s in liveRows
        id = asText(s.stream_id)
        if id <> ""
            cat = asText(s.category_id)
            if cat = "" then cat = "__other"
            live.Push({kind: "live", name: asText(s.name), icon: asText(s.stream_icon), cat: cat, adult: isFlagOn(s.is_adult), url: base.server + "/live/" + base.user + "/" + base.pass + "/" + id + ".m3u8"})
        end if
    end for
    liveRows = invalid
    rx = browseRx()
    movies = []
    for each row in arrayOrEmpty(xtreamGet(base, "get_vod_streams"))
        title = titleFromXtream("movie", row, rx)
        if title <> invalid then movies.Push(title)
    end for
    series = []
    for each row in arrayOrEmpty(xtreamGet(base, "get_series"))
        title = titleFromXtream("series", row, rx)
        if title <> invalid then series.Push(title)
    end for
    rows = rowsFinish(rowsJob)
    return {
        live: grouped(categoriesOf(xtreamGet(base, "get_live_categories")), live),
        movies: buildTitleSection(movies, categoriesOf(xtreamGet(base, "get_vod_categories")), rows.movie, rows.genres.movie, rx),
        series: buildTitleSection(series, categoriesOf(xtreamGet(base, "get_series_categories")), rows.tv, rows.genres.tv, rx),
        moviePrefix: base.server + "/movie/" + base.user + "/" + base.pass + "/",
        rows: {source: rows.source, generated: rows.generated}
    }
end function

' A series' episodes in season order, plus its description.
function seriesEpisodes(account as object, seriesId as string) as dynamic
    if account = invalid or account.type <> "xtream" then return invalid
    base = xtreamBase(account)
    info = xtreamGet(base, "get_series_info&series_id=" + seriesId)
    if info = invalid or not isAssoc(info.episodes) then return invalid
    seasons = []
    for each key in info.episodes
        seasons.Push({key: key, number: Val(key)})
    end for
    seasons.SortBy("number")
    episodes = []
    for each season in seasons
        for each e in arrayOrEmpty(info.episodes[season.key])
            id = asText(e.id)
            ext = asText(e.container_extension)
            if ext = "" then ext = "mp4"
            title = asText(e.title)
            label = "S" + season.key + " E" + asText(e.episode_num)
            name = label
            if title <> "" then name = label + "  " + title
            if id <> "" then episodes.Push({kind: "episode", id: id, label: label, name: name, url: base.server + "/series/" + base.user + "/" + base.pass + "/" + id + "." + ext})
        end for
    end for
    plot = ""
    if isAssoc(info.info) then plot = asText(info.info.plot)
    return {episodes: episodes, plot: plot}
end function

' A movie's description and running time from get_vod_info; nothing else on the details screen needs it.
function movieInfo(account as object, streamId as dynamic) as dynamic
    if account = invalid or account.type <> "xtream" or asText(streamId) = "" then return invalid
    data = xtreamGet(xtreamBase(account), "get_vod_info&vod_id=" + asText(streamId))
    if not isAssoc(data) or not isAssoc(data.info) then return invalid
    return {plot: asText(data.info.plot), duration: asText(data.info.duration), genre: asText(data.info.genre)}
end function

' ------------------------------------------------------------------ M3U

' A short stable key for an M3U entry, from its URL ("m~" movies, "s~" series).
function m3uKey(prefix as string, url as string) as string
    bytes = CreateObject("roByteArray")
    bytes.FromAsciiString(url)
    digest = CreateObject("roEVPDigest")
    digest.Setup("md5")
    return prefix + "~" + Left(LCase(digest.Process(bytes)), 12)
end function

function m3uCatalog(account as object, rowsJob as object) as dynamic
    r = http(account.m3uUrl, invalid)
    if r.code < 200 or r.code >= 300 or Left(r.body.Trim(), 7) <> "#EXTM3U" then return invalid
    rx = browseRx()
    groupRe = CreateObject("roRegex", "group-title=" + Chr(34) + "([^" + Chr(34) + "]*)" + Chr(34), "i")
    logoRe = CreateObject("roRegex", "tvg-logo=" + Chr(34) + "([^" + Chr(34) + "]*)" + Chr(34), "i")
    lists = {live: [], movies: [], series: []}
    cats = {live: [], movies: [], series: []}
    seen = {live: {}, movies: {}, series: {}}
    pending = invalid
    for each raw in r.body.Tokenize(Chr(10))
        ' trimField, not Trim, which may remove more than spaces from the ends of a title (docs/browse.md, "Trimming").
        line = trimField(raw)
        if Left(line, 7) = "#EXTINF"
            ' The title follows the last comma outside quoted attributes.
            lastComma = 0
            inQuote = false
            for i = 1 to Len(line)
                ch = Mid(line, i, 1)
                if ch = Chr(34)
                    inQuote = not inQuote
                else if ch = "," and not inQuote
                    lastComma = i
                end if
            end for
            name = Mid(line, lastComma + 1)
            group = ""
            m1 = groupRe.Match(line)
            if m1.Count() > 1 then group = m1[1]
            logo = ""
            m2 = logoRe.Match(line)
            if m2.Count() > 1 then logo = m2[1]
            pending = {name: trimField(name), group: group, icon: logo}
        else if line <> "" and Left(line, 1) <> "#" and pending <> invalid
            lower = LCase(line)
            section = "live"
            if lower.InStr("/movie/") >= 0 or Right(lower, 4) = ".mp4" or Right(lower, 4) = ".mkv"
                section = "movies"
            else if lower.InStr("/series/") >= 0
                section = "series"
            end if
            group = pending.group
            if group = "" then group = "Other"
            if not seen[section].DoesExist(group)
                seen[section][group] = true
                cats[section].Push({id: group, name: group, adult: false})
            end if
            if section = "live"
                lists.live.Push({kind: "live", name: pending.name, icon: pending.icon, cat: group, adult: false, url: line})
            else if section = "movies"
                lists.movies.Push(titleFromM3u("movie", m3uKey("m", line), pending.name, pending.icon, group, line, rx))
            else
                ' An M3U series entry is one episode that plays on its own.
                lists.series.Push(titleFromM3u("episode", m3uKey("s", line), pending.name, pending.icon, group, line, rx))
            end if
            pending = invalid
        end if
    end for
    rows = rowsFinish(rowsJob)
    return {
        live: grouped(cats.live, lists.live),
        movies: buildTitleSection(lists.movies, cats.movies, rows.movie, rows.genres.movie, rx),
        series: buildTitleSection(lists.series, cats.series, rows.tv, rows.genres.tv, rx),
        moviePrefix: "",
        rows: {source: rows.source, generated: rows.generated}
    }
end function
