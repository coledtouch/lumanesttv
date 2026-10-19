import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

/// The real URLSession clients against a loopback server (no network needed).
final class URLSessionClientTests: XCTestCase {
    private var server: LocalHTTPServer!

    override func setUpWithError() throws {
        let gzip = Fixture.data("gzip/dynamic.gz")
        let stream = TSTestStream().frames(0..<50)
        server = try LocalHTTPServer { request in
            switch request.path {
            case "/player_api.php": return .init(headers: [("Content-Type", "application/json")], chunks: [(0, Data(#"{"user_info":{"auth":1}}"#.utf8))])
            case "/gzip": return .init(headers: [("Content-Type", "text/plain")], chunks: [(0, gzip)])
            case "/missing": return .init(status: 404, chunks: [(0, Data("nope".utf8))])
            case "/redirect": return .init(status: 302, headers: [("Location", "/player_api.php?username=a&password=b")])
            case "/slow": return .init(headDelay: 2, chunks: [(0, Data("late".utf8))])
            case "/live/1.ts":
                let pieces = stride(from: 0, to: stream.count, by: 18_800).map { (0.02, stream.subdata(in: $0..<min(stream.count, $0 + 18_800))) }
                return .init(headers: [("Content-Type", "video/mp2t")], chunks: pieces, holdOpen: 5)
            case "/movie.mp4":
                return .init(status: 206, headers: [("Content-Type", "video/mp4"), ("Content-Range", "bytes 0-9/1000"), ("Content-Length", "10")],
                             chunks: [(0, Data(count: 10))])
            default: return .init(status: 500)
            }
        }
    }

    override func tearDown() { server?.stop() }

    /// macOS test hosts may apply App Transport Security to plain HTTP: skip rather than fail there.
    private func requirePlainHTTP() async throws {
        #if canImport(Darwin)
        do {
            _ = try await URLSession.shared.data(from: server.baseURL.appendingPathComponent("player_api.php"))
        } catch let error as URLError where error.code == .appTransportSecurityRequiresSecureConnection {
            throw XCTSkip("App Transport Security blocks plain HTTP in this test host")
        }
        #endif
    }

    func testDataRawAndRedirects() async throws {
        try await requirePlainHTTP()
        let client = URLSessionHTTPClient(requestTimeout: 10)
        let result = try await client.data(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("player_api.php")))
        XCTAssertEqual(result.status, 200)
        XCTAssertEqual(result.headers["content-type"], "application/json")
        XCTAssertEqual(try XtreamParser.accountInfo(result.body).authorized, true)
        XCTAssertEqual(server.requests.last?.headers["user-agent"], TunerLinks.streamUserAgent)

        let custom = try await client.data(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("player_api.php"), headers: ["User-Agent": "Custom/1"]))
        XCTAssertEqual(custom.status, 200)
        XCTAssertEqual(server.requests.last?.headers["user-agent"], "Custom/1")

        do {
            _ = try await client.data(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("missing")))
            XCTFail("expected 404")
        } catch {
            XCTAssertEqual(error as? TunerError, .serverStatus(404))
        }
        let raw = try await client.raw(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("missing")))
        XCTAssertEqual(raw.status, 404)
        XCTAssertEqual(raw.body, Data("nope".utf8))

        let redirected = try await client.data(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("redirect")))
        XCTAssertEqual(redirected.finalURL.path, "/player_api.php")
        XCTAssertEqual(server.requests.last?.query, "username=a&password=b")

