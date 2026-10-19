import Foundation

// MARK: - MPEG-TS

public enum StreamSniff: Sendable, Hashable {
    /// 0x47 at offset k, k+188 and k+376 for some k < 188.
    case transportStream
    /// Starts with "#EXTM3U" (after an optional BOM/whitespace).
    case hlsPlaylist
    case html
    case unknown
}

public enum MPEGTS {
    public static let packetSize = 188
    public static let syncByte: UInt8 = 0x47

    static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
        var c = UInt32(n) << 24
        for _ in 0..<8 { c = (c & 0x8000_0000) != 0 ? (c << 1) ^ 0x04C1_1DB7 : c << 1 }
        return c
    }

    /// MPEG-2 CRC-32 (poly 0x04C11DB7, init 0xFFFFFFFF, no reflection, no final xor).
    public static func crc32<C: Collection>(_ bytes: C) -> UInt32 where C.Element == UInt8 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in bytes { crc = (crc << 8) ^ crcTable[Int(((crc >> 24) ^ UInt32(byte)) & 0xFF)] }
        return crc
    }

    public static func sniff(_ prefix: Data) -> StreamSniff {
        let bytes = [UInt8](prefix.prefix(4096))
        if syncOffset(bytes) != nil { return .transportStream }
        var start = 0
        if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF { start = 3 }
        while start < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[start]) { start += 1 }
        let head = String(decoding: bytes[start..<min(bytes.count, start + 512)], as: UTF8.self)
        if head.hasPrefix("#EXTM3U") { return .hlsPlaylist }
        let lower = head.lowercased()
        if lower.hasPrefix("<!doctype html") || lower.hasPrefix("<html") || lower.contains("<html") || lower.contains("<body") { return .html }
        return .unknown
    }

    /// Offset k < 188 with sync bytes at k, k+188 and k+376.
    static func syncOffset(_ bytes: [UInt8]) -> Int? {
        guard bytes.count >= 2 * packetSize + 1 else { return nil }
        for k in 0..<min(packetSize, bytes.count - 2 * packetSize) where bytes[k] == syncByte && bytes[k + packetSize] == syncByte
            && bytes[k + 2 * packetSize] == syncByte {
            return k
        }
        return nil
    }

    /// 33-bit timestamp from a PES header field (5 bytes).
    static func readTimestamp(_ b: [UInt8], _ at: Int) -> UInt64 {
        (UInt64(b[at] >> 1) & 0x07) << 30 | UInt64(b[at + 1]) << 22 | (UInt64(b[at + 2]) >> 1) << 15 | UInt64(b[at + 3]) << 7 | UInt64(b[at + 4]) >> 1
    }

    static let timestampMask: UInt64 = (1 << 33) - 1

    /// a − b on the 33-bit clock, as a signed value in (−2^32, 2^32].
    static func delta(_ a: UInt64, _ b: UInt64) -> Int64 {
        let d = (a &- b) & timestampMask
        return d > (1 << 32) ? Int64(d) - Int64(1 << 33) : Int64(d)
    }
}

public enum ElementaryStreamKind: String, Sendable, Hashable {
    case h264        // 0x1B
    case hevc        // 0x24
    case mpeg2Video  // 0x01, 0x02
    case aacADTS     // 0x0F
    case aacLATM     // 0x11
    case ac3         // 0x81, or 0x06 with AC-3 descriptor 0x6A (rewritten to 0x81)
    case eac3        // 0x87, or 0x06 with E-AC-3 descriptor 0x7A (rewritten to 0x87)
    case mpegAudio   // 0x03, 0x04 (layer read from the first frame header)
    case id3         // 0x15 timed metadata
    case other

    var isVideo: Bool { self == .h264 || self == .hevc || self == .mpeg2Video }
    var isAudio: Bool { self == .aacADTS || self == .aacLATM || self == .ac3 || self == .eac3 || self == .mpegAudio }
}

public struct ElementaryStream: Sendable, Hashable {
    public var pid: UInt16
    public var streamType: UInt8
    public var kind: ElementaryStreamKind
    /// ISO 639 language descriptor (0x0A), lowercased.
    public var language: String?
    public init(pid: UInt16, streamType: UInt8, kind: ElementaryStreamKind, language: String? = nil) {
        self.pid = pid; self.streamType = streamType; self.kind = kind; self.language = language
    }
}

public struct ProgramMap: Sendable, Hashable {
    public var programNumber: UInt16
    public var pmtPID: UInt16
    public var pcrPID: UInt16
    public var streams: [ElementaryStream]
    public init(programNumber: UInt16, pmtPID: UInt16, pcrPID: UInt16, streams: [ElementaryStream]) {
        self.programNumber = programNumber; self.pmtPID = pmtPID; self.pcrPID = pcrPID; self.streams = streams
    }
}

public struct StreamInfo: Sendable, Hashable {
    public var video: ElementaryStream?
    public var audio: ElementaryStream?
    /// "avc1.64001F" from the SPS (profile_idc, constraint flags, level_idc).
    public var videoCodec: String?
    /// "mp4a.40.2" (from ADTS object type), "ac-3", "ec-3", "mp4a.40.34" (MP3), "mp4a.40.33" (MPEG audio layer II).
    public var audioCodec: String?
    public var width: Int?
    public var height: Int?
    /// CEA-608 seen in H.264 SEI (user_data_registered_itu_t_t35, "GA94", cc_data) before the session was ready.
    public var hasCEA608: Bool
    /// The program's audio was MPEG Layer II and was left out (`SegmenterConfig.dropMPEGAudioLayer2`).
    public var audioDropped: Bool
    /// Every audio stream in the PMT (the app may offer them; v1 plays `audio`).
    public var audioStreams: [ElementaryStream]
    public init(video: ElementaryStream? = nil, audio: ElementaryStream? = nil, videoCodec: String? = nil, audioCodec: String? = nil,
                width: Int? = nil, height: Int? = nil, hasCEA608: Bool = false, audioDropped: Bool = false, audioStreams: [ElementaryStream] = []) {
        self.video = video; self.audio = audio; self.videoCodec = videoCodec; self.audioCodec = audioCodec
        self.width = width; self.height = height; self.hasCEA608 = hasCEA608; self.audioDropped = audioDropped
        self.audioStreams = audioStreams
    }

    /// CODECS attribute value, nil when a codec string is unknown (then the multivariant playlist is skipped).
    public var codecs: String? {
        var parts: [String] = []
        if video != nil {
            guard let videoCodec else { return nil }
            parts.append(videoCodec)
        }
        if audio != nil {
            guard let audioCodec else { return nil }
            parts.append(audioCodec)
        }
        return parts.isEmpty ? nil : parts.joined(separator: ",")
    }
}

