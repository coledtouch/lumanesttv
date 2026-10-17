package tv.lumanest.tuner.player

import java.util.zip.CRC32

/**
 * Joins the MPEG-TS of successive connections to one live channel into a single stream for Media3's TsExtractor.
 *
 * [LiveRejoin] replaces a provider connection that went quiet or dropped while ExoPlayer keeps reading, so one
 * extractor gets the bytes of several connections. Fed as they are, Media3 1.11.1 would lose or garble the frame at the
 * cut, and play time backwards after a resend (a provider's start-up burst) or leave a hole after a forward jump, because
 * ProgressiveMediaPeriod uses the stream's PTS as they are.
 *
 * The first connection is never touched: its bytes go out exactly as they come, in order, framed as TsExtractor frames
 * them (a packet starts at any sync byte), held back only while a packet that has started is incomplete (at most 187
 * bytes, so a cut never leaves half a packet in the extractor). Nothing on it is dropped, reordered or re-timed, as in
 * 1.6.2. Alongside, this class keeps a model of what TsExtractor (MODE_SINGLE_PMT) has made of those packets, per stream:
 * the PES it is reading and how much of it, the one before, its continuity counter checks (a repeat is dropped, a jump
 * resets the stream's reader), whole ADTS frames. A first connection that doesn't start with five whole packets (where
 * TsExtractor.sniff could start reading elsewhere) isn't modelled: it passes through untouched and is never spliced.
 *
 * A new connection is placed onto that state, or refused ([lost], [changed]) so that the caller lets ExoPlayer start over
 * exactly as 1.6.2 did. Nothing of a new connection goes out before its place is certain:
 * - a resend (the same clock, behind, at most [RESENT_LIMIT]): its copy of the PES the extractor was reading must
 *   match, byte for byte, what went out (a CRC of it), proving the same encode. What the extractor has is dropped, and
 *   the rest of that PES goes out as its continuation, so the frame or audio frame cut short is completed exactly and
 *   nothing is repeated or lost on any stream. A resend that doesn't reach that PES, differs, or whose continuity
 *   counter breaks where it continues (a packet lost, flagged with an error or repeated there), is refused;
 * - a forward jump on the same clock (no further ahead than the outage explains): continues from a keyframe (refused
 *   if none comes within [KEYFRAME_WAIT], or if its SPS or audio frame header differs: Media3 keeps the first format),
 *   shifted so that the audio continues exactly where the extractor's audio ends; the picture moves by at most
 *   [JUMP_SLACK] for it. The frame being read and a partial audio frame are discarded by a deliberate continuity counter
 *   jump, as TsExtractor does on a discontinuity; the frame before must be known to be whole. Every audio
 *   stream must continue exactly: otherwise DefaultAudioSink would play the overlap or gap (under 200 ms) back to back
 *   and leave the sound out of step with the picture for the rest of the session, so the splice is refused instead;
 * - anything else (a restarted clock, a different encode, another program map, no keyframe in time) is refused, and so
 *   is a cut while the extractor's reader of an audio or video stream is reset (a lost packet just before it): what
 *   the extractor has of that stream is then unknown.
 * A rejoined connection that has caught up passes on as it comes, with its continuity counters, timestamps and PCR
 * moved onto the extractor's timeline. Nothing of it is held back or re-timed beyond that, and its later program maps
 * are ignored, as TsExtractor ignores every program map after its first.
 *
 * Memory is bounded: at most [HOLD_LIMIT] bytes are held back while a connection is placed.
 * Single-threaded: the loading thread calls [push], [read], [connect] and [finish]. No Android dependencies.
 */
class TsSplicer(private val log: (String) -> Unit = {}) {

    /** Counts whole ADTS frames as the bytes of one PES go out, the way Media3's AdtsReader outputs them. */
    private class Adts {
        var ok = true
        var frames = 0
        var rate = 0
        private var at = 0
        private var end = -1
        private val header = ByteArray(7)
        private var length = 0

        /** [n] payload bytes from b[from], at payload offset [base]. */
        fun feed(b: ByteArray, from: Int, n: Int, base: Int) {
            val limit = base + n
            while (ok) {
                if (end < 0) {
                    while (length < 7 && at + length < limit) {
                        val i = at + length - base
                        if (i < 0) { ok = false; return }
                        header[length++] = b[from + i]
                    }
                    if (length < 7) return
                    if (u(header[0]) != 0xFF || (u(header[1]) and 0xF6) != 0xF0) { ok = false; return }
                    val size = ((u(header[3]) and 0x03) shl 11) or (u(header[4]) shl 3) or (u(header[5]) ushr 5)
                    val index = (u(header[2]) ushr 2) and 0x0F
                    if (size < 7 || index >= ADTS_RATES.size) { ok = false; return }
                    if (rate == 0) rate = ADTS_RATES[index] else if (rate != ADTS_RATES[index]) { ok = false; return }
                    end = at + size
                }
                if (end > limit) return
                frames++
                at = end
                end = -1
                length = 0
            }
        }
    }

    /** A PES as far as the extractor got it: its header and [es] bytes of its payload went out. Times on the output. */
    private class Sent(
        val dts: Long,
        val pts: Long,
        /** Its place on its stream: the DTS of the last timed PES (its own when it has one), and how many PES after it. */
        val keyDts: Long,
        val keyN: Int,
        /** The DTS of the frame before this PES's frame (its keyDts), or -1. */
        val frameBefore: Long,
        /** The first PES of this PES's frame (itself when [keyN] is 0). */
        head: Sent?,
        /** Payload bytes its header declares, or -1 (video). */
        val declared: Int,
        val adts: Adts?,
    ) {
        val head: Sent = head ?: this
        var es = 0
        val crc = CRC32()
        var complete = false
        /** Start codes in the payload that went out, counted to 2: the first NAL unit (the access unit delimiter) ended. */
        var startCodes = 0
        var zeros = 0
    }

    private class Track(val pid: Int, val type: Int) {
        val video = kindOf(type) == KIND_VIDEO
        val audio = kindOf(type) == KIND_AUDIO
        var count = 0
        /** The stream flags keyframes with random_access_indicator. */
        var marked = false
        /** Usual DTS distance between this stream's PES, and whether the last two were equal. */
        var step = 0L
        var steady = false
        var lastDts = -1L
        var lastConnection = 0
        /** The PES the extractor is reading, and the one before it (finished). */
        var cur: Sent? = null
        var prev: Sent? = null
        /** The continuity counter the extractor saw last on this PID, or -1. */
        var cc = -1
        var runDts = -1L
        var runN = 0
        /** The frame before the current one (its DTS), and the first PES of the current frame. */
        var frameBefore = -1L
        var frameHead: Sent? = null
        /** The first connection's codec configuration (video: SPS or sequence header; audio: a frame header). */
        var config: ByteArray? = null

        // A new connection: what the extractor had at the cut, and how this stream continues it.
        var cut: Sent? = null
        var cutEs = 0
        var cutCrc = 0L
        var before: Sent? = null
        /** Audio: where the extractor's audio ends at the cut (output PTS), or -1 when that isn't known exactly. */
        var end = -1L
        /** Video: the DTS of the last whole frame the extractor has at the cut, or -1 when that isn't certain. */
        var lastFrame = -1L
        var caught = true
        var dropping = false
        /** After a jump: the output time this stream's first kept PES must start at, or -1. */
        var align = -1L
        var inDts = -1L
        var inN = 0
    }

    /** A PES of a new connection, held while it is placed. Times on that connection's clock. */
    private class Pes(val track: Track, val first: ByteArray, val at: Int) {
        var flags = 0
        var dts = -1L
        var pts = -1L
        var keyDts = -1L
        var keyN = 0
        var key = false
        var declared = -1
        var received = 0
        var esStart = PACKET
        var packets = 0
        var complete = false
        var decision = PENDING
        var head: ByteArray? = null
        var headLength = 0
        /** This PES resends one the extractor has ([copyLength] bytes of it, with [copyCrc]); [checked] says if it matches. */
        var copyOf: Sent? = null
        var copyLength = 0
        var copyCrc = 0L
        var checked = 0
        var crc: CRC32? = null
        var crcBytes = 0
        /** Payload bytes handled by the continuation so far, in output order. */
        var copied = 0
    }

    private class Packet(val data: ByteArray, val pes: Pes?, val keep: Boolean)

    // Over all connections. Indexed by PID (arrays, not maps: a lookup per packet must not box the PID).
    private val tracks = arrayOfNulls<Track>(PIDS)
    private val trackList = ArrayList<Track>()
    private var lockedMap: Map<Int, Int>? = null
    private var lockedPmt = -1
    /** Ticks taken off the current connection's timestamps and PCR. */
    private var offset = 0L
    private val ccOut = IntArray(PIDS) { -1 }
    private val ccDelta = IntArray(PIDS)
    private val ccConnection = IntArray(PIDS)
    private val ccSkipped = BooleanArray(PIDS)
    private val ccBreak = BooleanArray(PIDS)
    /** The source counter of the last packet of a resent PES skipped because the extractor has it, or -1. */
    private val copyCc = IntArray(PIDS) { -1 }
    /** The output so far ends on a whole packet. */
    private var tidy = true
    private var synced = false
    /** Bytes of the first connection passed on so far. */
    private var passed = 0L

