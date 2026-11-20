import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case unauthorized(String)
    case serverError(Int, String)
    case decodingError(String)
    case networkError(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Endereço do servidor inválido."
        case .unauthorized(let msg):
            return msg.isEmpty ? "Sessão expirada. Faça login novamente." : msg
        case .serverError(_, let msg):
            return msg
        case .decodingError(let msg):
            return "Erro ao ler resposta do servidor: \(msg)"
        case .networkError(let msg):
            return msg
        }
    }
}

extension Error {
    /// True when the error comes from SwiftUI cancelling a `.task` on tab switch / navigation.
    var isCancellation: Bool {
        if self is CancellationError { return true }
        if let urlErr = self as? URLError, urlErr.code == .cancelled { return true }
        let ns = self as NSError
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return true }
        return false
    }
}

struct SSEEvent: Equatable {
    let event: String
    let data: String
}

/// Pure SSE line parser usable both in production and unit tests.
struct SSELineParser {
    private var currentEvent: String = "message"
    private var dataLines: [String] = []

    mutating func feed(line: String) -> SSEEvent? {
        let trimmed = line.hasSuffix("\r") ? String(line.dropLast()) : line
        if trimmed.isEmpty {
            guard !dataLines.isEmpty else {
                currentEvent = "message"
                return nil
            }
            let ev = SSEEvent(event: currentEvent, data: dataLines.joined(separator: "\n"))
            currentEvent = "message"
            dataLines.removeAll(keepingCapacity: true)
            return ev
        }
        if trimmed.hasPrefix(":") {
            return nil // SSE comment / keepalive
        }
        if trimmed.hasPrefix("event:") {
            currentEvent = String(trimmed.dropFirst(6)).trimmingCharacters(in: .whitespaces)
        } else if trimmed.hasPrefix("data:") {
            var value = String(trimmed.dropFirst(5))
            if value.hasPrefix(" ") { value.removeFirst() }
            dataLines.append(value)
        }
        return nil
    }
}

final class APIClient {
    static let defaultProductionURL = "https://painel.yacacode.com"

    private let session: URLSession
    private let streamSession: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    var baseURLString: String
    var onUnauthorized: (@MainActor () -> Void)?

    init(baseURLString: String = APIClient.defaultProductionURL) {
        self.baseURLString = Self.normalizeBaseURL(baseURLString)

        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        self.session = URLSession(configuration: config)

        let streamConfig = URLSessionConfiguration.default
        streamConfig.httpCookieStorage = HTTPCookieStorage.shared
        streamConfig.httpCookieAcceptPolicy = .always
        streamConfig.httpShouldSetCookies = true
        streamConfig.timeoutIntervalForRequest = 120
        streamConfig.timeoutIntervalForResource = 60 * 60 * 6
        self.streamSession = URLSession(configuration: streamConfig)

        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        restorePersistedCookieIfNeeded()
    }

