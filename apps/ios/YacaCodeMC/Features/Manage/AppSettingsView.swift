import SwiftUI

struct AppSettingsView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        @Bindable var state = appState
        Form {
            Section {
                if appState.biometricKind != .none {
                    Toggle(isOn: $state.biometricLoginEnabled) {
                        Label("Login rápido com \(appState.biometricKind.displayName)", systemImage: appState.biometricKind.systemImage)
                    }
                    .tint(YCColors.primary)

                    Toggle(isOn: $state.biometricAppLockEnabled) {
                        Label("Exigir \(appState.biometricKind.displayName) ao reabrir o app", systemImage: "lock.shield.fill")
                    }
                    .tint(YCColors.primary)
                } else {
                    Label("Biometria não configurada neste dispositivo.", systemImage: "exclamationmark.shield")
                        .foregroundStyle(YCColors.textMuted)
                }

                if appState.hasSavedCredentials {
                    Button(role: .destructive) {
                        KeychainStore.clearCredentials()
                        appState.biometricLoginEnabled = false
                        appState.showToast("Credenciais removidas do Keychain.", kind: .warn)
                    } label: {
                        Label("Remover credenciais salvas no Keychain", systemImage: "key.slash.fill")
                    }
                }
            } header: {
                Text("Segurança & Biometria")
            } footer: {
                Text("Suas credenciais são armazenadas exclusivamente no Keychain criptografado deste iPhone.")
            }

            Section("Aparência") {
                Picker("Tema do Aplicativo", selection: $state.appearance) {
                    ForEach(AppearancePreference.allCases) { pref in
                        Text(pref.title).tag(pref)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section("Servidor Conectado") {
                LabeledContent("Endpoint") {
                    Text(appState.serverURL)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(YCColors.textMuted)
                }
                LabeledContent("Versão do App") {
                    Text("1.0.0 (Native SwiftUI)")
                        .foregroundStyle(YCColors.textMuted)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(YCColors.background.ignoresSafeArea())
        .navigationTitle("Biometria & Preferências")
        .navigationBarTitleDisplayMode(.inline)
    }
}
