import Foundation
import XCTest
@testable import TunerCore

private let origin = URL(string: "http://127.0.0.1:49152")!
private let primary = URL(string: "http://line.example.com/live/u/p/1.ts")!
private let backup = URL(string: "http://line.example.com/live/u/p/2.ts")!

/// `frames` of `stream` in chunks of `perChunk` frames, paced in real (clock) time: 25 frames per second.
func liveChunks(_ stream: TSTestStream, _ frames: Range<Int>, perChunk: Int = 5) -> [(Double, Data)] {
    var chunks: [(Double, Data)] = []
    var start = frames.lowerBound
    while start < frames.upperBound {
        let end = min(frames.upperBound, start + perChunk)
        chunks.append((chunks.isEmpty ? 0 : Double(perChunk) / 25, stream.frames(start..<end)))
        start = end
    }
    return chunks
}

/// A live session on a manual clock with its events recorded.
final class LiveHarness: @unchecked Sendable {
    let clock = ManualClock()
    let transport: StubUpstreamTransport
    let session: LiveChannelSession
    let events = Recorder<LiveSessionEvent>()

    init(sources: [URL] = [primary], request: LiveTuneRequest? = nil, config: LiveSessionConfig = LiveSessionConfig(),
         script: @escaping @Sendable (UpstreamRequest, Int) -> StubUpstreamTransport.Script) async {
        transport = StubUpstreamTransport(clock: clock, handler: script)
        session = LiveChannelSession(id: "s1", request: request ?? LiveTuneRequest(channelKey: "x:1", channelName: "One", sources: sources),
                                     origin: origin, transport: transport, config: config, clock: clock)
        let stream = await session.events()
        let events = self.events
        Task.detached { for await event in stream { events.append(event) } }
        await session.start()
    }

    var failure: PlaybackFailure? {
        for event in events.values { if case .failed(let failure) = event { return failure } }
        return nil
    }

    var ready: LiveReady? {
        for event in events.values { if case .ready(let ready) = event { return ready } }
        return nil
    }

    func count(_ match: (LiveSessionEvent) -> Bool) -> Int { events.values.filter(match).count }

    @discardableResult
    func drive(limit: Double = 60, until condition: @escaping () async -> Bool) async -> Bool {
        await TunerCoreTests.drive(clock, step: 0.05, limit: limit, until: condition)
    }
}

