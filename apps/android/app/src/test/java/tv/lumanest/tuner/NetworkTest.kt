package tv.lumanest.tuner

import tv.lumanest.tuner.data.Net
import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class NetworkTest {
    @Test fun cancelledBodyReadReturnsPromptlyAndKeepsOldCache() = runBlocking {
        val server = ServerSocket(0)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        val folder = kotlin.io.path.createTempDirectory("tuner-network").toFile()
        val cache = File(folder, "catalog.json").apply { writeText("old cache") }
        val serving = executor.submit {
            server.accept().use { socket ->
                val reader = socket.getInputStream().bufferedReader()
                while (reader.readLine()?.isNotEmpty() == true) Unit
                socket.getOutputStream().apply {
                    write("HTTP/1.1 200 OK\r\nContent-Length: 1000000\r\nConnection: close\r\n\r\nx".toByteArray())
                    flush()
                }
                started.countDown()
                release.await(5, TimeUnit.SECONDS)
            }
        }
        try {
            val request = async { Net.download("http://127.0.0.1:${server.localPort}/slow", "", cache, 0, true) }
            assertTrue("Request did not start", withContext(Dispatchers.IO) { started.await(3, TimeUnit.SECONDS) })
            withTimeout(1_000) { request.cancelAndJoin() }
            assertTrue(request.isCancelled)
            assertEquals("old cache", cache.readText())
        } finally {
            release.countDown(); server.close(); serving.cancel(true); executor.shutdownNow()
            folder.deleteRecursively()
        }
    }

    @Test fun unavailableProviderFallsBackToExistingCache() = runBlocking {
        val server = ServerSocket(0)
        val executor = Executors.newSingleThreadExecutor()
        val folder = kotlin.io.path.createTempDirectory("tuner-network").toFile()
        val cache = File(folder, "catalog.json").apply { writeText("cached catalog") }
        val serving = executor.submit {
            server.accept().use { socket ->
                val reader = socket.getInputStream().bufferedReader()
                while (reader.readLine()?.isNotEmpty() == true) Unit
                socket.getOutputStream().apply { write("HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); flush() }
            }
        }
        try {
            val result = withTimeout(3_000) { Net.download("http://127.0.0.1:${server.localPort}/catalog", "", cache, 0, true) }
            assertEquals(cache, result)
            assertEquals("cached catalog", result.readText())
            assertEquals(listOf(cache.name), folder.list()?.toList())
        } finally {
            server.close(); serving.cancel(true); executor.shutdownNow(); folder.deleteRecursively()
        }
    }
}
