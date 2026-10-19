import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - Upstream (the one provider connection)

public struct UpstreamRequest: Sendable, Hashable {
    public var url: URL
    public var headers: [String: String]
    /// Cancel and fail with `UpstreamError.headerDeadline` if response headers take longer (busy-line hold).
    public var headerDeadline: Double?
    public init(url: URL, headers: [String: String] = [:], headerDeadline: Double? = nil) {
        self.url = url; self.headers = headers; self.headerDeadline = headerDeadline
    }
}

public struct UpstreamResponse: Sendable {
    public var status: Int
    /// After redirects (http://<ip>/... allowed).
    public var url: URL
    /// Lowercased names.
    public var headers: [String: String]
    public var expectedLength: Int64?
    /// Ends when the server closes; throws on network errors. Ending iteration (or task cancellation) cancels the request.
    public var body: AsyncThrowingStream<Data, any Error>
    public var cancel: @Sendable () -> Void
    public init(status: Int, url: URL, headers: [String: String], expectedLength: Int64?, body: AsyncThrowingStream<Data, any Error>, cancel: @escaping @Sendable () -> Void) {
        self.status = status; self.url = url; self.headers = headers; self.expectedLength = expectedLength; self.body = body; self.cancel = cancel
    }
}

public enum UpstreamError: Error, Sendable, Hashable {
    case headerDeadline
    case timedOut
    case cannotConnect(String)
    case cancelled
}

public protocol UpstreamTransport: Sendable {
    func open(_ request: UpstreamRequest) async throws -> UpstreamResponse
}

/// The body of one connection: chunks queued by the producer, pulled by one consumer. Pulling is what tells the
/// producer how much is waiting unread (backpressure). Thread-safe.
final class BodyChannel: @unchecked Sendable {
    private let lock = NSLock()
    private var chunks: [Data] = []
    private var chunkIndex = 0
    private var buffered = 0
    private var finished = false
    private var failure: (any Error)?
    private var waiter: CheckedContinuation<Data?, any Error>?
    private let highWater: Int
    private let lowWater: Int
    /// Called with true to pause the producer, false to resume it.
    var onPressure: (@Sendable (Bool) -> Void)?
    var onCancel: (@Sendable () -> Void)?
    private var paused = false

    init(highWater: Int = .max, lowWater: Int = 0) {
        self.highWater = highWater
        self.lowWater = lowWater
    }

    func yield(_ data: Data) {
        guard !data.isEmpty else { return }
        lock.lock()
        if finished { lock.unlock(); return }
        if let waiter {
            self.waiter = nil
            lock.unlock()
            waiter.resume(returning: data)
            return
        }
        chunks.append(data)
        buffered += data.count
        let pause = buffered > highWater && !paused
        if pause { paused = true }
        let pressure = onPressure
        lock.unlock()
        if pause { pressure?(true) }
    }

    func finish(throwing error: (any Error)? = nil) {
        lock.lock()
        if finished { lock.unlock(); return }
        finished = true
        failure = error
        let waiter = self.waiter
        self.waiter = nil
        lock.unlock()
        if let waiter {
            if let error { waiter.resume(throwing: error) } else { waiter.resume(returning: nil) }
        }
    }

    /// Ends the connection from the consumer's side.
    func cancel() {
        let cancelAction: (@Sendable () -> Void)?
        lock.lock()
        cancelAction = finished ? nil : onCancel
        lock.unlock()
        finish(throwing: UpstreamError.cancelled)
        cancelAction?()
    }

    var isFinished: Bool {
        lock.lock(); defer { lock.unlock() }
        return finished
    }

