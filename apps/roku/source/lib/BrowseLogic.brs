' Movies & Series browsing rules shared by every Tuner app (docs/browse.md), in plain BrightScript.
' Nothing here touches m, SceneGraph nodes, the registry or the network, so the catalog task
' (ApiTask), the screen (MainScene) and the on-device tests (apps/roku/tests) all run the same code.

' ------------------------------------------------------------------ values

function asText(v as dynamic) as string
    if v = invalid then return ""
    t = type(v)
    if t = "roString" or t = "String" then return v
    if t = "roInteger" or t = "Integer" or t = "roLongInteger" or t = "LongInteger" then return v.ToStr()
    if t = "roFloat" or t = "Float" or t = "roDouble" or t = "Double"
        if v = Int(v) and Abs(v) < 2147483647 then return Int(v).ToStr()
        return Str(v).Trim()
    end if
    if t = "roBoolean" or t = "Boolean"
        if v then return "true"
        return "false"
    end if
    return ""
end function

' Xtream marks adult categories and streams with is_adult = 1, "1" or true.
function isFlagOn(v as dynamic) as boolean
    t = asText(v)
    return t = "1" or LCase(t) = "true"
end function

function isAssoc(v as dynamic) as boolean
    return type(v) = "roAssociativeArray"
end function

function isTrueValue(v as dynamic) as boolean
    t = type(v)
    if t = "Boolean" or t = "roBoolean" then return v
    return false
end function

function arrayOrEmpty(v as dynamic) as object
    if type(v) = "roArray" then return v
    return []
end function

function numberOf(v as dynamic) as float
    t = asText(v).Trim()
    if t = "" then return 0
    return Val(t)
end function

' ------------------------------------------------------------------ fixed lists

' Streaming services in the order Home shows them. words is used for the fallback by category name.
function browseServices() as object
    return [
        {key: "netflix", name: "Netflix"},
        {key: "disney", name: "Disney+"},
        {key: "max", name: "Max"},
        {key: "prime", name: "Prime Video"},
        {key: "apple", name: "Apple TV+"},
        {key: "hulu", name: "Hulu"},
        {key: "paramount", name: "Paramount+"},
        {key: "peacock", name: "Peacock"}
    ]
end function

' Compiled once per thread and passed to the functions below, so a 20,000-title catalogue is not
' recompiling the same patterns for every title.
function browseRx() as object
    services = {
        netflix: CreateObject("roRegex", "NETFLIX", ""),
        disney: CreateObject("roRegex", "DISNEY", ""),
        max: CreateObject("roRegex", "HBO|(^|[^A-Z0-9])MAX([^A-Z0-9]|$)", ""),
        prime: CreateObject("roRegex", "AMAZON|(^|[^A-Z0-9])PRIME([^A-Z0-9]|VIDEO|$)", ""),
        apple: CreateObject("roRegex", "APPLE", ""),
        hulu: CreateObject("roRegex", "HULU", ""),
        paramount: CreateObject("roRegex", "PARAMOUNT", ""),
        peacock: CreateObject("roRegex", "PEACOCK", "")
    }
    ' The same list as the Android app (VodRegion), plus "arab" ("ARAB MOVIES" carries no AR code).
    foreignWords = "french|france|german|germany|deutsch|italian|italiano|italia|italy|spanish|espanol|español|spain|castellano|latino|latina|latam|mexico|mexican|brazil|brasil|brazilian|portuguese|portugal|turkish|turkey|arabic|arab|india|indian|hindi|bollywood|tamil|telugu|malayalam|punjabi|pakistan|pakistani|urdu|dutch|netherlands|polish|poland|polska|romanian|romania|russian|russia|british|canada|canadian|quebec"
    ' Separators that make "IN" or "IT" a tag rather than an English word.
    tagSep = "([|:\[\]()/-]|–)"
    return {
        ' Bracketed, pipe-delimited and short parenthesised tags: [4K], {EN}, |US|, (US), (2019).
        tags: CreateObject("roRegex", "\[[^\]]*\]|\{[^\}]*\}|\|[^|]*\||\([0-9]{4}\)|\([A-Z0-9 +]{1,4}\)", ""),
        ' A short upper-case tag in front of the title: "US - ", "EN| ", "NF: ".
        prefix: CreateObject("roRegex", "^\s*[A-Z0-9+]{2,4}\s*(\|\s*|[:\-]\s+)", ""),
        ' The same kind of tag after the title: " | EN", " - US".
        suffix: CreateObject("roRegex", "\s(\||-)\s*[A-Z0-9+]{2,4}\s*$", ""),
        year: CreateObject("roRegex", "[\(\[]\s*((19|20)[0-9][0-9])\s*[\)\]]", ""),
        yearText: CreateObject("roRegex", "^\s*((19|20)[0-9][0-9])", ""),
        digits: CreateObject("roRegex", "^[0-9]+$", ""),
        apostrophe: CreateObject("roRegex", "['`´’]", ""),
        nonWord: CreateObject("roRegex", "[^a-z0-9]+", ""),
        nonAscii: CreateObject("roRegex", "[^\x00-\x7F]", ""),
        genreSplit: CreateObject("roRegex", "[,/|&;]+", ""),
        ' Parts of a category name that can each name a genre: "EN | Action Movies", "Kids & Family".
        categorySplit: CreateObject("roRegex", "[,/|&;:()\[\]]+|\s+-\s+|–", ""),
        spaces: CreateObject("roRegex", "\s+", ""),
        ' Country and language tags (upper case, as a whole word or a "XX |", "|XX|", "XX:" prefix)...
        foreignCode: CreateObject("roRegex", "(^|[^A-Za-z0-9])(FR|DE|ES|LAT|MX|BR|PT|TR|AR|HINDI|PK|NL|PL|RO|RU|UK|CA)([^A-Za-z0-9]|$)", ""),
        ' ...IN and IT only as a tag: at the start or end of the name or next to a separator ("IT: Serie",
        ' "Films (IN)"), never as the English word in "MOVIES IN 4K" or "NEW IN CINEMAS"...
        foreignTag: CreateObject("roRegex", "^\s*(IN|IT)([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])(IN|IT)\s*$|" + tagSep + "\s*(IN|IT)([^A-Za-z0-9]|$)|(^|[^A-Za-z0-9])(IN|IT)\s*" + tagSep, ""),
        ' ...and the same countries and languages written out.
        foreignWord: CreateObject("roRegex", "(^|[^a-z])(" + foreignWords + ")([^a-z]|$)", "i"),
        adult: CreateObject("roRegex", "(^|[^a-z0-9])(xxx|adults?|18\+|porn)([^a-z0-9]|$)", "i"),
        adultSwim: CreateObject("roRegex", "adult\s*swim", "i"),
        services: services
    }
