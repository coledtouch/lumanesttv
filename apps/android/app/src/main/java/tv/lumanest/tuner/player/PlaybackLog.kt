package tv.lumanest.tuner.player

import android.os.SystemClock
import android.util.Log

/**
 * Tune timing in logcat (tag "TunerPlayback"), so zapping speed can be measured on a real box:
 *   adb logcat -s TunerPlayback
 */
object PlaybackLog {
    private const val TAG = "TunerPlayback"
    @Volatile private var startedAt = 0L
    @Volatile private var label = ""
    @Volatile private var busyRetries = 0

    fun start(url: String) {
        startedAt = SystemClock.elapsedRealtime()
        label = url.substringBefore('?').substringAfterLast('/')
        busyRetries = 0
        Log.i(TAG, "tune $label")
    }

    fun slotBusy(attempt: Int, length: Long) {
        busyRetries = attempt
        Log.i(TAG, "slot busy $label attempt=$attempt clipBytes=$length at=${since()}ms")
    }

    fun opened(busy: Int) { Log.i(TAG, "stream open $label at=${since()}ms busyRetries=$busy") }

    fun ready() { Log.i(TAG, "ready $label at=${since()}ms") }

    fun firstFrame() { Log.i(TAG, "first frame $label at=${since()}ms busyRetries=$busyRetries") }

    fun note(msg: String) { Log.i(TAG, "$msg $label at=${since()}ms") }

    private fun since() = if (startedAt == 0L) -1 else SystemClock.elapsedRealtime() - startedAt
}
