package tv.lumanest.tuner.player

import java.io.ByteArrayOutputStream

/**
 * Synthetic live MPEG-TS for the splice tests: PAT, PMT (H.264 video, AAC audio), one video PES per frame with PTS and
 * DTS, PCR and random_access_indicator on keyframes, an IDR (or P slice) after a real SPS and PPS, and [audioFrames] ADTS
 * frames per audio PES. Every video frame and audio frame carries its number, so a test can tell which came out and
 * whether whole.
 */
class TsTestStream(
    val videoPid: Int = 0x100,
    val audioPid: Int = 0x101,
    val pmtPid: Int = 0x1000,
    /** Video PTS/DTS of frame 0 (ticks); the audio clock starts there too. Set it to restart the clock mid-stream. */
    var base: Long = 900_000L,
    /** A keyframe every [gop] frames. */
    val gop: Int = 12,
    /** Continuity counters of a new connection start anywhere. */
    ccStart: Int = 0,
    /** Mark keyframes with random_access_indicator. */
    val marked: Boolean = true,
    /** ADTS frames per audio PES: ffmpeg's muxer packs about 2930 bytes, 8 or 9 AAC frames at 128 kbps. */
    val audioFrames: Int = 1,
    /** How long after its first frame's time an audio PES is written: ffmpeg writes one once it is full. */
    val audioDelay: Long = 0,
    /** Keyframes in two PES with the same PTS and DTS: the SPS and PPS in one, the IDR slice in the next. */
    val splitKeyframes: Boolean = false,
    /** A second AAC stream on this PID (0 for none), with [secondFrames] frames per PES. */
    val secondAudioPid: Int = 0,
    val secondFrames: Int = 1,
    /** The byte that pads each frame: another value makes other pictures with the same timestamps (another encode). */
    val filler: Int = 0xA5,
    /** The sequence parameter set keyframes carry. */
    val sps: ByteArray = SPS,
    /** Frames this many times larger, for a higher bitrate. */
    val scale: Int = 1,
    /** A private data stream (stream type 0x06, no descriptors) the program map lists on this PID (0 for none). */
    val dataPid: Int = 0,
    /** The stream type the program map gives the video (the pictures are H.264 whatever it says). */
    val videoType: Int = 0x1B,
    /** A second H.264 stream on this PID (0 for none), carrying the same pictures. */
    val secondVideoPid: Int = 0,
) {
    private val cc = IntArray(8192) { ccStart and 0x0F }

    /** Time from one audio PES to the next: its duration. */
    val audioStep: Long = AUDIO_STEP * audioFrames

    fun videoDts(frame: Int): Long = TsSplicer.wrap(base + frame * VIDEO_STEP)
    fun videoPts(frame: Int): Long = TsSplicer.wrap(videoDts(frame) + VIDEO_STEP)
    fun audioPts(k: Int): Long = TsSplicer.wrap(base + k * audioStep)
    fun isKey(frame: Int) = frame % gop == 0

    /** Payload bytes of video frame [frame]. */
    fun sizeOf(frame: Int): Int = videoSize(frame) * scale

    /**
     * Frames [from] until [to]: tables first and every 10 frames, then each frame's video PES and the audio PES due to be
     * written by the next frame (those starting by then, or [audioDelay] earlier).
     */
    fun frames(from: Int, to: Int): ByteArray {
        val out = ByteArrayOutputStream()
        for (n in from until to) {
            if (n == from || n % 10 == 0) { out.write(pat()); out.write(pmt()) }
            out.write(video(n))
            if (secondVideoPid != 0) out.write(video(n, secondVideoPid))
            for (k in firstAudio(n) until firstAudio(n + 1)) out.write(audio(k))
            if (secondAudioPid != 0) for (k in firstAudio(n, secondStep) until firstAudio(n + 1, secondStep)) out.write(second(k))
        }
        return out.toByteArray()
    }

    fun firstAudio(frame: Int, step: Long = audioStep): Int = maxOf(0L, -Math.floorDiv(audioDelay - frame * VIDEO_STEP, step)).toInt()

    /** Time from one PES of the second audio stream to the next. */
    val secondStep: Long = AUDIO_STEP * secondFrames

    /** Byte offset in [bytes] (made by this stream's clock) where [frame]'s video PES starts. */
    fun videoStart(bytes: ByteArray, frame: Int): Int {
        for (i in 0 until bytes.size / 188) {
            val p = i * 188
            val pid = ((bytes[p + 1].toInt() and 0x1F) shl 8) or (bytes[p + 2].toInt() and 0xFF)
            if (pid != videoPid || (bytes[p + 1].toInt() and 0x40) == 0) continue
            val at = if ((bytes[p + 3].toInt() and 0x20) != 0) p + 5 + (bytes[p + 4].toInt() and 0xFF) else p + 4
            if (TsSplicer.readStamp(bytes, at + 14) == videoDts(frame)) return p
        }
        error("frame $frame not found")
    }

    fun pat(): ByteArray {
        val s = ByteArrayOutputStream()
        s.write(0x00) // table_id
        val body = byteArrayOf(0x00, 0x01, 0xC1.toByte(), 0x00, 0x00, // transport_stream_id, version 0 current, section 0/0
            0x00, 0x01, (0xE0 or (pmtPid shr 8)).toByte(), (pmtPid and 0xFF).toByte())
        return section(0, s, body)
    }

    fun pmt(): ByteArray {
        val s = ByteArrayOutputStream()
        s.write(0x02)
        val body = ByteArrayOutputStream()
        body.write(byteArrayOf(0x00, 0x01, 0xC1.toByte(), 0x00, 0x00,
            (0xE0 or (videoPid shr 8)).toByte(), (videoPid and 0xFF).toByte(), // PCR PID
            0xF0.toByte(), 0x00))
        body.write(byteArrayOf(videoType.toByte(), (0xE0 or (videoPid shr 8)).toByte(), (videoPid and 0xFF).toByte(), 0xF0.toByte(), 0x00))
        if (secondVideoPid != 0) {
            body.write(byteArrayOf(0x1B, (0xE0 or (secondVideoPid shr 8)).toByte(), (secondVideoPid and 0xFF).toByte(), 0xF0.toByte(), 0x00))
        }
        body.write(byteArrayOf(0x0F, (0xE0 or (audioPid shr 8)).toByte(), (audioPid and 0xFF).toByte(), 0xF0.toByte(), 0x00))
        if (secondAudioPid != 0) {
            body.write(byteArrayOf(0x0F, (0xE0 or (secondAudioPid shr 8)).toByte(), (secondAudioPid and 0xFF).toByte(), 0xF0.toByte(), 0x00))
        }
        if (dataPid != 0) body.write(byteArrayOf(0x06, (0xE0 or (dataPid shr 8)).toByte(), (dataPid and 0xFF).toByte(), 0xF0.toByte(), 0x00))
        return section(pmtPid, s, body.toByteArray())
    }

    private fun section(pid: Int, head: ByteArrayOutputStream, body: ByteArray): ByteArray {
        val length = body.size + 4
        head.write(0xB0 or (length shr 8))
        head.write(length and 0xFF)
        head.write(body)
        val sectionBytes = head.toByteArray()
        val crc = crc32(sectionBytes)
        val payload = ByteArrayOutputStream()
        payload.write(0) // pointer_field
        payload.write(sectionBytes)
        payload.write(byteArrayOf((crc ushr 24).toByte(), (crc ushr 16).toByte(), (crc ushr 8).toByte(), crc.toByte()))
        val p = ByteArray(188) { 0xFF.toByte() }
        p[0] = 0x47
        p[1] = (0x40 or (pid shr 8)).toByte()
        p[2] = (pid and 0xFF).toByte()
        p[3] = (0x10 or next(pid)).toByte()
        payload.toByteArray().copyInto(p, 4)
        return p
    }

    fun video(frame: Int, pid: Int = videoPid): ByteArray {
        val pcr = if (pid == videoPid) TsSplicer.wrap(videoDts(frame) - 9000) else null
        val es = ByteArrayOutputStream()
        es.write(byteArrayOf(0, 0, 0, 1, 0x09, 0xF0.toByte())) // access unit delimiter
        if (isKey(frame)) {
            es.write(byteArrayOf(0, 0, 0, 1)); es.write(sps)
            es.write(byteArrayOf(0, 0, 0, 1)); es.write(PPS)
        }
        if (splitKeyframes && isKey(frame)) {
            // The parameter sets go in a PES of their own; the slice follows in a second PES with the same timestamps.
            val head = pes(0xE0, es.toByteArray(), videoPts(frame), videoDts(frame), bounded = false)
            val rest = ByteArrayOutputStream()
            rest.write(byteArrayOf(0, 0, 0, 1))
            rest.write(slice(frame))
            rest.write(marker(frame))
            repeat(sizeOf(frame) - es.size() - rest.size()) { rest.write(filler) }
            val tail = pes(0xE0, rest.toByteArray(), videoPts(frame), videoDts(frame), bounded = false)
            return packetize(pid, head, pcr = pcr, rai = marked) + packetize(pid, tail, pcr = null, rai = false)
        }
        es.write(byteArrayOf(0, 0, 0, 1))
        es.write(slice(frame))
        es.write(marker(frame))
        val padding = sizeOf(frame) - es.size()
        repeat(padding) { es.write(filler) }
        val pes = pes(0xE0, es.toByteArray(), videoPts(frame), videoDts(frame), bounded = false)
        return packetize(pid, pes, pcr = pcr, rai = marked && isKey(frame))
    }

    fun audio(k: Int): ByteArray = packetize(audioPid, pes(0xC0, adts(k, audioFrames), audioPts(k), -1, bounded = true), pcr = null, rai = false)

    fun audioPts(k: Int, step: Long): Long = TsSplicer.wrap(base + k * step)

    /** PES [k] of the second audio stream. */
    fun second(k: Int): ByteArray =
        packetize(secondAudioPid, pes(0xC1, adts(k, secondFrames), audioPts(k, secondStep), -1, bounded = true), pcr = null, rai = false)

    /** [frames] ADTS frames, each marked with the PES number [k] and its index in the PES. */
    fun adts(k: Int, frames: Int): ByteArray {
        val frameLength = 7 + AUDIO_PAYLOAD
        val adts = ByteArray(frameLength * frames) { 0x5A }
        for (f in 0 until frames) {
            val at = f * frameLength
            adts[at] = 0xFF.toByte()
            adts[at + 1] = 0xF1.toByte() // MPEG-4, layer 0, no CRC
            adts[at + 2] = ((1 shl 6) or (3 shl 2) or 0).toByte() // AAC LC, 48 kHz, channel config high bit 0
            adts[at + 3] = ((2 shl 6) or ((frameLength shr 11) and 0x03)).toByte() // 2 channels
            adts[at + 4] = ((frameLength shr 3) and 0xFF).toByte()
            adts[at + 5] = (((frameLength and 0x07) shl 5) or 0x1F).toByte()
            adts[at + 6] = 0xFC.toByte()
            // The audio PES's number, for the tests, where no sync word can appear.
            adts[at + 7] = (0x80 or ((k shr 14) and 0x7F)).toByte()
            adts[at + 8] = (0x80 or ((k shr 7) and 0x7F)).toByte()
            adts[at + 9] = (0x80 or (k and 0x7F)).toByte()
            adts[at + 10] = (0x80 or f).toByte()
        }
        return adts
    }

    fun slice(frame: Int): ByteArray {
        val bits = BitWriter()
        val key = isKey(frame)
        bits.u(8, if (key) 0x65 else 0x41) // IDR or non-IDR slice NAL header
        bits.ue(0) // first_mb_in_slice
        bits.ue(if (key) 7 else 5) // I or P (all slices)
        bits.ue(0) // pic_parameter_set_id
        bits.u(4, frame and 0x0F) // frame_num
        if (key) bits.ue(0) // idr_pic_id
        bits.u(1, 1) // stand-in for the rest of the slice
        return escape(bits.bytes())
    }

    fun pes(streamId: Int, payload: ByteArray, pts: Long, dts: Long, bounded: Boolean): ByteArray {
        val headerData = if (dts >= 0) 10 else 5
        val out = ByteArray(9 + headerData + payload.size)
        out[2] = 1
        out[3] = streamId.toByte()
        val length = if (bounded) 3 + headerData + payload.size else 0
        out[4] = (length shr 8).toByte(); out[5] = length.toByte()
        out[6] = 0x84.toByte() // data_alignment_indicator
        out[7] = if (dts >= 0) 0xC0.toByte() else 0x80.toByte()
        out[8] = headerData.toByte()
        out[9] = if (dts >= 0) 0x30 else 0x20
        TsSplicer.writeStamp(out, 9, pts)
        if (dts >= 0) { out[14] = 0x10; TsSplicer.writeStamp(out, 14, dts) }
        payload.copyInto(out, 9 + headerData)
        return out
    }

    fun packetize(pid: Int, pes: ByteArray, pcr: Long?, rai: Boolean): ByteArray {
        val out = ByteArrayOutputStream()
        var i = 0
        var first = true
        while (i < pes.size) {
            val withPcr = first && pcr != null
            val withRai = first && rai
            val capacity = 184 - (if (withPcr) 8 else if (withRai) 2 else 0)
            val count = minOf(capacity, pes.size - i)
            out.write(packet(pid, first, pes, i, count, if (withPcr) pcr else null, withRai))
            i += count
            first = false
        }
        return out.toByteArray()
    }

    private fun packet(pid: Int, start: Boolean, data: ByteArray, from: Int, count: Int, pcr: Long?, rai: Boolean): ByteArray {
        val p = ByteArray(188)
        p[0] = 0x47
        p[1] = ((if (start) 0x40 else 0) or (pid shr 8)).toByte()
        p[2] = (pid and 0xFF).toByte()
        val adaptation = pcr != null || rai || count < 184
        p[3] = ((if (adaptation) 0x30 else 0x10) or next(pid)).toByte()
        if (adaptation) {
            val length = 183 - count
            p[4] = length.toByte()
            if (length > 0) {
                p[5] = ((if (rai) 0x40 else 0) or (if (pcr != null) 0x10 else 0)).toByte()
                var j = 6
                if (pcr != null) {
                    p[6] = (pcr ushr 25).toByte(); p[7] = (pcr ushr 17).toByte(); p[8] = (pcr ushr 9).toByte()
                    p[9] = (pcr ushr 1).toByte(); p[10] = (((pcr and 1) shl 7) or 0x7E).toByte(); p[11] = 0
                    j = 12
                }
                while (j < 5 + length) p[j++] = 0xFF.toByte()
            }
        }
        data.copyInto(p, 188 - count, from, from + count)
        return p
    }

    private fun next(pid: Int): Int {
        val v = cc[pid]
        cc[pid] = (v + 1) and 0x0F
        return v
    }

    companion object {
        const val VIDEO_STEP = 3600L // 25 fps
        const val AUDIO_STEP = 1920L // 1024 samples at 48 kHz
        const val AUDIO_PAYLOAD = 300

        fun videoSize(frame: Int): Int = if (frame % 12 == 0) 4000 else 900 + (frame % 7) * 130

        /** Baseline 320x240: poc type 2, 4-bit frame_num. */
        val SPS: ByteArray = sps(19, 14)
        /** The same at 640x480: another encode. */
        val SPS_640: ByteArray = sps(39, 29)

        private fun sps(widthMbs: Int, heightMbs: Int): ByteArray = BitWriter().run {
            u(8, 0x67); u(8, 66); u(8, 0xC0); u(8, 30)
            ue(0); ue(0); ue(2); ue(1); u(1, 0); ue(widthMbs); ue(heightMbs); u(1, 1); u(1, 1); u(1, 0); u(1, 0)
            trailing(); escape(bytes())
        }
        val PPS: ByteArray = BitWriter().run {
            u(8, 0x68); ue(0); ue(0); u(1, 0); u(1, 0); ue(0); ue(0); ue(0); u(1, 0); u(2, 0); se(0); se(0); se(0)
            u(1, 1); u(1, 0); u(1, 0); trailing(); escape(bytes())
        }

        fun marker(frame: Int) = byteArrayOf(0xFF.toByte(), 0xFE.toByte(),
            (0x80 or ((frame shr 14) and 0x7F)).toByte(), (0x80 or ((frame shr 7) and 0x7F)).toByte(), (0x80 or (frame and 0x7F)).toByte())

        fun escape(rbsp: ByteArray): ByteArray {
            val out = ByteArrayOutputStream()
            var zeros = 0
            for (b in rbsp) {
                val v = b.toInt() and 0xFF
                if (zeros >= 2 && v <= 3) { out.write(3); zeros = 0 }
                out.write(v)
                zeros = if (v == 0) zeros + 1 else 0
            }
            return out.toByteArray()
        }

        fun crc32(data: ByteArray): Int {
            var crc = -1
            for (b in data) {
                crc = crc xor ((b.toInt() and 0xFF) shl 24)
                repeat(8) { crc = if (crc < 0) (crc shl 1) xor 0x04C11DB7 else crc shl 1 }
            }
            return crc
        }

        fun pidAt(b: ByteArray, p: Int) = ((b[p + 1].toInt() and 0x1F) shl 8) or (b[p + 2].toInt() and 0xFF)

        /** [bytes] without the packets of [pid]. */
        fun withoutPid(bytes: ByteArray, pid: Int): ByteArray {
            val out = ByteArrayOutputStream()
            for (p in 0 until bytes.size step 188) if (pidAt(bytes, p) != pid) out.write(bytes, p, 188)
            return out.toByteArray()
        }

        /** [bytes] with every packet on [pmtPid] replaced by [pmt], keeping each one's continuity counter. */
        fun withPmt(bytes: ByteArray, pmtPid: Int, pmt: ByteArray): ByteArray {
            val out = bytes.copyOf()
            for (p in 0 until out.size step 188) {
                if (pidAt(out, p) != pmtPid) continue
                val cc = out[p + 3].toInt() and 0x0F
                pmt.copyInto(out, p)
                out[p + 3] = ((out[p + 3].toInt() and 0xF0) or cc).toByte()
            }
            return out
        }

        /** A PMT packet made by [pmt] that lists [pid] as stream [type] instead (its CRC recomputed). */
        fun retype(pmt: ByteArray, pid: Int, type: Int): ByteArray {
            val p = pmt.copyOf()
            val end = 5 + 3 + (((p[6].toInt() and 0x0F) shl 8) or (p[7].toInt() and 0xFF))
            var i = 17
            while (i + 5 <= end - 4) {
                if ((((p[i + 1].toInt() and 0x1F) shl 8) or (p[i + 2].toInt() and 0xFF)) == pid) p[i] = type.toByte()
                i += 5
            }
            val crc = crc32(p.copyOfRange(5, end - 4))
            for (k in 0 until 4) p[end - 4 + k] = (crc ushr (24 - 8 * k)).toByte()
            return p
        }
    }

    class BitWriter {
        private val out = ByteArrayOutputStream()
        private var current = 0
        private var count = 0
        fun u(n: Int, v: Int) { for (i in n - 1 downTo 0) bit((v shr i) and 1) }
        fun ue(v: Int) {
            val x = v + 1
            val len = 32 - Integer.numberOfLeadingZeros(x)
            repeat(len - 1) { bit(0) }
            u(len, x)
        }
        fun se(v: Int) = ue(if (v > 0) 2 * v - 1 else -2 * v)
        fun trailing() { bit(1); while (count != 0) bit(0) }
        fun bytes(): ByteArray { val copy = ByteArrayOutputStream(); copy.write(out.toByteArray()); if (count > 0) copy.write(current shl (8 - count)); return copy.toByteArray() }
        private fun bit(b: Int) {
            current = (current shl 1) or b
            if (++count == 8) { out.write(current); current = 0; count = 0 }
        }
    }
}

