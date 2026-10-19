import Foundation

// MARK: - Playback failures (shown to people)

public enum PlaybackFailure: Error, Sendable, Hashable {
    /// "Another device is using your line right now. Stop watching there, then try again." (Neutral wording: nothing
    /// that hints at buying more connections, and true for lines with several.)
    case lineBusy
    /// 404/410, not media, or unparseable on every source when tuning: retire the channel (dead for 3 days). Never
    /// reported for a channel that was already playing (a reconnect that fails ends with `.ended` or `.refused`).
    case gone
    case unsupported(UnsupportedFormat)
    /// "Can't reach the server. Check your internet connection."
    case unreachable
    /// "This stream is taking too long to load. Try again, or choose another channel." (The guide retries on Select;
    /// the full-screen player offers a "Try again" button.)
    case tooSlow
    /// The live stream ended and rejoining didn't bring it back.
    case ended
    /// 400/401/403 from every source: "Your provider refused this channel (error N)."
    case refused(Int)

    public var message: String {
        switch self {
        case .lineBusy: return "Another device is using your line right now. Stop watching there, then try again."
        case .gone: return "This channel isn't working right now, so it's been taken out of the guide."
        case .unsupported(let format): return format.message
        case .unreachable: return "Can't reach the server. Check your internet connection."
        case .tooSlow: return "This stream is taking too long to load. Try again, or choose another channel."
        case .ended: return "This stream stopped and couldn't be restarted. Try again, or choose another channel."
        case .refused(let status): return "Your provider refused this channel (error \(status))."
        }
    }

    /// Retire the channel (only `.gone`).
    public var retiresChannel: Bool { self == .gone }
}

// MARK: - Live sessions

public struct LiveSessionConfig: Sendable, Hashable {
    public var segmenter = SegmenterConfig()
    /// A finite live response under this size is the provider's "CONNECTION LIMIT REACHED" clip.
    public var busyClipMaxBytes: Int64 = 4 * 1024 * 1024
    public var busyBudget: Double = 9
    public var headerDeadlines: [Double] = [1.3, 2.2]
    public var busyBackoff: [Double] = [0.15, 0.25, 0.4, 0.6, 0.9, 1.2]
    /// No bytes for this long → rejoin while AVPlayer keeps playing its buffer. Android's 8 s: shorter silences are
    /// mostly Wi-Fi hiccups and TCP back-off (1 + 2 + 4 s) that recover on their own, and on a one-connection line every
    /// needless rejoin risks the busy answer. The open segment stays open meanwhile, so the playlist is frozen for
    /// (time since the last cut) + this + the reconnect (up to ~3.5 s when the provider holds the request) + the wait
    /// for a keyframe; `targetDuration` is sized so that stays under AVPlayer's limit of 1.5 × target duration.
    public var quietTimeout: Double = 8
    public var rejoinDelays: [Double] = [0, 0.5, 1.5]
    public var rejoinDelayWindow: Double = 20
    public var maxRejoins: Int = 6
    public var maxRejoinsWindow: Double = 120
    /// A new connection must give a keyframe within this time of its first byte.
    public var placeWithin: Double = 5
    /// Statuses (plus non-media bodies) that count as "gone" when tuning. While rejoining a channel that was playing,
    /// error statuses are retried like a lost connection instead (a panel restarting the stream answers 404 for a
    /// moment), then the other sources are tried (`rejoin()`).
    public var goneStatuses: Set<Int> = [404, 410]
    /// `waitUntilReady` resolves after this many complete segments.
    public var readySegments: Int = 2
    /// Overall time for `waitUntilReady` before `.tooSlow` (busy retries included).
    public var readyTimeout: Double = 20
    /// EXT-X-TARGETDURATION, fixed for the session. Segments are still cut every 2 to 6 s (`SegmenterConfig`); the
    /// target is an upper bound, and a larger one gives AVPlayer 1.5 × 12 = 18 s before it treats an unchanged live
    /// playlist as a server error (-12888) while a lost connection is replaced. AVPlayer reloads a changed playlist
    /// after the last segment's duration (HLS 2nd edition 6.3.4), not after the target duration, so this doesn't slow
    /// playlist updates.
    public var targetDuration: Int = 12
    /// The media playlist lists at least this much (>= 3 × target duration, RFC 8216 6.2.2) once available.
    public var playlistMinDuration: Double = 36
    /// A media playlist request that would end on the same segment as this session's previous media playlist
    /// response waits up to this long for a new segment (avoids AVPlayer's half-target-duration back-off).
    public var playlistHold: Double = 3
    /// Segments kept after leaving the playlist, for requests in flight.
    public var retainExtraSegments: Int = 4
    public var maxBufferedBytes: Int = 96 * 1024 * 1024
    public init() {}
}

public struct LiveTuneRequest: Sendable, Hashable {
    public var channelKey: String
    public var channelName: String
    /// Primary URL first, then backups. The source that worked last for this key is moved first by `MediaServer`.
    public var sources: [URL]
    public var userAgent: String
    /// Second attempt after AVPlayer rejected a Layer II channel: play it without that audio.
    public var dropMPEGAudioLayer2: Bool
    public init(channelKey: String, channelName: String, sources: [URL], userAgent: String = TunerLinks.streamUserAgent,
                dropMPEGAudioLayer2: Bool = false) {
        self.channelKey = channelKey; self.channelName = channelName; self.sources = sources; self.userAgent = userAgent
        self.dropMPEGAudioLayer2 = dropMPEGAudioLayer2
    }
}

public enum LiveRoute: Sendable, Hashable {
    /// http://127.0.0.1:<port>/live/<session>/index.m3u8 (or media.m3u8 when codecs are unknown).
    case loopback(URL)
    /// The provider answered with a real HLS playlist: AVPlayer loads it directly (the probe connection is closed first).
    case direct(URL)
}

public struct LiveReady: Sendable, Hashable {
    public var route: LiveRoute
    public var info: StreamInfo?
    public var sourceIndex: Int
    public init(route: LiveRoute, info: StreamInfo?, sourceIndex: Int) { self.route = route; self.info = info; self.sourceIndex = sourceIndex }
}

public enum LiveSessionEvent: Sendable, Hashable {
    case connecting(sourceIndex: Int, attempt: Int)
    /// The busy clip arrived; retrying within the busy budget.
    case waitingForLine
    case ready(LiveReady)
    case rejoining
    case rejoined(seamless: Bool)
    /// Sent once per session when Layer II audio had to be left out: the app shows
    /// "This channel's sound isn't supported on Apple TV."
    case audioUnsupported
    case switchedSource(index: Int)
    case failed(PlaybackFailure)
    case stopped
}

/// What one guarded open (header deadlines, busy-clip retries) came to.
enum OpenOutcome: Sendable {
    case response(UpstreamResponse)
    case busy
    case status(Int)
    case failed(UpstreamError)
    case stopped
}

/// Opens a provider URL past held requests and the busy clip (Android LiveSlotDataSource + TuneDeadline).
struct GuardedOpener: Sendable {
    let transport: any UpstreamTransport
    let config: LiveSessionConfig
    let clock: any TunerClock
    /// Live: header deadlines and the "finite and short is the busy clip" rule. VOD: neither (ranged files are short).
    let live: Bool