public enum UnsupportedFormat: String, Error, Sendable, Hashable {
    case hevcVideo
    case mpeg2Video
    case noPlayableStreams
    case scrambled
    /// hevcVideo/mpeg2Video: "This channel uses a video format Apple TV can't play from your provider."
    /// noPlayableStreams: "This channel has no video or audio Apple TV can play."
    /// scrambled: "This channel is scrambled by your provider."
    public var message: String {
        switch self {
        case .hevcVideo, .mpeg2Video: return "This channel uses a video format Apple TV can't play from your provider."
        case .noPlayableStreams: return "This channel has no video or audio Apple TV can play."
        case .scrambled: return "This channel is scrambled by your provider."
        }
    }
}

public struct SegmenterConfig: Sendable, Hashable {
    /// Cut at the first keyframe after this much media in the first segment...
    public var firstSegmentMinDuration: Double = 1.0
    /// ...and in every later one.
    public var segmentMinDuration: Double = 2.0
    /// Cut at the next video access unit even without a keyframe. Only long-GOP channels ever hit this.
    public var segmentMaxDuration: Double = 6.0
    /// No segment may last longer than this (EXTINF rounded to a whole second must stay <= EXT-X-TARGETDURATION;
    /// `LiveChannelSession` sets target duration + 0.4). Only a jump forward in the stream's timestamps (data lost
    /// upstream) can stretch a segment that far: the segment then ends at its last picture and the stream continues on
    /// a new timeline (EXT-X-DISCONTINUITY) at the next keyframe. Smaller jumps stay inside the segment, so channels with
    /// very few frames per second (radio stations with a still picture) aren't cut up.
    public var durationLimit: Double = 12.4
    /// Keep one audio stream: the first whose language matches, else the first playable one.
    public var preferredAudioLanguages: [String] = ["en", "eng"]
    /// Drop MPEG-1/2 Layer II audio (first try keeps it; the app retries with `LiveTuneRequest.dropMPEGAudioLayer2`
    /// when AVPlayer fails a Layer II channel).
    public var dropMPEGAudioLayer2: Bool = false
    /// Upper bound for packets held while an access unit is classified, and for one segment.
    public var maxSegmentBytes: Int = 24 * 1024 * 1024
    public init() {}
}

/// One HLS media segment: MPEG-TS starting with a fresh PAT and the rewritten PMT, then whole 188-byte packets.
public struct TSSegment: Sendable, Hashable {
    public var sequence: Int
    public var duration: Double
    public var data: Data
    /// EXT-X-DISCONTINUITY before this segment (new connection on a different clock/encode, or a gap > 1 s).
    public var discontinuity: Bool
    public var firstPTS: UInt64
    public init(sequence: Int, duration: Double, data: Data, discontinuity: Bool, firstPTS: UInt64) {
        self.sequence = sequence; self.duration = duration; self.data = data; self.discontinuity = discontinuity; self.firstPTS = firstPTS
    }
}

public enum SegmenterOutput: Sendable, Hashable {
    /// Once per program map (again after a change).
    case streamInfo(StreamInfo)
    case segment(TSSegment)
    case unsupported(UnsupportedFormat)
}

/// Pass-through TS → HLS-TS segmenter. Pure Swift, no Foundation beyond Data. Single-threaded (owned by one actor).
/// - Resyncs on 0x47; drops packets with transport_error_indicator.
/// - First program only (PAT rewritten to it); PMT rewritten to video + one audio (+ PCR PID), CRC recomputed;
///   DVB AC-3/E-AC-3 (0x06 + descriptor) retyped to 0x81/0x87. Own continuity counters for PAT/PMT.
/// - Keyframe = access unit with an IDR slice (NAL 5) or a recovery-point SEI; if none in the first 6 s,
///   I-slices (slice_type 2/7) count too. Audio-only programs cut at audio PES starts.
/// - Duration = next segment's first PTS − this one's (mod 2^33) / 90 000.
/// - `reconnect()`: drop bytes until the new connection's first keyframe; drop PES whose PTS <= the last one sent
///   on that PID; seamless when the gap is (0, 1 s], else the next segment carries `discontinuity`.
/// Every output packet gets this segmenter's own continuity counter, so splices never show a counter jump.
public struct TSSegmenter: Sendable {
    private struct OpenSegment: Sendable {
        var bytes: [UInt8]
        var firstPTS: UInt64
        var lastPTS: UInt64
        var discontinuity: Bool
    }

    /// The video access unit (or audio PES, for audio-only programs) whose packets are held until it is classified.
    private struct PendingUnit: Sendable {
        var pts: UInt64?
        var dts: UInt64?
        var payload: [UInt8] = []
        var classified = false
        var keyframe = false
    }

    private var config: SegmenterConfig
    private var input: [UInt8] = []
    private var synced = false

    private var pmtPID: UInt16?
    private var programNumber: UInt16 = 1
    private var lastPMTSection: [UInt8]?
    private var map: ProgramMap?
    private var videoPID: UInt16?
    private var audioPID: UInt16?
    private var audioKind: ElementaryStreamKind?
    private var pcrPID: UInt16?
    private var outputStreams: [(pid: UInt16, type: UInt8, language: String?)] = []
    private var info: StreamInfo?
    private var emittedInfo: StreamInfo?
    private var stopped = false
    private var scrambledCount = 0
    private var clearCount = 0

    private var outputCC: [UInt16: UInt8] = [:]
    private var lastInputCC: [UInt16: UInt8] = [:]
    private var pmtVersion: UInt8 = 0

    private var unit: PendingUnit?
    private var held: [[UInt8]] = []
    private var heldBytes = 0
    private var droppingVideoUnit = false
    private var droppingAudioPES = false
    private var audioCodecKnown = false

    private var segment: OpenSegment?
    private var nextSequence = 0
    private var firstVideoPTS: UInt64?
    private var lastUnitDTS: UInt64?
    private var frameDuration: UInt64 = 3000
    private var sps: [UInt8]?
    private var hasCEA608 = false
    private var nextDiscontinuity = false

    /// After `reconnect()`: waiting for the new connection's first keyframe.
    private var placing = false
    /// Whether the last placement after `reconnect()` had to start a new timeline.
    private(set) var lastPlacementWasDiscontinuity = false
    /// Last timestamp put in a segment, per PID (video: DTS, audio: PTS).
    private var lastSent: [UInt16: UInt64] = [:]
    /// PIDs whose old PES (timestamp <= lastSent) are dropped after a reconnect, until one passes.
    private var overlapCheck = Set<UInt16>()

    public init(config: SegmenterConfig = SegmenterConfig()) {
        self.config = config
    }

    public var programMap: ProgramMap? { map }
    public var streamInfo: StreamInfo? { info }
    /// True after `reconnect()` until the new connection's first keyframe is placed.
    var isPlacing: Bool { placing }
    /// True once a segment is open (the stream started at a keyframe).
    var hasStarted: Bool { segment != nil }

    // MARK: input