/**
 * What TsExtractor (MODE_SINGLE_PMT, as PlayerHolder sets it up) makes of the splicer's output: its continuity check (a
 * repeated packet is dropped; a jump resets the PID's reader, dropping what it was assembling), H.264 samples split at
 * access unit delimiters, and AdtsReader's audio samples (one per ADTS frame, timed from its PES).
 */
class TsAnalysis(bytes: ByteArray, val stream: TsTestStream) {
    /** A video sample. */
    class Pes(val pid: Int, val pts: Long, val dts: Long, val number: Int, val key: Boolean, val complete: Boolean, val rai: Boolean)

    /** An audio sample: one ADTS frame, with its PES number and its index in that PES. */
    class Frame(val pid: Int, val pts: Long, val number: Int, val index: Int)

    val problems = ArrayList<String>()
    val video = ArrayList<Pes>()
    val audio = ArrayList<Frame>()
    val second = ArrayList<Frame>()
    /** PIDs whose reader TsExtractor reset on a continuity jump, in output order. */
    val resets = ArrayList<Int>()
    val packets = bytes.size / 188

    private class Picture(val pts: Long, val dts: Long, val rai: Boolean) { val data = ByteArrayOutputStream() }
    private class Audio(val out: ArrayList<Frame>) {
        var time = -1L
        var pes = 0
        val pending = ByteArrayOutputStream()
        val from = ArrayList<Int>() // the PES each pending byte came from
    }