final class LiveSessionTests: XCTestCase {
    func testReadyAfterTwoSegmentsAndServesHLS() async throws {
        let stream = TSTestStream { $0.captions = true }
        let harness = await LiveHarness { _, _ in .init(chunks: liveChunks(stream, 0..<500), endless: true) }
        let ok = await harness.drive(limit: 10) { harness.ready != nil }
        XCTAssertTrue(ok)
        let ready = try XCTUnwrap(harness.ready)
        XCTAssertEqual(ready.route, .loopback(URL(string: "http://127.0.0.1:49152/live/s1/index.m3u8")!))
        XCTAssertEqual(ready.sourceIndex, 0)
        XCTAssertEqual(ready.info?.codecs, "avc1.42C01E,mp4a.40.2")
        // 1 s + 2 s of media arrive at real-time pace (under load the manual clock may run a little ahead).
        XCTAssertGreaterThanOrEqual(harness.clock.now(), 2.95)
        XCTAssertLessThan(harness.clock.now(), 6)
        let waited = try await harness.session.waitUntilReady()
        XCTAssertEqual(waited, ready)
        XCTAssertEqual(harness.events.values.first, .connecting(sourceIndex: 0, attempt: 0))

        let multivariantValue = await harness.session.multivariantPlaylist()

        let multivariant = try XCTUnwrap(multivariantValue)
        XCTAssertTrue(multivariant.contains(#"CODECS="avc1.42C01E,mp4a.40.2""#))
        XCTAssertTrue(multivariant.contains(#"INSTREAM-ID="CC1""#), "captions declared")
        XCTAssertTrue(multivariant.hasSuffix("media.m3u8\n"))
        let mediaValue = await harness.session.mediaPlaylist()
        let media = try XCTUnwrap(mediaValue)
        XCTAssertTrue(media.contains("#EXT-X-TARGETDURATION:12"))
        XCTAssertTrue(media.contains("#EXTINF:1.000,\n0.ts\n#EXTINF:2.000,\n1.ts"))
        XCTAssertFalse(media.contains("ENDLIST"))
        let firstValue = await harness.session.segment(sequence: 0)
        let first = try XCTUnwrap(firstValue)
        XCTAssertEqual(TSAnalysis(first, checkContinuity: false).numbers(0x100), Array(0..<25))
        let missing = await harness.session.segment(sequence: 99)
        XCTAssertNil(missing)
        XCTAssertEqual(harness.transport.maxConcurrent, 1)
        XCTAssertEqual(harness.transport.opened.first?.headers["User-Agent"], TunerLinks.streamUserAgent)
        await harness.session.stop()
        XCTAssertEqual(harness.transport.openCount, 0, "the line is free once stop returns")
        let stopped = await harness.session.isStopped
        XCTAssertTrue(stopped)
        await eventually { harness.events.values.last == .stopped }
        do {
            _ = try await harness.session.waitUntilReady()
        } catch {
            XCTFail("a ready session stays ready: \(error)")
        }
    }

    func testBusyClipIsRetriedWithBackoff() async throws {
        let stream = TSTestStream()
        let clip = Data(repeating: 0x47, count: 680_000)
        let harness = await LiveHarness { _, attempt in
            if attempt < 3 { return .init(headers: ["Content-Length": "680000"], headerDelay: 0.1, chunks: [(0, clip)]) }
            return .init(chunks: liveChunks(stream, 0..<500), endless: true)
        }
        await harness.drive(limit: 10) { harness.ready != nil }
        XCTAssertNotNil(harness.ready)
        XCTAssertEqual(harness.transport.opened.count, 4)
        XCTAssertEqual(harness.count { $0 == .waitingForLine }, 3)
        XCTAssertEqual(harness.transport.maxConcurrent, 1, "each busy answer is hung up before asking again")
        XCTAssertEqual(harness.events.values.filter { if case .connecting = $0 { return true }; return false }.count, 4)
        await harness.session.stop()
    }

    func testABusyLineFailsAfterTheBudget() async throws {
        let harness = await LiveHarness { _, _ in .init(headers: ["Content-Length": "680000"], chunks: [(0, Data(count: 100))]) }
        await harness.drive(limit: 15) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .lineBusy)
        XCTAssertLessThanOrEqual(harness.clock.now(), 9.5)
        XCTAssertGreaterThan(harness.transport.opened.count, 6)
        do {
            _ = try await harness.session.waitUntilReady()
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? PlaybackFailure, .lineBusy)
        }
        XCTAssertEqual(PlaybackFailure.lineBusy.message, "Another device is using your line right now. Stop watching there, then try again.")
        XCTAssertFalse(PlaybackFailure.lineBusy.message.lowercased().contains("plan"), "nothing that hints at buying more")
        XCTAssertFalse(PlaybackFailure.lineBusy.retiresChannel)
        await harness.session.stop()
    }

    func testHeldRequestsAreAskedAgainAtTheHeaderDeadlines() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness { _, attempt in
            attempt < 2 ? .init(headerDelay: 5, chunks: liveChunks(stream, 0..<500), endless: true)
                        : .init(headerDelay: 0.2, chunks: liveChunks(stream, 0..<500), endless: true)
        }
        await harness.drive(limit: 15) { harness.ready != nil }
        XCTAssertNotNil(harness.ready)
        let deadlines = harness.transport.opened.map(\.headerDeadline)
        XCTAssertEqual(deadlines.count, 3)
        XCTAssertEqual(deadlines[0], 1.3)
        XCTAssertEqual(deadlines[1], 2.2)
        XCTAssertLessThanOrEqual(deadlines[2] ?? 99, 9 - 3.5 + 0.001, "then whatever the busy budget has left")
        XCTAssertGreaterThan(deadlines[2] ?? 0, 3.5)
        XCTAssertEqual(harness.transport.maxConcurrent, 1)
        await harness.session.stop()
    }

    func testQuietConnectionsAreRejoinedSeamlessly() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness { _, attempt in
            attempt == 0 ? .init(chunks: liveChunks(stream, 0..<200), endless: true) // 8 s, then silence
                         : .init(chunks: liveChunks(stream, 200..<600), endless: true)
        }
        await harness.drive(limit: 30) { harness.count { if case .rejoined = $0 { return true }; return false } > 0 }
        XCTAssertEqual(harness.count { $0 == .rejoining }, 1)
        XCTAssertTrue(harness.events.values.contains(.rejoined(seamless: true)))
        XCTAssertEqual(harness.transport.opened.count, 2)
        XCTAssertEqual(harness.transport.maxConcurrent, 1, "the old connection is closed before the new one opens")
        XCTAssertGreaterThanOrEqual(harness.clock.now(), 7.8 + 8, "rejoined only after 8 s without bytes")
        XCTAssertLessThan(harness.clock.now(), 20)
        await harness.drive(limit: 10) { (await harness.session.mediaPlaylist())?.contains("6.ts") ?? false }
        let media = await harness.session.mediaPlaylist() ?? ""
        XCTAssertFalse(media.contains("DISCONTINUITY\n"), "a seamless join has no discontinuity")
        await harness.session.stop()
    }

