import Foundation

// docs/extras.md: English subtitles from OpenSubtitles.com and title trailers, both through lumanest.tv, and the hidden
// "Most watched now" live category. The app never calls OpenSubtitles, TMDB or YouTube's servers itself.

// MARK: - Hidden live category

/// docs/extras.md "Hidden live category": ASCII letters lower-cased, every character that is not an ASCII letter or
/// digit separates words (spaces of any kind, punctuation, emoji, letters beyond ASCII), one leading and then one
/// trailing word `us`, `usa` or `en` dropped, and the words left are exactly "most watched now" or "most watched".
/// A loop over the Unicode scalars, no regular expression: a combining mark after a letter is a separator too.
public func isHiddenLiveCategory(_ name: String) -> Bool {
    var words: [String] = []
    var word = String.UnicodeScalarView()
    for scalar in name.unicodeScalars {
        switch scalar.value {
        case 0x41...0x5A: word.append(Unicode.Scalar(scalar.value + 0x20)!)
        case 0x61...0x7A, 0x30...0x39: word.append(scalar)
        default:
            if !word.isEmpty { words.append(String(word)) }
            word = String.UnicodeScalarView()
        }
        // No hidden name has more than five words ("us most watched now en").
        if words.count > 5 { return false }
    }
    if !word.isEmpty { words.append(String(word)) }
    let tags: Set<String> = ["us", "usa", "en"]
    if let first = words.first, tags.contains(first) { words.removeFirst() }
    if let last = words.last, tags.contains(last) { words.removeLast() }
    return words == ["most", "watched", "now"] || words == ["most", "watched"]
}

/// Removes hidden live categories (docs/extras.md): the category leaves the list, its id leaves each channel's
/// categories, and a channel whose categories were all hidden is dropped (it copies a channel of another category).
/// A channel without any category is unaffected. Live categories only: movies and series never come here.
public enum HiddenLiveCategories {
    /// Nil when no category is hidden (nothing to change).
    static func filter(_ channels: [Channel], categories: [Category]) -> (channels: [Channel], categories: [Category])? {
        let hidden = Set(categories.filter { isHiddenLiveCategory($0.name) }.map(\.id))
        guard !hidden.isEmpty else { return nil }
        var kept: [Channel] = []
        kept.reserveCapacity(channels.count)
        for var channel in channels {
            let ids = channel.categoryIDs.filter { !$0.isEmpty }
            let remaining = ids.filter { !hidden.contains($0) }
            if remaining.count != ids.count {
                if remaining.isEmpty { continue }
                channel.categoryIDs = remaining
                if hidden.contains(channel.categoryID) || channel.categoryID.isEmpty { channel.categoryID = remaining[0] }
            }
            kept.append(channel)
        }
        return (kept, categories.filter { !hidden.contains($0.id) })
    }

    /// A lineup restored from a snapshot saved before this rule existed, filtered the same way (a fresh download is
    /// filtered before the lineup is built, in `CatalogService.parseLive`).
    public static func lineup(_ lineup: LiveLineup) -> LiveLineup {
        guard let filtered = filter(lineup.channels, categories: lineup.categories) else { return lineup }
        var copy = lineup
        copy.channels = filtered.channels
        copy.categories = filtered.categories
        return copy
    }
}

// MARK: - Reading WebVTT

public struct WebVTTCue: Sendable, Hashable {
    /// Milliseconds.
    public var start: Int
    public var end: Int
    /// Plain text: tags removed, the six entities decoded once, lines joined with "\n".
    public var text: String
    public init(start: Int, end: Int, text: String) { self.start = start; self.end = end; self.text = text }
}

/// docs/extras.md "Reading WebVTT": a strict reader for the OpenSubtitles files lumanest.tv converts (the provider's own
/// subtitle files keep going through `SubtitleParser`, whose overlap rule differs). Works on the UTF-8 bytes, so a
/// combining mark never hides a `-->` or a `>`, and CR LF is two line ends' worth of one break, as in the other apps.
public struct WebVTT: Sendable, Hashable {
    /// Sorted by start; equal starts keep file order.
    public let cues: [WebVTTCue]
    /// `maxEnd[i]` is the latest end among `cues[0...i]`: `text(at:)` stops looking back once no earlier cue can still run.
    private let maxEnd: [Int]

    public init(cues: [WebVTTCue]) {
        let sorted = cues.enumerated().sorted { $0.element.start != $1.element.start ? $0.element.start < $1.element.start : $0.offset < $1.offset }
            .map(\.element)
        self.cues = sorted
        var latest = Int.min
        maxEnd = sorted.map { cue in
            latest = max(latest, cue.end)
            return latest
        }
    }

