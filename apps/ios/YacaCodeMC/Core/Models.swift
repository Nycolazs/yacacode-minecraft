import Foundation

// MARK: - Auth & Branding

struct AuthMeResponse: Codable {
    let authenticated: Bool
    let username: String?
    let displayName: String?
    let role: String?
    let isOwner: Bool?
    let expiresAt: Double?
    let cfEmail: String?
    let viaCloudflare: Bool?
    let cfAccessEnabled: Bool?
    let brand: BrandInfo?

    var isAdmin: Bool { role == "admin" }
    var isModeratorOrAbove: Bool { role == "admin" || role == "moderator" }
}

struct BrandInfo: Codable {
    let name: String
    let mcVersion: String
    let mcDomain: String
    let panelDomain: String
    let javaPort: Int
    let bedrockPort: Int
}

struct LoginResponse: Codable {
    let ok: Bool?
    let username: String?
    let error: String?
}

struct GenericOkResponse: Codable {
    let ok: Bool?
    let output: String?
    let error: String?
    let message: String?
}

struct ApiErrorPayload: Codable {
    let error: String?
    let message: String?
}

// MARK: - Overview & Telemetry

struct OverviewResponse: Codable {
    let server: ServerOverview
    let connection: ConnectionOverview
    let host: HostOverview
    let stack: [StackService]
    let network: NetworkSnapshot?
    let history: [TelemetryPoint]
    let dockerAvailable: Bool?
}

struct ServerOverview: Codable {
    let name: String
    let configuredVersion: String
    let runningVersion: String
    let container: ContainerInfo?
    let stats: ContainerStats?
    let ping: McPingInfo?
    let tps: TpsInfo?
    let players: PlayersOverview
    let crossplay: CrossplayInfo?
    let backupCount: Int?
    let latestBackup: LocalBackupItem?
}

struct ContainerInfo: Codable {
    let exists: Bool?
    let id: String?
    let name: String?
    let image: String?
    let tty: Bool?
    let state: String?
    let running: Bool?
    let restarting: Bool?
    let startedAt: String?
    let finishedAt: String?
    let restartCount: Int?
    let health: String?
    let memLimitBytes: Int64?
}

struct ContainerStats: Codable {
    let cpuPercent: Double
    let cpuCoresUsed: Double?
    let onlineCpus: Int?
    let memUsedBytes: Int64
    let memLimitBytes: Int64
    let memPercent: Double
    let rxBytes: Int64?
    let txBytes: Int64?
}

struct McPingInfo: Codable {
    let online: Bool
    let latencyMs: Int?
    let version: String?
    let motd: String?
}

struct TpsInfo: Codable {
    let tps1m: Double
    let tps5m: Double
    let tps15m: Double
    let raw: String?
}

struct PlayersOverview: Codable {
    let online: Int
    let max: Int
    let list: [OnlinePlayer]
    let javaCount: Int
    let bedrockCount: Int
}

struct OnlinePlayer: Codable, Identifiable, Hashable {
    var id: String { name }
    let name: String
    let edition: String?

    var isBedrock: Bool {
        edition?.lowercased() == "bedrock" || name.hasPrefix(".")
    }
}

struct CrossplayInfo: Codable {
    let geyserInstalled: Bool?
    let floodgateInstalled: Bool?
    let geyserConfigured: Bool?
}

struct ConnectionOverview: Codable {
    let mcDomain: String
    let panelDomain: String
    let javaPort: Int
    let bedrockPort: Int
    let viaCloudflare: Bool?
    let cfEmail: String?
}

struct HostOverview: Codable {
    let arch: String
    let platform: String?
    let hostname: String?
    let cpuCores: Int
    let cpuModel: String?
    let loadAvg: [Double]
    let uptimeSeconds: Int?
    let memory: HostMemory
    let temperature: HostTemperature?
    let disk: HostDisk?
}

struct HostMemory: Codable {
    let totalBytes: Int64
    let usedBytes: Int64
    let availableBytes: Int64?
    let percent: Double
    let swapTotalBytes: Int64?
    let swapUsedBytes: Int64?
    let swapPercent: Double?
}