    func testRejoinPacingGivesUpAfterThreeFailuresIn20Seconds() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness { _, attempt in
            if attempt == 0 { return .init(chunks: liveChunks(stream, 0..<100)) } // 4 s, then the connection ends
            let start = 100 + (attempt - 1) * 25
            return .init(chunks: liveChunks(stream, start..<(start + 25)))      // 1 s each
        }
        await harness.drive(limit: 40) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .ended)
        XCTAssertEqual(harness.count { $0 == .rejoining }, 3)
        XCTAssertEqual(harness.transport.opened.count, 4)
        XCTAssertEqual(harness.transport.maxConcurrent, 1)
        await harness.session.stop()
    }

    func testRefusalsDuringARejoinAreRetriedThenReported() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness { _, attempt in
            attempt == 0 ? .init(chunks: liveChunks(stream, 0..<100)) : .init(status: 403)
        }
        await harness.drive(limit: 20) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .refused(403))
        XCTAssertEqual(PlaybackFailure.refused(403).message, "Your provider refused this channel (error 403).")
        XCTAssertEqual(harness.transport.opened.count, 4, "the paced retries (0, 0.5 and 1.5 s), then the verdict")
        XCTAssertEqual(harness.transport.maxConcurrent, 1)
        await harness.session.stop()
    }

    /// A 404 while replacing the connection of a channel that was playing (the panel restarting the stream) is retried,
    /// then the backups are tried; the channel is never retired from a rejoin.
    func testAPlayingChannelIsNotRetiredWhenARejoinAnswers404() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness(sources: [primary, backup]) { _, attempt in
            if attempt == 0 { return .init(chunks: liveChunks(stream, 0..<150)) } // 6 s, then the provider closes
            return .init(status: 404)
        }
        await harness.drive(limit: 30) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .ended)
        XCTAssertFalse(harness.failure?.retiresChannel ?? true)
        XCTAssertEqual(harness.transport.opened.map(\.url), [primary, primary, primary, primary, backup])
        XCTAssertTrue(harness.events.values.contains(.switchedSource(index: 1)))
        XCTAssertEqual(harness.transport.maxConcurrent, 1)
        await harness.session.stop()
    }

    func testARejoinMovesToTheBackupWhenThePlayingSourceStopsAnswering() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness(sources: [primary, backup]) { request, attempt in
            if attempt == 0 { return .init(chunks: liveChunks(stream, 0..<150)) } // 6 s, then the provider closes
            if request.url == primary { return .init(status: 404) }
            return .init(chunks: liveChunks(stream, 160..<800), endless: true)
        }
        await harness.drive(limit: 30) { harness.count { if case .rejoined = $0 { return true }; return false } > 0 }
        XCTAssertNil(harness.failure)
        XCTAssertEqual(harness.transport.opened.map(\.url), [primary, primary, primary, primary, backup])
        XCTAssertTrue(harness.events.values.contains(.switchedSource(index: 1)))
        XCTAssertEqual(harness.transport.openCount, 1)
        await harness.session.stop()
        XCTAssertEqual(harness.transport.openCount, 0)
    }

    func testGoneOnEverySourceRetiresTheChannel() async throws {
        let harness = await LiveHarness(sources: [primary, backup]) { request, _ in
            .init(status: request.url == primary ? 404 : 410)
        }
        await harness.drive(limit: 10) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .gone)
        XCTAssertTrue(PlaybackFailure.gone.retiresChannel)
        XCTAssertTrue(harness.events.values.contains(.switchedSource(index: 1)))
        XCTAssertEqual(harness.transport.opened.map(\.url), [primary, backup])
        XCTAssertEqual(PlaybackFailure.gone.message, "This channel isn't working right now, so it's been taken out of the guide.")
        await harness.session.stop()
    }

    func testABackupThatWorksIsUsed() async throws {
        let stream = TSTestStream()
        let harness = await LiveHarness(sources: [primary, backup]) { request, _ in
            request.url == primary ? .init(status: 404) : .init(chunks: liveChunks(stream, 0..<500), endless: true)
        }
        await harness.drive(limit: 10) { harness.ready != nil }
        XCTAssertEqual(harness.ready?.sourceIndex, 1)
        await harness.session.stop()
    }

    func testMixedFailuresGiveTheMostUsefulVerdict() async throws {
        let refused = await LiveHarness(sources: [primary, backup]) { request, _ in .init(status: request.url == primary ? 404 : 401) }
        await refused.drive(limit: 10) { refused.failure != nil }
        XCTAssertEqual(refused.failure, .refused(401))
        await refused.session.stop()
        let unreachable = await LiveHarness(sources: [primary]) { _, _ in .init(failure: .cannotConnect("refused")) }
        await unreachable.drive(limit: 10) { unreachable.failure != nil }
        XCTAssertEqual(unreachable.failure, .unreachable)
        await unreachable.session.stop()
    }

    func testPagesThatAreNotMediaAreGone() async throws {
        let html = await LiveHarness { _, _ in .init(chunks: [(0, Data("<html><body>Account suspended</body></html>".utf8))], endless: true) }
        await html.drive(limit: 10) { html.failure != nil }
        XCTAssertEqual(html.failure, .gone)
        await html.session.stop()
        XCTAssertEqual(html.transport.openCount, 0)

        let text = await LiveHarness { _, _ in .init(chunks: [(0, Data(repeating: UInt8(ascii: "x"), count: 5000))]) }
        await text.drive(limit: 10) { text.failure != nil }
        XCTAssertEqual(text.failure, .gone)
        await text.session.stop()
    }

    func testRealHLSIsHandedToThePlayerDirectly() async throws {
        let redirected = URL(string: "http://10.0.0.9:8080/hls/u/p/1/index.m3u8?token=abc")!
        let harness = await LiveHarness { _, _ in
            .init(finalURL: redirected, chunks: [(0, Data("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n".utf8))], endless: true)
        }
        await harness.drive(limit: 5) { harness.ready != nil }
        XCTAssertEqual(harness.ready?.route, .direct(redirected))
        XCTAssertNil(harness.ready?.info)
        await harness.drive(limit: 2) { harness.transport.openCount == 0 }
        XCTAssertEqual(harness.transport.openCount, 0, "the probe connection is closed so the player can open its own")
        let multivariant = await harness.session.multivariantPlaylist()
        XCTAssertNil(multivariant)
        await harness.drive(limit: 15) { false }
        XCTAssertNil(harness.failure, "nothing to rejoin for a direct stream")
        await harness.session.stop()
    }

    func testUnsupportedVideoFails() async throws {
        let stream = TSTestStream { $0.videoType = 0x24 }
        let harness = await LiveHarness { _, _ in .init(chunks: liveChunks(stream, 0..<100), endless: true) }
        await harness.drive(limit: 5) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .unsupported(.hevcVideo))
        XCTAssertFalse(PlaybackFailure.unsupported(.hevcVideo).retiresChannel)
        await harness.session.stop()
    }

    func testLayerTwoAudioIsLeftOutOnTheRetry() async throws {
        let stream = TSTestStream { $0.audioType = 0x03; $0.mpegAudioLayer2 = true }
        let request = LiveTuneRequest(channelKey: "x:1", channelName: "One", sources: [primary], dropMPEGAudioLayer2: true)
        let harness = await LiveHarness(request: request) { _, _ in .init(chunks: liveChunks(stream, 0..<500), endless: true) }
        await harness.drive(limit: 10) { harness.ready != nil }
        XCTAssertEqual(harness.count { $0 == .audioUnsupported }, 1)
        XCTAssertEqual(harness.ready?.info?.codecs, "avc1.42C01E")
        XCTAssertEqual(harness.ready?.info?.audioDropped, true)
        await harness.session.stop()
    }

    func testTooSlowWhenNoSegmentsArrive() async throws {
        let stream = TSTestStream { $0.gop = 10_000 } // never a keyframe after the first: segments never complete in time
        let harness = await LiveHarness { _, _ in .init(chunks: liveChunks(stream, 1..<1000), endless: true) }
        await harness.drive(limit: 25) { harness.failure != nil }
        XCTAssertEqual(harness.failure, .tooSlow)
        XCTAssertGreaterThanOrEqual(harness.clock.now(), 20)
        XCTAssertLessThan(harness.clock.now(), 22)
        await harness.session.stop()
    }

    func testPlaylistWindowEvictionAndHold() async throws {
        let stream = TSTestStream()
        var config = LiveSessionConfig()
        config.maxBufferedBytes = 96 * 1024 * 1024
        let harness = await LiveHarness(config: config) { _, _ in .init(chunks: liveChunks(stream, 0..<2000), endless: true) }
        await harness.drive(limit: 70) { harness.clock.now() >= 61 }
        let mediaValue = await harness.session.mediaPlaylist()
        let media = try XCTUnwrap(mediaValue)
        let durations = media.split(separator: "\n").filter { $0.hasPrefix("#EXTINF:") }.compactMap { Double($0.dropFirst(8).dropLast()) }
        let listed = durations.reduce(0, +)
        XCTAssertGreaterThanOrEqual(listed, 36, "at least 3 × the target duration")
        XCTAssertLessThan(listed, 36 + 2.5, "no more than needed")
        XCTAssertTrue(media.contains("#EXT-X-TARGETDURATION:12"))
        XCTAssertTrue(durations.allSatisfy { $0.rounded() <= 12 })
        let firstSequence = Int(media.split(separator: "\n").first { $0.hasPrefix("#EXT-X-MEDIA-SEQUENCE:") }!.dropFirst(22))!
        let retained = await harness.session.segment(sequence: firstSequence - 4)
        XCTAssertNotNil(retained, "four segments are kept for requests in flight")
        let evicted = await harness.session.segment(sequence: firstSequence - 5)
        XCTAssertNil(evicted)

        // A request that would end on the same segment waits for the next one (or 3 s).
        let session = harness.session
        _ = await session.mediaPlaylist() // remembers where this response ended
        let held = Shared<String?>(nil)
        let start = harness.clock.now()
        let waiter = Task { held.value = await session.heldMediaPlaylist() }
        await harness.drive(limit: 3) { held.value != nil }
        await waiter.value
        XCTAssertLessThanOrEqual(harness.clock.now() - start, 2.1)
        XCTAssertNotNil(held.value)
        await harness.session.stop()
    }

    func testStopBeforeReadyCancelsWaiters() async throws {
        let harness = await LiveHarness { _, _ in .init(headerDelay: 100, endless: true) }
        let session = harness.session
        let outcome = Shared<String>("")
        let waiter = Task {
            do { _ = try await session.waitUntilReady(); outcome.value = "ready" } catch { outcome.value = "\(type(of: error))" }
        }
        await harness.drive(limit: 1) { harness.transport.openCount == 1 }
        await session.stop()
        await waiter.value
        XCTAssertEqual(outcome.value, "CancellationError")
        XCTAssertEqual(harness.transport.openCount, 0)
        let late = await session.events()
        var iterator = late.makeAsyncIterator()
        let event = await iterator.next()
        XCTAssertEqual(event, .stopped, "subscribing after stop gets .stopped")
    }
}

