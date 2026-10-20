import Foundation

// MARK: - Edition (compile-time only)

/// Which edition this build is. Chosen at compile time only: there is no runtime switch, setting, hub flag or server
/// flag (App Review guideline 2.5.19). `TUNER_DIRECT_EDITION` is never defined anywhere in this repository, so every
/// build (Xcode, CI, `swift test`) is `.appStore`. Neither edition has an adult unlock.
public enum Edition: String, Sendable, CaseIterable {
    case appStore
    case direct

    public static let current: Edition = {
        #if TUNER_DIRECT_EDITION
        return .direct
        #else
        return .appStore
        #endif
    }()

    /// `.strict` (Android store-edition rules, also checks item names) for `.appStore`; `.standard` otherwise.
    public var adultFilterMode: AdultFilter.Mode { self == .appStore ? .strict : .standard }
}

// MARK: - Fixed addresses and identifiers

public enum TunerLinks {
    /// `start` and `poll` are resolved against this.
    public static let pairingAPI = URL(string: "https://lumanest.tv/api/pair/")!
    /// docs/browse.md "catalog rows endpoint".
    public static let catalogRows = URL(string: "https://lumanest.tv/api/catalog/rows?v=1")!
    /// docs/extras.md: `subtitles` and `trailer` are resolved against this; subtitle files must be on its origin.
    public static let extrasAPI = URL(string: "https://lumanest.tv/api/extras/")!
    /// Tuner's own privacy policy (tunertv.app, the app's website). Not lumanest.tv/privacy, which covers only the shop
    /// and web player.
    public static let privacyPolicy = URL(string: "https://tunertv.app/privacy")!
    /// Help and contact. Deliberately not lumanest.tv/apps, which sells plans (App Review guidelines 3.1.1 and 3.1.3(a)).
    public static let help = URL(string: "https://tunertv.app/support")!
    public static let logos = URL(string: "https://iptv-org.github.io/api/logos.json")!
    /// User-Agent for lumanest.tv calls (pairing, catalog rows, subtitles and trailers).
    public static let lumanestUserAgent = "LumaNestTuner/AppleTV"
    /// User-Agent for provider API, guide, artwork and stream requests (same as Android).
    public static let streamUserAgent = "VLC/3.0.21 LibVLC/3.0.21"
    /// `{"device":"appletv"}` for /api/pair/start.
    public static let pairingDevice = "appletv"
    /// Settings → About, shown only when the catalog rows answered with `source == "tmdb"` (docs/browse.md).
    public static let tmdbAttribution = "This product uses the TMDB API but is not endorsed or certified by TMDB."
    /// The subtitle menu (under the OpenSubtitles tracks) and Settings → About, whatever the plan (docs/extras.md).
    public static let openSubtitlesCredit = "Subtitles provided by OpenSubtitles.com"
    /// Settings → About (guideline 5.1.1(i)).
    public static let privacyNotice = "Privacy policy: tunertv.app/privacy  ·  Help: tunertv.app/support"
}

// MARK: - Errors shown to people

public enum TunerError: Error, Sendable, Hashable {
    /// "Can't reach the server. Check the URL."
    case unreachable
    /// "The server took too long to respond."
    case timedOut
    /// "Connection refused by the server."
    case refused
    /// "Login failed. Check the username and password."
    case loginFailed
    /// "Server returned N"
    case serverStatus(Int)
    /// "The server sent something Tuner couldn't read."
    case invalidResponse
    /// A validation message, shown as is.
    case invalidInput(String)
    case cancelled

    public var message: String {
        switch self {
        case .unreachable: return "Can't reach the server. Check the URL."
        case .timedOut: return "The server took too long to respond."
        case .refused: return "Connection refused by the server."
        case .loginFailed: return "Login failed. Check the username and password."
        case .serverStatus(let status): return "Server returned \(status)"
        case .invalidResponse: return "The server sent something Tuner couldn't read."
        case .invalidInput(let text): return text
        case .cancelled: return "Cancelled."
        }
    }

