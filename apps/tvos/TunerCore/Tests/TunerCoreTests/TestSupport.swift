import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import TunerCore

// MARK: - Fixtures and files

enum Fixture {
    static func url(_ name: String) -> URL {
        Bundle.module.resourceURL!.appendingPathComponent("Fixtures").appendingPathComponent(name)
    }

    static func data(_ name: String) -> Data {
        do { return try Data(contentsOf: url(name)) } catch { fatalError("Missing fixture \(name): \(error)") }
    }

    static func text(_ name: String) -> String { String(decoding: data(name), as: UTF8.self) }
}

/// A fresh directory under the system temporary directory, removed by the test case's teardown.
func makeTemporaryDirectory(_ testCase: XCTestCase) -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("TunerCoreTests-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    testCase.addTeardownBlock { try? FileManager.default.removeItem(at: url) }
    return url
}

/// Collects values from @Sendable callbacks.
final class Recorder<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [Value] = []
    func append(_ value: Value) { lock.lock(); stored.append(value); lock.unlock() }
    var values: [Value] { lock.lock(); defer { lock.unlock() }; return stored }
    var count: Int { values.count }
}

/// A mutable value shared with @Sendable closures.
final class Shared<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value
    init(_ value: Value) { stored = value }
    var value: Value {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
    func mutate<T>(_ body: (inout Value) -> T) -> T { lock.lock(); defer { lock.unlock() }; return body(&stored) }
}

// MARK: - HTTP stubs

func ok(_ request: HTTPRequestSpec, _ body: Data, status: Int = 200, headers: [String: String] = [:]) -> HTTPResult {
    HTTPResult(status: status, headers: headers, finalURL: request.url, body: body)
}

/// The Xtream `action` (or "account" without one) a player_api request asks for; "xmltv" for the guide.
func xtreamAction(_ request: HTTPRequestSpec) -> String {
    let url = request.url.absoluteString
    if url.contains("/xmltv.php") { return "xmltv" }
    let items = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    return items.first { $0.name == "action" }?.value ?? "account"
}

func queryValue(_ request: HTTPRequestSpec, _ name: String) -> String? {
    URLComponents(url: request.url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == name }?.value
}

/// A fake provider panel answering player_api.php from the xtream fixtures.
func xtreamPanel(overrides: [String: Data] = [:], failing: Set<String> = []) -> StubHTTPClient {
    StubHTTPClient { request in
        let action = xtreamAction(request)
        if failing.contains(action) { throw URLError(.timedOut) }
        if let body = overrides[action] { return ok(request, body) }
        let files = ["account": "account", "get_live_categories": "live_categories", "get_live_streams": "live_streams",
                     "get_vod_categories": "vod_categories", "get_vod_streams": "vod_streams",
                     "get_series_categories": "series_categories", "get_series": "series", "get_vod_info": "vod_info",
                     "get_series_info": "series_info", "get_short_epg": "short_epg"]
        if let file = files[action] { return ok(request, Fixture.data("xtream/\(file).json")) }
        if action == "xmltv" { return ok(request, Fixture.data("guide.xml.gz")) }
        return ok(request, Data("not found".utf8), status: 404)
    }
}

let demoLogin = XtreamLogin(server: "http://line.example.com:8080", username: "demo", password: "s3cret pass")
let demoSource = Source(id: "src-1", name: "LumaNest TV", kind: .xtream, server: "http://line.example.com:8080", username: "demo",
                        password: "s3cret pass")

// MARK: - Waiting

/// Polls `condition` (real time) until it holds or `timeout` passes.
func eventually(timeout: TimeInterval = 5, _ message: @autoclosure () -> String = "condition never held",
                file: StaticString = #filePath, line: UInt = #line, _ condition: () async -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if await condition() { return }
        try? await Task.sleep(nanoseconds: 2_000_000)
    }
    if await condition() { return }
    XCTFail(message(), file: file, line: line)
}

/// Advances a `ManualClock` in small steps (letting tasks run between steps) until `condition` holds or `limit`
/// seconds of clock time have passed. Returns whether the condition held.
@discardableResult
func drive(_ clock: ManualClock, step: Double = 0.05, limit: Double = 60, until condition: () async -> Bool) async -> Bool {
    let end = clock.now() + limit
    while clock.now() < end {
        if await condition() { return true }
        await quiesce(clock)
        if await condition() { return true }
        clock.advance(by: step)
    }
    return await condition()
}

/// Lets tasks run until the number of sleepers on `clock` stops changing, so everything that is about to wait is
/// waiting before time moves on (otherwise a sleep registered late would drift).
func quiesce(_ clock: ManualClock) async {
    var last = -1
    var stable = 0
    for _ in 0..<100 {
        await settle()
        let count = clock.sleeperCount
        if count == last && count > 0 {
            stable += 1
            if stable >= 2 { return }
        } else {
            stable = 0
        }
        last = count
    }
}

/// Gives other tasks a chance to run.
func settle() async {
    for _ in 0..<5 { await Task.yield() }
    try? await Task.sleep(nanoseconds: 300_000)
}

// MARK: - Dates

/// UTC date from components.
func utc(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0, _ second: Int = 0) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second))!
}

/// US Eastern wall-clock date.
func eastern(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/New_York")!
    return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
}

// MARK: - Model builders

func channel(_ key: String, _ name: String, number: Int = 0, category: String = "c", categories: [String] = [], epg: String? = nil,
             country: String? = nil, language: String? = nil, adult: Bool = false, url: String? = nil) -> Channel {
    Channel(key: key, number: number, name: name, categoryID: category, categoryIDs: categories.isEmpty ? [category] : categories,
            epgID: epg, streamID: key, url: URL(string: url ?? "http://h.example.com/live/u/p/\(key.replacingOccurrences(of: ":", with: "_")).ts")!,
            country: country, language: language, adult: adult)
}

func movie(_ id: String, _ name: String, category: String = "c", categories: [String] = [], added: Int64 = 0, ext: String? = "mp4",
           year: String? = nil, tmdb: Int? = nil, rating: String? = nil, genre: String? = nil, adult: Bool = false) -> Movie {
    Movie(id: id, name: name, categoryID: category, categoryIDs: categories.isEmpty ? [category] : categories,
          url: URL(string: "http://h.example.com/movie/u/p/\(id.replacingOccurrences(of: ":", with: "_")).\(ext ?? "mp4")")!,
          added: added, containerExtension: ext, year: year, tmdbID: tmdb, genre: genre, adult: adult)
        .with { $0.rating = rating }
}

func series(_ id: String, _ name: String, category: String = "c", categories: [String] = [], added: Int64 = 0, year: String? = nil,
            tmdb: Int? = nil, rating: String? = nil, genre: String? = nil, adult: Bool = false) -> Series {
    Series(id: id, seriesID: String(id.split(separator: ":").last ?? ""), name: name, rating: rating, genre: genre, year: year, added: added,
           categoryID: category, categoryIDs: categories.isEmpty ? [category] : categories, tmdbID: tmdb, adult: adult)
}

func episode(_ id: String, season: Int, number: Int, ext: String = "mp4", duration: Int = 1800) -> Episode {
    Episode(id: id, season: season, number: number, title: "Episode \(number)", durationSeconds: duration,
            url: URL(string: "http://h.example.com/series/u/p/\(id.replacingOccurrences(of: ":", with: "_")).\(ext)")!, containerExtension: ext)
}

extension Movie {
    func with(_ change: (inout Movie) -> Void) -> Movie {
        var copy = self
        change(&copy)
        return copy
    }
}
