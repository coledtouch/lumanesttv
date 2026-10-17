package tv.lumanest.tuner.player

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import kotlin.random.Random

class TsSplicerTest {
    private val logs = ArrayList<String>()
    private val out = ByteArrayOutputStream()
    private val splicer = TsSplicer { logs += it }
    private val random = Random(7)

    /** Pushes in uneven chunks, the way a socket delivers, reading everything finished after each one. */
    private fun feed(bytes: ByteArray, from: Int = 0, to: Int = bytes.size) {
        var i = from
        while (i < to) {
            val n = minOf(to - i, 1 + random.nextInt(5000))
            splicer.push(bytes, i, n)
            i += n
            drain()
        }
    }

    private fun drain() {
        val buffer = ByteArray(5000)
        while (true) {
            val got = splicer.read(buffer, 0, 1 + random.nextInt(buffer.size))
            if (got == 0) break
            out.write(buffer, 0, got)
        }
    }

    /** A new connection; what the old one finished goes out first. */
    private fun connect(awayMs: Long = -1) {
        splicer.connect(awayMs)
        drain()
    }

    private fun videoStart(bytes: ByteArray, stream: TsTestStream, frame: Int) = stream.videoStart(bytes, frame)

    // ------------------------------------------------------------------ the first connection is never touched