    /**
     * The first connection doesn't start as 188-byte TS (five whole packets from its first byte): bytes pass untouched,
     * and a cut can't be spliced.
     */
    var raw = false
        private set
    var connections = 1
        private set
    /**
     * The new connection carries other streams (another program map) while it is being placed. Sticky: the caller lets
     * ExoPlayer start over. Never set once the connection has caught up (see [tables]).
     */
    var changed: String? = null
        private set
    /** Why the new connection can't be placed exactly, or null. The caller lets ExoPlayer start over. */
    var lost: String? = null
        private set
    /** Bytes handed out by [read], over all connections. */
    var delivered = 0L
        private set

    /**
     * A new connection could continue the stream: it is MPEG-TS whose program map was read (as TsExtractor read it),
     * the extractor has finished at least one PES of the stream that would place it, it is reading a PES on every
     * audio and video stream that has played (see [resetStream]), and at most one video stream has played.
     */
    val canSplice: Boolean
        get() = !raw && changed == null && lost == null && lockedMap != null && tidy && resetStream() == null &&
            !twoVideos() && pickAnchor()?.prev != null

    /** A new connection hasn't found its place yet, or is still catching up with the extractor. */
    val placing: Boolean get() = connections > 1 && changed == null && lost == null && !settled

    /** How the program map that was read lists [pid]: [KIND_VIDEO], [KIND_AUDIO] or [KIND_OTHER] (also when it isn't). */
    internal fun streamKind(pid: Int): Int = tracks[pid]?.let { kindOf(it.type) } ?: KIND_OTHER

    // This connection.
    private var anchor: Track? = null
    private var placed = true
    private var settled = true
    private var mode = UNDECIDED
    private var cutOffset = 0L
    private var jumpLimit = JUMP_LIMIT
    private var found = false
    private var keyWait = -1L
    private val group = ArrayList<Pes>()
    private var jumpKey: Pes? = null
    private var jumpShift = 0L
    private var primary: Track? = null
    private var probeTrack: Track? = null
    private var probeDts = -1L
    private var anchorBytes = 0L
    private var wasted = 0L
    private val units = arrayOfNulls<Pes>(PIDS)
    private val waiting = ArrayDeque<Pes>()
    private var pmts: Set<Int>? = null
    private var resent = 0
    private var spliceGap = 0L
    private var beforeVerified = false

    // Held packets, in arrival order, and finished output.
    private val queue = ArrayDeque<Packet>()
    private var held = 0
    private var work = ByteArray(0)
    private var carryLength = 0
    private var out = ByteArray(OUT_INITIAL)
    private var outStart = 0
    private var outEnd = 0

    val available: Int get() = outEnd - outStart

    /** Copies up to [length] finished bytes; 0 when there are none yet. */
    fun read(target: ByteArray, offset: Int, length: Int): Int {
        val n = minOf(length, outEnd - outStart)
        if (n <= 0) return 0
        System.arraycopy(out, outStart, target, offset, n)
        outStart += n
        delivered += n
        if (outStart == outEnd) {
            outStart = 0
            outEnd = 0
            if (out.size > OUT_SHRINK) out = ByteArray(OUT_INITIAL)
        }
        return n
    }

    /** Takes bytes off the current connection. Finished output becomes available to [read]. */
    fun push(data: ByteArray, offset: Int, length: Int) {
        if (changed != null || lost != null || length <= 0) return
        if (raw) { write(data, offset, length); return }
        val n = carryLength + length
        if (work.size < n) work = work.copyOf(maxOf(n, work.size * 2))
        System.arraycopy(data, offset, work, carryLength, length)
        carryLength = 0
        if (connections == 1) passThrough(n) else splice(n)
    }

    /**
     * The first connection: every byte goes out as it came, framed the way TsExtractor frames it (TsUtil's sync byte
     * search): a packet starts at a sync byte, and bytes before one, which the extractor skips, go out at once. Only a
     * packet still arriving is held, at most 187 bytes. Packets are only read, to follow what the extractor makes of
     * them, so the model sees exactly the packets the extractor sees.
     *
     * TsExtractor frames this way from the first byte when it is reused for ExoPlayer's retry, but its sniff on the first
     * load starts at the first of five sync bytes 188 apart. The two only agree when the stream starts with five whole
     * packets; a stream that doesn't passes through untouched, and is never spliced (as in 1.6.2).
     */
    private fun passThrough(n: Int) {
        val b = work
        var i = 0
        while (i < n) {
            if (u(b[i]) != SYNC) {
                if (passed + i < CLEAN_START) {
                    raw = true
                    tidy = false
                    log("doesn't start as 188-byte TS, passing it through")
                    write(b, 0, n)
                    passed += n
                    carryLength = 0
                    return
                }
                // Junk, or a lost sync byte: TsExtractor skips to the next sync byte, and these bytes go out at once.
                i++
                while (i < n && u(b[i]) != SYNC) i++
                continue
            }
            if (i + PACKET > n) break // a packet still arriving
            tables(b, i)
            account(b, i)
            if ((u(b[i + 1]) and 0x80) == 0 && (u(b[i + 3]) and 0x10) != 0) {
                val pid = pid(b, i)
                ccOut[pid] = u(b[i + 3]) and 0x0F
                ccConnection[pid] = connections
            }
            i += PACKET
        }
        if (i > 0) write(b, 0, i)
        passed += i
        if (i < n) System.arraycopy(b, i, b, 0, n - i)
        carryLength = n - i
    }

    /** A rejoined connection: whole packets only, placed onto what the extractor has. */
    private fun splice(n: Int) {
        val b = work
        var i = 0
        while (i + PACKET <= n) {
            if (!synced || u(b[i]) != SYNC) {
                synced = false
                val sync = findSync(b, i, n)
                if (sync < 0) {
                    val keep = maxOf(i, n - 2 * PACKET)
                    wasted += keep - i
                    i = keep
                    break
                }
                wasted += sync - i
                i = sync
                synced = true
            } else if (i + PACKET < n && u(b[i + PACKET]) != SYNC) {
                val next = findSync(b, i + 1, minOf(n, i + 3 * PACKET))
                if (next in i + 1 until i + PACKET) {
                    wasted += next - i
                    i = next
                    continue
                }
            }
            packet(b.copyOfRange(i, i + PACKET))
            if (changed != null || lost != null) return
            i += PACKET
        }
        if (i < n) System.arraycopy(b, i, b, 0, n - i)
        carryLength = n - i
        flush()
        if (!placed && wasted > WASTE_LIMIT) lose("dropped ${wasted / 1024} KB without finding its place")
    }

    /**
     * The connection ended and nothing continues it: on the first connection, bytes still held (part of a packet, or
     * what was being searched for a packet start) go out, as without this class.
     */
    fun finish() {
        if (connections != 1 || carryLength == 0) return
        write(work, 0, carryLength)
        carryLength = 0
        tidy = false
    }

    /**
     * A new connection starts. [awayMs] is how long the stream has been without data (what a forward jump on the same
     * clock can explain), or -1 if unknown. Whatever the last connection hadn't passed on is dropped.
     */
    fun connect(awayMs: Long = -1) {
        for (t in trackList) {
            val pes = units[t.pid] ?: continue
            if (pes.decision == PENDING) pes.decision = DROP
            units[t.pid] = null
        }
        for (pes in waiting) if (pes.decision == PENDING) pes.decision = DROP
        for (pes in group) if (pes.decision == PENDING) pes.decision = DROP
        for (packet in queue) if (packet.pes?.decision == PENDING) packet.pes.decision = DROP
        flush()
        waiting.clear()
        group.clear()
        queue.clear()
        held = 0
        carryLength = 0
        synced = false
        val wasTidy = tidy
        tidy = true // from here on only whole packets go out
        connections++
        cutOffset = offset
        jumpLimit = if (awayMs >= 0) awayMs * (TICKS / 1000) + JUMP_SLACK_AHEAD else JUMP_LIMIT
        for (t in trackList) {
            val c = t.cur
            t.cut = c
            t.cutEs = c?.es ?: 0
            t.cutCrc = c?.crc?.value ?: 0L
            t.before = t.prev
            t.end = if (t.audio) audioEnd(t) else -1
            t.lastFrame = if (t.video) lastFrame(t) else -1
            // Only a stream that never played has nothing to catch up with. One that played but whose reader was reset
            // (no PES being read) is refused below if it is audio or video.
            t.caught = c == null && t.count == 0
            t.dropping = false
            t.align = -1
            t.inDts = -1
            t.inN = 0
            copyCc[t.pid] = -1
        }
        anchor = pickAnchor()
        placed = false
        settled = false
        mode = UNDECIDED
        found = false
        keyWait = -1
        jumpKey = null
        jumpShift = 0
        primary = null
        probeTrack = null
        probeDts = -1
        anchorBytes = 0
        wasted = 0
        pmts = null
        // Not cleared: a failure found while the last connection's output was flushed above refuses this one too.
        resent = 0
        spliceGap = 0
        beforeVerified = false
        val reset = resetStream()
        when {
            changed != null -> {}
            !wasTidy -> lose("the last connection didn't end on a whole packet")
            reset != null -> lose("the extractor's reader of PID ${reset.pid} was reset just before the cut")
            twoVideos() -> lose("more than one video stream played")
            anchor?.prev == null -> lose("nothing to continue")
        }
    }

