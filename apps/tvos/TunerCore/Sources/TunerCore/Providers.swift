import Foundation

// MARK: - Xtream Codes

public enum Xtream {
    /// Trim; prefix "http://" without a scheme; cut from /player_api.php, /get.php or /xmltv.php; trim trailing "/".
    public static func normalizeServer(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return "" }
        let lower = text.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") { text = "http://" + text }
        for marker in ["/player_api.php", "/get.php", "/xmltv.php"] {
            if let range = text.range(of: marker, options: .caseInsensitive) { text = String(text[..<range.lowerBound]) }
        }
        while text.hasSuffix("/") { text.removeLast() }
        return text
    }

    /// ".../get.php?username=U&password=P..." → login with server = scheme://authority. Nil otherwise.
    public static func login(fromGetPhp link: String) -> XtreamLogin? {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: "get.php", options: .caseInsensitive) != nil,
              let components = URLComponents(string: trimmed), let scheme = components.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = components.percentEncodedHost, !host.isEmpty
        else { return nil }
        // Form-style query: "+" is a space and "%2B" a plus, so "+" is replaced before percent-decoding.
        let items = components.percentEncodedQueryItems ?? []
        func query(_ name: String) -> String? {
            guard let raw = items.first(where: { $0.name.lowercased() == name })?.value else { return nil }
            let spaced = raw.replacingOccurrences(of: "+", with: " ")
            return spaced.removingPercentEncoding ?? spaced
        }
        guard let username = query("username"), !username.isEmpty, let password = query("password"), !password.isEmpty else { return nil }
        var server = "\(scheme)://\(host)"
        if let port = components.port { server += ":\(port)" }
        return XtreamLogin(server: server, username: username, password: password)
    }

    /// <base>/player_api.php?username=&password=[&action=][&extra...] (form-encoded query values, space → "+").
    public static func apiURL(_ login: XtreamLogin, action: String? = nil, extra: [(String, String)] = []) -> URL? {
        let base = normalizeServer(login.server)
        guard !base.isEmpty else { return nil }
        var text = base + "/player_api.php?username=" + formEncode(login.username) + "&password=" + formEncode(login.password)
        if let action { text += "&action=" + formEncode(action) }
        for (key, value) in extra { text += "&" + formEncode(key) + "=" + formEncode(value) }
        return URL(string: text)
    }

    /// <base>/xmltv.php?username=&password=
    public static func guideURL(_ login: XtreamLogin) -> URL? {
        let base = normalizeServer(login.server)
        guard !base.isEmpty else { return nil }
        return URL(string: base + "/xmltv.php?username=" + formEncode(login.username) + "&password=" + formEncode(login.password))
    }

    /// Always ".ts" (the provider sends raw TS anyway). A `direct_source` starting with http wins; a direct .ts/.m3u8
    /// source gets its extension swapped to .ts, query kept. Path segments percent-encoded.
    public static func liveURL(_ login: XtreamLogin, streamID: String, directSource: String? = nil) -> URL? {
        if let direct = httpLink(directSource) { return makeURL(withTSExtension(direct)) }
        return streamURL(login, kind: "live", id: streamID, ext: "ts")
    }

    /// <base>/movie/<u>/<p>/<id>.<ext or "mp4">, or `directSource` when it starts with http.
    public static func movieURL(_ login: XtreamLogin, streamID: String, containerExtension: String?, directSource: String? = nil) -> URL? {
        if let direct = httpLink(directSource) { return makeURL(direct) }
        return streamURL(login, kind: "movie", id: streamID, ext: sanitizedExtension(containerExtension))
    }

    /// <base>/series/<u>/<p>/<id>.<ext or "mp4">, or `directSource` when it starts with http.
    public static func episodeURL(_ login: XtreamLogin, episodeID: String, containerExtension: String?, directSource: String? = nil) -> URL? {
        if let direct = httpLink(directSource) { return makeURL(direct) }
        return streamURL(login, kind: "series", id: episodeID, ext: sanitizedExtension(containerExtension))
    }

    // MARK: helpers

    static func streamURL(_ login: XtreamLogin, kind: String, id: String, ext: String) -> URL? {
        let base = normalizeServer(login.server)
        guard !base.isEmpty, !id.isEmpty else { return nil }
        return URL(string: "\(base)/\(kind)/\(pathEncode(login.username))/\(pathEncode(login.password))/\(pathEncode(id)).\(ext)")
    }

    static func sanitizedExtension(_ raw: String?) -> String {
        guard var ext = raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), !ext.isEmpty else { return "mp4" }
        if ext.hasPrefix(".") { ext.removeFirst() }
        guard (1...8).contains(ext.count), ext.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) }) else { return "mp4" }
        return ext
    }

    static func httpLink(_ raw: String?) -> String? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), text.lowercased().hasPrefix("http") else { return nil }
        let lower = text.lowercased()
        guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else { return nil }
        return text
    }

    static func makeURL(_ text: String) -> URL? {
        if let url = URL(string: text) { return url }
        return URL(string: text.replacingOccurrences(of: " ", with: "%20"))
    }

    /// Swaps a live direct_source's .ts/.m3u8 extension to .ts, keeping the query.
    static func withTSExtension(_ url: String) -> String {
        let path: Substring
        let rest: Substring
        if let mark = url.firstIndex(of: "?") { path = url[..<mark]; rest = url[mark...] } else { path = url[...]; rest = "" }
        guard let slash = path.lastIndex(of: "/") else { return url }
        let last = path[path.index(after: slash)...].lowercased()
        guard last.hasSuffix(".ts") || last.hasSuffix(".m3u8"), let dot = path.lastIndex(of: "."), dot > slash else { return url }
        return String(path[..<dot]) + ".ts" + rest
    }

    /// `URLEncoder.encode`-style form encoding (unreserved: A-Z a-z 0-9 . - * _; space → "+").
    static func formEncode(_ text: String) -> String {
        var out = ""
        for byte in text.utf8 {
            switch byte {
            case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "."), UInt8(ascii: "-"), UInt8(ascii: "*"), UInt8(ascii: "_"):
                out.append(Character(Unicode.Scalar(byte)))
            case UInt8(ascii: " "): out.append("+")
            default: out += percent(byte)
            }
        }
        return out
    }

    /// `encodeURIComponent`-style path segment encoding (as the Samsung and LG apps do).
    static func pathEncode(_ text: String) -> String {
        var out = ""
        for byte in text.utf8 {
            switch byte {
            case UInt8(ascii: "A")...UInt8(ascii: "Z"), UInt8(ascii: "a")...UInt8(ascii: "z"), UInt8(ascii: "0")...UInt8(ascii: "9"),
                 UInt8(ascii: "-"), UInt8(ascii: "_"), UInt8(ascii: "."), UInt8(ascii: "!"), UInt8(ascii: "~"), UInt8(ascii: "*"),
                 UInt8(ascii: "'"), UInt8(ascii: "("), UInt8(ascii: ")"):
                out.append(Character(Unicode.Scalar(byte)))
            default: out += percent(byte)
            }
        }
        return out
    }

    private static func percent(_ byte: UInt8) -> String {
        let digits = Array("0123456789ABCDEF")
        return "%" + String(digits[Int(byte >> 4)]) + String(digits[Int(byte & 0x0F)])
    }
}

