import Foundation

// Movies & Series browsing as specified in docs/browse.md: Home rows, Discover, Library, the catalog rows endpoint,
// TMDB matching, the "Movies & Series: USA only / All" filter and genres. Everything here is pure and synchronous
// except `CatalogRowsService`.

// MARK: - Catalog rows endpoint (GET https://lumanest.tv/api/catalog/rows?v=1)

/// One TMDB title from the rows endpoint: `{"id","title","original_title","year","origin","lang","genres","popularity"}`.
public struct RowsItem: Codable, Sendable, Hashable {
    public var id: Int
    public var title: String
    public var originalTitle: String?
    public var year: String?
    /// TMDB's countries of origin, ISO 3166-1 alpha-2 in upper case ("US"). Parsed rows keep only the entries that are
    /// countries (`TitleRegion.country`); `TitleRegion` checks every entry again, so other values given here are ignored.
    public var origin: [String]
    public var lang: String?
    /// TMDB genre ids.
    public var genres: [Int]
    public var popularity: Double?
    public init(id: Int, title: String, originalTitle: String? = nil, year: String? = nil, origin: [String] = [], lang: String? = nil,
                genres: [Int] = [], popularity: Double? = nil) {
        self.id = id; self.title = title; self.originalTitle = originalTitle; self.year = year; self.origin = origin
        self.lang = lang; self.genres = genres; self.popularity = popularity
    }

    /// Lenient: nil without a positive id and a title.
    init?(json: JSONValue) {
        guard case .object = json, let id = json["id"]?.int, id > 0, let title = json["title"]?.text else { return nil }
        // docs/browse.md "Origin countries": only strings that are two ASCII letters (spaces around them allowed) count,
        // upper-cased; "USA", "U.S.", "" and values that are not strings are dropped, so ["USA"] is unknown, like [].
        // An origin that is not an array ("US", "US, GB", null) is unknown too, as in the other apps.
        let origin: [String]
        if case .array(let values)? = json["origin"] {
            origin = values.compactMap { value in
                guard case .string(let text) = value else { return nil }
                return TitleRegion.country(text)
            }
        } else {
            origin = []
        }
        self.init(id: id, title: title, originalTitle: json["original_title"]?.text, year: TitleNormalizer.tmdbYear(json["year"]?.text),
                  origin: origin, lang: json["lang"]?.text, genres: (json["genres"] ?? .null).elements.compactMap(\.int),
                  popularity: json["popularity"]?.double)
    }
}

public enum StreamingService: String, Codable, Sendable, Hashable, CaseIterable {
    // Declaration order is the Home row order.
    case netflix, disney, max, prime, apple, hulu, paramount, peacock
    /// "Netflix", "Disney+", "Max", "Prime Video", "Apple TV+", "Hulu", "Paramount+", "Peacock".
    public var displayName: String {
        switch self {
        case .netflix: return "Netflix"
        case .disney: return "Disney+"
        case .max: return "Max"
        case .prime: return "Prime Video"
        case .apple: return "Apple TV+"
        case .hulu: return "Hulu"
        case .paramount: return "Paramount+"
        case .peacock: return "Peacock"
        }
    }

    /// Whole-word category keywords for the no-TMDB fallback, in any ASCII letter case: netflix | disney | hbo, max |
    /// prime, amazon | apple | hulu | paramount | peacock.
    public var categoryKeywords: [String] {
        switch self {
        case .netflix: return ["netflix"]
        case .disney: return ["disney"]
        case .max: return ["hbo", "max"]
        case .prime: return ["prime", "amazon"]
        case .apple: return ["apple"]
        case .hulu: return ["hulu"]
        case .paramount: return ["paramount"]
        case .peacock: return ["peacock"]
        }
    }

    /// Matched against `BrowseText.asciiLowercased(name)`: case is ignored for the ASCII letters only, as in every rule
    /// of docs/browse.md (`.caseInsensitive` would let `ſ` match `s` and the Kelvin sign `k`).
    var keywordPattern: Pattern {
        Pattern("(?<![a-z0-9])(?:" + categoryKeywords.joined(separator: "|") + ")(?![a-z0-9])")
    }
}

/// The lists the rows endpoint can carry.
public enum RowsList: Hashable, Sendable {
    case popular
    case featured
    case topRated
    case service(StreamingService)

    /// popular, featured, topRated, then the services in Home order.
    static let matchingOrder: [RowsList] = [.popular, .featured, .topRated] + StreamingService.allCases.map { .service($0) }
}

public struct RowsLists: Sendable, Hashable {
    public var popular: [RowsItem]
    public var featured: [RowsItem]
    public var topRated: [RowsItem]
    public var services: [StreamingService: [RowsItem]]
    public init(popular: [RowsItem] = [], featured: [RowsItem] = [], topRated: [RowsItem] = [], services: [StreamingService: [RowsItem]] = [:]) {
        self.popular = popular; self.featured = featured; self.topRated = topRated; self.services = services
    }

    /// Missing lists are empty.
    public func items(_ list: RowsList) -> [RowsItem] {
        switch list {
        case .popular: return popular
        case .featured: return featured
        case .topRated: return topRated
        case .service(let service): return services[service] ?? []
        }
    }

    var isEmpty: Bool { popular.isEmpty && featured.isEmpty && topRated.isEmpty && services.values.allSatisfy(\.isEmpty) }

    init(json: JSONValue?) {
        func list(_ value: JSONValue?) -> [RowsItem] {
            guard let value, case .array(let items) = value else { return [] }
            return items.compactMap(RowsItem.init(json:))
        }
        var services: [StreamingService: [RowsItem]] = [:]
        for service in StreamingService.allCases {
            let items = list(json?["services"]?[service.rawValue])
            if !items.isEmpty { services[service] = items }
        }
        self.init(popular: list(json?["popular"]), featured: list(json?["featured"]), topRated: list(json?["top_rated"]), services: services)
    }
}

public struct RowsGenre: Codable, Sendable, Hashable {
    public var id: Int
    public var name: String
    public init(id: Int, name: String) { self.id = id; self.name = name }
}

public struct CatalogRows: Sendable, Hashable {
    /// "tmdb" or "none".
    public var source: String
    public var generated: Date?
    public var movie: RowsLists
    /// The endpoint's "tv" object.
    public var tv: RowsLists
    public var movieGenres: [RowsGenre]
    public var tvGenres: [RowsGenre]
    public init(source: String, generated: Date? = nil, movie: RowsLists = RowsLists(), tv: RowsLists = RowsLists(),
                movieGenres: [RowsGenre] = [], tvGenres: [RowsGenre] = []) {
        self.source = source; self.generated = generated; self.movie = movie; self.tv = tv
        self.movieGenres = movieGenres; self.tvGenres = tvGenres
    }

    /// `{"v":1,"source":"none","movie":{},"tv":{},"genres":{}}`: the no-TMDB fallback.
    public static let none = CatalogRows(source: "none")

    /// `source == "tmdb"` and at least one list is non-empty. Drives the TMDB attribution and Popular/Featured.
    public var usesTMDB: Bool { source == "tmdb" && !(movie.isEmpty && tv.isEmpty) }

    /// Lenient: unknown keys ignored, missing lists empty, bad items skipped. Throws `TunerError.invalidResponse`
    /// when the body isn't a JSON object or `v` isn't 1.
    public static func parse(_ data: Data) throws -> CatalogRows {
        guard let root = try? JSONValue.parse(data) else { throw TunerError.invalidResponse }
        return try parse(value: root)
    }

    static func parse(value root: JSONValue) throws -> CatalogRows {
        guard case .object = root, root["v"]?.int == 1 else { throw TunerError.invalidResponse }
        func genres(_ value: JSONValue?) -> [RowsGenre] {
            (value ?? .null).elements.compactMap { item in
                guard let id = item["id"]?.int, let name = item["name"]?.text else { return nil }
                return RowsGenre(id: id, name: name)
            }
        }
        return CatalogRows(source: root["source"]?.text?.lowercased() ?? "none", generated: root["generated"]?.text.flatMap(parseISODate),
                           movie: RowsLists(json: root["movie"]), tv: RowsLists(json: root["tv"]),
                           movieGenres: genres(root["genres"]?["movie"]), tvGenres: genres(root["genres"]?["tv"]))
    }

    public func lists(_ kind: TitleKind) -> RowsLists { kind == .movie ? movie : tv }
    public func genres(_ kind: TitleKind) -> [RowsGenre] { kind == .movie ? movieGenres : tvGenres }