    /**
     * An audio or video stream that has played but whose PES the extractor isn't reading: a continuity counter jump
     * (a lost or errored packet), a bad PES header or a deliberate break reset its reader, as TsExtractor does, and the
     * stream's next PES start hasn't gone out yet. Which PES the extractor has of it is then unknown, so a new connection
     * can't be placed on it: a resend would pass again what already played (time going back, audio heard twice), and a
     * jump could resume video on a frame that isn't a keyframe, or audio with an overlap or gap. Such a cut is refused,
     * and ExoPlayer starts over as in 1.6.2. Null if there is none.
     */
    private fun resetStream(): Track? {
        for (t in trackList) if ((t.audio || t.video) && t.count > 0 && t.cur == null) return t
        return null
    }

    /**
     * More than one video stream has played. Only the anchor's video is placed by keyframes and caught up exactly; a
     * second one would resume on any frame after a jump, and pass its resent frames again after a resend.
     */
    private fun twoVideos(): Boolean = trackList.count { it.video && it.count > 0 } > 1

    /** The stream (video when there is one) that places a new connection on the timeline. */
    private fun pickAnchor(): Track? {
        var best: Track? = null
        for (t in trackList) {
            val c = t.cur ?: continue
            if (!(t.video || t.audio) || c.keyDts < 0) continue // nothing to place it by
            val b = best
            if (b == null || (t.video && !b.video) || (t.video == b.video && t.count > b.count)) best = t
        }
        return best
    }

    /**
     * The last frame of [t] that is a whole sample in the extractor: the one before the frame being read, once the
     * first NAL unit of that frame (its access unit delimiter) ended, which is when Media3's H.264/H.265/MPEG-2 readers
     * output the frame before. A counter jump then drops only the frame being read.
     */
    private fun lastFrame(t: Track): Long {
        val c = t.cur ?: return -1
        if (c.head.startCodes < 2 || c.frameBefore < 0) return -1
        return c.frameBefore
    }

    /** Where the extractor's audio ends on [t] (output PTS), or -1 if that isn't known to the sample. */
    private fun audioEnd(t: Track): Long {
        val c = t.cur ?: return -1
        if (c.pts < 0) return -1
        val a = c.adts
        if (a != null && a.ok && a.rate > 0) return wrap(c.pts + frameTicks(a.frames, a.rate))
        // Other codecs: only a whole PES of a stream whose PES all last the same.
        if (c.complete && t.steady && t.step > 0) return wrap(c.pts + t.step)
        return -1
    }

    // ------------------------------------------------------------------ what the extractor has

    /** Follows one packet that went out the way TsExtractor reads it. [o] is where it starts in [b]. */
    private fun account(b: ByteArray, o: Int) {
        if ((u(b[o + 1]) and 0x80) != 0) return // transport_error_indicator: skipped
        val control = (u(b[o + 3]) shr 4) and 3
        if ((control and 1) == 0) return // no payload: skipped before the continuity check
        val t = tracks[pid(b, o)] ?: return
        val cc = u(b[o + 3]) and 0x0F
        val last = t.cc
        t.cc = cc
        if (last >= 0) {
            if (cc == last) return // a repeated packet: dropped
            if (cc != ((last + 1) and 0x0F)) {
                // A discontinuity: the stream's reader starts over, dropping what it was assembling.
                t.cur = null
                t.prev = null
            }
        }
        val at = if ((control and 2) != 0) 5 + u(b[o + 4]) else 4
        if (at >= PACKET) return
        val pusi = (u(b[o + 1]) and 0x40) != 0
        if (!pusi) {
            val c = t.cur ?: return
            append(t, c, b, o + at, PACKET - at, false)
            return
        }
        t.cur?.let { t.prev = it }
        t.cur = null
        val p = o + at
        if (at + 9 > PACKET || b[p].toInt() != 0 || b[p + 1].toInt() != 0 || b[p + 2].toInt() != 1) return
        val flags = u(b[p + 7]) ushr 6
        val headerLength = u(b[p + 8])
        val pts = if ((flags and 2) != 0 && at + 14 <= PACKET) readStamp(b, p + 9) else -1L
        val dts = if (flags == 3 && at + 19 <= PACKET) readStamp(b, p + 14) else pts
        val length = (u(b[p + 4]) shl 8) or u(b[p + 5])
        val keyDts: Long
        val keyN: Int
        if (dts >= 0 && dts != t.runDts) {
            t.frameBefore = t.runDts
            t.runDts = dts
            t.runN = 0
            keyDts = dts
            keyN = 0
        } else {
            keyDts = t.runDts
            keyN = ++t.runN
        }
        if (dts >= 0) {
            if (t.lastDts >= 0 && t.lastConnection == connections) {
                val step = ticksAfter(dts, t.lastDts)
                if (step in 1 until TICKS) {
                    t.steady = step == t.step
                    t.step = step
                }
            }
            t.lastDts = dts
            t.lastConnection = connections
        }
        if ((control and 2) != 0 && u(b[o + 4]) > 0 && (u(b[o + 5]) and 0x40) != 0) t.marked = true
        val s = Sent(dts, pts, keyDts, keyN, t.frameBefore, if (keyN == 0) null else t.frameHead,
            if (length == 0) -1 else maxOf(0, length - 3 - headerLength), if (t.type == TYPE_ADTS) Adts() else null)
        if (keyN == 0) t.frameHead = s
        t.cur = s
        t.count++
        val from = at + 9 + headerLength
        if (from < PACKET) append(t, s, b, o + from, PACKET - from, true)
        if (s.declared == 0) s.complete = true
    }

    private fun append(t: Track, s: Sent, b: ByteArray, from: Int, length: Int, first: Boolean) {
        var n = length
        if (s.declared >= 0) n = minOf(n, s.declared - s.es)
        if (n <= 0) return
        s.crc.update(b, from, n)
        if (t.video && s.startCodes < 2) countStartCodes(s, b, from, n)
        s.adts?.feed(b, from, n, s.es)
        if (first && t.config == null) t.config = configOf(t.type, b, from, n)
        s.es += n
        if (s.declared >= 0 && s.es >= s.declared) s.complete = true
    }

    private fun countStartCodes(s: Sent, b: ByteArray, from: Int, n: Int) {
        var zeros = s.zeros
        for (i in from until from + n) {
            val v = b[i].toInt()
            if (v == 0) zeros++
            else {
                if (v == 1 && zeros >= 2 && ++s.startCodes >= 2) break
                zeros = 0
            }
        }
        s.zeros = zeros
    }

    // ------------------------------------------------------------------ a new connection

    private fun packet(p: ByteArray) {
        val pid = pid(p, 0)
        val control = (u(p[3]) shr 4) and 3
        val payload = (control and 1) != 0
        val at = if ((control and 2) != 0) 5 + u(p[4]) else 4
        val pusi = (u(p[1]) and 0x40) != 0
        // transport_error_indicator: TsExtractor skips the packet whole, header and counter included (its PID may be
        // wrong). Once the connection is placed it goes out untouched, as on the first connection; before, it is dropped.
        if ((u(p[1]) and 0x80) != 0) { queue(p, null, placed); return }
        tables(p, 0)
        if (changed != null) return
        val track = tracks[pid]
        if (track == null) {
            // Not a stream the extractor reads: tables and the like. Nothing of a connection goes out before its place.
            queue(p, null, placed)
            return
        }
        var pes = units[pid]
        if (pusi && payload && at < PACKET) {
            if (pes != null) complete(pes)
            units[pid] = null
            if (at + 9 <= PACKET && p[at].toInt() == 0 && p[at + 1].toInt() == 0 && p[at + 2].toInt() == 1) {
                pes = Pes(track, p, at)
                units[pid] = pes
                start(pes, p, at, control)
                queue(p, pes)
                if (placed) begin(pes)
                if (placed && pes.checked != 0) resolveCopy(pes)
                if (pes.declared in 0..pes.received) complete(pes)
                hold()
                return
            }
            queue(p, null, false)
            return
        }
        if (pes != null) {
            queue(p, pes)
            if (payload && at < PACKET) arrive(pes, p, at, PACKET - at)
            if (placed && pes.checked != 0) resolveCopy(pes)
            if (pes.declared in 0..pes.received) complete(pes)
            hold()
            return
        }
        // The rest of a PES that began before this connection, which the extractor can't use; or a clock reference.
        if (payload) wasted += PACKET
        queue(p, null, !payload && placed)
    }