    public init(parsing text: String) { self.init(cues: WebVTT.parse(text)) }

    /// UTF-8, invalid bytes replaced (never fails).
    public init(data: Data) { self.init(parsing: String(decoding: data, as: UTF8.self)) }

    public var isEmpty: Bool { cues.isEmpty }

    /// The text of every cue with `start <= ms < end`, in order, joined with "\n"; "" when none.
    public func text(atMilliseconds ms: Int) -> String {
        // The last cue that started at or before `ms`.
        var low = 0, high = cues.count - 1, found = -1
        while low <= high {
            let mid = (low + high) / 2
            if cues[mid].start <= ms { found = mid; low = mid + 1 } else { high = mid - 1 }
        }
        var shown: [String] = []
        var index = found
        while index >= 0 && maxEnd[index] > ms {
            if cues[index].end > ms { shown.append(cues[index].text) }
            index -= 1
        }
        return shown.reversed().joined(separator: "\n")
    }

    /// The player's position in seconds, rounded to whole milliseconds.
    public func text(at seconds: Double) -> String {
        guard seconds.isFinite else { return "" }
        let ms = (seconds * 1000).rounded()
        guard ms > -9e15 && ms < 9e15 else { return "" }
        return text(atMilliseconds: Int(ms))
    }

    /// The cues of a WebVTT text, in file order (`init` sorts them).
    public static func parse(_ text: String) -> [WebVTTCue] {
        var bytes = Array(text.utf8)
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes.removeFirst(3) }
        let lines = splitLines(bytes)
        guard let header = lines.first, isHeader(header) else { return [] }
        var cues: [WebVTTCue] = []
        var block: [ArraySlice<UInt8>] = []
        func finish() {
            if let cue = cue(block) { cues.append(cue) }
            block = []
        }
        for line in lines.dropFirst() {
            if line.isEmpty {
                if !block.isEmpty { finish() }
            } else {
                block.append(line)
            }
        }
        if !block.isEmpty { finish() }
        return cues
    }

    private static let space = UInt8(ascii: " "), tab = UInt8(ascii: "\t")

    /// Split at CR LF, CR and LF.
    static func splitLines(_ bytes: [UInt8]) -> [ArraySlice<UInt8>] {
        var lines: [ArraySlice<UInt8>] = []
        var start = 0
        var index = 0
        while index < bytes.count {
            let byte = bytes[index]
            if byte == 0x0A || byte == 0x0D {
                lines.append(bytes[start..<index])
                if byte == 0x0D && index + 1 < bytes.count && bytes[index + 1] == 0x0A { index += 1 }
                start = index + 1
            }
            index += 1
        }
        lines.append(bytes[start..<bytes.count])
        return lines
    }

    /// `WEBVTT` alone, or followed by a space or tab and anything.
    private static func isHeader(_ line: ArraySlice<UInt8>) -> Bool {
        let magic = Array("WEBVTT".utf8)
        guard line.starts(with: magic) else { return false }
        let rest = line.dropFirst(magic.count)
        return rest.isEmpty || rest.first == space || rest.first == tab
    }

    private static func contains(_ line: ArraySlice<UInt8>, _ needle: [UInt8]) -> Bool {
        guard line.count >= needle.count else { return false }
        var index = line.startIndex
        while index + needle.count <= line.endIndex {
            if line[index..<(index + needle.count)].elementsEqual(needle) { return true }
            index += 1
        }
        return false
    }

    /// One block: the timing line is its first or second line holding `-->`; a block without one is skipped.
    private static func cue(_ block: [ArraySlice<UInt8>]) -> WebVTTCue? {
        let arrow = Array("-->".utf8)
        guard let timingIndex = block.prefix(2).firstIndex(where: { contains($0, arrow) }),
              let (start, end) = timing(block[timingIndex]), end > start else { return nil }
        var lines: [String] = []
        for line in block[(timingIndex + 1)...] {
            let plain = trimSpaces(decodeEntities(removeTags(line)))
            if !plain.isEmpty { lines.append(String(decoding: plain, as: UTF8.self)) }
        }
        guard !lines.isEmpty else { return nil }
        return WebVTTCue(start: start, end: end, text: lines.joined(separator: "\n"))
    }

    /// `^(STAMP)[ \t]+-->[ \t]+(STAMP)(?:[ \t].*)?$` with STAMP `(?:[0-9]{2,}:)?[0-9]{2}:[0-9]{2}\.[0-9]{3}`, minutes and
    /// seconds 59 or less. Milliseconds, or nil.
    static func timing(_ line: ArraySlice<UInt8>) -> (Int, Int)? {
        var index = line.startIndex
        guard let start = stamp(line, &index) else { return nil }
        let blanks = index
        while index < line.endIndex && (line[index] == space || line[index] == tab) { index += 1 }
        guard index > blanks, line[index...].starts(with: Array("-->".utf8)) else { return nil }
        index += 3
        let afterArrow = index
        while index < line.endIndex && (line[index] == space || line[index] == tab) { index += 1 }
        guard index > afterArrow, let end = stamp(line, &index) else { return nil }
        guard index == line.endIndex || line[index] == space || line[index] == tab else { return nil }
        return (start, end)
    }

    /// One stamp at `index` (moved past it): `HH+:MM:SS.mmm` or `MM:SS.mmm`.
    private static func stamp(_ line: ArraySlice<UInt8>, _ index: inout Int) -> Int? {
        func digits() -> ArraySlice<UInt8> {
            let from = index
            while index < line.endIndex && line[index] >= 0x30 && line[index] <= 0x39 { index += 1 }
            return line[from..<index]
        }
        func expect(_ character: Unicode.Scalar) -> Bool {
            guard index < line.endIndex, line[index] == UInt8(ascii: character) else { return false }
            index += 1
            return true
        }
        func value(_ run: ArraySlice<UInt8>) -> Int? {
            var result = 0
            for digit in run {
                let (times, overflow) = result.multipliedReportingOverflow(by: 10)
                let (sum, overflow2) = times.addingReportingOverflow(Int(digit - 0x30))
                guard !overflow, !overflow2 else { return nil }
                result = sum
            }
            return result
        }
        let first = digits()
        guard first.count >= 2, expect(":") else { return nil }
        let second = digits()
        var hours = 0
        let minutes: Int, seconds: Int
        if index < line.endIndex && line[index] == UInt8(ascii: ":") {
            // `first` was the hours.
            index += 1
            let third = digits()
            guard second.count == 2, third.count == 2, let h = value(first), let m = value(second), let s = value(third) else { return nil }
            hours = h; minutes = m; seconds = s
        } else {
            guard first.count == 2, second.count == 2, let m = value(first), let s = value(second) else { return nil }
            minutes = m; seconds = s
        }
        guard expect(".") else { return nil }
        let fraction = digits()
        guard fraction.count == 3, let ms = value(fraction), minutes <= 59, seconds <= 59 else { return nil }
        let (hourMs, overflow) = hours.multipliedReportingOverflow(by: 3_600_000)
        guard !overflow else { return nil }
        let (total, overflow2) = hourMs.addingReportingOverflow(minutes * 60_000 + seconds * 1000 + ms)
        return overflow2 ? nil : total
    }

    /// Every `<[^>]*>` removed; a `<` with no `>` after it stays.
    static func removeTags(_ line: ArraySlice<UInt8>) -> [UInt8] {
        var result: [UInt8] = []
        result.reserveCapacity(line.count)
        var index = line.startIndex
        while index < line.endIndex {
            if line[index] == UInt8(ascii: "<"), let close = line[(index + 1)...].firstIndex(of: UInt8(ascii: ">")) {
                index = close + 1
                continue
            }
            result.append(line[index])
            index += 1
        }
        return result
    }

    private static let entities: [([UInt8], UInt8)] = [
        (Array("&amp;".utf8), UInt8(ascii: "&")), (Array("&lt;".utf8), UInt8(ascii: "<")), (Array("&gt;".utf8), UInt8(ascii: ">")),
        (Array("&nbsp;".utf8), UInt8(ascii: " ")), (Array("&quot;".utf8), UInt8(ascii: "\"")), (Array("&apos;".utf8), UInt8(ascii: "'")),
    ]

    /// `&amp;` `&lt;` `&gt;` `&nbsp;` `&quot;` `&apos;` decoded once, left to right (`&amp;lt;` is the text `&lt;`).
    static func decodeEntities(_ line: [UInt8]) -> [UInt8] {
        guard line.contains(UInt8(ascii: "&")) else { return line }
        var result: [UInt8] = []
        result.reserveCapacity(line.count)
        var index = 0
        outer: while index < line.count {
            if line[index] == UInt8(ascii: "&") {
                for (entity, character) in entities where line[index...].starts(with: entity) {
                    result.append(character)
                    index += entity.count
                    continue outer
                }
            }
            result.append(line[index])
            index += 1
        }
        return result
    }

    /// Spaces and tabs removed from both ends.
    private static func trimSpaces(_ line: [UInt8]) -> ArraySlice<UInt8> {
        guard let first = line.firstIndex(where: { $0 != space && $0 != tab }) else { return [] }
        let last = line.lastIndex(where: { $0 != space && $0 != tab })!
        return line[first...last]
    }
}

