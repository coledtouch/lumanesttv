package tv.lumanest.tuner

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import tv.lumanest.tuner.data.Prefs

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SourcePasswordPrefsTest {
    @Test fun plainTextPasswordsFromOlderVersionsStillLoad() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val saved = JSONArray().put(JSONObject().put("id", "legacy").put("name", "Legacy").put("type", "XTREAM")
            .put("server", "http://panel.invalid").put("username", "user").put("password", "secret"))
        context.getSharedPreferences("tuner", Context.MODE_PRIVATE).edit().putString("sources", saved.toString()).commit()
        val prefs = Prefs(context)
        assertEquals("secret", prefs.sources.value.single().password)
        // Robolectric has no Android Keystore; saving must still round-trip rather than lose the password.
        prefs.saveSource(prefs.sources.value.single().copy(name = "Renamed"))
        assertEquals("secret", Prefs(context).sources.value.single().password)
    }
}