    /// Maps URLError / POSIX / CancellationError to the cases above (already-`TunerError` values pass through).
    public static func from(_ error: any Error) -> TunerError {
        if let error = error as? TunerError { return error }
        if error is CancellationError { return .cancelled }
        if let error = error as? UpstreamError {
            switch error {
            case .headerDeadline, .timedOut: return .timedOut
            case .cancelled: return .cancelled
            case .cannotConnect: return .unreachable
            }
        }
        if let error = error as? URLError {
            switch error.code {
            case .cancelled, .userCancelledAuthentication: return .cancelled
            case .timedOut: return .timedOut
            case .cannotConnectToHost: return .refused
            case .badServerResponse, .cannotParseResponse, .cannotDecodeRawData, .cannotDecodeContentData,
                 .zeroByteResource, .dataLengthExceedsMaximum:
                return .invalidResponse
            default: return .unreachable
            }
        }
        if error is DecodingError { return .invalidResponse }
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain {
            if ns.code == Int(ECONNREFUSED) { return .refused }
            if ns.code == Int(ETIMEDOUT) { return .timedOut }
            if ns.code == Int(ECANCELED) { return .cancelled }
            return .unreachable
        }
        if ns.domain == "NSURLErrorDomain" {
            switch ns.code {
            case -999: return .cancelled
            case -1001: return .timedOut
            case -1004: return .refused
            case -1011, -1014, -1015, -1016, -1017, -1103: return .invalidResponse
            default: return .unreachable
            }
        }
        return .unreachable
    }
}

// MARK: - Small pure helpers

public enum StableHash {
    /// FNV-1a 64-bit over UTF-8. Stable across launches and platforms (never use `hashValue` for stored ids).
    public static func fnv1a64(_ text: String) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return hash
    }

    /// Lowercase base-36 rendering, used for M3U keys: "u:<base36>:<index>", "mu:<base36>", "ms:<base36>", "me:<base36>".
    public static func base36(_ value: UInt64) -> String { String(value, radix: 36, uppercase: false) }

    /// Pure-Swift SHA-256, lowercase hex (CryptoKit does not exist on Linux). Used for cache identities.
    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data).map { byte in
            let text = String(byte, radix: 16)
            return byte < 16 ? "0" + text : text
        }.joined()
    }
}

/// FIPS 180-4 SHA-256.
enum SHA256 {
    private static let k: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    static func hash(_ data: Data) -> [UInt8] {
        var h: [UInt32] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
        var message = [UInt8](data)
        let bitLength = UInt64(message.count) &* 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        for shift in stride(from: 56, through: 0, by: -8) { message.append(UInt8(truncatingIfNeeded: bitLength >> UInt64(shift))) }
        var w = [UInt32](repeating: 0, count: 64)
        var chunk = 0
        while chunk < message.count {
            for i in 0..<16 {
                let j = chunk + i * 4
                w[i] = UInt32(message[j]) << 24 | UInt32(message[j + 1]) << 16 | UInt32(message[j + 2]) << 8 | UInt32(message[j + 3])
            }
            for i in 16..<64 {
                let s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3)
                let s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10)
                w[i] = w[i - 16] &+ s0 &+ w[i - 7] &+ s1
            }
            var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
            for i in 0..<64 {
                let s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
                let ch = (e & f) ^ (~e & g)
                let t1 = hh &+ s1 &+ ch &+ k[i] &+ w[i]
                let s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
                let maj = (a & b) ^ (a & c) ^ (b & c)
                let t2 = s0 &+ maj
                hh = g; g = f; f = e; e = d &+ t1; d = c; c = b; b = a; a = t1 &+ t2
            }
            h[0] = h[0] &+ a; h[1] = h[1] &+ b; h[2] = h[2] &+ c; h[3] = h[3] &+ d
            h[4] = h[4] &+ e; h[5] = h[5] &+ f; h[6] = h[6] &+ g; h[7] = h[7] &+ hh
            chunk += 64
        }
        var out: [UInt8] = []
        out.reserveCapacity(32)
        for value in h { for shift in [24, 16, 8, 0] { out.append(UInt8(truncatingIfNeeded: value >> UInt32(shift))) } }
        return out
    }

    @inline(__always) private static func rotr(_ x: UInt32, _ n: UInt32) -> UInt32 { (x >> n) | (x << (32 - n)) }
}

