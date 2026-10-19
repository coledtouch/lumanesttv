import Foundation
@testable import TunerCore

/// Synthetic live MPEG-TS for the segmenter and live-session tests (a Swift port of the Android TsTestStream idea):
/// PAT, PMT, one H.264 video PES per frame (access unit delimiter, SPS + PPS + IDR on keyframes, a P slice otherwise,
/// optionally an SEI with CEA-608 captions), PCR on the video PID, and one ADTS AAC frame per audio PES. Every video
/// frame and audio frame carries its number, so a test can tell which came out.
final class TSTestStream: @unchecked Sendable {
    static let videoStep: UInt64 = 3600 // 25 fps
    static let audioStep: UInt64 = 1920 // 1024 samples at 48 kHz

    struct ExtraStream {
        var type: UInt8
        var pid: UInt16
        var descriptors: [UInt8] = []
    }

    var videoPID: UInt16 = 0x100
    var audioPID: UInt16 = 0x101
    var pmtPID: UInt16 = 0x1000
    /// PTS/DTS of frame 0; the audio clock starts there too.
    var base: UInt64 = 900_000
    /// A keyframe every `gop` frames.
    var gop = 25
    var videoType: UInt8 = 0x1B
    /// nil: no video stream in the PMT.
    var hasVideo = true
    /// nil: no audio stream.
    var audioType: UInt8? = 0x0F
    var audioLanguage: String?
    var audioDescriptors: [UInt8] = []
    /// Streams listed (in order) before the main audio in the PMT.
    var extraStreams: [ExtraStream] = []
    /// A second program in the PAT (listed after the first).
    var secondProgram = false
    var captions = false
    var scrambled = false
    var sps: [UInt8] = TSTestStream.baselineSPS
    /// Bytes of picture data per frame (keyframes are 4× larger).
    var frameSize = 600
    /// The byte that fills each frame: another value makes other pictures with the same timestamps (another encode).
    var filler: UInt8 = 0xA5
    /// Audio payload: ADTS AAC, or MPEG-1 Layer II frames.
    var mpegAudioLayer2 = false

    private var cc = [UInt8](repeating: 0, count: 8192)

    init(configure: (TSTestStream) -> Void = { _ in }) { configure(self) }

    /// A new connection: continuity counters start somewhere else.
    func restartCounters(at value: UInt8) { cc = [UInt8](repeating: value & 0x0F, count: 8192) }

    func videoDTS(_ frame: Int) -> UInt64 { (base &+ UInt64(frame) &* TSTestStream.videoStep) & MPEGTS.timestampMask }
    func videoPTS(_ frame: Int) -> UInt64 { (videoDTS(frame) &+ TSTestStream.videoStep) & MPEGTS.timestampMask }
    func audioPTS(_ k: Int) -> UInt64 { (base &+ UInt64(k) &* TSTestStream.audioStep) & MPEGTS.timestampMask }
    func isKey(_ frame: Int) -> Bool { frame % gop == 0 }

    /// Frames `range`: tables first and every 10 frames, then each frame's video PES and the audio PES due by the next frame.
    func frames(_ range: Range<Int>) -> Data {
        var out = Data()
        for n in range {
            if n == range.lowerBound || n % 10 == 0 { out.append(pat()); out.append(pmt()) }
            if hasVideo { out.append(video(n)) }
            if audioType != nil {
                for k in firstAudio(n)..<firstAudio(n + 1) { out.append(audio(k)) }
            }
        }
        return out
    }

    /// Index of the first audio PES whose time is at or after video frame `frame`'s time.
    func firstAudio(_ frame: Int) -> Int {
        Int((UInt64(frame) * TSTestStream.videoStep + TSTestStream.audioStep - 1) / TSTestStream.audioStep)
    }

    // MARK: tables

