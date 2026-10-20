package tv.lumanest.tuner

import android.content.ActivityNotFoundException
import android.content.ContextWrapper
import android.content.Intent
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import tv.lumanest.tuner.ui.TrailerLauncher
import tv.lumanest.tuner.ui.qrRows

/** How Android hands a trailer to YouTube (docs/extras.md, "Per platform"), and the QR code shown when it can't. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TrailerTest {
    private val key = "vKQi3bBA1y8"

    /** A context whose YouTube apps are [installed] (by package; null is the package-less `vnd.youtube:` link). */
    private class Tv(private val installed: Set<String?>, private val refused: Set<String?> = emptySet()) : ContextWrapper(RuntimeEnvironment.getApplication()) {
        val tried = mutableListOf<Intent>()
        override fun startActivity(intent: Intent) {
            tried += intent
            if (intent.`package` in refused) throw SecurityException("Not exported")
            if (intent.`package` !in installed) throw ActivityNotFoundException("No activity for ${intent.`package`}")
        }
    }

    @Test fun theTvYouTubeAppsAreTriedInOrderThenTheYouTubeLink() {
        val expected = listOf("com.google.android.youtube.tv", "com.amazon.firetv.youtube", "com.amazon.firetv.youtube.tv",
            "com.google.android.youtube.googletv", "com.google.android.youtube", null)
        val nothing = Tv(installed = emptySet())
        assertFalse(TrailerLauncher.open(nothing, key))
        assertEquals(expected, nothing.tried.map { it.`package` })
        assertTrue(nothing.tried.all { it.action == Intent.ACTION_VIEW })
        assertEquals(List(5) { "https://www.youtube.com/watch?v=$key" } + "vnd.youtube:$key", nothing.tried.map { it.dataString })
        // Not an activity: the intent starts a new task.
        assertTrue(nothing.tried.all { it.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0 })

        val fireTv = Tv(installed = setOf("com.amazon.firetv.youtube.tv", "com.google.android.youtube"))
        assertTrue(TrailerLauncher.open(fireTv, key))
        assertEquals(expected.take(3), fireTv.tried.map { it.`package` })

        val refusing = Tv(installed = setOf("com.google.android.youtube.tv", null), refused = setOf("com.google.android.youtube.tv"))
        assertTrue(TrailerLauncher.open(refusing, key))
        assertEquals(null, refusing.tried.last().`package`)
        assertEquals(6, refusing.tried.size)
    }

    @Test fun aKeyThatIsntAYouTubeKeyOpensNothing() {
        listOf("", "vKQi3bBA1y", "vKQi3bBA1y8&list=x", "../../x/abc", "vKQi3bBA1y8 ").forEach { bad ->
            val tv = Tv(installed = setOf(null))
            assertFalse(bad, TrailerLauncher.open(tv, bad))
            assertTrue(tv.tried.isEmpty())
        }
    }

    @Test fun anActivityContextKeepsItsTask() {
        val intent = TrailerLauncher.intent(TrailerLauncher.attempts(key).first(), newTask = false)
        assertEquals("com.google.android.youtube.tv", intent.`package`)
        assertEquals(0, intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    @Test fun theQrCodeOpensTheTrailerOnAPhone() {
        val rows = qrRows("https://youtu.be/$key")
        assertTrue(rows.size >= 21)
        assertTrue(rows.all { row -> row.length == rows.size && row.all { it == '0' || it == '1' } })
        // Read it back as a phone camera would: 4 pixels a module and a quiet zone of 4 modules.
        val scale = 4; val quiet = 4; val size = (rows.size + 2 * quiet) * scale
        val pixels = IntArray(size * size) { 0xFFFFFFFF.toInt() }
        rows.forEachIndexed { y, row -> row.forEachIndexed { x, c ->
            if (c == '1') for (dy in 0 until scale) for (dx in 0 until scale) pixels[((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx] = 0xFF000000.toInt()
        } }
        val text = QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(size, size, pixels)))).text
        assertEquals("https://youtu.be/$key", text)
    }
}
