package tv.lumanest.tuner

import tv.lumanest.tuner.ui.multiViewFrames
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MultiViewFrameTest {
    @Test fun splitUsesTheWholeWidthWithCenteredUncroppedSixteenByNinePictures() {
        val frames = multiViewFrames(960f, 540f, false, true)
        assertEquals(0f, frames[0].x, 0.01f)
        assertEquals(480f, frames[1].x, 0.01f)
        frames.forEach {
            assertEquals(480f, it.width, 0.01f)
            assertEquals(270f, it.height, 0.01f)
            assertEquals(135f, it.y, 0.01f)
            assertEquals(16f / 9, it.width / it.height, 0.01f)
        }
    }

    @Test fun pictureInPictureMainFillsTheViewportAndTheInsetStaysInsideIt() {
        val frames = multiViewFrames(960f, 540f, true, true)
        assertEquals(0f, frames[0].x, 0.01f)
        assertEquals(0f, frames[0].y, 0.01f)
        assertEquals(960f, frames[0].width, 0.01f)
        assertEquals(540f, frames[0].height, 0.01f)
        assertTrue(frames[1].x > 0 && frames[1].y > 0)
        assertEquals(948f, frames[1].x + frames[1].width, 0.01f)
        assertEquals(528f, frames[1].y + frames[1].height, 0.01f)
        assertEquals(16f / 9, frames[1].width / frames[1].height, 0.01f)
    }
}
