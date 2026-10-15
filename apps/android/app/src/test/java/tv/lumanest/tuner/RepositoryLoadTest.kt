package tv.lumanest.tuner

import tv.lumanest.tuner.data.*
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.Executors

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RepositoryLoadTest {
    @Test fun failingLiveEndpointCannotCancelMovieAndSeriesLoading() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        File(context.cacheDir, "sources/logos/logos.json").apply { parentFile!!.mkdirs(); writeText("[]") }
        Repo.init(context)
        Repo.prefs.freeEpgRegions = emptyList()
        val server = ServerSocket(0)
        val executor = Executors.newCachedThreadPool()
        executor.submit {
            while (!server.isClosed) runCatching {
                val socket = server.accept()
                executor.submit {
                    socket.use {
                        val reader = it.getInputStream().bufferedReader()
                        val request = reader.readLine().orEmpty()
                        while (reader.readLine()?.isNotEmpty() == true) Unit
                        val action = Regex("action=([^& ]+)").find(request)?.groupValues?.get(1)
                        val body = when (action) {
                            "get_live_streams" -> """[{"stream_id":1,"name":"[US] CNN","category_id":"1"}]"""
                            "get_vod_categories", "get_series_categories" -> """[{"category_id":"1","category_name":"Action"}]"""
                            "get_vod_streams" -> """[{"stream_id":2,"name":"Film","category_id":"1","container_extension":"mp4"}]"""
                            "get_series" -> """[{"series_id":3,"name":"Series","category_id":"1"}]"""
                            else -> null
                        }
                        val bytes = body.orEmpty().toByteArray()
                        val headers = "HTTP/1.1 ${if (body == null) "503 Unavailable" else "200 OK"}\r\nContent-Type: application/json\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                        it.getOutputStream().apply { write(headers.toByteArray()); write(bytes); flush() }
                    }
                }
            }
        }
        try {
            val source = Source(UUID.randomUUID().toString(), "Local test", SourceType.XTREAM, "http://127.0.0.1:${server.localPort}", "test", "test")
            Repo.prefs.saveSource(source); Repo.prefs.setActive(source.id)
            Repo.load()
            withTimeout(5_000) {
                while (Repo.liveStatus.value !is LoadStatus.Error || Repo.vodStatus.value !is LoadStatus.Ready || Repo.seriesStatus.value !is LoadStatus.Ready) delay(20)
            }
            assertEquals("Film", Repo.movies.value.single().name)
            assertEquals("Series", Repo.series.value.single().name)
        } finally { server.close(); executor.shutdownNow() }
    }
}