public struct XtreamAccountInfo: Sendable, Equatable {
    /// `user_info.auth == "1"`.
    public var authorized: Bool
    public var status: String?
    public var expires: Date?
    public var maxConnections: Int?
    public var activeConnections: Int?
    public init(authorized: Bool, status: String? = nil, expires: Date? = nil, maxConnections: Int? = nil, activeConnections: Int? = nil) {
        self.authorized = authorized; self.status = status; self.expires = expires; self.maxConnections = maxConnections
        self.activeConnections = activeConnections
    }

    /// "Connected · Active · expires Mar 4, 2027 · 1 connection" (parts that exist; en_US_POSIX "MMM d, yyyy").
    public var summary: String {
        var parts = [authorized ? "Connected" : "Not connected"]
        if let status = status?.trimmingCharacters(in: .whitespacesAndNewlines), !status.isEmpty {
            parts.append(status.prefix(1).uppercased() + status.dropFirst())
        }
        if let expires {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "MMM d, yyyy"
            parts.append("expires " + formatter.string(from: expires))
        }
        if let maxConnections, maxConnections > 0 {
            parts.append("\(maxConnections) connection" + (maxConnections == 1 ? "" : "s"))
        }
        return parts.joined(separator: " · ")
    }
}

/// Parsers take raw response bytes, so they are testable from fixtures. List parsers merge duplicates by id
/// (union of categoryIDs; country/language joined with ";"; adult = any), keep provider order; live also renumbers.
/// Provider ids are compared byte for byte, as the other apps compare them: category ids, and the stream, series and
/// episode ids in `Channel.key`, `Movie.id`, `Series.id` and `Episode.id`, are kept as `ExactText.key` forms ("123" as it
/// is), because Swift's `String` equality would take canonically equivalent ids ("\u{E9}" and "e\u{301}") as one.
/// `Channel.streamID` and `Series.seriesID` keep the provider's id for requests.
public enum XtreamParser {
    static let countryFields = ["country", "country_code", "country_name", "stream_country", "tvg-country"]
    static let languageFields = ["language", "lang", "original_language", "audio_language", "stream_language", "tvg-language"]
    private static let commonFields: Set<String> = Set(countryFields + languageFields + ["name", "category_id", "category_ids", "is_adult"])
    private static let liveFields = commonFields.union(["stream_id", "num", "stream_icon", "epg_channel_id", "direct_source"])
    private static let movieFields = commonFields.union(["stream_id", "stream_icon", "rating", "direct_source", "container_extension", "added",
                                                         "year", "releaseDate", "release_date", "releasedate", "tmdb", "tmdb_id", "info", "genre"])
    private static let seriesFields = commonFields.union(["series_id", "cover", "plot", "rating", "genre", "year", "releaseDate", "release_date",
                                                          "releasedate", "backdrop_path", "last_modified", "tmdb", "tmdb_id", "info"])

