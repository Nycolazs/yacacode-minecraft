package com.yacacode.minecraft

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.yacacode.minecraft.data.AiActionLog
import com.yacacode.minecraft.data.AiChatMessage
import com.yacacode.minecraft.data.AiConversationSummary
import com.yacacode.minecraft.data.AiHistoryItem
import com.yacacode.minecraft.data.AiStatusResponse
import com.yacacode.minecraft.data.AppUpdater
import com.yacacode.minecraft.data.AuthMeResponse
import com.yacacode.minecraft.data.BiometricHelper
import com.yacacode.minecraft.data.ConsoleLogKind
import com.yacacode.minecraft.data.ConsoleLogLine
import com.yacacode.minecraft.data.ConsoleStreamLog
import com.yacacode.minecraft.data.ConsoleStreamMeta
import com.yacacode.minecraft.data.GDriveProgress
import com.yacacode.minecraft.data.GDriveStatusResponse
import com.yacacode.minecraft.data.LocalBackupItem
import com.yacacode.minecraft.data.OverviewResponse
import com.yacacode.minecraft.data.PlayersResponse
import com.yacacode.minecraft.data.SecureStore
import com.yacacode.minecraft.data.UpdateUiState
import com.yacacode.minecraft.data.YacaCodeApiClient
import com.yacacode.minecraft.data.isCancellation
import com.yacacode.minecraft.ui.theme.AppearanceMode
import com.yacacode.minecraft.ui.theme.Formatters
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.sse.EventSource
import java.io.File

enum class AppTab(val index: Int, val label: String) {
    OVERVIEW(0, "Início"),
    AI(1, "Gemini IA"),
    TERMINAL(2, "Terminal"),
    PLAYERS(3, "Jogadores"),
    MANAGE(4, "Gerenciar")
}

enum class ToastKind { OK, WARN, ERROR }

data class ToastEvent(
    val id: Long = System.nanoTime(),
    val message: String,
    val kind: ToastKind = ToastKind.OK
)

enum class TerminalConnState(val label: String) {
    CONNECTING("Conectando…"),
    CONNECTED("Conectado"),
    RECONNECTING("Reconectando…"),
    DISCONNECTED("Desconectado"),
    ERROR("Erro")
}

