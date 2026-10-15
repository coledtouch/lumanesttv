package tv.lumanest.tuner

import tv.lumanest.tuner.data.Category
import tv.lumanest.tuner.data.Channel
import tv.lumanest.tuner.data.ContentPolicy
import tv.lumanest.tuner.data.LocalLineup
import org.junit.Assert.*
import org.junit.Test

class LocalLineupTest {
    private val categories = listOf(Category("local", "US Locals & Regional"), Category("abc", "US ABC"),
        Category("cable", "US Entertainment"), Category("fast", "US Roku & Free TV"), Category("sports", "NFL"))
    private fun channel(name: String, group: String = "cable", epg: String? = null) =
        Channel(name, 1, name, null, group, epg, null, "https://example.test/live", listOf(group))
    private fun filter(vararg channels: Channel) = LocalLineup.filter(channels.toList(), categories, "01608")

    @Test fun genericInstallKeepsTheOriginalCatalogueWithoutInventingALocalCategory() {
        val catalogue = ContentPolicy.Catalogue(listOf(channel("ABC WABC New York", "local")), categories)
        assertSame(catalogue, LocalLineup.filterCatalogue(catalogue, ""))
        assertSame(catalogue, LocalLineup.filterCatalogue(catalogue, "90210"))
    }

    @Test fun supportedMarketIsExplicitAndDoesNotPretendToGeocodeEveryZip() {
        listOf("01608", "01701", "02108", "03101", "03824").forEach { assertNotNull(LocalLineup.marketForZip(it)) }
        listOf("", "016", "01608-1234", "abcde", "10001", "90210", "01103").forEach { assertNull(LocalLineup.marketForZip(it)) }
    }

    @Test fun bostonAndManchesterStationsRemainWhileOtherMarketsLeaveEveryProviderBucket() {
        val nearby = listOf("ABC: BOSTON WCVB", "CBS: MA BOSTON WBZ", "NBC: MA BOSTON WBTS", "FOX: BOSTON WFXT", "ABC: MANCHESTER WMUR")
        val remote = listOf("US ABC (WABC) (D)", "US: ABC 7 New York (WABC)", "US NBC 10 Philadelphia WCAU", "US FOX 5 Atlanta WAGA")
        val result = filter(*(nearby.map { channel(it, "abc") } + remote.map { channel(it, "abc") }).toTypedArray())
        assertEquals(nearby, result.map { it.name })
    }

    @Test fun fastLocalNewsFeedsAreFilteredEvenWhenProvidersFileThemAsEntertainment() {
        val nearby = listOf("(PLUTO USA) CBS News Boston", "(US) (RK) Boston 25 News", "US NBC Boston News (PC)", "US NBC New England Cable News (NECN) (D)", "(US) (SP) Spectrum News 1 Worcester")
        val remote = listOf("(US) (RK) CBS News Texas", "US NBC South Florida News (PC)", "US CBSN New York (D)", "(US) (RK) Cleveland 19 News Plus", "US CBS News Local (PM)", "US: News 12 Connecticut")
        assertEquals(nearby, filter(*(nearby.map { channel(it, "fast") } + remote.map { channel(it, "fast") }).toTypedArray()).map { it.name })
    }

    @Test fun cableSportsAndProgramNamesNeverBecomeLocalStationsBecauseOfTheirCities() {
        val names = listOf("US NBC Sports Boston (D)", "US: NBC Sports Chicago", "US Chicago Sports Network", "ESPN+ 42: Boston College vs. Boston University", "Football Event 15: Manchester United vs. Madrid", "NBALP: Boston Celtics", "24/7 Boston Legal", "24/7 Chicago Fire", "24/7 King of Queens", "(US) (RK) King of Queens", "US: SportsNet New York", "US: NESN")
        assertEquals(names, filter(*names.map { channel(it) }.toTypedArray()).map { it.name })
        assertEquals(1, filter(channel("NFL Teams: FOX Bears WFLD Chicago IL", "sports")).size)
    }

    @Test fun nationalNewsAndPbsProgrammingStayAvailableEvenInTheWrongProviderBucket() {
        val names = listOf("US: CNN HD", "US: FOX News", "US: ABC News Live", "US CBS News 24/7 (S)", "(US) (RK) NBC News NOW", "US: CBSN HD", "US: PBS Kids", "USA PBS KIDS EAST", "(PLUTO USA) PBS Antiques Roadshow", "US PBS Nature (S)", "US: WGN America", "US: USA Network")
        assertEquals(names, filter(*names.map { channel(it, "local") }.toTypedArray()).map { it.name })
    }

