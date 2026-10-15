package tv.lumanest.tuner

import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.Cleanup
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.TitleLanguage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

class CleanupTest {
    private fun ch(key: String, name: String, epg: String? = null, cats: List<String> = listOf("us")) =
        Channel(key, 0, name, null, cats.first(), epg, key, "http://h/live/u/p/$key.ts", cats)

    private fun eastern(y: Int, mo: Int, d: Int, h: Int, mi: Int): Long =
        Calendar.getInstance(TimeZone.getTimeZone("America/New_York"), Locale.US).apply { clear(); set(y, mo - 1, d, h, mi, 0) }.timeInMillis

    @Test fun countryAndFeedTagsComeOff() {
        assertEquals("ESPN", Cleanup.displayName("US: ESPN"))
        assertEquals("MeTV (KAZA)", Cleanup.displayName("(US) (SP) MeTV (KAZA)"))
        assertEquals("TLC (East)", Cleanup.displayName("US TLC (East) (H)"))
        assertEquals("NATIONAL GEOGRAPHIC", Cleanup.displayName("US: NATIONAL GEOGRAPHIC HD"))
        assertEquals("BYUtv", Cleanup.displayName("(STV) (USA) BYUtv"))
        assertEquals("Storage Wars by A&E", Cleanup.displayName("(PLUTO USA) Storage Wars by A&E"))
        assertEquals("PBS KTNW (Yakima)", Cleanup.displayName("(US) (A) (Yakima) PBS KTNW"))
        assertEquals("NBA TV", Cleanup.displayName("NBA TV (D) (1080p59 @ 9.4Mbps)"))
        assertEquals("ESPN2", Cleanup.displayName("US (MAX) ESPN2 (HD @ 4.7 Mbps @ 29 FPS)"))
        assertEquals("TNT", Cleanup.displayName("USA  TNT"))
        assertEquals("Showtime Next", Cleanup.displayName("USA Showtime Next"))
        assertEquals("STARZ East", Cleanup.displayName("USA MOVIE: STARZ East"))
        assertEquals("CBS (KCBS)", Cleanup.displayName("USA REG: CBS (KCBS)"))
        assertEquals("TBN (Faith)", Cleanup.displayName("TBN (D) (Faith)"))
    }

    @Test fun officialNamesKeepTheirUsa() {
        assertEquals("USA Network", Cleanup.displayName("US: USA Network"))
        assertEquals("USA Network (West)", Cleanup.displayName("USA Network (West)"))
        assertEquals("USA", Cleanup.displayName("US USA (S)"))
        assertEquals("WWE Monday Night RAW", Cleanup.displayName("WWE Monday Night RAW"))
    }

    @Test fun emptyEventSlotsAreIdle() {
        listOf(
            "ESPN+ 78:", ":MAX US 71", "NHL | 13", "MLB 18: No event today", "Peacock | Event 20", "PPV EVENT 14",
            "USHTV 06: No Game Scheduled", "Tennis TV 16: No Match Scheduled", "(MAX 093) | (2098 12 31 08:00:55)", "NHL 07 : Offline",
        ).forEach { assertTrue(it, Cleanup.isIdleEvent(it)) }
        listOf(
            "ESPN", "FS1", "ESPN2", "NFL Network", "NBA 03: Thunder @ Hawks (10.12 7:00PM ET)", "FOX 5 (WNYW) New York",
            "Ligue 1: Angers vs Marseille | Sunday, 18 October 2026 14:00", "Music Choice: 80s",
        ).forEach { assertFalse(it, Cleanup.isIdleEvent(it)) }
    }

    @Test fun eventsThatEndedOrAreDaysAwayAreOffAir() {
        val now = eastern(2026, 10, 12, 22, 0)
        assertTrue(Cleanup.isOffAir("NFL 10: Commanders vs Giants (10.11 1:00PM ET)", now))
        assertFalse(Cleanup.isOffAir("NBA 03: Thunder @ Hawks (10.12 7:00PM ET)", now))
        assertTrue(Cleanup.isOffAir("HBO 38: AEW Dynamite (10.21 8:00PM ET)", now))
        assertTrue(Cleanup.isOffAir("UFC 02 : FIGHT NIGHT start:2026 10 11 01:55:00 stop:2026 10 11 06:00:00", now))
        assertFalse(Cleanup.isOffAir("MLB 02 : Guardians x Rays start:2026 10 13 01:00:00 stop:2026 10 13 08:13:20", now))
        assertTrue(Cleanup.isOffAir("NBA 04 : Knicks vs Wizards @ Oct 8 7:30 PM", now))
        assertFalse(Cleanup.isOffAir("CNN", now))
    }

