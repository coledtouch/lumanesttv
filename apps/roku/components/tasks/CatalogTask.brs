' Parsing is kept in plain functions (groupXtream, parseM3u) so tests can run it without SceneGraph;
' buildContent turns the result into the ContentNode tree the lists display.

sub init()
    m.top.functionName = "loadCatalog"
end sub

sub loadCatalog()
    source = m.top.source
    if source = invalid or source.type = invalid
        m.top.error = "Add a playlist in Settings first."
        return
    end if
    if source.type = "xtream"
        result = loadXtream(source, m.top.section)
    else
        result = loadM3u(source, m.top.section)
    end if
    if result.error <> ""
        m.top.error = result.error
    else
        m.top.content = buildContent(result.groups)
    end if
end sub

function fetchJson(url as String) as Object
    response = utilHttp(url, invalid, 90000)
    if response.code = -2 then return {error: "The provider took too long to answer. Try Reload in Settings.", data: invalid}
    if response.code < 200 or response.code >= 300
        if response.code = 401 or response.code = 403 then return {error: "The provider refused this line login. Check it in Settings.", data: invalid}
        return {error: "Couldn't reach the provider (" + response.code.ToStr() + "). Check the server address in Settings.", data: invalid}
    end if
    data = ParseJson(response.body)
    if data = invalid then return {error: "The provider sent a list this Roku couldn't read.", data: invalid}
    return {error: "", data: data}
end function

function loadXtream(source as Object, section as String) as Object
    if section = "movies"
        cats = fetchJson(utilXtreamApi(source, "get_vod_categories"))
        if cats.error <> "" then return {error: cats.error}
        items = fetchJson(utilXtreamApi(source, "get_vod_streams"))
    else
        cats = fetchJson(utilXtreamApi(source, "get_live_categories"))
        if cats.error <> "" then return {error: cats.error}
        items = fetchJson(utilXtreamApi(source, "get_live_streams"))
    end if
    if items.error <> "" then return {error: items.error}
    ' Panels answer a wrong login with {"user_info":{"auth":0}} rather than an error status.
    if type(items.data) <> "roArray" then return {error: "The provider refused this line login. Check it in Settings."}
    groups = groupXtream(source, section, cats.data, items.data)
    if groups.Count() = 0
        if section = "movies" then return {error: "This line has no movies."}
        return {error: "This line has no channels."}
    end if
    return {error: "", groups: groups}
end function

' Returns [{title, items: [{title, url, streamFormat, live, poster, label}]}] in the provider's category order.
function groupXtream(source as Object, section as String, cats as Dynamic, streams as Object) as Object
    byId = {}
    order = []
    if type(cats) = "roArray"
        for each cat in cats
            if type(cat) = "roAssociativeArray"
                id = utilStr(cat.category_id)
                if id <> "" and not byId.DoesExist(id)
                    title = utilStr(cat.category_name)
                    if title = "" then title = "Other"
                    byId[id] = {title: title, items: []}
                    order.Push(id)
                end if
            end if
        end for
    end if
    for each stream in streams
        if type(stream) = "roAssociativeArray"
            id = utilStr(stream.stream_id)
            if id <> ""
                catId = utilStr(stream.category_id)
                if not byId.DoesExist(catId)
                    byId[catId] = {title: "Other", items: []}
                    order.Push(catId)
                end if
                if section = "movies"
                    ext = utilStr(stream.container_extension)
                    if ext = "" then ext = "mp4"
                    rating = utilStr(stream.rating)
                    label = ""
                    if rating <> "" and rating <> "0" then label = "★ " + rating
                    byId[catId].items.Push({title: utilStr(stream.name), url: utilXtreamStream(source, "movie", id, ext), streamFormat: utilStreamFormat(ext), live: false, poster: utilStr(stream.stream_icon), label: label})
                else
                    ' Roku plays HLS natively, so live channels use the panel's .m3u8 output.
                    byId[catId].items.Push({title: utilStr(stream.name), url: utilXtreamStream(source, "live", id, "m3u8"), streamFormat: "hls", live: true, poster: utilStr(stream.stream_icon), label: utilStr(stream.num)})
                end if
            end if
        end if
    end for
    groups = []
    for each catId in order
        if byId[catId].items.Count() > 0 then groups.Push(byId[catId])
    end for
    return groups
