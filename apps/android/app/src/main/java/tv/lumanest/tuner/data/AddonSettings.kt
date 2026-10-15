package tv.lumanest.tuner.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The configured URL may embed a debrid API key. Encrypt it with the app's Android Keystore key. */
class AddonSettings(context: Context) {
    private val prefs = context.getSharedPreferences("torrentio", Context.MODE_PRIVATE)
    val configured: Boolean get() = prefs.contains("manifest")
    var allowUntaggedAudio: Boolean
        get() = prefs.getBoolean("allowUntaggedAudio", false)
        set(value) { check(prefs.edit().putBoolean("allowUntaggedAudio", value).commit()) }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    var manifest: String
        get() {
            val saved = prefs.getString("manifest", null) ?: return DEFAULT
            return runCatching {
                val bytes = Base64.decode(saved, Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
                String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
            }.getOrDefault(DEFAULT)
        }
        set(value) {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val encrypted = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
            check(prefs.edit().putString("manifest", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit()) { "Could not save the addon settings." }
        }
    companion object {
        private const val ALIAS = "tuner.torrentio.manifest"
        const val DEFAULT = "https://torrentio.strem.fun/sort=quality%7Cqualityfilter=brremux,threed,scr,cam,720p,480p,other,unknown%7Climit=5%7Csizefilter=15GB,3GB/manifest.json"
    }
}
