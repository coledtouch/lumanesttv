import Foundation
import XCTest
@testable import TunerCore

final class MPEGTSTests: XCTestCase {
    func testCRC32() {
        XCTAssertEqual(MPEGTS.crc32([UInt8]()), 0xFFFF_FFFF)
        XCTAssertEqual(MPEGTS.crc32(Array("123456789".utf8)), 0x0376_E6E7, "CRC-32/MPEG-2 check value")
        // A section followed by its CRC sums to zero.
        let pat = [UInt8](TSTestStream().pat())
        let length = Int(pat[6] & 0x0F) << 8 | Int(pat[7])
        XCTAssertEqual(MPEGTS.crc32(pat[5..<(8 + length)]), 0)
    }

    func testSniffing() {
        let stream = TSTestStream()
        XCTAssertEqual(MPEGTS.sniff(stream.frames(0..<2)), .transportStream)
        var offset = Data([1, 2, 3])
        offset.append(stream.frames(0..<2))
        XCTAssertEqual(MPEGTS.sniff(offset), .transportStream, "sync found at an offset")
        XCTAssertEqual(MPEGTS.sniff(Data("#EXTM3U\n#EXT-X-VERSION:3\n".utf8)), .hlsPlaylist)
        XCTAssertEqual(MPEGTS.sniff(Data([0xEF, 0xBB, 0xBF]) + Data("\n  #EXTM3U".utf8)), .hlsPlaylist)
        XCTAssertEqual(MPEGTS.sniff(Data("<!DOCTYPE html><html><body>Not found</body></html>".utf8)), .html)
        XCTAssertEqual(MPEGTS.sniff(Data("CONNECTION LIMIT".utf8)), .unknown)
        XCTAssertEqual(MPEGTS.sniff(Data([0x47] + [UInt8](repeating: 0, count: 300))), .unknown, "one sync byte is not enough")
    }
}

final class H264Tests: XCTestCase {
    func testNALUnits() {
        let annexB = Data([0, 0, 0, 1, 0x09, 0xF0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x65, 9])
        XCTAssertEqual(H264.nalUnits(in: annexB), [4..<6, 9..<12, 16..<18])
        let sliced = annexB.dropFirst(4)
        XCTAssertEqual(H264.nalUnits(in: Data(sliced)).count, 2)
        XCTAssertEqual(H264.nalUnits(in: Data()), [])
    }

    func testCodecStringsAndDimensions() throws {
        XCTAssertEqual(H264.codecString(sps: Data(TSTestStream.baselineSPS)), "avc1.42C01E")
        let baseline = try XCTUnwrap(H264.dimensions(sps: Data(TSTestStream.baselineSPS)))
        XCTAssertEqual(baseline.width, 320)
        XCTAssertEqual(baseline.height, 240)
        XCTAssertEqual(H264.codecString(sps: Data(TSTestStream.highSPS)), "avc1.640028")
        let high = try XCTUnwrap(H264.dimensions(sps: Data(TSTestStream.highSPS)))
        XCTAssertEqual(high.width, 1920)
        XCTAssertEqual(high.height, 1080)
        XCTAssertNil(H264.codecString(sps: Data([0x68, 1, 2, 3])), "not an SPS")
        XCTAssertNil(H264.dimensions(sps: Data([0x67, 66])))
    }

    func testCaptionsAndRecoveryPoints() {
        XCTAssertTrue(H264.hasCEA608(sei: Data(TSTestStream.captionSEI)))
        XCTAssertFalse(H264.hasCEA608(sei: Data([0x06, 0x05, 0x02, 0xAA, 0xBB, 0x80])))
        // 708-only data (cc_type 2) is not CEA-608.
        let only708: [UInt8] = [0xB5, 0x00, 0x31, 0x47, 0x41, 0x39, 0x34, 0x03, 0x41, 0xFF, 0xFE, 0x10, 0x20, 0xFF]
        XCTAssertFalse(H264.hasCEA608(sei: Data([0x06, 0x04, UInt8(only708.count)] + only708 + [0x80])))
        XCTAssertTrue(H264.hasRecoveryPoint(sei: Data([0x06, 0x06, 0x01, 0x84, 0x80])))
        XCTAssertFalse(H264.hasRecoveryPoint(sei: Data(TSTestStream.captionSEI)))
        XCTAssertEqual(H264.sliceType(TSTestStream.slice(frame: 0, key: true)), 7)
        XCTAssertEqual(H264.sliceType(TSTestStream.slice(frame: 3, key: false)), 5)
    }
}