end function

' ------------------------------------------------------------------ titles

' Normalized title for matching (docs/browse.md): lower case; no trailing (YYYY), bracketed or
' pipe-delimited tags or "US -" style prefixes; no quality words; & becomes and; no punctuation;
' single spaces; no leading "the ".
function normalizeTitle(name as string, rx as object) as string
    ' The Instr checks skip patterns that cannot match, which keeps a 20,000-title catalogue quick.
    s = name
    if Instr(1, s, "[") > 0 or Instr(1, s, "{") > 0 or Instr(1, s, "|") > 0 or Instr(1, s, "(") > 0 then s = rx.tags.ReplaceAll(s, " ")
    if Instr(1, s, "|") > 0 or Instr(1, s, ":") > 0 or Instr(1, s, "-") > 0
        for i = 1 to 3
            stripped = rx.prefix.Replace(s, "")
            if stripped = s then exit for
            s = stripped
        end for
        s = rx.suffix.Replace(s, "")
    end if
    s = LCase(s)
    if Instr(1, s, "&") > 0 then s = s.Replace("&", " and ")
    if Instr(1, s, "'") > 0 or Instr(1, s, "`") > 0 or Instr(1, s, "´") > 0 or Instr(1, s, "’") > 0 then s = rx.apostrophe.ReplaceAll(s, "")
    if rx.nonAscii.IsMatch(s) then s = foldAccents(s)
    s = rx.nonWord.ReplaceAll(s, " ")
    quality = {"4k": true, "uhd": true, "hd": true, "fhd": true, "hdr": true, "hdr10": true, "1080p": true, "720p": true, "2160p": true}
    words = []
    for each word in s.Split(" ")
        if word <> "" and not quality.DoesExist(word) then words.Push(word)
    end for
    if words.Count() > 1 and words[0] = "the" then words.Shift()
    return words.Join(" ")
end function

function foldAccents(s as string) as string
    pairs = [["á", "a"], ["à", "a"], ["â", "a"], ["ä", "a"], ["ã", "a"], ["å", "a"], ["é", "e"], ["è", "e"], ["ê", "e"], ["ë", "e"], ["í", "i"], ["ì", "i"], ["î", "i"], ["ï", "i"], ["ó", "o"], ["ò", "o"], ["ô", "o"], ["ö", "o"], ["õ", "o"], ["ø", "o"], ["ú", "u"], ["ù", "u"], ["û", "u"], ["ü", "u"], ["ñ", "n"], ["ç", "c"], ["ý", "y"], ["ÿ", "y"], ["æ", "ae"], ["œ", "oe"], ["ß", "ss"]]
    for each pair in pairs
        s = s.Replace(pair[0], pair[1])
    end for
    return s