    private var picture: Picture? = null
    private val audios = HashMap<Int, Audio>()

    init {
        audios[stream.audioPid] = Audio(audio)
        if (stream.secondAudioPid != 0) audios[stream.secondAudioPid] = Audio(second)
        if (bytes.size % 188 != 0) problems += "output is ${bytes.size} bytes, not whole packets"
        val lastCc = HashMap<Int, Int>()
        for (i in 0 until packets) {
            val p = bytes.copyOfRange(i * 188, i * 188 + 188)
            if (p[0].toInt() != 0x47) { problems += "packet $i has no sync byte"; continue }
            if ((p[1].toInt() and 0x80) != 0) continue
            val pid = ((p[1].toInt() and 0x1F) shl 8) or (p[2].toInt() and 0xFF)
            val control = (p[3].toInt() shr 4) and 3
            if ((control and 1) == 0) continue
            val cc = p[3].toInt() and 0x0F
            val media = pid == stream.videoPid || pid in audios
            val prev = lastCc[pid]
            lastCc[pid] = cc
            if (prev != null) {
                if (cc == prev) continue // TsExtractor drops a repeated packet
                if (cc != ((prev + 1) and 0x0F)) {
                    if (!media) problems += "PID $pid continuity $prev -> $cc at packet $i"
                    else {
                        resets += pid
                        if (pid == stream.videoPid) picture = null
                        else audios[pid]!!.let { it.pending.reset(); it.from.clear(); it.time = -1 }
                    }
                }
            }
            if (!media) continue
            val at = if ((control and 2) != 0) 5 + (p[4].toInt() and 0xFF) else 4
            if (at >= 188) continue
            val start = (p[1].toInt() and 0x40) != 0
            val rai = (control and 2) != 0 && (p[4].toInt() and 0xFF) > 0 && (p[5].toInt() and 0x40) != 0
            if (pid == stream.videoPid) videoPacket(p, at, start, rai) else audioPacket(audios[pid]!!, pid, p, at, start)
        }
        picture?.let { finishPicture(it) }
        for ((pid, a) in audios) if (a.pending.size() > 0) problems += "PID $pid: ${a.pending.size()} audio bytes left over"
    }