final class SegmenterTests: XCTestCase {
    private func run(_ data: Data, config: SegmenterConfig = SegmenterConfig(), chunk: Int? = nil) -> (outputs: [SegmenterOutput], segmenter: TSSegmenter) {
        var segmenter = TSSegmenter(config: config)
        var outputs: [SegmenterOutput] = []
        if let chunk {
            var offset = 0
            while offset < data.count {
                outputs += segmenter.push(data.subdata(in: offset..<min(data.count, offset + chunk)))
                offset += chunk
            }
        } else {
            outputs += segmenter.push(data)
        }
        return (outputs, segmenter)
    }

    private func joined(_ segments: [TSSegment]) -> Data { segments.reduce(into: Data()) { $0.append($1.data) } }

    func testKeyframeAlignedSegmentsWithFreshTables() throws {
        let stream = TSTestStream() // 25 fps, a keyframe every second
        let result = run(stream.frames(0..<300))
        let segments = result.outputs.segments
        XCTAssertEqual(segments.map(\.duration), [1, 2, 2, 2, 2, 2], "1 s first, then the first keyframe 2 s on")
        XCTAssertEqual(segments.map(\.sequence), [0, 1, 2, 3, 4, 5])
        XCTAssertEqual(segments.map(\.firstPTS), [0, 25, 75, 125, 175, 225].map { stream.videoPTS($0) })
        XCTAssertTrue(segments.allSatisfy { !$0.discontinuity })
        for segment in segments {
            let analysis = TSAnalysis(segment.data, checkContinuity: false)
            XCTAssertEqual(analysis.problems, [])
            XCTAssertEqual(Array(segment.data.prefix(4)), [0x47, 0x40, 0x00, segment.data[3]], "a PAT first")
            XCTAssertEqual(analysis.programs.map(\.pid), [0x1000])
            XCTAssertEqual(analysis.streams.map(\.pid), [0x100, 0x101])
            let video = analysis.pes.filter { $0.pid == 0x100 }
            XCTAssertTrue(video.first?.key ?? false, "every segment starts at a keyframe")
        }
        // The segmenter numbers every packet itself: continuity holds across segment boundaries.
        let whole = TSAnalysis(joined(segments))
        XCTAssertEqual(whole.problems, [])
        XCTAssertEqual(whole.numbers(0x100), Array(0..<275), "every frame up to the open segment, once, in order")
        let audio = whole.numbers(0x101)
        XCTAssertEqual(audio, Array(audio.first!...audio.last!), "audio continuous")
        // Info comes before the first segment.
        guard case .streamInfo(let info) = result.outputs.first else { return XCTFail("expected stream info first") }
        XCTAssertEqual(info.codecs, "avc1.42C01E,mp4a.40.2")
        XCTAssertEqual(info.width, 320)
        XCTAssertEqual(info.height, 240)
        XCTAssertFalse(info.hasCEA608)
        XCTAssertEqual(info.audioStreams.map(\.pid), [0x101])
        XCTAssertEqual(result.segmenter.streamInfo, info)
        XCTAssertEqual(result.segmenter.programMap?.pmtPID, 0x1000)
        XCTAssertEqual(result.segmenter.programMap?.streams.map(\.kind), [.h264, .aacADTS])
    }

