' Unit tests for source/lib/ExtrasLogic.brs (docs/extras.md): the hidden live category, the subtitle and trailer
' lookups and their answers, and the automatic subtitle choice. They run with the BrowseLogic tests (tests/main.brs)
' and use their expectEqual helpers. testExtrasSharedCases runs the live_category cases of docs/extras-cases.json,
' which tools/extras-cases.mjs writes into ExtrasCases.brs.

function runExtrasLogicTests() as object
    t = {passed: 0, failed: 0, failures: []}
    rx = browseRx()
    testExtrasSharedCases(t)
    testHiddenCategoryNames(t)
    testHideLiveCategories(t)
    testLiveChannelCategory(t)
    testHiddenLiveLineups(t, rx)
    testExtrasEscape(t)
    testExtrasQuery(t, rx)
    testEpisodeInName(t)
    testExtrasRefs(t, rx)
    testProviderTmdbKept(t, rx)
    testSubtitlesAnswer(t)
    testTrailerAnswer(t)
    testExtrasCache(t)
    testSubtitleChoice(t)
    return t
end function

sub testExtrasSharedCases(t as object)
    cases = extrasCases()
    expectTrue(t, cases.Count() >= 30, "shared extras cases are loaded")
    hidden = 0
    for each c in cases
        if c.kind = "live_category"
            expectEqual(t, isHiddenLiveCategory(c.name), c.hidden, "shared live_category " + FormatJson(c.name))
            if c.hidden then hidden = hidden + 1
        else
            expectEqual(t, c.kind, "live_category", "shared extras case kind")
        end if
    end for
    expectTrue(t, hidden > 0 and hidden < cases.Count(), "shared live_category cases hide some names and keep others")
end sub

sub testHiddenCategoryNames(t as object)
    ' Only text is a name.
    expectFalse(t, isHiddenLiveCategory(invalid), "invalid is not hidden")
    expectFalse(t, isHiddenLiveCategory(5), "a number is not hidden")
    ' Tags in any ASCII letter case, one at each end at most.
    expectTrue(t, isHiddenLiveCategory("En | most WATCHED now"), "a leading En tag")
    expectTrue(t, isHiddenLiveCategory("us most watched now usa"), "a tag at each end")
    expectFalse(t, isHiddenLiveCategory("USA EN Most Watched Now"), "two leading tags")
    expectFalse(t, isHiddenLiveCategory("Most Watched Now EN US"), "two trailing tags")
    expectFalse(t, isHiddenLiveCategory("US"), "a tag alone")
    ' Separators of any kind and length; a letter beyond ASCII is a separator, not a letter.
    expectTrue(t, isHiddenLiveCategory("Most" + String(500, "-") + "Watched" + Chr(&h3000) + "Now"), "long runs and Unicode spaces between the words")
    expectFalse(t, isHiddenLiveCategory("Most Watched N" + Chr(&hF6) + "w"), "a letter beyond ASCII splits a word")
    expectTrue(t, isHiddenLiveCategory("Most" + Chr(&hE9) + "Watched" + Chr(&h4E2D) + "Now"), "letters beyond ASCII separate words")
    expectFalse(t, isHiddenLiveCategory("Most Watched Nowadays"), "a longer last word")
    ' A long name stops being read after its sixth word (16,000 characters: well under 200 ms in the emulator, where
    ' reading every character takes about 350).
    clock = CreateObject("roTimespan")
    clock.Mark()
    expectFalse(t, isHiddenLiveCategory(String(2000, "watched ")), "a long name")
    took = clock.TotalMilliseconds()
    expectTrue(t, took < 200, "a long name is read only up to its sixth word (" + took.ToStr() + " ms)")
    ' A name that doesn't have "watched" in it is never read character by character.
    clock.Mark()
    expectFalse(t, isHiddenLiveCategory("Most" + String(16000, " ") + "Popular Now"), "16,000 spaces without watched")
    took = clock.TotalMilliseconds()
    expectTrue(t, took < 50, "a name without watched is not read character by character (" + took.ToStr() + " ms)")
