package tv.lumanest.tuner.data

import java.util.Locale

/** Optional station-market filter. Cable networks, entertainment and sports keep their full lineup. */
object LocalLineup {
    const val LOCAL_NEWS_ID = "__tuner_local_news"
    const val WORCESTER_ZIP = "01608"

    enum class Market(val label: String) {
        BOSTON_WORCESTER_NH("Boston, Worcester + New Hampshire"),
    }

    // Explicit supported market only. This is not a ZIP geocoder or a national DMA database.
    private val zipPrefixes = setOf("014", "015", "016", "017", "018", "019", "020", "021", "022", "024",
        "030", "031", "032", "033", "034", "035", "036", "037", "038")

    fun marketForZip(zip: String): Market? = zip.trim().takeIf {
        it.matches(zipFormat) && it.take(3) in zipPrefixes
    }?.let { Market.BOSTON_WORCESTER_NH }

    /** Run before duplicate folding so a remote affiliate never becomes a nearby station's backup. */
    fun filterCatalogue(catalogue: ContentPolicy.Catalogue<Channel>, zip: String): ContentPolicy.Catalogue<Channel> {
        if (marketForZip(zip) == null) return catalogue
        val classifier = Classifier(catalogue.categories)
        val accepted = catalogue.items.mapNotNull { channel ->
            val kind = classifier.kind(channel)
            if (kind == Kind.OTHER_LOCAL) null
            else if (kind == Kind.NEARBY_NEWS) channel.copy(categoryIds = (channel.categoryIds + LOCAL_NEWS_ID).distinct())
            else channel
        }
        val used = accepted.flatMapTo(HashSet()) { it.categoryIds }
        val categories = catalogue.categories.filter { it.id in used && it.id != LOCAL_NEWS_ID }.toMutableList()
        if (LOCAL_NEWS_ID in used) categories.add(0, Category(LOCAL_NEWS_ID, "Local news"))
        return ContentPolicy.Catalogue(accepted, categories)
    }

    fun filter(items: List<Channel>, categories: List<Category>, zip: String): List<Channel> =
        filterCatalogue(ContentPolicy.Catalogue(items, categories), zip).items

    fun isNearby(channel: Channel, categories: List<Category>, zip: String): Boolean =
        marketForZip(zip) != null && Classifier(categories).kind(channel) in setOf(Kind.NEARBY, Kind.NEARBY_NEWS)

    private enum class Kind { NONLOCAL, NEARBY, NEARBY_NEWS, OTHER_LOCAL }

    private class Classifier(categories: List<Category>) {
        private val categoryNames = categories.associate { it.id to normalize(it.name) }

        fun kind(channel: Channel): Kind {
            val name = normalize(channel.name)
            val groups = channel.categoryIds.mapNotNull(categoryNames::get)
            // Providers put sports networks in their local bucket, and event names contain cities/callsigns.
            if (sportsName.containsMatchIn(name) || eventName.containsMatchIn(name) || name.startsWith("24/7 ")) return Kind.NONLOCAL
            val core = coreName(name)
            val national = nationalName.matches(core)
            // A provider can attach a local station's EPG ID to a national cable network by mistake.
            if (national && !nationalBroadcastName.matches(core)) return Kind.NONLOCAL
            val epg = normalize(channel.epgId.orEmpty())
            val localBucket = groups.any(localGroup::containsMatchIn)
            val affiliateBucket = groups.any(affiliateGroup::matches)
            val displayStations = stationNames(name)
            // Ordinary program names such as King of Queens must not become a KING Seattle station.
            val stationContext = localBucket || affiliateBucket || broadcastName.containsMatchIn(name) ||
                parenthesizedStation.containsMatchIn(name) || leadingStation.containsMatchIn(core) ||
                namedStation.containsMatchIn(core)
            val stations = (if (stationContext) displayStations else displayStations.filterTo(HashSet()) { it in nearbyStations }) +
                stationNames(epg) + epgStation.findAll(epg).map { it.groupValues[1] }.toSet()
            if (stations.isEmpty() && national) return Kind.NONLOCAL
            val nearbyStation = stations.any { it in nearbyStations }
            val nearbyName = nearbyBrand.containsMatchIn(name)
            val brandedLocal = localBrand.containsMatchIn(name)
            if (groups.any(sportsGroup::containsMatchIn) && stations.isEmpty() && !nearbyName && !brandedLocal) return Kind.NONLOCAL
            val looksLocal = nearbyStation || nearbyName || stations.isNotEmpty() || localBucket || affiliateBucket || brandedLocal
            if (!looksLocal) return Kind.NONLOCAL
            // Some feeds say Worcester after a Rhode Island or western-Massachusetts PBS brand.
            if (outsideBrand.containsMatchIn(name) || stations.any { it !in nearbyStations }) return Kind.OTHER_LOCAL
            if (!nearbyStation && !nearbyName) return Kind.OTHER_LOCAL
            return if (stations.any { it in newsStations } || newsBrand.containsMatchIn(name)) Kind.NEARBY_NEWS else Kind.NEARBY
        }
    }