    func testFlushClosesTheOpenSegment() {
        var segmenter = TSSegmenter()
        let stream = TSTestStream()
        let first = segmenter.push(stream.frames(0..<60)).segments
        XCTAssertEqual(first.map(\.duration), [1])
        let flushed = segmenter.flush().segments
        XCTAssertEqual(flushed.count, 1)
        XCTAssertEqual(flushed[0].duration, 35.0 / 25.0, accuracy: 0.0001, "frames 25...59 plus one frame")
        XCTAssertEqual(segmenter.flush().segments, [], "nothing left")
    }

    func testByteByByteAndOddChunksGiveTheSameOutput() {
        let data = TSTestStream().frames(0..<130)
        let whole = run(data).outputs.segments
        XCTAssertEqual(whole.count, 3)
        for chunk in [1, 7, 187, 189, 1000] {
            XCTAssertEqual(run(data, chunk: chunk).outputs.segments, whole, "chunk \(chunk)")
        }
    }

    func testResyncsAfterGarbageAndDropsBrokenAndRepeatedPackets() {
        let stream = TSTestStream()
        var data = Data(repeating: 0x00, count: 377) // leading junk
        data.append(stream.frames(0..<40))
        data.append(Data(repeating: 0x00, count: 50)) // junk between packets
        let middle = stream.frames(40..<80)
        // Repeat one packet (same continuity counter): a legal duplicate that must not be sent twice.
        data.append(middle.prefix(188))
        data.append(middle)
        var broken = [UInt8](stream.frames(80..<81))
        for p in stride(from: 0, to: broken.count, by: 188) { broken[p + 1] |= 0x80 } // transport_error_indicator
        data.append(contentsOf: broken)
        data.append(stream.frames(81..<130))
        let segments = run(data).outputs.segments
        XCTAssertEqual(segments.map(\.duration), [1, 2, 2])
        let analysis = TSAnalysis(joined(segments))
        XCTAssertEqual(analysis.problems, [])
        let video = analysis.numbers(0x100)
        XCTAssertEqual(video, Array(0..<80) + Array(81..<125), "frame 80's packets were all flagged as errors")
    }

    func testForcedCutsForLongGOPs() {
        let stream = TSTestStream { $0.gop = 250 } // a keyframe every 10 s
        let segments = run(stream.frames(0..<800)).outputs.segments
        XCTAssertEqual(segments.map(\.duration), [6, 4, 6, 4, 6, 4], "EXTINF never exceeds the target duration")
        XCTAssertTrue(segments.allSatisfy { $0.duration <= 6 })
    }

    /// Data lost upstream makes the timestamps jump forward. No EXTINF may round above the target duration (12 s for
    /// live sessions): a jump that would stretch the open segment past it ends the segment at its last picture and
    /// starts a new timeline at the next keyframe; a smaller jump stays inside the segment.
    func testForwardJumpsNeverStretchASegmentPastTheTargetDuration() {
        let stream = TSTestStream { $0.gop = 250 } // a keyframe every 10 s
        var data = stream.frames(0..<140)          // 5.6 s
        data.append(stream.frames(340..<700))      // 8 s missing: frame 340 would make the open segment 13.6 s long
        var segmenter = TSSegmenter()
        var segments = segmenter.push(data).segments
        segments += segmenter.flush().segments
        XCTAssertEqual(segments.first?.duration ?? 0, 5.6, accuracy: 0.001, "ended at its last picture")
        XCTAssertEqual(segments.filter(\.discontinuity).map(\.firstPTS), [stream.videoPTS(500)], "a new timeline from the next keyframe")
        XCTAssertTrue(segments.allSatisfy { $0.duration.rounded() <= 12 }, "\(segments.map(\.duration))")

        let small = TSTestStream { $0.gop = 250 }
        var smallData = small.frames(0..<140)
        smallData.append(small.frames(260..<400)) // 4.8 s missing: the segment ends at 10.4 s
        let smallSegments = run(smallData).outputs.segments
        XCTAssertEqual(smallSegments.first?.duration ?? 0, 10.4, accuracy: 0.001)
        XCTAssertTrue(smallSegments.allSatisfy { !$0.discontinuity })
        XCTAssertTrue(smallSegments.allSatisfy { $0.duration.rounded() <= 12 })
    }