    public mutating func push(_ bytes: Data) -> [SegmenterOutput] {
        guard !stopped else { return [] }
        input.append(contentsOf: bytes)
        var outputs: [SegmenterOutput] = []
        var offset = 0
        while input.count - offset >= MPEGTS.packetSize {
            if !synced || input[offset] != MPEGTS.syncByte {
                synced = false
                // Find three sync bytes in a row, 188 apart.
                var found: Int?
                var k = offset
                while k + 2 * MPEGTS.packetSize < input.count {
                    if input[k] == MPEGTS.syncByte && input[k + MPEGTS.packetSize] == MPEGTS.syncByte
                        && input[k + 2 * MPEGTS.packetSize] == MPEGTS.syncByte {
                        found = k
                        break
                    }
                    k += 1
                }
                guard let start = found else {
                    // Keep the tail that could still start a synced run.
                    offset = max(offset, input.count - 2 * MPEGTS.packetSize)
                    break
                }
                offset = start
                synced = true
            }
            let packet = Array(input[offset..<(offset + MPEGTS.packetSize)])
            offset += MPEGTS.packetSize
            handle(packet, &outputs)
            if stopped { break }
        }
        if offset > 0 { input.removeFirst(min(offset, input.count)) }
        return outputs
    }

    public mutating func reconnect() {
        input = []
        synced = false
        lastInputCC = [:]
        dropHeld()
        unit = nil
        droppingVideoUnit = false
        droppingAudioPES = false
        if segment != nil || !lastSent.isEmpty {
            placing = true
            overlapCheck = Set(lastSent.keys)
        }
    }

    /// Closes the open segment at end of stream (its duration from the last PTS seen).
    public mutating func flush() -> [SegmenterOutput] {
        guard !stopped else { return [] }
        var outputs: [SegmenterOutput] = []
        if let unit, unit.classified || !held.isEmpty, segment != nil {
            for packet in held { append(packet) }
            if let pts = unit.pts { segment?.lastPTS = pts }
        }
        dropHeld()
        self.unit = nil
        closeSegment(nextFirstPTS: nil, &outputs)
        return outputs
    }

    // MARK: packets

    private mutating func handle(_ packet: [UInt8], _ outputs: inout [SegmenterOutput]) {
        if packet[1] & 0x80 != 0 { return } // transport_error_indicator
        let pid = UInt16(packet[1] & 0x1F) << 8 | UInt16(packet[2])
        let pusi = packet[1] & 0x40 != 0
        let control = (packet[3] >> 4) & 0x03
        let hasPayload = control & 0x01 != 0
        let cc = packet[3] & 0x0F
        var payloadStart = 4
        if control & 0x02 != 0 { payloadStart = 5 + Int(packet[4]) }
        if hasPayload {
            // A repeated packet (same counter) is a legal duplicate: drop it.
            if let previous = lastInputCC[pid], previous == cc, pid != 0x1FFF { return }
            lastInputCC[pid] = cc
        }
        if pid == 0 {
            if pusi, hasPayload, payloadStart < MPEGTS.packetSize { parsePAT(packet, payloadStart) }
            return
        }
        if let pmtPID, pid == pmtPID {
            if pusi, hasPayload, payloadStart < MPEGTS.packetSize { parsePMT(packet, payloadStart, &outputs) }
            return
        }
        guard map != nil else { return }
        let scrambled = packet[3] & 0xC0 != 0
        if pid == videoPID || pid == audioPID {
            if scrambled { scrambledCount += 1 } else { clearCount += 1 }
            if scrambled && clearCount == 0 && scrambledCount >= 50 && segment == nil {
                stop(.scrambled, &outputs)
                return
            }
            if scrambled { return }
        }
        let payload: ArraySlice<UInt8> = hasPayload && payloadStart < MPEGTS.packetSize ? packet[payloadStart...] : []
        if pid == videoPID {
            video(packet, pusi: pusi, payload: payload, &outputs)
        } else if pid == audioPID {
            audio(packet, pusi: pusi, payload: payload, &outputs)
        } else if pid == pcrPID {
            route(packet)
        }
    }

    /// Puts a packet where it belongs: held with the unit being classified, in the open segment, or nowhere yet.
    private mutating func route(_ packet: [UInt8]) {
        if unit != nil && !(unit?.classified ?? true) {
            held.append(packet)
            heldBytes += packet.count
            return
        }
        if segment != nil && !placing { append(packet) }
    }

    private mutating func append(_ packet: [UInt8]) {
        guard segment != nil else { return }
        var copy = packet
        let pid = UInt16(copy[1] & 0x1F) << 8 | UInt16(copy[2])
        if copy[3] & 0x10 != 0 {
            let next = ((outputCC[pid] ?? 0x0F) &+ 1) & 0x0F
            outputCC[pid] = next
            copy[3] = (copy[3] & 0xF0) | next
        } else {
            copy[3] = (copy[3] & 0xF0) | (outputCC[pid] ?? 0)
        }
        segment?.bytes.append(contentsOf: copy)
        // Remember the last timestamp sent on each media PID (video: DTS, audio: PTS) for splicing.
        if copy[1] & 0x40 != 0, copy[3] & 0x10 != 0, pid == videoPID || pid == audioPID {
            let start = copy[3] & 0x20 != 0 ? 5 + Int(copy[4]) : 4
            if start < MPEGTS.packetSize, let header = TSSegmenter.pesHeader(copy[start...]) {
                if let stamp = pid == videoPID ? (header.dts ?? header.pts) : header.pts { lastSent[pid] = stamp }
            }
        }
    }

    private mutating func dropHeld() {
        held = []
        heldBytes = 0
    }

    // MARK: tables

    private func section(_ packet: [UInt8], _ payloadStart: Int) -> [UInt8]? {
        let pointer = Int(packet[payloadStart])
        let start = payloadStart + 1 + pointer
        guard start + 3 <= MPEGTS.packetSize else { return nil }
        let length = Int(packet[start + 1] & 0x0F) << 8 | Int(packet[start + 2])
        guard length >= 9, start + 3 + length <= MPEGTS.packetSize else { return nil }
        let bytes = Array(packet[start..<(start + 3 + length)])
        guard MPEGTS.crc32(bytes) == 0 else { return nil } // CRC over the section including its CRC is 0
        return bytes
    }

    private mutating func parsePAT(_ packet: [UInt8], _ payloadStart: Int) {
        guard let bytes = section(packet, payloadStart), bytes[0] == 0x00 else { return }
        let end = bytes.count - 4
        var i = 8
        while i + 4 <= end {
            let number = UInt16(bytes[i]) << 8 | UInt16(bytes[i + 1])
            let pid = UInt16(bytes[i + 2] & 0x1F) << 8 | UInt16(bytes[i + 3])
            if number != 0 {
                if pmtPID != pid {
                    pmtPID = pid
                    lastPMTSection = nil
                }
                programNumber = number
                return
            }
            i += 4
        }
    }