    private val nearbyStations = setOf("WCVB", "WBZ", "WBTS", "WHDH", "WFXT", "WGBH", "WGBX", "WMUR", "WUNI", "WUTF", "WNEU", "WENH", "WLED", "WEKW", "WCCA", "WLVI", "WSBK", "WWJE", "WMFP")
    private val newsStations = setOf("WCVB", "WBZ", "WBTS", "WHDH", "WFXT", "WMUR", "WUNI", "WNEU")
    // A station callsign is a separate word, optionally followed by its broadcast suffix or subchannel.
    private val station = Regex("(?<![A-Z0-9])([WK][A-Z]{2,3})(?:(?:-|\\s+)(?:TV|DT|CD|LD))?(?:\\d)?(?=$|[^A-Z0-9])")
    private val epgStation = Regex("^(?:ABC|CBS|NBC|FOX|PBS|CW|MY)[0-9]*([WK][A-Z]{2,3})(?:[ ._-]|$)")
    private val broadcastName = Regex("\\b(?:ABC|CBS|NBC|FOX|PBS|CW|UNIVISION|UNIMAS|TELEMUNDO)\\b")
    private val parenthesizedStation = Regex("(?:\\(|\\[)\\s*[WK][A-Z]{2,3}(?:[- ]?(?:TV|DT|CD|LD))?\\s*(?:\\)|\\])")
    private val leadingStation = Regex("^[WK][A-Z]{2,3}(?:(?:-|\\s+)(?:TV|DT|CD|LD)\\b|\\s*[0-9]+(?:[^0-9]|$)|$)")
    private val namedStation = Regex("^[WK][A-Z]{2,3}(?:(?:-|\\s+)(?:TV|DT|CD|LD))?\\s+(?:NEW YORK|LOS ANGELES|CHICAGO|SEATTLE|PHILADELPHIA|MIAMI|DALLAS|HOUSTON|ATLANTA|DENVER|DETROIT|SAN FRANCISCO|LAS VEGAS|CLEVELAND|ORLANDO|BALTIMORE|PITTSBURGH|BOSTON|WORCESTER|MANCHESTER)\\b")
    private val notStations = setOf("KEY", "KILL", "KIDS", "WEST", "WITH", "WILD", "WISH", "WILL", "WARS", "WAVE", "WORK", "WEEK", "WALK", "WELL", "WHAT", "WHEN", "WALL", "WOKE", "WORD", "WINE", "WOLF", "WWE")
    private fun stationNames(text: String): Set<String> = station.findAll(text).map { it.groupValues[1] }.filterNot { it in notStations }.toSet()
    private val zipFormat = Regex("[0-9]{5}")
    private val whitespace = Regex("\\s+")
    private val parenthesizedLabels = Regex("\\([^)]*\\)|\\[[^]]*]")
    private val servicePrefix = Regex("^(?:PEACOCK LIVE[ |:]+|USA?[ :|/-]+)")
    private val qualityWords = Regex("\\b(?:HD|FHD|UHD|4K|SD|HEVC)\\b")
    private fun normalize(value: String) = value.uppercase(Locale.ROOT).replace(whitespace, " ").trim()
    private val sportsGroup = Regex("\\b(?:SPORTS?|NBA|NFL|MLB|NHL|HOCKEY|PPV|ESPN|LIVE EVENTS|LEAGUE PASS)\\b")
    private val sportsName = Regex("\\b(?:ESPN|NESN|SPORTSNET|SPORTS|FANDUEL|BALLY|NBALP|NFL TEAMS|TENNIS CHANNEL|GOLF CHANNEL)\\b")
    private val eventName = Regex("^(?:USA?[: ]+)?(?:NBA|NFL|MLB|NHL|DAZN|UFC|FOOTBALL EVENT|PPV|ESPN\\+)[ :0-9]")
    private val localGroup = Regex("\\b(?:LOCALS?|REGIONAL|AFFILIATES?|LOCAL STATIONS)\\b")
    private val affiliateGroup = Regex("(?:USA?|UNITED STATES)[ |:/-]+(?:ABC|CBS|FOX|NBC|PBS|CW)")
    private val localBrand = Regex("\\b(?:CBSN|CBS NEWS|(?:NBC|ABC)\\b.*\\bNEWS|ABC[ 0-9]+|FOX[ 0-9]+|FOX LOCAL|NEWS ?12|SPECTRUM NEWS|LOCAL NEWS|NEWSON|PBS|CW[ 0-9]+|UNIVISION[ 0-9]+|TELEMUNDO[ 0-9]+|[0-9]{1,2} NEWS)\\b")
    private val nearbyBrand = Regex("\\b(?:NECN|NEW ENGLAND CABLE NEWS|(?:CBSN|CBS NEWS|NBC(?: ?10)?(?: NEWS)?|ABC ?5|FOX ?25|7 ?NEWS|BOSTON ?25(?: NEWS)?) ?BOSTON|BOSTON ?25(?: NEWS)?|7 ?NEWS BOSTON|NBC ?10 BOSTON NEWS|SPECTRUM NEWS(?: ?1)? (?:WORCESTER|MASSACHUSETTS|NEW ENGLAND)|GBH|(?:NEW HAMPSHIRE|NH) PBS|PBS(?: ?11)? NEW HAMPSHIRE|WORCESTER (?:TV|COMMUNITY))\\b")
    private val newsBrand = Regex("\\b(?:NECN|NEW ENGLAND CABLE NEWS|BOSTON ?25|7 ?NEWS BOSTON|CBSN BOSTON|CBS NEWS BOSTON|NBC(?: ?10)? BOSTON NEWS|NBC NEWS BOSTON|SPECTRUM NEWS(?: ?1)? (?:WORCESTER|MASSACHUSETTS|NEW ENGLAND))\\b")
    private val outsideBrand = Regex("\\b(?:RHODE ISLAND|NEW ENGLAND PUBLIC MEDIA|WESTERN RESERVE)\\b")
    private val nationalName = Regex("(?:CNN|HLN|FOX NEWS|FOX BUSINESS|CNBC(?: WORLD)?|MSNBC|MS NOW|NEWSMAX(?:2)?|NEWSNATION|WGN AMERICA|(?:ALL REALITY )?WE ?TV|ANTENNA TV|FUSE(?: MUSIC| FM)?|WORLD FISHING NETWORK|WORLD POKER TOUR|WORLD AT WAR|WPT|BLOOMBERG(?: TV)?|(?:THE )?WEATHER CHANNEL|C ?SPAN(?: [123])?|BBC (?:WORLD NEWS|NEWS)|AL JAZEERA|ONE AMERICA NEWS|OAN|CHEDDAR(?: NEWS)?|ABC NEWS(?: LIVE)?|NBC NEWS NOW|CBS NEWS(?: 24/?7)?|CBSN|LIVE ?NOW FROM FOX|PBS (?:KIDS(?: EAST| WEST)?|ANTIQUES ROADSHOW|NATURE|TRAVEL|GENEALOGY|FOOD|RETRO)|WORLD|CREATE|USA(?: NETWORK)?|(?:ABC|CBS|NBC|FOX|CW|PBS|UNIVISION|UNIMAS|TELEMUNDO)(?: (?:EAST|WEST|NETWORK))?)")
    private val nationalBroadcastName = Regex("(?:ABC|CBS|NBC|FOX|CW|PBS|UNIVISION|UNIMAS|TELEMUNDO)(?: (?:EAST|WEST|NETWORK))?")
    private fun coreName(name: String): String = name
        .replace(parenthesizedLabels, " ").trim()
        .replace(servicePrefix, "")
        .replace(qualityWords, " ")
        .replace(whitespace, " ").trim()
}
