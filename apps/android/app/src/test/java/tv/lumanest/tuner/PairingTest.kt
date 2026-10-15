package tv.lumanest.tuner

import tv.lumanest.tuner.data.Pairing
import tv.lumanest.tuner.data.SourceType
import org.junit.Assert.*
import org.junit.Test

class PairingTest {
    @Test fun pairedAccountsBecomeXtreamOrM3uSources() {
        assertEquals(
            Pairing.Account(SourceType.M3U, "LumaNest TV", m3uUrl = "https://tv.lumanest.tv/m3u?u=a&p=b"),
            Pairing.account(mapOf("type" to "m3u", "name" to "LumaNest TV", "m3uUrl" to "https://tv.lumanest.tv/m3u?u=a&p=b")),
        )
        assertEquals(
            Pairing.Account(SourceType.XTREAM, "LumaNest TV", server = "https://x.lumanest.tv", username = "u", password = "p"),
            Pairing.account(mapOf("type" to "xtream", "server" to "https://x.lumanest.tv", "username" to "u", "password" to "p")),
        )
    }

    @Test fun unusableAccountsAreRejected() {
        assertNull(Pairing.account(mapOf("type" to "m3u", "m3uUrl" to "file:///sdcard/list.m3u")))
        assertNull(Pairing.account(mapOf("type" to "xtream", "server" to "https://x.lumanest.tv", "username" to "u")))
        assertNull(Pairing.account(mapOf("type" to "other")))
    }
}
