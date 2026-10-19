import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct HTTPRequestSpec: Sendable, Hashable {
    public var url: URL
    public var method: String
    public var headers: [String: String]
    public var body: Data?
    /// Overall time limit for `data(_:)`; nil uses the client's default (60 s).
    public var timeout: TimeInterval?
    public init(url: URL, method: String = "GET", headers: [String: String] = [:], body: Data? = nil, timeout: TimeInterval? = nil) {
        self.url = url; self.method = method; self.headers = headers; self.body = body; self.timeout = timeout
    }
}

public struct HTTPResult: Sendable {
    public var status: Int
    /// Header names lowercased.
    public var headers: [String: String]
    /// After redirects.
    public var finalURL: URL
    /// Gunzipped when the bytes start with 1f 8b. Empty for `download`.
    public var body: Data
    public init(status: Int, headers: [String: String], finalURL: URL, body: Data) {
        self.status = status; self.headers = headers; self.finalURL = finalURL; self.body = body
    }
}

/// Every network call except live/VOD media goes through this. Non-2xx throws `TunerError.serverStatus(status)`
/// for `data`/`download`; `raw` returns any status (the pairing client reads 4xx bodies).
public protocol HTTPClient: Sendable {
    func data(_ request: HTTPRequestSpec) async throws -> HTTPResult
    /// Any status; never throws for HTTP errors (only transport errors).
    func raw(_ request: HTTPRequestSpec) async throws -> HTTPResult
    /// Writes the (gunzipped) body to a temporary file, then moves it to `destination`. A failure leaves
    /// `destination` untouched (a stale cached file stays usable).
    func download(_ request: HTTPRequestSpec, to destination: URL) async throws -> HTTPResult
}

/// Holds a value for closures that must be `@Sendable` (guarded by a lock).
final class LockedBox<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value
    init(_ value: Value) { stored = value }
    var value: Value {
        get { lock.lock(); defer { lock.unlock() }; return stored }
        set { lock.lock(); stored = newValue; lock.unlock() }
    }
    func withLock<T>(_ body: (inout Value) throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }
        return try body(&stored)
    }
}

extension HTTPURLResponse {
    /// Header names lowercased.
    var lowercasedHeaders: [String: String] {
        var result: [String: String] = [:]
        for (key, value) in allHeaderFields {
            result[String(describing: key).lowercased()] = String(describing: value)
        }
        return result
    }
}

/// URLSession-backed client (FoundationNetworking on Linux). Follows redirects; 15 s to connect, 60 s idle;
/// adds `User-Agent` unless the request sets one.
public final class URLSessionHTTPClient: HTTPClient, @unchecked Sendable {
    private let session: URLSession
    private let userAgent: String
    private let requestTimeout: TimeInterval

    public init(userAgent: String = TunerLinks.streamUserAgent, requestTimeout: TimeInterval = 60) {
        self.userAgent = userAgent
        self.requestTimeout = requestTimeout
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = requestTimeout
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        session = URLSession(configuration: configuration)
    }

    deinit { session.finishTasksAndInvalidate() }

    private func urlRequest(_ spec: HTTPRequestSpec) -> URLRequest {
        var request = URLRequest(url: spec.url)
        request.httpMethod = spec.method
        request.httpBody = spec.body
        request.timeoutInterval = min(requestTimeout, spec.timeout ?? requestTimeout)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        for (name, value) in spec.headers { request.setValue(value, forHTTPHeaderField: name) }
        if request.value(forHTTPHeaderField: "User-Agent") == nil { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }
        return request
    }

    public func data(_ request: HTTPRequestSpec) async throws -> HTTPResult {
        let result = try await raw(request)
        guard (200..<300).contains(result.status) else { throw TunerError.serverStatus(result.status) }
        return result
    }

