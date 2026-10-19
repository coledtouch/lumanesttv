import Foundation
import XCTest
@testable import TunerCore

final class HTTPHeadTests: XCTestCase {
    private func parse(_ text: String) -> HTTPRequestHead.Parse { HTTPRequestHead.parse(Data(text.utf8)) }

    func testCompleteHeads() {
        let text = "GET /live/abc/media.m3u8?x=1 HTTP/1.1\r\nHost: 127.0.0.1:49152\r\nX-Playback-Session-Id: A\r\nAccept: */*\r\n\r\nBODY"
        guard case .complete(let head, let length) = parse(text) else { return XCTFail("expected a complete head") }
        XCTAssertEqual(head.method, "GET")
        XCTAssertEqual(head.path, "/live/abc/media.m3u8")
        XCTAssertEqual(head.headers["host"], "127.0.0.1:49152")
        XCTAssertEqual(head.headers["x-playback-session-id"], "A")
        XCTAssertNil(head.range)
        XCTAssertEqual(length, text.utf8.count - 4, "the body starts after the blank line")

        guard case .complete(let ranged, _) = parse("head /vod/s/media.mp4 HTTP/1.1\r\nRange: bytes=100-199\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(ranged.method, "HEAD")
        XCTAssertEqual(ranged.range, ByteRange(start: 100, end: 199))
        guard case .complete(let open, _) = parse("GET /a%20b HTTP/1.0\r\nrange:bytes=5-\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(open.path, "/a b", "percent-decoded")
        XCTAssertEqual(open.range, ByteRange(start: 5, end: nil))
        guard case .complete(let absolute, _) = parse("GET http://127.0.0.1:5/live/x/1.ts HTTP/1.1\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(absolute.path, "/live/x/1.ts")
        guard case .complete(let repeated, _) = parse("GET / HTTP/1.1\r\nA: 1\r\na: 2\r\n\r\n") else { return XCTFail() }
        XCTAssertEqual(repeated.headers["a"], "1, 2")
    }

    func testRanges() {
        XCTAssertEqual(HTTPRequestHead.parseRange("bytes=0-0"), ByteRange(start: 0, end: 0))
        XCTAssertNil(HTTPRequestHead.parseRange("bytes=-500"), "suffix ranges send the whole file")
        XCTAssertNil(HTTPRequestHead.parseRange("bytes=0-1,5-6"), "multiple ranges send the whole file")
        XCTAssertNil(HTTPRequestHead.parseRange("bytes=9-3"))
        XCTAssertNil(HTTPRequestHead.parseRange("items=0-1"))
        XCTAssertEqual(ByteRange(start: 5, end: nil).headerValue, "bytes=5-")
        XCTAssertEqual(ByteRange(start: 5, end: 10).headerValue, "bytes=5-10")
    }

    func testIncompleteAndInvalidHeads() {
        XCTAssertEqual(parse("GET / HTTP/1.1\r\nHost: x\r\n"), .incomplete)
        XCTAssertEqual(parse(""), .incomplete)
        XCTAssertEqual(parse("GARBAGE\r\n\r\n"), .invalid)
        XCTAssertEqual(parse("GET relative HTTP/1.1\r\n\r\n"), .invalid)
        XCTAssertEqual(parse("GET / SPDY/3\r\n\r\n"), .invalid)
        XCTAssertEqual(parse("GET / HTTP/1.1\r\nno colon here\r\n\r\n"), .invalid)
        XCTAssertEqual(parse("GET / HTTP/1.1\r\nX: " + String(repeating: "a", count: 17 * 1024)), .invalid, "heads over 16 KiB")
        XCTAssertEqual(parse("GET / HTTP/1.1\r\nX: " + String(repeating: "a", count: 17 * 1024) + "\r\n\r\n"), .invalid)
    }

    func testResponseHeads() {
        let data = HTTPResponse(status: 200, headers: [HTTPHeader("Content-Type", "video/mp2t"), HTTPHeader("Connection", "keep-alive")],
                                body: .data(Data(count: 1316)))
        XCTAssertEqual(String(decoding: data.serializedHead(), as: UTF8.self),
                       "HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nConnection: close\r\nContent-Length: 1316\r\n\r\n")
        let ranged = HTTPResponse(status: 206, headers: [HTTPHeader("Content-Length", "10"), HTTPHeader("X-Bad", "a\r\nInjected: 1")],
                                  body: .stream(AsyncThrowingStream { $0.finish() }))
        XCTAssertEqual(String(decoding: ranged.serializedHead(), as: UTF8.self),
                       "HTTP/1.1 206 Partial Content\r\nContent-Length: 10\r\nX-Bad: a  Injected: 1\r\nConnection: close\r\n\r\n")
        let streamed = HTTPResponse(status: 200, body: .stream(AsyncThrowingStream { $0.finish() }))
        XCTAssertFalse(String(decoding: streamed.serializedHead(), as: UTF8.self).contains("Content-Length"))
        XCTAssertEqual(String(decoding: HTTPResponse(status: 503).serializedHead(), as: UTF8.self),
                       "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
        let plain = HTTPResponse.status(404)
        XCTAssertEqual(plain.status, 404)
        if case .data(let body) = plain.body { XCTAssertEqual(String(decoding: body, as: UTF8.self), "Not Found\n") } else { XCTFail() }
        if case .data(let body) = HTTPResponse.status(503, text: "Busy").body { XCTAssertEqual(body, Data("Busy\n".utf8)) } else { XCTFail() }
    }
}

final class SubtitleParserTests: XCTestCase {
    func testSRT() {
        let cues = SubtitleParser.parse(Fixture.data("subtitles/sample.srt"), format: .srt)
        XCTAssertEqual(cues, [
            SubtitleCue(start: 1, end: 2.5, text: "Hello there\nsecond line"),
            SubtitleCue(start: 2, end: 3.5, text: "Overlap starts later in the file"),
            SubtitleCue(start: 3, end: 4, text: "Top & tagged"),
        ])
        XCTAssertEqual(SubtitleParser.cue(at: 1.2, in: cues)?.start, 1)
        XCTAssertEqual(SubtitleParser.cue(at: 2.2, in: cues)?.start, 2, "the latest cue that started wins")
        XCTAssertEqual(SubtitleParser.cue(at: 3.2, in: cues)?.start, 3)
        XCTAssertNil(SubtitleParser.cue(at: 0.5, in: cues))
        XCTAssertNil(SubtitleParser.cue(at: 4.5, in: cues))
        XCTAssertNil(SubtitleParser.cue(at: 1, in: []))
    }

    func testWebVTT() {
        let cues = SubtitleParser.parse(Fixture.data("subtitles/sample.vtt"), format: .webvtt)
        XCTAssertEqual(cues, [SubtitleCue(start: 1, end: 2, text: "Hi there"), SubtitleCue(start: 3600.25, end: 3601.75, text: "An hour in")])
    }

    func testSSA() {
        let cues = SubtitleParser.parse(Fixture.data("subtitles/sample.ass"), format: .ssa)
        XCTAssertEqual(cues, [SubtitleCue(start: 1, end: 2.5, text: "Hello, world\nsecond line"), SubtitleCue(start: 3, end: 4, text: "Commas, inside, text here")])
    }

    func testTTML() {
        let cues = SubtitleParser.parse(Fixture.data("subtitles/sample.ttml"), format: .ttml)
        XCTAssertEqual(cues.map(\.text), ["Hello\nworld", "Ticks & é", "Prefixed", "Frames"])
        XCTAssertEqual(cues.map(\.start), [1, 3, 5, 7.48])
        XCTAssertEqual(cues.map(\.end), [2.5, 4, 6.5, 8])
        XCTAssertEqual(SubtitleParser.ttmlTime("1500ms", tickRate: 1, frameRate: 25), 1.5)
        XCTAssertEqual(SubtitleParser.ttmlTime("2m", tickRate: 1, frameRate: 25), 120)
        XCTAssertEqual(SubtitleParser.ttmlTime("0.5h", tickRate: 1, frameRate: 25), 1800)
        XCTAssertEqual(SubtitleParser.ttmlTime("50f", tickRate: 1, frameRate: 25), 2)
        XCTAssertNil(SubtitleParser.ttmlTime("soon", tickRate: 1, frameRate: 25))
    }

    func testLegacyEncodingsAndGarbage() {
        let latin = Data([0x31, 0x0A] + Array("00:00:01,000 --> 00:00:02,000\nCaf".utf8) + [0xE9, 0x0A])
        XCTAssertEqual(SubtitleParser.parse(latin, format: .srt).first?.text, "Café", "Windows-1252 files are read")
        XCTAssertEqual(SubtitleParser.parse(Data("no cues here".utf8), format: .srt), [])
        XCTAssertEqual(SubtitleParser.parse(Data(), format: .ttml), [])
        XCTAssertEqual(SubtitleParser.clockSeconds("01:02:03.5"), 3723.5)
        XCTAssertEqual(SubtitleParser.clockSeconds("02:03,250"), 123.25)
        XCTAssertNil(SubtitleParser.clockSeconds("3"))
    }
}
