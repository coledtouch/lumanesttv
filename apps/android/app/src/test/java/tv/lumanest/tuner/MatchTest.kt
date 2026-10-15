package tv.lumanest.tuner

import tv.lumanest.tuner.data.ChannelMatch
import tv.lumanest.tuner.data.Xmltv
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MatchTest {
    @Test fun keysNormalizeProviderNoise() {
        val cnn = ChannelMatch.key("CNN")
        listOf("US: CNN HD", "|US| CNN ᴴᴰ", "[US] CNN (East)", "US - CNN FHD", "CNN 1080p").forEach {
            assertEquals(it, cnn, ChannelMatch.key(it))
        }
        assertEquals(ChannelMatch.key("USA Network"), ChannelMatch.key("US: USA Network HD"))
        assertEquals("foxnews", ChannelMatch.idKey("FoxNews.us"))
        assertEquals("fightnetwork", ChannelMatch.idKey("Fight.Network.us2"))
        assertEquals("ae", ChannelMatch.key("A&E HD"))
        assertEquals("ae", ChannelMatch.key("A and E HD East"))
        assertEquals("hgtv", ChannelMatch.key("Home and Garden Television HD"))
        assertEquals("CNN", ChannelMatch.display("US: CNN HD"))
    }

    /** Runs against a real epgshare01 file when one is supplied via -Dfree.epg=path. */
    @Test fun realFreeGuideMatches() {
        val path = System.getProperty("free.epg") ?: System.getenv("FREE_EPG")
        assumeTrue(path != null && File(path).exists())
        val names = listOf(
            "US: CNN HD", "US: ESPN FHD", "|US| AMC ᴴᴰ", "US: HGTV", "US: Food Network HD", "US: Discovery Channel",
            "US: TNT", "US: FX HD", "US: Bravo", "US: Comedy Central HD", "US: Hallmark Channel", "US: Fox News",
            "US: MSNBC", "US: Nickelodeon", "US: Disney Channel", "US: Cartoon Network", "US: A&E", "US: History Channel",
            "US: NFL Network", "US: Syfy", "US: USA Network", "US: TLC", "US: Lifetime", "US: Travel Channel",
        )
        val keys = names.map { ChannelMatch.key(it) }.toSet()
        val now = System.currentTimeMillis()
        val res = Xmltv.parse(File(path!!), HashSet(), keys, now - 4 * 3600_000L, now + 3 * 86_400_000L)
        val report = names.map { n ->
            val id = res.nameToId[ChannelMatch.key(n)]
            "$n -> $id (${res.programs[id]?.size ?: 0} progs, icon=${res.icons[id] != null})"
        }
        report.forEach { println("MATCH " + it) }
        val hits = names.count { res.programs[res.nameToId[ChannelMatch.key(it)]]?.isNotEmpty() == true }
        println("MATCHED $hits / ${names.size}")
        assumeTrue(hits > names.size / 2)
    }
}
