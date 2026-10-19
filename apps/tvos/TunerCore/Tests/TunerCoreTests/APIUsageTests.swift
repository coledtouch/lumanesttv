import Foundation
import XCTest
@testable import TunerCore

/// Compile-only check that the API is usable the way the app will use it (bodies are stubs; not run).
final class APIUsageTests: XCTestCase {
    func testEditionIsAppStore() {
        XCTAssertEqual(Edition.current, .appStore)
    }

    func compileOnlyUsage() async throws {
        let http = URLSessionHTTPClient()
        let caches = FileManager.default.temporaryDirectory
        let catalog = CatalogService(cacheDirectory: caches.appendingPathComponent("Catalog"), http: http)
        let guide = GuideService(cacheDirectory: caches.appendingPathComponent("Guide"), http: http)
        let rowsService = CatalogRowsService(cacheDirectory: caches.appendingPathComponent("Rows"),
                                             http: URLSessionHTTPClient(userAgent: TunerLinks.lumanestUserAgent))
        let store = InMemoryKeyValueStore()
        let sources = SourceStore(store: store, secrets: InMemorySecretStore())
        let library = UserLibrary(store: store)
        guard let source = sources.active() else { return }
        let settings = library.settings
        await catalog.load(source, options: CatalogOptions(usOnly: settings.usOnly, hiddenChannels: library.deadChannels(sourceID: source.id)))
        let rows = await rowsService.rows()
        for await state in await catalog.states() {
            if let live = state.live {
                library.canonicalize(sourceID: source.id, aliases: live.aliases)
                await guide.load(source: source, lineup: live)
                let chips = GuideLineup.chips(live.categories, order: settings.categoryOrder)
                let channels = GuideLineup.channels(for: chips[0].chip, lineup: live, favorites: library.favorites(sourceID: source.id),
                                                    mostWatched: library.mostWatched(sourceID: source.id))
                let schedule = await guide.schedule
                let now = Date()
                for channel in channels.prefix(10) {
                    _ = schedule.filled(forKey: channel.key, channelName: channel.name, window: DateInterval(start: now, duration: 9000))
                }
                _ = live.neighbor(of: channels[0].key, offset: 1, in: channels, hidden: library.deadChannels(sourceID: source.id))
            }
            let index = BrowseIndex(movies: state.movies, series: state.series, rows: rows, usOnly: settings.titlesUSOnly)
            let snapshot = library.snapshot(sourceID: source.id)
            for row in index.homeRows(library: snapshot) {
                for poster in row.items { _ = (poster.title.name, poster.title.poster, poster.progress, poster.inLibrary, poster.caption) }
                switch row.seeAll {
                case .discover(let query): _ = index.discover(query, library: snapshot)
                case .library: _ = index.library(snapshot)
                }
            }
            for list in index.lists(for: .series) { _ = list.title }
            _ = index.genres(for: .movie).map { GenreOption(id: $0.id, name: $0.name) }
            _ = CatalogSearch.run("news", lineup: state.live, index: index, library: snapshot)
            if index.usesTMDB { _ = TunerLinks.tmdbAttribution }
            if let series = index.series.first {
                let info = try await catalog.seriesInfo(for: series, source: source)
                let season = SeriesNavigation.defaultSeason(info, returningTo: nil, recents: snapshot.recents)
                _ = season.map { SeriesInfo.seasonTitle($0) }
                if let point = SeriesNavigation.resumePoint(info, seriesID: series.id, recents: snapshot.recents) {
                    _ = SeriesNavigation.queue(after: point.episode, in: info)
                }
            }
            break
        }

        let server = MediaServer(transport: URLSessionUpstreamTransport())
        await server.setOrigin(URL(string: "http://127.0.0.1:49152")!)
        let session = try await server.tuneLive(LiveTuneRequest(channelKey: "x:1", channelName: "One", sources: [URL(string: "http://example.com/live/u/p/1.ts")!]))
        let events = await session.events()
        let ready = try await session.waitUntilReady()
        switch ready.route {
        case .loopback(let url), .direct(let url): _ = url
        }
        for await event in events {
            switch event {
            case .failed(let failure): _ = (failure.message, failure.retiresChannel)
            case .audioUnsupported, .waitingForLine, .rejoining: break
            default: break
            }
            break
        }
        await session.stop()

        let head = HTTPRequestHead.parse(Data("GET / HTTP/1.1\r\n\r\n".utf8))
        if case .complete(let request, _) = head {
            let response = await server.respond(to: request)
            _ = response.serializedHead()
            if case .stream(let body) = response.body { for try await chunk in body { _ = chunk } }
        }

        let pairing = PairingLoop(client: PairingClient(http: URLSessionHTTPClient(userAgent: TunerLinks.lumanestUserAgent)))
        for await status in pairing.run() {
            switch status {
            case .gettingCode, .retrying: break
            case .waiting(let code): _ = QRMatrix(rows: code.qr)
            case .paired(let source): sources.save(source); sources.setActive(id: source.id)
            }
        }

        var segmenter = TSSegmenter()
        for output in segmenter.push(Data()) { if case .segment(let s) = output { _ = s.duration } }
        _ = HLSPlaylistWriter.media([HLSSegmentEntry(sequence: 0, duration: 2, discontinuity: false)], targetDuration: 6, discontinuitySequence: 0) { "\($0).ts" }
        _ = SubtitleParser.cue(at: 1, in: SubtitleParser.parse(Data(), format: .srt))
        _ = AdultFilter.isAdultName("XXX", mode: Edition.current.adultFilterMode)
        _ = TitleRegion.isForeignCategory("FR | Films")
        _ = TitleNormalizer.normalize("The Batman (2022) [4K]")
        let clock = ManualClock()
        clock.advance(by: 1)
    }
}