// MARK: - What the app asks for

/// docs/extras.md "Which ids an app sends": a TMDB id, or the provider's name with a year.
public enum ExtrasTitle: Sendable, Hashable {
    case tmdb(Int)
    case name(String, year: String)

    /// The provider TMDB id, else the TMDB id of the rows item the title matched, else the provider's name (trimmed as a
    /// provider field, 1 to 300 UTF-16 code units) with its year (1800 to 2099). Nil when there is nothing to send.
    public static func of(tmdbID: Int?, match: RowsItem?, name: String, year: String?) -> ExtrasTitle? {
        if let id = tmdbID, isTMDBID(id) { return .tmdb(id) }
        if let id = match?.id, isTMDBID(id) { return .tmdb(id) }
        let trimmed = BrowseText.trimField(name)
        guard !trimmed.isEmpty, trimmed.utf16.count <= 300,
              let year = TitleNormalizer.year(field: year) ?? TitleNormalizer.year(in: name), isYear(year) else { return nil }
        return .name(trimmed, year: year)
    }

    static func isTMDBID(_ id: Int) -> Bool { id >= 1 && id <= 999_999_999_999 }

    static func isYear(_ text: String) -> Bool {
        let bytes = Array(text.utf8)
        guard bytes.count == 4, bytes.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }), let value = Int(text) else { return false }
        return (1800...2099).contains(value)
    }

    /// `tmdb=603`, or `name=...&year=1999` (with `middle`, the season and episode, between them in the spec's order).
    fileprivate func query(middle: [(String, String)]) -> [(String, String)] {
        switch self {
        case .tmdb(let id): return [("tmdb", String(id))] + middle
        case .name(let name, let year): return middle + [("name", name), ("year", year)]
        }
    }
}