    public static func accountInfo(_ data: Data) throws -> XtreamAccountInfo {
        let root = try parse(data)
        guard case .object = root else {
            if case .array = root { return XtreamAccountInfo(authorized: false) }
            throw TunerError.invalidResponse
        }
        guard let user = root["user_info"] else { return XtreamAccountInfo(authorized: false) }
        let expires = user["exp_date"]?.double.flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0) : nil }
        return XtreamAccountInfo(authorized: user["auth"]?.text == "1", status: user["status"]?.text, expires: expires,
                                 maxConnections: user["max_connections"]?.int, activeConnections: user["active_cons"]?.int)
    }

    /// get_live_categories / get_vod_categories / get_series_categories. Default name "Other".
    public static func categories(_ data: Data) throws -> [Category] {
        var result: [Category] = []
        var seen = Set<String>()
        try forEachRow(data, fields: ["category_id", "category_name", "is_adult"]) { row in
            guard let id = row["category_id"]?.text.map(ExactText.key), seen.insert(id).inserted else { return }
            result.append(Category(id: id, name: row["category_name"]?.text ?? "Other", adult: AdultFilter.isAdultFlag(row["is_adult"]?.text)))
        }
        return result
    }

    public static func live(_ data: Data, login: XtreamLogin) throws -> [Channel] {
        var order: [String] = []
        var byID: [String: Channel] = [:]
        try forEachRow(data, fields: liveFields) { row in
            guard let streamID = row["stream_id"]?.text else { return }
            let id = ExactText.key(streamID)
            let categories = categoryIDs(row)
            if var previous = byID[id] {
                merge(&previous.categoryIDs, categories)
                previous.country = mergeMetadata(previous.country, metadata(row, countryFields))
                previous.language = mergeMetadata(previous.language, metadata(row, languageFields))
                previous.adult = previous.adult || AdultFilter.isAdultFlag(row["is_adult"]?.text)
                byID[id] = previous
                return
            }
            guard let url = Xtream.liveURL(login, streamID: streamID, directSource: row["direct_source"]?.text) else { return }
            byID[id] = Channel(key: "x:\(id)", number: row["num"]?.int ?? 0, name: row["name"]?.text ?? "Channel \(streamID)",
                               logo: webURL(row["stream_icon"]?.text), categoryID: categories.first ?? "", categoryIDs: categories,
                               epgID: row["epg_channel_id"]?.text, streamID: streamID, url: url, country: metadata(row, countryFields),
                               language: metadata(row, languageFields), adult: AdultFilter.isAdultFlag(row["is_adult"]?.text))
            order.append(id)
        }
        return Renumber.apply(order.compactMap { byID[$0] })
    }

    /// Reads the year (`yearOf`), the TMDB id (`tmdb`), `genre` and `added` (`unixSeconds`) when present.
    public static func movies(_ data: Data, login: XtreamLogin) throws -> [Movie] {
        var order: [String] = []
        var byID: [String: Movie] = [:]
        try forEachRow(data, fields: movieFields) { row in
            guard let streamID = row["stream_id"]?.text else { return }
            let id = ExactText.key(streamID)
            let categories = categoryIDs(row)
            if var previous = byID[id] {
                merge(&previous.categoryIDs, categories)
                previous.country = mergeMetadata(previous.country, metadata(row, countryFields))
                previous.language = mergeMetadata(previous.language, metadata(row, languageFields))
                previous.adult = previous.adult || AdultFilter.isAdultFlag(row["is_adult"]?.text)
                byID[id] = previous
                return
            }
            let ext = row["container_extension"]?.text
            guard let url = Xtream.movieURL(login, streamID: streamID, containerExtension: ext, directSource: row["direct_source"]?.text) else { return }
            let name = row["name"]?.text ?? "Movie"
            byID[id] = Movie(id: "m:\(id)", name: name, poster: webURL(row["stream_icon"]?.text), rating: ratingText(row["rating"]?.text),
                             categoryID: categories.first ?? "", categoryIDs: categories, url: url, added: unixSeconds(row["added"]),
                             containerExtension: ext?.lowercased(), year: yearOf(row, name: name), tmdbID: tmdb(row), genre: row["genre"]?.text,
                             country: metadata(row, countryFields), language: metadata(row, languageFields),
                             adult: AdultFilter.isAdultFlag(row["is_adult"]?.text))
            order.append(id)
        }
        return order.compactMap { byID[$0] }
    }

    /// Reads the year (`yearOf`) and the TMDB id (`tmdb`) when present; `last_modified` → `added` (`unixSeconds`).
    public static func series(_ data: Data) throws -> [Series] {
        var order: [String] = []
        var byID: [String: Series] = [:]
        try forEachRow(data, fields: seriesFields) { row in
            guard let seriesID = row["series_id"]?.text else { return }
            let id = ExactText.key(seriesID)
            let categories = categoryIDs(row)
            if var previous = byID[id] {
                merge(&previous.categoryIDs, categories)
                previous.country = mergeMetadata(previous.country, metadata(row, countryFields))
                previous.language = mergeMetadata(previous.language, metadata(row, languageFields))
                previous.adult = previous.adult || AdultFilter.isAdultFlag(row["is_adult"]?.text)
                byID[id] = previous
                return
            }
            let name = row["name"]?.text ?? "Series"
            byID[id] = Series(id: "s:\(id)", seriesID: seriesID, name: name, cover: webURL(row["cover"]?.text), plot: row["plot"]?.text,
                              rating: ratingText(row["rating"]?.text), genre: row["genre"]?.text, year: yearOf(row, name: name),
                              backdrop: webURL(row["backdrop_path"]?.text), added: unixSeconds(row["last_modified"]),
                              categoryID: categories.first ?? "", categoryIDs: categories, tmdbID: tmdb(row),
                              country: metadata(row, countryFields), language: metadata(row, languageFields),
                              adult: AdultFilter.isAdultFlag(row["is_adult"]?.text))
            order.append(id)
        }
        return order.compactMap { byID[$0] }
    }

    public static func movieInfo(_ data: Data) throws -> MovieInfo {
        let root = try parse(data)
        guard case .object = root else { throw TunerError.invalidResponse }
        let info = root["info"] ?? .object([:])
        let year = TitleNormalizer.year(field: info["releasedate"]?.text) ?? TitleNormalizer.year(field: info["release_date"]?.text)
            ?? TitleNormalizer.year(field: info["year"]?.text)
        let subtitles = unique(subtitles(info["subtitles"]) + subtitles(root["movie_data"]?["subtitles"]))
        return MovieInfo(plot: info["plot"]?.text ?? info["description"]?.text, cast: info["cast"]?.text ?? info["actors"]?.text,
                         director: info["director"]?.text, genre: info["genre"]?.text, year: year,
                         duration: info["duration"]?.text ?? info["duration_secs"]?.text, rating: ratingText(info["rating"]?.text),
                         backdrop: webURL(info["backdrop_path"]?.text), poster: webURL(info["movie_image"]?.text ?? info["cover_big"]?.text),
                         subtitles: subtitles)
    }

    public static func seriesInfo(_ data: Data, login: XtreamLogin) throws -> SeriesInfo {
        let root = try parse(data)
        guard case .object = root else { throw TunerError.invalidResponse }
        let info = root["info"] ?? .object([:])
        var seasons: [Int: [Episode]] = [:]
        func add(_ row: JSONValue, seasonHint: Int?) {
            guard case .object = row, let id = row["id"]?.text else { return }
            let details = row["info"] ?? .object([:])
            let season = row["season"]?.int ?? seasonHint ?? 1
            let number = row["episode_num"]?.int ?? 0
            let ext = row["container_extension"]?.text
            guard let url = Xtream.episodeURL(login, episodeID: id, containerExtension: ext, directSource: row["direct_source"]?.text) else { return }
            var duration = details["duration_secs"]?.int ?? 0
            if duration <= 0, let text = details["duration"]?.text { duration = parseClock(text) ?? 0 }
            let title = row["title"]?.text ?? "Episode \(number)"
            seasons[season, default: []].append(Episode(id: "e:\(ExactText.key(id))", season: season, number: number, title: title, plot: details["plot"]?.text,
                                                        image: webURL(details["movie_image"]?.text), durationSeconds: duration, url: url,
                                                        containerExtension: ext?.lowercased(),
                                                        subtitles: unique(subtitles(row["subtitles"]) + subtitles(details["subtitles"]))))
        }
        switch root["episodes"] {
        case .object(let members)?:
            for key in JSONValue.sortedKeys(members.keys) {
                for row in members[key]?.elements ?? [] { add(row, seasonHint: Int(key)) }
            }
        case .array(let items)?:
            for item in items {
                if case .array(let rows) = item { rows.forEach { add($0, seasonHint: nil) } } else { add(item, seasonHint: nil) }
            }
        default: break
        }
        var cleaned: [Int: [Episode]] = [:]
        for (season, episodes) in seasons {
            var seen = Set<String>()
            let unique = episodes.filter { seen.insert($0.id).inserted }
            cleaned[season] = unique.enumerated().sorted { a, b in
                a.element.number != b.element.number ? a.element.number < b.element.number : a.offset < b.offset
            }.map(\.element)
        }
        let year = TitleNormalizer.year(field: info["releaseDate"]?.text) ?? TitleNormalizer.year(field: info["release_date"]?.text)
            ?? TitleNormalizer.year(field: info["year"]?.text)
        return SeriesInfo(plot: info["plot"]?.text, cast: info["cast"]?.text, genre: info["genre"]?.text, year: year,
                          backdrop: webURL(info["backdrop_path"]?.text), seasons: cleaned)
    }

    /// get_short_epg: base64 title/description (raw text fallback), start/stop(end)_timestamp, end > start, sorted.
    public static func shortEPG(_ data: Data) throws -> [Program] {
        let root = try parse(data)
        var programs: [Program] = []
        for row in (root["epg_listings"] ?? .null).elements {
            guard let start = row["start_timestamp"]?.double,
                  let end = row["stop_timestamp"]?.double ?? row["end_timestamp"]?.double, end > start else { continue }
            programs.append(Program(start: Date(timeIntervalSince1970: start), end: Date(timeIntervalSince1970: end),
                                    title: base64Text(row["title"]?.text) ?? "", description: base64Text(row["description"]?.text)))
        }
        return programs.enumerated().sorted { a, b in
            a.element.start != b.element.start ? a.element.start < b.element.start : a.offset < b.offset
        }.map(\.element)
    }

    /// Sidecar subtitle entries: plain http strings or objects with url/file/path/src/link, language/lang/srclang,
    /// label/name/title. De-duplicated by URL.
    public static func subtitles(_ value: JSONValue?) -> [ExternalSubtitle] {
        guard let value else { return [] }
        let entries: [JSONValue]
        switch value {
        case .array(let items): entries = items
        case .string, .object: entries = [value]
        default: entries = []
        }
        var result: [ExternalSubtitle] = []
        for entry in entries {
            switch entry {
            case .string(let text):
                if let link = Xtream.httpLink(text), let url = Xtream.makeURL(link) { result.append(ExternalSubtitle(url: url)) }
            case .object:
                let link = ["url", "file", "path", "src", "link"].lazy.compactMap { entry[$0]?.text }.first
                guard let link = Xtream.httpLink(link), let url = Xtream.makeURL(link) else { continue }
                result.append(ExternalSubtitle(url: url, language: entry["language"]?.text ?? entry["lang"]?.text ?? entry["srclang"]?.text,
                                               label: entry["label"]?.text ?? entry["name"]?.text ?? entry["title"]?.text))
            default: continue
            }
        }
        return unique(result)
    }

    // MARK: helpers

    static func parse(_ data: Data) throws -> JSONValue {
        do { return try JSONValue.parse(data) } catch { throw TunerError.invalidResponse }
    }

    static func forEachRow(_ data: Data, fields: Set<String>, _ body: (JSONValue) -> Void) throws {
        var parser = JSONParser(data)
        do { try parser.forEachObject(fields: fields, body) } catch { throw TunerError.invalidResponse }
    }

    static func categoryIDs(_ row: JSONValue) -> [String] {
        var list: [String] = []
        if let id = row["category_id"]?.text { list.append(ExactText.key(id)) }
        if let extra = row["category_ids"] {
            let values: [JSONValue]
            if case .array(let items) = extra { values = items } else { values = [extra] }
            for value in values {
                guard var text = value.text else { continue }
                if let dot = text.firstIndex(of: ".") { text = String(text[..<dot]) }
                text = ExactText.key(text)
                if !text.isEmpty && !list.contains(text) { list.append(text) }
            }
        }
        return list
    }

    static func merge(_ list: inout [String], _ more: [String]) {
        for item in more where !list.contains(item) { list.append(item) }
    }

    static func metadata(_ row: JSONValue, _ keys: [String]) -> String? {
        var values: [String] = []
        for key in keys {
            guard let value = row[key] else { continue }
            let items: [JSONValue]
            if case .array(let list) = value { items = list } else { items = [value] }
            for item in items {
                guard let text = item.text, !values.contains(where: { ExactText.same($0, text) }) else { continue }
                values.append(text)
            }
        }
        return values.isEmpty ? nil : values.joined(separator: ";")
    }

    static func mergeMetadata(_ first: String?, _ second: String?) -> String? {
        guard let first else { return second }
        guard let second, !ExactText.same(first, second) else { return first }
        return first + ";" + second
    }

    static func webURL(_ text: String?) -> URL? {
        guard let link = Xtream.httpLink(text) else { return nil }
        return Xtream.makeURL(link)
    }

    static func ratingText(_ text: String?) -> String? {
        guard let text, text != "0", text != "0.0" else { return nil }
        return text
    }

    /// The year of a list row (docs/browse.md): the first of `year`, `releaseDate`, `release_date` and `releasedate`
    /// that starts with a year from 1800 to 2099 not followed by another digit, else the year in `name`.
    static func yearOf(_ row: JSONValue, name: String) -> String? {
        TitleNormalizer.year(fields: ["year", "releaseDate", "release_date", "releasedate"].map { row[$0]?.text }, name: name)
    }

    /// The first usable TMDB id of `tmdb`, `tmdb_id`, `info.tmdb_id` and `info.tmdb` (docs/browse.md Matching step 1; the
    /// last two only when `info` is an object): a string of 1 to 12 ASCII digits (a trailing ".0" allowed) or a whole
    /// number from 1 to 999999999999, not zero (`TitleNormalizer.tmdbID`). Any other value is skipped.
    static func tmdb(_ row: JSONValue) -> Int? {
        let info = row["info"]
        for value in [row["tmdb"], row["tmdb_id"], info?["tmdb_id"], info?["tmdb"]] {
            if let id = TitleNormalizer.tmdbID(value) { return id }
        }
        return nil
    }

    /// `added` / `last_modified`: Unix seconds; a value above 100000000000 is in milliseconds and is divided by 1000.
    static func unixSeconds(_ value: JSONValue?) -> Int64 {
        guard let seconds = value?.int else { return 0 }
        return Int64(seconds > 100_000_000_000 ? seconds / 1000 : seconds)
    }

    /// "01:45:00" / "45:00" → seconds.
    static func parseClock(_ text: String) -> Int? {
        let parts = text.split(separator: ":").map { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count >= 2, parts.allSatisfy({ $0 != nil }) else { return Int(text) }
        let values = parts.compactMap { $0 }
        return values.count == 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values[0] * 60 + values[1]
    }

    static func base64Text(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        var compact = text.filter { !$0.isWhitespace }
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_")
        if compact.allSatisfy({ allowed.contains($0) }) {
            compact = compact.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            while compact.count % 4 != 0 { compact += "=" }
            if let data = Data(base64Encoded: compact), let decoded = String(data: data, encoding: .utf8) {
                let trimmed = decoded.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) || $0 == "\n" || $0 == "\t" }) {
                    return trimmed.isEmpty ? nil : trimmed
                }
            }
        }
        return text
    }

    static func unique(_ subtitles: [ExternalSubtitle]) -> [ExternalSubtitle] {
        var seen = Set<URL>()
        return subtitles.filter { seen.insert($0.url).inserted }
    }
}