    /// `shouldContinue` is asked before every attempt, after every answer and after every back-off: false (the request
    /// was replaced or its session stopped) ends the loop at once with `.stopped`, so no further provider request is made.
    func open(_ url: URL, headers: [String: String], isBusy: (@Sendable (UpstreamResponse) async -> Bool)? = nil,
              shouldContinue: @Sendable () async -> Bool = { true },
              onWaiting: @Sendable () async -> Void, onAttempt: @Sendable (Int) async -> Void) async -> OpenOutcome {
        let start = clock.now()
        var attempt = 0
        var busyCount = 0
        while true {
            if Task.isCancelled { return .stopped }
            if !(await shouldContinue()) { return .stopped }
            let remaining = config.busyBudget - (clock.now() - start)
            if remaining <= 0 { return .busy }
            let deadline: Double? = live ? min(attempt < config.headerDeadlines.count ? config.headerDeadlines[attempt] : remaining, remaining) : nil
            await onAttempt(attempt)
            do {
                let response = try await transport.open(UpstreamRequest(url: url, headers: headers, headerDeadline: deadline))
                if Task.isCancelled {
                    response.cancel()
                    return .stopped
                }
                if !(await shouldContinue()) {
                    response.cancel()
                    return .stopped
                }
                guard (200..<300).contains(response.status) else {
                    response.cancel()
                    return .status(response.status)
                }
                var busy = false
                if live, let length = response.expectedLength, length < config.busyClipMaxBytes { busy = true }
                if !busy, let isBusy, await isBusy(response) { busy = true }
                if !busy { return .response(response) }
                response.cancel()
                busyCount += 1
                attempt += 1
                await onWaiting()
                let wait = config.busyBackoff[min(busyCount - 1, config.busyBackoff.count - 1)]
                if clock.now() + wait - start >= config.busyBudget { return .busy }
                do { try await clock.sleep(seconds: wait) } catch { return .stopped }
                if !(await shouldContinue()) { return .stopped }
            } catch UpstreamError.headerDeadline {
                // The provider held the request (the previous stream still counted): ask again at once.
                attempt += 1
                if clock.now() - start >= config.busyBudget { return .busy }
            } catch let error as UpstreamError {
                if error == .cancelled && Task.isCancelled { return .stopped }
                return .failed(error)
            } catch {
                return Task.isCancelled ? .stopped : .failed(.cannotConnect(String(describing: error)))
            }
        }
    }
}