    static func normalizeBaseURL(_ raw: String) -> String {
        var cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return defaultProductionURL }
        if !cleaned.hasPrefix("http://") && !cleaned.hasPrefix("https://") {
            cleaned = "https://\(cleaned)"
        }
        while cleaned.hasSuffix("/") { cleaned.removeLast() }
        return cleaned
    }

    func updateBaseURL(_ raw: String) {
        baseURLString = Self.normalizeBaseURL(raw)
        KeychainStore.set(baseURLString, for: .serverURL)
        restorePersistedCookieIfNeeded()
    }

    func clearSessionCookies() {
        KeychainStore.delete(.sessionCookie)
        if let url = URL(string: baseURLString),
           let cookies = HTTPCookieStorage.shared.cookies(for: url) {
            for cookie in cookies {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
    }

    private func persistSessionCookie(from response: HTTPURLResponse, url: URL) {
        guard let headers = response.allHeaderFields as? [String: String] else { return }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        for cookie in cookies {
            HTTPCookieStorage.shared.setCookie(cookie)
            if cookie.name == "yacacode_session", !cookie.value.isEmpty {
                KeychainStore.set(cookie.value, for: .sessionCookie)
            }
        }
    }

    private func restorePersistedCookieIfNeeded() {
        guard let url = URL(string: baseURLString),
              let host = url.host,
              let token = KeychainStore.get(.sessionCookie), !token.isEmpty else { return }

        let existing = HTTPCookieStorage.shared.cookies(for: url)?.first { $0.name == "yacacode_session" }
        if existing != nil { return }

        var props: [HTTPCookiePropertyKey: Any] = [
            .domain: host,
            .path: "/",
            .name: "yacacode_session",
            .value: token
        ]
        if url.scheme == "https" {
            props[.secure] = "TRUE"
        }
        if let cookie = HTTPCookie(properties: props) {
            HTTPCookieStorage.shared.setCookie(cookie)
        }
    }

    func buildURL(path: String, queryItems: [URLQueryItem]? = nil) throws -> URL {
        guard var components = URLComponents(string: baseURLString + path) else {
            throw APIError.invalidURL
        }
        if let queryItems, !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }
        return url
    }

    private func makeRequest(
        path: String,
        method: String = "GET",
        queryItems: [URLQueryItem]? = nil,
        body: Data? = nil,
        contentType: String? = "application/json",
        timeout: TimeInterval? = nil
    ) throws -> URLRequest {
        restorePersistedCookieIfNeeded()
        let url = try buildURL(path: path, queryItems: queryItems)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("YacaCodePanel", forHTTPHeaderField: "X-Requested-With")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let timeout {
            req.timeoutInterval = timeout
        }
        if let body {
            req.httpBody = body
            if let contentType {
                req.setValue(contentType, forHTTPHeaderField: "Content-Type")
            }
        }
        return req
    }

    func request<T: Decodable>(
        _ type: T.Type = T.self,
        path: String,
        method: String = "GET",
        queryItems: [URLQueryItem]? = nil,
        jsonBody: [String: Any]? = nil,
        timeout: TimeInterval? = nil,
        notifyUnauthorized: Bool = true
    ) async throws -> T {
        let bodyData: Data?
        if let jsonBody {
            bodyData = try JSONSerialization.data(withJSONObject: jsonBody)
        } else {
            bodyData = nil
        }
        let req = try makeRequest(
            path: path,
            method: method,
            queryItems: queryItems,
            body: bodyData,
            contentType: bodyData != nil ? "application/json" : nil,
            timeout: timeout
        )
        return try await execute(req, as: T.self, notifyUnauthorized: notifyUnauthorized)
    }

    func requestEncodable<Body: Encodable, T: Decodable>(
        _ type: T.Type = T.self,
        path: String,
        method: String = "POST",
        body: Body,
        timeout: TimeInterval? = nil
    ) async throws -> T {
        let data = try encoder.encode(body)
        let req = try makeRequest(path: path, method: method, body: data, contentType: "application/json", timeout: timeout)
        return try await execute(req, as: T.self, notifyUnauthorized: true)
    }

    func uploadRaw<T: Decodable>(
        _ type: T.Type = T.self,
        path: String,
        queryItems: [URLQueryItem],
        data: Data
    ) async throws -> T {
        let req = try makeRequest(
            path: path,
            method: "POST",
            queryItems: queryItems,
            body: data,
            contentType: "application/octet-stream",
            timeout: 180
        )
        return try await execute(req, as: T.self, notifyUnauthorized: true)
    }

    func downloadFile(path: String, queryItems: [URLQueryItem]) async throws -> (Data, String) {
        let req = try makeRequest(path: path, method: "GET", queryItems: queryItems, contentType: nil, timeout: 120)
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw APIError.networkError("Resposta HTTP inválida.")
        }
        if http.statusCode == 401 {
            await triggerUnauthorized()
            throw APIError.unauthorized("Sessão expirada.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let msg = parseErrorMessage(from: data) ?? "Erro HTTP \(http.statusCode)"
            throw APIError.serverError(http.statusCode, msg)
        }
        let suggested = http.suggestedFilename ?? "arquivo"
        return (data, suggested)
    }

    private func execute<T: Decodable>(
        _ req: URLRequest,
        as type: T.Type,
        notifyUnauthorized: Bool
    ) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if error.isCancellation || Task.isCancelled { throw CancellationError() }
            if let urlErr = error as? URLError {
                throw APIError.networkError("Sem conexão com o servidor (\(urlErr.localizedDescription)).")
            }
            throw APIError.networkError(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.networkError("Resposta inválida do servidor.")
        }

        if let url = req.url {
            persistSessionCookie(from: http, url: url)
        }

        if http.statusCode == 401 {
            let msg = parseErrorMessage(from: data) ?? "Sessão expirada ou credenciais inválidas."
            if notifyUnauthorized && !(req.url?.path.contains("/api/auth/") ?? false) {
                await triggerUnauthorized()
            }
            throw APIError.unauthorized(msg)
        }

        guard (200..<300).contains(http.statusCode) else {
            let msg = parseErrorMessage(from: data) ?? "Erro HTTP \(http.statusCode)"
            throw APIError.serverError(http.statusCode, msg)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingError(error.localizedDescription)
        }
    }

    private func parseErrorMessage(from data: Data) -> String? {
        guard let payload = try? decoder.decode(ApiErrorPayload.self, from: data) else { return nil }
        return payload.error ?? payload.message
    }

    private func triggerUnauthorized() async {
        if let cb = onUnauthorized {
            await cb()
        }
    }

    // MARK: - Live Console SSE Stream

    func streamConsole(tail: Int = 220) -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    restorePersistedCookieIfNeeded()
                    let url = try buildURL(
                        path: "/api/console/stream",
                        queryItems: [URLQueryItem(name: "tail", value: String(tail))]
                    )
                    var req = URLRequest(url: url)
                    req.httpMethod = "GET"
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    req.setValue("YacaCodePanel", forHTTPHeaderField: "X-Requested-With")

                    let (bytes, response) = try await streamSession.bytes(for: req)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError.networkError("Resposta inválida no stream SSE.")
                    }
                    if http.statusCode == 401 {
                        await triggerUnauthorized()
                        throw APIError.unauthorized("Sessão expirada no console.")
                    }
                    if http.statusCode == 403 {
                        throw APIError.serverError(403, "Permissão insuficiente para o console ao vivo.")
                    }
                    guard http.statusCode == 200 else {
                        throw APIError.serverError(http.statusCode, "Falha ao conectar console (HTTP \(http.statusCode)).")
                    }

                    var parser = SSELineParser()
                    var buffer = Data()
                    for try await byte in bytes {
                        if Task.isCancelled { break }
                        if byte == 0x0A { // '\n'
                            let line = String(data: buffer, encoding: .utf8) ?? ""
                            buffer.removeAll(keepingCapacity: true)
                            if let event = parser.feed(line: line) {
                                continuation.yield(event)
                            }
                        } else {
                            buffer.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    if !Task.isCancelled {
                        continuation.finish(throwing: error)
                    } else {
                        continuation.finish()
                    }
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    // MARK: - High-Level Endpoint Helpers

    func authMe() async throws -> AuthMeResponse {
        try await request(AuthMeResponse.self, path: "/api/auth/me", notifyUnauthorized: false)
    }

    func login(username: String, password: String) async throws -> LoginResponse {
        try await request(
            LoginResponse.self,
            path: "/api/auth/login",
            method: "POST",
            jsonBody: ["username": username, "password": password],
            notifyUnauthorized: false
        )
    }

    func logout() async {
        _ = try? await request(GenericOkResponse.self, path: "/api/auth/logout", method: "POST", notifyUnauthorized: false)
        clearSessionCookies()
    }

    func changeOwnPassword(currentPassword: String, newPassword: String) async throws -> GenericOkResponse {
        try await request(
            GenericOkResponse.self,
            path: "/api/auth/password",
            method: "POST",
            jsonBody: ["currentPassword": currentPassword, "newPassword": newPassword]
        )
    }

    func overview() async throws -> OverviewResponse {
        try await request(OverviewResponse.self, path: "/api/overview")
    }

    func serverPower(action: String) async throws -> GenericOkResponse {
        try await request(GenericOkResponse.self, path: "/api/server/power", method: "POST", jsonBody: ["action": action], timeout: 75)
    }

    func runConsoleCommand(_ command: String) async throws -> ConsoleCommandResponse {
        try await request(ConsoleCommandResponse.self, path: "/api/console/command", method: "POST", jsonBody: ["command": command])
    }

    func aiStatus() async throws -> AIStatusResponse {
        try await request(AIStatusResponse.self, path: "/api/ai/status")
    }

    func updateAiConfig(apiKey: String?, model: String, inGameChatEnabled: Bool) async throws -> AIStatusResponse {
        var body: [String: Any] = ["model": model, "inGameChatEnabled": inGameChatEnabled]
        if let apiKey, !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["apiKey"] = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return try await request(AIStatusResponse.self, path: "/api/ai/config", method: "PUT", jsonBody: body)
    }

    func aiChat(message: String, history: [AIChatHistoryItem], conversationId: String? = nil) async throws -> AIChatResponse {
        struct Payload: Encodable {
            let message: String
            let history: [AIChatHistoryItem]
            let conversationId: String?
        }
        return try await requestEncodable(
            AIChatResponse.self,
            path: "/api/ai/chat",
            method: "POST",
            body: Payload(message: message, history: history, conversationId: conversationId),
            timeout: 65
        )
    }

    func aiConversations() async throws -> AIConversationsResponse {
        try await request(AIConversationsResponse.self, path: "/api/ai/conversations")
    }

    func aiConversation(id: String, select: Bool = true) async throws -> AIConversationDetailResponse {
        let query = select ? [URLQueryItem(name: "select", value: "1")] : nil
        return try await request(
            AIConversationDetailResponse.self,
            path: "/api/ai/conversations/\(id)",
            queryItems: query
        )
    }

    func aiCreateConversation(title: String = "") async throws -> AIConversationCreateResponse {
        let body: [String: Any] = title.isEmpty ? [:] : ["title": title]
        return try await request(
            AIConversationCreateResponse.self,
            path: "/api/ai/conversations",
            method: "POST",
            jsonBody: body
        )
    }

    func aiDeleteConversation(id: String) async throws -> AIConversationDeleteResponse {
        try await request(
            AIConversationDeleteResponse.self,
            path: "/api/ai/conversations/\(id)",
            method: "DELETE"
        )
    }

    func streamAiEvents() -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    restorePersistedCookieIfNeeded()
                    let url = try buildURL(path: "/api/ai/events")
                    var req = URLRequest(url: url)
                    req.httpMethod = "GET"
                    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    req.setValue("YacaCodePanel", forHTTPHeaderField: "X-Requested-With")

                    let (bytes, response) = try await streamSession.bytes(for: req)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError.networkError("Resposta inválida no stream de sincronização.")
                    }
                    if http.statusCode == 401 {
                        await triggerUnauthorized()
                        throw APIError.unauthorized("Sessão expirada.")
                    }
                    guard http.statusCode == 200 else {
                        throw APIError.serverError(http.statusCode, "Falha no sync IA (HTTP \(http.statusCode)).")
                    }

                    var parser = SSELineParser()
                    var buffer = Data()
                    for try await byte in bytes {
                        if Task.isCancelled { break }
                        if byte == 0x0A {
                            let line = String(data: buffer, encoding: .utf8) ?? ""
                            buffer.removeAll(keepingCapacity: true)
                            if let event = parser.feed(line: line) {
                                continuation.yield(event)
                            }
                        } else {
                            buffer.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    if !Task.isCancelled {
                        continuation.finish(throwing: error)
                    } else {
                        continuation.finish()
                    }
                }
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }

    func aiConfirm(actionId: String, decision: String) async throws -> AIConfirmResponse {
        try await request(
            AIConfirmResponse.self,
            path: "/api/ai/confirm",
            method: "POST",
            jsonBody: ["actionId": actionId, "decision": decision]
        )
    }

    func players() async throws -> PlayersResponse {
        try await request(PlayersResponse.self, path: "/api/players")
    }

    func playerAction(action: String, player: String? = nil, reason: String? = nil, message: String? = nil) async throws -> PlayerActionResponse {
        var body: [String: Any] = ["action": action]
        if let player { body["player"] = player }
        if let reason, !reason.isEmpty { body["reason"] = reason }
        if let message, !message.isEmpty { body["message"] = message }
        return try await request(PlayerActionResponse.self, path: "/api/players/action", method: "POST", jsonBody: body)
    }

    func properties() async throws -> PropertiesResponse {
        try await request(PropertiesResponse.self, path: "/api/properties")
    }

    func saveProperties(_ props: [String: String]) async throws -> GenericOkResponse {
        try await request(GenericOkResponse.self, path: "/api/properties", method: "PUT", jsonBody: ["properties": props])
    }

    func applyPresets() async throws -> PresetsApplyResponse {
        try await request(PresetsApplyResponse.self, path: "/api/presets/apply", method: "POST")
    }

    func plugins() async throws -> PluginsResponse {
        try await request(PluginsResponse.self, path: "/api/plugins")
    }

    func togglePlugin(fileName: String) async throws -> GenericOkResponse {
        try await request(GenericOkResponse.self, path: "/api/plugins/toggle", method: "POST", jsonBody: ["fileName": fileName])
    }

    func deletePlugin(fileName: String) async throws -> GenericOkResponse {
        try await request(
            GenericOkResponse.self,
            path: "/api/plugins",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "name", value: fileName)]
        )
    }

    func uploadPlugin(fileName: String, data: Data) async throws -> GenericOkResponse {
        try await uploadRaw(
            GenericOkResponse.self,
            path: "/api/plugins/upload",
            queryItems: [URLQueryItem(name: "name", value: fileName)],
            data: data
        )
    }

    func listFiles(path: String) async throws -> FilesListResponse {
        try await request(
            FilesListResponse.self,
            path: "/api/files",
            queryItems: [URLQueryItem(name: "path", value: path)]
        )
    }

    func readFile(path: String) async throws -> FileContentResponse {
        try await request(
            FileContentResponse.self,
            path: "/api/files/content",
            queryItems: [URLQueryItem(name: "path", value: path)]
        )
    }

    func saveFile(path: String, content: String) async throws -> GenericOkResponse {
        try await request(
            GenericOkResponse.self,
            path: "/api/files/content",
            method: "PUT",
            jsonBody: ["path": path, "content": content]
        )
    }

    func mkdir(path: String) async throws -> GenericOkResponse {
        try await request(GenericOkResponse.self, path: "/api/files/mkdir", method: "POST", jsonBody: ["path": path])
    }

    func deleteFile(path: String) async throws -> GenericOkResponse {
        try await request(
            GenericOkResponse.self,
            path: "/api/files",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "path", value: path)]
        )
    }

    func localBackups() async throws -> BackupsListResponse {
        try await request(BackupsListResponse.self, path: "/api/backups")
    }

    func deleteLocalBackup(name: String) async throws -> GenericOkResponse {
        try await request(
            GenericOkResponse.self,
            path: "/api/backups",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "name", value: name)]
        )
    }

    func gdriveStatus(includeFiles: Bool = true) async throws -> GDriveStatusResponse {
        let query = includeFiles ? [URLQueryItem(name: "files", value: "1")] : nil
        return try await request(GDriveStatusResponse.self, path: "/api/backups/gdrive/status", queryItems: query)
    }

    func triggerBackupNow() async throws -> BackupTriggerResponse {
        try await request(BackupTriggerResponse.self, path: "/api/backups/now", method: "POST")
    }

    func syncBackupToGDrive(fileName: String? = nil) async throws -> BackupTriggerResponse {
        let body: [String: Any] = fileName.map { ["fileName": $0] } ?? [:]
        return try await request(BackupTriggerResponse.self, path: "/api/backups/gdrive/sync", method: "POST", jsonBody: body)
    }

    func updateGDriveConfig(_ payload: [String: Any]) async throws -> GDriveStatusResponse {
        try await request(GDriveStatusResponse.self, path: "/api/backups/gdrive/config", method: "PUT", jsonBody: payload)
    }

    func gdriveAuthUrl() async throws -> GDriveAuthUrlResponse {
        try await request(GDriveAuthUrlResponse.self, path: "/api/backups/gdrive/auth-url")
    }

    func testGDrive() async throws -> GDriveTestResponse {
        try await request(GDriveTestResponse.self, path: "/api/backups/gdrive/test", method: "POST")
    }

    func disconnectGDrive(clearCredentials: Bool = false) async throws -> GDriveStatusResponse {
        try await request(
            GDriveStatusResponse.self,
            path: "/api/backups/gdrive/disconnect",
            method: "POST",
            jsonBody: ["clearCredentials": clearCredentials]
        )
    }

    func deleteGDriveFile(id: String) async throws -> GenericOkResponse {
        try await request(
            GenericOkResponse.self,
            path: "/api/backups/gdrive/files",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "id", value: id)]
        )
    }

    func networkDetail(refresh: Bool = false) async throws -> NetworkDetailResponse {
        let query = refresh ? [URLQueryItem(name: "refresh", value: "1")] : nil
        return try await request(NetworkDetailResponse.self, path: "/api/network", queryItems: query)
    }

    func users() async throws -> UsersResponse {
        try await request(UsersResponse.self, path: "/api/users")
    }

    func createUser(username: String, displayName: String, role: String, password: String) async throws -> UsersResponse {
        try await request(
            UsersResponse.self,
            path: "/api/users",
            method: "POST",
            jsonBody: [
                "username": username,
                "displayName": displayName,
                "role": role,
                "password": password
            ]
        )
    }

    func updateUser(username: String, role: String? = nil, enabled: Bool? = nil, password: String? = nil) async throws -> UsersResponse {
        var body: [String: Any] = ["username": username]
        if let role { body["role"] = role }
        if let enabled { body["enabled"] = enabled }
        if let password { body["password"] = password }
        return try await request(UsersResponse.self, path: "/api/users", method: "PATCH", jsonBody: body)
    }

    func deleteUser(username: String) async throws -> UsersResponse {
        try await request(
            UsersResponse.self,
            path: "/api/users",
            method: "DELETE",
            queryItems: [URLQueryItem(name: "username", value: username)]
        )
    }
}