struct HostTemperature: Codable {
    let celsius: Double?
    let status: String?
    let sensors: [ThermalSensor]?
}

struct ThermalSensor: Codable, Identifiable {
    var id: String { name }
    let name: String
    let celsius: Double
}

struct HostDisk: Codable {
    let totalBytes: Int64
    let usedBytes: Int64
    let freeBytes: Int64
    let percent: Double
}

struct StackService: Codable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let container: String
    let exists: Bool
    let running: Bool
    let state: String?
    let health: String?
    let startedAt: String?
    let restartCount: Int?
}

struct TelemetryPoint: Codable, Identifiable {
    var id: Double { ts }
    let ts: Double
    let hostMemPercent: Double?
    let mcMemMB: Double
    let mcCpuPercent: Double
    let tempC: Double?
}

// MARK: - AI Assistant (Gemini)

struct AIStatusResponse: Codable {
    let configured: Bool
    let model: String
    let source: String?
    let inGameChatEnabled: Bool?
    let updatedAt: String?
    let maskedKey: String?
    let availableModels: [AIModelOption]?
    let permissions: AIPermissions?
    let inGameChat: InGameChatStats?
}

struct AIModelOption: Codable, Identifiable, Hashable {
    let id: String
    let label: String
}

struct AIPermissions: Codable {
    let canRead: Bool?
    let canRunCommands: Bool?
    let canAdminCommands: Bool?
    let canConfigure: Bool?
}

struct InGameChatStats: Codable {
    let connected: Bool?
    let totalAnswered: Int?
    let lastPlayer: String?
    let lastQuestionAt: String?
    let lastError: String?
    let triggers: [String]?
}

struct AIChatHistoryItem: Codable {
    let role: String
    let text: String
}

struct AIChatResponse: Codable {
    let ok: Bool?
    let reply: String
    let model: String?
    let actions: [AIActionLog]?
    let pendingActions: [AIPendingAction]?
    let conversationId: String?
    let conversationTitle: String?
    let userMessage: AIPersistedMessage?
    let assistantMessage: AIPersistedMessage?
}

struct AIPersistedMessage: Codable, Identifiable {
    let id: String
    let role: String
    let text: String
    let model: String?
    let actions: [AIActionLog]?
    let pendingActions: [AIPendingAction]?
    let time: String?
    let createdAt: String?

    func toChatMessage() -> AIChatMessage {
        AIChatMessage(
            id: id.isEmpty ? UUID().uuidString : id,
            role: role,
            text: text,
            model: model,
            actions: actions ?? [],
            pendingActions: pendingActions ?? [],
            time: time ?? ""
        )
    }
}

struct AIConversationSummary: Codable, Identifiable {
    let id: String
    let title: String
    let createdAt: String?
    let updatedAt: String?
    let messageCount: Int?
    let preview: String?
}

struct AIConversationDetail: Codable, Identifiable {
    let id: String
    let title: String
    let createdAt: String?
    let updatedAt: String?
    let messages: [AIPersistedMessage]?
}

struct AIConversationsResponse: Codable {
    let conversations: [AIConversationSummary]
    let activeConversationId: String?
    let activeConversation: AIConversationDetail?
}

struct AIConversationCreateResponse: Codable {
    let conversation: AIConversationDetail?
    let conversations: [AIConversationSummary]
    let activeConversationId: String?
}

struct AIConversationDetailResponse: Codable {
    let conversation: AIConversationDetail
}

struct AIConversationDeleteResponse: Codable {
    let ok: Bool?
    let conversations: [AIConversationSummary]
    let activeConversationId: String?
    let activeConversation: AIConversationDetail?
}

struct AIActionLog: Codable, Identifiable {
    var id: String { "\(tool ?? "")-\(label)-\(status)-\(output ?? "")" }
    let tool: String?
    let command: String?
    let label: String
    let status: String
    let output: String?
}

