import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

final class CatalogRowsTests: XCTestCase {
    func testTMDBRowsParseLeniently() throws {
        let rows = try CatalogRows.parse(Fixture.data("rows.json"))
        XCTAssertEqual(rows.source, "tmdb")
        XCTAssertTrue(rows.usesTMDB)
        XCTAssertEqual(rows.generated, utc(2026, 10, 19))
        XCTAssertEqual(rows.movie.popular.map(\.id), [693134, 414906, 194, 862], "bad items are skipped")
        let dune = rows.movie.popular[0]
        XCTAssertEqual(dune, RowsItem(id: 693134, title: "Dune: Part Two", originalTitle: "Dune: Part Two", year: "2024", origin: ["US"], lang: "en",
                                      genres: [878, 12], popularity: 321.5))
        XCTAssertEqual(rows.movie.popular[3].origin, ["US"], "a string origin is accepted")
        XCTAssertEqual(rows.movie.items(.featured).map(\.id), [414906])
        XCTAssertEqual(rows.movie.items(.topRated).map(\.id), [862])
        XCTAssertEqual(rows.movie.items(.service(.netflix)).map(\.id), [693134])
        XCTAssertEqual(rows.movie.items(.service(.disney)), [])
        XCTAssertEqual(rows.movie.items(.service(.hulu)), [], "missing lists are empty")
        XCTAssertEqual(rows.lists(.series).popular.map(\.title), ["The Last of Us", "Money Heist"])
        XCTAssertEqual(rows.genres(.movie).count, 11)
        XCTAssertEqual(rows.genres(.series).first, RowsGenre(id: 10759, name: "Action & Adventure"))
    }

    func testTheNoTMDBAnswerAndBadVersions() throws {
        let none = try CatalogRows.parse(Fixture.data("rows_none.json"))
        XCTAssertEqual(none.source, "none")
        XCTAssertFalse(none.usesTMDB)
        XCTAssertEqual(none, CatalogRows.none)
        let emptyTMDB = try CatalogRows.parse(Data(#"{"v":1,"source":"tmdb","movie":{"popular":[]}}"#.utf8))
        XCTAssertFalse(emptyTMDB.usesTMDB, "TMDB without any list is treated like none")
        for bad in [#"{"v":2,"source":"tmdb"}"#, #"{"source":"tmdb"}"#, "[]", "garbage", ""] {
            XCTAssertThrowsError(try CatalogRows.parse(Data(bad.utf8)), bad) { XCTAssertEqual($0 as? TunerError, .invalidResponse) }
        }
    }

    func testISODates() {
        XCTAssertEqual(CatalogRows.parseISODate("2026-10-19T00:00:00Z"), utc(2026, 10, 19))
        XCTAssertEqual(CatalogRows.parseISODate("2026-10-19T02:30:00.123+02:00"), utc(2026, 10, 19, 0, 30))
        XCTAssertEqual(CatalogRows.parseISODate("2026-10-19"), utc(2026, 10, 19))
        XCTAssertNil(CatalogRows.parseISODate("yesterday"))
    }
}

final class CatalogRowsServiceTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_842_400)

