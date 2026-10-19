' Unit tests for source/lib/BrowseLogic.brs (docs/browse.md). They run on a Roku in the test package
' (npm run build:tests, see apps/roku/README.md) and print every failure to the debug console.
' testSharedCases runs docs/browse-cases.json, which tools/browse-cases.mjs writes into BrowseCases.brs.

function runBrowseLogicTests() as object
    t = {passed: 0, failed: 0, failures: []}
    rx = browseRx()
    testSharedCases(t, rx)
    testNormalizeTitle(t, rx)
    testYears(t, rx)
    testTrimming(t, rx)
    testTagChainTime(t, rx)
    testSpaceRunTime(t, rx)
    testProviderTmdbId(t, rx)
    testAdultNames(t, rx)
    testCategoryServices(t, rx)
    testRowsPayload(t)
    testCacheAge(t)
    testMatching(t, rx)
    testGenres(t, rx)
    testBuildTitleSection(t, rx)
    testUnknownOrigin(t, rx)
    testOrigins(t, rx)
    testCategoryMemberships(t, rx)
    testCategoryGenres(t, rx)
    testPickTitles(t, rx)
    testCopies(t, rx)
    testHomeRows(t, rx)
    testSearchTitles(t, rx)
    testDiscoverLists(t)
    testLibraryStore(t)
    testClockText(t)
    return t
end function

' ------------------------------------------------------------------ helpers

sub expectEqual(t as object, actual as dynamic, expected as dynamic, label as string)
    if FormatJson(actual) = FormatJson(expected)
        t.passed = t.passed + 1
    else
        t.failed = t.failed + 1
        t.failures.Push(label + ": expected " + FormatJson(expected) + ", got " + FormatJson(actual))
    end if
end sub

sub expectTrue(t as object, actual as boolean, label as string)
    expectEqual(t, actual, true, label)
end sub

sub expectFalse(t as object, actual as boolean, label as string)
    expectEqual(t, actual, false, label)
end sub

function tmdbItem(id as integer, title as string, year as string, origin as object, genres as object) as object
    return {id: id, title: title, original_title: title, year: year, origin: origin, lang: "en", genres: genres, popularity: 10.0}
end function

' A rows payload with the given movie lists, through the same parser the app uses.
function rowsPayloadWith(movie as object, tv as object) as object
    return parseRowsPayload(FormatJson({v: 1, source: "tmdb", generated: "2026-10-19T00:00:00Z", movie: movie, tv: tv, genres: {movie: [{id: 28, name: "Action"}, {id: 18, name: "Drama"}, {id: 878, name: "Science Fiction"}], tv: [{id: 10759, name: "Action & Adventure"}, {id: 10765, name: "Sci-Fi & Fantasy"}]}}))
end function

function movieRow(id as string, name as string, cat as string, extra as object) as object
    row = {stream_id: id, name: name, category_id: cat, stream_icon: "http://img/" + id + ".jpg", container_extension: "mkv", added: "0", rating: ""}
    row.Append(extra)
    return row
end function

function sectionTitles(rows as object, kind as string, rx as object) as object
    titles = []
    for each row in rows
        title = titleFromXtream(kind, row, rx)
        if title <> invalid then titles.Push(title)
    end for
    return titles
end function

function namesOf(section as object, indices as object) as object
    names = []
    for each i in indices
        names.Push(section.items[i].name)
    end for
    return names
end function

' ------------------------------------------------------------------ tests

' The cases every Tuner app runs (docs/browse-cases.json): the category filter, normalized titles with the year
' in the name, USA only through buildTitleSection, and the provider TMDB id of a row read with ParseJson.
sub testSharedCases(t as object, rx as object)
    cases = browseCases()
    expectTrue(t, cases.Count() > 0, "shared cases are loaded")
    for each c in cases
        if c.kind = "category"
            expectEqual(t, isForeignCategory(c.name, rx), c.foreign, "shared category " + FormatJson(c.name))
        else if c.kind = "normalize"
            expectEqual(t, [normalizeTitle(c.input, rx), titleYearOf(c.input, rx)], [c.title, c.year], "shared normalize " + FormatJson(c.input))
        else if c.kind = "usa"
            expectEqual(t, sharedUsaCase(c, rx), c.expect, "shared usa " + FormatJson(c.category) + " origin " + FormatJson(c.origin))
        else if c.kind = "tmdb"
            expected = c.expect
            if expected = invalid then expected = ""
            expectEqual(t, sharedTmdbCase(c.json, rx), expected, "shared tmdb " + FormatJson(c.json))
        else
            expectEqual(t, c.kind, "category, normalize, usa or tmdb", "shared case kind")
        end if
    end for
end sub

' One tmdb case as the catalog task reads it: the row's JSON text through ParseJson (ApiTask), then providerTmdbId,
' and the hint titleFromXtream keeps for the row (with a stream id and a name added when the row has none). Returns
' the id, "" for none, or a text saying what went wrong.
function sharedTmdbCase(json as string, rx as object) as string
    row = ParseJson(json)
    if not isAssoc(row) then return "ParseJson gave " + type(row)
    id = providerTmdbId(row, rx)
    if row.stream_id = invalid then row.stream_id = 1
    if row.name = invalid then row.name = "Case Title"
    title = titleFromXtream("movie", row, rx)
    if title = invalid then return "titleFromXtream gave no title"
    if title.hint <> id then return "providerTmdbId gave " + FormatJson(id) + ", the title's hint " + FormatJson(title.hint)
    return id
end function

' One usa case as the catalog task builds it: a movie in the case's categories, given as the category_id and
' category_ids of one row and, for several categories, also as one row per category with the same stream id.
' With an origin it carries the TMDB id of a Popular title with that origin; with none (null) it is unmatched.
' Returns whether USA only keeps it, or a text saying what went wrong.
function sharedUsaCase(c as object, rx as object) as dynamic
    names = c.category
    if type(names) <> "roArray"
        if names = "" then names = [] else names = [names]
    end if
    categories = []
    for each name in names
        categories.Push({id: (101 + categories.Count()).ToStr(), name: name, adult: false})
    end for
    movie = {}
    extra = {}
    if c.origin <> invalid
        movie = {popular: [tmdbItem(77, "Case Title", "2020", c.origin, [])]}
        extra = {tmdb: "77"}
    end if
    payload = rowsPayloadWith(movie, {})
    row = movieRow("1", "Case Title", "", extra)
    others = []
    for i = 0 to categories.Count() - 1
        if i = 0 then row.category_id = categories[0].id else others.Push(categories[i].id.ToInt())
    end for
    row.category_ids = others
    variants = [[row]]
    if categories.Count() > 1
        rows = []
        for each category in categories
            rows.Push(movieRow("1", "Case Title", category.id, extra))
        end for
        variants.Push(rows)
    end if
    results = []
    for each rows in variants
        section = buildTitleSection(sectionTitles(rows, "movie", rx), categories, payload.movie, payload.genres.movie, rx)
        for each item in section.items
            if (item.tmdb = "77") <> (c.origin <> invalid) then return "matched " + FormatJson(item.tmdb)
            results.Push(item.us)
        end for
    end for
    for each result in results
        if result <> results[0] then return "rows with one id disagree"
    end for
    return results[0]
