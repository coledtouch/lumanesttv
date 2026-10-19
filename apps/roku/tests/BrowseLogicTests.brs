' Unit tests for source/lib/BrowseLogic.brs (docs/browse.md). They run on a Roku in the test package
' (npm run build:tests, see apps/roku/README.md) and print every failure to the debug console.

function runBrowseLogicTests() as object
    t = {passed: 0, failed: 0, failures: []}
    rx = browseRx()
    testNormalizeTitle(t, rx)
    testYears(t, rx)
    testProviderTmdbId(t, rx)
    testUsaCategoryFilter(t, rx)
    testAdultNames(t, rx)
    testCategoryServices(t, rx)
    testRowsPayload(t)
    testCacheAge(t)
    testMatching(t, rx)
    testGenres(t, rx)
    testBuildTitleSection(t, rx)
    testUnknownOrigin(t, rx)
    testCategoryGenres(t, rx)
    testPickTitles(t, rx)
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

sub testNormalizeTitle(t as object, rx as object)
    expectEqual(t, normalizeTitle("The Matrix (1999)", rx), "matrix", "trailing year and leading the")
    expectEqual(t, normalizeTitle("|US| Dune: Part Two [4K]", rx), "dune part two", "pipe and bracket tags")
    expectEqual(t, normalizeTitle("US - Fast & Furious 7 HD", rx), "fast and furious 7", "prefix, & and quality word")
    expectEqual(t, normalizeTitle("EN| Spider-Man: No Way Home (2021) UHD", rx), "spider man no way home", "punctuation becomes spaces")
    expectEqual(t, normalizeTitle("Ocean's Eleven", rx), "oceans eleven", "apostrophes are dropped")
    expectEqual(t, normalizeTitle("The Office (US)", rx), "office", "short parenthesised tag")
    expectEqual(t, normalizeTitle("Amélie", rx), "amelie", "accents folded")
    expectEqual(t, normalizeTitle("  Blade   Runner 2049  ", rx), "blade runner 2049", "years inside the title stay")
    expectEqual(t, normalizeTitle("The", rx), "the", "a lone 'the' stays")
    expectEqual(t, normalizeTitle("WALL-E", rx), "wall e", "hyphenated title is not a prefix")
    expectEqual(t, normalizeTitle("X-MEN: APOCALYPSE", rx), "x men apocalypse", "upper-case title with a colon keeps its first word")
    expectEqual(t, normalizeTitle("4K | NF | Stranger Things - EN", rx), "stranger things", "stacked prefixes and suffix")
    expectEqual(t, normalizeTitle("Mission: Impossible – Dead Reckoning", rx), "mission impossible dead reckoning", "dashes and colons")
    expectEqual(t, normalizeTitle("", rx), "", "empty title")
end sub

sub testYears(t as object, rx as object)
    expectEqual(t, titleYearOf("Dune (2021)", rx), "2021", "year in parentheses")
    expectEqual(t, titleYearOf("Dune [2021] [4K]", rx), "2021", "year in brackets")
    expectEqual(t, titleYearOf("Blade Runner 2049", rx), "", "bare number is not a year")
    expectEqual(t, yearOfText("2021-05-01", rx), "2021", "release date")
    expectEqual(t, yearOfText(1999, rx), "1999", "numeric year")
    expectEqual(t, yearOfText(invalid, rx), "", "missing year")
    title = titleFromXtream("movie", movieRow("7", "Heat (1995)", "1", {}), rx)
    expectEqual(t, title.year, "1995", "year taken from the name when the row has none")
    title = titleFromXtream("series", {series_id: 9, name: "Show", category_id: "2", releaseDate: "2019-01-02", last_modified: "1700000000", rating: "8.1", cover: "c.jpg"}, rx)
    expectEqual(t, [title.key, title.id, title.year, title.added, title.icon, title.rating], ["s9", "9", "2019", 1700000000, "c.jpg", 8.1], "series row")
    title = titleFromXtream("movie", movieRow("12", "EN| Heat", "3", {added: "1700000123", rating_5based: "4", tmdb: "949", container_extension: ""}), rx)
    expectEqual(t, [title.key, title.cat, title.ext, title.added, title.rating, title.hint, title.year], ["m12", "3", "mp4", 1700000123, 8, "949", ""], "movie row")
    expectEqual(t, titleFromXtream("movie", {name: "No id"}, rx), invalid, "a row without an id")
end sub

sub testProviderTmdbId(t as object, rx as object)
    expectEqual(t, providerTmdbId({tmdb: "603"}, rx), "603", "tmdb field")
    expectEqual(t, providerTmdbId({tmdb_id: 603}, rx), "603", "numeric tmdb_id")
    expectEqual(t, providerTmdbId({info: {tmdb_id: "603"}}, rx), "603", "tmdb_id inside info")
    expectEqual(t, providerTmdbId({tmdb: "0"}, rx), "", "zero is no id")
    expectEqual(t, providerTmdbId({tmdb: "tt0133093"}, rx), "", "IMDb ids are ignored")
