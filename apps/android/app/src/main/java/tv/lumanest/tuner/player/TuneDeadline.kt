package tv.lumanest.tuner.player

import okhttp3.Call
import okhttp3.EventListener
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * OkHttp call factory for stream requests that can give up on a server which sits on a request.
 *
 * mybunny-style panels hold a new stream request for about 3.5 s when the previous channel's
 * connection hasn't been released yet, then answer with a "connection limit" clip. A healthy
 * stream answers in 0.3 to 0.9 s. So the first attempt of a tune gets a short deadline for the
 * response headers; if it passes, the call is canceled and [LiveSlotDataSource] asks again,
 * by which time the old connection is usually gone.
 *
 * The deadline only covers waiting for headers. Once the stream starts flowing it never applies.
 *
 * Each [Attempt] also keeps the [Call] it made. Media3's OkHttpDataSource is not thread-safe, so nothing may close it
 * from another thread, but [Call.cancel] is: [LiveRejoin]'s watchdog uses [Attempt.cancel] to end a body read that is
 * stuck on a provider connection which went quiet, and the loading thread then rejoins the stream.
 */
class TuneDeadline(base: OkHttpClient) : Call.Factory {
    private val answered: MutableSet<Call> = Collections.synchronizedSet(Collections.newSetFromMap(WeakHashMap<Call, Boolean>()))
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "tune-deadline").apply { isDaemon = true } }

    /** Each open owns its cancellation marker; another request's timeout must not mask its failure. */
    class Attempt(val timeoutMs: Long) {
        val expired = AtomicBoolean(false)

        /** The call this open made (set when OkHttp creates it on the opening thread). */
        @Volatile
        var call: Call? = null
            internal set

        /** Cancels this attempt's call from any thread; a read blocked on its socket fails at once. */
        fun cancel() { call?.cancel() }
    }

    private val client: OkHttpClient = base.newBuilder()
        // Live stalls should surface in seconds, not the minute a file download is allowed. [LiveRejoin] replaces a
        // quiet live TS connection a little sooner (QUIET_MS) when it can continue the stream on a new one; every other
        // connection, and any connection waiting for its first byte, keeps this timeout as before.
        .readTimeout(10, TimeUnit.SECONDS)
        .eventListenerFactory {
            object : EventListener() {
                override fun responseHeadersEnd(call: Call, response: Response) {
                    if (!response.isRedirect) answered += call
                }
                override fun callFailed(call: Call, ioe: java.io.IOException) { answered += call }
                override fun callEnd(call: Call) { answered += call }
            }
        }
        .build()

    override fun newCall(request: Request): Call {
        val call = client.newCall(request)
        val attempt = nextAttempt.get()
        attempt?.call = call
        val ms = attempt?.timeoutMs ?: 0L
        if (ms > 0) {
            scheduler.schedule({
                if (call !in answered && !call.isCanceled()) {
                    attempt?.expired?.set(true)
                    call.cancel()
                }
            }, ms, TimeUnit.MILLISECONDS)
        }
        return call
    }

    companion object {
        /** Set on the loading thread just before opening a stream; read when OkHttp creates the call. */
        val nextAttempt = ThreadLocal<Attempt?>()
    }
}
