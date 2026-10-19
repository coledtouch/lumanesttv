import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif

public struct LiveLineup: Codable, Sendable, Hashable {
    public var channels: [Channel]
    /// Only categories actually used, in provider order.
    public var categories: [Category]
    /// Folded key → kept key, from `Cleanup.lineup`.
    public var aliases: [String: String]
    /// Playlist url-tvg (nil for Xtream).
    public var playlistGuideURL: URL?
    public var updated: Date
    public init(channels: [Channel], categories: [Category], aliases: [String: String] = [:], playlistGuideURL: URL? = nil, updated: Date) {
        self.channels = channels; self.categories = categories; self.aliases = aliases
        self.playlistGuideURL = playlistGuideURL; self.updated = updated
    }

    /// aliases[key] ?? key.
    public func canonical(_ key: String) -> String {
        var current = key
        var visited = Set<String>()
        while let next = aliases[current], next != current, visited.insert(current).inserted { current = next }
        return current
    }

    public func channel(forKey key: String) -> Channel? {
        let wanted = canonical(key)
        return channels.first { $0.key == wanted } ?? channels.first { $0.key == key }
    }

    /// The kept key plus every key folded into it (dead-channel reports hide all of them).
    public func keys(foldedInto key: String) -> [String] {
        let kept = canonical(key)
        return [kept] + aliases.keys.filter { $0 != kept && canonical($0) == kept }.sorted()
    }

    /// Next/previous channel in `channels` order from `key`, wrapping, skipping `hidden` keys.
    public func neighbor(of key: String, offset: Int, in channels: [Channel], hidden: Set<String> = []) -> Channel? {
        guard !channels.isEmpty else { return nil }
        let kept = canonical(key)
        let start = channels.firstIndex { $0.key == kept } ?? channels.firstIndex { $0.key == key }
        if offset == 0 { return start.map { channels[$0] } }
        let count = channels.count
        let step = offset > 0 ? 1 : -1
        var index = start ?? (offset > 0 ? -1 : count)
        var remaining = abs(offset)
        var looked = 0
        while looked < count * abs(offset) + count {
            index = ((index + step) % count + count) % count
            looked += 1
            if hidden.contains(channels[index].key) { continue }
            remaining -= 1
            if remaining == 0 { return channels[index] }
        }
        return nil
    }
}

public struct MovieLibrary: Codable, Sendable, Hashable {
    /// Adult-filtered, playable on Apple TV, duplicates folded (`Cleanup.movies`).
    public var movies: [Movie]
    public var categories: [Category]
    public var updated: Date
    public init(movies: [Movie], categories: [Category], updated: Date) { self.movies = movies; self.categories = categories; self.updated = updated }
    public func movie(id: String) -> Movie? { movies.first { $0.id == id } }
}

public struct SeriesLibrary: Codable, Sendable, Hashable {
    public var series: [Series]
    public var categories: [Category]
    public var updated: Date
    public init(series: [Series], categories: [Category], updated: Date) { self.series = series; self.categories = categories; self.updated = updated }
    public func series(id: String) -> Series? { series.first { $0.id == id } }
}

public enum LoadPhase: Sendable, Hashable {
    case idle
    case loading
    case ready
    /// `TunerError.message`.
    case failed(String)
}

public struct CatalogOptions: Sendable, Hashable {
    /// Live TV "Channels: All / USA only" (the hub-chosen lineup is the default).
    public var usOnly: Bool
    /// Dead channel keys from `UserLibrary.deadChannels`.
    public var hiddenChannels: Set<String>
    public init(usOnly: Bool = false, hiddenChannels: Set<String> = []) { self.usOnly = usOnly; self.hiddenChannels = hiddenChannels }
}

public struct CatalogState: Sendable, Hashable {
    public var sourceID: String?
    public var live: LiveLineup?
    public var movies: MovieLibrary?
    public var series: SeriesLibrary?
    public var livePhase: LoadPhase
    public var moviesPhase: LoadPhase
    public var seriesPhase: LoadPhase
    public init(sourceID: String? = nil, live: LiveLineup? = nil, movies: MovieLibrary? = nil, series: SeriesLibrary? = nil,
                livePhase: LoadPhase = .idle, moviesPhase: LoadPhase = .idle, seriesPhase: LoadPhase = .idle) {
        self.sourceID = sourceID; self.live = live; self.movies = movies; self.series = series
        self.livePhase = livePhase; self.moviesPhase = moviesPhase; self.seriesPhase = seriesPhase
    }
}

/// A cached value with its own age (no file-timestamp APIs) and the identity it was made for.
struct Snapshot<Payload: Codable>: Codable {
    var identity: String
    /// Unix seconds.
    var saved: Double
    var payload: Payload
}

extension Snapshot: Sendable where Payload: Sendable {}

enum SnapshotFiles {
    static let maxAge: TimeInterval = 7 * 24 * 3600

    static func read<P: Codable>(_ type: P.Type, at url: URL) -> Snapshot<P>? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Snapshot<P>.self, from: data)
    }

    /// Snapshot writes run in order on one serial queue, so an older snapshot never lands after a newer one.
    static let queue = DispatchQueue(label: "app.tunertv.snapshots", qos: .utility)

    static func enqueue<P: Codable & Sendable>(_ snapshot: Snapshot<P>, to url: URL) {
        queue.async { write(snapshot, to: url) }
    }

    /// Waits for every queued write (tests).
    static func drain() { queue.sync {} }

    static func write<P: Codable>(_ snapshot: Snapshot<P>, to url: URL) {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(snapshot).write(to: url, options: .atomic)
        } catch {
            // A cache that can't be written is only slower next time.
        }
    }

    static func removeAll(in directory: URL) {
        drain()
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path) else { return }
        for name in names { try? FileManager.default.removeItem(at: directory.appendingPathComponent(name)) }
    }
}

/// The adult-filtered parse of a live catalogue, kept in memory so USA-only and hidden channels re-filter offline.
struct ParsedLive: Sendable {
    var channels: [Channel]
    var categories: [Category]
    var guideURL: URL?
    var parsedAt: Date
}

struct SeriesPayload: Codable, Sendable {
    var library: SeriesLibrary
    /// Playlist series only: series id → episodes.
    var episodes: [String: [Episode]]
}