    func testDurationsAcrossThePTSWrap() {
        let stream = TSTestStream { $0.base = (1 << 33) - 90_000 * 3 / 2 }
        let segments = run(stream.frames(0..<300)).outputs.segments
        XCTAssertEqual(segments.map(\.duration), [1, 2, 2, 2, 2, 2])
        XCTAssertLessThan(segments[2].firstPTS, segments[1].firstPTS, "the clock wrapped between them")
        XCTAssertTrue(segments.allSatisfy { !$0.discontinuity })
    }

    func testProgramMapIsRewrittenToVideoAndOnePreferredAudio() {
        let stream = TSTestStream {
            $0.audioLanguage = "eng"
            $0.extraStreams = [.init(type: 0x0F, pid: 0x102, descriptors: TSTestStream.languageDescriptor("spa")),
                               .init(type: 0x06, pid: 0x103, descriptors: [0x6A, 0x01, 0x00] + TSTestStream.languageDescriptor("fre")),
                               .init(type: 0x06, pid: 0x104, descriptors: [0x59, 0x00]),
                               .init(type: 0x15, pid: 0x105)]
            $0.secondProgram = true
        }
        let result = run(stream.frames(0..<60))
        let segment = result.outputs.segments[0]
        let analysis = TSAnalysis(segment.data, checkContinuity: false)
        XCTAssertEqual(analysis.programs.count, 1, "only the first program")
        XCTAssertEqual(analysis.streams.map(\.pid), [0x100, 0x101], "video and the English audio")
        XCTAssertEqual(analysis.streams.last?.language, "eng")
        XCTAssertEqual(analysis.pcrPID, 0x100)
        XCTAssertTrue(analysis.pes.allSatisfy { $0.pid == 0x100 || $0.pid == 0x101 })
        let info = result.outputs.infos[0]
        XCTAssertEqual(info.audio?.pid, 0x101)
        XCTAssertEqual(info.audioStreams.map(\.pid), [0x102, 0x103, 0x101])
        XCTAssertEqual(info.audioStreams.map(\.kind), [.aacADTS, .ac3, .aacADTS])
        XCTAssertEqual(info.audioStreams.map(\.language), ["spa", "fre", "eng"])
    }

    func testDVBAC3IsRetypedAndTheFirstAudioWinsWithoutALanguageMatch() {
        let stream = TSTestStream {
            $0.audioType = 0x06
            $0.audioDescriptors = [0x7A, 0x01, 0x00] // E-AC-3 descriptor
            $0.audioLanguage = "deu"
        }
        let result = run(stream.frames(0..<60))
        let analysis = TSAnalysis(result.outputs.segments[0].data, checkContinuity: false)
        XCTAssertEqual(analysis.streams.map(\.type), [0x1B, 0x87])
        XCTAssertEqual(result.outputs.infos[0].codecs, "avc1.42C01E,ec-3")
        XCTAssertEqual(result.outputs.infos[0].audio?.kind, .eac3)

        let ac3 = TSTestStream { $0.audioType = 0x06; $0.audioDescriptors = [0x05, 0x04] + Array("AC-3".utf8) }
        let ac3Result = run(ac3.frames(0..<60))
        XCTAssertEqual(TSAnalysis(ac3Result.outputs.segments[0].data, checkContinuity: false).streams.map(\.type), [0x1B, 0x81])
        XCTAssertEqual(ac3Result.outputs.infos[0].audioCodec, "ac-3")
    }