end function

sub testNormalizeTitle(t as object, rx as object)
    expectEqual(t, normalizeTitle("|US| Dune: Part Two [4K]", rx), "dune part two", "pipe and bracket tags")
    expectEqual(t, normalizeTitle("  Blade   Runner 2049  ", rx), "blade runner 2049", "years inside the title stay")
    expectEqual(t, normalizeTitle("Dune – Part Two", rx), "dune part two", "en dash")
    expectEqual(t, normalizeTitle("Rock ’n’ Roll", rx), "rock n roll", "typographic apostrophes are dropped")
    expectEqual(t, normalizeTitle("Dune 8K", rx), "dune", "8K is a quality word")
    ' LCase may leave non-ASCII letters alone on a Roku, so the fold table has the upper-case letters too.
    expectEqual(t, normalizeTitle("ÉCOLE", rx), "ecole", "upper-case accented letter")
    expectEqual(t, normalizeTitle("ŁÓDŹ", rx), "lodz", "Latin Extended-A in upper case")
    expectEqual(t, normalizeTitle("Straße", rx), "strasse", "sharp s")
    expectEqual(t, normalizeTitle("ŒUVRE", rx), "oeuvre", "upper-case oe")
    expectEqual(t, normalizeTitle("Ærø", rx), "aero", "ae and o with stroke")
    expectEqual(t, normalizeTitle("ǄEMAL", rx), "dzemal", "a letter NFKD splits in two")
    expectEqual(t, normalizeTitle("İstanbul", rx), "istanbul", "I with a dot")
    expectEqual(t, normalizeTitle("Ŀlobregat", rx), "l lobregat", "L with a middle dot keeps NFKD's separator")
    expectEqual(t, normalizeTitle(Chr(&hFB01) + "nding Nemo", rx), "finding nemo", "fi ligature")
    expectEqual(t, normalizeTitle("Ame" + Chr(&h301) + "lie", rx), "amelie", "a combining mark is dropped")
    expectEqual(t, normalizeTitle("Ħal", rx), "al", "a letter NFKD keeps becomes a space")
    expectEqual(t, normalizeKey("CSI: Miami", false, rx), "csi miami", "without tag removal")
    expectEqual(t, normalizeKey("EN | The Matrix | 1999", false, rx), "en the matrix 1999", "without tag removal, tags stay as words")
    expectEqual(t, normalizeKey("Dune | 4K | EN [x]", false, rx), "dune en", "without tag removal, brackets and pipe tags still go")
    fold = foldTable()
    expectEqual(t, [fold["é"], fold["É"], fold["ǅ"], fold[Chr(&h36F)], fold["a"], fold["Ħ"]], ["e", "e", "dz", "", invalid, invalid], "fold table")
    ' Fullwidth, Roman numerals, circled numbers and letters, the Kelvin sign; marks beyond U+0300 to U+036F stay.
    expectEqual(t, [fold[Chr(&hFF10)], fold[Chr(&hFF21)], fold[Chr(&hFF5A)], fold[Chr(&h2163)], fold[Chr(&h217F)], fold[Chr(&h2460)], fold[Chr(&h2473)], fold[Chr(&h24B6)], fold[Chr(&h24E9)], fold[Chr(&h212A)]], ["0", "a", "z", "iv", "m", "1", "20", "a", "z", "k"], "fold table beyond Latin")
    expectEqual(t, [fold[Chr(&h483)], fold[Chr(&h1AB0)], fold[Chr(&h20D7)], fold[Chr(&hFE20)], fold[Chr(&h2474)], fold[Chr(&h2180)]], [invalid, invalid, invalid, invalid, invalid, invalid], "fold table leaves other characters")
    ' Rules that ignore case lower-case A to Z only.
    expectEqual(t, asciiLower("ÉCOLE ſ " + Chr(&h212A) + "İX", rx), "École ſ " + Chr(&h212A) + "İx", "only ASCII letters are lower-cased")
end sub

sub testYears(t as object, rx as object)
    expectEqual(t, titleYearOf("Dune (2021)", rx), "2021", "year in parentheses")
    expectEqual(t, titleYearOf("Dune [2021] [4K]", rx), "2021", "year in brackets")
    expectEqual(t, titleYearOf("Blade Runner 2049", rx), "", "bare number is not a year")
    expectEqual(t, titleYearOf("Heat (1995) | 2001", rx), "1995", "a bracket year comes first")
    expectEqual(t, titleYearOf("Heat |" + Chr(160) + "1995", rx), "1995", "no-break space before an ending year")
    expectEqual(t, yearOfText("2021-05-01", rx), "2021", "release date")
    expectEqual(t, yearOfText(1999, rx), "1999", "numeric year")
    expectEqual(t, yearOfText(" 1895", rx), "1895", "a year from 1800")
    expectEqual(t, yearOfText("1799", rx), "", "before 1800")
    expectEqual(t, yearOfText("20211", rx), "", "five digits are not a year")
    expectEqual(t, yearOfText("N/A", rx), "", "not a year")
    expectEqual(t, yearOfText(invalid, rx), "", "missing year")
    ' Provider year fields are read with the Unicode spaces replaced; U+200B and U+180E are not spaces.
    expectEqual(t, [yearOfText(Chr(&hA0) + "2021-05-01", rx), yearOfText(Chr(&h3000) + Chr(&h2002) + "1999", rx), yearOfText(Chr(&hFEFF) + "2001", rx), yearOfText(Chr(&h85) + "1984", rx), yearOfText(Chr(&h2028) + Chr(&h1680) + "1900", rx)], ["2021", "1999", "2001", "1984", "1900"], "Unicode spaces before a provider year")
    expectEqual(t, [yearOfText(Chr(&h200B) + "2021", rx), yearOfText(Chr(&h180E) + "2021", rx), yearOfText(Chr(&h1F) + "2021", rx)], ["", "", ""], "characters that are not spaces before a provider year")
    title = titleFromXtream("movie", movieRow("6", "Heat (1995)", "1", {year: Chr(&h202F) + "1996"}), rx)
    expectEqual(t, title.year, "1996", "a provider year after a narrow no-break space")
    expectEqual(t, [titleYearOf("Heat (1995]", rx), titleYearOf("Heat - 1995 - 4K", rx), titleYearOf("2012 | 1999 | EN", rx), titleYearOf("EN | 1984 | 2010", rx), titleYearOf("Heat-1995", rx)], ["1995", "1995", "1999", "2010", ""], "years among brackets and trailing tags")
    title = titleFromXtream("movie", movieRow("7", "Heat (1995)", "1", {}), rx)
    expectEqual(t, title.year, "1995", "year taken from the name when the row has none")
    title = titleFromXtream("movie", movieRow("8", "EN | Wonka | 2023", "1", {year: "N/A"}), rx)
    expectEqual(t, title.year, "2023", "a year after a pipe in the name")
    title = titleFromXtream("movie", movieRow("9", "Heat (1995)", "1", {year: "", releaseDate: "soon", release_date: "", releasedate: "1996-02-03"}), rx)
    expectEqual(t, title.year, "1996", "releasedate is the last provider field, before the name")
    title = titleFromXtream("series", {series_id: 9, name: "Show", category_id: "2", releaseDate: "2019-01-02", last_modified: "1700000000", rating: "8.1", cover: "c.jpg"}, rx)
    expectEqual(t, [title.key, title.id, title.year, title.added, title.icon, title.rating], ["s9", "9", "2019", 1700000000, "c.jpg", 8.1], "series row")
    title = titleFromXtream("movie", movieRow("12", "EN| Heat", "3", {added: "1700000123", rating_5based: "4", tmdb: "949", container_extension: ""}), rx)
    expectEqual(t, [title.key, title.cats, title.ext, title.added, title.rating, title.hint, title.year], ["m12", ["3"], "mp4", 1700000123, 8, "949", ""], "movie row")
    title = titleFromXtream("movie", movieRow("13", "Heat", "", {category_ids: [4, "5", ""]}), rx)
    expectEqual(t, title.cats, ["4", "5"], "category_ids")
    expectEqual(t, titleFromXtream("movie", {name: "No id"}, rx), invalid, "a row without an id")
    expectEqual(t, [unixSeconds("1700000123456"), unixSeconds(ParseJson("1700000123456")), unixSeconds("100000000001"), unixSeconds("1700000123.0"), unixSeconds(1700000123), unixSeconds(""), unixSeconds(invalid)], [1700000123, 1700000123, 100000000, 1700000123, 1700000123, 0, 0], "dates in milliseconds")
    title = titleFromXtream("series", {series_id: 10, name: "Show", last_modified: "1700000000000"}, rx)
    expectEqual(t, title.added, 1700000000, "series last_modified in milliseconds")