/// `GET /api/extras/subtitles`: a movie, or one episode of a series (the series' TMDB id or name and year).
public struct SubtitleQuery: Sendable, Hashable {
    public enum Kind: Sendable, Hashable {
        case movie
        case episode(season: Int, episode: Int)
    }

    public var kind: Kind
    public var title: ExtrasTitle

    public init(kind: Kind, title: ExtrasTitle) { self.kind = kind; self.title = title }

    public static func movie(_ movie: Movie, match: RowsItem?) -> SubtitleQuery? {
        ExtrasTitle.of(tmdbID: movie.tmdbID, match: match, name: movie.name, year: movie.year).map { SubtitleQuery(kind: .movie, title: $0) }
    }

    /// The series' TMDB id (an episode's own id is never sent), season 0 to 9999 and episode 1 to 9999; nil without them.
    public static func episode(_ episode: Episode, of series: Series, match: RowsItem?) -> SubtitleQuery? {
        guard (0...9999).contains(episode.season), (1...9999).contains(episode.number),
              let title = ExtrasTitle.of(tmdbID: series.tmdbID, match: match, name: series.name, year: series.year) else { return nil }
        return SubtitleQuery(kind: .episode(season: episode.season, episode: episode.number), title: title)
    }

    /// `subtitles?v=1&type=...`, parameters in the order of docs/extras.md.
    public func url(base: URL = TunerLinks.extrasAPI) -> URL? {
        let parameters: [(String, String)]
        switch kind {
        case .movie: parameters = [("type", "movie")] + title.query(middle: [])
        case .episode(let season, let episode):
            parameters = [("type", "episode")] + title.query(middle: [("season", String(season)), ("episode", String(episode))])
        }
        return ExtrasQueryText.url(base, "subtitles", parameters)
    }
}

/// `GET /api/extras/trailer`: a movie (`type=movie`) or a series (`type=tv`).
public struct TrailerQuery: Sendable, Hashable {
    public var kind: TitleKind
    public var title: ExtrasTitle

    public init(kind: TitleKind, title: ExtrasTitle) { self.kind = kind; self.title = title }

    public static func movie(_ movie: Movie, match: RowsItem?) -> TrailerQuery? {
        ExtrasTitle.of(tmdbID: movie.tmdbID, match: match, name: movie.name, year: movie.year).map { TrailerQuery(kind: .movie, title: $0) }
    }

