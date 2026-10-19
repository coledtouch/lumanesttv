import Foundation

/// POST https://lumanest.tv/api/pair/start {"device":"appletv"} response.
public struct PairingCode: Codable, Sendable, Hashable {
    public var deviceCode: String
    /// "XXXX-XXXX".
    public var userCode: String
    public var verificationUri: String
    public var verificationUriComplete: String
    /// Square QR module rows of "0"/"1" (ECC M) for verificationUriComplete.
    public var qr: [String]
    public var expiresIn: Int
    public var interval: Int
    public init(deviceCode: String, userCode: String, verificationUri: String, verificationUriComplete: String, qr: [String], expiresIn: Int, interval: Int) {
        self.deviceCode = deviceCode; self.userCode = userCode; self.verificationUri = verificationUri
        self.verificationUriComplete = verificationUriComplete; self.qr = qr; self.expiresIn = expiresIn; self.interval = interval
    }
}

/// The approved account, handed out exactly once.
public struct PairingAccount: Codable, Sendable, Hashable {
    /// "xtream" or "m3u".
    public var type: String
    public var name: String?
    public var server: String?
    public var username: String?
    public var password: String?
    public var m3uUrl: String?
    public init(type: String, name: String? = nil, server: String? = nil, username: String? = nil, password: String? = nil, m3uUrl: String? = nil) {
        self.type = type; self.name = name; self.server = server; self.username = username; self.password = password; self.m3uUrl = m3uUrl
    }

    /// Validates (xtream: http(s) server + username + password; m3u: http(s) m3uUrl), name defaults to "LumaNest TV",
    /// server normalized. Nil when unusable (treated like an expired code).
    public func source(id: String = UUID().uuidString) -> Source? {
        func clean(_ text: String?) -> String? {
            guard let value = text?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty, value != "null" else { return nil }
            return value
        }
        let displayName = clean(name) ?? "LumaNest TV"
        switch type.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "xtream":
            guard let server = Xtream.httpLink(clean(server)), let username = clean(username), let password = clean(password) else { return nil }
            return Source(id: id, name: displayName, kind: .xtream, server: Xtream.normalizeServer(server), username: username, password: password)
        case "m3u":
            guard let link = Xtream.httpLink(clean(m3uUrl)), Xtream.makeURL(link) != nil else { return nil }
            return Source(id: id, name: displayName, kind: .m3u, playlistURL: link)
        default:
            return nil
        }
    }
}

public enum PairingPoll: Sendable, Hashable {
    case pending
    case expired
    case approved(PairingAccount)
}

public enum PairingError: Error, Sendable, Hashable {
    /// `{"error":{"code","message"}}` from the server; `retryAfter` from Retry-After (seconds).
    case server(status: Int, code: String, message: String, retryAfter: Int?)
    case network(TunerError)
    case invalidResponse
}

public struct PairingClient: Sendable {
    private let http: any HTTPClient
    private let baseURL: URL
    private let device: String

    /// Sends JSON (`Content-Type: application/json`), User-Agent `TunerLinks.lumanestUserAgent`, 15 s timeout.
    public init(http: any HTTPClient, baseURL: URL = TunerLinks.pairingAPI, device: String = TunerLinks.pairingDevice) {
        self.http = http
        self.baseURL = baseURL
        self.device = device
    }

    public func start() async throws -> PairingCode {
        let root = try await post("start", .object(["device": .string(device)]))
        guard let deviceCode = root["deviceCode"]?.text, let userCode = root["userCode"]?.text,
              let complete = root["verificationUriComplete"]?.text else { throw PairingError.invalidResponse }
        let qr = (root["qr"] ?? .null).elements.compactMap { value -> String? in
            if case .string(let row) = value { return row }
            return nil
        }
        guard !qr.isEmpty else { throw PairingError.invalidResponse }
        return PairingCode(deviceCode: deviceCode, userCode: userCode, verificationUri: root["verificationUri"]?.text ?? "https://lumanest.tv/pair",
                           verificationUriComplete: complete, qr: qr, expiresIn: root["expiresIn"]?.int ?? 600,
                           interval: root["interval"]?.int ?? 5)
    }

    public func poll(deviceCode: String) async throws -> PairingPoll {
        let root = try await post("poll", .object(["deviceCode": .string(deviceCode)]))
        switch root["status"]?.text {
        case "approved":
            guard let account = root["account"], case .object = account, let type = account["type"]?.text else { return .expired }
            return .approved(PairingAccount(type: type, name: account["name"]?.text, server: account["server"]?.text,
                                            username: account["username"]?.text, password: account["password"]?.text,
                                            m3uUrl: account["m3uUrl"]?.text))
        case "pending":
            return .pending
        default:
            return .expired
        }
    }

    private func post(_ path: String, _ body: JSONValue) async throws -> JSONValue {
        let url = baseURL.appendingPathComponent(path)
        let request = HTTPRequestSpec(url: url, method: "POST",
                                      headers: ["Content-Type": "application/json", "User-Agent": TunerLinks.lumanestUserAgent,
                                                "Accept": "application/json"],
                                      body: PairingClient.encode(body), timeout: 15)
        let result: HTTPResult
        do {
            result = try await http.raw(request)
        } catch let error as CancellationError {
            throw error
        } catch {
            let mapped = TunerError.from(error)
            if mapped == .cancelled { throw CancellationError() }
            throw PairingError.network(mapped)
        }
        let json = try? JSONValue.parse(result.body)
        guard (200..<300).contains(result.status) else {
            let detail = json?["error"]
            throw PairingError.server(status: result.status, code: detail?["code"]?.text ?? "http_\(result.status)",
                                      message: detail?["message"]?.text ?? "Couldn't reach LumaNest TV. Check the Apple TV's internet connection.",
                                      retryAfter: result.headers["retry-after"].flatMap { Int($0.trimmingCharacters(in: .whitespaces)) })
        }
        guard let json, case .object = json else { throw PairingError.invalidResponse }
        return json
    }

