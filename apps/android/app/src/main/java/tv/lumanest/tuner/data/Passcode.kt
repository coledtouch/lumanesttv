package tv.lumanest.tuner.data

import java.security.MessageDigest
import java.security.SecureRandom

/**
 * The 4-digit adult content passcode. Only a salted SHA-256 hash and its random salt are stored, never the digits.
 * Five wrong tries in a row lock entry for [LOCKOUT_MS].
 */
object Passcode {
    const val LENGTH = 4
    const val MAX_TRIES = 5
    const val LOCKOUT_MS = 60_000L
    private val random by lazy { SecureRandom() }

    fun isValid(code: String): Boolean = code.length == LENGTH && code.all { it in '0'..'9' }

    fun newSalt(): String = ByteArray(16).also { random.nextBytes(it) }.toHex()

    fun hash(code: String, salt: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(salt.toByteArray(Charsets.UTF_8))
        digest.update(':'.code.toByte())
        digest.update(code.toByteArray(Charsets.UTF_8))
        return digest.digest().toHex()
    }

    fun verify(code: String, salt: String?, hash: String?): Boolean {
        if (salt.isNullOrBlank() || hash.isNullOrBlank() || !isValid(code)) return false
        return MessageDigest.isEqual(hash(code, salt).toByteArray(Charsets.UTF_8), hash.lowercase().toByteArray(Charsets.UTF_8))
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }

    /** Wrong-try bookkeeping, persisted by [Prefs] so restarting the app does not reset a lockout. */
    data class Attempts(val failures: Int = 0, val lockedUntil: Long = 0) {
        /** Remaining wait; a clock moved backwards never extends it past one lockout. */
        fun waitMs(now: Long): Long = (lockedUntil - now).coerceIn(0, LOCKOUT_MS)
        val triesLeft: Int get() = (MAX_TRIES - failures).coerceAtLeast(0)
        fun failed(now: Long): Attempts {
            val count = failures + 1
            return if (count >= MAX_TRIES) Attempts(0, now + LOCKOUT_MS) else Attempts(count, 0)
        }
    }

    sealed interface Check {
        data object Ok : Check
        data class Wrong(val triesLeft: Int) : Check
        data class LockedOut(val waitMs: Long) : Check
    }

    /** Pure verification step: returns the outcome and the attempts to store. */
    fun check(code: String, salt: String?, hash: String?, attempts: Attempts, now: Long): Pair<Check, Attempts> {
        val wait = attempts.waitMs(now)
        if (wait > 0) return Check.LockedOut(wait) to attempts
        val current = if (attempts.lockedUntil != 0L) Attempts() else attempts
        if (verify(code, salt, hash)) return Check.Ok to Attempts()
        val next = current.failed(now)
        return (if (next.lockedUntil > 0) Check.LockedOut(next.waitMs(now)) else Check.Wrong(next.triesLeft)) to next
    }
}