end function

function loadM3u(source as Object, section as String) as Object
    response = utilHttp(source.m3uUrl, invalid, 90000)
    if response.code < 200 or response.code >= 300 or response.body = ""
        return {error: "Couldn't download the M3U playlist. Check its link in Settings."}
    end if
    groups = parseM3u(response.body, section)
    if groups.Count() = 0
        if section = "movies" then return {error: "This playlist has no movies."}
        return {error: "This playlist has no channels. Check its link in Settings."}
    end if
    return {error: "", groups: groups}
end function

' M3U playlists hold live and on-demand entries together; on-demand links are recognised as the Android app does.
function parseM3u(text as String, section as String) as Object
    wantVod = section = "movies"
    groups = []
    byName = {}
    attrs = {}
    title = ""
    groupOverride = ""
    count = 0
    for each raw in text.Split(Chr(10))
        line = raw.Trim()
        if utilStartsWithI(line, "#EXTINF")
            attrs = m3uAttributes(line)
            title = m3uTitle(line)
            groupOverride = ""
        else if utilStartsWithI(line, "#EXTGRP:")
            groupOverride = Mid(line, 9).Trim()
        else if line <> "" and Left(line, 1) <> "#"
            lower = LCase(line)
            isVod = Instr(1, lower, "/movie/") > 0 or Instr(1, lower, "/series/") > 0 or Right(lower, 4) = ".mp4" or Right(lower, 4) = ".mkv" or Right(lower, 4) = ".avi"
            if wantVod = isVod
                count = count + 1
                group = utilStr(attrs["group-title"])
                if group = "" then group = groupOverride
                if group = "" then group = "Uncategorized"
                if not byName.DoesExist(group)
                    byName[group] = {title: group, items: []}
                    groups.Push(byName[group])
                end if
                name = title
                if name = "" then name = utilStr(attrs["tvg-name"])
                if name = "" then name = "Channel " + count.ToStr()
                label = ""
                if not isVod then label = utilStr(attrs["tvg-chno"])
                byName[group].items.Push({title: name, url: line, streamFormat: utilStreamFormat(line), live: not isVod, poster: utilStr(attrs["tvg-logo"]), label: label})
            end if
            attrs = {}
            title = ""
        end if
    end for
    return groups
end function

' Reads key="value" pairs from an #EXTINF line.
function m3uAttributes(line as String) as Object
    if m.attrRe = invalid then m.attrRe = CreateObject("roRegex", "([A-Za-z0-9_-]+)=" + Chr(34) + "([^" + Chr(34) + "]*)" + Chr(34), "")
    result = {}
    for each match in m.attrRe.MatchAll(line)
        result[LCase(match[1])] = match[2]
    end for
    return result
end function

' The display name follows the first comma after the quoted attribute values, so names may contain commas.
function m3uTitle(line as String) as String
    lastQuote = 0
    at = Instr(1, line, Chr(34))
    while at > 0
        lastQuote = at
        at = Instr(at + 1, line, Chr(34))
    end while
    comma = Instr(lastQuote + 1, line, ",")
    if comma = 0 then return ""
    return Mid(line, comma + 1).Trim()
end function

' root > category > item. Building the nodes in this task keeps the remote responsive on large lineups.
function buildContent(groups as Object) as Object
    root = CreateObject("roSGNode", "ContentNode")
    for each group in groups
        cat = root.CreateChild("ContentNode")
        cat.title = group.title
        for each entry in group.items
            item = cat.CreateChild("ContentNode")
            item.title = entry.title
            item.url = entry.url
            if entry.streamFormat <> "" then item.streamFormat = entry.streamFormat
            item.live = entry.live
            item.HDPosterUrl = entry.poster
            item.ShortDescriptionLine1 = entry.label
        end for
    end for
    return root
end function