/// Holds the channel's single provider connection, segments it and serves playlists/segments to the loopback server.
public actor LiveChannelSession {
    public nonisolated let id: String
    public nonisolated let request: LiveTuneRequest
    private let origin: URL
    private let transport: any UpstreamTransport
    private let config: LiveSessionConfig
    private let clock: any TunerClock
    private static let tick = 0.25

    private enum Probe { case waiting, media, done }
    private enum SourceOutcome { case gone, refused(Int), unreachable }

    private var started = false
    private var stopped = false
    private var runTask: Task<Void, Never>?
    private var subscribers: [UUID: AsyncStream<LiveSessionEvent>.Continuation] = [:]
    private var readyValue: LiveReady?
    private var failure: PlaybackFailure?
    private var readyWaiters: [UUID: CheckedContinuation<LiveReady, any Error>] = [:]
    private var startTime = 0.0

    private var segmenter: TSSegmenter
    private var segments: [TSSegment] = []
    private var info: StreamInfo?
    private var evictedDiscontinuities = 0
    private var lastServedEnd: Int?
    private var segmentWaiters: [UUID: CheckedContinuation<Void, Never>] = [:]
    private var peakBandwidth = 0
    private var audioUnsupportedSent = false
    private var awaitingPlacement = false

    private var response: UpstreamResponse?
    private var readerTask: Task<Void, Never>?
    private var connection = 0
    private var probe = Probe.waiting
    private var probeBuffer = Data()
    private var lastByteAt = 0.0
    private var firstByteAt: Double?
    private var connectionEnded = false
    private var sourceFailure: SourceOutcome?
    private var sourceIndex = 0
    private var mediaStarted = false
    private var failures: [Double] = []
    private var rejoins: [Double] = []

    public init(id: String, request: LiveTuneRequest, origin: URL, transport: any UpstreamTransport,
                config: LiveSessionConfig = LiveSessionConfig(), clock: any TunerClock = SystemClock()) {
        self.id = id
        self.request = request
        self.origin = origin
        self.transport = transport
        var tuned = config
        tuned.segmenter.dropMPEGAudioLayer2 = config.segmenter.dropMPEGAudioLayer2 || request.dropMPEGAudioLayer2
        // EXTINF rounded to a whole second must stay <= EXT-X-TARGETDURATION (RFC 8216 4.3.3.1).
        tuned.segmenter.durationLimit = min(config.segmenter.durationLimit, Double(config.targetDuration) + 0.4)
        self.config = tuned
        self.clock = clock
        segmenter = TSSegmenter(config: tuned.segmenter)
    }

    /// Starts the upstream loop (idempotent).
    public func start() {
        guard !started, !stopped else { return }
        started = true
        startTime = clock.now()
        runTask = Task { await self.run() }
    }

    /// Yields every event from now on.
    public func events() -> AsyncStream<LiveSessionEvent> {
        let (stream, continuation) = AsyncStream.makeStream(of: LiveSessionEvent.self)
        if stopped {
            continuation.yield(.stopped)
            continuation.finish()
            return stream
        }
        let id = UUID()
        subscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeSubscriber(id) }
        }
        return stream
    }

    private func removeSubscriber(_ id: UUID) { subscribers[id] = nil }

    private func emit(_ event: LiveSessionEvent) {
        for continuation in subscribers.values { continuation.yield(event) }
    }

    /// Throws `PlaybackFailure` (or `CancellationError` once the session is stopped).
    public func waitUntilReady() async throws -> LiveReady {
        if let readyValue { return readyValue }
        if let failure { throw failure }
        if stopped { throw CancellationError() }
        let id = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<LiveReady, any Error>) in
                readyWaiters[id] = continuation
            }
        } onCancel: {
            Task { await self.cancelWaiter(id) }
        }
    }

    private func cancelWaiter(_ id: UUID) {
        readyWaiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
    }

    /// Cancels the upstream and returns once its task has ended (the line is free).
    public func stop() async {
        if !stopped {
            stopped = true
            runTask?.cancel()
            response?.cancel()
            readerTask?.cancel()
            for waiter in readyWaiters.values { waiter.resume(throwing: CancellationError()) }
            readyWaiters = [:]
            for waiter in segmentWaiters.values { waiter.resume() }
            segmentWaiters = [:]
        }
        await runTask?.value
        await closeConnection()
        if !subscribers.isEmpty {
            emit(.stopped)
            for continuation in subscribers.values { continuation.finish() }
            subscribers = [:]
        }
    }

    public var isStopped: Bool { stopped }

    // MARK: serving

    public func multivariantPlaylist() -> String? {
        guard readyValue != nil, let info, !segments.isEmpty else { return nil }
        return HLSPlaylistWriter.multivariant(info: info, bandwidth: bandwidth, mediaURI: "media.m3u8")
    }

    public func mediaPlaylist() -> String? {
        let listed = playlistSegments()
        guard let first = listed.first else { return nil }
        let before = evictedDiscontinuities + segments.filter { $0.sequence < first.sequence && $0.discontinuity }.count
        lastServedEnd = listed.last?.sequence
        return HLSPlaylistWriter.media(listed.map { HLSSegmentEntry(sequence: $0.sequence, duration: $0.duration, discontinuity: $0.discontinuity) },
                                       targetDuration: config.targetDuration, discontinuitySequence: before) { "\($0).ts" }
    }

    /// The media playlist, waiting up to `playlistHold` when it would end on the segment the previous response ended on.
    func heldMediaPlaylist() async -> String? {
        if let lastServedEnd, let latest = segments.last?.sequence, latest == lastServedEnd, !stopped, failure == nil {
            let id = UUID()
            let hold = config.playlistHold
            let clock = self.clock
            let timer = Task {
                try? await clock.sleep(seconds: hold)
                self.wakeSegmentWaiter(id)
            }
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                segmentWaiters[id] = continuation
            }
            timer.cancel()
        }
        return mediaPlaylist()
    }

    private func wakeSegmentWaiter(_ id: UUID) { segmentWaiters.removeValue(forKey: id)?.resume() }

    public func segment(sequence: Int) -> Data? { segments.first { $0.sequence == sequence }?.data }

    private var bandwidth: Int { peakBandwidth > 0 ? peakBandwidth : 4_000_000 }

    private func playlistSegments() -> ArraySlice<TSSegment> {
        guard !segments.isEmpty else { return [] }
        var total = 0.0
        var start = segments.count
        while start > 0 && total < config.playlistMinDuration {
            start -= 1
            total += segments[start].duration
        }
        return segments[start...]
    }

    // MARK: upstream loop

    private func run() async {
        var outcomes: [SourceOutcome] = []
        var index = 0
        guard await connect(index) else { return }
        while !Task.isCancelled && !stopped && failure == nil {
            do { try await clock.sleep(seconds: LiveChannelSession.tick) } catch { return }
            if stopped || failure != nil { return }
            let now = clock.now()
            if readyValue == nil && now - startTime >= config.readyTimeout {
                fail(.tooSlow)
                break
            }
            if probe == .done && mediaStarted { continue } // direct HLS: nothing to hold
            if !mediaStarted, let outcome = sourceFailure ?? (connectionEnded ? .unreachable : nil) {
                // This source didn't give a stream: the next one, or the verdict.
                await closeConnection()
                outcomes.append(outcome)
                index += 1
                guard index < request.sources.count else {
                    fail(LiveChannelSession.verdict(outcomes))
                    break
                }
                emit(.switchedSource(index: index))
                guard await connect(index) else { return }
                continue
            }
            guard mediaStarted else { continue }
            // `lastByteAt` restarts with every connection, so a rejoin that never sends a byte is quiet too.
            let quiet = now - lastByteAt >= config.quietTimeout
            let late = segmenter.isPlacing && (firstByteAt.map { now - $0 >= config.placeWithin } ?? false)
            if connectionEnded || quiet || late || sourceFailure != nil {
                await closeConnection()
                guard await rejoin() else { break }
            }
        }
        await closeConnection()
    }

    private static func verdict(_ outcomes: [SourceOutcome]) -> PlaybackFailure {
        if !outcomes.isEmpty && outcomes.allSatisfy({ if case .gone = $0 { return true }; return false }) { return .gone }
        for outcome in outcomes { if case .refused(let status) = outcome { return .refused(status) } }
        return .unreachable
    }

    /// Opens source `index` (busy handling included) and starts reading it. False when the session ended.
    private func connect(_ index: Int) async -> Bool {
        sourceIndex = index
        let outcome = await guardedOpen(index)
        switch outcome {
        case .response(let response):
            begin(response)
            return true
        case .busy:
            fail(.lineBusy)
            return false
        case .status(let status):
            sourceFailure = config.goneStatuses.contains(status) ? .gone : (status == 401 || status == 403 || status == 400) ? .refused(status) : .unreachable
            connectionEnded = true
            return !stopped
        case .failed:
            sourceFailure = .unreachable
            connectionEnded = true
            return !stopped
        case .stopped:
            return false
        }
    }

    private func guardedOpen(_ index: Int) async -> OpenOutcome {
        let opener = GuardedOpener(transport: transport, config: config, clock: clock, live: true)
        return await opener.open(request.sources[index], headers: ["User-Agent": request.userAgent],
                                 onWaiting: { await self.emitWaiting() },
                                 onAttempt: { attempt in await self.emitConnecting(index, attempt) })
    }

    private func emitWaiting() { emit(.waitingForLine) }
    private func emitConnecting(_ index: Int, _ attempt: Int) { emit(.connecting(sourceIndex: index, attempt: attempt)) }

    /// Starts reading a connection; its bytes go to `ingest` on this actor.
    private func begin(_ response: UpstreamResponse) {
        connection += 1
        let current = connection
        self.response = response
        connectionEnded = false
        sourceFailure = nil
        firstByteAt = nil
        lastByteAt = clock.now()
        if !mediaStarted {
            probe = .waiting
            probeBuffer = Data()
        }
        readerTask = Task {
            do {
                for try await chunk in response.body {
                    self.ingest(chunk, connection: current)
                }
                self.connectionDidEnd(current)
            } catch {
                self.connectionDidEnd(current)
            }
        }
    }

    private func connectionDidEnd(_ id: Int) {
        guard id == connection else { return }
        if probe == .waiting && !probeBuffer.isEmpty { decideProbe(final: true) }
        connectionEnded = true
    }

    private func closeConnection() async {
        let reader = readerTask
        response?.cancel()
        reader?.cancel()
        response = nil
        readerTask = nil
        connection += 1
        await reader?.value
    }

    private func ingest(_ chunk: Data, connection id: Int) {
        guard id == connection, !stopped, failure == nil else { return }
        let now = clock.now()
        lastByteAt = now
        if firstByteAt == nil { firstByteAt = now }
        switch probe {
        case .waiting:
            probeBuffer.append(chunk)
            decideProbe(final: false)
        case .media:
            feed(chunk)
        case .done:
            break
        }
    }

    private func decideProbe(final: Bool) {
        let enough = probeBuffer.count >= 3 * MPEGTS.packetSize + 1
        switch MPEGTS.sniff(probeBuffer) {
        case .transportStream:
            probe = .media
            mediaStarted = true
            let buffered = probeBuffer
            probeBuffer = Data()
            feed(buffered)
        case .hlsPlaylist:
            probe = .done
            mediaStarted = true
            let url = response?.url ?? request.sources[sourceIndex]
            let direct = url.pathExtension.lowercased() == "m3u8" ? url : request.sources[sourceIndex]
            response?.cancel()
            readerTask?.cancel()
            setReady(LiveReady(route: .direct(direct), info: nil, sourceIndex: sourceIndex))
        case .html:
            probe = .done
            sourceFailure = .gone
        case .unknown:
            if enough && probeBuffer.count >= 4096 || final {
                probe = .done
                sourceFailure = .gone
            }
        }
    }

    private func feed(_ data: Data) {
        let outputs = segmenter.push(data)
        handle(outputs)
    }

    private func handle(_ outputs: [SegmenterOutput]) {
        for output in outputs {
            switch output {
            case .streamInfo(let streamInfo):
                info = streamInfo
                if streamInfo.audioDropped && !audioUnsupportedSent {
                    audioUnsupportedSent = true
                    emit(.audioUnsupported)
                }
            case .segment(let segment):
                add(segment)
            case .unsupported(let format):
                fail(.unsupported(format))
                response?.cancel()
                return
            }
        }
        if awaitingPlacement && !segmenter.isPlacing {
            awaitingPlacement = false
            emit(.rejoined(seamless: !segmenter.lastPlacementWasDiscontinuity))
        }
    }

    private func add(_ segment: TSSegment) {
        segments.append(segment)
        if segment.duration > 0 {
            let rate = Int(Double(segment.data.count * 8) / segment.duration * 1.1)
            peakBandwidth = max(peakBandwidth, rate)
        }
        // Keep the playlist window plus a few segments for requests in flight, within the memory cap.
        let listed = playlistSegments()
        let keepFrom = max(0, (listed.startIndex) - config.retainExtraSegments)
        if keepFrom > 0 {
            for old in segments[..<keepFrom] where old.discontinuity { evictedDiscontinuities += 1 }
            segments.removeFirst(keepFrom)
        }
        var bytes = segments.reduce(0) { $0 + $1.data.count }
        while bytes > config.maxBufferedBytes && segments.count > 1 {
            let old = segments.removeFirst()
            if old.discontinuity { evictedDiscontinuities += 1 }
            bytes -= old.data.count
        }
        for waiter in segmentWaiters.values { waiter.resume() }
        segmentWaiters = [:]
        if readyValue == nil && segments.count >= config.readySegments {
            let path = info?.codecs != nil ? "index.m3u8" : "media.m3u8"
            let url = origin.appendingPathComponent("live").appendingPathComponent(id).appendingPathComponent(path)
            setReady(LiveReady(route: .loopback(url), info: info, sourceIndex: sourceIndex))
        }
    }

    private func setReady(_ ready: LiveReady) {
        guard readyValue == nil, failure == nil else { return }
        readyValue = ready
        emit(.ready(ready))
        for waiter in readyWaiters.values { waiter.resume(returning: ready) }
        readyWaiters = [:]
    }

    private func fail(_ failure: PlaybackFailure) {
        guard self.failure == nil, !stopped else { return }
        self.failure = failure
        emit(.failed(failure))
        for waiter in readyWaiters.values { waiter.resume(throwing: failure) }
        readyWaiters = [:]
        for waiter in segmentWaiters.values { waiter.resume() }
        segmentWaiters = [:]
    }

    /// Replaces a lost connection while AVPlayer plays its buffer (Android LiveRejoin pacing). False when it gave up.
    /// The source that was playing is asked again with the paced delays; an error status (a panel restarting the stream
    /// answers 404 for a moment) is retried like a lost connection. When the pacing gives up, every other source is
    /// tried once before the session ends. A channel that was playing is never retired from here: the result is
    /// `.refused` when every answer was 400/401/403, else `.ended` (tuning it again gives the full verdict).
    private func rejoin() async -> Bool {
        let playing = sourceIndex
        var answers: [Int] = [] // statuses answered during this outage; 0 = no answer (network error)
        while !stopped && failure == nil {
            let now = clock.now()
            failures.removeAll { now - $0 >= config.rejoinDelayWindow }
            rejoins.removeAll { now - $0 >= config.maxRejoinsWindow }
            failures.append(now)
            if failures.count > config.rejoinDelays.count || rejoins.count >= config.maxRejoins { break }
            rejoins.append(now)
            emit(.rejoining)
            let delay = config.rejoinDelays[min(failures.count - 1, config.rejoinDelays.count - 1)]
            if delay > 0 {
                do { try await clock.sleep(seconds: delay) } catch { return false }
            }
            if stopped { return false }
            switch await attemptRejoin(playing) {
            case .joined: return true
            case .over: return false
            case .answered(let status): answers.append(status)
            }
        }
        if stopped || failure != nil { return false }
        // The playing source can't be brought back: the other sources, once each.
        for index in request.sources.indices where index != playing {
            if stopped || failure != nil { return false }
            emit(.switchedSource(index: index))
            switch await attemptRejoin(index) {
            case .joined: return true
            case .over: return false
            case .answered(let status): answers.append(status)
            }
        }
        let refusals: Set<Int> = [400, 401, 403]
        if let first = answers.first, answers.allSatisfy(refusals.contains) {
            fail(.refused(first))
        } else {
            fail(.ended)
        }
        return false
    }

    private enum RejoinAttempt {
        /// The new connection is being read (and spliced in).
        case joined
        /// The session ended (stopped, busy line, or failed).
        case over
        /// No stream: the status it answered with (0 for a network error).
        case answered(Int)
    }

    /// One guarded open of `index` during a rejoin; on success the new connection is spliced into the stream.
    private func attemptRejoin(_ index: Int) async -> RejoinAttempt {
        switch await guardedOpen(index) {
        case .response(let response):
            sourceIndex = index
            segmenter.reconnect()
            awaitingPlacement = segmenter.isPlacing
            begin(response)
            return .joined
        case .busy:
            fail(.lineBusy)
            return .over
        case .status(let status):
            return .answered(status)
        case .failed:
            return .answered(0)
        case .stopped:
            return .over
        }
    }
}