    /// "2026-10-19T00:00:00Z", "2026-10-19T00:00:00.123+02:00" or "2026-10-19".
    static func parseISODate(_ text: String) -> Date? {
        let chars = Array(text.trimmingCharacters(in: .whitespaces).utf8)
        func number(_ from: Int, _ count: Int) -> Int? {
            guard from + count <= chars.count else { return nil }
            var value = 0
            for i in from..<(from + count) {
                guard chars[i] >= 48 && chars[i] <= 57 else { return nil }
                value = value * 10 + Int(chars[i] - 48)
            }
            return value
        }
        guard let year = number(0, 4), let month = number(5, 2), let day = number(8, 2), (1...12).contains(month), (1...31).contains(day) else { return nil }
        var seconds = Double(XMLTV.daysFromCivil(year, month, day)) * 86400
        guard chars.count > 10 else { return Date(timeIntervalSince1970: seconds) }
        guard let hour = number(11, 2), let minute = number(14, 2) else { return nil }
        seconds += Double(hour * 3600 + minute * 60 + (number(17, 2) ?? 0))
        var index = 19
        if index < chars.count, chars[index] == UInt8(ascii: ".") {
            index += 1
            while index < chars.count, chars[index] >= 48, chars[index] <= 57 { index += 1 }
        }
        if index < chars.count, chars[index] == UInt8(ascii: "+") || chars[index] == UInt8(ascii: "-"), let hh = number(index + 1, 2) {
            let mm = number(index + 4, 2) ?? number(index + 3, 2) ?? 0
            seconds -= (chars[index] == UInt8(ascii: "+") ? 1 : -1) * Double(hh * 3600 + mm * 60)
        }
        return Date(timeIntervalSince1970: seconds)
    }
}

/// Fetches and caches the rows: memory, then Caches/Rows/rows.json (`{"fetched": <unix s>, "body": <raw JSON>}`),
/// refreshed when older than 12 h; a failed refresh keeps the stale copy; nothing at all gives `.none`.
/// Requests use User-Agent `TunerLinks.lumanestUserAgent` and a 15 s timeout.
public actor CatalogRowsService {
    public static let maxAge: TimeInterval = 12 * 60 * 60

    private let cacheDirectory: URL
    private let http: any HTTPClient
    private let url: URL
    private let now: @Sendable () -> Date
    private var memory: (rows: CatalogRows, fetched: Date)?
    private var diskChecked = false

    public init(cacheDirectory: URL, http: any HTTPClient, url: URL = TunerLinks.catalogRows,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.cacheDirectory = cacheDirectory
        self.http = http
        self.url = url
        self.now = now
    }

    private var file: URL { cacheDirectory.appendingPathComponent("rows.json") }

    /// Never throws. `force` refreshes even when fresh (Settings → Refresh).
    public func rows(force: Bool = false) async -> CatalogRows {
        let date = now()
        if memory == nil && !diskChecked {
            diskChecked = true
            if let data = try? Data(contentsOf: file), let root = try? JSONValue.parse(data), let fetched = root["fetched"]?.double,
               let body = root["body"], let rows = try? CatalogRows.parse(value: body) {
                memory = (rows, Date(timeIntervalSince1970: fetched))
            }
        }
        if !force, let memory, date.timeIntervalSince(memory.fetched) < CatalogRowsService.maxAge, date >= memory.fetched {
            return memory.rows
        }
        do {
            let request = HTTPRequestSpec(url: url, headers: ["User-Agent": TunerLinks.lumanestUserAgent, "Accept": "application/json"], timeout: 15)
            let body = try await http.data(request).body
            let rows = try CatalogRows.parse(body)
            memory = (rows, date)
            var stored = Data("{\"fetched\":\(Int64(date.timeIntervalSince1970)),\"body\":".utf8)
            stored.append(body)
            stored.append(contentsOf: Array("}".utf8))
            try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            try? stored.write(to: file, options: .atomic)
            return rows
        } catch {
            return memory?.rows ?? .none
        }
    }

    public func clearCache() async {
        memory = nil
        diskChecked = true
        try? FileManager.default.removeItem(at: file)
    }
}

// MARK: - Matching catalogue titles to TMDB

/// docs/browse.md "Spaces and letter case", for every rule that reads a category name, an `origin` entry, a title's
/// name or a provider's year field.
enum BrowseText {
    /// U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF: the characters
    /// beyond ASCII that `\s` matches in JavaScript or ICU but not in Java or PCRE. U+200B and U+180E are not spaces.
    static func isUnicodeSpace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x0085, 0x00A0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    /// Each Unicode space replaced with U+0020, scalar by scalar (never with `\s`, `isWhitespace` or
    /// `trimmingCharacters`, which each cover a different set). Afterwards ICU's `\s` is tab, line feed, vertical tab,
    /// form feed, carriage return and space, as in the other apps' engines.
    static func spaces(_ text: String) -> String {
        guard text.unicodeScalars.contains(where: isUnicodeSpace) else { return text }
        var scalars = String.UnicodeScalarView()
        for scalar in text.unicodeScalars { scalars.append(isUnicodeSpace(scalar) ? " " : scalar) }
        return String(scalars)
    }

    /// Space, tab, line feed, vertical tab, form feed and carriage return: `[ \t\n\x0B\f\r]`, what `\s` matches in
    /// every engine once the Unicode spaces are replaced.
    static func isASCIISpace(_ scalar: Unicode.Scalar) -> Bool {
        scalar == " " || (scalar.value >= 0x09 && scalar.value <= 0x0D)
    }

    /// docs/browse.md "Trimming" (normalize step 1 and the year from a name, after `spaces`): `[ \t\n\x0B\f\r]` removed
    /// from both ends, scalar by scalar. Never `trimmingCharacters(in: .whitespaces)`: Foundation's set also holds
    /// U+200B, and a space followed by a combining mark is one `Character`.
    static func trimEnds(_ text: String) -> String { trimming(text, isASCIISpace) }

    /// A provider field's ends trimmed of `[ \t\n\x0B\f\r]` and the Unicode spaces, nothing else (docs/browse.md
    /// "Trimming"): `.whitespacesAndNewlines` also removes U+200B, so "\u{200B} - 1999" would read as "- 1999".
    static func trimField(_ text: String) -> String { trimming(text) { isASCIISpace($0) || isUnicodeSpace($0) } }

    private static func trimming(_ text: String, _ remove: (Unicode.Scalar) -> Bool) -> String {
        let scalars = text.unicodeScalars
        guard let first = scalars.firstIndex(where: { !remove($0) }) else { return "" }
        let last = scalars.lastIndex(where: { !remove($0) })!
        if first == scalars.startIndex && scalars.index(after: last) == scalars.endIndex { return text }
        return String(scalars[first...last])
    }

    /// A copy with `A` to `Z` lower-cased and every other character unchanged: rules that ignore case ignore it for the
    /// ASCII letters only (NSRegularExpression's `.caseInsensitive` follows Unicode: `ſ` would match `s` and the Kelvin
    /// sign `k`).
    static func asciiLowercased(_ text: String) -> String {
        guard text.utf8.contains(where: { $0 >= 0x41 && $0 <= 0x5A }) else { return text }
        // Bytes 0x41 to 0x5A are never part of a multi-byte UTF-8 sequence.
        return String(decoding: text.utf8.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 }, as: UTF8.self)
    }

    /// Capture group `index` of the first match, cut from the UTF-16 text (exact even inside a grapheme cluster).
    static func group(_ index: Int, of pattern: Pattern, in text: String) -> String? {
        guard let match = pattern.firstMatch(text) else { return nil }
        let range = match.range(at: index)
        guard range.location != NSNotFound else { return nil }
        return (text as NSString).substring(with: range)
    }
}

