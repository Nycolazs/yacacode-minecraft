package com.yacacode.minecraft.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.util.UUID

// --- Auth ---

@Serializable
data class AuthMeResponse(
    val authenticated: Boolean = false,
    val username: String? = null,
    val displayName: String? = null,
    val role: String? = null,
    val isOwner: Boolean = false,
    val expiresAt: Long? = null,
    val cfEmail: String? = null,
    val viaCloudflare: Boolean = false,
    val cfAccessEnabled: Boolean = false,
    val brand: BrandInfo? = null
) {
    val isAdmin: Boolean get() = role == "admin"
    val isModeratorOrAbove: Boolean get() = role == "admin" || role == "moderator"
}

@Serializable
data class BrandInfo(
    val name: String = "YacaCode",
    val mcVersion: String = "26.3",
    val mcDomain: String = "mc.yacacode.com",
    val panelDomain: String = "painel.yacacode.com",
    val javaPort: Int = 25565,
    val bedrockPort: Int = 19132
)

@Serializable
data class LoginResponse(
    val ok: Boolean = false,
    val username: String? = null,
    val error: String? = null
)

@Serializable
data class GenericOkResponse(
    val ok: Boolean = false,
    val output: String? = null,
    val error: String? = null,
    val message: String? = null
)

@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val message: String? = null
)

// --- Overview & Telemetry ---

@Serializable
data class OverviewResponse(
    val server: ServerOverview,
    val connection: ConnectionOverview,
    val host: HostOverview,
    val stack: List<StackService> = emptyList(),
    val network: NetworkSnapshot? = null,
    val history: List<TelemetryPoint> = emptyList(),
    val dockerAvailable: Boolean = true
)

@Serializable
data class ServerOverview(
    val name: String = "YacaCode",
    val configuredVersion: String = "26.3",
    val runningVersion: String = "26.3",
    val container: ContainerInfo? = null,
    val stats: ContainerStats? = null,
    val ping: McPingInfo? = null,
    val tps: TpsInfo? = null,
    val players: PlayersOverview = PlayersOverview(),
    val crossplay: CrossplayInfo? = null,
    val backupCount: Int = 0
)

@Serializable
data class ContainerInfo(
    val exists: Boolean = false,
    val id: String? = null,
    val name: String? = null,
    val image: String? = null,
    val tty: Boolean = false,
    val state: String? = null,
    val running: Boolean = false,
    val restarting: Boolean = false,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val restartCount: Int = 0,
    val health: String? = null,
    val memLimitBytes: Long = 0
)

@Serializable
data class ContainerStats(
    val cpuPercent: Double = 0.0,
    val cpuCoresUsed: Double = 0.0,
    val onlineCpus: Int = 4,
    val memUsedBytes: Long = 0,
    val memLimitBytes: Long = 0,
    val memPercent: Double = 0.0,
    val rxBytes: Long = 0,
    val txBytes: Long = 0
)

@Serializable
data class McPingInfo(
    val online: Boolean = false,
    val latencyMs: Int? = null,
    val version: String? = null,
    val motd: String? = null
)

@Serializable
data class TpsInfo(
    val tps1m: Double = 20.0,
    val tps5m: Double = 20.0,
    val tps15m: Double = 20.0,
    val raw: String? = null
)

@Serializable
data class PlayersOverview(
    val online: Int = 0,
    val max: Int = 6,
    val list: List<OnlinePlayer> = emptyList(),
    val javaCount: Int = 0,
    val bedrockCount: Int = 0
)

@Serializable
data class OnlinePlayer(
    val name: String,
    val edition: String? = null
) {
    val isBedrock: Boolean get() = edition.equals("bedrock", ignoreCase = true) || name.startsWith(".")
}

@Serializable
data class CrossplayInfo(
    val geyserInstalled: Boolean = false,
    val floodgateInstalled: Boolean = false,
    val geyserConfigured: Boolean = false
)

@Serializable
data class ConnectionOverview(
    val mcDomain: String = "mc.yacacode.com",
    val panelDomain: String = "painel.yacacode.com",
    val javaPort: Int = 25565,
    val bedrockPort: Int = 19132,
    val viaCloudflare: Boolean = false,
    val cfEmail: String? = null
)

