import Foundation
import XCTest
@testable import TunerCore

private let movieURL = URL(string: "http://line.example.com/movie/u/p/900.mp4")!
private let otherUpload = URL(string: "http://line.example.com/movie/u/p/901.mp4")!
private let file = Data((0..<1000).map { UInt8($0 % 251) })

/// A provider file server: honours single byte ranges unless `ignoresRanges`.
private func fileScript(_ request: UpstreamRequest, ignoresRanges: Bool = false, contentType: String = "video/mp4", endless: Bool = false)
    -> StubUpstreamTransport.Script {
    if !ignoresRanges, let range = request.headers["Range"].flatMap(HTTPRequestHead.parseRange) {
        let end = min(range.end ?? 999, 999)
        guard range.start <= end else { return .init(status: 416, headers: ["Content-Range": "bytes */1000"]) }
        let slice = file.subdata(in: Int(range.start)..<Int(end + 1))
        return .init(status: 206, headers: ["Content-Type": contentType, "Content-Range": "bytes \(range.start)-\(end)/1000",
                                            "Content-Length": String(slice.count)],
                     chunks: [(0, slice)], endless: endless)
    }
    return .init(status: 200, headers: ["Content-Type": contentType, "Content-Length": "1000"], chunks: [(0, file)], endless: endless)
}

private func collect(_ response: HTTPResponse) async throws -> Data {
    switch response.body {
    case .empty: return Data()
    case .data(let data): return data
    case .stream(let stream):
        var out = Data()
        for try await chunk in stream { out.append(chunk) }
        return out
    }
}

private func header(_ response: HTTPResponse, _ name: String) -> String? {
    response.headers.first { $0.name.lowercased() == name.lowercased() }?.value
}

final class VODSessionTests: XCTestCase {
    private func session(_ sources: [URL] = [movieURL], ext: String? = "mp4", clock: ManualClock = ManualClock(),
                         script: @escaping @Sendable (UpstreamRequest, Int) -> StubUpstreamTransport.Script)
        -> (VODSession, StubUpstreamTransport, Recorder<VODSessionEvent>) {
        let transport = StubUpstreamTransport(clock: clock, handler: script)
        let session = VODSession(id: "v1", request: VODRequest(id: "m:900", sources: sources, containerExtension: ext),
                                 origin: URL(string: "http://127.0.0.1:49152")!, transport: transport, clock: clock)
        return (session, transport, Recorder<VODSessionEvent>())
    }

    private func listen(_ session: VODSession, _ events: Recorder<VODSessionEvent>) async {
        let stream = await session.events()
        Task.detached { for await event in stream { events.append(event) } }
    }

