package tv.lumanest.tuner.player

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.TimestampAdjuster
import androidx.media3.common.util.UnstableApi
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.ts.DefaultTsPayloadReaderFactory
import androidx.media3.extractor.ts.TsExtractor
import androidx.media3.extractor.ts.TsPayloadReader
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.atomic.AtomicLong

/**
 * The spliced bytes through Media3 1.11.1's own TsExtractor, set up as PlayerHolder sets it up: per track, sample times
 * keep going forward across every splice, nothing is repeated, video resumes on a keyframe, and the audio goes on
 * exactly where it stopped (DefaultAudioSink would play an overlap or gap under 200 ms back to back, leaving the sound
 * out of step with the picture). A connection that is never spliced gives what it gave without the splicer.
 */
@RunWith(RobolectricTestRunner::class)
class TsExtractorSpliceTest {
    @Test fun splicedStreamPlaysContinuouslyThroughMedia3() = Media3TsCheck.splicedStreamPlaysContinuously()

    @Test fun theSameConnectionsJoinedRawBreakTheTimeline() = Media3TsCheck.rawJoinBreaksTheTimeline()

    @Test fun multiFrameAudioContinuesExactlyThroughMedia3() = Media3TsCheck.multiFrameAudioContinuesExactly()

    @Test fun resendCutInsideAnAudioPesContinuesExactlyThroughMedia3() = Media3TsCheck.resendCutInsideAudioContinuesExactly()

    @Test fun jumpOntoAKeyframeKeepsTheAudioExactThroughMedia3() = Media3TsCheck.jumpOntoAKeyframeKeepsAudioExact()

    @Test fun keyframesSplitOverTwoPesAllReachMedia3() = Media3TsCheck.splitKeyframesAllSurvive()

    @Test fun anEncoderRestartingBehindKeepsItsKeyframe() = Media3TsCheck.stepBackKeepsTheNewKeyframe()

    @Test fun aProgramMapUpdateAfterARejoinPlaysOnThroughMedia3() = Media3TsCheck.programMapUpdateAfterARejoinPlaysOn()

    @Test fun everyStreamTypeIsVideoAudioOrNeitherAsMedia3ReadsIt() = Media3TsCheck.streamTypesAsMedia3ReadsThem()

    @Test fun privateStreamsResolveThroughTheirDescriptorsAsInMedia3() = Media3TsCheck.descriptorsAsMedia3ResolvesThem()
}

/** Plain JVM code; the Robolectric runner above only supplies android.util.Log and friends to Media3. */
@OptIn(UnstableApi::class)
object Media3TsCheck {
    /** 150 frames before the 33-bit clock wraps: the splices below cross it. */
    private val NEAR_WRAP = TsSplicer.WRAP - 150 * TsTestStream.VIDEO_STEP
    private const val HOUR = 3_600L * TsSplicer.TICKS

    class Track(val type: Int) : TrackOutput {
        var format: Format? = null
        val times = ArrayList<Long>()
        val flags = ArrayList<Int>()
        private val scratch = ByteArray(64 * 1024)

        override fun format(format: Format) { this.format = format }

        override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
            val n = input.read(scratch, 0, minOf(length, scratch.size))
            if (n == C.RESULT_END_OF_INPUT) {
                if (allowEndOfInput) return C.RESULT_END_OF_INPUT
                throw EOFException()
            }
            return n
        }

