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
        XCTAssertEqual(XtreamParser.tmdbID(inInfo: Fixture.data("xtream/vod_info.json")), 693134)
        XCTAssertEqual(XtreamParser.tmdbID(inInfo: Fixture.data("xtream/series_info.json")), 100088)
        XCTAssertNil(XtreamParser.tmdbID(inInfo: Data("{}".utf8)))
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
        XCTAssertEqual(playlist.channels.map(\.name), ["US: CNN HD", "BBC One HD", "Sky News, Live", "Late", "Channel 5", "Fallback Name"])
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

    func testWindowsAndClassicMacLineEndings() {
        let text = String(decoding: Fixture.data("playlist.m3u"), as: UTF8.self)
        XCTAssertFalse(text.unicodeScalars.contains("\r"), "the fixture is the LF baseline")
        let lf = M3UParser.parse(Data(text.utf8))
        XCTAssertFalse(lf.channels.isEmpty || lf.movies.isEmpty || lf.series.isEmpty || lf.guideURL == nil)
        for ending in ["\r\n", "\r"] {
            let playlist = M3UParser.parse(Data(text.replacingOccurrences(of: "\n", with: ending).utf8))
            XCTAssertEqual(playlist, lf, "\(ending.unicodeScalars.map { $0.escaped(asASCII: true) }.joined()) ends lines like \\n")
        }
    }

    func testEmptyAndGarbageInput() {
        XCTAssertEqual(M3UParser.parse(Data()), M3UPlaylist())
        XCTAssertEqual(M3UParser.parse(Data("<html>nope</html>".utf8)).channels, [])
    }

    func testAttributeParsing() {
        let attributes = M3UParser.parseAttributes(#"#EXTINF:-1 tvg-id = "a,b" TVG-NAME='Q "x"' group-title="",Name"#)
        XCTAssertEqual(attributes["tvg-id"], "a,b")
        XCTAssertEqual(attributes["tvg-name"], #"Q "x""#)
        XCTAssertEqual(attributes["group-title"], "")
        XCTAssertEqual(M3UParser.nameAfterComma(#"#EXTINF:-1 group-title="A, B",The Name, Part 2"#), "The Name, Part 2")
        XCTAssertNil(M3UParser.nameAfterComma("#EXTINF:-1 tvg-id=\"x\""))
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
