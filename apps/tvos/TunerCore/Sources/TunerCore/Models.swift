import Foundation

public enum SourceKind: String, Codable, Sendable, Hashable {
    /// Shown as "Server login" (never "Xtream").
    case xtream
    /// Shown as "Playlist link" (never "M3U").
    case m3u
}

/// A line login. `password` lives in the Keychain (`SecretStore`), never in UserDefaults; `SourceStore` strips it
/// before encoding and restores it on read.
public struct Source: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var kind: SourceKind
    /// Xtream base URL, normalized by `Xtream.normalizeServer`.
    public var server: String
    public var username: String
    public var password: String
    /// Playlist link (M3U).
    public var playlistURL: String
    /// Optional XMLTV override; empty uses xmltv.php (Xtream) or the playlist's url-tvg (M3U).
    public var guideURL: String

    public init(id: String = UUID().uuidString, name: String = "LumaNest TV", kind: SourceKind, server: String = "",
                username: String = "", password: String = "", playlistURL: String = "", guideURL: String = "") {
        self.id = id; self.name = name; self.kind = kind; self.server = server; self.username = username
        self.password = password; self.playlistURL = playlistURL; self.guideURL = guideURL
    }

    /// Non-nil for `.xtream` sources with server, username and password.
    public var xtreamLogin: XtreamLogin? {
        guard kind == .xtream, !server.isEmpty, !username.isEmpty, !password.isEmpty else { return nil }
        return XtreamLogin(server: server, username: username, password: password)
    }
}

public struct XtreamLogin: Sendable, Hashable {
    public var server: String
    public var username: String
    public var password: String
    public init(server: String, username: String, password: String) {
        self.server = server; self.username = username; self.password = password
    }
}

public struct Category: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    /// Xtream `is_adult`.
    public var adult: Bool
    public init(id: String, name: String, adult: Bool = false) { self.id = id; self.name = name; self.adult = adult }
}

public enum SubtitleFormat: String, Codable, Sendable, Hashable {
    case srt, webvtt, ssa, ttml
    /// srt → .srt; vtt, webvtt → .webvtt; ass, ssa → .ssa; ttml, dfxp, xml → .ttml; anything else → nil.
    public init?(fileExtension: String) {
        var ext = fileExtension.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if ext.hasPrefix(".") { ext.removeFirst() }
        switch ext {
        case "srt": self = .srt
        case "vtt", "webvtt": self = .webvtt
        case "ass", "ssa": self = .ssa
        case "ttml", "dfxp", "xml": self = .ttml
        default: return nil
        }
    }
}

public struct ExternalSubtitle: Codable, Sendable, Hashable {
    public var url: URL
    public var language: String?
    public var label: String?
    public init(url: URL, language: String? = nil, label: String? = nil) { self.url = url; self.language = language; self.label = label }
    /// From the URL's path extension.
    public var format: SubtitleFormat? { SubtitleFormat(fileExtension: url.pathExtension) }
    /// label, else the language's English name ("English"), else "Subtitles".
    public var displayName: String {
        if let label = label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty { return label }
        if let language = language?.trimmingCharacters(in: .whitespacesAndNewlines), !language.isEmpty {
            let code = language.replacingOccurrences(of: "_", with: "-").split(separator: "-").first.map(String.init) ?? language
            if let name = Locale(identifier: "en_US_POSIX").localizedString(forLanguageCode: code.lowercased()),
               name.lowercased() != code.lowercased() {
                return name
            }
            return language
        }
        return "Subtitles"
    }
}

public struct Channel: Codable, Sendable, Hashable, Identifiable {
    /// "x:<stream_id>" (Xtream), "u:<base36 fnv1a64(url)>:<index>" (M3U).
    public var key: String
    public var id: String { key }
    public var number: Int
    public var name: String
    public var logo: URL?
    public var categoryID: String
    public var categoryIDs: [String]
    public var epgID: String?
    public var streamID: String?
    public var url: URL
    /// URLs of duplicate copies folded into this channel by `Cleanup.lineup`, tried in order after `url`.
    public var backups: [URL]
    public var country: String?
    public var language: String?
    public var adult: Bool