end function

' "Dune (2021)" or "Dune [2021]" -> "2021".
function titleYearOf(name as string, rx as object) as string
    if Instr(1, name, "(") = 0 and Instr(1, name, "[") = 0 then return ""
    found = rx.year.Match(name)
    if found.Count() > 1 then return found[1]
    return ""
end function

' "2021-05-01", "2021" or 2021 -> "2021".
function yearOfText(v as dynamic, rx as object) as string
    if v = invalid then return ""
    found = rx.yearText.Match(asText(v))
    if found.Count() > 1 then return found[1]
    return ""
end function

' The TMDB id a provider item carries in tmdb, tmdb_id or info.tmdb_id (numbers only), or "".
function providerTmdbId(row as object, rx as object) as string
    values = [row.tmdb, row.tmdb_id]
    if isAssoc(row.info) then values.Push(row.info.tmdb_id)
    for each v in values
        if v <> invalid
            t = asText(v).Trim()
            if t <> "" and t <> "0" and rx.digits.IsMatch(t) then return t
        end if
    end for
    return ""
end function

function ratingOf(row as object) as float
    rating = numberOf(row.rating)
    if rating <= 0 then rating = numberOf(row.rating_5based) * 2
    if rating > 10 then rating = rating / 10
    return rating
end function

' One Xtream get_vod_streams (kind "movie") or get_series (kind "series") row as a catalogue title,
' or invalid when it has no id. id is the stream_id or series_id. Fields that only matter while the
' index is built (hint, genre, cat, added) are dropped by buildTitleSection.
function titleFromXtream(kind as string, row as object, rx as object) as dynamic
    if not isAssoc(row) then return invalid
    if kind = "movie" then id = asText(row.stream_id) else id = asText(row.series_id)
    if id = "" then return invalid
    cat = asText(row.category_id)
    if cat = "" then cat = "__other"
    name = asText(row.name)
    year = yearOfText(row.year, rx)
    if year = "" then year = yearOfText(row.releaseDate, rx)
    if year = "" then year = yearOfText(row.release_date, rx)
    if year = "" then year = yearOfText(row.releasedate, rx)
    if year = "" then year = titleYearOf(name, rx)
    title = {kind: kind, key: Left(kind, 1) + id, id: id, name: name, cat: cat, adult: isFlagOn(row.is_adult), year: year, rating: ratingOf(row), hint: providerTmdbId(row, rx), genre: asText(row.genre)}
    if kind = "movie"
        title.icon = asText(row.stream_icon)
        ext = asText(row.container_extension)
        if ext = "" then ext = "mp4"
        title.ext = ext
        title.added = asText(row.added).Trim().ToInt()
    else
        title.icon = asText(row.cover)
        title.added = asText(row.last_modified).Trim().ToInt()
    end if
    return title
end function

' One M3U entry as a catalogue title. key is a stable id made from the stream URL by the caller.
function titleFromM3u(kind as string, key as string, name as string, icon as string, group as string, url as string, rx as object) as object
    return {kind: kind, key: key, id: "", name: name, cat: group, adult: false, year: titleYearOf(name, rx), rating: 0, hint: "", genre: "", icon: icon, url: url, added: 0}
end function

' ------------------------------------------------------------------ USA only and adult rules

' A category fails the USA filter when its name carries a non-US country or language tag.
function isForeignCategory(name as string, rx as object) as boolean
    if name = "" then return false
    return rx.foreignCode.IsMatch(name) or rx.foreignTag.IsMatch(name) or rx.foreignWord.IsMatch(name)
end function

' XXX, Adult, Adults, 18+ or Porn, but not Adult Swim.
function isAdultName(name as string, rx as object) as boolean
    if rx.adultSwim.IsMatch(name) then return false
    return rx.adult.IsMatch(name)
end function

' Streaming services a provider category belongs to by name ("NETFLIX 4K" -> ["netflix"]).
function categoryServices(name as string, rx as object) as object
    upper = UCase(name)
    found = []
    for each service in browseServices()
        if rx.services[service.key].IsMatch(upper) then found.Push(service.key)
    end for
    return found
end function

' ------------------------------------------------------------------ catalog rows endpoint

function emptyRowsSection() as object
    services = {}
    for each service in browseServices()
        services[service.key] = []
    end for
    return {popular: [], featured: [], top_rated: [], services: services}
end function