    private mutating func parsePMT(_ packet: [UInt8], _ payloadStart: Int, _ outputs: inout [SegmenterOutput]) {
        guard let bytes = section(packet, payloadStart), bytes[0] == 0x02 else { return }
        // Ignore the version and CRC bytes when comparing: a repeat of the same program isn't a change.
        let body = Array(bytes[3..<(bytes.count - 4)])
        if let last = lastPMTSection, last == body { return }
        let isChange = lastPMTSection != nil || map != nil
        lastPMTSection = body
        let number = UInt16(bytes[3]) << 8 | UInt16(bytes[4])
        let pcr = UInt16(bytes[8] & 0x1F) << 8 | UInt16(bytes[9])
        let programInfoLength = Int(bytes[10] & 0x0F) << 8 | Int(bytes[11])
        var i = 12 + programInfoLength
        let end = bytes.count - 4
        var streams: [ElementaryStream] = []
        while i + 5 <= end {
            let type = bytes[i]
            let pid = UInt16(bytes[i + 1] & 0x1F) << 8 | UInt16(bytes[i + 2])
            let infoLength = Int(bytes[i + 3] & 0x0F) << 8 | Int(bytes[i + 4])
            let descriptorsEnd = min(end, i + 5 + infoLength)
            var language: String?
            var ac3 = false, eac3 = false
            var d = i + 5
            while d + 2 <= descriptorsEnd {
                let tag = bytes[d], length = Int(bytes[d + 1])
                if tag == 0x0A, length >= 3, d + 5 <= descriptorsEnd {
                    let code = String(decoding: bytes[(d + 2)..<(d + 5)], as: UTF8.self).lowercased()
                    if code.allSatisfy({ $0.isLetter }) { language = code }
                }
                if tag == 0x6A { ac3 = true }
                if tag == 0x7A { eac3 = true }
                if tag == 0x05, length >= 4, d + 6 <= descriptorsEnd {
                    let format = String(decoding: bytes[(d + 2)..<(d + 6)], as: UTF8.self)
                    if format == "AC-3" { ac3 = true }
                    if format == "EAC3" { eac3 = true }
                }
                d += 2 + length
            }
            let kind: ElementaryStreamKind
            switch type {
            case 0x1B: kind = .h264
            case 0x24: kind = .hevc
            case 0x01, 0x02: kind = .mpeg2Video
            case 0x0F: kind = .aacADTS
            case 0x11: kind = .aacLATM
            case 0x81: kind = .ac3
            case 0x87: kind = .eac3
            case 0x03, 0x04: kind = .mpegAudio
            case 0x15: kind = .id3
            case 0x06: kind = eac3 ? .eac3 : ac3 ? .ac3 : .other
            default: kind = .other
            }
            streams.append(ElementaryStream(pid: pid, streamType: type, kind: kind, language: language))
            i += 5 + infoLength
        }
        guard let pmtPID else { return }
        let program = ProgramMap(programNumber: number, pmtPID: pmtPID, pcrPID: pcr, streams: streams)
        map = program
        select(program, isChange: isChange, &outputs)
    }

    private mutating func select(_ program: ProgramMap, isChange: Bool, _ outputs: inout [SegmenterOutput]) {
        let videoStream = program.streams.first { $0.kind.isVideo }
        let allAudio = program.streams.filter { $0.kind.isAudio }
        var candidates = allAudio
        var dropped = false
        if config.dropMPEGAudioLayer2 {
            // Layer II can't be told from MP3 until a frame arrives; MPEG audio and LATM are left out together on the
            // retry this setting is for.
            let kept = candidates.filter { $0.kind != .mpegAudio && $0.kind != .aacLATM }
            dropped = kept.count < candidates.count
            candidates = kept
        }
        let preferred = Set(config.preferredAudioLanguages.map { $0.lowercased() })
        let audioStream = candidates.first { $0.language.map(preferred.contains) ?? false } ?? candidates.first

        if let videoStream, videoStream.kind == .hevc { stop(.hevcVideo, &outputs); return }
        if let videoStream, videoStream.kind == .mpeg2Video { stop(.mpeg2Video, &outputs); return }
        if videoStream == nil && audioStream == nil { stop(.noPlayableStreams, &outputs); return }

        let previousVideo = videoPID, previousAudio = audioPID
        videoPID = videoStream?.pid
        audioPID = audioStream?.pid
        audioKind = audioStream?.kind
        pcrPID = program.pcrPID == 0x1FFF ? nil : program.pcrPID
        var streams: [(pid: UInt16, type: UInt8, language: String?)] = []
        if let videoStream { streams.append((videoStream.pid, videoStream.streamType, nil)) }
        if let audioStream {
            let type: UInt8 = audioStream.kind == .ac3 ? 0x81 : audioStream.kind == .eac3 ? 0x87 : audioStream.streamType
            streams.append((audioStream.pid, type, audioStream.language))
        }
        outputStreams = streams
        if previousAudio != audioPID { audioCodecKnown = false }
        var updated = info ?? StreamInfo()
        updated.video = videoStream
        updated.audio = audioStream
        updated.audioDropped = dropped && audioStream == nil
        updated.audioStreams = allAudio
        if videoStream == nil { updated.videoCodec = nil; updated.width = nil; updated.height = nil }
        if audioStream == nil { updated.audioCodec = nil } else if previousAudio != audioPID {
            updated.audioCodec = audioStream.flatMap { TSSegmenter.defaultAudioCodec($0.kind) }
        }
        info = updated
        if isChange && (previousVideo != videoPID || previousAudio != audioPID) {
            pmtVersion = (pmtVersion &+ 1) & 0x1F
            // Another program on the same connection: start over at its next keyframe, on a new timeline.
            if segment != nil {
                var dummy: [SegmenterOutput] = []
                closeSegment(nextFirstPTS: nil, &dummy)
                outputs.append(contentsOf: dummy)
                nextDiscontinuity = true
            }
            dropHeld()
            unit = nil
            placing = false
            overlapCheck = []
            lastSent = [:]
        }
    }

    private static func defaultAudioCodec(_ kind: ElementaryStreamKind) -> String? {
        switch kind {
        case .aacADTS: return "mp4a.40.2"
        case .ac3: return "ac-3"
        case .eac3: return "ec-3"
        default: return nil
        }
    }

    private mutating func stop(_ format: UnsupportedFormat, _ outputs: inout [SegmenterOutput]) {
        stopped = true
        outputs.append(.unsupported(format))
    }

    // MARK: PES

    private struct PESHeader {
        var pts: UInt64?
        var dts: UInt64?
        var payloadOffset: Int
    }

