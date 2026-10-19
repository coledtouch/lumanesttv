import Foundation
import Network
import TunerCore

/// Serves TunerCore's MediaServer to AVPlayer on http://127.0.0.1:<ephemeral port>. It listens on the loopback
/// interface only (nothing off the device can reach it) and never on a fixed port. All HTTP parsing and routing is in
/// TunerCore (`HTTPRequestHead.parse`, `MediaServer.respond`, `HTTPResponse.serializedHead`); this is the socket glue.
/// Network callbacks run on `queue`; nothing here is main-actor isolated.
final class LoopbackServer: @unchecked Sendable {
    private let media: MediaServer
    private let queue = DispatchQueue(label: "app.tunertv.loopback")
    private let lock = NSLock()
    private var listener: NWListener?
    private var origin: URL?
    private var starting: Task<URL, Error>?

    init(media: MediaServer) {
        self.media = media
    }

    /// The running origin, or nil while the listener is down.
    var currentOrigin: URL? {
        lock.lock()
        defer { lock.unlock() }
        return listener == nil ? nil : origin
    }

    /// Returns the running origin, starting the listener (again, after a failure or suspension) when needed, and
    /// hands it to MediaServer.
    @discardableResult
    func ensureRunning() async throws -> URL {
        let reservation = reserveStart()
        if let origin = reservation.origin { return origin }
        guard let task = reservation.task else { throw CancellationError() }
        do {
            let url = try await task.value
            finishStart(task)
            await media.setOrigin(url)
            return url
        } catch {
            finishStart(task)
            throw error
        }
    }

    func stop() {
        lock.lock()
        let old = listener
        listener = nil
        origin = nil
        lock.unlock()
        old?.cancel()
    }

    // MARK: Listener

    private func reserveStart() -> (origin: URL?, task: Task<URL, Error>?) {
        lock.lock()
        defer { lock.unlock() }
        if let origin, listener != nil { return (origin, nil) }
        if let starting { return (nil, starting) }
        let task = Task { try await self.startListener() }
        starting = task
        return (nil, task)
    }

    private func finishStart(_ task: Task<URL, Error>) {
        lock.lock()
        if starting == task { starting = nil }
        lock.unlock()
    }

    private func startListener() async throws -> URL {
        do {
            // Bound to 127.0.0.1 with a port the system picks...
            return try await listen(bindLoopbackAddress: true)
        } catch {
            NSLog("Tuner: loopback listener on 127.0.0.1 failed (%@), trying the loopback interface", String(describing: error))
            // ...or, if that is refused, restricted to the loopback interface.
            return try await listen(bindLoopbackAddress: false)
        }
    }

    private func listen(bindLoopbackAddress: Bool) async throws -> URL {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        if bindLoopbackAddress {
            parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
        } else {
            parameters.requiredInterfaceType = .loopback
        }
        let listener = try NWListener(using: parameters, on: .any)
        let once = Once()
        let url: URL = try await withCheckedThrowingContinuation { continuation in
            listener.stateUpdateHandler = { [weak self, weak listener] state in
                switch state {
                case .ready:
                    guard let port = listener?.port, port.rawValue != 0,
                          let url = URL(string: "http://127.0.0.1:\(port.rawValue)") else {
                        if once.claim() { continuation.resume(throwing: URLError(.cannotFindHost)) }
                        listener?.cancel()
                        return
                    }
                    if once.claim() { continuation.resume(returning: url) }
                case .waiting(let error), .failed(let error):
                    if once.claim() { continuation.resume(throwing: error) }
                    listener?.cancel()
                    if let listener { self?.forget(listener) }
                case .cancelled:
                    if once.claim() { continuation.resume(throwing: CancellationError()) }
                    if let listener { self?.forget(listener) }
                default:
                    break
                }
            }
            listener.newConnectionHandler = { [weak self] connection in
                guard let self else {
                    connection.cancel()
                    return
                }
                self.accept(connection)
            }
            listener.start(queue: queue)
            // A listener that never becomes ready (or fails) within 5 s is given up.
            queue.asyncAfter(deadline: .now() + 5) { [weak listener] in
                if once.claim() {
                    continuation.resume(throwing: URLError(.timedOut))
                    listener?.cancel()
                }
            }
        }
        remember(listener, origin: url)
        return url
    }

    private func remember(_ new: NWListener, origin url: URL) {
        lock.lock()
        let old = listener
        listener = new
        origin = url
        lock.unlock()
        if let old, old !== new { old.cancel() }
    }

    private func forget(_ old: NWListener) {
        lock.lock()
        if listener === old {
            listener = nil
            origin = nil
        }
        lock.unlock()
    }

    // MARK: Connections (one request per connection; every response says "Connection: close")

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveHead(connection, buffer: Data())
    }

    private func receiveHead(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }
            var buffer = buffer
            if let data { buffer.append(data) }
            switch HTTPRequestHead.parse(buffer) {
            case .complete(let head, _):
                Task { await self.serve(head, on: connection) }
            case .incomplete where error == nil && !isComplete:
                self.receiveHead(connection, buffer: buffer)
            default:
                connection.cancel()
            }
        }
    }

    private func serve(_ head: HTTPRequestHead, on connection: NWConnection) async {
        let response = await media.respond(to: head)
        guard await send(response.serializedHead(), on: connection) else {
            connection.cancel()
            return
        }
        if head.method != "HEAD" {
            switch response.body {
            case .empty:
                break
            case .data(let data):
                _ = await send(data, on: connection)
            case .stream(let stream):
                // Stops when AVPlayer goes away (a failed send), which also ends the producer's upstream request.
                do {
                    for try await chunk in stream {
                        if !(await send(chunk, on: connection)) { break }
                    }
                } catch {}
            }
        }
        connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func send(_ data: Data, on connection: NWConnection) async -> Bool {
        if data.isEmpty { return true }
        return await withCheckedContinuation { continuation in
            connection.send(content: data, completion: .contentProcessed { error in
                continuation.resume(returning: error == nil)
            })
        }
    }
}

/// Resumes a continuation at most once from callbacks that may fire repeatedly.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}