    private fun start(pes: Pes, p: ByteArray, at: Int, control: Int) {
        val t = pes.track
        val flags = u(p[at + 7]) ushr 6
        val headerLength = u(p[at + 8])
        pes.flags = flags
        pes.key = (control and 2) != 0 && u(p[4]) > 0 && (u(p[5]) and 0x40) != 0
        if (flags == 3 && at + 19 <= PACKET) pes.dts = readStamp(p, at + 14)
        if ((flags and 2) != 0 && at + 14 <= PACKET) pes.pts = readStamp(p, at + 9)
        if (pes.dts < 0) pes.dts = pes.pts
        val length = (u(p[at + 4]) shl 8) or u(p[at + 5])
        pes.declared = if (length == 0) -1 else maxOf(0, length - 3 - headerLength)
        pes.esStart = at + 9 + headerLength
        if (pes.dts >= 0 && pes.dts != t.inDts) {
            t.inDts = pes.dts
            t.inN = 0
            pes.keyDts = pes.dts
        } else if (t.inDts >= 0) {
            pes.keyDts = t.inDts
            pes.keyN = ++t.inN
        }
        if (!settled && (t.video || t.audio)) pes.head = ByteArray(if (t.video) HEAD_BYTES else AUDIO_HEAD)
        // Does it resend a PES the extractor has? Its place on the stream says which; its bytes must then match.
        if (pes.keyDts >= 0 && !settled) {
            val key = wrap(pes.keyDts - cutOffset)
            val cut = t.cut
            val before = t.before
            val copy = when {
                cut != null && key == cut.keyDts && pes.keyN == cut.keyN -> cut
                before != null && key == before.keyDts && pes.keyN == before.keyN -> before
                else -> null
            }
            if (copy != null) {
                pes.copyOf = copy
                pes.copyLength = if (copy === cut) t.cutEs else copy.es
                pes.copyCrc = if (copy === cut) t.cutCrc else copy.crc.value
                pes.crc = CRC32()
                // A PES of another declared length can't continue the one the extractor reads.
                if (copy.declared != pes.declared) pes.checked = -1
            }
        }
        if (pes.esStart < PACKET) arrive(pes, p, pes.esStart, PACKET - pes.esStart)
        else if (pes.esStart > PACKET) pes.esStart = PACKET
    }

    /** Payload bytes of [pes] arrived. */
    private fun arrive(pes: Pes, p: ByteArray, from: Int, length: Int) {
        var n = length
        if (pes.declared >= 0) n = minOf(n, pes.declared - pes.received)
        if (n <= 0) return
        val head = pes.head
        if (head != null && pes.headLength < head.size) {
            val m = minOf(n, head.size - pes.headLength)
            System.arraycopy(p, from, head, pes.headLength, m)
            pes.headLength += m
        }
        val crc = pes.crc
        if (crc != null && pes.checked == 0) {
            val m = minOf(n, pes.copyLength - pes.crcBytes)
            if (m > 0) crc.update(p, from, m)
            pes.crcBytes += maxOf(m, 0)
            if (pes.crcBytes >= pes.copyLength) pes.checked = if (crc.value == pes.copyCrc) 1 else -1
        }
        pes.received += n
    }

    private fun queue(p: ByteArray, pes: Pes?, keep: Boolean = true) {
        queue.addLast(Packet(p, pes, keep))
        held += PACKET
        if (pes != null) pes.packets++
    }

    private fun complete(pes: Pes) {
        if (units[pes.track.pid] === pes) units[pes.track.pid] = null
        if (pes.complete) return
        pes.complete = true
        // Fewer bytes than the extractor has of the PES it resends: not the same PES.
        if (pes.copyOf != null && pes.checked == 0) pes.checked = -1
        if (pes.decision != PENDING) return
        if (!placed) return place(pes)
        // Started before the connection was placed: decided now.
        begin(pes)
        if (pes.checked != 0) resolveCopy(pes)
    }

    /** A PES that starts once the connection is placed: decided at once, so it passes on as it comes. */
    private fun begin(pes: Pes) {
        val t = pes.track
        if (pes.decision != PENDING) return
        if (settled || t.caught) return keep(pes)
        if (mode == RESEND) settleResend(pes) else settleJump(pes)
    }

    private fun keep(pes: Pes) {
        pes.decision = KEEP
        if (offset != 0L) restamp(pes)
    }

    private fun drop(pes: Pes) {
        pes.decision = DROP
        resent += pes.packets
    }

    private fun waste(pes: Pes) {
        pes.decision = DROP
        wasted += pes.packets.toLong() * PACKET
    }

    /** Finds where a new connection continues the stream, from the anchor stream's timed PES. */
    private fun place(pes: Pes) {
        val a = anchor ?: return lose("nothing to continue")
        if (jumpKey != null) {
            if (pes.track === a) group.add(pes) else waiting.addLast(pes)
            tryFinish()
            return
        }
        if (pes.track !== a) {
            // A resend: what the extractor already has goes at once, so a long burst isn't held.
            if (mode == RESEND && behind(pes)) return drop(pes)
            // The other streams wait for the anchor. If it hasn't come with this much of them, the streams changed.
            waiting.addLast(pes)
            if (!found) {
                anchorBytes += pes.packets.toLong() * PACKET
                if (anchorBytes > ANCHOR_BYTES) return change("anchor stream missing after ${anchorBytes / 1024} KB")
                if (pes.dts >= 0) {
                    val probe = probeTrack
                    if (probe == null) { probeTrack = pes.track; probeDts = pes.dts }
                    else if (pes.track === probe && ticksAfter(pes.dts, probeDts) > ANCHOR_WAIT) {
                        return change("anchor stream missing for ${ANCHOR_WAIT / TICKS}s")
                    }
                }
            }
            return
        }
        if (pes.keyDts < 0) return waste(pes)
        found = true
        val cut = a.cut ?: return lose("nothing to continue")
        val gap = ticksAfter(wrap(pes.keyDts - cutOffset), cut.keyDts)
        if (mode == UNDECIDED) {
            spliceGap = gap
            mode = when {
                gap <= 0 && gap > -RESENT_LIMIT -> RESEND
                gap > 0 && gap <= jumpLimit -> JUMP
                gap <= 0 -> return lose("the new connection is ${-gap / 90}ms behind: its clock restarted")
                else -> return lose("the new connection is ${gap / 90}ms ahead: more than the outage explains")
            }
            if (mode == JUMP) {
                val why = jumpable(a)
                if (why != null) return lose(why)
            } else {
                val it = waiting.iterator()
                while (it.hasNext()) {
                    val w = it.next()
                    if (behind(w)) { drop(w); it.remove() }
                }
            }
        }
        if (mode == RESEND) resendAnchor(pes, a) else jumpAnchor(pes, a)
    }

    // ------------------------------------------------------------------ a resend

    private fun resendAnchor(pes: Pes, a: Track) {
        val cut = a.cut ?: return
        when {
            pes.copyOf === cut -> {
                if (pes.checked != 1) return lose("the resent stream differs from what played")
                // Too little of it went out to prove much: then the PES before it must have matched too.
                if (a.cutEs < VERIFY_MIN && !beforeVerified) return lose("too little went out to check the resend against")
                pes.decision = CONTINUE
                a.caught = true
                placed = true
                offset = cutOffset
                log("spliced: dropped $resent resent packets, gap ${spliceGap / 90}ms, continuing the frame being read")
                for (w in waiting) if (w.decision == PENDING) settleResend(w)
                waiting.clear()
                checkSettled()
            }
            compare(pes, cut) < 0 -> {
                if (pes.copyOf != null) {
                    if (pes.checked != 1) return lose("the resent stream differs from what played")
                    beforeVerified = true
                }
                drop(pes)
                a.dropping = true
            }
            else -> lose("the resend skipped the frame being read")
        }
    }

    /** Another stream's PES once a resend is placed: dropped while the extractor has it, continued, then passed on. */
    private fun settleResend(pes: Pes) {
        val t = pes.track
        if (t.caught) return keep(pes)
        val cut = t.cut
        if (cut == null) { t.caught = true; return keep(pes) }
        if (pes.keyDts < 0) return drop(pes)
        if (pes.copyOf === cut) {
            if (pes.checked != 0) resolveCopy(pes)
            return
        }
        if (compare(pes, cut) < 0) {
            if (pes.copyOf != null && pes.checked == -1) return lose("the resent stream differs from what played")
            t.dropping = true
            return drop(pes)
        }
        // The copy of the PES the extractor is reading never came.
        if (!cut.complete) {
            if (t.audio || t === anchor) return lose("the resend skipped the audio being read on PID ${t.pid}")
            breakCc(t)
        } else if (t.audio) {
            val start = wrap(pes.pts - offset)
            if (t.end < 0 || pes.pts < 0 || kotlin.math.abs(ticksAfter(start, t.end)) > AUDIO_TOLERANCE) {
                return lose("the resent audio on PID ${t.pid} doesn't continue exactly")
            }
        }
        t.caught = true
        keep(pes)
        checkSettled()
    }