/// Downloads, parses, filters (adult filter BEFORE anything is cached), cleans and caches catalogues.
/// - Stale-while-revalidate: a snapshot (<= 7 days old, same identity) is published at once and refreshed in the
///   background when older than its TTL (live 2 h, movies/series 12 h) or when `force` is true.
/// - Raw provider JSON/playlists are parsed in memory and never written to disk. The adult-filtered parse result is
///   kept in memory for the session, so changing USA-only or hidden channels re-filters without a download.
/// - Snapshots are JSON files in `cacheDirectory` (the app passes Caches/Catalog); their age is stored inside the
///   file (no file-timestamp APIs).
/// - Movies and series load concurrently with live; live is published first.
public actor CatalogService {
    static let policyVersion = "policy:1"
    static let liveTTL: TimeInterval = 2 * 3600
    static let vodTTL: TimeInterval = 12 * 3600

    private let cacheDirectory: URL
    private let http: any HTTPClient
    private let edition: Edition
    private let now: @Sendable () -> Date

    private var current = CatalogState()
    private var continuations: [UUID: AsyncStream<CatalogState>.Continuation] = [:]
    private var generation = 0
    private var sourceDigest: String?
    private var liveIdentity: String?
    private var parsedLive: (digest: String, parsed: ParsedLive)?
    private var playlistEpisodes: (digest: String, episodes: [String: [Episode]])?
    private var movieInfoCache: [String: MovieInfo] = [:]
    private var seriesInfoCache: [String: SeriesInfo] = [:]

    public init(cacheDirectory: URL, http: any HTTPClient, edition: Edition = .current,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.cacheDirectory = cacheDirectory
        self.http = http
        self.edition = edition
        self.now = now
    }

    public var state: CatalogState { current }

    /// Yields the current state immediately, then every change, until the consumer stops iterating.
    public func states() -> AsyncStream<CatalogState> {
        let (stream, continuation) = AsyncStream.makeStream(of: CatalogState.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        continuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeContinuation(id) }
        }
        continuation.yield(current)
        return stream
    }

    private func removeContinuation(_ id: UUID) { continuations[id] = nil }

    private func publish() {
        for continuation in continuations.values { continuation.yield(current) }
    }

    /// A changed identity (source, USA-only, edition, policy version) clears the published state first; a plain
    /// refresh keeps it visible. Concurrent calls: the newest wins, older loads stop publishing.
    public func load(_ source: Source, options: CatalogOptions, force: Bool = false) async {
        generation += 1
        let token = generation
        let digest = CatalogService.sourceDigest(source)
        let liveID = CatalogService.identity(source: source, options: options, edition: edition)
        let vodID = CatalogService.identity(source: source, options: CatalogOptions(), edition: edition)
        let date = now()
        movieInfoCache = [:]
        seriesInfoCache = [:]

        if sourceDigest != digest || current.sourceID != source.id {
            current = CatalogState(sourceID: source.id, livePhase: .loading, moviesPhase: .loading, seriesPhase: .loading)
            sourceDigest = digest
            liveIdentity = nil
            parsedLive = nil
            playlistEpisodes = nil
        } else if liveIdentity != liveID {
            current.live = nil
            current.livePhase = .loading
        }
        liveIdentity = liveID

        // Snapshots first.
        var liveStale = true, moviesStale = true, seriesStale = true
        if current.live == nil, let snapshot = SnapshotFiles.read(LiveLineup.self, at: file("live", digest)), snapshot.identity == liveID,
           date.timeIntervalSince1970 - snapshot.saved <= SnapshotFiles.maxAge {
            current.live = snapshot.payload
            current.livePhase = .ready
            liveStale = date.timeIntervalSince1970 - snapshot.saved > CatalogService.liveTTL
        } else if current.live != nil {
            liveStale = date.timeIntervalSince(current.live!.updated) > CatalogService.liveTTL
        }
        if current.live == nil, let parsed = parsedLive, parsed.digest == digest {
            // Options changed: re-filter the session's parse without a download (off the actor: large lineups take a while).
            let lineup = await CatalogService.buildLineup(parsed.parsed, options: options, edition: edition, now: date)
            guard token == generation else { return }
            current.live = lineup
            current.livePhase = .ready
            liveStale = date.timeIntervalSince(parsed.parsed.parsedAt) > CatalogService.liveTTL
            // The data is as old as its download: re-filtering doesn't make it fresh.
            writeSnapshot(lineup, identity: liveID, saved: parsed.parsed.parsedAt, to: file("live", digest))
        }
        if current.movies == nil, let snapshot = SnapshotFiles.read(MovieLibrary.self, at: file("movies", digest)), snapshot.identity == vodID,
           date.timeIntervalSince1970 - snapshot.saved <= SnapshotFiles.maxAge {
            current.movies = snapshot.payload
            current.moviesPhase = .ready
            moviesStale = date.timeIntervalSince1970 - snapshot.saved > CatalogService.vodTTL
        } else if let movies = current.movies {
            moviesStale = date.timeIntervalSince(movies.updated) > CatalogService.vodTTL
        }
        if current.series == nil, let snapshot = SnapshotFiles.read(SeriesPayload.self, at: file("series", digest)), snapshot.identity == vodID,
           date.timeIntervalSince1970 - snapshot.saved <= SnapshotFiles.maxAge {
            current.series = snapshot.payload.library
            current.seriesPhase = .ready
            if !snapshot.payload.episodes.isEmpty { playlistEpisodes = (digest, snapshot.payload.episodes) }
            seriesStale = date.timeIntervalSince1970 - snapshot.saved > CatalogService.vodTTL
        } else if let series = current.series {
            seriesStale = date.timeIntervalSince(series.updated) > CatalogService.vodTTL
        }
        if force { liveStale = true; moviesStale = true; seriesStale = true }
        if current.live == nil { current.livePhase = .loading }
        if current.movies == nil { current.moviesPhase = .loading }
        if current.series == nil { current.seriesPhase = .loading }
        publish()

        guard liveStale || moviesStale || seriesStale else { return }
        await refresh(source, options: options, token: token, digest: digest, liveID: liveID, vodID: vodID,
                      live: liveStale, movies: moviesStale, series: seriesStale)
    }

    /// Re-applies options (USA-only, hidden channels) to the in-memory parse; falls back to `load` when there is none.
    public func apply(_ options: CatalogOptions, source: Source) async {
        let digest = CatalogService.sourceDigest(source)
        guard let parsed = parsedLive, parsed.digest == digest, sourceDigest == digest else {
            await load(source, options: options)
            return
        }
        generation += 1
        let token = generation
        let date = now()
        let liveID = CatalogService.identity(source: source, options: options, edition: edition)
        let lineup = await CatalogService.buildLineup(parsed.parsed, options: options, edition: edition, now: date)
        guard token == generation else { return }
        liveIdentity = liveID
        current.live = lineup
        current.livePhase = .ready
        writeSnapshot(lineup, identity: liveID, saved: parsed.parsed.parsedAt, to: file("live", digest))
        publish()
    }

    /// Kept in memory per load; playlist sources return an empty MovieInfo.
    public func movieInfo(for movie: Movie, source: Source) async throws -> MovieInfo {
        if let cached = movieInfoCache[movie.id] { return cached }
        guard source.kind == .xtream, movie.id.hasPrefix("m:") else { return MovieInfo() }
        guard let login = source.xtreamLogin else { throw TunerError.loginFailed }
        let token = generation
        let info = try await XtreamClient(login: login, http: http).movieInfo(streamID: String(movie.id.dropFirst(2)))
        if token == generation { movieInfoCache[movie.id] = info }
        return info
    }

    /// Xtream: get_series_info; playlist series: built from the playlist's episodes. Episodes Apple TV can't play
    /// are kept and report `isPlayable == false`.
    public func seriesInfo(for series: Series, source: Source) async throws -> SeriesInfo {
        if let cached = seriesInfoCache[series.id] { return cached }
        let token = generation
        let info: SeriesInfo
        if series.id.hasPrefix("ms:") {
            let digest = CatalogService.sourceDigest(source)
            var episodes = playlistEpisodes?.digest == digest ? playlistEpisodes?.episodes : nil
            if episodes == nil, let snapshot = SnapshotFiles.read(SeriesPayload.self, at: file("series", digest)) {
                episodes = snapshot.payload.episodes
            }
            if episodes == nil || episodes?[series.id] == nil {
                let playlist = try await CatalogService.fetchPlaylist(source, http: http)
                episodes = playlist.episodes
                if token == generation { playlistEpisodes = (digest, playlist.episodes) }
            }
            info = CatalogService.seriesInfo(series, episodes: episodes?[series.id] ?? [])
        } else {
            guard let login = source.xtreamLogin else { throw TunerError.loginFailed }
            info = try await XtreamClient(login: login, http: http).seriesInfo(seriesID: series.seriesID)
        }
        if token == generation { seriesInfoCache[series.id] = info }
        return info
    }

    /// Deletes every snapshot and in-memory cache; the published state stays until the next load.
    public func clearCaches() async {
        SnapshotFiles.removeAll(in: cacheDirectory)
        parsedLive = nil
        playlistEpisodes = nil
        movieInfoCache = [:]
        seriesInfoCache = [:]
    }

    /// Forgets everything (source deleted / signed out) and publishes an empty state.
    public func reset() async {
        generation += 1
        sourceDigest = nil
        liveIdentity = nil
        parsedLive = nil
        playlistEpisodes = nil
        movieInfoCache = [:]
        seriesInfoCache = [:]
        current = CatalogState()
        publish()
    }

    /// sha256 of source fields + "policy:1" + edition + usOnly (+ sorted hidden keys for live).
    public static func identity(source: Source, options: CatalogOptions, edition: Edition) -> String {
        let fields = sourceFields(source) + [policyVersion, edition.rawValue, "us:\(options.usOnly)",
                                             "hidden:" + options.hiddenChannels.sorted().joined(separator: ",")]
        return StableHash.sha256Hex(Data(fields.joined(separator: "\n").utf8))
    }

    static func sourceFields(_ source: Source) -> [String] {
        ["source:1", source.id, source.kind.rawValue, Xtream.normalizeServer(source.server), source.username, source.password,
         source.playlistURL, source.guideURL]
    }

    static func sourceDigest(_ source: Source) -> String {
        String(StableHash.sha256Hex(Data(sourceFields(source).joined(separator: "\n").utf8)).prefix(24))
    }

    private func file(_ kind: String, _ digest: String) -> URL { cacheDirectory.appendingPathComponent("\(kind)-\(digest).json") }

    private func writeSnapshot<P: Codable & Sendable>(_ payload: P, identity: String, saved: Date, to url: URL) {
        SnapshotFiles.enqueue(Snapshot(identity: identity, saved: saved.timeIntervalSince1970, payload: payload), to: url)
    }

    // MARK: refresh

    private enum Fetched: Sendable {
        case live(Result<(ParsedLive, LiveLineup), TunerError>)
        case movies(Result<MovieLibrary, TunerError>)
        case series(Result<SeriesPayload, TunerError>)
        case playlist(Result<(ParsedLive, LiveLineup, MovieLibrary, SeriesPayload), TunerError>)
    }

    private func refresh(_ source: Source, options: CatalogOptions, token: Int, digest: String, liveID: String, vodID: String,
                         live: Bool, movies: Bool, series: Bool) async {
        let http = self.http
        let edition = self.edition
        let date = now()
        await withTaskGroup(of: Fetched.self) { group in
            if source.kind == .m3u {
                group.addTask {
                    do {
                        let playlist = try await CatalogService.fetchPlaylist(source, http: http)
                        let parsed = CatalogService.parseLive(playlist.channels, playlist.liveCategories, guideURL: playlist.guideURL,
                                                              edition: edition, date: date)
                        let lineup = CatalogService.lineup(parsed, options: options, edition: edition, now: date)
                        let movieLibrary = CatalogService.movieLibrary(playlist.movies, playlist.movieCategories, edition: edition, date: date)
                        let seriesPayload = CatalogService.seriesPayload(playlist.series, playlist.seriesCategories, episodes: playlist.episodes,
                                                                         edition: edition, date: date)
                        return .playlist(.success((parsed, lineup, movieLibrary, seriesPayload)))
                    } catch {
                        return .playlist(.failure(TunerError.from(error)))
                    }
                }
            } else if let login = source.xtreamLogin {
                if live {
                    group.addTask {
                        do {
                            async let categories = CatalogService.get(login, "get_live_categories", http: http)
                            async let streams = CatalogService.get(login, "get_live_streams", http: http)
                            let parsedCategories = try XtreamParser.categories(try await categories)
                            let channels = try XtreamParser.live(try await streams, login: login)
                            let parsed = CatalogService.parseLive(channels, parsedCategories, guideURL: nil, edition: edition, date: date)
                            return .live(.success((parsed, CatalogService.lineup(parsed, options: options, edition: edition, now: date))))
                        } catch {
                            return .live(.failure(TunerError.from(error)))
                        }
                    }
                }
                if movies {
                    group.addTask {
                        do {
                            async let categories = CatalogService.get(login, "get_vod_categories", http: http)
                            async let streams = CatalogService.get(login, "get_vod_streams", http: http)
                            let parsedCategories = try XtreamParser.categories(try await categories)
                            let items = try XtreamParser.movies(try await streams, login: login)
                            return .movies(.success(CatalogService.movieLibrary(items, parsedCategories, edition: edition, date: date)))
                        } catch {
                            return .movies(.failure(TunerError.from(error)))
                        }
                    }
                }
                if series {
                    group.addTask {
                        do {
                            async let categories = CatalogService.get(login, "get_series_categories", http: http)
                            async let list = CatalogService.get(login, "get_series", http: http)
                            let parsedCategories = try XtreamParser.categories(try await categories)
                            let items = try XtreamParser.series(try await list)
                            return .series(.success(CatalogService.seriesPayload(items, parsedCategories, episodes: [:], edition: edition, date: date)))
                        } catch {
                            return .series(.failure(TunerError.from(error)))
                        }
                    }
                }
            } else {
                group.addTask { .playlist(.failure(.loginFailed)) }
            }
            // Live is published first; VOD results that finish earlier wait for it.
            var liveDone = !live || source.kind == .m3u
            var held: [Fetched] = []
            for await result in group {
                guard token == generation else { continue }
                switch result {
                case .live(let outcome):
                    applyLive(outcome, digest: digest, liveID: liveID)
                    liveDone = true
                    for item in held { applyVOD(item, digest: digest, vodID: vodID, date: date) }
                    held = []
                    publish()
                case .playlist(let outcome):
                    switch outcome {
                    case .success(let (parsed, lineup, movieLibrary, seriesPayload)):
                        applyLive(.success((parsed, lineup)), digest: digest, liveID: liveID)
                        publish()
                        applyVOD(.movies(.success(movieLibrary)), digest: digest, vodID: vodID, date: date)
                        applyVOD(.series(.success(seriesPayload)), digest: digest, vodID: vodID, date: date)
                    case .failure(let error):
                        applyLive(.failure(error), digest: digest, liveID: liveID)
                        applyVOD(.movies(.failure(error)), digest: digest, vodID: vodID, date: date)
                        applyVOD(.series(.failure(error)), digest: digest, vodID: vodID, date: date)
                    }
                    publish()
                case .movies, .series:
                    if liveDone {
                        applyVOD(result, digest: digest, vodID: vodID, date: date)
                        publish()
                    } else {
                        held.append(result)
                    }
                }
            }
            if token == generation && !held.isEmpty {
                for item in held { applyVOD(item, digest: digest, vodID: vodID, date: date) }
                publish()
            }
        }
    }

    private func applyLive(_ outcome: Result<(ParsedLive, LiveLineup), TunerError>, digest: String, liveID: String) {
        switch outcome {
        case .success(let (parsed, lineup)):
            parsedLive = (digest, parsed)
            current.live = lineup
            current.livePhase = .ready
            writeSnapshot(lineup, identity: liveID, saved: parsed.parsedAt, to: file("live", digest))
        case .failure(let error):
            current.livePhase = current.live == nil ? .failed(error.message) : .ready
        }
    }

    private func applyVOD(_ result: Fetched, digest: String, vodID: String, date: Date) {
        switch result {
        case .movies(.success(let library)):
            current.movies = library
            current.moviesPhase = .ready
            writeSnapshot(library, identity: vodID, saved: date, to: file("movies", digest))
        case .movies(.failure(let error)):
            current.moviesPhase = current.movies == nil ? .failed(error.message) : .ready
        case .series(.success(let payload)):
            current.series = payload.library
            current.seriesPhase = .ready
            if !payload.episodes.isEmpty { playlistEpisodes = (digest, payload.episodes) }
            writeSnapshot(payload, identity: vodID, saved: date, to: file("series", digest))
        case .series(.failure(let error)):
            current.seriesPhase = current.series == nil ? .failed(error.message) : .ready
        default:
            break
        }
    }

    // MARK: pipeline (pure, off the actor)

    static func get(_ login: XtreamLogin, _ action: String, http: any HTTPClient) async throws -> Data {
        guard let url = Xtream.apiURL(login, action: action) else { throw TunerError.invalidInput("Check the server address.") }
        return try await http.data(HTTPRequestSpec(url: url)).body
    }

    static func fetchPlaylist(_ source: Source, http: any HTTPClient) async throws -> M3UPlaylist {
        guard let link = Xtream.httpLink(source.playlistURL), let url = Xtream.makeURL(link) else {
            throw TunerError.invalidInput("Enter an HTTP or HTTPS playlist link.")
        }
        let body = try await http.data(HTTPRequestSpec(url: url)).body
        return M3UParser.parse(body)
    }

    /// The adult filter runs here, before anything is kept or cached.
    static func parseLive(_ channels: [Channel], _ categories: [Category], guideURL: URL?, edition: Edition, date: Date) -> ParsedLive {
        let adult = AdultFilter.adultCategoryIDs(categories, mode: edition.adultFilterMode)
        let allowed = AdultFilter.filter(channels, categories: categories, mode: edition.adultFilterMode, live: true,
                                         categoryIDs: { $0.categoryIDs }, name: { $0.name }, flagged: { $0.adult })
        return ParsedLive(channels: allowed, categories: categories.filter { !adult.contains($0.id) }, guideURL: guideURL, parsedAt: date)
    }

    /// `lineup` on a background task: a large lineup takes a moment and the actor stays responsive meanwhile.
    static func buildLineup(_ parsed: ParsedLive, options: CatalogOptions, edition: Edition, now: Date) async -> LiveLineup {
        await Task.detached(priority: .userInitiated) { lineup(parsed, options: options, edition: edition, now: now) }.value
    }

    static func lineup(_ parsed: ParsedLive, options: CatalogOptions, edition: Edition, now: Date) -> LiveLineup {
        let policy = ContentPolicy.live(parsed.channels, categories: parsed.categories, usOnly: options.usOnly, edition: edition)
        let cleaned = Cleanup.lineup(policy.items, hidden: options.hiddenChannels, now: now)
        let used = Set(cleaned.channels.flatMap(\.categoryIDs))
        // `updated` is when the provider's data was downloaded (re-filtering keeps it), so TTLs stay honest.
        return LiveLineup(channels: cleaned.channels, categories: policy.categories.filter { used.contains($0.id) }, aliases: cleaned.merged,
                          playlistGuideURL: parsed.guideURL, updated: parsed.parsedAt)
    }

    static func movieLibrary(_ movies: [Movie], _ categories: [Category], edition: Edition, date: Date) -> MovieLibrary {
        let policy = ContentPolicy.movies(movies, categories: categories, edition: edition)
        let folded = Cleanup.movies(policy.items, categories: policy.categories)
        let used = Set(folded.flatMap(\.categoryIDs))
        return MovieLibrary(movies: folded, categories: policy.categories.filter { used.contains($0.id) }, updated: date)
    }

    static func seriesPayload(_ series: [Series], _ categories: [Category], episodes: [String: [Episode]], edition: Edition, date: Date) -> SeriesPayload {
        let policy = ContentPolicy.series(series, categories: categories, edition: edition)
        let kept = Set(policy.items.map(\.id))
        return SeriesPayload(library: SeriesLibrary(series: policy.items, categories: policy.categories, updated: date),
                             episodes: episodes.filter { kept.contains($0.key) })
    }

    static func seriesInfo(_ series: Series, episodes: [Episode]) -> SeriesInfo {
        var seasons: [Int: [Episode]] = [:]
        var seen = Set<String>()
        for episode in episodes where seen.insert(episode.id).inserted { seasons[episode.season, default: []].append(episode) }
        for (season, list) in seasons {
            seasons[season] = list.enumerated().sorted { $0.element.number != $1.element.number ? $0.element.number < $1.element.number : $0.offset < $1.offset }
                .map(\.element)
        }
        return SeriesInfo(plot: series.plot, genre: series.genre, year: series.year, backdrop: series.backdrop, seasons: seasons)
    }
}