// MARK: - VOD through the loopback proxy

public struct VODRequest: Sendable, Hashable {
    /// Movie or episode id (for logs).
    public var id: String
    /// Primary URL, then other uploads. Backups are only tried before the first byte reached AVPlayer.
    public var sources: [URL]
    public var containerExtension: String?
    public var userAgent: String
    public init(id: String, sources: [URL], containerExtension: String?, userAgent: String = TunerLinks.streamUserAgent) {
        self.id = id; self.sources = sources; self.containerExtension = containerExtension; self.userAgent = userAgent
    }
}

public enum VODSessionEvent: Sendable, Hashable {
    case waitingForLine
    case switchedSource(index: Int)
    case failed(PlaybackFailure)
}

/// Pulls a response body for the loopback server: an optional first chunk read ahead, bytes skipped and capped for
/// a synthesized range, and the upstream cancelled when the client goes away.
private final class BodyPump: @unchecked Sendable {
    private var first: Data?
    private var iterator: AsyncThrowingStream<Data, any Error>.AsyncIterator
    private var skip: Int64
    private var remaining: Int64?
    private let cancel: @Sendable () -> Void
    private let onFirstByte: @Sendable () -> Void
    private var sentAny = false

    init(first: Data?, iterator: AsyncThrowingStream<Data, any Error>.AsyncIterator, skip: Int64, limit: Int64?,
         cancel: @escaping @Sendable () -> Void, onFirstByte: @escaping @Sendable () -> Void) {
        self.first = first
        self.iterator = iterator
        self.skip = skip
        remaining = limit
        self.cancel = cancel
        self.onFirstByte = onFirstByte
    }

    deinit { cancel() }

    func next() async throws -> Data? {
        while true {
            if let remaining, remaining <= 0 { cancel(); return nil }
            var chunk: Data
            if let first {
                chunk = first
                self.first = nil
            } else {
                var it = iterator
                let next = try await it.next()
                iterator = it
                guard let next else { return nil }
                chunk = next
            }
            if skip > 0 {
                if Int64(chunk.count) <= skip {
                    skip -= Int64(chunk.count)
                    continue
                }
                chunk = chunk.subdata(in: (chunk.startIndex + Int(skip))..<chunk.endIndex)
                skip = 0
            }
            if let left = remaining, Int64(chunk.count) > left { chunk = chunk.prefix(Int(left)) }
            if let left = remaining { remaining = left - Int64(chunk.count) }
            if chunk.isEmpty { continue }
            if !sentAny {
                sentAny = true
                onFirstByte()
            }
            return chunk
        }
    }
}