    func next() async throws -> Data? {
        if let ready = try takeReady() { return ready.data }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data?, any Error>) in
                park(continuation)
            }
        } onCancel: {
            cancel()
        }
    }

    private struct Ready { let data: Data? }

    /// A queued chunk, the end, or nil when the consumer must wait.
    private func takeReady() throws -> Ready? {
        lock.lock()
        if chunkIndex < chunks.count {
            let data = chunks[chunkIndex]
            chunkIndex += 1
            if chunkIndex > 64 && chunkIndex * 2 > chunks.count {
                chunks.removeFirst(chunkIndex)
                chunkIndex = 0
            }
            buffered -= data.count
            let resume = paused && buffered < lowWater
            if resume { paused = false }
            let pressure = onPressure
            lock.unlock()
            if resume { pressure?(false) }
            return Ready(data: data)
        }
        if finished {
            let failure = self.failure
            lock.unlock()
            if let failure { throw failure }
            return Ready(data: nil)
        }
        lock.unlock()
        return nil
    }

    private func park(_ continuation: CheckedContinuation<Data?, any Error>) {
        lock.lock()
        if chunkIndex < chunks.count || finished {
            lock.unlock()
            do {
                let ready = try takeReady()
                continuation.resume(returning: ready?.data)
            } catch {
                continuation.resume(throwing: error)
            }
            return
        }
        if Task.isCancelled {
            lock.unlock()
            continuation.resume(throwing: UpstreamError.cancelled)
            return
        }
        waiter = continuation
        lock.unlock()
    }

    /// The consumer's view: an async stream that pulls from this channel. Dropping the stream cancels the connection.
    func stream() -> AsyncThrowingStream<Data, any Error> {
        let handle = ChannelHandle(self)
        return AsyncThrowingStream(unfolding: { try await handle.channel.next() })
    }
}

/// Cancels its channel when the last reference to the body stream goes away.
private final class ChannelHandle: @unchecked Sendable {
    let channel: BodyChannel
    init(_ channel: BodyChannel) { self.channel = channel }
    deinit { channel.cancel() }
}

/// One live connection's state while its response headers are awaited.
private final class PendingConnection: @unchecked Sendable {
    let lock = NSLock()
    let channel: BodyChannel
    var task: URLSessionDataTask?
    var head: CheckedContinuation<UpstreamResponse, any Error>?
    var headResolved = false
    var deadlinePassed = false
    let requestURL: URL

    init(channel: BodyChannel, requestURL: URL) {
        self.channel = channel
        self.requestURL = requestURL
    }

    /// Resolves the wait for headers exactly once.
    func resolve(_ result: Result<UpstreamResponse, any Error>) {
        lock.lock()
        guard !headResolved else { lock.unlock(); return }
        headResolved = true
        let head = self.head
        self.head = nil
        lock.unlock()
        switch result {
        case .success(let response): head?.resume(returning: response)
        case .failure(let error): head?.resume(throwing: error)
        }
    }

    /// Resolves the wait with this response unless it was already resolved. The body stream is only made here, so no
    /// stray stream (whose release would cancel the connection) is ever created.
    func resolveHead(with urlResponse: URLResponse?) {
        lock.lock()
        let resolved = headResolved
        lock.unlock()
        guard !resolved, let response = response(from: urlResponse) else { return }
        resolve(.success(response))
    }

    private func response(from urlResponse: URLResponse?) -> UpstreamResponse? {
        guard let http = urlResponse as? HTTPURLResponse else { return nil }
        let length = http.expectedContentLength >= 0 ? http.expectedContentLength : nil
        let channel = self.channel
        return UpstreamResponse(status: http.statusCode, url: http.url ?? requestURL, headers: http.lowercasedHeaders,
                                expectedLength: length, body: channel.stream(), cancel: { channel.cancel() })
    }
}