    func testCachesForTwelveHoursAndKeepsAStaleCopy() async throws {
        let directory = makeTemporaryDirectory(self)
        let failing = Shared(false)
        let unavailable = Shared(false)
        let body = Shared(Fixture.data("rows.json"))
        let http = StubHTTPClient { request in
            if failing.value { throw URLError(.timedOut) }
            if unavailable.value { return ok(request, Data(#"{"error":"unavailable"}"#.utf8), status: 503, headers: ["retry-after": "300"]) }
            return ok(request, body.value)
        }
        let clock = Shared(start)
        let service = CatalogRowsService(cacheDirectory: directory, http: http, now: { clock.value })
        let first = await service.rows()
        XCTAssertTrue(first.usesTMDB)
        XCTAssertEqual(http.requests.count, 1)
        let request = try XCTUnwrap(http.requests.first)
        XCTAssertEqual(request.url, TunerLinks.catalogRows)
        XCTAssertEqual(request.headers["User-Agent"], "LumaNestTuner/AppleTV")
        XCTAssertEqual(request.timeout, 15)
        _ = await service.rows()
        XCTAssertEqual(http.requests.count, 1, "served from memory")

        let stored = try JSONValue.parse(Data(contentsOf: directory.appendingPathComponent("rows.json")))
        XCTAssertEqual(stored["fetched"]?.int, Int(start.timeIntervalSince1970))
        XCTAssertEqual(stored["body"]?["source"]?.text, "tmdb")

        let reopened = CatalogRowsService(cacheDirectory: directory, http: http, now: { clock.value })
        _ = await reopened.rows()
        XCTAssertEqual(http.requests.count, 1, "served from disk")

        clock.value = start.addingTimeInterval(13 * 3600)
        failing.value = true
        let stale = await reopened.rows()
        XCTAssertTrue(stale.usesTMDB, "a failed refresh keeps the stale copy")
        XCTAssertEqual(http.requests.count, 2)

        failing.value = false
        body.value = Fixture.data("rows_none.json")
        let refreshed = await reopened.rows(force: true)
        XCTAssertEqual(refreshed.source, "none")

        body.value = Data(#"{"v":9}"#.utf8)
        let kept = await reopened.rows(force: true)
        XCTAssertEqual(kept.source, "none", "an unreadable answer doesn't replace what we have")

        // The server's "TMDB failed and I have no copy" answer is a 503: a failed request, never stored.
        unavailable.value = true
        body.value = Fixture.data("rows.json")
        let during503 = await reopened.rows(force: true)
        XCTAssertEqual(during503.source, "none")
        let stored503 = try JSONValue.parse(Data(contentsOf: directory.appendingPathComponent("rows.json")))
        XCTAssertEqual(stored503["body"]?["source"]?.text, "none")
        unavailable.value = false

        await reopened.clearCache()
        failing.value = true
        let nothing = await reopened.rows()
        XCTAssertEqual(nothing, .none)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("rows.json").path))
    }
}

final class TitleMatchingTests: XCTestCase {
    func testNormalizationFollowsTheEightSteps() {
        let cases: [(String, String)] = [
            ("The Batman (2022) [4K]", "batman"), ("Amélie", "amelie"), ("US - The Office", "office"), ("|US| Breaking Bad", "breaking bad"),
            ("Spider-Man: No Way Home (2021)", "spiderman no way home"), ("Fast & Furious 4K", "fast and furious"),
            ("IT - Gomorra", "it gomorra"), ("The", "the"), ("Movie 1080p HDR10", "movie"), ("4K: Planet Earth", "planet earth"),
            ("Pokémon: The Movie", "pokemon the movie"), ("Mission: Impossible – Dead Reckoning", "mission impossible dead reckoning"),
            ("Don't Look Up", "dont look up"), ("EN| Dune {Extended}", "dune"), ("  The   Matrix  ", "matrix"), ("Blade Runner 2049", "blade runner 2049"),
            ("In the Mood for Love", "in the mood for love"), ("LAT: El Hoyo (2019)", "el hoyo"),
        ]
        for (input, expected) in cases { XCTAssertEqual(TitleNormalizer.normalize(input), expected, input) }
    }

    func testYears() {
        XCTAssertEqual(TitleNormalizer.year(in: "The Batman (2022) [4K]"), "2022")
        XCTAssertEqual(TitleNormalizer.year(in: "Dune (2021)"), "2021")
        XCTAssertEqual(TitleNormalizer.year(in: "Show [2019]"), "2019")
        XCTAssertEqual(TitleNormalizer.year(in: "1917 (2019)"), "2019")
        XCTAssertNil(TitleNormalizer.year(in: "Blade Runner 2049"))
        XCTAssertNil(TitleNormalizer.year(in: "(2002) Remake"))
        XCTAssertNil(TitleNormalizer.year(in: "Film (1850)"))
        XCTAssertTrue(TitleNormalizer.yearsMatch("2021", "2022"))
        XCTAssertTrue(TitleNormalizer.yearsMatch("2021-05-01", "2021"))
        XCTAssertFalse(TitleNormalizer.yearsMatch("2021", "2023"))
        XCTAssertFalse(TitleNormalizer.yearsMatch(nil, "2021"))
        XCTAssertFalse(TitleNormalizer.yearsMatch("20xx", "2021"))
    }

    func testMatchingRules() {
        let movies = [
            movie("m:a", "Dune: Part Two (2024)", added: 10, tmdb: 693134), movie("m:b", "Dune Part Two", added: 20, year: "2024"),
            movie("m:c", "Old Upload", added: 1, tmdb: 5), movie("m:d", "New Upload", added: 9, tmdb: 5),
            movie("m:e", "The Batman", year: "2021"), movie("m:f", "The Batman (2004)"),
            movie("m:g", "Heat", added: 1, year: "1995"), movie("m:h", "Heat", added: 50, year: "1996"),
            movie("m:i", "Unique Film"), movie("m:t1", "Twin"), movie("m:t2", "Twin (1990)"),
        ]
        let shows = [series("s:1", "La Casa de Papel", year: "2017"), series("s:2", "The Last of Us (2023)", tmdb: 100088)]
        let rows = CatalogRows(source: "tmdb", movie: RowsLists(
            popular: [RowsItem(id: 693134, title: "Dune: Part Two", year: "2024"), RowsItem(id: 5, title: "Something"),
                      RowsItem(id: 414906, title: "The Batman", year: "2022"), RowsItem(id: 949, title: "Heat", year: "1995"),
                      RowsItem(id: 77, title: "Unique Film", year: "2020"), RowsItem(id: 78, title: "Twin", year: "2010"),
                      RowsItem(id: 693134, title: "Dune: Part Two", year: "2024")],
            featured: [RowsItem(id: 949, title: "Heat", year: "1995"), RowsItem(id: 999, title: "Not In Catalogue", year: "2020")],
            services: [.netflix: [RowsItem(id: 1, title: "Heat", year: "1996")]]),
            tv: RowsLists(popular: [RowsItem(id: 71446, title: "Money Heist", originalTitle: "La casa de papel", year: "2017"),
                                    RowsItem(id: 100088, title: "The Last of Us", year: "2023")]))
        let matches = TitleMatcher(movies: movies, series: shows).match(rows)
        XCTAssertEqual(matches.ids(.movie, .popular), ["m:a", "m:d", "m:e", "m:g", "m:i"], "TMDB order, each title once")
        XCTAssertEqual(matches.ids(.movie, .featured), ["m:g"])
        XCTAssertEqual(matches.ids(.movie, .service(.netflix)), ["m:h"], "smallest year difference wins")
        XCTAssertEqual(matches.items["m:g"]?.id, 949, "a title keeps the first item it matched")
        XCTAssertEqual(matches.items["m:a"]?.id, 693134)
        XCTAssertNil(matches.items["m:b"], "the TMDB id match beats the name match")
        XCTAssertNil(matches.items["m:f"], "years more than 1 apart never match")
        XCTAssertNil(matches.items["m:t1"], "a title without a year matches only when its name is unique")
        XCTAssertEqual(matches.ids(.series, .popular), ["s:1", "s:2"], "original titles count")
        XCTAssertEqual(matches.ids(.movie, .topRated), [])
    }
}

final class TitleRegionTests: XCTestCase {
    func testForeignCategoryNames() {
        for name in ["FR | Films", "|DE| Filme", "[IT] Film", "(ES) Peliculas", "LAT: Accion", "IN | Movies", "IT: Serie", "UK Comedy", "CA Movies",
                     "Hindi Movies", "Movies French", "Español", "Telugu Dubbed", "VOD - TR", "Latino", "Brazil", "NL - Kids", "- PT - Novelas"] {
            XCTAssertTrue(TitleRegion.isForeignCategory(name), name)
        }
        for name in ["Movies In Theaters", "Action", "Netflix Movies", "Kids", "Top IT Crowd Picks", "In Theaters", "Documentaries", "UKRAINE War",
                     "Canada Day Specials", "Arts & Culture", "Pinoy Classics", "Brain Games", "Ukulele"] {
            XCTAssertFalse(TitleRegion.isForeignCategory(name), name)
        }
    }

    func testUSAFilter() {
        let categories = ["fr": Category(id: "fr", name: "FR | Films"), "a": Category(id: "a", name: "Action")]
        XCTAssertTrue(TitleRegion.isUSA(match: RowsItem(id: 1, title: "A", origin: ["US", "GB"]), categoryIDs: ["a"], categoriesByID: categories))
        XCTAssertTrue(TitleRegion.isUSA(match: RowsItem(id: 1, title: "A", origin: ["us"]), categoryIDs: [], categoriesByID: categories))
        XCTAssertFalse(TitleRegion.isUSA(match: RowsItem(id: 1, title: "A", origin: ["US", "GB"]), categoryIDs: ["fr"], categoriesByID: categories),
                       "a US film filed in a foreign-language category is usually a dubbed copy")
        XCTAssertFalse(TitleRegion.isUSA(match: RowsItem(id: 1, title: "A", origin: ["FR"]), categoryIDs: ["a"], categoriesByID: categories))
        XCTAssertTrue(TitleRegion.isUSA(match: RowsItem(id: 1, title: "A", origin: []), categoryIDs: ["a"], categoriesByID: categories),
                      "an empty origin is unknown: the category decides")
        XCTAssertFalse(TitleRegion.isUSA(match: nil, categoryIDs: ["a", "fr"], categoriesByID: categories))
        XCTAssertTrue(TitleRegion.isUSA(match: nil, categoryIDs: ["a", "__tuner_movies"], categoriesByID: categories))
        XCTAssertFalse(TitleRegion.isUSA(match: RowsItem(id: 1, title: "A"), categoryIDs: ["fr"], categoriesByID: categories),
                       "a match without origins falls back to the category rule")
    }

    func testGenreMapping() throws {
        XCTAssertEqual(GenreMapping.split("Action & Adventure, Drama / Comedy|drama;  "), ["Action & Adventure", "Drama", "Comedy"])
        XCTAssertEqual(GenreMapping.split(nil), [])
        let rows = try CatalogRows.parse(Fixture.data("rows.json"))
        let movieGenres = rows.genres(.movie), tvGenres = rows.genres(.series)
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Sci-Fi", kind: .movie, genres: movieGenres), [878])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "sci-fi", kind: .series, genres: tvGenres), [10765])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "ACTION", kind: .movie, genres: movieGenres), [28])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Action", kind: .series, genres: tvGenres), [10759])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Fantasy", kind: .series, genres: tvGenres), [10765])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Kids", kind: .movie, genres: movieGenres), [10751])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Kids", kind: .series, genres: tvGenres), [10762])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Documentaries", kind: .movie, genres: movieGenres), [99])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "tv movie", kind: .movie, genres: movieGenres), [10770])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Musical", kind: .movie, genres: movieGenres), [10402])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "War", kind: .series, genres: tvGenres), [10768])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: "Western", kind: .movie, genres: movieGenres), [])
        XCTAssertEqual(GenreMapping.tmdbIDs(forProviderGenre: " ", kind: .movie, genres: movieGenres), [])
    }
}