    /** A copy of the PES the extractor is reading, now checked: its rest continues that PES. */
    private fun resolveCopy(pes: Pes) {
        val t = pes.track
        if (pes.decision != PENDING || pes.copyOf == null || pes.copyOf !== t.cut) return
        if (t.caught) return keep(pes)
        if (pes.checked != 1) return lose("the resent stream on PID ${t.pid} differs from what played")
        pes.decision = CONTINUE
        t.caught = true
        checkSettled()
    }

    /**
     * The next packet on [t]'s PID jumps its continuity counter, so TsExtractor drops the PES it is reading (for video,
     * the frame being read; for audio, a frame cut short), as on any discontinuity. Until then that PES isn't counted.
     */
    private fun breakCc(t: Track) {
        ccBreak[t.pid] = true
        t.cur = null
    }

    private fun checkSettled() {
        if (settled || !placed) return
        val a = anchor
        if (a != null && !a.caught) return
        for (t in trackList) if (t.audio && t.cut != null && !t.caught) return
        settled = true
        for (t in trackList) {
            t.caught = true
            // A PES that began before the connection was placed and is still arriving goes out as it comes from here
            // on, as it would once complete: a connection that has caught up holds nothing back.
            val pes = units[t.pid]
            if (pes != null && pes.decision == PENDING) keep(pes)
        }
    }

    // ------------------------------------------------------------------ a jump ahead

    /** Why a jump can't continue what the extractor has exactly, or null. */
    private fun jumpable(a: Track): String? {
        val cut = a.cut ?: return "nothing to continue"
        if (a.video && a.lastFrame < 0) return "can't tell which frame the extractor finished"
        if (a.video && !(a.marked || a.type in KEYFRAME_CODECS)) return "can't tell keyframes on this stream"
        for (t in trackList) {
            if (t.audio && t.cut != null && t.end < 0) return "can't tell where the audio on PID ${t.pid} ends"
        }
        return null
    }

    private fun jumpAnchor(pes: Pes, a: Track) {
        if (!a.video) {
            // Audio only: every frame starts the stream again.
            group.add(pes)
            startJump(pes, a)
            return
        }
        if (keyWait < 0) keyWait = pes.keyDts
        if (group.isNotEmpty() && pes.keyDts != group[0].keyDts) {
            for (g in group) waste(g)
            group.clear()
        }
        group.add(pes)
        if (pes.key) a.marked = true
        if (group.any { keyframe(it) }) return startJump(group[0], a)
        if (ticksAfter(pes.keyDts, keyWait) >= KEYFRAME_WAIT) return lose("no keyframe within ${KEYFRAME_WAIT / 90}ms")
        prune(pes.keyDts)
    }

    private fun startJump(key: Pes, a: Track) {
        if (a.video) {
            val sps = group.firstNotNullOfOrNull { g -> g.head?.let { configOf(a.type, it, 0, g.headLength) } }
            val before = a.config
            if (sps != null && before != null && !sps.contentEquals(before)) return lose("the video format changed")
        }
        val last = if (a.video) a.lastFrame else a.end
        val step = if (a.video) (if (a.step > 0) a.step else DEFAULT_STEP) else 0L
        val from = if (a.video) key.keyDts else key.pts
        jumpShift = wrap(from - last - step)
        jumpKey = key
        if (keyWait >= 0) log("waited ${ticksAfter(key.keyDts, keyWait) / 90}ms for a keyframe")
        primary = if (a.audio) null else audioToContinue()
        tryFinish()
    }

    /** The audio stream that played most: the jump's shift continues it exactly. */
    private fun audioToContinue(): Track? {
        var best: Track? = null
        for (t in trackList) {
            if (!t.audio || t.cut == null || t === anchor) continue
            if (best == null || t.count > best.count) best = t
        }
        return best
    }

    /** Picks the new audio PES that continues the old audio, once one at or past that point has come, and finishes. */
    private fun tryFinish() {
        val key = jumpKey ?: return
        val a = anchor ?: return
        val p = primary
        if (p == null) return finishJump(jumpShift, null)
        val target = wrap(jumpShift + p.end)
        var best: Pes? = null
        var reached = false
        for (w in waiting) {
            if (w.track !== p || w.pts < 0 || w.decision != PENDING) continue
            val d = ticksAfter(w.pts, target)
            if (d >= 0) reached = true
            if (best == null || kotlin.math.abs(d) < kotlin.math.abs(ticksAfter(best.pts, target))) best = w
            if (reached) break
        }
        val newest = group.lastOrNull()?.keyDts ?: key.keyDts
        val waited = ticksAfter(newest, key.keyDts) > ALIGN_WAIT
        if (!reached && !waited) return
        if (best == null) return lose("no audio to continue within ${ALIGN_WAIT / 90}ms of the keyframe")
        val move = ticksAfter(target, best.pts)
        if (kotlin.math.abs(move) > JUMP_SLACK) return lose("the new audio is ${move / 90}ms off where the old audio ends")
        finishJump(wrap(best.pts - p.end), best)
    }

    private fun finishJump(shift: Long, first: Pes?) {
        val a = anchor ?: return
        val key = jumpKey ?: return
        jumpKey = null
        val moved = ticksAfter(jumpShift, shift)
        offset = shift
        placed = true
        mode = JUMP
        // The frame being read goes (the extractor drops it on a counter jump); the one before it is the last frame.
        breakCc(a)
        a.caught = true
        for (t in trackList) {
            if (t === a) continue
            val cut = t.cut ?: continue
            if (!cut.complete) breakCc(t)
            if (t.audio) t.align = t.end
        }
        val p = primary
        if (p != null && first != null && !sameConfig(p, first)) return lose("the audio format changed on PID ${p.pid}")
        for (g in group) if (g.decision == PENDING) keep(g)
        for (w in waiting) {
            if (w.decision != PENDING) continue
            when {
                w.track === a -> keep(w)
                w.track === p && first != null -> when {
                    w === first -> { keep(w); p.caught = true; p.dropping = false }
                    p.caught -> keep(w)
                    else -> { drop(w); p.dropping = true }
                }
                else -> settleJump(w)
            }
        }
        waiting.clear()
        group.clear()
        val shiftMs = ticksAfter(shift, cutOffset) / 90
        val audioMs = when {
            moved > 0 -> ", ${moved / 90}ms later to continue the audio"
            moved < 0 -> ", ${-moved / 90}ms earlier to continue the audio"
            else -> ""
        }
        log("spliced: dropped $resent packets, gap ${spliceGap / 90}ms, shift ${shiftMs}ms$audioMs")
        checkSettled()
    }

    /** Another stream's PES after a jump: audio from where the extractor's ends, exactly; the rest from what's new. */
    private fun settleJump(pes: Pes) {
        val t = pes.track
        if (t.caught) return keep(pes)
        if (t.cut == null) { t.caught = true; return keep(pes) }
        if (pes.dts < 0) return if (t.dropping) drop(pes) else keep(pes)
        if (t.audio) {
            val d = ticksAfter(wrap(pes.pts - offset), t.align)
            when {
                d < -AUDIO_TOLERANCE -> { drop(pes); t.dropping = true }
                d <= AUDIO_TOLERANCE -> {
                    if (!sameConfig(t, pes)) return lose("the audio format changed on PID ${t.pid}")
                    keep(pes)
                    t.caught = true
                    t.dropping = false
                    checkSettled()
                }
                else -> lose("the audio on PID ${t.pid} can't continue exactly (${d / 90}ms gap)")
            }
            return
        }
        val cut = t.cut!!
        if (ticksAfter(wrap(pes.keyDts - offset), cut.keyDts) > 0) {
            keep(pes)
            t.caught = true
            t.dropping = false
        } else {
            drop(pes)
            t.dropping = true
        }
    }

    /** [pes] has the codec configuration [t] had on the first connection, as far as its first bytes tell. */
    private fun sameConfig(t: Track, pes: Pes): Boolean {
        val before = t.config ?: return true
        val head = pes.head ?: return true
        val now = configOf(t.type, head, 0, pes.headLength) ?: return true
        return now.contentEquals(before)
    }

    /** While waiting for a keyframe: other streams' PES this far before the anchor would only be dropped later. */
    private fun prune(anchorDts: Long) {
        val it = waiting.iterator()
        while (it.hasNext()) {
            val w = it.next()
            if (w.dts >= 0 && ticksAfter(anchorDts, w.dts) > PRUNE) {
                waste(w)
                it.remove()
            }
        }
    }