@Serializable
data class HostOverview(
    val arch: String = "arm64",
    val platform: String? = null,
    val hostname: String? = null,
    val cpuCores: Int = 4,
    val cpuModel: String? = null,
    val loadAvg: List<Double> = emptyList(),
    val uptimeSeconds: Long = 0,
    val memory: HostMemory = HostMemory(),
    val temperature: HostTemperature? = null,
    val disk: HostDisk? = null
)

@Serializable
data class HostMemory(
    val totalBytes: Long = 0,
    val usedBytes: Long = 0,
    val availableBytes: Long = 0,
    val percent: Double = 0.0,
    val swapTotalBytes: Long = 0,
    val swapUsedBytes: Long = 0,
    val swapPercent: Double = 0.0
)

@Serializable
data class HostTemperature(
    val celsius: Double? = null,
    val status: String? = null,
    val sensors: List<ThermalSensor> = emptyList()
)

@Serializable
data class ThermalSensor(
    val name: String,
    val celsius: Double
)

@Serializable
data class HostDisk(
    val totalBytes: Long = 0,
    val usedBytes: Long = 0,
    val freeBytes: Long = 0,
    val percent: Double = 0.0
)

@Serializable
data class StackService(
    val key: String,
    val label: String,
    val container: String,
    val exists: Boolean = false,
    val running: Boolean = false,
    val state: String? = null,
    val health: String? = null,
    val startedAt: String? = null,
    val restartCount: Int = 0
)

@Serializable
data class TelemetryPoint(
    val ts: Long,
    val hostMemPercent: Double = 0.0,
    val mcMemMB: Double = 0.0,
    val mcCpuPercent: Double = 0.0,
    val tempC: Double? = null
)

// --- AI Assistant (Gemini) ---

@Serializable
data class AiStatusResponse(
    val configured: Boolean = false,
    val model: String = "gemini-3.5-flash-lite",
    val source: String? = null,
    val inGameChatEnabled: Boolean = true,
    val updatedAt: String? = null,
    val maskedKey: String? = null,
    val availableModels: List<AiModelOption> = emptyList(),
    val permissions: AiPermissions? = null,
    val inGameChat: InGameChatStats? = null
)

@Serializable
data class AiModelOption(
    val id: String,
    val label: String
)

@Serializable
data class AiPermissions(
    val canRead: Boolean = true,
    val canRunCommands: Boolean = false,
    val canAdminCommands: Boolean = false,
    val canConfigure: Boolean = false
)

@Serializable
data class InGameChatStats(
    val connected: Boolean = false,
    val totalAnswered: Int = 0,
    val lastPlayer: String? = null,
    val lastQuestionAt: String? = null,
    val lastError: String? = null,
    val triggers: List<String> = emptyList()
)

@Serializable
data class AiHistoryItem(
    val role: String,
    val text: String
)

@Serializable
data class AiChatRequest(
    val message: String,
    val history: List<AiHistoryItem>,
    val conversationId: String? = null
)

@Serializable
data class AiPersistedMessage(
    val id: String = "",
    val role: String = "model",
    val text: String = "",
    val model: String? = null,
    val actions: List<AiActionLog> = emptyList(),
    val pendingActions: List<AiPendingAction> = emptyList(),
    val time: String = "",
    val createdAt: String? = null
) {
    fun toChatMessage(): AiChatMessage = AiChatMessage(
        id = id.ifBlank { UUID.randomUUID().toString() },
        role = role,
        text = text,
        model = model,
        actions = actions,
        pendingActions = pendingActions,
        time = time
    )
}

@Serializable
data class AiConversationSummary(
    val id: String,
    val title: String = "Nova conversa",
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val messageCount: Int = 0,
    val preview: String = ""
)

@Serializable
data class AiConversationDetail(
    val id: String,
    val title: String = "Nova conversa",
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val messages: List<AiPersistedMessage> = emptyList()
)

@Serializable
data class AiConversationsResponse(
    val conversations: List<AiConversationSummary> = emptyList(),
    val activeConversationId: String? = null,
    val activeConversation: AiConversationDetail? = null
)

@Serializable
data class AiConversationCreateResponse(
    val conversation: AiConversationDetail? = null,
    val conversations: List<AiConversationSummary> = emptyList(),
    val activeConversationId: String? = null
)

@Serializable
data class AiConversationDetailResponse(
    val conversation: AiConversationDetail
)