' Reads the body of GET /api/catalog/rows?v=1. Any missing or malformed list becomes an empty list;
' anything that is not version 1 counts as "no data" (source "none", valid false).
function parseRowsPayload(text as dynamic) as object
    out = {valid: false, source: "none", generated: "", movie: emptyRowsSection(), tv: emptyRowsSection(), genres: {movie: [], tv: []}}
    data = invalid
    if text <> invalid and asText(text) <> "" then data = ParseJson(text)
    if not isAssoc(data) or asText(data.v) <> "1" then return out
    out.valid = true
    if asText(data.source) <> "" then out.source = asText(data.source)
    out.generated = asText(data.generated)
    for each kind in ["movie", "tv"]
        section = data[kind]
        if isAssoc(section)
            target = out[kind]
            target.popular = arrayOrEmpty(section.popular)
            target.featured = arrayOrEmpty(section.featured)
            target.top_rated = arrayOrEmpty(section.top_rated)
            if isAssoc(section.services)
                for each service in browseServices()
                    target.services[service.key] = arrayOrEmpty(section.services[service.key])
                end for
            end if
        end if
    end for
    if isAssoc(data.genres)
        out.genres.movie = arrayOrEmpty(data.genres.movie)
        out.genres.tv = arrayOrEmpty(data.genres.tv)
    end if
    return out
end function

' The apps keep the rows for 12 hours (maxAge seconds) and use an older copy when a refresh fails.
function isFreshCache(fetchedAt as integer, now as integer, maxAge as integer) as boolean
    if fetchedAt <= 0 then return false
    age = now - fetchedAt
    return age >= 0 and age < maxAge
end function

' ------------------------------------------------------------------ matching

function tmdbEntry(raw as dynamic) as dynamic
    if not isAssoc(raw) then return invalid
    id = asText(raw.id)
    if id = "" then return invalid
    ' known is false when TMDB gave no country (origin []); USA only then goes by the category alone.
    us = false
    known = false
    for each country in arrayOrEmpty(raw.origin)
        code = UCase(asText(country))
        if code <> "" then known = true
        if code = "US" then us = true
    end for
    g = ""
    for each genre in arrayOrEmpty(raw.genres)
        t = asText(genre)
        if t <> "" then g = g + "|" + t
    end for
    if g <> "" then g = g + "|"
    return {id: id, year: Int(Val(Left(asText(raw.year), 4))), us: us, known: known, g: g}
end function

' Every TMDB title in one section of the rows payload, by id and by normalized title (and original title).
function tmdbIndex(section as object, rx as object) as object
    byId = {}
    byTitle = {}
    lists = [section.popular, section.featured, section.top_rated]
    for each service in browseServices()
        lists.Push(section.services[service.key])
    end for
    for each list in lists
        for each raw in arrayOrEmpty(list)
            entry = tmdbEntry(raw)
            if entry <> invalid and not byId.DoesExist(entry.id)
                byId[entry.id] = entry
                title = normalizeTitle(asText(raw.title), rx)
                original = normalizeTitle(asText(raw.original_title), rx)
                for each key in [title, original]
                    if key <> ""
                        if not byTitle.DoesExist(key) then byTitle[key] = []
                        bucket = byTitle[key]
                        if bucket.Count() = 0 or bucket[bucket.Count() - 1].id <> entry.id then bucket.Push(entry)
                    end if
                end for
            end if
        end for
    end for
    return {byId: byId, byTitle: byTitle, count: byId.Count()}
end function

' 1. A provider TMDB id matches on the id alone. 2. Otherwise the normalized title must match and the
' years may differ by 1. A title without a year matches only when exactly one TMDB title has that name.
function matchTmdb(index as object, hint as string, norm as string, year as string) as dynamic
    if hint <> ""
        if index.byId.DoesExist(hint) then return index.byId[hint]
        return invalid
    end if
    if norm = "" or not index.byTitle.DoesExist(norm) then return invalid
    candidates = index.byTitle[norm]
    wanted = Int(Val(year))
    if wanted <= 0
        if candidates.Count() = 1 then return candidates[0]
        return invalid
    end if
    best = invalid
    for each candidate in candidates
        if candidate.year = wanted then return candidate
        if best = invalid and candidate.year > 0 and Abs(candidate.year - wanted) <= 1 then best = candidate
    end for
    return best
end function

' ------------------------------------------------------------------ genres