    public init(key: String, number: Int, name: String, logo: URL? = nil, categoryID: String, categoryIDs: [String] = [],
                epgID: String? = nil, streamID: String? = nil, url: URL, backups: [URL] = [], country: String? = nil,
                language: String? = nil, adult: Bool = false) {
        self.key = key; self.number = number; self.name = name; self.logo = logo; self.categoryID = categoryID
        self.categoryIDs = categoryIDs.isEmpty ? [categoryID] : categoryIDs; self.epgID = epgID; self.streamID = streamID
        self.url = url; self.backups = backups; self.country = country; self.language = language; self.adult = adult
    }
}

public struct Movie: Codable, Sendable, Hashable, Identifiable {
    /// "m:<stream_id>" (Xtream), "mu:<base36 fnv1a64(url)>" (M3U).
    public var id: String
    public var name: String
    public var poster: URL?
    /// Provider rating text ("7.4"); "0"/"0.0" become nil.
    public var rating: String?
    public var categoryID: String
    public var categoryIDs: [String]
    public var url: URL
    /// Other playable uploads of the same film (newest first).
    public var backups: [URL]
    /// Unix seconds; 0 when unknown.
    public var added: Int64
    public var containerExtension: String?
    /// "2023": provider `year`, else first 4 chars of `releaseDate`/`release_date`/`releasedate`, else a trailing
    /// "(YYYY)" in the name.
    public var year: String?
    /// Provider `tmdb` / `tmdb_id` (docs/browse.md matching step 1).
    public var tmdbID: Int?
    /// Provider `genre` text when the list carries it ("Action, Drama").
    public var genre: String?
    public var country: String?
    public var language: String?
    public var adult: Bool

    public init(id: String, name: String, poster: URL? = nil, rating: String? = nil, categoryID: String, categoryIDs: [String] = [],
                url: URL, backups: [URL] = [], added: Int64 = 0, containerExtension: String? = nil, year: String? = nil,
                tmdbID: Int? = nil, genre: String? = nil, country: String? = nil, language: String? = nil, adult: Bool = false) {
        self.id = id; self.name = name; self.poster = poster; self.rating = rating; self.categoryID = categoryID
        self.categoryIDs = categoryIDs.isEmpty ? [categoryID] : categoryIDs; self.url = url; self.backups = backups
        self.added = added; self.containerExtension = containerExtension; self.year = year; self.tmdbID = tmdbID
        self.genre = genre; self.country = country; self.language = language; self.adult = adult
    }
}

public struct Series: Codable, Sendable, Hashable, Identifiable {
    /// "s:<series_id>" (Xtream) or "ms:<base36 fnv1a64(show name)>" (playlist series).
    public var id: String
    /// Provider `series_id` (Xtream); the hash part for playlist series.
    public var seriesID: String
    public var name: String
    public var cover: URL?
    public var plot: String?
    public var rating: String?
    public var genre: String?
    public var year: String?
    public var backdrop: URL?
    /// `last_modified`, unix seconds; 0 when unknown.
    public var added: Int64
    public var categoryID: String
    public var categoryIDs: [String]
    public var tmdbID: Int?
    public var country: String?
    public var language: String?
    public var adult: Bool

    public init(id: String, seriesID: String, name: String, cover: URL? = nil, plot: String? = nil, rating: String? = nil,
                genre: String? = nil, year: String? = nil, backdrop: URL? = nil, added: Int64 = 0, categoryID: String,
                categoryIDs: [String] = [], tmdbID: Int? = nil, country: String? = nil, language: String? = nil, adult: Bool = false) {
        self.id = id; self.seriesID = seriesID; self.name = name; self.cover = cover; self.plot = plot
        self.rating = rating; self.genre = genre; self.year = year; self.backdrop = backdrop; self.added = added
        self.categoryID = categoryID; self.categoryIDs = categoryIDs.isEmpty ? [categoryID] : categoryIDs
        self.tmdbID = tmdbID; self.country = country; self.language = language; self.adult = adult
    }
}

