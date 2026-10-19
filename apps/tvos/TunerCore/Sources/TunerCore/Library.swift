import Foundation

// MARK: - Storage abstractions

/// Small persistent values. The app uses `UserDefaultsKeyValueStore` (UserDefaults is the only persistent local
/// storage on tvOS, ~500 KB budget); tests use `InMemoryKeyValueStore`.
public protocol KeyValueStore: AnyObject, Sendable {
    func data(forKey key: String) -> Data?
    func set(_ data: Data?, forKey key: String)
}

public final class InMemoryKeyValueStore: KeyValueStore, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    public init() {}

    public func data(forKey key: String) -> Data? {
        lock.lock(); defer { lock.unlock() }
        return values[key]
    }

    public func set(_ data: Data?, forKey key: String) {
        lock.lock(); defer { lock.unlock() }
        values[key] = data
    }
}

public final class UserDefaultsKeyValueStore: KeyValueStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let prefix: String

    /// Keys are stored as "<prefix><key>".
    public init(defaults: UserDefaults = .standard, prefix: String = "tuner.") {
        self.defaults = defaults
        self.prefix = prefix
    }

    public func data(forKey key: String) -> Data? { defaults.data(forKey: prefix + key) }

    public func set(_ data: Data?, forKey key: String) {
        if let data { defaults.set(data, forKey: prefix + key) } else { defaults.removeObject(forKey: prefix + key) }
    }
}

/// Line passwords. The app implements this with the Keychain (Security framework, Apple only).
public protocol SecretStore: AnyObject, Sendable {
    func secret(forAccount account: String) -> String?
    func setSecret(_ value: String?, forAccount account: String)
}

public final class InMemorySecretStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var secrets: [String: String] = [:]

    public init() {}

    public func secret(forAccount account: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return secrets[account]
    }

    public func setSecret(_ value: String?, forAccount account: String) {
        lock.lock(); defer { lock.unlock() }
        secrets[account] = value
    }
}

// MARK: - Sources

/// Sources in key "sources" (JSON, password removed), passwords in `SecretStore` (account = source id),
/// active id in "active". Thread-safe (NSLock).
public final class SourceStore: @unchecked Sendable {
    private let store: any KeyValueStore
    private let secrets: any SecretStore
    private let lock = NSLock()

    public init(store: any KeyValueStore, secrets: any SecretStore) {
        self.store = store
        self.secrets = secrets
    }

    private func readStored() -> [Source] {
        guard let data = store.data(forKey: "sources"), let list = try? JSONDecoder().decode([Source].self, from: data) else { return [] }
        return list
    }

    private func writeStored(_ list: [Source]) {
        let stripped = list.map { source -> Source in
            var copy = source
            copy.password = ""
            return copy
        }
        store.set(try? JSONEncoder().encode(stripped), forKey: "sources")
    }

    private func storedActiveID() -> String? {
        store.data(forKey: "active").flatMap { String(data: $0, encoding: .utf8) }
    }

    public func all() -> [Source] {
        lock.lock(); defer { lock.unlock() }
        return readStored().map { source in
            var copy = source
            copy.password = secrets.secret(forAccount: source.id) ?? ""
            return copy
        }
    }

    public func active() -> Source? {
        guard let id = activeID else { return nil }
        return all().first { $0.id == id }
    }

    public var activeID: String? {
        lock.lock(); defer { lock.unlock() }
        guard let id = storedActiveID(), readStored().contains(where: { $0.id == id }) else { return nil }
        return id
    }

    /// Inserts or replaces by id.
    public func save(_ source: Source) {
        lock.lock(); defer { lock.unlock() }
        var list = readStored()
        if let index = list.firstIndex(where: { $0.id == source.id }) { list[index] = source } else { list.append(source) }
        secrets.setSecret(source.password.isEmpty ? nil : source.password, forAccount: source.id)
        writeStored(list)
    }

    /// Also deletes its password. Deleting the active source makes the first remaining one active (or none).
    public func delete(id: String) {
        lock.lock(); defer { lock.unlock() }
        let list = readStored().filter { $0.id != id }
        writeStored(list)
        secrets.setSecret(nil, forAccount: id)
        if storedActiveID() == id {
            store.set(list.first.map { Data($0.id.utf8) }, forKey: "active")
        }
    }

    public func setActive(id: String?) {
        lock.lock(); defer { lock.unlock() }
        store.set(id.map { Data($0.utf8) }, forKey: "active")
    }
}

// MARK: - Settings

public enum SubtitleMode: String, Codable, Sendable, CaseIterable {
    /// Follow the Apple TV setting (Settings → Accessibility → Subtitles and Captioning).
    case automatic
    case on
    case off
    /// "Automatic", "On", "Off".
    public var label: String {
        switch self {
        case .automatic: return "Automatic"
        case .on: return "On"
        case .off: return "Off"
        }
    }
}