        override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) { data.skipBytes(length) }

        override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
            times += timeUs
            this.flags += flags
        }

        fun keyframes(): Int = flags.count { (it and C.BUFFER_FLAG_KEY_FRAME) != 0 }
    }

    /** Runs TsExtractor as DefaultExtractorsFactory builds it in PlayerHolder (non-IDR keyframes, CEA-608 declared). */
    fun extract(reader: DataReader): Map<Int, Track> {
        val tracks = LinkedHashMap<Int, Track>()
        val output = object : ExtractorOutput {
            override fun track(id: Int, type: Int): TrackOutput = tracks.getOrPut(id) { Track(type) }
            override fun endTracks() {}
            override fun seekMap(seekMap: SeekMap) {}
        }
        val captions = listOf(Format.Builder().setSampleMimeType(MimeTypes.APPLICATION_CEA608).build())
        val extractor = TsExtractor(
            TsExtractor.MODE_SINGLE_PMT, TimestampAdjuster(0),
            DefaultTsPayloadReaderFactory(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES, captions),
        )
        extractor.init(output)
        val input = DefaultExtractorInput(reader, 0, C.LENGTH_UNSET.toLong())
        val position = PositionHolder()
        while (extractor.read(input, position) != Extractor.RESULT_END_OF_INPUT) Unit
        return tracks
    }

    private class Run(val tracks: Map<Int, Track>, val bytes: ByteArray, val reopens: Int, val logs: List<String>) {
        val video get() = tracks.values.single { it.type == C.TRACK_TYPE_VIDEO }
        val audio get() = tracks.values.single { it.type == C.TRACK_TYPE_AUDIO }
    }

    /** The connections through LiveRejoin (a fake clock, no waiting), read by TsExtractor until the end. */
    private fun play(vararg connections: LiveRejoinTest.Script, delays: List<Long> = listOf(0L, 500L, 1_500L)): Run {
        val clock = AtomicLong(1_000_000)
        val upstream = LiveRejoinTest.FakeUpstream(connections[0], *connections.drop(1).toTypedArray(), clock = clock)
        val watchdog = ScheduledThreadPoolExecutor(1)
        val logs = ArrayList<String>()
        val rejoin = LiveRejoin(upstream, upstream.firstConnection.canceller, { logs += it }, { clock.get() },
            LiveRejoin.Pacing(delaysMs = delays), { clock.addAndGet(it) }, watchdog)
        val copy = ByteArrayOutputStream()
        val tracks = try {
            extract(object : DataReader {
                override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                    val n = rejoin.read(buffer, offset, length)
                    if (n > 0) copy.write(buffer, offset, n)
                    return n
                }
            })
        } finally {
            rejoin.release()
            watchdog.shutdownNow()
        }
        return Run(tracks, copy.toByteArray(), upstream.reopens.get(), logs)
    }

    private fun script(bytes: ByteArray, ending: LiveRejoinTest.Ending = LiveRejoinTest.Ending.END) = LiveRejoinTest.Script(bytes, ending)

    /**
     * Every audio sample follows the one before by one AAC frame: no overlap, no gap. AdtsReader steps 21,333 us inside
     * a PES; each PES starts at its own PTS (up to 3 us of rounding with 8 frames per PES).
     */
    private fun assertAudioExact(run: Run) {
        val times = run.audio.times
        for (i in 1 until times.size) {
            val step = times[i] - times[i - 1]
            assertTrue("audio sample $i moved $step us: ${run.logs}", step in 21_333..21_336)
        }
    }

    private class Connections {
        val first = TsTestStream(base = NEAR_WRAP)
        val c1: ByteArray
        val c2: ByteArray
        val c3: ByteArray
        val c4: ByteArray
        init {
            // 1: dies inside frame 46. 2: resends from 40 (the same clock), ends inside frame 90.
            // 3: comes back 40 frames later, between keyframes, across the 33-bit wrap. 4: comes back 31 frames later.
            val a = first.frames(0, 50)
            c1 = a.copyOf(first.videoStart(a, 46) + 300)
            val second = TsTestStream(base = NEAR_WRAP, ccStart = 4)
            val b = second.frames(40, 100)
            c2 = b.copyOf(second.videoStart(b, 90) + 400)
            c3 = TsTestStream(base = NEAR_WRAP, ccStart = 8).frames(130, 200)
            c4 = TsTestStream(base = NEAR_WRAP, ccStart = 1).frames(230, 290)
        }
    }

    fun splicedStreamPlaysContinuously() {
        val connections = Connections()
        val run = play(script(connections.c1, LiveRejoinTest.Ending.ERROR), script(connections.c2), script(connections.c3),
            script(connections.c4))
        assertEquals(run.logs.toString(), 3, run.reopens)

        val analysis = TsAnalysis(run.bytes, connections.first)
        assertEquals(emptyList<String>(), analysis.problems)
        // Frame 46 is completed from the resend; frames 90 and 199, being read at a jump, are dropped by the extractor.
        val expectedFrames = (0..45) + (46..89) + (132..198) + (240..289)
        assertEquals(expectedFrames, analysis.video.map { it.number })

        val video = run.video
        assertEquals(320, video.format?.width)
        assertEquals(MimeTypes.AUDIO_AAC, run.audio.format?.sampleMimeType)
        assertEquals("one sample per frame, none repeated or lost", expectedFrames.size, video.times.size)
        // Where a jump resumes, the last frame shows a little longer or shorter so the audio continues exactly.
        val jumps = setOf(90, 157)
        for (i in 1 until video.times.size) {
            val step = video.times[i] - video.times[i - 1]
            if (i in jumps) assertTrue("video sample $i moved $step us", kotlin.math.abs(step - 40_000) <= 10_667)
            else assertEquals("video sample $i", 40_000L, step)
        }
        for (i in listOf(0, 90, 157)) {
            assertTrue("video sample $i is a keyframe", (video.flags[i] and C.BUFFER_FLAG_KEY_FRAME) != 0)
        }
        assertEquals(analysis.audio.size, run.audio.times.size)
        assertAudioExact(run)
        // Audio and video stay together: both end within a frame of each other.
        assertTrue(kotlin.math.abs(run.audio.times.last() - video.times.last()) < 100_000)
    }

    /**
     * ffmpeg-style audio (8 AAC frames per PES, each PES written once full) across a jump: the first new audio frame
     * starts exactly where the old audio ended. Without the alignment it started up to one PES (171 ms) inside it.
     */
    fun multiFrameAudioContinuesExactly() {
        val delay = 8 * TsTestStream.AUDIO_STEP
        val first = TsTestStream(base = HOUR, audioFrames = 8, audioDelay = delay)
        val a = first.frames(0, 50)
        val c1 = a.copyOf(first.videoStart(a, 46) + 300)
        val c2 = TsTestStream(base = HOUR, ccStart = 4, audioFrames = 8, audioDelay = delay).frames(70, 150)
        // One rejoin, then the end goes to the extractor as an end.
        val run = play(script(c1, LiveRejoinTest.Ending.ERROR), script(c2), delays = listOf(0L))
        assertEquals(run.logs.toString(), 1, run.reopens)
        val analysis = TsAnalysis(run.bytes, first)
        assertEquals(emptyList<String>(), analysis.problems)
        assertEquals((0..45) + (72..149), analysis.video.map { it.number })

        val video = run.video
        assertEquals(analysis.video.size, video.times.size)
        for (i in 1 until video.times.size) {
            val step = video.times[i] - video.times[i - 1]
            if (i == 46) assertTrue("video sample $i moved $step us", kotlin.math.abs(step - 40_000) <= 4 * 21_334)
            else assertEquals("video sample $i", 40_000L, step)
        }
        assertTrue((video.flags[46] and C.BUFFER_FLAG_KEY_FRAME) != 0)
        assertEquals(analysis.audio.size, run.audio.times.size)
        assertAudioExact(run)
    }

    /** A resend with the connection cut inside an 8-frame audio PES: the frame cut short is completed, none repeated. */
    fun resendCutInsideAudioContinuesExactly() {
        val delay = 8 * TsTestStream.AUDIO_STEP
        val first = TsTestStream(base = HOUR, audioFrames = 8, audioDelay = delay)
        val a = first.frames(0, 200)
        var cut = first.videoStart(a, 180)
        while (((a[cut + 1].toInt() and 0x1F) shl 8 or (a[cut + 2].toInt() and 0xFF)) != first.audioPid || (a[cut + 1].toInt() and 0x40) == 0) cut += 188
        val c1 = a.copyOf(cut + 188 * 4 + 50)
        val c2 = TsTestStream(base = HOUR, ccStart = 6, audioFrames = 8, audioDelay = delay).frames(100, 260)
        val run = play(script(c1, LiveRejoinTest.Ending.ERROR), script(c2), delays = listOf(0L))
        val analysis = TsAnalysis(run.bytes, first)
        assertEquals(emptyList<String>(), analysis.problems)
        assertEquals((0..259).toList(), analysis.video.map { it.number })
        val video = run.video
        for (i in 1 until video.times.size) assertEquals("video sample $i", 40_000L, video.times[i] - video.times[i - 1])
        assertEquals((0 until analysis.audio.size).toList(), analysis.audioFrames())
        assertEquals(analysis.audio.size, run.audio.times.size)
        assertAudioExact(run)
    }

    /**
     * The new connection starts exactly on a keyframe, with no audio before it: its first audio starts after where
     * the old audio ended. The picture moves up to 250 ms earlier so the audio still continues exactly.
     */
    fun jumpOntoAKeyframeKeepsAudioExact() {
        val delay = 8 * TsTestStream.AUDIO_STEP
        val first = TsTestStream(base = HOUR, audioFrames = 8, audioDelay = delay)
        val a = first.frames(0, 60)
        val c1 = a.copyOf(first.videoStart(a, 51) + 400)
        val second = TsTestStream(base = HOUR, ccStart = 5, audioFrames = 8, audioDelay = delay)
        val all = second.frames(100, 180)
        val c2 = all.copyOfRange(second.videoStart(all, 120), all.size)
        val run = play(script(c1, LiveRejoinTest.Ending.ERROR), script(c2), delays = listOf(0L))
        val analysis = TsAnalysis(run.bytes, first)
        assertEquals(emptyList<String>(), analysis.problems)
        assertEquals((0..50) + (120..179), analysis.video.map { it.number })
        assertTrue(run.logs.toString(), run.logs.any { it.contains("earlier to continue the audio") })
        assertTrue((run.video.flags[51] and C.BUFFER_FLAG_KEY_FRAME) != 0)
        assertAudioExact(run)
    }

    /** A keyframe's parameter sets and slice in two PES with the same timestamps (finding: 1 of 9 survived). */
    fun splitKeyframesAllSurvive() {
        val stream = TsTestStream(base = HOUR, splitKeyframes = true)
        val run = play(script(stream.frames(0, 100)))
        assertEquals(100, run.video.times.size)
        assertEquals("every keyframe", 9, run.video.keyframes())
    }

    /** An encoder restarting 0.4 s behind on the same connection: its IDR comes out flagged, as without the splicer. */
    fun stepBackKeepsTheNewKeyframe() {
        val stream = TsTestStream(base = HOUR)
        val restart = TsTestStream(base = stream.videoDts(50) - 10 * TsTestStream.VIDEO_STEP, ccStart = 9)
        val bytes = stream.frames(0, 50) + restart.frames(0, 40)
        val run = play(script(bytes))
        var position = 0
        val raw = extract(object : DataReader {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (position >= bytes.size) return C.RESULT_END_OF_INPUT
                val n = minOf(length, bytes.size - position)
                System.arraycopy(bytes, position, buffer, offset, n)
                position += n
                return n
            }
        })
        assertArrayEquals(bytes, run.bytes)
        val video = run.video
        assertEquals(raw.values.single { it.type == C.TRACK_TYPE_VIDEO }.times, video.times)
        val idrUs = (restart.videoPts(0) - stream.videoDts(0)) * 1000 / 90 // TimestampAdjuster starts at the first DTS
        val at = video.times.lastIndexOf(idrUs) // the old frame 40 has the same time
        assertTrue("the restart's IDR at $idrUs us came out", at >= 0)
        assertTrue("and it is a keyframe", (video.flags[at] and C.BUFFER_FLAG_KEY_FRAME) != 0)
    }

    /**
     * A programme boundary on a rejoined connection that has caught up: from frame 100 on, the program map no longer
     * lists the second audio stream, and it stops. TsExtractor reads only its first map, so the connection plays on to
     * its end with no restart, as the first connection would (an earlier version gave up on it at the new map).
     */
    fun programMapUpdateAfterARejoinPlaysOn() {
        val first = TsTestStream(base = HOUR, secondAudioPid = 0x102)
        val a = first.frames(0, 60)
        val c1 = a.copyOf(first.videoStart(a, 50) + 400)
        val second = TsTestStream(base = HOUR, secondAudioPid = 0x102, ccStart = 5)
        val caughtUp = second.frames(45, 100)
        val tail = TsTestStream.withPmt(TsTestStream.withoutPid(second.frames(100, 200), 0x102), first.pmtPid,
            TsTestStream(base = HOUR).pmt())
        // One rejoin, then the second connection's end goes to the extractor as an end.
        val run = play(script(c1, LiveRejoinTest.Ending.ERROR), script(caughtUp + tail), delays = listOf(0L))
        assertEquals(run.logs.toString(), 1, run.reopens)
        assertTrue(run.logs.toString(), run.logs.none { it.contains("gave up:") })
        val analysis = TsAnalysis(run.bytes, first)
        assertEquals(emptyList<String>(), analysis.problems)
        assertEquals((0..199).toList(), analysis.video.map { it.number })
        val video = run.video
        assertEquals("one sample per frame, to the end", 200, video.times.size)
        for (i in 1 until video.times.size) assertEquals("video sample $i", 40_000L, video.times[i] - video.times[i - 1])
        val audio = run.tracks.getValue(first.audioPid).times
        assertEquals(analysis.audio.size, audio.size)
        for (i in 1 until audio.size) assertTrue("audio sample $i", audio[i] - audio[i - 1] in 21_333..21_334)
        assertEquals("the second audio stream ends at the boundary", analysis.second.size, run.tracks.getValue(0x102).times.size)
    }

    private val captions = listOf(Format.Builder().setSampleMimeType(MimeTypes.APPLICATION_CEA608).build())

    /** The kind of track Media3 makes of [tracks] (track id to type) for one stream. */
    private fun kindOf(types: Collection<Int>): Int = when {
        C.TRACK_TYPE_VIDEO in types -> TsSplicer.KIND_VIDEO
        C.TRACK_TYPE_AUDIO in types -> TsSplicer.KIND_AUDIO
        else -> TsSplicer.KIND_OTHER
    }

    /**
     * The splicer places a new connection by the streams Media3 decodes as video and audio, and must know them all: one
     * it took for data (0x80 MPEG-2, DTS-HD, DTS-UHD and MPEG-H audio, in an earlier version) was resumed on any frame
     * after a jump, or passed again after a resend, with no exact audio alignment.
     */
    fun streamTypesAsMedia3ReadsThem() {
        val factory = DefaultTsPayloadReaderFactory(DefaultTsPayloadReaderFactory.FLAG_ALLOW_NON_IDR_KEYFRAMES, captions)
        for (type in 0..0xFF) {
            if (type == 0x05 || type == 0x06) continue // resolved through descriptors, below
            val esInfo = TsPayloadReader.EsInfo(type, null, TsPayloadReader.EsInfo.AUDIO_TYPE_UNDEFINED, emptyList(), ByteArray(0))
            val types = ArrayList<Int>()
            factory.createPayloadReader(type, esInfo)?.init(TimestampAdjuster(0), object : ExtractorOutput {
                override fun track(id: Int, trackType: Int): TrackOutput { types += trackType; return Track(trackType) }
                override fun endTracks() {}
                override fun seekMap(seekMap: SeekMap) {}
            }, TsPayloadReader.TrackIdGenerator(1, 0x100, 0x2000))
            assertEquals("stream type 0x${Integer.toHexString(type)}: $types", kindOf(types), TsSplicer.kindOf(type))
        }
    }

    /**
     * Private streams (0x05, 0x06) as TsExtractor resolves them from their descriptors, the last one naming a type
     * winning: what the splicer reads from the same program map is video, audio or neither as in Media3.
     */
    fun descriptorsAsMedia3ResolvesThem() {
        fun d(vararg bytes: Int) = bytes.map { it.toByte() }.toByteArray()
        val subtitles = d(0x59, 8, 'e'.code, 'n'.code, 'g'.code, 0x10, 0, 1, 0, 1)
        val entries = listOf(
            0x06 to d(0x05, 4, 'A'.code, 'C'.code, '-'.code, '3'.code),
            0x06 to d(0x05, 4, 'H'.code, 'E'.code, 'V'.code, 'C'.code),
            0x06 to d(0x7F, 1, 0x0E), // DTS-HD
            0x06 to d(0x7F, 1, 0x21), // DTS-UHD
            0x06 to d(0x7F, 1, 0x15), // AC-4
            0x06 to d(0x7B, 0), // DTS
            0x06 to d(0x7A, 0), // E-AC-3
            0x06 to subtitles,
            0x06 to d(0x56, 5, 'e'.code, 'n'.code, 'g'.code, 0x09, 0x00), // teletext: not read
            0x06 to d(),
            0x05 to d(0x6A, 0), // AC-3, read as PES even on a private sections type
            0x06 to d(0x6A, 0) + subtitles, // the last one wins: subtitles
            0x06 to subtitles + d(0x6A, 0), // AC-3
            0x06 to d(0x0A, 4, 'e'.code, 'n'.code, 'g'.code, 0, 0x6A, 0), // a language, then AC-3
            0x06 to d(0x6F, 0), // AIT: sections
            0x80 to d(),
        )
        val pmtPid = 0x1000
        val body = ByteArrayOutputStream()
        body.write(d(0x00, 0x01, 0xC1, 0x00, 0x00, 0xE1, 0x10, 0xF0, 0x00)) // program 1, PCR on 0x110, no program info
        for ((i, entry) in entries.withIndex()) {
            val pid = 0x110 + i
            body.write(d(entry.first, 0xE0 or (pid shr 8), pid and 0xFF, 0xF0, entry.second.size))
            body.write(entry.second)
        }
        val section = ByteArrayOutputStream()
        section.write(d(0x02, 0xB0 or ((body.size() + 4) shr 8), (body.size() + 4) and 0xFF))
        section.write(body.toByteArray())
        val crc = TsTestStream.crc32(section.toByteArray())
        section.write(d(crc ushr 24, (crc ushr 16) and 0xFF, (crc ushr 8) and 0xFF, crc and 0xFF))
        assertTrue("one packet", section.size() <= 183)
        val pmt = ByteArray(188) { 0xFF.toByte() }
        d(0x47, 0x40 or (pmtPid shr 8), pmtPid and 0xFF, 0x10, 0x00).copyInto(pmt)
        section.toByteArray().copyInto(pmt, 5)
        val stuffing = ByteArray(188) { 0xFF.toByte() }.also { d(0x47, 0x1F, 0xFF, 0x10).copyInto(it) }
        val bytes = TsTestStream(pmtPid = pmtPid).pat() + pmt + stuffing + stuffing + stuffing

        var position = 0
        val tracks = extract(object : DataReader {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (position >= bytes.size) return C.RESULT_END_OF_INPUT
                val n = minOf(length, bytes.size - position)
                System.arraycopy(bytes, position, buffer, offset, n)
                position += n
                return n
            }
        })
        val splicer = TsSplicer()
        splicer.push(bytes, 0, bytes.size)
        for (i in entries.indices) {
            val pid = 0x110 + i
            val types = tracks.filterKeys { it % 0x2000 == pid }.values.map { it.type }
            assertEquals("entry $i (PID 0x${Integer.toHexString(pid)}): $types", kindOf(types), splicer.streamKind(pid))
        }
        assertEquals("these read as audio", 9, entries.indices.count { splicer.streamKind(0x110 + it) == TsSplicer.KIND_AUDIO })
    }

    fun rawJoinBreaksTheTimeline() {
        val connections = Connections()
        val joined = connections.c1 + connections.c2 + connections.c3 + connections.c4
        var position = 0
        val tracks = extract(object : DataReader {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                if (position >= joined.size) return C.RESULT_END_OF_INPUT
                val n = minOf(length, joined.size - position)
                System.arraycopy(joined, position, buffer, offset, n)
                position += n
                return n
            }
        })
        val video = tracks.values.single { it.type == C.TRACK_TYPE_VIDEO }
        val steps = (1 until video.times.size).map { video.times[it] - video.times[it - 1] }
        assertTrue("time goes back or jumps without the splicer", steps.any { it <= 0 } && steps.any { it > 40_000 })
    }
}
