package tv.lumanest.tuner.player

import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import tv.lumanest.tuner.player.PlayerDataSource.Route
import java.io.File
import java.nio.file.Files

/**
 * Which links the main player opens (security review, finding 7): http(s) to the streams, file: only inside the
 * OpenSubtitles folder by its canonical path, everything else refused. Plain JUnit: [PlayerDataSource.route] needs no
 * Android, only the file system.
 */
class PlayerDataSourceRouteTest {
    @get:Rule val tmp = TemporaryFolder()

    private lateinit var cache: File
    private lateinit var subtitles: File
    private lateinit var vtt: File

    @Before fun folders() {
        cache = tmp.newFolder("cache")
        subtitles = File(cache, "subtitles").apply { mkdirs() }
        vtt = File(subtitles, "0123456789abcdef0123456789abcdef.vtt").apply { writeText("WEBVTT\n") }
    }

    private fun route(scheme: String?, path: String?) = PlayerDataSource.route(scheme, path, subtitles)
    private fun opened(file: File) = Route.SubtitleFile(file.canonicalFile)

    @Test fun httpAndHttpsGoToTheStreams() {
        assertEquals(Route.Stream, route("http", "/live/user/pass/1.ts"))
        assertEquals(Route.Stream, route("https", "/movie/user/pass/2.mkv"))
        assertEquals(Route.Stream, route("https", null))
        // Streams don't depend on the subtitle folder.
        assertEquals(Route.Stream, PlayerDataSource.route("http", "/x.m3u8", null))
    }

    @Test fun schemesIgnoreLetterCase() {
        for (scheme in listOf("HTTP", "Http", "HTTPS", "hTtPs")) assertEquals(scheme, Route.Stream, route(scheme, "/live/1.ts"))
        for (scheme in listOf("FILE", "File", "fIlE")) assertEquals(scheme, opened(vtt), route(scheme, vtt.path))
        for (scheme in listOf("CONTENT", "Asset", "DATA", "Udp", "ANDROID.RESOURCE", "RawResource", "RTMP")) {
            assertEquals(scheme, Route.Refused, route(scheme, vtt.path))
        }
    }

    @Test fun theSubtitleCopyIsOpenedByItsCanonicalPath() {
        assertEquals(opened(vtt), route("file", vtt.path))
        assertEquals(opened(vtt), route("file", vtt.absolutePath))
        // Another name in the folder that isn't there yet: FileDataSource reports it missing.
        val missing = File(subtitles, "fedcba9876543210fedcba9876543210.vtt")
        assertEquals(opened(missing), route("file", missing.path))
        // Dots that stay inside the folder are fine; the route names the canonical file.
        assertEquals(opened(vtt), route("file", "${subtitles.path}/./x/../${vtt.name}"))
        assertEquals(opened(vtt), route("file", "${subtitles.path}/../subtitles/${vtt.name}"))
    }

    @Test fun dotDotCantLeaveTheFolder() {
        File(cache, "secret.txt").writeText("token")
        assertEquals(Route.Refused, route("file", "${subtitles.path}/../secret.txt"))
        assertEquals(Route.Refused, route("file", "${subtitles.path}/../../cache/secret.txt"))
        assertEquals(Route.Refused, route("file", "${subtitles.path}/x/../../secret.txt"))
        assertEquals(Route.Refused, route("file", "${subtitles.path}/.."))
        assertEquals(Route.Refused, route("file", "${subtitles.path}/../../../../../../../../etc/hosts"))
    }

    @Test fun otherFilesInTheCacheFolderAreRefused() {
        val other = File(cache, "image_cache/abc.0").apply { parentFile!!.mkdirs(); writeText("x") }
        assertEquals(Route.Refused, route("file", other.path))
        assertEquals(Route.Refused, route("file", File(cache, "catalog.json").path))
        // The folder itself, with or without a trailing slash.
        assertEquals(Route.Refused, route("file", subtitles.path))
        assertEquals(Route.Refused, route("file", subtitles.path + "/"))
        // A sibling whose name only starts with the folder's.
        val sibling = File(cache, "subtitles-old/${vtt.name}").apply { parentFile!!.mkdirs(); writeText("WEBVTT\n") }
        assertEquals(Route.Refused, route("file", sibling.path))
        assertEquals(Route.Refused, route("file", File(cache, "subtitles.vtt").path))
        // Files elsewhere on the device.
        assertEquals(Route.Refused, route("file", "/data/data/tv.lumanest.tuner/shared_prefs/prefs.xml"))
        assertEquals(Route.Refused, route("file", "/android_asset/index.html"))
        assertEquals(Route.Refused, route("file", "/sdcard/Download/x.vtt"))
    }

    @Test fun aSymbolicLinkCantLeaveTheFolder() {
        val secret = File(tmp.root, "files/secret.txt").apply { parentFile!!.mkdirs(); writeText("token") }
        val link = File(subtitles, "evil.vtt")
        assumeTrue("symbolic links unavailable", symlink(link, secret))
        assertEquals(Route.Refused, route("file", link.path))
        // A linked folder inside the subtitle folder that points out of it.
        val linkedDir = File(subtitles, "out")
        assumeTrue(symlink(linkedDir, secret.parentFile!!))
        assertEquals(Route.Refused, route("file", "${linkedDir.path}/secret.txt"))
        // A link that stays inside resolves to its target.
        val inside = File(subtitles, "alias.vtt")
        assumeTrue(symlink(inside, vtt))
        assertEquals(opened(vtt), route("file", inside.path))
    }

    /** As /data/user/0 links to /data/data on many devices: the folder reached through a linked parent still works. */
    @Test fun theFolderReachedThroughALinkedParentStillWorks() {
        val alias = File(tmp.root, "user0")
        assumeTrue("symbolic links unavailable", symlink(alias, cache))
        val viaAlias = File(alias, "subtitles")
        assertEquals(opened(vtt), PlayerDataSource.route("file", File(viaAlias, vtt.name).path, viaAlias))
        assertEquals(opened(vtt), PlayerDataSource.route("file", vtt.path, viaAlias))
        assertEquals(opened(vtt), PlayerDataSource.route("file", File(viaAlias, vtt.name).path, subtitles))
        assertEquals(Route.Refused, PlayerDataSource.route("file", File(alias, "secret.txt").path, viaAlias))
    }

    @Test fun everyOtherSchemeIsRefused() {
        for (scheme in listOf("content", "asset", "android.resource", "rawresource", "data", "udp", "rtmp", "rtsp", "ftp", "jar", "javascript", "", "x-file", "files", "https+file")) {
            assertEquals(scheme, Route.Refused, route(scheme, vtt.path))
        }
        // No scheme: Media3's DefaultDataSource would read that as a local file.
        assertEquals(Route.Refused, route(null, vtt.path))
    }

    @Test fun aFileLinkWithoutAUsablePathIsRefused() {
        // An opaque link (file:name) has no path.
        assertEquals(Route.Refused, route("file", null))
        assertEquals(Route.Refused, route("file", ""))
        // No subtitle folder yet: no file at all.
        assertEquals(Route.Refused, PlayerDataSource.route("file", vtt.path, null))
        // A path the file system can't take (an encoded NUL) is refused, not thrown.
        assertEquals(Route.Refused, route("file", subtitles.path + "/a" + Char(0) + ".vtt"))
    }

    private fun symlink(link: File, target: File): Boolean =
        runCatching { Files.createSymbolicLink(link.toPath(), target.toPath()) }.isSuccess
}