/// Decoding never fails on missing or unknown keys: each missing key takes its default (custom `init(from:)`).
public struct TunerSettings: Codable, Sendable, Hashable {
    /// Live TV "Channels": false = All (the lineup chosen in the customer hub, the default), true = USA only.
    public var usOnly: Bool
    /// "Movies & Series: USA only / All" (docs/browse.md), default USA only.
    public var titlesUSOnly: Bool
    public var categoryOrder: CategoryOrder
    /// Play the last channel in the guide's preview window.
    public var guidePreview: Bool
    public var subtitles: SubtitleMode
    /// Open on Live TV instead of Home.
    public var startOnLiveTV: Bool

    public init(usOnly: Bool = false, titlesUSOnly: Bool = true, categoryOrder: CategoryOrder = .featured, guidePreview: Bool = true,
                subtitles: SubtitleMode = .automatic, startOnLiveTV: Bool = false) {
        self.usOnly = usOnly; self.titlesUSOnly = titlesUSOnly; self.categoryOrder = categoryOrder
        self.guidePreview = guidePreview; self.subtitles = subtitles; self.startOnLiveTV = startOnLiveTV
    }

    private enum CodingKeys: String, CodingKey {
        case usOnly, titlesUSOnly, categoryOrder, guidePreview, subtitles, startOnLiveTV
    }

    public init(from decoder: any Decoder) throws {
        let defaults = TunerSettings()
        guard let container = try? decoder.container(keyedBy: CodingKeys.self) else {
            self = defaults
            return
        }
        usOnly = (try? container.decodeIfPresent(Bool.self, forKey: .usOnly)) ?? defaults.usOnly
        titlesUSOnly = (try? container.decodeIfPresent(Bool.self, forKey: .titlesUSOnly)) ?? defaults.titlesUSOnly
        categoryOrder = ((try? container.decodeIfPresent(String.self, forKey: .categoryOrder)) ?? nil).flatMap(CategoryOrder.init(rawValue:))
            ?? defaults.categoryOrder
        guidePreview = (try? container.decodeIfPresent(Bool.self, forKey: .guidePreview)) ?? defaults.guidePreview
        subtitles = ((try? container.decodeIfPresent(String.self, forKey: .subtitles)) ?? nil).flatMap(SubtitleMode.init(rawValue:))
            ?? defaults.subtitles
        startOnLiveTV = (try? container.decodeIfPresent(Bool.self, forKey: .startOnLiveTV)) ?? defaults.startOnLiveTV
    }
}

// MARK: - Per-source library (favorites, Most Watched, recents, history, last channel, dead channels)

public struct WatchCount: Codable, Sendable, Hashable {
    public var count: Int
    public var updated: Date
    public init(count: Int, updated: Date) { self.count = count; self.updated = updated }
}

/// Thread-safe (NSLock), synchronous, small. Keys: "settings", "fav.<sid>" (channel keys), "favTitles.<sid>"
/// (movie/series ids), "watched.<sid>" (top 500), "recents.<sid>" (newest first, max 40), "history.<sid>" (max 60),
/// "last.<sid>", "dead.<sid>" (key → hidden-at, 3 days).
public final class UserLibrary: @unchecked Sendable {
    static let deadFor: TimeInterval = 3 * 24 * 3600
    static let maxWatched = 500
    static let maxRecents = 40
    static let maxHistory = 60

    private let store: any KeyValueStore
    private let now: @Sendable () -> Date
    private let lock = NSLock()

    public init(store: any KeyValueStore, now: @escaping @Sendable () -> Date = { Date() }) {
        self.store = store
        self.now = now
    }

    // MARK: storage helpers (callers hold the lock)