    func pat() -> Data {
        var body: [UInt8] = [0x00, 0x01, 0xC1, 0x00, 0x00, 0x00, 0x01, 0xE0 | UInt8(pmtPID >> 8), UInt8(pmtPID & 0xFF)]
        if secondProgram { body += [0x00, 0x02, 0xE0 | UInt8((pmtPID + 0x100) >> 8), UInt8((pmtPID + 0x100) & 0xFF)] }
        return section(pid: 0, tableID: 0x00, body: body)
    }

    func pmt() -> Data {
        let pcr = hasVideo ? videoPID : audioPID
        var body: [UInt8] = [0x00, 0x01, 0xC1, 0x00, 0x00, 0xE0 | UInt8(pcr >> 8), UInt8(pcr & 0xFF), 0xF0, 0x00]
        func entry(_ type: UInt8, _ pid: UInt16, _ descriptors: [UInt8]) {
            body += [type, 0xE0 | UInt8(pid >> 8), UInt8(pid & 0xFF), 0xF0 | UInt8(descriptors.count >> 8), UInt8(descriptors.count & 0xFF)] + descriptors
        }
        if hasVideo { entry(videoType, videoPID, []) }
        for extra in extraStreams { entry(extra.type, extra.pid, extra.descriptors) }
        if let audioType {
            var descriptors = audioDescriptors
            if let audioLanguage { descriptors += [0x0A, 0x04] + Array(audioLanguage.utf8) + [0x00] }
            entry(audioType, audioPID, descriptors)
        }
        return section(pid: pmtPID, tableID: 0x02, body: body)
    }

    static func languageDescriptor(_ code: String) -> [UInt8] { [0x0A, 0x04] + Array(code.utf8) + [0x00] }

    private func section(pid: UInt16, tableID: UInt8, body: [UInt8]) -> Data {
        let length = body.count + 4
        var section: [UInt8] = [tableID, 0xB0 | UInt8(length >> 8), UInt8(length & 0xFF)] + body
        let crc = MPEGTS.crc32(section)
        section += [UInt8(crc >> 24), UInt8((crc >> 16) & 0xFF), UInt8((crc >> 8) & 0xFF), UInt8(crc & 0xFF)]
        var packet = [UInt8](repeating: 0xFF, count: 188)
        packet[0] = 0x47
        packet[1] = 0x40 | UInt8(pid >> 8)
        packet[2] = UInt8(pid & 0xFF)
        packet[3] = 0x10 | next(pid)
        packet[4] = 0
        for (i, byte) in section.enumerated() { packet[5 + i] = byte }
        return Data(packet)
    }

    // MARK: media

    func video(_ frame: Int) -> Data {
        var es: [UInt8] = [0, 0, 0, 1, 0x09, 0xF0]
        if isKey(frame) {
            es += [0, 0, 0, 1] + sps + [0, 0, 0, 1] + TSTestStream.pps
            if captions { es += [0, 0, 0, 1] + TSTestStream.captionSEI }
        }
        es += [0, 0, 0, 1] + TSTestStream.slice(frame: frame, key: isKey(frame))
        es += TSTestStream.marker(frame)
        let size = isKey(frame) ? frameSize * 4 : frameSize
        if es.count < size { es += [UInt8](repeating: filler, count: size - es.count) }
        let pes = TSTestStream.pes(streamID: 0xE0, payload: es, pts: videoPTS(frame), dts: videoDTS(frame), bounded: false)
        let pcr = (videoDTS(frame) &- 9000) & MPEGTS.timestampMask
        return packetize(pid: videoPID, pes: pes, pcr: pcr, randomAccess: isKey(frame))
    }

    func audio(_ k: Int) -> Data {
        let payload = mpegAudioLayer2 ? TSTestStream.mpegFrame(k) : TSTestStream.adts(k)
        let pes = TSTestStream.pes(streamID: 0xC0, payload: payload, pts: audioPTS(k), dts: nil, bounded: true)
        return packetize(pid: audioPID, pes: pes, pcr: hasVideo ? nil : audioPTS(k), randomAccess: false)
    }