    private static func pesHeader(_ payload: ArraySlice<UInt8>) -> PESHeader? {
        let b = Array(payload)
        guard b.count >= 9, b[0] == 0, b[1] == 0, b[2] == 1 else { return nil }
        let flags = b[7] >> 6
        let headerLength = Int(b[8])
        guard 9 + headerLength <= b.count else { return PESHeader(pts: nil, dts: nil, payloadOffset: b.count) }
        var pts: UInt64?, dts: UInt64?
        if flags & 0x02 != 0, b.count >= 14 { pts = MPEGTS.readTimestamp(b, 9) }
        if flags == 0x03, b.count >= 19 { dts = MPEGTS.readTimestamp(b, 14) }
        return PESHeader(pts: pts, dts: dts, payloadOffset: 9 + headerLength)
    }

    // MARK: video

    private mutating func video(_ packet: [UInt8], pusi: Bool, payload: ArraySlice<UInt8>, _ outputs: inout [SegmenterOutput]) {
        if pusi {
            let header = TSSegmenter.pesHeader(payload)
            let pts = header?.pts
            let dts = header?.dts ?? pts
            if var current = unit, !current.classified {
                if current.pts == nil || pts == nil || current.pts == pts {
                    // Same picture split over two PES (parameter sets, then the slice): keep collecting.
                    if let header { current.payload.append(contentsOf: payload.dropFirst(header.payloadOffset)) }
                    unit = current
                    held.append(packet)
                    heldBytes += packet.count
                    classify(&outputs)
                    return
                }
                // The previous unit never showed a slice: settle it as a non-keyframe.
                settle(keyframe: false, &outputs)
            }
            droppingVideoUnit = false
            if let dts, overlapCheck.contains(videoPID ?? 0), let last = lastSent[videoPID ?? 0], !placing {
                if MPEGTS.delta(dts, last) <= 0 { droppingVideoUnit = true; return }
                overlapCheck.remove(videoPID ?? 0)
            }
            if let pts, firstVideoPTS == nil { firstVideoPTS = pts }
            unit = PendingUnit(pts: pts, dts: dts)
            if let header { unit?.payload.append(contentsOf: payload.dropFirst(header.payloadOffset)) }
            held.append(packet)
            heldBytes += packet.count
            classify(&outputs)
            return
        }
        if droppingVideoUnit { return }
        guard var current = unit else { return }
        if !current.classified {
            current.payload.append(contentsOf: payload)
            unit = current
            held.append(packet)
            heldBytes += packet.count
            classify(&outputs)
            if heldBytes > config.maxSegmentBytes, !(unit?.classified ?? true) { settle(keyframe: false, &outputs) }
        } else if segment != nil && !placing {
            append(packet)
        }
    }

    /// Classifies the pending unit once its first slice is visible.
    private mutating func classify(_ outputs: inout [SegmenterOutput]) {
        guard let current = unit, !current.classified else { return }
        guard let verdict = examine(current.payload) else { return }
        settle(keyframe: verdict, &outputs)
    }

    /// nil until a slice NAL (with enough of its header) is in `payload`; then whether the unit is a keyframe.
    private mutating func examine(_ payload: [UInt8]) -> Bool? {
        var recovery = false
        let units = H264.nalRanges(payload)
        for (index, range) in units.enumerated() {
            guard range.count > 0 else { continue }
            let type = payload[range.lowerBound] & 0x1F
            let complete = index + 1 < units.count
            switch type {
            case 7:
                if complete, sps == nil || Array(payload[range]) != sps! {
                    sps = Array(payload[range])
                    updateVideoInfo()
                }
            case 6:
                if complete {
                    let sei = Data(payload[range])
                    if !hasCEA608 && H264.hasCEA608(sei: sei) {
                        hasCEA608 = true
                        info?.hasCEA608 = true
                    }
                    if H264.hasRecoveryPoint(sei: sei) { recovery = true }
                }
            case 5:
                return true
            case 1, 2:
                if recovery { return true }
                guard range.count >= 4 || complete else { return nil }
                if allowsISlices, let sliceType = H264.sliceType(Array(payload[range])) {
                    return sliceType % 5 == 2 || sliceType % 5 == 4
                }
                return false
            default:
                continue
            }
        }
        return nil
    }

    private var allowsISlices: Bool {
        guard let first = firstVideoPTS, let pts = unit?.pts else { return false }
        return segment == nil && MPEGTS.delta(pts, first) >= 6 * 90_000 || segment != nil && lastKeyframeAge(pts) >= 6 * 90_000
    }

    private var lastKeyframePTS: UInt64?

    private func lastKeyframeAge(_ pts: UInt64) -> Int64 {
        guard let last = lastKeyframePTS else { return 0 }
        return MPEGTS.delta(pts, last)
    }

    private mutating func updateVideoInfo() {
        guard let sps else { return }
        let data = Data(sps)
        info?.videoCodec = H264.codecString(sps: data)
        if let size = H264.dimensions(sps: data) {
            info?.width = size.width
            info?.height = size.height
        }
    }

    /// The pending unit is classified: place a segment boundary before it when due, then release its packets.
    private mutating func settle(keyframe: Bool, _ outputs: inout [SegmenterOutput]) {
        guard var current = unit else { return }
        current.classified = true
        current.keyframe = keyframe
        unit = current
        let pts = current.pts
        let dts = current.dts ?? pts
        let packets = held
        dropHeld()
        if keyframe, let pts { lastKeyframePTS = pts }

        if placing {
            guard keyframe, let pts, let dts else { return } // still looking for the new connection's first keyframe
            placing = false
            let video = videoPID ?? 0
            if let last = lastSent[video] {
                let gap = MPEGTS.delta(dts, last)
                lastPlacementWasDiscontinuity = false
                if gap > 0 && gap <= 90_000 + Int64(frameDuration) {
                    overlapCheck.remove(video) // continues the stream seamlessly
                } else if gap <= 0 && gap > -10 * 90_000 {
                    // The new connection replays what was already sent: drop up to the last sent picture.
                    overlapCheck.insert(video)
                    droppingVideoUnit = true
                    unit = nil
                    return
                } else {
                    closeSegment(nextFirstPTS: nil, &outputs)
                    nextDiscontinuity = true
                    lastPlacementWasDiscontinuity = true
                    lastSent = [:]
                    overlapCheck = []
                }
            }
            startOrCut(pts: pts, packets: packets, &outputs)
            lastUnitDTS = dts
            return
        }

        guard let pts, let dts else {
            if segment != nil { for packet in packets { append(packet) } }
            return
        }
        // A jump on the stream's own clock (new encode, ad splice): a new timeline at the next keyframe.
        if let previous = lastUnitDTS, segment != nil {
            let step = MPEGTS.delta(dts, previous)
            let stretched = step >= 90_000 && segment.map { Double(MPEGTS.delta(pts, $0.firstPTS)) / 90_000 > config.durationLimit } ?? false
            if step < -5 * 90_000 || step > 10 * 90_000 || stretched {
                closeSegment(nextFirstPTS: nil, &outputs)
                nextDiscontinuity = true
                lastSent = [:]
                overlapCheck = []
                if !keyframe { lastUnitDTS = dts; return }
            } else if step > 0 && step < 90_000 {
                frameDuration = UInt64(step)
            }
        }
        lastUnitDTS = dts
        if segment == nil {
            guard keyframe else { return } // the stream starts at a keyframe
            startOrCut(pts: pts, packets: packets, &outputs)
        } else if let open = segment {
            let age = Double(MPEGTS.delta(pts, open.firstPTS)) / 90_000
            let minimum = nextSequence == 0 ? config.firstSegmentMinDuration : config.segmentMinDuration
            let samePicture = open.lastPTS == pts
            if !samePicture && ((keyframe && age >= minimum) || age >= config.segmentMaxDuration || open.bytes.count > config.maxSegmentBytes) {
                startOrCut(pts: pts, packets: packets, &outputs)
            } else {
                for packet in packets { append(packet) }
                segment?.lastPTS = pts
            }
        }
    }