/// Byte-range proxy: one upstream at a time, newest request wins (the older upstream is cancelled first), busy clip
/// detected (video/mp2t or TS sync bytes on a file request) and retried within the busy budget, Content-Type fixed
/// from the container (video/mp4, video/quicktime).
public actor VODSession {
    public nonisolated let id: String
    /// http://127.0.0.1:<port>/vod/<id>/media.<mp4|mov>
    public nonisolated let localURL: URL
    private let request: VODRequest
    private let transport: any UpstreamTransport
    private let config: LiveSessionConfig
    private let clock: any TunerClock
    private var subscribers: [UUID: AsyncStream<VODSessionEvent>.Continuation] = [:]
    private var token = 0
    private var currentCancel: (@Sendable () -> Void)?
    /// Requests still opening the provider (busy retries included), by token: cancelled and awaited by a newer request
    /// and by `stop()`, so no provider request is ever made after either.
    private var opening: [Int: Task<HTTPResponse, Never>] = [:]
    private var workingSource: Int?
    private var stopped = false
    private var totalLength: Int64?

    public init(id: String, request: VODRequest, origin: URL, transport: any UpstreamTransport,
                config: LiveSessionConfig = LiveSessionConfig(), clock: any TunerClock = SystemClock()) {
        self.id = id
        self.request = request
        self.transport = transport
        self.config = config
        self.clock = clock
        let ext: String
        switch PlaybackSupport.vodContainer(url: request.sources.first ?? origin, containerExtension: request.containerExtension) {
        case .quickTime: ext = "mov"
        default: ext = "mp4"
        }
        localURL = origin.appendingPathComponent("vod").appendingPathComponent(id).appendingPathComponent("media.\(ext)")
    }

    public func events() -> AsyncStream<VODSessionEvent> {
        let (stream, continuation) = AsyncStream.makeStream(of: VODSessionEvent.self)
        let id = UUID()
        subscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.removeSubscriber(id) }
        }
        return stream
    }

    private func removeSubscriber(_ id: UUID) { subscribers[id] = nil }

    private func emit(_ event: VODSessionEvent) {
        for continuation in subscribers.values { continuation.yield(event) }
    }

    private var contentType: String {
        switch PlaybackSupport.vodContainer(url: request.sources.first ?? localURL, containerExtension: request.containerExtension) {
        case .quickTime: return "video/quicktime"
        case .hls: return "application/vnd.apple.mpegurl"
        default: return "video/mp4"
        }
    }

    private func markWorking(_ index: Int) { if workingSource == nil { workingSource = index } }

    public func respond(to head: HTTPRequestHead) async -> HTTPResponse {
        guard !stopped else { return .status(410) }
        guard head.method == "GET" || head.method == "HEAD" else { return .status(405) }
        // Newest request wins: the previous upstream is closed, and older requests still opening the provider are
        // cancelled and waited for, before this one opens (one connection per line).
        token += 1
        let mine = token
        currentCancel?()
        currentCancel = nil
        let older = Array(opening.values)
        for task in older { task.cancel() }
        for task in older { _ = await task.value }
        guard mine == token, !stopped else { return .status(503) }
        let work = Task { await self.open(head, mine: mine) }
        opening[mine] = work
        // The client going away (the server's task cancelled) cancels the open too.
        let response = await withTaskCancellationHandler {
            await work.value
        } onCancel: {
            work.cancel()
        }
        opening[mine] = nil
        return response
    }

    private func isCurrent(_ mine: Int) -> Bool { mine == token && !stopped }

    private func open(_ head: HTTPRequestHead, mine: Int) async -> HTTPResponse {
        let isHead = head.method == "HEAD"
        let indices: [Int] = workingSource.map { [$0] } ?? Array(request.sources.indices)
        var outcomes: [Int] = []
        let busyStart = clock.now()
        var busyCount = 0
        sources: for (position, index) in indices.enumerated() {
            if position > 0 { emit(.switchedSource(index: index)) }
            while true {
                let range = isHead ? ByteRange(start: 0, end: 0) : head.range
                var headers = ["User-Agent": request.userAgent, "Accept-Encoding": "identity"]
                if let range { headers["Range"] = range.headerValue }
                let opener = GuardedOpener(transport: transport, config: config, clock: clock, live: false)
                let outcome = await opener.open(request.sources[index], headers: headers, isBusy: { response in
                    // The provider's "connection limit" notice is a short TS clip, never the movie file.
                    let type = response.headers["content-type"]?.lowercased() ?? ""
                    return type.contains("mp2t")
                }, shouldContinue: { await self.isCurrent(mine) }, onWaiting: { await self.emitWaiting() }, onAttempt: { _ in })
                guard mine == token, !stopped else {
                    if case .response(let response) = outcome { response.cancel() }
                    return .status(503)
                }
                switch outcome {
                case .response(let response):
                    var iterator = response.body.makeAsyncIterator()
                    var first: Data?
                    do { first = try await iterator.next() } catch { first = nil }
                    guard mine == token, !stopped, !Task.isCancelled else { response.cancel(); return .status(503) }
                    if let first, MPEGTS.sniff(first) == .transportStream {
                        // TS sync bytes on a file request: the busy clip without its content type. Retry within the budget.
                        response.cancel()
                        emit(.waitingForLine)
                        busyCount += 1
                        let wait = config.busyBackoff[min(busyCount - 1, config.busyBackoff.count - 1)]
                        guard clock.now() + wait - busyStart < config.busyBudget else {
                            outcomes.append(-1)
                            continue sources
                        }
                        do { try await clock.sleep(seconds: wait) } catch { return .status(503) }
                        guard mine == token, !stopped else { return .status(503) }
                        continue
                    }
                    if let first, MPEGTS.sniff(first) == .html {
                        response.cancel()
                        outcomes.append(404)
                        continue sources
                    }
                    return reply(response, first: first, iterator: iterator, range: isHead ? nil : head.range, isHead: isHead, index: index)
                case .busy:
                    emit(.failed(.lineBusy))
                    return .status(503, text: PlaybackFailure.lineBusy.message)
                case .status(let status):
                    if status == 416 { return HTTPResponse(status: 416, headers: totalLength.map { [HTTPHeader("Content-Range", "bytes */\($0)")] } ?? []) }
                    outcomes.append(status)
                    continue sources
                case .failed:
                    outcomes.append(0)
                    continue sources
                case .stopped:
                    return .status(503)
                }
            }
        }
        let failure: PlaybackFailure
        if !outcomes.isEmpty && outcomes.allSatisfy({ $0 == 404 || $0 == 410 }) {
            failure = .gone
        } else if let refused = outcomes.first(where: { $0 == 401 || $0 == 403 }) {
            failure = .refused(refused)
        } else if outcomes.contains(-1) {
            failure = .lineBusy
        } else {
            failure = .unreachable
        }
        emit(.failed(failure))
        return .status(failure == .gone ? 404 : 502, text: failure.message)
    }

    private func emitWaiting() { emit(.waitingForLine) }

    private func reply(_ response: UpstreamResponse, first: Data?, iterator: AsyncThrowingStream<Data, any Error>.AsyncIterator,
                       range: ByteRange?, isHead: Bool, index: Int) -> HTTPResponse {
        markWorking(index)
        var total: Int64?
        var upstreamStart: Int64 = 0
        if response.status == 206, let contentRange = response.headers["content-range"] {
            // "bytes 0-1023/146515"
            let parts = contentRange.replacingOccurrences(of: "bytes", with: "").trimmingCharacters(in: .whitespaces).split(separator: "/")
            if parts.count == 2 {
                total = Int64(parts[1].trimmingCharacters(in: .whitespaces))
                upstreamStart = Int64(parts[0].split(separator: "-").first?.trimmingCharacters(in: .whitespaces) ?? "") ?? 0
            }
        } else if response.status == 200 {
            total = response.expectedLength
        }
        if let total { totalLength = total }
        let cancel = response.cancel
        var headers = [HTTPHeader("Content-Type", contentType), HTTPHeader("Accept-Ranges", "bytes"), HTTPHeader("Cache-Control", "no-store")]
        if isHead {
            cancel()
            if let total = total ?? totalLength { headers.append(HTTPHeader("Content-Length", String(total))) }
            return HTTPResponse(status: 200, headers: headers, body: .empty)
        }
        let status: Int
        var skip: Int64 = 0
        var limit: Int64?
        if let range {
            let start = range.start
            if response.status == 206 {
                status = 206
                if let value = response.headers["content-range"] { headers.append(HTTPHeader("Content-Range", value)) }
                if let length = response.expectedLength { headers.append(HTTPHeader("Content-Length", String(length))) }
                skip = max(0, start - upstreamStart)
            } else if let total {
                // The provider ignored the range: cut the requested bytes out of the whole file.
                let end = min(range.end ?? (total - 1), total - 1)
                guard start <= end else {
                    cancel()
                    return HTTPResponse(status: 416, headers: [HTTPHeader("Content-Range", "bytes */\(total)")])
                }
                status = 206
                skip = start
                limit = end - start + 1
                headers.append(HTTPHeader("Content-Range", "bytes \(start)-\(end)/\(total)"))
                headers.append(HTTPHeader("Content-Length", String(end - start + 1)))
            } else {
                // The provider ignored the range and sent no length: pass the whole file on as a plain 200 (a 200 body
                // must start at byte 0; cutting it would put every byte at the wrong offset).
                status = 200
            }
        } else {
            status = 200
            if let length = response.expectedLength { headers.append(HTTPHeader("Content-Length", String(length))) }
        }
        let pump = BodyPump(first: first, iterator: iterator, skip: skip, limit: limit, cancel: cancel, onFirstByte: {})
        currentCancel = cancel
        return HTTPResponse(status: status, headers: headers, body: .stream(AsyncThrowingStream(unfolding: { try await pump.next() })))
    }

    /// Closes the upstream and returns once no request is opening the provider any more (the line is free).
    public func stop() async {
        stopped = true
        currentCancel?()
        currentCancel = nil
        let pending = Array(opening.values)
        for task in pending { task.cancel() }
        for task in pending { _ = await task.value }
        for continuation in subscribers.values { continuation.finish() }
        subscribers = [:]
    }
}