// MARK: - Guide (EPG)

public struct GuideSchedule: Codable, Sendable, Hashable {
    /// Channel key → programmes sorted by start, non-overlapping.
    public var programs: [String: [Program]]
    /// Channel key → XMLTV icon.
    public var icons: [String: URL]
    public var updated: Date
    public init(programs: [String: [Program]] = [:], icons: [String: URL] = [:], updated: Date = Date(timeIntervalSince1970: 0)) {
        self.programs = programs; self.icons = icons; self.updated = updated
    }

    public func current(forKey key: String, at date: Date) -> Program? {
        guard let list = programs[key] else { return nil }
        var low = 0, high = list.count - 1
        while low <= high {
            let mid = (low + high) / 2
            if list[mid].start > date { high = mid - 1 } else if list[mid].end <= date { low = mid + 1 } else { return list[mid] }
        }
        return nil
    }

    public func next(forKey key: String, after date: Date) -> Program? {
        programs[key]?.first { $0.start > date }
    }

    /// Programmes overlapping `window` with their real start and end (shown in the guide; `GuideWindow` clips the cell
    /// width to the window), gaps inside the window filled with hour-aligned placeholders titled `channelName`. A listing
    /// that overlaps the one before it starts where that one ends, so cells never overlap.
    public func filled(forKey key: String, channelName: String, window: DateInterval) -> [Program] {
        var result: [Program] = []
        var cursor = window.start
        func fill(until end: Date) {
            while cursor < end {
                let hour = (cursor.timeIntervalSince1970 / 3600).rounded(.down) * 3600 + 3600
                let stop = min(end, Date(timeIntervalSince1970: hour))
                result.append(Program(start: cursor, end: stop, title: channelName, placeholder: true))
                cursor = stop
            }
        }
        for program in programs[key] ?? [] where program.end > window.start && program.start < window.end && program.end > program.start {
            let start = max(program.start, window.start, cursor)
            let end = min(program.end, window.end)
            guard end > start else { continue }
            fill(until: start)
            var shown = program
            if program.start < cursor && cursor > window.start { shown.start = cursor }
            result.append(shown)
            cursor = end
        }
        fill(until: window.end)
        return result
    }