/// Keeps provider `num` (sorted) when >90% of items have num > 0 and >90% are distinct; otherwise 1...n in order.
public enum Renumber {
    public static func numbers(_ provided: [Int?]) -> [Int] {
        usesProviderNumbers(provided) ? provided.map { $0 ?? 0 } : provided.indices.map { $0 + 1 }
    }

    static func usesProviderNumbers(_ provided: [Int?]) -> Bool {
        guard !provided.isEmpty else { return false }
        let values = provided.map { $0 ?? 0 }
        let positive = values.filter { $0 > 0 }.count
        let distinct = Set(values).count
        return Double(positive) > Double(values.count) * 0.9 && Double(distinct) > Double(values.count) * 0.9
    }

    /// Channels numbered and, when the provider's numbers are kept, sorted by them (stable).
    static func apply(_ channels: [Channel]) -> [Channel] {
        let provided = channels.map { $0.number > 0 ? Optional($0.number) : nil }
        let numbers = Renumber.numbers(provided)
        var result = channels
        for i in result.indices { result[i].number = numbers[i] }
        guard usesProviderNumbers(provided) else { return result }
        return result.enumerated().sorted { a, b in
            a.element.number != b.element.number ? a.element.number < b.element.number : a.offset < b.offset
        }.map(\.element)
    }
}