function genreToken(text as string) as string
    t = LCase(text).Trim()
    aliases = {"sci-fi": "science fiction", "scifi": "science fiction", "sci fi": "science fiction", "science-fiction": "science fiction", "documentaries": "documentary", "docs": "documentary", "docu": "documentary", "comedies": "comedy", "dramas": "drama", "thrillers": "thriller", "westerns": "western", "animated": "animation", "anime": "animation", "cartoon": "animation", "cartoons": "animation", "children": "kids", "childrens": "kids", "kid": "kids", "romantic": "romance", "musical": "music", "musicals": "music", "suspense": "thriller", "horrors": "horror", "historical": "history", "crimes": "crime"}
    if aliases.DoesExist(t) then return aliases[t]
    return t
end function

' TMDB genres for one type ({id, name} rows) as the Discover genre list plus a lookup from a provider
' genre word to a TMDB genre id. With no TMDB genres the table is "open": provider genre words become
' the genres themselves.
function genreTable(raw as object) as object
    list = []
    lookup = {}
    for each genre in arrayOrEmpty(raw)
        if isAssoc(genre)
            id = asText(genre.id)
            name = asText(genre.name)
            if id <> "" and name <> ""
                list.Push({key: id, name: name})
                lookup[genreToken(name)] = id
                for each part in name.Split("&")
                    token = genreToken(part)
                    if token <> "" and not lookup.DoesExist(token) then lookup[token] = id
                end for
            end if
        end if
    end for
    return {list: list, lookup: lookup, open: list.Count() = 0}
end function

' Provider genre text ("Action, Drama") as genre keys "|28|18|" ("" when none is known).
function providerGenreKeys(text as string, table as object, rx as object) as string
    if text = "" then return ""
    g = ""
    for each part in rx.genreSplit.Split(text)
        token = genreToken(rx.spaces.ReplaceAll(part, " "))
        if token <> ""
            key = ""
            if table.lookup.DoesExist(token)
                key = table.lookup[token]
            else if table.open
                key = token
                table.lookup[token] = key
                display = part.Trim()
                table.list.Push({key: key, name: UCase(Left(display, 1)) + Mid(display, 2)})
            end if
            if key <> "" and Instr(1, g + "|", "|" + key + "|") = 0 then g = g + "|" + key
        end if
    end for
    if g <> "" then g = g + "|"
    return g
end function

' A provider category named after a genre ("EN | Action Movies", "Kids & Family", "Sci-Fi") as genre keys
' "|28|" ("" when none). Each part of the name must be a genre on its own once words such as Movies, EN or 4K
' are dropped, so "Comedy Central" or "Netflix" never count. With no TMDB genres only common genres count.
function categoryGenreKeys(name as string, table as object, rx as object) as string
    if name = "" then return ""
    noise = {"movies": true, "movie": true, "films": true, "film": true, "series": true, "shows": true, "show": true, "tv": true, "vod": true, "4k": true, "uhd": true, "hd": true, "fhd": true, "en": true, "us": true, "usa": true, "english": true, "new": true, "top": true, "best": true, "all": true, "and": true}
    common = {action: "Action", adventure: "Adventure", animation: "Animation", comedy: "Comedy", crime: "Crime", documentary: "Documentary", drama: "Drama", family: "Family", fantasy: "Fantasy", history: "History", horror: "Horror", music: "Music", mystery: "Mystery", romance: "Romance", "science fiction": "Science Fiction", thriller: "Thriller", war: "War", western: "Western", kids: "Kids", reality: "Reality", sports: "Sports"}
    g = ""
    for each part in rx.categorySplit.Split(name)
        words = []
        for each word in rx.nonWord.Split(LCase(part))
            if word <> "" and not noise.DoesExist(word) then words.Push(word)
        end for
        token = genreToken(words.Join(" "))
        key = ""
        if token = ""
            key = ""
        else if table.lookup.DoesExist(token)
            key = table.lookup[token]
        else if table.open and common.DoesExist(token)
            key = token
            table.lookup[token] = key
            table.list.Push({key: key, name: common[token]})
        end if
        if key <> "" and Instr(1, g + "|", "|" + key + "|") = 0 then g = g + "|" + key
    end for
    if g <> "" then g = g + "|"
    return g
end function

' ------------------------------------------------------------------ building the browse index