public struct Episode: Codable, Sendable, Hashable, Identifiable {
    /// "e:<episode id>" (Xtream) or "me:<base36 fnv1a64(url)>" (playlist).
    public var id: String
    public var season: Int
    public var number: Int
    public var title: String
    public var plot: String?
    public var image: URL?
    public var durationSeconds: Int
    public var url: URL
    public var containerExtension: String?
    public var subtitles: [ExternalSubtitle]

    public init(id: String, season: Int, number: Int, title: String, plot: String? = nil, image: URL? = nil,
                durationSeconds: Int = 0, url: URL, containerExtension: String? = nil, subtitles: [ExternalSubtitle] = []) {
        self.id = id; self.season = season; self.number = number; self.title = title; self.plot = plot; self.image = image
        self.durationSeconds = durationSeconds; self.url = url; self.containerExtension = containerExtension
        self.subtitles = subtitles
    }

    /// `PlaybackSupport.isPlayableVOD(url:containerExtension:)`.
    public var isPlayable: Bool { PlaybackSupport.isPlayableVOD(url: url, containerExtension: containerExtension) }
}

public struct Program: Codable, Sendable, Hashable {
    public var start: Date
    public var end: Date
    public var title: String
    public var description: String?
    public var subtitle: String?
    /// Gap filler titled with the channel name.
    public var placeholder: Bool
    public init(start: Date, end: Date, title: String, description: String? = nil, subtitle: String? = nil, placeholder: Bool = false) {
        self.start = start; self.end = end; self.title = title; self.description = description; self.subtitle = subtitle
        self.placeholder = placeholder
    }
}

public struct MovieInfo: Codable, Sendable, Hashable {
    public var plot: String?
    public var cast: String?
    public var director: String?
    public var genre: String?
    public var year: String?
    public var duration: String?
    public var rating: String?
    public var backdrop: URL?
    public var poster: URL?
    public var subtitles: [ExternalSubtitle]
    public init(plot: String? = nil, cast: String? = nil, director: String? = nil, genre: String? = nil, year: String? = nil,
                duration: String? = nil, rating: String? = nil, backdrop: URL? = nil, poster: URL? = nil,
                subtitles: [ExternalSubtitle] = []) {
        self.plot = plot; self.cast = cast; self.director = director; self.genre = genre; self.year = year
        self.duration = duration; self.rating = rating; self.backdrop = backdrop; self.poster = poster; self.subtitles = subtitles
    }
    /// "2023 · 1 hr 52 min · Drama · ★7.5" (parts that exist).
    public var metadataLine: String {
        var parts: [String] = []
        if let year = year?.trimmingCharacters(in: .whitespacesAndNewlines), !year.isEmpty { parts.append(year) }
        if let duration = MovieInfo.durationText(duration) { parts.append(duration) }
        if let genre = genre?.trimmingCharacters(in: .whitespacesAndNewlines), !genre.isEmpty { parts.append(genre) }
        if let rating = TimeText.rating(rating) { parts.append("★" + rating) }
        return parts.joined(separator: " · ")
    }

    /// Provider durations come as "01:52:30", "112 min", "6720" (seconds) or free text.
    static func durationText(_ raw: String?) -> String? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        var seconds: Int?
        let pieces = text.split(separator: ":").map { Int($0.trimmingCharacters(in: .whitespaces)) }
        if pieces.count >= 2, pieces.allSatisfy({ $0 != nil }) {
            let values = pieces.compactMap { $0 }
            seconds = values.count == 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values[0] * 60 + values[1]
        } else if let value = Int(text) {
            seconds = value
        }
        guard let total = seconds else { return text }
        guard total >= 60 else { return nil }
        let hours = total / 3600, minutes = (total % 3600) / 60
        if hours > 0 { return minutes > 0 ? "\(hours) hr \(minutes) min" : "\(hours) hr" }
        return "\(minutes) min"
    }
}

