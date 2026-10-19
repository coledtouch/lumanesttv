import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

final class JSONValueTests: XCTestCase {
    func testParsesEveryValueKind() throws {
        let value = try JSONValue.parse(Data(#"{"a":[1,-2.5,1e3,true,false,null,"x"],"b":{"c":"d"},"e":""}"#.utf8))
        XCTAssertEqual(value["a"], .array([.number(1), .number(-2.5), .number(1000), .bool(true), .bool(false), .null, .string("x")]))
        XCTAssertEqual(value["b"]?["c"], .string("d"))
        XCTAssertNil(value["missing"])
        XCTAssertNil(JSONValue.string("x")["a"])
    }

    func testStringEscapesAndUnicode() throws {
        let value = try JSONValue.parse(Data(#"["a\"b\\c\/d\n\t", "é€", "😀", "\ud800x", "Amélie"]"#.utf8))
        XCTAssertEqual(value.elements.map { $0.text }, ["a\"b\\c/d", "é€", "😀", "\u{FFFD}x", "Amélie"])
    }

    func testByteOrderMarkAndTrailingContent() throws {
        var data = Data([0xEF, 0xBB, 0xBF])
        data.append(Data(#"  {"ok":1}  garbage"#.utf8))
        XCTAssertEqual(try JSONValue.parse(data)["ok"]?.int, 1)
    }

    func testMalformedDocumentsThrow() {
        for text in ["", "{", "[1,", "{\"a\" 1}", "tru", "\"open", "-", "{\"a\":1,}x"] {
            XCTAssertThrowsError(try JSONValue.parse(Data(text.utf8)), text)
        }
    }

    func testDeepNestingIsRejectedNotACrash() {
        let deep = String(repeating: "[", count: 600) + String(repeating: "]", count: 600)
        XCTAssertThrowsError(try JSONValue.parse(Data(deep.utf8)))
    }

    func testLenientText() {
        XCTAssertEqual(JSONValue.number(12).text, "12")
        XCTAssertEqual(JSONValue.number(12.5).text, "12.5")
        XCTAssertEqual(JSONValue.bool(true).text, "true")
        XCTAssertEqual(JSONValue.string("  x  ").text, "x")
        XCTAssertNil(JSONValue.string("   ").text)
        XCTAssertNil(JSONValue.string("null").text)
        XCTAssertNil(JSONValue.null.text)
        XCTAssertNil(JSONValue.object([:]).text)
        XCTAssertEqual(JSONValue.array([.string(" "), .number(3), .string("first")]).text, "first")
        XCTAssertNil(JSONValue.array([]).text)
    }

    func testNumbersFromTextOrNumbers() {
        XCTAssertEqual(JSONValue.string("12").int, 12)
        XCTAssertEqual(JSONValue.string("12.0").int, 12)
        XCTAssertEqual(JSONValue.number(12).int, 12)
        XCTAssertEqual(JSONValue.number(12.9).int, 12)
        XCTAssertNil(JSONValue.string("x").int)
        XCTAssertNil(JSONValue.number(.infinity).int)
        XCTAssertEqual(JSONValue.string("7.5").double, 7.5)
        XCTAssertEqual(JSONValue.number(3).double, 3)
        XCTAssertNil(JSONValue.bool(true).int)
    }

    func testElementsOfArraysAndObjectsInKeyOrder() throws {
        let object = try JSONValue.parse(Data(#"{"10":"ten","2":"two","b":"bee","a":"ay","1":"one"}"#.utf8))
        XCTAssertEqual(object.elements.map { $0.text }, ["one", "two", "ten", "ay", "bee"])
        XCTAssertEqual(JSONValue.array([.null]).elements, [.null])
        XCTAssertEqual(JSONValue.string("x").elements, [])
    }

    func testDecodableMatchesTheParser() throws {
        let data = Data(#"{"n":1,"s":"x","b":false,"a":[null],"o":{}}"#.utf8)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(decoded, try JSONValue.parse(data))
        XCTAssertEqual(decoded["b"], .bool(false))
        XCTAssertEqual(decoded["n"], .number(1))
    }

    func testLenientStringAndList() throws {
        struct Row: Decodable, Sendable { let id: LenientString; let name: LenientString? }
        let list = try JSONDecoder().decode(LenientList<Row>.self, from: Data(#"[{"id":1,"name":["","x"]},{"id":"2"},5,{"id":true,"name":null}]"#.utf8))
        XCTAssertEqual(list.items.map { $0.id.value }, ["1", "2", "true"])
        XCTAssertEqual(list.items.first?.name?.value, "x")
        let keyed = try JSONDecoder().decode(LenientList<Row>.self, from: Data(#"{"b":{"id":"b"},"a":{"id":"a"},"x":"skip"}"#.utf8))
        XCTAssertEqual(keyed.items.map { $0.id.value }, ["a", "b"])
        let other = try JSONDecoder().decode(LenientList<Row>.self, from: Data(#""text""#.utf8))
        XCTAssertTrue(other.items.isEmpty)
    }
}

final class HTTPClientTests: XCTestCase {
    func testStubRecordsRequestsAndThrowsForErrorStatuses() async throws {
        let client = StubHTTPClient { request in
            ok(request, Data("{\"error\":1}".utf8), status: request.url.path == "/missing" ? 404 : 200)
        }
        let good = try await client.data(HTTPRequestSpec(url: URL(string: "http://h.example.com/a")!))
        XCTAssertEqual(good.status, 200)
        do {
            _ = try await client.data(HTTPRequestSpec(url: URL(string: "http://h.example.com/missing")!))
            XCTFail("expected a status error")
        } catch {
            XCTAssertEqual(error as? TunerError, .serverStatus(404))
        }
        // `raw` hands back any status.
        let raw = try await client.raw(HTTPRequestSpec(url: URL(string: "http://h.example.com/missing")!, method: "POST"))
        XCTAssertEqual(raw.status, 404)
        XCTAssertEqual(client.requests.map(\.method), ["GET", "GET", "POST"])
    }

    func testGzipBodiesAreInflatedWhateverTheHeadersSay() async throws {
        let client = StubHTTPClient { ok($0, Fixture.data("gzip/fixed.gz"), headers: ["content-type": "text/plain"]) }
        let result = try await client.data(HTTPRequestSpec(url: URL(string: "http://h.example.com/a")!))
        XCTAssertEqual(result.body, Fixture.data("gzip/text.txt"))
    }

    func testDownloadReplacesTheFileOnlyOnSuccess() async throws {
        let directory = makeTemporaryDirectory(self)
        let destination = directory.appendingPathComponent("cache/guide.xml")
        let fail = Shared(false)
        let client = StubHTTPClient { request in
            if fail.value { return ok(request, Data(), status: 500) }
            return ok(request, Fixture.data("guide.xml.gz"))
        }
        let result = try await client.download(HTTPRequestSpec(url: URL(string: "http://h.example.com/xmltv.php")!), to: destination)
        XCTAssertTrue(result.body.isEmpty)
        XCTAssertEqual(try Data(contentsOf: destination), Fixture.data("guide.xml"))
        fail.value = true
        do {
            _ = try await client.download(HTTPRequestSpec(url: URL(string: "http://h.example.com/xmltv.php")!), to: destination)
            XCTFail("expected failure")
        } catch {}
        XCTAssertEqual(try Data(contentsOf: destination), Fixture.data("guide.xml"), "a failed download keeps the stale file")
    }

    func testURLSessionClientInstallsGzippedDownloads() throws {
        let directory = makeTemporaryDirectory(self)
        let staged = directory.appendingPathComponent("staged")
        try Fixture.data("guide.xml.gz").write(to: staged)
        let destination = directory.appendingPathComponent("guide.xml")
        try URLSessionHTTPClient.install(staged, at: destination)
        XCTAssertEqual(try Data(contentsOf: destination), Fixture.data("guide.xml"))
        let plain = directory.appendingPathComponent("plain")
        try Data("plain".utf8).write(to: plain)
        try URLSessionHTTPClient.install(plain, at: destination)
        XCTAssertEqual(try Data(contentsOf: destination), Data("plain".utf8))
    }

    func testTimeoutHelperCancelsSlowWork() async {
        do {
            _ = try await withTimeout(0.05) { () async throws -> Int in
                try await Task.sleep(nanoseconds: 5_000_000_000)
                return 1
            }
            XCTFail("expected a timeout")
        } catch {
            XCTAssertEqual(error as? TunerError, .timedOut)
        }
        let value = try? await withTimeout(1) { () async throws -> Int in 7 }
        XCTAssertEqual(value, 7)
    }

    func testURLSessionClientReportsAnUnreachableHost() async {
        // Port 9 on the loopback interface refuses connections: no network access is needed.
        let client = URLSessionHTTPClient(requestTimeout: 5)
        do {
            _ = try await client.data(HTTPRequestSpec(url: URL(string: "http://127.0.0.1:9/player_api.php")!, timeout: 5))
            XCTFail("expected an error")
        } catch {
            XCTAssertTrue([TunerError.refused, .unreachable, .timedOut].contains(error as? TunerError), "\(error)")
        }
    }
}