    func testRangesPassThrough() async throws {
        let (vod, transport, _) = session { request, _ in fileScript(request) }
        XCTAssertEqual(vod.localURL.absoluteString, "http://127.0.0.1:49152/vod/v1/media.mp4")
        let ranged = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 100, end: 199)))
        XCTAssertEqual(ranged.status, 206)
        XCTAssertEqual(header(ranged, "Content-Range"), "bytes 100-199/1000")
        XCTAssertEqual(header(ranged, "Content-Length"), "100")
        XCTAssertEqual(header(ranged, "Content-Type"), "video/mp4")
        XCTAssertEqual(header(ranged, "Accept-Ranges"), "bytes")
        let body = try await collect(ranged)
        XCTAssertEqual(body, file.subdata(in: 100..<200))
        let upstream = try XCTUnwrap(transport.opened.first)
        XCTAssertEqual(upstream.headers["Range"], "bytes=100-199")
        XCTAssertEqual(upstream.headers["User-Agent"], TunerLinks.streamUserAgent)
        XCTAssertEqual(upstream.headers["Accept-Encoding"], "identity")
        XCTAssertNil(upstream.headerDeadline, "VOD has no live header deadlines")

        let whole = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4"))
        XCTAssertEqual(whole.status, 200)
        XCTAssertEqual(header(whole, "Content-Length"), "1000")
        let wholeBody = try await collect(whole)
        XCTAssertEqual(wholeBody, file)
        await vod.stop()
        let afterStop = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4"))
        XCTAssertEqual(afterStop.status, 410)
    }

    func testRangesAreCutFromProvidersThatIgnoreThem() async throws {
        let (vod, _, _) = session { request, _ in fileScript(request, ignoresRanges: true) }
        let middle = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 100, end: 199)))
        XCTAssertEqual(middle.status, 206)
        XCTAssertEqual(header(middle, "Content-Range"), "bytes 100-199/1000")
        XCTAssertEqual(header(middle, "Content-Length"), "100")
        let middleBody = try await collect(middle)
        XCTAssertEqual(middleBody, file.subdata(in: 100..<200))
        let tail = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 900, end: nil)))
        XCTAssertEqual(header(tail, "Content-Range"), "bytes 900-999/1000")
        let tailBody = try await collect(tail)
        XCTAssertEqual(tailBody, file.subdata(in: 900..<1000))
        let beyond = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 2000, end: nil)))
        XCTAssertEqual(beyond.status, 416)
        XCTAssertEqual(header(beyond, "Content-Range"), "bytes */1000")
        await vod.stop()
    }

    func testHeadReportsTheLengthAndHangsUp() async throws {
        let (vod, transport, _) = session(ext: "mov") { request, _ in fileScript(request, contentType: "application/octet-stream", endless: true) }
        XCTAssertEqual(vod.localURL.lastPathComponent, "media.mov")
        let head = await vod.respond(to: HTTPRequestHead(method: "HEAD", path: "/vod/v1/media.mov"))
        XCTAssertEqual(head.status, 200)
        XCTAssertEqual(header(head, "Content-Length"), "1000")
        XCTAssertEqual(header(head, "Content-Type"), "video/quicktime", "the type comes from the container, not the provider")
        XCTAssertEqual(transport.opened.first?.headers["Range"], "bytes=0-0")
        XCTAssertEqual(transport.openCount, 0)
        let post = await vod.respond(to: HTTPRequestHead(method: "POST", path: "/vod/v1/media.mov"))
        XCTAssertEqual(post.status, 405)
        await vod.stop()
    }

    func testTheNewestRequestWins() async throws {
        let (vod, transport, _) = session { request, _ in fileScript(request, endless: true) }
        let first = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 0, end: nil)))
        XCTAssertEqual(first.status, 206)
        XCTAssertEqual(transport.openCount, 1)
        let second = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 500, end: 599)))
        XCTAssertEqual(second.status, 206)
        XCTAssertEqual(transport.maxConcurrent, 1, "the older upstream is closed before the newer one opens")
        do {
            _ = try await collect(first)
        } catch {
            // The first body ends (or fails) once its upstream is gone: either is fine for the player.
        }
        guard case .stream(let stream) = second.body else { return XCTFail("expected a stream") }
        var iterator = stream.makeAsyncIterator()
        let chunk = try await iterator.next()
        XCTAssertEqual(chunk, file.subdata(in: 500..<600))
        await vod.stop()
        XCTAssertEqual(transport.openCount, 0)
    }

    func testBusyClipsAreRetried() async throws {
        let clock = ManualClock()
        let (vod, transport, events) = session(clock: clock) { request, attempt in
            switch attempt {
            case 0: return .init(status: 200, headers: ["Content-Type": "video/mp2t", "Content-Length": "680000"], chunks: [(0, Data(count: 1000))])
            case 1: return .init(status: 200, headers: ["Content-Length": "1000"], chunks: [(0, TSTestStream().frames(0..<3))])
            default: return fileScript(request)
            }
        }
        await listen(vod, events)
        let result = Shared<HTTPResponse?>(nil)
        let task = Task { result.value = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 0, end: 9))) }
        await drive(clock, limit: 5) { result.value != nil }
        await task.value
        let response = try XCTUnwrap(result.value)
        XCTAssertEqual(response.status, 206)
        let body = try await collect(response)
        XCTAssertEqual(body, file.prefix(10))
        XCTAssertEqual(transport.opened.count, 3)
        await eventually { events.values.filter { $0 == .waitingForLine }.count == 2 }
        await vod.stop()
    }

    func testABusyLineAnswers503AfterTheBudget() async throws {
        let clock = ManualClock()
        let (vod, _, events) = session(clock: clock) { _, _ in
            .init(status: 200, headers: ["Content-Type": "video/MP2T"], chunks: [(0, Data(count: 100))])
        }
        await listen(vod, events)
        let result = Shared<HTTPResponse?>(nil)
        let task = Task { result.value = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4")) }
        await drive(clock, limit: 15) { result.value != nil }
        await task.value
        XCTAssertEqual(result.value?.status, 503)
        XCTAssertLessThan(clock.now(), 9.5)
        await eventually { events.values.contains(.failed(.lineBusy)) }
        await vod.stop()
    }

    func testMissingUploadsAndBackups() async throws {
        let (gone, _, goneEvents) = session([movieURL, otherUpload]) { _, _ in .init(status: 404) }
        await listen(gone, goneEvents)
        let response = await gone.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4"))
        XCTAssertEqual(response.status, 404)
        await eventually { goneEvents.values.contains(.failed(.gone)) }
        XCTAssertTrue(goneEvents.values.contains(.switchedSource(index: 1)))
        await gone.stop()

        let (vod, transport, events) = session([movieURL, otherUpload]) { request, _ in
            request.url == movieURL ? .init(status: 404) : fileScript(request)
        }
        await listen(vod, events)
        let first = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 0, end: 1)))
        XCTAssertEqual(first.status, 206)
        let next = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 2, end: 3)))
        XCTAssertEqual(next.status, 206)
        XCTAssertEqual(transport.opened.map(\.url), [movieURL, otherUpload, otherUpload], "the upload that worked is used from then on")
        let refused = session { _, _ in .init(status: 403) }.0
        let answer = await refused.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4"))
        XCTAssertEqual(answer.status, 502)
        await vod.stop()
    }

    /// A request stuck in busy-clip retries makes no provider request once the session is stopped, and `stop()`
    /// returns only when nothing is opening the provider any more.
    func testNoProviderRequestsAfterStop() async throws {
        let clock = ManualClock()
        let (vod, transport, _) = session(clock: clock) { _, _ in
            .init(status: 200, headers: ["Content-Type": "video/mp2t", "Content-Length": "680000"], headerDelay: 0.3, chunks: [(0, Data(count: 100))])
        }
        let done = Shared(false)
        let task = Task {
            _ = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 0, end: 1)))
            done.value = true
        }
        await drive(clock, limit: 1) { false }
        XCTAssertGreaterThan(transport.opened.count, 0)
        await vod.stop()
        let opensAtStop = transport.opened.count
        XCTAssertEqual(transport.openCount, 0, "the line is free once stop returns")
        await drive(clock, limit: 12) { done.value }
        await task.value
        XCTAssertEqual(transport.opened.count, opensAtStop, "no provider requests after stop()")
    }

    /// A newer request cancels an older one that is still retrying the busy clip: never two provider requests at once.
    func testANewerRequestCancelsAnOlderOneStillOpening() async throws {
        let clock = ManualClock()
        let (vod, transport, _) = session(clock: clock) { request, attempt in
            if request.headers["Range"] == "bytes=10-" && attempt > 4 { return fileScript(request) }
            return .init(status: 200, headers: ["Content-Type": "video/mp2t", "Content-Length": "680000"], headerDelay: 0.3, chunks: [(0, Data(count: 100))])
        }
        let first = Shared<HTTPResponse?>(nil)
        let a = Task { first.value = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4")) }
        await drive(clock, limit: 0.5) { false }
        let second = Shared<HTTPResponse?>(nil)
        let b = Task { second.value = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 10, end: nil))) }
        await drive(clock, limit: 12) { first.value != nil && second.value != nil }
        await a.value
        await b.value
        XCTAssertEqual(first.value?.status, 503, "the older request gave up")
        XCTAssertEqual(second.value?.status, 206)
        XCTAssertEqual(transport.maxConcurrent, 1)
        let afterB = transport.opened.firstIndex { $0.headers["Range"] == "bytes=10-" } ?? 0
        XCTAssertTrue(transport.opened[afterB...].allSatisfy { $0.headers["Range"] == "bytes=10-" }, "the older request stopped knocking")
        await vod.stop()
    }

    /// A provider that ignores the range and sends no length: the reply is a plain 200 with the whole file from byte 0.
    func testIgnoredRangeWithoutALengthIsPassedOnWhole() async throws {
        let (vod, _, _) = session { _, _ in .init(status: 200, headers: ["Content-Type": "video/mp4"], chunks: [(0, file)]) }
        let response = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4", range: ByteRange(start: 100, end: nil)))
        XCTAssertEqual(response.status, 200)
        XCTAssertNil(header(response, "Content-Range"))
        let body = try await collect(response)
        XCTAssertEqual(body, file, "a 200 body starts at byte 0")
        await vod.stop()
    }

    func testErrorPagesAreNotMovies() async throws {
        let (vod, _, _) = session { _, _ in .init(status: 200, headers: ["Content-Type": "text/html"], chunks: [(0, Data("<html><body>Gone</body></html>".utf8))]) }
        let response = await vod.respond(to: HTTPRequestHead(method: "GET", path: "/vod/v1/media.mp4"))
        XCTAssertEqual(response.status, 404)
        await vod.stop()
    }
}

