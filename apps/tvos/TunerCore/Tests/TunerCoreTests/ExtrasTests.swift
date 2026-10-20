import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

/// docs/extras.md for Apple TV: the hidden live category in the catalogue, what the app asks lumanest.tv for, how it
/// reads the answers, the session and device caches, and the automatic subtitle choice. The shared cases are in
/// `ExtrasCasesTests`.
final class ExtrasTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_842_400)

    // MARK: Hidden live category in the catalogue

    private static let liveCategories = Data("""
    [{"category_id":"1","category_name":"USA | News"},
     {"category_id":"9","category_name":"|USA| MOST WATCHED NOW"},
     {"category_id":"10","category_name":"Most Watched Movies"}]
    """.utf8)

    private static let liveStreams = Data("""
    [{"num":1,"name":"US: CNN","stream_id":201,"category_id":"1","category_ids":[1]},
     {"num":2,"name":"US: CNN","stream_id":202,"category_id":"9","category_ids":[9]},
     {"num":3,"name":"US: ESPN","stream_id":203,"category_id":"9","category_ids":[9,1]},
     {"num":4,"name":"US: HBO","stream_id":204,"category_id":""},
     {"num":5,"name":"US: AMC","stream_id":205,"category_id":"10","category_ids":[10]}]
    """.utf8)

    /// Both editions: the App Store edition's strict adult filter also drops a channel whose categories are all unknown,
    /// so the direct edition shows that the hidden copy is dropped by this rule itself.
    func testTheProvidersMostWatchedNowCategoryIsHiddenInEveryMode() async throws {
        for edition in Edition.allCases {
            for usOnly in [false, true] {
                let directory = makeTemporaryDirectory(self)
                let http = xtreamPanel(overrides: ["get_live_categories": ExtrasTests.liveCategories, "get_live_streams": ExtrasTests.liveStreams])
                let catalog = CatalogService(cacheDirectory: directory, http: http, edition: edition, now: { [start] in start })
                await catalog.load(demoSource, options: CatalogOptions(usOnly: usOnly))
                let state = await catalog.state
                let live = try XCTUnwrap(state.live)
                let label = "\(edition), " + (usOnly ? "USA only" : "All")
                XCTAssertFalse(live.categories.contains { $0.id == "9" }, label)
                XCTAssertTrue(live.categories.contains { $0.id == "10" }, "\(label): another \"Most Watched\" name stays")
                // The copy listed only in the hidden category is dropped (and doesn't fold into CNN as a backup); a channel
                // also listed elsewhere stays there; a channel without any category is unaffected.
                XCTAssertEqual(live.channels.map(\.key), ["x:201", "x:203", "x:204", "x:205"], label)
                XCTAssertEqual(live.channel(forKey: "x:201")?.backups, [], label)
                XCTAssertEqual(live.channel(forKey: "x:203")?.categoryIDs, ["1"], label)
                XCTAssertEqual(live.channel(forKey: "x:203")?.categoryID, "1", label)
                XCTAssertFalse(live.channels.contains { $0.categoryIDs.contains("9") }, label)
            }
        }
    }

    func testPlaylistGroupsAreHiddenByName() async throws {
        let playlist = """
        #EXTM3U
        #EXTINF:-1 group-title="Most Watched Now",Copy One
        http://h.example.com/live/u/p/1.ts
        #EXTINF:-1 group-title="News",CNN
        http://h.example.com/live/u/p/2.ts
        #EXTINF:-1,No Group
        http://h.example.com/live/u/p/3.ts
        """
        let http = StubHTTPClient { request in ok(request, Data(playlist.utf8)) }
        let catalog = CatalogService(cacheDirectory: makeTemporaryDirectory(self), http: http, edition: .appStore, now: { [start] in start })
        await catalog.load(Source(id: "pl", kind: .m3u, playlistURL: "https://tv.example.com/m3u"), options: CatalogOptions())
        let state = await catalog.state
        let live = try XCTUnwrap(state.live)
        XCTAssertEqual(live.channels.map(\.name), ["CNN", "No Group"])
        XCTAssertFalse(live.categories.contains { isHiddenLiveCategory($0.name) })
    }

    /// A lineup saved before the rule existed still shows without the category while it refreshes (here it can't).
    func testSnapshotsSavedBeforeTheRuleAreFiltered() async throws {
        let directory = makeTemporaryDirectory(self)
        let options = CatalogOptions()
        let lineup = LiveLineup(channels: [channel("x:1", "CNN", category: "1"), channel("x:2", "Copy", category: "9"),
                                           channel("x:3", "ESPN", category: "9", categories: ["9", "1"])],
                                categories: [Category(id: "1", name: "News"), Category(id: "9", name: "Most Watched Now")],
                                updated: start)
        let file = directory.appendingPathComponent("live-\(CatalogService.sourceDigest(demoSource)).json")
        SnapshotFiles.write(Snapshot(identity: CatalogService.identity(source: demoSource, options: options, edition: .appStore),
                                     saved: start.timeIntervalSince1970, payload: lineup), to: file)
        let offline = StubHTTPClient { _ in throw URLError(.notConnectedToInternet) }
        let catalog = CatalogService(cacheDirectory: directory, http: offline, edition: .appStore, now: { [start] in start })
        await catalog.load(demoSource, options: options)
        let state = await catalog.state
        let live = try XCTUnwrap(state.live)
        XCTAssertEqual(live.channels.map(\.key), ["x:1", "x:3"])
        XCTAssertEqual(live.categories.map(\.id), ["1"])
        XCTAssertEqual(live.channel(forKey: "x:3")?.categoryIDs, ["1"])
        // Nothing hidden: the lineup comes back as it was.
        let plain = LiveLineup(channels: [channel("x:1", "CNN", category: "1")], categories: [Category(id: "1", name: "News")], updated: start)
        XCTAssertEqual(HiddenLiveCategories.lineup(plain), plain)
    }

    func testHiddenNamesAreReadScalarByScalar() {
        // A combining mark is not an ASCII letter: it separates words, as a precomposed letter does.
        XCTAssertFalse(isHiddenLiveCategory("Most Wa\u{301}tched Now"))
        XCTAssertTrue(isHiddenLiveCategory("Most Watched Now\u{301}"))
        XCTAssertTrue(isHiddenLiveCategory("usa\u{2003}most watched\u{3000}now"))
        XCTAssertFalse(isHiddenLiveCategory("us usa most watched now en en"))
        XCTAssertFalse(isHiddenLiveCategory("Most Watched Now Now"))
        XCTAssertTrue(isHiddenLiveCategory("EN Most Watched US"))
    }

    // MARK: What the app asks for

    private let matrix = RowsItem(id: 603, title: "The Matrix", year: "1999", origin: ["US"])

    func testMovieLookupsPreferTheProviderIDThenTheMatchThenTheNameAndYear() throws {
        let provider = movie("m:1", "The Matrix", year: "1999", tmdb: 604)
        XCTAssertEqual(SubtitleQuery.movie(provider, match: matrix)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=movie&tmdb=604")
        let matched = movie("m:2", "The Matrix", year: "1999")
        XCTAssertEqual(SubtitleQuery.movie(matched, match: matrix)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=movie&tmdb=603")
        let named = movie("m:3", "  EN | The Matrix + Co & Friends (1999)\u{00A0}", year: nil)
        XCTAssertEqual(SubtitleQuery.movie(named, match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=movie&name=EN%20%7C%20The%20Matrix%20%2B%20Co%20%26%20Friends%20%281999%29&year=1999")
        let accented = movie("m:4", "Am\u{E9}lie", year: "2001")
        XCTAssertEqual(SubtitleQuery.movie(accented, match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=movie&name=Am%C3%A9lie&year=2001")
        // No id and no year: nothing to ask.
        XCTAssertNil(SubtitleQuery.movie(movie("m:5", "The Matrix"), match: nil))
        XCTAssertNil(SubtitleQuery.movie(movie("m:6", String(repeating: "a", count: 301), year: "1999"), match: nil))
        XCTAssertNotNil(SubtitleQuery.movie(movie("m:7", String(repeating: "a", count: 300), year: "1999"), match: nil))
        XCTAssertNil(SubtitleQuery.movie(movie("m:8", "Old", year: "1799"), match: nil))
        // An out-of-range provider id is not sent; the match is.
        XCTAssertEqual(SubtitleQuery.movie(movie("m:9", "The Matrix", tmdb: 0), match: matrix)?.title, .tmdb(603))
        XCTAssertEqual(SubtitleQuery.movie(movie("m:10", "The Matrix", tmdb: 1_000_000_000_000), match: nil)?.title, nil)
    }

    func testEpisodeLookupsUseTheSeriesIDSeasonAndEpisode() {
        let show = series("s:1", "Game of Thrones", year: "2011", tmdb: 1399)
        XCTAssertEqual(SubtitleQuery.episode(episode("e:1", season: 1, number: 3), of: show, match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=episode&tmdb=1399&season=1&episode=3")
        XCTAssertEqual(SubtitleQuery.episode(episode("e:2", season: 0, number: 1), of: show, match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=episode&tmdb=1399&season=0&episode=1")
        let unmatched = series("s:2", "Some Show (2011)")
        XCTAssertEqual(SubtitleQuery.episode(episode("e:3", season: 2, number: 10), of: unmatched, match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/subtitles?v=1&type=episode&season=2&episode=10&name=Some%20Show%20%282011%29&year=2011")
        let matched = series("s:3", "GoT")
        XCTAssertEqual(SubtitleQuery.episode(episode("e:4", season: 1, number: 1), of: matched,
                                             match: RowsItem(id: 1399, title: "Game of Thrones", year: "2011"))?.title, .tmdb(1399))
        // An episode without a number, or out of range, gets no request.
        XCTAssertNil(SubtitleQuery.episode(episode("e:5", season: 1, number: 0), of: show, match: nil))
        XCTAssertNil(SubtitleQuery.episode(episode("e:6", season: 10000, number: 1), of: show, match: nil))
        XCTAssertNil(SubtitleQuery.episode(episode("e:7", season: -1, number: 1), of: show, match: nil))
        XCTAssertNotNil(SubtitleQuery.episode(episode("e:8", season: 9999, number: 9999), of: show, match: nil))
        XCTAssertNil(SubtitleQuery.episode(episode("e:9", season: 1, number: 10000), of: show, match: nil))
    }

    func testTrailerLookups() {
        XCTAssertEqual(TrailerQuery.movie(movie("m:1", "The Matrix", tmdb: 603), match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/trailer?v=1&type=movie&tmdb=603")
        XCTAssertEqual(TrailerQuery.series(series("s:1", "Game of Thrones", tmdb: 1399), match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/trailer?v=1&type=tv&tmdb=1399")
        XCTAssertEqual(TrailerQuery.series(series("s:2", "Show", year: "2011"), match: nil)?.url()?.absoluteString,
                       "https://lumanest.tv/api/extras/trailer?v=1&type=tv&name=Show&year=2011")
        XCTAssertNil(TrailerQuery.series(series("s:3", "Show"), match: nil))
    }

    // MARK: Reading the answers

    private let origin = "https://lumanest.tv/"

    private static func track(_ id: String, _ label: String = "English (OpenSubtitles)", hi: Bool = false, vtt: String? = nil) -> String {
        let link = vtt ?? "https://lumanest.tv/api/extras/subtitles/file/\(id).vtt"
        return #"{"id":"\#(id)","lang":"en","label":"\#(label)","hi":\#(hi),"vtt":"\#(link)","srt":"\#(link.replacingOccurrences(of: ".vtt", with: ".srt"))"}"#
    }

    func testSubtitleAnswersKeepOnlyTracksOnTheOriginTheyWereAskedFrom() throws {
        let body = #"{"v":1,"status":"ok","tmdb":603,"future":{"x":1},"tracks":["#
            + [ExtrasTests.track("1-a"), ExtrasTests.track("2-b", vtt: "https://evil.example.com/api/extras/subtitles/file/2-b.vtt"),
               ExtrasTests.track("3-c", vtt: "http://lumanest.tv/api/extras/subtitles/file/3-c.vtt"),
               ExtrasTests.track("4-d", vtt: "https://lumanest.tv.evil.example.com/x.vtt"),
               ExtrasTests.track("5-e", "English SDH (OpenSubtitles 2)", hi: true), #"{"id":"6-f"}"#, ExtrasTests.track("1-a"),
               ExtrasTests.track("7-g", "A\\u0007\\nB\\u202EC   D"), ExtrasTests.track("8-h"), ExtrasTests.track("9-i")].joined(separator: ",")
            + #"],"credit":"Subtitles provided by OpenSubtitles.com"}"#
        let lookup = try XCTUnwrap(SubtitleLookup.parse(Data(body.utf8), origin: origin))
        XCTAssertEqual(lookup.tracks.map(\.id), ["1-a", "5-e", "7-g"], "at most 3, same origin only, no repeats")
        XCTAssertEqual(lookup.tracks.map(\.hearingImpaired), [false, true, false])
        XCTAssertEqual(lookup.tracks[1].label, "English SDH (OpenSubtitles 2)")
        XCTAssertEqual(lookup.tracks[2].label, "A B C D", "one plain line, controls and direction overrides removed")
        XCTAssertEqual(lookup.tracks[0].vtt.absoluteString, "https://lumanest.tv/api/extras/subtitles/file/1-a.vtt")
        XCTAssertEqual(lookup.credit, "Subtitles provided by OpenSubtitles.com")

        let unlabelled = try XCTUnwrap(SubtitleLookup.parse(Data(#"{"tracks":[{"id":"1-a","vtt":"https://lumanest.tv/f/1.vtt"}]}"#.utf8), origin: origin))
        XCTAssertEqual(unlabelled.tracks.map(\.label), ["English (OpenSubtitles)"])
        XCTAssertEqual(unlabelled.credit, TunerLinks.openSubtitlesCredit)

        let none = try XCTUnwrap(SubtitleLookup.parse(Data(#"{"v":1,"status":"not_configured","tmdb":null,"tracks":[],"credit":"x"}"#.utf8), origin: origin))
        XCTAssertEqual(none.tracks, [])
        XCTAssertNil(SubtitleLookup.parse(Data(#"{"v":2,"tracks":[]}"#.utf8), origin: origin), "another version is not read")
        XCTAssertNil(SubtitleLookup.parse(Data("<html>".utf8), origin: origin))
        XCTAssertNil(SubtitleLookup.parse(Data("[]".utf8), origin: origin))
    }

    func testTrailerAnswersAreCheckedAndLinksBuiltFromTheKey() throws {
        let qr = #"["111","101","111"]"#
        let body = #"{"v":1,"status":"ok","tmdb":603,"trailer":{"key":"vKQi3bBA1y8","name":"  Official\nTrailer  ","url":"https://evil.example.com","short":"evil","qr":\#(qr)}}"#
        let trailer = try XCTUnwrap(Trailer.parse(Data(body.utf8)) ?? nil)
        XCTAssertEqual(trailer.key, "vKQi3bBA1y8")
        XCTAssertEqual(trailer.name, "Official Trailer")
        XCTAssertEqual(trailer.appURL.absoluteString, "youtube://watch/vKQi3bBA1y8")
        XCTAssertEqual(trailer.phoneURL.absoluteString, "https://youtu.be/vKQi3bBA1y8")
        XCTAssertEqual(trailer.shortLink, "youtu.be/vKQi3bBA1y8")
        XCTAssertEqual(trailer.watchURL.absoluteString, "https://www.youtube.com/watch?v=vKQi3bBA1y8")
        XCTAssertEqual(trailer.qr, ["111", "101", "111"])

        for key in ["vKQi3bBA1y", "vKQi3bBA1y8x", "vKQi3bBA1y/", "vKQi3bBA1y\u{0430}", "javascript:"] {
            let bad = #"{"v":1,"status":"ok","trailer":{"key":"\#(key)","name":"x"}}"#
            let parsed = try XCTUnwrap(Trailer.parse(Data(bad.utf8)), key)
            XCTAssertNil(parsed, key)
        }
        let noName = try XCTUnwrap(Trailer.parse(Data(#"{"status":"ok","trailer":{"key":"a_b-C1d2E3f","qr":["10"]}}"#.utf8)) ?? nil)
        XCTAssertEqual(noName.name, "Trailer")
        XCTAssertEqual(noName.qr, [], "rows that aren't a square of 0 and 1 are not kept")
        for status in ["none", "unmatched", "not_configured"] {
            let answer = try XCTUnwrap(Trailer.parse(Data(#"{"v":1,"status":"\#(status)","tmdb":null,"trailer":null}"#.utf8)))
            XCTAssertNil(answer, status)
        }
        XCTAssertTrue(Trailer.parse(Data(#"{"v":"1","status":"ok"}"#.utf8)) == nil, "not a v1 answer")
        XCTAssertTrue(Trailer.parse(Data("oops".utf8)) == nil)
    }

    // MARK: The service

    private static func lookupBody(_ ids: [String]) -> Data {
        Data((#"{"v":1,"status":"ok","tmdb":603,"tracks":["# + ids.map { track($0) }.joined(separator: ",") + "]}").utf8)
    }

    private static let vtt = Data("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n".utf8)

    func testLookupsAreKeptForTheSessionButFailuresAreNot() async throws {
        let failing = Shared(true)
        let http = StubHTTPClient { request in
            if request.url.path.hasSuffix("/trailer") {
                return ok(request, Data(#"{"v":1,"status":"ok","trailer":{"key":"vKQi3bBA1y8","name":"T"}}"#.utf8))
            }
            if failing.value { return ok(request, Data(#"{"v":1,"error":{"code":"unavailable"}}"#.utf8), status: 503) }
            return ok(request, ExtrasTests.lookupBody(["1-a"]))
        }
        let service = ExtrasService(http: http, cacheDirectory: nil)
        let query = try XCTUnwrap(SubtitleQuery.movie(movie("m:1", "The Matrix", tmdb: 603), match: nil))
        let first = await service.subtitles(query)
        XCTAssertEqual(first.tracks, [], "a failure is nothing")
        failing.value = false
        let second = await service.subtitles(query)
        XCTAssertEqual(second.tracks.map(\.id), ["1-a"], "and is asked again")
        let third = await service.subtitles(query)
        XCTAssertEqual(third, second)
        XCTAssertEqual(http.requests.count, 2, "a 200 answer is kept")
        let request = try XCTUnwrap(http.requests.last)
        XCTAssertEqual(request.timeout, 10)
        XCTAssertEqual(request.headers["User-Agent"], TunerLinks.lumanestUserAgent)
        XCTAssertNil(request.body)

        let trailerQuery = try XCTUnwrap(TrailerQuery.movie(movie("m:1", "The Matrix", tmdb: 603), match: nil))
        let trailer = await service.trailer(trailerQuery)
        XCTAssertEqual(trailer?.key, "vKQi3bBA1y8")
        _ = await service.trailer(trailerQuery)
        XCTAssertEqual(http.requests.count, 3)
    }

    func testEveryStatusIsKeptAndAtMost200Answers() async throws {
        let http = StubHTTPClient { request in ok(request, Data(#"{"v":1,"status":"none","tmdb":1,"tracks":[]}"#.utf8)) }
        let service = ExtrasService(http: http, cacheDirectory: nil)
        func query(_ id: Int) -> SubtitleQuery { SubtitleQuery(kind: .movie, title: .tmdb(id)) }
        for id in 1...200 { _ = await service.subtitles(query(id)) }
        _ = await service.subtitles(query(1))
        XCTAssertEqual(http.requests.count, 200, "a `none` answer is kept too")
        _ = await service.subtitles(query(201))
        _ = await service.subtitles(query(2))
        XCTAssertEqual(http.requests.count, 201, "the 201st answer pushes out the oldest only")
        _ = await service.subtitles(query(1))
        XCTAssertEqual(http.requests.count, 202, "the oldest was pushed out")
    }

    func testIdenticalLookupsInFlightShareOneRequest() async throws {
        let http = SlowHTTPClient(delay: { _ in 0.2 }) { request in ok(request, ExtrasTests.lookupBody(["1-a"])) }
        let service = ExtrasService(http: http, cacheDirectory: nil)
        let query = SubtitleQuery(kind: .episode(season: 1, episode: 2), title: .tmdb(1399))
        async let a = service.subtitles(query)
        async let b = service.subtitles(query)
        let (first, second) = await (a, b)
        XCTAssertEqual(first.tracks.map(\.id), ["1-a"])
        XCTAssertEqual(second, first)
        XCTAssertEqual(http.requests.count, 1)
    }

    func testAFileIsDownloadedOnceAndKeptOnTheDeviceForAWeek() async throws {
        let directory = makeTemporaryDirectory(self)
        let clock = Shared(start)
        let http = StubHTTPClient { request in ok(request, ExtrasTests.vtt) }
        let service = ExtrasService(http: http, cacheDirectory: directory, now: { clock.value })
        let subtitle = SubtitleTrack(id: "1-a", label: "English (OpenSubtitles)", hearingImpaired: false,
                                     vtt: URL(string: "https://lumanest.tv/api/extras/subtitles/file/1-a.vtt")!)
        let file = try await service.subtitleFile(subtitle)
        XCTAssertEqual(file.text(at: 1.5), "Hello")
        XCTAssertEqual(http.requests.count, 1)
        XCTAssertEqual(http.requests.first?.timeout, 20)
        XCTAssertEqual(http.requests.first?.url, subtitle.vtt)

        // Another session on the same device reads it from the cache folder.
        clock.value = start.addingTimeInterval(6 * 24 * 3600)
        let later = ExtrasService(http: http, cacheDirectory: directory, now: { clock.value })
        let kept = try await later.subtitleFile(subtitle)
        XCTAssertEqual(kept, file)
        XCTAssertEqual(http.requests.count, 1)

        // After 7 days it is downloaded again, and the old copy is replaced.
        clock.value = start.addingTimeInterval(7 * 24 * 3600 + 1)
        _ = try await later.subtitleFile(subtitle)
        XCTAssertEqual(http.requests.count, 2)
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".vtt") }
        XCTAssertEqual(names.count, 1)
        XCTAssertTrue(names.first?.hasSuffix("-\(Int64(clock.value.timeIntervalSince1970)).vtt") ?? false, "\(names)")

        await later.clearCache()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".vtt") }, [])
    }

    func testTheDeviceKeepsAtMost20Files() async throws {
        let directory = makeTemporaryDirectory(self)
        let clock = Shared(start)
        let http = StubHTTPClient { request in ok(request, ExtrasTests.vtt) }
        let service = ExtrasService(http: http, cacheDirectory: directory, now: { clock.value })
        func subtitle(_ index: Int) -> SubtitleTrack {
            SubtitleTrack(id: "\(index)-a", label: "x", hearingImpaired: false, vtt: URL(string: "https://lumanest.tv/api/extras/subtitles/file/\(index)-a.vtt")!)
        }
        for index in 1...21 {
            clock.value = start.addingTimeInterval(Double(index) * 60)
            _ = try await service.subtitleFile(subtitle(index))
        }
        let names = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".vtt") }
        XCTAssertEqual(names.count, 20)
        _ = try await service.subtitleFile(subtitle(21))
        XCTAssertEqual(http.requests.count, 21, "the newest is kept")
        _ = try await service.subtitleFile(subtitle(1))
        XCTAssertEqual(http.requests.count, 22, "the oldest went")
    }

    func testFilesThatFailAreNotKept() async throws {
        let directory = makeTemporaryDirectory(self)
        // An error answer is never read as a file, even one that would parse.
        let answers = Shared<[(Int, Data)]>([(200, Data("WEBVTT\n\nno cues here\n".utf8)), (503, ExtrasTests.vtt),
                                             (200, Data("1\n00:00:01,000 --> 00:00:02,000\nSRT\n".utf8))])
        let http = StubHTTPClient { request in
            let (status, body) = answers.mutate { $0.isEmpty ? (200, ExtrasTests.vtt) : $0.removeFirst() }
            return ok(request, body, status: status)
        }
        let service = ExtrasService(http: http, cacheDirectory: directory)
        let subtitle = SubtitleTrack(id: "1-a", label: "x", hearingImpaired: false, vtt: URL(string: "https://lumanest.tv/api/extras/subtitles/file/1-a.vtt")!)
        for _ in 0..<3 {
            do {
                _ = try await service.subtitleFile(subtitle)
                XCTFail("a file without cues, or a failed request, is an error")
            } catch {}
        }
        XCTAssertEqual(http.requests.count, 3)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { $0.hasSuffix(".vtt") }, [])

        // A file on another origin is never requested.
        let elsewhere = SubtitleTrack(id: "2-b", label: "x", hearingImpaired: false, vtt: URL(string: "https://evil.example.com/2-b.vtt")!)
        do {
            _ = try await service.subtitleFile(elsewhere)
            XCTFail("another origin")
        } catch {}
        XCTAssertEqual(http.requests.count, 3)
    }

    // MARK: WebVTT details beyond the shared cases

    func testALongCueStaysShownAcrossManyShortOnes() {
        var cues = [WebVTTCue(start: 0, end: 100_000, text: "Long")]
        for index in 0..<50 { cues.append(WebVTTCue(start: 1000 + index * 1000, end: 1500 + index * 1000, text: "Short \(index)")) }
        let file = WebVTT(cues: cues)
        XCTAssertEqual(file.text(atMilliseconds: 1200), "Long\nShort 0")
        XCTAssertEqual(file.text(atMilliseconds: 50_700), "Long")
        XCTAssertEqual(file.text(atMilliseconds: 99_999), "Long")
        XCTAssertEqual(file.text(atMilliseconds: 100_000), "")
        XCTAssertEqual(file.text(atMilliseconds: -1), "")
        XCTAssertEqual(file.text(at: 1.2004), "Long\nShort 0")
        XCTAssertEqual(file.text(at: 0.9996), "Long\nShort 0", "seconds round to the nearest millisecond")
        XCTAssertEqual(file.text(at: 0.9994), "Long")
        XCTAssertEqual(file.text(at: .nan), "")
    }

    func testTimingLinesAreRead() {
        XCTAssertEqual(WebVTT.timing(ArraySlice("00:01.000 --> 00:02.000".utf8))?.0, 1000)
        XCTAssertEqual(WebVTT.timing(ArraySlice("100:00:00.000\t-->\t100:00:01.500 align:start".utf8))?.1, 360_001_500)
        for bad in ["00:01.000 -->00:02.000", "00:01.000--> 00:02.000", "0:01.000 --> 00:02.000", "00:01.00 --> 00:02.000",
                    "00:01.0000 --> 00:02.000", "00:01,000 --> 00:02,000", "00:01.000 --> 00:02.000x", "00:60.000 --> 01:00.000",
                    "000:01.000 --> 00:02.000", " 00:01.000 --> 00:02.000", "99999999999999999999:00:00.000 --> 00:02.000"] {
            XCTAssertNil(WebVTT.timing(ArraySlice(bad.utf8)), bad)
        }
        // Markup is never rendered: tags go, the six entities decode once, anything else stays text.
        let file = WebVTT(parsing: "WEBVTT\n\n00:00.000 --> 00:01.000\n<script>alert(1)</script> &lt;i&gt; a < b &copy; <unclosed\n")
        XCTAssertEqual(file.cues.first?.text, "alert(1) <i> a < b &copy; <unclosed")
        // A third line holding --> is text, not a timing line.
        XCTAssertEqual(WebVTT(parsing: "WEBVTT\n\nid\nnote\n00:00.000 --> 00:01.000\nX\n").cues, [])
        XCTAssertEqual(WebVTT(parsing: "WEBVTTX\n\n00:00.000 --> 00:01.000\nX\n").cues, [])
        XCTAssertEqual(WebVTT(parsing: "WEBVTT\r\r00:00.000 --> 00:01.000\rX\r").cues.map(\.text), ["X"])
    }

    // MARK: Automatic choice

    func testTheAutomaticChoiceOrder() {
        let english = ExternalSubtitle(url: URL(string: "http://p.example.com/en.srt")!, language: "en")
        let spanish = ExternalSubtitle(url: URL(string: "http://p.example.com/es.srt")!, language: "es")
        XCTAssertEqual(SubtitleAutoChoice.choose(embeddedEnglish: true, embeddedCount: 2, provider: [english], openSubtitles: 2), .embeddedEnglish)
        XCTAssertEqual(SubtitleAutoChoice.choose(embeddedEnglish: false, embeddedCount: 2, provider: [spanish, english], openSubtitles: nil), .provider(1))
        XCTAssertEqual(SubtitleAutoChoice.choose(embeddedEnglish: false, embeddedCount: 1, provider: [spanish], openSubtitles: 3), .openSubtitles(0))
        XCTAssertNil(SubtitleAutoChoice.choose(embeddedEnglish: false, embeddedCount: 1, provider: [spanish], openSubtitles: nil),
                     "waits for the lookup")
        XCTAssertEqual(SubtitleAutoChoice.choose(embeddedEnglish: false, embeddedCount: 1, provider: [spanish], openSubtitles: 0), .embeddedOther)
        XCTAssertEqual(SubtitleAutoChoice.choose(embeddedEnglish: false, embeddedCount: 0, provider: [spanish], openSubtitles: 0), .provider(0))
        XCTAssertEqual(SubtitleAutoChoice.choose(embeddedEnglish: false, embeddedCount: 0, provider: [], openSubtitles: 0), .nothing)
        XCTAssertTrue(SubtitleAutoChoice.isEnglish(ExternalSubtitle(url: URL(string: "http://p.example.com/1.srt")!, label: "English SDH")))
        XCTAssertTrue(SubtitleAutoChoice.isEnglish(ExternalSubtitle(url: URL(string: "http://p.example.com/1.srt")!, language: "en-US")))
        XCTAssertFalse(SubtitleAutoChoice.isEnglish(spanish))
    }
}