end sub

sub testHideLiveCategories(t as object)
    categories = [{id: "1", name: "US | News", adult: false}, {id: "2", name: "Most watched now", adult: false}, {id: "a", name: "Sports", adult: false}, {id: "A", name: "|USA| MOST WATCHED", adult: false}, {id: "3", name: "Most Watched Movies", adult: false}]
    result = hideLiveCategories(categories)
    ids = []
    for each cat in result.categories
        ids.Push(cat.id)
    end for
    expectEqual(t, ids, ["1", "a", "3"], "hidden categories are taken out, the rest keep their order")
    expectEqual(t, [result.hidden["2"] <> invalid, result.hidden["A"] <> invalid, result.hidden["a"] <> invalid, result.hidden["1"] <> invalid], [true, true, false, false], "hidden ids, told apart by letter case")
    expectEqual(t, hideLiveCategories([]).categories, [], "no categories")
end sub

' A get_live_streams row as ParseJson gives it to the catalog task.
function liveRow(json as string) as object
    return ParseJson(json)
end function

sub testLiveChannelCategory(t as object)
    none = hideLiveCategories([{id: "1", name: "News"}]).hidden
    hidden = hideLiveCategories([{id: "1", name: "News"}, {id: "2", name: "Most watched now"}, {id: "A", name: "Most watched"}, {id: "7", name: "Sports"}]).hidden
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":""1""}"), none), "1", "nothing hidden: category_id")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":""2"",""category_ids"":[7]}"), none), "2", "nothing hidden on the line: category_id as before")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":""1"",""category_ids"":[2]}"), hidden), "1", "category_id not hidden stays")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":2}"), hidden), invalid, "only category hidden: dropped")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":""2"",""category_ids"":[2,""A""]}"), hidden), invalid, "every category hidden: dropped")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":""2"",""category_ids"":[2,7]}"), hidden), "7", "hidden category_id: the next category that is not hidden")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":"""",""category_ids"":[""2"",""7""]}"), hidden), "7", "no category_id, one hidden in category_ids")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":null,""category_ids"":[2]}"), hidden), invalid, "no category_id, the only other one hidden")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":"""",""category_ids"":[7]}"), hidden), "", "no category_id and none hidden: Other, as before")
    expectEqual(t, liveChannelCategory(liveRow("{""name"":""CNN""}"), hidden), "", "a channel with no category at all stays")
    expectEqual(t, liveChannelCategory(liveRow("{""category_id"":""a""}"), hidden), "a", "ids differ by letter case")
end sub

