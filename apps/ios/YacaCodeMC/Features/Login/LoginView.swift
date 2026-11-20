import SwiftUI

struct LoginView: View {
    @Environment(AppState.self) private var appState

    @State private var username: String = ""
    @State private var password: String = ""
    @State private var showPassword: Bool = false
    @State private var rememberBiometrics: Bool = true
    @State private var showServerConfig: Bool = false
    @State private var customURL: String = APIClient.defaultProductionURL
    @State private var isLoading: Bool = false
    @State private var errorMessage: String? = nil
    @State private var didAutoPromptBiometrics: Bool = false

    @FocusState private var focusedField: Field?
    private enum Field { case username, password, server }

    private var canUseBiometrics: Bool {
        appState.biometricKind != .none
    }

    private var showBiometricQuickLogin: Bool {
        canUseBiometrics && appState.biometricLoginEnabled && appState.hasSavedCredentials
    }

    var body: some View {
        ZStack {
            YCColors.background.ignoresSafeArea()

            // Ambient YacaCode aura
            GeometryReader { geo in
                Circle()
                    .fill(YCColors.accent.opacity(0.14))
                    .frame(width: 300, height: 300)
                    .blur(radius: 90)
                    .position(x: geo.size.width * 0.16, y: geo.size.height * 0.14)

                Circle()
                    .fill(YCColors.primary.opacity(0.20))
                    .frame(width: 340, height: 340)
                    .blur(radius: 100)
                    .position(x: geo.size.width * 0.85, y: geo.size.height * 0.18)
            }
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 24)

                    // Brand Hero
                    VStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 24, style: .continuous)
                                .fill(YCColors.surfaceElevated)
                                .frame(width: 88, height: 88)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                                        .strokeBorder(YCColors.borderStrong, lineWidth: 1)
                                )
                                .shadow(color: YCColors.primary.opacity(0.22), radius: 22, y: 10)

                            Image("YacaCodeLogo")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 66, height: 66)
                        }

                        VStack(spacing: 4) {
                            Text("MINECRAFT CONTROL PLANE")
                                .font(.caption2.weight(.heavy))
                                .tracking(1.4)
                                .foregroundStyle(YCColors.primary)

                            Text("YacaCode")
                                .font(.largeTitle.weight(.bold))
                                .foregroundStyle(YCColors.text)

                            Text("Pumpkin Rust 26.3 • Java & Bedrock • 24/7")
                                .font(.footnote)
                                .foregroundStyle(YCColors.textMuted)
                        }

                        HStack(spacing: 6) {
                            PulsingDot(color: YCColors.ok, active: true)
                            Text("painel.yacacode.com • Cloudflare HTTPS")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(YCColors.ok)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(YCColors.ok.opacity(0.12))
                        .clipShape(Capsule())
                    }

                    // Biometric Express Login Card (when saved)
                    if showBiometricQuickLogin {
                        VStack(spacing: 12) {
                            Button {
                                Task { await triggerBiometricLogin() }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: appState.biometricKind.systemImage)
                                        .font(.title2.weight(.semibold))
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Entrar com \(appState.biometricKind.displayName)")
                                            .font(.headline)
                                        if let saved = appState.savedUsername {
                                            Text("Conta salva: @\(saved)")
                                                .font(.caption)
                                                .opacity(0.82)
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: "arrow.right.circle.fill")
                                        .font(.title3)
                                }
                                .padding(.horizontal, 18)
                                .padding(.vertical, 15)
                                .frame(maxWidth: .infinity)
                                .background(YCColors.primary)
                                .foregroundStyle(YCColors.onPrimary)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .shadow(color: YCColors.primary.opacity(0.28), radius: 14, y: 6)
                            }
                            .disabled(isLoading)

                            HStack {
                                Rectangle().fill(YCColors.border).frame(height: 1)
                                Text("ou entre com senha")
                                    .font(.caption)
                                    .foregroundStyle(YCColors.textMuted)
                                Rectangle().fill(YCColors.border).frame(height: 1)
                            }
                            .padding(.top, 2)
                        }
                    }

                    // Credentials Card
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Usuário")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(YCColors.textMuted)

                            HStack(spacing: 10) {
                                Image(systemName: "person.fill")
                                    .foregroundStyle(YCColors.textMuted)
                                    .frame(width: 18)
                                TextField("ex: nycolas", text: $username)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .textContentType(.username)
                                    .submitLabel(.next)
                                    .focused($focusedField, equals: .username)
                                    .onSubmit { focusedField = .password }
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 13)
                            .background(YCColors.background)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(focusedField == .username ? YCColors.primary : YCColors.borderStrong, lineWidth: 1.2)
                            )
                        }

                        VStack(alignment: .leading, spacing: 6) {
                            Text("Senha")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(YCColors.textMuted)

                            HStack(spacing: 10) {
                                Image(systemName: "lock.fill")
                                    .foregroundStyle(YCColors.textMuted)
                                    .frame(width: 18)

                                Group {
                                    if showPassword {
                                        TextField("Sua senha", text: $password)
                                    } else {
                                        SecureField("••••••••••••", text: $password)
                                    }
                                }
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .textContentType(.password)
                                .submitLabel(.go)
                                .focused($focusedField, equals: .password)
                                .onSubmit { Task { await submitPasswordLogin() } }

                                Button {
                                    showPassword.toggle()
                                } label: {
                                    Image(systemName: showPassword ? "eye.slash.fill" : "eye.fill")
                                        .foregroundStyle(YCColors.textMuted)
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 13)
                            .background(YCColors.background)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(focusedField == .password ? YCColors.primary : YCColors.borderStrong, lineWidth: 1.2)
                            )
                        }

                        if canUseBiometrics {
                            Toggle(isOn: $rememberBiometrics) {
                                HStack(spacing: 8) {
                                    Image(systemName: appState.biometricKind.systemImage)
                                        .foregroundStyle(YCColors.primary)
                                    Text("Habilitar login com \(appState.biometricKind.displayName)")
                                        .font(.subheadline)
                                        .foregroundStyle(YCColors.text)
                                }
                            }
                            .tint(YCColors.primary)
                        }

                        if let errorMessage {
                            HStack(spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                Text(errorMessage)
                                    .font(.footnote.weight(.medium))
                            }
                            .foregroundStyle(YCColors.danger)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(YCColors.danger.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }

                        Button {
                            Task { await submitPasswordLogin() }
                        } label: {
                            HStack(spacing: 8) {
                                if isLoading {
                                    ProgressView()
                                        .tint(showBiometricQuickLogin ? YCColors.text : YCColors.onPrimary)
                                }
                                Text(isLoading ? "Autenticando…" : "Entrar no Painel")
                                    .font(.headline)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(showBiometricQuickLogin ? YCColors.surfaceElevated : YCColors.primary)
                            .foregroundStyle(showBiometricQuickLogin ? YCColors.text : YCColors.onPrimary)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(showBiometricQuickLogin ? YCColors.borderStrong : .clear, lineWidth: 1)
                            )
                        }
                        .disabled(isLoading)

                        // Optional Custom Server URL
                        DisclosureGroup(isExpanded: $showServerConfig) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("URL do Painel (padrão produção)")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(YCColors.textMuted)
                                TextField("https://painel.yacacode.com", text: $customURL)
                                    .font(.system(.footnote, design: .monospaced))
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .keyboardType(.URL)
                                    .focused($focusedField, equals: .server)
                                    .padding(10)
                                    .background(YCColors.background)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(YCColors.borderStrong, lineWidth: 1)
                                    )
                                HStack {
                                    Button("Produção") {
                                        customURL = APIClient.defaultProductionURL
                                        appState.serverURL = customURL
                                    }
                                    .font(.caption.weight(.semibold))
                                    Spacer()
                                    Button("Tailscale (Orange Pi)") {
                                        customURL = "http://100.73.198.14:8080"
                                        appState.serverURL = customURL
                                    }
                                    .font(.caption.weight(.semibold))
                                }
                                .foregroundStyle(YCColors.primary)
                            }
                            .padding(.top, 8)
                        } label: {
                            Label("Endereço do servidor", systemImage: "network")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(YCColors.textMuted)
                        }
                    }
                    .ycCard(padding: 20, cornerRadius: 22)

                    Text("© 2026 YacaCode • yacacode.com")
                        .font(.caption2)
                        .foregroundStyle(YCColors.textMuted)
                        .padding(.bottom, 16)
                }
                .padding(.horizontal, 20)
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear {
            customURL = appState.serverURL
            if username.isEmpty, let saved = appState.savedUsername {
                username = saved
            }
            if showBiometricQuickLogin && !didAutoPromptBiometrics {
                didAutoPromptBiometrics = true
                Task {
                    try? await Task.sleep(for: .milliseconds(350))
                    await triggerBiometricLogin()
                }
            }
        }
    }

    private func submitPasswordLogin() async {
        focusedField = nil
        errorMessage = nil
        appState.serverURL = customURL
        isLoading = true
        defer { isLoading = false }
        do {
            try await appState.login(
                username: username,
                password: password,
                rememberForBiometrics: rememberBiometrics && canUseBiometrics
            )
            password = ""
        } catch {
            Haptics.error()
            errorMessage = error.localizedDescription
        }
    }

    private func triggerBiometricLogin() async {
        focusedField = nil
        errorMessage = nil
        appState.serverURL = customURL
        isLoading = true
        defer { isLoading = false }
        do {
            try await appState.loginWithBiometrics()
        } catch {
            let nsErr = error as NSError
            // Ignore user cancel silently
            if nsErr.code != -2 && nsErr.code != -4 {
                errorMessage = error.localizedDescription
            }
        }
    }
}