public struct XtreamClient: Sendable {
    private let login: XtreamLogin
    private let http: any HTTPClient

    public init(login: XtreamLogin, http: any HTTPClient) {
        self.login = login
        self.http = http
    }

    private func get(_ action: String?, _ extra: [(String, String)] = []) async throws -> Data {
        guard let url = Xtream.apiURL(login, action: action, extra: extra) else { throw TunerError.invalidInput("Check the server address.") }
        do {
            return try await http.data(HTTPRequestSpec(url: url)).body
        } catch {
            throw TunerError.from(error)
        }
    }

    /// Throws `TunerError.loginFailed` when `auth` isn't "1"; maps transport errors with `TunerError.from`.
    public func accountInfo() async throws -> XtreamAccountInfo {
        let data: Data
        do { data = try await get(nil) } catch TunerError.serverStatus(let status) where status == 401 || status == 403 {
            throw TunerError.loginFailed
        }
        let info = try XtreamParser.accountInfo(data)
        guard info.authorized else { throw TunerError.loginFailed }
        return info
    }

    public func movieInfo(streamID: String) async throws -> MovieInfo {
        try XtreamParser.movieInfo(try await get("get_vod_info", [("vod_id", streamID)]))
    }

    public func seriesInfo(seriesID: String) async throws -> SeriesInfo {
        try XtreamParser.seriesInfo(try await get("get_series_info", [("series_id", seriesID)]), login: login)
    }

