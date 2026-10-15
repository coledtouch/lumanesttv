package tv.lumanest.tuner.player

import org.junit.Assert.*
import org.junit.Test

class PipAspectRatioTest {
    private fun ratio(width: Int, height: Int, pixels: Float) = PipAspectRatio.of(width, height, pixels).let { it.first.toDouble() / it.second }

    @Test fun respectsVideoDimensionsAndNonSquarePixels() {
        assertEquals(16.0 / 9.0, ratio(1920, 1080, 1f), 0.0001)
        assertEquals(4.0 / 3.0, ratio(720, 480, 8f / 9f), 0.0001)
    }

    @Test fun extremePortraitAndWideVideoStayInsideNativePipLimits() {
        assertTrue(ratio(100, 10000, 1f) >= 1.0 / 2.39)
        assertTrue(ratio(10000, 100, 1f) <= 2.39)
    }

    @Test fun missingOrInvalidDimensionsUseWidescreenFallback() {
        assertEquals(16.0 / 9.0, ratio(0, 0, 1f), 0.0001)
        assertEquals(16.0 / 9.0, ratio(1920, 1080, Float.NaN), 0.0001)
        assertEquals(16.0 / 9.0, ratio(1920, 1080, 0f), 0.0001)
    }
}