    public static func series(_ series: Series, match: RowsItem?) -> TrailerQuery? {
        ExtrasTitle.of(tmdbID: series.tmdbID, match: match, name: series.name, year: series.year).map { TrailerQuery(kind: .series, title: $0) }
    }

    public func url(base: URL = TunerLinks.extrasAPI) -> URL? {
        ExtrasQueryText.url(base, "trailer", [("type", kind == .movie ? "movie" : "tv")] + title.query(middle: []))
    }
}

enum ExtrasQueryText {
    /// UTF-8 percent-encoding of everything but `A-Z a-z 0-9 - . _ ~` (a `+` must not read as a space at the server).
    static func encode(_ value: String) -> String {
        var result = ""
        for byte in value.utf8 {
            switch byte {
            case 0x41...0x5A, 0x61...0x7A, 0x30...0x39, UInt8(ascii: "-"), UInt8(ascii: "."), UInt8(ascii: "_"), UInt8(ascii: "~"):
                result.append(Character(Unicode.Scalar(byte)))
            default:
                let hex = Array("0123456789ABCDEF".utf8)
                result.append("%")
                result.append(Character(Unicode.Scalar(hex[Int(byte >> 4)])))
                result.append(Character(Unicode.Scalar(hex[Int(byte & 0x0F)])))
            }
        }
        return result
    }

    static func url(_ base: URL, _ path: String, _ parameters: [(String, String)]) -> URL? {
        let query = ([("v", "1")] + parameters).map { "\($0.0)=\(encode($0.1))" }.joined(separator: "&")
        return URL(string: base.absoluteString + path + "?" + query)
    }

    /// `https://lumanest.tv/` for any URL on that origin.
    static func origin(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else { return nil }
        return scheme + "://" + host + (url.port.map { ":\($0)" } ?? "") + "/"
    }

    /// One line of plain text from the server (a label or a video name): controls and line breaks become spaces, runs of
    /// spaces one, at most `limit` characters. Shown in text views only.
    static func plainLine(_ value: String, limit: Int) -> String {
        var scalars = String.UnicodeScalarView()
        var lastWasSpace = true
        for scalar in value.unicodeScalars {
            let v = scalar.value
            let isSpace = v < 0x20 || (v >= 0x7F && v <= 0x9F) || v == 0x20 || BrowseText.isUnicodeSpace(scalar)
                || v == 0x200B || v == 0x200E || v == 0x200F || (0x202A...0x202E).contains(v) || (0x2066...0x2069).contains(v)
            if isSpace {
                if !lastWasSpace { scalars.append(" ") }
                lastWasSpace = true
            } else {
                scalars.append(scalar)
                lastWasSpace = false
            }
        }
        var text = String(scalars)
        if text.hasSuffix(" ") { text.removeLast() }
        return text.count > limit ? String(text.prefix(limit)) : text
    }
}

// MARK: - Answers

/// One OpenSubtitles track a lookup offered.
public struct SubtitleTrack: Sendable, Hashable, Identifiable {
    /// The server's file token.
    public var id: String
    /// "English (OpenSubtitles)", "English SDH (OpenSubtitles 2)"…: shown as it is, as plain text.
    public var label: String
    public var hearingImpaired: Bool
    /// The WebVTT file, on the origin the lookup was sent to.
    public var vtt: URL
    public init(id: String, label: String, hearingImpaired: Bool, vtt: URL) {
        self.id = id; self.label = label; self.hearingImpaired = hearingImpaired; self.vtt = vtt
    }
}

/// A subtitles lookup: at most 3 tracks, best first. Any other answer (a failure, `none`, `not_configured`…) has none.
public struct SubtitleLookup: Sendable, Hashable {
    public var tracks: [SubtitleTrack]
    /// "Subtitles provided by OpenSubtitles.com", shown under the tracks in the subtitle menu.
    public var credit: String
    public init(tracks: [SubtitleTrack] = [], credit: String = TunerLinks.openSubtitlesCredit) { self.tracks = tracks; self.credit = credit }
    public static let empty = SubtitleLookup()

