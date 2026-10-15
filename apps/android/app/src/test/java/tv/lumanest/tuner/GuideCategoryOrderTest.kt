package tv.lumanest.tuner

import tv.lumanest.tuner.ui.CAT_ALL
import tv.lumanest.tuner.ui.CAT_FAV
import tv.lumanest.tuner.ui.CAT_HOT
import tv.lumanest.tuner.ui.guideCategoryItems
import org.junit.Assert.assertEquals
import org.junit.Test

class GuideCategoryOrderTest {
    @Test fun requestedCableGroupsImmediatelyFollowMostWatched() {
        val categories = listOf("local" to "Local news", "other" to "US Kids", "d" to "US Documentaries",
            "n" to "US News", "e" to "US Entertainment", "m" to "US Movies", "p" to "USA Premium", "s" to "US Sports")
        val ordered = guideCategoryItems(categories, true)
        assertEquals(listOf(CAT_ALL, CAT_FAV, CAT_HOT, "s", "p", "n", "m", "e", "d", "local", "other"), ordered.map { it.first })
        assertEquals("Most Watched", ordered[2].second)
    }

    @Test fun punctuationAndCountryAliasesSortWithoutChangingProviderIdsOrLabels() {
        val categories = listOf("news" to "US: News", "sport" to "USA | Sports", "premium" to "USA Premium", "other-a" to "Kids", "other-b" to "Music")
        assertEquals(listOf(CAT_ALL, CAT_FAV, CAT_HOT, "sport", "premium", "news", "other-a", "other-b"), guideCategoryItems(categories, false).map { it.first })
        assertEquals(categories.toMap(), guideCategoryItems(categories, false).drop(3).toMap())
    }

    @Test fun duplicatedAndReservedProviderIdsCannotCreateRepeatedFocusTargets() {
        val categories = listOf(CAT_ALL to "Provider All", CAT_HOT to "Provider Hot", CAT_FAV to "Provider Favorites", "sports" to "US Sports", "sports" to "Duplicate")
        assertEquals(listOf(CAT_ALL, CAT_FAV, CAT_HOT, "sports"), guideCategoryItems(categories, true).map { it.first })
    }

    @Test fun personalMostWatchedIsAvailableBeforeAnyProviderTrendingFeed() {
        assertEquals(listOf(CAT_ALL, CAT_FAV, CAT_HOT), guideCategoryItems(emptyList(), false).map { it.first })
    }
}
