import SwiftUI
import Observation

enum AppearancePreference: String, CaseIterable, Identifiable {
    case system
    case dark
    case light

    var id: String { rawValue }
    var title: String {
        switch self {
        case .system: return "Sistema"
        case .dark: return "Escuro"
        case .light: return "Claro"
        }
    }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .dark: return .dark
        case .light: return .light
        }
    }
}

enum AppTab: Int, Hashable {
    case overview = 0
    case ai = 1
    case terminal = 2
    case players = 3
    case manage = 4
}

struct ToastMessage: Identifiable, Equatable {
    enum Kind { case ok, warn, error }
    let id = UUID()
    let text: String
    let kind: Kind
}

@Observable
@MainActor
final class AppState {
    private static let biometricEnabledKey = "yc_biometric_login_enabled"
    private static let appLockEnabledKey = "yc_biometric_app_lock"
    private static let appearanceKey = "yc_appearance_pref"

    let api: APIClient

    var isBootstrapping: Bool = true
    var isAuthenticated: Bool = false
    var isBiometricLocked: Bool = false
    var session: AuthMeResponse? = nil
    var selectedTab: AppTab = .overview
    var onlinePlayersCount: Int = 0
    var serverOnline: Bool = false
    var toast: ToastMessage? = nil

    var serverURL: String {
        didSet { api.updateBaseURL(serverURL) }
    }

    var biometricLoginEnabled: Bool {
        didSet { UserDefaults.standard.set(biometricLoginEnabled, forKey: Self.biometricEnabledKey) }
    }

    var biometricAppLockEnabled: Bool {
        didSet { UserDefaults.standard.set(biometricAppLockEnabled, forKey: Self.appLockEnabledKey) }
    }

    var appearance: AppearancePreference {
        didSet { UserDefaults.standard.set(appearance.rawValue, forKey: Self.appearanceKey) }
    }

    var biometricKind: BiometricKind { BiometricAuth.availableKind() }
    var hasSavedCredentials: Bool { KeychainStore.hasSavedCredentials() }
    var savedUsername: String? { KeychainStore.get(.username) }

    private var toastTask: Task<Void, Never>?
    private var backgroundTimestamp: Date?

    init() {
        let savedURL = KeychainStore.get(.serverURL) ?? APIClient.defaultProductionURL
        self.serverURL = savedURL
        self.api = APIClient(baseURLString: savedURL)

        let defaults = UserDefaults.standard
        if defaults.object(forKey: Self.biometricEnabledKey) == nil {
            self.biometricLoginEnabled = true
        } else {
            self.biometricLoginEnabled = defaults.bool(forKey: Self.biometricEnabledKey)
        }
        self.biometricAppLockEnabled = defaults.bool(forKey: Self.appLockEnabledKey)
        let savedAppearance = defaults.string(forKey: Self.appearanceKey) ?? AppearancePreference.system.rawValue
        self.appearance = AppearancePreference(rawValue: savedAppearance) ?? .system

        self.api.onUnauthorized = { [weak self] in
            self?.handleSessionExpired()
        }
    }

    func showToast(_ text: String, kind: ToastMessage.Kind = .ok) {
        toastTask?.cancel()
        switch kind {
        case .ok: Haptics.success()
        case .warn: Haptics.warning()
        case .error: Haptics.error()
        }
        withAnimation(.spring(duration: 0.28)) {
            toast = ToastMessage(text: text, kind: kind)
        }
        toastTask = Task {
            try? await Task.sleep(for: .seconds(3.6))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.25)) {
                toast = nil
            }
        }
    }

    func bootstrap() async {
        isBootstrapping = true
        defer { isBootstrapping = false }
        do {
            let me = try await api.authMe()
            session = me
            if me.authenticated {
                isAuthenticated = true
                if biometricAppLockEnabled && biometricKind != .none {
                    isBiometricLocked = true
                }
            } else {
                isAuthenticated = false
            }
        } catch {
            isAuthenticated = false
        }
    }

    func login(username: String, password: String, rememberForBiometrics: Bool) async throws {
        let cleanUser = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanUser.isEmpty, !password.isEmpty else {
            throw APIError.serverError(400, "Informe usuário e senha.")
        }
        _ = try await api.login(username: cleanUser, password: password)
        let me = try await api.authMe()
        guard me.authenticated else {
            throw APIError.unauthorized("Não foi possível validar a sessão.")
        }
        if rememberForBiometrics {
            KeychainStore.set(cleanUser, for: .username)
            KeychainStore.set(password, for: .password)
            biometricLoginEnabled = true
        }
        session = me
        isBiometricLocked = false
        withAnimation(.spring(duration: 0.35)) {
            isAuthenticated = true
        }
        Haptics.success()
    }

    func loginWithBiometrics() async throws {
        guard let username = KeychainStore.get(.username),
              let password = KeychainStore.get(.password),
              !username.isEmpty, !password.isEmpty else {
            throw APIError.unauthorized("Faça login com senha uma vez para ativar \(biometricKind.displayName).")
        }

        let authResult = await BiometricAuth.authenticate(
            reason: "Autentique-se com \(biometricKind.displayName) para acessar o Painel YacaCode"
        )
        switch authResult {
        case .success:
            try await login(username: username, password: password, rememberForBiometrics: true)
        case .failure(let error):
            throw error
        }
    }

    func unlockAppWithBiometrics() async {
        let result = await BiometricAuth.authenticate(
            reason: "Desbloqueie o YacaCode MC com \(biometricKind.displayName)"
        )
        if case .success = result {
            Haptics.success()
            withAnimation(.spring(duration: 0.25)) {
                isBiometricLocked = false
            }
        }
    }

    func handleScenePhaseChange(_ phase: ScenePhase) {
        switch phase {
        case .background:
            backgroundTimestamp = Date()
        case .active:
            if isAuthenticated, biometricAppLockEnabled, biometricKind != .none,
               let bg = backgroundTimestamp, Date().timeIntervalSince(bg) > 15 {
                isBiometricLocked = true
            }
            backgroundTimestamp = nil
        default:
            break
        }
    }

    func logout(clearSavedBiometrics: Bool = false) async {
        await api.logout()
        if clearSavedBiometrics {
            KeychainStore.clearCredentials()
            biometricLoginEnabled = false
            biometricAppLockEnabled = false
        }
        withAnimation(.easeInOut(duration: 0.25)) {
            isAuthenticated = false
            isBiometricLocked = false
            selectedTab = .overview
        }
        session = try? await api.authMe()
    }

    private func handleSessionExpired() {
        guard isAuthenticated else { return }
        api.clearSessionCookies()
        withAnimation {
            isAuthenticated = false
            isBiometricLocked = false
        }
        showToast("Sessão expirada. Entre novamente.", kind: .warn)
    }
}