final class UpstreamTransportTests: XCTestCase {
    func testStubCountsConnectionsAndHonoursDeadlines() async throws {
        let clock = ManualClock()
        let transport = StubUpstreamTransport(clock: clock) { _, attempt in
            attempt == 0 ? .init(headerDelay: 5) : .init(status: 200, headers: ["Content-Length": "3"], chunks: [(0, Data([1, 2, 3]))])
        }
        let outcome = Shared<String>("")
        let task = Task {
            do {
                _ = try await transport.open(UpstreamRequest(url: movieURL, headerDeadline: 1))
                outcome.value = "opened"
            } catch {
                outcome.value = "\(error)"
            }
        }
        await drive(clock, limit: 3) { !outcome.value.isEmpty }
        await task.value
        XCTAssertEqual(outcome.value, "headerDeadline")
        XCTAssertGreaterThanOrEqual(clock.now(), 1)
        XCTAssertLessThan(clock.now(), 1.5)
        XCTAssertEqual(transport.openCount, 0)
        let response = try await transport.open(UpstreamRequest(url: movieURL))
        XCTAssertEqual(response.expectedLength, 3)
        XCTAssertEqual(response.headers["content-length"], "3")
        var bytes = Data()
        for try await chunk in response.body { bytes.append(chunk) }
        XCTAssertEqual(bytes, Data([1, 2, 3]))
        XCTAssertEqual(transport.openCount, 0)
        XCTAssertEqual(transport.maxConcurrent, 1)
        XCTAssertEqual(transport.opened.count, 2)
    }