final class BrowseIndexTests: XCTestCase {
    private let categories = [Category(id: "a", name: "Action"), Category(id: "n", name: "Netflix Movies"), Category(id: "fr", name: "FR | Films")]

    /// Films 1...25 (tmdb 1001...1025, years 2001..., added N), 21...25 in "Netflix Movies", plus two French titles.
    private func movieLibrary() -> MovieLibrary {
        var movies = (1...25).map { n in
            movie("m:\(n)", "Film \(n)", category: n > 20 ? "n" : "a", added: Int64(n), year: String(2000 + n), tmdb: 1000 + n,
                  rating: n % 10 == 0 ? nil : "\(n % 10).5", genre: n % 2 == 1 ? "Action" : "Drama")
        }
        movies.append(movie("m:fr", "Amélie (2001)", category: "fr", added: 0, tmdb: 194, rating: "9.9"))
        movies.append(movie("m:fr2", "Le Film", category: "fr", added: 0))
        return MovieLibrary(movies: movies, categories: categories, updated: Date())
    }

    private func seriesLibrary() -> SeriesLibrary {
        let shows = [series("s:1", "The Last of Us (2023)", category: "d", added: 5, tmdb: 100088, genre: "Drama"),
                     series("s:2", "Zorro", category: "d", added: 3), series("s:3", "Éclair Story", category: "d"),
                     series("s:4", "¡Ahí Viene!", category: "d", added: 1), series("s:5", "The Abyss Show", category: "d")]
        return SeriesLibrary(series: shows, categories: [Category(id: "d", name: "Drama")], updated: Date())
    }

