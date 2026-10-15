package tv.lumanest.tuner.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject

/** Small persistent store: sources, favorites, resume points and a few settings. */
class Prefs(context: Context) {
    data class ChannelWatch(val count: Long, val updated: Long)

    val addon = AddonSettings(context)
    private val sp: SharedPreferences = context.getSharedPreferences("tuner", Context.MODE_PRIVATE)

    private val _sources = MutableStateFlow(readSources())
    val sources: StateFlow<List<Source>> = _sources

    private val _activeId = MutableStateFlow(sp.getString("active", null))
    val activeId: StateFlow<String?> = _activeId

    private val _favorites = MutableStateFlow<Set<String>>(emptySet())
    val favorites: StateFlow<Set<String>> = _favorites

    private val _recents = MutableStateFlow(readRecents())
    val recents: StateFlow<List<Recent>> = _recents

    private var watchAliases = readWatchAliases()
    private var watchAliasesFlat = watchAliases.values.none { it in watchAliases }
    private val _watchHistory = MutableStateFlow(readWatchHistory())
    val watchHistory: StateFlow<Map<String, ChannelWatch>> = _watchHistory
    private val _watchedChannelKeys = MutableStateFlow(rankedWatches(_watchHistory.value).take(50).map { it.key })
    val watchedChannelKeys: StateFlow<List<String>> = _watchedChannelKeys

    /** Blank keeps every U.S. local market. Only an explicitly selected supported market is filtered. */
    private val _localZip = MutableStateFlow(sp.getString("localZip", "").orEmpty())
    val localZip: StateFlow<String> = _localZip

    fun setLocalZip(zip: String): Boolean {
        val value = zip.trim()
        if (value.isNotEmpty() && LocalLineup.marketForZip(value) == null) return false
        sp.edit().putString("localZip", value).apply()
        _localZip.value = value
        return true
    }

    var liveFormat: String
        get() = sp.getString("liveFormat", "ts") ?: "ts"
        set(v) = sp.edit().putString("liveFormat", v).apply()

    var guidePreview: Boolean
        get() = sp.getBoolean("guidePreview", true)
        set(v) = sp.edit().putBoolean("guidePreview", v).apply()

    /** epgshare01 region codes used to fill guide gaps. Empty list turns the fallback off. */
    var freeEpgRegions: List<String>
        get() = sp.getString("freeEpg", null)?.split(',')?.filter { it.isNotBlank() } ?: FreeEpg.defaults
        set(v) = sp.edit().putString("freeEpg", v.joinToString(",")).apply()

    var themeId: String?
        get() = sp.getString("theme", null)
        set(v) = sp.edit().putString("theme", v).apply()

    var lastChannelKey: String?
        get() = sp.getString("lastChannel_${_activeId.value}", null)
        @Synchronized set(v) = sp.edit().putString("lastChannel_${_activeId.value}", v).apply()

    init { reloadFavorites() }

    // ---- sources ----
    fun saveSource(s: Source) {
        val list = _sources.value.filterNot { it.id == s.id } + s
        writeSources(list)
    }

    fun deleteSource(id: String) {
        writeSources(_sources.value.filterNot { it.id == id })
        if (_activeId.value == id) setActive(_sources.value.firstOrNull()?.id)
    }

    @Synchronized fun setActive(id: String?) {
        sp.edit().putString("active", id).apply()
        _activeId.value = id
        reloadFavorites()
        _recents.value = readRecents()
        watchAliases = readWatchAliases()
        watchAliasesFlat = watchAliases.values.none { it in watchAliases }
        publishWatchHistory(readWatchHistory())
    }

    private fun writeSources(list: List<Source>) {
        val arr = JSONArray()
        list.forEach { s ->
            arr.put(JSONObject().apply {
                put("id", s.id); put("name", s.name); put("type", s.type.name)
                put("server", s.server); put("username", s.username); put("password", s.password)
                put("m3uUrl", s.m3uUrl); put("epgUrl", s.epgUrl); put("userAgent", s.userAgent)
                put("hotUrl", s.hotUrl)
            })
        }
        sp.edit().putString("sources", arr.toString()).apply()
        _sources.value = list
    }