    func packetize(pid: UInt16, pes: [UInt8], pcr: UInt64?, randomAccess: Bool) -> Data {
        var out = Data()
        var i = 0
        var first = true
        while i < pes.count {
            let withPCR = first && pcr != nil
            let withRAI = first && randomAccess
            let capacity = 184 - (withPCR ? 8 : withRAI ? 2 : 0)
            let count = min(capacity, pes.count - i)
            var packet = [UInt8](repeating: 0, count: 188)
            packet[0] = 0x47
            packet[1] = (first ? 0x40 : 0) | UInt8(pid >> 8)
            packet[2] = UInt8(pid & 0xFF)
            let adaptation = withPCR || withRAI || count < 184
            packet[3] = (adaptation ? 0x30 : 0x10) | next(pid) | (scrambled ? 0x80 : 0)
            if adaptation {
                let length = 183 - count
                packet[4] = UInt8(length)
                if length > 0 {
                    packet[5] = (withRAI ? 0x40 : 0) | (withPCR ? 0x10 : 0)
                    var j = 6
                    if withPCR, let pcr {
                        packet[6] = UInt8((pcr >> 25) & 0xFF); packet[7] = UInt8((pcr >> 17) & 0xFF); packet[8] = UInt8((pcr >> 9) & 0xFF)
                        packet[9] = UInt8((pcr >> 1) & 0xFF); packet[10] = UInt8(((pcr & 1) << 7) | 0x7E); packet[11] = 0
                        j = 12
                    }
                    while j < 5 + length { packet[j] = 0xFF; j += 1 }
                }
            }
            for k in 0..<count { packet[188 - count + k] = pes[i + k] }
            out.append(contentsOf: packet)
            i += count
            first = false
        }
        return out
    }

    private func next(_ pid: UInt16) -> UInt8 {
        let value = cc[Int(pid)]
        cc[Int(pid)] = (value + 1) & 0x0F
        return value
    }

    // MARK: elementary streams

    static func pes(streamID: UInt8, payload: [UInt8], pts: UInt64, dts: UInt64?, bounded: Bool) -> [UInt8] {
        let headerData = dts != nil ? 10 : 5
        var out = [UInt8](repeating: 0, count: 9 + headerData)
        out[2] = 1
        out[3] = streamID
        let length = bounded ? 3 + headerData + payload.count : 0
        out[4] = UInt8((length >> 8) & 0xFF); out[5] = UInt8(length & 0xFF)
        out[6] = 0x84
        out[7] = dts != nil ? 0xC0 : 0x80
        out[8] = UInt8(headerData)
        writeStamp(&out, 9, pts, prefix: dts != nil ? 0x30 : 0x20)
        if let dts { writeStamp(&out, 14, dts, prefix: 0x10) }
        return out + payload
    }

    static func writeStamp(_ b: inout [UInt8], _ at: Int, _ value: UInt64, prefix: UInt8) {
        b[at] = prefix | UInt8(((value >> 30) & 0x07) << 1) | 1
        b[at + 1] = UInt8((value >> 22) & 0xFF)
        b[at + 2] = UInt8(((value >> 15) & 0x7F) << 1) | 1
        b[at + 3] = UInt8((value >> 7) & 0xFF)
        b[at + 4] = UInt8((value & 0x7F) << 1) | 1
    }

    /// Frame number marker: no 00 00 0x byte pattern can appear in it.
    static func marker(_ frame: Int) -> [UInt8] {
        [0xFF, 0xFE, UInt8(0x80 | ((frame >> 14) & 0x7F)), UInt8(0x80 | ((frame >> 7) & 0x7F)), UInt8(0x80 | (frame & 0x7F))]
    }

    static let audioPayload = 300