    @Test fun cleanConnectionPassesThroughByteForByteWithoutHoldingAnythingBack() {
        val stream = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP)
        val bytes = stream.frames(0, 100)
        var i = 0
        while (i < bytes.size) {
            val n = minOf(bytes.size - i, 1 + random.nextInt(5000))
            splicer.push(bytes, i, n)
            i += n
            drain()
            // Everything up to the last whole packet is out at once; only a packet still arriving waits.
            assertEquals(i / 188 * 188, out.size())
        }
        assertArrayEquals(bytes, out.toByteArray())
        assertContinuous(TsAnalysis(out.toByteArray(), stream), (0..99).toList())
        assertTrue(splicer.canSplice)
    }

    /**
     * Streams that 1.6.2 played as they were and an earlier version of this filter broke: a keyframe's parameter sets
     * and slice in two PES with the same timestamps, a repeated packet, the source repeating its last frames, an
     * encoder restarting 0.4 s behind with a new IDR, audio PES that repeat a timestamp, the clock jumping back 16 s,
     * a PID outside the program map opening a video PES that never ends, a subtitle PES cut short, junk between
     * packets. One connection that is never spliced comes out byte for byte, at once.
     */
    @Test fun firstConnectionWithRepeatedEqualOrBackwardTimestampsComesOutByteIdentical() {
        val stream = TsTestStream(splitKeyframes = true)
        val s = ByteArrayOutputStream()
        s.write(stream.frames(0, 40))
        // A packet sent twice (allowed with the same continuity counter): a video PES start.
        val again = stream.frames(40, 41)
        s.write(again.copyOf(188 * 3))
        s.write(again, 188 * 2, again.size - 188 * 2)
        s.write(stream.frames(41, 60))
        s.write(stream.frames(54, 70)) // the source repeats its last 6 frames (240 ms)
        val restarted = TsTestStream(base = stream.videoDts(70) - 10 * TsTestStream.VIDEO_STEP, splitKeyframes = true, ccStart = 3)
        s.write(restarted.frames(0, 30)) // an encoder restart 0.4 s behind, from a new IDR
        // Two audio PES with one timestamp.
        s.write(restarted.audio(29)); s.write(restarted.audio(29))
        // A video PES on a PID the program map doesn't list, never ended; an open subtitle PES.
        val stray = TsTestStream(videoPid = 0x1FF).video(5)
        s.write(stray.copyOf(188 * 2))
        val sub = ByteArray(188) { 0xFF.toByte() }
        sub[0] = 0x47; sub[1] = 0x41; sub[2] = 0x02; sub[3] = 0x10
        byteArrayOf(0, 0, 1, 0xBD.toByte(), 0x07, 0xD0.toByte(), 0x81.toByte(), 0x80.toByte(), 5, 0x21, 0, 1, 0, 1).copyInto(sub, 4)
        s.write(sub)
        s.write(restarted.frames(30, 45))
        s.write(ByteArray(77) { 0x47 }) // junk that even looks like sync bytes
        restarted.base -= 16 * TsSplicer.TICKS // the clock jumps 16 s back
        s.write(restarted.frames(45, 80))
        val bytes = s.toByteArray()
        feed(bytes)
        splicer.finish()
        drain()
        assertArrayEquals(bytes, out.toByteArray())
        assertNull(splicer.lost)
        assertNull(splicer.changed)
    }

    @Test fun clockJumpingBackOnOneConnectionIsPassedOnAsItIs() {
        for ((from, to) in listOf(3_000_000L to 3_000_000L - 16 * TsSplicer.TICKS, 3_600L * TsSplicer.TICKS to 126_000L)) {
            val s = TsSplicer()
            val stream = TsTestStream(base = from)
            val a = stream.frames(0, 100)
            stream.base = to // the same connection and continuity counters, a new clock
            val bytes = a + stream.frames(0, 300)
            val got = ByteArrayOutputStream()
            var i = 0
            while (i < bytes.size) {
                val n = minOf(bytes.size - i, 1 + random.nextInt(5000))
                s.push(bytes, i, n)
                i += n
                val buffer = ByteArray(65536)
                while (true) { val r = s.read(buffer, 0, buffer.size); if (r <= 0) break; got.write(buffer, 0, r) }
            }
            assertArrayEquals(bytes, got.toByteArray())
        }
    }

    @Test fun aSmallStepBackOnOneConnectionIsPassedOn() {
        val stream = TsTestStream()
        val bytes = stream.frames(0, 50) + stream.frames(44, 100) // the source repeats its last 6 frames (240 ms)
        feed(bytes)
        assertArrayEquals(bytes, out.toByteArray())
        val video = TsAnalysis(out.toByteArray(), stream).video.map { it.number }
        assertEquals((0..49).toList() + (44..99).toList(), video)
    }

    @Test fun garbageBetweenPacketsPassesThroughUntouched() {
        val stream = TsTestStream()
        val bytes = stream.frames(0, 40)
        val dirty = ByteArrayOutputStream()
        dirty.write(bytes, 0, 188 * 50)
        dirty.write(ByteArray(77) { 0x47 }) // junk that even looks like sync bytes
        dirty.write(bytes, 188 * 50, bytes.size - 188 * 50)
        feed(dirty.toByteArray())
        assertArrayEquals(dirty.toByteArray(), out.toByteArray())
        assertTrue(splicer.canSplice)
    }

    @Test fun notTransportStreamPassesThroughUntouched() {
        val bytes = Random(3).nextBytes(20_000).map { if (it.toInt() == 0x47) 0 else it }.toByteArray()
        feed(bytes)
        splicer.finish()
        drain()
        assertArrayEquals(bytes, out.toByteArray())
        assertTrue(splicer.raw)
        assertFalse(splicer.canSplice)
    }

    @Test fun aFalseSyncInAnotherFormatPassesThroughUntouched() {
        // Compressed audio that happens to have 0x47 three times 188 bytes apart at the start.
        val bytes = Random(5).nextBytes(200_000).map { if (it.toInt() == 0x47) 0 else it }.toByteArray()
        for (k in 0 until 3) bytes[100 + k * 188] = 0x47
        feed(bytes)
        splicer.finish()
        drain()
        assertArrayEquals(bytes, out.toByteArray())
        assertFalse("no program map was read: nothing a rejoin could continue", splicer.canSplice)
    }

    /**
     * A first connection waits for nothing but the rest of a packet that has started: junk between packets, a lost sync
     * byte or a packet cut short goes out at once, as TsExtractor skips it (an earlier version held up to 563 bytes while
     * it looked for three sync bytes in a row, or for the next packet start).
     */
    @Test fun firstConnectionHoldsBackOnlyAPacketStillArriving() {
        val p = ByteArray(188) { 0xFF.toByte() }.also { it[0] = 0x47; it[1] = 0x1F; it[2] = 0xFF.toByte(); it[3] = 0x10 }
        fun deliveredAfter(data: ByteArray, cuts: List<Int>): List<Int> {
            val s = TsSplicer()
            val got = ByteArrayOutputStream()
            var at = 0
            return cuts.map { cut ->
                s.push(data, at, cut - at)
                at = cut
                val buffer = ByteArray(65536)
                while (true) { val r = s.read(buffer, 0, buffer.size); if (r <= 0) break; got.write(buffer, 0, r) }
                got.size()
            }
        }
        // Each packet goes out as soon as it is whole, from the first one.
        assertEquals(listOf(188, 376, 564), deliveredAfter(p + p + p, listOf(188, 376, 564)))
        // A stray byte after five clean packets goes out with the packets around it.
        val five = p + p + p + p + p
        assertEquals(listOf(940, 941, 1129, 1317), deliveredAfter(five + byteArrayOf(0) + p + p, listOf(940, 941, 1129, 1317)))
        // Not a stream that starts with whole packets: it passes through as it comes.
        assertEquals(listOf(100, 600), deliveredAfter(ByteArray(600), listOf(100, 600)))
        assertEquals(listOf(188, 189, 377), deliveredAfter(p + byteArrayOf(0) + p, listOf(188, 189, 377)))

        for (seed in 0 until 40) {
            val r = Random(seed)
            val clean = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP).frames(0, 40)
            val dirty = ByteArrayOutputStream()
            dirty.write(clean, 0, 188 * 5)
            var i = 188 * 5
            while (i < clean.size) {
                when (r.nextInt(30)) {
                    0 -> dirty.write(ByteArray(1 + r.nextInt(400)) { (if (r.nextInt(8) == 0) 0x47 else r.nextInt(256)).toByte() })
                    1 -> { dirty.write(clean, i, 1 + r.nextInt(187)); i += 188; continue } // a packet cut short
                }
                dirty.write(clean, i, 188)
                i += 188
            }
            val bytes = dirty.toByteArray()
            val s = TsSplicer()
            val got = ByteArrayOutputStream()
            val buffer = ByteArray(65536)
            var pushed = 0
            while (pushed < bytes.size) {
                val n = minOf(bytes.size - pushed, 1 + r.nextInt(if (r.nextBoolean()) 400 else 5000))
                s.push(bytes, pushed, n)
                pushed += n
                while (true) { val got1 = s.read(buffer, 0, buffer.size); if (got1 <= 0) break; got.write(buffer, 0, got1) }
                val held = pushed - got.size()
                assertTrue("seed $seed: $held bytes held after $pushed", held < 188)
                if (held > 0) assertEquals("seed $seed: what is held starts a packet", 0x47, bytes[got.size()].toInt())
            }
            assertFalse("seed $seed: a stream that starts with whole packets is followed", s.raw)
            s.finish()
            while (true) { val got1 = s.read(buffer, 0, buffer.size); if (got1 <= 0) break; got.write(buffer, 0, got1) }
            assertArrayEquals(bytes, got.toByteArray())
        }
    }

    @Test fun aPesThatNeverEndsPassesOnAsItComes() {
        val stream = TsTestStream()
        val start = stream.frames(0, 3)
        // A video PES start, then 2 MB of its continuation and no next start on the PID.
        val head = stream.video(3).copyOf(188)
        val tail = head.copyOf().also { it[1] = (it[1].toInt() and 0x40.inv()).toByte(); it[3] = 0x10 }
        val big = ByteArrayOutputStream()
        big.write(start)
        big.write(head)
        var cc = (head[3].toInt() and 0x0F)
        repeat((2 * 1024 * 1024) / 188) {
            cc = (cc + 1) and 0x0F
            tail[3] = (0x10 or cc).toByte()
            for (k in 4 until 188) tail[k] = 0x5A
            big.write(tail)
        }
        feed(big.toByteArray())
        assertArrayEquals(big.toByteArray(), out.toByteArray())
    }

    // ------------------------------------------------------------------ a resend

    @Test fun overlappingResendContinuesTheFrameCutShort() {
        val first = TsTestStream()
        val a = first.frames(0, 50)
        feed(a, to = videoStart(a, first, 45) + 500) // the connection dies inside frame 45
        connect()
        val second = TsTestStream(ccStart = 7) // the same clock, resent from frame 38
        feed(second.frames(38, 100))
        val analysis = TsAnalysis(out.toByteArray(), first)
        assertContinuous(analysis, (0..99).toList())
        assertEquals((0 until first.firstAudio(100)).toList(), analysis.audioFrames())
        assertEquals("the extractor's readers never reset", emptyList<Int>(), analysis.resets)
        assertTrue(logs.toString(), logs.any { it.startsWith("spliced: dropped") && it.contains("continuing the frame") })
        assertTrue("resent packets counted", logs.any { Regex("dropped [1-9][0-9]* resent").containsMatchIn(it) })
        assertFalse(splicer.placing)
    }

    @Test fun resendFromSecondsBackIsDroppedExactly() {
        // A provider's start-up burst: several seconds the extractor already has (more than the 1 s an earlier
        // version treated as a repeat), with ffmpeg-style audio cut inside a PES.
        for (back in listOf(75, 125, 250)) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            val first = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP)
            val a = first.frames(0, 300)
            val got = ByteArrayOutputStream()
            fun pump(b: ByteArray) {
                var i = 0
                while (i < b.size) {
                    val n = minOf(b.size - i, 1 + random.nextInt(5000))
                    s.push(b, i, n); i += n
                    val buffer = ByteArray(65536)
                    while (true) { val r = s.read(buffer, 0, buffer.size); if (r <= 0) break; got.write(buffer, 0, r) }
                }
            }
            // Cut inside an audio PES.
            val cutAt = audioCut(a, first, 280)
            pump(a.copyOf(cutAt))
            s.connect()
            pump(TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP, ccStart = 9).frames(280 - back, 360))
            val analysis = TsAnalysis(got.toByteArray(), first)
            assertNull(log.toString(), s.lost)
            assertContinuous(analysis, (0..359).toList())
            val frames = analysis.audioFrames()
            assertEquals("back $back", (0 until frames.size).toList(), frames)
            assertEquals(emptyList<Int>(), analysis.resets)
        }
    }

    @Test fun aLongBurstAtAHighBitrateIsNotHeldBack() {
        // 15 s resent at about 5 Mbps (more than the 8 MB a placement may hold): what the extractor has goes at once.
        val first = TsTestStream(scale = 20)
        val a = first.frames(0, 500)
        feed(a, to = videoStart(a, first, 450) + 3000)
        connect()
        val b = TsTestStream(scale = 20, ccStart = 3).frames(450 - 375, 520)
        assertTrue("${b.size} bytes", b.size > 10 * 1024 * 1024)
        feed(b)
        assertNull(logs.toString(), splicer.lost)
        assertContinuous(TsAnalysis(out.toByteArray(), first), (0..519).toList())
    }

    /**
     * A resend continues the PES the extractor is reading by joining its rest to the last packet the extractor has,
     * continuity counter included. If the resend loses, flags (transport_error_indicator) or repeats a packet right
     * where it continues, that join would hide a hole or a repeat in the frame, where the extractor on one connection
     * would have reset and dropped it. The splice is refused before any of it goes out; the same resend undamaged splices.
     */
    @Test fun aResendThatBreaksContinuityWhereItContinuesIsRefused() {
        for (where in listOf("inside a frame", "at a frame's end", "inside audio")) {
            for (damage in listOf("none", "error", "lost", "repeated")) {
                val case = "$damage packet $where"
                val log = ArrayList<String>()
                val s = TsSplicer { log += it }
                fun stream(cc: Int) = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP, ccStart = cc)
                val first = stream(0)
                val a = first.frames(0, 60)
                val pid: Int
                val cut: Int
                when (where) {
                    "inside a frame" -> { pid = first.videoPid; cut = first.videoStart(a, 45) + 3 * 188 }
                    "at a frame's end" -> { pid = first.videoPid; cut = first.videoStart(a, 46) }
                    else -> { pid = first.audioPid; cut = pesStart(a, pid, first.videoStart(a, 45)) + 3 * 188 }
                }
                val got = ByteArrayOutputStream()
                pump(s, a.copyOf(cut), got)
                s.connect()
                // The resend from frame 38: the packet on the PID that the extractor doesn't have yet is damaged.
                val b = stream(5).frames(38, 100)
                val at = samePacket(a, cut, pid, b)
                val resend = when (damage) {
                    "error" -> b.copyOf().also { it[at + 1] = (it[at + 1].toInt() or 0x80).toByte() }
                    "lost" -> b.copyOf(at) + b.copyOfRange(at + 188, b.size)
                    "repeated" -> {
                        val before = (at - 188 downTo 0 step 188).first { pidAt(b, it) == pid }
                        b.copyOf(at) + b.copyOfRange(before, before + 188) + b.copyOfRange(at, b.size)
                    }
                    else -> b
                }
                pump(s, resend, got)
                val analysis = TsAnalysis(got.toByteArray(), first)
                if (damage == "none") {
                    assertNull("$case: $log", s.lost)
                    assertContinuous(analysis, (0..99).toList())
                    continue
                }
                assertNotNull("$case: $log", s.lost)
                assertTrue("$case: ${s.lost}", s.lost!!.contains("continuity"))
                // What went out is whole up to the refusal: every frame but the one being read, and no reset.
                val video = analysis.video.dropLast(1)
                assertEquals(case, (0 until video.size).toList(), video.map { it.number })
                assertTrue(case, video.all { it.complete })
                assertEquals(case, emptyList<String>(), analysis.problems.filter { !it.contains("left over") })
                assertEquals(case, emptyList<Int>(), analysis.resets)
                assertEquals(case, (0 until analysis.audio.size).toList(), analysis.audioFrames())
            }
        }
    }

    @Test fun resentStreamThatDiffersIsRefused() {
        // The same clock and timestamps, other pictures: a restarted encoder, or a backup feed.
        val first = TsTestStream()
        val a = first.frames(0, 60)
        feed(a, to = videoStart(a, first, 50) + 600)
        val before = out.size()
        connect()
        feed(TsTestStream(filler = 0x3C).frames(40, 80))
        assertNotNull(splicer.lost)
        assertEquals("nothing of it went out", before, out.size())
    }

    @Test fun restartedClockBehindIsRefusedAtOnceNotDroppedForItsLength() {
        // The provider's relay restarted (no -copyts): its clock starts over at 1.4 s, 30 s behind the old one.
        val first = TsTestStream(base = 126_000L + 30 * TsSplicer.TICKS)
        val a = first.frames(0, 40)
        feed(a, to = videoStart(a, first, 30) + 300)
        val before = out.size()
        connect()
        val restarted = TsTestStream(base = 126_000L, filler = 0x3C).frames(0, 30)
        feed(restarted, to = 20_000) // well under a second of it
        assertNotNull(logs.toString(), splicer.lost)
        assertTrue(splicer.lost!!, splicer.lost!!.contains("behind"))
        assertEquals(before, out.size())
    }

    @Test fun restartedClockWithinTheResendWindowIsRefusedByItsContent() {
        // The old connection lived 10 s; the restart lands 10 s behind, where a resend could be: the bytes tell.
        val first = TsTestStream(base = 126_000L)
        val a = first.frames(0, 260)
        feed(a, to = videoStart(a, first, 250) + 300)
        connect()
        val before = out.size()
        feed(TsTestStream(base = 126_000L, filler = 0x3C, ccStart = 2).frames(0, 260))
        assertNotNull(splicer.lost)
        assertTrue(splicer.lost!!, splicer.lost!!.contains("differs"))
        assertEquals(before, out.size())
    }

    // ------------------------------------------------------------------ a jump ahead

    @Test fun forwardGapIsClosedFromTheNextKeyframe() {
        val first = TsTestStream()
        val a = first.frames(0, 50)
        feed(a, to = videoStart(a, first, 46) + 300)
        connect()
        val second = TsTestStream(ccStart = 3) // 24 frames later on the same clock, starting between keyframes
        feed(second.frames(70, 150))
        val analysis = TsAnalysis(out.toByteArray(), first)
        // Frame 46 was being read: TsExtractor drops it on the counter jump. Frame 45 was whole.
        assertContinuous(analysis, (0..45).toList() + (72..149).toList(), jumps = setOf(46))
        assertTrue("resumes on a keyframe", analysis.video[46].key)
        assertEquals(listOf(first.videoPid), analysis.resets)
        assertTrue(logs.toString(), logs.any { it.startsWith("spliced:") })
        assertFalse(splicer.placing)
    }

    @Test fun keyframesAreFoundByNalUnitsWhenTheStreamDoesNotMarkThem() {
        val first = TsTestStream(marked = false)
        val a = first.frames(0, 30)
        feed(a, to = videoStart(a, first, 20) + 200) // inside frame 20
        connect()
        feed(TsTestStream(marked = false).frames(27, 80))
        val analysis = TsAnalysis(out.toByteArray(), first)
        assertContinuous(analysis, (0..19).toList() + (36..79).toList(), jumps = setOf(20))
        assertTrue(analysis.video[20].key)
        assertFalse(analysis.video[20].rai)
    }

    @Test fun jumpIsShiftedAcrossThe33BitWrap() {
        // The clock wraps at frame 30 of the first connection; the next one, on the same clock, lands past it.
        val first = TsTestStream(base = TsSplicer.WRAP - 30 * TsTestStream.VIDEO_STEP)
        val a = first.frames(0, 60)
        feed(a, to = videoStart(a, first, 26) + 1000)
        connect()
        feed(TsTestStream(base = TsSplicer.WRAP - 30 * TsTestStream.VIDEO_STEP, ccStart = 11).frames(40, 90))
        val analysis = TsAnalysis(out.toByteArray(), first)
        assertContinuous(analysis, (0..25).toList() + (48..89).toList(), jumps = setOf(26))
        assertTrue(analysis.video[26].key)
        // The clock reference moved with the timestamps: always 9000 ticks before its frame's DTS (frame 26, cut short,
        // went out with its PCR before the extractor dropped it).
        val dts = analysis.video.map { it.dts }
        val pcrs = analysis.pcrs.toMutableList().apply { removeAt(26) }
        assertEquals(dts.size, pcrs.size)
        for (i in dts.indices) assertEquals(TsSplicer.wrap(dts[i] - 9000), pcrs[i])
    }

    @Test fun restartedClockFarAwayIsRefused() {
        for (base in listOf(10L * TsSplicer.TICKS, 5_000_000_000L)) {
            val s = TsSplicer()
            val first = TsTestStream(base = 100L * TsSplicer.TICKS)
            val a = first.frames(0, 40)
            s.push(a, 0, videoStart(a, first, 30) + 200)
            s.connect()
            val b = TsTestStream(base = base).frames(0, 30)
            s.push(b, 0, b.size)
            assertNotNull("base $base", s.lost)
        }
    }

    @Test fun jumpFurtherThanTheOutageExplainsIsRefused() {
        val first = TsTestStream()
        val a = first.frames(0, 50)
        feed(a, to = videoStart(a, first, 46) + 300)
        connect(awayMs = 2_000)
        feed(TsTestStream().frames(46 + 25 * 20, 46 + 25 * 22)) // 20 s later, after 2 s without data
        assertNotNull(splicer.lost)
        assertTrue(splicer.lost!!, splicer.lost!!.contains("ahead"))
    }

    @Test fun noKeyframeInTimeIsRefusedInsteadOfSplicingOnAPlainFrame() {
        val first = TsTestStream(gop = 300) // a 12 s GOP
        val a = first.frames(0, 60)
        feed(a, to = videoStart(a, first, 50) + 300)
        val before = out.size()
        connect()
        feed(TsTestStream(gop = 300).frames(80, 260))
        assertNotNull(splicer.lost)
        assertTrue(splicer.lost!!, splicer.lost!!.contains("keyframe"))
        assertEquals(before, out.size())
    }

    @Test fun otherVideoParametersOnAJumpAreRefused() {
        val first = TsTestStream()
        val a = first.frames(0, 50)
        feed(a, to = videoStart(a, first, 46) + 300)
        connect()
        feed(TsTestStream(sps = TsTestStream.SPS_640).frames(70, 150))
        assertNotNull(splicer.lost)
        assertTrue(splicer.lost!!, splicer.lost!!.contains("format"))
    }

    @Test fun jumpContinuesMultiFrameAudioExactly() {
        // ffmpeg-style audio: 8 AAC frames (171 ms) per PES, each PES written once it is full. Over these cuts and jumps
        // the audio PES that continues the old audio comes both before and after the new keyframe is complete, and
        // starts inside the old audio's last PES or after it; the old audio's last PES may be cut short.
        var spliced = 0
        for (cut in 40..51) for (jump in listOf(23, 29, 34)) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            val first = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP)
            val a = first.frames(0, 60)
            val got = ByteArrayOutputStream()
            fun drainTo() {
                val b = ByteArray(65536)
                while (true) { val n = s.read(b, 0, b.size); if (n <= 0) break; got.write(b, 0, n) }
            }
            val end = first.videoStart(a, cut) + 400
            s.push(a, 0, end); drainTo()
            val before = got.size()
            s.connect(); drainTo()
            val second = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP, ccStart = 5)
            val b = second.frames(cut + jump, cut + jump + 80)
            var i = 0
            while (i < b.size) { val n = minOf(b.size - i, 1 + random.nextInt(5000)); s.push(b, i, n); i += n; drainTo() }
            val what = "cut $cut jump $jump: $log"
            if (s.lost != null) {
                assertEquals("a refused splice sends nothing: $what", before, got.size())
                continue
            }
            spliced++
            val analysis = TsAnalysis(got.toByteArray(), first)
            val resume = (cut + jump + 11) / 12 * 12
            assertEquals(what, (0 until cut).toList() + (resume until cut + jump + 80).toList(), analysis.video.map { it.number })
            assertContinuous(analysis, analysis.video.map { it.number }, jumps = setOf(cut))
            assertLipSync(analysis, first, what)
        }
        assertTrue("$spliced of 36 spliced", spliced >= 30)
    }

    @Test fun jumpOntoAKeyframeWithNoEarlierAudioIsExactOrRefused() {
        // A server that starts a new client at a keyframe: its first audio may start after where the old audio ended.
        // Played back to back, a gap under 200 ms would leave the sound ahead of the picture for the rest of the
        // session; the splice moves the picture up to 250 ms instead, or is refused.
        var spliced = 0
        var earlier = 0
        for (cut in 40..70) for (key in listOf(120, 132, 144, 156, 168, 180, 192, 204, 216, 228, 240, 252)) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            val first = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP)
            val a = first.frames(0, 80)
            val got = ByteArrayOutputStream()
            fun drainTo() {
                val b = ByteArray(65536)
                while (true) { val n = s.read(b, 0, b.size); if (n <= 0) break; got.write(b, 0, n) }
            }
            s.push(a, 0, first.videoStart(a, cut) + 400); drainTo()
            val before = got.size()
            s.connect(); drainTo()
            val second = TsTestStream(audioFrames = 8, audioDelay = 8 * TsTestStream.AUDIO_STEP, ccStart = 5)
            // From the keyframe on: no audio PES that starts before it.
            val all = second.frames(key - 20, key + 60)
            val b = all.copyOfRange(second.videoStart(all, key), all.size)
            s.push(b, 0, b.size); drainTo()
            val what = "cut $cut key $key: $log"
            if (s.lost != null) {
                assertEquals("a refused splice sends nothing: $what", before, got.size())
                continue
            }
            spliced++
            if (log.any { it.contains("earlier to continue the audio") }) earlier++
            val analysis = TsAnalysis(got.toByteArray(), first)
            assertEquals(what, (0 until cut).toList() + (key until key + 60).toList(), analysis.video.map { it.number })
            assertContinuous(analysis, analysis.video.map { it.number }, jumps = setOf(cut))
            assertTrue(what, analysis.video[cut].key)
            assertLipSync(analysis, first, what)
        }
        assertTrue("$spliced spliced", spliced > 100)
        assertTrue("$earlier moved the picture earlier to close an audio gap", earlier > 10)
    }

    @Test fun twoAudioStreamsOnAJumpBothContinueExactlyOrTheSpliceIsRefused() {
        var spliced = 0
        var refused = 0
        for (secondFrames in listOf(1, 8)) for (cut in 40..51) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            fun stream(cc: Int) = TsTestStream(audioFrames = 1, secondAudioPid = 0x102, secondFrames = secondFrames,
                audioDelay = 8 * TsTestStream.AUDIO_STEP, ccStart = cc)
            val first = stream(0)
            val a = first.frames(0, 60)
            val got = ByteArrayOutputStream()
            s.push(a, 0, first.videoStart(a, cut) + 400)
            val buffer = ByteArray(1 shl 20)
            got.write(buffer, 0, s.read(buffer, 0, buffer.size))
            s.connect()
            val b = stream(5).frames(cut + 29, cut + 120)
            s.push(b, 0, b.size)
            got.write(buffer, 0, s.read(buffer, 0, buffer.size))
            if (s.lost != null) { refused++; continue }
            spliced++
            val analysis = TsAnalysis(got.toByteArray(), first)
            assertEquals(emptyList<String>(), analysis.problems)
            for (frames in listOf(analysis.audio, analysis.second)) {
                for (i in 1 until frames.size) {
                    assertEquals("cut $cut: $log", TsTestStream.AUDIO_STEP, TsSplicer.ticksAfter(frames[i].pts, frames[i - 1].pts))
                }
            }
        }
        assertTrue("$spliced spliced", spliced > 0)
        assertTrue("$refused refused", refused > 0)
    }

    // ------------------------------------------------------------------ a reader reset just before the cut

    /**
     * A packet lost just before the connection went quiet: TsExtractor reset that stream's reader on the counter jump,
     * and the stream's next PES start never came. What the extractor has of it is unknown, so the cut is refused and
     * ExoPlayer starts over as in 1.6.2, rather than passing resent video or audio again (time going back, sound heard
     * twice) or resuming video on a frame that isn't a keyframe. The same cut without the loss splices.
     */
    @Test fun aStreamWhoseReaderWasResetJustBeforeTheCutIsNotSpliced() {
        val first = TsTestStream()
        val a = first.frames(0, 60)
        val at = first.videoStart(a, 45)
        val end = at + 5 * 188 // inside frame 45 (a P-frame; 48 is the next keyframe)
        // Video: the 3rd packet of frame 45 lost, the connection ends two packets later.
        val videoGap = a.copyOfRange(0, at + 2 * 188) + a.copyOfRange(at + 3 * 188, end)
        // Audio: the first packet of the last audio PES before frame 45 lost; its second one arrives.
        val audio = lastPesStart(a, first.audioPid, at)
        val audioGap = a.copyOfRange(0, audio) + a.copyOfRange(audio + 188, end)
        for ((what, head) in listOf("video" to videoGap, "audio" to audioGap, "no" to a.copyOf(end))) {
            for (from in listOf(38, 44, 47)) {
                val log = ArrayList<String>()
                val s = TsSplicer { log += it }
                val got = ByteArrayOutputStream()
                pump(s, head, got)
                val before = got.size()
                assertEquals("$what loss: whole packets went out", head.size, before)
                assertEquals("$what loss", what == "no", s.canSplice)
                s.connect(9_000)
                pump(s, TsTestStream(ccStart = 5).frames(from, 120), got)
                val case = "$what loss, new connection from frame $from: $log"
                if (what == "no") {
                    assertNull(case, s.lost)
                    val analysis = TsAnalysis(got.toByteArray(), first)
                    val video = analysis.video.map { it.number }
                    if (from < 45) assertContinuous(analysis, (0..119).toList())
                    else assertEquals(case, (0..44).toList() + (48..119).toList(), video)
                    continue
                }
                assertNotNull(case, s.lost)
                assertTrue(case, s.lost!!.contains("reset"))
                assertEquals("nothing of the new connection went out: $case", before, got.size())
            }
        }
    }

    // ------------------------------------------------------------------ after a rejoin has caught up

    /**
     * A programme boundary on a pass-through feed: the program map drops the second audio stream, or gives it another
     * stream type. TsExtractor reads one map and never another, so 1.6.2 played on; a rejoined connection that has
     * caught up plays on too, as the first connection does.
     */
    @Test fun programMapUpdatesAfterARejoinHasCaughtUpAreIgnored() {
        for (update in listOf("dropped", "retyped", "first connection")) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            val got = ByteArrayOutputStream()
            val first = TsTestStream(secondAudioPid = 0x102)
            val second = TsTestStream(secondAudioPid = 0x102, ccStart = 5)
            val tail: ByteArray
            if (update == "first connection") {
                pump(s, first.frames(0, 100), got)
                tail = first.frames(100, 160)
            } else {
                val a = first.frames(0, 60)
                pump(s, a.copyOf(first.videoStart(a, 50) + 400), got)
                s.connect()
                pump(s, second.frames(45, 100), got)
                assertNull(log.toString(), s.lost)
                assertFalse("caught up: $log", s.placing)
                tail = second.frames(100, 160)
            }
            val updated = when (update) {
                "retyped" -> TsTestStream.withPmt(tail, first.pmtPid, TsTestStream.retype(TsTestStream(secondAudioPid = 0x102).pmt(), 0x102, 0x81))
                else -> TsTestStream.withPmt(TsTestStream.withoutPid(tail, 0x102), first.pmtPid, TsTestStream().pmt())
            }
            val before = got.size()
            pump(s, updated, got)
            assertNull("$update: $log", s.changed)
            assertNull("$update: $log", s.lost)
            assertEquals("$update: all of it went out", updated.size, got.size() - before)
            val analysis = TsAnalysis(got.toByteArray(), first)
            assertContinuous(analysis, (0..159).toList())
            assertEquals((0 until analysis.audio.size).toList(), analysis.audioFrames())
            assertTrue(update, s.canSplice)
        }
    }

    /**
     * TsExtractor skips a packet flagged with transport_error_indicator, and the counter gap it leaves resets that
     * stream's reader, dropping the damaged frame. A connection that has caught up passes the packet on as it came, as
     * the first connection does, so the extractor sees the same gap rather than a frame with a hole in it.
     */
    @Test fun anErrorPacketAfterARejoinHasCaughtUpReachesTheExtractorAsItCame() {
        for (rejoined in listOf(false, true)) {
            val s = TsSplicer()
            val got = ByteArrayOutputStream()
            val first = TsTestStream()
            val stream: TsTestStream
            if (rejoined) {
                val a = first.frames(0, 60)
                pump(s, a.copyOf(first.videoStart(a, 50) + 400), got)
                s.connect()
                stream = TsTestStream(ccStart = 5)
                pump(s, stream.frames(45, 100), got)
                assertFalse(s.placing)
            } else {
                stream = first
                pump(s, first.frames(0, 100), got)
            }
            val tail = stream.frames(100, 140)
            val p = stream.videoStart(tail, 110) + 2 * 188
            tail[p + 1] = (tail[p + 1].toInt() or 0x80).toByte()
            val before = got.size()
            pump(s, tail, got)
            assertEquals(tail.size, got.size() - before)
            val analysis = TsAnalysis(got.toByteArray(), first)
            assertEquals(emptyList<String>(), analysis.problems)
            assertEquals("rejoined $rejoined", (0..109).toList() + (111..139).toList(), analysis.video.map { it.number })
            assertTrue("every video sample whole", analysis.video.all { it.complete })
            assertEquals(listOf(first.videoPid), analysis.resets)
            assertEquals((0 until analysis.audio.size).toList(), analysis.audioFrames())
        }
    }

    @Test fun aPesStillArrivingWhenARejoinCatchesUpIsNotHeldBack() {
        // A private data stream starts a PES of unknown length before the new connection has found its place, and sends
        // nothing more. Once the connection has caught up, it holds nothing back for it (an earlier version held the
        // whole stream behind it, then gave up after 8 MB).
        val first = TsTestStream(dataPid = 0x1F0, scale = 20)
        val a = first.frames(0, 60)
        feed(a, to = videoStart(a, first, 50) + 3000)
        connect()
        val second = TsTestStream(dataPid = 0x1F0, scale = 20, ccStart = 5)
        val open = ByteArray(188) { 0xFF.toByte() }
        byteArrayOf(0x47, 0x41, 0xF0.toByte(), 0x10, 0, 0, 1, 0xBD.toByte(), 0, 0, 0x80.toByte(), 0, 0).copyInto(open)
        val b = second.frames(45, 47) + open + second.frames(47, 400)
        assertTrue("${b.size} bytes", b.size > TsSplicer.HOLD_LIMIT + 1024 * 1024)
        feed(b)
        assertNull(logs.toString(), splicer.lost)
        assertFalse(splicer.placing)
        val bytes = out.toByteArray()
        assertContinuous(TsAnalysis(bytes, first), (0..399).toList())
        val starts = (0 until bytes.size / 188).count { pidAt(bytes, it * 188) == 0x1F0 && (bytes[it * 188 + 1].toInt() and 0x40) != 0 }
        assertEquals("the data PES went out", 1, starts)
    }

    // ------------------------------------------------------------------ other streams

    @Test fun programMapChangeCannotBeSpliced() {
        val first = TsTestStream()
        val a = first.frames(0, 30)
        feed(a, to = videoStart(a, first, 25) + 50)
        connect()
        val before = out.size()
        feed(TsTestStream(videoPid = 0x200, audioPid = 0x201).frames(0, 30))
        assertNotNull(splicer.changed)
        assertTrue(splicer.changed!!, splicer.changed!!.contains("256"))
        assertEquals("nothing of the other program went out", before, out.size())
    }

    @Test fun streamTypeChangeCannotBeSpliced() {
        val first = TsTestStream()
        val a = first.frames(0, 30)
        feed(a, to = videoStart(a, first, 25))
        connect()
        val other = TsTestStream().frames(0, 30)
        // The same PIDs, but the PMT now says H.265 for the video PID (PMT CRC recomputed).
        val pmt = TsTestStream().pmt()
        val patched = pmt.copyOf()
        val i = (0 until 188 - 5).first { patched[it].toInt() == 0x1B && patched[it + 2].toInt() == 0x00 }
        patched[i] = 0x24
        val end = 5 + 3 + (((patched[6].toInt() and 0x0F) shl 8) or (patched[7].toInt() and 0xFF))
        val crc = TsTestStream.crc32(patched.copyOfRange(5, end - 4))
        for (k in 0 until 4) patched[end - 4 + k] = (crc ushr (24 - 8 * k)).toByte()
        for (k in 0 until other.size / 188) if (other.copyOfRange(k * 188, k * 188 + 188).contentEquals(pmt)) patched.copyInto(other, k * 188)
        feed(other)
        assertTrue(splicer.changed.toString(), splicer.changed?.contains("stream type") == true)
    }

    /**
     * Media3 decodes stream type 0x80 (DigiCipher II) as MPEG-2 video, as it does 0x02. The splice must place it as
     * video: a jump resumes it on a keyframe, a resend completes the frame being read and repeats nothing (an earlier
     * version took it for data, placed the jump by the audio, and passed resent pictures again).
     */
    @Test fun videoListedAsDigiCipherMpeg2IsPlacedAsVideo() {
        for (jump in listOf(true, false)) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            val first = TsTestStream(videoType = 0x80)
            val a = first.frames(0, 60)
            val got = ByteArrayOutputStream()
            pump(s, a.copyOf(first.videoStart(a, 46) + 300), got)
            s.connect()
            pump(s, TsTestStream(videoType = 0x80, ccStart = 3).frames(if (jump) 70 else 38, 150), got)
            assertNull(log.toString(), s.lost)
            val analysis = TsAnalysis(got.toByteArray(), first)
            if (jump) {
                assertContinuous(analysis, (0..45).toList() + (72..149).toList(), jumps = setOf(46))
                assertTrue("resumes on a keyframe", analysis.video[46].key)
            } else {
                assertContinuous(analysis, (0..149).toList())
            }
        }
    }

    /**
     * Only the anchor's video is placed by keyframes and caught up exactly: a second video stream would resume on any
     * frame after a jump, or pass resent pictures again after a resend. Once a second one has played, no splice.
     */
    @Test fun twoVideoStreamsThatPlayedAreNotSpliced() {
        for (second in listOf(true, false)) {
            val log = ArrayList<String>()
            val s = TsSplicer { log += it }
            val first = TsTestStream(secondVideoPid = 0x110)
            fun sent(bytes: ByteArray) = if (second) bytes else TsTestStream.withoutPid(bytes, 0x110)
            val a = sent(first.frames(0, 60))
            val got = ByteArrayOutputStream()
            pump(s, a.copyOf(first.videoStart(a, 45) + 300), got)
            assertEquals("second video stream sent: $second", !second, s.canSplice)
            val before = got.size()
            s.connect()
            pump(s, sent(TsTestStream(secondVideoPid = 0x110, ccStart = 5).frames(38, 100)), got)
            if (second) {
                assertTrue(log.toString(), s.lost?.contains("video") == true)
                assertEquals("nothing of the new connection went out", before, got.size())
            } else {
                assertNull(log.toString(), s.lost)
                assertContinuous(TsAnalysis(got.toByteArray(), first), (0..99).toList())
            }
        }
    }

    @Test fun missingAnchorStreamCannotBeSpliced() {
        val first = TsTestStream()
        val a = first.frames(0, 30)
        feed(a, to = videoStart(a, first, 25))
        connect()
        // The same map, but the video never comes: audio only for 10 s.
        val other = TsTestStream()
        val audioOnly = ByteArrayOutputStream()
        audioOnly.write(other.pat()); audioOnly.write(other.pmt())
        for (k in 0 until 500) audioOnly.write(other.audio(k))
        feed(audioOnly.toByteArray())
        assertTrue(splicer.changed.toString(), splicer.changed?.contains("anchor") == true)
    }

    @Test fun keyframeRulesMatchMedia3() {
        fun nal(vararg bytes: Int) = bytes.map { it.toByte() }.toByteArray()
        assertEquals(true, TsSplicer.h264Keyframe(nal(0, 0, 1, 0x09, 0xF0, 0, 0, 1, 0x65, 0x88), 10))
        // A non-IDR NAL: first_mb 0, slice_type 7 (I) -> keyframe; slice_type 5 (P) -> not.
        assertEquals(true, TsSplicer.h264Keyframe(nal(0, 0, 1, 0x41, 0b1000_1000, 0x80), 6))
        assertEquals(true, TsSplicer.h264Keyframe(nal(0, 0, 1, 0x41, 0b1011_0000), 5))
        assertEquals(false, TsSplicer.h264Keyframe(nal(0, 0, 1, 0x41, 0b1001_1000), 5))
        assertNull(TsSplicer.h264Keyframe(nal(0, 0, 1, 0x09, 0xF0, 0, 0, 1, 0x67, 0x42), 10))
        assertEquals(true, TsSplicer.h265Keyframe(nal(0, 0, 1, 0x26, 0x01), 5)) // IDR_W_RADL (19)
        assertEquals(true, TsSplicer.h265Keyframe(nal(0, 0, 1, 0x2A, 0x01), 5)) // CRA (21)
        assertEquals(false, TsSplicer.h265Keyframe(nal(0, 0, 1, 0x02, 0x01), 5)) // TRAIL_R (1)
        assertNull(TsSplicer.h265Keyframe(nal(0, 0, 1, 0x40, 0x01), 5)) // VPS
        assertEquals(true, TsSplicer.mpeg2Keyframe(nal(0, 0, 1, 0xB3, 0, 0), 6))
        assertEquals(false, TsSplicer.mpeg2Keyframe(nal(0, 0, 1, 0x00, 0x00, 0x10), 6))
    }

    @Test fun timestampsSurviveTheRoundTrip() {
        val p = ByteArray(10)
        p[0] = 0x31
        for (t in listOf(0L, 1L, 90_000L, TsSplicer.WRAP - 1, 0x1_2345_6789L and (TsSplicer.WRAP - 1))) {
            TsSplicer.writeStamp(p, 0, t)
            assertEquals(t, TsSplicer.readStamp(p, 0))
            assertEquals(0x30, p[0].toInt() and 0xF0)
        }
        assertEquals(-3600L, TsSplicer.ticksAfter(10, 3610))
        assertEquals(20L, TsSplicer.ticksAfter(10, TsSplicer.WRAP - 10))
    }

    private fun pidAt(b: ByteArray, p: Int) = TsTestStream.pidAt(b, p)

    /** Where the first PES on [pid] at or after byte [from] of [a] starts. */
    private fun pesStart(a: ByteArray, pid: Int, from: Int): Int =
        (from / 188 until a.size / 188).map { it * 188 }.first { pidAt(a, it) == pid && (a[it + 1].toInt() and 0x40) != 0 }

    /**
     * Where [b] (the same stream resent, with other continuity counters) has the packet on [pid] that [a] has first at
     * or after byte [from]: the same PES (found by its first packet, which carries its timestamps), as many packets in.
     */
    private fun samePacket(a: ByteArray, from: Int, pid: Int, b: ByteArray): Int {
        val target = (from / 188 until a.size / 188).map { it * 188 }.first { pidAt(a, it) == pid }
        val head = (target downTo 0 step 188).first { pidAt(a, it) == pid && (a[it + 1].toInt() and 0x40) != 0 }
        val index = (head until target step 188).count { pidAt(a, it) == pid }
        val start = (0 until b.size step 188).first { q -> (4 until 188).all { b[q + it] == a[head + it] } && b[q + 1] == a[head + 1] }
        return (start until b.size step 188).filter { pidAt(b, it) == pid }[index]
    }

    /** Where the last PES on [pid] before byte [before] of [a] starts. */
    private fun lastPesStart(a: ByteArray, pid: Int, before: Int): Int =
        (0 until before / 188).map { it * 188 }.last { pidAt(a, it) == pid && (a[it + 1].toInt() and 0x40) != 0 }

    /** Pushes [bytes] into [s] in uneven chunks, reading everything finished into [got] after each one. */
    private fun pump(s: TsSplicer, bytes: ByteArray, got: ByteArrayOutputStream) {
        var i = 0
        val buffer = ByteArray(65536)
        while (i < bytes.size) {
            val n = minOf(bytes.size - i, 1 + random.nextInt(5000))
            s.push(bytes, i, n)
            i += n
            while (true) { val r = s.read(buffer, 0, buffer.size); if (r <= 0) break; got.write(buffer, 0, r) }
        }
    }

    /** Where in [a] to cut so the connection ends inside an audio PES, near video frame [frame]. */
    private fun audioCut(a: ByteArray, stream: TsTestStream, frame: Int): Int {
        var p = stream.videoStart(a, frame)
        while (true) {
            val pid = ((a[p + 1].toInt() and 0x1F) shl 8) or (a[p + 2].toInt() and 0xFF)
            if (pid == stream.audioPid && (a[p + 1].toInt() and 0x40) != 0) return p + 188 * 3 + 100
            p += 188
        }
    }

    companion object {
        /**
         * Whole video samples one frame apart, except where a jump resumes ([jumps]: indexes into the video that came
         * out): there the picture may move by up to [TsSplicer.JUMP_SLACK] so that the audio continues exactly. Audio is
         * seamless throughout: each frame starts where the one before it ended, never overlapping it or leaving a gap.
         */
        fun assertContinuous(a: TsAnalysis, frames: List<Int>, jumps: Set<Int> = emptySet()) {
            assertEquals(emptyList<String>(), a.problems)
            assertEquals(frames, a.video.map { it.number })
            assertTrue("every video sample whole", a.video.all { it.complete })
            for (i in 1 until a.video.size) {
                val pts = TsSplicer.ticksAfter(a.video[i].pts, a.video[i - 1].pts)
                val dts = TsSplicer.ticksAfter(a.video[i].dts, a.video[i - 1].dts)
                if (i in jumps) {
                    val slack = TsSplicer.JUMP_SLACK
                    assertTrue("video PTS step $pts at ${a.video[i].number}", pts in TsTestStream.VIDEO_STEP - slack..TsTestStream.VIDEO_STEP + slack)
                    assertEquals("video DTS step at ${a.video[i].number}", pts, dts)
                } else {
                    assertEquals("video PTS step at ${a.video[i].number}", TsTestStream.VIDEO_STEP, pts)
                    assertEquals("video DTS step at ${a.video[i].number}", TsTestStream.VIDEO_STEP, dts)
                }
            }
            for (i in 1 until a.audio.size) {
                val step = TsSplicer.ticksAfter(a.audio[i].pts, a.audio[i - 1].pts)
                assertEquals("audio step at ${a.audio[i].number}/${a.audio[i].index}", TsTestStream.AUDIO_STEP, step)
            }
        }

        /** The new connection's audio and video moved by the same amount: what plays together was recorded together. */
        fun assertLipSync(a: TsAnalysis, stream: TsTestStream, what: String) {
            val videoShift = a.video.map { TsSplicer.ticksAfter(stream.videoPts(it.number), it.pts) }.toSet()
            val audioShift = a.audio.map {
                TsSplicer.ticksAfter(TsSplicer.wrap(stream.audioPts(it.number) + it.index * TsTestStream.AUDIO_STEP), it.pts)
            }.toSet()
            assertEquals(what, videoShift, audioShift)
        }
    }
}