    public func raw(_ request: HTTPRequestSpec) async throws -> HTTPResult {
        let spec = request
        let urlRequest = urlRequest(spec)
        let operation: @Sendable () async throws -> HTTPResult = { [session] in
            let task = LockedBox<URLSessionDataTask?>(nil)
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HTTPResult, any Error>) in
                    let dataTask = session.dataTask(with: urlRequest) { data, response, error in
                        if let error {
                            continuation.resume(throwing: TunerError.from(error))
                            return
                        }
                        guard let http = response as? HTTPURLResponse else {
                            continuation.resume(throwing: TunerError.invalidResponse)
                            return
                        }
                        var body = data ?? Data()
                        if Gzip.isGzip(body) {
                            do { body = try Gzip.decompress(body) } catch {
                                continuation.resume(throwing: TunerError.invalidResponse)
                                return
                            }
                        }
                        continuation.resume(returning: HTTPResult(status: http.statusCode, headers: http.lowercasedHeaders,
                                                                  finalURL: http.url ?? spec.url, body: body))
                    }
                    task.value = dataTask
                    dataTask.resume()
                    if Task.isCancelled { dataTask.cancel() }
                }
            } onCancel: {
                task.value?.cancel()
            }
        }
        guard let limit = spec.timeout else { return try await operation() }
        return try await withTimeout(limit, operation)
    }

    public func download(_ request: HTTPRequestSpec, to destination: URL) async throws -> HTTPResult {
        let spec = request
        let urlRequest = urlRequest(spec)
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let session = self.session
        let operation: @Sendable () async throws -> HTTPResult = {
            let task = LockedBox<URLSessionDownloadTask?>(nil)
            let staged = directory.appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).download")
            defer { try? FileManager.default.removeItem(at: staged) }
            let result: HTTPResult = try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HTTPResult, any Error>) in
                    let downloadTask = session.downloadTask(with: urlRequest) { location, response, error in
                        if let error {
                            continuation.resume(throwing: TunerError.from(error))
                            return
                        }
                        guard let http = response as? HTTPURLResponse else {
                            continuation.resume(throwing: TunerError.invalidResponse)
                            return
                        }
                        guard (200..<300).contains(http.statusCode) else {
                            continuation.resume(throwing: TunerError.serverStatus(http.statusCode))
                            return
                        }
                        // The system deletes `location` when this handler returns: move it now.
                        do {
                            guard let location else { throw TunerError.invalidResponse }
                            try FileManager.default.moveItem(at: location, to: staged)
                        } catch {
                            continuation.resume(throwing: TunerError.from(error))
                            return
                        }
                        continuation.resume(returning: HTTPResult(status: http.statusCode, headers: http.lowercasedHeaders,
                                                                  finalURL: http.url ?? spec.url, body: Data()))
                    }
                    task.value = downloadTask
                    downloadTask.resume()
                    if Task.isCancelled { downloadTask.cancel() }
                }
            } onCancel: {
                task.value?.cancel()
            }
            try Task.checkCancellation()
            try URLSessionHTTPClient.install(staged, at: destination)
            return result
        }
        guard let limit = spec.timeout else { return try await operation() }
        return try await withTimeout(limit, operation)
    }

    /// Moves a downloaded file into place, gunzipping it when it starts with the gzip magic.
    static func install(_ staged: URL, at destination: URL) throws {
        let handle = try FileHandle(forReadingFrom: staged)
        let prefix = try handle.read(upToCount: 2) ?? Data()
        try? handle.close()
        if Gzip.isGzip(prefix) {
            try Gzip.decompressFile(at: staged, to: destination)
        } else {
            try Gzip.replaceItem(at: destination, with: staged)
        }
    }
}

/// Runs `operation`, cancelling it and throwing `TunerError.timedOut` after `seconds`.
func withTimeout<T: Sendable>(_ seconds: TimeInterval, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T?.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1e9))
            return nil
        }
        defer { group.cancelAll() }
        while let next = try await group.next() {
            if let value = next { return value }
            throw TunerError.timedOut
        }
        throw TunerError.timedOut
    }
}

/// Test double: answers from a closure, records requests.
public final class StubHTTPClient: HTTPClient, @unchecked Sendable {
    private let handler: @Sendable (HTTPRequestSpec) throws -> HTTPResult
    private let recorded = LockedBox<[HTTPRequestSpec]>([])

