import Foundation
import XCTest
@testable import TunerCore

/// Runs every case in docs/browse-cases.json, the file all Tuner apps share (docs/browse.md, "Test cases"): the category
/// filter, title normalization with the year read from the name, "Movies & Series: USA only" for one title, both on
/// its own (`TitleRegion.isUSA`) and as a whole catalogue title in a `BrowseIndex` (movie and series), and the provider
/// TMDB id of one row read by the catalogue's JSON reader, and the name and group of every entry of an M3U playlist
/// read by `M3UParser`.
///
/// The package reads its copy, Fixtures/browse-cases.json (the package may be built outside the repository);
/// `testFixtureIsTheRepositoryCopy` fails when that copy differs from the repository's docs/browse-cases.json.
final class BrowseCasesTests: XCTestCase {
    private static let fixture = "browse-cases.json"

    /// docs/browse-cases.json in the repository that holds this package: ../../../docs from the package directory.
    private static var repositoryCopy: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // TunerCoreTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // TunerCore (the package)
            .appendingPathComponent("../../../docs/browse-cases.json").standardizedFileURL
    }

    private struct Case {
        let kind: String
        let fields: [String: JSONValue]
        func string(_ key: String) -> String? {
            if case .string(let text)? = fields[key] { return text }
            return nil
        }
        func bool(_ key: String) -> Bool? {
            if case .bool(let value)? = fields[key] { return value }
            return nil
        }
        /// A usa case's category names: "" and [] are none.
        var categories: [String] {
            switch fields["category"] {
            case .string(let name)?: return name.isEmpty ? [] : [name]
            case .array(let names)?: return names.compactMap { if case .string(let name) = $0 { return name } else { return nil } }
            default: return []
            }
        }
        /// A usa case's origin; nil means the title is unmatched.
        var origin: [String]? {
            guard case .array(let codes)? = fields["origin"] else { return nil }
            return codes.compactMap { if case .string(let code) = $0 { return code } else { return nil } }
        }
        var label: String {
            let category = fields["category"].map { "\($0)" } ?? ""
            return "category \(category), origin \(origin.map { "\($0)" } ?? "null")"
        }
    }

    private func cases(_ kind: String) throws -> [Case] {
        let root = try JSONDecoder().decode(JSONValue.self, from: Fixture.data(BrowseCasesTests.fixture))
        guard case .array(let entries) = root else { XCTFail("\(BrowseCasesTests.fixture) is not an array"); return [] }
        let all = entries.compactMap { entry -> Case? in
            guard case .object(let fields) = entry, case .string(let kind)? = fields["kind"] else { return nil }
            return Case(kind: kind, fields: fields)
        }
        XCTAssertEqual(all.count, entries.count, "every case is an object with a kind")
        let matching = all.filter { $0.kind == kind }
        XCTAssertFalse(matching.isEmpty, "no \(kind) cases")
        return matching
    }

    func testFixtureIsTheRepositoryCopy() throws {
        let repository = BrowseCasesTests.repositoryCopy
        guard FileManager.default.fileExists(atPath: repository.path) else {
            throw XCTSkip("\(repository.path) is not here (the package was built outside the repository)")
        }
        XCTAssertEqual(try Data(contentsOf: repository), Fixture.data(BrowseCasesTests.fixture),
                       "Tests/TunerCoreTests/Fixtures/browse-cases.json differs from docs/browse-cases.json: copy it again")
    }

    func testEveryCaseHasAKnownKind() throws {
        let root = try JSONDecoder().decode(JSONValue.self, from: Fixture.data(BrowseCasesTests.fixture))
        let kinds = Set(root.elements.compactMap { $0["kind"]?.text })
        XCTAssertEqual(kinds, ["category", "m3u", "normalize", "tmdb", "usa"])
    }

    func testCategoryCases() throws {
        var failures: [String] = []
        for entry in try cases("category") {
            guard let name = entry.string("name"), let foreign = entry.bool("foreign") else { failures.append("bad case \(entry.fields)"); continue }
            let actual = TitleRegion.isForeignCategory(name)
            if actual != foreign { failures.append("\"\(name)\": foreign \(actual), expected \(foreign)") }
        }
        XCTAssertTrue(failures.isEmpty, "Category cases that fail:\n" + failures.joined(separator: "\n"))
    }

    func testNormalizeCases() throws {
        var failures: [String] = []
        for entry in try cases("normalize") {
            guard let input = entry.string("input"), let title = entry.string("title"), let year = entry.string("year") else {
                failures.append("bad case \(entry.fields)"); continue
            }
            let actualTitle = TitleNormalizer.normalize(input)
            let actualYear = TitleNormalizer.year(in: input) ?? ""
            if actualTitle != title || actualYear != year {
                failures.append("\"\(input)\": \"\(actualTitle)\" (\(actualYear)), expected \"\(title)\" (\(year))")
            }
        }
        XCTAssertTrue(failures.isEmpty, "Normalize cases that fail:\n" + failures.joined(separator: "\n"))
    }

    func testUSACases() throws {
        var failures: [String] = []
        for entry in try cases("usa") {
            guard let expected = entry.bool("expect") else { failures.append("bad case \(entry.fields)"); continue }
            let names = entry.categories
            let categories = names.enumerated().map { Category(id: "c\($0.offset)", name: $0.element) }
            let match = entry.origin.map { RowsItem(id: 4242, title: "Matched Title", year: "2020", origin: $0) }
            var byID: [String: TunerCore.Category] = [:]
            for category in categories { byID[category.id] = category }
            // Plus an id the category list doesn't know: it is left out.
            let alone = TitleRegion.isUSA(match: match, categoryIDs: categories.map(\.id) + ["unknown"], categoriesByID: byID)
            if alone != expected { failures.append("isUSA \(entry.label): \(alone), expected \(expected)") }
            for kind in TitleKind.allCases {
                let (shown, matched, shownWithAll) = catalogueTitle(kind, categories: categories, origin: entry.origin)
                if matched != (entry.origin != nil) { failures.append("\(kind) \(entry.label): matched \(matched)") }
                if shown != expected { failures.append("\(kind) \(entry.label): shown \(shown), expected \(expected)") }
                if !shownWithAll { failures.append("\(kind) \(entry.label): hidden with \"All\"") }
            }
        }
        XCTAssertTrue(failures.isEmpty, "USA only cases that fail:\n" + failures.joined(separator: "\n"))
    }

    /// docs/browse.md Matching step 1: `json` is one provider row as JSON text, `expect` its TMDB id or null. Each row is
    /// read as the catalogue reads it, twice: `JSONValue.parse` and `XtreamParser.tmdb`, and a whole get_vod_streams and
    /// get_series answer (`XtreamParser.movies` and `.series`, the streaming reader that keeps only the fields they use)
    /// holding the row with a stream_id, series_id and name put in front (the row's own keys come later and win).
    func testTMDBCases() throws {
        var failures: [String] = []
        for entry in try cases("tmdb") {
            guard let json = entry.string("json"), json.hasPrefix("{"), json.hasSuffix("}") else { failures.append("bad case \(entry.fields)"); continue }
            let expected: Int?
            switch entry.fields["expect"] {
            case .string(let id)?: expected = Int(id)
            case .null?: expected = nil
            default: failures.append("bad case \(entry.fields)"); continue
            }
            let row = try JSONValue.parse(Data(json.utf8))
            let actual = XtreamParser.tmdb(row)
            if actual != expected { failures.append("\(json): \(actual.map(String.init) ?? "null"), expected \(expected.map(String.init) ?? "null")") }
            let members = json.dropFirst()  // after "{"; "}" alone for an empty row
            let rest = (members == "}" ? "" : ",") + members + "]"
            let movies = try XtreamParser.movies(Data((#"[{"stream_id":"9001","name":"Case Title""# + rest).utf8), login: demoLogin)
            let shows = try XtreamParser.series(Data((#"[{"series_id":"9002","name":"Case Title""# + rest).utf8))
            if movies.count != 1 || movies.first?.tmdbID != expected {
                failures.append("\(json) as a movie: \(movies.map { $0.tmdbID.map(String.init) ?? "null" })")
            }
            if shows.count != 1 || shows.first?.tmdbID != expected {
                failures.append("\(json) as a series: \(shows.map { $0.tmdbID.map(String.init) ?? "null" })")
            }
        }
        XCTAssertTrue(failures.isEmpty, "TMDB id cases that fail:\n" + failures.joined(separator: "\n"))
    }

    /// docs/browse.md "M3U playlists": `text` is a whole playlist, `expect` its entries in order, each a name and a group
    /// ("" for none). Every URL in the cases is a live channel, so the entries are the channels `M3UParser.parse` reads,
    /// each with the name of its live category as its group ("Uncategorized", this app's label for no group, reads as "").
    /// Names and groups are compared scalar by scalar: `==` on Swift strings ignores canonical differences.
    func testM3UCases() throws {
        var failures: [String] = []
        func shown(_ text: String) -> String {
            "\"" + text.unicodeScalars.map { $0.isASCII && $0.value >= 0x20 && $0.value < 0x7F ? String($0) : String(format: "\\u{%04X}", $0.value) }.joined() + "\""
        }
        for entry in try cases("m3u") {
            guard let text = entry.string("text"), case .array(let items)? = entry.fields["expect"] else { failures.append("bad case \(entry.fields)"); continue }
            let expected = items.compactMap { item -> [String]? in
                guard case .string(let name)? = item["name"], case .string(let group)? = item["group"] else { return nil }
                return [name, group]
            }
            guard expected.count == items.count else { failures.append("bad case \(entry.fields)"); continue }
            let playlist = M3UParser.parse(Data(text.utf8))
            var groups: [String: String] = [:]
            for category in playlist.liveCategories { groups[category.id] = category.name == "Uncategorized" ? "" : category.name }
            let actual = playlist.channels.map { [$0.name, groups[$0.categoryID] ?? "(no category \($0.categoryID))"] }
            let same = actual.count == expected.count
                && zip(actual, expected).allSatisfy { pair in zip(pair.0, pair.1).allSatisfy { Array($0.unicodeScalars) == Array($1.unicodeScalars) } }
            if !same || !playlist.movies.isEmpty || !playlist.series.isEmpty {
                let list = { (entries: [[String]]) in entries.map { "\(shown($0[0])) in \(shown($0[1]))" }.joined(separator: ", ") }
                failures.append("\(shown(text)):\n  read    [\(list(actual))] (\(playlist.movies.count) movies, \(playlist.series.count) series)"
                                + "\n  expect  [\(list(expected))]")
            }
        }
        XCTAssertTrue(failures.isEmpty, "M3U cases that fail:\n" + failures.joined(separator: "\n"))
    }

    // `TunerCore.Category` (here and in `byID` above): on Apple platforms Foundation also brings in the Objective-C
    // runtime's `Category` typedef, which makes a bare `Category` ambiguous in a type position (initializer calls are fine).

    /// One catalogue title of `kind` listed in `categories` (one provider row per category, merged by the parser), matched
    /// by its provider TMDB id to a title with `origin`, or unmatched when `origin` is nil. Returns whether "USA only"
    /// shows it, whether it matched, and whether "All" shows it.
    private func catalogueTitle(_ kind: TitleKind, categories: [TunerCore.Category], origin: [String]?) -> (Bool, Bool, Bool) {
        let ids = categories.map(\.id)
        let tmdbID = origin == nil ? nil : 4242
        // Another TMDB title, so the rows count as TMDB data when the case's title is unmatched.
        let items = [RowsItem(id: 7, title: "Something Else", year: "2001", origin: ["US"])]
            + (origin.map { [RowsItem(id: 4242, title: "Matched Title", year: "2020", origin: $0)] } ?? [])
        let lists = RowsLists(popular: items)
        let rows = CatalogRows(source: "tmdb", movie: kind == .movie ? lists : RowsLists(), tv: kind == .series ? lists : RowsLists())
        let date = Date(timeIntervalSince1970: 0)
        let movies = kind == .movie ? [movie("m:1", "Case Title (2020)", category: ids.first ?? "", categories: ids, tmdb: tmdbID)] : []
        let shows = kind == .series ? [series("s:1", "Case Title (2020)", category: ids.first ?? "", categories: ids, tmdb: tmdbID)] : []
        func index(usOnly: Bool) -> BrowseIndex {
            BrowseIndex(movies: MovieLibrary(movies: movies, categories: categories, updated: date),
                        series: SeriesLibrary(series: shows, categories: categories, updated: date), rows: rows, usOnly: usOnly)
        }
        let id = kind == .movie ? "m:1" : "s:1"
        let usOnly = index(usOnly: true)
        let all = index(usOnly: false)
        let shown = kind == .movie ? usOnly.movie(id: id) != nil : usOnly.series(id: id) != nil
        let shownWithAll = kind == .movie ? all.movie(id: id) != nil : all.series(id: id) != nil
        return (shown, all.tmdbItem(forTitleID: id) != nil, shownWithAll)
    }
}