struct AIPendingAction: Codable, Identifiable {
    let id: String
    let kind: String?
    let command: String?
    let powerAction: String?
    let label: String
    let reason: String?
    let expiresAt: Double?

    var resolution: String? = nil
    var resolvedOutput: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, kind, command, powerAction, label, reason, expiresAt, resolution, resolvedOutput
    }
}

struct AIConfirmResponse: Codable {
    let ok: Bool?
    let status: String
    let label: String?
    let output: String?
    let summary: String?
}

struct AIChatMessage: Identifiable {
    var id: String = UUID().uuidString
    let role: String // "user" | "model"
    let text: String
    let model: String?
    var actions: [AIActionLog]
    var pendingActions: [AIPendingAction]
    let time: String
}

// MARK: - Console & SSE

struct ConsoleCommandResponse: Codable {
    let ok: Bool?
    let command: String?
    let output: String?
}

struct ConsoleStreamMeta: Codable {
    let connected: Bool?
    let container: String?
    let ended: Bool?
    let error: String?
}

struct ConsoleStreamLog: Codable {
    let line: String
    let ts: Double?
}

enum ConsoleLogKind: Equatable {
    case normal
    case info
    case warn
    case error
    case chat
    case geyser
    case command
    case system
}

struct ConsoleLogLine: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let kind: ConsoleLogKind
    let timestamp: Date

    static func classify(_ text: String) -> ConsoleLogKind {
        let lower = text.lowercased()
        if lower.contains("error") || lower.contains("fatal") || lower.contains("exception") || lower.contains("severe") {
            return .error
        }
        if lower.contains("warn") {
            return .warn
        }
        if lower.contains("geyser") || lower.contains("floodgate") || lower.contains("bedrock") || lower.contains("nethernet") {
            return .geyser
        }
        if lower.contains("<chat>") || text.contains("joined the game") || text.contains("left the game") {
            return .chat
        }
        if text.contains(" INFO ") || text.contains("[INFO]") {
            return .info
        }
        return .normal
    }
}

// MARK: - Players

struct PlayersResponse: Codable {
    let online: [OnlinePlayer]
    let max: Int
    let whitelistEnabled: Bool
    let whitelist: [PlayerEntity]
    let ops: [PlayerEntity]
    let bannedPlayers: [PlayerEntity]
    let bannedIps: [PlayerEntity]?
}

struct PlayerEntity: Codable, Identifiable, Hashable {
    var id: String { name }
    let name: String
    let uuid: String?
    let level: Int?
    let reason: String?

    init(name: String, uuid: String? = nil, level: Int? = nil, reason: String? = nil) {
        self.name = name
        self.uuid = uuid
        self.level = level
        self.reason = reason
    }

    init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let str = try? single.decode(String.self) {
            self.name = str
            self.uuid = nil
            self.level = nil
            self.reason = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.name = (try? container.decode(String.self, forKey: .name))
            ?? (try? container.decode(String.self, forKey: .ip))
            ?? "Desconhecido"
        self.uuid = try? container.decode(String.self, forKey: .uuid)
        self.level = try? container.decode(Int.self, forKey: .level)
        self.reason = try? container.decode(String.self, forKey: .reason)
    }

    enum CodingKeys: String, CodingKey {
        case name, ip, uuid, level, reason
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(uuid, forKey: .uuid)
        try container.encodeIfPresent(level, forKey: .level)
        try container.encodeIfPresent(reason, forKey: .reason)
    }
}

struct PlayerActionResponse: Codable {
    let ok: Bool?
    let command: String?
    let output: String?
}

// MARK: - Properties & Presets

struct PropertiesResponse: Codable {
    let exists: Bool
    let engine: String?
    let properties: [String: String]
}

struct PresetsApplyResponse: Codable {
    let ok: Bool?
    let report: [PresetReportItem]
}

struct PresetReportItem: Codable, Identifiable {
    var id: String { "\(preset)-\(file)" }
    let preset: String
    let file: String
    let status: String
    let changes: Int?
    let reason: String?
}

// MARK: - Plugins