    private func read<T: Decodable>(_ type: T.Type, _ key: String) -> T? {
        guard let data = store.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func write<T: Encodable>(_ value: T?, _ key: String) {
        guard let value else { store.set(nil, forKey: key); return }
        store.set(try? JSONEncoder().encode(value), forKey: key)
    }

    private func readString(_ key: String) -> String? {
        store.data(forKey: key).flatMap { String(data: $0, encoding: .utf8) }.flatMap { $0.isEmpty ? nil : $0 }
    }

    private func writeString(_ value: String?, _ key: String) { store.set(value.map { Data($0.utf8) }, forKey: key) }

    public var settings: TunerSettings {
        lock.lock(); defer { lock.unlock() }
        return read(TunerSettings.self, "settings") ?? TunerSettings()
    }

    public func updateSettings(_ change: (inout TunerSettings) -> Void) {
        lock.lock(); defer { lock.unlock() }
        var value = read(TunerSettings.self, "settings") ?? TunerSettings()
        change(&value)
        write(value, "settings")
    }

    /// Rewrites stored channel keys (favorites, watch history, last channel) through a new lineup's aliases.
    public func canonicalize(sourceID: String, aliases: [String: String]) {
        guard !aliases.isEmpty else { return }
        func resolve(_ key: String) -> String {
            var current = key
            var visited = Set<String>()
            while let next = aliases[current], next != current, visited.insert(current).inserted { current = next }
            return current
        }
        lock.lock(); defer { lock.unlock() }
        let favorites = read(Set<String>.self, "fav.\(sourceID)") ?? []
        let mapped = Set(favorites.map(resolve))
        if mapped != favorites { write(mapped, "fav.\(sourceID)") }
        let watched = readWatched(sourceID)
        if watched.keys.contains(where: { resolve($0) != $0 }) {
            var merged: [String: WatchCount] = [:]
            for (key, value) in watched {
                let target = resolve(key)
                if let existing = merged[target] {
                    merged[target] = WatchCount(count: UserLibrary.adding(existing.count, value.count), updated: max(existing.updated, value.updated))
                } else {
                    merged[target] = value
                }
            }
            write(merged, "watched.\(sourceID)")
        }
        if let last = readString("last.\(sourceID)"), resolve(last) != last { writeString(resolve(last), "last.\(sourceID)") }
    }

    // MARK: Live TV

    public func favorites(sourceID: String) -> Set<String> {
        lock.lock(); defer { lock.unlock() }
        return read(Set<String>.self, "fav.\(sourceID)") ?? []
    }

    /// Returns the new state (true = now a favorite).
    @discardableResult
    public func toggleFavorite(_ key: String, sourceID: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        var set = read(Set<String>.self, "fav.\(sourceID)") ?? []
        let added: Bool
        if set.contains(key) { set.remove(key); added = false } else { set.insert(key); added = true }
        write(set, "fav.\(sourceID)")
        return added
    }

    /// Called once per explicit tune when the stream first plays (never for preview restores, retries or skips).
    public func recordWatch(_ key: String, sourceID: String) {
        guard !key.isEmpty else { return }
        let date = now()
        lock.lock(); defer { lock.unlock() }
        var history = readWatched(sourceID)
        let previous = history[key]
        history[key] = WatchCount(count: UserLibrary.adding(previous?.count ?? 0, 1), updated: max(previous?.updated ?? date, date))
        let kept = UserLibrary.ranked(history).prefix(UserLibrary.maxWatched)
        write(Dictionary(uniqueKeysWithValues: kept.map { ($0, history[$0]!) }), "watched.\(sourceID)")
    }

    /// Saturating: a corrupt or huge stored count never traps.
    private static func adding(_ a: Int, _ b: Int) -> Int {
        let (sum, overflow) = max(0, a).addingReportingOverflow(max(0, b))
        return overflow ? Int.max : sum
    }

    /// The watch history; entries that don't decode are skipped instead of discarding the rest.
    private func readWatched(_ sourceID: String) -> [String: WatchCount] {
        guard let data = store.data(forKey: "watched.\(sourceID)"),
              let entries = try? JSONDecoder().decode([String: LenientEntry<WatchCount>].self, from: data) else { return [:] }
        return entries.compactMapValues { $0.value.flatMap { $0.count > 0 ? $0 : nil } }
    }

    private static func ranked(_ history: [String: WatchCount]) -> [String] {
        history.sorted { a, b in
            if a.value.count != b.value.count { return a.value.count > b.value.count }
            if a.value.updated != b.value.updated { return a.value.updated > b.value.updated }
            return a.key < b.key
        }.map(\.key)
    }

    /// Count desc, updated desc, key asc.
    public func mostWatched(sourceID: String, limit: Int = 50) -> [String] {
        lock.lock(); defer { lock.unlock() }
        return Array(UserLibrary.ranked(readWatched(sourceID)).prefix(max(0, limit)))
    }

    public func lastChannel(sourceID: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return readString("last.\(sourceID)")
    }

    public func setLastChannel(_ key: String, sourceID: String) {
        lock.lock(); defer { lock.unlock() }
        writeString(key, "last.\(sourceID)")
    }

    /// Keys hidden in the last 3 days.
    public func deadChannels(sourceID: String) -> Set<String> {
        let date = now()
        lock.lock(); defer { lock.unlock() }
        let dead = read([String: Date].self, "dead.\(sourceID)") ?? [:]
        return Set(dead.filter { date.timeIntervalSince($0.value) < UserLibrary.deadFor }.keys)
    }

    public func reportDead(_ keys: [String], sourceID: String) {
        let date = now()
        lock.lock(); defer { lock.unlock() }
        var dead = (read([String: Date].self, "dead.\(sourceID)") ?? [:]).filter { date.timeIntervalSince($0.value) < UserLibrary.deadFor }
        for key in keys where !key.isEmpty { dead[key] = date }
        write(dead, "dead.\(sourceID)")
    }

    public func clearDead(sourceID: String) {
        lock.lock(); defer { lock.unlock() }
        store.set(nil, forKey: "dead.\(sourceID)")
    }

    // MARK: Movies & Series

    public func favoriteTitles(sourceID: String) -> Set<String> {
        lock.lock(); defer { lock.unlock() }
        return read(Set<String>.self, "favTitles.\(sourceID)") ?? []
    }

    @discardableResult
    public func toggleFavoriteTitle(_ titleID: String, sourceID: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        var set = read(Set<String>.self, "favTitles.\(sourceID)") ?? []
        let added: Bool
        if set.contains(titleID) { set.remove(titleID); added = false } else { set.insert(titleID); added = true }
        write(set, "favTitles.\(sourceID)")
        return added
    }

    public func recents(sourceID: String) -> [RecentItem] {
        lock.lock(); defer { lock.unlock() }
        return read([RecentItem].self, "recents.\(sourceID)") ?? []
    }

    /// Applies `ResumePolicy` (save/update and move to front, remove when finished, ignore the first 15 s).
    /// Saving an episode removes the other recents of the same series (one entry per series).
    public func saveProgress(_ item: RecentItem, sourceID: String) {
        lock.lock(); defer { lock.unlock() }
        var list = read([RecentItem].self, "recents.\(sourceID)") ?? []
        switch ResumePolicy.decide(positionMs: item.positionMs, durationMs: item.durationMs) {
        case .ignore:
            return
        case .remove:
            list.removeAll { $0.id == item.id }
        case .save:
            var saved = item
            saved.upNext = false
            list.removeAll { $0.id == item.id || (item.kind == .episode && item.seriesID != nil && $0.seriesID == item.seriesID) }
            list.insert(saved, at: 0)
        }
        write(Array(list.prefix(UserLibrary.maxRecents)), "recents.\(sourceID)")
    }

    /// After an episode finishes: stores the next episode (position 0, `upNext = true`) as the series' entry.
    public func saveUpNext(_ item: RecentItem, sourceID: String) {
        lock.lock(); defer { lock.unlock() }
        var list = read([RecentItem].self, "recents.\(sourceID)") ?? []
        var next = item
        next.positionMs = 0
        next.upNext = true
        list.removeAll { $0.id == item.id || (item.seriesID != nil && $0.seriesID == item.seriesID) }
        list.insert(next, at: 0)
        write(Array(list.prefix(UserLibrary.maxRecents)), "recents.\(sourceID)")
    }

    /// Removes the recent with this id, or every recent of the series with this id.
    public func removeRecent(id: String, sourceID: String) {
        lock.lock(); defer { lock.unlock() }
        var list = read([RecentItem].self, "recents.\(sourceID)") ?? []
        list.removeAll { $0.id == id || $0.seriesID == id }
        write(list, "recents.\(sourceID)")
    }

    public func history(sourceID: String) -> [HistoryEntry] {
        lock.lock(); defer { lock.unlock() }
        return read([HistoryEntry].self, "history.\(sourceID)") ?? []
    }

    /// Moves the title to the front (called when playback of a movie or episode starts).
    public func recordHistory(titleID: String, kind: TitleKind, sourceID: String) {
        let date = now()
        lock.lock(); defer { lock.unlock() }
        var list = read([HistoryEntry].self, "history.\(sourceID)") ?? []
        list.removeAll { $0.titleID == titleID }
        list.insert(HistoryEntry(titleID: titleID, kind: kind, updated: date), at: 0)
        write(Array(list.prefix(UserLibrary.maxHistory)), "history.\(sourceID)")
    }

    public func snapshot(sourceID: String) -> LibrarySnapshot {
        lock.lock(); defer { lock.unlock() }
        return LibrarySnapshot(favoriteTitles: read(Set<String>.self, "favTitles.\(sourceID)") ?? [],
                               recents: read([RecentItem].self, "recents.\(sourceID)") ?? [],
                               history: read([HistoryEntry].self, "history.\(sourceID)") ?? [])
    }

    public func removeAll(sourceID: String) {
        lock.lock(); defer { lock.unlock() }
        for prefix in ["fav", "favTitles", "watched", "recents", "history", "last", "dead"] {
            store.set(nil, forKey: "\(prefix).\(sourceID)")
        }
    }
}

/// Decodes `T` when it can and nil otherwise, so one bad entry doesn't fail a whole stored collection.
struct LenientEntry<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: any Decoder) throws { value = try? T(from: decoder) }
}