        let posted = try await URLSessionHTTPClient(userAgent: TunerLinks.lumanestUserAgent)
            .raw(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("player_api.php"), method: "POST",
                                 headers: ["Content-Type": "application/json"], body: Data("{}".utf8)))
        XCTAssertEqual(posted.status, 200)
        XCTAssertEqual(server.requests.last?.method, "POST")
        XCTAssertEqual(server.requests.last?.headers["user-agent"], "LumaNestTuner/AppleTV")
    }

    func testGzipBodiesAndDownloads() async throws {
        try await requirePlainHTTP()
        let client = URLSessionHTTPClient()
        let result = try await client.data(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("gzip")))
        XCTAssertEqual(result.body, Fixture.data("gzip/text.txt"))
        let directory = makeTemporaryDirectory(self)
        let destination = directory.appendingPathComponent("cache/guide.txt")
        let download = try await client.download(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("gzip")), to: destination)
        XCTAssertEqual(download.status, 200)
        XCTAssertEqual(try Data(contentsOf: destination), Fixture.data("gzip/text.txt"))
        do {
            _ = try await client.download(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("missing")), to: destination)
            XCTFail("expected 404")
        } catch {
            XCTAssertEqual(error as? TunerError, .serverStatus(404))
        }
        XCTAssertEqual(try Data(contentsOf: destination), Fixture.data("gzip/text.txt"), "the stale copy stays")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.deletingLastPathComponent().path), ["guide.txt"])
    }

    func testOverallTimeout() async throws {
        try await requirePlainHTTP()
        let client = URLSessionHTTPClient()
        let started = Date()
        do {
            _ = try await client.data(HTTPRequestSpec(url: server.baseURL.appendingPathComponent("slow"), timeout: 0.3))
            XCTFail("expected a timeout")
        } catch {
            XCTAssertEqual(error as? TunerError, .timedOut)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.8)
    }

    func testUpstreamStreamsLiveBytesAndHangsUp() async throws {
        try await requirePlainHTTP()
        let transport = URLSessionUpstreamTransport()
        let response = try await transport.open(UpstreamRequest(url: server.baseURL.appendingPathComponent("live/1.ts"), headers: ["User-Agent": "Test/1"]))
        XCTAssertEqual(response.status, 200)
        XCTAssertEqual(response.headers["content-type"], "video/mp2t")
        XCTAssertNil(response.expectedLength)
        let expected = TSTestStream().frames(0..<50)
        var received = Data()
        for try await chunk in response.body {
            received.append(chunk)
            if received.count >= expected.count { break }
        }
        XCTAssertEqual(received, expected)
        XCTAssertEqual(server.requests.last?.headers["user-agent"], "Test/1")
        XCTAssertEqual(server.requests.last?.headers["accept-encoding"], "identity")
        response.cancel()
        await eventually(timeout: 4, "the provider connection closes when the reader stops") { self.server.closed >= 1 }
    }

    func testUpstreamHeaderDeadline() async throws {
        try await requirePlainHTTP()
        let transport = URLSessionUpstreamTransport()
        let started = Date()
        do {
            _ = try await transport.open(UpstreamRequest(url: server.baseURL.appendingPathComponent("slow"), headerDeadline: 0.3))
            XCTFail("expected the deadline")
        } catch {
            XCTAssertEqual(error as? UpstreamError, .headerDeadline)
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 1.5)
        let movie = try await transport.open(UpstreamRequest(url: server.baseURL.appendingPathComponent("movie.mp4"), headers: ["Range": "bytes=0-9"]))
        XCTAssertEqual(movie.status, 206)
        XCTAssertEqual(movie.expectedLength, 10)
        var bytes = 0
        for try await chunk in movie.body { bytes += chunk.count }
        XCTAssertEqual(bytes, 10)
        XCTAssertEqual(server.requests.last?.headers["range"], "bytes=0-9")
    }

    func testAMediaServerSessionOverTheRealTransport() async throws {
        try await requirePlainHTTP()
        // Real sockets, real clock: the provider sends 2 s of TS; the session segments it.
        let stream = TSTestStream()
        let live = try LocalHTTPServer { _ in
            let data = stream.frames(0..<100)
            let pieces = stride(from: 0, to: data.count, by: 9400).map { (0.01, data.subdata(in: $0..<min(data.count, $0 + 9400))) }
            return .init(headers: [("Content-Type", "video/mp2t")], chunks: pieces, holdOpen: 10)
        }
        defer { live.stop() }
        let server = MediaServer(transport: URLSessionUpstreamTransport())
        await server.setOrigin(URL(string: "http://127.0.0.1:1")!)
        let session = try await server.tuneLive(LiveTuneRequest(channelKey: "x:1", channelName: "One",
                                                               sources: [live.baseURL.appendingPathComponent("live/u/p/1.ts")]))
        let ready = try await session.waitUntilReady()
        guard case .loopback(let url) = ready.route else { return XCTFail("expected the loopback route") }
        XCTAssertEqual(url.lastPathComponent, "index.m3u8")
        let response = await server.respond(to: HTTPRequestHead(method: "GET", path: url.path))
        XCTAssertEqual(response.status, 200)
        await server.stopAll()
        await eventually(timeout: 4) { live.closed >= 1 }
    }
}
