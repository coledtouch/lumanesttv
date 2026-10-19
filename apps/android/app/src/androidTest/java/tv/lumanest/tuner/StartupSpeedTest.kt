package tv.lumanest.tuner

import android.app.Activity
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.LocalLineup
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.TwoChannelPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

/** Run alone in a fresh process, after a normal production load has saved its catalog snapshot. */
@RunWith(AndroidJUnit4::class)
class StartupSpeedTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun nodes(): List<AccessibilityNodeInfo> {
        val result = mutableListOf<AccessibilityNodeInfo>()
        fun visit(node: AccessibilityNodeInfo?) {
            if (node == null) return
            result += node
            for (i in 0 until node.childCount) visit(node.getChild(i))
        }
        visit(instrumentation.uiAutomation.rootInActiveWindow)
        return result
    }

    private fun navigation(label: String, visibleNodes: List<AccessibilityNodeInfo> = nodes()): AccessibilityNodeInfo? = visibleNodes.firstOrNull {
        it.contentDescription?.toString() == label
    } ?: visibleNodes.firstOrNull { it.text?.toString() == label }

    private fun awaitUi(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return
            SystemClock.sleep(50)
        }
        val visible = nodes()
        val labels = visible.mapNotNull { it.text?.toString() }.filter { it in setOf("Home", "Live TV", "Discover", "Library", "All Channels") }
        throw AssertionError("The saved guide or navigation did not become accessible: package=${visible.firstOrNull()?.packageName}, nodes=${visible.size}, controls=$labels")
    }

    private fun clickNavigation(label: String) {
        var node = navigation(label) ?: throw AssertionError("A navigation control is unavailable")
        while (!node.isClickable) node = node.parent ?: throw AssertionError("A navigation control has no clickable parent")
        assertTrue("The navigation control did not accept its accessibility action", node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
    }

    @Test fun savedLineupOpensWithinThreeSecondsAndRefreshNeverBlanksTheGuide() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("startupSpeedCheck") == "true")
        assertTrue("Save a configured playlist before running this benchmark", Repo.activeSource != null)
        assertTrue("Run the startup benchmark alone in a fresh app process", Repo.channels.value.isEmpty())
        assertTrue("The saved local lineup must be configured for ZIP 01608", Repo.prefs.localZip.value == LocalLineup.WORCESTER_ZIP)
        val originalFavorites = Repo.prefs.favorites.value.toSet()
        val originalHistoryTotal = Repo.prefs.watchHistory.value.values.sumOf { it.count }
        val originalLastChannel = Repo.prefs.lastChannelKey
        val originalSource = Repo.activeSource

        val started = SystemClock.elapsedRealtime()
        instrumentation.runOnMainSync { Repo.load() }
        val deadline = started + 3_000
        while (Repo.channels.value.isEmpty() && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(10)
        val firstLineupMs = SystemClock.elapsedRealtime() - started
        val saved = Repo.channels.value
        val news = saved.filter { LocalLineup.LOCAL_NEWS_ID in it.categoryIds }
        instrumentation.sendStatus(2, Bundle().apply {
            putString("stream", "STARTUP_SPEED firstLineupMs=$firstLineupMs channels=${saved.size} movies=${Repo.movies.value.size} series=${Repo.series.value.size} localNews=${news.size} cache={${Repo.snapshotDiagnostics()}}\n")
        })
        assertTrue("The saved channel lineup exceeded the 3000 ms startup budget", saved.isNotEmpty() && firstLineupMs <= 3_000)
        assertTrue("Saved nearby news is missing", news.isNotEmpty())
        assertTrue("Saved Manchester news is missing", news.any { it.name.contains("WMUR", true) })
        assertTrue("Saved Boston news is missing", news.any { Regex("WCVB|WBZ|WBTS|WFXT|WHDH", RegexOption.IGNORE_CASE).containsMatchIn(it.name) })
        assertTrue("Saved national cable news is missing", saved.any { it.name.contains("CNN", true) })
        assertTrue("Saved sports channels are missing", saved.any { it.name.startsWith("ESPN", true) })
        assertTrue("Saved channels do not match the current local policy", LocalLineup.filter(saved, Repo.liveCategories.value, Repo.prefs.localZip.value).map { it.key }.toSet() == saved.map { it.key }.toSet())
        assertTrue("Favorites changed while loading the saved lineup", Repo.prefs.favorites.value == originalFavorites)
        assertTrue("Watch counts changed while loading the saved lineup", Repo.prefs.watchHistory.value.values.sumOf { it.count } == originalHistoryTotal)
        assertTrue("Last watched channel changed while loading the saved lineup", Repo.prefs.lastChannelKey == originalLastChannel)

        var activity: Activity? = null
        var scenario: ActivityScenario<MainActivity>? = null
        val automation = instrumentation.uiAutomation
        val previousFlags = automation.serviceInfo.flags
        automation.serviceInfo = automation.serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        val emptyEmissions = AtomicInteger()
        // Unconfined observation runs at publication, including transient empty values
        // that an ordinary timed polling loop could miss between two samples.
        val observation = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)
        val observer = observation.launch(start = CoroutineStart.UNDISPATCHED) {
            Repo.channels.collect { if (it.isEmpty()) emptyEmissions.incrementAndGet() }
        }
        try {
            val launched = ActivityScenario.launch<MainActivity>(Intent(instrumentation.targetContext, MainActivity::class.java))
            scenario = launched
            launched.onActivity { activity = it }
            assertTrue("The app activity did not open", activity != null)
            // Tuner opens on Home unless Settings > Start on says Live TV; the benchmark measures the guide either way.
            awaitUi { val tree = nodes(); navigation("Live TV", tree) != null && navigation("Discover", tree) != null }
            if (nodes().none { it.text?.toString() == "All Channels" }) clickNavigation("Live TV")
            awaitUi { nodes().any { it.text?.toString() == "All Channels" } }

            val refreshStarted = SystemClock.elapsedRealtime()
            instrumentation.runOnMainSync { Repo.load(force = true) }
            // This check observes the beginning of refresh; it intentionally does not
            // wait for fresh provider downloads or guide/film parsing to finish.
            repeat(15) {
                assertTrue("Refresh temporarily emptied the saved lineup", Repo.channels.value.isNotEmpty() && emptyEmissions.get() == 0)
                val tree = nodes(); assertTrue("Navigation became unavailable during refresh", navigation("Live TV", tree) != null && navigation("Discover", tree) != null)
                SystemClock.sleep(100)
            }
            clickNavigation("Discover")
            awaitUi { val tree = nodes(); navigation("Discover", tree) != null && navigation("Live TV", tree) != null }
            clickNavigation("Live TV")
            awaitUi { nodes().any { it.text?.toString() == "All Channels" } }
            assertTrue("Refresh published an empty channel lineup", emptyEmissions.get() == 0)
            instrumentation.sendStatus(2, Bundle().apply {
                putString("stream", "STARTUP_SPEED refreshObservedMs=${SystemClock.elapsedRealtime() - refreshStarted} channels=${Repo.channels.value.size} emptyEmissions=${emptyEmissions.get()} navigationChecks=2\n")
            })
            assertTrue("The active playlist changed during the benchmark", Repo.activeSource == originalSource)
            assertTrue("Favorites changed during startup or refresh", Repo.prefs.favorites.value == originalFavorites)
            assertTrue("Watch counts changed during startup or refresh", Repo.prefs.watchHistory.value.values.sumOf { it.count } == originalHistoryTotal)
            assertTrue("Last watched channel changed during startup or refresh", Repo.prefs.lastChannelKey == originalLastChannel)
        } finally {
            observer.cancel()
            observation.cancel()
            instrumentation.runOnMainSync { PlayerHolder.stop(); TwoChannelPlayer.stop() }
            scenario?.close()
            automation.serviceInfo = automation.serviceInfo.apply { flags = previousFlags }
        }
    }
}
