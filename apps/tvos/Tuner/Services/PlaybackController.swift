import AVFoundation
import AVKit
import Combine
import Foundation
import Observation
import SwiftUI
import UIKit
import TunerCore

/// The one AVPlayer: the guide's preview window, full-screen live TV and movies/episodes all use it, so going full
/// screen on the previewed channel never opens a second provider connection. TunerCore's MediaServer holds the single
/// upstream connection and serves it to AVPlayer on 127.0.0.1.
@MainActor
@Observable
final class PlaybackController {
    enum Mode: Equatable {
        case idle
        case live
        case vod
    }

    /// A movie or episode being played (no stream URLs are stored anywhere else).
    struct VODItem {
        var id: String
        var kind: RecentKind
        /// Movie id or series id (Library history).
        var titleID: String
        var title: String
        /// Episodes: "S1 E2 · Title".
        var subtitle: String?
        var image: URL?
        var plot: String?
        var sources: [URL]
        var containerExtension: String?
        /// The provider's subtitle files.
        var subtitles: [ExternalSubtitle]
        /// What to ask lumanest.tv for OpenSubtitles tracks (nil: no TMDB id and no name with a year, or no episode number).
        var subtitleQuery: SubtitleQuery?
        var series: Series?
        var season: Int?
        var episode: Int?
        var durationSeconds: Int
        /// The episodes that play next (at most 30).
        var queue: [Episode]
    }

    // MARK: Observed

    private(set) var mode: Mode = .idle
    /// The channel tuned in the preview or full screen.
    private(set) var liveChannel: Channel?
    /// "Waiting for your line…", errors: shown over the guide preview (and in the full-screen player).
    private(set) var status: String?
    private(set) var isFullScreen = false
    /// Changes when the full-screen player closes, so the guide preview attaches a fresh layer to the player.
    private(set) var previewToken = 0
    /// The channel list Channel up/down and the Channels panel move through.
    private(set) var zapChannels: [Channel] = []

    // MARK: Fixed

    let player = AVPlayer()
    @ObservationIgnored weak var model: AppModel?
    private let presenter: PlayerPresenter
    private let media: MediaServer
    private let http: any HTTPClient

    // MARK: Live state

    @ObservationIgnored private var tuneToken = 0
    @ObservationIgnored private var tuneTask: Task<Void, Never>?
    @ObservationIgnored private var eventsTask: Task<Void, Never>?
    @ObservationIgnored private var stopTask: Task<Void, Never>?
    @ObservationIgnored private var liveSession: LiveChannelSession?
    @ObservationIgnored private var liveReady: LiveReady?
    @ObservationIgnored private var liveURL: URL?
    @ObservationIgnored private var failedToken: Int?
    @ObservationIgnored private var lastTuneRequest = Date.distantPast
    @ObservationIgnored private var pendingWatch: Channel?
    /// The tune whose watch was counted (Most Watched counts each tune at most once).
    @ObservationIgnored private var countedToken: Int?
    @ObservationIgnored private var droppedAudio = false
    @ObservationIgnored private var itemRetries: [Date] = []
    @ObservationIgnored private var zapDirection = 1
    @ObservationIgnored private var skipsLeft = 0
    /// The channel to bring back when the app returns to the foreground.
    @ObservationIgnored private var backgroundChannel: Channel?

    // MARK: VOD state

    @ObservationIgnored private var vod: VODItem?
    @ObservationIgnored private var vodToken = 0
    @ObservationIgnored private var vodEventsTask: Task<Void, Never>?
    @ObservationIgnored private var pendingSeekMs: Int64?
    @ObservationIgnored private var lastSave = Date.distantPast
    @ObservationIgnored private var lastPositionMs: Int64 = 0
    @ObservationIgnored private var showingNextAction = false
    @ObservationIgnored private var resumeVODAfterBackground = false
    /// What the local proxy reported for this title (busy line, missing upload…): shown if AVPlayer then gives up.
    @ObservationIgnored private var vodFailure: PlaybackFailure?

    // MARK: Subtitle files (drawn over the video)

    /// A subtitle file: one the provider lists (by index) or an OpenSubtitles track (by its id).
    enum Sidecar: Equatable {
        case provider(Int)
        case openSubtitles(String)
    }

    /// The file shown, if any.
    @ObservationIgnored private var sidecar: Sidecar?
    /// The provider file's cues.
    @ObservationIgnored private var subtitleCues: [SubtitleCue] = []
    /// The OpenSubtitles file's cues.
    @ObservationIgnored private var openSubtitleFile: WebVTT?
    /// This title's OpenSubtitles lookup, and whether it has answered (or there is nothing to ask).
    @ObservationIgnored private var openSubtitles = SubtitleLookup.empty
    @ObservationIgnored private var lookupDone = false
    /// The automatic choice (or the viewer's pick) has been applied for this title.
    @ObservationIgnored private var subtitlesDecided = false
    /// The current item's subtitle group, once loaded.
    @ObservationIgnored private var legible: (item: AVPlayerItem, group: AVMediaSelectionGroup?)?
    /// What the viewer picked in the menu: it stays picked for that title until playback ends (also over Try again).
    @ObservationIgnored private var viewerPick: (titleID: String, sidecar: Sidecar?)?
    /// OpenSubtitles files of the title being played, by track id: a replay or resume needs no new download.
    @ObservationIgnored private var openSubtitleFiles: (titleID: String, files: [String: WebVTT]) = ("", [:])

    // MARK: Observers

