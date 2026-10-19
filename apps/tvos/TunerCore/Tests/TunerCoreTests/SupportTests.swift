import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

final class EditionTests: XCTestCase {
    func testEveryBuildOfThisRepositoryIsTheAppStoreEdition() {
        XCTAssertEqual(Edition.current, .appStore)
        XCTAssertEqual(Edition.current.adultFilterMode, .strict)
        XCTAssertEqual(Edition.direct.adultFilterMode, .standard)
    }

    func testFixedLinksAndIdentifiers() {
        XCTAssertEqual(TunerLinks.pairingAPI.appendingPathComponent("start").absoluteString, "https://lumanest.tv/api/pair/start")
        XCTAssertEqual(TunerLinks.catalogRows.absoluteString, "https://lumanest.tv/api/catalog/rows?v=1")
        XCTAssertEqual(TunerLinks.pairingDevice, "appletv")
        XCTAssertEqual(TunerLinks.lumanestUserAgent, "LumaNestTuner/AppleTV")
        XCTAssertEqual(TunerLinks.streamUserAgent, "VLC/3.0.21 LibVLC/3.0.21")
        XCTAssertEqual(TunerLinks.privacyPolicy.absoluteString, "https://tunertv.app/privacy")
        XCTAssertEqual(TunerLinks.help.absoluteString, "https://tunertv.app/support")
        XCTAssertTrue(TunerLinks.privacyNotice.contains("tunertv.app/privacy"))
        XCTAssertFalse(TunerLinks.privacyNotice.contains("lumanest.tv"), "lumanest.tv/apps sells plans")
        // Reader-app rules: nothing the app shows points at purchasing.
        for text in [TunerLinks.privacyNotice, TunerLinks.tmdbAttribution] {
            for word in ["buy", "plan", "renew", "subscribe", "price", "IPTV", "Xtream", "M3U"] {
                XCTAssertFalse(text.localizedCaseInsensitiveContains(word), "\(text) mentions \(word)")
            }
        }
    }
}

final class TunerErrorTests: XCTestCase {
    func testMessages() {
        XCTAssertEqual(TunerError.unreachable.message, "Can't reach the server. Check the URL.")
        XCTAssertEqual(TunerError.timedOut.message, "The server took too long to respond.")
        XCTAssertEqual(TunerError.refused.message, "Connection refused by the server.")
        XCTAssertEqual(TunerError.loginFailed.message, "Login failed. Check the username and password.")
        XCTAssertEqual(TunerError.serverStatus(503).message, "Server returned 503")
        XCTAssertEqual(TunerError.invalidInput("Enter a server address.").message, "Enter a server address.")
    }

    func testMapping() {
        XCTAssertEqual(TunerError.from(TunerError.loginFailed), .loginFailed)
        XCTAssertEqual(TunerError.from(CancellationError()), .cancelled)
        XCTAssertEqual(TunerError.from(URLError(.timedOut)), .timedOut)
        XCTAssertEqual(TunerError.from(URLError(.cannotConnectToHost)), .refused)
        XCTAssertEqual(TunerError.from(URLError(.cannotFindHost)), .unreachable)
        XCTAssertEqual(TunerError.from(URLError(.notConnectedToInternet)), .unreachable)
        XCTAssertEqual(TunerError.from(URLError(.cancelled)), .cancelled)
        XCTAssertEqual(TunerError.from(URLError(.badServerResponse)), .invalidResponse)
        XCTAssertEqual(TunerError.from(UpstreamError.headerDeadline), .timedOut)
        XCTAssertEqual(TunerError.from(NSError(domain: NSPOSIXErrorDomain, code: Int(ECONNREFUSED))), .refused)
        struct Odd: Error {}
        XCTAssertEqual(TunerError.from(Odd()), .unreachable)
    }
}

final class StableHashTests: XCTestCase {
    func testFNV1a64KnownAnswers() {
        XCTAssertEqual(StableHash.fnv1a64(""), 0xcbf2_9ce4_8422_2325)
        XCTAssertEqual(StableHash.fnv1a64("a"), 0xaf63_dc4c_8601_ec8c)
        XCTAssertEqual(StableHash.fnv1a64("foobar"), 0x8594_4171_f739_67e8)
        // Stable across calls (unlike `hashValue`).
        XCTAssertEqual(StableHash.fnv1a64("http://h/live/1.ts"), StableHash.fnv1a64("http://h/live/1.ts"))
    }

