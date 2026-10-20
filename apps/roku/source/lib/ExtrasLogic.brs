' Subtitles, trailers and the hidden live category (docs/extras.md), in plain BrightScript like BrowseLogic.brs.
' Nothing here touches m, SceneGraph nodes, the registry or the network, so the catalog task (ApiTask), the screen
' (MainScene) and the on-device tests (apps/roku/tests) all run the same code. It uses asText, isAssoc, isTrueValue,
' arrayOrEmpty, arrayHas, exactKeys, trimField and titleYearOf from BrowseLogic.brs, which is always loaded with it.
' Strings here stay ASCII; labels with other characters come from the server's JSON.

function extrasBase() as string
    return "https://lumanest.tv/"
end function

function extrasCredit() as string
    return "Subtitles provided by OpenSubtitles.com"
end function

' ------------------------------------------------------------------ hidden live category

' The provider's own "Most watched now" live category, hidden by its name on every line (docs/extras.md, Hidden live
' category): each ASCII letter lower-cased, each ASCII letter or digit kept, every other character (punctuation,
' spaces of any kind, emoji, letters beyond ASCII) a separator; one leading and then one trailing word us, usa or en
' dropped; hidden when the words left are exactly "most watched now" or "most watched". A loop over the characters
' with Asc, not roRegex, which may match bytes. Tuner has no category of its own with this name.
function isHiddenLiveCategory(name as dynamic) as boolean
    t = type(name)
    if t <> "roString" and t <> "String" then return false
    ' Every hidden name has the ASCII letters "watched" in a row, so most names are never read one character at a
    ' time. LCase may change letters beyond ASCII as well (the Kelvin sign to k), which only lets more names through
    ' to the loop, never fewer.
    if Instr(1, LCase(name), "watched") = 0 then return false
    words = []
    word = ""
    count = Len(name)
    for i = 1 to count + 1
        code = 32
        if i <= count then code = Asc(Mid(name, i, 1))
        if code >= 65 and code <= 90
            word = word + Chr(code + 32)
        else if (code >= 97 and code <= 122) or (code >= 48 and code <= 57)
            word = word + Chr(code)
        else if word <> ""
            words.Push(word)
            word = ""
            ' A tag, three words and a tag at most: a longer name is never hidden, and is read no further.
            if words.Count() > 5 then return false
        end if
    end for
    if words.Count() > 0 and isLiveCategoryTag(words[0]) then words.Shift()
    if words.Count() > 0 and isLiveCategoryTag(words[words.Count() - 1]) then words.Pop()
    rest = words.Join(" ")
    return rest = "most watched now" or rest = "most watched"
end function

function isLiveCategoryTag(word as string) as boolean
    return word = "us" or word = "usa" or word = "en"
end function

' The live categories ([{id, name, adult}]) without the hidden ones: {categories, hidden}, where hidden holds the ids
' taken out (provider text, told apart by letter case with exactKeys and read with brackets).
function hideLiveCategories(categories as object) as object
    kept = []
    hidden = exactKeys()
    for each cat in categories
        if isHiddenLiveCategory(cat.name) then hidden[asText(cat.id)] = true else kept.Push(cat)
    end for
    return {categories: kept, hidden: hidden}
end function

' The category an Xtream live channel (a get_live_streams row as ParseJson gave it) is listed under once the hidden
' categories are gone: its category_id when that is not hidden, as before. When its category_id is hidden, or one of
' its category_ids is, the first category_ids entry that is not hidden takes its place; a channel whose categories
' were all hidden gives invalid and is dropped (it is a copy of a channel in another category). A channel with no
' category at all gives "" (Other), as before.
function liveChannelCategory(row as object, hidden as object) as dynamic
    primary = asText(row["category_id"])
    if hidden.Count() = 0 then return primary
    if primary <> "" and hidden[primary] = invalid then return primary
    hiddenSeen = primary <> ""
    first = ""
    for each value in arrayOrEmpty(row["category_ids"])
        id = asText(value)
        if id <> ""
            if hidden[id] <> invalid
                hiddenSeen = true
            else if first = ""
                first = id
            end if
        end if
    end for
    if not hiddenSeen then return primary
    if first <> "" then return first
    return invalid
end function

' ------------------------------------------------------------------ lookups

' Which ids a lookup sends (docs/extras.md, Which ids an app sends). ref is {type, tmdb, season, episode, name, year}:
' type "movie" or "episode" for subtitles, "movie" or "tv" for a trailer; for an episode tmdb, name and year are the
' series'. Returns the query in the documented order, as every app sends it, or "" when the title can't be asked for
' (no TMDB id and no year, a name that is empty or over 300 characters, or an episode without its numbers).
function subtitlesQuery(ref as dynamic, rx as object) as string
    return extrasQuery(ref, ["movie", "episode"], rx)
end function

function trailerQuery(ref as dynamic, rx as object) as string
    return extrasQuery(ref, ["movie", "tv"], rx)
end function

function extrasQuery(ref as dynamic, types as object, rx as object) as string
    if not isAssoc(ref) then return ""
    kind = asText(ref.type)
    if not arrayHas(types, kind) then return ""
    parts = ["v=1", "type=" + kind]
    tmdb = asText(ref.tmdb)
    if not isTmdbIdText(tmdb) then tmdb = ""
    if tmdb <> "" then parts.Push("tmdb=" + tmdb)
    if kind = "episode"
        season = extrasNumber(ref.season, 0, 9999)
        episode = extrasNumber(ref.episode, 1, 9999)
        if season < 0 or episode < 0 then return ""
        parts.Push("season=" + season.ToStr())
        parts.Push("episode=" + episode.ToStr())
    end if
    if tmdb = ""
        name = ""
        if ref.name <> invalid then name = trimField(asText(ref.name), rx)
        year = extrasNumber(ref.year, 1800, 2099)
        if name = "" or Len(name) > 300 or year < 0 then return ""
        parts.Push("name=" + extrasEscape(name))
        parts.Push("year=" + year.ToStr())
    end if
    return parts.Join("&")
end function

' 1 to 12 ASCII digits without a leading zero.
function isTmdbIdText(s as string) as boolean
    n = Len(s)
    if n < 1 or n > 12 or Left(s, 1) = "0" then return false
    return isAsciiDigits(s)
end function

function isAsciiDigits(s as string) as boolean
    if s = "" then return false
    for i = 1 to Len(s)
        code = Asc(Mid(s, i, 1))
        if code < 48 or code > 57 then return false
    end for
    return true
end function

' A whole number from low to high, or -1: an Integer or LongInteger, a whole Float or Double, or 1 to 4 ASCII digits
' (leading zeros allowed: Xtream's season "01").
function extrasNumber(v as dynamic, low as integer, high as integer) as integer
    t = type(v)
    if t = "roInteger" or t = "Integer" or t = "roLongInteger" or t = "LongInteger"
        if v >= low and v <= high then return Int(v)
    else if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double"
        if v >= low and v <= high and v = Int(v) then return Int(v)
    else if t = "roString" or t = "String"
        if Len(v) >= 1 and Len(v) <= 4 and isAsciiDigits(v)
            n = Val(v)
            if n >= low and n <= high then return Int(n)
        end if
    end if
    return -1