    static func adts(_ k: Int) -> [UInt8] {
        let length = 7 + audioPayload
        var frame = [UInt8](repeating: 0x5A, count: length)
        frame[0] = 0xFF
        frame[1] = 0xF1
        frame[2] = (1 << 6) | (3 << 2)
        frame[3] = (2 << 6) | UInt8((length >> 11) & 0x03)
        frame[4] = UInt8((length >> 3) & 0xFF)
        frame[5] = UInt8(((length & 0x07) << 5) | 0x1F)
        frame[6] = 0xFC
        frame[7] = UInt8(0x80 | ((k >> 14) & 0x7F))
        frame[8] = UInt8(0x80 | ((k >> 7) & 0x7F))
        frame[9] = UInt8(0x80 | (k & 0x7F))
        return frame
    }

    /// An MPEG-1 Layer II frame header (no CRC) and filler.
    static func mpegFrame(_ k: Int) -> [UInt8] {
        var frame = [UInt8](repeating: 0x33, count: 200)
        frame[0] = 0xFF; frame[1] = 0xFD; frame[2] = 0x94; frame[3] = 0x44
        frame[7] = UInt8(0x80 | ((k >> 14) & 0x7F)); frame[8] = UInt8(0x80 | ((k >> 7) & 0x7F)); frame[9] = UInt8(0x80 | (k & 0x7F))
        return frame
    }

    static func slice(frame: Int, key: Bool) -> [UInt8] {
        var bits = BitWriter()
        bits.u(8, key ? 0x65 : 0x41)
        bits.ue(0)
        bits.ue(key ? 7 : 5)
        bits.ue(0)
        bits.u(4, frame & 0x0F)
        if key { bits.ue(0) }
        bits.u(1, 1)
        return escape(bits.bytes())
    }

    /// Baseline 320x240: poc type 2, 4-bit frame_num.
    static let baselineSPS: [UInt8] = {
        var bits = BitWriter()
        bits.u(8, 0x67); bits.u(8, 66); bits.u(8, 0xC0); bits.u(8, 30)
        bits.ue(0); bits.ue(0); bits.ue(2); bits.ue(1); bits.u(1, 0); bits.ue(19); bits.ue(14); bits.u(1, 1); bits.u(1, 1); bits.u(1, 0); bits.u(1, 0)
        bits.trailing()
        return escape(bits.bytes())
    }()

    /// High profile 1920x1080 (1088 coded, 8 lines cropped), level 4.0.
    static let highSPS: [UInt8] = {
        var bits = BitWriter()
        bits.u(8, 0x67); bits.u(8, 100); bits.u(8, 0x00); bits.u(8, 40)
        bits.ue(0)
        bits.ue(1); bits.ue(0); bits.ue(0); bits.u(1, 0); bits.u(1, 0) // chroma 4:2:0, 8-bit, no scaling matrices
        bits.ue(0); bits.ue(0); bits.ue(0) // log2_max_frame_num, poc type 0, log2_max_poc_lsb
        bits.ue(4); bits.u(1, 0); bits.ue(119); bits.ue(67); bits.u(1, 1); bits.u(1, 1)
        bits.u(1, 1); bits.ue(0); bits.ue(0); bits.ue(0); bits.ue(4) // cropping: bottom 4 (×2 lines)
        bits.u(1, 0)
        bits.trailing()
        return escape(bits.bytes())
    }()

    static let pps: [UInt8] = {
        var bits = BitWriter()
        bits.u(8, 0x68); bits.ue(0); bits.ue(0); bits.u(1, 0); bits.u(1, 0); bits.ue(0); bits.ue(0); bits.ue(0); bits.u(1, 0); bits.u(2, 0)
        bits.se(0); bits.se(0); bits.se(0); bits.u(1, 1); bits.u(1, 0); bits.u(1, 0)
        bits.trailing()
        return escape(bits.bytes())
    }()

    /// SEI with ATSC A/53 CEA-608 caption data (user_data_registered_itu_t_t35, "GA94").
    static let captionSEI: [UInt8] = {
        let payload: [UInt8] = [0xB5, 0x00, 0x31, 0x47, 0x41, 0x39, 0x34, 0x03, 0x42, 0xFF, 0xFC, 0x94, 0x2C, 0xFD, 0x80, 0x80, 0xFF]
        return escape([0x06, 0x04, UInt8(payload.count)] + payload + [0x80])
    }()

