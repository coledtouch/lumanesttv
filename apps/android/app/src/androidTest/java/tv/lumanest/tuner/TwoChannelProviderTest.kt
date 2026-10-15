package tv.lumanest.tuner

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.WindowManager
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.media3.common.C
import androidx.media3.ui.PlayerView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.LoadStatus
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.TwoChannelPlayer
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale

/** Opt in with -e twoChannelProviderCheck true after freeing the provider's two stream slots. */
@RunWith(AndroidJUnit4::class)
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class TwoChannelProviderTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    @Test fun savedProviderPlaysTwoNationalChannelsAndSwitchesTheirAudio() {
        assumeTrue("Saved-provider dual checks require explicit opt-in",
            InstrumentationRegistry.getArguments().getString("twoChannelProviderCheck") == "true")
        assumeTrue("Do not interrupt existing playback", onMain {
            PlayerHolder.currentUrl == null && !TwoChannelPlayer.active.value
        })
        assertNotNull("No saved provider is configured", Repo.activeSource)
        if (Repo.channels.value.isEmpty() && Repo.liveStatus.value !is LoadStatus.Loading) Repo.load()
        val catalogDeadline = SystemClock.elapsedRealtime() + 120_000
        while (Repo.channels.value.isEmpty() && Repo.liveStatus.value !is LoadStatus.Error &&
            SystemClock.elapsedRealtime() < catalogDeadline) Thread.sleep(100)
        assertTrue("Live lineup did not load: ${Repo.liveStatus.value.javaClass.simpleName}, ${Repo.channels.value.size} channels",
            Repo.channels.value.isNotEmpty())
        val channels = chooseNationalFeeds(Repo.channels.value)
        assertEquals("The saved lineup needs two distinct national feeds for this check", 2, channels.size)
        status("Chosen national feeds: ${channels.joinToString { it.name }}. Lineup: ${Repo.channels.value.size} channels.")
        val historyBefore = Repo.prefs.watchHistory.value
        val lastChannelBefore = Repo.prefs.lastChannelKey

        // This declared debug activity hosts surfaces without launching App's provider/navigation flow.
        val scenario = ActivityScenario.launch<ComponentActivity>(Intent(instrumentation.targetContext, ComponentActivity::class.java))
        val views = ArrayList<PlayerView>()
        try {
            scenario.onActivity { activity ->
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val layout = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
                repeat(2) {
                    val view = PlayerView(activity).apply { useController = false }
                    views += view
                    layout.addView(view, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
                }
                activity.setContentView(layout)
            }
            onMain {
                TwoChannelPlayer.init(instrumentation.targetContext)
                PlayerHolder.onAppForeground()
                // A retry does not count a new visit. Configuring and retrying before the first
                // prepare lets this provider check leave the viewer's history untouched.
                TwoChannelPlayer.onAppBackground()
                assertTrue(TwoChannelPlayer.play(0, channels[0]))
                assertTrue(TwoChannelPlayer.play(1, channels[1]))
                TwoChannelPlayer.retry(0); TwoChannelPlayer.retry(1)
                TwoChannelPlayer.onAppForeground()
                views.forEachIndexed { slot, view -> view.player = TwoChannelPlayer.player(slot) }
                assertNull("Dual view left another ordinary stream playing", PlayerHolder.currentUrl)
            }
            waitFor("Both provider channels did not render", 60_000) { bothRender() }
            val players = onMain { (0..1).map { requireNotNull(TwoChannelPlayer.player(it)) } }
            val positions = onMain { players.map { it.currentPosition } }
            val rendered = onMain { players.map { it.videoDecoderCounters?.renderedOutputBufferCount ?: 0 } }
            waitFor("Both provider clocks and video decoders did not advance", 15_000) {
                players.indices.all { slot ->
                    players[slot].currentPosition - positions[slot] >= 750 &&
                        (players[slot].videoDecoderCounters?.renderedOutputBufferCount ?: 0) > rendered[slot]
                }
            }
            status("Both national feeds rendered and advanced. Frames: ${onMain { players.map { it.videoDecoderCounters?.renderedOutputBufferCount ?: 0 } }}.")
            for (selected in listOf(1, 0)) {
                val mediaIds = onMain { players.map { it.currentMediaItem?.mediaId } }
                onMain { assertTrue(TwoChannelPlayer.selectAudio(selected)) }
                waitFor("Provider sound selection did not enable only the chosen soundtrack", 15_000) {
                    players[selected].volume == 1f && players[1 - selected].volume == 0f &&
                        !players[selected].trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO) &&
                        players[1 - selected].trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_AUDIO) &&
                        players[selected].currentTracks.isTypeSelected(C.TRACK_TYPE_AUDIO) &&
                        !players[1 - selected].currentTracks.isTypeSelected(C.TRACK_TYPE_AUDIO) && bothRender()
                }
                onMain {
                    assertSame("Selecting sound replaced the first decoder", players[0], TwoChannelPlayer.player(0))
                    assertSame("Selecting sound replaced the second decoder", players[1], TwoChannelPlayer.player(1))
                    assertEquals("Selecting sound reopened a provider media item", mediaIds, players.map { it.currentMediaItem?.mediaId })
                    assertNull(PlayerHolder.currentUrl)
                }
                status("Sound selected: ${channels[selected].name}. Both pictures continue.")
            }
            onMain {
                views.forEach { it.player = null }
                TwoChannelPlayer.stop()
                assertNull(TwoChannelPlayer.player(0)); assertNull(TwoChannelPlayer.player(1))
                assertFalse(TwoChannelPlayer.active.value)
                assertTrue(TwoChannelPlayer.states.value.all { it.channel == null })
                assertTrue("Provider verification changed viewing history", historyBefore == Repo.prefs.watchHistory.value)
                assertTrue("Provider verification changed the last watched channel", lastChannelBefore == Repo.prefs.lastChannelKey)
            }
            status("Both provider players released.")
        } finally {
            onMain {
                views.forEach { it.player = null }
                TwoChannelPlayer.stop()
                TwoChannelPlayer.onAppForeground()
                PlayerHolder.stop()
            }
            scenario.close()
        }
    }

    private fun chooseNationalFeeds(lineup: List<Channel>): List<Channel> {
        val national = listOf("COMEDY CENTRAL", "ESPN", "ESPN2", "CNN", "FOX NEWS", "USA NETWORK", "TNT", "TBS", "FS1", "NFL NETWORK", "MSNBC")
        fun rank(channel: Channel): Int {
            val name = channel.name.uppercase(Locale.US).replace(Regex("\\s+"), " ").trim()
            return national.indexOfFirst { brand ->
                name == brand || name.startsWith("$brand HD") || name.startsWith("$brand FHD") ||
                    name.startsWith("$brand SD") || name.startsWith("$brand USA") || name.startsWith("US: $brand")
            }.takeIf { it >= 0 } ?: Int.MAX_VALUE
        }
        val candidates = lineup.filter { rank(it) != Int.MAX_VALUE }.sortedBy(::rank)
        val result = ArrayList<Channel>(2)
        for (candidate in candidates) {
            val sources = (listOf(candidate.url) + candidate.backups).toSet()
            if (result.none { chosen -> rank(chosen) == rank(candidate) || chosen.key == candidate.key ||
                    (listOf(chosen.url) + chosen.backups).any(sources::contains) }) result += candidate
            if (result.size == 2) break
        }
        return result
    }

    private fun bothRender() = (0..1).all { slot ->
        val player = TwoChannelPlayer.player(slot)
        player != null && player.isPlaying && (player.videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0 &&
            TwoChannelPlayer.states.value[slot].error == null
    }

    private fun waitFor(message: String, timeoutMs: Long, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) {
            if (onMain(condition)) return
            if (TwoChannelPlayer.states.value.any { it.status == TwoChannelPlayer.Status.ERROR }) break
            Thread.sleep(100)
        }
        val states = TwoChannelPlayer.states.value.joinToString { "${it.channel?.name}: ${it.status}/${it.error.orEmpty()}" }
        fail("$message. $states")
    }

    private fun status(message: String) {
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "$message\n") })
    }

    private fun <T> onMain(block: () -> T): T {
        var result: T? = null
        instrumentation.runOnMainSync { result = block() }
        @Suppress("UNCHECKED_CAST") return result as T
    }
}