' Turns one type's titles into what the screen browses: the titles with their USA, adult, TMDB and
' genre facts worked out, and every list Home and Discover need as arrays of title indices.
'   titles: from titleFromXtream / titleFromM3u. categories: [{id, name, adult}].
'   section: parseRowsPayload(...).movie or .tv. rawGenres: parseRowsPayload(...).genres.movie or .tv.
function buildTitleSection(titles as object, categories as object, section as object, rawGenres as object, rx as object) as object
    index = tmdbIndex(section, rx)
    genres = genreTable(rawGenres)
    catInfo = {}
    for each cat in categories
        catInfo[cat.id] = {foreign: isForeignCategory(cat.name, rx), adult: isFlagOn(cat.adult) or isAdultName(cat.name, rx), services: categoryServices(cat.name, rx), g: categoryGenreKeys(cat.name, genres, rx)}
    end for
    plain = {foreign: false, adult: false, services: [], g: ""}
    usedGenres = {}
    items = []
    byKey = {}
    byTmdb = {}
    byService = {}
    for each service in browseServices()
        byService[service.key] = []
    end for
    ' The screen gets each title without the fields only needed here, so less is copied between threads.
    unused = ["hint", "genre", "cat", "added"]
    recent = []
    rated = []
    az = []
    matched = 0
    for each title in titles
        info = catInfo[title.cat]
        if info = invalid then info = plain
        norm = normalizeTitle(title.name, rx)
        entry = invalid
        if index.count > 0 then entry = matchTmdb(index, title.hint, norm, title.year)
        ' USA only keeps a title only if its category passes the filter and, when it is matched
        ' to TMDB and TMDB gave its countries, they include US (as on Android). A match with no
        ' countries (origin []) is judged by its category alone.
        us = not info.foreign
        title.tmdb = ""
        title.g = ""
        if entry <> invalid
            title.tmdb = entry.id
            title.g = entry.g
            if entry.known then us = us and entry.us
            matched = matched + 1
        end if
        ' Genres: TMDB's, else the provider's genre text, else a category named after a genre.
        if title.g = "" and title.genre <> "" then title.g = providerGenreKeys(title.genre, genres, rx)
        if title.g = "" then title.g = info.g
        if title.g <> "" then usedGenres[title.g] = true
        title.us = us
        title.adult = title.adult or info.adult
        i = items.Count()
        items.Push(title)
        if not byKey.DoesExist(title.key) then byKey[title.key] = i
        if title.tmdb <> ""
            if not byTmdb.DoesExist(title.tmdb) then byTmdb[title.tmdb] = []
            byTmdb[title.tmdb].Push(i)
        end if
        for each key in info.services
            byService[key].Push({i: i, k: title.added})
        end for
        if title.added > 0 then recent.Push({i: i, k: title.added})
        if title.rating > 0 then rated.Push({i: i, k: title.rating})
        sortName = norm
        if sortName = "" then sortName = LCase(title.name)
        ' Catalogue order breaks ties, so copies of one title always sort the same way.
        az.Push({i: i, k: sortName + Chr(1) + Right("0000000" + i.ToStr(), 8)})
        for each field in unused
            title.Delete(field)
        end for
    end for
    ' Copies of one TMDB title: the ones in categories that pass the USA filter come first.
    for each id in byTmdb
        group = byTmdb[id]
        if group.Count() > 1
            first = []
            rest = []
            for each i in group
                if items[i].us then first.Push(i) else rest.Push(i)
            end for
            first.Append(rest)
            byTmdb[id] = first
        end if
    end for
    lists = {
        popular: tmdbOrder(section.popular, byTmdb),
        featured: tmdbOrder(section.featured, byTmdb),
        recent: sortedIndices(recent, "r"),
        rated: mergeIndices(tmdbOrder(section.top_rated, byTmdb), sortedIndices(rated, "r")),
        az: sortedIndices(az, "")
    }
    for each service in browseServices()
        lists[service.key] = mergeIndices(tmdbOrder(section.services[service.key], byTmdb), sortedIndices(byService[service.key], "r"))
    end for
    genreList = genres.list
    if genres.open
        ' Provider and category genres: only those some title has, by name.
        used = {}
        for each g in usedGenres
            for each key in g.Split("|")
                if key <> "" then used[key] = true
            end for
        end for
        genreList = []
        for each genre in genres.list
            if used.DoesExist(genre.key) then genreList.Push(genre)
        end for
        genreList.SortBy("name", "i")
    end if
    return {items: items, lists: lists, byKey: byKey, genres: genreList, matched: matched}
end function

function tmdbOrder(list as object, byTmdb as object) as object
    out = []
    for each raw in arrayOrEmpty(list)
        if isAssoc(raw)
            group = byTmdb[asText(raw.id)]
            if group <> invalid then out.Append(group)
        end if
    end for
    return out
end function

function sortedIndices(pairs as object, flags as string) as object
    pairs.SortBy("k", flags)
    out = []
    for each pair in pairs
        out.Push(pair.i)
    end for
    return out
end function

function mergeIndices(first as object, second as object) as object
    seen = {}
    out = []
    for each list in [first, second]
        for each i in list
            key = i.ToStr()
            if not seen.DoesExist(key)
                seen[key] = true
                out.Push(i)
            end if
        end for
    end for
    return out