end sub

' Normalize step 1 and the year from a name take space, tab, line feed, vertical tab, form feed and carriage return
' off both ends once the Unicode spaces are replaced, and nothing else; M3U lines and titles lose those and the
' Unicode spaces (trimField). U+001C to U+001F, U+180E and U+200B stay: Trim may remove some of them.
sub testTrimming(t as object, rx as object)
    ascii = Chr(9) + Chr(10) + Chr(11) + Chr(12) + Chr(13) + " "
    expectEqual(t, [normalizeTitle(ascii + "- 1999" + ascii, rx), titleYearOf(ascii + " - 1999" + ascii, rx), titleYearOf(Chr(&h3000) + "- 1999", rx)], ["1999", "", ""], "a tag-only name is read with its ends trimmed")
    expectEqual(t, [titleYearOf("Heat - 1995" + Chr(13) + Chr(10), rx), titleYearOf(Chr(9) + "Heat | 1995 " + Chr(11), rx)], ["1995", "1995"], "a year before trimmed ends")
    expectEqual(t, [normalizeTitle(Chr(&h1F) + " - 1999", rx), titleYearOf(Chr(&h1F) + " - 1999", rx), titleYearOf(Chr(&h180E) + " - 1999", rx), titleYearOf(Chr(&h200B) + " - 1999", rx)], ["", "1999", "1999", "1999"], "characters that are not spaces are not trimmed")
    expectEqual(t, trimEnds(" " + Chr(&h1C) + " Heat " + Chr(&h1F) + Chr(13)), Chr(&h1C) + " Heat " + Chr(&h1F), "trimEnds stops at U+001C and U+001F")
    expectEqual(t, [trimEnds(""), trimEnds(ascii), trimEnds("Heat"), trimEnds(ascii + "H" + ascii), trimEnds(" A  B" + Chr(9))], ["", "", "Heat", "H", "A  B"], "trimEnds takes the ends only")
    expectEqual(t, [trimField(""), trimField("Heat"), trimField(ascii), trimField(Chr(&h3000) + Chr(&hFEFF) + " Heat" + Chr(&hA0) + Chr(&h2029) + Chr(13))], ["", "Heat", "", "Heat"], "trimField takes spaces off the ends")
    expectEqual(t, [trimField(Chr(&h1F) + " - 1999" + Chr(13)), trimField(Chr(&h180E) + "Heat" + Chr(&h200B) + " "), trimField(" " + Chr(&h1C) + "|EN" + Chr(&h1E))], [Chr(&h1F) + " - 1999", Chr(&h180E) + "Heat" + Chr(&h200B), Chr(&h1C) + "|EN" + Chr(&h1E)], "trimField keeps U+001C to U+001F, U+180E and U+200B")
    expectEqual(t, titleFromM3u("movie", "m~1", trimField(Chr(&h1F) + " - 1999" + Chr(13)), "", "Movies", "u", rx).year, "1999", "an M3U title keeps U+001F")
end sub

' docs/browse.md, "Test cases": a name ending in 40 quality tags and a word that is not a tag. yearEnd tries the
' whole chain and fails; with a TAG that matched a tag in two ways this took longer with each tag.
sub testTagChainTime(t as object, rx as object)
    chain = "Movie - 1999"
    for i = 1 to 40
        chain = chain + " - 4K"
    end for
    name = chain + " - Extended"
    timer = CreateObject("roTimespan")
    timer.Mark()
    result = [normalizeTitle(name, rx), normalizeKey(name, false, rx), titleYearOf(name, rx)]
    elapsed = timer.TotalMilliseconds()
    expectEqual(t, result, ["movie 1999 extended", "movie 1999 extended", ""], "40 quality tags and a word")
    expectTrue(t, elapsed < 50, "40 quality tags take well under 50 ms (took " + elapsed.ToStr() + " ms)")
    expectEqual(t, [normalizeTitle(chain, rx), titleYearOf(chain, rx)], ["movie", "1999"], "40 quality tags after a year")
end sub

' docs/browse.md, "Test cases" and "Trimming": a name with a long run of spaces inside it. A trim written as the pattern
' ^[ \t\n\x0B\f\r]+|[ \t\n\x0B\f\r]+$ tries its second half again at every space of the run, so its time grew with
' the square of the run (over half a second here for 16,000 spaces). trimEnds reads the ends only. The run is timed
' with spaces at the ends of the name too, since the old trim ran its pattern only then.
sub testSpaceRunTime(t as object, rx as object)
    spaces = String(16000, " ")
    for each name in ["A" + spaces + "B", " A" + spaces + "B" + Chr(13)]
        timer = CreateObject("roTimespan")
        timer.Mark()
        result = [normalizeTitle(name, rx), titleYearOf(name, rx)]
        elapsed = timer.TotalMilliseconds()
        label = "16,000 spaces inside a name of " + Len(name).ToStr() + " characters"
        expectEqual(t, result, ["a b", ""], label)
        expectTrue(t, elapsed < 50, label + " take well under 50 ms (took " + elapsed.ToStr() + " ms)")
    end for
