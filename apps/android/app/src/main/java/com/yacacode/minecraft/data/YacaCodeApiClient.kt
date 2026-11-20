package com.yacacode.minecraft.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class ApiException(val statusCode: Int, override val message: String) : Exception(message)

fun Throwable.isCancellation(): Boolean {
    if (this is CancellationException) return true
    if (cause is CancellationException) return true
    val msg = message?.lowercase().orEmpty()
    if (msg == "canceled" || msg == "cancelled" || msg.contains("job was cancelled")) return true
    return false
}

class YacaCodeApiClient(
    private val secureStore: SecureStore,
    var onUnauthorized: (() -> Unit)? = null
) {
    companion object {
        const val DEFAULT_PROD_URL = "https://painel.yacacode.com"

        val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            isLenient = true
            explicitNulls = false
        }

        fun normalizeBaseUrl(raw: String): String {
            var cleaned = raw.trim()
            if (cleaned.isEmpty()) return DEFAULT_PROD_URL
            if (!cleaned.startsWith("http://") && !cleaned.startsWith("https://")) {
                cleaned = "https://$cleaned"
            }
            while (cleaned.endsWith("/")) cleaned = cleaned.dropLast(1)
            return cleaned
        }
    }

    var baseUrl: String = normalizeBaseUrl(secureStore.serverUrl)
        private set

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val octetMediaType = "application/octet-stream".toMediaType()

    private val cookieJar = object : CookieJar {
        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            for (c in cookies) {
                if (c.name == "yacacode_session") {
                    if (c.value.isBlank() || c.expiresAt <= System.currentTimeMillis()) {
                        secureStore.sessionCookie = null
                    } else {
                        secureStore.sessionCookie = c.value
                    }
                }
            }
        }

        override fun loadForRequest(url: HttpUrl): List<Cookie> {
            val token = secureStore.sessionCookie ?: return emptyList()
            if (token.isBlank()) return emptyList()
            return listOf(
                Cookie.Builder()
                    .name("yacacode_session")
                    .value(token)
                    .domain(url.host)
                    .path("/")
                    .build()
            )
        }
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(65, TimeUnit.SECONDS)
        .writeTimeout(65, TimeUnit.SECONDS)
        .build()

    private val sseClient: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .build()

    fun updateBaseUrl(raw: String) {
        baseUrl = normalizeBaseUrl(raw)
        secureStore.serverUrl = baseUrl
    }

    fun clearSession() {
        secureStore.sessionCookie = null
    }

    private fun buildUrl(path: String, query: Map<String, String> = emptyMap()): HttpUrl {
        val base = (baseUrl + path).toHttpUrlOrNull()
            ?: throw ApiException(0, "Endereço do servidor inválido: $baseUrl")
        if (query.isEmpty()) return base
        val b = base.newBuilder()
        for ((k, v) in query) b.addQueryParameter(k, v)
        return b.build()
    }

    private suspend inline fun <reified T> executeJson(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        bodyJson: String? = null,
        notifyUnauthorized: Boolean = true
    ): T = withContext(Dispatchers.IO) {
        val url = buildUrl(path, query)
        val reqBuilder = Request.Builder()
            .url(url)
            .header("X-Requested-With", "YacaCodePanel")
            .header("Accept", "application/json")

        val body = bodyJson?.toRequestBody(jsonMediaType)
        when (method) {
            "GET" -> reqBuilder.get()
            "DELETE" -> if (body != null) reqBuilder.delete(body) else reqBuilder.delete()
            "POST" -> reqBuilder.post(body ?: "{}".toRequestBody(jsonMediaType))
            "PUT" -> reqBuilder.put(body ?: "{}".toRequestBody(jsonMediaType))
            "PATCH" -> reqBuilder.patch(body ?: "{}".toRequestBody(jsonMediaType))
            else -> reqBuilder.method(method, body)
        }

        val response = try {
            client.newCall(reqBuilder.build()).execute()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            if (e.isCancellation()) throw CancellationException(e.message)
            throw ApiException(0, "Sem conexão com o servidor (${e.localizedMessage ?: "erro de rede"}).")
        }

        response.use { res ->
            val raw = res.body?.string().orEmpty()
            if (res.code == 401) {
                val msg = extractError(raw) ?: "Sessão expirada ou credenciais inválidas."
                if (notifyUnauthorized && !path.startsWith("/api/auth/")) {
                    onUnauthorized?.invoke()
                }
                throw ApiException(401, msg)
            }
            if (!res.isSuccessful) {
                val msg = extractError(raw) ?: "Erro HTTP ${res.code}"
                throw ApiException(res.code, msg)
            }
            try {
                json.decodeFromString<T>(raw)
            } catch (e: Exception) {
                throw ApiException(res.code, "Erro ao interpretar resposta: ${e.localizedMessage}")
            }
        }
    }

    private fun extractError(raw: String): String? = try {
        val parsed = json.decodeFromString<ApiErrorBody>(raw)
        parsed.error ?: parsed.message
    } catch (_: Exception) {
        null
    }

    // --- Endpoints ---

    suspend fun authMe(): AuthMeResponse =
        executeJson("GET", "/api/auth/me", notifyUnauthorized = false)

    suspend fun login(username: String, password: String): LoginResponse {
        val payload = buildJsonObject {
            put("username", JsonPrimitive(username))
            put("password", JsonPrimitive(password))
        }.toString()
        return executeJson("POST", "/api/auth/login", bodyJson = payload, notifyUnauthorized = false)
    }

    suspend fun logout() {
        runCatching { executeJson<GenericOkResponse>("POST", "/api/auth/logout", notifyUnauthorized = false) }
        clearSession()
    }

    suspend fun changeOwnPassword(currentPassword: String, newPassword: String): GenericOkResponse {
        val payload = buildJsonObject {
            put("currentPassword", JsonPrimitive(currentPassword))
            put("newPassword", JsonPrimitive(newPassword))
        }.toString()
        return executeJson("POST", "/api/auth/password", bodyJson = payload)
    }

    suspend fun overview(): OverviewResponse = executeJson("GET", "/api/overview")

    suspend fun serverPower(action: String): GenericOkResponse {
        val payload = buildJsonObject { put("action", JsonPrimitive(action)) }.toString()
        return executeJson("POST", "/api/server/power", bodyJson = payload)
    }

    suspend fun runConsoleCommand(command: String): ConsoleCommandResponse {
        val payload = buildJsonObject { put("command", JsonPrimitive(command)) }.toString()
        return executeJson("POST", "/api/console/command", bodyJson = payload)
    }

    fun openConsoleStream(
        tail: Int = 220,
        onEvent: (event: String, data: String) -> Unit,
        onFailure: (String) -> Unit,
        onClosed: () -> Unit
    ): EventSource {
        val url = buildUrl("/api/console/stream", mapOf("tail" to tail.toString()))
        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("X-Requested-With", "YacaCodePanel")
            .build()

        return EventSources.createFactory(sseClient).newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                onEvent(type ?: "message", data)
            }

            override fun onClosed(eventSource: EventSource) {
                onClosed()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                if (response?.code == 401) {
                    onUnauthorized?.invoke()
                }
                val msg = t?.localizedMessage ?: response?.let { "HTTP ${it.code}" } ?: "Conexão interrompida"
                onFailure(msg)
            }
        })
    }

    suspend fun aiStatus(): AiStatusResponse = executeJson("GET", "/api/ai/status")

    suspend fun updateAiConfig(apiKey: String?, model: String, inGameChatEnabled: Boolean): AiStatusResponse {
        val payload = buildJsonObject {
            put("model", JsonPrimitive(model))
            put("inGameChatEnabled", JsonPrimitive(inGameChatEnabled))
            if (!apiKey.isNullOrBlank()) put("apiKey", JsonPrimitive(apiKey.trim()))
        }.toString()
        return executeJson("PUT", "/api/ai/config", bodyJson = payload)
    }

    suspend fun aiChat(
        message: String,
        history: List<AiHistoryItem>,
        conversationId: String? = null
    ): AiChatResponse {
        val payload = json.encodeToString(
            AiChatRequest.serializer(),
            AiChatRequest(message, history, conversationId)
        )
        return executeJson("POST", "/api/ai/chat", bodyJson = payload)
    }

    suspend fun aiConversations(): AiConversationsResponse =
        executeJson("GET", "/api/ai/conversations")

    suspend fun aiConversation(id: String, select: Boolean = true): AiConversationDetailResponse =
        executeJson(
            "GET",
            "/api/ai/conversations/${URLEncoder.encode(id, "UTF-8")}",
            query = if (select) mapOf("select" to "1") else emptyMap()
        )

    suspend fun aiCreateConversation(title: String = ""): AiConversationCreateResponse {
        val payload = buildJsonObject {
            if (title.isNotBlank()) put("title", JsonPrimitive(title))
        }.toString()
        return executeJson("POST", "/api/ai/conversations", bodyJson = payload)
    }

    suspend fun aiDeleteConversation(id: String): AiConversationDeleteResponse =
        executeJson("DELETE", "/api/ai/conversations/${URLEncoder.encode(id, "UTF-8")}")

    fun openAiSyncStream(
        onConnected: () -> Unit,
        onSync: (String) -> Unit,
        onFailure: () -> Unit
    ): EventSource {
        val url = buildUrl("/api/ai/events")
        val request = Request.Builder()
            .url(url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("X-Requested-With", "YacaCodePanel")
            .build()

        return EventSources.createFactory(sseClient).newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                when (type) {
                    "connected" -> onConnected()
                    "sync" -> onSync(data)
                }
            }

            override fun onClosed(eventSource: EventSource) {
                onFailure()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                if (response?.code == 401) {
                    onUnauthorized?.invoke()
                }
                onFailure()
            }
        })
    }

    suspend fun aiConfirm(actionId: String, decision: String): AiConfirmResponse {
        val payload = buildJsonObject {
            put("actionId", JsonPrimitive(actionId))
            put("decision", JsonPrimitive(decision))
        }.toString()
        return executeJson("POST", "/api/ai/confirm", bodyJson = payload)
    }

    suspend fun players(): PlayersResponse = executeJson("GET", "/api/players")

    suspend fun playerAction(
        action: String,
        player: String? = null,
        reason: String? = null,
        message: String? = null
    ): PlayerActionResponse {
        val payload = buildJsonObject {
            put("action", JsonPrimitive(action))
            if (!player.isNullOrBlank()) put("player", JsonPrimitive(player))
            if (!reason.isNullOrBlank()) put("reason", JsonPrimitive(reason))
            if (!message.isNullOrBlank()) put("message", JsonPrimitive(message))
        }.toString()
        return executeJson("POST", "/api/players/action", bodyJson = payload)
    }

    suspend fun properties(): PropertiesResponse = executeJson("GET", "/api/properties")

    suspend fun saveProperties(props: Map<String, String>): GenericOkResponse {
        val propsObj = JsonObject(props.mapValues { JsonPrimitive(it.value) })
        val payload = JsonObject(mapOf("properties" to propsObj)).toString()
        return executeJson("PUT", "/api/properties", bodyJson = payload)
    }

    suspend fun applyPresets(): PresetsApplyResponse = executeJson("POST", "/api/presets/apply")

    suspend fun plugins(): PluginsResponse = executeJson("GET", "/api/plugins")

    suspend fun togglePlugin(fileName: String): GenericOkResponse {
        val payload = buildJsonObject { put("fileName", JsonPrimitive(fileName)) }.toString()
        return executeJson("POST", "/api/plugins/toggle", bodyJson = payload)
    }

    suspend fun deletePlugin(fileName: String): GenericOkResponse =
        executeJson("DELETE", "/api/plugins", query = mapOf("name" to fileName))

    suspend fun uploadPlugin(fileName: String, bytes: ByteArray): GenericOkResponse = withContext(Dispatchers.IO) {
        val url = buildUrl("/api/plugins/upload", mapOf("name" to fileName))
        val req = Request.Builder()
            .url(url)
            .header("X-Requested-With", "YacaCodePanel")
            .post(bytes.toRequestBody(octetMediaType))
            .build()
        client.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) throw ApiException(res.code, extractError(raw) ?: "Erro HTTP ${res.code}")
            json.decodeFromString(raw)
        }
    }

    suspend fun listFiles(path: String): FilesListResponse =
        executeJson("GET", "/api/files", query = mapOf("path" to path))

    suspend fun readFile(path: String): FileContentResponse =
        executeJson("GET", "/api/files/content", query = mapOf("path" to path))

    suspend fun saveFile(path: String, content: String): GenericOkResponse {
        val payload = buildJsonObject {
            put("path", JsonPrimitive(path))
            put("content", JsonPrimitive(content))
        }.toString()
        return executeJson("PUT", "/api/files/content", bodyJson = payload)
    }

    suspend fun mkdir(path: String): GenericOkResponse {
        val payload = buildJsonObject { put("path", JsonPrimitive(path)) }.toString()
        return executeJson("POST", "/api/files/mkdir", bodyJson = payload)
    }

    suspend fun deleteFile(path: String): GenericOkResponse =
        executeJson("DELETE", "/api/files", query = mapOf("path" to path))

    suspend fun localBackups(): BackupsListResponse = executeJson("GET", "/api/backups")

    suspend fun deleteLocalBackup(name: String): GenericOkResponse =
        executeJson("DELETE", "/api/backups", query = mapOf("name" to name))

    suspend fun gdriveStatus(includeFiles: Boolean = true): GDriveStatusResponse =
        executeJson("GET", "/api/backups/gdrive/status", query = if (includeFiles) mapOf("files" to "1") else emptyMap())

    suspend fun triggerBackupNow(): BackupTriggerResponse = executeJson("POST", "/api/backups/now")

    suspend fun syncBackupToGDrive(fileName: String? = null): BackupTriggerResponse {
        val payload = if (fileName != null) {
            buildJsonObject { put("fileName", JsonPrimitive(fileName)) }.toString()
        } else "{}"
        return executeJson("POST", "/api/backups/gdrive/sync", bodyJson = payload)
    }

    suspend fun updateGDriveConfig(fields: Map<String, JsonElement>): GDriveStatusResponse =
        executeJson("PUT", "/api/backups/gdrive/config", bodyJson = JsonObject(fields).toString())

    suspend fun gdriveAuthUrl(): GDriveAuthUrlResponse = executeJson("GET", "/api/backups/gdrive/auth-url")

    suspend fun testGDrive(): GDriveTestResponse = executeJson("POST", "/api/backups/gdrive/test")

    suspend fun disconnectGDrive(): GDriveStatusResponse =
        executeJson("POST", "/api/backups/gdrive/disconnect", bodyJson = "{}")

    suspend fun deleteGDriveFile(id: String): GenericOkResponse =
        executeJson("DELETE", "/api/backups/gdrive/files", query = mapOf("id" to id))

    suspend fun networkDetail(refresh: Boolean = false): NetworkDetailResponse =
        executeJson("GET", "/api/network", query = if (refresh) mapOf("refresh" to "1") else emptyMap())

    suspend fun users(): UsersResponse = executeJson("GET", "/api/users")

    suspend fun createUser(username: String, displayName: String, role: String, password: String): UsersResponse {
        val payload = buildJsonObject {
            put("username", JsonPrimitive(username))
            put("displayName", JsonPrimitive(displayName))
            put("role", JsonPrimitive(role))
            put("password", JsonPrimitive(password))
        }.toString()
        return executeJson("POST", "/api/users", bodyJson = payload)
    }

    suspend fun updateUser(
        username: String,
        role: String? = null,
        enabled: Boolean? = null,
        password: String? = null
    ): UsersResponse {
        val payload = buildJsonObject {
            put("username", JsonPrimitive(username))
            if (role != null) put("role", JsonPrimitive(role))
            if (enabled != null) put("enabled", JsonPrimitive(enabled))
            if (!password.isNullOrBlank()) put("password", JsonPrimitive(password))
        }.toString()
        return executeJson("PATCH", "/api/users", bodyJson = payload)
    }

    suspend fun deleteUser(username: String): UsersResponse =
        executeJson("DELETE", "/api/users", query = mapOf("username" to username))

    fun fileDownloadUrl(relPath: String): String =
        "$baseUrl/api/files/download?path=${URLEncoder.encode(relPath, "UTF-8")}"
}