data class AppUiState(
    val isBootstrapping: Boolean = true,
    val isAuthenticated: Boolean = false,
    val isBiometricLocked: Boolean = false,
    val session: AuthMeResponse? = null,
    val selectedTab: AppTab = AppTab.OVERVIEW,
    val onlinePlayersCount: Int = 0,
    val serverUrl: String = YacaCodeApiClient.DEFAULT_PROD_URL,
    val appearanceMode: AppearanceMode = AppearanceMode.SYSTEM,
    val biometricAvailable: Boolean = false,
    val biometricLoginEnabled: Boolean = true,
    val biometricAppLockEnabled: Boolean = false,
    val hasSavedCredentials: Boolean = false,
    val savedUsername: String? = null,
    val toast: ToastEvent? = null,

    // Persistent tab caches (zero data loss & zero reload flicker on tab switch!)
    val overview: OverviewResponse? = null,
    val overviewRefreshing: Boolean = false,
    val players: PlayersResponse? = null,
    val playersRefreshing: Boolean = false,
    val aiStatus: AiStatusResponse? = null,
    val aiConversations: List<AiConversationSummary> = emptyList(),
    val activeAiConversationId: String? = null,
    val aiSyncConnected: Boolean = false,
    val aiMessages: List<AiChatMessage> = emptyList(),
    val aiSending: Boolean = false,
    val terminalLines: List<ConsoleLogLine> = emptyList(),
    val terminalContainer: String = "yacacode-mc",
    val terminalConnState: TerminalConnState = TerminalConnState.DISCONNECTED,
    val terminalHistory: List<String> = emptyList(),
    val terminalSending: Boolean = false,
    val gdriveStatus: GDriveStatusResponse? = null,
    val localBackups: List<LocalBackupItem> = emptyList(),
    val backupProgress: GDriveProgress? = null,
    val backupsRefreshing: Boolean = false,
    val updateState: UpdateUiState = UpdateUiState(),
    val showUpdateDialog: Boolean = false
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    val secureStore = SecureStore(application)
    val api = YacaCodeApiClient(secureStore) {
        viewModelScope.launch { handleSessionExpired() }
    }

    private val _uiState = MutableStateFlow(
        AppUiState(
            serverUrl = secureStore.serverUrl,
            appearanceMode = secureStore.appearanceMode,
            biometricAvailable = BiometricHelper.isBiometricAvailable(application),
            biometricLoginEnabled = secureStore.biometricLoginEnabled,
            biometricAppLockEnabled = secureStore.biometricAppLockEnabled,
            hasSavedCredentials = secureStore.hasSavedCredentials(),
            savedUsername = secureStore.savedUsername
        )
    )
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    private var backgroundedAtMs: Long = 0L
    private var toastJob: Job? = null
    private var overviewPollJob: Job? = null
    private var backupPollJob: Job? = null
    private var backupWasActive: Boolean = false
    private var sseSource: EventSource? = null
    private var sseReconnectJob: Job? = null
    private var sseShouldStayConnected: Boolean = false
    private var aiSyncSource: EventSource? = null
    private var aiSyncReconnectJob: Job? = null
    private var aiSyncShouldStayConnected: Boolean = false
    private var updateDownloadJob: Job? = null
    private var didAutoUpdateCheck: Boolean = false

    init {
        bootstrap()
        checkAppUpdates(manual = false)
    }

    fun showToast(message: String, kind: ToastKind = ToastKind.OK) {
        val ev = ToastEvent(message = message, kind = kind)
        _uiState.update { it.copy(toast = ev) }
        toastJob?.cancel()
        toastJob = viewModelScope.launch {
            delay(3400)
            _uiState.update { if (it.toast?.id == ev.id) it.copy(toast = null) else it }
        }
    }

    fun dismissToast() {
        toastJob?.cancel()
        _uiState.update { it.copy(toast = null) }
    }

    fun selectTab(tab: AppTab) {
        _uiState.update { it.copy(selectedTab = tab) }
        when (tab) {
            AppTab.OVERVIEW -> refreshOverview(silent = _uiState.value.overview != null)
            AppTab.AI -> {
                refreshAiStatus()
                refreshAiConversations(silent = true)
                ensureAiSyncConnected()
            }
            AppTab.TERMINAL -> ensureTerminalConnected()
            AppTab.PLAYERS -> refreshPlayers(silent = _uiState.value.players != null)
            AppTab.MANAGE -> {}
        }
    }

    fun updateOnlinePlayersCount(count: Int) {
        _uiState.update { it.copy(onlinePlayersCount = count) }
    }

    fun updateServerUrl(url: String) {
        api.updateBaseUrl(url)
        _uiState.update { it.copy(serverUrl = api.baseUrl) }
    }

    fun updateAppearance(mode: AppearanceMode) {
        secureStore.appearanceMode = mode
        _uiState.update { it.copy(appearanceMode = mode) }
    }

    fun setBiometricLoginEnabled(enabled: Boolean) {
        secureStore.biometricLoginEnabled = enabled
        _uiState.update { it.copy(biometricLoginEnabled = enabled) }
    }

    fun setBiometricAppLockEnabled(enabled: Boolean) {
        secureStore.biometricAppLockEnabled = enabled
        _uiState.update { it.copy(biometricAppLockEnabled = enabled) }
    }

    fun clearSavedCredentials() {
        secureStore.clearCredentials()
        secureStore.biometricLoginEnabled = false
        _uiState.update {
            it.copy(
                hasSavedCredentials = false,
                savedUsername = null,
                biometricLoginEnabled = false
            )
        }
        showToast("Credenciais removidas do Android Keystore.", ToastKind.WARN)
    }

    fun unlockBiometricShield() {
        _uiState.update { it.copy(isBiometricLocked = false) }
    }

    fun onAppBackgrounded() {
        backgroundedAtMs = System.currentTimeMillis()
    }

    fun onAppForegrounded() {
        val st = _uiState.value
        if (st.isAuthenticated && st.biometricAppLockEnabled && st.biometricAvailable &&
            backgroundedAtMs > 0L && System.currentTimeMillis() - backgroundedAtMs > 15_000L
        ) {
            _uiState.update { it.copy(isBiometricLocked = true) }
        }
        backgroundedAtMs = 0L

        if (st.isAuthenticated) {
            refreshAiConversations(silent = true)
            ensureAiSyncConnected()
        }

        // Retoma instalação automática se o usuário voltou de Configurações -> Fontes desconhecidas
        val upd = _uiState.value.updateState
        if (upd.needsInstallPermission && !upd.downloadedApkPath.isNullOrBlank()) {
            val ctx = getApplication<Application>()
            if (AppUpdater.canInstallPackages(ctx)) {
                val apkFile = File(upd.downloadedApkPath)
                if (apkFile.exists()) {
                    _uiState.update { it.copy(updateState = it.updateState.copy(needsInstallPermission = false)) }
                    runCatching { AppUpdater.launchInstallApk(ctx, apkFile) }
                }
            }
        }
    }

    fun bootstrap() {
        viewModelScope.launch {
            _uiState.update { it.copy(isBootstrapping = true) }
            try {
                val me = api.authMe()
                val lock = me.authenticated && secureStore.biometricAppLockEnabled && _uiState.value.biometricAvailable
                _uiState.update {
                    it.copy(
                        isBootstrapping = false,
                        isAuthenticated = me.authenticated,
                        isBiometricLocked = lock,
                        session = me
                    )
                }
                if (me.authenticated) {
                    onAuthenticatedStartWork()
                }
            } catch (_: Exception) {
                _uiState.update { it.copy(isBootstrapping = false, isAuthenticated = false) }
            }
        }
    }

    suspend fun login(username: String, password: String, rememberForBiometrics: Boolean): Result<Unit> {
        val cleanUser = username.trim()
        if (cleanUser.isEmpty() || password.isEmpty()) {
            return Result.failure(Exception("Informe usuário e senha."))
        }
        return try {
            api.login(cleanUser, password)
            val me = api.authMe()
            if (!me.authenticated) {
                return Result.failure(Exception("Não foi possível validar a sessão."))
            }
            if (rememberForBiometrics) {
                secureStore.saveCredentials(cleanUser, password)
                secureStore.biometricLoginEnabled = true
            }
            _uiState.update {
                it.copy(
                    isAuthenticated = true,
                    isBiometricLocked = false,
                    session = me,
                    hasSavedCredentials = secureStore.hasSavedCredentials(),
                    savedUsername = secureStore.savedUsername,
                    biometricLoginEnabled = secureStore.biometricLoginEnabled
                )
            }
            onAuthenticatedStartWork()
            Result.success(Unit)
        } catch (e: Exception) {
            if (e.isCancellation()) throw e
            Result.failure(e)
        }
    }

    suspend fun loginWithSavedCredentials(): Result<Unit> {
        val user = secureStore.savedUsername
        val pass = secureStore.savedPassword
        if (user.isNullOrBlank() || pass.isNullOrBlank()) {
            return Result.failure(Exception("Faça login com senha uma vez para ativar a biometria."))
        }
        return login(user, pass, rememberForBiometrics = true)
    }

    fun logout(clearSavedBiometrics: Boolean) {
        stopBackgroundJobs()
        viewModelScope.launch {
            api.logout()
            if (clearSavedBiometrics) {
                secureStore.clearCredentials()
                secureStore.biometricLoginEnabled = false
                secureStore.biometricAppLockEnabled = false
            }
            val me = runCatching { api.authMe() }.getOrNull()
            _uiState.update {
                it.copy(
                    isAuthenticated = false,
                    isBiometricLocked = false,
                    selectedTab = AppTab.OVERVIEW,
                    session = me,
                    overview = null,
                    players = null,
                    aiStatus = null,
                    aiConversations = emptyList(),
                    activeAiConversationId = null,
                    aiSyncConnected = false,
                    aiMessages = emptyList(),
                    terminalLines = emptyList(),
                    terminalConnState = TerminalConnState.DISCONNECTED,
                    gdriveStatus = null,
                    localBackups = emptyList(),
                    backupProgress = null,
                    hasSavedCredentials = secureStore.hasSavedCredentials(),
                    savedUsername = secureStore.savedUsername,
                    biometricLoginEnabled = secureStore.biometricLoginEnabled,
                    biometricAppLockEnabled = secureStore.biometricAppLockEnabled
                )
            }
        }
    }

    private fun handleSessionExpired() {
        if (!_uiState.value.isAuthenticated) return
        stopBackgroundJobs()
        api.clearSession()
        _uiState.update {
            it.copy(isAuthenticated = false, isBiometricLocked = false)
        }
        showToast("Sessão expirada. Entre novamente.", ToastKind.WARN)
    }

    private fun onAuthenticatedStartWork() {
        refreshOverview(silent = false)
        refreshAiStatus()
        refreshAiConversations(silent = true)
        ensureAiSyncConnected()
        startOverviewPolling()
    }

    private fun stopBackgroundJobs() {
        overviewPollJob?.cancel()
        overviewPollJob = null
        backupPollJob?.cancel()
        backupPollJob = null
        disconnectTerminal()
        disconnectAiSync()
    }

    // --- Overview ---

    private fun startOverviewPolling() {
        overviewPollJob?.cancel()
        overviewPollJob = viewModelScope.launch {
            while (isActive) {
                delay(10_000)
                val st = _uiState.value
                if (st.isAuthenticated && !st.isBiometricLocked && st.selectedTab == AppTab.OVERVIEW) {
                    refreshOverview(silent = true)
                }
            }
        }
    }

    fun refreshOverview(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.update { it.copy(overviewRefreshing = true) }
            try {
                val res = api.overview()
                _uiState.update {
                    it.copy(
                        overview = res,
                        onlinePlayersCount = res.server.players.online,
                        overviewRefreshing = false
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(overviewRefreshing = false) }
                if (e.isCancellation()) return@launch
                if (!silent && _uiState.value.overview == null) {
                    showToast("Não foi possível atualizar a visão geral.", ToastKind.WARN)
                }
            }
        }
    }

    // --- Players ---

    fun refreshPlayers(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.update { it.copy(playersRefreshing = true) }
            try {
                val res = api.players()
                _uiState.update {
                    it.copy(
                        players = res,
                        onlinePlayersCount = res.online.size,
                        playersRefreshing = false
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(playersRefreshing = false) }
                if (e.isCancellation()) return@launch
                if (!silent && _uiState.value.players == null) {
                    showToast("Não foi possível carregar jogadores.", ToastKind.WARN)
                }
            }
        }
    }

    // --- Gemini AI (Persistent Per-User Synced Conversations) ---

    fun refreshAiStatus() {
        viewModelScope.launch {
            try {
                val st = api.aiStatus()
                _uiState.update { it.copy(aiStatus = st) }
            } catch (_: Exception) {
                // silent
            }
        }
    }

    fun refreshAiConversations(silent: Boolean = true) {
        viewModelScope.launch {
            try {
                val data = api.aiConversations()
                val cur = _uiState.value
                val targetId = cur.activeAiConversationId
                    ?.takeIf { id -> data.conversations.any { it.id == id } }
                    ?: data.activeConversationId

                if (!cur.aiSending) {
                    val msgs = when {
                        targetId == null -> emptyList()
                        data.activeConversation?.id == targetId -> data.activeConversation.messages.map { it.toChatMessage() }
                        else -> runCatching { api.aiConversation(targetId, select = false).conversation.messages.map { it.toChatMessage() } }
                            .getOrDefault(cur.aiMessages)
                    }
                    _uiState.update {
                        it.copy(
                            aiConversations = data.conversations,
                            activeAiConversationId = targetId,
                            aiMessages = msgs
                        )
                    }
                } else {
                    _uiState.update { it.copy(aiConversations = data.conversations) }
                }
            } catch (e: Exception) {
                if (!silent && !e.isCancellation()) {
                    showToast("Não foi possível sincronizar conversas.", ToastKind.WARN)
                }
            }
        }
    }

    fun selectAiConversation(conversationId: String) {
        if (_uiState.value.aiSending) return
        viewModelScope.launch {
            try {
                val res = api.aiConversation(conversationId, select = true)
                _uiState.update {
                    it.copy(
                        activeAiConversationId = res.conversation.id,
                        aiMessages = res.conversation.messages.map { m -> m.toChatMessage() }
                    )
                }
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao abrir conversa.", ToastKind.ERROR)
            }
        }
    }

    fun startNewAiConversation() {
        if (_uiState.value.aiSending) return
        viewModelScope.launch {
            try {
                val res = api.aiCreateConversation()
                _uiState.update {
                    it.copy(
                        aiConversations = res.conversations,
                        activeAiConversationId = res.conversation?.id ?: res.activeConversationId,
                        aiMessages = emptyList()
                    )
                }
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao criar conversa.", ToastKind.ERROR)
            }
        }
    }

    fun deleteAiConversation(conversationId: String) {
        if (_uiState.value.aiSending) return
        viewModelScope.launch {
            try {
                val res = api.aiDeleteConversation(conversationId)
                _uiState.update {
                    it.copy(
                        aiConversations = res.conversations,
                        activeAiConversationId = res.activeConversationId,
                        aiMessages = res.activeConversation?.messages?.map { m -> m.toChatMessage() } ?: emptyList()
                    )
                }
                showToast("Conversa excluída.")
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao excluir conversa.", ToastKind.ERROR)
            }
        }
    }

    fun clearAiChat() {
        startNewAiConversation()
    }

    fun ensureAiSyncConnected() {
        if (!_uiState.value.isAuthenticated) return
        if (aiSyncSource != null && aiSyncShouldStayConnected) return
        aiSyncShouldStayConnected = true
        aiSyncReconnectJob?.cancel()
        openAiSyncEventSource()
    }

    private fun openAiSyncEventSource() {
        if (!aiSyncShouldStayConnected || !_uiState.value.isAuthenticated) return
        aiSyncSource?.cancel()
        aiSyncSource = api.openAiSyncStream(
            onConnected = {
                _uiState.update { it.copy(aiSyncConnected = true) }
            },
            onSync = { _ ->
                if (!_uiState.value.aiSending) {
                    refreshAiConversations(silent = true)
                }
            },
            onFailure = {
                _uiState.update { it.copy(aiSyncConnected = false) }
                if (!aiSyncShouldStayConnected || !_uiState.value.isAuthenticated) return@openAiSyncStream
                aiSyncReconnectJob?.cancel()
                aiSyncReconnectJob = viewModelScope.launch {
                    delay(4000)
                    if (aiSyncShouldStayConnected && _uiState.value.isAuthenticated) {
                        openAiSyncEventSource()
                    }
                }
            }
        )
    }

    private fun disconnectAiSync() {
        aiSyncShouldStayConnected = false
        aiSyncReconnectJob?.cancel()
        aiSyncReconnectJob = null
        aiSyncSource?.cancel()
        aiSyncSource = null
        _uiState.update { it.copy(aiSyncConnected = false) }
    }

    fun sendAiPrompt(raw: String) {
        val text = raw.trim()
        val st = _uiState.value
        if (text.isEmpty() || st.aiSending) return
        if (st.aiStatus != null && !st.aiStatus.configured) {
            showToast("Configure a Gemini API Key primeiro.", ToastKind.WARN)
            return
        }
        val history = st.aiMessages.takeLast(14).map { AiHistoryItem(it.role, it.text) }
        val targetConvId = st.activeAiConversationId
        _uiState.update {
            it.copy(
                aiMessages = it.aiMessages + AiChatMessage(role = "user", text = text, time = Formatters.nowHHMM()),
                aiSending = true
            )
        }
        viewModelScope.launch {
            try {
                val res = api.aiChat(text, history, conversationId = targetConvId)
                val persistedModelMsg = res.assistantMessage?.toChatMessage() ?: AiChatMessage(
                    role = "model",
                    text = res.reply,
                    model = res.model ?: _uiState.value.aiStatus?.model,
                    actions = res.actions,
                    pendingActions = res.pendingActions,
                    time = Formatters.nowHHMM()
                )
                _uiState.update { cur ->
                    cur.copy(
                        activeAiConversationId = res.conversationId ?: cur.activeAiConversationId,
                        aiMessages = cur.aiMessages + persistedModelMsg,
                        aiSending = false
                    )
                }
                refreshAiConversations(silent = true)
            } catch (e: Exception) {
                if (e.isCancellation()) {
                    _uiState.update { it.copy(aiSending = false) }
                    return@launch
                }
                val errMsg = e.localizedMessage ?: "Falha na IA Gemini."
                _uiState.update { cur ->
                    cur.copy(
                        aiMessages = cur.aiMessages + AiChatMessage(
                            role = "model",
                            text = "Não consegui concluir: $errMsg",
                            model = cur.aiStatus?.model,
                            actions = listOf(AiActionLog(label = "Erro na solicitação", status = "error", output = errMsg)),
                            time = Formatters.nowHHMM()
                        ),
                        aiSending = false
                    )
                }
                showToast(errMsg, ToastKind.ERROR)
            }
        }
    }

    // --- Android OTA Auto-Updater (GitHub Releases) ---

    fun checkAppUpdates(manual: Boolean = false) {
        if (!manual && didAutoUpdateCheck) return
        if (_uiState.value.updateState.checking || _uiState.value.updateState.downloading) return
        didAutoUpdateCheck = true
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    updateState = it.updateState.copy(
                        checking = true,
                        error = null,
                        upToDateMessage = null
                    )
                )
            }
            try {
                val info = AppUpdater.checkForUpdates()
                if (info != null) {
                    _uiState.update {
                        it.copy(
                            updateState = it.updateState.copy(
                                checking = false,
                                availableUpdate = info,
                                upToDateMessage = null,
                                error = null
                            ),
                            showUpdateDialog = true
                        )
                    }
                    if (manual) showToast("Nova versão v${info.versionName} disponível!")
                } else {
                    _uiState.update {
                        it.copy(
                            updateState = it.updateState.copy(
                                checking = false,
                                availableUpdate = null,
                                upToDateMessage = "Você já está na versão mais recente (v${BuildConfig.VERSION_NAME}).",
                                error = null
                            )
                        )
                    }
                    if (manual) showToast("App já está atualizado (v${BuildConfig.VERSION_NAME})!")
                }
            } catch (e: Exception) {
                if (e.isCancellation()) {
                    _uiState.update { it.copy(updateState = it.updateState.copy(checking = false)) }
                    return@launch
                }
                val err = e.localizedMessage ?: "Não foi possível consultar o GitHub."
                _uiState.update {
                    it.copy(
                        updateState = it.updateState.copy(
                            checking = false,
                            error = if (manual) err else null
                        )
                    )
                }
                if (manual) showToast("Erro ao verificar atualização: $err", ToastKind.WARN)
            }
        }
    }

    fun openUpdateDialog() {
        if (_uiState.value.updateState.availableUpdate != null) {
            _uiState.update { it.copy(showUpdateDialog = true) }
        }
    }

    fun dismissUpdateDialog() {
        if (!_uiState.value.updateState.downloading) {
            _uiState.update { it.copy(showUpdateDialog = false) }
        }
    }

    fun startUpdateDownload() {
        val info = _uiState.value.updateState.availableUpdate ?: return
        if (_uiState.value.updateState.downloading) return
        val ctx = getApplication<Application>()

        updateDownloadJob?.cancel()
        updateDownloadJob = viewModelScope.launch {
            _uiState.update {
                it.copy(
                    updateState = it.updateState.copy(
                        downloading = true,
                        downloadPercent = 0,
                        downloadedBytes = 0L,
                        totalBytes = info.sizeBytes,
                        error = null,
                        needsInstallPermission = false
                    )
                )
            }
            try {
                val apkFile = AppUpdater.downloadApk(ctx, info) { dl, total, pct ->
                    _uiState.update {
                        it.copy(
                            updateState = it.updateState.copy(
                                downloadedBytes = dl,
                                totalBytes = total,
                                downloadPercent = pct
                            )
                        )
                    }
                }
                if (!AppUpdater.canInstallPackages(ctx)) {
                    _uiState.update {
                        it.copy(
                            updateState = it.updateState.copy(
                                downloading = false,
                                downloadPercent = 100,
                                downloadedApkPath = apkFile.absolutePath,
                                needsInstallPermission = true
                            )
                        )
                    }
                    showToast("Permita instalar atualizações do YacaCode nas configurações.", ToastKind.WARN)
                } else {
                    _uiState.update {
                        it.copy(
                            updateState = it.updateState.copy(
                                downloading = false,
                                downloadPercent = 100,
                                downloadedApkPath = apkFile.absolutePath,
                                needsInstallPermission = false
                            ),
                            showUpdateDialog = false
                        )
                    }
                    AppUpdater.launchInstallApk(ctx, apkFile)
                }
            } catch (e: Exception) {
                if (e.isCancellation()) return@launch
                val msg = e.localizedMessage ?: "Falha no download da atualização."
                _uiState.update {
                    it.copy(
                        updateState = it.updateState.copy(
                            downloading = false,
                            error = msg
                        )
                    )
                }
                showToast(msg, ToastKind.ERROR)
            }
        }
    }

    fun openInstallPermissionSettings() {
        AppUpdater.openUnknownSourcesSettings(getApplication())
    }

    fun installDownloadedApkIfReady() {
        val path = _uiState.value.updateState.downloadedApkPath ?: return
        val ctx = getApplication<Application>()
        val file = File(path)
        if (!file.exists()) {
            startUpdateDownload()
            return
        }
        if (!AppUpdater.canInstallPackages(ctx)) {
            _uiState.update { it.copy(updateState = it.updateState.copy(needsInstallPermission = true)) }
            AppUpdater.openUnknownSourcesSettings(ctx)
        } else {
            _uiState.update { it.copy(showUpdateDialog = false, updateState = it.updateState.copy(needsInstallPermission = false)) }
            AppUpdater.launchInstallApk(ctx, file)
        }
    }

    fun resolveAiPending(messageId: String, actionId: String, decision: String) {
        viewModelScope.launch {
            try {
                val res = api.aiConfirm(actionId, decision)
                _uiState.update { cur ->
                    cur.copy(aiMessages = cur.aiMessages.map { m ->
                        if (m.id != messageId) m
                        else m.copy(pendingActions = m.pendingActions.map { p ->
                            if (p.id != actionId) p
                            else p.copy(resolution = res.status, resolvedOutput = res.output ?: res.summary)
                        })
                    })
                }
                showToast(res.summary ?: "Ação processada.", if (res.status == "executed") ToastKind.OK else ToastKind.WARN)
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao confirmar ação.", ToastKind.ERROR)
            }
        }
    }

    fun saveAiConfig(apiKey: String?, model: String, inGame: Boolean, onDone: () -> Unit) {
        viewModelScope.launch {
            try {
                val updated = api.updateAiConfig(apiKey, model, inGame)
                _uiState.update { it.copy(aiStatus = updated) }
                showToast("Configuração da IA Gemini salva!")
                onDone()
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao salvar IA.", ToastKind.ERROR)
            }
        }
    }

    // --- Persistent Termius Terminal SSE ---

    fun ensureTerminalConnected() {
        if (_uiState.value.session?.isModeratorOrAbove != true) return
        if (sseSource != null && sseShouldStayConnected) return
        reconnectTerminal()
    }

    fun reconnectTerminal() {
        if (_uiState.value.session?.isModeratorOrAbove != true) return
        sseShouldStayConnected = true
        sseReconnectJob?.cancel()
        sseSource?.cancel()
        _uiState.update { it.copy(terminalConnState = TerminalConnState.CONNECTING) }
        openTerminalEventSource()
    }

    private fun openTerminalEventSource() {
        if (!sseShouldStayConnected) return
        sseSource = api.openConsoleStream(
            tail = 220,
            onEvent = { event, data ->
                when (event) {
                    "meta" -> {
                        runCatching { YacaCodeApiClient.json.decodeFromString<ConsoleStreamMeta>(data) }
                            .onSuccess { meta ->
                                if (meta.connected == true) {
                                    _uiState.update {
                                        it.copy(
                                            terminalConnState = TerminalConnState.CONNECTED,
                                            terminalContainer = meta.container ?: it.terminalContainer
                                        )
                                    }
                                }
                                meta.error?.let { err ->
                                    _uiState.update { it.copy(terminalConnState = TerminalConnState.ERROR) }
                                    appendTerminalLine("[Painel] $err", ConsoleLogKind.ERROR)
                                }
                            }
                    }
                    "log" -> {
                        runCatching { YacaCodeApiClient.json.decodeFromString<ConsoleStreamLog>(data) }
                            .onSuccess { log -> appendTerminalLine(log.line) }
                    }
                }
            },
            onFailure = { _ ->
                if (!sseShouldStayConnected) return@openConsoleStream
                _uiState.update { it.copy(terminalConnState = TerminalConnState.RECONNECTING) }
                sseReconnectJob?.cancel()
                sseReconnectJob = viewModelScope.launch {
                    delay(3000)
                    if (sseShouldStayConnected && _uiState.value.isAuthenticated) {
                        openTerminalEventSource()
                    }
                }
            },
            onClosed = {
                if (!sseShouldStayConnected) return@openConsoleStream
                _uiState.update { it.copy(terminalConnState = TerminalConnState.DISCONNECTED) }
            }
        )
    }

    fun disconnectTerminal() {
        sseShouldStayConnected = false
        sseReconnectJob?.cancel()
        sseReconnectJob = null
        sseSource?.cancel()
        sseSource = null
    }

    fun clearTerminal() {
        _uiState.update { it.copy(terminalLines = emptyList()) }
    }

    fun appendTerminalLine(text: String, forcedKind: ConsoleLogKind? = null) {
        val entry = ConsoleLogLine(text = text, kind = forcedKind ?: ConsoleLogLine.classify(text))
        _uiState.update { cur ->
            val next = cur.terminalLines + entry
            cur.copy(terminalLines = if (next.size > 1200) next.takeLast(1200) else next)
        }
    }

    fun sendTerminalCommand(raw: String) {
        val clean = raw.trim()
        if (clean.isEmpty() || _uiState.value.terminalSending) return
        _uiState.update { cur ->
            cur.copy(
                terminalHistory = (listOf(clean) + cur.terminalHistory).take(50),
                terminalSending = true
            )
        }
        appendTerminalLine("❯ $clean", ConsoleLogKind.COMMAND)
        viewModelScope.launch {
            try {
                val res = api.runConsoleCommand(clean)
                res.output?.takeIf { it.isNotBlank() }?.split("\n")?.forEach { l ->
                    if (l.isNotEmpty()) appendTerminalLine(l, ConsoleLogKind.SYSTEM)
                }
            } catch (e: Exception) {
                if (!e.isCancellation()) {
                    val msg = e.localizedMessage ?: "Erro RCON"
                    appendTerminalLine("[Erro RCON] $msg", ConsoleLogKind.ERROR)
                    showToast(msg, ToastKind.ERROR)
                }
            } finally {
                _uiState.update { it.copy(terminalSending = false) }
            }
        }
    }

    // --- Backups (Persistent Progress Polling) ---

    fun refreshBackups(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) _uiState.update { it.copy(backupsRefreshing = true) }
            try {
                val gd = api.gdriveStatus(includeFiles = true)
                val local = runCatching { api.localBackups().backups }.getOrDefault(_uiState.value.localBackups)
                _uiState.update {
                    it.copy(
                        gdriveStatus = gd,
                        localBackups = local,
                        backupProgress = gd.progress,
                        backupsRefreshing = false
                    )
                }
                if (gd.progress?.active == true) {
                    backupWasActive = true
                    startBackupProgressPolling()
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(backupsRefreshing = false) }
                if (e.isCancellation()) return@launch
                if (!silent && _uiState.value.gdriveStatus == null) {
                    showToast("Não foi possível consultar o Google Drive.", ToastKind.WARN)
                }
            }
        }
    }

    fun triggerBackupNow() {
        viewModelScope.launch {
            try {
                val res = api.triggerBackupNow()
                res.progress?.let { p ->
                    backupWasActive = true
                    _uiState.update { it.copy(backupProgress = p) }
                    startBackupProgressPolling()
                }
                showToast(res.output ?: "Backup iniciado no Google Drive!")
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao iniciar backup.", ToastKind.ERROR)
            }
        }
    }

    fun syncLocalBackupToDrive(fileName: String) {
        viewModelScope.launch {
            try {
                val res = api.syncBackupToGDrive(fileName)
                res.progress?.let { p ->
                    backupWasActive = true
                    _uiState.update { it.copy(backupProgress = p) }
                    startBackupProgressPolling()
                }
                showToast(res.output ?: "Envio iniciado!")
            } catch (e: Exception) {
                if (!e.isCancellation()) showToast(e.localizedMessage ?: "Erro ao enviar backup.", ToastKind.ERROR)
            }
        }
    }

    private fun startBackupProgressPolling() {
        if (backupPollJob?.isActive == true) return
        backupPollJob = viewModelScope.launch {
            while (isActive) {
                delay(1200)
                val gd = runCatching { api.gdriveStatus(includeFiles = false) }.getOrNull() ?: continue
                _uiState.update { it.copy(backupProgress = gd.progress) }
                if (gd.progress?.active != true) {
                    if (backupWasActive) {
                        backupWasActive = false
                        if (gd.progress?.stage == "done") {
                            showToast(gd.progress.message ?: "Backup concluído no Google Drive!")
                            refreshBackups(silent = true)
                        } else if (gd.progress?.stage == "error") {
                            showToast(gd.progress.error ?: "Falha no backup.", ToastKind.ERROR)
                        }
                    }
                    break
                }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        stopBackgroundJobs()
    }
}
