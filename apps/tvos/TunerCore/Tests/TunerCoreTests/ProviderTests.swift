import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

final class XtreamURLTests: XCTestCase {
    func testServerNormalization() {
        XCTAssertEqual(Xtream.normalizeServer(" h.com:80/player_api.php "), "http://h.com:80")
        XCTAssertEqual(Xtream.normalizeServer("https://Line.Example.com:8443/"), "https://Line.Example.com:8443")
        XCTAssertEqual(Xtream.normalizeServer("http://x.com/get.php?username=a&password=b"), "http://x.com")
        XCTAssertEqual(Xtream.normalizeServer("x.com/panel/xmltv.php?username=a"), "http://x.com/panel")
        XCTAssertEqual(Xtream.normalizeServer("HTTP://x.com//"), "HTTP://x.com")
        XCTAssertEqual(Xtream.normalizeServer("   "), "")
    }

    func testGetPhpLinksBecomeServerLogins() {
        let login = Xtream.login(fromGetPhp: "http://iptv.example.com:8080/get.php?username=bob&password=s3cret&type=m3u_plus&output=ts")
        XCTAssertEqual(login, XtreamLogin(server: "http://iptv.example.com:8080", username: "bob", password: "s3cret"))
        // Form encoding: "+" is a space, "%2B" a plus, "%40" an at sign.
        XCTAssertEqual(Xtream.login(fromGetPhp: " https://h.example.com/get.php?USERNAME=a%40b&password=p%2Bq+r "),
                       XtreamLogin(server: "https://h.example.com", username: "a@b", password: "p+q r"))
        XCTAssertNil(Xtream.login(fromGetPhp: "http://h.example.com/get.php?username=bob"))
        XCTAssertNil(Xtream.login(fromGetPhp: "http://h.example.com/playlist.m3u?username=a&password=b"))
        XCTAssertNil(Xtream.login(fromGetPhp: "ftp://h.example.com/get.php?username=a&password=b"))
        XCTAssertNil(Xtream.login(fromGetPhp: "https://tv.lumanest.tv/m3u?u=a&p=b"))
    }

    func testAPIAndGuideURLsAreFormEncoded() {
        XCTAssertEqual(Xtream.apiURL(demoLogin)?.absoluteString,
                       "http://line.example.com:8080/player_api.php?username=demo&password=s3cret+pass")
        XCTAssertEqual(Xtream.apiURL(demoLogin, action: "get_vod_info", extra: [("vod_id", "900")])?.absoluteString,
                       "http://line.example.com:8080/player_api.php?username=demo&password=s3cret+pass&action=get_vod_info&vod_id=900")
        let odd = XtreamLogin(server: "line.example.com/player_api.php", username: "a&b", password: "p=1/é")
        XCTAssertEqual(Xtream.apiURL(odd)?.absoluteString, "http://line.example.com/player_api.php?username=a%26b&password=p%3D1%2F%C3%A9")
        XCTAssertEqual(Xtream.guideURL(demoLogin)?.absoluteString, "http://line.example.com:8080/xmltv.php?username=demo&password=s3cret+pass")
        XCTAssertNil(Xtream.apiURL(XtreamLogin(server: " ", username: "a", password: "b")))
        XCTAssertNil(Xtream.guideURL(XtreamLogin(server: "", username: "a", password: "b")))
    }

    func testStreamURLs() {
        XCTAssertEqual(Xtream.liveURL(demoLogin, streamID: "101")?.absoluteString, "http://line.example.com:8080/live/demo/s3cret%20pass/101.ts")
        XCTAssertEqual(Xtream.liveURL(demoLogin, streamID: "112", directSource: "http://cdn.example.com/live/d/p/112.m3u8?token=abc")?.absoluteString,
                       "http://cdn.example.com/live/d/p/112.ts?token=abc")
        XCTAssertEqual(Xtream.liveURL(demoLogin, streamID: "7", directSource: "https://cdn.example.com/live/7")?.absoluteString,
                       "https://cdn.example.com/live/7")
        XCTAssertEqual(Xtream.liveURL(demoLogin, streamID: "7", directSource: "rtmp://cdn.example.com/live/7")?.absoluteString,
                       "http://line.example.com:8080/live/demo/s3cret%20pass/7.ts")
        XCTAssertEqual(Xtream.movieURL(demoLogin, streamID: "900", containerExtension: "MKV")?.absoluteString,
                       "http://line.example.com:8080/movie/demo/s3cret%20pass/900.mkv")
        XCTAssertEqual(Xtream.movieURL(demoLogin, streamID: "900", containerExtension: nil)?.absoluteString,
                       "http://line.example.com:8080/movie/demo/s3cret%20pass/900.mp4")
        XCTAssertEqual(Xtream.movieURL(demoLogin, streamID: "900", containerExtension: "m p4")?.absoluteString,
                       "http://line.example.com:8080/movie/demo/s3cret%20pass/900.mp4")
        XCTAssertEqual(Xtream.movieURL(demoLogin, streamID: "1", containerExtension: "mp4", directSource: "https://vod.example.com/a b.mp4")?.absoluteString,
                       "https://vod.example.com/a%20b.mp4")
        XCTAssertEqual(Xtream.episodeURL(demoLogin, episodeID: "5010", containerExtension: ".mp4")?.absoluteString,
                       "http://line.example.com:8080/series/demo/s3cret%20pass/5010.mp4")
        let slashes = XtreamLogin(server: "h.example.com", username: "a/b", password: "p@ss?")
        XCTAssertEqual(Xtream.liveURL(slashes, streamID: "1")?.absoluteString, "http://h.example.com/live/a%2Fb/p%40ss%3F/1.ts")
        XCTAssertNil(Xtream.liveURL(XtreamLogin(server: "", username: "a", password: "b"), streamID: "1"))
        XCTAssertNil(Xtream.liveURL(demoLogin, streamID: ""))
    }
}

final class XtreamParserTests: XCTestCase {
    func testAccountInfo() throws {
        let info = try XtreamParser.accountInfo(Fixture.data("xtream/account.json"))
        XCTAssertTrue(info.authorized)
        XCTAssertEqual(info.status, "Active")
        XCTAssertEqual(info.expires, Date(timeIntervalSince1970: 1_804_161_600))
        XCTAssertEqual(info.maxConnections, 1)
        XCTAssertEqual(info.activeConnections, 0)
        XCTAssertEqual(info.summary, "Connected · Active · expires Mar 4, 2027 · 1 connection")
        XCTAssertEqual(XtreamAccountInfo(authorized: true, maxConnections: 2).summary, "Connected · 2 connections")
        XCTAssertFalse(try XtreamParser.accountInfo(Fixture.data("xtream/account_denied.json")).authorized)
        XCTAssertFalse(try XtreamParser.accountInfo(Data("[]".utf8)).authorized)
        XCTAssertFalse(try XtreamParser.accountInfo(Data("{}".utf8)).authorized)
        XCTAssertThrowsError(try XtreamParser.accountInfo(Data("<html>".utf8)))
    }

