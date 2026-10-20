package tv.lumanest.tuner

import tv.lumanest.tuner.data.AdultFilter
import tv.lumanest.tuner.data.CatalogSnapshots
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.M3u
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.Passcode
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import tv.lumanest.tuner.data.Xtream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AdultContentTest {
    private fun temp(text: String): File = File.createTempFile("tuner-adult", ".json").apply { writeText(text); deleteOnExit() }
    private fun channel(name: String, ids: List<String>, adult: Boolean = false) =
        Channel("k:$name", 1, name, null, ids.first(), null, null, "http://example/live/$name.ts", ids, adult = adult)

    @Test fun adultNamesAreStandaloneTokens() {
        listOf("XXX | Adult", "Adults 18+", "FOR ADULTS", "xxx", "Adult", "PORN", "18+ Movies", "VOD: XXX", "[XXX] Channels", "Adult Swim | XXX")
            .forEach { assertTrue(it, AdultFilter.isAdultName(it)) }
        listOf("Essex", "Taxxi", "Adult Swim", "ADULT SWIM HD", "adultswim", "Sports", "Kids", "Mature Drama", "118 News", "Pornic Travel", "XXXL Shows", null, "")
            .forEach { assertFalse(it.toString(), AdultFilter.isAdultName(it)) }
    }

    @Test fun providerFlagCountsInEveryShape() {
        listOf("1", "true", "TRUE", " 1 ", "1.0", "yes").forEach { assertTrue(it, AdultFilter.isAdultFlag(it)) }
        listOf("0", "false", "", null, "no", "0.0").forEach { assertFalse(it.toString(), AdultFilter.isAdultFlag(it)) }
        assertTrue(AdultFilter.isAdult(Category("7", "Late Night", adult = true)))
        assertFalse(AdultFilter.isAdult(Category("8", "Late Night")))
    }

    @Test fun lockedCataloguesDropAdultCategoriesAndTheirItems() {
        val categories = listOf(Category("news", "USA | News"), Category("xxx", "USA | XXX"), Category("flag", "USA | Night", adult = true),
            Category("swim", "USA | Adult Swim"))
        val items = listOf(
            channel("CNN", listOf("news")), channel("Hot", listOf("xxx")), channel("Both", listOf("news", "xxx")),
            channel("Flagged cat", listOf("flag")), channel("Flagged item", listOf("news"), adult = true), channel("Cartoons", listOf("swim")),
        )
        val locked = ContentPolicy.live(items, categories, usOnly = false)
        assertEquals(listOf("CNN", "Cartoons"), locked.items.map { it.name })
        assertEquals(setOf("news", "swim"), locked.categories.map { it.id }.toSet())
        val lockedUs = ContentPolicy.live(items, categories, usOnly = true)
        assertEquals(listOf("CNN", "Cartoons"), lockedUs.items.map { it.name })

        val unlocked = ContentPolicy.live(items, categories, usOnly = false, adultUnlocked = true)
        assertEquals(items.map { it.name }, unlocked.items.map { it.name })
        assertTrue(unlocked.categories.any { it.id == "xxx" })
    }

    @Test fun moviesAndSeriesFollowTheSameLock() {
        val categories = listOf(Category("a", "Action"), Category("x", "FOR ADULTS"))
        val movies = listOf(
            Movie("m:1", "Heat", null, null, "a", "http://example/m/1.mp4"),
            Movie("m:2", "Night", null, null, "x", "http://example/m/2.mp4"),
            Movie("m:3", "Flagged", null, null, "a", "http://example/m/3.mp4", adult = true),
        )
        assertEquals(listOf("Heat"), ContentPolicy.movies(movies, categories).items.map { it.name })
        assertEquals(3, ContentPolicy.movies(movies, categories, adultUnlocked = true).items.size)
        val series = listOf(
            Series("1", "Drama", null, null, null, "a", null, null, null),
            Series("2", "After Dark", null, null, null, "x", null, null, null),
        )
        assertEquals(listOf("Drama"), ContentPolicy.series(series, categories).items.map { it.name })
        assertEquals(listOf("a"), ContentPolicy.series(series, categories).categories.map { it.id })
    }

    @Test fun xtreamIsAdultFlagIsParsed() {
        val source = Source("s", "S", SourceType.XTREAM, "http://example", "u", "p")
        val x = Xtream(source)
        val categories = x.parseCategories(temp("""[{"category_id":"1","category_name":"Late","is_adult":"1"},{"category_id":"2","category_name":"News","is_adult":0}]"""))
        assertEquals(listOf(true, false), categories.map { it.adult })
        val movies = x.parseMovies(temp("""[{"stream_id":5,"name":"A","category_id":"2","is_adult":true},{"stream_id":6,"name":"B","category_id":"2"}]"""))
        assertEquals(listOf(true, false), movies.map { it.adult })
        assertEquals(listOf("B"), ContentPolicy.movies(movies, categories).items.map { it.name })
    }

    @Test fun m3uGroupTitlesAreChecked() {
        val playlist = M3u.parse(temp("#EXTM3U\n#EXTINF:-1 group-title=\"XXX Adults\",Late\nhttp://example/live/1.ts\n#EXTINF:-1 group-title=\"USA News\",CNN\nhttp://example/live/2.ts\n"))
        assertEquals(listOf("CNN"), ContentPolicy.live(playlist.channels, playlist.liveCategories, usOnly = false).items.map { it.name })
    }

    @Test fun lockStateIsPartOfTheSnapshotIdentity() {
        val source = Source("s", "S", SourceType.XTREAM, "http://example", "u", "p")
        val locked = CatalogSnapshots.identity(source, "ts", "")
        val unlocked = CatalogSnapshots.identity(source, "ts", "", adultUnlocked = true)
        assertEquals(locked.source, unlocked.source)
        assertNotEquals(locked.catalogue, unlocked.catalogue)
        assertNotEquals(locked.live, unlocked.live)
    }

    @Test fun passcodeIsSaltedAndVerified() {
        val salt = Passcode.newSalt()
        val other = Passcode.newSalt()
        assertNotEquals(salt, other)
        val hash = Passcode.hash("1234", salt)
        assertEquals(64, hash.length)
        // The digits never show in the hash. Checked with a fixed salt: a random hash holds "1234" about once in a
        // thousand runs, which made this test fail by chance.
        val fixed = Passcode.hash("1234", "00".repeat(16))
        assertEquals("af88269895fea9e985d8e7587268ea2fd6d0a639cc0438c88a9b22d6ce96b3ba", fixed)
        assertFalse(fixed.contains("1234"))
        assertNotEquals(hash, Passcode.hash("1234", other))
        assertTrue(Passcode.verify("1234", salt, hash))
        assertFalse(Passcode.verify("1235", salt, hash))
        assertFalse(Passcode.verify("1234", other, hash))
        assertFalse(Passcode.verify("1234", null, hash))
        assertFalse(Passcode.verify("12a4", salt, Passcode.hash("12a4", salt)))
        assertTrue(Passcode.isValid("0000"))
        assertFalse(Passcode.isValid("123"))
        assertFalse(Passcode.isValid("12345"))
    }

    @Test fun fiveWrongTriesWaitSixtySeconds() {
        val salt = Passcode.newSalt()
        val hash = Passcode.hash("2468", salt)
        var attempts = Passcode.Attempts()
        val now = 1_000_000L
        for (left in 4 downTo 1) {
            val (result, next) = Passcode.check("0000", salt, hash, attempts, now)
            assertEquals(Passcode.Check.Wrong(left), result)
            attempts = next
        }
        val (fifth, lockedOut) = Passcode.check("0000", salt, hash, attempts, now)
        assertEquals(Passcode.Check.LockedOut(Passcode.LOCKOUT_MS), fifth)
        // Even the right passcode waits out the lockout.
        val (during, _) = Passcode.check("2468", salt, hash, lockedOut, now + 30_000)
        assertEquals(Passcode.Check.LockedOut(30_000), during)
        val (after, cleared) = Passcode.check("2468", salt, hash, lockedOut, now + Passcode.LOCKOUT_MS)
        assertEquals(Passcode.Check.Ok, after)
        assertEquals(Passcode.Attempts(), cleared)
        // A clock moved backwards never makes the wait longer than one lockout.
        assertEquals(Passcode.LOCKOUT_MS, lockedOut.waitMs(0))
    }
}