public enum Gzip {
    /// True when the data starts with the gzip magic 1f 8b (checked regardless of HTTP headers).
    public static func isGzip(_ prefix: Data) -> Bool {
        guard prefix.count >= 2 else { return false }
        let start = prefix.startIndex
        return prefix[start] == 0x1f && prefix[prefix.index(after: start)] == 0x8b
    }

    /// Pure-Swift inflate (RFC 1951/1952) of one or more gzip members held in memory.
    public static func decompress(_ data: Data) throws -> Data {
        var handed = false
        var output = Data()
        let reader = ByteSource { () -> [UInt8]? in
            if handed { return nil }
            handed = true
            return [UInt8](data)
        }
        try inflateMembers(reader) { chunk in output.append(contentsOf: chunk) }
        return output
    }

    /// Streams `source` (gzip) into `destination` (plain) in 64 KiB chunks; memory stays bounded.
    public static func decompressFile(at source: URL, to destination: URL) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        let directory = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporary = directory.appendingPathComponent(".\(destination.lastPathComponent).\(UUID().uuidString).part")
        guard FileManager.default.createFile(atPath: temporary.path, contents: nil) else { throw TunerError.invalidResponse }
        do {
            let output = try FileHandle(forWritingTo: temporary)
            do {
                let reader = ByteSource { () -> [UInt8]? in
                    guard let chunk = try input.read(upToCount: 64 * 1024), !chunk.isEmpty else { return nil }
                    return [UInt8](chunk)
                }
                try inflateMembers(reader) { chunk in try output.write(contentsOf: Data(chunk)) }
                try output.close()
            } catch {
                try? output.close()
                throw error
            }
            try replaceItem(at: destination, with: temporary)
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }

    static func replaceItem(at destination: URL, with temporary: URL) throws {
        if FileManager.default.fileExists(atPath: destination.path) {
            try FileManager.default.removeItem(at: destination)
        }
        try FileManager.default.moveItem(at: temporary, to: destination)
    }

    /// Inflates every gzip member the source holds. Bytes after the last member that aren't another member are ignored.
    private static func inflateMembers(_ source: ByteSource, emit: @escaping ([UInt8]) throws -> Void) throws {
        var members = 0
        while true {
            guard let first = try source.peekByte() else {
                if members == 0 { throw TunerError.invalidResponse }
                return
            }
            if members > 0 && first != 0x1f { return }
            let inflater = Inflater(source: source, emit: emit)
            try inflater.readGzipHeader()
            let (crc, size) = try inflater.inflate()
            let storedCRC = try inflater.alignedUInt32LE()
            let storedSize = try inflater.alignedUInt32LE()
            guard storedCRC == crc, storedSize == size else { throw TunerError.invalidResponse }
            members += 1
        }
    }
}

/// Pulls input bytes chunk by chunk.
final class ByteSource {
    private var buffer: [UInt8] = []
    private var position = 0
    private let next: () throws -> [UInt8]?
    private var finished = false

    init(next: @escaping () throws -> [UInt8]?) { self.next = next }

    @inline(__always) func readByte() throws -> UInt8? {
        if position < buffer.count {
            let byte = buffer[position]
            position += 1
            return byte
        }
        guard try refill() else { return nil }
        let byte = buffer[position]
        position += 1
        return byte
    }

    func peekByte() throws -> UInt8? {
        if position < buffer.count { return buffer[position] }
        guard try refill() else { return nil }
        return buffer[position]
    }

