import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

private let startBody = """
{"deviceCode":"dc_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG","userCode":"BCDF-GH23","verificationUri":"https://lumanest.tv/pair",\
"verificationUriComplete":"https://lumanest.tv/pair?code=BCDF-GH23","qr":["101","010","111"],"expiresIn":600,"interval":5}
"""

final class PairingAccountTests: XCTestCase {
    /// Android PairingTest.
    func testPairedAccountsBecomeSources() {
        let m3u = PairingAccount(type: "m3u", name: "LumaNest TV", m3uUrl: "https://tv.lumanest.tv/m3u?u=a&p=b").source(id: "1")
        XCTAssertEqual(m3u, Source(id: "1", name: "LumaNest TV", kind: .m3u, playlistURL: "https://tv.lumanest.tv/m3u?u=a&p=b"))
        let xtream = PairingAccount(type: " XTREAM ", server: "https://x.lumanest.tv/", username: "u", password: "p").source(id: "2")
        XCTAssertEqual(xtream, Source(id: "2", name: "LumaNest TV", kind: .xtream, server: "https://x.lumanest.tv", username: "u", password: "p"))
        XCTAssertEqual(PairingAccount(type: "m3u", name: "  ", m3uUrl: "http://a.example.com/x").source()?.name, "LumaNest TV")
        XCTAssertEqual(PairingAccount(type: "m3u", name: "Den", m3uUrl: "http://a.example.com/x").source()?.name, "Den")
    }

    func testUnusableAccountsAreRejected() {
        XCTAssertNil(PairingAccount(type: "m3u", m3uUrl: "file:///sdcard/list.m3u").source())
        XCTAssertNil(PairingAccount(type: "m3u").source())
        XCTAssertNil(PairingAccount(type: "xtream", server: "https://x.lumanest.tv", username: "u").source())
        XCTAssertNil(PairingAccount(type: "xtream", server: "x.lumanest.tv", username: "u", password: "p").source(), "the server must be http(s)")
        XCTAssertNil(PairingAccount(type: "xtream", server: "https://x.lumanest.tv", username: "null", password: "p").source())
        XCTAssertNil(PairingAccount(type: "other").source())
    }

    func testQRMatrix() throws {
        let matrix = try XCTUnwrap(QRMatrix(rows: ["101", "010", "111"]))
        XCTAssertEqual(matrix.size, 3)
        XCTAssertTrue(matrix.isDark(row: 0, column: 0))
        XCTAssertFalse(matrix.isDark(row: 0, column: 1))
        XCTAssertTrue(matrix.isDark(row: 2, column: 1))
        XCTAssertFalse(matrix.isDark(row: 3, column: 0))
        XCTAssertFalse(matrix.isDark(row: -1, column: 0))
        XCTAssertNil(QRMatrix(rows: []))
        XCTAssertNil(QRMatrix(rows: ["10", "01", "11"]))
        XCTAssertNil(QRMatrix(rows: ["1x", "01"]))
    }
}