    public func shortEPG(streamID: String, limit: Int = 24) async throws -> [Program] {
        try XtreamParser.shortEPG(try await get("get_short_epg", [("stream_id", streamID), ("limit", String(limit))]))
    }
}

// MARK: - M3U

public struct M3UPlaylist: Sendable, Equatable {
    public var channels: [Channel]
    public var liveCategories: [Category]
    public var movies: [Movie]
    public var movieCategories: [Category]
    /// Built like Tizen: VOD entries with `series-name` + `season` + `episode` attributes, or a name like
    /// "Show S01E02", become series "ms:<hash(show)>" with episodes "me:<hash(url)>".
    public var series: [Series]
    public var seriesCategories: [Category]
    /// Series id → episodes (seasons are built by `CatalogService.seriesInfo`).
    public var episodes: [String: [Episode]]
    /// First value of url-tvg / x-tvg-url.
    public var guideURL: URL?
    public init(channels: [Channel] = [], liveCategories: [Category] = [], movies: [Movie] = [], movieCategories: [Category] = [],
                series: [Series] = [], seriesCategories: [Category] = [], episodes: [String: [Episode]] = [:], guideURL: URL? = nil) {
        self.channels = channels; self.liveCategories = liveCategories; self.movies = movies
        self.movieCategories = movieCategories; self.series = series; self.seriesCategories = seriesCategories
        self.episodes = episodes; self.guideURL = guideURL
    }
}