    private func refill() throws -> Bool {
        while !finished {
            guard let chunk = try next() else { finished = true; return false }
            if chunk.isEmpty { continue }
            buffer = chunk
            position = 0
            return true
        }
        return false
    }
}

/// One RFC 1951 stream (inside a gzip member). Keeps a 32 KiB window; output is emitted in 64 KiB chunks.
private final class Inflater {
    private let source: ByteSource
    private let emit: ([UInt8]) throws -> Void
    private var bitBuffer: UInt64 = 0
    private var bitCount = 0
    private var window = [UInt8](repeating: 0, count: 1 << 16)
    private var windowPosition = 0
    private var pending: [UInt8] = []
    private var crc: UInt32 = 0xFFFF_FFFF
    private var total: UInt32 = 0
    /// Bytes produced so far by this stream (back-references can't reach before its start).
    private var produced = 0

    init(source: ByteSource, emit: @escaping ([UInt8]) throws -> Void) {
        self.source = source
        self.emit = emit
        pending.reserveCapacity(64 * 1024)
    }

    private static let lengthBase: [Int] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    private static let lengthExtra: [Int] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    private static let distanceBase: [Int] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
                                              4097, 6145, 8193, 12289, 16385, 24577]
    private static let distanceExtra: [Int] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
    private static let codeLengthOrder: [Int] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
    static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }
    private static let fixedLiterals: Huffman = {
        var lengths = [Int](repeating: 8, count: 288)
        for i in 144..<256 { lengths[i] = 9 }
        for i in 256..<280 { lengths[i] = 7 }
        return Huffman(lengths: lengths)!
    }()
    private static let fixedDistances = Huffman(lengths: [Int](repeating: 5, count: 30))!

    // MARK: bits

    @inline(__always) private func need(_ count: Int) throws {
        while bitCount < count {
            guard let byte = try source.readByte() else { throw TunerError.invalidResponse }
            bitBuffer |= UInt64(byte) << UInt64(bitCount)
            bitCount += 8
        }
    }

    @inline(__always) private func bits(_ count: Int) throws -> Int {
        if count == 0 { return 0 }
        try need(count)
        let value = Int(bitBuffer & ((1 << UInt64(count)) - 1))
        bitBuffer >>= UInt64(count)
        bitCount -= count
        return value
    }

    /// Fills the bit buffer up to `count` bits when the input has them (fewer at the end of the stream).
    @inline(__always) private func fill(_ count: Int) throws {
        while bitCount < count {
            guard let byte = try source.readByte() else { return }
            bitBuffer |= UInt64(byte) << UInt64(bitCount)
            bitCount += 8
        }
    }

    func alignedUInt32LE() throws -> UInt32 {
        // Called after the last block: drop the partial byte, then read whole bytes (from the bit buffer first).
        let drop = bitCount % 8
        bitBuffer >>= UInt64(drop)
        bitCount -= drop
        var value: UInt32 = 0
        for i in 0..<4 { value |= UInt32(try bits(8)) << UInt32(8 * i) }
        return value
    }

    // MARK: gzip header

    func readGzipHeader() throws {
        guard try bits(8) == 0x1f, try bits(8) == 0x8b, try bits(8) == 8 else { throw TunerError.invalidResponse }
        let flags = try bits(8)
        for _ in 0..<6 { _ = try bits(8) } // mtime, xfl, os
        if flags & 0x04 != 0 { // FEXTRA
            let length = try bits(8) | (try bits(8) << 8)
            for _ in 0..<length { _ = try bits(8) }
        }
        if flags & 0x08 != 0 { while try bits(8) != 0 {} } // FNAME
        if flags & 0x10 != 0 { while try bits(8) != 0 {} } // FCOMMENT
        if flags & 0x02 != 0 { _ = try bits(16) } // FHCRC
    }

    // MARK: inflate

    /// Returns the CRC-32 and size (mod 2^32) of the output.
    func inflate() throws -> (UInt32, UInt32) {
        var last = false
        repeat {
            last = try bits(1) == 1
            switch try bits(2) {
            case 0: try stored()
            case 1: try codes(Inflater.fixedLiterals, Inflater.fixedDistances)
            case 2:
                let (literals, distances) = try dynamicTables()
                try codes(literals, distances)
            default: throw TunerError.invalidResponse
            }
        } while !last
        try flush()
        return (crc ^ 0xFFFF_FFFF, total)
    }

    private func stored() throws {
        let drop = bitCount % 8
        bitBuffer >>= UInt64(drop)
        bitCount -= drop
        let length = try bits(16)
        let complement = try bits(16)
        guard length == (~complement & 0xFFFF) else { throw TunerError.invalidResponse }
        for _ in 0..<length { put(UInt8(try bits(8))) }
        if pending.count >= 64 * 1024 { try flush() }
    }

    private func dynamicTables() throws -> (Huffman, Huffman) {
        let literalCount = try bits(5) + 257
        let distanceCount = try bits(5) + 1
        let codeCount = try bits(4) + 4
        guard literalCount <= 286, distanceCount <= 30 else { throw TunerError.invalidResponse }
        var codeLengths = [Int](repeating: 0, count: 19)
        for i in 0..<codeCount { codeLengths[Inflater.codeLengthOrder[i]] = try bits(3) }
        guard let lengthCode = Huffman(lengths: codeLengths) else { throw TunerError.invalidResponse }
        var lengths: [Int] = []
        lengths.reserveCapacity(literalCount + distanceCount)
        while lengths.count < literalCount + distanceCount {
            let symbol = try decode(lengthCode)
            switch symbol {
            case 0..<16: lengths.append(symbol)
            case 16:
                guard let previous = lengths.last else { throw TunerError.invalidResponse }
                for _ in 0..<(3 + (try bits(2))) { lengths.append(previous) }
            case 17: for _ in 0..<(3 + (try bits(3))) { lengths.append(0) }
            case 18: for _ in 0..<(11 + (try bits(7))) { lengths.append(0) }
            default: throw TunerError.invalidResponse
            }
        }
        guard lengths.count == literalCount + distanceCount, lengths[256] > 0,
              let literals = Huffman(lengths: Array(lengths[0..<literalCount])),
              let distances = Huffman(lengths: Array(lengths[literalCount...]), allowEmpty: true)
        else { throw TunerError.invalidResponse }
        return (literals, distances)
    }

    private func codes(_ literals: Huffman, _ distances: Huffman) throws {
        while true {
            let symbol = try decode(literals)
            if symbol < 256 {
                put(UInt8(symbol))
                if pending.count >= 64 * 1024 { try flush() }
                continue
            }
            if symbol == 256 { return }
            let index = symbol - 257
            guard index < 29 else { throw TunerError.invalidResponse }
            let length = Inflater.lengthBase[index] + (try bits(Inflater.lengthExtra[index]))
            let distanceSymbol = try decode(distances)
            guard distanceSymbol < 30 else { throw TunerError.invalidResponse }
            let distance = Inflater.distanceBase[distanceSymbol] + (try bits(Inflater.distanceExtra[distanceSymbol]))
            guard distance <= 32768, distance <= produced else { throw TunerError.invalidResponse }
            let mask = window.count - 1
            var from = (windowPosition - distance) & mask
            for _ in 0..<length {
                put(window[from])
                from = (from + 1) & mask
            }
            if pending.count >= 64 * 1024 { try flush() }
        }
    }

    @inline(__always) private func put(_ byte: UInt8) {
        window[windowPosition] = byte
        windowPosition = (windowPosition + 1) & (window.count - 1)
        pending.append(byte)
        produced += 1
    }

    private func flush() throws {
        guard !pending.isEmpty else { return }
        var c = crc
        for byte in pending { c = Inflater.crcTable[Int((c ^ UInt32(byte)) & 0xFF)] ^ (c >> 8) }
        crc = c
        total = total &+ UInt32(truncatingIfNeeded: pending.count)
        try emit(pending)
        pending.removeAll(keepingCapacity: true)
    }

    private func decode(_ table: Huffman) throws -> Int {
        try fill(Huffman.fastBits)
        let entry = table.fast[Int(bitBuffer & UInt64(Huffman.fastMask))]
        if entry != 0 {
            let length = Int(entry & 0xF)
            if length <= bitCount {
                bitBuffer >>= UInt64(length)
                bitCount -= length
                return Int(entry >> 4)
            }
        }
        // Slow path (codes longer than the fast table, or the very end of the input): one bit at a time.
        var code = 0, first = 0, index = 0
        for length in 1...15 {
            code |= try bits(1)
            let count = table.counts[length]
            if code - count < first { return table.symbols[index + (code - first)] }
            index += count
            first += count
            first <<= 1
            code <<= 1
        }
        throw TunerError.invalidResponse
    }
}