end sub

sub testProviderTmdbId(t as object, rx as object)
    expectEqual(t, providerTmdbId({tmdb: "603"}, rx), "603", "tmdb field")
    expectEqual(t, providerTmdbId({tmdb_id: 603}, rx), "603", "numeric tmdb_id")
    expectEqual(t, providerTmdbId({info: {tmdb_id: "603"}}, rx), "603", "tmdb_id inside info")
    expectEqual(t, providerTmdbId({info: {tmdb: "603"}}, rx), "603", "tmdb inside info")
    expectEqual(t, providerTmdbId({tmdb: " 603.0 "}, rx), "603", "a trailing .0")
    expectEqual(t, providerTmdbId({tmdb: "0603"}, rx), "603", "leading zeros")
    expectEqual(t, providerTmdbId({tmdb: "abc", tmdb_id: "", info: {tmdb_id: "0", tmdb: "77"}}, rx), "77", "the first usable field")
    expectEqual(t, providerTmdbId({tmdb: "123456789012"}, rx), "123456789012", "12 digits")
    expectEqual(t, providerTmdbId({tmdb: "1234567890123"}, rx), "", "13 digits")
    expectEqual(t, providerTmdbId({tmdb: "000"}, rx), "", "zero is no id")
    expectEqual(t, providerTmdbId({tmdb: "603.5"}, rx), "", "a fraction")
    expectEqual(t, providerTmdbId({tmdb: "tt0133093"}, rx), "", "IMDb ids are ignored")
    ' Strings are trimmed as provider fields (trimField), not with Trim: U+0085 and U+3000 are spaces, U+001F and
    ' U+200B are not.
    expectEqual(t, [providerTmdbId({tmdb: Chr(&h85) + "123"}, rx), providerTmdbId({tmdb: Chr(&h3000) + "123" + Chr(&hA0)}, rx), providerTmdbId({tmdb: Chr(11) + "123.0" + Chr(12)}, rx)], ["123", "123", "123"], "a string trimmed as a provider field")
    expectEqual(t, [providerTmdbId({tmdb: Chr(&h1F) + "123"}, rx), providerTmdbId({tmdb: "123" + Chr(&h1F)}, rx), providerTmdbId({tmdb: Chr(&h200B) + "123"}, rx), providerTmdbId({tmdb: "123 .0"}, rx), providerTmdbId({tmdb: Chr(&h661) + Chr(&h662) + Chr(&h663)}, rx)], ["", "", "", "", ""], "strings that are not ids")
    ' Numbers by type: ParseJson gives an Integer or LongInteger, or a single-precision Float for a number with a
    ' fraction or an exponent (whole numbers are exact below 16777216). Double is taken alike.
    expectEqual(t, [providerTmdbId({tmdb: 123}, rx), providerTmdbId({tmdb: 999999999999&}, rx), providerTmdbId({tmdb: 2147483648&}, rx), providerTmdbId({tmdb: 1000000000000&}, rx), providerTmdbId({tmdb: 0}, rx), providerTmdbId({tmdb: -5}, rx)], ["123", "999999999999", "2147483648", "", "", ""], "integers from 1 to 999999999999")
    expectEqual(t, [providerTmdbId({tmdb: 123.0}, rx), providerTmdbId({tmdb: 1000!}, rx), providerTmdbId({tmdb: 1234567.0}, rx), providerTmdbId({tmdb: 1e7}, rx), providerTmdbId({tmdb: 16777216.0}, rx), providerTmdbId({tmdb: 1.5}, rx), providerTmdbId({tmdb: 0.5}, rx), providerTmdbId({tmdb: -123.0}, rx), providerTmdbId({tmdb: 1e12}, rx)], ["123", "1000", "1234567", "10000000", "", "", "", "", ""], "whole Floats below 16777216")
    expectEqual(t, [providerTmdbId({tmdb: 123#}, rx), providerTmdbId({tmdb: 2.5#}, rx)], ["123", ""], "Doubles")
    ' ParseJson's types, read from JSON text: a number with a fraction or an exponent is a Float on a Roku.
    expectEqual(t, [providerTmdbId(ParseJson("{""tmdb"":1e3}"), rx), providerTmdbId(ParseJson("{""tmdb"":""1e3""}"), rx), providerTmdbId(ParseJson("{""tmdb"":123.0}"), rx), providerTmdbId(ParseJson("{""tmdb"":999999999999}"), rx)], ["1000", "", "123", "999999999999"], "numbers and strings from ParseJson")
    ' Anything else gives no id, and the next key is read; info counts only as an object.
    expectEqual(t, [providerTmdbId({tmdb: ["123"]}, rx), providerTmdbId({tmdb: {id: "123"}}, rx), providerTmdbId({tmdb: true}, rx), providerTmdbId({tmdb: invalid}, rx), providerTmdbId({}, rx)], ["", "", "", "", ""], "values that are not strings or numbers")
    expectEqual(t, [providerTmdbId({tmdb: ["", "77"], tmdb_id: 8}, rx), providerTmdbId({tmdb: true, tmdb_id: "true", info: {tmdb: "12"}}, rx), providerTmdbId({info: "123"}, rx), providerTmdbId({info: [{tmdb_id: "5"}]}, rx), providerTmdbId({tmdb: 1.5, tmdb_id: "7.0"}, rx)], ["8", "12", "", "", "7"], "the next key after a value that is no id")
    boxed = CreateObject("roString")
    boxed.SetString(" 0123 ")
    expectEqual(t, [providerTmdbId({tmdb: boxed}, rx), providerTmdbId({tmdb: CreateObject("roInt")}, rx)], ["123", ""], "boxed values")
end sub

sub testAdultNames(t as object, rx as object)
    for each name in ["XXX", "Adults Only", "ADULT", "18+ Movies", "Porn"]
        expectTrue(t, isAdultName(name, rx), "adult name " + name)
    end for
    for each name in ["Adult Swim", "Adultswim Shows", "Kids", "Young Adult Fiction?"]
        if name = "Young Adult Fiction?"
            ' "Adult" as a whole word counts, as on every other Tuner app.
            expectTrue(t, isAdultName(name, rx), "adult word " + name)
        else
            expectFalse(t, isAdultName(name, rx), "not adult " + name)
        end if
    end for
end sub

sub testCategoryServices(t as object, rx as object)
    expectEqual(t, categoryServices("NETFLIX 4K", rx), ["netflix"], "netflix")
    expectEqual(t, categoryServices("HBO Max Series", rx), ["max"], "hbo max")
    expectEqual(t, categoryServices("Max Originals", rx), ["max"], "max")
    expectEqual(t, categoryServices("Maximum Action", rx), [], "maximum is not max")
    expectEqual(t, categoryServices("Amazon Prime Video", rx), ["prime"], "amazon prime")
    expectEqual(t, categoryServices("Primetime Hits", rx), [], "primetime is not prime")
    expectEqual(t, categoryServices("Disney+ & Hulu", rx), ["disney", "hulu"], "two services")
    expectEqual(t, categoryServices("Apple TV+", rx), ["apple"], "apple")
    expectEqual(t, categoryServices("Paramount+ | Peacock", rx), ["paramount", "peacock"], "paramount and peacock")
end sub

sub testRowsPayload(t as object)
    none = parseRowsPayload(FormatJson({v: 1, source: "none", movie: {}, tv: {}, genres: {}}))
    expectEqual(t, [none.valid, none.source, none.movie.popular, none.tv.services.netflix, none.genres.movie], [true, "none", [], [], []], "no-key answer")
    partial = parseRowsPayload(FormatJson({v: 1, source: "tmdb", movie: {popular: [{id: 1}], services: {netflix: [{id: 2}]}}}))
    expectEqual(t, [partial.source, partial.movie.popular.Count(), partial.movie.featured, partial.movie.services.netflix.Count(), partial.movie.services.hulu, partial.tv.popular], ["tmdb", 1, [], 1, [], []], "missing lists are empty")
    wrongType = parseRowsPayload(FormatJson({v: 1, source: "tmdb", movie: {popular: "x"}}))
    expectEqual(t, wrongType.movie.popular, [], "a list that is not an array is empty")
    future = parseRowsPayload(FormatJson({v: 2, source: "tmdb"}))
    expectEqual(t, [future.valid, future.source], [false, "none"], "another version is ignored")
    expectEqual(t, [parseRowsPayload("").valid, parseRowsPayload("not json").valid, parseRowsPayload(invalid).valid], [false, false, false], "bad bodies")
end sub

sub testCacheAge(t as object)
    hours = 3600
    expectTrue(t, isFreshCache(1000, 1000 + 11 * hours, 12 * hours), "11 hours is fresh")
    expectFalse(t, isFreshCache(1000, 1000 + 12 * hours, 12 * hours), "12 hours is stale")
    expectFalse(t, isFreshCache(0, 5, 12 * hours), "never fetched")
    expectFalse(t, isFreshCache(5000, 1000, 12 * hours), "clock went back")
end sub

sub testMatching(t as object, rx as object)
    payload = rowsPayloadWith({popular: [tmdbItem(1, "Dune", "2021", ["US"], [878]), tmdbItem(2, "The Lion King", "2019", ["US"], []), tmdbItem(3, "The Lion King", "1994", ["US"], []), tmdbItem(4, "Amélie", "2001", ["FR"], [])], featured: [tmdbItem(1, "Dune", "2021", ["US"], [878])]}, {})
    index = tmdbIndex(payload.movie, rx)
    expectEqual(t, index.count, 4, "duplicates across lists are indexed once")
    expectEqual(t, matchTmdb(index, "1", "", "").id, "1", "provider id")
    expectEqual(t, matchTmdb(index, "999", "dune", "2021"), invalid, "an unknown provider id does not fall back to the title")
    expectEqual(t, matchTmdb(index, "", normalizeTitle("Dune (2021) [4K]", rx), "2021").id, "1", "title and year")
    expectEqual(t, matchTmdb(index, "", "dune", "2022").id, "1", "year off by one")
    expectEqual(t, matchTmdb(index, "", "dune", "2023"), invalid, "year off by two")
    expectEqual(t, matchTmdb(index, "", "dune", "").id, "1", "no year, one candidate")
    expectEqual(t, matchTmdb(index, "", normalizeTitle("The Lion King", rx), ""), invalid, "no year, two candidates")
    expectEqual(t, matchTmdb(index, "", "lion king", "1994").id, "3", "exact year wins")
    expectEqual(t, matchTmdb(index, "", normalizeTitle("Amelie", rx), "2001").id, "4", "accent-free provider title")
    expectEqual(t, matchTmdb(index, "", "", "2021"), invalid, "empty title")

    ' A name whose tags hide its title is looked up again without removing them.
    payload = rowsPayloadWith({popular: [tmdbItem(5, "Csi: Miami", "2002", ["US"], []), tmdbItem(6, "Love", "2015", ["US"], []), tmdbItem(7, "EN Love", "2011", ["US"], [])]}, {})
    index = tmdbIndex(payload.movie, rx)
    title = {hint: "", name: "CSI: Miami", year: ""}
    expectEqual(t, matchTitle(index, title, normalizeTitle(title.name, rx), rx).id, "5", "second lookup without tag removal")
    title = {hint: "", name: "EN | Love", year: "2015"}
    expectEqual(t, matchTitle(index, title, normalizeTitle(title.name, rx), rx).id, "6", "the first lookup wins when it matches")
    title = {hint: "", name: "EN | Love", year: "2011"}
    expectEqual(t, matchTitle(index, title, normalizeTitle(title.name, rx), rx).id, "7", "the second lookup when the year rules out the first")
    title = {hint: "999", name: "CSI: Miami", year: ""}
    expectEqual(t, matchTitle(index, title, normalizeTitle(title.name, rx), rx), invalid, "a provider id never falls back to the name")
end sub

sub testGenres(t as object, rx as object)
    table = genreTable([{id: 10759, name: "Action & Adventure"}, {id: 10765, name: "Sci-Fi & Fantasy"}, {id: 18, name: "Drama"}])
    expectEqual(t, providerGenreKeys("Action, Adventure", table, rx), "|10759|", "both words map to one TMDB genre")
    expectEqual(t, providerGenreKeys("Science Fiction / Drama", table, rx), "|10765|18|", "aliases")
    expectEqual(t, providerGenreKeys("Cooking", table, rx), "", "unknown genre")
    expectEqual(t, table.list.Count(), 3, "closed table does not grow")
    open = genreTable([])
    expectEqual(t, providerGenreKeys("Comedy, Drama", open, rx), "|comedy|drama|", "open table uses provider genres")
    expectEqual(t, providerGenreKeys("drama", open, rx), "|drama|", "open table reuses a genre")
    expectEqual(t, open.list, [{key: "comedy", name: "Comedy"}, {key: "drama", name: "Drama"}], "open table list")
end sub

' TMDB movie lists carry no countries until the server has looked them up: an empty origin is unknown,
' and USA only then goes by the category (docs/browse.md).
sub testUnknownOrigin(t as object, rx as object)
    categories = [{id: "1", name: "US | Movies", adult: false}, {id: "2", name: "FR | Films", adult: false}]
    rows = [movieRow("10", "Dune (2021)", "1", {added: "1700000300"}), movieRow("11", "Dune (2021)", "2", {added: "1700000400"}), movieRow("12", "Oppenheimer (2023)", "1", {added: "1700000500"})]
    payload = rowsPayloadWith({popular: [tmdbItem(438631, "Dune", "2021", [], [878]), tmdbItem(872585, "Oppenheimer", "2023", ["GB", "US"], [18])]}, {})
    section = buildTitleSection(sectionTitles(rows, "movie", rx), categories, payload.movie, payload.genres.movie, rx)
    items = section.items
    expectEqual(t, [items[0].tmdb, items[0].us], ["438631", true], "matched, origin unknown, US category")
    expectEqual(t, [items[1].tmdb, items[1].us], ["438631", false], "matched, origin unknown, foreign category")
    expectEqual(t, [items[2].tmdb, items[2].us], ["872585", true], "origin with US among others")
    usOnly = {usOnly: true, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.popular, usOnly, 0, 20).picked), ["Dune (2021)", "Oppenheimer (2023)"], "Popular keeps movies whose origin is not known yet")
end sub

' docs/browse.md, "Origin countries": an entry counts when it is two ASCII letters with only spaces around them;
' anything else, a value that is not a string too, is ignored, and a title with no country left is unknown.
sub testOrigins(t as object, rx as object)
    facts = []
    for each origin in [[" us ", "GB"], ["USA"], ["USA", "GB"], [840, invalid, true, "US"], [840], [Chr(&hA0) + "Us" + Chr(&h3000)], ["u" + Chr(&h17F)], [Chr(&hFF35) + Chr(&hFF33)], ["U.S.", "U S", ""]]
        entry = tmdbEntry({id: 1, origin: origin}, rx)
        facts.Push([entry.known, entry.us])
    end for
    expectEqual(t, facts, [[true, true], [false, false], [true, false], [true, true], [false, false], [true, true], [false, false], [false, false], [false, false]], "origin entries")
end sub

' A title's categories are the category_id and category_ids of every row with its id (docs/browse.md); ids
' missing from the category list are left out. Services, genres and the adult flag come from each row's own.
sub testCategoryMemberships(t as object, rx as object)
    categories = [{id: "1", name: "FR | Films", adult: false}, {id: "2", name: "NETFLIX MOVIES", adult: false}, {id: "3", name: "US | Comedy", adult: false}, {id: "4", name: "XXX", adult: false}, {id: "5", name: "DE | Filme", adult: false}]
    rows = [
        movieRow("10", "Glass Onion", "1", {added: "1700000100", category_ids: [2, 3]}),
        movieRow("11", "Le Film", "1", {added: "1700000200", category_ids: ["99"]}),
        movieRow("12", "No Category", "", {added: "1700000300"}),
        movieRow("13", "Unknown Only", "98", {added: "1700000400"}),
        movieRow("14", "Split Rows", "5", {added: "1700000500"}),
        movieRow("14", "Split Rows", "3", {added: "1700000500"}),
        movieRow("15", "Hidden Copy", "3", {added: "1700000600", category_ids: [4]})
    ]
    none = parseRowsPayload(FormatJson({v: 1, source: "none", movie: {}, tv: {}, genres: {}}))
    section = buildTitleSection(sectionTitles(rows, "movie", rx), categories, none.movie, none.genres.movie, rx)
    us = []
    for each item in section.items
        us.Push(item.us)
    end for
    expectEqual(t, us, [true, false, true, true, true, true, true], "USA only: any known category passes; none left passes")
    expectEqual(t, [section.items[0].g, section.items[6].adult, section.items[0].adult], ["|comedy|", true, false], "genres and adult from all of a row's categories")
    expectEqual(t, namesOf(section, section.lists.netflix), ["Glass Onion"], "services from category_ids")
end sub

' Copies of one TMDB title in a list are one poster: it stands where its first visible copy stands and opens
' its best visible copy, ranked by USA only, then the newest added, then catalogue order.
sub testCopies(t as object, rx as object)
    categories = [{id: "1", name: "US | Movies", adult: false}, {id: "2", name: "FR | Films", adult: false}, {id: "3", name: "XXX", adult: false}]
    rows = [
        movieRow("20", "Heat (1995)", "1", {added: "1700000100"}),
        movieRow("21", "Heat (1995) [4K]", "1", {added: "1700000300"}),
        movieRow("22", "Heat (1995) [FR]", "2", {added: "1700000500"}),
        movieRow("23", "Heat 1995", "1", {added: "1700000300", tmdb: "949"}),
        movieRow("24", "Heat - Adult Copy", "3", {added: "1700000900", tmdb: "949"}),
        movieRow("25", "Other Film", "1", {added: "1700000400"})
    ]
    payload = rowsPayloadWith({popular: [tmdbItem(949, "Heat", "1995", ["US"], [80])]}, {})
    section = buildTitleSection(sectionTitles(rows, "movie", rx), categories, payload.movie, payload.genres.movie, rx)
    expectEqual(t, section.copies["949"], [4, 1, 3, 0, 2], "copies: USA only first, then newest, then catalogue order")
    opts = {usOnly: true, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.recent, opts, 0, 20).picked), ["Other Film", "Heat (1995) [4K]"], "USA only: the poster stands where its first visible copy stands")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.recent, opts, 0, 20).picked), ["Heat (1995) [4K]", "Other Film"], "All: the French copy's place, the best copy")
    opts = {usOnly: false, adultOk: true, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.popular, opts, 0, 20).picked), ["Heat - Adult Copy"], "unlocked: the newest copy that passes")
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.az, {usOnly: true, adultOk: false, genre: "", seen: {}}, 0, 20).picked), ["Heat (1995) [4K]", "Other Film"], "A-Z")
    expectEqual(t, namesOf(section, searchTitles(section, "fr]", {usOnly: false, adultOk: false, genre: "", seen: {}}, 10)), ["Heat (1995) [4K]"], "search opens the best copy")