    func testUnsupportedPrograms() {
        XCTAssertEqual(run(TSTestStream { $0.videoType = 0x24 }.frames(0..<10)).outputs.unsupported, [.hevcVideo])
        XCTAssertEqual(run(TSTestStream { $0.videoType = 0x02 }.frames(0..<10)).outputs.unsupported, [.mpeg2Video])
        let dataOnly = TSTestStream { $0.hasVideo = false; $0.audioType = nil; $0.extraStreams = [.init(type: 0x06, pid: 0x200)] }
        XCTAssertEqual(run(dataOnly.frames(0..<30)).outputs.unsupported, [.noPlayableStreams])
        let scrambled = TSTestStream { $0.scrambled = true }
        let result = run(scrambled.frames(0..<60))
        XCTAssertEqual(result.outputs.unsupported, [.scrambled])
        XCTAssertEqual(result.outputs.segments, [])
        XCTAssertEqual(UnsupportedFormat.hevcVideo.message, "This channel uses a video format Apple TV can't play from your provider.")
        XCTAssertEqual(UnsupportedFormat.scrambled.message, "This channel is scrambled by your provider.")
        // A stopped segmenter ignores further input.
        var segmenter = TSSegmenter()
        _ = segmenter.push(TSTestStream { $0.videoType = 0x24 }.frames(0..<10))
        XCTAssertEqual(segmenter.push(TSTestStream().frames(0..<100)), [])
    }

    func testMPEGAudioLayerTwoIsKeptOrLeftOut() {
        let stream = TSTestStream { $0.audioType = 0x03; $0.mpegAudioLayer2 = true }
        let kept = run(stream.frames(0..<60))
        XCTAssertEqual(kept.outputs.infos[0].audioCodec, "mp4a.40.33", "layer read from the first frame header")
        XCTAssertFalse(kept.outputs.infos[0].audioDropped)
        XCTAssertEqual(TSAnalysis(kept.outputs.segments[0].data, checkContinuity: false).streams.count, 2)

        var config = SegmenterConfig()
        config.dropMPEGAudioLayer2 = true
        let dropped = run(TSTestStream { $0.audioType = 0x03; $0.mpegAudioLayer2 = true }.frames(0..<60), config: config)
        let info = dropped.outputs.infos[0]
        XCTAssertTrue(info.audioDropped)
        XCTAssertNil(info.audio)
        XCTAssertEqual(info.codecs, "avc1.42C01E")
        let analysis = TSAnalysis(dropped.outputs.segments[0].data, checkContinuity: false)
        XCTAssertEqual(analysis.streams.map(\.pid), [0x100])
        XCTAssertTrue(analysis.pes.allSatisfy { $0.pid == 0x100 })
    }

    func testCEA608CaptionsAreDetected() {
        let result = run(TSTestStream { $0.captions = true; $0.sps = TSTestStream.highSPS }.frames(0..<60))
        let info = result.outputs.infos[0]
        XCTAssertTrue(info.hasCEA608)
        XCTAssertEqual(info.width, 1920)
        XCTAssertEqual(info.height, 1080)
        XCTAssertEqual(info.videoCodec, "avc1.640028")
    }

    func testAudioOnlyProgramsCutAtAudioPES() {
        let stream = TSTestStream { $0.hasVideo = false }
        var data = Data()
        data.append(stream.pat())
        data.append(stream.pmt())
        for k in 0..<400 { data.append(stream.audio(k)) }
        let segments = run(data).outputs.segments
        XCTAssertGreaterThanOrEqual(segments.count, 3)
        XCTAssertEqual(segments[0].duration, 1, accuracy: 0.03)
        XCTAssertTrue(segments.dropFirst().allSatisfy { abs($0.duration - 2) < 0.03 })
        let analysis = TSAnalysis(joined(segments))
        XCTAssertEqual(analysis.problems, [])
        XCTAssertEqual(analysis.numbers(0x101), Array(0..<analysis.numbers(0x101).count))
    }

