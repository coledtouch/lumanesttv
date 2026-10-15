package tv.lumanest.tuner

import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.PictureInPictureUiState
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import tv.lumanest.tuner.player.PlayerHolder
import tv.lumanest.tuner.player.TwoChannelPlayer
import tv.lumanest.tuner.player.PipAspectRatio
import tv.lumanest.tuner.ui.App
import tv.lumanest.tuner.ui.TunerTheme
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.combine

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class MainActivity : ComponentActivity() {
    private var started = false
    private var pipSourceRect: Rect? = null
    private val pipAction = "tv.lumanest.tuner.PIP_PLAY_PAUSE"
    private val pipReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != pipAction || !PlayerHolder.inPictureInPicture.value) return
            val p = PlayerHolder.player
            if (PlayerHolder.error.value != null) PlayerHolder.retry()
            else if (p.playWhenReady && p.playbackState != androidx.media3.common.Player.STATE_ENDED) p.pause()
            else {
                if (p.playbackState == androidx.media3.common.Player.STATE_ENDED) p.seekTo(0)
                p.play()
            }
            updatePictureInPictureParams()
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlayerHolder.pipSupported.value = supportsNativePip()
        if (PlayerHolder.pipSupported.value) {
            ContextCompat.registerReceiver(this, pipReceiver, IntentFilter(pipAction), ContextCompat.RECEIVER_NOT_EXPORTED)
            lifecycleScope.launch {
                combine(PlayerHolder.fullscreenPlayback, PlayerHolder.pipStateChanges) { _, _ -> Unit }
                    .collect { updatePictureInPictureParams() }
            }
        }
        setContent { TunerTheme { App() } }
    }

    private fun supportsNativePip() = Build.VERSION.SDK_INT >= 26 && packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    fun updatePipSourceRect(rect: Rect) {
        if (rect.width() <= 0 || rect.height() <= 0) return
        pipSourceRect = Rect(rect)
        updatePictureInPictureParams()
    }

    /** Explicit button entry; Android may decline if its per-app PiP permission is disabled. */
    fun enterTunerPictureInPicture(): Boolean {
        if (!supportsNativePip() || !PlayerHolder.pipEligible || isFinishing) return false
        if (Build.VERSION.SDK_INT < 26) return false
        PlayerHolder.setPipTransition(true)
        val entered = runCatching { enterPictureInPictureMode(pipParams()) }.getOrDefault(false)
        if (!entered) PlayerHolder.setPipTransition(false)
        return entered
    }

    @RequiresApi(26)
    private fun pipParams(): PictureInPictureParams {
        val p = PlayerHolder.player
        val size = p.videoSize
        val ratio = PipAspectRatio.of(size.width, size.height, size.pixelWidthHeightRatio)
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(ratio.first, ratio.second))
        pipSourceRect?.let(builder::setSourceRectHint)
        val retry = PlayerHolder.error.value != null
        val label = if (retry) "Retry" else if (p.playWhenReady) "Pause" else "Play"
        val icon = if (retry) android.R.drawable.ic_popup_sync else if (p.playWhenReady) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val action = PendingIntent.getBroadcast(this, 1, Intent(pipAction).setPackage(packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.setActions(listOf(RemoteAction(Icon.createWithResource(this, icon), label, label, action)))
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setAutoEnterEnabled(PlayerHolder.pipEligible && p.isPlaying)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    private fun updatePictureInPictureParams() {
        if (Build.VERSION.SDK_INT >= 26 && PlayerHolder.pipSupported.value && !isFinishing) {
            runCatching { setPictureInPictureParams(pipParams()) }
        }
    }

    override fun onUserLeaveHint() {
        if (PlayerHolder.pipSupported.value && PlayerHolder.pipEligible && PlayerHolder.player.isPlaying) {
            if (Build.VERSION.SDK_INT in 26..30) enterTunerPictureInPicture()
            else if (Build.VERSION.SDK_INT >= 31) PlayerHolder.setPipTransition(true)
        }
        super.onUserLeaveHint()
    }

    @RequiresApi(26)
    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PlayerHolder.setPictureInPictureMode(isInPictureInPictureMode)
        if (!isInPictureInPictureMode && (!started || isFinishing)) PlayerHolder.onAppBackground()
        updatePictureInPictureParams()
    }

    @RequiresApi(31)
    override fun onPictureInPictureUiStateChanged(pipState: PictureInPictureUiState) {
        super.onPictureInPictureUiStateChanged(pipState)
        if (Build.VERSION.SDK_INT >= 35 && pipState.isTransitioningToPip) PlayerHolder.setPipTransition(true)
    }

    override fun onStart() {
        super.onStart()
        started = true
        if (Build.VERSION.SDK_INT < 26 || !isInPictureInPictureMode) PlayerHolder.setPipTransition(false)
        TwoChannelPlayer.onAppForeground()
        PlayerHolder.onAppForeground()
    }

    override fun onStop() {
        started = false
        if (!PlayerHolder.inPictureInPicture.value) PlayerHolder.setPipTransition(false)
        TwoChannelPlayer.onAppBackground()
        PlayerHolder.onAppBackground()
        super.onStop()
    }

    override fun onDestroy() {
        if (PlayerHolder.pipSupported.value) {
            runCatching { unregisterReceiver(pipReceiver) }
        }
        if (isFinishing) {
            TwoChannelPlayer.stop()
            PlayerHolder.setPictureInPictureMode(false)
            PlayerHolder.setFullscreenPlayback(false)
            PlayerHolder.stop()
        }
        super.onDestroy()
    }
}