    public init(handler: @escaping @Sendable (HTTPRequestSpec) throws -> HTTPResult) { self.handler = handler }

    public var requests: [HTTPRequestSpec] { recorded.value }

    public func data(_ request: HTTPRequestSpec) async throws -> HTTPResult {
        let result = try await raw(request)
        guard (200..<300).contains(result.status) else { throw TunerError.serverStatus(result.status) }
        return result
    }

    public func raw(_ request: HTTPRequestSpec) async throws -> HTTPResult {
        recorded.withLock { $0.append(request) }
        try Task.checkCancellation()
        var result = try handler(request)
        if Gzip.isGzip(result.body) { result.body = try Gzip.decompress(result.body) }
        return result
    }

    public func download(_ request: HTTPRequestSpec, to destination: URL) async throws -> HTTPResult {
        var result = try await data(request)
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let staged = directory.appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).download")
        try result.body.write(to: staged)
        do { try Gzip.replaceItem(at: destination, with: staged) } catch {
            try? FileManager.default.removeItem(at: staged)
            throw error
        }
        result.body = Data()
        return result
    }
}

// MARK: - Lenient JSON

/// Lenient JSON for irregular provider payloads (get_vod_info, get_series_info, short EPG, catalog rows).
/// Decoding order: null, Bool, Double, String, array, object. Identical on Linux and Apple platforms
/// (never `JSONSerialization`/`NSNumber`).
public enum JSONValue: Sendable, Hashable, Decodable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([JSONValue].self) { self = .array(value); return }
        if let value = try? container.decode([String: JSONValue].self) { self = .object(value); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
    }

    public static func parse(_ data: Data) throws -> JSONValue {
        var parser = JSONParser(data)
        return try parser.parseDocument()
    }

    /// Object member, nil for other cases.
    public subscript(key: String) -> JSONValue? {
        if case .object(let members) = self { return members[key] }
        return nil
    }

    /// Android `str()`: numbers/bools as text (integral numbers without ".0"), arrays → first non-blank string,
    /// trimmed; "" and "null" → nil. Trimmed of spaces and the Unicode spaces only (`BrowseText.trimField`,
    /// docs/browse.md "Trimming"): `.whitespacesAndNewlines` also removes U+200B, which changes how a name reads.
    public var text: String? {
        let raw: String?
        switch self {
        case .null, .object: raw = nil
        case .bool(let value): raw = value ? "true" : "false"
        case .number(let value): raw = JSONValue.format(value)
        case .string(let value): raw = value
        case .array(let values):
            raw = values.lazy.compactMap { value -> String? in
                if case .string(let text) = value, !BrowseText.trimField(text).isEmpty { return text }
                return nil
            }.first
        }
        guard let trimmed = raw.map(BrowseText.trimField), !trimmed.isEmpty, trimmed != "null" else { return nil }
        return trimmed
    }

    /// `text` parsed as Int (accepts "12", "12.0", 12).
    public var int: Int? {
        if case .number(let value) = self { return value.isFinite && abs(value) < 9.2e18 ? Int(value) : nil }
        guard let text else { return nil }
        if let value = Int(text) { return value }
        if let value = Double(text), value.isFinite, abs(value) < 9.2e18 { return Int(value) }
        return nil
    }

    /// `text` parsed as Double.
    public var double: Double? {
        if case .number(let value) = self { return value }
        guard let text, let value = Double(text) else { return nil }
        return value
    }

    /// Elements of an array, or the values of an object (providers send either), in key order for objects
    /// (numeric keys compared numerically).
    public var elements: [JSONValue] {
        switch self {
        case .array(let values): return values
        case .object(let members): return JSONValue.sortedKeys(members.keys).compactMap { members[$0] }
        default: return []
        }
    }

    static func format(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 9.2e18 { return String(Int64(value)) }
        return String(value)
    }

    /// Numeric keys first (numerically), then the rest lexicographically.
    static func sortedKeys<S: Sequence>(_ keys: S) -> [String] where S.Element == String {
        keys.sorted { a, b in
            switch (Int(a), Int(b)) {
            case let (x?, y?): return x != y ? x < y : a < b
            case (.some, nil): return true
            case (nil, .some): return false
            case (nil, nil): return a < b
            }
        }
    }
}

