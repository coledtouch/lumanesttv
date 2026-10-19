import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

/// An HTTP client whose answers can take (real) time, for concurrency tests.
final class SlowHTTPClient: HTTPClient, @unchecked Sendable {
    private let handler: @Sendable (HTTPRequestSpec) throws -> HTTPResult
    private let delay: @Sendable (HTTPRequestSpec) -> Double
    private let state = Shared((inFlight: 0, peak: 0, requests: [HTTPRequestSpec]()))

    init(delay: @escaping @Sendable (HTTPRequestSpec) -> Double, handler: @escaping @Sendable (HTTPRequestSpec) throws -> HTTPResult) {
        self.delay = delay
        self.handler = handler
    }

    var peak: Int { state.value.peak }
    var requests: [HTTPRequestSpec] { state.value.requests }

    func raw(_ request: HTTPRequestSpec) async throws -> HTTPResult {
        state.mutate { $0.inFlight += 1; $0.peak = max($0.peak, $0.inFlight); $0.requests.append(request) }
        defer { state.mutate { $0.inFlight -= 1 } }
        let seconds = delay(request)
        if seconds > 0 { try await Task.sleep(nanoseconds: UInt64(seconds * 1e9)) }
        var result = try handler(request)
        if Gzip.isGzip(result.body) { result.body = try Gzip.decompress(result.body) }
        return result
    }

    func data(_ request: HTTPRequestSpec) async throws -> HTTPResult {
        let result = try await raw(request)
        guard (200..<300).contains(result.status) else { throw TunerError.serverStatus(result.status) }
        return result
    }

    func download(_ request: HTTPRequestSpec, to destination: URL) async throws -> HTTPResult {
        let result = try await data(request)
        try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try result.body.write(to: destination, options: .atomic)
        return HTTPResult(status: result.status, headers: result.headers, finalURL: result.finalURL, body: Data())
    }
}