@Serializable
data class AiConversationDeleteResponse(
    val ok: Boolean = false,
    val conversations: List<AiConversationSummary> = emptyList(),
    val activeConversationId: String? = null,
    val activeConversation: AiConversationDetail? = null
)

@Serializable
data class AiChatResponse(
    val ok: Boolean = false,
    val reply: String = "",
    val model: String? = null,
    val actions: List<AiActionLog> = emptyList(),
    val pendingActions: List<AiPendingAction> = emptyList(),
    val conversationId: String? = null,
    val conversationTitle: String? = null,
    val userMessage: AiPersistedMessage? = null,
    val assistantMessage: AiPersistedMessage? = null
)

@Serializable
data class AiActionLog(
    val tool: String? = null,
    val command: String? = null,
    val label: String = "",
    val status: String = "ok",
    val output: String? = null
)

@Serializable
data class AiPendingAction(
    val id: String,
    val kind: String? = null,
    val command: String? = null,
    val powerAction: String? = null,
    val label: String = "",
    val reason: String? = null,
    val expiresAt: Long? = null,
    val resolution: String? = null,
    val resolvedOutput: String? = null
)

@Serializable
data class AiConfirmResponse(
    val ok: Boolean = false,
    val status: String = "",
    val label: String? = null,
    val output: String? = null,
    val summary: String? = null
)

data class AiChatMessage(
    val id: String = UUID.randomUUID().toString(),
    val role: String,
    val text: String,
    val model: String? = null,
    val actions: List<AiActionLog> = emptyList(),
    val pendingActions: List<AiPendingAction> = emptyList(),
    val time: String
)

// --- Console / Terminal ---

@Serializable
data class ConsoleCommandResponse(
    val ok: Boolean = false,
    val command: String? = null,
    val output: String? = null
)

@Serializable
data class ConsoleStreamMeta(
    val connected: Boolean? = null,
    val container: String? = null,
    val ended: Boolean? = null,
    val error: String? = null
)

@Serializable
data class ConsoleStreamLog(
    val line: String = "",
    val ts: Long? = null
)

enum class ConsoleLogKind {
    NORMAL, INFO, WARN, ERROR, CHAT, GEYSER, COMMAND, SYSTEM
}

data class ConsoleLogLine(
    val id: String = UUID.randomUUID().toString(),
    val text: String,
    val kind: ConsoleLogKind
) {
    companion object {
        fun classify(text: String): ConsoleLogKind {
            val l = text.lowercase()
            return when {
                l.contains("error") || l.contains("fatal") || l.contains("exception") || l.contains("severe") -> ConsoleLogKind.ERROR
                l.contains("warn") -> ConsoleLogKind.WARN
                l.contains("geyser") || l.contains("floodgate") || l.contains("bedrock") || l.contains("nethernet") -> ConsoleLogKind.GEYSER
                l.contains("<chat>") || text.contains("joined the game") || text.contains("left the game") -> ConsoleLogKind.CHAT
                text.contains(" INFO ") || text.contains("[INFO]") -> ConsoleLogKind.INFO
                else -> ConsoleLogKind.NORMAL
            }
        }
    }
}

// --- Players ---

@Serializable
data class PlayersResponse(
    val online: List<OnlinePlayer> = emptyList(),
    val max: Int = 6,
    val whitelistEnabled: Boolean = false,
    val whitelist: List<PlayerEntity> = emptyList(),
    val ops: List<PlayerEntity> = emptyList(),
    val bannedPlayers: List<PlayerEntity> = emptyList(),
    val bannedIps: List<PlayerEntity> = emptyList()
)

@Serializable(with = PlayerEntitySerializer::class)
data class PlayerEntity(
    val name: String,
    val uuid: String? = null,
    val level: Int? = null,
    val reason: String? = null
)