    /// Everything from `from` on (for the per-channel schedule sheet).
    public func upcoming(forKey key: String, from: Date, limit: Int = 48) -> [Program] {
        Array((programs[key] ?? []).filter { $0.end > from }.prefix(max(0, limit)))
    }
}

public enum XMLTV {
    public struct Wanted: Sendable, Hashable {
        /// Lowercased epg ids.
        public var ids: Set<String>
        /// `ChannelMatch.key(name)`, `key(epgID)`, `idKey(epgID)` with length >= 2.
        public var keys: Set<String>
        public init(ids: Set<String>, keys: Set<String>) { self.ids = ids; self.keys = keys }
        public init(channels: [Channel]) {
            var ids = Set<String>()
            var keys = Set<String>()
            for channel in channels {
                keys.insert(ChannelMatch.key(channel.name))
                if let epg = channel.epgID?.trimmingCharacters(in: .whitespaces), !epg.isEmpty {
                    ids.insert(epg.lowercased())
                    keys.insert(ChannelMatch.key(epg))
                    keys.insert(ChannelMatch.idKey(epg))
                }
            }
            self.ids = ids
            self.keys = keys.filter { $0.count >= 2 }
        }
    }

    public struct Result: Sendable, Hashable {
        /// Lowercased channel id → programmes.
        public var programs: [String: [Program]]
        public var icons: [String: URL]
        /// ChannelMatch key of a display-name → channel id (main feed beats regional feeds).
        public var nameToID: [String: String]
        public init(programs: [String: [Program]] = [:], icons: [String: URL] = [:], nameToID: [String: String] = [:]) {
            self.programs = programs; self.icons = icons; self.nameToID = nameToID
        }
    }