public enum M3UParser {
    /// "Show S01E02 Title": the show, season, episode and the rest. The show ends in a character that is not `\s`: with
    /// `(.*?)` the engine tried `\s+` again from every space of a run inside the name, so its time grew with the square
    /// of the run (about a second for 16,000 spaces, and from about 10,000 on ICU gave up and found no episode at all).
    /// The matches are otherwise the same, because a name is trimmed of every `\s` first (`nonBlank`,
    /// `BrowseText.trimField`): the show is never empty, and the shortest show before `\s+` never ends in a space.
    private static let episodeName = Pattern(#"^(.*?\S)\s+[Ss](\d{1,2})[ ._-]*[Ee](\d{1,3})\b(.*)$"#)

    /// Names and groups as docs/browse.md "M3U playlists" says, plus Tizen's playlist series. VOD = URL contains
    /// /movie/ or /series/, or ends in .mp4/.mkv/.avi (before any query). Category ids "live:g0", "movies:g0",
    /// "series:g0"... per kind; every playlist category has adult = false. Live channels renumbered (`Renumber`).
    public static func parse(_ data: Data) -> M3UPlaylist {
        var body = data
        if Gzip.isGzip(body), let plain = try? Gzip.decompress(body) { body = plain }
        let text = String(decoding: body, as: UTF8.self)

        var playlist = M3UPlaylist()
        // Category ids by the group's UTF-8 bytes: Swift's String equality takes canonically equivalent names
        // ("Caf\u{E9}" and "Cafe\u{301}") as one, which the other apps keep apart and the category rules read differently.
        var liveCategoryIDs: [[UInt8]: String] = [:]
        var movieCategoryIDs: [[UInt8]: String] = [:]
        var seriesCategoryIDs: [[UInt8]: String] = [:]
        var movieIndex: [String: Int] = [:]
        var seriesIndex: [String: Int] = [:]

        var attributes: [String: String] = [:]
        var title = ""
        var groupOverride: String?
        // Every URL line counts, the ones left out below too: "Channel N" names the entry's place in the playlist.
        var entry = 0

        func category(_ kind: String, _ name: String, _ ids: inout [[UInt8]: String], _ list: inout [Category]) -> String {
            let key = Array(name.utf8)
            if let id = ids[key] { return id }
            let id = "\(kind):g\(list.count)"
            ids[key] = id
            list.append(Category(id: id, name: name))
            return id
        }

        // Lines end with "\n", "\r\n" or "\r", and nothing else (not U+0085, U+2028 or U+2029). Split on Unicode
        // scalars: "\r\n" is one `Character`, so a split on the characters "\n" and "\r" finds no line end in a playlist
        // written with Windows line endings. The empty line between "\r" and "\n" is skipped like any empty line.
        for rawLine in text.unicodeScalars.split(omittingEmptySubsequences: true, whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            // Spaces and the Unicode spaces only (BrowseText.trimField, docs/browse.md "Trimming"), U+FEFF included, so
            // a byte order mark goes too: Foundation's `.whitespaces` also removes U+200B, which changes how a name reads.
            let line = BrowseText.trimField(String(rawLine))
            if line.isEmpty { continue }
            // Tags compared scalar by scalar (a combining mark after "#EXTGRP:" or "#" joins its `Character`), ignoring
            // the case of A to Z only: `uppercased()` reads "#EXT\u{0131}NF" (a dotless i) as "#EXTINF".
            func tag(_ name: String) -> Bool { startsWithTag(line.unicodeScalars, name) }
            if tag("#EXTM3U") {
                let header = read(line, stopsAtComma: false).attributes
                if let value = header["url-tvg"] ?? header["x-tvg-url"],
                   let first = value.split(separator: ",").first.map({ $0.trimmingCharacters(in: .whitespaces) }),
                   let link = Xtream.httpLink(first) {
                    playlist.guideURL = Xtream.makeURL(link)
                }
                continue
            }
            if tag("#EXTINF") {
                (attributes, title) = read(line)
                groupOverride = nil
                continue
            }
            if tag("#EXTGRP:") {
                groupOverride = BrowseText.trimField(String(line.unicodeScalars.dropFirst(8)))
                continue
            }
            if line.unicodeScalars.first == "#" { continue }
            entry += 1
            defer { attributes = [:]; title = ""; groupOverride = nil }
            guard let link = Xtream.httpLink(line), let url = Xtream.makeURL(link) else { continue }

            let name = nonBlank(title) ?? nonBlank(attributes["tvg-name"]) ?? "Channel \(entry)"
            let group = nonBlank(attributes["group-title"]) ?? nonBlank(groupOverride) ?? "Uncategorized"
            let logo = Xtream.httpLink(attributes["tvg-logo"]).flatMap(Xtream.makeURL)
            let country = nonBlank(attributes["tvg-country"]) ?? nonBlank(attributes["country"])
            let language = nonBlank(attributes["tvg-language"]) ?? nonBlank(attributes["language"])
            let path = String(link.split(separator: "?", maxSplits: 1).first ?? Substring(link)).lowercased()
            let isVOD = path.contains("/movie/") || path.contains("/series/") || path.hasSuffix(".mp4") || path.hasSuffix(".mkv") || path.hasSuffix(".avi")
            let urlHash = StableHash.base36(StableHash.fnv1a64(link))

            if isVOD {
                let ext = url.pathExtension.isEmpty ? nil : url.pathExtension.lowercased()
                let match = episodeName.groups(name)
                let season = Int(attributes["season"] ?? "") ?? match.flatMap { $0[1] }.flatMap { Int($0) } ?? 0
                let number = Int(attributes["episode"] ?? "") ?? match.flatMap { $0[2] }.flatMap { Int($0) } ?? 0
                let showName = nonBlank(attributes["series-name"]) ?? match.flatMap { $0[0] }.map { $0.trimmingCharacters(in: .whitespaces) }
                if season > 0, number > 0, let show = nonBlank(showName) {
                    let categoryID = category("series", group, &seriesCategoryIDs, &playlist.seriesCategories)
                    let showHash = StableHash.base36(StableHash.fnv1a64(show))
                    let seriesID = "ms:" + showHash
                    if let index = seriesIndex[seriesID] {
                        XtreamParser.merge(&playlist.series[index].categoryIDs, [categoryID])
                    } else {
                        seriesIndex[seriesID] = playlist.series.count
                        playlist.series.append(Series(id: seriesID, seriesID: showHash, name: show, cover: logo,
                                                      year: TitleNormalizer.year(in: show), categoryID: categoryID,
                                                      country: country, language: language))
                    }
                    var episodeTitle = match.flatMap { $0[3] }?.trimmingCharacters(in: CharacterSet(charactersIn: " -–:|.")) ?? ""
                    if episodeTitle.isEmpty { episodeTitle = attributes["series-name"] == nil ? "Episode \(number)" : name }
                    let episode = Episode(id: "me:" + urlHash, season: season, number: number, title: episodeTitle, image: logo, url: url,
                                          containerExtension: ext)
                    if !(playlist.episodes[seriesID]?.contains { $0.id == episode.id } ?? false) {
                        playlist.episodes[seriesID, default: []].append(episode)
                    }
                } else {
                    let categoryID = category("movies", group, &movieCategoryIDs, &playlist.movieCategories)
                    let id = "mu:" + urlHash
                    if let index = movieIndex[id] {
                        XtreamParser.merge(&playlist.movies[index].categoryIDs, [categoryID])
                    } else {
                        movieIndex[id] = playlist.movies.count
                        playlist.movies.append(Movie(id: id, name: name, poster: logo, categoryID: categoryID, url: url, containerExtension: ext,
                                                     year: TitleNormalizer.year(in: name), country: country, language: language))
                    }
                }
            } else {
                let categoryID = category("live", group, &liveCategoryIDs, &playlist.liveCategories)
                let index = playlist.channels.count + 1
                playlist.channels.append(Channel(key: "u:\(urlHash):\(index)", number: Int(attributes["tvg-chno"] ?? "") ?? 0, name: name, logo: logo,
                                                 categoryID: categoryID, epgID: nonBlank(attributes["tvg-id"]) ?? nonBlank(attributes["tvg-name"]),
                                                 url: url, country: country, language: language))
            }
        }
        playlist.channels = Renumber.apply(playlist.channels)
        return playlist
    }

    private static func nonBlank(_ text: String?) -> String? {
        guard let trimmed = text.map(BrowseText.trimField), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    /// `line` starts with `tag`, the ASCII letters compared without case and every other scalar exactly.
    static func startsWithTag(_ line: String.UnicodeScalarView, _ tag: String) -> Bool {
        func upper(_ c: Unicode.Scalar) -> UInt32 { c >= "a" && c <= "z" ? c.value - 0x20 : c.value }
        var scalars = line.makeIterator()
        for wanted in tag.unicodeScalars {
            guard let c = scalars.next(), upper(c) == upper(wanted) else { return false }
        }
        return true
    }

    /// An `#EXTINF` line read once from its start, scalar by scalar (docs/browse.md "M3U playlists", Values and title):
    /// - A key is a run of ASCII letters, digits, "_" and "-", taken whole. When "=" follows it (spaces U+0020 around
    ///   the "=" allowed), then `"` or `'`, and the same quote comes again later on the line, the text between the
    ///   quotes is the key's value and reading goes on after the closing quote; otherwise it goes on after the key.
    /// - The first "," reached is the name comma: the rest of the line, trimmed as a provider field, is the title, and
    ///   nothing after it is a value. No name comma: the title is "".
    /// - Any other scalar is passed over, a quote that starts no value too.
    /// Keys are ASCII-lowercased and a key given twice keeps its first value; a comma or the other quote inside a value
    /// is part of it. With `stopsAtComma` false (the `#EXTM3U` header, which has no title) a comma is passed over too.
    /// Time grows with the line: a value's closing quote is looked for once per quote kind at most when it is missing
    /// (no quote of that kind comes after it, so no later value can open with it).
    static func read(_ line: String, stopsAtComma: Bool = true) -> (attributes: [String: String], title: String) {
        let scalars = Array(line.unicodeScalars)
        let n = scalars.count
        var attributes: [String: String] = [:]
        func isKey(_ c: Unicode.Scalar) -> Bool {
            (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "_" || c == "-"
        }
        func text(_ range: Range<Int>) -> String {
            var view = String.UnicodeScalarView()
            view.append(contentsOf: scalars[range])
            return String(view)
        }
        var i = 0
        while i < n {
            let c = scalars[i]
            if c == ",", stopsAtComma { return (attributes, BrowseText.trimField(text(i + 1..<n))) }
            guard isKey(c) else { i += 1; continue }
            var keyEnd = i
            while keyEnd < n && isKey(scalars[keyEnd]) { keyEnd += 1 }
            var j = keyEnd
            while j < n && scalars[j] == " " { j += 1 }
            if j < n && scalars[j] == "=" {
                j += 1
                while j < n && scalars[j] == " " { j += 1 }
                if j < n && (scalars[j] == "\"" || scalars[j] == "'") {
                    let quote = scalars[j]
                    var close = j + 1
                    while close < n && scalars[close] != quote { close += 1 }
                    if close < n {
                        let key = BrowseText.asciiLowercased(text(i..<keyEnd))
                        if attributes[key] == nil { attributes[key] = text(j + 1..<close) }
                        i = close + 1
                        continue
                    }
                }
            }
            i = keyEnd
        }
        return (attributes, "")
    }
}