    private fun readSources(): List<Source> = runCatching {
        val arr = JSONArray(sp.getString("sources", "[]"))
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Source(
                id = o.getString("id"), name = o.optString("name"),
                type = SourceType.valueOf(o.optString("type", "XTREAM")),
                server = o.optString("server"), username = o.optString("username"),
                password = o.optString("password"), m3uUrl = o.optString("m3uUrl"),
                epgUrl = o.optString("epgUrl"), userAgent = o.optString("userAgent"),
                hotUrl = o.optString("hotUrl"),
            )
        }
    }.getOrDefault(emptyList())

    // ---- favorites (per source) ----
    private fun favKey() = "fav_${_activeId.value}"
    private fun reloadFavorites() {
        _favorites.value = sp.getStringSet(favKey(), emptySet())?.toSet() ?: emptySet()
    }

    @Synchronized fun toggleFavorite(channelKey: String): Boolean {
        val key = canonicalChannelKey(channelKey)
        val set = _favorites.value.mapTo(HashSet(), ::canonicalChannelKey)
        val added = if (key in set) { set.remove(key); false } else { set.add(key); true }
        sp.edit().putStringSet(favKey(), set).apply()
        _favorites.value = set
        return added
    }

    /** Favorites, viewing history and the last-watched channel follow folded provider duplicates. */
    @Synchronized fun remapChannelKeys(merged: Map<String, String>, expectedSourceId: String? = null) {
        if (expectedSourceId != null && _activeId.value != expectedSourceId) return
        if (merged.isEmpty()) return
        // Finished snapshots normally repeat the persisted, already flattened graph. Compare
        // its edges without copying it or allocating a visited set for every provider alias.
        val sameGraph = watchAliasesFlat && merged.all { (old, canonical) ->
            canonical !in watchAliases && (old == canonical || watchAliases[old] == canonical)
        }
        if (!sameGraph) {
            val aliases = watchAliases.toMutableMap()
            // A refresh can pick a different canonical copy. Its old alias must not form a cycle.
            merged.values.forEach(aliases::remove)
            merged.forEach { (old, canonical) -> if (old != canonical) aliases[old] = canonical }
            val flattened = aliases.mapValues { (_, value) -> resolveChannelKey(value, aliases) }.filter { (key, value) -> key != value }
            if (flattened != watchAliases) {
                watchAliases = flattened
                val json = JSONObject()
                flattened.forEach { (key, value) -> json.put(key, value) }
                sp.edit().putString(watchAliasesKey(), json.toString()).apply()
            }
            watchAliasesFlat = watchAliases.values.none { it in watchAliases }
        }
        val favorites = _favorites.value
        if (favorites.any { canonicalChannelKey(it) != it }) {
            val set = favorites.mapTo(HashSet(), ::canonicalChannelKey)
            sp.edit().putStringSet(favKey(), set).apply()
            _favorites.value = set
        }
        lastChannelKey?.let { key -> canonicalChannelKey(key).takeIf { it != key }?.let { lastChannelKey = it } }
        if (_watchHistory.value.keys.any { canonicalChannelKey(it) != it }) {
            val history = mergeWatchAliases(_watchHistory.value)
            if (history != _watchHistory.value) writeWatchHistory(history)
        }
    }

    // ---- personal most watched (per source) ----
    private fun watchHistoryKey() = "watched_${_activeId.value}"
    private fun watchAliasesKey() = "watchAliases_${_activeId.value}"

    /** Call once after an explicitly tuned live request becomes ready, never for retries or browsing. */
    @Synchronized fun recordWatched(channelKey: String, now: Long = System.currentTimeMillis()) {
        if (channelKey.isBlank() || _activeId.value == null) return
        val key = canonicalChannelKey(channelKey)
        val previous = _watchHistory.value[key]
        val history = _watchHistory.value.toMutableMap()
        history[key] = ChannelWatch(
            count = ((previous?.count ?: 0).coerceAtMost(Long.MAX_VALUE - 1) + 1),
            updated = maxOf(previous?.updated ?: 0, now.coerceAtLeast(0)),
        )
        writeWatchHistory(history)
    }

    private fun readWatchAliases(): Map<String, String> = runCatching {
        val json = JSONObject(sp.getString(watchAliasesKey(), null) ?: "{}")
        buildMap { json.keys().forEach { key -> json.optString(key).takeIf { it.isNotBlank() && it != key }?.let { put(key, it) } } }
    }.getOrDefault(emptyMap())

    private fun canonicalChannelKey(key: String) =
        if (watchAliasesFlat) watchAliases[key] ?: key else resolveChannelKey(key, watchAliases)

    private fun resolveChannelKey(key: String, aliases: Map<String, String>): String {
        var current = key
        val visited = HashSet<String>()
        while (visited.add(current)) {
            val next = aliases[current]?.takeIf { it.isNotBlank() && it != current } ?: return current
            current = next
        }
        return visited.minOrNull() ?: key
    }

    private fun mergeWatchAliases(history: Map<String, ChannelWatch>): Map<String, ChannelWatch> = buildMap {
        history.forEach { (key, watch) ->
            val canonical = canonicalChannelKey(key)
            val existing = get(canonical)
            val oldCount = existing?.count ?: 0
            put(canonical, ChannelWatch(
                count = oldCount + watch.count.coerceAtMost(Long.MAX_VALUE - oldCount),
                updated = maxOf(existing?.updated ?: 0, watch.updated),
            ))
        }
    }

    private fun readWatchHistory(): Map<String, ChannelWatch> = runCatching {
        val json = JSONObject(sp.getString(watchHistoryKey(), null) ?: "{}")
        mergeWatchAliases(buildMap {
            json.keys().forEach { key ->
                val item = json.optJSONObject(key) ?: return@forEach
                val count = item.optLong("count").takeIf { it > 0 } ?: return@forEach
                put(key, ChannelWatch(count, item.optLong("updated").coerceAtLeast(0)))
            }
        })
    }.getOrDefault(emptyMap())

    private fun rankedWatches(history: Map<String, ChannelWatch>) = history.entries.sortedWith(
        compareByDescending<Map.Entry<String, ChannelWatch>> { it.value.count }.thenByDescending { it.value.updated }.thenBy { it.key },
    )

    private fun publishWatchHistory(history: Map<String, ChannelWatch>) {
        _watchHistory.value = history
        _watchedChannelKeys.value = rankedWatches(history).take(50).map { it.key }
    }

    private fun writeWatchHistory(history: Map<String, ChannelWatch>) {
        val bounded = rankedWatches(history).take(500).associate { it.key to it.value }
        val json = JSONObject()
        bounded.forEach { (key, watch) -> json.put(key, JSONObject().put("count", watch.count).put("updated", watch.updated)) }
        sp.edit().putString(watchHistoryKey(), json.toString()).apply()
        publishWatchHistory(bounded)
    }

    // ---- channels that failed on every source (per source), hidden for a few days ----
    private fun deadKey() = "dead_${_activeId.value}"

    private fun readDead(): JSONObject = runCatching { JSONObject(sp.getString(deadKey(), null) ?: "{}") }.getOrDefault(JSONObject())

    fun deadChannels(now: Long = System.currentTimeMillis()): Set<String> {
        val o = readDead()
        return o.keys().asSequence().filter { now - o.optLong(it) < DEAD_FOR_MS }.toSet()
    }

    fun markDead(keys: Collection<String>, now: Long = System.currentTimeMillis()) {
        val o = readDead()
        o.keys().asSequence().toList().forEach { if (now - o.optLong(it) >= DEAD_FOR_MS) o.remove(it) }
        keys.forEach { o.put(it, now) }
        sp.edit().putString(deadKey(), o.toString()).apply()
    }

    fun clearDead() = sp.edit().remove(deadKey()).apply()

    // ---- resume / continue watching (per source) ----
    private fun recentsKey() = "recents_${_activeId.value}"

    fun resumePosition(id: String): Long = _recents.value.firstOrNull { it.id == id }?.positionMs ?: 0L

    fun saveProgress(r: Recent) {
        val finished = r.durationMs > 0 && r.positionMs > r.durationMs * 0.95
        val list = _recents.value.filterNot { it.id == r.id }.toMutableList()
        if (!finished && r.positionMs > 15_000) list.add(0, r)
        val trimmed = list.take(40)
        val arr = JSONArray()
        trimmed.forEach {
            arr.put(JSONObject().apply {
                put("id", it.id); put("title", it.title); put("subtitle", it.subtitle ?: "")
                put("image", it.image ?: ""); put("url", it.url); put("pos", it.positionMs)
                put("dur", it.durationMs); put("updated", it.updated)
            })
        }
        sp.edit().putString(recentsKey(), arr.toString()).apply()
        _recents.value = trimmed
    }

    private fun readRecents(): List<Recent> = runCatching {
        val arr = JSONArray(sp.getString(recentsKey(), "[]"))
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Recent(
                id = o.getString("id"), title = o.optString("title"),
                subtitle = o.optString("subtitle").ifBlank { null },
                image = o.optString("image").ifBlank { null }, url = o.getString("url"),
                positionMs = o.optLong("pos"), durationMs = o.optLong("dur"), updated = o.optLong("updated"),
            )
        }
    }.getOrDefault(emptyList())

    companion object {
        /** How long a channel that failed on every source stays out of the guide before it gets another chance. */
        const val DEAD_FOR_MS = 3 * 24 * 3600_000L
    }
}
