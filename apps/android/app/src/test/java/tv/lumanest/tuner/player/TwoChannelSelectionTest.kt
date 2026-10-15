package tv.lumanest.tuner.player

import android.app.Application
import tv.lumanest.tuner.data.Channel
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class TwoChannelSelectionTest {
    private val first = Channel("first", 1, "First channel", null, "fixture", null, null, "https://example.invalid/first.ts")
    private val second = first.copy(key = "second", number = 2, url = "https://example.invalid/second.ts")

    @Before fun suspendBeforeSelection() {
        TwoChannelPlayer.init(RuntimeEnvironment.getApplication())
        TwoChannelPlayer.stop()
        TwoChannelPlayer.onAppBackground()
    }

    @After fun releaseEverything() {
        TwoChannelPlayer.stop()
        TwoChannelPlayer.onAppForeground()
    }

    @Test fun suspendedSelectionHasExactlyTwoSlotsRejectsDuplicateFeedsAndCannotAllocateDecoders() {
        assertTrue(TwoChannelPlayer.play(0, first))
        assertFalse(TwoChannelPlayer.play(1, first))
        assertFalse(TwoChannelPlayer.play(1, second.copy(url = first.url)))
        assertTrue(TwoChannelPlayer.play(1, second))
        assertFalse(TwoChannelPlayer.play(2, second))
        assertEquals(2, TwoChannelPlayer.states.value.size)
        assertEquals(listOf(first, second), TwoChannelPlayer.states.value.map { it.channel })
        assertTrue(TwoChannelPlayer.states.value.all { it.status == TwoChannelPlayer.Status.PAUSED })
        assertNull(TwoChannelPlayer.player(0)); assertNull(TwoChannelPlayer.player(1)); assertNull(TwoChannelPlayer.player(2))
        assertTrue(TwoChannelPlayer.selectAudio(1)); assertEquals(1, TwoChannelPlayer.audioSlot.value)
        assertFalse(TwoChannelPlayer.selectAudio(2)); assertEquals(1, TwoChannelPlayer.audioSlot.value)
        TwoChannelPlayer.stop()
        assertFalse(TwoChannelPlayer.active.value)
        assertTrue(TwoChannelPlayer.states.value.all { it.channel == null && it.status == TwoChannelPlayer.Status.IDLE })
        assertFalse(TwoChannelPlayer.selectAudio(0))
        assertEquals(0, TwoChannelPlayer.audioSlot.value)
    }
}