end sub

' Unmatched titles reach genre filters through categories named after a genre.
sub testCategoryGenres(t as object, rx as object)
    table = genreTable([{id: 28, name: "Action"}, {id: 878, name: "Science Fiction"}, {id: 10751, name: "Family"}, {id: 35, name: "Comedy"}])
    expectEqual(t, categoryGenreKeys("EN | Action Movies", table, rx), "|28|", "noise words dropped")
    expectEqual(t, categoryGenreKeys("SCI-FI 4K", table, rx), "|878|", "alias and quality word")
    expectEqual(t, categoryGenreKeys("Kids & Family", table, rx), "|10751|", "one part of two is a TMDB genre")
    expectEqual(t, categoryGenreKeys("Comedy Central", table, rx), "", "a genre word with more words is not a genre")
    expectEqual(t, categoryGenreKeys("NETFLIX MOVIES", table, rx), "", "no genre")
    expectEqual(t, table.list.Count(), 4, "closed table does not grow")
    open = genreTable([])
    expectEqual(t, categoryGenreKeys("US | Horror Movies", open, rx), "|horror|", "open table: common genre")
    expectEqual(t, categoryGenreKeys("Bollywood Gold", open, rx), "", "open table: other words are not genres")
    expectEqual(t, open.list, [{key: "horror", name: "Horror"}], "open table list")

    categories = [{id: "1", name: "US | Comedy", adult: false}, {id: "2", name: "Kids & Family", adult: false}, {id: "3", name: "Movies", adult: false}]
    rows = [movieRow("1", "Some Comedy", "1", {}), movieRow("2", "Some Family Film", "2", {genre: "Animation"}), movieRow("3", "Plain", "3", {})]
    none = parseRowsPayload(FormatJson({v: 1, source: "none", movie: {}, tv: {}, genres: {}}))
    section = buildTitleSection(sectionTitles(rows, "movie", rx), categories, none.movie, none.genres.movie, rx)
    expectEqual(t, [section.items[0].g, section.items[1].g, section.items[2].g], ["|comedy|", "|animation|", ""], "provider genre first, then the category")
    expectEqual(t, section.genres, [{key: "animation", name: "Animation"}, {key: "comedy", name: "Comedy"}], "only genres some title has, by name")