    func testCategoriesFromArraysOrObjects() throws {
        let live = try XtreamParser.categories(Fixture.data("xtream/live_categories.json"))
        XCTAssertEqual(live.map(\.id), ["1", "2", "3", "4", "5", "6", "7", "8"])
        XCTAssertEqual(live[0].name, "USA | News")
        XCTAssertEqual(live[7].name, "Other")
        XCTAssertEqual(live.filter(\.adult).map(\.id), ["6"])
        let vod = try XtreamParser.categories(Fixture.data("xtream/vod_categories.json"))
        XCTAssertEqual(vod.map(\.id), ["20", "21", "22", "23", "24"], "object roots keep numeric key order")
        XCTAssertEqual(try XtreamParser.categories(Data("null".utf8)), [])
        XCTAssertThrowsError(try XtreamParser.categories(Data("not json".utf8)))
    }

    func testLiveStreams() throws {
        let channels = try XtreamParser.live(Fixture.data("xtream/live_streams.json"), login: demoLogin)
        XCTAssertEqual(channels.map(\.key), (101...113).map { "x:\($0)" })
        XCTAssertEqual(channels.map(\.number), Array(1...13))
        let cnn = channels[0]
        XCTAssertEqual(cnn.name, "US: CNN HD")
        XCTAssertEqual(cnn.streamID, "101")
        XCTAssertEqual(cnn.epgID, "CNN.us")
        XCTAssertEqual(cnn.logo?.absoluteString, "http://logos.example.com/cnn.png")
        XCTAssertEqual(cnn.url.absoluteString, "http://line.example.com:8080/live/demo/s3cret%20pass/101.ts")
        XCTAssertEqual(cnn.categoryIDs, ["1"])
        XCTAssertNil(channels[1].logo)
        XCTAssertNil(channels[1].epgID)
        // Duplicate rows merge: categories unioned ("2.0" → "2"), metadata joined, provider order kept.
        let espn = channels[2]
        XCTAssertEqual(espn.categoryIDs, ["2", "1", "8"])
        XCTAssertEqual(espn.categoryID, "2")
        XCTAssertEqual(espn.country, "USA")
        XCTAssertEqual(channels[3].country, "GB")
        XCTAssertNil(channels[4].epgID, "blank epg ids are nil")
        XCTAssertTrue(channels[8].adult)
        XCTAssertFalse(channels[0].adult)
        XCTAssertEqual(channels[11].url.absoluteString, "http://cdn.example.com/live/demo/s3cret/112.ts?token=abc")
    }

    func testRenumbering() {
        XCTAssertEqual(Renumber.numbers([5, 3, 9]), [5, 3, 9])
        XCTAssertEqual(Renumber.numbers([1, 1, 1, 2]), [1, 2, 3, 4], "mostly duplicate numbers are replaced")
        XCTAssertEqual(Renumber.numbers([nil, 2, 3]), [1, 2, 3], "missing numbers are replaced")
        XCTAssertEqual(Renumber.numbers(Array(1...19).map { Optional($0) } + [nil]), Array(1...20).map { $0 <= 19 ? $0 : 0 })
        XCTAssertEqual(Renumber.numbers([]), [])
        let shuffled = [channel("a", "A", number: 30), channel("b", "B", number: 10), channel("c", "C", number: 20)]
        XCTAssertEqual(Renumber.apply(shuffled).map(\.key), ["b", "c", "a"], "kept provider numbers sort the lineup")
        let unnumbered = [channel("a", "A"), channel("b", "B")]
        XCTAssertEqual(Renumber.apply(unnumbered).map(\.number), [1, 2])
    }

    func testMoviesReadYearTMDBGenreAndMergeDuplicates() throws {
        let movies = try XtreamParser.movies(Fixture.data("xtream/vod_streams.json"), login: demoLogin)
        XCTAssertEqual(movies.map(\.id), (900...909).map { "m:\($0)" })
        let dune = movies[0]
        XCTAssertEqual(dune.year, "2024")
        XCTAssertEqual(dune.tmdbID, 693134)
        XCTAssertEqual(dune.genre, "Science Fiction, Adventure")
        XCTAssertEqual(dune.rating, "8.2")
        XCTAssertEqual(dune.added, 1_710_000_000)
        XCTAssertEqual(dune.categoryIDs, ["20", "21", "24"])
        XCTAssertEqual(dune.containerExtension, "mp4")
        XCTAssertEqual(dune.url.absoluteString, "http://line.example.com:8080/movie/demo/s3cret%20pass/900.mp4")
        XCTAssertNil(movies[1].rating, "\"0\" is no rating")
        XCTAssertNil(movies[1].poster)
        XCTAssertEqual(movies[1].year, "2024", "year from the name")
        XCTAssertEqual(movies[1].containerExtension, "mkv")
        XCTAssertEqual(movies[2].year, "2022")
        XCTAssertEqual(movies[2].tmdbID, 414906)
        XCTAssertEqual(movies[2].rating, "7.8")
        XCTAssertEqual(movies[3].year, "2001")
        XCTAssertNil(movies[3].rating)
        XCTAssertTrue(movies[5].adult)
        XCTAssertEqual(movies[8].rating, "7.9")
        XCTAssertEqual(movies[8].url.absoluteString, "https://vod.example.com/toy-story.m4v")
        XCTAssertEqual(movies[8].containerExtension, "m4v")
    }