    @Test fun sportsCategoryMembershipDoesNotReclassifyAnActualRemoteAffiliate() {
        val remote = channel("US FOX 5 New York WNYW", "local").copy(categoryIds = listOf("local", "sports"))
        val network = channel("US NBC Sports Boston", "local").copy(categoryIds = listOf("local", "sports"))
        assertEquals(listOf(network), filter(remote, network))
    }

    @Test fun ordinaryEntertainmentWordsAndWorldBrandsAreNotGuessedStationCallsigns() {
        val names = listOf("(US) (RK) Key & Peele", "US King of Queens", "US King of Queens: New York episodes", "US Kill Bill Movie Collection", "US World’s Most Evil Killers (S)", "(US) (RK) World Of Love Island", "US World Fishing Network (S)", "US World Poker Tour (WPT) (S)", "US Key TV (D)")
        assertEquals(names, filter(*names.map { channel(it) }.toTypedArray()).map { it.name })
        assertTrue(filter(channel("US WNBC New York"), channel("US NBC 5 Seattle (KING)")).isEmpty())
    }

    @Test fun nationalCableIdentityOverridesAProvidersWrongLocalStationEpgId() {
        val items = listOf(channel("US: WE TV", epg = "WETV.us"), channel("US: Antenna TV", epg = "WGN"), channel("US Fuse Music (FM) (A)", epg = "CBSWFMY.us"), channel("US CNN", epg = "WCBS.us"))
        assertEquals(items, filter(*items.toTypedArray()))
        assertTrue(filter(channel("US ABC (WABC)", epg = "abcwabc.us")).isEmpty())
        assertEquals(2, filter(channel("US World at War (H)", "local"), channel("(US) (A) All Reality WeTV", "local")).size)
    }

    @Test fun nearbySpanishPublicTvAndCommunityStationsStayWithoutLanguageRestrictions() {
        val names = listOf("US: Telemundo Boston (WNEU)", "(US) (H) [Worcester] WUNI", "US WUTF-TV", "US PBS (GBH) Worcester (H)", "US PBS 11 (WENH) New Hampshire (H)", "US WCCA TV (Worcester)", "US CW 56 WLVI Boston", "US WSBK Boston")
        assertEquals(names, filter(*names.map { channel(it, "local") }.toTypedArray()).map { it.name })
    }

    @Test fun wrongMarketBrandIsNotOverriddenByAMislabelledWorcesterSuffix() {
        val result = filter(channel("US PBS Rhode Island Worcester (H)"), channel("US PBS New England Public Media Worcester (H)"), channel("US WABC Boston (WCVB)"), channel("US Unknown regional feed", "local"))
        assertTrue(result.isEmpty())
    }

    @Test fun verifiedEpgCallsignCanIdentifyANearbyStationWhenItsDisplayNameIsGeneric() {
        assertEquals(1, filter(channel("US: Local affiliate", epg = "abcwcvb.us")).size)
        assertTrue(filter(channel("US: Local affiliate", epg = "abcwabc.us")).isEmpty())
    }

    @Test fun localNewsShortcutContainsNewsStationsWithoutChangingTheirPrimaryCategory() {
        val catalogue = LocalLineup.filterCatalogue(ContentPolicy.Catalogue(listOf(channel("WCVB Boston", "abc"), channel("WGBH Boston", "local"), channel("US CNN", "cable"), channel("WABC New York", "abc")), categories), "01608")
        assertEquals("Local news", catalogue.categories.first().name)
        assertEquals("abc", catalogue.items.first().categoryId)
        assertTrue(LocalLineup.LOCAL_NEWS_ID in catalogue.items.first().categoryIds)
        assertTrue(catalogue.items.drop(1).all { LocalLineup.LOCAL_NEWS_ID !in it.categoryIds })
        assertEquals(1, catalogue.categories.count { it.id == LocalLineup.LOCAL_NEWS_ID })
        val repeated = LocalLineup.filterCatalogue(catalogue, "01608")
        assertEquals(catalogue, repeated)
    }
}
