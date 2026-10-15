package tv.lumanest.tuner

import android.content.Intent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import tv.lumanest.tuner.data.LocalLineup
import tv.lumanest.tuner.data.Repo
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Checks real TV navigation with public accessibility actions on the instrumented debug build. */
@RunWith(AndroidJUnit4::class)
class DeviceNavigationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun nodes(): List<AccessibilityNodeInfo> {
        val list = mutableListOf<AccessibilityNodeInfo>()
        fun visit(node: AccessibilityNodeInfo?) {
            if (node == null) return
            list += node
            for (i in 0 until node.childCount) visit(node.getChild(i))
        }
        visit(instrumentation.uiAutomation.rootInActiveWindow)
        return list
    }
    private fun waitFor(vararg text: String): AccessibilityNodeInfo {
        val end = System.currentTimeMillis() + 60_000
        while (System.currentTimeMillis() < end) {
            nodes().firstOrNull { it.text?.toString() in text }?.let { return it }
            Thread.sleep(100)
        }
        throw AssertionError("Tuner never displayed ${text.joinToString()}")
    }
    private fun click(text: String) {
        var node = waitFor(text)
        while (!node.isClickable) node = node.parent ?: throw AssertionError("$text has no clickable parent")
        assertTrue("Could not open $text", node.performAction(AccessibilityNodeInfo.ACTION_CLICK))
        Thread.sleep(300)
    }
    /** Explicit user-requested setup. Ordinary test runs never change the saved home area. */
    @Test fun configureRequestedLocalMarket() {
        val zip = InstrumentationRegistry.getArguments().getString("localZip")
        assumeTrue("Home-area setup requires an explicit ZIP argument", zip != null)
        assertTrue("Unsupported home-area ZIP", Repo.prefs.setLocalZip(requireNotNull(zip)))
        // This opt-in setup has no Activity stop lifecycle to flush queued preference writes.
        assertTrue("Home-area setup could not be saved to disk", instrumentation.targetContext
            .getSharedPreferences("tuner", android.content.Context.MODE_PRIVATE)
            .edit().putString("localZip", zip).commit())
        assertEquals(zip, Repo.prefs.localZip.value)
        assertNotNull(LocalLineup.marketForZip(zip))
        instrumentation.sendStatus(2, android.os.Bundle().apply { putString("stream", "Saved requested local-station market\n") })
    }
    @Test fun movieSeriesAndGuidePagesOpenWithSavedProvider() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("uiCheck") == "true")
        instrumentation.targetContext.startActivity(Intent().setClassName("tv.lumanest.tuner", "tv.lumanest.tuner.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        click("Movies")
        waitFor("MOVIES", "Recently Added", "Continue Watching")
        click("Series")
        waitFor("SERIES", "Recently Updated", "Continue Watching")
        click("Live TV")
        waitFor("All Channels")
        click("Favorites")
        // No favorites are added or removed; the existing per-playlist list is preserved.
        assertTrue(nodes().any { it.text?.toString() == "Favorites" })
    }
}