    /// A 200 answer's body. Tracks need a string `id`, and a `vtt` URL that starts with `origin` (the address the lookup
    /// went to): anything else is left out. Nil when the body isn't a v1 answer.
    public static func parse(_ body: Data, origin: String) -> SubtitleLookup? {
        guard let root = try? JSONValue.parse(body), case .object = root, ExtrasAnswer.isVersion1(root) else { return nil }
        var tracks: [SubtitleTrack] = []
        var seen = Set<String>()
        for entry in root["tracks"]?.arrayElements ?? [] where tracks.count < 3 {
            guard case .string(let id)? = entry["id"], !id.isEmpty, id.utf8.count <= 64, seen.insert(id).inserted,
                  case .string(let link)? = entry["vtt"], link.hasPrefix(origin), let url = URL(string: link),
                  ExtrasQueryText.origin(url) == origin else { continue }
            var label = ""
            if case .string(let text)? = entry["label"] { label = ExtrasQueryText.plainLine(text, limit: 80) }
            if label.isEmpty { label = tracks.isEmpty ? "English (OpenSubtitles)" : "English (OpenSubtitles \(tracks.count + 1))" }
            let hearingImpaired: Bool
            if case .bool(true)? = entry["hi"] { hearingImpaired = true } else { hearingImpaired = false }
            tracks.append(SubtitleTrack(id: id, label: label, hearingImpaired: hearingImpaired, vtt: url))
        }
        var credit = TunerLinks.openSubtitlesCredit
        if case .string(let text)? = root["credit"] {
            let line = ExtrasQueryText.plainLine(text, limit: 120)
            if !line.isEmpty { credit = line }
        }
        return SubtitleLookup(tracks: tracks, credit: credit)
    }
}

/// A title's trailer on YouTube. The key is checked again here: every link is built from it, never taken from the answer.
public struct Trailer: Sendable, Hashable {
    /// The 11-character YouTube video id.
    public var key: String
    /// TMDB's video name, one plain line ("Official Trailer").
    public var name: String
    /// The server's QR modules of `https://youtu.be/<key>` ("0"/"1" rows), a fallback for the device's own encoder.
    public var qr: [String]

    public init?(key: String, name: String = "Trailer", qr: [String] = []) {
        guard Trailer.isYouTubeKey(key) else { return nil }
        self.key = key
        self.name = name
        self.qr = qr
    }

    /// The YouTube app on Apple TV (`youtube://watch/<key>`).
    public var appURL: URL { URL(string: "youtube://watch/" + key)! }
    /// What the QR code holds.
    public var phoneURL: URL { URL(string: "https://youtu.be/" + key)! }
    /// The text under the QR code.
    public var shortLink: String { "youtu.be/" + key }
    public var watchURL: URL { URL(string: "https://www.youtube.com/watch?v=" + key)! }

    /// `^[A-Za-z0-9_-]{11}$`.
    public static func isYouTubeKey(_ key: String) -> Bool {
        let bytes = Array(key.utf8)
        return bytes.count == 11 && bytes.allSatisfy { byte in
            (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte) || (0x30...0x39).contains(byte)
                || byte == UInt8(ascii: "_") || byte == UInt8(ascii: "-")
        }
    }

    /// A 200 answer's body: the trailer when `status` is `ok` and its key is valid; `.some(nil)` for an answer without
    /// one; nil when the body isn't a v1 answer.
    public static func parse(_ body: Data) -> Trailer?? {
        guard let root = try? JSONValue.parse(body), case .object = root, ExtrasAnswer.isVersion1(root) else { return nil }
        guard case .string("ok")? = root["status"], let trailer = root["trailer"], case .object = trailer,
              case .string(let key)? = trailer["key"] else { return .some(nil) }
        var name = ""
        if case .string(let text)? = trailer["name"] { name = ExtrasQueryText.plainLine(text, limit: 100) }
        let rows = (trailer["qr"]?.arrayElements ?? []).compactMap { row -> String? in
            if case .string(let text) = row { return text }
            return nil
        }
        return .some(Trailer(key: key, name: name.isEmpty ? "Trailer" : name, qr: QRMatrix(rows: rows) == nil ? [] : rows))
    }
}

enum ExtrasAnswer {
    /// `"v": 1`, or no `v`.
    static func isVersion1(_ root: JSONValue) -> Bool {
        switch root["v"] {
        case nil: return true
        case .number(let value)?: return value == 1
        default: return false
        }
    }
}

extension JSONValue {
    /// The elements of an array only (`elements` also reads objects).
    var arrayElements: [JSONValue]? {
        if case .array(let values) = self { return values }
        return nil
    }
}

// MARK: - The service