    private func rows() -> CatalogRows {
        let popular = (1001...1025).map { RowsItem(id: $0, title: "Film \($0 - 1000)", origin: ["US"], genres: $0 == 1001 ? [28, 35] : []) }
            + [RowsItem(id: 194, title: "Amélie", year: "2001", origin: ["FR"])]
        return CatalogRows(source: "tmdb",
                           movie: RowsLists(popular: popular, featured: [1003, 1002, 1001].map { RowsItem(id: $0, title: "x", origin: ["US"]) },
                                            topRated: [1010, 1009].map { RowsItem(id: $0, title: "x", origin: ["US"]) },
                                            services: [.netflix: [RowsItem(id: 1001, title: "x", origin: ["US"])]]),
                           tv: RowsLists(popular: [RowsItem(id: 100088, title: "The Last of Us", year: "2023", origin: ["US"])]),
                           movieGenres: [RowsGenre(id: 28, name: "Action"), RowsGenre(id: 18, name: "Drama"), RowsGenre(id: 35, name: "Comedy")],
                           tvGenres: [RowsGenre(id: 18, name: "Drama")])
    }

    func testHomeRowsOrderLimitsAndSeeAll() {
        let index = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: rows(), usOnly: true, edition: .direct)
        XCTAssertTrue(index.usesTMDB)
        XCTAssertTrue(index.usOnly)
        let home = index.homeRows(library: .empty)
        XCTAssertEqual(home.map(\.id), ["popular.movie", "service.netflix.movie", "recent.movie", "top.movie"])
        XCTAssertEqual(home.map(\.title), ["Popular – Movies", "Netflix – Movies", "Recently added – Movies", "Top rated – Movies"])
        XCTAssertTrue(home.allSatisfy { $0.items.count <= BrowseIndex.homeRowLimit && $0.items.count >= BrowseIndex.homeRowMinimum })
        XCTAssertEqual(home[0].items.count, 20)
        XCTAssertEqual(home[0].items.prefix(3).map(\.id), ["m:1", "m:2", "m:3"])
        XCTAssertEqual(home[0].seeAll, .discover(DiscoverQuery(kind: .movie, list: .popular)))
        XCTAssertEqual(home[1].items.map(\.id), ["m:1", "m:25", "m:24", "m:23", "m:22", "m:21"], "TMDB matches, then the service's categories, newest first")
        XCTAssertEqual(home[2].items.first?.id, "m:25")
        XCTAssertEqual(home[3].items.prefix(3).map(\.id), ["m:10", "m:9", "m:19"], "TMDB top rated, then provider rating")
        XCTAssertEqual(home[0].items.first?.caption, "2001")
    }

    func testUSAFilterAndFallbacksWithoutTMDB() {
        let us = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: rows(), usOnly: true, edition: .direct)
        XCTAssertFalse(us.movies.contains { $0.id.hasPrefix("m:fr") }, "a French origin and a French category are both hidden")
        XCTAssertNil(us.movie(id: "m:fr"))
        let all = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: rows(), usOnly: false)
        XCTAssertEqual(all.movies.count, 27)
        XCTAssertEqual(all.discover(DiscoverQuery(kind: .movie, list: .popular), library: .empty).last?.id, "m:fr")
        XCTAssertEqual(all.tmdbItem(forTitleID: "m:fr")?.origin, ["FR"])

        let plain = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: .none, usOnly: true, edition: .direct)
        XCTAssertFalse(plain.usesTMDB)
        XCTAssertEqual(plain.homeRows(library: .empty).map(\.id), ["service.netflix.movie", "recent.movie", "top.movie"])
        XCTAssertEqual(plain.lists(for: .movie), [.topRated, .recentlyAdded, .az, .service(.netflix)])
        XCTAssertEqual(plain.discover(DiscoverQuery(kind: .movie, list: .popular), library: .empty), [])
        XCTAssertEqual(plain.discover(DiscoverQuery(kind: .movie, list: .topRated), library: .empty).prefix(2).map(\.id), ["m:9", "m:19"])
        XCTAssertFalse(plain.movies.contains { $0.id.hasPrefix("m:fr") })
        XCTAssertEqual(us.lists(for: .movie), [.popular, .featured, .topRated, .recentlyAdded, .az, .service(.netflix)])
        XCTAssertEqual(us.lists(for: .series), [.popular, .featured, .topRated, .recentlyAdded, .az])
        XCTAssertEqual(BrowseIndex.empty.homeRows(library: .empty), [])
    }

    func testTheAppStoreEditionNamesNoStreamingService() {
        XCTAssertEqual(Edition.current, .appStore)
        for endpoint in [rows(), CatalogRows.none] {
            let index = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: endpoint, usOnly: true)
            let home = index.homeRows(library: .empty)
            XCTAssertFalse(home.contains { $0.id.hasPrefix("service.") }, "no service rows on Home")
            for service in StreamingService.allCases {
                XCTAssertFalse(home.contains { $0.title.contains(service.displayName) }, "\(service.displayName) named on Home")
                for kind in TitleKind.allCases {
                    XCTAssertFalse(index.lists(for: kind).contains(.service(service)), "\(service) offered in Discover")
                    XCTAssertEqual(index.discover(DiscoverQuery(kind: kind, list: .service(service)), library: .empty), [])
                }
            }
        }
        let store = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: rows(), usOnly: true)
        XCTAssertEqual(store.homeRows(library: .empty).map(\.id), ["popular.movie", "recent.movie", "top.movie"])
        XCTAssertEqual(store.lists(for: .movie), [.popular, .featured, .topRated, .recentlyAdded, .az])
        XCTAssertEqual(BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: .none, usOnly: true).lists(for: .movie),
                       [.topRated, .recentlyAdded, .az])
    }

    func testDiscoverListsAndGenres() {
        let index = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: rows(), usOnly: true)
        XCTAssertEqual(index.discover(DiscoverQuery(kind: .movie, list: .featured), library: .empty).map(\.id), ["m:3", "m:2", "m:1"])
        XCTAssertEqual(index.discover(DiscoverQuery(kind: .movie, list: .popular), library: .empty).count, 25, "Discover is unlimited")
        XCTAssertEqual(index.discover(DiscoverQuery(kind: .series, list: .az), library: .empty).map(\.title.name),
                       ["The Abyss Show", "¡Ahí Viene!", "Éclair Story", "The Last of Us (2023)", "Zorro"])
        XCTAssertEqual(index.genres(for: .movie), [GenreOption(id: "tmdb:28", name: "Action"), GenreOption(id: "tmdb:35", name: "Comedy"),
                                                   GenreOption(id: "tmdb:18", name: "Drama")])
        XCTAssertEqual(index.discover(DiscoverQuery(kind: .movie, list: .az, genreID: "tmdb:35"), library: .empty).map(\.id), ["m:1"])
        XCTAssertEqual(index.discover(DiscoverQuery(kind: .movie, list: .recentlyAdded, genreID: "tmdb:18"), library: .empty).prefix(2).map(\.id),
                       ["m:24", "m:22"])
        let plain = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: .none, usOnly: false)
        XCTAssertEqual(plain.genres(for: .movie).map(\.id), ["name:action", "name:drama"])
        XCTAssertEqual(plain.discover(DiscoverQuery(kind: .movie, list: .az, genreID: "name:drama"), library: .empty).count, 12)
        XCTAssertEqual(BrowseList.az.title, "A–Z")
        XCTAssertEqual(BrowseList.service(.apple).title, "Apple TV+")
    }

    func testContinueWatchingUpNextAndLibrary() {
        let index = BrowseIndex(movies: movieLibrary(), series: seriesLibrary(), rows: rows(), usOnly: true)
        let date = Date(timeIntervalSince1970: 1_000)
        let recents = [
            RecentItem(id: "e:3", kind: .episode, title: "The Last of Us", subtitle: "S1 E3 · Long", seriesID: "s:1", season: 1, episode: 3,
                       positionMs: 600_000, durationMs: 3_000_000, updated: date),
            RecentItem(id: "m:2", kind: .movie, title: "Film 2", positionMs: 3_600_000, durationMs: 7_200_000, updated: date),
            RecentItem(id: "e:2", kind: .episode, title: "The Last of Us", seriesID: "s:1", season: 1, episode: 2, positionMs: 1, durationMs: 2, updated: date),
            RecentItem(id: "e:9", kind: .episode, title: "Zorro", seriesID: "s:2", season: 2, episode: 1, positionMs: 0, durationMs: 0, updated: date, upNext: true),
            RecentItem(id: "m:fr", kind: .movie, title: "Amélie", positionMs: 100_000, durationMs: 200_000, updated: date),
            RecentItem(id: "m:gone", kind: .movie, title: "Gone", positionMs: 100_000, durationMs: 200_000, updated: date),
        ]
        let library = LibrarySnapshot(favoriteTitles: ["m:2", "s:1", "m:gone"], recents: recents,
                                      history: [HistoryEntry(titleID: "s:2", kind: .series, updated: date), HistoryEntry(titleID: "m:1", kind: .movie, updated: date),
                                                HistoryEntry(titleID: "m:gone", kind: .movie, updated: date), HistoryEntry(titleID: "m:1", kind: .movie, updated: date)])
        let continuing = index.continueWatching(library)
        XCTAssertEqual(continuing.map(\.id), ["s:1", "m:2", "s:2"])
        XCTAssertEqual(continuing.map(\.caption), ["S1 E3 · 40 min left", "1 hr left", "Up next · S2 E1"])
        XCTAssertEqual(continuing[0].progress ?? 0, 0.2, accuracy: 0.0001)
        XCTAssertNil(continuing[2].progress)
        XCTAssertEqual(continuing[0].resume?.id, "e:3")
        XCTAssertEqual(continuing.map(\.inLibrary), [true, true, false])
        XCTAssertFalse(index.homeRows(library: library).contains { $0.id == "continue" }, "fewer than 5 titles")

        let sections = index.library(library)
        XCTAssertEqual(sections.continueWatching.map(\.id), ["s:1", "m:2", "s:2"])
        XCTAssertEqual(sections.favoriteMovies.map(\.id), ["m:2"])
        XCTAssertEqual(sections.favoriteSeries.map(\.id), ["s:1"])
        XCTAssertEqual(sections.recentlyWatched.map(\.id), ["s:2", "m:1"])
        XCTAssertFalse(sections.isEmpty)
        XCTAssertTrue(index.library(.empty).isEmpty)

        let posters = index.discover(DiscoverQuery(kind: .movie, list: .az), library: library)
        let film2 = posters.first { $0.id == "m:2" }
        XCTAssertEqual(film2?.progress, 0.5)
        XCTAssertEqual(film2?.inLibrary, true)

        let five = (1...5).map { RecentItem(id: "m:\($0)", kind: .movie, title: "Film \($0)", positionMs: 60_000, durationMs: 600_000, updated: date) }
        let home = index.homeRows(library: LibrarySnapshot(recents: five))
        XCTAssertEqual(home.first?.id, "continue")
        XCTAssertEqual(home.first?.title, "Continue watching")
        XCTAssertEqual(home.first?.seeAll, .library)
    }

    func testSeriesNavigation() {
        let info = SeriesInfo(seasons: [0: [episode("e:0", season: 0, number: 1)],
                                        1: [episode("e:1", season: 1, number: 1), episode("e:2", season: 1, number: 2, ext: "mkv"), episode("e:3", season: 1, number: 3)],
                                        2: [episode("e:4", season: 2, number: 1)]])
        let recent = { (id: String, series: String?) in
            RecentItem(id: id, kind: .episode, title: "S", seriesID: series, positionMs: 1, durationMs: 2, updated: Date())
        }
        XCTAssertEqual(SeriesNavigation.defaultSeason(info, returningTo: "e:4", recents: [recent("e:1", "s:1")]), 2)
        XCTAssertEqual(SeriesNavigation.defaultSeason(info, returningTo: nil, recents: [recent("e:x", "s:1"), recent("e:2", "s:1")]), 1)
        XCTAssertEqual(SeriesNavigation.defaultSeason(info, returningTo: nil, recents: []), 1)
        XCTAssertEqual(SeriesNavigation.defaultSeason(SeriesInfo(seasons: [0: [episode("e:0", season: 0, number: 1)]]), returningTo: nil, recents: []), 0)
        XCTAssertNil(SeriesNavigation.defaultSeason(SeriesInfo(), returningTo: nil, recents: []))

        let point = SeriesNavigation.resumePoint(info, seriesID: "s:1", recents: [recent("e:3", "s:9"), recent("e:x", "s:1"), recent("e:3", "s:1"), recent("e:1", "s:1")])
        XCTAssertEqual(point?.episode.id, "e:3")
        XCTAssertEqual(point?.recent.seriesID, "s:1")
        XCTAssertNil(SeriesNavigation.resumePoint(info, seriesID: "s:1", recents: []))

        XCTAssertEqual(SeriesNavigation.firstEpisode(info)?.id, "e:1")
        let onlySpecialsPlayable = SeriesInfo(seasons: [0: [episode("e:0", season: 0, number: 1)], 1: [episode("e:1", season: 1, number: 1, ext: "mkv")]])
        XCTAssertEqual(SeriesNavigation.firstEpisode(onlySpecialsPlayable)?.id, "e:0")
        XCTAssertEqual(SeriesNavigation.queue(after: episode("e:1", season: 1, number: 1), in: info).map(\.id), ["e:3", "e:4"], "unplayable episodes are skipped")
        XCTAssertEqual(SeriesNavigation.queue(after: episode("e:0", season: 0, number: 1), in: info, limit: 1).map(\.id), ["e:1"])
        XCTAssertEqual(SeriesNavigation.queue(after: episode("e:4", season: 2, number: 1), in: info), [])
        XCTAssertEqual(SeriesNavigation.queue(after: episode("e:zz", season: 9, number: 9), in: info), [])
        XCTAssertEqual(SeriesNavigation.label(episode("e:3", season: 1, number: 3)), "S1 E3 · Episode 3")
    }

    func testResumePolicy() {
        XCTAssertEqual(ResumePolicy.decide(positionMs: 10_000, durationMs: 100_000), .ignore)
        XCTAssertEqual(ResumePolicy.decide(positionMs: 15_000, durationMs: 100_000), .ignore)
        XCTAssertEqual(ResumePolicy.decide(positionMs: 16_000, durationMs: 100_000), .save)
        XCTAssertEqual(ResumePolicy.decide(positionMs: 95_000, durationMs: 100_000), .save)
        XCTAssertEqual(ResumePolicy.decide(positionMs: 95_001, durationMs: 100_000), .remove)
        XCTAssertEqual(ResumePolicy.decide(positionMs: 20_000, durationMs: 0), .save)
        XCTAssertEqual(ResumePolicy.decide(positionMs: 0, durationMs: 0), .ignore)
    }

    func testRecentProgressAndTitleIDs() {
        let date = Date()
        XCTAssertEqual(RecentItem(id: "m:1", kind: .movie, title: "A", positionMs: 50, durationMs: 100, updated: date).progress, 0.5)
        XCTAssertEqual(RecentItem(id: "m:1", kind: .movie, title: "A", positionMs: 500, durationMs: 100, updated: date).progress, 1)
        XCTAssertNil(RecentItem(id: "m:1", kind: .movie, title: "A", positionMs: 50, durationMs: 0, updated: date).progress)
        XCTAssertEqual(RecentItem(id: "m:1", kind: .movie, title: "A", positionMs: 0, durationMs: 0, updated: date).titleID, "m:1")
        XCTAssertEqual(RecentItem(id: "e:1", kind: .episode, title: "A", seriesID: "s:9", positionMs: 0, durationMs: 0, updated: date).titleID, "s:9")
        XCTAssertEqual(TitleKind.movie.plural, "Movies")
        XCTAssertEqual(TitleKind.series.plural, "Series")
    }
}

