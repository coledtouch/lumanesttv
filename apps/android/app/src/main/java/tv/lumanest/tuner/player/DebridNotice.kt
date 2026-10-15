package tv.lumanest.tuner.player

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

class DebridNoticeException(val explanation: String) : IOException(explanation)

/** Torrentio redirects unsuccessful debrid requests to silent status videos. */
object DebridNotice : Interceptor {
    fun message(url: HttpUrl): String? {
        if (url.host != "torrentio.strem.fun" || !url.encodedPath.startsWith("/videos/")) return null
        val file = url.pathSegments.last().lowercase()
        return when {
            file.startsWith("blocked_access") -> "AllDebrid blocked this connection. Open AllDebrid in your browser and approve the new third-party connection. Check its confirmation email, then retry."
            file.contains("download") -> "AllDebrid is still downloading this video. Try again later or choose another stream."
            file.contains("expired") -> "Your debrid subscription or trial has expired. Check your account, then retry."
            file.contains("invalid") || file.contains("apikey") -> "The debrid API key was rejected. Update your Torrentio source settings."
            file.contains("error") -> "The debrid service could not provide this stream. Check your account or try another stream."
            else -> "The debrid service returned a status video instead of the movie. Check your account and try another stream."
        }
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        val notice = message(response.request.url) ?: return response
        response.close()
        throw DebridNoticeException(notice)
    }
}