final class CatalogServiceTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_791_842_400)

    private func service(_ directory: URL, http: any HTTPClient, now: Shared<Date>, edition: Edition = .appStore) -> CatalogService {
        CatalogService(cacheDirectory: directory, http: http, edition: edition, now: { now.value })
    }

    func testXtreamLoadFiltersAdultContentBeforeAnythingIsCached() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = xtreamPanel()
        let clock = Shared(start)
        let catalog = service(directory, http: http, now: clock)
        await catalog.load(demoSource, options: CatalogOptions())
        let state = await catalog.state
        XCTAssertEqual(state.sourceID, "src-1")
        XCTAssertEqual(state.livePhase, .ready)
        XCTAssertEqual(state.moviesPhase, .ready)
        XCTAssertEqual(state.seriesPhase, .ready)

        let live = try XCTUnwrap(state.live)
        XCTAssertEqual(live.channels.map(\.key), ["x:101", "x:103", "x:104", "x:106", "x:112", "x:113"])
        XCTAssertEqual(live.channels.map(\.name), ["CNN", "ESPN", "UK: BBC One", "Cartoons", "FOX 5 (WNYW) New York", "Unsorted Feed"])
        XCTAssertEqual(live.channels[0].backups.map(\.lastPathComponent), ["102.ts"], "the backup copy folds into CNN")
        XCTAssertEqual(live.aliases, ["x:102": "x:101"])
        XCTAssertEqual(live.categories.map(\.id), ["1", "2", "3", "5", "8", "__tuner_live"])
        XCTAssertNil(live.playlistGuideURL)

        let movies = try XCTUnwrap(state.movies)
        XCTAssertEqual(movies.movies.map(\.id), ["m:900", "m:902", "m:903", "m:907", "m:908"])
        XCTAssertEqual(movies.movie(id: "m:908")?.backups.map(\.lastPathComponent), ["909.mp4"])
        XCTAssertEqual(movies.categories.map(\.id), ["20", "21", "22", "24"])
        let shows = try XCTUnwrap(state.series)
        XCTAssertEqual(shows.series.map(\.id), ["s:331", "s:332"])
        XCTAssertEqual(shows.series(id: "s:331")?.name, "The Last of Us (2023)")

        // Nothing adult reaches the disk.
        SnapshotFiles.drain()
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(files.filter { $0.hasPrefix("live-") }.count, 1)
        XCTAssertEqual(files.filter { $0.hasPrefix("movies-") }.count, 1)
        XCTAssertEqual(files.filter { $0.hasPrefix("series-") }.count, 1)
        for file in files {
            let text = String(decoding: try Data(contentsOf: directory.appendingPathComponent(file)), as: UTF8.self)
            for adult in ["Hot Channel", "PLAYBOY", "Night Show", "Flagged", "Movies Plus", "Night Movie", "XXX Parody", "After Dark"] {
                XCTAssertFalse(text.contains(adult), "\(file) contains \(adult)")
            }
        }
        let actions = http.requests.map(xtreamAction)
        XCTAssertEqual(Set(actions), ["get_live_categories", "get_live_streams", "get_vod_categories", "get_vod_streams",
                                      "get_series_categories", "get_series"])
    }

    func testFreshSnapshotsArePublishedWithoutTheNetwork() async throws {
        let directory = makeTemporaryDirectory(self)
        let clock = Shared(start)
        let first = service(directory, http: xtreamPanel(), now: clock)
        await first.load(demoSource, options: CatalogOptions())
        SnapshotFiles.drain()

        clock.value = start.addingTimeInterval(60 * 60)
        let offline = StubHTTPClient { _ in throw URLError(.notConnectedToInternet) }
        let second = service(directory, http: offline, now: clock)
        await second.load(demoSource, options: CatalogOptions())
        let state = await second.state
        XCTAssertEqual(state.live?.channels.count, 6)
        XCTAssertEqual(state.movies?.movies.count, 5)
        XCTAssertEqual(state.series?.series.count, 2)
        XCTAssertTrue(offline.requests.isEmpty, "everything was fresh")
    }

    func testStaleLiveRefreshesAloneAndFailuresKeepTheSnapshot() async throws {
        let directory = makeTemporaryDirectory(self)
        let clock = Shared(start)
        await service(directory, http: xtreamPanel(), now: clock).load(demoSource, options: CatalogOptions())
        SnapshotFiles.drain()

        clock.value = start.addingTimeInterval(3 * 3600) // live TTL 2 h, VOD 12 h
        let http = xtreamPanel()
        await service(directory, http: http, now: clock).load(demoSource, options: CatalogOptions())
        XCTAssertEqual(Set(http.requests.map(xtreamAction)), ["get_live_categories", "get_live_streams"])

        clock.value = start.addingTimeInterval(13 * 3600)
        let failing = StubHTTPClient { _ in throw URLError(.timedOut) }
        let catalog = service(directory, http: failing, now: clock)
        await catalog.load(demoSource, options: CatalogOptions())
        let state = await catalog.state
        XCTAssertEqual(state.livePhase, .ready, "a failed refresh keeps the snapshot visible")
        XCTAssertEqual(state.live?.channels.count, 6)
        XCTAssertEqual(state.moviesPhase, .ready)
        XCTAssertEqual(Set(failing.requests.map(xtreamAction)).count, 6)

        // Snapshots older than 7 days are discarded.
        clock.value = start.addingTimeInterval(8 * 86400)
        let old = service(directory, http: failing, now: clock)
        await old.load(demoSource, options: CatalogOptions())
        let empty = await old.state
        XCTAssertNil(empty.live)
        XCTAssertEqual(empty.livePhase, .failed("The server took too long to respond."))
        XCTAssertEqual(empty.moviesPhase, .failed("The server took too long to respond."))
    }

    func testForcedLoadsRefreshEverything() async {
        let directory = makeTemporaryDirectory(self)
        let clock = Shared(start)
        let http = xtreamPanel()
        let catalog = service(directory, http: http, now: clock)
        await catalog.load(demoSource, options: CatalogOptions())
        let before = http.requests.count
        await catalog.load(demoSource, options: CatalogOptions())
        XCTAssertEqual(http.requests.count, before, "a plain reload of fresh data stays offline")
        await catalog.load(demoSource, options: CatalogOptions(), force: true)
        XCTAssertEqual(http.requests.count, before * 2)
    }

    func testOptionsReapplyWithoutADownload() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = xtreamPanel()
        let catalog = service(directory, http: http, now: Shared(start))
        await catalog.load(demoSource, options: CatalogOptions())
        let requests = http.requests.count

        await catalog.apply(CatalogOptions(usOnly: true), source: demoSource)
        let applied = await catalog.state.live
        var live = try XCTUnwrap(applied)
        XCTAssertEqual(live.channels.map(\.key), ["x:101", "x:103", "x:106", "x:112"], "BBC (GB) and the unlabelled feed are not USA")
        XCTAssertFalse(live.categories.contains { $0.id == "3" })

        await catalog.apply(CatalogOptions(usOnly: false, hiddenChannels: ["x:101", "x:102", "x:104"]), source: demoSource)
        let hidden = await catalog.state.live
        live = try XCTUnwrap(hidden)
        XCTAssertEqual(live.channels.map(\.key), ["x:103", "x:106", "x:112", "x:113"])
        XCTAssertEqual(http.requests.count, requests, "re-filtered in memory")

        // A different identity (USA only) with no in-memory parse loads from the network.
        SnapshotFiles.drain()
        let other = service(directory, http: http, now: Shared(start))
        await other.load(demoSource, options: CatalogOptions(usOnly: true))
        let otherCount = await other.state.live?.channels.count
        XCTAssertEqual(otherCount, 4)
        XCTAssertGreaterThan(http.requests.count, requests)
    }

    func testReFilteringDoesNotMakeOldDataFresh() async {
        let directory = makeTemporaryDirectory(self)
        let clock = Shared(start)
        let http = xtreamPanel()
        let catalog = service(directory, http: http, now: clock)
        await catalog.load(demoSource, options: CatalogOptions())
        clock.value = start.addingTimeInterval(3 * 3600)
        await catalog.apply(CatalogOptions(usOnly: true), source: demoSource)
        let updated = await catalog.state.live?.updated
        XCTAssertEqual(updated, start, "a lineup is as old as its download")
        let before = http.requests.count
        await catalog.load(demoSource, options: CatalogOptions(usOnly: true))
        XCTAssertEqual(Set(http.requests.dropFirst(before).map(xtreamAction)), ["get_live_categories", "get_live_streams"])
    }

    func testIdentityCoversSourceOptionsAndEdition() {
        let base = CatalogService.identity(source: demoSource, options: CatalogOptions(), edition: .appStore)
        XCTAssertEqual(base, CatalogService.identity(source: demoSource, options: CatalogOptions(), edition: .appStore))
        XCTAssertEqual(base.count, 64)
        var renamed = demoSource
        renamed.password = "other"
        XCTAssertNotEqual(base, CatalogService.identity(source: renamed, options: CatalogOptions(), edition: .appStore))
        XCTAssertNotEqual(base, CatalogService.identity(source: demoSource, options: CatalogOptions(usOnly: true), edition: .appStore))
        XCTAssertNotEqual(base, CatalogService.identity(source: demoSource, options: CatalogOptions(hiddenChannels: ["x"]), edition: .appStore))
        XCTAssertNotEqual(base, CatalogService.identity(source: demoSource, options: CatalogOptions(), edition: .direct))
        XCTAssertEqual(CatalogService.identity(source: demoSource, options: CatalogOptions(hiddenChannels: ["a", "b"]), edition: .appStore),
                       CatalogService.identity(source: demoSource, options: CatalogOptions(hiddenChannels: ["b", "a"]), edition: .appStore))
    }

    func testPlaylistSourcesBuildSeriesAndSkipVODInfo() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = StubHTTPClient { request in
            request.url.path == "/get/playlist" ? ok(request, Fixture.data("playlist.m3u")) : ok(request, Data(), status: 404)
        }
        let source = Source(id: "pl", kind: .m3u, playlistURL: "https://tv.example.com/get/playlist?u=a&p=b")
        let catalog = service(directory, http: http, now: Shared(start))
        await catalog.load(source, options: CatalogOptions())
        let state = await catalog.state
        XCTAssertEqual(state.live?.channels.map(\.name), ["CNN", "BBC One", "Sky News, Live", "Channel 5", "Fallback Name"],
                       "the \"XXX Adults\" group is gone")
        XCTAssertEqual(state.live?.playlistGuideURL?.absoluteString, "http://epg.example.com/guide.xml.gz")
        XCTAssertEqual(state.movies?.movies.map(\.name), ["Inside Out 2 (2024)"], "the MKV film is left out")
        XCTAssertEqual(state.series?.series.map(\.name), ["The Last of Us", "Severance"])
        XCTAssertEqual(http.requests.count, 1, "one download feeds every catalogue")

        let tlou = try XCTUnwrap(state.series?.series.first)
        let info = try await catalog.seriesInfo(for: tlou, source: source)
        XCTAssertEqual(info.seasonNumbers, [1])
        XCTAssertEqual(info.seasons[1]?.map(\.number), [1, 2])
        let severance = try XCTUnwrap(state.series?.series.last)
        let unplayable = try await catalog.seriesInfo(for: severance, source: source)
        XCTAssertEqual(unplayable.allEpisodes.map(\.isPlayable), [false], "kept, reported as not playable")
        let movieInfo = try await catalog.movieInfo(for: try XCTUnwrap(state.movies?.movies.first), source: source)
        XCTAssertEqual(movieInfo, MovieInfo())
        XCTAssertEqual(http.requests.count, 1)

        // A fresh service finds the playlist episodes in the series snapshot.
        SnapshotFiles.drain()
        let offline = StubHTTPClient { _ in throw URLError(.notConnectedToInternet) }
        let restored = service(directory, http: offline, now: Shared(start.addingTimeInterval(60)))
        await restored.load(source, options: CatalogOptions())
        let again = try await restored.seriesInfo(for: tlou, source: source)
        XCTAssertEqual(again.allEpisodes.count, 2)
        XCTAssertTrue(offline.requests.isEmpty)
    }

    func testDetailsAreFetchedOnceAndCached() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = xtreamPanel()
        let catalog = service(directory, http: http, now: Shared(start))
        await catalog.load(demoSource, options: CatalogOptions())
        let loadedState = await catalog.state
        let dune = try XCTUnwrap(loadedState.movies?.movie(id: "m:900"))
        let info = try await catalog.movieInfo(for: dune, source: demoSource)
        XCTAssertEqual(info.director, "Denis Villeneuve")
        _ = try await catalog.movieInfo(for: dune, source: demoSource)
        let show = try XCTUnwrap(loadedState.series?.series(id: "s:331"))
        let seriesInfo = try await catalog.seriesInfo(for: show, source: demoSource)
        XCTAssertEqual(seriesInfo.seasonNumbers, [0, 1, 2])
        _ = try await catalog.seriesInfo(for: show, source: demoSource)
        XCTAssertEqual(http.requests.map(xtreamAction).filter { $0.hasSuffix("_info") }, ["get_vod_info", "get_series_info"])
        XCTAssertEqual(queryValue(http.requests.last { xtreamAction($0) == "get_series_info" }!, "series_id"), "331")
    }

    func testFailuresWithoutSnapshotsReportTheReason() async {
        let directory = makeTemporaryDirectory(self)
        let catalog = service(directory, http: xtreamPanel(overrides: ["get_live_streams": Data("<html>".utf8)], failing: ["get_vod_streams"]),
                              now: Shared(start))
        await catalog.load(demoSource, options: CatalogOptions())
        let state = await catalog.state
        XCTAssertEqual(state.livePhase, .failed("The server sent something Tuner couldn't read."))
        XCTAssertEqual(state.moviesPhase, .failed("The server took too long to respond."))
        XCTAssertEqual(state.seriesPhase, .ready)

        let noLogin = Source(id: "broken", kind: .xtream, server: "http://h.example.com")
        await catalog.load(noLogin, options: CatalogOptions())
        let phase = await catalog.state.livePhase
        XCTAssertEqual(phase, .failed("Login failed. Check the username and password."))
    }

    func testStatesStreamResetAndClearCaches() async throws {
        let directory = makeTemporaryDirectory(self)
        let catalog = service(directory, http: xtreamPanel(), now: Shared(start))
        let stream = await catalog.states()
        var iterator = stream.makeAsyncIterator()
        let initial = await iterator.next()
        XCTAssertEqual(initial, CatalogState())
        await catalog.load(demoSource, options: CatalogOptions())
        var latest = await iterator.next()
        while latest?.livePhase != .ready || latest?.moviesPhase != .ready || latest?.seriesPhase != .ready { latest = await iterator.next() }
        XCTAssertEqual(latest?.live?.channels.count, 6)

        await catalog.clearCaches()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
        let kept = await catalog.state.live
        XCTAssertNotNil(kept, "the published state stays until the next load")

        await catalog.reset()
        let afterReset = await catalog.state
        XCTAssertEqual(afterReset, CatalogState())
        let reset = await iterator.next()
        XCTAssertEqual(reset, CatalogState())
    }

    func testTheNewestLoadWins() async throws {
        let directory = makeTemporaryDirectory(self)
        let slowServer = "slow.example.com"
        let http = SlowHTTPClient(delay: { $0.url.host == slowServer ? 0.3 : 0 }) { request in
            let action = xtreamAction(request)
            let files = ["get_live_categories": "live_categories", "get_live_streams": "live_streams", "get_vod_categories": "vod_categories",
                         "get_vod_streams": "vod_streams", "get_series_categories": "series_categories", "get_series": "series"]
            return ok(request, Fixture.data("xtream/\(files[action] ?? "account").json"))
        }
        let catalog = service(directory, http: http, now: Shared(start))
        let slow = Source(id: "slow", kind: .xtream, server: "http://\(slowServer)", username: "u", password: "p")
        let first = Task { await catalog.load(slow, options: CatalogOptions()) }
        try await Task.sleep(nanoseconds: 50_000_000)
        await catalog.load(demoSource, options: CatalogOptions())
        await first.value
        let state = await catalog.state
        XCTAssertEqual(state.sourceID, "src-1")
        XCTAssertEqual(state.live?.channels.count, 6)
        XCTAssertFalse(state.live?.channels.contains { $0.url.host == slowServer } ?? true, "the older load never published")
        XCTAssertFalse(state.movies?.movies.contains { $0.url.host == slowServer } ?? true)
    }
}

