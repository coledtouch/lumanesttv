import AVFoundation
import Foundation
import Observation
import SwiftUI
import TunerCore

/// The app's state and services. Views read it from the environment; everything that touches the network, the
/// catalogue or the provider line lives in TunerCore (actors) and is awaited from here.
@MainActor
@Observable
final class AppModel {
    // MARK: Services (constants, not observed)

    let sources: SourceStore
    let library: UserLibrary
    /// Provider API, guide, artwork and subtitle requests (VLC User-Agent, like the other Tuner apps).
    let http: URLSessionHTTPClient
    /// lumanest.tv requests: pairing and the catalog rows.
    let lumanestHTTP: URLSessionHTTPClient
    let catalog: CatalogService
    let guide: GuideService
    let rowsService: CatalogRowsService
    let media: MediaServer
    let loopback: LoopbackServer
    let playback: PlaybackController

    // MARK: Observed state

    /// False until `start()` has read the saved login (the root view shows a plain screen until then).
    private(set) var started = false
    private(set) var source: Source?
    private(set) var allSources: [Source] = []
    private(set) var catalogState = CatalogState()
    private(set) var schedule = GuideSchedule()
    private(set) var logos = LogoIndex()
    private(set) var rows = CatalogRows.none
    private(set) var browse = BrowseIndex.empty
    private(set) var librarySnapshot = LibrarySnapshot.empty
    private(set) var favorites: Set<String> = []
    private(set) var mostWatched: [String] = []
    private(set) var deadChannels: Set<String> = []
    private(set) var settings = TunerSettings()
    private(set) var accountSummary: String?
    var selectedTab: AppTab = .home
    var discoverQuery = DiscoverQuery()
    var guideChip: GuideChip = .all
    private(set) var toast: String?
    var homePath: [TitleRoute] = []
    var discoverPath: [TitleRoute] = []
    var libraryPath: [TitleRoute] = []
    var searchPath: [TitleRoute] = []

    // MARK: Private

    @ObservationIgnored private var didStart = false
    @ObservationIgnored private var browseTask: Task<Void, Never>?
    @ObservationIgnored private var toastTask: Task<Void, Never>?
    @ObservationIgnored private var logosTask: Task<Void, Never>?
    @ObservationIgnored private var lastOrigin: URL?

    init() {
        let store = UserDefaultsKeyValueStore()
        sources = SourceStore(store: store, secrets: KeychainSecretStore())
        library = UserLibrary(store: store)
        let http = URLSessionHTTPClient()
        self.http = http
        lumanestHTTP = URLSessionHTTPClient(userAgent: TunerLinks.lumanestUserAgent)
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        catalog = CatalogService(cacheDirectory: caches.appendingPathComponent("Catalog", isDirectory: true), http: http)
        guide = GuideService(cacheDirectory: caches.appendingPathComponent("Guide", isDirectory: true), http: http)
        rowsService = CatalogRowsService(cacheDirectory: caches.appendingPathComponent("Rows", isDirectory: true), http: lumanestHTTP)
        let media = MediaServer(transport: URLSessionUpstreamTransport())
        self.media = media
        loopback = LoopbackServer(media: media)
        playback = PlaybackController(media: media, http: http)
        settings = library.settings
        playback.model = self
    }

    // MARK: Start, background and foreground