    /// Minimal JSON writer for the two request bodies.
    static func encode(_ value: JSONValue) -> Data {
        func write(_ value: JSONValue) -> String {
            switch value {
            case .null: return "null"
            case .bool(let flag): return flag ? "true" : "false"
            case .number(let number): return JSONValue.format(number)
            case .string(let text):
                var out = "\""
                for scalar in text.unicodeScalars {
                    switch scalar {
                    case "\"": out += "\\\""
                    case "\\": out += "\\\\"
                    case "\n": out += "\\n"
                    case "\r": out += "\\r"
                    case "\t": out += "\\t"
                    default:
                        if scalar.value < 0x20 {
                            let hex = String(scalar.value, radix: 16)
                            out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                        } else {
                            out.unicodeScalars.append(scalar)
                        }
                    }
                }
                return out + "\""
            case .array(let items): return "[" + items.map(write).joined(separator: ",") + "]"
            case .object(let members): return "{" + members.keys.sorted().map { write(.string($0)) + ":" + write(members[$0]!) }.joined(separator: ",") + "}"
            }
        }
        return Data(write(value).utf8)
    }
}

public enum PairingStatus: Sendable, Hashable {
    /// "Getting a code…"
    case gettingCode
    /// "Waiting for you to approve on your phone…"
    case waiting(PairingCode)
    /// "Can't reach LumaNest TV. Retrying…" (keeps showing the code when there is one)
    case retrying(PairingCode?)
    /// "Paired. Loading your channels…"
    case paired(Source)
}

/// Android EditSource.kt loop: start → poll every `interval` (clamped 2...30 s); network errors double the wait up to
/// 30 s; new code at max(expiresIn − 20, 60) s or on "expired"/unusable account; start failures back off 5 s doubling
/// to 60 s (429: Retry-After). Ends after `.paired`; cancel by cancelling the consuming task.
public struct PairingLoop: Sendable {
    private let client: PairingClient
    private let clock: any TunerClock

    public init(client: PairingClient, clock: any TunerClock = SystemClock()) {
        self.client = client
        self.clock = clock
    }

    public func run() -> AsyncStream<PairingStatus> {
        let client = self.client
        let clock = self.clock
        return AsyncStream { continuation in
            let task = Task {
                await PairingLoop.loop(client: client, clock: clock) { continuation.yield($0) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func loop(client: PairingClient, clock: any TunerClock, emit: @Sendable (PairingStatus) -> Void) async {
        var startBackoff = 5.0
        newCode: while !Task.isCancelled {
            emit(.gettingCode)
            let code: PairingCode
            do {
                code = try await client.start()
                startBackoff = 5
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                emit(.retrying(nil))
                var wait = startBackoff
                if case PairingError.server(status: 429, _, _, let retryAfter?) = error { wait = Double(max(1, retryAfter)) }
                startBackoff = min(startBackoff * 2, 60)
                do { try await clock.sleep(seconds: wait) } catch { return }
                continue newCode
            }
            emit(.waiting(code))
            let interval = Double(min(30, max(2, code.interval)))
            let renewAt = clock.now() + Double(max(code.expiresIn - 20, 60))
            var wait = interval
            var retrying = false
            while !Task.isCancelled {
                do { try await clock.sleep(seconds: wait) } catch { return }
                if clock.now() >= renewAt { continue newCode }
                do {
                    switch try await client.poll(deviceCode: code.deviceCode) {
                    case .pending:
                        wait = interval
                        if retrying { retrying = false; emit(.waiting(code)) }
                    case .expired:
                        continue newCode
                    case .approved(let account):
                        guard let source = account.source() else { continue newCode }
                        emit(.paired(source))
                        return
                    }
                } catch is CancellationError {
                    return
                } catch PairingError.server(let status, _, _, _) where (400..<500).contains(status) && status != 429 && status != 408 {
                    // The code is unknown or invalid now: get a new one.
                    continue newCode
                } catch {
                    if Task.isCancelled { return }
                    if !retrying { retrying = true; emit(.retrying(code)) }
                    if case PairingError.server(status: 429, _, _, let retryAfter?) = error {
                        wait = Double(min(30, max(Int(interval), retryAfter)))
                    } else {
                        wait = min(wait * 2, 30)
                    }
                }
            }
            return
        }
    }
}

public struct QRMatrix: Sendable, Hashable {
    public let size: Int
    private let modules: [Bool]

    /// Nil unless rows form a non-empty square of "0"/"1".
    public init?(rows: [String]) {
        let count = rows.count
        guard count > 0 else { return nil }
        var modules: [Bool] = []
        modules.reserveCapacity(count * count)
        for row in rows {
            let characters = Array(row.utf8)
            guard characters.count == count else { return nil }
            for c in characters {
                switch c {
                case UInt8(ascii: "1"): modules.append(true)
                case UInt8(ascii: "0"): modules.append(false)
                default: return nil
                }
            }
        }
        size = count
        self.modules = modules
    }

    public func isDark(row: Int, column: Int) -> Bool {
        guard row >= 0, column >= 0, row < size, column < size else { return false }
        return modules[row * size + column]
    }
}
