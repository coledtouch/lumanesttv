package tv.lumanest.tuner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.lang.reflect.Modifier
import java.util.IdentityHashMap

/**
 * Every regex the app builds must compile on a device. Android compiles java.util.regex patterns with ICU, which is
 * stricter than the JVM these tests run on: 1.7.0 shipped `\{[^}]*}` (a bare `}`), passed every test here and crashed at
 * launch on every device. This test loads every app class, collects each [Regex] and [java.util.regex.Pattern] reachable
 * from static fields, Kotlin objects, enum constants, lazies and collections, and
 * - fails on a `{` or `}` outside a character class that isn't a `{n}`, `{n,}` or `{n,m}` quantifier (ICU rejects it);
 * - writes them all to build/regex-patterns/patterns.json, which CI compiles with ICU itself (tools/icu-check.swift).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RegexPatternsTest {
    private class Found(val pattern: String, val ignoreCase: Boolean, val source: String)

    @Test fun everyAppRegexAvoidsBracesThatIcuRejectsAndIsSavedForTheIcuCheck() {
        val classes = appClassNames()
        // Fewer means the class folder moved (Android Gradle plugin update) and the check would silently cover nothing.
        assertTrue("found only ${classes.size} app classes", classes.size >= 300)
        val found = mutableListOf<Found>()
        val seen = IdentityHashMap<Any, Boolean>()
        for (name in classes) {
            val cls = Class.forName(name, true, javaClass.classLoader)
            readFields(cls, null, name, 0, found, seen)
            val instance = runCatching { cls.getDeclaredField("INSTANCE").apply { isAccessible = true }.get(null) }.getOrNull()
            if (instance != null) readFields(cls, instance, name, 0, found, seen)
        }
        assertTrue("found only ${found.size} regexes", found.size >= 80)

        val bad = found.filter { bareBraces(it.pattern).isNotEmpty() }.map { "${it.source}: ${it.pattern}" }
        assertEquals("Regexes with a { or } that ICU (Android devices) rejects; write \\{ or \\}", emptyList<String>(), bad)

        File("build/regex-patterns").mkdirs()
        File("build/regex-patterns/patterns.json").writeText(
            found.joinToString(",\n", "[", "]") { """{"p":${json(it.pattern)},"i":${it.ignoreCase},"src":${json(it.source)}}""" })
    }

    @Test fun theBraceCheckFlagsTheBraceThatCrashed170AndAllowsQuantifiersAndClasses() {
        assertEquals(listOf(17), bareBraces("""\[[^\]]*]|\{[^}]*}|\|\s*[A-Z0-9+]{1,6}\s*\|"""))
        assertEquals(emptyList<Int>(), bareBraces("""\[[^\]]*]|\{[^}]*\}|\|\s*[A-Z0-9+]{1,6}\s*\|"""))
        assertEquals(emptyList<Int>(), bareBraces("""a{2}b{2,}c{2,5}[{}]\{\}\Q{}\E"""))
        assertEquals(emptyList<Int>(), bareBraces("""\p{Mn}+\P{L}\x{41}\N{SPACE}"""))
        assertEquals(listOf(1, 3), bareBraces("""a{b}"""))
        assertEquals(listOf(1), bareBraces("""a}"""))
    }

    /** Names of the app's own classes (not the tests'), from the class folder that holds [TunerApp]. */
    private fun appClassNames(): List<String> {
        val marker = "tv/lumanest/tuner/TunerApp.class"
        val roots = javaClass.classLoader!!.getResources(marker).toList()
            .filter { it.protocol == "file" }.map { File(it.toURI()).path.removeSuffix(marker.replace('/', File.separatorChar)) }
            .ifEmpty { listOf("build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes", "build/tmp/kotlin-classes/debug") }
            .map(::File).filter { it.isDirectory }
        return roots.flatMap { root ->
            root.walkTopDown().filter { it.isFile && it.name.endsWith(".class") }
                .map { it.relativeTo(root).path.removeSuffix(".class").replace(File.separatorChar, '.') }
                .filter { it.startsWith("tv.lumanest.tuner.") }.toList()
        }.distinct().sorted()
    }

    private fun readFields(cls: Class<*>, target: Any?, source: String, depth: Int, found: MutableList<Found>, seen: IdentityHashMap<Any, Boolean>) {
        var c: Class<*>? = cls
        while (c != null && c.name.startsWith("tv.lumanest.tuner")) {
            for (f in c.declaredFields) {
                if (Modifier.isStatic(f.modifiers) != (target == null)) continue
                f.isAccessible = true
                collect(f.get(target), "$source.${f.name}", depth, found, seen)
            }
            c = c.superclass
        }
    }

    private fun collect(value: Any?, source: String, depth: Int, found: MutableList<Found>, seen: IdentityHashMap<Any, Boolean>) {
        if (value == null || depth > 4 || value is String || value is Number || value is Boolean || value is Char) return
        if (seen.put(value, true) != null) return
        val next = depth + 1
        when (value) {
            is Regex -> found += Found(value.pattern, RegexOption.IGNORE_CASE in value.options, source)
            is java.util.regex.Pattern -> found += Found(value.pattern(), value.flags() and java.util.regex.Pattern.CASE_INSENSITIVE != 0, source)
            is Lazy<*> -> collect(value.value, source, next, found, seen)
            is Map<*, *> -> value.forEach { (k, v) -> collect(k, source, next, found, seen); collect(v, source, next, found, seen) }
            is Iterable<*> -> value.forEach { collect(it, source, next, found, seen) }
            is Array<*> -> value.forEach { collect(it, source, next, found, seen) }
            is Pair<*, *> -> { collect(value.first, source, next, found, seen); collect(value.second, source, next, found, seen) }
            else -> if (value.javaClass.name.startsWith("tv.lumanest.tuner")) readFields(value.javaClass, value, source, next, found, seen)
        }
    }

    private fun json(s: String) = buildString {
        append('"')
        for (ch in s) when {
            ch == '\\' || ch == '"' -> append('\\').append(ch)
            ch < ' ' || ch.code in 0x7f..0x9f || ch == '\u2028' || ch == '\u2029' -> append("\\u%04x".format(ch.code))
            else -> append(ch)
        }
        append('"')
    }

    private companion object {
        private val quantifier = Regex("""\{\d+(?:,\d*)?\}""")

        /** Positions of `{` and `}` outside character classes, `\Q...\E` and `\p{...}`-style escapes that don't belong to a quantifier. */
        fun bareBraces(p: String): List<Int> {
            val bad = mutableListOf<Int>()
            var i = 0
            var classDepth = 0
            while (i < p.length) {
                val ch = p[i]
                when {
                    ch == '\\' && p.startsWith("\\Q", i) -> { val end = p.indexOf("\\E", i + 2); i = if (end < 0) p.length else end + 2; continue }
                    // \p{Mn}, \P{L}, \x{41}, \N{name}: the braces belong to the escape.
                    ch == '\\' && i + 2 < p.length && p[i + 1] in "pPxN" && p[i + 2] == '{' -> {
                        val end = p.indexOf('}', i + 3); i = if (end < 0) p.length else end + 1; continue
                    }
                    ch == '\\' -> { i += 2; continue }
                    ch == '[' -> classDepth++
                    ch == ']' && classDepth > 0 -> classDepth--
                    classDepth > 0 -> {}
                    ch == '{' -> {
                        val q = quantifier.find(p, i)?.takeIf { it.range.first == i }
                        if (q != null) { i = q.range.last + 1; continue }
                        bad += i
                    }
                    ch == '}' -> bad += i
                }
                i++
            }
            return bad
        }
    }
}