end function

' ------------------------------------------------------------------ picking titles for the screen

' opts: {usOnly, adultOk, genre ("" for all), seen ({} shared by one row or one Discover grid)}.
function titleVisible(item as object, opts as object) as boolean
    if not opts.adultOk and item.adult then return false
    if opts.usOnly and not item.us then return false
    if opts.genre <> ""
        if item.g = invalid or Instr(1, item.g, "|" + opts.genre + "|") = 0 then return false
    end if
    return true
end function

' Walks indices from cursor and returns up to limit visible titles, one per TMDB title.
' Returns {picked: [index], cursor: where to continue}.
function pickTitles(items as object, indices as dynamic, opts as object, cursor as integer, limit as integer) as object
    picked = []
    list = arrayOrEmpty(indices)
    i = cursor
    n = list.Count()
    while i < n and picked.Count() < limit
        index = list[i]
        i = i + 1
        item = items[index]
        if titleVisible(item, opts)
            seenKey = item.key
            if item.tmdb <> "" then seenKey = "tmdb:" + item.tmdb
            if not opts.seen.DoesExist(seenKey)
                opts.seen[seenKey] = true
                picked.Push(index)
            end if
        end if
    end while
    return {picked: picked, cursor: i}
end function

' Search: up to limit visible titles whose names contain query (lower case), names starting with it first.
function searchTitles(items as object, query as string, opts as object, limit as integer) as object
    starts = []
    contains = []
    if Len(query) < 2 then return []
    for i = 0 to items.Count() - 1
        item = items[i]
        position = LCase(item.name).InStr(query)
        if position >= 0 and titleVisible(item, opts)
            if position = 0
                starts.Push(i)
                if starts.Count() >= limit then exit for
            else if contains.Count() < limit
                contains.Push(i)
            end if
        end if
    end for
    starts.Append(contains)
    return pickTitles(items, starts, opts, 0, limit).picked
end function

' Home rows after Continue watching, in the order docs/browse.md gives. Popular and Featured need TMDB.
function homeRowSpecs(withTmdb as boolean) as object
    specs = []
    if withTmdb
        specs.Push({type: "movies", list: "popular", title: "Popular – Movies"})
        specs.Push({type: "series", list: "popular", title: "Popular – Series"})
        specs.Push({type: "movies", list: "featured", title: "Featured – Movies"})
        specs.Push({type: "series", list: "featured", title: "Featured – Series"})
    end if
    for each service in browseServices()
        specs.Push({type: "movies", list: service.key, title: service.name + " – Movies"})
        specs.Push({type: "series", list: service.key, title: service.name + " – Series"})
    end for
    specs.Push({type: "movies", list: "recent", title: "Recently added – Movies"})
    specs.Push({type: "series", list: "recent", title: "Recently added – Series"})
    specs.Push({type: "movies", list: "rated", title: "Top rated – Movies"})
    specs.Push({type: "series", list: "rated", title: "Top rated – Series"})
    return specs
end function

' Discover's List choices. Popular and Featured need TMDB.
function discoverLists(withTmdb as boolean) as object
    lists = []
    if withTmdb
        lists.Push({key: "popular", name: "Popular"})
        lists.Push({key: "featured", name: "Featured"})
    end if
    lists.Push({key: "rated", name: "Top rated"})
    lists.Push({key: "recent", name: "Recently added"})
    lists.Push({key: "az", name: "A–Z"})
    for each service in browseServices()
        lists.Push({key: service.key, name: service.name})
    end for
    return lists
end function

' Home: Continue watching (refs from continueRefs) and then every row with at least 5 titles, 20 at most.
' catalog: {movies, series} from buildTitleSection. Each row is {id, title, type, list, refs: [{type, idx}]}.
function buildHomeRows(catalog as object, withTmdb as boolean, opts as object, continueRefs as object) as object
    rows = []
    if continueRefs.Count() >= 5
        refs = []
        for each ref in continueRefs
            if refs.Count() < 20 then refs.Push(ref)
        end for
        rows.Push({id: "continue", title: "Continue watching", type: "library", list: "continue", refs: refs})
    end if
    for each spec in homeRowSpecs(withTmdb)
        section = catalog[spec.type]
        rowOpts = {usOnly: opts.usOnly, adultOk: opts.adultOk, genre: "", seen: {}}
        result = pickTitles(section.items, section.lists[spec.list], rowOpts, 0, 20)
        if result.picked.Count() >= 5
            refs = []
            for each i in result.picked
                refs.Push({type: spec.type, idx: i})
            end for
            rows.Push({id: spec.type + ":" + spec.list, title: spec.title, type: spec.type, list: spec.list, refs: refs})
        end if
    end for
    return rows