/// A Decodable string that also accepts numbers, booleans and arrays (first non-blank string), like `JSONValue.text`.
/// Used by typed list rows (get_live_streams etc.) for speed. Never throws for a present key of any JSON type.
public struct LenientString: Decodable, Sendable, Hashable {
    public let value: String?
    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        value = (try? container.decode(JSONValue.self))?.text
    }
}

/// A list that accepts `[T]` or `{"k": T}`; elements that fail to decode are skipped (never aborts the list).
public struct LenientList<T: Decodable & Sendable>: Decodable, Sendable {
    public let items: [T]

    private struct AnyKey: CodingKey {
        var stringValue: String
        var intValue: Int?
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
    }

    public init(from decoder: any Decoder) throws {
        var result: [T] = []
        if var list = try? decoder.unkeyedContainer() {
            while !list.isAtEnd {
                if let item = try? list.decode(T.self) {
                    result.append(item)
                } else if (try? list.decode(JSONValue.self)) == nil {
                    break
                }
            }
        } else if let object = try? decoder.container(keyedBy: AnyKey.self) {
            let keys = JSONValue.sortedKeys(object.allKeys.map(\.stringValue))
            for name in keys {
                guard let key = AnyKey(stringValue: name), let item = try? object.decode(T.self, forKey: key) else { continue }
                result.append(item)
            }
        }
        items = result
    }
}

/// A small, fast JSON reader (no Foundation JSON classes, so results match on every platform). Strict JSON plus a
/// leading byte-order mark; trailing content after the document is ignored.
struct JSONParser {
    private let bytes: [UInt8]
    private var index = 0

    init(_ data: Data) { bytes = [UInt8](data) }

    mutating func parseDocument() throws -> JSONValue {
        skipBOM()
        skipWhitespace()
        guard index < bytes.count else { throw TunerError.invalidResponse }
        return try parseValue(depth: 0)
    }

    /// Hands each object of a top-level array (or each object value of a top-level object) to `body`, keeping only
    /// `fields` at its top level when given. Other elements are skipped. A top-level `null` has no elements.
    mutating func forEachObject(fields: Set<String>?, _ body: (JSONValue) throws -> Void) throws {
        skipBOM()
        skipWhitespace()
        guard index < bytes.count else { throw TunerError.invalidResponse }
        switch bytes[index] {
        case UInt8(ascii: "["):
            index += 1
            skipWhitespace()
            if peek(UInt8(ascii: "]")) { index += 1; return }
            while true {
                skipWhitespace()
                if peek(UInt8(ascii: "{")) { try body(try parseObject(depth: 1, fields: fields)) } else { try skipValue(depth: 1) }
                skipWhitespace()
                guard index < bytes.count else { throw TunerError.invalidResponse }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                if bytes[index] == UInt8(ascii: "]") { index += 1; return }
                throw TunerError.invalidResponse
            }
        case UInt8(ascii: "{"):
            index += 1
            skipWhitespace()
            if peek(UInt8(ascii: "}")) { index += 1; return }
            while true {
                skipWhitespace()
                _ = try parseString()
                skipWhitespace()
                try expect(UInt8(ascii: ":"))
                skipWhitespace()
                if peek(UInt8(ascii: "{")) { try body(try parseObject(depth: 1, fields: fields)) } else { try skipValue(depth: 1) }
                skipWhitespace()
                guard index < bytes.count else { throw TunerError.invalidResponse }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                if bytes[index] == UInt8(ascii: "}") { index += 1; return }
                throw TunerError.invalidResponse
            }
        default:
            _ = try parseValue(depth: 0)
        }
    }

    private mutating func skipBOM() {
        if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF { index = 3 }
    }

    @inline(__always) private mutating func skipWhitespace() {
        while index < bytes.count {
            let byte = bytes[index]
            if byte == 0x20 || byte == 0x0A || byte == 0x0D || byte == 0x09 { index += 1 } else { return }
        }
    }