public struct SeriesInfo: Codable, Sendable, Hashable {
    public var plot: String?
    public var cast: String?
    public var genre: String?
    public var year: String?
    public var backdrop: URL?
    /// Season number → episodes sorted by number, de-duplicated by id. Season 0 is "Specials".
    public var seasons: [Int: [Episode]]
    public init(plot: String? = nil, cast: String? = nil, genre: String? = nil, year: String? = nil, backdrop: URL? = nil,
                seasons: [Int: [Episode]] = [:]) {
        self.plot = plot; self.cast = cast; self.genre = genre; self.year = year; self.backdrop = backdrop; self.seasons = seasons
    }
    /// Ascending.
    public var seasonNumbers: [Int] { seasons.keys.sorted() }
    /// Every episode in season-then-episode order.
    public var allEpisodes: [Episode] { seasonNumbers.flatMap { seasons[$0] ?? [] } }
    /// "Specials" for 0, else "Season N".
    public static func seasonTitle(_ season: Int) -> String { season == 0 ? "Specials" : "Season \(season)" }
}

public enum TitleKind: String, Codable, Sendable, Hashable, CaseIterable {
    case movie
    case series
    /// "Movies" / "Series".
    public var plural: String { self == .movie ? "Movies" : "Series" }
}

public enum RecentKind: String, Codable, Sendable, Hashable {
    case movie
    case episode
}

/// A resume point. Holds no stream URL (URLs carry the line password); playback resolves the URL from the catalogue
/// (movies) or `CatalogService.seriesInfo` (episodes).
public struct RecentItem: Codable, Sendable, Hashable, Identifiable {
    /// "m:…"/"mu:…" for movies, "e:…"/"me:…" for episodes.
    public var id: String
    public var kind: RecentKind
    /// Movie name, or the series name for episodes.
    public var title: String
    /// Episodes: "S1 E2 · Title".
    public var subtitle: String?
    public var image: URL?
    /// "s:…"/"ms:…" for episodes.
    public var seriesID: String?
    public var season: Int?
    public var episode: Int?
    public var positionMs: Int64
    public var durationMs: Int64
    public var updated: Date
    /// The next episode after a finished one (position 0): Continue watching offers it as "Up next".
    public var upNext: Bool
    public init(id: String, kind: RecentKind, title: String, subtitle: String? = nil, image: URL? = nil, seriesID: String? = nil,
                season: Int? = nil, episode: Int? = nil, positionMs: Int64, durationMs: Int64, updated: Date, upNext: Bool = false) {
        self.id = id; self.kind = kind; self.title = title; self.subtitle = subtitle; self.image = image; self.seriesID = seriesID
        self.season = season; self.episode = episode; self.positionMs = positionMs; self.durationMs = durationMs
        self.updated = updated; self.upNext = upNext
    }
    /// position / duration in 0...1 (nil when duration is unknown or this is an up-next item).
    public var progress: Double? {
        guard !upNext, durationMs > 0 else { return nil }
        return min(1, max(0, Double(positionMs) / Double(durationMs)))
    }
    /// The movie id or the series id: the title this recent belongs to.
    public var titleID: String { kind == .episode ? (seriesID ?? id) : id }
}

/// "Recently watched" in Library: a title (movie id or series id) and when it was last played.
public struct HistoryEntry: Codable, Sendable, Hashable, Identifiable {
    public var titleID: String
    public var kind: TitleKind
    public var updated: Date
    public var id: String { titleID }
    public init(titleID: String, kind: TitleKind, updated: Date) { self.titleID = titleID; self.kind = kind; self.updated = updated }
}