end function

' Text as JavaScript's encodeURIComponent writes it, so every app asks for the same URL: UTF-8, with every byte but
' A to Z, a to z, 0 to 9 and - _ . ! ~ * ' ( ) written as %XX.
function extrasEscape(s as string) as string
    bytes = CreateObject("roByteArray")
    bytes.FromAsciiString(s)
    hexDigits = "0123456789ABCDEF"
    out = []
    ' By index: the emulator (brs-cli) steps through a roByteArray in a for each loop one byte off.
    for i = 0 to bytes.Count() - 1
        b = bytes[i]
        if (b >= 65 and b <= 90) or (b >= 97 and b <= 122) or (b >= 48 and b <= 57) or b = 45 or b = 95 or b = 46 or b = 33 or b = 126 or b = 42 or b = 39 or b = 40 or b = 41
            out.Push(Chr(b))
        else
            out.Push("%" + Mid(hexDigits, (b \ 16) + 1, 1) + Mid(hexDigits, (b mod 16) + 1, 1))
        end if
    end for
    return out.Join("")
end function

' The TMDB id the lookups send for a catalogue title: the provider's own (docs/browse.md, Matching step 1; buildTitleSection
' keeps it as ptmdb when the rows don't list it), else the id of the rows item the title matched (step 2), else "".
function extrasTmdbOf(item as object) as string
    provider = asText(item.ptmdb)
    if provider <> "" then return provider
    return asText(item.tmdb)