    func testAnotherProgramMidStreamStartsANewTimeline() {
        let first = TSTestStream()
        var data = first.frames(0..<130)
        let second = TSTestStream { $0.videoPID = 0x200; $0.audioPID = 0x201; $0.base = 50_000_000 }
        data.append(second.frames(0..<130))
        let segments = run(data).outputs.segments
        XCTAssertEqual(segments.filter(\.discontinuity).count, 1)
        let index = segments.firstIndex(where: \.discontinuity)!
        XCTAssertEqual(segments[index].firstPTS, second.videoPTS(0))
        XCTAssertEqual(TSAnalysis(segments[index].data, checkContinuity: false).streams.map(\.pid), [0x200, 0x201])
    }

    // MARK: reconnects (splicing a new connection onto the old one)

    private func reconnect(firstFrames: Range<Int>, replay: Range<Int>, configure: (TSTestStream) -> Void = { _ in })
        -> (before: [TSSegment], after: [TSSegment], segmenter: TSSegmenter) {
        var segmenter = TSSegmenter()
        let stream = TSTestStream()
        let before = segmenter.push(stream.frames(firstFrames)).segments
        segmenter.reconnect()
        XCTAssertTrue(segmenter.isPlacing)
        let again = TSTestStream(configure: configure)
        again.restartCounters(at: 9)
        var after = segmenter.push(again.frames(replay)).segments
        after += segmenter.flush().segments
        return (before, after, segmenter)
    }

    func testReconnectThatOverlapsIsSeamless() {
        let result = reconnect(firstFrames: 0..<100, replay: 50..<200)
        XCTAssertFalse(result.segmenter.isPlacing)
        XCTAssertFalse(result.segmenter.lastPlacementWasDiscontinuity)
        let all = result.before + result.after
        XCTAssertTrue(all.allSatisfy { !$0.discontinuity })
        let analysis = TSAnalysis(joined(all))
        XCTAssertEqual(analysis.problems, [], "the segmenter's own counters hide the new connection's")
        XCTAssertEqual(analysis.numbers(0x100), Array(0..<200), "replayed frames are dropped, nothing is lost")
        let dts = analysis.pes.filter { $0.pid == 0x100 }.compactMap(\.dts)
        XCTAssertEqual(dts, dts.sorted())
        let audio = analysis.numbers(0x101)
        XCTAssertEqual(audio, Array(audio.first!...audio.last!), "audio continues without repeats")
    }

    func testReconnectWithASmallGapIsSeamlessFromTheNextKeyframe() {
        let result = reconnect(firstFrames: 0..<100, replay: 110..<200)
        XCTAssertFalse(result.segmenter.lastPlacementWasDiscontinuity)
        let all = result.before + result.after
        XCTAssertTrue(all.allSatisfy { !$0.discontinuity })
        let analysis = TSAnalysis(joined(all))
        XCTAssertEqual(analysis.numbers(0x100), Array(0..<100) + Array(125..<200), "joined at the new connection's first keyframe")
        XCTAssertEqual(result.after.first?.firstPTS, TSTestStream().videoPTS(75), "the segment open at the reconnect closes at the join")
        XCTAssertEqual(result.after.dropFirst().first?.firstPTS, TSTestStream().videoPTS(125))
    }

    func testReconnectAfterALongGapOrOnAnotherClockIsADiscontinuity() {
        let gap = reconnect(firstFrames: 0..<100, replay: 150..<260)
        XCTAssertTrue(gap.segmenter.lastPlacementWasDiscontinuity)
        XCTAssertEqual(gap.after.filter(\.discontinuity).count, 1)
        XCTAssertEqual(gap.after.first { $0.discontinuity }?.firstPTS, TSTestStream().videoPTS(150))

        let otherClock = reconnect(firstFrames: 0..<100, replay: 0..<120) { $0.base = 7_000_000; $0.filler = 0x5C }
        XCTAssertTrue(otherClock.segmenter.lastPlacementWasDiscontinuity)
        let marked = otherClock.after.filter(\.discontinuity)
        XCTAssertEqual(marked.count, 1)
        XCTAssertEqual(TSAnalysis(marked[0].data, checkContinuity: false).numbers(0x100).first, 0, "the new encode starts at its keyframe")
    }