object PlayerEntitySerializer : KSerializer<PlayerEntity> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("PlayerEntity")
    override fun deserialize(decoder: Decoder): PlayerEntity {
        val jsonDecoder = decoder as? JsonDecoder
            ?: return PlayerEntity(name = decoder.decodeString())
        val elem = jsonDecoder.decodeJsonElement()
        return when (elem) {
            is JsonPrimitive -> PlayerEntity(name = elem.content)
            is JsonObject -> PlayerEntity(
                name = (elem["name"] as? JsonPrimitive)?.contentOrNull
                    ?: (elem["ip"] as? JsonPrimitive)?.contentOrNull
                    ?: "Desconhecido",
                uuid = (elem["uuid"] as? JsonPrimitive)?.contentOrNull,
                level = (elem["level"] as? JsonPrimitive)?.intOrNull,
                reason = (elem["reason"] as? JsonPrimitive)?.contentOrNull
            )
            else -> PlayerEntity(name = elem.toString())
        }
    }

    override fun serialize(encoder: Encoder, value: PlayerEntity) {
        encoder.encodeString(value.name)
    }
}

@Serializable
data class PlayerActionResponse(
    val ok: Boolean = false,
    val command: String? = null,
    val output: String? = null
)

// --- Properties & Presets ---

@Serializable
data class PropertiesResponse(
    val exists: Boolean = false,
    val engine: String? = null,
    val properties: Map<String, String> = emptyMap()
)

@Serializable
data class PresetsApplyResponse(
    val ok: Boolean = false,
    val report: List<PresetReportItem> = emptyList()
)

@Serializable
data class PresetReportItem(
    val preset: String = "",
    val file: String = "",
    val status: String = "",
    val changes: Int? = null,
    val reason: String? = null
)

// --- Plugins ---

@Serializable
data class PluginsResponse(
    val exists: Boolean = false,
    val plugins: List<PluginItem> = emptyList(),
    val geyserConfigured: Boolean = false,
    val floodgateInstalled: Boolean = false
)

@Serializable
data class PluginItem(
    val fileName: String,
    val displayName: String,
    val enabled: Boolean = true,
    val size: Long = 0,
    val mtime: String? = null,
    val isCoreCrossplay: Boolean = false
) {
    val isNativeModule: Boolean get() = fileName.endsWith(".native")
}

// --- Files ---

@Serializable
data class FilesListResponse(
    val path: String = "",
    val entries: List<FileEntry> = emptyList()
)

@Serializable
data class FileEntry(
    val name: String,
    val path: String,
    val isDirectory: Boolean = false,
    val size: Long = 0,
    val mtime: String? = null,
    val editable: Boolean = false
)

@Serializable
data class FileContentResponse(
    val path: String = "",
    val size: Long = 0,
    val mtime: String? = null,
    val content: String = ""
)

// --- Backups & Google Drive ---

@Serializable
data class BackupsListResponse(
    val backups: List<LocalBackupItem> = emptyList(),
    val totalBytes: Long = 0
)

@Serializable
data class LocalBackupItem(
    val name: String,
    val size: Long = 0,
    val mtime: String? = null
)

@Serializable
data class GDriveStatusResponse(
    val connected: Boolean = false,
    val hasCredentials: Boolean = false,
    val enabled: Boolean = false,
    val syncInProgress: Boolean = false,
    val progress: GDriveProgress? = null,
    val accountEmail: String? = null,
    val accountName: String? = null,
    val storageQuota: GDriveQuota? = null,
    val folderName: String? = null,
    val folderId: String? = null,
    val folderUrl: String? = null,
    val scheduleHours: Int = 0,
    val maxBackups: Int = 10,
    val autoUploadOnManual: Boolean = true,
    val skipIfNoActivity: Boolean = true,
    val lastBackupAt: String? = null,
    val lastUploadFile: String? = null,
    val lastUploadSize: Long? = null,
    val lastUploadStatus: String? = null,
    val lastError: String? = null,
    val nextScheduledAt: String? = null,
    val redirectUri: String? = null,
    val clientId: String? = null,
    val hasClientSecret: Boolean = false,
    val maskedClientSecret: String? = null,
    val canConfigure: Boolean = false,
    val remoteFiles: List<GDriveRemoteFile>? = null,
    val remoteListError: String? = null
)

@Serializable
data class GDriveProgress(
    val active: Boolean = false,
    val stage: String = "idle",
    val percent: Int = 0,
    val message: String? = null,
    val fileName: String? = null,
    val uploadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val speedBps: Long = 0,
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val error: String? = null
)

@Serializable
data class GDriveQuota(
    val limitBytes: Long = 0,
    val usageBytes: Long = 0,
    val usageInDriveBytes: Long = 0
)