end sub

sub testUsaCategoryFilter(t as object, rx as object)
    for each name in ["FR | Films", "|DE| Action", "IT: Serie TV", "LAT - Peliculas", "MX Novelas", "BR: Filmes", "TR | Diziler", "AR | Movies", "IN | Bollywood", "HINDI MOVIES", "PK Dramas", "NL Films", "PL | Filmy", "RO: Filme", "RU Kino", "UK | Drama", "CA | Movies", "PT | Filmes", "ES | Cine", "Peliculas Latino", "French Movies", "Arabic Series", "Movies (Spanish)", "|IT| Film", "Movies (IN)", "Serie IT", "IN-Movies", "Films – IT", "ITALIANO", "Cine Castellano", "Tamil Movies", "TELUGU HD", "Malayalam", "Quebec Films", "ARAB MOVIES"]
        expectTrue(t, isForeignCategory(name, rx), "foreign category " + name)
    end for
    ' All-caps IN and IT are English words unless they stand as a tag.
    for each name in ["Movies in 4K", "MOVIES IN 4K", "NEW IN CINEMAS", "WATCH IT ALL", "NETFLIX MOVIES", "US | Action", "EN | Comedy", "Kids", "4K UHD", "Documentaries", "Free Movies", "Canalplus", "Drama", "Adventure", "Top Picks", "INDIE FILMS", "IT CHAPTER TWO", ""]
        if name = "IT CHAPTER TWO"
            ' At the start of the name IT counts as a tag, as on Android.
            expectTrue(t, isForeignCategory(name, rx), "leading IT is a tag " + name)
        else
            expectFalse(t, isForeignCategory(name, rx), "US category " + name)
        end if
    end for
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
    expectEqual(t, namesOf(section, pickTitles(items, section.lists.popular, usOnly, 0, 20).picked), ["Dune (2021)", "Oppenheimer (2023)"], "Popular keeps movies whose origin is not known yet")
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
    expectEqual(t, items[0].DoesExist("hint") or items[0].DoesExist("genre") or items[0].DoesExist("cat") or items[0].DoesExist("added"), false, "index-only fields are dropped")
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
    expectEqual(t, namesOf(section, pickTitles(section.items, section.lists.popular, usOnly, 0, 20).picked), ["Dune (2021)"], "USA only keeps the US copy once")
    everything = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section.items, section.lists.popular, everything, 0, 20).picked), ["Dune (2021)", "Amélie (2001)"], "All shows each TMDB title once")
    unlocked = {usOnly: false, adultOk: true, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section.items, section.lists.recent, unlocked, 0, 2).picked), ["Hot Stuff", "Le Film Local"], "adult titles only when unlocked")
    locked = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section.items, section.lists.recent, locked, 0, 20).picked), ["Le Film Local", "Dune (2021) [FR]", "Glass Onion", "Amélie (2001)", "The Avengers"], "adult titles hidden when locked")
    genre = {usOnly: true, adultOk: false, genre: "878", seen: {}}
    expectEqual(t, namesOf(section, pickTitles(section.items, section.lists.az, genre, 0, 20).picked), ["The Avengers", "Dune (2021)"], "genre filter")
    paging = {usOnly: false, adultOk: true, genre: "", seen: {}}
    first = pickTitles(section.items, section.lists.az, paging, 0, 3)
    second = pickTitles(section.items, section.lists.az, paging, first.cursor, 3)
    expectEqual(t, [namesOf(section, first.picked), namesOf(section, second.picked), second.cursor], [["Amélie (2001)", "The Avengers", "Cartoon Time"], ["Dune (2021)", "Glass Onion", "Hot Stuff"], 7], "pages continue from the cursor and skip a TMDB title already shown")
    expectEqual(t, pickTitles(section.items, invalid, paging, 0, 3).picked, [], "a missing list is empty")
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
    expectEqual(t, namesOf(section, searchTitles(section.items, "dune", opts, 10)), ["Dune (2021)"], "one result per TMDB title")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section.items, "on", opts, 10)), ["Glass Onion"], "names containing the text")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section.items, "t", opts, 10)), [], "at least 2 letters")
    opts = {usOnly: true, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section.items, "le", opts, 10)), [], "USA only applies to search")
    opts = {usOnly: false, adultOk: false, genre: "", seen: {}}
    expectEqual(t, namesOf(section, searchTitles(section.items, "the", opts, 10)), ["The Avengers"], "names starting with the text come first")
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