end function

' ------------------------------------------------------------------ Library (favorites, progress, history)

' Stored as JSON in the registry, for one paired line. Keys: "m<stream_id>" movies, "s<series_id>" series.
'   fav:  [key], newest first.
'   prog: [{k, p (seconds), d (duration), t (time), e (episode id), l (episode label), n (episode index), nx}]
'         newest first; nx marks "the next episode is ready" after one finishes.
'   seen: [{k, t}], newest first.
function libraryNew(line as string) as object
    return {v: 1, line: line, fav: [], prog: [], seen: []}
end function

' A stored library for this line, or a new one when it is missing, damaged or for another line.
function libraryFor(stored as dynamic, line as string) as object
    if not isAssoc(stored) or asText(stored.line) <> line then return libraryNew(line)
    return {v: 1, line: line, fav: arrayOrEmpty(stored.fav), prog: arrayOrEmpty(stored.prog), seen: arrayOrEmpty(stored.seen)}
end function

function libraryTypeOf(key as string) as string
    if Left(key, 1) = "s" then return "series"
    return "movies"
end function

function libraryIsFavorite(store as object, key as string) as boolean
    for each k in store.fav
        if k = key then return true
    end for
    return false
end function

' Adds or removes a favorite and returns whether it is now a favorite. Keeps at most 150.
function libraryToggleFavorite(store as object, key as string) as boolean
    kept = []
    found = false
    for each k in store.fav
        if k = key then found = true else kept.Push(k)
    end for
    if not found
        kept.Unshift(key)
        while kept.Count() > 150
            kept.Pop()
        end while
    end if
    store.fav = kept
    return not found
end function

function libraryProgress(store as object, key as string) as dynamic
    for each entry in store.prog
        if entry.k = key then return entry
    end for
    return invalid
end function

sub libraryRemoveProgress(store as object, key as string)
    kept = []
    for each entry in store.prog
        if entry.k <> key then kept.Push(entry)
    end for
    store.prog = kept
end sub

' Records where playback stopped. A finished title (95% or more) leaves Continue watching; a stop in
' the first 15 seconds changes nothing; a "next episode" entry (nx) is always kept. At most 30 entries.
sub libraryRecordProgress(store as object, entry as object, now as integer)
    position = Int(numberOf(entry.p))
    duration = Int(numberOf(entry.d))
    nextUp = isTrueValue(entry.nx)
    finished = not nextUp and duration > 0 and position >= duration * 0.95
    if finished
        libraryRemoveProgress(store, entry.k)
        return
    end if
    if not nextUp and position < 15 then return
    libraryRemoveProgress(store, entry.k)
    entry.t = now
    store.prog.Unshift(entry)
    while store.prog.Count() > 30
        store.prog.Pop()
    end while
end sub

sub libraryRecordWatched(store as object, key as string, now as integer)
    kept = [{k: key, t: now}]
    for each entry in store.seen
        if entry.k <> key and kept.Count() < 30 then kept.Push(entry)
    end for
    store.seen = kept
end sub

' How far through a title is, 0 to 1, for the progress bar.
function progressFraction(entry as dynamic) as float
    if entry = invalid or isTrueValue(entry.nx) then return 0
    duration = numberOf(entry.d)
    if duration <= 0 then return 0
    fraction = numberOf(entry.p) / duration
    if fraction > 1 then fraction = 1
    if fraction < 0 then fraction = 0
    return fraction
end function

' Library keys as refs [{type, idx}] to visible titles in the catalogue (titles no longer on the line drop out).
function libraryRefs(keys as object, catalog as object, opts as object) as object
    refs = []
    for each key in keys
        kind = libraryTypeOf(key)
        section = catalog[kind]
        if section <> invalid and section.byKey.DoesExist(key)
            i = section.byKey[key]
            if titleVisible(section.items[i], opts) then refs.Push({type: kind, idx: i})
        end if
    end for
    return refs
end function

function libraryKeys(entries as object) as object
    keys = []
    for each entry in entries
        keys.Push(entry.k)
    end for
    return keys
end function

' "1:02:03" or "12:34".
function clockText(seconds as integer) as string
    if seconds < 0 then seconds = 0
    h = seconds \ 3600
    mm = (seconds mod 3600) \ 60
    ss = seconds mod 60
    sText = ss.ToStr()
    if ss < 10 then sText = "0" + sText
    if h > 0
        mText = mm.ToStr()
        if mm < 10 then mText = "0" + mText
        return h.ToStr() + ":" + mText + ":" + sText
    end if
    return mm.ToStr() + ":" + sText
end function