end sub

function fixtureSection(rx as object) as object
    categories = [{id: "1", name: "US | Movies", adult: false}, {id: "2", name: "FR | Films", adult: false}, {id: "3", name: "NETFLIX MOVIES", adult: false}, {id: "4", name: "XXX", adult: false}, {id: "5", name: "Kids", adult: "1"}]
    rows = [
        movieRow("10", "Dune (2021)", "1", {added: "1700000300", rating: "8.0"}),
        movieRow("11", "Dune (2021) [FR]", "2", {added: "1700000400"}),
        movieRow("12", "Amélie (2001)", "1", {added: "1700000100", rating: "8.3"}),
        movieRow("13", "Le Film Local", "2", {added: "1700000500", rating: "9.9"}),
        movieRow("14", "Glass Onion", "3", {added: "1700000200", tmdb: "661374"}),
        movieRow("15", "Hot Stuff", "4", {added: "1700000600", rating: "5.0"}),
        movieRow("16", "Cartoon Time", "5", {added: "0", rating: "6.0"}),
        movieRow("17", "The Avengers", "1", {added: "1700000050", genre: "Action, Science Fiction"}),
        {name: "No id", category_id: "1"}
    ]
    payload = rowsPayloadWith({popular: [tmdbItem(438631, "Dune", "2021", ["US"], [878]), tmdbItem(194, "Amélie", "2001", ["FR", "DE"], [35])], top_rated: [tmdbItem(194, "Amélie", "2001", ["FR", "DE"], [35]), tmdbItem(438631, "Dune", "2021", ["US"], [878])], services: {netflix: [tmdbItem(661374, "Glass Onion: A Knives Out Mystery", "2022", ["US"], [35, 80])]}}, {})
    return buildTitleSection(sectionTitles(rows, "movie", rx), categories, payload.movie, payload.genres.movie, rx)