/// Lookups and subtitle files from lumanest.tv (docs/extras.md "Apps"):
/// - Lookups time out after 10 s and are kept in memory for the session (at most 200 answers, any status). A failure
///   (any non-200 answer, a timeout, unreadable JSON) is "nothing" and isn't kept, so the next title or the viewer's
///   next choice asks again; there are no retries of its own. Identical lookups in flight share one request.
/// - Subtitle files are requested only when shown (the caller decides) and time out after 20 s. Files that read as at
///   least one cue are kept in `cacheDirectory` for 7 days, at most 20 of them. A file's age is in its name
///   (`<hash>-<unix seconds>.vtt`): no file-timestamp API is used.
/// Requests carry no login and nothing about the viewer: the TMDB id (or name and year), season and episode only.
public actor ExtrasService {
    public static let lookupTimeout: TimeInterval = 10
    public static let fileTimeout: TimeInterval = 20
    public static let maxAnswers = 200
    public static let maxFiles = 20
    public static let fileMaxAge: TimeInterval = 7 * 24 * 3600
    /// More than any converted subtitle file (the server reads at most 2 MB of SRT).
    static let maxFileBytes = 8 * 1024 * 1024

    private enum Answer: Sendable {
        case subtitles(SubtitleLookup)
        case trailer(Trailer?)
    }

    private let http: any HTTPClient
    private let base: URL
    private let cacheDirectory: URL?
    private let now: @Sendable () -> Date
    private var answers: [URL: Answer] = [:]
    private var answerOrder: [URL] = []
    private var inFlight: [URL: Task<Answer?, Never>] = [:]

    public init(http: any HTTPClient, base: URL = TunerLinks.extrasAPI, cacheDirectory: URL?,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http
        self.base = base
        self.cacheDirectory = cacheDirectory
        self.now = now
    }

    /// Never throws: anything but a usable answer is `.empty`.
    public func subtitles(_ query: SubtitleQuery) async -> SubtitleLookup {
        guard let url = query.url(base: base), let origin = ExtrasQueryText.origin(base) else { return .empty }
        if case .subtitles(let lookup)? = await answer(url, parse: { body in SubtitleLookup.parse(body, origin: origin).map(Answer.subtitles) }) {
            return lookup
        }
        return .empty
    }

    /// Nil on any failure and for any answer without a trailer.
    public func trailer(_ query: TrailerQuery) async -> Trailer? {
        guard let url = query.url(base: base) else { return nil }
        if case .trailer(let trailer)? = await answer(url, parse: { body in Trailer.parse(body).map(Answer.trailer) }) {
            return trailer
        }
        return nil
    }

    private func answer(_ url: URL, parse: @escaping @Sendable (Data) -> Answer?) async -> Answer? {
        if let kept = answers[url] { return kept }
        if let running = inFlight[url] { return await running.value }
        let http = self.http
        let task = Task<Answer?, Never> {
            let request = HTTPRequestSpec(url: url, headers: ["User-Agent": TunerLinks.lumanestUserAgent, "Accept": "application/json"],
                                          timeout: ExtrasService.lookupTimeout)
            guard let result = try? await http.raw(request), result.status == 200 else { return nil }
            return parse(result.body)
        }
        inFlight[url] = task
        let result = await task.value
        inFlight[url] = nil
        if let result { remember(url, result) }
        return result
    }

    private func remember(_ url: URL, _ answer: Answer) {
        if answers[url] == nil { answerOrder.append(url) }
        answers[url] = answer
        while answerOrder.count > ExtrasService.maxAnswers {
            answers[answerOrder.removeFirst()] = nil
        }
    }

    /// The track's WebVTT file: from the device cache when it has it, else downloaded (one download from the plan).
    /// Throws when it can't be loaded or holds no cue.
    public func subtitleFile(_ track: SubtitleTrack) async throws -> WebVTT {
        guard let origin = ExtrasQueryText.origin(base), track.vtt.absoluteString.hasPrefix(origin) else { throw TunerError.invalidResponse }
        let hash = String(StableHash.sha256Hex(Data(track.vtt.absoluteString.utf8)).prefix(32))
        if let kept = readKept(hash) { return kept }
        let request = HTTPRequestSpec(url: track.vtt, headers: ["User-Agent": TunerLinks.lumanestUserAgent, "Accept": "text/vtt"],
                                      timeout: ExtrasService.fileTimeout)
        let result = try await http.raw(request)
        guard result.status == 200 else { throw TunerError.serverStatus(result.status) }
        guard result.body.count <= ExtrasService.maxFileBytes else { throw TunerError.invalidResponse }
        let file = WebVTT(data: result.body)
        guard !file.isEmpty else { throw TunerError.invalidResponse }
        keep(result.body, hash: hash)
        return file
    }

    /// Settings → Clear cached data.
    public func clearCache() {
        answers = [:]
        answerOrder = []
        guard let cacheDirectory else { return }
        for name in keptFiles().map(\.name) { try? FileManager.default.removeItem(at: cacheDirectory.appendingPathComponent(name)) }
    }

    // MARK: Device cache

    private struct KeptFile {
        var name: String
        var hash: String
        var saved: Double
    }

    /// `<32 hex>-<unix seconds>.vtt` files in the cache folder.
    private func keptFiles() -> [KeptFile] {
        guard let cacheDirectory, let names = try? FileManager.default.contentsOfDirectory(atPath: cacheDirectory.path) else { return [] }
        return names.compactMap { name in
            guard name.hasSuffix(".vtt") else { return nil }
            let parts = name.dropLast(4).split(separator: "-")
            guard parts.count == 2, parts[0].count == 32, let saved = Double(parts[1]) else { return nil }
            return KeptFile(name: name, hash: String(parts[0]), saved: saved)
        }
    }

    private func isFresh(_ file: KeptFile, at date: Double) -> Bool {
        file.saved <= date + 3600 && date - file.saved <= ExtrasService.fileMaxAge
    }

    private func readKept(_ hash: String) -> WebVTT? {
        guard let cacheDirectory else { return nil }
        let date = now().timeIntervalSince1970
        for file in keptFiles() where file.hash == hash {
            let url = cacheDirectory.appendingPathComponent(file.name)
            if isFresh(file, at: date), let data = try? Data(contentsOf: url) {
                let parsed = WebVTT(data: data)
                if !parsed.isEmpty { return parsed }
            }
            try? FileManager.default.removeItem(at: url)
        }
        return nil
    }

    private func keep(_ body: Data, hash: String) {
        guard let cacheDirectory else { return }
        let date = now().timeIntervalSince1970
        do {
            try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            for file in keptFiles() where file.hash == hash { try? FileManager.default.removeItem(at: cacheDirectory.appendingPathComponent(file.name)) }
            try body.write(to: cacheDirectory.appendingPathComponent("\(hash)-\(Int64(date)).vtt"), options: .atomic)
        } catch {
            // A file that can't be kept is downloaded again next time.
            return
        }
        // Expired files go, then the oldest until 20 are left.
        var files = keptFiles()
        for file in files where !isFresh(file, at: date) { try? FileManager.default.removeItem(at: cacheDirectory.appendingPathComponent(file.name)) }
        files = files.filter { isFresh($0, at: date) }.sorted { $0.saved != $1.saved ? $0.saved > $1.saved : $0.name < $1.name }
        for file in files.dropFirst(ExtrasService.maxFiles) { try? FileManager.default.removeItem(at: cacheDirectory.appendingPathComponent(file.name)) }
    }
}

