package com.yacacode.minecraft.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.yacacode.minecraft.ui.theme.AppearanceMode
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hardware-backed Android Keystore AES-256-GCM encrypted preferences store.
 * Stores saved credentials for Fingerprint/Biometric login, session cookie, and app preferences.
 */
class SecureStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("yc_secure_prefs", Context.MODE_PRIVATE)
    private val keyAlias = "yacacode_mc_aes_key_v1"

    private fun getOrCreateSecretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = ks.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        gen.init(spec)
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        val combined = ByteArray(1 + iv.size + ct.size)
        combined[0] = iv.size.toByte()
        System.arraycopy(iv, 0, combined, 1, iv.size)
        System.arraycopy(ct, 0, combined, 1 + iv.size, ct.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String?): String? {
        if (encoded.isNullOrBlank()) return null
        return try {
            val raw = Base64.decode(encoded, Base64.NO_WRAP)
            val ivLen = raw[0].toInt() and 0xFF
            val iv = raw.copyOfRange(1, 1 + ivLen)
            val ct = raw.copyOfRange(1 + ivLen, raw.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    private fun putSecret(key: String, value: String?) {
        if (value.isNullOrEmpty()) {
            prefs.edit().remove(key).apply()
        } else {
            prefs.edit().putString(key, encrypt(value)).apply()
        }
    }

    private fun getSecret(key: String): String? = decrypt(prefs.getString(key, null))

    var serverUrl: String
        get() = prefs.getString("server_url", YacaCodeApiClient.DEFAULT_PROD_URL) ?: YacaCodeApiClient.DEFAULT_PROD_URL
        set(value) = prefs.edit().putString("server_url", value).apply()

    var sessionCookie: String?
        get() = getSecret("session_cookie")
        set(value) = putSecret("session_cookie", value)

    var savedUsername: String?
        get() = getSecret("saved_user")
        set(value) = putSecret("saved_user", value)

    var savedPassword: String?
        get() = getSecret("saved_pass")
        set(value) = putSecret("saved_pass", value)

    var biometricLoginEnabled: Boolean
        get() = prefs.getBoolean("bio_login_enabled", true)
        set(value) = prefs.edit().putBoolean("bio_login_enabled", value).apply()

    var biometricAppLockEnabled: Boolean
        get() = prefs.getBoolean("bio_app_lock", false)
        set(value) = prefs.edit().putBoolean("bio_app_lock", value).apply()

    var appearanceMode: AppearanceMode
        get() = AppearanceMode.fromKey(prefs.getString("appearance", AppearanceMode.SYSTEM.key))
        set(value) = prefs.edit().putString("appearance", value.key).apply()

    fun hasSavedCredentials(): Boolean =
        !savedUsername.isNullOrBlank() && !savedPassword.isNullOrBlank()

    fun saveCredentials(username: String, password: String) {
        savedUsername = username
        savedPassword = password
    }

    fun clearCredentials() {
        savedUsername = null
        savedPassword = null
    }
}

object BiometricHelper {
    fun isBiometricAvailable(context: Context): Boolean {
        val bm = BiometricManager.from(context)
        val res = bm.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.BIOMETRIC_WEAK
        )
        return res == BiometricManager.BIOMETRIC_SUCCESS
    }

    fun promptBiometric(
        activity: FragmentActivity,
        title: String = "Entrar com Digital / Biometria",
        subtitle: String = "Use sua impressão digital ou biometria para acessar o Painel YacaCode",
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    onSuccess()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    if (errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON &&
                        errorCode != BiometricPrompt.ERROR_USER_CANCELED &&
                        errorCode != BiometricPrompt.ERROR_CANCELED
                    ) {
                        onError(errString.toString())
                    }
                }
            }
        )

        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.BIOMETRIC_WEAK
            )
            .setNegativeButtonText("Usar senha")
            .build()

        prompt.authenticate(info)
    }
}
