package com.yacacode.minecraft.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.yacacode.minecraft.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

@Serializable
data class GitHubReleaseAsset(
    val name: String = "",
    @SerialName("browser_download_url") val downloadUrl: String = "",
    val size: Long = 0L
)

@Serializable
data class GitHubReleaseDto(
    @SerialName("tag_name") val tagName: String = "",
    val name: String = "",
    val body: String = "",
    @SerialName("html_url") val htmlUrl: String = "",
    @SerialName("published_at") val publishedAt: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<GitHubReleaseAsset> = emptyList()
)

data class AppUpdateInfo(
    val versionName: String,
    val tagName: String,
    val title: String,
    val releaseNotes: String,
    val downloadUrl: String,
    val htmlUrl: String,
    val sizeBytes: Long,
    val publishedAt: String?
)

data class UpdateUiState(
    val checking: Boolean = false,
    val availableUpdate: AppUpdateInfo? = null,
    val downloading: Boolean = false,
    val downloadPercent: Int = 0,
    val downloadedBytes: Long = 0L,
    val totalBytes: Long = 0L,
    val downloadedApkPath: String? = null,
    val needsInstallPermission: Boolean = false,
    val upToDateMessage: String? = null,
    val error: String? = null
)

object AppUpdater {
    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    fun normalizeVersion(raw: String): String =
        raw.trim().removePrefix("v").removePrefix("V").substringBefore("-").substringBefore("+").trim()

    fun parseVersionTuple(raw: String): List<Int> {
        val clean = normalizeVersion(raw)
        if (clean.isEmpty()) return listOf(0, 0, 0)
        return clean.split(".").map { part ->
            part.takeWhile { it.isDigit() }.toIntOrNull() ?: 0
        }
    }

    fun isNewerVersion(remoteTag: String, currentVersion: String): Boolean {
        val remote = parseVersionTuple(remoteTag)
        val local = parseVersionTuple(currentVersion)
        val maxLen = maxOf(remote.size, local.size)
        for (i in 0 until maxLen) {
            val r = remote.getOrElse(i) { 0 }
            val l = local.getOrElse(i) { 0 }
            if (r > l) return true
            if (r < l) return false
        }
        return false
    }

    suspend fun checkForUpdates(
        currentVersion: String = BuildConfig.VERSION_NAME,
        repo: String = BuildConfig.GITHUB_REPO
    ): AppUpdateInfo? = withContext(Dispatchers.IO) {
        val release = fetchLatestRelease(repo) ?: return@withContext null
        if (release.draft || release.tagName.isBlank()) return@withContext null
        if (!isNewerVersion(release.tagName, currentVersion)) return@withContext null

        val apkAsset = release.assets.firstOrNull {
            it.name.endsWith(".apk", ignoreCase = true) && it.downloadUrl.isNotBlank()
        } ?: return@withContext null

        val cleanVer = normalizeVersion(release.tagName)
        AppUpdateInfo(
            versionName = cleanVer,
            tagName = release.tagName,
            title = release.name.ifBlank { "YacaCode Minecraft v$cleanVer" },
            releaseNotes = release.body.trim().ifBlank { "Melhorias de estabilidade, sincronização e desempenho." },
            downloadUrl = apkAsset.downloadUrl,
            htmlUrl = release.htmlUrl,
            sizeBytes = apkAsset.size,
            publishedAt = release.publishedAt
        )
    }

    private fun fetchLatestRelease(repo: String): GitHubReleaseDto? {
        val latestReq = Request.Builder()
            .url("https://api.github.com/repos/$repo/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "YacaCode-MC-Android/${BuildConfig.VERSION_NAME}")
            .build()

        httpClient.newCall(latestReq).execute().use { res ->
            if (res.isSuccessful) {
                val raw = res.body?.string().orEmpty()
                if (raw.isNotBlank()) {
                    return YacaCodeApiClient.json.decodeFromString<GitHubReleaseDto>(raw)
                }
            }
            if (res.code != 404) {
                throw ApiException(res.code, "GitHub retornou HTTP ${res.code} ao verificar atualizações.")
            }
        }

        // Fallback caso o repositório só tenha releases sem flag latest
        val listReq = Request.Builder()
            .url("https://api.github.com/repos/$repo/releases?per_page=5")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "YacaCode-MC-Android/${BuildConfig.VERSION_NAME}")
            .build()

        httpClient.newCall(listReq).execute().use { res ->
            if (!res.isSuccessful) return null
            val raw = res.body?.string().orEmpty()
            if (raw.isBlank()) return null
            val list = YacaCodeApiClient.json.decodeFromString<List<GitHubReleaseDto>>(raw)
            return list.firstOrNull { !it.draft && it.assets.any { a -> a.name.endsWith(".apk", true) } }
        }
    }

    suspend fun downloadApk(
        context: Context,
        info: AppUpdateInfo,
        onProgress: (downloadedBytes: Long, totalBytes: Long, percent: Int) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val finalFile = File(updatesDir, "yacacode-mc-${info.versionName}.apk")
        val tmpFile = File(updatesDir, "yacacode-mc-${info.versionName}.apk.tmp")

        // Limpa APKs antigos no cache
        updatesDir.listFiles()?.forEach { f ->
            if (f != finalFile && f != tmpFile) f.delete()
        }

        val req = Request.Builder()
            .url(info.downloadUrl)
            .header("User-Agent", "YacaCode-MC-Android/${BuildConfig.VERSION_NAME}")
            .build()

        try {
            httpClient.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    throw ApiException(res.code, "Falha ao baixar APK (HTTP ${res.code}).")
                }
                val body = res.body ?: throw ApiException(res.code, "Resposta de download vazia.")
                val total = body.contentLength().takeIf { it > 0L } ?: info.sizeBytes
                var downloaded = 0L
                var lastEmit = 0L

                body.byteStream().use { input ->
                    FileOutputStream(tmpFile).use { output ->
                        val buffer = ByteArray(16 * 1024)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            downloaded += read
                            val now = System.currentTimeMillis()
                            if (now - lastEmit >= 120L || (total > 0 && downloaded >= total)) {
                                lastEmit = now
                                val pct = if (total > 0) ((downloaded * 100L) / total).toInt().coerceIn(0, 100) else 0
                                onProgress(downloaded, total, pct)
                            }
                        }
                        output.flush()
                    }
                }
                if (finalFile.exists()) finalFile.delete()
                if (!tmpFile.renameTo(finalFile)) {
                    tmpFile.copyTo(finalFile, overwrite = true)
                    tmpFile.delete()
                }
                onProgress(downloaded, if (total > 0) total else downloaded, 100)
                finalFile
            }
        } catch (ce: CancellationException) {
            tmpFile.delete()
            throw ce
        } catch (e: Exception) {
            tmpFile.delete()
            throw e
        }
    }

    fun canInstallPackages(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    fun openUnknownSourcesSettings(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }

    fun launchInstallApk(context: Context, apkFile: File) {
        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