final class GuideServiceTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_791_842_400)
    private lazy var lineup = LiveLineup(channels: [channel("x:cnn", "CNN", epg: "CNN.us"), channel("x:sky", "Sky News"), channel("x:hbo", "HBO"),
                                                    channel("x:101", "Local One"), channel("x:102", "Local Two")],
                                         categories: [], updated: now)

    func testProviderGuideLoadsCachesAndRestores() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = xtreamPanel()
        let clock = Shared(now)
        let guide = GuideService(cacheDirectory: directory, http: http, now: { clock.value })
        await guide.load(source: demoSource, lineup: lineup)
        var schedule = await guide.schedule
        XCTAssertEqual(schedule.programs["x:cnn"]?.map(\.title), ["The Situation Room", "Erin Burnett OutFront", "Overlaps the end"])
        XCTAssertEqual(schedule.programs["x:sky"]?.count, 2)
        XCTAssertEqual(schedule.icons["x:cnn"]?.lastPathComponent, "cnn.png")
        XCTAssertNil(schedule.programs["x:101"])
        XCTAssertEqual(http.requests.map(xtreamAction), ["xmltv"])
        XCTAssertEqual(http.requests.first?.url.absoluteString, "http://line.example.com:8080/xmltv.php?username=demo&password=s3cret+pass")

        // A new service publishes the snapshot (next 8 h) at once, and a failed download keeps the stale file.
        SnapshotFiles.drain()
        clock.value = now.addingTimeInterval(1800)
        let offline = StubHTTPClient { _ in throw URLError(.timedOut) }
        let restored = GuideService(cacheDirectory: directory, http: offline, now: { clock.value })
        let updates = await restored.schedules()
        var iterator = updates.makeAsyncIterator()
        let initial = await iterator.next()
        XCTAssertEqual(initial, GuideSchedule())
        await restored.load(source: demoSource, lineup: lineup, force: true)
        let firstPublished = await iterator.next()
        XCTAssertEqual(firstPublished?.programs["x:cnn"]?.count, 3, "the snapshot")
        schedule = await restored.schedule
        XCTAssertEqual(schedule.programs["x:cnn"]?.count, 3)
        XCTAssertEqual(offline.requests.count, 1)

        // Within 6 h the downloaded file is reused.
        clock.value = now.addingTimeInterval(3600)
        await guide.load(source: demoSource, lineup: lineup)
        XCTAssertEqual(http.requests.count, 1)
        clock.value = now.addingTimeInterval(7 * 3600)
        await guide.load(source: demoSource, lineup: lineup)
        XCTAssertEqual(http.requests.count, 2)
        let lateSchedule = await guide.schedule
        XCTAssertNil(lateSchedule.programs["x:cnn"], "nothing left on air from the fixture")
    }

    func testPlaylistGuidesUseTheirOwnLinkAndNothingElse() async {
        let directory = makeTemporaryDirectory(self)
        let http = StubHTTPClient { ok($0, Fixture.data("guide.xml")) }
        let guide = GuideService(cacheDirectory: directory, http: http, now: { [now] in now })
        let playlist = Source(id: "pl", kind: .m3u, playlistURL: "https://tv.example.com/m3u")
        var withLink = lineup
        withLink.playlistGuideURL = URL(string: "http://epg.example.com/guide.xml.gz")
        await guide.load(source: playlist, lineup: withLink)
        XCTAssertEqual(http.requests.map(\.url.absoluteString), ["http://epg.example.com/guide.xml.gz"])
        let playlistSchedule = await guide.schedule
        XCTAssertEqual(playlistSchedule.programs["x:cnn"]?.count, 3)

        let override = Source(id: "pl2", kind: .m3u, playlistURL: "https://tv.example.com/m3u", guideURL: "https://guide.example.com/custom.xml")
        await guide.load(source: override, lineup: withLink)
        XCTAssertEqual(http.requests.last?.url.absoluteString, "https://guide.example.com/custom.xml")

        let none = Source(id: "pl3", kind: .m3u, playlistURL: "https://tv.example.com/m3u")
        await guide.load(source: none, lineup: lineup)
        XCTAssertEqual(http.requests.count, 2, "no guide link: no third-party fallback")
        await guide.load(source: demoSource, lineup: LiveLineup(channels: [], categories: [], updated: now))
        XCTAssertEqual(http.requests.count, 2, "no channels: nothing to fetch")
    }

    func testShortEPGFillsGapsOncePerChannelWithAtMostFourRequests() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = SlowHTTPClient(delay: { _ in 0.02 }) { request in
            switch xtreamAction(request) {
            case "xmltv": return ok(request, Fixture.data("guide.xml"))
            default:
                let start = Int(1_791_842_400 - 600)
                let body = #"{"epg_listings":[{"title":"U2hvcnQ=","start_timestamp":"\#(start)","stop_timestamp":"\#(start + 3600)"}]}"#
                return ok(request, Data(body.utf8))
            }
        }
        let guide = GuideService(cacheDirectory: directory, http: http, now: { [now] in now })
        await guide.load(source: demoSource, lineup: lineup)
        let many = lineup.channels + (200..<210).map { channel("x:\($0)", "Extra \($0)") }
        await guide.requestShortEPG(for: many, source: demoSource)
        let schedule = await guide.schedule
        XCTAssertEqual(schedule.programs["x:101"]?.first?.title, "Short")
        XCTAssertEqual(schedule.programs["x:205"]?.first?.title, "Short")
        XCTAssertEqual(schedule.programs["x:cnn"]?.first?.title, "The Situation Room", "channels with guide data are not asked")
        let shortRequests = http.requests.filter { xtreamAction($0) == "get_short_epg" }
        XCTAssertEqual(shortRequests.count, 12)
        XCTAssertEqual(Set(shortRequests.compactMap { queryValue($0, "limit") }), ["24"])
        XCTAssertLessThanOrEqual(http.peak, 4)
        await guide.requestShortEPG(for: many, source: demoSource)
        XCTAssertEqual(http.requests.filter { xtreamAction($0) == "get_short_epg" }.count, 12, "once per channel per load")
        await guide.requestShortEPG(for: many, source: Source(id: "pl", kind: .m3u, playlistURL: "https://x.example.com/m3u"))
        XCTAssertEqual(http.requests.filter { xtreamAction($0) == "get_short_epg" }.count, 12, "playlists have no short EPG")
    }

    func testLogosAreCachedForAWeek() async throws {
        let directory = makeTemporaryDirectory(self)
        let http = StubHTTPClient { ok($0, Fixture.data("logos.json")) }
        let clock = Shared(now)
        let guide = GuideService(cacheDirectory: directory, http: http, now: { clock.value })
        let index = await guide.logos()
        XCTAssertNotNil(index.logo(for: channel("a", "CNN"), xmltvIcon: nil))
        _ = await guide.logos()
        XCTAssertEqual(http.requests.map(\.url), [TunerLinks.logos])
        let fresh = GuideService(cacheDirectory: directory, http: http, now: { clock.value })
        _ = await fresh.logos()
        XCTAssertEqual(http.requests.count, 1, "read from the cache file")
        clock.value = now.addingTimeInterval(8 * 86400)
        let stale = GuideService(cacheDirectory: directory, http: StubHTTPClient { _ in throw URLError(.timedOut) }, now: { clock.value })
        let staleIndex = await stale.logos()
        XCTAssertNotNil(staleIndex.logo(for: channel("a", "CNN"), xmltvIcon: nil), "a stale index beats none")
        await stale.clearCaches()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }
}