/// docs/browse.md "Matching catalogue titles to TMDB": title normalization, the year of a provider title and the
/// provider TMDB id, written as every Tuner app writes them (the shared cases are docs/browse-cases.json).
public enum TitleNormalizer {
    // docs/browse.md "Patterns for titles, years and countries", exactly as written there; all case-sensitive.
    /// Step 2: every `[...]` and `{...}`, a year in parentheses, a short upper-case tag in parentheses (`(US)`, `(U.S.)`).
    private static let brackets = Pattern(#"\[[^\]]*\]|\{[^}]*\}|\(\s*(18|19|20)[0-9]{2}\s*\)|\([A-Z0-9 +.]{1,6}\)"#)
    /// Step 3.1: a short upper-case tag between pipes (`|US| `), or a short upper-case code that is not a year followed by
    /// `|`, `:` or a dash (`US - `, `EN| `, `NF: `, `4K-NF-EN | `).
    private static let leading = Pattern(#"^\s*(\|\s*[A-Z0-9+]{1,6}\s*\|\s*|(?!(18|19|20)[0-9]{2}([^A-Z0-9+]|$))[A-Z0-9+]{2,4}(\s*[-_]\s*[A-Z0-9+]{2,4})*\s*(\|\s*|([:-]|–)\s+))"#)
    /// A short upper-case code, or a quality word in any ASCII letter case where no short upper-case code followed by a
    /// space or the end fits ("hd", "HDR10", "1080p"; "4K", "HD" and "UHD" are codes). Every tag matches in one way
    /// only, so `yearEnd` takes time in proportion to the name (two ways for "4K" doubled it with each tag).
    private static let tag = #"[A-Z0-9+]{2,4}|(?![A-Z0-9+]{2,4}(\s|$))([48][Kk]|[UuFf]?[Hh][Dd]|[Ss][Dd]|[Hh][Dd][Rr](10)?|(1080|720|2160)[Pp])"#
    /// Step 3.2: one trailing tag (` | EN`, ` - 4K`, ` | 1999`, ` – 1080p`).
    private static let trailing = Pattern(#"\s(\||-|–)\s*("# + tag + #")\s*$"#)
    /// Step 3.3: a short upper-case tag between pipes (`|US|`, `| 4K |`, not `| The Matrix |`).
    private static let pipes = Pattern(#"\|\s*[A-Z0-9+]{1,6}\s*\|"#)
    /// A provider year field: group 1.
    private static let yearField = Pattern(#"^\s*((18|19|20)[0-9]{2})([^0-9]|$)"#)
    /// The first year in brackets, the mixed `(2021]` and `[2021)` too: group 1.
    private static let yearBrackets = Pattern(#"[(\[]\s*((18|19|20)[0-9]{2})\s*[)\]]"#)
    /// The year among the trailing tags, the one nearest the end: group 2.
    private static let yearEnd = Pattern(#"\s(\||-|–)\s*((18|19|20)[0-9]{2})(\s+(\||-|–)\s*(?!(18|19|20)[0-9]{2}(\s|$))("# + tag
                                         + #"))*\s*$"#)
    private static let quality: Set<String> = ["4k", "8k", "uhd", "fhd", "hd", "sd", "hdr", "hdr10", "1080p", "720p", "2160p"]
    /// Step 7: the letters NFKD leaves alone.
    private static let letters: [Unicode.Scalar: String] = ["æ": "ae", "œ": "oe", "ø": "o", "ß": "ss", "đ": "d", "ł": "l", "ð": "d", "þ": "th"]

    /// The ten steps of docs/browse.md, in order:
    /// 1. the Unicode spaces become spaces, then `[ \t\n\x0B\f\r]` is removed from both ends (" - 1999" reads as
    ///    "- 1999": "1999" with no year, whether or not the provider trimmed it);
    /// 2. `brackets` become a space;
    /// 3. tags at the ends and between pipes: (1) a leading tag removed up to three times, (2) trailing tags removed, the
    ///    last first, for as long as one ends the name, (3) `pipes` become a space, (4) 1 and 2 again. With `removingTags`
    ///    false (the second lookup key) only 3.3 runs;
    /// 4. lower-cased (locale-independent);
    /// 5. "&" → " and ";
    /// 6. the apostrophes ' ` ´ ’ deleted;
    /// 7. NFKD, then exactly U+0300 to U+036F removed, then æ œ ø ß đ ł ð þ → ae oe o ss d l d th;
    /// 8. every run of characters other than a-z and 0-9 splits words;
    /// 9. the quality words 4k 8k uhd fhd hd sd hdr hdr10 1080p 720p 2160p dropped;
    /// 10. a leading "the" dropped when other words follow; words joined with single spaces.
    /// "EN | The Matrix | 1999" → "matrix", "Æon Flux (2005)" → "aeon flux", "Dune | 4K | EN" → "dune", "|US| 1984" → "1984".
    ///
    /// Swift compares `String`s by grapheme cluster, so every replacement here works on Unicode scalars, ICU's UTF-16 or
    /// `replacingOccurrences` with `.literal`: "&" or "’" followed by a combining mark is found as in the other apps.
    public static func normalize(_ name: String, removingTags: Bool = true) -> String {
        var s = BrowseText.trimEnds(BrowseText.spaces(name))                                              // 1
        // Each step 2 and 3 pattern needs one of these characters; most names have none.
        if s.unicodeScalars.contains(where: { $0 == "[" || $0 == "{" || $0 == "(" }) { s = brackets.replace(s, with: " ") }  // 2
        let ends = removingTags && hasTagSeparator(s)                                                     // 3
        if ends { s = removingEnds(s) }
        if s.unicodeScalars.contains("|") { s = pipes.replace(s, with: " ") }
        if ends { s = removingEnds(s) }
        s = s.lowercased()                                                                                // 4
        s = s.replacingOccurrences(of: "&", with: " and ", options: .literal)                             // 5
        s.unicodeScalars.removeAll { $0 == "'" || $0 == "`" || $0 == "\u{00B4}" || $0 == "\u{2019}" }   // 6
        var folded = String.UnicodeScalarView()                                                           // 7
        let decomposed = s.unicodeScalars.allSatisfy(\.isASCII) ? s : s.decomposedStringWithCompatibilityMapping
        for scalar in decomposed.unicodeScalars where !(0x0300...0x036F).contains(scalar.value) {
            if let letter = letters[scalar] { folded.append(contentsOf: letter.unicodeScalars) } else { folded.append(scalar) }
        }
        var words: [String] = []                                                                          // 8, 9
        var word = String.UnicodeScalarView()
        func endWord() {
            if !word.isEmpty, !quality.contains(String(word)) { words.append(String(word)) }
            word = String.UnicodeScalarView()
        }
        for scalar in folded {
            if (scalar >= "a" && scalar <= "z") || (scalar >= "0" && scalar <= "9") { word.append(scalar) } else { endWord() }
        }
        endWord()
        if words.count > 1, words[0] == "the" { words.removeFirst() }                                    // 10
        return words.joined(separator: " ")
    }

    /// Steps 3.1 and 3.2: up to three leading tags, then trailing tags for as long as one ends the name. Each match is
    /// non-empty, so an unchanged length means nothing was removed.
    private static func removingEnds(_ text: String) -> String {
        var s = text
        for _ in 0..<3 {
            let next = leading.replace(s, with: "")
            if next.utf16.count == s.utf16.count { break }
            s = next
        }
        while true {
            let next = trailing.replace(s, with: "")
            if next.utf16.count == s.utf16.count { break }
            s = next
        }
        return s
    }

    /// Steps 3.1 and 3.2 all need "|", ":", "-" or "–".
    static func hasTagSeparator(_ name: String) -> Bool {
        name.unicodeScalars.contains { $0 == "|" || $0 == ":" || $0 == "-" || $0 == "–" }
    }

    /// The year in a provider title's name, read with the Unicode spaces replaced and its ends trimmed as in normalize
    /// step 1 (" - 1999" has none: no space comes before its "-"): the first year in brackets
    /// (`(2021)`, `[ 2021 ]`, `(2021]`), else the year among the trailing tags nearest the end ("EN | Wonka | 2023",
    /// "Heat - 1995 - 4K", "2012 | 1999 | EN" → 1999); 1800 to 2099. A number that ends a name without a space and
    /// "|", "-" or "–" before it is part of the title ("Blade Runner 2049", "Heat-1995").
    public static func year(in name: String) -> String? {
        let s = BrowseText.trimEnds(BrowseText.spaces(name))
        return BrowseText.group(1, of: yearBrackets, in: s) ?? BrowseText.group(2, of: yearEnd, in: s)
    }

    /// A provider year field ("2021", "2021-05-01", " 2021.0"), read with the Unicode spaces replaced: a year from 1800
    /// to 2099 at the start (after optional spaces) that no other digit follows; "20211", "1799" and "abc" are nil.
    public static func year(field value: String?) -> String? {
        guard let value else { return nil }
        return BrowseText.group(1, of: yearField, in: BrowseText.spaces(value))
    }

    /// The year of a provider title: the first usable field (`year`, `releaseDate`, `release_date`, `releasedate`, in
    /// that order), else the name's year.
    public static func year(fields: [String?], name: String) -> String? {
        for field in fields { if let year = year(field: field) { return year } }
        return year(in: name)
    }

    /// A TMDB item's year: the first four characters of its `year` when they are ASCII digits ("2024-05-01" → "2024").
    static func tmdbYear(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespaces), text.count >= 4 else { return nil }
        let prefix = text.prefix(4)
        guard prefix.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return String(prefix)
    }

    /// docs/browse.md Matching step 1, one value of a provider row's TMDB id keys, told apart by its JSON type (never
    /// through `text`, which reads a number, a boolean or an array's first string as text):
    /// - a string trimmed as a provider field (`BrowseText.trimField`), then `TMDB_ID`, `^([0-9]{1,12})(\.0)?$`, in ASCII
    ///   digits, scalar by scalar (not `.whitespaces`, which takes U+200B, nor `Character.isNumber`, which takes the digits
    ///   of other scripts, nor `hasSuffix`, which compares grapheme clusters); leading zeros dropped, all zeros is none:
    ///   " 0123 ", "123.0" and U+00A0 "123" → 123; "123 .0", "123.00", "+123", "1e3", U+001F "123" → nil;
    /// - a number that is a whole number from 1 to 999999999999: 123, 123.0 and 1e3 → 123, 123, 1000; 1.5, -5, 0 → nil;
    /// - anything else (an array, an object, a boolean, null) or no value → nil.
    static func tmdbID(_ value: JSONValue?) -> Int? {
        switch value {
        case .string(let raw)?:
            var digits = Array(BrowseText.trimField(raw).unicodeScalars)
            if digits.count >= 2, digits[digits.count - 2] == ".", digits[digits.count - 1] == "0" { digits.removeLast(2) }
            guard (1...12).contains(digits.count), digits.allSatisfy({ $0.value >= 0x30 && $0.value <= 0x39 }) else { return nil }
            let id = digits.reduce(0) { $0 * 10 + Int($1.value - 0x30) }
            return id > 0 ? id : nil
        case .number(let number)?:
            guard number.isFinite, number >= 1, number <= 999_999_999_999, number == number.rounded(.towardZero) else { return nil }
            return Int(number)
        default:
            return nil
        }
    }
}

/// Which TMDB titles the catalogue titles match, and the rows lists in catalogue ids.
public struct TitleMatches: Sendable, Hashable {
    /// Catalogue title id ("m:…", "mu:…", "s:…", "ms:…") → its TMDB item. Several copies can match one item.
    public var items: [String: RowsItem]
    /// List → matched movie ids: the list's TMDB items in order, each with its copies in catalogue order.
    public var movieLists: [RowsList: [String]]
    /// List → matched series ids, the same way.
    public var seriesLists: [RowsList: [String]]
    public init(items: [String: RowsItem] = [:], movieLists: [RowsList: [String]] = [:], seriesLists: [RowsList: [String]] = [:]) {
        self.items = items; self.movieLists = movieLists; self.seriesLists = seriesLists
    }

    public func ids(_ kind: TitleKind, _ list: RowsList) -> [String] {
        (kind == .movie ? movieLists[list] : seriesLists[list]) ?? []
    }
}

/// docs/browse.md matching. Each catalogue title is matched on its own, so several copies can match one TMDB title:
/// 1. a provider TMDB id matches the TMDB title with that id in the lists, or nothing (never the name);
/// 2. otherwise its normalized name, then (when that finds no match) its name normalized without steps 3.1, 3.2 and
///    3.4, is looked up among the TMDB titles of its kind, indexed under their normalized `title` and `original_title` (lists in the order
///    popular, featured, topRated, services; an id counts once, where it first appears). With a year, the first TMDB
///    title there with the same year matches, else the first whose year differs by 1; without a year, only a key with
///    exactly one TMDB title matches.
public struct TitleMatcher: Sendable {
    private struct Title: Sendable {
        let id: String
        let name: String
        let year: Int?
        let tmdbID: Int?
    }

    /// The TMDB titles of one kind.
    private struct Index {
        var byID: [Int: RowsItem] = [:]
        var byKey: [String: [(item: RowsItem, year: Int)]] = [:]

        init(_ lists: RowsLists) {
            for list in RowsList.matchingOrder {
                for item in lists.items(list) where byID[item.id] == nil {
                    byID[item.id] = item
                    let year = TitleNormalizer.tmdbYear(item.year).flatMap { Int($0) } ?? 0
                    var keys: [String] = []
                    for name in [item.title, item.originalTitle ?? ""] {
                        let key = TitleNormalizer.normalize(name)
                        if !key.isEmpty && !keys.contains(key) { keys.append(key) }
                    }
                    for key in keys { byKey[key, default: []].append((item, year)) }
                }
            }
        }

        func match(_ title: Title) -> RowsItem? {
            if let tmdbID = title.tmdbID { return byID[tmdbID] }
            if let item = lookup(TitleNormalizer.normalize(title.name), year: title.year) { return item }
            guard TitleNormalizer.hasTagSeparator(title.name) else { return nil }
            return lookup(TitleNormalizer.normalize(title.name, removingTags: false), year: title.year)
        }

        private func lookup(_ key: String, year: Int?) -> RowsItem? {
            guard !key.isEmpty, let candidates = byKey[key] else { return nil }
            guard let year else { return candidates.count == 1 ? candidates[0].item : nil }
            return (candidates.first { $0.year == year } ?? candidates.first { $0.year > 0 && abs($0.year - year) <= 1 })?.item
        }
    }

    private let movies: [Title]
    private let series: [Title]

    public init(movies: [Movie], series: [Series]) {
        func title(_ id: String, _ name: String, _ year: String?, _ tmdbID: Int?) -> Title {
            Title(id: id, name: name, year: (TitleNormalizer.year(field: year) ?? TitleNormalizer.year(in: name)).flatMap { Int($0) }, tmdbID: tmdbID)
        }
        self.movies = movies.map { title($0.id, $0.name, $0.year, $0.tmdbID) }
        self.series = series.map { title($0.id, $0.name, $0.year, $0.tmdbID) }
    }

    public func match(_ rows: CatalogRows) -> TitleMatches {
        var result = TitleMatches()
        for kind in [TitleKind.movie, .series] {
            let lists = rows.lists(kind)
            let index = Index(lists)
            guard !index.byID.isEmpty else { continue }
            var copies: [Int: [String]] = [:]
            for title in kind == .movie ? movies : series {
                guard let item = index.match(title) else { continue }
                result.items[title.id] = item
                copies[item.id, default: []].append(title.id)
            }
            for list in RowsList.matchingOrder {
                var ids: [String] = []
                var seen = Set<Int>()
                for item in lists.items(list) where seen.insert(item.id).inserted { ids += copies[item.id] ?? [] }
                if !ids.isEmpty {
                    if kind == .movie { result.movieLists[list] = ids } else { result.seriesLists[list] = ids }
                }
            }
        }
        return result
    }
}

// MARK: - "Movies & Series: USA only" and genres

/// docs/browse.md "Which titles appear" and "The category filter".
public enum TitleRegion {
    static let codes = "FR|DE|ES|LAT|MX|BR|PT|TR|AR|PK|NL|PL|RO|RU|UK|CA|AF"
    static let words = "french|france|german|germany|deutsch|italian|italiano|italia|italy|spanish|espa(n|ñ|Ñ)ol|spain|castellano|"
        + "latino|latina|latam|mexico|mexican|brazil|brasil|brazilian|portuguese|portugal|turkish|turkey|arab|arabic|"
        + "india|indian|hindi|bollywood|tamil|telugu|malayalam|kannada|bengali|punjabi|pakistan|pakistani|urdu|"
        + "dutch|netherlands|polish|poland|polska|romanian|romania|russian|russia|british|canada|canadian|quebec|"
        + "korean|japanese|chinese|filipino|vietnamese|thai|persian|farsi|greek|albanian|kurdish"
    /// The four rules, exactly as docs/browse.md writes them (no lookbehind). Rules 1 and 2 are case-sensitive.
    private static let caseSensitiveRules = [
        // 1. A code in upper case as a whole word: "FR | Films", "Movies CA", "4K-FR Movies".
        Pattern(#"(^|[^A-Za-z0-9])("# + codes + #")([^A-Za-z0-9]|$)"#),
        // 2. "IN" and "IT" in upper case only as a tag: "IN | Movies", "Serie IT", not "IN THEATERS" or "IT CHAPTER TWO".
        Pattern(#"(^|[^A-Za-z0-9])(IN|IT)\s*([|:\[\]()/-]|–|$)"#),
    ]
    /// Rules 3 and 4 ignore the case of the ASCII letters only: they run in lower case, without `.caseInsensitive`, on a
    /// copy with only `A` to `Z` lower-cased (`BrowseText.asciiLowercased`), so `ſ`, the Kelvin sign, `İ` and `ı` never
    /// equal an ASCII letter.
    private static let asciiCaseInsensitiveRules: [Pattern] = {
        let lowerCodes = codes.lowercased()
        return [
            // 3. A rule 1 code in any ASCII letter case as a tag: "Fr | Films", "(Pt) Novelas", "[ru] Kino".
            Pattern(#"^[^A-Za-z0-9]*("# + lowerCodes + #")\s*([|:\])/-]|–)|\|\s*("# + lowerCodes + #")\s*\||\[\s*("# + lowerCodes
                    + #")\s*\]|\(\s*("# + lowerCodes + #")\s*\)"#),
            // 4. A country or language written out: "French Cinema", "FRENCH4K", not "Indiana Jones" or "Arabian Nights".
            Pattern(#"(^|[^A-Za-z])("# + words + #")([^A-Za-z]|$)"#),
        ]
    }()
    /// docs/browse.md "Origin countries": two ASCII letters with nothing but `\s` around them; group 1.
    private static let countryPattern = Pattern(#"^\s*([A-Za-z]{2})\s*$"#)

    /// A category name that one of the four rules matches, read with the Unicode spaces replaced. Everything else
    /// passes, an empty name included.
    public static func isForeignCategory(_ name: String) -> Bool {
        let s = BrowseText.spaces(name)
        guard !s.isEmpty else { return false }
        if caseSensitiveRules.contains(where: { $0.matches(s) }) { return true }
        let lower = BrowseText.asciiLowercased(s)
        return asciiCaseInsensitiveRules.contains { $0.matches(lower) }
    }

    /// An `origin` entry's country: with the Unicode spaces replaced, two ASCII letters with nothing but `\s` around
    /// them, upper-cased (" us" → "US"); nil for every other entry ("USA", "U.S.", "U S", "", "uſ", a fullwidth "ＵＳ").
    /// `COUNTRY` is checked before upper-casing, because "uſ".uppercased() is "US".
    static func country(_ entry: String) -> String? {
        BrowseText.group(1, of: countryPattern, in: BrowseText.spaces(entry))?.uppercased()
    }

    /// Category id → whether its name is foreign.
    static func foreignByID(_ categories: [Category]) -> [String: Bool] {
        var result: [String: Bool] = [:]
        for category in categories where result[category.id] == nil { result[category.id] = isForeignCategory(category.name) }
        return result
    }

    /// The category filter for one title: ids missing from `foreign` are left out; it passes when none is left or at
    /// least one of them is not foreign.
    static func categoriesPass(_ categoryIDs: [String], foreign: [String: Bool]) -> Bool {
        var known = false
        for id in categoryIDs {
            guard let isForeign = foreign[id] else { continue }
            if !isForeign { return true }
            known = true
        }
        return !known
    }

    /// No match, an `origin` without a country (unknown: `[]`, `["USA"]`), or one whose countries include US (`"US"`,
    /// `"us"`, `" US"`); entries that are not countries are ignored (`["USA", "GB"]` is Great Britain alone).
    static func originAllowed(_ match: RowsItem?) -> Bool {
        guard let match else { return true }
        let countries = match.origin.compactMap(country)
        return countries.isEmpty || countries.contains("US")
    }

    /// "Movies & Series: USA only" for one title: its categories pass the category filter (US titles filed only in
    /// foreign-language categories are usually dubbed copies) and, when it is matched to TMDB, its `origin` is unknown or
    /// includes US. `categoryIDs` are the title's merged `category_id`/`category_ids`; ids `categoriesByID` doesn't
    /// know (fallback categories such as "__tuner_movies") are left out.
    public static func isUSA(match: RowsItem?, categoryIDs: [String], categoriesByID: [String: Category]) -> Bool {
        let foreign = categoryIDs.reduce(into: [String: Bool]()) { result, id in
            if let category = categoriesByID[id] { result[id] = isForeignCategory(category.name) }
        }
        return categoriesPass(categoryIDs, foreign: foreign) && originAllowed(match)
    }
}

public struct GenreOption: Codable, Sendable, Hashable, Identifiable {
    /// "tmdb:<id>" when the rows carry genres for the kind, else "name:<lowercased name>".
    public var id: String
    public var name: String
    public init(id: String, name: String) { self.id = id; self.name = name }
}

public enum GenreMapping {
    /// Provider genre text split on "," "/" "|" ";" — never on "&" ("Action & Adventure" stays whole); trimmed,
    /// empty parts dropped, duplicates removed (case-insensitive).
    public static func split(_ text: String?) -> [String] {
        guard let text else { return [] }
        var seen = Set<String>()
        return text.split(whereSeparator: { ",/|;".contains($0) }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
    }

    /// A provider genre name → TMDB genre ids: case-insensitive name match, else the synonyms
    /// sci-fi/scifi/science-fiction → "Science Fiction" (movie) or "Sci-Fi & Fantasy" (tv); action, adventure → tv
    /// "Action & Adventure"; fantasy → tv "Sci-Fi & Fantasy"; war, politics → tv "War & Politics"; kids, children →
    /// tv "Kids", movie "Family"; doc, docu, documentaries → "Documentary"; tv movie → "TV Movie"; musical → "Music".
    public static func tmdbIDs(forProviderGenre name: String, kind: TitleKind, genres: [RowsGenre]) -> [Int] {
        let key = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !key.isEmpty else { return [] }
        if let exact = genres.first(where: { $0.name.lowercased() == key }) { return [exact.id] }
        let targets: [String]
        switch key {
        case "sci-fi", "scifi", "science-fiction", "science fiction", "sci fi":
            targets = kind == .movie ? ["science fiction"] : ["sci-fi & fantasy"]
        case "action", "adventure":
            targets = kind == .series ? ["action & adventure"] : []
        case "fantasy":
            targets = kind == .series ? ["sci-fi & fantasy"] : []
        case "war", "politics":
            targets = kind == .series ? ["war & politics"] : []
        case "kids", "children":
            targets = kind == .series ? ["kids"] : ["family"]
        case "doc", "docu", "documentaries":
            targets = ["documentary"]
        case "tv movie":
            targets = ["tv movie"]
        case "musical":
            targets = ["music"]
        default:
            targets = []
        }
        return targets.compactMap { target in genres.first { $0.name.lowercased() == target }?.id }
    }
}

// MARK: - Posters, rows, Discover, Library

public enum BrowseList: Hashable, Sendable, Codable {
    case popular
    case featured
    case topRated
    case recentlyAdded
    case az
    case service(StreamingService)
    /// "Popular", "Featured", "Top rated", "Recently added", "A–Z", or the service name.
    public var title: String {
        switch self {
        case .popular: return "Popular"
        case .featured: return "Featured"
        case .topRated: return "Top rated"
        case .recentlyAdded: return "Recently added"
        case .az: return "A–Z"
        case .service(let service): return service.displayName
        }
    }
}

public enum TitleRef: Hashable, Sendable {
    case movie(Movie)
    case series(Series)
    public var id: String {
        switch self {
        case .movie(let movie): return movie.id
        case .series(let series): return series.id
        }
    }
    public var kind: TitleKind {
        switch self {
        case .movie: return .movie
        case .series: return .series
        }
    }
    public var name: String {
        switch self {
        case .movie(let movie): return movie.name
        case .series(let series): return series.name
        }
    }
    /// Movie poster or series cover (2:3).
    public var poster: URL? {
        switch self {
        case .movie(let movie): return movie.poster
        case .series(let series): return series.cover
        }
    }
    public var year: String? {
        switch self {
        case .movie(let movie): return movie.year
        case .series(let series): return series.year
        }
    }
}

public struct PosterItem: Sendable, Hashable, Identifiable {
    public var title: TitleRef
    public var id: String { title.id }
    /// 0...1 when in progress (series: the newest episode's progress). Draws the progress bar.
    public var progress: Double?
    /// In the customer's Library (a favorite title). Draws the check badge.
    public var inLibrary: Bool
    /// Continue watching / Library: the recent that Select resumes (an episode for series).
    public var resume: RecentItem?
    /// Line under the poster: "S2 E3 · 12 min left", "Up next · S2 E4", or the year.
    public var caption: String?
    public init(title: TitleRef, progress: Double? = nil, inLibrary: Bool = false, resume: RecentItem? = nil, caption: String? = nil) {
        self.title = title; self.progress = progress; self.inLibrary = inLibrary; self.resume = resume; self.caption = caption
    }
}

public struct DiscoverQuery: Codable, Sendable, Hashable {
    public var kind: TitleKind
    public var list: BrowseList
    /// `GenreOption.id`; nil = "All".
    public var genreID: String?
    public init(kind: TitleKind = .movie, list: BrowseList = .popular, genreID: String? = nil) {
        self.kind = kind; self.list = list; self.genreID = genreID
    }
}

public enum SeeAll: Sendable, Hashable {
    case discover(DiscoverQuery)
    /// Continue watching opens Library.
    case library
}

public struct HomeRow: Sendable, Hashable, Identifiable {
    /// "continue", "popular.movie", "featured.series", "service.netflix.movie", "recent.movie", "top.series"...
    public var id: String
    /// "Continue watching", "Popular – Movies", "Netflix – Series"... (en dash).
    public var title: String
    /// At most `BrowseIndex.homeRowLimit`.
    public var items: [PosterItem]
    public var seeAll: SeeAll
    public init(id: String, title: String, items: [PosterItem], seeAll: SeeAll) {
        self.id = id; self.title = title; self.items = items; self.seeAll = seeAll
    }
}

/// The per-source library state the browse screens need (from `UserLibrary.snapshot`).
public struct LibrarySnapshot: Sendable, Hashable {
    /// Favorite movie and series ids.
    public var favoriteTitles: Set<String>
    /// Newest first.
    public var recents: [RecentItem]
    /// Newest first.
    public var history: [HistoryEntry]
    public init(favoriteTitles: Set<String> = [], recents: [RecentItem] = [], history: [HistoryEntry] = []) {
        self.favoriteTitles = favoriteTitles; self.recents = recents; self.history = history
    }
    public static let empty = LibrarySnapshot()
}

public struct LibrarySections: Sendable, Hashable {
    public var continueWatching: [PosterItem]
    public var favoriteMovies: [PosterItem]
    public var favoriteSeries: [PosterItem]
    public var recentlyWatched: [PosterItem]
    public init(continueWatching: [PosterItem] = [], favoriteMovies: [PosterItem] = [], favoriteSeries: [PosterItem] = [],
                recentlyWatched: [PosterItem] = []) {
        self.continueWatching = continueWatching; self.favoriteMovies = favoriteMovies
        self.favoriteSeries = favoriteSeries; self.recentlyWatched = recentlyWatched
    }
    public var isEmpty: Bool { continueWatching.isEmpty && favoriteMovies.isEmpty && favoriteSeries.isEmpty && recentlyWatched.isEmpty }
}

/// Immutable index over the visible catalogue. Build it off the main actor whenever the movie/series libraries, the
/// rows or the "Movies & Series" setting change (matching and filtering happen once, in `init`); the per-call
/// methods are cheap and take the current `LibrarySnapshot`.
///
/// The App Store edition (every build of this repository) names no streaming service anywhere: no "Netflix – Movies"
/// style Home rows and no service lists in Discover, exactly like the Android store edition. Service lists in the rows
/// endpoint still help matching (a title's TMDB origin feeds the USA filter); they are just never shown.
public struct BrowseIndex: Sendable {
    public static let homeRowMinimum = 5
    public static let homeRowLimit = 20

    /// Everything precomputed for one kind (movie or series).
    struct Side: Sendable {
        var ids: [String] = []
        var titles: [String: TitleRef] = [:]
        var searchNames: [String] = []
        /// Every visible title of each list, copies of one TMDB title included.
        var rawLists: [BrowseList: [String]] = [:]
        /// `rawLists` with one poster per TMDB title (`folded`), for queries without a genre.
        var lists: [BrowseList: [String]] = [:]
        var genreOptions: [GenreOption] = []
        var genres: [String: Set<String>] = [:]
        var services: [StreamingService] = []
        /// Visible title id → the id of the TMDB title it matched.
        var tmdbIDs: [String: Int] = [:]
        /// TMDB id → its visible copies when it has more than one, best first: those that pass "USA only", then the
        /// newest `added`, then catalogue order.
        var copies: [Int: [String]] = [:]

        /// docs/browse.md "Copies of one title": catalogue titles matched to the same TMDB title are one poster, which
        /// stands where its first visible copy stands in `ids` and opens its best-ranked visible copy. `visible` is the
        /// genre filter (the USA switch and the adult rules already left the others out of the side).
        func folded(_ ids: [String], visible: (String) -> Bool = { _ in true }) -> [String] {
            var result: [String] = []
            result.reserveCapacity(ids.count)
            var seen = Set<Int>()
            for id in ids where visible(id) {
                guard let tmdbID = tmdbIDs[id] else { result.append(id); continue }
                guard seen.insert(tmdbID).inserted else { continue }
                result.append(copies[tmdbID]?.first(where: visible) ?? id)
            }
            return result
        }
    }

    private let rows: CatalogRows
    private let usOnlyValue: Bool
    private let showsServices: Bool
    private let matches: TitleMatches
    let movieSide: Side
    let seriesSide: Side
    private let visibleMovies: [Movie]
    private let visibleSeries: [Series]

    /// `edition`: `.appStore` (the default, `Edition.current`) leaves out every list named after a streaming service.
    public init(movies: MovieLibrary?, series: SeriesLibrary?, rows: CatalogRows, usOnly: Bool, edition: Edition = .current) {
        let allMovies = movies?.movies ?? []
        let allSeries = series?.series ?? []
        let matches = rows.usesTMDB ? TitleMatcher(movies: allMovies, series: allSeries).match(rows) : TitleMatches()
        var movieCategories: [String: Category] = [:]
        for category in movies?.categories ?? [] where movieCategories[category.id] == nil { movieCategories[category.id] = category }
        var seriesCategories: [String: Category] = [:]
        for category in series?.categories ?? [] where seriesCategories[category.id] == nil { seriesCategories[category.id] = category }
        // "Movies & Series: USA only" for every title, also when the switch is off (it ranks copies of one TMDB title).
        let movieForeign = TitleRegion.foreignByID(movies?.categories ?? [])
        let seriesForeign = TitleRegion.foreignByID(series?.categories ?? [])
        let movieUSA = allMovies.map { TitleRegion.categoriesPass($0.categoryIDs, foreign: movieForeign) && TitleRegion.originAllowed(matches.items[$0.id]) }
        let seriesUSA = allSeries.map { TitleRegion.categoriesPass($0.categoryIDs, foreign: seriesForeign) && TitleRegion.originAllowed(matches.items[$0.id]) }
        let shownMovies = allMovies.indices.filter { !usOnly || movieUSA[$0] }
        let shownSeries = allSeries.indices.filter { !usOnly || seriesUSA[$0] }
        let visibleMovies = shownMovies.map { allMovies[$0] }
        let visibleSeries = shownSeries.map { allSeries[$0] }
        let services = edition == .direct
        self.rows = rows
        usOnlyValue = usOnly
        showsServices = services
        self.matches = matches
        self.visibleMovies = visibleMovies
        self.visibleSeries = visibleSeries
        movieSide = BrowseIndex.side(kind: .movie, refs: visibleMovies.map { TitleRef.movie($0) },
                                     meta: visibleMovies.map { ($0.added, $0.rating, $0.genre, $0.categoryIDs) }, usa: shownMovies.map { movieUSA[$0] },
                                     categories: movieCategories, rows: rows, matches: matches, services: services)
        seriesSide = BrowseIndex.side(kind: .series, refs: visibleSeries.map { TitleRef.series($0) },
                                      meta: visibleSeries.map { ($0.added, $0.rating, $0.genre, $0.categoryIDs) }, usa: shownSeries.map { seriesUSA[$0] },
                                      categories: seriesCategories, rows: rows, matches: matches, services: services)
    }

    private static func side(kind: TitleKind, refs: [TitleRef], meta: [(Int64, String?, String?, [String])], usa: [Bool],
                             categories: [String: Category], rows: CatalogRows, matches: TitleMatches, services: Bool) -> Side {
        var side = Side()
        side.ids = refs.map(\.id)
        for ref in refs { side.titles[ref.id] = ref }
        side.searchNames = refs.map { TextFold.fold($0.name) }
        let visible = Set(side.ids)
        let usesTMDB = rows.usesTMDB

        // Copies of one TMDB title, best first: those that pass USA only, then the newest `added`, then catalogue order.
        var copies: [Int: [Int]] = [:]
        for (index, ref) in refs.enumerated() {
            guard let item = matches.items[ref.id] else { continue }
            side.tmdbIDs[ref.id] = item.id
            copies[item.id, default: []].append(index)
        }
        for (tmdbID, indices) in copies where indices.count > 1 {
            side.copies[tmdbID] = indices.sorted { a, b in
                if usa[a] != usa[b] { return usa[a] }
                return meta[a].0 != meta[b].0 ? meta[a].0 > meta[b].0 : a < b
            }.map { refs[$0].id }
        }

        // Popular / Featured / Top rated from TMDB.
        if usesTMDB {
            side.rawLists[.popular] = matches.ids(kind, .popular).filter(visible.contains)
            side.rawLists[.featured] = matches.ids(kind, .featured).filter(visible.contains)
        }
        var top = usesTMDB ? matches.ids(kind, .topRated).filter(visible.contains) : []
        let topSet = Set(top)
        let rated = refs.indices.compactMap { index -> (String, Double, Int)? in
            guard !topSet.contains(refs[index].id), let value = TimeText.ratingValue(meta[index].1) else { return nil }
            return (refs[index].id, value, index)
        }.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.2 < $1.2 }
        top += rated.map(\.0)
        side.rawLists[.topRated] = top
        side.rawLists[.recentlyAdded] = refs.indices.filter { meta[$0].0 > 0 }
            .sorted { meta[$0].0 != meta[$1].0 ? meta[$0].0 > meta[$1].0 : $0 < $1 }.map { refs[$0].id }
        let sortKeys = refs.map { TextFold.sortKey($0.name) }
        side.rawLists[.az] = refs.indices.sorted { sortKeys[$0] != sortKeys[$1] ? sortKeys[$0] < sortKeys[$1] : $0 < $1 }.map { refs[$0].id }

        // Services: TMDB matches, then titles in categories named for the service (newest first). Direct edition only.
        for service in services ? StreamingService.allCases : [] {
            var ids = usesTMDB ? matches.ids(kind, .service(service)).filter(visible.contains) : []
            var seen = Set(ids)
            let pattern = service.keywordPattern
            let serviceCategories = Set(categories.values.filter { pattern.matches(BrowseText.asciiLowercased($0.name)) }.map(\.id))
            if !serviceCategories.isEmpty {
                let inCategories = refs.indices.filter { meta[$0].3.contains(where: serviceCategories.contains) }
                    .sorted { meta[$0].0 != meta[$1].0 ? meta[$0].0 > meta[$1].0 : $0 < $1 }
                for index in inCategories where seen.insert(refs[index].id).inserted { ids.append(refs[index].id) }
            }
            side.rawLists[.service(service)] = ids
            if !ids.isEmpty { side.services.append(service) }
        }
        let unfolded = side
        side.lists = unfolded.rawLists.mapValues { unfolded.folded($0) }

        // Genres.
        let rowGenres = rows.genres(kind)
        if !rowGenres.isEmpty {
            var used: [Int: Int] = [:]
            for (index, ref) in refs.enumerated() {
                var ids = Set(matches.items[ref.id]?.genres ?? [])
                for name in GenreMapping.split(meta[index].2) {
                    ids.formUnion(GenreMapping.tmdbIDs(forProviderGenre: name, kind: kind, genres: rowGenres))
                }
                guard !ids.isEmpty else { continue }
                side.genres[ref.id] = Set(ids.map { "tmdb:\($0)" })
                for id in ids { used[id, default: 0] += 1 }
            }
            side.genreOptions = rowGenres.filter { used[$0.id] != nil }
                .map { GenreOption(id: "tmdb:\($0.id)", name: $0.name) }
                .sorted { $0.name.lowercased() < $1.name.lowercased() }
        } else {
            var names: [String: String] = [:]
            for (index, ref) in refs.enumerated() {
                let parts = GenreMapping.split(meta[index].2)
                guard !parts.isEmpty else { continue }
                var ids = Set<String>()
                for part in parts {
                    let key = part.lowercased()
                    ids.insert("name:" + key)
                    if names[key] == nil { names[key] = part }
                }
                side.genres[ref.id] = ids
            }
            side.genreOptions = names.map { GenreOption(id: "name:" + $0.key, name: $0.value) }.sorted { $0.name.lowercased() < $1.name.lowercased() }
        }
        return side
    }

    public static let empty = BrowseIndex(movies: nil, series: nil, rows: .none, usOnly: true)

    public var usesTMDB: Bool { rows.usesTMDB }
    public var usOnly: Bool { usOnlyValue }
    /// Visible titles (after the USA filter), catalogue order.
    public var movies: [Movie] { visibleMovies }
    public var series: [Series] { visibleSeries }

    public func movie(id: String) -> Movie? {
        if case .movie(let movie)? = movieSide.titles[id] { return movie }
        return nil
    }

    public func series(id: String) -> Series? {
        if case .series(let series)? = seriesSide.titles[id] { return series }
        return nil
    }

    public func tmdbItem(forTitleID id: String) -> RowsItem? { matches.items[id] }

    private func side(_ kind: TitleKind) -> Side { kind == .movie ? movieSide : seriesSide }

    /// Discover's List picker, in this order: Popular, Featured (TMDB only), Top rated, Recently added, A–Z, then
    /// (direct edition only) each service that has at least one visible title. (Without TMDB data Popular is left out
    /// too: it would be empty.)
    public func lists(for kind: TitleKind) -> [BrowseList] {
        var lists: [BrowseList] = usesTMDB ? [.popular, .featured] : []
        lists += [.topRated, .recentlyAdded, .az]
        lists += side(kind).services.map { .service($0) }
        return lists
    }

    /// Discover's Genre picker (without "All"); empty hides the picker.
    public func genres(for kind: TitleKind) -> [GenreOption] { side(kind).genreOptions }

    /// The whole list, unlimited (the grid loads lazily):
    /// - Popular / Featured: matched titles in TMDB order (empty without TMDB);
    /// - Top rated: TMDB top_rated matches in order, then the rest with a provider rating > 0, highest first;
    /// - Recently added: `added` (movies) / `last_modified` (series) > 0, newest first;
    /// - A–Z: by name, case- and diacritic-insensitive, leading non-alphanumerics and a leading "The " ignored;
    /// - service: TMDB matches in order, then titles in categories named for the service (newest first), deduped
    ///   (direct edition only; empty in the App Store edition).
    /// Then filtered by genre when `genreID` is set, and copies of one TMDB title shown as one poster: the best-ranked
    /// visible copy (one that passes "USA only", then the newest), where the first visible copy stands.
    public func discover(_ query: DiscoverQuery, library: LibrarySnapshot) -> [PosterItem] {
        posters(ids(for: query), library: library)
    }

    func ids(for query: DiscoverQuery) -> [String] {
        let side = side(query.kind)
        guard let genreID = query.genreID else { return side.lists[query.list] ?? [] }
        return side.folded(side.rawLists[query.list] ?? []) { side.genres[$0]?.contains(genreID) ?? false }
    }

    func posters(_ ids: [String], library: LibrarySnapshot, limit: Int? = nil) -> [PosterItem] {
        let progress = BrowseIndex.progressByTitle(library.recents)
        var result: [PosterItem] = []
        for id in ids {
            if let limit, result.count >= limit { break }
            guard let ref = movieSide.titles[id] ?? seriesSide.titles[id] else { continue }
            result.append(PosterItem(title: ref, progress: progress[id], inLibrary: library.favoriteTitles.contains(id), caption: ref.year))
        }
        return result
    }

    /// Title id → the newest recent's progress (movies by id, series by their newest episode).
    private static func progressByTitle(_ recents: [RecentItem]) -> [String: Double] {
        var result: [String: Double] = [:]
        var seen = Set<String>()
        for recent in recents where seen.insert(recent.titleID).inserted {
            if let value = recent.progress { result[recent.titleID] = value }
        }
        return result
    }

    /// docs/browse.md Home order: Continue watching; Popular – Movies/Series; Featured – Movies/Series; per service
    /// (Netflix, Disney+, Max, Prime Video, Apple TV+, Hulu, Paramount+, Peacock) Movies then Series (direct edition
    /// only); Recently added – Movies/Series; Top rated – Movies/Series. A row appears only with >= 5 titles; at most 20 each.
    public func homeRows(library: LibrarySnapshot) -> [HomeRow] {
        var rows: [HomeRow] = []
        let continuing = continueWatching(library)
        if continuing.count >= BrowseIndex.homeRowMinimum {
            rows.append(HomeRow(id: "continue", title: "Continue watching", items: Array(continuing.prefix(BrowseIndex.homeRowLimit)), seeAll: .library))
        }
        func add(_ id: String, _ list: BrowseList, _ kind: TitleKind) {
            let query = DiscoverQuery(kind: kind, list: list)
            let items = posters(ids(for: query), library: library, limit: BrowseIndex.homeRowLimit)
            guard items.count >= BrowseIndex.homeRowMinimum else { return }
            rows.append(HomeRow(id: "\(id).\(kind.rawValue)", title: "\(list.title) – \(kind.plural)", items: items, seeAll: .discover(query)))
        }
        if usesTMDB {
            add("popular", .popular, .movie)
            add("popular", .popular, .series)
            add("featured", .featured, .movie)
            add("featured", .featured, .series)
        }
        for service in showsServices ? StreamingService.allCases : [] {
            add("service.\(service.rawValue)", .service(service), .movie)
            add("service.\(service.rawValue)", .service(service), .series)
        }
        add("recent", .recentlyAdded, .movie)
        add("recent", .recentlyAdded, .series)
        add("top", .topRated, .movie)
        add("top", .topRated, .series)
        return rows
    }

    /// Movies in progress plus, per series, its newest episode recent (in progress or up next); newest first.
    public func continueWatching(_ library: LibrarySnapshot) -> [PosterItem] {
        var result: [PosterItem] = []
        var seen = Set<String>()
        for recent in library.recents {
            let titleID = recent.titleID
            guard seen.insert(titleID).inserted else { continue }
            switch recent.kind {
            case .movie:
                guard let movie = movie(id: recent.id) else { continue }
                let left = recent.durationMs > 0 ? TimeText.left(seconds: Int(max(0, recent.durationMs - recent.positionMs) / 1000)) : nil
                result.append(PosterItem(title: .movie(movie), progress: recent.progress, inLibrary: library.favoriteTitles.contains(movie.id),
                                         resume: recent, caption: left ?? movie.year))
            case .episode:
                guard let show = series(id: titleID) else { continue }
                let label = BrowseIndex.episodeLabel(recent)
                let caption: String
                if recent.upNext {
                    caption = "Up next" + (label.map { " · " + $0 } ?? "")
                } else if recent.durationMs > 0 {
                    let left = TimeText.left(seconds: Int(max(0, recent.durationMs - recent.positionMs) / 1000))
                    caption = label.map { "\($0) · \(left)" } ?? left
                } else {
                    caption = label ?? (show.year ?? "")
                }
                result.append(PosterItem(title: .series(show), progress: recent.progress, inLibrary: library.favoriteTitles.contains(show.id),
                                         resume: recent, caption: caption.isEmpty ? nil : caption))
            }
        }
        return result
    }

    /// "S2 E3" from the recent's numbers.
    private static func episodeLabel(_ recent: RecentItem) -> String? {
        guard let season = recent.season, let episode = recent.episode else { return nil }
        return "S\(season) E\(episode)"
    }

    /// Continue watching, Favorite movies, Favorite series (A–Z, every favorite copy), Recently watched (history, newest
    /// first, max 40).
    public func library(_ library: LibrarySnapshot) -> LibrarySections {
        let favoriteMovies = movieSide.rawLists[.az]?.filter(library.favoriteTitles.contains) ?? []
        let favoriteSeries = seriesSide.rawLists[.az]?.filter(library.favoriteTitles.contains) ?? []
        var seen = Set<String>()
        let history = library.history.map(\.titleID).filter { seen.insert($0).inserted }
        return LibrarySections(continueWatching: continueWatching(library), favoriteMovies: posters(favoriteMovies, library: library),
                               favoriteSeries: posters(favoriteSeries, library: library),
                               recentlyWatched: posters(history, library: library, limit: 40))
    }
}

// MARK: - Series navigation and resume

public enum SeriesNavigation {
    /// Returning episode's season, else last-watched episode's season, else first season > 0, else first season.
    public static func defaultSeason(_ info: SeriesInfo, returningTo episodeID: String?, recents: [RecentItem]) -> Int? {
        let seasons = info.seasonNumbers
        guard !seasons.isEmpty else { return nil }
        var seasonOf: [String: Int] = [:]
        for (season, episodes) in info.seasons { for episode in episodes { seasonOf[episode.id] = season } }
        if let episodeID, let season = seasonOf[episodeID] { return season }
        for recent in recents where recent.kind == .episode {
            if let season = seasonOf[recent.id] { return season }
        }
        return seasons.first { $0 > 0 } ?? seasons.first
    }

    /// The newest recent for an episode of this series that still exists in `info`.
    public static func resumePoint(_ info: SeriesInfo, seriesID: String, recents: [RecentItem]) -> (episode: Episode, recent: RecentItem)? {
        var byID: [String: Episode] = [:]
        for episode in info.allEpisodes where byID[episode.id] == nil { byID[episode.id] = episode }
        for recent in recents where recent.kind == .episode && (recent.seriesID == nil || recent.seriesID == seriesID) {
            if let episode = byID[recent.id] { return (episode, recent) }
        }
        return nil
    }

    /// First playable episode with season > 0 (else the first playable one).
    public static func firstEpisode(_ info: SeriesInfo) -> Episode? {
        let playable = info.allEpisodes.filter(\.isPlayable)
        return playable.first { $0.season > 0 } ?? playable.first
    }

    /// Up to `limit` playable episodes after `episode`, in season-then-episode order.
    public static func queue(after episode: Episode, in info: SeriesInfo, limit: Int = 30) -> [Episode] {
        let all = info.allEpisodes
        guard let index = all.firstIndex(where: { $0.id == episode.id }) else { return [] }
        return Array(all[(index + 1)...].filter(\.isPlayable).prefix(max(0, limit)))
    }

    /// "S1 E2 · Title".
    public static func label(_ episode: Episode) -> String { "S\(episode.season) E\(episode.number) · \(episode.title)" }
}

public enum ResumeDecision: Sendable, Equatable {
    case save
    case remove
    case ignore
}

public enum ResumePolicy {
    /// save when position > 15 s and <= 95 % watched; remove when > 95 %; ignore otherwise.
    public static func decide(positionMs: Int64, durationMs: Int64) -> ResumeDecision {
        if durationMs > 0 && Double(positionMs) > Double(durationMs) * 0.95 { return .remove }
        if positionMs > 15_000 { return .save }
        return .ignore
    }
}

// MARK: - Search

public struct SearchResults: Sendable, Hashable {
    public var channels: [Channel]
    public var movies: [PosterItem]
    public var series: [PosterItem]
    public init(channels: [Channel] = [], movies: [PosterItem] = [], series: [PosterItem] = []) {
        self.channels = channels; self.movies = movies; self.series = series
    }
    public var isEmpty: Bool { channels.isEmpty && movies.isEmpty && series.isEmpty }
}

public enum CatalogSearch {
    /// Runs when the trimmed query has >= 2 characters or is all digits; case- and diacritic-insensitive contains.
    /// Channels: exact number first, then name/number matches (30). Movies 40, series 40, from the visible titles of
    /// `index` (the USA filter applies to search too). Names that start with the query come before other matches.
    public static func run(_ query: String, lineup: LiveLineup?, index: BrowseIndex, library: LibrarySnapshot) -> SearchResults {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = !trimmed.isEmpty && trimmed.allSatisfy { $0.isASCII && $0.isNumber }
        guard trimmed.count >= 2 || digits else { return SearchResults() }
        let needle = TextFold.fold(trimmed)
        var results = SearchResults()
        if let lineup {
            var exact: [Channel] = []
            var starts: [Channel] = []
            var contains: [Channel] = []
            let number = digits ? Int(trimmed) : nil
            for channel in lineup.channels {
                if let number, channel.number == number { exact.append(channel); continue }
                let name = TextFold.fold(channel.name)
                if name.hasPrefix(needle) { starts.append(channel) } else if name.contains(needle) || (digits && String(channel.number).contains(trimmed)) {
                    contains.append(channel)
                }
            }
            results.channels = Array((exact + starts + contains).prefix(30))
        }
        func titles(_ side: BrowseIndex.Side) -> [String] {
            var starts: [String] = []
            var contains: [String] = []
            for (offset, name) in side.searchNames.enumerated() {
                if name.hasPrefix(needle) { starts.append(side.ids[offset]) } else if name.contains(needle) { contains.append(side.ids[offset]) }
                if starts.count >= 40 { break }
            }
            return Array((starts + contains).prefix(40))
        }
        results.movies = index.posters(titles(index.movieSide), library: library)
        results.series = index.posters(titles(index.seriesSide), library: library)
        return results
    }
}
