package tv.lumanest.tuner

import android.content.Context
import android.content.pm.FeatureInfo
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import tv.lumanest.tuner.data.AdultFilter
import tv.lumanest.tuner.data.CatalogSnapshots
import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.FreeEpg
import tv.lumanest.tuner.data.Movie
import tv.lumanest.tuner.data.PhoneSetup
import tv.lumanest.tuner.data.Prefs
import tv.lumanest.tuner.data.Repo
import tv.lumanest.tuner.data.Series
import tv.lumanest.tuner.data.Source
import tv.lumanest.tuner.data.SourceType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The store edition (`-Pstore=true`, Google Play and Amazon Appstore) against the direct edition (the lumanest.tv APK).
 * Both editions are exercised here through their parameters; the direct edition must behave exactly as before.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StoreEditionTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun freshPrefs() = context.getSharedPreferences("tuner", Context.MODE_PRIVATE).edit().clear().commit()
    private fun channel(name: String, category: String) =
        Channel("k:$name", 1, name, null, category, null, null, "http://example/live/${name.hashCode()}.ts", listOf(category))

    @Test fun buildFlagDrivesTheEditionAndTheManifest() {
        assertEquals(BuildConfig.STORE_BUILD, Edition.STORE)
        assertTrue(Edition.pictureInPictureAllowed(store = false))
        assertFalse(Edition.pictureInPictureAllowed(store = true))
        // The merged manifest follows the same flag: TV-only and no picture-in-picture in the store edition.
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_CONFIGURATIONS or PackageManager.GET_ACTIVITIES)
        val leanback = info.reqFeatures.orEmpty().single { it.name == PackageManager.FEATURE_LEANBACK }
        assertEquals(Edition.STORE, leanback.flags and FeatureInfo.FLAG_REQUIRED != 0)
        val main = info.activities.orEmpty().single { it.name == MainActivity::class.java.name }
        // ActivityInfo.FLAG_SUPPORTS_PICTURE_IN_PICTURE is hidden API.
        assertEquals(!Edition.STORE, main.flags and 0x400000 != 0)
    }

    @Test fun storeEditionNeverUnlocksAdultContent() {
        freshPrefs()
        val direct = Prefs(context, storeBuild = false)
        assertTrue(direct.setAdultPasscode("1234"))
        direct.setAdultUnlocked(true)
        assertTrue(direct.adultUnlocked.value)
        // A Play or Amazon install replaces the lumanest.tv APK in place (same key, same data): its unlock is ignored.
        val store = Prefs(context, storeBuild = true)
        assertFalse(store.adultUnlocked.value)
        store.setAdultUnlocked(true)
        assertFalse(store.adultUnlocked.value)
        // The lumanest.tv APK keeps the customer's own unlock and passcode.
        assertTrue(Prefs(context, storeBuild = false).adultUnlocked.value)
    }

    @Test fun storeEditionHidesAdultCategoryVariantsAndChannelNames() {
        val categories = listOf(
            Category("ent", "USA | Entertainment"), Category("plus", "+18 Movies"), Category("es", "ADULTOS"),
            Category("ero", "Erotica"), Category("xxx", "XXX"), Category("swim", "USA | Adult Swim"),
        )
        val items = listOf(
            channel("CNN", "ent"), channel("Playboy TV", "ent"), channel("XXX Live", "ent"), channel("Hot Movies", "plus"),
            channel("Canal Rojo", "es"), channel("Night", "ero"), channel("Late", "xxx"), channel("Cartoons", "swim"),
        )
        // Direct edition, exactly as before: only the "XXX" category is hidden while locked.
        val direct = ContentPolicy.live(items, categories, usOnly = false)
        assertEquals(listOf("CNN", "Playboy TV", "XXX Live", "Hot Movies", "Canal Rojo", "Night", "Cartoons"), direct.items.map { it.name })
        assertEquals(items.map { it.name }, ContentPolicy.live(items, categories, usOnly = false, adultUnlocked = true).items.map { it.name })

        // Store edition: wider spellings, adult channel names, and no unlock even if one is passed in.
        listOf(false, true).forEach { unlocked ->
            val store = ContentPolicy.live(items, categories, usOnly = false, adultUnlocked = unlocked, storeBuild = true)
            assertEquals(listOf("CNN", "Cartoons"), store.items.map { it.name })
            assertEquals(setOf("ent", "swim"), store.categories.map { it.id }.toSet())
        }
        assertEquals(listOf("CNN", "Cartoons"),
            ContentPolicy.live(items, categories, usOnly = true, adultUnlocked = true, storeBuild = true).items.map { it.name })
    }

    @Test fun storeEditionChecksTitlesWithoutHidingOrdinaryFilms() {
        val categories = listOf(Category("a", "Action"), Category("e", "Erotic"))
        val movies = listOf(
            Movie("m:1", "Heat", null, null, "a", "http://example/m/1.mp4"),
            Movie("m:2", "xXx: Return of Xander Cage", null, null, "a", "http://example/m/2.mp4"),
            Movie("m:3", "The Hustler", null, null, "a", "http://example/m/3.mp4"),
            Movie("m:4", "Young Adult", null, null, "a", "http://example/m/4.mp4"),
            Movie("m:5", "XXX Parody", null, null, "a", "http://example/m/5.mp4"),
            Movie("m:6", "Late Show 18+", null, null, "a", "http://example/m/6.mp4"),
            Movie("m:7", "Velvet", null, null, "e", "http://example/m/7.mp4"),
        )
        assertEquals(movies.map { it.name }, ContentPolicy.movies(movies, categories).items.map { it.name })
        assertEquals(listOf("Heat", "xXx: Return of Xander Cage", "The Hustler", "Young Adult"),
            ContentPolicy.movies(movies, categories, adultUnlocked = true, storeBuild = true).items.map { it.name })

        val series = listOf(
            Series("1", "The Penthouse", null, null, null, "a", null, null, null),
            Series("2", "Porn Stars Uncovered", null, null, null, "a", null, null, null),
            Series("3", "After Dark", null, null, null, "e", null, null, null),
        )
        assertEquals(3, ContentPolicy.series(series, categories).items.size)
        assertEquals(listOf("The Penthouse"), ContentPolicy.series(series, categories, storeBuild = true).items.map { it.name })
    }

    @Test fun theXxxFilmsStayVisibleInAnyCapitalisation() {
        // Providers often list the films in capitals; the year in brackets or the sequel subtitle identifies them.
        listOf("xXx", "XXX (2002)", "EN - XXX (2002)", "XXX: Return of Xander Cage (2017)", "XXX - State of the Union",
            "XXX: STATE OF THE UNION (2005)", "XXX 2: The Next Level", "xxx: the return of xander cage")
            .forEach { assertFalse(it, AdultFilter.isAdultTitle(it, live = false)) }
        // Anything else named XXX is still hidden, including a year that isn't one of the films' or isn't in brackets.
        listOf("XXX Parody", "XXX (2019)", "XXX 2002 Hits", "Hot XXX: Return", "xXx XXX Party", "XXX: Next Door")
            .forEach { assertTrue(it, AdultFilter.isAdultTitle(it, live = false)) }
    }

    @Test fun bothEditionsClearTheOldTorrentPlayerData() {
        // A TV on a pre-1.6.0 lumanest.tv APK can update straight to the store edition, so this isn't edition-specific.
        context.getSharedPreferences("torrentio", Context.MODE_PRIVATE).edit().putString("addon", "https://example/debrid-key").commit()
        val caches = listOf("torrent-playback", "streaming-catalogs").map { java.io.File(context.cacheDir, it).apply { mkdirs() } }
        assertEquals(caches.toSet(), Repo.clearTorrentPlayerData(context).toSet())
        assertTrue(context.getSharedPreferences("torrentio", Context.MODE_PRIVATE).all.isEmpty())
        caches.forEach { it.deleteRecursively() }
        assertEquals(emptyList<java.io.File>(), Repo.clearTorrentPlayerData(context))
    }

    @Test fun strictNamesKeepTheDirectRulesAndAdultSwim() {
        listOf("+18", "18 +", "18 PLUS", "ADULTOS", "Adulte", "Adulti", "PORNO", "EROTIC", "Erotica", "X-X-X", "PORNHUB", "XXX", "Adults")
            .forEach { assertTrue(it, AdultFilter.isAdultName(it, strict = true)) }
        // These spellings were never hidden by the lumanest.tv APK and still aren't.
        listOf("+18", "18 PLUS", "ADULTOS", "PORNO", "EROTIC").forEach { assertFalse(it, AdultFilter.isAdultName(it)) }
        listOf("Adult Swim", "Essex", "Taxxi", "Sports", "118 News", "Pornic Travel", "XXXL Shows")
            .forEach { assertFalse(it, AdultFilter.isAdultName(it, strict = true)) }
        assertTrue(AdultFilter.isAdultTitle("US: PLAYBOY TV HD", live = true))
        assertFalse(AdultFilter.isAdultTitle("Playboy: The Story", live = false))
        assertFalse(AdultFilter.isAdultTitle("Adult Swim", live = true))
    }

    @Test fun storeSnapshotsNeverMixWithDirectOnes() {
        val source = Source("s", "S", SourceType.XTREAM, "http://example", "u", "p")
        val locked = CatalogSnapshots.identity(source, "ts", "")
        val unlocked = CatalogSnapshots.identity(source, "ts", "", adultUnlocked = true)
        val store = CatalogSnapshots.identity(source, "ts", "", storeBuild = true)
        assertEquals(store, CatalogSnapshots.identity(source, "ts", "", adultUnlocked = true, storeBuild = true))
        assertEquals(locked.source, store.source)
        assertNotEquals(locked.catalogue, store.catalogue)
        assertNotEquals(unlocked.catalogue, store.catalogue)
        assertNotEquals(locked.live, store.live)
        // The lumanest.tv APK keeps the snapshot keys of 1.6.3, so updating doesn't reload saved libraries.
        assertEquals("2c5f3084c330f9f1cc4567ffa693ba428f93fb767609547bdacd82a342f41d13", locked.catalogue)
        assertEquals("5dc259e35a0b06c5dba72d3c90f6b5b22289479d29eb18decf90565970473cd3", locked.live)
    }

    @Test fun storeEditionStartsWithoutFreeGuidesAndListsCountryGuidesOnly() {
        freshPrefs()
        assertEquals(FreeEpg.defaults, Prefs(context, storeBuild = false).freeEpgRegions)
        assertEquals(emptyList<String>(), Prefs(context, storeBuild = true).freeEpgRegions)
        Prefs(context, storeBuild = false).freeEpgRegions = listOf("US2", "PLEX1")
        assertEquals(listOf("US2", "PLEX1"), Prefs(context, storeBuild = false).freeEpgRegions)
        assertEquals(listOf("US2"), Prefs(context, storeBuild = true).freeEpgRegions)
        assertEquals(FreeEpg.regions, FreeEpg.regions(storeBuild = false))
        val storeNames = FreeEpg.regions(storeBuild = true).map { it.name }
        listOf("Plex", "Rakuten", "Peacock", "Distro").forEach { brand -> assertTrue(brand, storeNames.none { brand in it }) }
        assertTrue("United States · national" in storeNames)
    }

    @Test fun phoneFormUsesNeutralWordingInTheStoreEdition() {
        val direct = PhoneSetup.form(storeBuild = false)
        listOf("Xtream Codes", "M3U URL", "Living room IPTV").forEach { assertTrue(it, it in direct) }
        val store = PhoneSetup.form(storeBuild = true)
        listOf("Xtream", "M3U", "IPTV", "get.php").forEach { assertFalse(it, it in store) }
        listOf("Server login", "Playlist link", "placeholder=\"Living room\"").forEach { assertTrue(it, it in store) }
    }
}