// MARK: - HTTP/1.1 pieces for the loopback server (socket glue lives in the app)

public struct ByteRange: Sendable, Hashable {
    public var start: Int64
    /// Inclusive; nil = to the end.
    public var end: Int64?
    public init(start: Int64, end: Int64?) { self.start = start; self.end = end }
    /// "bytes=<start>-[end]"
    public var headerValue: String { "bytes=\(start)-" + (end.map(String.init) ?? "") }
}

public struct HTTPRequestHead: Sendable, Hashable {
    public var method: String
    /// Path without the query, percent-decoded.
    public var path: String
    /// Lowercased names.
    public var headers: [String: String]
    /// Parsed "Range: bytes=a-b" (single range only).
    public var range: ByteRange?
    public init(method: String, path: String, headers: [String: String] = [:], range: ByteRange? = nil) {
        self.method = method; self.path = path; self.headers = headers; self.range = range
    }

    public enum Parse: Sendable, Hashable {
        case incomplete
        case invalid
        case complete(HTTPRequestHead, headerLength: Int)
    }

    static let maxHeadBytes = 16 * 1024

    /// Parses the head up to CRLFCRLF; heads over 16 KiB are invalid.
    public static func parse(_ bytes: Data) -> Parse {
        let b = [UInt8](bytes.prefix(maxHeadBytes + 4))
        var end: Int?
        var i = 0
        while i + 3 < b.count {
            if b[i] == 13 && b[i + 1] == 10 && b[i + 2] == 13 && b[i + 3] == 10 { end = i; break }
            i += 1
        }
        guard let end else { return bytes.count > maxHeadBytes ? .invalid : .incomplete }
        guard end + 4 <= maxHeadBytes else { return .invalid }
        guard let text = String(bytes: b[0..<end], encoding: .utf8) ?? String(bytes: b[0..<end], encoding: .isoLatin1) else { return .invalid }
        let lines = text.components(separatedBy: "\r\n")
        let requestLine = lines[0].split(separator: " ", omittingEmptySubsequences: true)
        guard requestLine.count == 3, requestLine[2].hasPrefix("HTTP/1.") else { return .invalid }
        let method = String(requestLine[0]).uppercased()
        var target = String(requestLine[1])
        if target.lowercased().hasPrefix("http://") || target.lowercased().hasPrefix("https://") {
            guard let url = URLComponents(string: target) else { return .invalid }
            target = url.percentEncodedPath.isEmpty ? "/" : url.percentEncodedPath
        }
        if let query = target.firstIndex(where: { $0 == "?" || $0 == "#" }) { target = String(target[..<query]) }
        guard target.hasPrefix("/"), let path = target.removingPercentEncoding else { return .invalid }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { return .invalid }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { return .invalid }
            headers[name] = headers[name].map { $0 + ", " + value } ?? value
        }
        return .complete(HTTPRequestHead(method: method, path: path, headers: headers, range: headers["range"].flatMap(parseRange)),
                         headerLength: end + 4)
    }

    /// "bytes=a-b" / "bytes=a-" (single range); suffix and multiple ranges are ignored (the whole file is sent).
    static func parseRange(_ value: String) -> ByteRange? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        guard trimmed.lowercased().hasPrefix("bytes="), !trimmed.contains(",") else { return nil }
        let spec = trimmed.dropFirst(6)
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, let start = Int64(parts[0].trimmingCharacters(in: .whitespaces)), start >= 0 else { return nil }
        let endText = parts[1].trimmingCharacters(in: .whitespaces)
        if endText.isEmpty { return ByteRange(start: start, end: nil) }
        guard let end = Int64(endText), end >= start else { return nil }
        return ByteRange(start: start, end: end)
    }
}

public struct HTTPHeader: Sendable, Hashable {
    public var name: String
    public var value: String
    public init(_ name: String, _ value: String) { self.name = name; self.value = value }
}

public enum HTTPBody: Sendable {
    case empty
    case data(Data)
    /// The server writes chunks as they come; when the client goes away it stops iterating, which cancels the producer.
    case stream(AsyncThrowingStream<Data, any Error>)
}

public struct HTTPResponse: Sendable {
    public var status: Int
    public var headers: [HTTPHeader]
    public var body: HTTPBody
    public init(status: Int, headers: [HTTPHeader] = [], body: HTTPBody = .empty) { self.status = status; self.headers = headers; self.body = body }

    static func reason(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 204: return "No Content"
        case 206: return "Partial Content"
        case 400: return "Bad Request"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 410: return "Gone"
        case 416: return "Range Not Satisfiable"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        case 504: return "Gateway Timeout"
        default: return "Status"
        }
    }

    /// "HTTP/1.1 <status> <reason>\r\n" + headers + "Connection: close\r\n" (+ Content-Length for .data/.empty) + "\r\n".
    /// A Content-Length the headers already carry is kept (HEAD answers and ranged streams set their own).
    public func serializedHead() -> Data {
        var text = "HTTP/1.1 \(status) \(HTTPResponse.reason(status))\r\n"
        var hasLength = false
        for header in headers where header.name.lowercased() != "connection" {
            if header.name.lowercased() == "content-length" { hasLength = true }
            let value = header.value.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
            text += "\(header.name): \(value)\r\n"
        }
        text += "Connection: close\r\n"
        if !hasLength {
            switch body {
            case .empty: text += "Content-Length: 0\r\n"
            case .data(let data): text += "Content-Length: \(data.count)\r\n"
            case .stream: break
            }
        }
        text += "\r\n"
        return Data(text.utf8)
    }

    public static func status(_ status: Int, text: String = "") -> HTTPResponse {
        let message = text.isEmpty ? reason(status) : text
        return HTTPResponse(status: status, headers: [HTTPHeader("Content-Type", "text/plain; charset=utf-8"), HTTPHeader("Cache-Control", "no-store")],
                            body: .data(Data((message + "\n").utf8)))
    }
}