    /// Closes the open segment (if any) at `pts` and opens the next one with fresh tables and `packets`.
    private mutating func startOrCut(pts: UInt64, packets: [[UInt8]], _ outputs: inout [SegmenterOutput]) {
        closeSegment(nextFirstPTS: pts, &outputs)
        var bytes: [UInt8] = []
        bytes.reserveCapacity(1 << 20)
        bytes.append(contentsOf: patPacket())
        bytes.append(contentsOf: pmtPacket())
        segment = OpenSegment(bytes: bytes, firstPTS: pts, lastPTS: pts, discontinuity: nextDiscontinuity)
        nextDiscontinuity = false
        for packet in packets { append(packet) }
    }

    private mutating func closeSegment(nextFirstPTS: UInt64?, _ outputs: inout [SegmenterOutput]) {
        guard let open = segment else { return }
        segment = nil
        var duration: Double
        if let next = nextFirstPTS, MPEGTS.delta(next, open.firstPTS) > 0, MPEGTS.delta(next, open.firstPTS) < 30 * 90_000 {
            duration = Double(MPEGTS.delta(next, open.firstPTS)) / 90_000
        } else {
            duration = Double(max(0, MPEGTS.delta(open.lastPTS, open.firstPTS)) + Int64(frameDuration)) / 90_000
        }
        duration = max(duration, 0.001)
        if let info, info != emittedInfo {
            emittedInfo = info
            outputs.append(.streamInfo(info))
        }
        outputs.append(.segment(TSSegment(sequence: nextSequence, duration: duration, data: Data(open.bytes),
                                          discontinuity: open.discontinuity, firstPTS: open.firstPTS)))
        nextSequence += 1
    }

    // MARK: audio

    private mutating func audio(_ packet: [UInt8], pusi: Bool, payload: ArraySlice<UInt8>, _ outputs: inout [SegmenterOutput]) {
        guard let pid = audioPID else { return }
        if pusi {
            droppingAudioPES = false
            let header = TSSegmenter.pesHeader(payload)
            if let header, !audioCodecKnown {
                let body = Array(payload.dropFirst(header.payloadOffset))
                if let codec = TSSegmenter.audioCodec(kind: audioKind, frame: body) {
                    info?.audioCodec = codec
                    audioCodecKnown = true
                }
            }
            if let pts = header?.pts {
                if overlapCheck.contains(pid), let last = lastSent[pid] {
                    if MPEGTS.delta(pts, last) <= 0 { droppingAudioPES = true; return }
                    overlapCheck.remove(pid)
                }
                if videoPID == nil {
                    // Audio-only program: every PES start is a cut candidate.
                    audioOnlyUnit(packet, pts: pts, &outputs)
                    return
                }
            }
        }
        if droppingAudioPES || placing { return }
        if videoPID == nil {
            append(packet)
            return
        }
        route(packet)
    }

    private mutating func audioOnlyUnit(_ packet: [UInt8], pts: UInt64, _ outputs: inout [SegmenterOutput]) {
        if placing {
            placing = false
            if let last = lastSent[audioPID ?? 0] {
                let gap = MPEGTS.delta(pts, last)
                if !(gap > 0 && gap <= 90_000 + 3000) {
                    closeSegment(nextFirstPTS: nil, &outputs)
                    nextDiscontinuity = true
                }
            }
        }
        if let open = segment {
            let age = Double(MPEGTS.delta(pts, open.firstPTS)) / 90_000
            let minimum = nextSequence == 0 ? config.firstSegmentMinDuration : config.segmentMinDuration
            if age > config.durationLimit {
                // A jump forward: end the segment at its last frame, then a new timeline from this one.
                closeSegment(nextFirstPTS: nil, &outputs)
                nextDiscontinuity = true
                startOrCut(pts: pts, packets: [packet], &outputs)
            } else if age >= minimum || age < 0 {
                startOrCut(pts: pts, packets: [packet], &outputs)
            } else {
                append(packet)
                segment?.lastPTS = pts
            }
            let step = MPEGTS.delta(pts, open.lastPTS)
            if step > 0 && step < 90_000 { frameDuration = UInt64(step) }
        } else {
            startOrCut(pts: pts, packets: [packet], &outputs)
        }
    }

    /// Codec string from the first audio frame (ADTS object type, MPEG audio layer).
    private static func audioCodec(kind: ElementaryStreamKind?, frame: [UInt8]) -> String? {
        guard let kind else { return nil }
        switch kind {
        case .aacADTS:
            guard frame.count >= 3, frame[0] == 0xFF, frame[1] & 0xF0 == 0xF0 else { return "mp4a.40.2" }
            let objectType = Int(frame[2] >> 6) + 1
            return objectType == 5 ? "mp4a.40.5" : "mp4a.40.\(objectType)"
        case .ac3: return "ac-3"
        case .eac3: return "ec-3"
        case .mpegAudio:
            guard frame.count >= 2, frame[0] == 0xFF, frame[1] & 0xE0 == 0xE0 else { return nil }
            switch (frame[1] >> 1) & 0x03 {
            case 0x01: return "mp4a.40.34" // Layer III
            case 0x02: return "mp4a.40.33" // Layer II
            default: return nil
            }
        default:
            return nil
        }
    }

    // MARK: output tables

    private mutating func tablePacket(pid: UInt16, section: [UInt8]) -> [UInt8] {
        var packet = [UInt8](repeating: 0xFF, count: MPEGTS.packetSize)
        let next = ((outputCC[pid] ?? 0x0F) &+ 1) & 0x0F
        outputCC[pid] = next
        packet[0] = MPEGTS.syncByte
        packet[1] = 0x40 | UInt8(pid >> 8 & 0x1F)
        packet[2] = UInt8(pid & 0xFF)
        packet[3] = 0x10 | next
        packet[4] = 0 // pointer_field
        for (i, byte) in section.enumerated() where 5 + i < MPEGTS.packetSize { packet[5 + i] = byte }
        return packet
    }

