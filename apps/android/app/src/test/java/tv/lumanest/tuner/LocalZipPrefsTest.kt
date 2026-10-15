package tv.lumanest.tuner

import android.content.Context
import tv.lumanest.tuner.data.Prefs
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LocalZipPrefsTest {
    @Test fun localMarketIsOptInPersistentAndImmediatelyObservable() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("tuner", Context.MODE_PRIVATE).edit().remove("localZip").commit()
        val prefs = Prefs(context)
        assertEquals("", prefs.localZip.value)
        assertTrue(prefs.setLocalZip(" 01608 "))
        assertEquals("01608", prefs.localZip.value)
        assertEquals("01608", Prefs(context).localZip.value)
        assertFalse(prefs.setLocalZip("90210"))
        assertEquals("01608", prefs.localZip.value)
        assertTrue(prefs.setLocalZip(""))
        assertEquals("", prefs.localZip.value)
        assertEquals("", Prefs(context).localZip.value)
    }
}