    /** On a resend: [pes] comes before the PES the extractor is reading on its stream, so the extractor has it. */
    private fun behind(pes: Pes): Boolean {
        val cut = pes.track.cut ?: return false
        return pes.keyDts < 0 || compare(pes, cut) < 0
    }

    /** [pes] (new connection) against [s] (what the extractor has): before, the same PES, or after on its stream. */
    private fun compare(pes: Pes, s: Sent): Int {
        val d = ticksAfter(wrap(pes.keyDts - cutOffset), s.keyDts)
        return if (d != 0L) d.compareTo(0L) else pes.keyN.compareTo(s.keyN)
    }

    // ------------------------------------------------------------------ output

    /** Bounds what is held back. */
    private fun hold() {
        if (held <= HOLD_LIMIT) return
        flush()
        if (held <= HOLD_LIMIT) return
        lose("held ${held / 1024} KB without finding its place")
    }

    private fun lose(why: String) {
        if (lost == null) log("splice failed: $why")
        lost = why
    }

    private fun change(why: String) {
        if (changed == null) log("stream changed on the new connection: $why")
        changed = why
    }

    private fun flush() {
        while (queue.isNotEmpty() && lost == null) {
            val packet = queue.first()
            val pes = packet.pes
            val decision = if (pes == null) (if (packet.keep) KEEP else DROP) else pes.decision
            if (decision == PENDING) return
            queue.removeFirst()
            held -= PACKET
            when (decision) {
                KEEP -> emit(packet.data)
                CONTINUE -> continueCopy(packet.data, pes!!)
                // A dropped packet with an error flag leaves its counter gap, as TsExtractor saw it before.
                else -> if ((u(packet.data[3]) and 0x10) != 0 && (u(packet.data[1]) and 0x80) == 0) {
                    ccSkipped[pid(packet.data, 0)] = true
                }
            }
        }
    }

    /** One packet of a resent PES: what the extractor already has is dropped, the rest continues its PES. */
    private fun continueCopy(p: ByteArray, pes: Pes) {
        val pid = pid(p, 0)
        val control = (u(p[3]) shr 4) and 3
        val first = p === pes.first
        val from = if (first) pes.esStart else if ((control and 2) != 0) 5 + u(p[4]) else 4
        var n = if ((control and 1) != 0 && from < PACKET) PACKET - from else 0
        if (pes.declared >= 0) n = minOf(n, pes.declared - pes.copied)
        val skip = pes.copyLength - pes.copied
        if (n > 0) pes.copied += n
        if (n <= 0 || skip >= n) {
            if ((control and 1) != 0) {
                ccSkipped[pid] = true
                copyCc[pid] = u(p[3]) and 0x0F
            }
            return
        }
        if (skip <= 0 && !first && from + n == PACKET) return emit(p)
        val start = from + maxOf(skip, 0)
        // In place of this packet: its continuity counter, so the PID's sequence carries on from it.
        emit(continuation(pid, u(p[3]) and 0x0F, p, start, from + n - start))
    }

    /** Writes one packet out: PCR moved with the timestamps, continuity counter continuing the PID's sequence. */
    private fun emit(p: ByteArray) {
        if ((u(p[1]) and 0x80) != 0) return write(p, 0, PACKET) // an error packet: TsExtractor reads nothing of it
        val pid = pid(p, 0)
        val cc = u(p[3]) and 0x0F
        val skipped = copyCc[pid]
        if (skipped >= 0 && (u(p[3]) and 0x10) != 0) {
            copyCc[pid] = -1
            // The counter below joins this packet to the last one the extractor has, which the resend's last skipped
            // packet stands for. A packet between them on the resend (lost, flagged with an error, or repeated) would
            // then put a hole or a repeat in the PES unseen, where the extractor on one connection would have reset.
            if (cc != ((skipped + 1) and 0x0F)) return lose("the resend on PID $pid breaks its continuity where it continues")
        }
        if (offset != 0L && hasPcr(p)) shiftPcr(p, offset)
        var outCc = cc
        if ((u(p[3]) and 0x10) != 0) {
            if (ccOut[pid] >= 0 && (ccConnection[pid] != connections || ccSkipped[pid] || ccBreak[pid])) {
                // A deliberate jump makes TsExtractor drop what it was assembling on this PID (a repeat would be dropped).
                val next = if (ccBreak[pid]) 2 else 1
                ccDelta[pid] = (ccOut[pid] + next - cc) and 0x0F
            } else if (ccConnection[pid] != connections) {
                ccDelta[pid] = 0
            }
            ccConnection[pid] = connections
            ccSkipped[pid] = false
            ccBreak[pid] = false
            outCc = (cc + ccDelta[pid]) and 0x0F
            ccOut[pid] = outCc
        } else if (ccConnection[pid] == connections) {
            outCc = (cc + ccDelta[pid]) and 0x0F
        } else if (ccOut[pid] >= 0) {
            outCc = ccOut[pid] // No payload: the counter stays where the PID's sequence is.
        }
        if (outCc != cc) p[3] = ((u(p[3]) and 0xF0) or outCc).toByte()
        write(p, 0, PACKET)
        account(p, 0)
    }

    private fun restamp(pes: Pes) {
        val p = pes.first
        val at = pes.at
        if ((pes.flags and 2) != 0 && at + 14 <= PACKET) writeStamp(p, at + 9, wrap(readStamp(p, at + 9) - offset))
        if (pes.flags == 3 && at + 19 <= PACKET) writeStamp(p, at + 14, wrap(readStamp(p, at + 14) - offset))
    }

    private fun write(data: ByteArray, from: Int, length: Int) {
        if (outEnd + length > out.size) {
            val live = outEnd - outStart
            if (live + length <= out.size && outStart > 0) {
                System.arraycopy(out, outStart, out, 0, live)
            } else {
                val grown = ByteArray(maxOf(out.size * 2, live + length))
                System.arraycopy(out, outStart, grown, 0, live)
                out = grown
            }
            outStart = 0
            outEnd = live
        }
        System.arraycopy(data, from, out, outEnd, length)
        outEnd += length
    }

    // ------------------------------------------------------------------ program map

    /**
     * Reads PAT and PMT sections that fit in one packet (and pass their CRC). The first connection's first program
     * map is what TsExtractor (MODE_SINGLE_PMT) took; a later connection whose map no longer lists a stream that played,
     * or lists it as another stream type, while it is being placed, can't be spliced.
     *
     * TsExtractor reads that one map and never another, so a later version of it (a programme boundary on a
     * pass-through feed dropping a second-language, audio description or subtitle stream) changes nothing for it: it
     * keeps reading the streams it has. The first connection's later maps are ignored here for that reason, and so are
     * a rejoined connection's once it has caught up, which then passes on as it comes, like the first.
     */
    private fun tables(b: ByteArray, o: Int) {
        if (connections > 1 && settled) return
        if ((u(b[o + 1]) and 0x40) == 0 || (u(b[o + 3]) and 0x10) == 0) return
        val pid = pid(b, o)
        val progs = pmts
        val pmt = if (connections == 1) pid != 0 && progs != null && pid in progs && lockedMap == null
        else pid != 0 && pid == lockedPmt && progs != null && pid in progs
        if (pid != 0 && !pmt) return
        val at = if ((u(b[o + 3]) and 0x20) != 0) 5 + u(b[o + 4]) else 4
        if (at >= PACKET) return
        val s = o + at + 1 + u(b[o + at])
        if (s + 12 > o + PACKET) return
        val end = s + 3 + (((u(b[s + 1]) and 0x0F) shl 8) or u(b[s + 2]))
        if (end > o + PACKET || (u(b[s + 5]) and 1) == 0 || b[s + 6].toInt() != 0 || b[s + 7].toInt() != 0) return
        if (sectionCrc(b, s, end) != 0) return
        val body = end - 4
        if (pid == 0) {
            if (u(b[s]) != 0) return
            val found = HashSet<Int>()
            var i = s + 8
            while (i + 4 <= body) {
                if (b[i].toInt() != 0 || b[i + 1].toInt() != 0) found += ((u(b[i + 2]) and 0x1F) shl 8) or u(b[i + 3])
                i += 4
            }
            if (found.isNotEmpty() && pmts == null) pmts = found
            return
        }
        if (u(b[s]) != 2) return
        val listed = HashMap<Int, Int>()
        var i = s + 12 + (((u(b[s + 10]) and 0x0F) shl 8) or u(b[s + 11]))
        while (i + 5 <= body) {
            val es = ((u(b[i + 1]) and 0x1F) shl 8) or u(b[i + 2])
            val infoLength = ((u(b[i + 3]) and 0x0F) shl 8) or u(b[i + 4])
            listed[es] = resolveType(u(b[i]), b, i + 5, minOf(i + 5 + infoLength, body))
            i += 5 + infoLength
        }
        val locked = lockedMap
        if (locked == null) {
            lockedMap = listed
            lockedPmt = pid
            for ((es, type) in listed) {
                if (type in SECTION_TYPES || tracks[es] != null) continue
                val t = Track(es, type)
                tracks[es] = t
                trackList += t
            }
            return
        }
        for (t in trackList) {
            if (t.count == 0) continue
            val now = listed[t.pid] ?: return change("PID ${t.pid} is no longer in the program map")
            if (now != t.type) return change("PID ${t.pid} changed stream type ${t.type} -> $now")
        }
    }

