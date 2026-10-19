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
    /// ISO 3166-1 alpha-2, uppercase ("US").
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
        let origin: [String]
        switch json["origin"] {
        case .array(let values)?: origin = values.compactMap { $0.text?.uppercased() }
        case .string(let text)?: origin = text.split(whereSeparator: { $0 == "," || $0 == " " }).map { $0.uppercased() }
        default: origin = []
        }
        self.init(id: id, title: title, originalTitle: json["original_title"]?.text, year: XtreamParser.yearText(json["year"]?.text),
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

    /// Whole-word, case-insensitive category keywords for the no-TMDB fallback: netflix | disney | hbo, max |
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

    var keywordPattern: Pattern {
        Pattern("(?<![a-z0-9])(?:" + categoryKeywords.joined(separator: "|") + ")(?![a-z0-9])", caseInsensitive: true)
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

public enum TitleNormalizer {
    private static let trailingYear = Pattern(#"\s*[\(\[](?:19|20)\d{2}[\)\]]\s*$"#)
    private static let brackets = Pattern(#"\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|\|[^|]*\|"#)
    private static let leadingTag = Pattern(
        #"^\s*(?:us|usa|en|eng|uk|gb|ca|au|nz|ie|fr|de|es|pt|br|mx|lat|nl|pl|ro|ru|tr|ar|pk|hi|multi|vod|4k|8k|uhd|fhd|hd|sd|hdr)\s*[-:|]\s*"#)
    private static let quality = Pattern(#"(?<![\p{L}\p{N}])(?:4k|8k|uhd|fhd|hd|sd|hdr10|hdr|2160p|1080p|720p)(?![\p{L}\p{N}])"#)
    private static let yearAnywhere = Pattern(#"[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]"#)
    /// Trailing quality/language tags ("[4K]", "{Extended}", "|EN|"), but never a bracketed year ("[2019]").
    private static let trailingTags = Pattern(#"(?:\s*(?:\[(?!\s*(?:19|20)\d{2}\s*\])[^\]]*\]|\{[^}]*\}|\|[^|]*\|))+\s*$"#)

    /// docs/browse.md normalization, exactly in this order:
    /// 1. Unicode canonical decomposition, combining marks removed; lowercased.
    /// 2. A trailing "(YYYY)" or "[YYYY]" (19xx/20xx) removed.
    /// 3. Bracketed groups `[...]`, `(...)`, `{...}` and pipe-delimited tags `|...|` removed.
    /// 4. A leading tag followed by "-", ":" or "|" removed when the tag is one of: us usa en eng uk gb ca au nz ie fr de
    ///    es pt br mx lat nl pl ro ru tr ar pk hi multi vod 4k 8k uhd fhd hd sd hdr (never "it", "in" or other words).
    /// 5. Whole words 4k 8k uhd fhd hd sd hdr hdr10 2160p 1080p 720p removed.
    /// 6. "&" → " and ".
    /// 7. Every character that is not a letter, digit or whitespace removed (apostrophes, hyphens, colons...).
    /// 8. Whitespace collapsed and trimmed; a leading "the " removed.
    public static func normalize(_ title: String) -> String {
        var s = TextFold.fold(title)                                      // 1
        s = trailingYear.replace(s, with: "")                             // 2
        s = brackets.replace(s, with: " ")                                // 3
        s = leadingTag.replace(s, with: "")                               // 4
        s = quality.replace(s, with: " ")                                 // 5
        s = s.replacingOccurrences(of: "&", with: " and ")                // 6
        var kept = String.UnicodeScalarView()                             // 7
        for scalar in s.unicodeScalars {
            if scalar.properties.isAlphabetic || scalar.properties.numericType != nil || scalar.properties.isWhitespace {
                kept.append(scalar.properties.isWhitespace ? " " : scalar)
            }
        }
        var words = String(kept).split(separator: " ").map(String.init)  // 8
        if words.count > 1, words[0] == "the" { words.removeFirst() }
        return words.joined(separator: " ")
    }

    /// A trailing "(YYYY)"/"[YYYY]" in a provider name, else nil. Quality and language tags after it are ignored
    /// ("The Batman (2022) [4K]").
    public static func year(in title: String) -> String? {
        let head = trailingTags.replace(title, with: "")
        guard let match = yearAnywhere.allMatches(head).last, let swiftRange = Range(match.range, in: head) else { return nil }
        guard head[swiftRange.upperBound...].trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return Pattern.groups(of: match, in: head).first ?? nil
    }

    /// Both present (first 4 digits) and at most 1 apart.
    public static func yearsMatch(_ a: String?, _ b: String?) -> Bool {
        guard let x = yearValue(a), let y = yearValue(b) else { return false }
        return abs(x - y) <= 1
    }

    static func yearValue(_ text: String?) -> Int? {
        guard let text = text?.trimmingCharacters(in: .whitespaces), text.count >= 4 else { return nil }
        let prefix = text.prefix(4)
        guard prefix.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return Int(prefix)
    }
}

/// Which catalogue titles the rows lists point at.
public struct TitleMatches: Sendable, Hashable {
    /// Catalogue title id ("m:…", "mu:…", "s:…", "ms:…") → its TMDB item.
    public var items: [String: RowsItem]
    /// List → matched movie ids in TMDB order (each id once per list).
    public var movieLists: [RowsList: [String]]
    /// List → matched series ids in TMDB order.
    public var seriesLists: [RowsList: [String]]
    public init(items: [String: RowsItem] = [:], movieLists: [RowsList: [String]] = [:], seriesLists: [RowsList: [String]] = [:]) {
        self.items = items; self.movieLists = movieLists; self.seriesLists = seriesLists
    }

    public func ids(_ kind: TitleKind, _ list: RowsList) -> [String] {
        (kind == .movie ? movieLists[list] : seriesLists[list]) ?? []
    }
}

/// docs/browse.md matching. Each TMDB item matches at most one catalogue title of its kind:
/// 1. a title whose provider `tmdbID` equals the item id (several: the newest `added`);
/// 2. else titles whose normalized name equals the normalized `title` or `original_title` and whose year is within 1
///    (several: smallest year difference, then newest `added`); a title without a year matches only when it is the
///    only catalogue title with that normalized name.
/// A catalogue title keeps the first TMDB item it matched (lists in the order popular, featured, topRated, services).
public struct TitleMatcher: Sendable {
    private struct Candidate: Sendable {
        let id: String
        let year: Int?
        let added: Int64
    }

    private struct Index: Sendable {
        var byTMDB: [Int: [Candidate]] = [:]
        var byName: [String: [Candidate]] = [:]

        mutating func add(id: String, name: String, year: String?, tmdbID: Int?, added: Int64) {
            let candidate = Candidate(id: id, year: TitleNormalizer.yearValue(year ?? TitleNormalizer.year(in: name)), added: added)
            if let tmdbID { byTMDB[tmdbID, default: []].append(candidate) }
            let key = TitleNormalizer.normalize(name)
            if !key.isEmpty { byName[key, default: []].append(candidate) }
        }

        func match(_ item: RowsItem) -> String? {
            if let candidates = byTMDB[item.id], !candidates.isEmpty {
                return candidates.enumerated().max { a, b in
                    a.element.added != b.element.added ? a.element.added < b.element.added : a.offset > b.offset
                }?.element.id
            }
            var names: [String] = []
            for name in [item.title, item.originalTitle ?? ""] {
                let key = TitleNormalizer.normalize(name)
                if !key.isEmpty && !names.contains(key) { names.append(key) }
            }
            let itemYear = TitleNormalizer.yearValue(item.year)
            var best: (id: String, difference: Int, added: Int64, order: Int)?
            var order = 0
            for name in names {
                let candidates = byName[name] ?? []
                for candidate in candidates {
                    order += 1
                    let difference: Int
                    if let year = candidate.year {
                        guard let itemYear, abs(year - itemYear) <= 1 else { continue }
                        difference = abs(year - itemYear)
                    } else {
                        guard candidates.count == 1 else { continue }
                        difference = 2
                    }
                    if let current = best {
                        if difference > current.difference { continue }
                        if difference == current.difference && candidate.added <= current.added { continue }
                    }
                    best = (candidate.id, difference, candidate.added, order)
                }
            }
            return best?.id
        }
    }

    private let movieIndex: Index
    private let seriesIndex: Index

    public init(movies: [Movie], series: [Series]) {
        var movieIndex = Index()
        for movie in movies { movieIndex.add(id: movie.id, name: movie.name, year: movie.year, tmdbID: movie.tmdbID, added: movie.added) }
        var seriesIndex = Index()
        for show in series { seriesIndex.add(id: show.id, name: show.name, year: show.year, tmdbID: show.tmdbID, added: show.added) }
        self.movieIndex = movieIndex
        self.seriesIndex = seriesIndex
    }

    public func match(_ rows: CatalogRows) -> TitleMatches {
        var result = TitleMatches()
        for kind in [TitleKind.movie, .series] {
            let index = kind == .movie ? movieIndex : seriesIndex
            let lists = rows.lists(kind)
            var matchedByItem: [Int: String?] = [:]
            for list in RowsList.matchingOrder {
                var ids: [String] = []
                var seen = Set<String>()
                for item in lists.items(list) {
                    let id: String?
                    if let cached = matchedByItem[item.id] { id = cached } else {
                        id = index.match(item)
                        matchedByItem[item.id] = id
                    }
                    guard let id else { continue }
                    if result.items[id] == nil { result.items[id] = item }
                    if seen.insert(id).inserted { ids.append(id) }
                }
                if !ids.isEmpty {
                    if kind == .movie { result.movieLists[list] = ids } else { result.seriesLists[list] = ids }
                }
            }
        }
        return result
    }
}

// MARK: - "Movies & Series: USA only" and genres

public enum TitleRegion {
    private static let codes = ["FR", "DE", "IT", "ES", "LAT", "MX", "BR", "PT", "TR", "AR", "IN", "PK", "NL", "PL", "RO", "RU", "UK", "CA"]
    private static let codeGroup = "(?:" + codes.joined(separator: "|") + ")"
    private static let leading = Pattern(#"^[^A-Za-z0-9]*"# + codeGroup + #"\s*[|:\-\])]"#, caseInsensitive: true)
    private static let marked = Pattern(#"\|\s*"# + codeGroup + #"\s*\||\[\s*"# + codeGroup + #"\s*\]|\(\s*"# + codeGroup + #"\s*\)"#,
                                        caseInsensitive: true)
    private static let upperWord = Pattern("(?<![A-Za-z0-9])(?:" + codes.filter { $0 != "IN" && $0 != "IT" }.joined(separator: "|")
                                           + ")(?![A-Za-z0-9])")
    private static let languages = Pattern(
        "(?<![a-z0-9])(?:hindi|french|german|italian|spanish|espanol|español|latino|portuguese|brazil|brasil|turkish|arabic|punjabi|tamil|"
            + "telugu|malayalam|kannada|bengali|urdu|dutch|polish|romanian|russian|korean|japanese|chinese|filipino|vietnamese|thai|persian|"
            + "farsi|greek|albanian|kurdish)(?![a-z0-9])",
        caseInsensitive: true)

    /// A category name that carries a non-US country or language tag (docs/browse.md):
    /// - codes FR DE IT ES LAT MX BR PT TR AR IN PK NL PL RO RU UK CA, matched (case-insensitive) as a leading tag
    ///   (`^\W*CODE\s*[|:\-\])]`), as `|CODE|`, `[CODE]` or `(CODE)` anywhere, or (except IN and IT) as an uppercase
    ///   whole word in the original name ("UK Comedy", but not "Movies In Theaters");
    /// - language words, whole word, case-insensitive: hindi french german italian spanish espanol latino portuguese
    ///   brazil brasil turkish arabic punjabi tamil telugu malayalam kannada bengali urdu dutch polish romanian russian
    ///   korean japanese chinese filipino vietnamese thai persian farsi greek albanian kurdish.
    public static func isForeignCategory(_ name: String) -> Bool {
        leading.matches(name) || marked.matches(name) || upperWord.matches(name) || languages.matches(name)
    }

    /// Matched to TMDB: shown only if `origin` contains "US" and the category rule passes too (US titles filed in a
    /// foreign-language category are usually dubbed copies). An empty `origin` is unknown: the category rule alone
    /// decides, as for unmatched titles. The category rule: none of the title's categories is foreign (fallback
    /// categories such as "__tuner_movies" pass). docs/browse.md "Which titles appear".
    public static func isUSA(match: RowsItem?, categoryIDs: [String], categoriesByID: [String: Category]) -> Bool {
        let categoriesPass = !categoryIDs.contains { id in categoriesByID[id].map { isForeignCategory($0.name) } ?? false }
        if let match, !match.origin.isEmpty { return categoriesPass && match.origin.contains { $0.uppercased() == "US" } }
        return categoriesPass
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
        var lists: [BrowseList: [String]] = [:]
        var genreOptions: [GenreOption] = []
        var genres: [String: Set<String>] = [:]
        var services: [StreamingService] = []
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
        let visibleMovies = usOnly ? allMovies.filter {
            TitleRegion.isUSA(match: matches.items[$0.id], categoryIDs: $0.categoryIDs, categoriesByID: movieCategories)
        } : allMovies
        let visibleSeries = usOnly ? allSeries.filter {
            TitleRegion.isUSA(match: matches.items[$0.id], categoryIDs: $0.categoryIDs, categoriesByID: seriesCategories)
        } : allSeries
        let services = edition == .direct
        self.rows = rows
        usOnlyValue = usOnly
        showsServices = services
        self.matches = matches
        self.visibleMovies = visibleMovies
        self.visibleSeries = visibleSeries
        movieSide = BrowseIndex.side(kind: .movie, refs: visibleMovies.map { TitleRef.movie($0) },
                                     meta: visibleMovies.map { ($0.added, $0.rating, $0.genre, $0.categoryIDs) },
                                     categories: movieCategories, rows: rows, matches: matches, services: services)
        seriesSide = BrowseIndex.side(kind: .series, refs: visibleSeries.map { TitleRef.series($0) },
                                      meta: visibleSeries.map { ($0.added, $0.rating, $0.genre, $0.categoryIDs) },
                                      categories: seriesCategories, rows: rows, matches: matches, services: services)
    }

    private static func side(kind: TitleKind, refs: [TitleRef], meta: [(Int64, String?, String?, [String])], categories: [String: Category],
                             rows: CatalogRows, matches: TitleMatches, services: Bool) -> Side {
        var side = Side()
        side.ids = refs.map(\.id)
        for ref in refs { side.titles[ref.id] = ref }
        side.searchNames = refs.map { TextFold.fold($0.name) }
        let visible = Set(side.ids)
        let usesTMDB = rows.usesTMDB

        // Popular / Featured / Top rated from TMDB.
        if usesTMDB {
            side.lists[.popular] = matches.ids(kind, .popular).filter(visible.contains)
            side.lists[.featured] = matches.ids(kind, .featured).filter(visible.contains)
        }
        var top = usesTMDB ? matches.ids(kind, .topRated).filter(visible.contains) : []
        let topSet = Set(top)
        let rated = refs.indices.compactMap { index -> (String, Double, Int)? in
            guard !topSet.contains(refs[index].id), let value = TimeText.ratingValue(meta[index].1) else { return nil }
            return (refs[index].id, value, index)
        }.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.2 < $1.2 }
        top += rated.map(\.0)
        side.lists[.topRated] = top
        side.lists[.recentlyAdded] = refs.indices.filter { meta[$0].0 > 0 }
            .sorted { meta[$0].0 != meta[$1].0 ? meta[$0].0 > meta[$1].0 : $0 < $1 }.map { refs[$0].id }
        let sortKeys = refs.map { TextFold.sortKey($0.name) }
        side.lists[.az] = refs.indices.sorted { sortKeys[$0] != sortKeys[$1] ? sortKeys[$0] < sortKeys[$1] : $0 < $1 }.map { refs[$0].id }

        // Services: TMDB matches, then titles in categories named for the service (newest first). Direct edition only.
        for service in services ? StreamingService.allCases : [] {
            var ids = usesTMDB ? matches.ids(kind, .service(service)).filter(visible.contains) : []
            var seen = Set(ids)
            let pattern = service.keywordPattern
            let serviceCategories = Set(categories.values.filter { pattern.matches($0.name) }.map(\.id))
            if !serviceCategories.isEmpty {
                let inCategories = refs.indices.filter { meta[$0].3.contains(where: serviceCategories.contains) }
                    .sorted { meta[$0].0 != meta[$1].0 ? meta[$0].0 > meta[$1].0 : $0 < $1 }
                for index in inCategories where seen.insert(refs[index].id).inserted { ids.append(refs[index].id) }
            }
            side.lists[.service(service)] = ids
            if !ids.isEmpty { side.services.append(service) }
        }

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
    /// Then filtered by genre when `genreID` is set.
    public func discover(_ query: DiscoverQuery, library: LibrarySnapshot) -> [PosterItem] {
        posters(ids(for: query), library: library)
    }

    func ids(for query: DiscoverQuery) -> [String] {
        let side = side(query.kind)
        let ids = side.lists[query.list] ?? []
        guard let genreID = query.genreID else { return ids }
        return ids.filter { side.genres[$0]?.contains(genreID) ?? false }
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

    /// Continue watching, Favorite movies, Favorite series, Recently watched (history, newest first, max 40).
    public func library(_ library: LibrarySnapshot) -> LibrarySections {
        let favoriteMovies = movieSide.lists[.az]?.filter(library.favoriteTitles.contains) ?? []
        let favoriteSeries = seriesSide.lists[.az]?.filter(library.favoriteTitles.contains) ?? []
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