/// Routes:
///   GET /live/<sid>/index.m3u8   multivariant (503 until ready)
///   GET /live/<sid>/media.m3u8   media playlist, "Cache-Control: no-cache", application/vnd.apple.mpegurl
///   GET /live/<sid>/<seq>.ts     segment, video/mp2t (404 when evicted)
///   GET|HEAD /vod/<sid>/media.<ext>   byte-range proxy
/// Anything else → 404. Requests for a stopped session → 410.
public actor MediaServer {
    private let transport: any UpstreamTransport
    private let config: LiveSessionConfig
    private let clock: any TunerClock
    private var originURL: URL?
    private var liveSessions: [String: LiveChannelSession] = [:]
    private var vodSessions: [String: VODSession] = [:]
    private var currentLive: LiveChannelSession?
    private var currentVOD: VODSession?
    /// Sessions being stopped right now: every `stopAll` waits for all of them, so a tune that slips in while an
    /// older one is still hanging up never opens a second provider connection.
    private var stoppingLive: [String: LiveChannelSession] = [:]
    private var stoppingVOD: [String: VODSession] = [:]
    /// The newest tuneLive/openVOD; an older call that resumes after a newer one throws `CancellationError`.
    private var tuneGeneration = 0
    private var goneIDs: [String] = []
    private var workingSources: [String: URL] = [:]

    public init(transport: any UpstreamTransport, config: LiveSessionConfig = LiveSessionConfig(),
                clock: any TunerClock = SystemClock()) {
        self.transport = transport
        self.config = config
        self.clock = clock
    }

    /// http://127.0.0.1:<port>; set by the app once its listener is ready (and again after a restart).
    public func setOrigin(_ origin: URL) { originURL = origin }
    public var origin: URL? { originURL }

    public func respond(to request: HTTPRequestHead) async -> HTTPResponse {
        let parts = request.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 3 else { return .status(404) }
        let (kind, sessionID, file) = (parts[0], parts[1], parts[2])
        let isHead = request.method == "HEAD"
        switch kind {
        case "live":
            guard request.method == "GET" || isHead else { return .status(405) }
            guard let session = liveSessions[sessionID] else { return .status(goneIDs.contains(sessionID) ? 410 : 404) }
            if await session.isStopped { return .status(410) }
            let playlistHeaders = [HTTPHeader("Content-Type", "application/vnd.apple.mpegurl"), HTTPHeader("Cache-Control", "no-cache")]
            switch file {
            case "index.m3u8":
                guard let text = await session.multivariantPlaylist() else { return .status(503) }
                return HTTPResponse(status: 200, headers: playlistHeaders, body: .data(Data(text.utf8)))
            case "media.m3u8":
                guard let text = isHead ? await session.mediaPlaylist() : await session.heldMediaPlaylist() else { return .status(503) }
                return HTTPResponse(status: 200, headers: playlistHeaders, body: .data(Data(text.utf8)))
            default:
                guard file.hasSuffix(".ts"), let sequence = Int(file.dropLast(3)), let data = await session.segment(sequence: sequence) else {
                    return .status(404)
                }
                return HTTPResponse(status: 200, headers: [HTTPHeader("Content-Type", "video/mp2t"), HTTPHeader("Cache-Control", "no-cache")],
                                    body: .data(data))
            }
        case "vod":
            guard let session = vodSessions[sessionID] else { return .status(goneIDs.contains(sessionID) ? 410 : 404) }
            guard file.hasPrefix("media.") else { return .status(404) }
            return await session.respond(to: request)
        default:
            return .status(404)
        }
    }

    /// Stops whatever plays now and waits until its connection is closed, then starts this channel.
    /// Throws `PlaybackFailure.unreachable` if no origin is set, and `CancellationError` when a newer tuneLive/openVOD
    /// arrived while this one was waiting for the line to be free (the newest request wins).
    public func tuneLive(_ request: LiveTuneRequest) async throws -> LiveChannelSession {
        guard let origin = originURL else { throw PlaybackFailure.unreachable }
        tuneGeneration += 1
        let mine = tuneGeneration
        await stopAll()
        guard mine == tuneGeneration else { throw CancellationError() }
        var ordered = request
        if let working = workingSources[request.channelKey], let index = ordered.sources.firstIndex(of: working), index > 0 {
            ordered.sources.remove(at: index)
            ordered.sources.insert(working, at: 0)
        }
        let session = LiveChannelSession(id: MediaServer.makeID(), request: ordered, origin: origin, transport: transport, config: config, clock: clock)
        liveSessions[session.id] = session
        currentLive = session
        await session.start()
        return session
    }

    /// Stops whatever plays now (live or VOD) first. Throws like `tuneLive`.
    public func openVOD(_ request: VODRequest) async throws -> VODSession {
        guard let origin = originURL else { throw PlaybackFailure.unreachable }
        tuneGeneration += 1
        let mine = tuneGeneration
        await stopAll()
        guard mine == tuneGeneration else { throw CancellationError() }
        let session = VODSession(id: MediaServer.makeID(), request: request, origin: origin, transport: transport, config: config, clock: clock)
        vodSessions[session.id] = session
        currentVOD = session
        return session
    }

    /// Remembers which source index worked for a channel (session memory) so it is tried first next time.
    public func noteWorkingSource(channelKey: String, url: URL) { workingSources[channelKey] = url }

    public func stopAll() async {
        if let live = currentLive { stoppingLive[live.id] = live }
        if let vod = currentVOD { stoppingVOD[vod.id] = vod }
        currentLive = nil
        currentVOD = nil
        // Wait for every session being stopped, including ones another caller started stopping (stop() is idempotent
        // and returns once that session's connection is closed).
        for (id, live) in stoppingLive {
            await live.stop()
            stoppingLive[id] = nil
            retire(id)
            liveSessions[id] = nil
        }
        for (id, vod) in stoppingVOD {
            await vod.stop()
            stoppingVOD[id] = nil
            retire(id)
            vodSessions[id] = nil
        }
    }

    private func retire(_ id: String) {
        goneIDs.append(id)
        if goneIDs.count > 64 { goneIDs.removeFirst(goneIDs.count - 64) }
    }

    static func makeID() -> String {
        String(UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased().prefix(16))
    }
}

// MARK: - Sidecar subtitles (drawn by the app over the video)

public struct SubtitleCue: Sendable, Hashable {
    public var start: Double
    public var end: Double
    /// Plain text, tags stripped, lines joined with "\n".
    public var text: String
    public init(start: Double, end: Double, text: String) { self.start = start; self.end = end; self.text = text }
}

