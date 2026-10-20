import Foundation
import XCTest
@testable import TunerCore

/// Runs the cases of docs/extras-cases.json that Apple TV owns (docs/extras.md "Test cases"): `live_category` (the
/// hidden "Most watched now" category) and `vtt_cues` (reading WebVTT and the text at a time). The other kinds are the
/// server's (`site/lib/extras.ts`).
///
/// The package reads its copy, Fixtures/extras-cases.json; `testFixtureIsTheRepositoryCopy` fails when that copy
/// differs from the repository's docs/extras-cases.json.
final class ExtrasCasesTests: XCTestCase {
    private static let fixture = "extras-cases.json"

    private static var repositoryCopy: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // TunerCoreTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // TunerCore (the package)
            .appendingPathComponent("../../../docs/extras-cases.json").standardizedFileURL
    }

    private func cases(_ kind: String) throws -> [[String: JSONValue]] {
        let root = try JSONDecoder().decode(JSONValue.self, from: Fixture.data(ExtrasCasesTests.fixture))
        guard case .array(let entries) = root else { XCTFail("\(ExtrasCasesTests.fixture) is not an array"); return [] }
        let matching = entries.compactMap { entry -> [String: JSONValue]? in
            guard case .object(let fields) = entry, case .string(kind)? = fields["kind"] else { return nil }
            return fields
        }
        XCTAssertFalse(matching.isEmpty, "no \(kind) cases")
        return matching
    }

    /// Escapes everything but printable ASCII, so failures show invisible characters.
    private func shown(_ text: String) -> String {
        "\"" + text.unicodeScalars.map { $0.isASCII && $0.value >= 0x20 && $0.value < 0x7F ? String($0) : String(format: "\\u{%04X}", $0.value) }
            .joined() + "\""
    }

    func testFixtureIsTheRepositoryCopy() throws {
        let repository = ExtrasCasesTests.repositoryCopy
        guard FileManager.default.fileExists(atPath: repository.path) else {
            throw XCTSkip("\(repository.path) is not here (the package was built outside the repository)")
        }
        XCTAssertEqual(try Data(contentsOf: repository), Fixture.data(ExtrasCasesTests.fixture),
                       "Tests/TunerCoreTests/Fixtures/extras-cases.json differs from docs/extras-cases.json: copy it again")
    }

    /// A new kind needs a decision: run it here, or leave it to the server.
    func testEveryCaseHasAKnownKind() throws {
        let root = try JSONDecoder().decode(JSONValue.self, from: Fixture.data(ExtrasCasesTests.fixture))
        let kinds = Set(root.elements.compactMap { $0["kind"]?.text })
        XCTAssertEqual(kinds, ["srt_vtt", "cue_text", "vtt_cues", "subtitle_pick", "trailer", "live_category"])
    }

    func testLiveCategoryCases() throws {
        var failures: [String] = []
        var hiddenCount = 0
        for entry in try cases("live_category") {
            guard case .string(let name)? = entry["name"], case .bool(let hidden)? = entry["hidden"] else { failures.append("bad case \(entry)"); continue }
            if hidden { hiddenCount += 1 }
            let actual = isHiddenLiveCategory(name)
            if actual != hidden { failures.append("\(shown(name)): hidden \(actual), expected \(hidden)") }
        }
        XCTAssertGreaterThan(hiddenCount, 0)
        XCTAssertTrue(failures.isEmpty, "Live category cases that fail:\n" + failures.joined(separator: "\n"))
    }

    func testVTTCueCases() throws {
        var failures: [String] = []
        for entry in try cases("vtt_cues") {
            guard case .string(let text)? = entry["vtt"], case .array(let expectedCues)? = entry["cues"], case .array(let times)? = entry["at"] else {
                failures.append("bad case \(entry)"); continue
            }
            let note = entry["note"]?.text ?? shown(text)
            let expected = expectedCues.compactMap { cue -> WebVTTCue? in
                guard let start = cue["start"]?.int, let end = cue["end"]?.int, case .string(let body)? = cue["text"] else { return nil }
                return WebVTTCue(start: start, end: end, text: body)
            }
            guard expected.count == expectedCues.count else { failures.append("bad case \(note)"); continue }
            let file = WebVTT(parsing: text)
            if file.cues != expected { failures.append("\(note): cues \(file.cues), expected \(expected)") }
            // The same through the bytes the app downloads.
            if WebVTT(data: Data(text.utf8)).cues != expected { failures.append("\(note): cues read from data differ") }
            for time in times {
                guard case .array(let pair) = time, pair.count == 2, let ms = pair[0].int, case .string(let wanted) = pair[1] else {
                    failures.append("bad time in \(note)"); continue
                }
                let actual = file.text(atMilliseconds: ms)
                if actual != wanted { failures.append("\(note) at \(ms) ms: \(shown(actual)), expected \(shown(wanted))") }
                // The player's seconds compare after rounding to milliseconds.
                let fromSeconds = file.text(at: Double(ms) / 1000)
                if fromSeconds != wanted { failures.append("\(note) at \(Double(ms) / 1000) s: \(shown(fromSeconds)), expected \(shown(wanted))") }
            }
        }
        XCTAssertTrue(failures.isEmpty, "WebVTT cases that fail:\n" + failures.joined(separator: "\n"))
    }
}