final class CatalogSearchTests: XCTestCase {
    private let lineup = LiveLineup(channels: [channel("1", "CNN", number: 1), channel("2", "ESPN", number: 2), channel("12", "Channel 12 News", number: 12),
                                               channel("21", "Discovery", number: 21), channel("112", "FOX 5", number: 112), channel("3", "Récit TV", number: 3)],
                                    categories: [], updated: Date())

    private func index(usOnly: Bool) -> BrowseIndex {
        var movies = (1...45).map { movie("m:\($0)", "Film \($0)") }
        movies.append(movie("m:fr", "Amélie", category: "fr"))
        movies.append(movie("m:x", "My Film Night"))
        return BrowseIndex(movies: MovieLibrary(movies: movies, categories: [Category(id: "fr", name: "FR | Films")], updated: Date()),
                           series: SeriesLibrary(series: [series("s:1", "Filmmakers"), series("s:2", "News Hour")], categories: [], updated: Date()),
                           rows: .none, usOnly: usOnly)
    }

    func testChannelsByNumberAndName() {
        let results = CatalogSearch.run("12", lineup: lineup, index: index(usOnly: true), library: .empty)
        XCTAssertEqual(results.channels.map(\.key), ["12", "112"], "the exact number first")
        XCTAssertEqual(CatalogSearch.run("1", lineup: lineup, index: index(usOnly: true), library: .empty).channels.first?.key, "1", "digits search from one character")
        XCTAssertTrue(CatalogSearch.run("c", lineup: lineup, index: index(usOnly: true), library: .empty).isEmpty)
        XCTAssertTrue(CatalogSearch.run("   ", lineup: lineup, index: index(usOnly: true), library: .empty).isEmpty)
        XCTAssertEqual(CatalogSearch.run("news", lineup: lineup, index: index(usOnly: true), library: .empty).channels.map(\.key), ["12"])
        XCTAssertEqual(CatalogSearch.run("CN", lineup: lineup, index: index(usOnly: true), library: .empty).channels.map(\.key), ["1"])
        XCTAssertEqual(CatalogSearch.run("recit", lineup: lineup, index: index(usOnly: true), library: .empty).channels.map(\.key), ["3"], "diacritics ignored")
        XCTAssertEqual(CatalogSearch.run("news", lineup: nil, index: index(usOnly: true), library: .empty).channels, [])
    }

    func testTitlesStartsFirstLimitedAndFiltered() {
        let results = CatalogSearch.run("film", lineup: lineup, index: index(usOnly: true), library: .empty)
        XCTAssertEqual(results.movies.count, 40)
        XCTAssertEqual(results.movies.first?.id, "m:1")
        XCTAssertFalse(results.movies.contains { $0.id == "m:x" }, "names that start with the query fill the 40 first")
        XCTAssertEqual(results.series.map(\.id), ["s:1"])
        XCTAssertEqual(CatalogSearch.run("night", lineup: nil, index: index(usOnly: true), library: .empty).movies.map(\.id), ["m:x"])
        XCTAssertTrue(CatalogSearch.run("amelie", lineup: nil, index: index(usOnly: true), library: .empty).movies.isEmpty, "the USA filter applies")
        XCTAssertEqual(CatalogSearch.run("AMÉLIE", lineup: nil, index: index(usOnly: false), library: .empty).movies.map(\.id), ["m:fr"])
    }
}