/// Canonical Huffman code with a 9-bit lookup table (entries: symbol << 4 | length; 0 = not in the table).
private struct Huffman {
    static let fastBits = 9
    static let fastMask = (1 << fastBits) - 1
    var counts = [Int](repeating: 0, count: 16)
    var symbols: [Int] = []
    var fast = [UInt32](repeating: 0, count: 1 << fastBits)

    init?(lengths: [Int], allowEmpty: Bool = false) {
        for length in lengths { counts[length] += 1 }
        counts[0] = 0
        // Over-subscribed codes are invalid; incomplete ones are allowed (single-code distance trees).
        var left = 1
        for length in 1...15 {
            left <<= 1
            left -= counts[length]
            if left < 0 { return nil }
        }
        if !allowEmpty && counts.allSatisfy({ $0 == 0 }) { return nil }
        var offsets = [Int](repeating: 0, count: 16)
        for length in 1..<15 { offsets[length + 1] = offsets[length] + counts[length] }
        symbols = [Int](repeating: 0, count: lengths.count)
        for (symbol, length) in lengths.enumerated() where length != 0 {
            symbols[offsets[length]] = symbol
            offsets[length] += 1
        }
        // Fast table from canonical codes (MSB-first codes, read LSB-first from the stream: bit-reversed).
        var code = 0
        var index = 0
        for length in 1...15 {
            for _ in 0..<counts[length] {
                if length <= Huffman.fastBits {
                    var reversed = 0
                    var c = code
                    for _ in 0..<length { reversed = (reversed << 1) | (c & 1); c >>= 1 }
                    let entry = UInt32(symbols[index]) << 4 | UInt32(length)
                    var fill = reversed
                    while fill < (1 << Huffman.fastBits) {
                        fast[fill] = entry
                        fill += 1 << length
                    }
                }
                code += 1
                index += 1
            }
            code <<= 1
        }
    }
}