    static func escape(_ rbsp: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        var zeros = 0
        for byte in rbsp {
            if zeros >= 2 && byte <= 3 { out.append(3); zeros = 0 }
            out.append(byte)
            zeros = byte == 0 ? zeros + 1 : 0
        }
        return out
    }

    struct BitWriter {
        private var out: [UInt8] = []
        private var current = 0
        private var count = 0
        mutating func u(_ n: Int, _ value: Int) { for i in stride(from: n - 1, through: 0, by: -1) { bit((value >> i) & 1) } }
        mutating func ue(_ value: Int) {
            let x = value + 1
            let length = Int.bitWidth - x.leadingZeroBitCount
            for _ in 0..<(length - 1) { bit(0) }
            u(length, x)
        }
        mutating func se(_ value: Int) { ue(value > 0 ? 2 * value - 1 : -2 * value) }
        mutating func trailing() { bit(1); while count != 0 { bit(0) } }
        func bytes() -> [UInt8] { count > 0 ? out + [UInt8(current << (8 - count))] : out }
        private mutating func bit(_ b: Int) {
            current = (current << 1) | b
            count += 1
            if count == 8 { out.append(UInt8(current)); current = 0; count = 0 }
        }
    }
}

/// What a player would make of segmenter output: tables, continuity, PES timestamps and the numbered frames.
struct TSAnalysis {
    struct PES { let pid: UInt16; let pts: UInt64?; let dts: UInt64?; let number: Int?; let key: Bool; let bytes: Int }

    var problems: [String] = []
    var pmtPID: UInt16?
    var programs: [(number: UInt16, pid: UInt16)] = []
    var streams: [(type: UInt8, pid: UInt16, language: String?)] = []
    var pcrPID: UInt16?
    var pes: [PES] = []
    var packetCount = 0

    init(_ data: Data, checkContinuity: Bool = true) {
        let bytes = [UInt8](data)
        if bytes.count % 188 != 0 { problems.append("\(bytes.count) bytes is not whole packets") }
        packetCount = bytes.count / 188
        var lastCC: [UInt16: UInt8] = [:]
        var open: [UInt16: (pts: UInt64?, dts: UInt64?, data: [UInt8])] = [:]
        func finish(_ pid: UInt16) {
            guard let current = open.removeValue(forKey: pid) else { return }
            let payload = current.data
            var number: Int?
            if let m = TSAnalysis.find([0xFF, 0xFE], in: payload), m + 4 < payload.count {
                number = Int(payload[m + 2] & 0x7F) << 14 | Int(payload[m + 3] & 0x7F) << 7 | Int(payload[m + 4] & 0x7F)
            } else if payload.count > 10, payload[0] == 0xFF {
                number = Int(payload[7] & 0x7F) << 14 | Int(payload[8] & 0x7F) << 7 | Int(payload[9] & 0x7F)
            }
            let key = TSAnalysis.find([0, 0, 1, 0x65], in: payload) != nil
            pes.append(PES(pid: pid, pts: current.pts, dts: current.dts, number: number, key: key, bytes: payload.count))
        }
        for index in 0..<packetCount {
            let p = Array(bytes[(index * 188)..<(index * 188 + 188)])
            guard p[0] == 0x47 else { problems.append("packet \(index) has no sync byte"); continue }
            let pid = UInt16(p[1] & 0x1F) << 8 | UInt16(p[2])
            let pusi = p[1] & 0x40 != 0
            let control = (p[3] >> 4) & 3
            let cc = p[3] & 0x0F
            if control & 1 != 0 {
                if checkContinuity, let previous = lastCC[pid], cc != (previous + 1) & 0x0F {
                    problems.append("PID \(pid) continuity \(previous) -> \(cc) at packet \(index)")
                }
                lastCC[pid] = cc
            }
            var at = 4
            if control & 2 != 0 { at = 5 + Int(p[4]) }
            guard control & 1 != 0, at < 188 else { continue }
            let payload = Array(p[at...])
            if pid == 0 {
                if pusi { parsePAT(payload) }
                continue
            }
            if pid == pmtPID {
                if pusi { parsePMT(payload) }
                continue
            }
            if pusi {
                finish(pid)
                guard payload.count >= 9, payload[0] == 0, payload[1] == 0, payload[2] == 1 else { problems.append("bad PES start on \(pid)"); continue }
                let flags = payload[7] >> 6
                let pts = flags & 2 != 0 ? MPEGTS.readTimestamp(payload, 9) : nil
                let dts = flags == 3 ? MPEGTS.readTimestamp(payload, 14) : nil
                let start = 9 + Int(payload[8])
                open[pid] = (pts, dts, Array(payload[min(start, payload.count)...]))
            } else if open[pid] != nil {
                open[pid]?.data.append(contentsOf: payload)
            }
        }
        for pid in Array(open.keys) { finish(pid) }
    }