end function

sub testBuildTitleSection(t as object, rx as object)
    section = fixtureSection(rx)
    items = section.items
    expectEqual(t, items.Count(), 8, "rows without an id are skipped")
    expectEqual(t, section.matched, 4, "matched titles")
    expectEqual(t, [items[0].tmdb, items[0].us, items[0].g], ["438631", true, "|878|"], "US title in a US category")
    expectEqual(t, [items[1].tmdb, items[1].us], ["438631", false], "US title in a foreign category fails USA only")
    expectEqual(t, [items[2].tmdb, items[2].us], ["194", false], "non-US origin fails USA only")
    expectEqual(t, [items[3].tmdb, items[3].us], ["", false], "unmatched title in a foreign category")
    expectEqual(t, [items[4].tmdb, items[4].us], ["661374", true], "provider TMDB id")
    expectEqual(t, [items[5].adult, items[6].adult, items[0].adult], [true, true, false], "adult by category name and by flag")
    expectEqual(t, [items[7].tmdb, items[7].us, items[7].g], ["", true, "|28|878|"], "unmatched title keeps provider genres mapped to TMDB")
    expectEqual(t, items[0].DoesExist("hint") or items[0].DoesExist("genre") or items[0].DoesExist("cats") or items[0].DoesExist("added"), false, "index-only fields are dropped")
    expectEqual(t, section.byKey["m14"], 4, "key lookup")
    expectEqual(t, namesOf(section, section.lists.popular), ["Dune (2021)", "Dune (2021) [FR]", "Amélie (2001)"], "popular in TMDB order, USA copy first")
    expectEqual(t, namesOf(section, section.lists.featured), [], "empty TMDB list")
    expectEqual(t, namesOf(section, section.lists.recent), ["Hot Stuff", "Le Film Local", "Dune (2021) [FR]", "Dune (2021)", "Glass Onion", "Amélie (2001)", "The Avengers"], "recently added, newest first, no timestamp left out")
    expectEqual(t, namesOf(section, section.lists.rated), ["Amélie (2001)", "Dune (2021)", "Dune (2021) [FR]", "Le Film Local", "Cartoon Time", "Hot Stuff"], "top rated: TMDB order, then provider rating")
    expectEqual(t, namesOf(section, section.lists.netflix), ["Glass Onion"], "service: TMDB and the Netflix category, once")
    expectEqual(t, namesOf(section, section.lists.az), ["Amélie (2001)", "The Avengers", "Cartoon Time", "Dune (2021)", "Dune (2021) [FR]", "Glass Onion", "Hot Stuff", "Le Film Local"], "A-Z ignores a leading The")
    expectEqual(t, section.genres.Count(), 3, "TMDB genre list")
end sub

sub testPickTitles(t as object, rx as object)
    section = fixtureSection(rx)
    usOnly = {usOnly: true, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.popular, usOnly, 0, 20).picked), ["Dune (2021)"], "USA only keeps the US copy once")
    everything = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.popular, everything, 0, 20).picked), ["Dune (2021)", "Amélie (2001)"], "All shows each TMDB title once")
    unlocked = {usOnly: false, adultOk: true, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.recent, unlocked, 0, 2).picked), ["Hot Stuff", "Le Film Local"], "adult titles only when unlocked")
    locked = {usOnly: false, adultOk: false, genre: "", seen: {}}
    ' Dune stands where its newest copy, the French one, stands and opens the copy that passes USA only.
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.recent, locked, 0, 20).picked), ["Le Film Local", "Dune (2021)", "Glass Onion", "Amélie (2001)", "The Avengers"], "adult titles hidden when locked")
    genre = {usOnly: true, adultOk: false, genre: "878", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section, section.lists.az, genre, 0, 20).picked), ["The Avengers", "Dune (2021)"], "genre filter")
    paging = {usOnly: false, adultOk: true, genre: "", seen: {}}
    first = pickTitles(section, section.lists.az, paging, 0, 3)
    second = pickTitles(section, section.lists.az, paging, first.cursor, 3)
    expectEqual(t, [namesOf(section, first.picked), namesOf(section, second.picked), second.cursor], [["Amélie (2001)", "The Avengers", "Cartoon Time"], ["Dune (2021)", "Glass Onion", "Hot Stuff"], 7], "pages continue from the cursor and skip a TMDB title already shown")
    expectEqual(t, pickTitles(section, invalid, paging, 0, 3).picked, [], "a missing list is empty")
end sub