public enum TimeText {
    /// "1:02:03" or "2:03".
    public static func clock(seconds: Int) -> String {
        let s = max(0, seconds)
        let hours = s / 3600, minutes = (s % 3600) / 60, rest = s % 60
        let ss = rest < 10 ? "0\(rest)" : "\(rest)"
        if hours > 0 {
            let mm = minutes < 10 ? "0\(minutes)" : "\(minutes)"
            return "\(hours):\(mm):\(ss)"
        }
        return "\(minutes):\(ss)"
    }

    /// "1 hr 5 min left" / "12 min left" / "45 sec left".
    public static func left(seconds: Int) -> String {
        let s = max(0, seconds)
        if s < 60 { return "\(s) sec left" }
        let hours = s / 3600, minutes = (s % 3600) / 60
        if hours > 0 { return minutes > 0 ? "\(hours) hr \(minutes) min left" : "\(hours) hr left" }
        return "\(minutes) min left"
    }

    /// Badge text for a provider rating: nil unless > 0 and finite; one decimal, trailing ".0" dropped ("7.5", "8").
    public static func rating(_ raw: String?) -> String? {
        guard let value = ratingValue(raw) else { return nil }
        let tenths = Int((value * 10).rounded())
        if tenths <= 0 { return nil }
        return tenths % 10 == 0 ? "\(tenths / 10)" : "\(tenths / 10).\(tenths % 10)"
    }