    func testDurationsCoverTheGapOfASeamlessJoin() {
        let result = reconnect(firstFrames: 0..<100, replay: 110..<200)
        // The open segment from frame 75 closes at the join (frame 125): 2 s of timeline, 1 s of it missing.
        let closedAtJoin = (result.before + result.after).first { $0.firstPTS == TSTestStream().videoPTS(75) }
        XCTAssertEqual(closedAtJoin?.duration, 2)
    }
}

final class HLSPlaylistTests: XCTestCase {
    func testMultivariantPlaylist() {
        let info = StreamInfo(video: ElementaryStream(pid: 0x100, streamType: 0x1B, kind: .h264), audio: ElementaryStream(pid: 0x101, streamType: 0x0F, kind: .aacADTS),
                              videoCodec: "avc1.64001F", audioCodec: "mp4a.40.2", width: 1280, height: 720, hasCEA608: true)
        XCTAssertEqual(HLSPlaylistWriter.multivariant(info: info, bandwidth: 5_000_000, mediaURI: "media.m3u8"), """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,INSTREAM-ID="CC1"
        #EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.64001F,mp4a.40.2",RESOLUTION=1280x720,CLOSED-CAPTIONS="cc"
        media.m3u8

        """)
        // No captions seen yet: CC1 is still declared for H.264 video (AVPlayer reads this playlist once per item, and
        // captions often start after an ad or programme without them).
        var plain = info
        plain.hasCEA608 = false
        plain.width = nil
        XCTAssertEqual(HLSPlaylistWriter.multivariant(info: plain, bandwidth: 0, mediaURI: "media.m3u8"), """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-MEDIA:TYPE=CLOSED-CAPTIONS,GROUP-ID="cc",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,INSTREAM-ID="CC1"
        #EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.64001F,mp4a.40.2",CLOSED-CAPTIONS="cc"
        media.m3u8

        """)
        let radio = StreamInfo(audio: info.audio, audioCodec: "mp4a.40.2")
        XCTAssertEqual(HLSPlaylistWriter.multivariant(info: radio, bandwidth: 128_000, mediaURI: "media.m3u8"), """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2",CLOSED-CAPTIONS=NONE
        media.m3u8

        """)
        XCTAssertNil(StreamInfo(video: info.video, audio: info.audio, videoCodec: "avc1.64001F").codecs, "an unknown audio codec")
        XCTAssertEqual(StreamInfo(audio: info.audio, audioCodec: "ac-3").codecs, "ac-3")
        XCTAssertNil(StreamInfo().codecs)
    }

    func testMediaPlaylist() {
        let segments = [HLSSegmentEntry(sequence: 7, duration: 2.0004, discontinuity: false), HLSSegmentEntry(sequence: 8, duration: 1.9996, discontinuity: true),
                        HLSSegmentEntry(sequence: 9, duration: 6, discontinuity: false)]
        XCTAssertEqual(HLSPlaylistWriter.media(segments, targetDuration: 6, discontinuitySequence: 3) { "\($0).ts" }, """
        #EXTM3U
        #EXT-X-VERSION:3
        #EXT-X-TARGETDURATION:6
        #EXT-X-MEDIA-SEQUENCE:7
        #EXT-X-DISCONTINUITY-SEQUENCE:3
        #EXTINF:2.000,
        7.ts
        #EXT-X-DISCONTINUITY
        #EXTINF:2.000,
        8.ts
        #EXTINF:6.000,
        9.ts

        """)
        XCTAssertFalse(HLSPlaylistWriter.media(segments, targetDuration: 6, discontinuitySequence: 0) { "\($0).ts" }.contains("ENDLIST"))
        XCTAssertEqual(HLSPlaylistWriter.decimals(0.0004), "0.000")
        XCTAssertEqual(HLSPlaylistWriter.decimals(12.3456), "12.346")
        XCTAssertEqual(HLSPlaylistWriter.decimals(1.05), "1.050")
    }
}