    private static func withCRC(_ section: [UInt8]) -> [UInt8] {
        let crc = MPEGTS.crc32(section)
        return section + [UInt8(crc >> 24), UInt8(crc >> 16 & 0xFF), UInt8(crc >> 8 & 0xFF), UInt8(crc & 0xFF)]
    }

    private mutating func patPacket() -> [UInt8] {
        let pmt = pmtPID ?? 0x1000
        let body: [UInt8] = [0x00, 0x01, 0xC1 | (0 << 1), 0x00, 0x00,
                             UInt8(programNumber >> 8), UInt8(programNumber & 0xFF), 0xE0 | UInt8(pmt >> 8 & 0x1F), UInt8(pmt & 0xFF)]
        let length = body.count + 4
        let section = TSSegmenter.withCRC([0x00, 0xB0 | UInt8(length >> 8 & 0x0F), UInt8(length & 0xFF)] + body)
        return tablePacket(pid: 0, section: section)
    }

    private mutating func pmtPacket() -> [UInt8] {
        let pmt = pmtPID ?? 0x1000
        let pcr = pcrPID ?? videoPID ?? audioPID ?? 0x1FFF
        var body: [UInt8] = [UInt8(programNumber >> 8), UInt8(programNumber & 0xFF), 0xC1 | (pmtVersion << 1), 0x00, 0x00,
                             0xE0 | UInt8(pcr >> 8 & 0x1F), UInt8(pcr & 0xFF), 0xF0, 0x00]
        for stream in outputStreams {
            var descriptors: [UInt8] = []
            if let language = stream.language, language.utf8.count == 3 {
                descriptors = [0x0A, 0x04] + Array(language.utf8) + [0x00]
            }
            body += [stream.type, 0xE0 | UInt8(stream.pid >> 8 & 0x1F), UInt8(stream.pid & 0xFF),
                     0xF0 | UInt8(descriptors.count >> 8 & 0x0F), UInt8(descriptors.count & 0xFF)] + descriptors
        }
        let length = body.count + 4
        let section = TSSegmenter.withCRC([0x02, 0xB0 | UInt8(length >> 8 & 0x0F), UInt8(length & 0xFF)] + body)
        return tablePacket(pid: pmt, section: section)
    }
}

// MARK: - H.264

public enum H264 {
    /// Ranges of NAL unit payloads (after 00 00 01 / 00 00 00 01 start codes).
    public static func nalUnits(in annexB: Data) -> [Range<Int>] {
        let base = annexB.startIndex
        return nalRanges([UInt8](annexB)).map { ($0.lowerBound + base)..<($0.upperBound + base) }
    }

    static func nalRanges(_ b: [UInt8]) -> [Range<Int>] {
        var starts: [Int] = []
        var i = 0
        while i + 2 < b.count {
            if b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 {
                starts.append(i + 3)
                i += 3
            } else {
                i += 1
            }
        }
        var ranges: [Range<Int>] = []
        for (n, start) in starts.enumerated() {
            var end = n + 1 < starts.count ? starts[n + 1] - 3 : b.count
            // Zero bytes before the next start code belong to it (4-byte start codes, trailing_zero_8bits).
            if n + 1 < starts.count { while end > start && b[end - 1] == 0 { end -= 1 } }
            if end > start { ranges.append(start..<end) }
        }
        return ranges
    }

    /// RBSP: emulation prevention bytes (00 00 03) removed.
    static func rbsp(_ nal: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(nal.count)
        var zeros = 0
        for byte in nal {
            if zeros >= 2 && byte == 3 { zeros = 0; continue }
            out.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        return out
    }

    /// "avc1.PPCCLL" (uppercase hex) from an SPS NAL (including its 1-byte header).
    public static func codecString(sps: Data) -> String? {
        let b = [UInt8](sps)
        guard b.count >= 4, b[0] & 0x1F == 7 else { return nil }
        func hex(_ v: UInt8) -> String {
            let digits = Array("0123456789ABCDEF")
            return String(digits[Int(v >> 4)]) + String(digits[Int(v & 0x0F)])
        }
        return "avc1." + hex(b[1]) + hex(b[2]) + hex(b[3])
    }

    /// Cropped picture size from an SPS NAL (exp-Golomb parse, emulation prevention removed).
    public static func dimensions(sps: Data) -> (width: Int, height: Int)? {
        let raw = [UInt8](sps)
        guard raw.count >= 4, raw[0] & 0x1F == 7 else { return nil }
        var r = BitReader(rbsp(Array(raw.dropFirst())))
        guard let profile = r.bits(8), r.bits(8) != nil, r.bits(8) != nil, r.ue() != nil else { return nil }
        var chroma = 1
        var separateColourPlane = false
        if [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].contains(profile) {
            guard let c = r.ue() else { return nil }
            chroma = c
            if chroma == 3 { separateColourPlane = r.bits(1) == 1 }
            guard r.ue() != nil, r.ue() != nil, r.bits(1) != nil, let scaling = r.bits(1) else { return nil }
            if scaling == 1 {
                for i in 0..<(chroma == 3 ? 12 : 8) {
                    guard let present = r.bits(1) else { return nil }
                    if present == 1 {
                        let size = i < 6 ? 16 : 64
                        var last = 8, next = 8
                        for _ in 0..<size where next != 0 {
                            guard let delta = r.se() else { return nil }
                            next = (last + delta + 256) % 256
                            if next != 0 { last = next }
                        }
                    }
                }
            }
        }
        guard r.ue() != nil, let pocType = r.ue() else { return nil }
        if pocType == 0 {
            guard r.ue() != nil else { return nil }
        } else if pocType == 1 {
            guard r.bits(1) != nil, r.se() != nil, r.se() != nil, let cycle = r.ue() else { return nil }
            for _ in 0..<cycle { guard r.se() != nil else { return nil } }
        }
        guard r.ue() != nil, r.bits(1) != nil, let widthMbs = r.ue(), let heightUnits = r.ue(), let frameMbsOnly = r.bits(1) else { return nil }
        if frameMbsOnly == 0 { guard r.bits(1) != nil else { return nil } }
        guard r.bits(1) != nil, let cropping = r.bits(1) else { return nil }
        var left = 0, right = 0, top = 0, bottom = 0
        if cropping == 1 {
            guard let l = r.ue(), let rr = r.ue(), let t = r.ue(), let b = r.ue() else { return nil }
            left = l; right = rr; top = t; bottom = b
        }
        let arrayType = separateColourPlane ? 0 : chroma
        let subWidth = (chroma == 1 || chroma == 2) ? 2 : 1
        let subHeight = chroma == 1 ? 2 : 1
        let cropX = arrayType == 0 ? 1 : subWidth
        let cropY = arrayType == 0 ? (2 - frameMbsOnly) : subHeight * (2 - frameMbsOnly)
        let width = (widthMbs + 1) * 16 - cropX * (left + right)
        let height = (2 - frameMbsOnly) * (heightUnits + 1) * 16 - cropY * (top + bottom)
        guard width > 0, height > 0 else { return nil }
        return (width, height)
    }

    /// True when an SEI NAL carries ATSC A/53 caption data (GA94, user_data_type_code 3).
    public static func hasCEA608(sei: Data) -> Bool {
        var found = false
        forEachSEIMessage(sei) { type, payload in
            guard type == 4, payload.count >= 10, payload[0] == 0xB5, payload[1] == 0x00, payload[2] == 0x31,
                  payload[3] == 0x47, payload[4] == 0x41, payload[5] == 0x39, payload[6] == 0x34, payload[7] == 0x03 else { return }
            let count = Int(payload[8] & 0x1F)
            var i = 10
            for _ in 0..<count where i + 2 < payload.count {
                let marker = payload[i]
                if marker & 0x04 != 0 && marker & 0x03 <= 1 { found = true }
                i += 3
            }
        }
        return found
    }

    /// True for an SEI with a recovery point message (payload type 6).
    static func hasRecoveryPoint(sei: Data) -> Bool {
        var found = false
        forEachSEIMessage(sei) { type, _ in if type == 6 { found = true } }
        return found
    }

    private static func forEachSEIMessage(_ sei: Data, _ body: (Int, [UInt8]) -> Void) {
        let raw = [UInt8](sei)
        guard raw.count > 1, raw[0] & 0x1F == 6 else { return }
        let b = rbsp(Array(raw.dropFirst()))
        var i = 0
        while i < b.count {
            if b[i] == 0x80 && i == b.count - 1 { return } // rbsp_trailing_bits
            var type = 0
            while i < b.count && b[i] == 0xFF { type += 255; i += 1 }
            guard i < b.count else { return }
            type += Int(b[i]); i += 1
            var size = 0
            while i < b.count && b[i] == 0xFF { size += 255; i += 1 }
            guard i < b.count else { return }
            size += Int(b[i]); i += 1
            guard i + size <= b.count else { return }
            body(type, Array(b[i..<(i + size)]))
            i += size
        }
    }

    /// slice_type from a slice NAL (header byte included).
    static func sliceType(_ nal: [UInt8]) -> Int? {
        var r = BitReader(rbsp(Array(nal.dropFirst())))
        guard r.ue() != nil else { return nil }
        return r.ue()
    }
}

/// Big-endian bit reader with exp-Golomb codes.
struct BitReader {
    private let bytes: [UInt8]
    private var position = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    mutating func bits(_ count: Int) -> Int? {
        guard count >= 0, position + count <= bytes.count * 8 else { return nil }
        var value = 0
        for _ in 0..<count {
            let byte = bytes[position >> 3]
            value = value << 1 | Int((byte >> UInt8(7 - (position & 7))) & 1)
            position += 1
        }
        return value
    }