public enum SubtitleParser {
    private static let timing = Pattern(#"((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3})"#)
    private static let tags = Pattern(#"<[^>]*>"#)
    private static let braces = Pattern(#"\{[^}]*\}"#)
    private static let paragraph = Pattern(#"<(?:[A-Za-z0-9_]+:)?p\b([^>]*)>([\s\S]*?)</(?:[A-Za-z0-9_]+:)?p>"#)
    private static let lineBreak = Pattern(#"<(?:[A-Za-z0-9_]+:)?br\s*/?>"#, caseInsensitive: true)
    private static let attribute = Pattern(#"([A-Za-z_:]+)\s*=\s*"([^"]*)""#)

    /// SRT, WebVTT, SSA/ASS (Dialogue lines, override tags removed), TTML (<p begin end>). Sorted by start.
    public static func parse(_ data: Data, format: SubtitleFormat) -> [SubtitleCue] {
        var text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .windowsCP1252) ?? String(decoding: data, as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        text = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let cues: [SubtitleCue]
        switch format {
        case .srt, .webvtt: cues = parseBlocks(text)
        case .ssa: cues = parseSSA(text)
        case .ttml: cues = parseTTML(text)
        }
        return cues.filter { $0.end > $0.start && !$0.text.isEmpty }.enumerated()
            .sorted { $0.element.start != $1.element.start ? $0.element.start < $1.element.start : $0.offset < $1.offset }.map(\.element)
    }

    /// Binary search; nil between cues.
    public static func cue(at time: Double, in cues: [SubtitleCue]) -> SubtitleCue? {
        var low = 0, high = cues.count - 1, found = -1
        while low <= high {
            let mid = (low + high) / 2
            if cues[mid].start <= time { found = mid; low = mid + 1 } else { high = mid - 1 }
        }
        guard found >= 0 else { return nil }
        // Overlapping cues: the latest one that started and hasn't ended.
        var index = found
        while index >= 0 && index > found - 8 {
            if cues[index].end > time && cues[index].start <= time { return cues[index] }
            index -= 1
        }
        return nil
    }

    /// SRT and WebVTT: blank-line separated blocks with a "start --> end" line.
    private static func parseBlocks(_ text: String) -> [SubtitleCue] {
        var cues: [SubtitleCue] = []
        for block in text.components(separatedBy: "\n\n") {
            let lines = block.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
            guard let timeIndex = lines.firstIndex(where: { $0.contains("-->") }), let groups = timing.groups(lines[timeIndex]),
                  let start = groups[0].flatMap(clockSeconds), let end = groups[1].flatMap(clockSeconds) else { continue }
            let body = lines[(timeIndex + 1)...].map { clean(tags.replace(braces.replace($0, with: ""), with: "")) }.filter { !$0.isEmpty }
            cues.append(SubtitleCue(start: start, end: end, text: body.joined(separator: "\n")))
        }
        return cues
    }

    /// "[h:]mm:ss,mmm" / "[h:]mm:ss.mmm".
    static func clockSeconds(_ text: String) -> Double? {
        let normalized = text.replacingOccurrences(of: ",", with: ".")
        let parts = normalized.split(separator: ":")
        guard (2...3).contains(parts.count) else { return nil }
        var total = 0.0
        for part in parts {
            guard let value = Double(part) else { return nil }
            total = total * 60 + value
        }
        return total
    }

    private static func parseSSA(_ text: String) -> [SubtitleCue] {
        var format = ["layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text"]
        var inEvents = false
        var cues: [SubtitleCue] = []
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("[") { inEvents = line.lowercased() == "[events]"; continue }
            guard inEvents else { continue }
            if line.lowercased().hasPrefix("format:") {
                format = line.dropFirst(7).split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                continue
            }
            guard line.lowercased().hasPrefix("dialogue:") else { continue }
            let fields = line.dropFirst(9).split(separator: ",", maxSplits: max(0, format.count - 1), omittingEmptySubsequences: false)
                .map { $0.trimmingCharacters(in: .whitespaces) }
            guard fields.count == format.count, let startIndex = format.firstIndex(of: "start"), let endIndex = format.firstIndex(of: "end"),
                  let textIndex = format.firstIndex(of: "text"), let start = clockSeconds(fields[startIndex]), let end = clockSeconds(fields[endIndex])
            else { continue }
            var body = braces.replace(fields[textIndex], with: "")
            body = body.replacingOccurrences(of: "\\N", with: "\n").replacingOccurrences(of: "\\n", with: "\n").replacingOccurrences(of: "\\h", with: " ")
            let lines = body.split(separator: "\n").map { clean(String($0)) }.filter { !$0.isEmpty }
            cues.append(SubtitleCue(start: start, end: end, text: lines.joined(separator: "\n")))
        }
        return cues
    }

    private static func parseTTML(_ text: String) -> [SubtitleCue] {
        var tickRate = 10_000_000.0
        var frameRate = 30.0
        if let root = Pattern(#"<(?:[A-Za-z0-9_]+:)?tt\b([^>]*)>"#).groups(text)?.first ?? nil {
            let attributes = attributesOf(root)
            if let value = attributes["tickrate"].flatMap(Double.init) { tickRate = value }
            if let value = attributes["framerate"].flatMap(Double.init) { frameRate = value }
        }
        var cues: [SubtitleCue] = []
        for match in paragraph.allMatches(text) {
            let groups = Pattern.groups(of: match, in: text)
            let attributes = attributesOf(groups[0] ?? "")
            guard let start = attributes["begin"].flatMap({ ttmlTime($0, tickRate: tickRate, frameRate: frameRate) }) else { continue }
            var end = attributes["end"].flatMap { ttmlTime($0, tickRate: tickRate, frameRate: frameRate) }
            if end == nil, let duration = attributes["dur"].flatMap({ ttmlTime($0, tickRate: tickRate, frameRate: frameRate) }) { end = start + duration }
            guard let end else { continue }
            let inner = lineBreak.replace(groups[1] ?? "", with: "\n")
            let lines = tags.replace(inner, with: "").split(separator: "\n").map { decodeEntities(clean(String($0))) }.filter { !$0.isEmpty }
            cues.append(SubtitleCue(start: start, end: end, text: lines.joined(separator: "\n")))
        }
        return cues
    }

    private static func attributesOf(_ text: String) -> [String: String] {
        var result: [String: String] = [:]
        for match in attribute.allMatches(text) {
            let groups = Pattern.groups(of: match, in: text)
            guard let name = groups[0], let value = groups[1] else { continue }
            let local = name.split(separator: ":").last.map(String.init) ?? name
            result[local.lowercased()] = value
        }
        return result
    }

    /// "00:00:01.500", "00:00:01:12" (frames), "1.5s", "1500ms", "12345t", "1h", "2m".
    static func ttmlTime(_ raw: String, tickRate: Double, frameRate: Double) -> Double? {
        let text = raw.trimmingCharacters(in: .whitespaces)
        if text.contains(":") {
            let parts = text.split(separator: ":")
            if parts.count == 4, let h = Double(parts[0]), let m = Double(parts[1]), let s = Double(parts[2]), let f = Double(parts[3]) {
                return h * 3600 + m * 60 + s + f / max(1, frameRate)
            }
            return clockSeconds(text)
        }
        for (suffix, scale) in [("ms", 0.001), ("s", 1.0), ("h", 3600.0), ("m", 60.0)] where text.hasSuffix(suffix) {
            return Double(text.dropLast(suffix.count)).map { $0 * scale }
        }
        if text.hasSuffix("t") { return Double(text.dropLast()).map { $0 / tickRate } }
        if text.hasSuffix("f") { return Double(text.dropLast()).map { $0 / max(1, frameRate) } }
        return Double(text)
    }

    private static func clean(_ line: String) -> String {
        decodeEntities(line).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var result = text
        for (entity, value) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&apos;", "'"), ("&nbsp;", " ")] {
            result = result.replacingOccurrences(of: entity, with: value)
        }
        let numeric = Pattern(#"&#(x?)([0-9A-Fa-f]+);"#)
        while let match = numeric.firstMatch(result), let groups = Optional(Pattern.groups(of: match, in: result)),
              let digits = groups[1], let range = Range(match.range, in: result) {
            let value = (groups[0] ?? "").isEmpty ? UInt32(digits) : UInt32(digits, radix: 16)
            let character = value.flatMap(Unicode.Scalar.init).map { String(Character($0)) } ?? ""
            result.replaceSubrange(range, with: character)
        }
        return result.replacingOccurrences(of: "&amp;", with: "&")
    }
}