sub testHomeRows(t as object, rx as object)
    rows = []
    for i = 1 to 30
        rows.Push(movieRow(i.ToStr(), "Movie " + i.ToStr(), "1", {added: "17000000" + Right("0" + i.ToStr(), 2), rating: "7"}))
    end for
    for i = 31 to 33
        rows.Push(movieRow(i.ToStr(), "Netflix " + i.ToStr(), "3", {added: "0"}))
    end for
    categories = [{id: "1", name: "Movies", adult: false}, {id: "3", name: "Netflix", adult: false}]
    none = parseRowsPayload(FormatJson({v: 1, source: "none", movie: {}, tv: {}, genres: {}}))
    movies = buildTitleSection(sectionTitles(rows, "movie", rx), categories, none.movie, none.genres.movie, rx)
    series = buildTitleSection([], [], none.tv, none.genres.tv, rx)
    catalog = {movies: movies, series: series}
    opts = {usOnly: true, adultOk: false}
    home = buildHomeRows(catalog, false, opts, [])
    ids = []
    for each row in home
        ids.Push(row.id)
    end for
    expectEqual(t, ids, ["movies:recent", "movies:rated"], "without TMDB: no Popular or Featured, rows under 5 titles hidden")
    expectEqual(t, [home[0].refs.Count(), movies.items[home[0].refs[0].idx].name], [20, "Movie 30"], "rows hold 20 titles, newest first")
    refs = []
    for i = 0 to 5
        refs.Push({type: "movies", idx: i})
    end for
    home = buildHomeRows(catalog, false, opts, refs)
    expectEqual(t, [home[0].id, home[0].refs.Count()], ["continue", 6], "Continue watching comes first")
    home = buildHomeRows(catalog, false, opts, [{type: "movies", idx: 0}])
    expectEqual(t, home[0].id, "movies:recent", "Continue watching needs 5 titles on Home")
    specs = homeRowSpecs(true)
    expectEqual(t, [specs[0].title, specs[3].title, specs[4].title, specs[5].title, specs[19].title, specs[20].title, specs[specs.Count() - 1].title], ["Popular – Movies", "Featured – Series", "Netflix – Movies", "Netflix – Series", "Peacock – Series", "Recently added – Movies", "Top rated – Series"], "row order with TMDB")
    expectEqual(t, homeRowSpecs(false).Count(), 20, "row count without TMDB")
end sub

sub testSearchTitles(t as object, rx as object)
    section = fixtureSection(rx)
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section, "dune", opts, 10)), ["Dune (2021)"], "one result per TMDB title")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section, "on", opts, 10)), ["Glass Onion"], "names containing the text")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section, "t", opts, 10)), [], "at least 2 letters")
    opts = {usOnly: true, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section, "le", opts, 10)), [], "USA only applies to search")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section, "the", opts, 10)), ["The Avengers"], "names starting with the text come first")
end sub

sub testDiscoverLists(t as object)
    names = []
    for each list in discoverLists(true)
        names.Push(list.name)
    end for
    expectEqual(t, names, ["Popular", "Featured", "Top rated", "Recently added", "A–Z", "Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Hulu", "Paramount+", "Peacock"], "Discover lists with TMDB")
    expectEqual(t, discoverLists(false)[0].key, "rated", "Discover lists without TMDB")
end sub

sub testLibraryStore(t as object)
    store = libraryNew("line1")
    expectTrue(t, libraryToggleFavorite(store, "m1"), "add favorite")
    expectTrue(t, libraryToggleFavorite(store, "s2"), "add second favorite")
    expectEqual(t, store.fav, ["s2", "m1"], "newest favorite first")
    expectFalse(t, libraryToggleFavorite(store, "m1"), "remove favorite")
    expectEqual(t, [libraryIsFavorite(store, "s2"), libraryIsFavorite(store, "m1")], [true, false], "favorite lookup")
    for i = 1 to 160
        libraryToggleFavorite(store, "m" + i.ToStr())
    end for
    expectEqual(t, [store.fav.Count(), store.fav[0]], [150, "m160"], "favorites are capped")

    store = libraryNew("line1")
    libraryRecordProgress(store, {k: "m1", p: 600, d: 6000}, 100)
    libraryRecordProgress(store, {k: "m2", p: 10, d: 6000}, 101)
    expectEqual(t, libraryKeys(store.prog), ["m1"], "under 15 seconds is not recorded")
    libraryRecordProgress(store, {k: "m1", p: 5, d: 6000}, 102)
    expectEqual(t, store.prog[0].p, 600, "a short stop keeps the old position")
    libraryRecordProgress(store, {k: "s3", p: 300, d: 2400, e: "77", l: "S1 E2", n: 1}, 103)
    expectEqual(t, libraryKeys(store.prog), ["s3", "m1"], "newest progress first")
    expectEqual(t, progressFraction(libraryProgress(store, "s3")), 0.125, "progress fraction")
    libraryRecordProgress(store, {k: "m1", p: 5800, d: 6000}, 104)
    expectEqual(t, libraryKeys(store.prog), ["s3"], "finished movie leaves Continue watching")
    libraryRecordProgress(store, {k: "s3", e: "78", l: "S1 E3", n: 2, p: 0, d: 0, nx: true}, 105)
    expectEqual(t, [store.prog[0].l, progressFraction(store.prog[0]), store.prog[0].t], ["S1 E3", 0, 105], "next episode is kept")
    libraryRemoveProgress(store, "s3")
    expectEqual(t, store.prog, [], "remove progress")
    for i = 1 to 35
        libraryRecordProgress(store, {k: "m" + i.ToStr(), p: 100, d: 1000}, 200 + i)
    end for
    expectEqual(t, [store.prog.Count(), store.prog[0].k], [30, "m35"], "progress is capped")

    libraryRecordWatched(store, "m1", 1)
    libraryRecordWatched(store, "s2", 2)
    libraryRecordWatched(store, "m1", 3)
    expectEqual(t, libraryKeys(store.seen), ["m1", "s2"], "recently watched, newest first, once each")

    expectEqual(t, libraryFor(invalid, "line1").line, "line1", "new library when nothing is stored")
    expectEqual(t, libraryFor({line: "other", fav: ["m1"]}, "line1").fav, [], "another line starts empty")
    expectEqual(t, libraryFor({line: "line1", fav: ["m1"], prog: "x"}, "line1").prog, [], "damaged lists are reset")
    expectEqual(t, [libraryTypeOf("m1"), libraryTypeOf("s2")], ["movies", "series"], "key types")

    rx = browseRx()
    section = fixtureSection(rx)
    catalog = {movies: section, series: buildTitleSection([], [], emptyRowsSection(), [], rx)}
    refs = libraryRefs(["m10", "m15", "m99", "s1", "m12"], catalog, {usOnly: true, adultOk: false, genre: "", seen: {}})
    expectEqual(t, refs, [{type: "movies", idx: 0}], "library shows only visible titles still on the line")
end sub

sub testClockText(t as object)
    expectEqual(t, [clockText(0), clockText(75), clockText(3723), clockText(36000)], ["0:00", "1:15", "1:02:03", "10:00:00"], "clock text")
end sub