/// Routes URLSession delegate callbacks to each task's connection.
private final class SessionRouter: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var connections: [Int: PendingConnection] = [:]

    func register(_ id: Int, _ connection: PendingConnection) {
        lock.lock(); connections[id] = connection; lock.unlock()
    }

    private func connection(_ id: Int) -> PendingConnection? {
        lock.lock(); defer { lock.unlock() }
        return connections[id]
    }

    private func remove(_ id: Int) {
        lock.lock(); connections[id] = nil; lock.unlock()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        connection(dataTask.taskIdentifier)?.resolveHead(with: response)
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let connection = connection(dataTask.taskIdentifier) else { return }
        // Headers count as arrived with the first bytes too (in case the response callback isn't delivered).
        connection.resolveHead(with: dataTask.response)
        connection.channel.yield(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let connection = connection(task.taskIdentifier) else { return }
        remove(task.taskIdentifier)
        let mapped = error.map { URLSessionUpstreamTransport.map($0, deadlinePassed: connection.deadlinePassed) }
        if let mapped {
            connection.resolve(.failure(mapped))
        } else {
            connection.resolveHead(with: task.response)
            connection.resolve(.failure(UpstreamError.cannotConnect("No response")))
        }
        connection.channel.finish(throwing: mapped)
    }
}

/// URLSession data task with a delegate (works with FoundationNetworking on Linux). 15 s to the response headers
/// (`timeoutIntervalForRequest`), no overall timeout, redirects followed (http://<ip> included), "Accept-Encoding:
/// identity". Backpressure: URLSession pushes data regardless of the reader, so the task is suspended while more
/// than `highWater` bytes wait unread in `body` and resumed below `lowWater` (VOD readers pause; live readers don't).
public final class URLSessionUpstreamTransport: UpstreamTransport, @unchecked Sendable {
    private let session: URLSession
    private let router: SessionRouter
    private let userAgent: String
    private let highWater: Int
    private let lowWater: Int

    public init(userAgent: String = TunerLinks.streamUserAgent, highWater: Int = 8 * 1024 * 1024, lowWater: Int = 2 * 1024 * 1024) {
        self.userAgent = userAgent
        self.highWater = highWater
        self.lowWater = lowWater
        let router = SessionRouter()
        self.router = router
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 7 * 24 * 3600
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        session = URLSession(configuration: configuration, delegate: router, delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    static func map(_ error: any Error, deadlinePassed: Bool) -> UpstreamError {
        if let error = error as? UpstreamError { return error }
        if deadlinePassed { return .headerDeadline }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled: return .cancelled
            case .timedOut: return .timedOut
            default: return .cannotConnect(urlError.localizedDescription)
            }
        }
        let ns = error as NSError
        if ns.code == -999 { return .cancelled }
        if ns.code == -1001 { return .timedOut }
        return .cannotConnect(ns.localizedDescription)
    }

    public func open(_ request: UpstreamRequest) async throws -> UpstreamResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.timeoutInterval = 15
        urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
        for (name, value) in request.headers { urlRequest.setValue(value, forHTTPHeaderField: name) }
        if urlRequest.value(forHTTPHeaderField: "User-Agent") == nil { urlRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
        urlRequest.setValue("identity", forHTTPHeaderField: "Accept-Encoding")

        let channel = BodyChannel(highWater: highWater, lowWater: lowWater)
        let connection = PendingConnection(channel: channel, requestURL: request.url)
        let task = session.dataTask(with: urlRequest)
        connection.task = task
        channel.onPressure = { [weak task] pause in
            if pause { task?.suspend() } else { task?.resume() }
        }
        channel.onCancel = { [weak task] in task?.cancel() }
        router.register(task.taskIdentifier, connection)

        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UpstreamResponse, any Error>) in
                connection.lock.lock()
                if connection.headResolved {
                    connection.lock.unlock()
                    continuation.resume(throwing: UpstreamError.cancelled)
                    return
                }
                connection.head = continuation
                connection.lock.unlock()
                task.resume()
                if let deadline = request.headerDeadline {
                    DispatchQueue.global().asyncAfter(deadline: .now() + max(0, deadline)) {
                        connection.lock.lock()
                        let waiting = !connection.headResolved
                        if waiting { connection.deadlinePassed = true }
                        connection.lock.unlock()
                        guard waiting else { return }
                        connection.resolve(.failure(UpstreamError.headerDeadline))
                        channel.finish(throwing: UpstreamError.headerDeadline)
                        task.cancel()
                    }
                }
            }
        } onCancel: {
            connection.resolve(.failure(UpstreamError.cancelled))
            channel.cancel()
            task.cancel()
        }
    }
}