    @ObservationIgnored private var playerObservers = Set<AnyCancellable>()
    @ObservationIgnored private var itemObservers = Set<AnyCancellable>()
    @ObservationIgnored private var timeObserver: Any?

    init(media: MediaServer, http: any HTTPClient) {
        self.media = media
        self.http = http
        presenter = PlayerPresenter()
        presenter.skipChannel = { [weak self] offset in
            guard let self else { return false }
            return await self.skip(by: offset)
        }
        presenter.didDismiss = { [weak self] in
            self?.fullScreenDismissed()
        }
        player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                self?.timeControlChanged(status)
            }
            .store(in: &playerObservers)
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 4), queue: .main) { [weak self] time in
            let seconds = time.seconds
            MainActor.assumeIsolated {
                self?.tick(seconds)
            }
        }
    }

    // MARK: - Live TV

    /// Tunes a channel. `lineup` is the list Channel up/down moves through. `explicit` tunes count a watch once the
    /// stream plays; preview restores don't.
    func tune(_ channel: Channel, in lineup: [Channel], explicit: Bool = true, fullScreen: Bool = false) {
        reconcileFullScreen()
        zapChannels = lineup.isEmpty ? [channel] : lineup
        skipsLeft = 5
        if isTuned(to: channel) {
            // Already playing (or tuning) in the preview: a deliberate Select still counts as watching it, once per tune.
            if explicit && countedToken != tuneToken {
                if player.timeControlStatus == .playing {
                    countWatch(channel)
                } else {
                    pendingWatch = channel
                }
            }
        } else {
            startTune(channel, explicit: explicit, dropAudio: false)
        }
        if fullScreen { presentLive() }
    }

    /// True while `channel` is tuned (or tuning) and hasn't failed: Select then goes full screen instead of retuning.
    func isTuned(to channel: Channel) -> Bool {
        mode == .live && liveChannel?.key == channel.key && failedToken != tuneToken
    }

    /// Shows the tuned channel full screen (`tune(_:in:explicit:fullScreen:)` with `fullScreen` comes here).
    func presentLive() {
        reconcileFullScreen()
        guard mode == .live, liveChannel != nil else { return }
        if isFullScreen {
            presenter.update(menuItems: liveMenuItems(), infoPanels: liveInfoPanels())
            return
        }
        isFullScreen = presenter.present(player: player, menuItems: liveMenuItems(), infoPanels: liveInfoPanels())
        presenter.overlay.message = status
    }

    /// Picks a channel from the full-screen Channels panel.
    func zap(to channel: Channel) {
        skipsLeft = 5
        guard channel.key != liveChannel?.key else { return }
        zapDirection = 1
        startTune(channel, explicit: true, dropAudio: false)
    }

    /// Opening Live TV: the last channel in the preview, without counting a watch.
    func restorePreview() {
        reconcileFullScreen()
        guard let model, model.settings.guidePreview, mode == .idle, !isFullScreen else { return }
        guard let key = model.lastChannelKey, let channel = model.channel(key: key) else { return }
        guard !model.deadChannels.contains(channel.key) else { return }
        tune(channel, in: model.guideChannels(for: model.guideChip), explicit: false)
    }

    /// Leaving Live TV stops live (frees the line) unless the full-screen player is showing.
    func leftLiveTab() {
        reconcileFullScreen()
        guard mode == .live, !isFullScreen else { return }
        stopLive()
    }

    /// UIKit is the source of truth for full screen: a player it refused to show, or one that went away without the
    /// dismissal callback, is treated as closed here (otherwise live would keep the line after leaving the guide, or a
    /// movie would play with no picture).
    private func reconcileFullScreen() {
        if isFullScreen && !presenter.isPresented { fullScreenDismissed() }
    }

    func stopLive() {
        tuneToken += 1
        tuneTask?.cancel()
        eventsTask?.cancel()
        clearItem()
        liveSession = nil
        liveReady = nil
        liveURL = nil
        pendingWatch = nil
        liveChannel = nil
        status = nil
        if mode == .live { mode = .idle }
        hangUp()
    }

    /// Source changed or deleted: stop everything and close the player.
    func stopEverything() {
        if isFullScreen { presenter.dismiss() }
        isFullScreen = false
        if mode == .vod { saveProgress() }
        vodToken += 1
        vodEventsTask?.cancel()
        vod = nil
        resetSubtitles(keepingPickFor: nil)
        stopLive()
        mode = .idle
    }

    private func hangUp() {
        let media = self.media
        let previous = stopTask
        stopTask = Task {
            await previous?.value
            await media.stopAll()
        }
    }

    private func startTune(_ channel: Channel, explicit: Bool, dropAudio: Bool, delay: Double? = nil) {
        if mode == .vod {
            saveProgress()
            vodToken += 1
            vodEventsTask?.cancel()
            vod = nil
            resetSubtitles(keepingPickFor: nil)
        }
        tuneToken += 1
        let token = tuneToken
        tuneTask?.cancel()
        eventsTask?.cancel()
        let now = Date()
        let quick = now.timeIntervalSince(lastTuneRequest) < 1.0
        lastTuneRequest = now
        let wait = delay ?? (quick ? 0.45 : 0.09)
        mode = .live
        liveChannel = channel
        liveSession = nil
        liveReady = nil
        liveURL = nil
        failedToken = nil
        itemRetries = []
        pendingWatch = explicit ? channel : nil
        setStatus(nil)
        clearItem()
        if isFullScreen {
            presenter.update(menuItems: liveMenuItems())
            presenter.setContextualActions([])
        }
        tuneTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.performTune(channel, dropAudio: dropAudio, token: token)
        }
    }

    private func performTune(_ channel: Channel, dropAudio: Bool, token: Int) async {
        if let stopTask { await stopTask.value }
        guard token == tuneToken else { return }
        // The local server may have been stopped in the background; this returns at once when it runs.
        _ = try? await model?.loopback.ensureRunning()
        guard token == tuneToken else { return }
        let request = LiveTuneRequest(channelKey: channel.key, channelName: channel.name, sources: [channel.url] + channel.backups,
                                      dropMPEGAudioLayer2: dropAudio)
        let session: LiveChannelSession
        do {
            session = try await media.tuneLive(request)
        } catch is CancellationError {
            return
        } catch {
            guard token == tuneToken else { return }
            liveFailed(PlaybackController.failure(from: error), channel: channel, token: token)
            return
        }
        // Replaced or stopped while the line was being set up: hang this one up (stopping twice is harmless).
        guard token == tuneToken else {
            await session.stop()
            return
        }
        liveSession = session
        droppedAudio = dropAudio
        let events = await session.events()
        guard token == tuneToken else { return }
        eventsTask = Task { [weak self] in
            for await event in events {
                guard let self, token == self.tuneToken else { return }
                self.handle(event, channel: channel, token: token)
            }
        }
        do {
            let ready = try await session.waitUntilReady()
            guard token == tuneToken else { return }
            liveReady = ready
            let url: URL
            switch ready.route {
            case .loopback(let local): url = local
            case .direct(let remote): url = remote
            }
            liveURL = url
            playLiveItem(url: url, route: ready.route, channel: channel)
            setStatus(nil)
        } catch is CancellationError {
            return
        } catch {
            guard token == tuneToken else { return }
            liveFailed(PlaybackController.failure(from: error), channel: channel, token: token)
        }
    }

    private static func failure(from error: Error) -> PlaybackFailure {
        if let failure = error as? PlaybackFailure { return failure }
        switch TunerError.from(error) {
        case .timedOut: return .tooSlow
        default: return .unreachable
        }
    }

    private static let waitingText = "Waiting for your line…"

    private func handle(_ event: LiveSessionEvent, channel: Channel, token: Int) {
        switch event {
        case .connecting:
            // Busy retries reconnect several times: once "Waiting for your line…" shows, it stays until the picture does.
            if liveReady == nil && status != PlaybackController.waitingText { setStatus("Tuning \(channel.name)…") }
        case .waitingForLine:
            setStatus(PlaybackController.waitingText)
        case .rejoined:
            // A rejoin that had to wait for the line while AVPlayer played its buffer: the picture never stopped.
            if liveReady != nil && status == PlaybackController.waitingText { setStatus(nil) }
        case .audioUnsupported:
            notify("This channel's sound isn't supported on Apple TV.")
        case .failed(let failure):
            // Before the stream was ready, waitUntilReady reports the failure.
            if liveReady != nil { liveFailed(failure, channel: channel, token: token) }
        default:
            break
        }
    }

    private func playLiveItem(url: URL, route: LiveRoute, channel: Channel) {
        let item: AVPlayerItem
        if case .direct = route {
            let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPUserAgentKey: TunerLinks.streamUserAgent])
            item = AVPlayerItem(asset: asset)
        } else {
            item = AVPlayerItem(url: url)
        }
        item.externalMetadata = liveMetadata(channel)
        install(item)
        player.play()
    }

    private func liveMetadata(_ channel: Channel) -> [AVMetadataItem] {
        var items = [PlaybackController.metadata(.commonIdentifierTitle, channel.name)]
        if let program = model?.schedule.current(forKey: channel.key, at: Date()), !program.placeholder {
            items.append(PlaybackController.metadata(.iTunesMetadataTrackSubTitle, program.title))
            if let description = program.description, !description.isEmpty {
                items.append(PlaybackController.metadata(.commonIdentifierDescription, description))
            }
        }
        return items
    }

    private func liveFailed(_ failure: PlaybackFailure, channel: Channel, token: Int) {
        failedToken = token
        pendingWatch = nil
        clearItem()
        hangUp()
        guard failure.retiresChannel else {
            setStatus(failure.message)
            if isFullScreen {
                // Select only shows the transport bar in the full-screen player: offer the retry as a button.
                let lineup = zapChannels
                presenter.setContextualActions([UIAction(title: "Try again", image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in
                    self?.tune(channel, in: lineup, explicit: true)
                }])
            }
            return
        }
        model?.retire(channel)
        if isFullScreen, skipsLeft > 0, let next = neighbor(of: channel, offset: zapDirection) {
            skipsLeft -= 1
            notify("\(channel.name) isn't working right now. Skipping it.")
            startTune(next, explicit: false, dropAudio: false, delay: 1.5)
        } else {
            setStatus(failure.message)
        }
    }

    /// AVPlayer rejected the item while the session was fine: Layer II / LATM sound is retried without the sound,
    /// anything else gets a new item (at most 3 a minute), then the channel is tuned again.
    private func liveItemFailed() {
        guard let channel = liveChannel else { return }
        if !droppedAudio, let info = liveReady?.info, let audio = info.audio,
           audio.kind == .aacLATM || (audio.kind == .mpegAudio && info.audioCodec == "mp4a.40.33") {
            startTune(channel, explicit: pendingWatch?.key == channel.key, dropAudio: true, delay: 0)
            return
        }
        let now = Date()
        itemRetries = itemRetries.filter { now.timeIntervalSince($0) < 60 }
        guard itemRetries.count < 3 else {
            let token = tuneToken
            liveFailed(.ended, channel: channel, token: token)
            return
        }
        itemRetries.append(now)
        let retries = itemRetries
        let explicit = pendingWatch?.key == channel.key
        guard let session = liveSession, let url = liveURL, let ready = liveReady else {
            startTune(channel, explicit: explicit, dropAudio: droppedAudio, delay: 0)
            return
        }
        let token = tuneToken
        Task { [weak self] in
            let stopped = await session.isStopped
            guard let self, token == self.tuneToken else { return }
            if stopped {
                self.startTune(channel, explicit: explicit, dropAudio: self.droppedAudio, delay: 0)
                self.itemRetries = retries
            } else {
                self.playLiveItem(url: url, route: ready.route, channel: channel)
            }
        }
    }

    /// Channel up/down in the full-screen player (AVKit's channel-skip delegate). True once the new channel plays.
    func skip(by offset: Int) async -> Bool {
        guard mode == .live, let current = liveChannel, let next = neighbor(of: current, offset: offset) else { return false }
        zapDirection = offset >= 0 ? 1 : -1
        skipsLeft = 5
        startTune(next, explicit: true, dropAudio: false)
        let token = tuneToken
        for _ in 0..<120 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if token != tuneToken || liveReady != nil { return true }
            if failedToken == token { return false }
        }
        return true
    }

    private func neighbor(of channel: Channel, offset: Int) -> Channel? {
        let hidden = model?.deadChannels ?? []
        if let live = model?.catalogState.live {
            return live.neighbor(of: channel.key, offset: offset, in: zapChannels, hidden: hidden)
        }
        let list = zapChannels.filter { !hidden.contains($0.key) || $0.key == channel.key }
        guard list.count > 1, let index = list.firstIndex(where: { $0.key == channel.key }) else { return nil }
        let next = ((index + offset) % list.count + list.count) % list.count
        return list[next]
    }

    private func timeControlChanged(_ status: AVPlayer.TimeControlStatus) {
        guard status == .playing else { return }
        guard mode == .live, let channel = liveChannel else { return }
        setStatus(nil)
        if let watched = pendingWatch, watched.key == channel.key {
            pendingWatch = nil
            if countedToken != tuneToken { countWatch(channel) }
            if let session = liveSession, let ready = liveReady, session.request.sources.indices.contains(ready.sourceIndex) {
                let url = session.request.sources[ready.sourceIndex]
                let media = self.media
                let key = channel.key
                Task { await media.noteWorkingSource(channelKey: key, url: url) }
            }
        }
    }

    private func countWatch(_ channel: Channel) {
        countedToken = tuneToken
        model?.recordWatch(channel)
    }

    private func liveMenuItems() -> [UIMenuElement] {
        guard let channel = liveChannel, let model else { return [] }
        let isFavorite = model.favorites.contains(channel.key)
        let favorite = UIAction(title: isFavorite ? "Remove from Favorites" : "Add to Favorites",
                                image: UIImage(systemName: isFavorite ? "heart.fill" : "heart")) { [weak self] _ in
            self?.toggleFavoriteInPlayer()
        }
        return [favorite]
    }

    private func toggleFavoriteInPlayer() {
        guard let channel = liveChannel, let model else { return }
        model.toggleFavorite(channel)
        let isFavorite = model.favorites.contains(channel.key)
        notify(isFavorite ? "\(channel.name) added to Favorites" : "\(channel.name) removed from Favorites")
        presenter.update(menuItems: liveMenuItems())
    }

    private func liveInfoPanels() -> [UIViewController] {
        guard let model else { return [] }
        let panel = UIHostingController(rootView: ChannelsPanel().environment(model))
        panel.title = "Channels"
        panel.preferredContentSize = CGSize(width: 1920, height: 340)
        return [panel]
    }

    // MARK: - Movies and episodes

    func playMovie(_ movie: Movie, info: MovieInfo?, from positionMs: Int64) {
        let item = VODItem(id: movie.id, kind: .movie, titleID: movie.id, title: movie.name, subtitle: nil, image: info?.poster ?? movie.poster,
                           plot: info?.plot, sources: [movie.url] + movie.backups, containerExtension: movie.containerExtension,
                           subtitles: (info?.subtitles ?? []).filter { $0.format != nil }, subtitleQuery: model?.subtitleQuery(for: movie),
                           series: nil, season: nil, episode: nil, durationSeconds: 0, queue: [])
        startVOD(item, from: positionMs)
    }

    func playEpisode(_ episode: Episode, of series: Series, info: SeriesInfo, from positionMs: Int64) {
        let queue = SeriesNavigation.queue(after: episode, in: info)
        startVOD(episodeItem(episode, series: series, queue: queue), from: positionMs)
    }

    private func episodeItem(_ episode: Episode, series: Series, queue: [Episode]) -> VODItem {
        VODItem(id: episode.id, kind: .episode, titleID: series.id, title: series.name, subtitle: SeriesNavigation.label(episode),
                image: episode.image ?? series.cover, plot: episode.plot ?? series.plot, sources: [episode.url],
                containerExtension: episode.containerExtension, subtitles: episode.subtitles.filter { $0.format != nil },
                subtitleQuery: model?.subtitleQuery(for: episode, of: series), series: series, season: episode.season,
                episode: episode.number, durationSeconds: episode.durationSeconds, queue: queue)
    }

    private func startVOD(_ item: VODItem, from positionMs: Int64) {
        reconcileFullScreen()
        if mode == .vod { saveProgress() }
        // Live off: MediaServer.openVOD also hangs up the live connection before opening this one.
        tuneToken += 1
        tuneTask?.cancel()
        eventsTask?.cancel()
        liveSession = nil
        liveReady = nil
        liveURL = nil
        pendingWatch = nil
        liveChannel = nil
        clearItem()
        mode = .vod
        vod = item
        vodToken += 1
        let token = vodToken
        vodEventsTask?.cancel()
        resetSubtitles(keepingPickFor: item.id)
        startSubtitleLookup(item, token: token)
        showingNextAction = false
        vodFailure = nil
        pendingSeekMs = positionMs > 15_000 ? positionMs : nil
        lastPositionMs = max(0, positionMs)
        lastSave = Date()
        status = nil
        model?.recordHistory(titleID: item.titleID, kind: item.kind == .movie ? .movie : .series)
        if isFullScreen {
            presenter.update(menuItems: vodMenuItems(), infoPanels: [])
            presenter.setContextualActions([])
        } else {
            isFullScreen = presenter.present(player: player, menuItems: vodMenuItems(), infoPanels: [])
        }
        presenter.overlay.subtitle = nil
        presenter.overlay.message = nil
        Task { [weak self] in
            await self?.openVOD(item, token: token)
        }
    }

    private func openVOD(_ item: VODItem, token: Int) async {
        if let stopTask { await stopTask.value }
        guard token == vodToken else { return }
        _ = try? await model?.loopback.ensureRunning()
        guard token == vodToken else { return }
        let session: VODSession
        do {
            session = try await media.openVOD(VODRequest(id: item.id, sources: item.sources, containerExtension: item.containerExtension))
        } catch is CancellationError {
            return
        } catch {
            guard token == vodToken else { return }
            showVODProblem(PlaybackController.failure(from: error).message)
            return
        }
        guard token == vodToken else {
            await session.stop()
            return
        }
        let events = await session.events()
        vodEventsTask = Task { [weak self] in
            for await event in events {
                guard let self, token == self.vodToken else { return }
                switch event {
                case .waitingForLine: self.notify(PlaybackController.waitingText)
                case .failed(let failure):
                    self.vodFailure = failure
                    self.notify(failure.message)
                case .switchedSource: break
                }
            }
        }
        let playerItem: AVPlayerItem
        if case .hls = PlaybackSupport.vodContainer(url: item.sources.first ?? session.localURL, containerExtension: item.containerExtension),
           let remote = item.sources.first {
            // The provider's own HLS playlist: AVPlayer loads it directly, because its segment addresses are relative to
            // the provider and the local byte-range proxy can't serve them. `openVOD` has already freed the line.
            playerItem = AVPlayerItem(asset: AVURLAsset(url: remote, options: [AVURLAssetHTTPUserAgentKey: TunerLinks.streamUserAgent]))
        } else {
            playerItem = AVPlayerItem(url: session.localURL)
        }
        playerItem.externalMetadata = vodMetadata(item)
        install(playerItem)
        if pendingSeekMs == nil { player.play() }
    }

    private func vodMetadata(_ item: VODItem) -> [AVMetadataItem] {
        var items = [PlaybackController.metadata(.commonIdentifierTitle, item.title)]
        if let subtitle = item.subtitle { items.append(PlaybackController.metadata(.iTunesMetadataTrackSubTitle, subtitle)) }
        if let plot = item.plot, !plot.isEmpty { items.append(PlaybackController.metadata(.commonIdentifierDescription, plot)) }
        return items
    }

    private func vodReady() {
        guard let ms = pendingSeekMs else { return }
        pendingSeekMs = nil
        player.seek(to: CMTime(value: CMTimeValue(ms), timescale: 1000))
        player.play()
    }

    private func vodItemFailed(_ error: Error?) {
        guard let vod else { return }
        NSLog("Tuner: VOD item failed for %@: %@", vod.id, String(describing: error))
        showVODProblem(vodFailure?.message ?? "This title couldn't be played. Try again, or choose another title.")
    }

    /// A lasting message over the (black) player with a "Try again" button, or a toast outside full screen.
    private func showVODProblem(_ text: String) {
        guard isFullScreen, vod != nil else {
            notify(text)
            return
        }
        presenter.overlay.message = text
        presenter.setContextualActions([UIAction(title: "Try again", image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in
            guard let self, self.mode == .vod, let current = self.vod else { return }
            self.startVOD(current, from: self.lastPositionMs)
        }])
    }

    /// Every 0.25 s while something plays.
    private func tick(_ seconds: Double) {
        guard mode == .vod, vod != nil, seconds.isFinite, seconds >= 0 else { return }
        if pendingSeekMs == nil { lastPositionMs = Int64(seconds * 1000) }
        updateSubtitleText(seconds)
        if Date().timeIntervalSince(lastSave) >= 10 { saveProgress() }
        updateNextEpisodeAction(at: seconds)
    }

    private func currentDurationSeconds() -> Double {
        let duration = player.currentItem?.duration.seconds ?? .nan
        if duration.isFinite && duration > 0 { return duration }
        return Double(vod?.durationSeconds ?? 0)
    }

    private func saveProgress() {
        guard mode == .vod, let vod, pendingSeekMs == nil else { return }
        lastSave = Date()
        let duration = currentDurationSeconds()
        let recent = RecentItem(id: vod.id, kind: vod.kind, title: vod.title, subtitle: vod.subtitle, image: vod.image,
                                seriesID: vod.series?.id, season: vod.season, episode: vod.episode, positionMs: lastPositionMs,
                                durationMs: Int64(max(0, duration) * 1000), updated: Date())
        model?.saveProgress(recent)
    }

    private func itemEnded() {
        guard mode == .vod, let vod else { return }
        lastPositionMs = Int64(currentDurationSeconds() * 1000)
        saveProgress()
        playNextEpisode(from: vod)
    }

    private func playNextEpisode(from current: VODItem) {
        guard let series = current.series, let next = current.queue.first else {
            presenter.dismiss()
            return
        }
        let upNext = RecentItem(id: next.id, kind: .episode, title: series.name, subtitle: SeriesNavigation.label(next),
                                image: next.image ?? series.cover, seriesID: series.id, season: next.season, episode: next.number,
                                positionMs: 0, durationMs: Int64(next.durationSeconds) * 1000, updated: Date(), upNext: true)
        model?.saveUpNext(upNext)
        startVOD(episodeItem(next, series: series, queue: Array(current.queue.dropFirst())), from: 0)
    }

    /// "Next episode" over the video during an episode's last 30 seconds.
    private func updateNextEpisodeAction(at seconds: Double) {
        guard let vod, !vod.queue.isEmpty else { return }
        let duration = currentDurationSeconds()
        let show = duration > 60 && duration - seconds <= 30
        guard show != showingNextAction else { return }
        showingNextAction = show
        if show {
            let action = UIAction(title: "Next episode", image: UIImage(systemName: "forward.end.fill")) { [weak self] _ in
                guard let self, let current = self.vod else { return }
                self.lastPositionMs = Int64(self.currentDurationSeconds() * 1000)
                self.saveProgress()
                self.playNextEpisode(from: current)
            }
            presenter.setContextualActions([action])
        } else {
            presenter.setContextualActions([])
        }
    }

    // MARK: - Subtitles

    /// Automatic follows the Apple TV setting (AVPlayer applies it). On/Off pick the legible track explicitly.
    func subtitleSettingChanged() {
        if let item = player.currentItem { applySubtitleMode(to: item) }
    }

    private func applySubtitleMode(to item: AVPlayerItem) {
        let setting = model?.settings.subtitles ?? .automatic
        Task { [weak self] in
            let group = try? await item.asset.loadMediaSelectionGroup(for: .legible)
            guard let self, item === self.player.currentItem else { return }
            if self.mode == .vod {
                if self.legible?.item !== item { self.legible = (item, group) }
                self.decideSubtitles()
                return
            }
            // Live: closed captions and the stream's subtitles. OpenSubtitles never applies to live channels.
            if let group, setting != .automatic {
                var choice: AVMediaSelectionOption?
                if setting == .on {
                    choice = AVMediaSelectionGroup.mediaSelectionOptions(from: group.options, with: Locale(identifier: "en")).first
                        ?? group.options.first
                }
                item.select(choice, in: group)
            }
        }
    }

    /// Forgets the subtitles of the title that was playing. `id` is the title about to play (the viewer's pick and the
    /// files already fetched are kept when it is the same title again, as after Try again), or nil when playback ends.
    private func resetSubtitles(keepingPickFor id: String?) {
        sidecar = nil
        subtitleCues = []
        openSubtitleFile = nil
        openSubtitles = .empty
        lookupDone = false
        subtitlesDecided = false
        legible = nil
        if viewerPick?.titleID != id { viewerPick = nil }
        if openSubtitleFiles.titleID != id { openSubtitleFiles = (id ?? "", [:]) }
        presenter.overlay.subtitle = nil
    }

    /// The OpenSubtitles lookup when a movie or episode starts (kept in memory for the session by `ExtrasService`).
    /// Only the list: a file is fetched when it is about to be shown, never before.
    private func startSubtitleLookup(_ item: VODItem, token: Int) {
        guard let query = item.subtitleQuery, let extras = model?.extras else {
            lookupDone = true
            return
        }
        Task { [weak self] in
            let lookup = await extras.subtitles(query)
            guard let self, token == self.vodToken else { return }
            self.openSubtitles = lookup
            self.lookupDone = true
            if !lookup.tracks.isEmpty { self.presenter.update(menuItems: self.vodMenuItems()) }
            self.decideSubtitles()
        }
    }

    /// docs/extras.md "Automatic choice", once per title, when the item is ready and (unless the stream or the provider
    /// has English) the lookup has answered. Settings → Subtitles On, or Automatic with the Apple TV's captions on: the
    /// stream's English track, else the provider's English file, else the first OpenSubtitles track, else the stream's
    /// first track, else the provider's first file. A file turns the stream's subtitles off. The viewer's pick wins.
    private func decideSubtitles() {
        guard mode == .vod, !subtitlesDecided, let vod, let item = player.currentItem, let legible, legible.item === item else { return }
        let group = legible.group
        if let pick = viewerPick, pick.titleID == vod.id {
            if case .openSubtitles(_)? = pick.sidecar, !lookupDone { return }
            subtitlesDecided = true
            if pick.sidecar != nil, let group { item.select(nil, in: group) }
            showSidecar(pick.sidecar, automatic: false)
            return
        }
        let setting = model?.settings.subtitles ?? .automatic
        if setting == .off {
            subtitlesDecided = true
            if let group { item.select(nil, in: group) }
            return
        }
        guard setting == .on || CaptionPreference.systemCaptionsOn else {
            // Automatic with the Apple TV's captions off: the stream's tracks are AVPlayer's choice, and no file shows.
            subtitlesDecided = true
            return
        }
        let options = group?.options ?? []
        let english = AVMediaSelectionGroup.mediaSelectionOptions(from: options, with: Locale(identifier: "en"))
        guard let choice = SubtitleAutoChoice.choose(embeddedEnglish: !english.isEmpty, embeddedCount: options.count, provider: vod.subtitles,
                                                     openSubtitles: lookupDone ? openSubtitles.tracks.count : nil) else { return }
        subtitlesDecided = true
        switch choice {
        case .embeddedEnglish:
            // Automatic leaves the stream's tracks to AVPlayer, which follows the Apple TV's language and caption settings.
            if setting == .on, let group { item.select(english.first, in: group) }
        case .embeddedOther:
            if setting == .on, let group { item.select(options.first, in: group) }
        case .provider(let index):
            if let group { item.select(nil, in: group) }
            showSidecar(.provider(index), automatic: true)
        case .openSubtitles(let index):
            if let group { item.select(nil, in: group) }
            showSidecar(.openSubtitles(openSubtitles.tracks[index].id), automatic: true)
        case .nothing:
            break
        }
    }

    /// "Subtitle files": Off, the provider's files, the OpenSubtitles tracks and, under them, the credit as a note.
    private func vodMenuItems() -> [UIMenuElement] {
        guard let vod else { return [] }
        let tracks = openSubtitles.tracks
        guard !vod.subtitles.isEmpty || !tracks.isEmpty else { return [] }
        var children: [UIMenuElement] = [
            UIAction(title: "Off", state: sidecar == nil ? .on : .off) { [weak self] _ in
                self?.pickSidecar(nil)
            },
        ]
        for (index, subtitle) in vod.subtitles.enumerated() {
            children.append(UIAction(title: subtitle.displayName, state: sidecar == .provider(index) ? .on : .off) { [weak self] _ in
                self?.pickSidecar(.provider(index))
            })
        }
        for track in tracks {
            let id = track.id
            children.append(UIAction(title: track.label, state: sidecar == .openSubtitles(id) ? .on : .off) { [weak self] _ in
                self?.pickSidecar(.openSubtitles(id))
            })
        }
        if !tracks.isEmpty {
            // A note, not a choice: shown dimmed.
            children.append(UIAction(title: openSubtitles.credit, attributes: .disabled) { _ in })
        }
        return [UIMenu(title: "Subtitle files", image: UIImage(systemName: "captions.bubble"), children: children)]
    }

    /// The viewer's choice in "Subtitle files".
    private func pickSidecar(_ choice: Sidecar?) {
        guard mode == .vod, let vod else { return }
        viewerPick = (vod.id, choice)
        subtitlesDecided = true
        if choice != nil, let item = player.currentItem, let legible, legible.item === item, let group = legible.group {
            item.select(nil, in: group)
        }
        showSidecar(choice, automatic: false)
    }

    /// The stream's own subtitles chosen in the player's subtitle menu turn a subtitle file off.
    private func mediaSelectionChanged(_ item: AVPlayerItem) {
        guard mode == .vod, sidecar != nil, let legible, legible.item === item, let group = legible.group,
              item.currentMediaSelection.selectedMediaOption(in: group) != nil else { return }
        if let vod { viewerPick = (vod.id, nil) }
        subtitlesDecided = true
        showSidecar(nil, automatic: false)
    }

    /// Shows a file (nil: none). A file is fetched only here, when it is about to be shown. Its text is untrusted and goes
    /// into the overlay's label as plain text. If an OpenSubtitles file can't be loaded, a menu choice falls back to Off
    /// with a short message; an automatic choice fails silently.
    private func showSidecar(_ choice: Sidecar?, automatic: Bool) {
        sidecar = choice
        subtitleCues = []
        openSubtitleFile = nil
        presenter.overlay.subtitle = nil
        presenter.update(menuItems: vodMenuItems())
        guard let choice, let vod else { return }
        let token = vodToken
        switch choice {
        case .provider(let index):
            guard vod.subtitles.indices.contains(index), let format = vod.subtitles[index].format else { return }
            let url = vod.subtitles[index].url
            let http = self.http
            Task { [weak self] in
                do {
                    let data = try await http.data(HTTPRequestSpec(url: url)).body
                    let cues = await Task.detached(priority: .userInitiated) { SubtitleParser.parse(data, format: format) }.value
                    guard let self, token == self.vodToken, self.sidecar == choice else { return }
                    guard !cues.isEmpty else {
                        self.sidecarFailed(automatic: automatic, message: "These subtitles couldn't be read.")
                        return
                    }
                    self.subtitleCues = cues
                    self.updateSubtitleText()
                } catch {
                    guard let self, token == self.vodToken, self.sidecar == choice else { return }
                    self.sidecarFailed(automatic: automatic, message: "These subtitles couldn't be loaded. \(TunerError.from(error).message)")
                }
            }
        case .openSubtitles(let id):
            guard let track = openSubtitles.tracks.first(where: { $0.id == id }) else {
                sidecar = nil
                presenter.update(menuItems: vodMenuItems())
                return
            }
            let titleID = vod.id
            if openSubtitleFiles.titleID == titleID, let kept = openSubtitleFiles.files[id] {
                openSubtitleFile = kept
                updateSubtitleText()
                return
            }
            guard let extras = model?.extras else { return }
            Task { [weak self] in
                let file = try? await extras.subtitleFile(track)
                guard let self, token == self.vodToken, self.sidecar == choice else { return }
                guard let file else {
                    self.sidecarFailed(automatic: automatic, message: "These subtitles couldn't be loaded.")
                    return
                }
                if self.openSubtitleFiles.titleID != titleID { self.openSubtitleFiles = (titleID, [:]) }
                self.openSubtitleFiles.files[id] = file
                self.openSubtitleFile = file
                self.updateSubtitleText()
            }
        }
    }

    /// A file that couldn't be loaded or read: the menu shows Off again. A menu choice gets a short message (and stays Off
    /// for the title); an automatic choice fails silently.
    private func sidecarFailed(automatic: Bool, message: String) {
        sidecar = nil
        subtitleCues = []
        openSubtitleFile = nil
        presenter.overlay.subtitle = nil
        presenter.update(menuItems: vodMenuItems())
        guard !automatic else { return }
        if let vod { viewerPick = (vod.id, nil) }
        notify(message)
    }

    /// The text at the player's position, from the periodic time observer (every 0.25 s, and at once when time jumps
    /// after a seek or when playback starts or stops; while paused the text stays) and as soon as a file has loaded.
    /// Live channels never show a file.
    private func updateSubtitleText(_ seconds: Double? = nil) {
        let time = seconds ?? player.currentTime().seconds
        var text: String?
        if mode == .vod && time.isFinite {
            if let file = openSubtitleFile {
                let current = file.text(at: time)
                text = current.isEmpty ? nil : current
            } else if !subtitleCues.isEmpty {
                text = SubtitleParser.cue(at: time, in: subtitleCues)?.text
            }
        }
        if presenter.overlay.subtitle != text { presenter.overlay.subtitle = text }
    }

    // MARK: - Player item plumbing

    private func install(_ item: AVPlayerItem) {
        itemObservers.removeAll()
        player.replaceCurrentItem(with: item)
        item.publisher(for: \.status)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak item] status in
                guard let self, let item, item === self.player.currentItem else { return }
                self.itemStatusChanged(item, status: status)
            }
            .store(in: &itemObservers)
        NotificationCenter.default.publisher(for: AVPlayerItem.didPlayToEndTimeNotification, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.itemEnded()
            }
            .store(in: &itemObservers)
        NotificationCenter.default.publisher(for: AVPlayerItem.mediaSelectionDidChangeNotification, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak item] _ in
                guard let self, let item, item === self.player.currentItem else { return }
                self.mediaSelectionChanged(item)
            }
            .store(in: &itemObservers)
    }

    private func itemStatusChanged(_ item: AVPlayerItem, status: AVPlayerItem.Status) {
        switch status {
        case .readyToPlay:
            applySubtitleMode(to: item)
            if mode == .vod { vodReady() }
        case .failed:
            NSLog("Tuner: player item failed: %@", String(describing: item.error))
            if mode == .live {
                liveItemFailed()
            } else if mode == .vod {
                vodItemFailed(item.error)
            }
        default:
            break
        }
    }

    private func clearItem() {
        itemObservers.removeAll()
        player.pause()
        player.replaceCurrentItem(with: nil)
    }

    private static func metadata(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
        let item = AVMutableMetadataItem()
        item.identifier = identifier
        item.value = value as NSString
        item.extendedLanguageTag = "und"
        return item
    }

    // MARK: - Full screen, messages, background

    private func fullScreenDismissed() {
        isFullScreen = false
        previewToken += 1
        presenter.overlay.subtitle = nil
        presenter.overlay.message = nil
        switch mode {
        case .live:
            // Back to the guide: keep playing in the preview when it is on and Live TV is showing; otherwise free the line.
            let keep = model?.selectedTab == .live && (model?.settings.guidePreview ?? false)
            if !keep { stopLive() }
        case .vod:
            saveProgress()
            vodToken += 1
            vodEventsTask?.cancel()
            vod = nil
            resetSubtitles(keepingPickFor: nil)
            pendingSeekMs = nil
            clearItem()
            mode = .idle
            hangUp()
        case .idle:
            break
        }
    }

    private func setStatus(_ text: String?) {
        status = text
        if isFullScreen { presenter.overlay.message = text }
    }

    /// A short message: over the video in full screen, as a toast otherwise.
    private func notify(_ text: String) {
        if isFullScreen {
            presenter.overlay.flash(text)
        } else {
            model?.showToast(text)
        }
    }

    func enterBackground() {
        switch mode {
        case .live:
            backgroundChannel = liveChannel
            let wasFullScreen = isFullScreen
            stopLive()
            if wasFullScreen {
                // Stay presented; the channel is tuned again when the app comes back.
                mode = .live
                liveChannel = backgroundChannel
            }
        case .vod:
            player.pause()
            saveProgress()
            resumeVODAfterBackground = true
        case .idle:
            backgroundChannel = nil
        }
    }

    func enterForeground(serverRestarted: Bool) {
        if let channel = backgroundChannel {
            backgroundChannel = nil
            let showsLive = isFullScreen || (model?.selectedTab == .live && (model?.settings.guidePreview ?? false))
            if showsLive {
                startTune(channel, explicit: false, dropAudio: false, delay: 0)
            } else if mode == .live {
                stopLive()
            }
        }
        if resumeVODAfterBackground {
            resumeVODAfterBackground = false
            if mode == .vod, let vod, serverRestarted || player.currentItem?.status == .failed {
                // The local server came back on a new port: reopen the title where it stopped.
                startVOD(vod, from: lastPositionMs)
            }
        }
    }
}