    func start() async {
        guard !didStart else { return }
        didStart = true
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        } catch {
            NSLog("Tuner: audio session category failed: %@", String(describing: error))
        }
        lastOrigin = try? await loopback.ensureRunning()
        settings = library.settings
        reloadSources()
        selectedTab = settings.startOnLiveTV ? .live : .home
        started = true
        observeServices()
        if source != nil { loadCatalog(force: false) }
    }

    private func observeServices() {
        Task { [weak self] in
            guard let stream = await self?.catalog.states() else { return }
            for await state in stream {
                self?.receive(state)
            }
        }
        Task { [weak self] in
            guard let stream = await self?.guide.schedules() else { return }
            for await schedule in stream {
                self?.schedule = schedule
            }
        }
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        guard didStart else { return }
        switch phase {
        case .background:
            playback.enterBackground()
            // tvOS reclaims a suspended app's sockets: start a fresh listener when the app comes back.
            loopback.stop()
        case .active:
            Task { await self.returnToForeground() }
        default:
            break
        }
    }

    private func returnToForeground() async {
        let origin = try? await loopback.ensureRunning()
        let restarted = origin != nil && origin != lastOrigin
        if origin != nil { lastOrigin = origin }
        playback.enterForeground(serverRestarted: restarted)
        if source != nil { loadCatalog(force: false) }
    }

    /// Called by the root view when the tab bar selection changes.
    func tabChanged(from old: AppTab, to new: AppTab) {
        if old == .live && new != .live { playback.leftLiveTab() }
    }

    // MARK: Catalogue

    private func receive(_ state: CatalogState) {
        let previous = catalogState
        catalogState = state
        guard let source, state.sourceID == source.id else { return }
        if let live = state.live, live != previous.live {
            library.canonicalize(sourceID: source.id, aliases: live.aliases)
            refreshLibrary()
            if case .category(let id) = guideChip, !live.categories.contains(where: { $0.id == id }) {
                guideChip = .all
            }
            let lineup = live
            Task { await self.guide.load(source: source, lineup: lineup) }
            if logosTask == nil {
                logosTask = Task { [weak self] in
                    guard let index = await self?.guide.logos() else { return }
                    self?.logos = index
                }
            }
        }
        if state.movies != previous.movies || state.series != previous.series {
            rebuildBrowse()
        }
    }

    /// Loads (or refreshes when stale or `force`) the live lineup, movies, series and the catalog rows.
    func loadCatalog(force: Bool) {
        guard let source else { return }
        refreshLibrary()
        let options = catalogOptions(for: source)
        Task { await self.catalog.load(source, options: options, force: force) }
        Task { [weak self] in
            guard let self else { return }
            let rows = await self.rowsService.rows(force: force)
            guard rows != self.rows else { return }
            self.rows = rows
            self.rebuildBrowse()
        }
        if source.kind == .xtream {
            Task { await self.refreshAccountSummary() }
        } else {
            accountSummary = nil
        }
    }

    /// Settings → Refresh: catalogue, rows and guide, even when fresh.
    func refreshAll() {
        guard let source else { return }
        loadCatalog(force: true)
        if let live = catalogState.live {
            Task { await self.guide.load(source: source, lineup: live, force: true) }
        }
        showToast("Refreshing channels, movies and the guide…")
    }

    /// Settings → Clear cached data: snapshots, guide, rows and artwork, then a fresh load.
    func clearCaches() async {
        await catalog.clearCaches()
        await guide.clearCaches()
        await rowsService.clearCache()
        URLCache.shared.removeAllCachedResponses()
        logosTask = nil
        loadCatalog(force: true)
        showToast("Cached data cleared")
    }

    private func catalogOptions(for source: Source) -> CatalogOptions {
        CatalogOptions(usOnly: settings.usOnly, hiddenChannels: library.deadChannels(sourceID: source.id))
    }

    /// Re-applies USA-only and hidden channels to the lineup without downloading it again.
    private func reapplyLiveOptions() {
        guard let source else { return }
        let options = catalogOptions(for: source)
        Task { await self.catalog.apply(options, source: source) }
    }

    private func rebuildBrowse() {
        browseTask?.cancel()
        let movies = catalogState.movies
        let series = catalogState.series
        let rows = self.rows
        let usOnly = settings.titlesUSOnly
        browseTask = Task { [weak self] in
            let index = await Task.detached(priority: .userInitiated) {
                BrowseIndex(movies: movies, series: series, rows: rows, usOnly: usOnly)
            }.value
            guard !Task.isCancelled else { return }
            self?.browse = index
        }
    }

    func refreshAccountSummary() async {
        guard let login = source?.xtreamLogin else {
            accountSummary = nil
            return
        }
        let info = try? await XtreamClient(login: login, http: http).accountInfo()
        accountSummary = info?.summary
    }

    // MARK: Library state

    func refreshLibrary() {
        guard let id = source?.id else {
            librarySnapshot = .empty
            favorites = []
            mostWatched = []
            deadChannels = []
            return
        }
        librarySnapshot = library.snapshot(sourceID: id)
        favorites = library.favorites(sourceID: id)
        mostWatched = library.mostWatched(sourceID: id)
        deadChannels = library.deadChannels(sourceID: id)
    }

    func movie(id: String) -> Movie? {
        browse.movie(id: id) ?? catalogState.movies?.movie(id: id)
    }

    func series(id: String) -> Series? {
        browse.series(id: id) ?? catalogState.series?.series(id: id)
    }

    func channel(key: String) -> Channel? {
        catalogState.live?.channel(forKey: key)
    }

    var lastChannelKey: String? {
        guard let id = source?.id else { return nil }
        return library.lastChannel(sourceID: id)
    }

    /// The channels Channel up/down moves through for the guide's current chip.
    func guideChannels(for chip: GuideChip) -> [Channel] {
        guard let live = catalogState.live else { return [] }
        return GuideLineup.channels(for: chip, lineup: live, favorites: favorites, mostWatched: mostWatched)
    }

    // MARK: Live TV actions

    func toggleFavorite(_ channel: Channel) {
        guard let id = source?.id else { return }
        let added = library.toggleFavorite(channel.key, sourceID: id)
        favorites = library.favorites(sourceID: id)
        showToast(added ? "\(channel.name) added to Favorites" : "\(channel.name) removed from Favorites")
    }

    /// Once per explicit tune, when the stream first plays (never for preview restores, retries or skips).
    func recordWatch(_ channel: Channel) {
        guard let id = source?.id else { return }
        library.recordWatch(channel.key, sourceID: id)
        library.setLastChannel(channel.key, sourceID: id)
        mostWatched = library.mostWatched(sourceID: id)
    }

    /// A channel that failed on every source with a "gone" answer: hidden for 3 days with every copy folded into it.
    func retire(_ channel: Channel) {
        guard let source else { return }
        let keys = catalogState.live?.keys(foldedInto: channel.key) ?? [channel.key]
        library.reportDead(keys, sourceID: source.id)
        deadChannels = library.deadChannels(sourceID: source.id)
        reapplyLiveOptions()
    }

    func bringBackHiddenChannels() {
        guard let source else { return }
        library.clearDead(sourceID: source.id)
        deadChannels = []
        reapplyLiveOptions()
        showToast("Hidden channels are back in the guide")
    }

    func showFavoriteChannels() {
        guideChip = .favorites
        selectedTab = .live
    }

    // MARK: Movies & Series actions

    func isInLibrary(_ titleID: String) -> Bool {
        librarySnapshot.favoriteTitles.contains(titleID)
    }

    func toggleLibrary(_ title: TitleRef) {
        guard let id = source?.id else { return }
        let added = library.toggleFavoriteTitle(title.id, sourceID: id)
        librarySnapshot = library.snapshot(sourceID: id)
        showToast(added ? "\(title.name) added to your Library" : "\(title.name) removed from your Library")
    }

    func removeFromContinueWatching(_ recent: RecentItem) {
        guard let id = source?.id else { return }
        library.removeRecent(id: recent.id, sourceID: id)
        librarySnapshot = library.snapshot(sourceID: id)
    }

    func saveProgress(_ recent: RecentItem) {
        guard let id = source?.id else { return }
        library.saveProgress(recent, sourceID: id)
        librarySnapshot = library.snapshot(sourceID: id)
    }

    func saveUpNext(_ recent: RecentItem) {
        guard let id = source?.id else { return }
        library.saveUpNext(recent, sourceID: id)
        librarySnapshot = library.snapshot(sourceID: id)
    }

    func recordHistory(titleID: String, kind: TitleKind) {
        guard let id = source?.id else { return }
        library.recordHistory(titleID: titleID, kind: kind, sourceID: id)
        librarySnapshot = library.snapshot(sourceID: id)
    }

    /// Pushes a detail page onto the current tab's stack.
    func open(_ route: TitleRoute) {
        switch selectedTab {
        case .home: homePath.append(route)
        case .discover: discoverPath.append(route)
        case .library: libraryPath.append(route)
        case .search: searchPath.append(route)
        case .live, .settings:
            selectedTab = .home
            homePath.append(route)
        }
    }

    func seeAll(_ target: SeeAll) {
        switch target {
        case .discover(let query):
            discoverQuery = query
            discoverPath = []
            selectedTab = .discover
        case .library:
            libraryPath = []
            selectedTab = .library
        }
    }

    /// Select on a poster: Continue watching resumes at once, everything else opens the detail page.
    func select(_ item: PosterItem, resumes: Bool) {
        if resumes, let recent = item.resume {
            Task { await self.resume(recent) }
        } else {
            open(TitleRoute(item.title))
        }
    }

    func resume(_ recent: RecentItem) async {
        guard let source else { return }
        switch recent.kind {
        case .movie:
            guard let movie = movie(id: recent.id) else {
                showToast("This movie isn't available any more.")
                return
            }
            let info = await movieInfo(for: movie, source: source, waitingAtMost: 3)
            playback.playMovie(movie, info: info, from: recent.upNext ? 0 : recent.positionMs)
        case .episode:
            guard let seriesID = recent.seriesID, let series = series(id: seriesID) else {
                showToast("This series isn't available any more.")
                return
            }
            do {
                let info = try await catalog.seriesInfo(for: series, source: source)
                guard let episode = info.allEpisodes.first(where: { $0.id == recent.id }) else {
                    open(.series(series.id))
                    return
                }
                guard episode.isPlayable else {
                    showToast("This episode isn't available on Apple TV.")
                    return
                }
                playback.playEpisode(episode, of: series, info: info, from: recent.upNext ? 0 : recent.positionMs)
            } catch {
                showToast(TunerError.from(error).message)
            }
        }
    }

    /// The movie's details (for its subtitle files), unless the server takes longer than `seconds`: then playback
    /// starts without them rather than keep people waiting.
    private func movieInfo(for movie: Movie, source: Source, waitingAtMost seconds: Double) async -> MovieInfo? {
        let catalog = self.catalog
        return await withTaskGroup(of: MovieInfo?.self) { group in
            group.addTask { try? await catalog.movieInfo(for: movie, source: source) }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    // MARK: Settings

    func updateSettings(_ change: (inout TunerSettings) -> Void) {
        let old = settings
        library.updateSettings(change)
        settings = library.settings
        if old.usOnly != settings.usOnly { reapplyLiveOptions() }
        if old.titlesUSOnly != settings.titlesUSOnly { rebuildBrowse() }
        if old.subtitles != settings.subtitles { playback.subtitleSettingChanged() }
        if old.guidePreview != settings.guidePreview && !settings.guidePreview { playback.leftLiveTab() }
    }

    // MARK: Logins

    private func reloadSources() {
        allSources = sources.all()
        source = sources.active()
    }

    /// Validates a login before it is saved: a server login must answer with an active account, a playlist link
    /// must download and contain at least one channel or title. Returns the account summary for server logins.
    func validate(_ candidate: Source) async throws -> String? {
        switch candidate.kind {
        case .xtream:
            guard let login = candidate.xtreamLogin else {
                throw TunerError.invalidInput("Enter the server address, username and password.")
            }
            let info = try await XtreamClient(login: login, http: http).accountInfo()
            return info.summary
        case .m3u:
            guard let url = SignInForm.webURL(candidate.playlistURL) else {
                throw TunerError.invalidInput("Enter a playlist link that starts with http:// or https://.")
            }
            let body: Data
            do {
                body = try await http.data(HTTPRequestSpec(url: url)).body
            } catch {
                throw TunerError.from(error)
            }
            let playlist = await Task.detached(priority: .userInitiated) { M3UParser.parse(body) }.value
            if playlist.channels.isEmpty && playlist.movies.isEmpty && playlist.series.isEmpty {
                throw TunerError.invalidInput("That playlist link has no channels, movies or series.")
            }
            return nil
        }
    }

    /// A login approved on the phone. Server logins are checked first; false means "this Apple TV couldn't use it".
    func acceptPaired(_ paired: Source) async -> Bool {
        if paired.kind == .xtream {
            guard let login = paired.xtreamLogin, (try? await XtreamClient(login: login, http: http).accountInfo()) != nil else {
                return false
            }
        }
        addSource(paired)
        return true
    }

    func addSource(_ new: Source) {
        sources.save(new)
        sources.setActive(id: new.id)
        activeSourceChanged()
    }

    func useSource(id: String) {
        guard id != source?.id else { return }
        sources.setActive(id: id)
        activeSourceChanged()
    }

    func removeSource(id: String) {
        playback.stopEverything()
        library.removeAll(sourceID: id)
        sources.delete(id: id)
        activeSourceChanged()
    }

    private func activeSourceChanged() {
        let hadSource = source != nil
        playback.stopEverything()
        reloadSources()
        homePath = []
        discoverPath = []
        libraryPath = []
        searchPath = []
        guideChip = .all
        discoverQuery = DiscoverQuery()
        accountSummary = nil
        logosTask = nil
        if source == nil {
            catalogState = CatalogState()
            browse = .empty
            schedule = GuideSchedule()
            refreshLibrary()
            Task { await self.catalog.reset() }
        } else {
            // The first login opens on Home (or Live TV); switching logins in Settings stays there.
            if !hadSource { selectedTab = settings.startOnLiveTV ? .live : .home }
            loadCatalog(force: false)
        }
    }

    // MARK: Messages

    func showToast(_ text: String) {
        toast = text
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }
}