' The hidden category in Live TV's lineup, as the catalog task builds it from an M3U playlist and from Xtream rows.
sub testHiddenLiveLineups(t as object, rx as object)
    lf = Chr(10)
    text = "#EXTM3U" + lf
    for each entry in [["US | News", "CNN", "live/1.ts"], ["Most watched now", "CNN", "live/2.ts"], ["US | Sports", "ESPN", "live/3.ts"], ["|USA| MOST WATCHED NOW", "ESPN", "live/4.ts"], ["", "Local", "live/5.ts"], ["Most Watched Movies", "Movies 1", "live/6.ts"]]
        text = text + "#EXTINF:-1 group-title=" + Chr(34) + entry[0] + Chr(34) + "," + entry[1] + lf + "http://m3u.invalid/" + entry[2] + lf
    end for
    parts = m3uSections(m3uEntries(text, rx), rx)
    live = grouped(hideLiveCategories(parts.cats.live).categories, parts.lists.live)
    expectEqual(t, lineup(live), [["US | News", ["CNN"]], ["US | Sports", ["ESPN"]], ["Other", ["Local"]], ["Most Watched Movies", ["Movies 1"]]], "M3U: hidden groups and their channels are gone")

    cats = [{id: "21", name: "US | News", adult: false}, {id: "99", name: "Most watched now", adult: false}, {id: "22", name: "US | Sports", adult: false}]
    rows = ParseJson("[{""name"":""CNN"",""category_id"":""21""},{""name"":""CNN copy"",""category_id"":""99""},{""name"":""ESPN"",""category_id"":""99"",""category_ids"":[99,22]},{""name"":""Local"",""category_id"":""""}]")
    shown = hideLiveCategories(cats)
    channels = []
    for each row in rows
        cat = liveChannelCategory(row, shown.hidden)
        if cat <> invalid then channels.Push({kind: "live", name: row["name"], cat: cat, adult: false, url: ""})
    end for
    expectEqual(t, lineup(grouped(shown.categories, channels)), [["US | News", ["CNN"]], ["US | Sports", ["ESPN"]], ["Other", ["Local"]]], "Xtream: copies dropped, a channel also in another category moves there")
end sub

function lineup(live as object) as object
    out = []
    for each cat in live.categories
        names = []
        for each item in live.byCat[cat.id]
            names.Push(item.name)
        end for
        out.Push([cat.name, names])
    end for
    return out
end function

sub testExtrasEscape(t as object)
    expectEqual(t, extrasEscape("EN | The Matrix"), "EN%20%7C%20The%20Matrix", "spaces and bars")
    expectEqual(t, extrasEscape("AZaz09-_.!~*'()"), "AZaz09-_.!~*'()", "what encodeURIComponent leaves")
    expectEqual(t, extrasEscape("&=?/#+%" + Chr(34)), "%26%3D%3F%2F%23%2B%25%22", "what it escapes")
    expectEqual(t, extrasEscape("Am" + Chr(&hE9) + "lie"), "Am%C3%A9lie", "UTF-8, upper-case hex")
    expectEqual(t, extrasEscape(Chr(128293)), "%F0%9F%94%A5", "a character beyond U+FFFF")
    expectEqual(t, extrasEscape(""), "", "empty")
end sub

sub testExtrasQuery(t as object, rx as object)
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "603", name: "The Matrix", year: "1999"}, rx), "v=1&type=movie&tmdb=603", "movie by TMDB id; name and year ignored")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: 1, episode: 3}, rx), "v=1&type=episode&tmdb=1399&season=1&episode=3", "episode by the series' id")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: "01", episode: "003"}, rx), "v=1&type=episode&tmdb=1399&season=1&episode=3", "numbers as Xtream text, leading zeros dropped")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: 0, episode: 1}, rx), "v=1&type=episode&tmdb=1399&season=0&episode=1", "season 0 is specials")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: 1, episode: 0}, rx), "", "no episode 0")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: -1, episode: 2}, rx), "", "no season number")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: 10000, episode: 2}, rx), "", "season over 9999")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399", season: "1a", episode: 2}, rx), "", "season not a number")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "1399"}, rx), "", "an episode without its numbers")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: "EN | The Matrix", year: "1999"}, rx), "v=1&type=movie&name=EN%20%7C%20The%20Matrix&year=1999", "movie by name and year")
    expectEqual(t, subtitlesQuery({type: "episode", tmdb: "", season: 1, episode: 3, name: "Breaking Bad", year: "2008"}, rx), "v=1&type=episode&season=1&episode=3&name=Breaking%20Bad&year=2008", "episode by the series' name and year")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: "The Matrix", year: ""}, rx), "", "no TMDB id and no year: no lookup")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: "The Matrix", year: "1799"}, rx), "", "year before 1800")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: "The Matrix", year: "2100"}, rx), "", "year after 2099")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "0603", name: "The Matrix", year: "1999"}, rx), "v=1&type=movie&name=The%20Matrix&year=1999", "an id with a leading zero is no id")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "1234567890123", name: "X", year: "1999"}, rx), "v=1&type=movie&name=X&year=1999", "an id over 12 digits is no id")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: " " + Chr(&hA0) + "Heat" + Chr(9), year: "1995"}, rx), "v=1&type=movie&name=Heat&year=1995", "the name trimmed as a provider field")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: Chr(&h3000), year: "1995"}, rx), "", "an empty name")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: String(300, "a"), year: "1995"}, rx), "v=1&type=movie&name=" + String(300, "a") + "&year=1995", "a name of 300 characters")
    expectEqual(t, subtitlesQuery({type: "movie", tmdb: "", name: String(301, "a"), year: "1995"}, rx), "", "a name over 300 characters")
    expectEqual(t, subtitlesQuery({type: "tv", tmdb: "1399"}, rx), "", "subtitles are for movies and episodes")
    expectEqual(t, subtitlesQuery(invalid, rx), "", "no title")
    expectEqual(t, trailerQuery({type: "tv", tmdb: "1399"}, rx), "v=1&type=tv&tmdb=1399", "series trailer")
    expectEqual(t, trailerQuery({type: "movie", tmdb: "", name: "Heat", year: 1995}, rx), "v=1&type=movie&name=Heat&year=1995", "movie trailer by name and year")
    expectEqual(t, trailerQuery({type: "episode", tmdb: "1399", season: 1, episode: 1}, rx), "", "no trailer for an episode")
end sub

sub testEpisodeInName(t as object)
    expectEqual(t, episodeFields(episodeInName("Breaking Bad S01E02")), [1, 2, "Breaking Bad "], "S01E02")
    expectEqual(t, episodeFields(episodeInName("show s1e2 720p")), [1, 2, "show "], "lower case, one digit each")
    expectEqual(t, episodeFields(episodeInName("Show - S02 E10")), [2, 10, "Show - "], "a space before E")
    expectEqual(t, episodeFields(episodeInName("Show.S03.E04.1080p")), [3, 4, "Show."], "a dot before E")
    expectEqual(t, episodeFields(episodeInName("S01E01")), [1, 1, ""], "at the start")
    expectEqual(t, episodeFields(episodeInName("Season 1 Show S01E05")), [1, 5, "Season 1 Show "], "an earlier S that starts no marker")
    expectEqual(t, episodeInName("ShowS01E02"), invalid, "a letter just before S")
    expectEqual(t, episodeInName("Show S01E02345"), invalid, "five episode digits")
    expectEqual(t, episodeInName("Show S12345E01"), invalid, "five season digits")
    expectEqual(t, episodeInName("Show S01  E02"), invalid, "two characters before E")
    expectEqual(t, episodeInName("Show Season 1 Episode 2"), invalid, "words")
    expectEqual(t, episodeInName(""), invalid, "empty")
end sub

function episodeFields(found as dynamic) as dynamic
    if found = invalid then return invalid
    return [found.season, found.episode, found.series]
end function

sub testExtrasRefs(t as object, rx as object)
    movie = {kind: "movie", id: "12", name: "EN | Heat (1995)", year: "1995", tmdb: "", ptmdb: "949"}
    expectEqual(t, subtitlesQuery(titleSubtitlesRef(movie, rx), rx), "v=1&type=movie&tmdb=949", "the provider's TMDB id first")
    expectEqual(t, trailerQuery(trailerRef(movie), rx), "v=1&type=movie&tmdb=949", "movie trailer by the provider's id")
    movie = {kind: "movie", id: "12", name: "EN | Heat (1995)", year: "1995", tmdb: "949"}
    expectEqual(t, subtitlesQuery(titleSubtitlesRef(movie, rx), rx), "v=1&type=movie&tmdb=949", "else the matched rows item")
    movie = {kind: "movie", id: "12", name: "EN | Heat (1995)", year: "1995", tmdb: ""}
    expectEqual(t, subtitlesQuery(titleSubtitlesRef(movie, rx), rx), "v=1&type=movie&name=EN%20%7C%20Heat%20(1995)&year=1995", "else the provider's name and year")
    expectEqual(t, subtitlesQuery(titleSubtitlesRef({kind: "movie", id: "12", name: "Show S01E02", year: "", tmdb: ""}, rx), rx), "", "an Xtream movie is a movie: no year, no lookup")
    ' M3U entries (no id): a name with S01E02 is an episode of the show named before it.
    m3uMovie = {kind: "movie", id: "", name: "Breaking Bad (2008) S01E02", year: "2008", tmdb: "1396"}
    expectEqual(t, subtitlesQuery(titleSubtitlesRef(m3uMovie, rx), rx), "v=1&type=episode&season=1&episode=2&name=Breaking%20Bad%20(2008)&year=2008", "an M3U movie named like an episode; its movie id is not the series'")
    m3uEpisode = {kind: "episode", id: "", name: "Breaking Bad S01E02", year: "", tmdb: "1396"}
    expectEqual(t, subtitlesQuery(titleSubtitlesRef(m3uEpisode, rx), rx), "v=1&type=episode&tmdb=1396&season=1&episode=2", "an M3U episode matched to its series")
    expectEqual(t, subtitlesQuery(titleSubtitlesRef({kind: "episode", id: "", name: "Breaking Bad 1x02", year: "2008", tmdb: "1396"}, rx), rx), "", "an M3U episode without S and E numbers")
    expectEqual(t, trailerQuery(trailerRef(m3uEpisode), rx), "", "no trailer for an M3U episode")
    series = {kind: "series", id: "7", name: "Breaking Bad", year: "2008", tmdb: "", ptmdb: "1396"}
    expectEqual(t, subtitlesQuery(episodeSubtitlesRef(series, {season: 2, episode: 5}), rx), "v=1&type=episode&tmdb=1396&season=2&episode=5", "an Xtream episode: the series' id")
    expectEqual(t, trailerQuery(trailerRef(series), rx), "v=1&type=tv&tmdb=1396", "series trailer")
    series = {kind: "series", id: "7", name: "Breaking Bad", year: "2008", tmdb: ""}
    expectEqual(t, subtitlesQuery(episodeSubtitlesRef(series, {season: 2, episode: 5}), rx), "v=1&type=episode&season=2&episode=5&name=Breaking%20Bad&year=2008", "an Xtream episode: the series' name and year")
    expectEqual(t, subtitlesQuery(episodeSubtitlesRef(series, {season: 2, episode: -1}), rx), "", "an episode without its number")
end sub

' buildTitleSection keeps the provider's TMDB id for the lookups when the rows don't list it.
sub testProviderTmdbKept(t as object, rx as object)
    rows = [movieRow("1", "Heat (1995)", "3", {tmdb: "949"}), movieRow("2", "Dune (2021)", "3", {tmdb: "438631"}), movieRow("3", "Up (2009)", "3", {})]
    cats = [{id: "3", name: "Movies", adult: false}]
    none = parseRowsPayload("")
    items = buildTitleSection(sectionTitles(rows, "movie", rx), cats, none.movie, none.genres.movie, rx).items
    expectEqual(t, [extrasTmdbOf(items[0]), extrasTmdbOf(items[1]), extrasTmdbOf(items[2]), items[0].tmdb], ["949", "438631", "", ""], "without rows: the provider's ids")
    payload = rowsPayloadWith({popular: [tmdbItem(438631, "Dune", "2021", ["US"], [878])]}, {})
    items = buildTitleSection(sectionTitles(rows, "movie", rx), cats, payload.movie, payload.genres.movie, rx).items
    expectEqual(t, [extrasTmdbOf(items[0]), extrasTmdbOf(items[1]), items[1].tmdb, items[1].DoesExist("ptmdb")], ["949", "438631", "438631", false], "with rows: the matched id, the provider's for the rest")
end sub

sub testSubtitlesAnswer(t as object)
    file = "https://lumanest.tv/api/extras/subtitles/file/"
    body = FormatJson({v: 1, status: "ok", tmdb: 603, tracks: [{id: "1-a", lang: "en", label: "English (OpenSubtitles)", hi: false, vtt: file + "1-a.vtt", srt: file + "1-a.srt"}, {id: "2-b", lang: "en", label: "English SDH (OpenSubtitles 2)", hi: true, vtt: file + "2-b.vtt", srt: file + "2-b.srt"}], credit: "Subtitles provided by OpenSubtitles.com"})
    answer = parseSubtitlesAnswer(body)
    expectEqual(t, [answer.status, answer.credit, answer.tracks.Count()], ["ok", "Subtitles provided by OpenSubtitles.com", 2], "an ok answer")
    expectEqual(t, trackFields(answer.tracks), [["1-a", "English (OpenSubtitles)", false, file + "1-a.srt"], ["2-b", "English SDH (OpenSubtitles 2)", true, file + "2-b.srt"]], "its tracks, best first, with their SRT files")
    tracks = []
    for each srt in ["http://lumanest.tv/api/extras/subtitles/file/1-a.srt", "https://lumanest.tv.evil.example/1-a.srt", "https://example.com/https://lumanest.tv/1.srt", file + "3-c.vtt", file + "4-d.srt", file + "5 e.srt", file + "6-f.srt", file + "7-g.srt", file + "8-h.srt"]
        tracks.Push({id: "x", label: "L", hi: false, srt: srt})
    end for
    tracks.Push("not a track")
    kept = parseSubtitlesAnswer(FormatJson({v: 1, status: "ok", tracks: tracks})).tracks
    srts = []
    for each track in kept
        srts.Push(track.srt)
    end for
    expectEqual(t, srts, [file + "4-d.srt", file + "6-f.srt", file + "7-g.srt"], "only SRT files on https://lumanest.tv/, at most 3")
    odd = parseSubtitlesAnswer(FormatJson({v: 1, status: "ok", tracks: [{label: "A" + Chr(10) + "B" + Chr(13) + Chr(9) + "<i>C</i>", hi: "true", srt: file + "1-a.srt"}, {label: 5, srt: file + "2-b.srt"}, {label: "  ", srt: file + "3-c.srt"}, {label: String(200, "x"), srt: file + "4-d.srt"}]}))
    labels = []
    for each track in odd.tracks
        labels.Push([track.label, track.hi])
    end for
    expectEqual(t, labels, [["A B  <i>C</i>", false], ["English (OpenSubtitles)", false], ["English (OpenSubtitles)", false]], "labels are one plain line; hi only when true")
    expectEqual(t, Len(parseSubtitlesAnswer(FormatJson({v: 1, tracks: [{label: String(200, "x"), srt: file + "1-a.srt"}]})).tracks[0].label), 80, "labels at most 80 characters")
    expectEqual(t, odd.credit, "Subtitles provided by OpenSubtitles.com", "the credit when the answer has none")
    empty = parseSubtitlesAnswer("{""v"":1,""status"":""not_configured"",""tmdb"":null,""tracks"":[],""credit"":""Subtitles provided by OpenSubtitles.com""}")
    expectEqual(t, [empty.status, empty.tracks], ["not_configured", []], "not configured: no tracks")
    expectEqual(t, parseSubtitlesAnswer("{""v"":1}").tracks, [], "no tracks key")
    for each bad in ["", "not json", "[]", "{""v"":2,""tracks"":[]}", "{""v"":""1"",""tracks"":[]}", "{""tracks"":[]}", "{""v"":1.5}"]
        expectEqual(t, parseSubtitlesAnswer(bad), invalid, "unreadable answer " + FormatJson(bad))
    end for
    expectEqual(t, parseSubtitlesAnswer(invalid), invalid, "no body")
end sub

function trackFields(tracks as object) as object
    out = []
    for each track in tracks
        out.Push([track.id, track.label, track.hi, track.srt])
    end for
    return out
end function

function qrSquare(size as integer) as object
    rows = []
    for r = 0 to size - 1
        row = ""
        for c = 0 to size - 1
            if (r + c) mod 2 = 0 then row = row + "1" else row = row + "0"
        end for
        rows.Push(row)
    end for
    return rows
end function

sub testTrailerAnswer(t as object)
    qr = qrSquare(25)
    answer = parseTrailerAnswer(FormatJson({v: 1, status: "ok", tmdb: 603, trailer: {key: "vKQi3bBA1y8", name: "Official Trailer", url: "https://www.youtube.com/watch?v=vKQi3bBA1y8", short: "youtu.be/other", qr: qr}}))
    trailer = answer.trailer
    expectEqual(t, [answer.status, trailer.key, trailer.name, trailer.short, trailer.qr], ["ok", "vKQi3bBA1y8", "Official Trailer", "youtu.be/vKQi3bBA1y8", qr], "an ok answer; the link is made from the key")
    for each key in ["vKQi3bBA1y", "vKQi3bBA1y8x", "vKQi3bBA1/8", "vKQi3bBA1<8", "vKQi3bBA1 8", "vKQi3bBA1y" + Chr(&hE9), 12345678901]
        expectEqual(t, parseTrailerAnswer(FormatJson({v: 1, status: "ok", trailer: {key: key, qr: qr}})).trailer, invalid, "not a YouTube key: " + FormatJson(key))
    end for
    expectEqual(t, parseTrailerAnswer(FormatJson({v: 1, status: "ok", trailer: {key: "a_B-0123456"}})).trailer.key, "a_B-0123456", "_ and - in a key")
    named = parseTrailerAnswer(FormatJson({v: 1, status: "ok", trailer: {key: "vKQi3bBA1y8", name: "", qr: qr}})).trailer
    expectEqual(t, named.name, "Trailer", "no name")
    expectEqual(t, Len(parseTrailerAnswer(FormatJson({v: 1, status: "ok", trailer: {key: "vKQi3bBA1y8", name: String(150, "n")}})).trailer.name), 100, "names at most 100 characters")
    narrow = qrSquare(25)
    narrow[3] = Left(narrow[3], 24)
    letters = qrSquare(25)
    letters[0] = "2" + Mid(letters[0], 2)
    for each rows in [narrow, letters, qrSquare(20), qrSquare(178), "1111", [], invalid]
        expectEqual(t, parseTrailerAnswer(FormatJson({v: 1, status: "ok", trailer: {key: "vKQi3bBA1y8", qr: rows}})).trailer.qr, [], "an unusable QR code is left out")
    end for
    expectEqual(t, qrRowsOf(qrSquare(21)).Count(), 21, "the smallest QR code")
    expectEqual(t, qrRowsOf(qrSquare(177)).Count(), 177, "the largest QR code")
    none = parseTrailerAnswer("{""v"":1,""status"":""none"",""tmdb"":603,""trailer"":null}")
    expectEqual(t, [none.status, none.trailer], ["none", invalid], "no trailer")
    expectEqual(t, parseTrailerAnswer("{""status"":""ok"",""trailer"":{""key"":""vKQi3bBA1y8""}}"), invalid, "no version")
    expectEqual(t, parseTrailerAnswer("{""v"":1,""error"":{""code"":""rate_limited""}}").trailer, invalid, "an error body")
end sub

sub testExtrasCache(t as object)
    cache = extrasCacheNew()
    expectEqual(t, extrasRecall(cache, "a"), invalid, "empty")
    extrasRemember(cache, "name=heat", {n: 1})
    extrasRemember(cache, "name=Heat", {n: 2})
    expectEqual(t, [recalledN(cache, "name=heat"), recalledN(cache, "name=Heat")], [1, 2], "keys differ by letter case")
    extrasRemember(cache, "name=heat", {n: 3})
    expectEqual(t, [recalledN(cache, "name=heat"), cache.order.Count()], [3, 2], "a key kept again is replaced, not added")
    for i = 1 to 199
        extrasRemember(cache, "k" + i.ToStr(), {n: i})
    end for
    expectEqual(t, [cache.order.Count(), recalledN(cache, "name=heat"), recalledN(cache, "name=Heat"), recalledN(cache, "k199")], [200, invalid, 2, 199], "200 answers at most, the oldest go first")
end sub

' The TrackName of a chosen track, or invalid when none was chosen.
function pickedName(track as dynamic) as dynamic
    if track = invalid then return invalid
    return trackField(track, "TrackName")
end function

function recalledN(cache as object, key as string) as dynamic
    answer = extrasRecall(cache, key)
    if answer = invalid then return invalid
    return answer.n
end function

sub testSubtitleChoice(t as object)
    url = "https://lumanest.tv/api/extras/subtitles/file/1-a.srt"
    ext = {Language: "eng", TrackName: url, Description: "English (OpenSubtitles)"}
    fre = {Language: "fre", TrackName: "webvtt/1", Description: ""}
    spa = {Language: "spa", TrackName: "webvtt/2", Description: ""}
    eng = {Language: "en", TrackName: "webvtt/3", Description: ""}
    expectEqual(t, pickedName(pickSubtitleTrack([fre, ext, eng], url, "")), "webvtt/3", "the stream's English track before OpenSubtitles")
    expectEqual(t, pickedName(pickSubtitleTrack([fre, eng, spa, ext], url, "spa")), "webvtt/2", "the language chosen last time first")
    expectEqual(t, pickedName(pickSubtitleTrack([fre, ext], url, "")), url, "OpenSubtitles before the stream's first track")
    expectEqual(t, pickedName(pickSubtitleTrack([ext, fre], url, "eng")), url, "English chosen last time: OpenSubtitles when the stream has no English")
    expectEqual(t, pickedName(pickSubtitleTrack([fre, spa], "", "")), "webvtt/1", "else the stream's first track")
    expectEqual(t, pickedName(pickSubtitleTrack([ext], url, "")), url, "OpenSubtitles alone")
    expectEqual(t, pickSubtitleTrack([], url, ""), invalid, "no track yet")
    expectEqual(t, preferredOwnTrack([ext, fre], url, "eng"), invalid, "the OpenSubtitles track is not the stream's own")
    expectEqual(t, pickedName(preferredOwnTrack([ext, fre], "", "eng")), url, "with nothing attached every track counts as the stream's")
    expectEqual(t, trackNames(ownSubtitleTracks([fre, ext, eng, "x"], [{srt: url}, {srt: "https://lumanest.tv/api/extras/subtitles/file/2-b.srt"}])), ["webvtt/1", "webvtt/3"], "the menu's own tracks leave out OpenSubtitles files")
    expectEqual(t, [isEnglish("en"), isEnglish("ENG"), isEnglish("en-US"), isEnglish("en_GB"), isEnglish("English"), isEnglish("es"), isEnglish("ens")], [true, true, true, true, true, false, false], "English codes")
    tracks = subtitleContentTracks({label: "English SDH (OpenSubtitles 2)", srt: url})
    expectEqual(t, [tracks.Count(), tracks[0].Language, tracks[0].TrackName, tracks[0].Description], [1, "eng", url, "English SDH (OpenSubtitles 2)"], "the side-loaded SRT track")
    expectEqual(t, subtitleContentTracks(invalid), [], "nothing side-loaded")
end sub

function trackNames(tracks as object) as object
    out = []
    for each track in tracks
        out.Push(trackField(track, "TrackName"))
    end for
    return out
end function