// MARK: - Which subtitles show by themselves

/// docs/extras.md "Automatic choice" (Settings → Subtitles On, or Automatic with the system's captions on): an English
/// track the stream carries, else an English file the provider lists, else the first OpenSubtitles track, else the
/// app's existing fallback (another track the stream carries, else the provider's first file).
public enum SubtitleAutoChoice: Sendable, Hashable {
    /// The stream's English track.
    case embeddedEnglish
    /// The provider-listed file at this index.
    case provider(Int)
    /// The OpenSubtitles track at this index.
    case openSubtitles(Int)
    /// The stream's first track (none of them English).
    case embeddedOther
    /// Nothing to show.
    case nothing

    /// `openSubtitles` is the number of OpenSubtitles tracks, or nil while the lookup hasn't answered: nil is returned
    /// then when the answer could still change the choice.
    public static func choose(embeddedEnglish: Bool, embeddedCount: Int, provider: [ExternalSubtitle], openSubtitles: Int?) -> SubtitleAutoChoice? {
        if embeddedEnglish { return .embeddedEnglish }
        if let english = provider.firstIndex(where: isEnglish) { return .provider(english) }
        guard let openSubtitles else { return nil }
        if openSubtitles > 0 { return .openSubtitles(0) }
        if embeddedCount > 0 { return .embeddedOther }
        if !provider.isEmpty { return .provider(0) }
        return .nothing
    }

    /// A provider file in English: language `en`, `eng`, `en-…` or `english`, or "english" in its name.
    public static func isEnglish(_ subtitle: ExternalSubtitle) -> Bool {
        let language = (subtitle.language ?? "").lowercased()
        return language == "en" || language == "eng" || language.hasPrefix("en-") || language == "english"
            || subtitle.displayName.lowercased().contains("english")
    }
}