/// Test double: each `open` asks `handler`, which returns a scripted response (status, headers, chunks, delays).
public final class StubUpstreamTransport: UpstreamTransport, @unchecked Sendable {
    public struct Script: Sendable {
        public var status: Int
        public var headers: [String: String]
        public var finalURL: URL?
        /// Seconds before the headers arrive (exercises header deadlines).
        public var headerDelay: Double
        /// (delay before chunk, chunk); the body ends after the last chunk unless `endless`.
        public var chunks: [(Double, Data)]
        public var endless: Bool
        public var failure: UpstreamError?
        public init(status: Int = 200, headers: [String: String] = [:], finalURL: URL? = nil, headerDelay: Double = 0,
                    chunks: [(Double, Data)] = [], endless: Bool = false, failure: UpstreamError? = nil) {
            self.status = status; self.headers = headers; self.finalURL = finalURL; self.headerDelay = headerDelay
            self.chunks = chunks; self.endless = endless; self.failure = failure
        }
    }

    private let clock: any TunerClock
    private let handler: @Sendable (UpstreamRequest, Int) -> Script
    private let state = LockedBox<(opened: [UpstreamRequest], open: Int, max: Int)>(([], 0, 0))

    public init(clock: any TunerClock, handler: @escaping @Sendable (UpstreamRequest, Int) -> Script) {
        self.clock = clock
        self.handler = handler
    }

    /// Every request opened so far (for asserting single-connection behaviour).
    public var opened: [UpstreamRequest] { state.value.opened }
    /// Connections currently open (must never exceed 1).
    public var openCount: Int { state.value.open }
    public var maxConcurrent: Int { state.value.max }

    public func open(_ request: UpstreamRequest) async throws -> UpstreamResponse {
        let attempt = state.withLock { value -> Int in
            value.opened.append(request)
            value.open += 1
            value.max = max(value.max, value.open)
            return value.opened.count - 1
        }
        let closed = LockedBox(false)
        let close: @Sendable () -> Void = { [state] in
            let first = closed.withLock { done -> Bool in
                if done { return false }
                done = true
                return true
            }
            if first { state.withLock { $0.open -= 1 } }
        }
        let script = handler(request, attempt)
        do {
            if let deadline = request.headerDeadline, deadline < script.headerDelay {
                try await clock.sleep(seconds: deadline)
                close()
                throw UpstreamError.headerDeadline
            }
            if script.headerDelay > 0 { try await clock.sleep(seconds: script.headerDelay) }
        } catch let error as UpstreamError {
            throw error
        } catch {
            close()
            throw UpstreamError.cancelled
        }
        if let failure = script.failure {
            close()
            throw failure
        }
        let channel = BodyChannel()
        let clock = self.clock
        let producer = Task {
            for (delay, chunk) in script.chunks {
                if delay > 0 {
                    do { try await clock.sleep(seconds: delay) } catch { break }
                }
                if Task.isCancelled || channel.isFinished { break }
                channel.yield(chunk)
            }
            if !script.endless && !Task.isCancelled {
                channel.finish()
                close()
            }
        }
        channel.onCancel = {
            producer.cancel()
            close()
        }
        var headers: [String: String] = [:]
        for (name, value) in script.headers { headers[name.lowercased()] = value }
        let length = headers["content-length"].flatMap { Int64($0) }
        return UpstreamResponse(status: script.status, url: script.finalURL ?? request.url, headers: headers, expectedLength: length,
                                body: channel.stream(), cancel: { channel.cancel() })
    }
}