    /// Streaming parse (XMLParser(stream:); FoundationXML on Linux). Keeps `window` and wanted channels only.
    public static func parse(fileURL: URL, window: DateInterval, wanted: Wanted) throws -> Result {
        var url = fileURL
        var temporary: URL?
        if let handle = try? FileHandle(forReadingFrom: fileURL) {
            let prefix = (try? handle.read(upToCount: 2)) ?? Data()
            try? handle.close()
            if Gzip.isGzip(prefix) {
                let plain = fileURL.deletingLastPathComponent().appendingPathComponent(".\(fileURL.lastPathComponent).\(UUID().uuidString).xml")
                try Gzip.decompressFile(at: fileURL, to: plain)
                url = plain
                temporary = plain
            }
        }
        defer { if let temporary { try? FileManager.default.removeItem(at: temporary) } }
        guard let stream = InputStream(url: url) else { throw TunerError.invalidResponse }
        return try run(XMLParser(stream: stream), window: window, wanted: wanted)
    }

    public static func parse(data: Data, window: DateInterval, wanted: Wanted) throws -> Result {
        var body = data
        if Gzip.isGzip(body) { body = try Gzip.decompress(body) }
        return try run(XMLParser(data: body), window: window, wanted: wanted)
    }

    private static func run(_ parser: XMLParser, window: DateInterval, wanted: Wanted) throws -> Result {
        let handler = XMLTVHandler(window: window, wanted: wanted)
        parser.delegate = handler
        parser.shouldProcessNamespaces = false
        parser.shouldResolveExternalEntities = false
        if !parser.parse() && handler.programs.isEmpty && handler.names.isEmpty { throw TunerError.invalidResponse }
        var programs: [String: [Program]] = [:]
        for (id, list) in handler.programs { programs[id] = dedupe(list) }
        return Result(programs: programs, icons: handler.icons, nameToID: handler.names)
    }

    /// Sorted; a programme starting before the previous one ends starts at that end, or is dropped if inside it.
    static func dedupe(_ list: [Program]) -> [Program] {
        let sorted = list.enumerated().sorted { $0.element.start != $1.element.start ? $0.element.start < $1.element.start : $0.offset < $1.offset }
            .map(\.element)
        var result: [Program] = []
        result.reserveCapacity(sorted.count)
        for program in sorted {
            if let last = result.last, program.start < last.end {
                if program.end > last.end {
                    var trimmed = program
                    trimmed.start = last.end
                    result.append(trimmed)
                }
            } else {
                result.append(program)
            }
        }
        return result
    }

