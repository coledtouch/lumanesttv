import Foundation
#if canImport(Glibc)
import Glibc
#elseif canImport(Darwin)
import Darwin
#endif
@testable import TunerCore

/// A tiny HTTP/1.1 server on 127.0.0.1 (POSIX sockets, one thread per connection) for exercising the real URLSession
/// clients without the network. Each request is answered by `handler`; the head is parsed with TunerCore's own parser.
final class LocalHTTPServer: @unchecked Sendable {
    struct Reply: Sendable {
        var status = 200
        var headers: [(String, String)] = []
        /// Seconds before the status line is written (a provider holding the request).
        var headDelay: Double = 0
        /// (delay, bytes) written after the head; the connection closes after the last one unless `holdOpen`.
        var chunks: [(Double, Data)] = []
        var holdOpen: Double = 0
    }

    struct Request: Sendable {
        var method: String
        var path: String
        var query: String
        var headers: [String: String]
    }

    private let listener: Int32
    private let lock = NSLock()
    private var running = true
    private var received: [Request] = []
    private var closedConnections = 0
    let port: UInt16

    init(handler: @escaping @Sendable (Request) -> Reply) throws {
        #if os(Linux)
        let fd = socket(AF_INET, Int32(SOCK_STREAM.rawValue), 0)
        #else
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        #endif
        guard fd >= 0 else { throw POSIXError(.EIO) }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        #if !os(Linux)
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        #endif
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0, listen(fd, 16) == 0 else { close(fd); throw POSIXError(.EADDRINUSE) }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &length) }
        }
        listener = fd
        port = UInt16(bigEndian: address.sin_port)
        let thread = Thread { [self] in acceptLoop(handler) }
        thread.start()
    }

    var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }
    var requests: [Request] { lock.lock(); defer { lock.unlock() }; return received }
    var closed: Int { lock.lock(); defer { lock.unlock() }; return closedConnections }

    func stop() {
        lock.lock()
        running = false
        lock.unlock()
    }

    private var isRunning: Bool { lock.lock(); defer { lock.unlock() }; return running }

    private func acceptLoop(_ handler: @escaping @Sendable (Request) -> Reply) {
        while isRunning {
            var poller = pollfd(fd: listener, events: Int16(POLLIN), revents: 0)
            guard poll(&poller, 1, 50) > 0 else { continue }
            let client = accept(listener, nil, nil)
            guard client >= 0 else { continue }
            #if !os(Linux)
            var yes: Int32 = 1
            setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
            #endif
            let connection = Thread { [self] in serve(client, handler) }
            connection.start()
        }
        close(listener)
    }

    private func serve(_ client: Int32, _ handler: @Sendable (Request) -> Reply) {
        defer {
            // A graceful close: no reset while the client is still reading the reply.
            #if os(Linux)
            shutdown(client, Int32(SHUT_WR))
            #else
            shutdown(client, SHUT_WR)
            #endif
            var drain = [UInt8](repeating: 0, count: 512)
            var poller = pollfd(fd: client, events: Int16(POLLIN), revents: 0)
            while poll(&poller, 1, 100) > 0, recv(client, &drain, drain.count, 0) > 0 {}
            close(client)
            lock.lock(); closedConnections += 1; lock.unlock()
        }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        var head: HTTPRequestHead?
        var headLength = 0
        var target = ""
        while head == nil {
            let count = recv(client, &chunk, chunk.count, 0)
            guard count > 0 else { return }
            buffer.append(contentsOf: chunk[0..<count])
            switch HTTPRequestHead.parse(buffer) {
            case .complete(let parsed, let length):
                head = parsed
                headLength = length
                let line = String(decoding: buffer.prefix { $0 != 13 }, as: UTF8.self)
                target = line.split(separator: " ").dropFirst().first.map(String.init) ?? ""
            case .invalid: return
            case .incomplete: continue
            }
        }
        guard let head else { return }
        // Read the request body too: closing with unread bytes would reset the connection before the reply is read.
        let bodyLength = Int(head.headers["content-length"] ?? "") ?? 0
        while buffer.count - headLength < bodyLength {
            let count = recv(client, &chunk, chunk.count, 0)
            guard count > 0 else { return }
            buffer.append(contentsOf: chunk[0..<count])
        }
        let query = target.split(separator: "?", maxSplits: 1).dropFirst().first.map(String.init) ?? ""
        let request = Request(method: head.method, path: head.path, query: query, headers: head.headers)
        lock.lock(); received.append(request); lock.unlock()
        let reply = handler(request)
        if reply.headDelay > 0 { Thread.sleep(forTimeInterval: reply.headDelay) }
        var text = "HTTP/1.1 \(reply.status) \(HTTPResponse.reason(reply.status))\r\n"
        for (name, value) in reply.headers { text += "\(name): \(value)\r\n" }
        text += "Connection: close\r\n\r\n"
        guard write(client, Data(text.utf8)) else { return }
        for (delay, bytes) in reply.chunks {
            if delay > 0 { Thread.sleep(forTimeInterval: delay) }
            guard write(client, bytes) else { return }
        }
        if reply.holdOpen > 0 {
            // Stay open (as an endless live stream would) until the client goes away or the time is up.
            let end = Date().addingTimeInterval(reply.holdOpen)
            while Date() < end {
                var poller = pollfd(fd: client, events: Int16(POLLIN), revents: 0)
                if poll(&poller, 1, 20) > 0 {
                    var probe = [UInt8](repeating: 0, count: 16)
                    if recv(client, &probe, probe.count, 0) <= 0 { return }
                }
            }
        }
    }

    private func write(_ client: Int32, _ data: Data) -> Bool {
        var offset = 0
        let bytes = [UInt8](data)
        while offset < bytes.count {
            #if os(Linux)
            let sent = bytes[offset...].withUnsafeBytes { send(client, $0.baseAddress, $0.count, Int32(MSG_NOSIGNAL)) }
            #else
            let sent = bytes[offset...].withUnsafeBytes { send(client, $0.baseAddress, $0.count, 0) }
            #endif
            if sent <= 0 { return false }
            offset += sent
        }
        return true
    }
}