    mutating func ue() -> Int? {
        var zeros = 0
        while true {
            guard let bit = bits(1) else { return nil }
            if bit == 1 { break }
            zeros += 1
            if zeros > 31 { return nil }
        }
        guard let rest = bits(zeros) else { return nil }
        return (1 << zeros) - 1 + rest
    }

    mutating func se() -> Int? {
        guard let value = ue() else { return nil }
        return value % 2 == 1 ? (value + 1) / 2 : -(value / 2)
    }
}

public struct HLSSegmentEntry: Sendable, Hashable {
    public var sequence: Int
    public var duration: Double
    public var discontinuity: Bool
    public init(sequence: Int, duration: Double, discontinuity: Bool) { self.sequence = sequence; self.duration = duration; self.discontinuity = discontinuity }
}

public enum HLSPlaylistWriter {
    /// #EXTM3U, #EXT-X-VERSION:3, [#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="English",LANGUAGE="en",
    /// DEFAULT=YES,AUTOSELECT=YES,INSTREAM-ID="CC1"], #EXT-X-STREAM-INF:BANDWIDTH=,CODECS="",[RESOLUTION=WxH,]
    /// CLOSED-CAPTIONS="cc"|NONE, then `mediaURI`.
    /// CC1 is declared for every program with H.264 video, not only when captions were seen before the session was
    /// ready: AVPlayer reads this playlist once per item, so a channel tuned during a programme or ad without captions
    /// would otherwise have none until it is tuned again. When the stream carries none, the option shows nothing.
    public static func multivariant(info: StreamInfo, bandwidth: Int, mediaURI: String) -> String {
        var lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
        let captions = info.hasCEA608 || info.video?.kind == .h264
        if captions {
            lines.append("#EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID=\"cc\",NAME=\"English\",LANGUAGE=\"en\",DEFAULT=YES,AUTOSELECT=YES,INSTREAM-ID=\"CC1\"")
        }
        var attributes = ["BANDWIDTH=\(max(1, bandwidth))"]
        if let codecs = info.codecs { attributes.append("CODECS=\"\(codecs)\"") }
        if let width = info.width, let height = info.height { attributes.append("RESOLUTION=\(width)x\(height)") }
        attributes.append(captions ? "CLOSED-CAPTIONS=\"cc\"" : "CLOSED-CAPTIONS=NONE")
        lines.append("#EXT-X-STREAM-INF:" + attributes.joined(separator: ","))
        lines.append(mediaURI)
        return lines.joined(separator: "\n") + "\n"
    }

    /// #EXTM3U, #EXT-X-VERSION:3, #EXT-X-TARGETDURATION:<n>, #EXT-X-MEDIA-SEQUENCE:<first>,
    /// #EXT-X-DISCONTINUITY-SEQUENCE:<n>, per segment [#EXT-X-DISCONTINUITY] #EXTINF:<d.ddd>, + URI.
    /// No ENDLIST (live). EXTINF with 3 decimals.
    public static func media(_ segments: [HLSSegmentEntry], targetDuration: Int, discontinuitySequence: Int,
                             segmentURI: (Int) -> String) -> String {
        var lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:\(targetDuration)",
                     "#EXT-X-MEDIA-SEQUENCE:\(segments.first?.sequence ?? 0)", "#EXT-X-DISCONTINUITY-SEQUENCE:\(discontinuitySequence)"]
        for segment in segments {
            if segment.discontinuity { lines.append("#EXT-X-DISCONTINUITY") }
            lines.append("#EXTINF:" + decimals(segment.duration) + ",")
            lines.append(segmentURI(segment.sequence))
        }
        return lines.joined(separator: "\n") + "\n"
    }

    /// Three decimals without locale formatting ("2.002").
    static func decimals(_ value: Double) -> String {
        let thousandths = Int64((max(0, value) * 1000).rounded())
        let fraction = thousandths % 1000
        return "\(thousandths / 1000)." + (fraction < 10 ? "00" : fraction < 100 ? "0" : "") + "\(fraction)"
    }
}