    func testBodyChannelBackpressure() async throws {
        let pressure = Recorder<Bool>()
        let channel = BodyChannel(highWater: 10, lowWater: 4)
        channel.onPressure = { pressure.append($0) }
        channel.yield(Data(count: 6))
        channel.yield(Data(count: 6)) // 12 > 10: pause
        XCTAssertEqual(pressure.values, [true])
        _ = try await channel.next() // 6 left: still above low water
        XCTAssertEqual(pressure.values, [true])
        _ = try await channel.next() // 0 left: resume
        XCTAssertEqual(pressure.values, [true, false])
        channel.finish()
        let end = try await channel.next()
        XCTAssertNil(end)
        let failing = BodyChannel()
        failing.finish(throwing: UpstreamError.timedOut)
        do {
            _ = try await failing.next()
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? UpstreamError, .timedOut)
        }
    }

    func testDroppingABodyStreamCancelsTheConnection() async throws {
        let cancelled = Shared(false)
        do {
            let channel = BodyChannel()
            channel.onCancel = { cancelled.value = true }
            var stream: AsyncThrowingStream<Data, any Error>? = channel.stream()
            XCTAssertNotNil(stream)
            stream = nil
            _ = stream
        }
        await eventually { cancelled.value }
    }

    func testURLSessionTransportMapsErrors() {
        XCTAssertEqual(URLSessionUpstreamTransport.map(URLError(.timedOut), deadlinePassed: false), .timedOut)
        XCTAssertEqual(URLSessionUpstreamTransport.map(URLError(.cancelled), deadlinePassed: true), .headerDeadline)
        XCTAssertEqual(URLSessionUpstreamTransport.map(URLError(.cancelled), deadlinePassed: false), .cancelled)
        if case .cannotConnect = URLSessionUpstreamTransport.map(URLError(.cannotFindHost), deadlinePassed: false) {} else { XCTFail() }
    }
}