    @inline(__always) private func peek(_ byte: UInt8) -> Bool { index < bytes.count && bytes[index] == byte }

    private mutating func expect(_ byte: UInt8) throws {
        guard peek(byte) else { throw TunerError.invalidResponse }
        index += 1
    }

    private mutating func parseValue(depth: Int) throws -> JSONValue {
        guard depth < 512, index < bytes.count else { throw TunerError.invalidResponse }
        switch bytes[index] {
        case UInt8(ascii: "{"): return try parseObject(depth: depth + 1, fields: nil)
        case UInt8(ascii: "["):
            index += 1
            var values: [JSONValue] = []
            skipWhitespace()
            if peek(UInt8(ascii: "]")) { index += 1; return .array(values) }
            while true {
                skipWhitespace()
                values.append(try parseValue(depth: depth + 1))
                skipWhitespace()
                guard index < bytes.count else { throw TunerError.invalidResponse }
                if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
                if bytes[index] == UInt8(ascii: "]") { index += 1; return .array(values) }
                throw TunerError.invalidResponse
            }
        case UInt8(ascii: "\""): return .string(try parseString())
        case UInt8(ascii: "t"): try literal("true"); return .bool(true)
        case UInt8(ascii: "f"): try literal("false"); return .bool(false)
        case UInt8(ascii: "n"): try literal("null"); return .null
        default: return .number(try parseNumber())
        }
    }

    private mutating func parseObject(depth: Int, fields: Set<String>?) throws -> JSONValue {
        guard depth < 512 else { throw TunerError.invalidResponse }
        try expect(UInt8(ascii: "{"))
        var members: [String: JSONValue] = [:]
        skipWhitespace()
        if peek(UInt8(ascii: "}")) { index += 1; return .object(members) }
        while true {
            skipWhitespace()
            let key = try parseString()
            skipWhitespace()
            try expect(UInt8(ascii: ":"))
            skipWhitespace()
            if let fields, !fields.contains(key) {
                try skipValue(depth: depth)
            } else {
                members[key] = try parseValue(depth: depth)
            }
            skipWhitespace()
            guard index < bytes.count else { throw TunerError.invalidResponse }
            if bytes[index] == UInt8(ascii: ",") { index += 1; continue }
            if bytes[index] == UInt8(ascii: "}") { index += 1; return .object(members) }
            throw TunerError.invalidResponse
        }
    }

    private mutating func skipValue(depth: Int) throws {
        guard depth < 512, index < bytes.count else { throw TunerError.invalidResponse }
        switch bytes[index] {
        case UInt8(ascii: "\""): try skipString()
        case UInt8(ascii: "{"), UInt8(ascii: "["):
            // Strings may contain brackets: skip them as strings while counting nesting.
            var nesting = 0
            while index < bytes.count {
                let byte = bytes[index]
                if byte == UInt8(ascii: "\"") { try skipString(); continue }
                if byte == UInt8(ascii: "{") || byte == UInt8(ascii: "[") { nesting += 1 }
                if byte == UInt8(ascii: "}") || byte == UInt8(ascii: "]") {
                    nesting -= 1
                    if nesting == 0 { index += 1; return }
                }
                index += 1
            }
            throw TunerError.invalidResponse
        default: _ = try parseValue(depth: depth)
        }
    }

    private mutating func skipString() throws {
        try expect(UInt8(ascii: "\""))
        while index < bytes.count {
            let byte = bytes[index]
            if byte == UInt8(ascii: "\\") { index += 2; continue }
            index += 1
            if byte == UInt8(ascii: "\"") { return }
        }
        throw TunerError.invalidResponse
    }

    private mutating func literal(_ word: StaticString) throws {
        let count = word.utf8CodeUnitCount
        guard index + count <= bytes.count else { throw TunerError.invalidResponse }
        let expected = UnsafeBufferPointer(start: word.utf8Start, count: count)
        for i in 0..<count where bytes[index + i] != expected[i] { throw TunerError.invalidResponse }
        index += count
    }