    // ------------------------------------------------------------------ keyframes

    private fun keyframe(pes: Pes): Boolean {
        val head = pes.head
        if (head != null) {
            val verdict = when (pes.track.type) {
                TYPE_H264 -> h264Keyframe(head, pes.headLength)
                TYPE_H265 -> h265Keyframe(head, pes.headLength)
                TYPE_MPEG2, TYPE_DC2_MPEG2 -> mpeg2Keyframe(head, pes.headLength)
                else -> null
            }
            if (verdict != null) return verdict
        }
        return pes.key
    }

    companion object {
        const val PACKET = 188
        const val TICKS = 90_000L
        /** The MPEG-TS clock: 90 kHz, 33 bits. */
        const val WRAP = 1L shl 33
        /** After a jump, how long the new connection's video may go without a keyframe before the splice is refused. */
        const val KEYFRAME_WAIT = 5 * TICKS
        /** Content on other streams without the anchor stream: the streams changed. Longer than a GOP. */
        const val ANCHOR_WAIT = 6 * TICKS
        /** The same in bytes, for streams without timestamps. */
        const val ANCHOR_BYTES = 2L * 1024 * 1024
        /**
         * A resend goes back at most this far. A provider resends what it buffers for a new client (the 10 to 15 s burst
         * that fills the player's buffer); further back, the clock restarted.
         */
        const val RESENT_LIMIT = 20 * TICKS
        /** A jump ahead with no outage time to explain it goes at most this far; further, the clock restarted. */
        const val JUMP_LIMIT = 60 * TICKS
        /** Added to the outage time when the caller knows it: how far ahead a jump on the same clock may land. */
        const val JUMP_SLACK_AHEAD = 10 * TICKS
        /** After a jump's keyframe, how long to wait for the audio that continues the old audio. */
        const val ALIGN_WAIT = TICKS
        /**
         * How far a jump may move the picture so the audio continues exactly: the last frame shows that much longer, or
         * the first new frames that much earlier (late ones are dropped by the renderer; Media3 drops to the next
         * keyframe only past 500 ms).
         */
        const val JUMP_SLACK = TICKS / 4
        /** Audio continues "exactly" within this (timestamp rounding). */
        const val AUDIO_TOLERANCE = TICKS / 500
        /** Bytes of a resent PES that must match before its rest continues it, unless the PES before it matched too. */
        const val VERIFY_MIN = 64
        /** The first connection's sync bytes at 0, 188, 376, 564 and 752: where TsExtractor.sniff starts reading. */
        private const val CLEAN_START = 4 * PACKET + 1
        /** Bytes held back at most while a new connection is placed. */
        const val HOLD_LIMIT = 8 * 1024 * 1024
        /** Bytes a new connection may drop while finding its place. */
        const val WASTE_LIMIT = 16L * 1024 * 1024

        private const val SYNC = 0x47
        private const val PIDS = 8192
        private const val PENDING = 0
        private const val KEEP = 1
        private const val DROP = 2
        private const val CONTINUE = 3
        private const val UNDECIDED = 0
        private const val RESEND = 1
        private const val JUMP = 2
        private const val PRUNE = 2 * TICKS
        private const val DEFAULT_STEP = TICKS / 25
        private const val HEAD_BYTES = 8192
        private const val AUDIO_HEAD = 16
        private const val OUT_INITIAL = 64 * 1024
        private const val OUT_SHRINK = 1024 * 1024
        // Stream types as Media3 1.11.1's DefaultTsPayloadReaderFactory reads them, with PlayerHolder's flags.
        private const val TYPE_MPEG2 = 0x02
        /** DigiCipher II video: MPEG-2, read by H262Reader too. */
        private const val TYPE_DC2_MPEG2 = 0x80
        private const val TYPE_MPEG4 = 0x10
        private const val TYPE_MPEG1_AUDIO = 0x03
        private const val TYPE_MPEG2_AUDIO = 0x04
        private const val TYPE_ADTS = 0x0F
        private const val TYPE_LATM = 0x11
        private const val TYPE_H264 = 0x1B
        private const val TYPE_H265 = 0x24
        private const val TYPE_MHAS = 0x2D
        private const val TYPE_AC3 = 0x81
        private const val TYPE_EAC3 = 0x87
        private const val TYPE_AC4 = 0xAC
        private const val TYPE_DTS = 0x8A
        private const val TYPE_DTS_HD = 0x88
        private const val TYPE_DTS_UHD = 0x8B
        private const val TYPE_DVB_SUBTITLES = 0x59
        private const val TYPE_AIT = 0x101
        private val KEYFRAME_CODECS = setOf(TYPE_MPEG2, TYPE_DC2_MPEG2, TYPE_H264, TYPE_H265)
        private val VIDEO_TYPES = setOf(TYPE_MPEG2, TYPE_DC2_MPEG2, TYPE_MPEG4, TYPE_H264, TYPE_H265)
        // HDMV DTS (0x82) is only read with FLAG_ENABLE_HDMV_DTS_AUDIO_STREAMS, which PlayerHolder doesn't set.
        private val AUDIO_TYPES = setOf(TYPE_MPEG1_AUDIO, TYPE_MPEG2_AUDIO, TYPE_ADTS, TYPE_LATM, TYPE_AC3, TYPE_EAC3,
            TYPE_AC4, TYPE_DTS, TYPE_DTS_HD, TYPE_DTS_UHD, TYPE_MHAS)
        /** Stream types read as sections (SCTE-35, AIT) or carrying DSM-CC sections: no PES to follow. */
        private val SECTION_TYPES = setOf(0x0A, 0x0B, 0x0C, 0x0D, 0x86, TYPE_AIT)

        /** How the extractor reads stream type [type] (resolved as [resolveType] does): video, audio, or neither. */
        internal fun kindOf(type: Int): Int = when (type) {
            in VIDEO_TYPES -> KIND_VIDEO
            in AUDIO_TYPES -> KIND_AUDIO
            else -> KIND_OTHER
        }
        internal const val KIND_OTHER = 0
        internal const val KIND_VIDEO = 1
        internal const val KIND_AUDIO = 2
        private val ADTS_RATES = intArrayOf(96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)

        private fun u(b: Byte) = b.toInt() and 0xFF
        private fun pid(p: ByteArray, o: Int) = ((u(p[o + 1]) and 0x1F) shl 8) or u(p[o + 2])

        fun wrap(ticks: Long): Long = ticks.mod(WRAP)

        /** a - b on the 33-bit clock, as the shorter way round. */
        fun ticksAfter(a: Long, b: Long): Long {
            val d = wrap(a - b)
            return if (d > WRAP / 2) d - WRAP else d
        }

        /** How long [frames] AAC frames (1024 samples, as AdtsReader counts them) last at [rate], in ticks. */
        private fun frameTicks(frames: Int, rate: Int): Long = (frames * 1024L * TICKS + rate / 2) / rate

        fun readStamp(p: ByteArray, i: Int): Long =
            ((u(p[i]) and 0x0E).toLong() shl 29) or (u(p[i + 1]).toLong() shl 22) or
                ((u(p[i + 2]) and 0xFE).toLong() shl 14) or (u(p[i + 3]).toLong() shl 7) or (u(p[i + 4]) ushr 1).toLong()

        fun writeStamp(p: ByteArray, i: Int, ticks: Long) {
            p[i] = ((u(p[i]) and 0xF0) or (((ticks ushr 30).toInt() and 0x07) shl 1) or 1).toByte()
            p[i + 1] = (ticks ushr 22).toInt().toByte()
            p[i + 2] = ((((ticks ushr 15).toInt() and 0x7F) shl 1) or 1).toByte()
            p[i + 3] = (ticks ushr 7).toInt().toByte()
            p[i + 4] = (((ticks.toInt() and 0x7F) shl 1) or 1).toByte()
        }

        fun hasPcr(p: ByteArray) = (u(p[3]) and 0x20) != 0 && u(p[4]) >= 7 && (u(p[5]) and 0x10) != 0

        fun readPcr(p: ByteArray): Long =
            (u(p[6]).toLong() shl 25) or (u(p[7]).toLong() shl 17) or (u(p[8]).toLong() shl 9) or
                (u(p[9]).toLong() shl 1) or (u(p[10]) ushr 7).toLong()

        /** TsExtractor ignores the PCR of an endless stream, but it moves with the timestamps so the stream stays valid. */
        fun shiftPcr(p: ByteArray, ticks: Long) {
            val base = wrap(readPcr(p) - ticks)
            p[6] = (base ushr 25).toInt().toByte()
            p[7] = (base ushr 17).toInt().toByte()
            p[8] = (base ushr 9).toInt().toByte()
            p[9] = (base ushr 1).toInt().toByte()
            p[10] = ((u(p[10]) and 0x7F) or ((base.toInt() and 1) shl 7)).toByte()
        }

        /** A packet with no PUSI carrying [n] payload bytes from data[from], the rest of the packet stuffing. */
        private fun continuation(pid: Int, cc: Int, data: ByteArray, from: Int, n: Int): ByteArray {
            val p = ByteArray(PACKET)
            p[0] = SYNC.toByte()
            p[1] = ((pid shr 8) and 0x1F).toByte()
            p[2] = (pid and 0xFF).toByte()
            if (n >= PACKET - 4) {
                p[3] = (0x10 or cc).toByte()
            } else {
                p[3] = (0x30 or cc).toByte()
                val length = PACKET - 5 - n
                p[4] = length.toByte()
                if (length > 0) {
                    p[5] = 0
                    for (i in 6 until 5 + length) p[i] = 0xFF.toByte()
                }
            }
            System.arraycopy(data, from, p, PACKET - n, n)
            return p
        }

        /** MPEG-2 CRC-32 over a section with its CRC: 0 when it is intact. */
        private fun sectionCrc(b: ByteArray, from: Int, to: Int): Int {
            var crc = -1
            for (i in from until to) {
                crc = crc xor (u(b[i]) shl 24)
                repeat(8) { crc = if (crc < 0) (crc shl 1) xor 0x04C11DB7 else crc shl 1 }
            }
            return crc
        }

        /**
         * The stream type TsExtractor uses (its PmtReader.readEsInfo): private data (0x05, 0x06) resolved through its
         * descriptors, the last one that names a type winning; -1, which the extractor doesn't read, when none does.
         */
        private fun resolveType(type: Int, b: ByteArray, from: Int, to: Int): Int {
            if (type != 0x06 && type != 0x05) return type
            var resolved = -1
            var i = from
            while (i + 2 <= to) {
                val tag = u(b[i])
                val length = u(b[i + 1])
                val body = i + 2
                if (body + length > to) break
                when (tag) {
                    0x05 -> if (length >= 4) {
                        when (String(CharArray(4) { (u(b[body + it])).toChar() })) {
                            "AC-3" -> resolved = TYPE_AC3
                            "EAC3" -> resolved = TYPE_EAC3
                            "AC-4" -> resolved = TYPE_AC4
                            "HEVC" -> resolved = TYPE_H265
                        }
                    }
                    0x6A -> resolved = TYPE_AC3
                    0x7A -> resolved = TYPE_EAC3
                    0x7B -> resolved = TYPE_DTS
                    0x7F -> if (length >= 1) when (u(b[body])) {
                        0x15 -> resolved = TYPE_AC4
                        0x0E -> resolved = TYPE_DTS_HD
                        0x21 -> resolved = TYPE_DTS_UHD
                    }
                    0x59 -> resolved = TYPE_DVB_SUBTITLES
                    0x6F -> resolved = TYPE_AIT
                }
                i = body + length
            }
            return resolved
        }

        /**
         * The codec configuration at the start of a PES payload, to tell a different encode: the SPS (H.264, H.265) or
         * sequence header (MPEG-2) when the payload has one; the parameters of an audio frame header. Null if none.
         */
        private fun configOf(type: Int, b: ByteArray, from: Int, n: Int): ByteArray? {
            val end = from + n
            when (type) {
                TYPE_H264, TYPE_H265, TYPE_MPEG2, TYPE_DC2_MPEG2 -> {
                    var i = from
                    while (i + 3 < end) {
                        if (b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 1) {
                            val v = u(b[i + 3])
                            val sps = when (type) {
                                TYPE_H264 -> (v and 0x1F) == 7
                                TYPE_H265 -> ((v shr 1) and 0x3F) == 33
                                else -> v == 0xB3
                            }
                            if (sps) {
                                if (type == TYPE_MPEG2 || type == TYPE_DC2_MPEG2) {
                                    return if (i + 12 <= end) b.copyOfRange(i + 4, i + 12) else null
                                }
                                var j = i + 4
                                while (j + 2 < end && !(b[j].toInt() == 0 && b[j + 1].toInt() == 0 && u(b[j + 2]) <= 1)) j++
                                if (j + 2 >= end) return null // the SPS runs past what is here
                                return b.copyOfRange(i + 3, j)
                            }
                            i += 3
                        } else i++
                    }
                    return null
                }
                TYPE_ADTS -> {
                    if (n < 4 || u(b[from]) != 0xFF || (u(b[from + 1]) and 0xF6) != 0xF0) return null
                    return byteArrayOf(b[from + 1], (u(b[from + 2]) and 0xFD).toByte(), (u(b[from + 3]) and 0xC0).toByte())
                }
                TYPE_MPEG1_AUDIO, TYPE_MPEG2_AUDIO -> {
                    if (n < 4 || u(b[from]) != 0xFF || (u(b[from + 1]) and 0xE0) != 0xE0) return null
                    return byteArrayOf((u(b[from + 1]) and 0xFE).toByte(), (u(b[from + 2]) and 0x0C).toByte(), (u(b[from + 3]) and 0xC0).toByte())
                }
                TYPE_AC3, TYPE_EAC3 -> {
                    if (n < 7 || u(b[from]) != 0x0B || u(b[from + 1]) != 0x77) return null
                    return if (type == TYPE_AC3) byteArrayOf((u(b[from + 4]) and 0xC0).toByte(), (u(b[from + 5]) and 0xF8).toByte(), (u(b[from + 6]) and 0xE0).toByte())
                    else byteArrayOf(b[from + 4], (u(b[from + 5]) and 0xF8).toByte())
                }
            }
            return null
        }

        private fun findSync(data: ByteArray, from: Int, n: Int): Int {
            var i = from
            while (i + 2 * PACKET < n) {
                if (u(data[i]) == SYNC && u(data[i + PACKET]) == SYNC && u(data[i + 2 * PACKET]) == SYNC) return i
                i++
            }
            return -1
        }

        /** The first picture's verdict: true for IDR or an I slice (as Media3's H264Reader with non-IDR keyframes), null if none. */
        internal fun h264Keyframe(b: ByteArray, n: Int): Boolean? {
            var i = 0
            while (i + 3 < n) {
                if (b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 1) {
                    val type = u(b[i + 3]) and 0x1F
                    if (type == 5) return true
                    if (type in 1..4) {
                        if (type != 1) return false
                        val bits = Bits(unescape(b, i + 4, n))
                        bits.ue() ?: return null // first_mb_in_slice
                        val sliceType = bits.ue() ?: return null
                        return sliceType == 2 || sliceType == 7
                    }
                    i += 3
                } else i++
            }
            return null
        }

        /** IRAP pictures (BLA, IDR, CRA: NAL types 16 to 21), as Media3's H265Reader. */
        internal fun h265Keyframe(b: ByteArray, n: Int): Boolean? {
            var i = 0
            while (i + 3 < n) {
                if (b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 1) {
                    val type = (u(b[i + 3]) shr 1) and 0x3F
                    if (type <= 31) return type in 16..21
                    i += 3
                } else i++
            }
            return null
        }

        /** A sequence header or an I picture. */
        internal fun mpeg2Keyframe(b: ByteArray, n: Int): Boolean? {
            var i = 0
            while (i + 5 < n) {
                if (b[i].toInt() == 0 && b[i + 1].toInt() == 0 && b[i + 2].toInt() == 1) {
                    val code = u(b[i + 3])
                    if (code == 0xB3) return true
                    if (code == 0x00) return ((u(b[i + 5]) shr 3) and 7) == 1
                    i += 3
                } else i++
            }
            return null
        }

        /** Up to 8 bytes of a NAL unit's payload with emulation prevention bytes removed. */
        private fun unescape(b: ByteArray, from: Int, n: Int): ByteArray {
            val result = ByteArray(8)
            var count = 0
            var zeros = 0
            var i = from
            while (i < n && count < result.size) {
                val v = u(b[i])
                if (zeros >= 2 && v == 3) {
                    zeros = 0
                } else {
                    result[count++] = v.toByte()
                    zeros = if (v == 0) zeros + 1 else 0
                }
                i++
            }
            return result.copyOf(count)
        }

        private class Bits(private val data: ByteArray) {
            private var position = 0
            private fun bit(): Int? {
                if (position >= data.size * 8) return null
                val v = (u(data[position / 8]) shr (7 - position % 8)) and 1
                position++
                return v
            }
            /** Exp-Golomb ue(v). */
            fun ue(): Int? {
                var zeros = 0
                while (true) {
                    val b = bit() ?: return null
                    if (b == 1) break
                    if (++zeros > 31) return null
                }
                var value = 0
                repeat(zeros) { value = (value shl 1) or (bit() ?: return null) }
                return (1 shl zeros) - 1 + value
            }
        }
    }
}
