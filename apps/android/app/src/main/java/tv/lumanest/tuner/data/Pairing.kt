package tv.lumanest.tuner.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * "Pair with your phone": lumanest.tv hands out a QR code and a short code, the customer approves it on
 * their phone, and the TV receives its LumaNest playlist login. See site/lib/pairing.ts.
 */
object Pairing {
    const val API = "https://lumanest.tv/api/pair/"

    /** Off in Robolectric tests, so rendering the add-playlist screen never calls the live site. */
    var enabled = android.os.Build.FINGERPRINT != "robolectric"

    data class Code(val deviceCode: String, val userCode: String, val url: String, val qr: List<String>, val expiresInS: Int, val intervalS: Int)

    sealed interface Status {
        data object Pending : Status
        data object Expired : Status
        data class Approved(val account: Account) : Status
    }

    data class Account(val type: SourceType, val name: String, val server: String = "", val username: String = "", val password: String = "", val m3uUrl: String = "")

    suspend fun start(): Code {
        val json = post("start", JSONObject().put("device", "android"))
        val qr = (json["qr"] as? List<*>)?.filterIsInstance<String>().orEmpty()
        val deviceCode = json.str("deviceCode"); val userCode = json.str("userCode"); val url = json.str("verificationUriComplete")
        if (deviceCode == null || userCode == null || url == null || qr.isEmpty()) throw IllegalStateException("Pairing isn't available right now.")
        return Code(deviceCode, userCode, url, qr, json.int("expiresIn") ?: 600, (json.int("interval") ?: 5).coerceIn(2, 30))
    }

    suspend fun poll(deviceCode: String): Status {
        val json = post("poll", JSONObject().put("deviceCode", deviceCode))
        return when (json.str("status")) {
            "approved" -> json.obj("account")?.let(::account)?.let { Status.Approved(it) } ?: Status.Expired
            "pending" -> Status.Pending
            else -> Status.Expired
        }
    }

    /** Validates what the server sent; anything unusable is treated as an expired code. */
    fun account(map: JMap): Account? {
        val name = map.str("name") ?: "LumaNest TV"
        fun web(url: String?) = url?.takeIf { it.startsWith("https://", true) || it.startsWith("http://", true) }
        return when (map.str("type")) {
            "xtream" -> {
                val server = web(map.str("server")); val user = map.str("username"); val pass = map.str("password")
                if (server == null || user == null || pass == null) null else Account(SourceType.XTREAM, name, server = server, username = user, password = pass)
            }
            "m3u" -> web(map.str("m3uUrl"))?.let { Account(SourceType.M3U, name, m3uUrl = it) }
            else -> null
        }
    }

    private suspend fun post(path: String, body: JSONObject): JMap = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(API + path)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .header("User-Agent", "LumaNestTuner/Android").build()
        Net.client.newCall(request).execute().use { response ->
            @Suppress("UNCHECKED_CAST")
            val json = runCatching { parseJson(response.body?.string().orEmpty()) as? JMap }.getOrNull()
            if (!response.isSuccessful || json == null) {
                throw IllegalStateException(json?.obj("error")?.str("message") ?: "Couldn't reach LumaNest TV. Check the TV's internet connection.")
            }
            json
        }
    }

    private fun JMap.int(key: String): Int? = when (val v = this[key]) {
        is Number -> v.toInt()
        is String -> v.toIntOrNull()
        else -> null
    }
}