@Serializable
data class GDriveRemoteFile(
    val id: String,
    val name: String,
    val size: Long = 0,
    val createdTime: String? = null,
    val webViewLink: String? = null
)

@Serializable
data class GDriveAuthUrlResponse(
    val url: String = "",
    val redirectUri: String? = null
)

@Serializable
data class BackupTriggerResponse(
    val started: Boolean = false,
    val alreadyRunning: Boolean = false,
    val progress: GDriveProgress? = null,
    val output: String? = null
)

@Serializable
data class GDriveTestResponse(
    val ok: Boolean = false,
    val status: GDriveStatusResponse? = null
)

// --- Network ---

@Serializable
data class NetworkSnapshot(
    val checkedAt: Long? = null,
    val publicIp: String? = null,
    val domainIps: List<String> = emptyList(),
    val dnsSynced: Boolean? = null,
    val error: String? = null
)

@Serializable
data class NetworkDetailResponse(
    val network: NetworkSnapshot = NetworkSnapshot(),
    val mcDomain: String = "mc.yacacode.com",
    val panelDomain: String = "painel.yacacode.com",
    val javaPort: Int = 25565,
    val bedrockPort: Int = 19132,
    val cloudflared: ContainerInfo? = null,
    val ddns: ContainerInfo? = null,
    val viaCloudflare: Boolean = false,
    val cfEmail: String? = null,
    val cfAccessEnabled: Boolean = false
)

// --- Users ---

@Serializable
data class UsersResponse(
    val users: List<PanelUser> = emptyList()
)

@Serializable
data class PanelUser(
    val username: String,
    val displayName: String,
    val role: String = "viewer",
    val enabled: Boolean = true,
    val isOwner: Boolean = false,
    val createdAt: String? = null,
    val lastLoginAt: String? = null
)

// --- Markdown Parser (Pure Kotlin for AI Chat & Tests) ---

sealed class MarkdownBlock {
    data class Heading(val level: Int, val text: String) : MarkdownBlock()
    data class Paragraph(val text: String) : MarkdownBlock()
    data class BulletList(val items: List<String>) : MarkdownBlock()
    data class CodeBlock(val language: String?, val code: String) : MarkdownBlock()
}

object MarkdownParser {
    fun parse(raw: String): List<MarkdownBlock> {
        val lines = raw.replace("\r\n", "\n").split("\n")
        val blocks = mutableListOf<MarkdownBlock>()
        var i = 0
        while (i < lines.size) {
            val trimmed = lines[i].trim()
            if (trimmed.startsWith("```")) {
                val lang = trimmed.removePrefix("```").trim().ifEmpty { null }
                val codeLines = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) {
                    codeLines.add(lines[i])
                    i++
                }
                i++
                blocks.add(MarkdownBlock.CodeBlock(lang, codeLines.joinToString("\n")))
                continue
            }
            if (trimmed.isEmpty()) {
                i++
                continue
            }
            when {
                trimmed.startsWith("### ") -> {
                    blocks.add(MarkdownBlock.Heading(3, trimmed.removePrefix("### ")))
                    i++
                }
                trimmed.startsWith("## ") -> {
                    blocks.add(MarkdownBlock.Heading(2, trimmed.removePrefix("## ")))
                    i++
                }
                trimmed.startsWith("# ") -> {
                    blocks.add(MarkdownBlock.Heading(1, trimmed.removePrefix("# ")))
                    i++
                }
                isBullet(trimmed) -> {
                    val items = mutableListOf<String>()
                    while (i < lines.size && isBullet(lines[i].trim())) {
                        items.add(lines[i].trim().drop(2).trim())
                        i++
                    }
                    blocks.add(MarkdownBlock.BulletList(items))
                }
                else -> {
                    val para = mutableListOf<String>()
                    while (i < lines.size) {
                        val t = lines[i].trim()
                        if (t.isEmpty() || t.startsWith("```") || t.startsWith("# ") || t.startsWith("## ") || t.startsWith("### ") || isBullet(t)) {
                            break
                        }
                        para.add(lines[i])
                        i++
                    }
                    blocks.add(MarkdownBlock.Paragraph(para.joinToString("\n")))
                }
            }
        }
        return blocks
    }

    private fun isBullet(s: String): Boolean =
        s.startsWith("- ") || s.startsWith("* ") || s.startsWith("• ")
}