    /// Numeric provider rating (> 0 and finite) or nil. Used by "Top rated" without TMDB.
    public static func ratingValue(_ raw: String?) -> Double? {
        guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), let value = Double(text), value.isFinite, value > 0 else { return nil }
        return value
    }

    /// "9:30 PM" in the given time zone (default: current), en_US_POSIX "h:mm a".
    public static func time(_ date: Date, timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let hour = parts.hour ?? 0, minute = parts.minute ?? 0
        let twelve = hour % 12 == 0 ? 12 : hour % 12
        return "\(twelve):\(minute < 10 ? "0" : "")\(minute) \(hour < 12 ? "AM" : "PM")"
    }
}

/// Monotonic time and sleeping, injectable for tests. `SystemClock` uses `ContinuousClock` (no required-reason API).
public protocol TunerClock: Sendable {
    /// Seconds on a monotonic clock.
    func now() -> Double
    func sleep(seconds: Double) async throws
}

public struct SystemClock: TunerClock {
    private static let origin = ContinuousClock.now

    public init() {}

    public func now() -> Double {
        let elapsed = SystemClock.origin.duration(to: ContinuousClock.now).components
        return Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18
    }

    public func sleep(seconds: Double) async throws {
        guard seconds > 0 else { try Task.checkCancellation(); return }
        try await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
    }
}

/// A clock tests drive by hand: `sleep` suspends until `advance(by:)` passes the deadline.
public final class ManualClock: TunerClock, @unchecked Sendable {
    private struct Sleeper {
        let id: UInt64
        let deadline: Double
        let continuation: CheckedContinuation<Void, any Error>
    }

    private let lock = NSLock()
    private var current: Double
    private var sleepers: [Sleeper] = []
    private var nextID: UInt64 = 0

    public init(start: Double = 0) { current = start }

    public func now() -> Double {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    public func sleep(seconds: Double) async throws {
        try Task.checkCancellation()
        guard let (id, deadline) = reserve(seconds) else { return }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                enqueue(Sleeper(id: id, deadline: deadline, continuation: continuation))
            }
        } onCancel: {
            cancelSleeper(id)
        }
    }

    /// The sleeper's id and deadline, or nil when there is nothing to wait for.
    private func reserve(_ seconds: Double) -> (UInt64, Double)? {
        lock.lock(); defer { lock.unlock() }
        let deadline = current + max(0, seconds)
        if deadline <= current { return nil }
        nextID += 1
        return (nextID, deadline)
    }

    private func enqueue(_ sleeper: Sleeper) {
        lock.lock()
        if Task.isCancelled {
            lock.unlock()
            sleeper.continuation.resume(throwing: CancellationError())
            return
        }
        if sleeper.deadline <= current {
            lock.unlock()
            sleeper.continuation.resume()
            return
        }
        sleepers.append(sleeper)
        lock.unlock()
    }

    private func cancelSleeper(_ id: UInt64) {
        lock.lock()
        let index = sleepers.firstIndex { $0.id == id }
        let sleeper = index.map { sleepers.remove(at: $0) }
        lock.unlock()
        sleeper?.continuation.resume(throwing: CancellationError())
    }

    public func advance(by seconds: Double) {
        lock.lock()
        current += max(0, seconds)
        let now = current
        let due = sleepers.filter { $0.deadline <= now }.sorted { $0.deadline < $1.deadline }
        sleepers.removeAll { $0.deadline <= now }
        lock.unlock()
        for sleeper in due { sleeper.continuation.resume() }
    }

    /// Tasks currently sleeping on this clock (tests use it to wait until a session reaches its next wait).
    var sleeperCount: Int {
        lock.lock(); defer { lock.unlock() }
        return sleepers.count
    }
}