    private fun videoPacket(p: ByteArray, at: Int, start: Boolean, rai: Boolean) {
        var from = at
        if (start) {
            if (p[at].toInt() != 0 || p[at + 1].toInt() != 0 || p[at + 2].toInt() != 1) { picture = null; return }
            val flags = (p[at + 7].toInt() and 0xFF) ushr 6
            val pts = TsSplicer.readStamp(p, at + 9)
            val dts = if (flags == 3) TsSplicer.readStamp(p, at + 14) else pts
            from = at + 9 + (p[at + 8].toInt() and 0xFF)
            // A new access unit starts at its delimiter; a PES without one continues the picture before it.
            val aud = from + 4 < 188 && p[from].toInt() == 0 && p[from + 1].toInt() == 0 && p[from + 2].toInt() == 0 &&
                p[from + 3].toInt() == 1 && p[from + 4].toInt() == 0x09
            if (aud) {
                picture?.let { finishPicture(it) }
                picture = Picture(pts, dts, rai)
            }
        }
        picture?.data?.write(p, from, 188 - from)
    }

    private fun finishPicture(pic: Picture) {
        val payload = pic.data.toByteArray()
        val m = indexOf(payload, byteArrayOf(0xFF.toByte(), 0xFE.toByte()))
        val number = if (m < 0) -1 else (((payload[m + 2].toInt() and 0x7F) shl 14) or ((payload[m + 3].toInt() and 0x7F) shl 7) or (payload[m + 4].toInt() and 0x7F))
        val key = TsSplicer.h264Keyframe(payload, payload.size) == true || indexOf(payload, byteArrayOf(0, 0, 1, 0x65)) >= 0
        val complete = number >= 0 && payload.size == stream.sizeOf(number)
        video += Pes(stream.videoPid, pic.pts, pic.dts, number, key, complete, pic.rai)
    }