    func testBase36() {
        XCTAssertEqual(StableHash.base36(0), "0")
        XCTAssertEqual(StableHash.base36(35), "z")
        XCTAssertEqual(StableHash.base36(36), "10")
        XCTAssertEqual(StableHash.base36(UInt64.max), "3w5e11264sgsf")
    }

    func testSHA256KnownAnswers() {
        XCTAssertEqual(StableHash.sha256Hex(Data()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(StableHash.sha256Hex(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(StableHash.sha256Hex(Data("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq".utf8)),
                       "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1")
        XCTAssertEqual(StableHash.sha256Hex(Data(repeating: UInt8(ascii: "a"), count: 1_000_000)),
                       "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")
        // Padding boundaries: 55, 56 and 64 bytes.
        XCTAssertEqual(StableHash.sha256Hex(Data(repeating: 0x61, count: 55)), "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318")
        XCTAssertEqual(StableHash.sha256Hex(Data(repeating: 0x61, count: 56)), "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a")
        XCTAssertEqual(StableHash.sha256Hex(Data(repeating: 0x61, count: 64)), "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb")
    }
}

final class GzipTests: XCTestCase {
    struct Expected: Decodable { let length: Int; let sha256: String }
    lazy var manifest: [String: Expected] = try! JSONDecoder().decode([String: Expected].self, from: Fixture.data("gzip/manifest.json"))

    func testEveryDeflateBlockTypeAndHeaderFlagInflates() throws {
        for name in ["stored.gz", "fixed.gz", "dynamic.gz", "headers.gz", "multi.gz", "big.gz", "noise.gz", "empty.gz"] {
            let packed = Fixture.data("gzip/\(name)")
            XCTAssertTrue(Gzip.isGzip(packed), name)
            let plain = try Gzip.decompress(packed)
            XCTAssertEqual(plain.count, manifest[name]!.length, name)
            XCTAssertEqual(StableHash.sha256Hex(plain), manifest[name]!.sha256, name)
        }
        XCTAssertEqual(try Gzip.decompress(Fixture.data("gzip/dynamic.gz")), Fixture.data("gzip/text.txt"))
    }

    func testMagicCheckIgnoresHeaders() {
        XCTAssertFalse(Gzip.isGzip(Data()))
        XCTAssertFalse(Gzip.isGzip(Data([0x1f])))
        XCTAssertFalse(Gzip.isGzip(Data("[{}]".utf8)))
        XCTAssertTrue(Gzip.isGzip(Data([0x1f, 0x8b, 0x00])))
        // A slice that doesn't start at index 0.
        let data = Data([0x00, 0x1f, 0x8b])
        XCTAssertTrue(Gzip.isGzip(data.dropFirst()))
    }

    func testCorruptDataThrows() {
        var bad = Fixture.data("gzip/dynamic.gz")
        bad[bad.count - 6] ^= 0xFF // stored CRC
        XCTAssertThrowsError(try Gzip.decompress(bad))
        let truncated = Fixture.data("gzip/big.gz").prefix(1000)
        XCTAssertThrowsError(try Gzip.decompress(Data(truncated)))
        XCTAssertThrowsError(try Gzip.decompress(Data([0x1f, 0x8b, 0x07, 0, 0, 0, 0, 0, 0, 3])))
        XCTAssertThrowsError(try Gzip.decompress(Data()))
        // Trailing bytes after the last member that aren't another member are ignored.
        var trailing = Fixture.data("gzip/fixed.gz")
        trailing.append(contentsOf: [0, 0, 0, 0])
        XCTAssertEqual(try Gzip.decompress(trailing), Fixture.data("gzip/text.txt"))
    }

    func testFileInflationStreamsAndReplacesAtomically() throws {
        let directory = makeTemporaryDirectory(self)
        let source = directory.appendingPathComponent("big.gz")
        try Fixture.data("gzip/big.gz").write(to: source)
        let destination = directory.appendingPathComponent("out/big.txt")
        try Gzip.decompressFile(at: source, to: destination)
        XCTAssertEqual(StableHash.sha256Hex(try Data(contentsOf: destination)), manifest["big.gz"]!.sha256)
        // A failed inflate leaves an existing destination as it was.
        let bad = directory.appendingPathComponent("bad.gz")
        try Fixture.data("gzip/big.gz").prefix(5000).write(to: bad)
        XCTAssertThrowsError(try Gzip.decompressFile(at: bad, to: destination))
        XCTAssertEqual(StableHash.sha256Hex(try Data(contentsOf: destination)), manifest["big.gz"]!.sha256)
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: destination.deletingLastPathComponent().path)
        XCTAssertEqual(leftovers, ["big.txt"])
    }
}

final class TimeTextTests: XCTestCase {
    func testClockAndTimeLeft() {
        XCTAssertEqual(TimeText.clock(seconds: 0), "0:00")
        XCTAssertEqual(TimeText.clock(seconds: 123), "2:03")
        XCTAssertEqual(TimeText.clock(seconds: 3723), "1:02:03")
        XCTAssertEqual(TimeText.clock(seconds: -5), "0:00")
        XCTAssertEqual(TimeText.left(seconds: 45), "45 sec left")
        XCTAssertEqual(TimeText.left(seconds: 12 * 60 + 30), "12 min left")
        XCTAssertEqual(TimeText.left(seconds: 3900), "1 hr 5 min left")
        XCTAssertEqual(TimeText.left(seconds: 7200), "2 hr left")
    }

    func testRatingBadge() {
        XCTAssertEqual(TimeText.rating("7.5"), "7.5")
        XCTAssertEqual(TimeText.rating("8.0"), "8")
        XCTAssertEqual(TimeText.rating("7.46"), "7.5")
        XCTAssertEqual(TimeText.rating(" 6 "), "6")
        for bad in [nil, "", "0", "0.0", "-1", "nan", "inf", "abc", "0.01"] { XCTAssertNil(TimeText.rating(bad), "\(String(describing: bad))") }
        XCTAssertEqual(TimeText.ratingValue("8.2"), 8.2)
        XCTAssertNil(TimeText.ratingValue("0"))
    }

    func testTimeOfDayInAGivenZone() {
        let date = utc(2026, 10, 13, 1, 30)
        XCTAssertEqual(TimeText.time(date, timeZone: TimeZone(identifier: "UTC")!), "1:30 AM")
        XCTAssertEqual(TimeText.time(date, timeZone: TimeZone(identifier: "America/New_York")!), "9:30 PM")
        XCTAssertEqual(TimeText.time(utc(2026, 1, 1, 12, 5), timeZone: TimeZone(identifier: "UTC")!), "12:05 PM")
        XCTAssertEqual(TimeText.time(utc(2026, 1, 1, 0, 0), timeZone: TimeZone(identifier: "UTC")!), "12:00 AM")
    }
}

final class ClockTests: XCTestCase {
    func testManualClockWakesSleepersInDeadlineOrder() async throws {
        let clock = ManualClock(start: 10)
        XCTAssertEqual(clock.now(), 10)
        let woke = Recorder<String>()
        let a = Task { try await clock.sleep(seconds: 2); woke.append("a") }
        let b = Task { try await clock.sleep(seconds: 1); woke.append("b") }
        await eventually { clock.sleeperCount == 2 }
        clock.advance(by: 1)
        await eventually { woke.values == ["b"] }
        clock.advance(by: 0.5)
        try await Task.sleep(nanoseconds: 5_000_000)
        XCTAssertEqual(woke.values, ["b"])
        clock.advance(by: 0.5)
        try await a.value
        try await b.value
        XCTAssertEqual(woke.values, ["b", "a"])
        XCTAssertEqual(clock.now(), 12)
        // Zero and negative sleeps return at once.
        try await clock.sleep(seconds: 0)
        try await clock.sleep(seconds: -1)
    }

    func testCancellingAManualSleepThrows() async {
        let clock = ManualClock()
        let task = Task { try await clock.sleep(seconds: 100) }
        await eventually { clock.sleeperCount == 1 }
        task.cancel()
        do {
            try await task.value
            XCTFail("expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        XCTAssertEqual(clock.sleeperCount, 0)
    }

    func testSystemClockIsMonotonic() async throws {
        let clock = SystemClock()
        let start = clock.now()
        try await clock.sleep(seconds: 0.01)
        XCTAssertGreaterThanOrEqual(clock.now() - start, 0.009)
    }
}