final class MediaServerTests: XCTestCase {
    func testRoutesAndOneSessionAtATime() async throws {
        let clock = ManualClock()
        let stream = TSTestStream()
        let transport = StubUpstreamTransport(clock: clock) { _, _ in .init(chunks: liveChunks(stream, 0..<2000), endless: true) }
        let server = MediaServer(transport: transport, clock: clock)
        await assertThrows(PlaybackFailure.unreachable) {
            _ = try await server.tuneLive(LiveTuneRequest(channelKey: "x:1", channelName: "One", sources: [primary]))
        }
        await server.setOrigin(origin)
        let current = await server.origin
        XCTAssertEqual(current, origin)

        let first = try await server.tuneLive(LiveTuneRequest(channelKey: "x:1", channelName: "One", sources: [primary]))
        let notReady = await server.respond(to: HTTPRequestHead(method: "GET", path: "/live/\(first.id)/index.m3u8"))
        XCTAssertEqual(notReady.status, 503)
        await drive(clock, limit: 10) { (try? await first.waitUntilReadyIfReady()) ?? false }
        let index = await server.respond(to: HTTPRequestHead(method: "GET", path: "/live/\(first.id)/index.m3u8"))
        XCTAssertEqual(index.status, 200)
        XCTAssertTrue(index.headers.contains(HTTPHeader("Content-Type", "application/vnd.apple.mpegurl")))
        let media = await server.respond(to: HTTPRequestHead(method: "HEAD", path: "/live/\(first.id)/media.m3u8"))
        XCTAssertEqual(media.status, 200)
        XCTAssertTrue(media.headers.contains(HTTPHeader("Cache-Control", "no-cache")))
        let segment = await server.respond(to: HTTPRequestHead(method: "GET", path: "/live/\(first.id)/0.ts"))
        XCTAssertEqual(segment.status, 200)
        XCTAssertTrue(segment.headers.contains(HTTPHeader("Content-Type", "video/mp2t")))
        if case .data(let data) = segment.body { XCTAssertEqual(data.count % 188, 0) } else { XCTFail("expected data") }
        for path in ["/live/\(first.id)/77.ts", "/live/\(first.id)/x.ts", "/live/unknown/index.m3u8", "/", "/live/\(first.id)", "/other/a/b"] {
            let response = await server.respond(to: HTTPRequestHead(method: "GET", path: path))
            XCTAssertEqual(response.status, 404, path)
        }
        let post = await server.respond(to: HTTPRequestHead(method: "POST", path: "/live/\(first.id)/index.m3u8"))
        XCTAssertEqual(post.status, 405)

        // Tuning again hangs up first: never two provider connections.
        await server.noteWorkingSource(channelKey: "x:2", url: backup)
        let second = try await server.tuneLive(LiveTuneRequest(channelKey: "x:2", channelName: "Two", sources: [primary, backup]))
        let firstStopped = await first.isStopped
        XCTAssertTrue(firstStopped)
        XCTAssertEqual(second.request.sources, [backup, primary], "the source that worked last goes first")
        await drive(clock, limit: 2) { transport.opened.count == 2 }
        XCTAssertEqual(transport.opened.last?.url, backup)
        XCTAssertEqual(transport.maxConcurrent, 1)
        let gone = await server.respond(to: HTTPRequestHead(method: "GET", path: "/live/\(first.id)/media.m3u8"))
        XCTAssertEqual(gone.status, 410)

        let vod = try await server.openVOD(VODRequest(id: "m:1", sources: [URL(string: "http://line.example.com/movie/u/p/1.mp4")!], containerExtension: "mp4"))
        let secondStopped = await second.isStopped
        XCTAssertTrue(secondStopped, "VOD stops live first")
        XCTAssertEqual(vod.localURL.path, "/vod/\(vod.id)/media.mp4")
        XCTAssertEqual(transport.openCount, 0)
        await server.stopAll()
        let afterStop = await server.respond(to: HTTPRequestHead(method: "GET", path: "/vod/\(vod.id)/media.mp4"))
        XCTAssertEqual(afterStop.status, 410)
    }
}

