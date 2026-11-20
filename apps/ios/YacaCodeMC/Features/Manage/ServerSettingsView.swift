import SwiftUI

struct ServerSettingsView: View {
    @Environment(AppState.self) private var appState

    @State private var engine: String? = nil
    @State private var motd: String = ""
    @State private var maxPlayers: String = "6"
    @State private var difficulty: String = "normal"
    @State private var gamemode: String = "survival"
    @State private var viewDistance: String = "8"
    @State private var simDistance: String = "6"
    @State private var spawnProtection: String = "0"
    @State private var pvp: Bool = true
    @State private var onlineMode: Bool = true
    @State private var whiteList: Bool = false
    @State private var allowNether: Bool = true
    @State private var allowFlight: Bool = true
    @State private var levelSeed: String = ""

    @State private var isLoading: Bool = false
    @State private var isSaving: Bool = false
    @State private var showPresetsConfirm: Bool = false
    @State private var showRestartPrompt: Bool = false

    var body: some View {
        Form {
            // Presets Banner
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    YCPill(text: engine == "rust-pumpkin" ? "ENGINE RUST PUMPKIN" : "OTIMIZAÇÃO ORANGE PI 4GB", color: YCColors.primary)
                    Text("Presets Profissionais YacaCode")
                        .font(.headline)
                    Text("Aplica otimizações de entidades, redstone, spawn limits e crossplay com backup automático .bak.")
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                    Button {
                        showPresetsConfirm = true
                    } label: {
                        Label("Aplicar Presets YacaCode", systemImage: "bolt.fill")
                            .font(.subheadline.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(YCColors.primary)
                            .foregroundStyle(YCColors.onPrimary)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                }
                .padding(.vertical, 4)
            }

            Section("Geral (\(engine == "rust-pumpkin" ? "pumpkin.toml" : "server.properties"))") {
                LabeledContent("MOTD") {
                    TextField("Mensagem do servidor", text: $motd)
                        .multilineTextAlignment(.trailing)
                }
                LabeledContent("Máx. Jogadores") {
                    TextField("6", text: $maxPlayers)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                }
                Picker("Dificuldade", selection: $difficulty) {
                    Text("Pacífico").tag("peaceful")
                    Text("Fácil").tag("easy")
                    Text("Normal").tag("normal")
                    Text("Difícil").tag("hard")
                }
                Picker("Modo de Jogo", selection: $gamemode) {
                    Text("Sobrevivência").tag("survival")
                    Text("Criativo").tag("creative")
                    Text("Aventura").tag("adventure")
                    Text("Espectador").tag("spectator")
                }
            }

            Section("Desempenho (Orange Pi 4GB)") {
                LabeledContent("View Distance (chunks)") {
                    TextField("8", text: $viewDistance)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                }
                LabeledContent("Simulation Distance") {
                    TextField("6", text: $simDistance)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                }
                LabeledContent("Proteção Spawn (blocos)") {
                    TextField("0", text: $spawnProtection)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                }
            }

            Section("Regras & Segurança") {
                Toggle("PvP entre Jogadores", isOn: $pvp).tint(YCColors.primary)
                Toggle("Online Mode (Contas Originais)", isOn: $onlineMode).tint(YCColors.primary)
                Toggle("Whitelist (Privado)", isOn: $whiteList).tint(YCColors.primary)
                Toggle("Permitir Nether", isOn: $allowNether).tint(YCColors.primary)
                Toggle("Permitir Voo (Elytra / Bedrock)", isOn: $allowFlight).tint(YCColors.primary)
            }

            Section("Mundo") {
                LabeledContent("Seed") {
                    TextField("Aleatória", text: $levelSeed)
                        .font(.system(.footnote, design: .monospaced))
                        .multilineTextAlignment(.trailing)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(YCColors.background.ignoresSafeArea())
        .navigationTitle("Configurações")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(isSaving ? "Salvando…" : "Salvar") {
                    Task { await save() }
                }
                .fontWeight(.bold)
                .disabled(isSaving || isLoading)
            }
        }
        .confirmationDialog("Aplicar Presets YacaCode?", isPresented: $showPresetsConfirm, titleVisibility: .visible) {
            Button("Aplicar Presets") {
                Task { await applyPresets() }
            }
            Button("Cancelar", role: .cancel) {}
        } message: {
            Text("Arquivos .bak serão criados automaticamente antes de otimizar as configurações.")
        }
        .alert("Configurações salvas!", isPresented: $showRestartPrompt) {
            Button("Reiniciar Servidor Agora", role: .destructive) {
                Task {
                    _ = try? await appState.api.serverPower(action: "restart")
                    appState.showToast("Reinício do servidor solicitado!")
                }
            }
            Button("Depois", role: .cancel) {}
        } message: {
            Text("Reinicie o servidor para que todas as alterações entrem em vigor.")
        }
        .task { await loadProperties() }
    }

    private func loadProperties() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let res = try await appState.api.properties()
            engine = res.engine
            let p = res.properties
            motd = p["motd"] ?? ""
            maxPlayers = p["max-players"] ?? "6"
            difficulty = (p["difficulty"] ?? "normal").lowercased()
            gamemode = (p["gamemode"] ?? "survival").lowercased()
            viewDistance = p["view-distance"] ?? "8"
            simDistance = p["simulation-distance"] ?? "6"
            spawnProtection = p["spawn-protection"] ?? "0"
            pvp = p["pvp"] != "false"
            onlineMode = p["online-mode"] != "false"
            whiteList = p["white-list"] == "true"
            allowNether = p["allow-nether"] != "false"
            allowFlight = p["allow-flight"] != "false"
            levelSeed = p["level-seed"] ?? ""
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            appState.showToast("Não foi possível ler as configurações.", kind: .warn)
        }
    }

    private func save() async {
        isSaving = true
        defer { isSaving = false }
        let updates: [String: String] = [
            "motd": motd,
            "max-players": maxPlayers,
            "difficulty": difficulty,
            "gamemode": gamemode,
            "view-distance": viewDistance,
            "simulation-distance": simDistance,
            "spawn-protection": spawnProtection,
            "pvp": pvp ? "true" : "false",
            "online-mode": onlineMode ? "true" : "false",
            "white-list": whiteList ? "true" : "false",
            "allow-nether": allowNether ? "true" : "false",
            "allow-flight": allowFlight ? "true" : "false",
            "level-seed": levelSeed
        ]
        do {
            _ = try await appState.api.saveProperties(updates)
            Haptics.success()
            showRestartPrompt = true
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func applyPresets() async {
        do {
            let res = try await appState.api.applyPresets()
            let applied = res.report.filter { $0.status == "applied" }.count
            let skipped = res.report.filter { $0.status == "skipped" }.count
            appState.showToast("Presets aplicados em \(applied) arquivo(s) (\(skipped) ignorados).")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