    @Test fun copiesOfOneChannelFoldIntoOneEntryWithBackups() {
        val raw = listOf(
            ch("x1", "US: CNN HD"), ch("x2", "US: CNN", epg = "CNN.us"), ch("x3", "USA: CNN (Backup)"),
            ch("x4", "FOX: DALLAS TX KDFW"), ch("x5", "US FOX 4 (KDFW) Dallas (H)"),
            ch("x6", "US: ABC 23 Eureka (KAEF)"), ch("x7", "(US) (FOX1) FOX 28 (KAEF)"),
            ch("x8", "HBO (East)"), ch("x9", "HBO West"), ch("x10", "ESPN+ 78:"),
        )
        val lineup = Cleanup.lineup(raw, listOf(Category("us", "United States")))
        assertEquals(
            listOf("CNN", "FOX 4 (KDFW) Dallas", "ABC 23 Eureka (KAEF)", "FOX 28 (KAEF)", "HBO (East)", "HBO West"),
            lineup.channels.map { it.name },
        )
        val cnn = lineup.channels.first()
        assertEquals("x2", cnn.key) // the copy with guide data leads
        assertEquals(listOf("http://h/live/u/p/x1.ts", "http://h/live/u/p/x3.ts"), cnn.backups) // the "(Backup)" copy goes last
        assertEquals("x2", lineup.merged["x1"])
        assertEquals("x5", lineup.merged["x4"])
    }

    @Test fun hiddenChannelsStayOut() {
        val lineup = Cleanup.lineup(listOf(ch("x1", "US: CNN"), ch("x2", "US: CNN HD")), emptyList(), hidden = setOf("x1"))
        assertEquals(listOf("x2"), lineup.channels.map { it.key })
        assertTrue(lineup.channels.single().backups.isEmpty())
    }

    @Test fun reuploadedMoviesFoldIntoTheNewestCopy() {
        val movies = listOf(
            Movie("m:1", "Grafted (2024)", null, null, "1", "http://h/movie/1.mp4", added = 10, categoryIds = listOf("1")),
            Movie("m:2", "Grafted (2024)", null, null, "2", "http://h/movie/2.mp4", added = 30, categoryIds = listOf("2")),
            Movie("m:3", "Grafted (2023)", null, null, "1", "http://h/movie/3.mp4", added = 20),
        )
        val out = Cleanup.movies(movies)
        assertEquals(listOf("m:2", "m:3"), out.map { it.id })
        assertEquals(listOf("2", "1"), out.first().categoryIds)
        assertEquals(listOf("http://h/movie/1.mp4"), out.first().backups)
        assertTrue(out.last().backups.isEmpty())
    }

    @Test fun releaseTagsAndForeignWordsMarkForeignFilms() {
        listOf(
            "Invisibles FRENCH (2025)", "Last Hit NORDIC (2026)", "Los Domingos (2025)", "Il Mio Posto e Qui (2024)",
            "Der Untertan (1951)", "Un Petit Frere (2022)", "Ask Ve Yemek (2025)",
        ).forEach { assertTrue(it, TitleLanguage.looksForeign(it)) }
    }

    @Test fun englishFilmsWithForeignWordsStay() {
        listOf(
            "Destruction Las Vegas (2013)", "Cirque du Soleil Varekai", "French Fried Vacation (1978)", "Van Helsing (2004)",
            "Von Ryan's Express (1965)", "El Camino: A Breaking Bad Movie (2019)", "Mamma Mia (2008)", "Die Hard (1988)",
            "Top Gun (1986)", "Les Misérables (2012)", "Guillermo del Toro's Pinocchio (2022)", "The Ring (2002)",
        ).forEach { assertFalse(it, TitleLanguage.looksForeign(it)) }
    }

    @Test fun seriesOnlyGoByReleaseTags() {
        assertFalse(TitleLanguage.looksForeign("NCIS: Los Angeles", functionWords = false))
        assertTrue(TitleLanguage.looksForeign("Yoroiden Samurai Troopers E17 FRENCH", functionWords = false))
    }
}