final class MediaServerZappingTests: XCTestCase {
    /// Fast zapping: tunes that overlap (an older one still waiting for the line) never open a second connection,
    /// and the newest request is the one left playing.
    func testOverlappingTunesKeepOneConnection() async throws {
        let clock = ManualClock()
        let stream = TSTestStream()
        let transport = StubUpstreamTransport(clock: clock) { _, _ in .init(chunks: liveChunks(stream, 0..<500), endless: true) }
        let server = MediaServer(transport: transport, clock: clock)
        await server.setOrigin(origin)
        var sessions: [LiveChannelSession] = []
        for round in 0..<15 {
            let one = LiveTuneRequest(channelKey: "x:\(round).1", channelName: "C", sources: [primary])
            let two = LiveTuneRequest(channelKey: "x:\(round).2", channelName: "C", sources: [primary])
            let three = LiveTuneRequest(channelKey: "x:\(round).3", channelName: "C", sources: [primary])
            async let a = try? server.tuneLive(one)
            async let b = try? server.tuneLive(two)
            async let c = try? server.tuneLive(three)
            let tuned = await [a, b, c].compactMap { $0 }
            XCTAssertFalse(tuned.isEmpty, "the newest tune always succeeds")
            sessions += tuned
            await drive(clock, limit: 0.3) { false }
            XCTAssertLessThanOrEqual(transport.openCount, 1)
        }
        XCTAssertEqual(transport.maxConcurrent, 1)
        var running = 0
        for session in sessions where !(await session.isStopped) { running += 1 }
        XCTAssertEqual(running, 1, "only the newest session is left")
        await server.stopAll()
        XCTAssertEqual(transport.openCount, 0)
    }
}

extension LiveChannelSession {
    /// True once ready (for polling in tests; never waits).
    func waitUntilReadyIfReady() async throws -> Bool { multivariantPlaylist() != nil }
}