struct PluginsResponse: Codable {
    let exists: Bool?
    let plugins: [PluginItem]
    let geyserConfigured: Bool?
    let floodgateInstalled: Bool?
}

struct PluginItem: Codable, Identifiable {
    var id: String { fileName }
    let fileName: String
    let displayName: String
    let enabled: Bool
    let size: Int64
    let mtime: String?
    let isCoreCrossplay: Bool?

    var isNativeModule: Bool {
        fileName.hasSuffix(".native")
    }
}

// MARK: - Files

struct FilesListResponse: Codable {
    let path: String
    let entries: [FileEntry]
}

struct FileEntry: Codable, Identifiable {
    var id: String { path }
    let name: String
    let path: String
    let isDirectory: Bool
    let size: Int64
    let mtime: String?
    let editable: Bool
}

struct FileContentResponse: Codable {
    let path: String
    let size: Int64?
    let mtime: String?
    let content: String
}

// MARK: - Backups & Google Drive

struct BackupsListResponse: Codable {
    let backups: [LocalBackupItem]
    let totalBytes: Int64?
}

struct LocalBackupItem: Codable, Identifiable {
    var id: String { name }
    let name: String
    let size: Int64
    let mtime: String?
}

struct GDriveStatusResponse: Codable {
    let connected: Bool
    let hasCredentials: Bool?
    let enabled: Bool?
    let syncInProgress: Bool?
    let progress: GDriveProgress?
    let accountEmail: String?
    let accountName: String?
    let storageQuota: GDriveQuota?
    let folderName: String?
    let folderId: String?
    let folderUrl: String?
    let scheduleHours: Int?
    let maxBackups: Int?
    let autoUploadOnManual: Bool?
    let skipIfNoActivity: Bool?
    let lastBackupAt: String?
    let lastUploadFile: String?
    let lastUploadSize: Int64?
    let lastUploadStatus: String?
    let lastError: String?
    let nextScheduledAt: String?
    let redirectUri: String?
    let clientId: String?
    let hasClientSecret: Bool?
    let maskedClientSecret: String?
    let canConfigure: Bool?
    let remoteFiles: [GDriveRemoteFile]?
    let remoteListError: String?
}

struct GDriveProgress: Codable {
    let active: Bool
    let stage: String
    let percent: Int
    let message: String?
    let fileName: String?
    let uploadedBytes: Int64?
    let totalBytes: Int64?
    let speedBps: Int64?
    let startedAt: String?
    let finishedAt: String?
    let error: String?
}

struct GDriveQuota: Codable {
    let limitBytes: Int64
    let usageBytes: Int64
    let usageInDriveBytes: Int64?
}

struct GDriveRemoteFile: Codable, Identifiable {
    let id: String
    let name: String
    let size: Int64
    let createdTime: String?
    let webViewLink: String?
}

struct GDriveAuthUrlResponse: Codable {
    let url: String
    let redirectUri: String?
}

struct BackupTriggerResponse: Codable {
    let started: Bool?
    let alreadyRunning: Bool?
    let progress: GDriveProgress?
    let output: String?
}

struct GDriveTestResponse: Codable {
    let ok: Bool?
    let status: GDriveStatusResponse?
}

// MARK: - Network

struct NetworkSnapshot: Codable {
    let checkedAt: Double?
    let publicIp: String?
    let domainIps: [String]?
    let dnsSynced: Bool?
    let error: String?
}

struct NetworkDetailResponse: Codable {
    let network: NetworkSnapshot
    let mcDomain: String
    let panelDomain: String
    let javaPort: Int
    let bedrockPort: Int
    let cloudflared: ContainerInfo?
    let ddns: ContainerInfo?
    let viaCloudflare: Bool?
    let cfEmail: String?
    let cfAccessEnabled: Bool?
}

// MARK: - Users (RBAC)

struct UsersResponse: Codable {
    let users: [PanelUser]
}

struct PanelUser: Codable, Identifiable {
    var id: String { username }
    let username: String
    let displayName: String
    let role: String
    let enabled: Bool
    let isOwner: Bool
    let createdAt: String?
    let lastLoginAt: String?
}