    private mutating func parsePAT(_ payload: [UInt8]) {
        let start = 1 + Int(payload[0])
        let length = Int(payload[start + 1] & 0x0F) << 8 | Int(payload[start + 2])
        let section = Array(payload[start..<(start + 3 + length)])
        if MPEGTS.crc32(section) != 0 { problems.append("PAT CRC") }
        programs = []
        var i = 8
        while i + 4 <= section.count - 4 {
            let number = UInt16(section[i]) << 8 | UInt16(section[i + 1])
            let pid = UInt16(section[i + 2] & 0x1F) << 8 | UInt16(section[i + 3])
            programs.append((number, pid))
            if number != 0 && pmtPID == nil { pmtPID = pid }
            i += 4
        }
    }

    private mutating func parsePMT(_ payload: [UInt8]) {
        let start = 1 + Int(payload[0])
        let length = Int(payload[start + 1] & 0x0F) << 8 | Int(payload[start + 2])
        let section = Array(payload[start..<(start + 3 + length)])
        if MPEGTS.crc32(section) != 0 { problems.append("PMT CRC") }
        pcrPID = UInt16(section[8] & 0x1F) << 8 | UInt16(section[9])
        let infoLength = Int(section[10] & 0x0F) << 8 | Int(section[11])
        var i = 12 + infoLength
        var found: [(type: UInt8, pid: UInt16, language: String?)] = []
        while i + 5 <= section.count - 4 {
            let type = section[i]
            let pid = UInt16(section[i + 1] & 0x1F) << 8 | UInt16(section[i + 2])
            let esLength = Int(section[i + 3] & 0x0F) << 8 | Int(section[i + 4])
            var language: String?
            let descriptors = Array(section[(i + 5)..<(i + 5 + esLength)])
            if descriptors.count >= 5, descriptors[0] == 0x0A { language = String(decoding: descriptors[2..<5], as: UTF8.self) }
            found.append((type, pid, language))
            i += 5 + esLength
        }
        streams = found
    }

    static func find(_ needle: [UInt8], in haystack: [UInt8]) -> Int? {
        guard haystack.count >= needle.count else { return nil }
        outer: for i in 0...(haystack.count - needle.count) {
            for j in needle.indices where haystack[i + j] != needle[j] { continue outer }
            return i
        }
        return nil
    }

    func numbers(_ pid: UInt16) -> [Int] { pes.filter { $0.pid == pid }.compactMap(\.number) }
}

extension Array where Element == SegmenterOutput {
    var segments: [TSSegment] { compactMap { if case .segment(let segment) = $0 { return segment }; return nil } }
    var infos: [StreamInfo] { compactMap { if case .streamInfo(let info) = $0 { return info }; return nil } }
    var unsupported: [UnsupportedFormat] { compactMap { if case .unsupported(let format) = $0 { return format }; return nil } }
}