    /// "YYYYMMDDhhmm[ss] [+-]hhmm"; no offset = UTC.
    public static func parseTime(_ text: String) -> Date? {
        let chars = Array(text.trimmingCharacters(in: .whitespaces).utf8)
        guard chars.count >= 12 else { return nil }
        func number(_ from: Int, _ count: Int) -> Int? {
            guard from + count <= chars.count else { return nil }
            var value = 0
            for i in from..<(from + count) {
                let c = chars[i]
                guard c >= 48 && c <= 57 else { return nil }
                value = value * 10 + Int(c - 48)
            }
            return value
        }
        guard let year = number(0, 4), let month = number(4, 2), let day = number(6, 2), let hour = number(8, 2), let minute = number(10, 2),
              (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60 else { return nil }
        var index = 12
        var second = 0
        if let s = number(12, 2) { second = s; index = 14 }
        var seconds = Double(daysFromCivil(year, month, day)) * 86400 + Double(hour * 3600 + minute * 60 + second)
        while index < chars.count && (chars[index] == UInt8(ascii: " ") || chars[index] == UInt8(ascii: ".")) {
            if chars[index] == UInt8(ascii: ".") {
                index += 1
                while index < chars.count && chars[index] >= 48 && chars[index] <= 57 { index += 1 }
            } else {
                index += 1
            }
        }
        if index < chars.count, chars[index] == UInt8(ascii: "+") || chars[index] == UInt8(ascii: "-") {
            let sign = chars[index] == UInt8(ascii: "+") ? 1.0 : -1.0
            if let hh = number(index + 1, 2) {
                var mm = 0
                if let m = number(index + 3, 2) { mm = m } else if chars.count > index + 3, chars[index + 3] == UInt8(ascii: ":"), let m = number(index + 4, 2) { mm = m }
                seconds -= sign * Double(hh * 3600 + mm * 60)
            }
        }
        return Date(timeIntervalSince1970: seconds)
    }

    /// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm).
    static func daysFromCivil(_ year: Int, _ month: Int, _ day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    /// epgID → id, then nameToID[key(epgID)], nameToID[idKey(epgID)], nameToID[key(name)]; only if a real
    /// programme ends after `now`. Result keyed by channel key.
    public static func assign(_ result: Result, to channels: [Channel], now: Date) -> GuideSchedule {
        var schedule = GuideSchedule(updated: now)
        for channel in channels {
            let id = channel.epgID?.trimmingCharacters(in: .whitespaces).lowercased()
            var xid: String?
            if let id, !id.isEmpty {
                if result.programs[id] != nil || result.icons[id] != nil {
                    xid = id
                } else {
                    xid = result.nameToID[ChannelMatch.key(id)] ?? result.nameToID[ChannelMatch.idKey(id)]
                }
            }
            if xid == nil {
                let key = ChannelMatch.key(channel.name)
                if key.count >= 2 { xid = result.nameToID[key] }
            }
            guard let xid else { continue }
            if let list = result.programs[xid], list.contains(where: { $0.end > now && !$0.placeholder }) {
                schedule.programs[channel.key] = list
            }
            if let icon = result.icons[xid] { schedule.icons[channel.key] = icon }
        }
        return schedule
    }
}

/// XMLParser delegate for XMLTV (Android Xmltv.kt rules).
private final class XMLTVHandler: NSObject, XMLParserDelegate {
    let window: DateInterval
    var wantedIDs: Set<String>
    let wantedKeys: Set<String>
    let keepAll: Bool
    var programs: [String: [Program]] = [:]
    var names: [String: String] = [:]
    var regionalNames = Set<String>()
    var icons: [String: URL] = [:]

    private var channelID: String?
    private var inDisplayName = false
    private var programmeChannel: String?
    private var programmeStart: Date?
    private var programmeEnd: Date?
    private var keep = false
    private var field: String?
    private var text = ""
    private var title: String?
    private var subtitle: String?
    private var desc: String?

    init(window: DateInterval, wanted: XMLTV.Wanted) {
        self.window = window
        wantedIDs = wanted.ids
        wantedKeys = wanted.keys
        keepAll = wanted.ids.isEmpty && wanted.keys.isEmpty
    }

    private func addName(_ key: String, _ id: String, regional: Bool) {
        guard !key.isEmpty else { return }
        if names[key] == nil || (regionalNames.contains(key) && !regional) {
            names[key] = id
            if regional { regionalNames.insert(key) } else { regionalNames.remove(key) }
        }
        if wantedKeys.contains(key) { wantedIDs.insert(id) }
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        switch elementName {
        case "channel":
            if let raw = attributeDict["id"] {
                let id = raw.lowercased()
                channelID = id
                addName(ChannelMatch.idKey(raw), id, regional: ChannelMatch.isRegional(raw))
            }
        case "display-name":
            if channelID != nil { inDisplayName = true; text = "" }
        case "icon":
            if let id = channelID, programmeChannel == nil, icons[id] == nil, let src = attributeDict["src"], let link = Xtream.httpLink(src),
               let url = Xtream.makeURL(link) {
                icons[id] = url
            }
        case "programme":
            programmeChannel = attributeDict["channel"]?.lowercased()
            programmeStart = attributeDict["start"].flatMap(XMLTV.parseTime)
            programmeEnd = attributeDict["stop"].flatMap(XMLTV.parseTime)
            title = nil; subtitle = nil; desc = nil
            if let channel = programmeChannel, let start = programmeStart, let end = programmeEnd {
                keep = (keepAll || wantedIDs.contains(channel)) && end > window.start && start < window.end && end > start
            } else {
                keep = false
            }
        case "title", "sub-title", "desc":
            if keep { field = elementName; text = "" }
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inDisplayName || field != nil { text += string }
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        if inDisplayName || field != nil { text += String(decoding: CDATABlock, as: UTF8.self) }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        switch elementName {
        case "channel":
            channelID = nil
        case "display-name":
            if inDisplayName, let id = channelID {
                let name = text.trimmingCharacters(in: .whitespacesAndNewlines)
                addName(ChannelMatch.key(name), id, regional: ChannelMatch.isRegional(name))
            }
            inDisplayName = false
        case "title", "sub-title", "desc":
            guard field == elementName else { break }
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            switch elementName {
            case "title": if title == nil { title = value }
            case "sub-title": if subtitle == nil { subtitle = value }
            default: if desc == nil { desc = value }
            }
            field = nil
        case "programme":
            if keep, let channel = programmeChannel, let start = programmeStart, let end = programmeEnd {
                programs[channel, default: []].append(Program(start: start, end: end, title: title ?? "",
                                                              description: desc.flatMap { $0.isEmpty ? nil : $0 },
                                                              subtitle: subtitle.flatMap { $0.isEmpty ? nil : $0 }))
            }
            keep = false
            programmeChannel = nil
        default:
            break
        }
    }
}

public struct LogoIndex: Sendable, Hashable {
    private var byKey: [String: URL] = [:]
    private var usKeys: Set<String> = []

    public init() {}

    /// iptv-org logos.json (channel, url, in_use), indexed by idKey(channel); ".us" ids win.
    public init(json: Data) throws {
        let root = try XtreamParser.parse(json)
        for row in root.elements {
            guard let channel = row["channel"]?.text, let link = Xtream.httpLink(row["url"]?.text), let url = Xtream.makeURL(link) else { continue }
            if case .bool(false)? = row["in_use"] { continue }
            let key = ChannelMatch.idKey(channel)
            guard key.count >= 2 else { continue }
            let isUS = channel.lowercased().hasSuffix(".us")
            if byKey[key] == nil || (isUS && !usKeys.contains(key)) {
                byKey[key] = url
                if isUS { usKeys.insert(key) }
            }
        }
    }

    /// channel.logo, then the XMLTV icon, then index[key(name)], then index[idKey(epgID)].
    public func logo(for channel: Channel, xmltvIcon: URL?) -> URL? {
        if let logo = channel.logo { return logo }
        if let xmltvIcon { return xmltvIcon }
        if let url = byKey[ChannelMatch.key(channel.name)] { return url }
        if let epg = channel.epgID, let url = byKey[ChannelMatch.idKey(epg)] { return url }
        return nil
    }
}

/// Provider XMLTV (6 h TTL; xmltv.php for Xtream, guideURL or url-tvg for playlists), short EPG for Xtream gaps,
/// logos (7 days). No third-party guide sources in the App Store edition. The cached snapshot keeps the next 8 h,
/// max 32 programmes per channel (Caches/Guide).
public actor GuideService {
    static let guideTTL: TimeInterval = 6 * 3600
    static let logoTTL: TimeInterval = 7 * 24 * 3600

    private struct FileMeta: Codable {
        var url: String
        var fetched: Double
    }

    private let cacheDirectory: URL
    private let http: any HTTPClient
    private let now: @Sendable () -> Date
    private var current = GuideSchedule()
    private var continuations: [UUID: AsyncStream<GuideSchedule>.Continuation] = [:]
    private var generation = 0
    private var sourceDigest: String?
    private var shortTried = Set<String>()
    private var logoIndex: LogoIndex?

    public init(cacheDirectory: URL, http: any HTTPClient, now: @escaping @Sendable () -> Date = { Date() }) {
        self.cacheDirectory = cacheDirectory
        self.http = http
        self.now = now
    }

    public var schedule: GuideSchedule { current }

    public func schedules() -> AsyncStream<GuideSchedule> {
        let (stream, continuation) = AsyncStream.makeStream(of: GuideSchedule.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        continuations[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeContinuation(id) }
        }
        continuation.yield(current)
        return stream
    }

    private func removeContinuation(_ id: UUID) { continuations[id] = nil }

    private func publish() {
        for continuation in continuations.values { continuation.yield(current) }
    }

    private func file(_ name: String) -> URL { cacheDirectory.appendingPathComponent(name) }

    /// Window now − 4 h ... now + 3 days while parsing. Publishes the snapshot first, then fresh data.
    public func load(source: Source, lineup: LiveLineup, force: Bool = false) async {
        generation += 1
        let token = generation
        let digest = CatalogService.sourceDigest(source)
        let date = now()
        shortTried = []
        let keys = Set(lineup.channels.map(\.key))
        if sourceDigest != digest {
            sourceDigest = digest
            current = GuideSchedule()
            if let snapshot = SnapshotFiles.read(GuideSchedule.self, at: file("guide-\(digest).json")),
               date.timeIntervalSince1970 - snapshot.saved <= SnapshotFiles.maxAge {
                var restored = snapshot.payload
                restored.programs = restored.programs.filter { keys.contains($0.key) }.mapValues { $0.filter { $0.end > date } }
                    .filter { !$0.value.isEmpty }
                restored.icons = restored.icons.filter { keys.contains($0.key) }
                current = restored
            }
            publish()
        }

        let guideURL: URL?
        if let link = Xtream.httpLink(source.guideURL) {
            guideURL = Xtream.makeURL(link)
        } else if source.kind == .xtream, let login = source.xtreamLogin {
            guideURL = Xtream.guideURL(login)
        } else {
            guideURL = lineup.playlistGuideURL
        }
        // Without channels nothing would be wanted (and an empty wish list keeps the whole guide): skip it.
        guard let guideURL, !lineup.channels.isEmpty else { return }

        let xmlFile = file("xmltv-\(digest).xml")
        let metaFile = file("xmltv-\(digest).meta.json")
        var usable = FileManager.default.fileExists(atPath: xmlFile.path)
        let meta = (try? Data(contentsOf: metaFile)).flatMap { try? JSONDecoder().decode(FileMeta.self, from: $0) }
        let fresh = usable && meta?.url == guideURL.absoluteString && date.timeIntervalSince1970 - (meta?.fetched ?? 0) < GuideService.guideTTL
        if force || !fresh {
            do {
                _ = try await http.download(HTTPRequestSpec(url: guideURL), to: xmlFile)
                let data = try JSONEncoder().encode(FileMeta(url: guideURL.absoluteString, fetched: date.timeIntervalSince1970))
                try? data.write(to: metaFile, options: .atomic)
                usable = true
            } catch {
                // A stale guide beats none; without one the snapshot (if any) stays.
                usable = usable && meta?.url == guideURL.absoluteString
            }
        }
        guard usable, token == generation else { return }
        let channels = lineup.channels
        let window = DateInterval(start: date.addingTimeInterval(-4 * 3600), end: date.addingTimeInterval(3 * 24 * 3600))
        let parsed = await Task.detached(priority: .utility) { () -> GuideSchedule? in
            guard let result = try? XMLTV.parse(fileURL: xmlFile, window: window, wanted: XMLTV.Wanted(channels: channels)) else { return nil }
            return XMLTV.assign(result, to: channels, now: date)
        }.value
        guard token == generation, var schedule = parsed else { return }
        // Short EPG results fill only channels the provider's guide left empty.
        for (key, list) in current.programs where schedule.programs[key] == nil && keys.contains(key) && list.contains(where: { $0.end > date }) {
            schedule.programs[key] = list
        }
        current = schedule
        publish()
        saveSnapshot(digest: digest, date: date)
    }

    private func saveSnapshot(digest: String, date: Date) {
        var trimmed = current
        let horizon = date.addingTimeInterval(8 * 3600)
        trimmed.programs = trimmed.programs.mapValues { list in Array(list.filter { $0.end > date && $0.start < horizon }.prefix(32)) }
            .filter { !$0.value.isEmpty }
        let snapshot = Snapshot(identity: digest, saved: date.timeIntervalSince1970, payload: trimmed)
        SnapshotFiles.enqueue(snapshot, to: file("guide-\(digest).json"))
    }

    /// Xtream only: channels without data, once per channel per load, at most 4 requests at a time, limit=24.
    public func requestShortEPG(for channels: [Channel], source: Source) async {
        guard source.kind == .xtream, let login = source.xtreamLogin else { return }
        let token = generation
        let date = now()
        let wanted = channels.filter { channel in
            guard channel.streamID != nil, !shortTried.contains(channel.key) else { return false }
            return !(current.programs[channel.key]?.contains { $0.end > date } ?? false)
        }
        guard !wanted.isEmpty else { return }
        for channel in wanted { shortTried.insert(channel.key) }
        let client = XtreamClient(login: login, http: http)
        await withTaskGroup(of: (String, [Program]?).self) { group in
            var pending = wanted[...]
            func next() {
                guard let channel = pending.popFirst(), let streamID = channel.streamID else { return }
                group.addTask { (channel.key, try? await client.shortEPG(streamID: streamID, limit: 24)) }
            }
            for _ in 0..<4 { next() }
            while let (key, programs) = await group.next() {
                next()
                guard token == generation, let programs, programs.contains(where: { $0.end > date }) else { continue }
                if current.programs[key]?.contains(where: { $0.end > date }) ?? false { continue }
                current.programs[key] = programs
                publish()
            }
        }
    }

    public func logos() async -> LogoIndex {
        if let logoIndex { return logoIndex }
        let date = now()
        let dataFile = file("logos.json")
        let metaFile = file("logos.meta.json")
        let meta = (try? Data(contentsOf: metaFile)).flatMap { try? JSONDecoder().decode(FileMeta.self, from: $0) }
        let cached = try? Data(contentsOf: dataFile)
        if let cached, let meta, date.timeIntervalSince1970 - meta.fetched < GuideService.logoTTL, let index = try? LogoIndex(json: cached) {
            logoIndex = index
            return index
        }
        if let fresh = try? await http.data(HTTPRequestSpec(url: TunerLinks.logos)).body, let index = try? LogoIndex(json: fresh) {
            try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
            try? fresh.write(to: dataFile, options: .atomic)
            if let data = try? JSONEncoder().encode(FileMeta(url: TunerLinks.logos.absoluteString, fetched: date.timeIntervalSince1970)) {
                try? data.write(to: metaFile, options: .atomic)
            }
            logoIndex = index
            return index
        }
        if let cached, let index = try? LogoIndex(json: cached) {
            logoIndex = index
            return index
        }
        return LogoIndex()
    }

    public func clearCaches() async {
        SnapshotFiles.removeAll(in: cacheDirectory)
        shortTried = []
        logoIndex = nil
    }
}

// MARK: - Guide chips and lineups

public enum CategoryOrder: String, Codable, Sendable, CaseIterable {
    case featured
    case provider
    case az
    /// "Featured", "Hub order", "A to Z".
    public var label: String {
        switch self {
        case .featured: return "Featured"
        case .provider: return "Hub order"
        case .az: return "A to Z"
        }
    }

    /// featured → provider → az → featured.
    public var next: CategoryOrder {
        switch self {
        case .featured: return .provider
        case .provider: return .az
        case .az: return .featured
        }
    }
}

public enum GuideChip: Hashable, Sendable {
    case all
    case favorites
    case mostWatched
    case category(String)
}

public struct GuideChipItem: Hashable, Sendable, Identifiable {
    public var chip: GuideChip
    public var title: String
    public var id: GuideChip { chip }
    public init(chip: GuideChip, title: String) { self.chip = chip; self.title = title }
}

public struct EmptyMessage: Sendable, Hashable {
    public var title: String
    public var detail: String?
    public init(title: String, detail: String? = nil) { self.title = title; self.detail = detail }
}

public enum GuideLineup {
    private static let leadingSymbols = Pattern(#"^[^\p{L}\p{N}]+"#)
    private static let separators = Pattern(#"[^A-Z0-9]+"#)

    /// "All Channels", "Favorites", "Most Watched", then categories in the chosen order.
    public static func chips(_ categories: [Category], order: CategoryOrder) -> [GuideChipItem] {
        var seen = Set<String>()
        let provider = categories.filter { seen.insert($0.id).inserted }
        let ordered: [Category]
        switch order {
        case .provider:
            ordered = provider
        case .az:
            ordered = provider.enumerated().sorted { a, b in
                let x = leadingSymbols.replace(a.element.name, with: "").lowercased()
                let y = leadingSymbols.replace(b.element.name, with: "").lowercased()
                return x != y ? x < y : a.offset < b.offset
            }.map(\.element)
        case .featured:
            ordered = provider.enumerated().sorted { a, b in
                let x = featuredRank(a.element.name), y = featuredRank(b.element.name)
                return x != y ? x < y : a.offset < b.offset
            }.map(\.element)
        }
        return [GuideChipItem(chip: .all, title: "All Channels"), GuideChipItem(chip: .favorites, title: "Favorites"),
                GuideChipItem(chip: .mostWatched, title: "Most Watched")] + ordered.map { GuideChipItem(chip: .category($0.id), title: $0.name) }
    }

    /// SPORTS 0, PREMIUM 1, NEWS 2, MOVIES 3, ENTERTAINMENT 4, DOCUMENTARIES 5, LOCAL NEWS 6, else 7.
    public static func featuredRank(_ name: String) -> Int {
        var normalized = separators.replace(name.uppercased(), with: " ").trimmingCharacters(in: .whitespaces)
        if normalized.hasPrefix("USA ") { normalized.removeFirst(4) }
        if normalized.hasPrefix("US ") { normalized.removeFirst(3) }
        switch normalized {
        case "SPORTS": return 0
        case "PREMIUM": return 1
        case "NEWS": return 2
        case "MOVIES": return 3
        case "ENTERTAINMENT": return 4
        case "DOCUMENTARIES": return 5
        case "LOCAL NEWS": return 6
        default: return 7
        }
    }

    /// `mostWatched` is the ranked key list from `UserLibrary.mostWatched` (already canonical); max 50 shown.
    public static func channels(for chip: GuideChip, lineup: LiveLineup, favorites: Set<String>, mostWatched: [String]) -> [Channel] {
        switch chip {
        case .all:
            return lineup.channels
        case .category(let id):
            return lineup.channels.filter { $0.categoryIDs.contains(id) }
        case .favorites:
            let canonical = Set(favorites.map(lineup.canonical))
            return lineup.channels.filter { canonical.contains($0.key) }
        case .mostWatched:
            var byKey: [String: Channel] = [:]
            for channel in lineup.channels where byKey[channel.key] == nil { byKey[channel.key] = channel }
            var seen = Set<String>()
            var result: [Channel] = []
            for key in mostWatched {
                guard let channel = byKey[lineup.canonical(key)], seen.insert(channel.key).inserted else { continue }
                result.append(channel)
                if result.count == 50 { break }
            }
            return result
        }
    }

    /// Favorites: "No favorites yet" / "Press and hold Select on any channel to add it here."
    /// Most Watched: "No Most Watched channels yet" / "Watch live TV and the channels you use most will appear here."
    /// Category: "No channels in this category". USA-only with nothing left: "No matching USA channels".
    public static func emptyMessage(for chip: GuideChip, usOnly: Bool) -> EmptyMessage {
        switch chip {
        case .favorites:
            return EmptyMessage(title: "No favorites yet", detail: "Press and hold Select on any channel to add it here.")
        case .mostWatched:
            return EmptyMessage(title: "No Most Watched channels yet", detail: "Watch live TV and the channels you use most will appear here.")
        case .category:
            return EmptyMessage(title: "No channels in this category")
        case .all:
            return usOnly ? EmptyMessage(title: "No matching USA channels", detail: "Switch Channels to All in Settings to see the whole lineup.")
                : EmptyMessage(title: "No channels yet", detail: "Your channels will appear here once they load.")
        }
    }
}
