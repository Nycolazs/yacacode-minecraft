import SwiftUI

struct ManageHubView: View {
    @Environment(AppState.self) private var appState
    @State private var showLogoutDialog = false

    private var isAdmin: Bool { appState.session?.isAdmin == true }

    var body: some View {
        NavigationStack {
            List {
                // Account Profile Card
                Section {
                    HStack(spacing: 14) {
                        ZStack {
                            Circle()
                                .fill(YCColors.primary.opacity(0.18))
                                .frame(width: 52, height: 52)
                            Text(String((appState.session?.displayName ?? appState.session?.username ?? "Y").prefix(1)).uppercased())
                                .font(.title2.weight(.bold))
                                .foregroundStyle(YCColors.primary)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(appState.session?.displayName ?? appState.session?.username ?? "Usuário")
                                    .font(.headline)
                                    .foregroundStyle(YCColors.text)
                                YCPill(
                                    text: Formatters.roleLabel(appState.session?.role),
                                    color: Formatters.roleColor(appState.session?.role)
                                )
                            }
                            Text("@\(appState.session?.username ?? "—") • \(appState.session?.brand?.panelDomain ?? "painel.yacacode.com")")
                                .font(.caption)
                                .foregroundStyle(YCColors.textMuted)
                        }
                    }
                    .padding(.vertical, 4)
                }

                // Server Operations
                Section("Servidor & Nuvem") {
                    NavigationLink {
                        BackupsView()
                    } label: {
                        hubRow(
                            icon: "icloud.and.arrow.up.fill",
                            color: YCColors.info,
                            title: "Backups (Google Drive)",
                            subtitle: "Backup em 1 toque, progresso ao vivo e agendamento"
                        )
                    }

                    if isAdmin {
                        NavigationLink {
                            ServerSettingsView()
                        } label: {
                            hubRow(
                                icon: "gearshape.2.fill",
                                color: YCColors.primary,
                                title: "Configurações do Servidor",
                                subtitle: "pumpkin.toml / server.properties e Presets YacaCode"
                            )
                        }

                        NavigationLink {
                            PluginsView()
                        } label: {
                            hubRow(
                                icon: "puzzlepiece.extension.fill",
                                color: YCColors.accent,
                                title: "Plugins & Crossplay",
                                subtitle: "Módulos Rust, Geyser, Floodgate e envio .jar"
                            )
                        }

                        NavigationLink {
                            FileManagerView()
                        } label: {
                            hubRow(
                                icon: "folder.fill",
                                color: Color.orange,
                                title: "Gerenciador de Arquivos",
                                subtitle: "Explorar /data e editar arquivos com editor de código"
                            )
                        }
                    }

                    NavigationLink {
                        NetworkView()
                    } label: {
                        hubRow(
                            icon: "globe",
                            color: Color.teal,
                            title: "Domínio & Cloudflare",
                            subtitle: "DNS mc.yacacode.com, Tunnel HTTPS e portas"
                        )
                    }
                }

                // Security & Users
                Section("Contas & Segurança") {
                    NavigationLink {
                        UsersView()
                    } label: {
                        hubRow(
                            icon: "person.badge.shield.checkmark.fill",
                            color: YCColors.geminiViolet,
                            title: isAdmin ? "Usuários do Painel (RBAC)" : "Alterar Minha Senha",
                            subtitle: isAdmin ? "Criar contas, cargos, senhas e acessos" : "Atualize a senha da sua conta"
                        )
                    }

                    NavigationLink {
                        AppSettingsView()
                    } label: {
                        hubRow(
                            icon: appState.biometricKind != .none ? appState.biometricKind.systemImage : "lock.shield.fill",
                            color: YCColors.ok,
                            title: "Biometria & Preferências",
                            subtitle: "\(appState.biometricKind.displayName), bloqueio do app e aparência"
                        )
                    }
                }

                // Logout
                Section {
                    Button(role: .destructive) {
                        showLogoutDialog = true
                    } label: {
                        HStack {
                            Spacer()
                            Label("Sair da Conta", systemImage: "rectangle.portrait.and.arrow.right")
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(YCColors.background.ignoresSafeArea())
            .navigationTitle("Gerenciar")
            .confirmationDialog("Sair do Painel?", isPresented: $showLogoutDialog, titleVisibility: .visible) {
                Button("Sair (manter \(appState.biometricKind.displayName))") {
                    Task { await appState.logout(clearSavedBiometrics: false) }
                }
                Button("Sair e esquecer credenciais salvas", role: .destructive) {
                    Task { await appState.logout(clearSavedBiometrics: true) }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Você pode manter suas credenciais protegidas no Keychain para entrar rapidamente com \(appState.biometricKind.displayName).")
            }
        }
    }

    private func hubRow(icon: String, color: Color, title: String, subtitle: String) -> some View {
        HStack(spacing: 13) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(color.opacity(0.16))
                    .frame(width: 34, height: 34)
                Image(systemName: icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(color)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(YCColors.text)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(YCColors.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}