final class PairingClientTests: XCTestCase {
    func testStartSendsTheDeviceAsJSON() async throws {
        let http = StubHTTPClient { ok($0, Data(startBody.utf8)) }
        let code = try await PairingClient(http: http).start()
        XCTAssertEqual(code.userCode, "BCDF-GH23")
        XCTAssertEqual(code.deviceCode.count, 46)
        XCTAssertEqual(code.verificationUriComplete, "https://lumanest.tv/pair?code=BCDF-GH23")
        XCTAssertEqual(code.qr, ["101", "010", "111"])
        XCTAssertEqual(code.expiresIn, 600)
        XCTAssertEqual(code.interval, 5)
        let request = try XCTUnwrap(http.requests.first)
        XCTAssertEqual(request.url.absoluteString, "https://lumanest.tv/api/pair/start")
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.body, Data(#"{"device":"appletv"}"#.utf8))
        XCTAssertEqual(request.headers["Content-Type"], "application/json")
        XCTAssertEqual(request.headers["User-Agent"], "LumaNestTuner/AppleTV")
        XCTAssertEqual(request.timeout, 15)
    }

    func testServerErrorsCarryTheirCodeAndRetryAfter() async {
        let busy = StubHTTPClient {
            ok($0, Data(#"{"error":{"code":"pairing_rate_limit","message":"Too many codes."}}"#.utf8), status: 429, headers: ["retry-after": "120"])
        }
        await assertThrows(PairingError.server(status: 429, code: "pairing_rate_limit", message: "Too many codes.", retryAfter: 120)) {
            _ = try await PairingClient(http: busy).start()
        }
        let unknownDevice = StubHTTPClient { ok($0, Data(#"{"error":{"code":"invalid_request","message":"Check the details and try again."}}"#.utf8), status: 400) }
        await assertThrows(PairingError.server(status: 400, code: "invalid_request", message: "Check the details and try again.", retryAfter: nil)) {
            _ = try await PairingClient(http: unknownDevice, device: "toaster").start()
        }
        let html = StubHTTPClient { ok($0, Data("<html>".utf8), status: 503) }
        do {
            _ = try await PairingClient(http: html).start()
            XCTFail("expected an error")
        } catch PairingError.server(let status, let code, _, _) {
            XCTAssertEqual(status, 503)
            XCTAssertEqual(code, "http_503")
        } catch {
            XCTFail("\(error)")
        }
        let offline = StubHTTPClient { _ in throw URLError(.notConnectedToInternet) }
        await assertThrows(PairingError.network(.unreachable)) { _ = try await PairingClient(http: offline).start() }
        let garbage = StubHTTPClient { ok($0, Data("{}".utf8)) }
        await assertThrows(PairingError.invalidResponse) { _ = try await PairingClient(http: garbage).start() }
        let noQR = StubHTTPClient { ok($0, Data(#"{"deviceCode":"a","userCode":"b","verificationUriComplete":"c","qr":[]}"#.utf8)) }
        await assertThrows(PairingError.invalidResponse) { _ = try await PairingClient(http: noQR).start() }
    }

    func testPollStatuses() async throws {
        let answers = Shared([
            #"{"status":"pending"}"#, #"{"status":"expired"}"#,
            #"{"status":"approved","account":{"type":"xtream","name":"LumaNest TV","server":"https://x.lumanest.tv","username":"u","password":"p"}}"#,
            #"{"status":"approved","account":{"type":"m3u","name":"LumaNest TV","m3uUrl":"https://tv.lumanest.tv/m3u?u=a&p=b"}}"#,
            #"{"status":"approved","account":"nope"}"#, #"{"status":"weird"}"#,
        ])
        let http = StubHTTPClient { request in ok(request, Data(answers.mutate { $0.removeFirst() }.utf8)) }
        let client = PairingClient(http: http, baseURL: URL(string: "https://staging.example.com/api/pair/")!)
        let pending = try await client.poll(deviceCode: "abc")
        XCTAssertEqual(pending, .pending)
        let expired = try await client.poll(deviceCode: "abc")
        XCTAssertEqual(expired, .expired)
        let xtream = try await client.poll(deviceCode: "abc")
        XCTAssertEqual(xtream, .approved(PairingAccount(type: "xtream", name: "LumaNest TV", server: "https://x.lumanest.tv", username: "u", password: "p")))
        let m3u = try await client.poll(deviceCode: "abc")
        XCTAssertEqual(m3u, .approved(PairingAccount(type: "m3u", name: "LumaNest TV", m3uUrl: "https://tv.lumanest.tv/m3u?u=a&p=b")))
        let broken = try await client.poll(deviceCode: "abc")
        XCTAssertEqual(broken, .expired)
        let weird = try await client.poll(deviceCode: "abc")
        XCTAssertEqual(weird, .expired)
        XCTAssertEqual(http.requests.first?.url.absoluteString, "https://staging.example.com/api/pair/poll")
        XCTAssertEqual(http.requests.first?.body, Data(#"{"deviceCode":"abc"}"#.utf8))
    }

    func testJSONWriterEscapes() {
        XCTAssertEqual(String(decoding: PairingClient.encode(.object(["b": .string("q\"\\\n\u{1}é"), "a": .array([.number(1), .bool(true), .null])])), as: UTF8.self),
                       #"{"a":[1,true,null],"b":"q\"\\\n\u0001é"}"#)
    }
}

/// The pairing loop on a manual clock: each test scripts the server and steps time.
final class PairingLoopTests: XCTestCase {
    /// Answers in order; "start" requests get `startAnswers`, polls `pollAnswers` (an exhausted list repeats its last answer).
    private final class Server: @unchecked Sendable {
        let starts: Shared<[Result<(Int, String, [String: String]), URLError>]>
        let polls: Shared<[Result<(Int, String, [String: String]), URLError>]>
        let log = Recorder<String>()
        init(starts: [Result<(Int, String, [String: String]), URLError>], polls: [Result<(Int, String, [String: String]), URLError>]) {
            self.starts = Shared(starts)
            self.polls = Shared(polls)
        }
        var client: StubHTTPClient {
            StubHTTPClient { [self] request in
                let isStart = request.url.lastPathComponent == "start"
                log.append(isStart ? "start" : "poll")
                let list = isStart ? starts : polls
                let answer = list.mutate { $0.count > 1 ? $0.removeFirst() : $0[0] }
                switch answer {
                case .success(let (status, body, headers)): return ok(request, Data(body.utf8), status: status, headers: headers)
                case .failure(let error): throw error
                }
            }
        }
    }

    private static func code(_ id: String, interval: Int = 5, expires: Int = 600) -> Result<(Int, String, [String: String]), URLError> {
        .success((200, #"{"deviceCode":"\#(id)","userCode":"\#(id)","verificationUriComplete":"https://lumanest.tv/pair?code=\#(id)","qr":["1"],"expiresIn":\#(expires),"interval":\#(interval)}"#, [:]))
    }
    private static let pending: Result<(Int, String, [String: String]), URLError> = .success((200, #"{"status":"pending"}"#, [:]))
    private static let expired: Result<(Int, String, [String: String]), URLError> = .success((200, #"{"status":"expired"}"#, [:]))
    private static let approved: Result<(Int, String, [String: String]), URLError> =
        .success((200, #"{"status":"approved","account":{"type":"xtream","server":"https://x.lumanest.tv","username":"u","password":"p"}}"#, [:]))

    private static func describe(_ status: PairingStatus) -> String {
        switch status {
        case .gettingCode: return "getting"
        case .waiting(let code): return "waiting \(code.userCode)"
        case .retrying(let code): return "retrying \(code?.userCode ?? "-")"
        case .paired(let source): return "paired \(source.username)"
        }
    }

    /// Runs the loop, stepping the clock until `done` holds for the statuses so far (or the loop ends).
    private func run(_ server: Server, clock: ManualClock, limit: Double = 400, step: Double = 0.5,
                     until done: @escaping @Sendable ([String]) -> Bool) async -> (statuses: [String], times: [Double]) {
        let log = Recorder<(String, Double)>()
        let finished = Shared(false)
        let stream = PairingLoop(client: PairingClient(http: server.client), clock: clock).run()
        let task = Task.detached {
            for await status in stream { log.append((PairingLoopTests.describe(status), clock.now())) }
            finished.value = true
        }
        await drive(clock, step: step, limit: limit) { finished.value || done(log.values.map(\.0)) }
        task.cancel()
        let entries = log.values
        return (entries.map(\.0), entries.map(\.1))
    }

    func testCodeThenPendingThenPaired() async {
        let server = Server(starts: [Self.code("AAAA")], polls: [Self.pending, Self.pending, Self.approved])
        let clock = ManualClock()
        let result = await run(server, clock: clock) { $0.last?.hasPrefix("paired") ?? false }
        XCTAssertEqual(result.statuses, ["getting", "waiting AAAA", "paired u"])
        XCTAssertEqual(server.log.values, ["start", "poll", "poll", "poll"])
        XCTAssertEqual(result.times.last ?? 0, 15, accuracy: 1.5, "polled every 5 s")
    }

    func testExpiredAndUnusableCodesAreReplaced() async {
        let unusable: Result<(Int, String, [String: String]), URLError> = .success((200, #"{"status":"approved","account":{"type":"xtream","server":"https://x"}}"#, [:]))
        let server = Server(starts: [Self.code("AAAA"), Self.code("BBBB"), Self.code("CCCC")], polls: [Self.expired, unusable, Self.approved])
        let result = await run(server, clock: ManualClock()) { $0.last?.hasPrefix("paired") ?? false }
        XCTAssertEqual(result.statuses, ["getting", "waiting AAAA", "getting", "waiting BBBB", "getting", "waiting CCCC", "paired u"])
    }

    func testCodesRenewBeforeTheyExpire() async {
        let server = Server(starts: [Self.code("AAAA", expires: 100), Self.code("BBBB")], polls: [Self.pending])
        let result = await run(server, clock: ManualClock()) { $0.contains("waiting BBBB") }
        XCTAssertEqual(result.statuses, ["getting", "waiting AAAA", "getting", "waiting BBBB"])
        XCTAssertEqual(result.times.last ?? 0, 80, accuracy: 6, "renewed at expiresIn - 20 s")
        let short = Server(starts: [Self.code("AAAA", expires: 30), Self.code("BBBB")], polls: [Self.pending])
        let shortResult = await run(short, clock: ManualClock()) { $0.contains("waiting BBBB") }
        XCTAssertEqual(shortResult.times.last ?? 0, 60, accuracy: 6, "never sooner than 60 s")
    }

    func testNetworkErrorsBackOffAndRecover() async {
        let server = Server(starts: [Self.code("AAAA")],
                            polls: [.failure(URLError(.timedOut)), .failure(URLError(.timedOut)), .failure(URLError(.timedOut)), Self.pending, Self.approved])
        let clock = ManualClock()
        let result = await run(server, clock: clock) { $0.last?.hasPrefix("paired") ?? false }
        XCTAssertEqual(result.statuses, ["getting", "waiting AAAA", "retrying AAAA", "waiting AAAA", "paired u"])
        // Polls at 5, then 10, 20 and 30 s later (doubling up to 30), then back to every 5 s.
        XCTAssertEqual(result.times.last ?? 0, 5 + 10 + 20 + 30 + 5, accuracy: 3)
    }

    func testStartFailuresBackOffAndHonourRetryAfter() async {
        let server = Server(starts: [.failure(URLError(.cannotConnectToHost)), .failure(URLError(.cannotConnectToHost)),
                                     .success((429, #"{"error":{"code":"pairing_rate_limit","message":"x"}}"#, ["retry-after": "120"])), Self.code("AAAA")],
                            polls: [Self.pending])
        let result = await run(server, clock: ManualClock(), limit: 600, step: 1) { $0.contains("waiting AAAA") }
        XCTAssertEqual(result.statuses, ["getting", "retrying -", "getting", "retrying -", "getting", "retrying -", "getting", "waiting AAAA"])
        XCTAssertEqual(result.times.last ?? 0, 5 + 10 + 120, accuracy: 4)
    }

    func testIntervalsAreClamped() async {
        let fast = Server(starts: [Self.code("AAAA", interval: 1)], polls: [Self.approved])
        let fastResult = await run(fast, clock: ManualClock(), step: 0.25) { $0.last?.hasPrefix("paired") ?? false }
        XCTAssertEqual(fastResult.times.last ?? 0, 2, accuracy: 0.75)
        let slow = Server(starts: [Self.code("AAAA", interval: 100)], polls: [Self.approved])
        let slowResult = await run(slow, clock: ManualClock()) { $0.last?.hasPrefix("paired") ?? false }
        XCTAssertEqual(slowResult.times.last ?? 0, 30, accuracy: 1.5)
    }

    func testStoppingTheConsumerStopsTheLoop() async {
        let server = Server(starts: [Self.code("AAAA")], polls: [Self.pending])
        let clock = ManualClock()
        _ = await run(server, clock: clock) { $0.contains("waiting AAAA") }
        let requests = server.log.count
        for _ in 0..<20 {
            clock.advance(by: 5)
            await settle()
        }
        XCTAssertEqual(server.log.count, requests, "no polls after the consumer went away")
    }
}