end function

' What a movie (or an M3U entry played as one) sends for subtitles. An M3U entry named like "Show S01E02" is an
' episode of Show: its season and episode numbers, with the name before them and the year in that name (a TMDB id it
' matched among movies is not the series'). An M3U episode without those numbers gets no lookup.
function titleSubtitlesRef(item as object, rx as object) as object
    tmdb = extrasTmdbOf(item)
    if asText(item.id) = ""
        found = episodeInName(asText(item.name))
        if found <> invalid
            if item.kind <> "episode" then tmdb = ""
            return {type: "episode", tmdb: tmdb, season: found.season, episode: found.episode, name: found.series, year: titleYearOf(found.series, rx)}
        end if
        if item.kind = "episode" then return {type: "episode", tmdb: tmdb}
    end if
    return {type: "movie", tmdb: tmdb, name: item.name, year: item.year}
end function

' What an Xtream episode sends: its series' TMDB id (or the series' name and year), with the season it is listed under
' and its episode_num (seriesEpisodes keeps both as numbers, -1 when they are not).
function episodeSubtitlesRef(series as object, episode as object) as object
    return {type: "episode", tmdb: extrasTmdbOf(series), season: episode.season, episode: episode.episode, name: series.name, year: series.year}
end function

' What a movie or series page sends for its trailer; invalid for anything else (an M3U episode).
function trailerRef(item as object) as dynamic
    kind = ""
    if item.kind = "movie" then kind = "movie"
    if item.kind = "series" then kind = "tv"
    if kind = "" then return invalid
    return {type: kind, tmdb: extrasTmdbOf(item), name: item.name, year: item.year}
end function

' The first "S<season> E<episode>" marker in a name: S or s and 1 to 4 digits, at most one of space . _ -, E or e and
' 1 to 4 digits, with no letter or digit just before it and no digit just after it. Returns {season, episode, series}
' (series: the name before the marker, which the lookup trims as a provider field) or invalid.
function episodeInName(name as string) as dynamic
    count = Len(name)
    at = 1
    while at <= count
        s = Instr(at, name, "S")
        lower = Instr(at, name, "s")
        if s = 0 or (lower > 0 and lower < s) then s = lower
        if s = 0 then return invalid
        at = s + 1
        before = 32
        if s > 1 then before = Asc(Mid(name, s - 1, 1))
        if not isAsciiAlnum(before)
            i = s + 1
            season = digitRun(name, i)
            i = i + Len(season)
            if season <> ""
                if i <= count and Instr(1, " ._-", Mid(name, i, 1)) > 0 then i = i + 1
                if i <= count and (Mid(name, i, 1) = "E" or Mid(name, i, 1) = "e")
                    ' digitRun gives "" when a fifth digit follows, so no digit comes just after the episode.
                    episode = digitRun(name, i + 1)
                    if episode <> ""
                        return {season: Int(Val(season)), episode: Int(Val(episode)), series: Left(name, s - 1)}
                    end if
                end if
            end if
        end if
    end while
    return invalid
end function

' The run of 1 to 4 ASCII digits that starts at position i, or "" (also when a fifth digit follows).
function digitRun(s as string, i as integer) as string
    n = 0
    while i + n <= Len(s) and n < 5 and isAsciiDigitCode(Asc(Mid(s, i + n, 1)))
        n = n + 1
    end while
    if n < 1 or n > 4 then return ""
    return Mid(s, i, n)
end function

function isAsciiDigitCode(code as integer) as boolean
    return code >= 48 and code <= 57
end function

function isAsciiAlnum(code as integer) as boolean
    return (code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122)
end function

' ------------------------------------------------------------------ answers

' The JSON object of a version 1 answer, or invalid.
function extrasJson(body as dynamic) as dynamic
    t = type(body)
    if (t <> "roString" and t <> "String") or body = "" then return invalid
    data = ParseJson(body)
    if not isAssoc(data) then return invalid
    v = data["v"]
    t = type(v)
    if t <> "roInteger" and t <> "Integer" and t <> "roLongInteger" and t <> "LongInteger" then return invalid
    if v <> 1 then return invalid
    return data
end function

' A server text shown as it is in a label: every control character a space, the ends trimmed, at most max characters.
' "" for anything that is not a string.
function extrasPlain(v as dynamic, max as integer) as string
    t = type(v)
    if t <> "roString" and t <> "String" then return ""
    s = Left(v, max * 2)
    out = []
    for i = 1 to Len(s)
        ch = Mid(s, i, 1)
        code = Asc(ch)
        if code < 32 or (code >= 127 and code <= 159) then ch = " "
        out.Push(ch)
    end for
    return Left(out.Join("").Trim(), max)
end function

' A file URL from a lookup: only https://lumanest.tv/ links ending in ext are used (docs/extras.md, Subtitles lookup).
function isExtrasFileUrl(v as dynamic, ext as string) as boolean
    t = type(v)
    if t <> "roString" and t <> "String" then return false
    base = extrasBase()
    return Len(v) > Len(base) + Len(ext) and Left(v, Len(base)) = base and Right(v, Len(ext)) = ext and Instr(1, v, " ") = 0
end function

' A 200 answer of /api/extras/subtitles as {status, tracks, credit}, or invalid when it can't be read. tracks holds at
' most 3, best first, each {id, label, hi, srt}; a track whose srt file is not on lumanest.tv is left out. Labels and
' the credit are plain text for a label.
function parseSubtitlesAnswer(body as dynamic) as dynamic
    data = extrasJson(body)
    if data = invalid then return invalid
    tracks = []
    for each raw in arrayOrEmpty(data["tracks"])
        if tracks.Count() < 3 and isAssoc(raw)
            srt = raw["srt"]
            if isExtrasFileUrl(srt, ".srt")
                label = extrasPlain(raw["label"], 80)
                if label = "" then label = "English (OpenSubtitles)"
                tracks.Push({id: extrasPlain(raw["id"], 64), label: label, hi: isTrueValue(raw["hi"]), srt: srt})
            end if
        end if
    end for
    credit = extrasPlain(data["credit"], 120)
    if credit = "" then credit = extrasCredit()
    return {status: extrasPlain(data["status"], 32), tracks: tracks, credit: credit}
end function

' A YouTube video key: 11 of A to Z, a to z, 0 to 9, _ and -.
function isYoutubeKey(v as dynamic) as boolean
    t = type(v)
    if t <> "roString" and t <> "String" then return false
    if Len(v) <> 11 then return false
    for i = 1 to 11
        code = Asc(Mid(v, i, 1))
        if not isAsciiAlnum(code) and code <> 95 and code <> 45 then return false
    end for
    return true
end function

' A QR code as the server sends it (rows of "0" and "1", as many rows as each row is long, 21 to 177), or [] when it
' is anything else.
function qrRowsOf(v as dynamic) as object
    if type(v) <> "roArray" then return []
    size = v.Count()
    if size < 21 or size > 177 then return []
    rows = []
    for each row in v
        t = type(row)
        if t <> "roString" and t <> "String" then return []
        if Len(row) <> size or row.Replace("0", "").Replace("1", "") <> "" then return []
        rows.Push(row)
    end for
    return rows
end function

' A 200 answer of /api/extras/trailer as {status, trailer}, or invalid when it can't be read. trailer is invalid unless
' the answer has a YouTube key; then {key, name, short, qr}, where short is the youtu.be link shown under the code
' (made here from the checked key) and qr the code's rows ([] when unusable).
function parseTrailerAnswer(body as dynamic) as dynamic
    data = extrasJson(body)
    if data = invalid then return invalid
    trailer = invalid
    raw = data["trailer"]
    if isAssoc(raw)
        key = raw["key"]
        if isYoutubeKey(key)
            name = extrasPlain(raw["name"], 100)
            if name = "" then name = "Trailer"
            trailer = {key: key, name: name, short: "youtu.be/" + key, qr: qrRowsOf(raw["qr"])}
        end if
    end if
    return {status: extrasPlain(data["status"], 32), trailer: trailer}
end function

' ------------------------------------------------------------------ the session's answers

' Lookups are kept for the app's session: at most 200 answers (any status), the oldest go first. Keys are the request
' URLs, which hold provider names, so they are told apart by letter case.
function extrasCacheNew() as object
    return {answers: exactKeys(), order: []}
end function

function extrasRecall(cache as object, key as string) as dynamic
    return cache.answers[key]
end function

sub extrasRemember(cache as object, key as string, answer as object)
    if cache.answers[key] = invalid then cache.order.Push(key)
    cache.answers[key] = answer
    while cache.order.Count() > 200
        cache.answers.Delete(cache.order.Shift())
    end while
end sub

' ------------------------------------------------------------------ subtitle tracks in the player

function trackField(track as object, name as string) as string
    v = track[name]
    if v = invalid then return ""
    if type(v) = "roString" or type(v) = "String" then return v
    return ""
end function

function trackName(track as object) as string
    return trackField(track, "TrackName")
end function

function isEnglish(code as string) as boolean
    lower = LCase(code)
    return lower = "en" or lower = "eng" or Left(lower, 3) = "en-" or Left(lower, 3) = "en_" or lower = "english"
end function

' The content node's SubtitleTracks for one OpenSubtitles track, side-loaded as SRT (ISO 639-2 language code).
function subtitleContentTracks(track as dynamic) as object
    if track = invalid then return []
    return [{Language: "eng", TrackName: track.srt, Description: track.label}]
end function

' The stream's own tracks: Roku's availableSubtitleTracks without the side-loaded OpenSubtitles ones (TrackName is
' the srt URL of one of extTracks), which the subtitle menu lists after them with their own labels.
function ownSubtitleTracks(tracks as object, extTracks as object) as object
    own = []
    for each track in tracks
        if isAssoc(track)
            name = trackField(track, "TrackName")
            side = false
            for each ext in extTracks
                if name <> "" and name = ext.srt then side = true
            end for
            if not side then own.Push(track)
        end if
    end for
    return own
end function

' Among the stream's own tracks (Roku's availableSubtitleTracks without the side-loaded OpenSubtitles one, whose
' TrackName is extUrl): the language the viewer chose last time, then English; invalid when there is neither.
function preferredOwnTrack(tracks as object, extUrl as string, subLang as string) as dynamic
    if subLang <> ""
        for each track in tracks
            if isAssoc(track) and (extUrl = "" or trackField(track, "TrackName") <> extUrl) and LCase(trackField(track, "Language")) = subLang then return track
        end for
    end if
    for each track in tracks
        if isAssoc(track) and (extUrl = "" or trackField(track, "TrackName") <> extUrl) and isEnglish(trackField(track, "Language")) then return track
    end for
    return invalid
end function

' The automatic choice with Subtitles On (docs/extras.md, Subtitles in the player): a track the stream carries in the
' language chosen last time, or in English; else the attached OpenSubtitles track; else the stream's first track.
' invalid when there is none yet.
function pickSubtitleTrack(tracks as object, extUrl as string, subLang as string) as dynamic
    track = preferredOwnTrack(tracks, extUrl, subLang)
    if track <> invalid then return track
    own = invalid
    for each candidate in tracks
        if isAssoc(candidate)
            if extUrl <> "" and trackField(candidate, "TrackName") = extUrl then return candidate
            if own = invalid then own = candidate
        end if
    end for
    return own
end function