    private fun audioPacket(a: Audio, pid: Int, p: ByteArray, at: Int, start: Boolean) {
        var from = at
        if (start) {
            if (p[at].toInt() != 0 || p[at + 1].toInt() != 0 || p[at + 2].toInt() != 1) return
            a.time = TsSplicer.readStamp(p, at + 9)
            a.pes++
            from = at + 9 + (p[at + 8].toInt() and 0xFF)
        }
        for (k in from until 188) { a.pending.write(p[k].toInt()); a.from += a.pes }
        while (true) {
            val b = a.pending.toByteArray()
            if (b.size < 7) return
            if ((b[0].toInt() and 0xFF) != 0xFF || (b[1].toInt() and 0xF6) != 0xF0) {
                problems += "PID $pid: audio out of sync"
                a.pending.reset(); a.from.clear()
                return
            }
            val size = ((b[3].toInt() and 0x03) shl 11) or ((b[4].toInt() and 0xFF) shl 3) or ((b[5].toInt() and 0xFF) ushr 5)
            if (b.size < size) return
            if (a.from[0] != a.from[size - 1]) problems += "PID $pid: an audio frame spans two PES"
            val number = ((b[7].toInt() and 0x7F) shl 14) or ((b[8].toInt() and 0x7F) shl 7) or (b[9].toInt() and 0x7F)
            a.out += Frame(pid, a.time, number, b[10].toInt() and 0x7F)
            a.time = TsSplicer.wrap(a.time + TsTestStream.AUDIO_STEP)
            a.pending.reset()
            a.pending.write(b, size, b.size - size)
            repeat(size) { a.from.removeAt(0) }
        }
    }

    /** PCR values of the video PID, in output order. */
    val pcrs: List<Long> = (0 until packets).mapNotNull { i ->
        val p = bytes.copyOfRange(i * 188, i * 188 + 188)
        val pid = ((p[1].toInt() and 0x1F) shl 8) or (p[2].toInt() and 0xFF)
        if (pid == stream.videoPid && TsSplicer.hasPcr(p)) TsSplicer.readPcr(p) else null
    }

    /** Audio frames as absolute frame numbers: PES number times frames per PES, plus the index. */
    fun audioFrames(perPes: Int = stream.audioFrames): List<Int> = audio.map { it.number * perPes + it.index }

    private fun indexOf(data: ByteArray, what: ByteArray): Int {
        outer@ for (i in 0..data.size - what.size) {
            for (j in what.indices) if (data[i + j] != what[j]) continue@outer
            return i
        }
        return -1
    }
}