    private mutating func parseNumber() throws -> Double {
        let start = index
        var integerOnly = true
        var negative = false
        if peek(UInt8(ascii: "-")) { negative = true; index += 1 }
        while index < bytes.count {
            let byte = bytes[index]
            if byte >= UInt8(ascii: "0") && byte <= UInt8(ascii: "9") { index += 1; continue }
            if byte == UInt8(ascii: ".") || byte == UInt8(ascii: "e") || byte == UInt8(ascii: "E") || byte == UInt8(ascii: "+") || byte == UInt8(ascii: "-") {
                integerOnly = false
                index += 1
                continue
            }
            break
        }
        let digits = index - start - (negative ? 1 : 0)
        guard digits > 0 else { throw TunerError.invalidResponse }
        if integerOnly && digits <= 15 {
            var value: Int64 = 0
            for i in (start + (negative ? 1 : 0))..<index { value = value * 10 + Int64(bytes[i] - UInt8(ascii: "0")) }
            return Double(negative ? -value : value)
        }
        guard let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)) else { throw TunerError.invalidResponse }
        return value
    }

    private mutating func parseString() throws -> String {
        try expect(UInt8(ascii: "\""))
        let start = index
        while index < bytes.count {
            let byte = bytes[index]
            if byte == UInt8(ascii: "\"") {
                let text = String(decoding: bytes[start..<index], as: UTF8.self)
                index += 1
                return text
            }
            if byte == UInt8(ascii: "\\") { break }
            index += 1
        }
        // Slow path with escapes.
        var buffer = [UInt8](bytes[start..<index])
        while index < bytes.count {
            let byte = bytes[index]
            if byte == UInt8(ascii: "\"") {
                index += 1
                return String(decoding: buffer, as: UTF8.self)
            }
            if byte != UInt8(ascii: "\\") {
                buffer.append(byte)
                index += 1
                continue
            }
            index += 1
            guard index < bytes.count else { break }
            let escape = bytes[index]
            index += 1
            switch escape {
            case UInt8(ascii: "\""): buffer.append(0x22)
            case UInt8(ascii: "\\"): buffer.append(0x5C)
            case UInt8(ascii: "/"): buffer.append(0x2F)
            case UInt8(ascii: "b"): buffer.append(0x08)
            case UInt8(ascii: "f"): buffer.append(0x0C)
            case UInt8(ascii: "n"): buffer.append(0x0A)
            case UInt8(ascii: "r"): buffer.append(0x0D)
            case UInt8(ascii: "t"): buffer.append(0x09)
            case UInt8(ascii: "u"):
                var scalar = try hex4()
                if (0xD800..<0xDC00).contains(scalar), index + 1 < bytes.count, bytes[index] == UInt8(ascii: "\\"), bytes[index + 1] == UInt8(ascii: "u") {
                    let save = index
                    index += 2
                    let low = try hex4()
                    if (0xDC00..<0xE000).contains(low) {
                        scalar = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
                    } else {
                        index = save
                    }
                }
                let value = Unicode.Scalar(scalar) ?? "\u{FFFD}"
                buffer.append(contentsOf: Array(String(Character(value)).utf8))
            default:
                buffer.append(escape)
            }
        }
        throw TunerError.invalidResponse
    }

    private mutating func hex4() throws -> UInt32 {
        guard index + 4 <= bytes.count else { throw TunerError.invalidResponse }
        var value: UInt32 = 0
        for _ in 0..<4 {
            let byte = bytes[index]
            let digit: UInt32
            switch byte {
            case UInt8(ascii: "0")...UInt8(ascii: "9"): digit = UInt32(byte - UInt8(ascii: "0"))
            case UInt8(ascii: "a")...UInt8(ascii: "f"): digit = UInt32(byte - UInt8(ascii: "a") + 10)
            case UInt8(ascii: "A")...UInt8(ascii: "F"): digit = UInt32(byte - UInt8(ascii: "A") + 10)
            default: throw TunerError.invalidResponse
            }
            value = value << 4 | digit
            index += 1
        }
        return value
    }
}
