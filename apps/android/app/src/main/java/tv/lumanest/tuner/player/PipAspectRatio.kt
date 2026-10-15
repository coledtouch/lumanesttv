package tv.lumanest.tuner.player

import kotlin.math.roundToInt

/** Normal PiP supports ratios from 1:2.39 through 2.39:1, including non-square video pixels. */
internal object PipAspectRatio {
    fun of(width: Int, height: Int, pixelRatio: Float): Pair<Int, Int> {
        val raw = if (width > 0 && height > 0) width.toDouble() * pixelRatio / height else 16.0 / 9.0
        val ratio = raw.takeIf { it.isFinite() && it > 0 } ?: 16.0 / 9.0
        // Round inward at the lower bound so floating-point conversion cannot violate Android's limit.
        return (ratio * 10_000).coerceIn(4185.0, 23900.0).roundToInt() to 10_000
    }
}
