import SwiftUI

@main
struct YacaCodeMCApp: App {
    @State private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootContainerView()
                .environment(appState)
                .preferredColorScheme(appState.appearance.colorScheme)
                .tint(YCColors.primary)
                .onChange(of: scenePhase) { _, newPhase in
                    appState.handleScenePhaseChange(newPhase)
                }
        }
    }
}

struct RootContainerView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            YCColors.background.ignoresSafeArea()

            if appState.isBootstrapping {
                SplashLoadingView()
                    .transition(.opacity)
            } else if !appState.isAuthenticated {
                LoginView()
                    .transition(.asymmetric(insertion: .opacity, removal: .opacity))
            } else {
                MainTabView()
                    .transition(.opacity)
                    .overlay {
                        if appState.isBiometricLocked {
                            BiometricLockOverlay()
                                .transition(.opacity)
                        }
                    }
            }
        }
        .overlay(alignment: .top) {
            if let toast = appState.toast {
                ToastBannerView(toast: toast)
                    .padding(.top, 8)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(999)
            }
        }
        .task {
            await appState.bootstrap()
        }
    }
}

struct SplashLoadingView: View {
    var body: some View {
        VStack(spacing: 18) {
            Image("YacaCodeLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .shadow(color: YCColors.primary.opacity(0.35), radius: 22, y: 8)
            VStack(spacing: 6) {
                Text("YacaCode")
                    .font(.title.bold())
                    .foregroundStyle(YCColors.text)
                Text("Conectando a painel.yacacode.com…")
                    .font(.footnote)
                    .foregroundStyle(YCColors.textMuted)
            }
            ProgressView()
                .tint(YCColors.primary)
                .padding(.top, 4)
        }
    }
}

struct BiometricLockOverlay: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: 22) {
                Image("YacaCodeLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 72, height: 72)

                VStack(spacing: 6) {
                    Text("Painel Protegido")
                        .font(.title2.bold())
                        .foregroundStyle(YCColors.text)
                    Text("Use \(appState.biometricKind.displayName) para desbloquear o acesso ao servidor.")
                        .font(.subheadline)
                        .foregroundStyle(YCColors.textMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 28)
                }

                Button {
                    Task { await appState.unlockAppWithBiometrics() }
                } label: {
                    Label("Desbloquear com \(appState.biometricKind.displayName)", systemImage: appState.biometricKind.systemImage)
                        .font(.headline)
                        .frame(maxWidth: 280)
                        .padding(.vertical, 14)
                        .background(YCColors.primary)
                        .foregroundStyle(YCColors.onPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                Button("Trocar conta") {
                    Task { await appState.logout(clearSavedBiometrics: false) }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(YCColors.textMuted)
            }
            .padding(24)
        }
        .task {
            await appState.unlockAppWithBiometrics()
        }
    }
}

struct MainTabView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState
        TabView(selection: $state.selectedTab) {
            OverviewView()
                .tabItem {
                    Label("Início", systemImage: "square.grid.2x2.fill")
                }
                .tag(AppTab.overview)

            AIChatView()
                .tabItem {
                    Label("Gemini IA", systemImage: "sparkles")
                }
                .tag(AppTab.ai)

            TerminalView()
                .tabItem {
                    Label("Terminal", systemImage: "terminal.fill")
                }
                .tag(AppTab.terminal)

            PlayersView()
                .tabItem {
                    Label("Jogadores", systemImage: "person.2.fill")
                }
                .badge(appState.onlinePlayersCount)
                .tag(AppTab.players)

            ManageHubView()
                .tabItem {
                    Label("Gerenciar", systemImage: "slider.horizontal.3")
                }
                .tag(AppTab.manage)
        }
        .tint(YCColors.primary)
    }
}

struct ToastBannerView: View {
    let toast: ToastMessage

    private var accentColor: Color {
        switch toast.kind {
        case .ok: return YCColors.ok
        case .warn: return YCColors.warn
        case .error: return YCColors.danger
        }
    }

    private var iconName: String {
        switch toast.kind {
        case .ok: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .error: return "xmark.octagon.fill"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .foregroundStyle(accentColor)
                .font(.body.weight(.semibold))
            Text(toast.text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(YCColors.text)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(.ultraThickMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(accentColor.opacity(0.45), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.22), radius: 14, y: 6)
    }
}