    /// docs/browse.md "Trimming": provider fields lose spaces and the Unicode spaces at their ends, nothing else.
    /// Foundation's `.whitespacesAndNewlines` also removes U+200B, which turned "\u{200B} - 1999" into "- 1999".
    func testProviderFieldsAreTrimmedOfSpacesOnly() throws {
        // JSON with every character outside printable ASCII written as a \u escape, as providers send them.
        func json(_ text: String) -> String {
            let units = text.utf16.map { unit in
                unit >= 0x20 && unit < 0x7F && unit != 0x22 && unit != 0x5C ? String(UnicodeScalar(UInt8(unit))) : String(format: "\\u%04x", unit)
            }
            return "\"" + units.joined() + "\""
        }
        let rows = "[" + [
            #"{"stream_id":1,"name":\#(json("\u{200B} - 1999")),"category_id":\#(json("\u{3000} 7 \u{0085}"))}"#,
            #"{"stream_id":2,"name":\#(json("\u{001F} - 1999 \t")),"category_id":"7"}"#,
            #"{"stream_id":3,"name":\#(json("\u{3000}\u{FEFF}Heat - 1995\u{2028}\u{00A0}")),"category_id":"7"}"#,
            #"{"stream_id":4,"name":[\#(json("\u{2003}")),\#(json("\u{180E}Dune "))],"category_id":"7"}"#,
        ].joined(separator: ",") + "]"
        let movies = try XtreamParser.movies(Data(rows.utf8), login: demoLogin)
        XCTAssertEqual(movies.map(\.name), ["\u{200B} - 1999", "\u{001F} - 1999", "Heat - 1995", "\u{180E}Dune"])
        XCTAssertEqual(movies.map(\.year), ["1999", "1999", "1995", nil])
        XCTAssertEqual(movies.map { TitleNormalizer.normalize($0.name) }, ["", "", "heat", "dune"])
        XCTAssertEqual(movies[0].categoryIDs, ["7"])
        let categories = try XtreamParser.categories(Data(("[" + #"{"category_id":"1","category_name":\#(json("\u{001C} | EN\u{3000}"))},"#
            + #"{"category_id":"2","category_name":\#(json("\u{200B}Action "))}]"#).utf8))
        XCTAssertEqual(categories.map(\.name), ["\u{001C} | EN", "\u{200B}Action"])

        let playlist = M3UParser.parse(Data("""
        #EXTM3U
        #EXTINF:-1 group-title="\u{3000}Films\u{200B}",\u{200B} - 1999\u{00A0}
        http://s/movie/u/p/1.mkv
        #EXTINF:-1 tvg-name=" \u{001F} - 1999",\u{3000}
        http://s/movie/u/p/2.mkv
        #EXTINF:-1,Heat - 1995\u{FEFF}
        #EXTGRP:\u{2007}Drama\u{180E}\u{0085}
        http://s/movie/u/p/3.mkv
        #EXTINF:-1 group-title="Films\u{200B}",Dune - 2021\u{200B}
        http://s/movie/u/p/4.mkv
        """.utf8))
        XCTAssertEqual(playlist.movies.map(\.name), ["\u{200B} - 1999", "\u{001F} - 1999", "Heat - 1995", "Dune - 2021\u{200B}"])
        XCTAssertEqual(playlist.movies.map(\.year), ["1999", "1999", "1995", nil], "a year followed by U+200B does not end the name")
        XCTAssertEqual(playlist.movieCategories.map(\.name), ["Films\u{200B}", "Uncategorized", "Drama\u{180E}"])
    }

    func testListRowsReadTheTMDBIDYearAndTimestampsOfDocsBrowse() throws {
        let rows = #"""
        [{"stream_id":1,"name":"A","tmdb":"0","tmdb_id":"77.0","added":"1710000000000","year":"","releaseDate":"20211","release_date":"2019-02-03"},
         {"stream_id":2,"name":"B | 2020","tmdb":"tt0111","info":{"tmdb_id":"","tmdb":55},"added":1710000000,"releasedate":"2018-01-01"},
         {"stream_id":3,"name":"C (1999)","tmdb_id":"1234567890123","info":[],"year":"1799"},
         {"stream_id":4,"name":"D","info":{"tmdb_id":"12"},"tmdb":"","releaseDate":" 2001"}]
        """#
        let movies = try XtreamParser.movies(Data(rows.utf8), login: demoLogin)
        XCTAssertEqual(movies.map(\.tmdbID), [77, 55, nil, 12], "tmdb, tmdb_id, info.tmdb_id, info.tmdb: the first usable one")
        XCTAssertEqual(movies.map(\.year), ["2019", "2018", "1999", "2001"], "year, releaseDate, release_date, releasedate, then the name")
        XCTAssertEqual(movies.map(\.added), [1_710_000_000, 1_710_000_000, 0, 0], "milliseconds become seconds")

        let shows = try XtreamParser.series(Data(#"""
        [{"series_id":1,"name":"S","year":"2015","releaseDate":"2016-01-01","last_modified":"1700000000123","info":{"tmdb":"9.0"}},
         {"series_id":2,"name":"T - 2010","releasedate":"2012-05-05"}]
        """#.utf8))
        XCTAssertEqual(shows.map(\.year), ["2015", "2012"], "the year field first, and releasedate counts for series too")
        XCTAssertEqual(shows.map(\.tmdbID), [9, nil])
        XCTAssertEqual(shows.map(\.added), [1_700_000_000, 0])
    }

    func testSeries() throws {
        let shows = try XtreamParser.series(Fixture.data("xtream/series.json"))
        XCTAssertEqual(shows.map(\.id), ["s:331", "s:332", "s:333"])
        let tlou = shows[0]
        XCTAssertEqual(tlou.seriesID, "331")
        XCTAssertEqual(tlou.year, "2023")
        XCTAssertEqual(tlou.tmdbID, 100088)
        XCTAssertEqual(tlou.added, 1_710_000_000)
        XCTAssertEqual(tlou.categoryIDs, ["31", "30", "18"])
        XCTAssertEqual(tlou.backdrop?.absoluteString, "https://image.tmdb.org/t/p/w1280/tlou-back.jpg")
        XCTAssertEqual(tlou.genre, "Drama / Action & Adventure")
        XCTAssertEqual(shows[1].year, "2017")
        XCTAssertNil(shows[1].rating)
        XCTAssertNil(shows[1].plot)
        XCTAssertNil(shows[1].cover)
        XCTAssertTrue(shows[2].adult)
    }

    func testMovieInfoAndSidecarSubtitles() throws {
        let info = try XtreamParser.movieInfo(Fixture.data("xtream/vod_info.json"))
        XCTAssertEqual(info.plot, "Paul Atreides unites with Chani and the Fremen.")
        XCTAssertEqual(info.cast, "Timothée Chalamet, Zendaya, Rebecca Ferguson")
        XCTAssertEqual(info.director, "Denis Villeneuve")
        XCTAssertEqual(info.year, "2024")
        XCTAssertEqual(info.metadataLine, "2024 · 2 hr 46 min · Science Fiction, Adventure · ★8.2")
        XCTAssertEqual(info.backdrop?.lastPathComponent, "dune-back.jpg")
        XCTAssertEqual(info.poster?.lastPathComponent, "dune.jpg")
        XCTAssertEqual(info.subtitles, [
            ExternalSubtitle(url: URL(string: "http://subs.example.com/dune.en.srt")!),
            ExternalSubtitle(url: URL(string: "http://subs.example.com/dune.es.vtt")!, language: "es", label: "Spanish"),
            ExternalSubtitle(url: URL(string: "http://subs.example.com/dune.de.ass")!, language: "de"),
        ])
        XCTAssertEqual(try XtreamParser.movieInfo(Data(#"{"info":[]}"#.utf8)).metadataLine, "")
    }

    func testSeriesInfoWithSeasonMap() throws {
        let info = try XtreamParser.seriesInfo(Fixture.data("xtream/series_info.json"), login: demoLogin)
        XCTAssertEqual(info.seasonNumbers, [0, 1, 2])
        XCTAssertEqual(info.seasons[1]?.map(\.id), ["e:5010", "e:5011"], "sorted by number, duplicates removed")
        XCTAssertEqual(info.allEpisodes.map(\.id), ["e:5000", "e:5010", "e:5011", "e:5002"])
        let pilot = info.seasons[1]![0]
        XCTAssertEqual(pilot.durationSeconds, 4860)
        XCTAssertEqual(pilot.image?.lastPathComponent, "s1e1.jpg")
        XCTAssertEqual(pilot.subtitles, [ExternalSubtitle(url: URL(string: "http://subs.example.com/5010.vtt")!, language: "en", label: "English")])
        XCTAssertEqual(pilot.url.absoluteString, "http://line.example.com:8080/series/demo/s3cret%20pass/5010.mp4")
        XCTAssertTrue(pilot.isPlayable)
        let infected = info.seasons[1]![1]
        XCTAssertEqual(infected.number, 2)
        XCTAssertEqual(infected.durationSeconds, 3180, "\"00:53:00\" duration")
        XCTAssertEqual(infected.containerExtension, "mkv")
        XCTAssertFalse(infected.isPlayable, "MKV episodes are listed but not playable on Apple TV")
        XCTAssertEqual(infected.subtitles.map(\.url.lastPathComponent), ["5011.srt"])
        XCTAssertEqual(info.seasons[0]?.first?.title, "Making Of")
        XCTAssertEqual(info.cast, "Pedro Pascal, Bella Ramsey")
        XCTAssertEqual(info.year, "2023")
        XCTAssertEqual(SeriesInfo.seasonTitle(0), "Specials")
        XCTAssertEqual(SeriesInfo.seasonTitle(2), "Season 2")
    }

    func testSeriesInfoWithEpisodeLists() throws {
        let info = try XtreamParser.seriesInfo(Fixture.data("xtream/series_info_list.json"), login: demoLogin)
        XCTAssertEqual(info.seasonNumbers, [1, 3])
        XCTAssertEqual(info.seasons[3]?.map(\.id), ["e:1", "e:2"])
        XCTAssertEqual(info.seasons[3]?[1].url.absoluteString, "https://cdn.example.com/series/2.mp4")
        XCTAssertEqual(info.seasons[1]?.first?.number, 4)
        XCTAssertEqual(info.plot, "P")
    }

    /// Provider ids are told apart byte for byte, as the other apps tell them apart (docs/browse.md, USA only: a title's
    /// categories are the ids its rows give). Swift's `String` equality takes ids that are only canonically equivalent
    /// ("\u{E9}" and "e\u{301}") as one: the second category was dropped and its titles read the first one's name, two
    /// streams became one, and so did two episodes and two country values.
    func testIdsThatAreOnlyCanonicallyEquivalentStayApart() throws {
        let nfc = "\u{E9}", nfd = "e\u{301}"
        func bytes(_ text: String?) -> [UInt8] { Array((text ?? "<nil>").utf8) }
        let categories = try XtreamParser.categories(Data(#"""
            [{"category_id":"\u00e9","category_name":"French Movies"},{"category_id":"e\u0301","category_name":"Movies"},
             {"category_id":"7","category_name":"Kids"},{"category_id":"e\u0301","category_name":"Again"}]
            """#.utf8))
        XCTAssertEqual(categories.map(\.name), ["French Movies", "Movies", "Kids"], "an id given again is still left out")
        XCTAssertEqual(categories.map(\.id), [ExactText.key(nfc), ExactText.key(nfd), "7"], "ASCII ids are kept as they are")
        guard categories.count == 3 else { return }
        let byID = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })

        let movies = try XtreamParser.movies(Data(#"""
            [{"stream_id":"\u00e9","name":"Heat","category_id":"\u00e9","country":"\u00e9"},
             {"stream_id":"e\u0301","name":"Dune","category_id":"e\u0301","category_ids":["7"],"country":"e\u0301","country_code":"\u00e9"},
             {"stream_id":"\u00e9","name":"Heat again","category_id":"\u00e9","country":"e\u0301"}]
            """#.utf8), login: demoLogin)
        XCTAssertEqual(movies.map(\.name), ["Heat", "Dune"])
        guard movies.count == 2 else { return }
        XCTAssertEqual(movies.map(\.id), ["m:" + ExactText.key(nfc), "m:" + ExactText.key(nfd)])
        XCTAssertEqual(movies.map(\.categoryIDs), [[categories[0].id], [categories[1].id, "7"]])
        XCTAssertFalse(TitleRegion.isUSA(match: nil, categoryIDs: movies[0].categoryIDs, categoriesByID: byID), "French Movies")
        XCTAssertTrue(TitleRegion.isUSA(match: nil, categoryIDs: movies[1].categoryIDs, categoriesByID: byID), "Movies and Kids")
        XCTAssertEqual(bytes(movies[0].country), bytes(nfc + ";" + nfd), "a duplicate row's country is joined")
        XCTAssertEqual(bytes(movies[1].country), bytes(nfd + ";" + nfc), "both country fields are kept")
        // Requests and stream URLs use the provider's own id.
        XCTAssertTrue(movies[0].url.absoluteString.hasSuffix("/%C3%A9.mp4"), movies[0].url.absoluteString)
        XCTAssertTrue(movies[1].url.absoluteString.hasSuffix("/e%CC%81.mp4"), movies[1].url.absoluteString)
        XCTAssertEqual(bytes(ExactText.text(fromKey: String(movies[1].id.dropFirst(2)))), bytes(nfd))
        XCTAssertEqual(ExactText.text(fromKey: "900"), "900")
        XCTAssertEqual(ContentPolicy.movies(movies, categories: categories).items.count, 2)

        let channels = try XtreamParser.live(Data(#"""
            [{"stream_id":"\u00e9","name":"One","category_id":"\u00e9"},{"stream_id":"e\u0301","name":"Two","category_id":"e\u0301"}]
            """#.utf8), login: demoLogin)
        XCTAssertEqual(channels.map(\.name), ["One", "Two"])
        XCTAssertEqual(channels.map(\.key), ["x:" + ExactText.key(nfc), "x:" + ExactText.key(nfd)])
        XCTAssertEqual(channels.map { bytes($0.streamID) }, [bytes(nfc), bytes(nfd)])
        XCTAssertEqual(ContentPolicy.live(channels, categories: categories, usOnly: false).items.map(\.name), ["One", "Two"])

        let shows = try XtreamParser.series(Data(#"[{"series_id":"\u00e9","name":"A"},{"series_id":"e\u0301","name":"B"}]"#.utf8))
        XCTAssertEqual(shows.map(\.id), ["s:" + ExactText.key(nfc), "s:" + ExactText.key(nfd)])
        XCTAssertEqual(shows.map { bytes($0.seriesID) }, [bytes(nfc), bytes(nfd)])

        let info = try XtreamParser.seriesInfo(Data(#"""
            {"episodes":{"1":[{"id":"\u00e9","episode_num":1},{"id":"e\u0301","episode_num":2},{"id":"e\u0301","episode_num":3}]}}
            """#.utf8), login: demoLogin)
        XCTAssertEqual(info.seasons[1]?.map(\.id), ["e:" + ExactText.key(nfc), "e:" + ExactText.key(nfd)], "an id given again is left out")
        XCTAssertEqual(info.seasons[1]?.map { $0.url.absoluteString.hasSuffix("/series/demo/s3cret%20pass/" + ["%C3%A9", "e%CC%81"][$0.number - 1] + ".mp4") },
                       [true, true])
    }

    /// The JSON reader keeps keys apart as JavaScript and Kotlin do: a key spelled again with the same bytes keeps its last
    /// value, and keys that are only canonically equivalent ("\u{E9}" and "e\u{301}", "K" and the Kelvin sign) are two
    /// keys, so a season map keeps the episodes of both.
    func testObjectKeysThatAreOnlyCanonicallyEquivalentStayApart() throws {
        let object = try JSONValue.parse(Data(#"{"\u00e9":1,"e\u0301":2,"e\u0301":3,"K":4,"\u212a":5,"K":6}"#.utf8))
        XCTAssertEqual(object.elements.compactMap(\.int).sorted(), [1, 3, 5, 6])
        XCTAssertEqual(object["K"]?.int, 6)
        XCTAssertEqual(object["\u{E9}"]?.int, 1)
        let info = try XtreamParser.seriesInfo(Data(#"""
            {"episodes":{"\u00e9":[{"id":"1","episode_num":1,"season":1}],"e\u0301":[{"id":"2","episode_num":2,"season":1}]}}
            """#.utf8), login: demoLogin)
        XCTAssertEqual(info.seasons[1]?.map(\.id), ["e:1", "e:2"])
    }

    func testShortEPG() throws {
        let programs = try XtreamParser.shortEPG(Fixture.data("xtream/short_epg.json"))
        XCTAssertEqual(programs.map(\.title), ["Plain Title", "News Night", "Late"])
        XCTAssertEqual(programs[1].description, "The day's headlines.")
        XCTAssertEqual(programs[1].end.timeIntervalSince(programs[1].start), 3600)
        XCTAssertNil(programs[0].description)
        XCTAssertEqual(programs[2].end, Date(timeIntervalSince1970: 1_760_022_000), "end_timestamp is accepted")
        XCTAssertEqual(try XtreamParser.shortEPG(Data("{}".utf8)), [])
    }

    func testSubtitleEntryShapes() {
        XCTAssertEqual(XtreamParser.subtitles(.string("http://s.example.com/a.srt")).map(\.url.absoluteString), ["http://s.example.com/a.srt"])
        XCTAssertEqual(XtreamParser.subtitles(.object(["link": .string("https://s.example.com/b.vtt"), "srclang": .string("fr"), "title": .string("Français")])),
                       [ExternalSubtitle(url: URL(string: "https://s.example.com/b.vtt")!, language: "fr", label: "Français")])
        XCTAssertEqual(XtreamParser.subtitles(.array([.string("http://s.example.com/a.srt"), .object(["path": .string("http://s.example.com/a.srt")])])).count, 1)
        XCTAssertEqual(XtreamParser.subtitles(.number(1)), [])
        XCTAssertEqual(XtreamParser.subtitles(nil), [])
    }

    func testSubtitleFormatsAndNames() {
        XCTAssertEqual(SubtitleFormat(fileExtension: "SRT"), .srt)
        XCTAssertEqual(SubtitleFormat(fileExtension: ".vtt"), .webvtt)
        XCTAssertEqual(SubtitleFormat(fileExtension: "webvtt"), .webvtt)
        XCTAssertEqual(SubtitleFormat(fileExtension: "ass"), .ssa)
        XCTAssertEqual(SubtitleFormat(fileExtension: "dfxp"), .ttml)
        XCTAssertEqual(SubtitleFormat(fileExtension: "xml"), .ttml)
        XCTAssertNil(SubtitleFormat(fileExtension: "sub"))
        XCTAssertEqual(ExternalSubtitle(url: URL(string: "http://example/a.SRT?token=1")!).format, .srt)
        XCTAssertNil(ExternalSubtitle(url: URL(string: "http://example/subtitle")!).format)
        XCTAssertEqual(ExternalSubtitle(url: URL(string: "http://e/a.srt")!, language: "es", label: " Castellano ").displayName, "Castellano")
        XCTAssertEqual(ExternalSubtitle(url: URL(string: "http://e/a.srt")!, language: "en").displayName, "English")
        XCTAssertEqual(ExternalSubtitle(url: URL(string: "http://e/a.srt")!, language: "pt_BR").displayName, "Portuguese")
        XCTAssertEqual(ExternalSubtitle(url: URL(string: "http://e/a.srt")!).displayName, "Subtitles")
    }
}

final class XtreamClientTests: XCTestCase {
    func testAccountInfoChecksAuth() async throws {
        let info = try await XtreamClient(login: demoLogin, http: xtreamPanel()).accountInfo()
        XCTAssertEqual(info.maxConnections, 1)
        let denied = XtreamClient(login: demoLogin, http: xtreamPanel(overrides: ["account": Fixture.data("xtream/account_denied.json")]))
        await assertThrows(TunerError.loginFailed) { _ = try await denied.accountInfo() }
        let unauthorized = XtreamClient(login: demoLogin, http: StubHTTPClient { ok($0, Data(), status: 401) })
        await assertThrows(TunerError.loginFailed) { _ = try await unauthorized.accountInfo() }
        let slow = XtreamClient(login: demoLogin, http: xtreamPanel(failing: ["account"]))
        await assertThrows(TunerError.timedOut) { _ = try await slow.accountInfo() }
        let broken = XtreamClient(login: demoLogin, http: StubHTTPClient { ok($0, Data("<html>".utf8)) })
        await assertThrows(TunerError.invalidResponse) { _ = try await broken.accountInfo() }
    }

    func testDetailRequests() async throws {
        let http = xtreamPanel()
        let client = XtreamClient(login: demoLogin, http: http)
        _ = try await client.movieInfo(streamID: "900")
        _ = try await client.seriesInfo(seriesID: "331")
        let programs = try await client.shortEPG(streamID: "101")
        XCTAssertEqual(programs.count, 3)
        let urls = http.requests.map(\.url.absoluteString)
        XCTAssertTrue(urls[0].hasSuffix("action=get_vod_info&vod_id=900"))
        XCTAssertTrue(urls[1].hasSuffix("action=get_series_info&series_id=331"))
        XCTAssertTrue(urls[2].hasSuffix("action=get_short_epg&stream_id=101&limit=24"))
        XCTAssertTrue(http.requests.allSatisfy { $0.headers["User-Agent"] == nil }, "the client's default stream User-Agent applies")
    }
}

/// Asserts that `body` throws `expected`.
func assertThrows<E: Error & Equatable>(_ expected: E, file: StaticString = #filePath, line: UInt = #line,
                                        _ body: () async throws -> Void) async {
    do {
        try await body()
        XCTFail("expected \(expected)", file: file, line: line)
    } catch {
        XCTAssertEqual(error as? E, expected, "\(error)", file: file, line: line)
    }
}

final class M3UParserTests: XCTestCase {
    func testPlaylistParsing() throws {
        let playlist = M3UParser.parse(Fixture.data("playlist.m3u"))
        XCTAssertEqual(playlist.guideURL?.absoluteString, "http://epg.example.com/guide.xml.gz")
        // "Channel 11": the fallback numbers the entry in the whole playlist, movies and episodes included
        // (docs/browse.md "M3U playlists", Name).
        XCTAssertEqual(playlist.channels.map(\.name), ["US: CNN HD", "BBC One HD", "Sky News, Live", "Late", "Channel 11", "Fallback Name"])
        let cnn = playlist.channels[0]
        XCTAssertEqual(playlist.channels.map(\.number), Array(1...6), "only half carry tvg-chno: renumbered in order")
        XCTAssertEqual(cnn.epgID, "CNN.us")
        XCTAssertEqual(cnn.country, "US")
        XCTAssertEqual(cnn.language, "en-US")
        XCTAssertEqual(cnn.logo?.absoluteString, "http://logos.example.com/cnn.png")
        let hash = StableHash.base36(StableHash.fnv1a64("http://line.example.com/live/demo/s3cret/1.ts"))
        XCTAssertEqual(cnn.key, "u:\(hash):1")
        XCTAssertEqual(playlist.channels[1].epgID, "BBC One", "tvg-name stands in for a blank tvg-id")
        XCTAssertEqual(playlist.channels[3].logo?.absoluteString, "http://logos.example.com/hot.png", "single-quoted attributes")
        XCTAssertEqual(playlist.liveCategories.map(\.name), ["USA | News", "UK, Entertainment", "News Extra", "XXX Adults", "Uncategorized"])
        XCTAssertEqual(playlist.liveCategories.map(\.id), ["live:g0", "live:g1", "live:g2", "live:g3", "live:g4"])
        XCTAssertTrue(playlist.liveCategories.allSatisfy { !$0.adult }, "playlists have no adult flag; only names count")
        XCTAssertEqual(playlist.channels[2].categoryID, "live:g2", "#EXTGRP sets the group")

        XCTAssertEqual(playlist.movies.map(\.name), ["Dune Part Two (2024)", "Inside Out 2 (2024)"], "the same URL twice is one movie")
        XCTAssertEqual(playlist.movies[0].id, "mu:" + StableHash.base36(StableHash.fnv1a64("http://line.example.com/movie/demo/s3cret/55.mkv")))
        XCTAssertEqual(playlist.movies[0].year, "2024")
        XCTAssertEqual(playlist.movies[0].containerExtension, "mkv")
        XCTAssertEqual(playlist.movies[1].containerExtension, "mp4", "the extension ignores the query")
        XCTAssertEqual(playlist.movieCategories.map(\.id), ["movies:g0"])

        XCTAssertEqual(playlist.series.map(\.name), ["The Last of Us", "Severance"])
        let tlou = playlist.series[0]
        XCTAssertEqual(tlou.id, "ms:" + StableHash.base36(StableHash.fnv1a64("The Last of Us")))
        XCTAssertEqual(tlou.cover?.absoluteString, "http://posters.example.com/tlou.jpg")
        let episodes = playlist.episodes[tlou.id] ?? []
        XCTAssertEqual(episodes.map(\.number), [2, 1])
        XCTAssertEqual(episodes.map(\.title), ["Infected", "Episode 1"])
        XCTAssertEqual(episodes[0].id, "me:" + StableHash.base36(StableHash.fnv1a64("http://line.example.com/series/demo/s3cret/5011.mp4")))
        let severance = playlist.episodes[playlist.series[1].id] ?? []
        XCTAssertEqual(severance.map(\.season), [2])
        XCTAssertEqual(severance.first?.title, "Hello, Ms. Cobel")
        XCTAssertEqual(severance.first?.isPlayable, false)
        XCTAssertEqual(playlist.seriesCategories.map(\.name), ["Series | Drama", "Series | Apple"])
    }

    func testGzippedPlaylistsAndRenumbering() throws {
        // Android ParserTest: attributes with commas, #EXTVLCOPT lines and VOD detection.
        let text = """
        #EXTM3U url-tvg="http://epg.example/guide.xml.gz"
        #EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="http://l/bbc.png" group-title="UK, Entertainment",BBC One HD
        http://s/live/1.ts
        #EXTINF:-1 tvg-chno="7" group-title="News",Sky News
        #EXTVLCOPT:http-user-agent=foo
        http://s/live/2.m3u8
        #EXTINF:-1 tvg-logo="http://p/x.jpg" group-title="Movies 2024",Dune Part Two (2024)
        http://s/movie/u/p/55.mkv
        """
        let playlist = M3UParser.parse(gzipped(text))
        XCTAssertEqual(playlist.guideURL?.absoluteString, "http://epg.example/guide.xml.gz")
        XCTAssertEqual(playlist.channels.map(\.name), ["BBC One HD", "Sky News"])
        XCTAssertEqual(playlist.channels.map(\.number), [1, 2], "too few provider numbers: renumbered in order")
        XCTAssertEqual(playlist.liveCategories.first?.name, "UK, Entertainment")
        XCTAssertEqual(playlist.movies.map(\.name), ["Dune Part Two (2024)"])
    }

    /// Windows ("\r\n") and old Mac ("\r") line endings read as "\n": "\r\n" is one Swift `Character`, so a split on the
    /// characters "\n" and "\r" saw one long line and found no channel.
    func testWindowsAndCarriageReturnLineEndings() throws {
        let unix = Fixture.text("playlist.m3u")
        XCTAssertFalse(unix.unicodeScalars.contains("\r"))
        let expected = M3UParser.parse(Data(unix.utf8))
        XCTAssertEqual(expected.channels.count, 6)
        let windows = unix.replacingOccurrences(of: "\n", with: "\r\n", options: .literal)
        let mac = unix.replacingOccurrences(of: "\n", with: "\r", options: .literal)
        for (label, text) in [("CRLF", windows), ("CR", mac)] {
            let playlist = M3UParser.parse(Data(text.utf8))
            XCTAssertEqual(playlist.channels.map(\.name), expected.channels.map(\.name), label)
            XCTAssertEqual(playlist, expected, label)
            XCTAssertEqual(M3UParser.parse(gzipped(text)), expected, "\(label), gzipped")
        }
        // Mixed endings, blank lines and a "\r\n" right after a multi-byte name.
        let mixed = M3UParser.parse(Data("#EXTM3U\r\n\r\n#EXTINF:-1 group-title=\"News\",Été\r\nhttp://s/live/1.ts\n\r#EXTINF:-1,Two\rhttp://s/live/2.ts".utf8))
        XCTAssertEqual(mixed.channels.map(\.name), ["Été", "Two"])
        XCTAssertEqual(mixed.channels.map(\.url.absoluteString), ["http://s/live/1.ts", "http://s/live/2.ts"])
        XCTAssertEqual(mixed.liveCategories.map(\.name), ["News", "Uncategorized"])
    }

    /// The name after the comma, "#EXTGRP:" and "#" comments are found scalar by scalar: a combining mark (U+0301) or
    /// U+200D after them makes one `Character` with them.
    func testTagsAndCommasFollowedByCombiningMarks() {
        XCTAssertEqual(M3UParser.read("#EXTINF:-1 tvg-name=\"T\",\u{0301}Name").title, "\u{0301}Name")
        XCTAssertEqual(M3UParser.read("#EXTINF:-1 tvg-name=\"T\u{0301}\",\u{200D}Name").title, "\u{200D}Name")
        XCTAssertEqual(M3UParser.read("#EXTINF:-1 tvg-name=\"T\u{0301}\",\u{200D}Name").attributes, ["tvg-name": "T\u{0301}"])
        let playlist = M3UParser.parse(Data("""
        #EXTM3U
        #EXTINF:-1 tvg-name="Fallback",\u{0301}Accent
        #EXTGRP:\u{0301}Group
        #\u{0301} a comment
        http://s/live/1.ts
        """.utf8))
        XCTAssertEqual(playlist.channels.map(\.name), ["\u{0301}Accent"])
        XCTAssertEqual(playlist.liveCategories.map(\.name), ["\u{0301}Group"])
    }

    /// docs/browse.md "M3U playlists", Group: groups are told apart byte for byte, as in the other apps. Swift's `String`
    /// equality takes names that are only canonically equivalent as one, which made "Espan\u{303}ol" (not foreign) and
    /// "Espa\u{F1}ol" (foreign) one category: a title filed under the second passed USA only on Apple TV alone.
    func testGroupsThatAreOnlyCanonicallyEquivalentStayApart() {
        let nfd = "Espan\u{303}ol", nfc = "Espa\u{F1}ol"
        XCTAssertFalse(TitleRegion.isForeignCategory(nfd))
        XCTAssertTrue(TitleRegion.isForeignCategory(nfc))
        for (first, second) in [(nfd, nfc), (nfc, nfd)] {
            let text = "#EXTM3U\n"
                + "#EXTINF:-1 group-title=\"\(first)\",Heat\nhttp://s/movie/u/p/1.mp4\n#EXTINF:-1 group-title=\"\(second)\",Dune\nhttp://s/movie/u/p/2.mp4\n"
                + "#EXTINF:-1 group-title=\"\(first)\",One\nhttp://s/live/1.ts\n#EXTINF:-1 group-title=\"\(second)\",Two\nhttp://s/live/2.ts\n"
                + "#EXTINF:-1 group-title=\"\(first)\",Show S01E01\nhttp://s/series/u/p/3.mp4\n"
                + "#EXTINF:-1 group-title=\"\(second)\",Show S01E02\nhttp://s/series/u/p/4.mp4\n"
            let playlist = M3UParser.parse(Data(text.utf8))
            let names = { (categories: [TunerCore.Category]) in categories.map { Array($0.name.utf8) } }
            XCTAssertEqual(names(playlist.movieCategories), [Array(first.utf8), Array(second.utf8)])
            XCTAssertEqual(names(playlist.liveCategories), [Array(first.utf8), Array(second.utf8)])
            XCTAssertEqual(names(playlist.seriesCategories), [Array(first.utf8), Array(second.utf8)])
            XCTAssertEqual(playlist.movies.map(\.categoryID), ["movies:g0", "movies:g1"])
            XCTAssertEqual(playlist.channels.map(\.categoryID), ["live:g0", "live:g1"])
            XCTAssertEqual(playlist.series.map(\.categoryIDs), [["series:g0", "series:g1"]])
            let byID = Dictionary(uniqueKeysWithValues: playlist.movieCategories.map { ($0.id, $0) })
            let usa = playlist.movies.map { TitleRegion.isUSA(match: nil, categoryIDs: $0.categoryIDs, categoriesByID: byID) }
            XCTAssertEqual(usa, [first, second].map { Array($0.utf8) == Array(nfd.utf8) }, "only the title under \"Espan\\u{303}ol\" passes")
        }
    }

    /// The episode-name pattern takes time in proportion to a run of spaces inside a name. With `(.*?)` before `\s+` it
    /// tried the run again from each of its spaces: about a second for 16,000 spaces, after which ICU gave up and found
    /// no episode (from about 10,000 spaces on, "A", the run, "B S01E02" was a movie).
    func testEpisodeNamesWithLongRunsOfSpacesTakeLinearTime() {
        let run = String(repeating: " ", count: 16_000)
        let clock = ContinuousClock()
        // Each playlist holds one entry, a name with the run inside it, timed alone.
        for (name, series, title) in [("A\(run)B S01E02 Pilot", "A\(run)B", "Pilot"), ("A\(run)B", nil, nil), ("Show\(run)S01x", nil, nil)] {
            let text = "#EXTM3U\n#EXTINF:-1,\(name)\nhttp://s/series/u/p/1.mp4\n"
            var playlist = M3UPlaylist()
            let elapsed = clock.measure { playlist = M3UParser.parse(Data(text.utf8)) }
            XCTAssertEqual(playlist.series.map(\.name), series.map { [$0] } ?? [], name.suffix(20).debugDescription)
            XCTAssertEqual(playlist.series.first.flatMap { playlist.episodes[$0.id] }?.map(\.title), title.map { [$0] })
            XCTAssertEqual(playlist.movies.map(\.name), series == nil ? [name] : [])
            XCTAssertLessThan(elapsed, .milliseconds(50), "\(name.suffix(20).debugDescription): \(elapsed)")
        }
    }

    func testEmptyAndGarbageInput() {
        XCTAssertEqual(M3UParser.parse(Data()), M3UPlaylist())
        XCTAssertEqual(M3UParser.parse(Data("<html>nope</html>".utf8)).channels, [])
    }

    /// docs/browse.md "M3U playlists", Values and title: one pass from the start of the line.
    func testAttributeParsing() {
        let line = M3UParser.read(#"#EXTINF:-1 tvg-id = "a,b" TVG-NAME='Q "x"' group-title="",Name"#)
        XCTAssertEqual(line.attributes, ["tvg-id": "a,b", "tvg-name": #"Q "x""#, "group-title": ""])
        XCTAssertEqual(line.title, "Name")
        XCTAssertEqual(M3UParser.read(#"#EXTINF:-1 group-title="A, B",The Name, Part 2"#).title, "The Name, Part 2")
        XCTAssertEqual(M3UParser.read("#EXTINF:-1 tvg-id=\"x\"").title, "", "no name comma")
        // The first value of a key is kept, and nothing after the name comma is a value.
        let twice = M3UParser.read(#"#EXTINF:-1 group-title="First" GROUP-TITLE="Second",Heat group-title="Third""#)
        XCTAssertEqual(twice.attributes, ["group-title": "First"])
        XCTAssertEqual(twice.title, #"Heat group-title="Third""#)
        // A quote that starts no value is passed over: "Bob's" has no "=", and the "\"" after tvg-name has no partner.
        XCTAssertEqual(M3UParser.read("#EXTINF:-1 tvg-id=Bob's,Heat").title, "Heat")
        XCTAssertEqual(M3UParser.read(#"#EXTINF:-1 tvg-name="Heat,Heat"#).title, "Heat")
        XCTAssertEqual(M3UParser.read(#"#EXTINF:-1 tvg-name="Heat,Heat"#).attributes, [:])
        // A value ends at the first quote of its own kind; a key never starts inside a run of key characters.
        XCTAssertEqual(M3UParser.read("#EXTINF:-1 tvg-name='Bob's Burgers',").attributes, ["tvg-name": "Bob"])
        XCTAssertEqual(M3UParser.read(#"#EXTINF:-1 xtvg-name="X" tvg-id="1"tvg-name="Heat",Up"#).attributes, ["xtvg-name": "X", "tvg-id": "1", "tvg-name": "Heat"])
        // The #EXTM3U header has no title: its commas are passed over.
        XCTAssertEqual(M3UParser.read(#"#EXTM3U x, url-tvg="http://e/a.xml,http://e/b.xml""#, stopsAtComma: false).attributes,
                       ["url-tvg": "http://e/a.xml,http://e/b.xml"])
    }

    /// One pass over the line: long lines of every shape read in time that grows with the line, not with its square.
    func testLongExtinfLinesReadInOnePass() {
        let count = 50_000
        let shapes = [
            "#EXTINF:-1 " + String(repeating: "a=\"", count: 1) + String(repeating: "b='x ", count: count) + ",Name",
            "#EXTINF:-1 " + String(repeating: "k=v ", count: count) + ",Name",
            "#EXTINF:-1 " + String(repeating: "key = 'v' ", count: count) + ",Name",
            "#EXTINF:-1 " + String(repeating: "x", count: count * 4) + ",Name",
            "#EXTINF:-1 tvg-name=\"" + String(repeating: "'a=' ", count: count) + ",Name",
        ]
        let start = Date()
        for line in shapes { XCTAssertFalse(M3UParser.read(line).title.isEmpty) }
        XCTAssertLessThan(Date().timeIntervalSince(start), 10, "five lines of about 200,000 characters")
    }

    /// A gzip member with stored blocks (enough for tests; the parser must not care how it was compressed).
    private func gzipped(_ text: String) -> Data {
        let plain = Array(text.utf8)
        var out: [UInt8] = [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]
        var offset = 0
        repeat {
            let count = min(65535, plain.count - offset)
            let last: UInt8 = offset + count >= plain.count ? 1 : 0
            out += [last, UInt8(count & 0xFF), UInt8(count >> 8), UInt8(~count & 0xFF), UInt8((~count >> 8) & 0xFF)]
            out += plain[offset..<(offset + count)]
            offset += count
        } while offset < plain.count
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in plain {
            crc ^= UInt32(byte)
            for _ in 0..<8 { crc = crc & 1 != 0 ? 0xEDB8_8320 ^ (crc >> 1) : crc >> 1 }
        }
        crc ^= 0xFFFF_FFFF
        for value in [crc, UInt32(plain.count)] { for shift in [0, 8, 16, 24] { out.append(UInt8((value >> UInt32(shift)) & 0xFF)) } }
        return Data(out)
    }
}
