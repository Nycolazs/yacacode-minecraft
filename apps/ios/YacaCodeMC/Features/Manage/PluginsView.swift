import SwiftUI
import UniformTypeIdentifiers

struct PluginsView: View {
    @Environment(AppState.self) private var appState

    @State private var data: PluginsResponse? = nil
    @State private var isLoading: Bool = false
    @State private var isUploading: Bool = false
    @State private var showImporter: Bool = false
    @State private var deleteTarget: PluginItem? = nil

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                crossplayCard
                uploadCard
                installedListCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(YCColors.background.ignoresSafeArea())
        .navigationTitle("Plugins & Crossplay")
        .refreshable { await loadPlugins() }
        .fileImporter(
            isPresented: $showImporter,
            allowedContentTypes: [UTType.data, UTType.archive],
            allowsMultipleSelection: false
        ) { result in
            Task { await handleImportedFile(result) }
        }
        .confirmationDialog("Excluir plugin?", isPresented: Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        ), titleVisibility: .visible) {
            Button("Excluir permanentemente", role: .destructive) {
                if let p = deleteTarget {
                    deleteTarget = nil
                    Task { await deletePlugin(p) }
                }
            }
            Button("Cancelar", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("Remover \"\(deleteTarget?.fileName ?? "")\"?")
        }
        .task { await loadPlugins() }
    }

    private var crossplayCard: some View {
        let plugins = data?.plugins ?? []
        let geyserOn = plugins.contains { ($0.fileName.localizedCaseInsensitiveContains("geyser") || $0.fileName.contains("bedrock")) && $0.enabled }
        let chunkyOn = plugins.contains { ($0.fileName.localizedCaseInsensitiveContains("chunky") || $0.fileName.contains("chunks")) && $0.enabled }

        let items: [(String, Bool)] = [
            ("Ponte Bedrock → Java (NetherNet / Geyser)", geyserOn),
            ("Login Bedrock sem conta Java (Floodgate / Nativo)", data?.floodgateInstalled == true),
            ("Configuração Crossplay ativa", data?.geyserConfigured == true),
            ("Pré-geração / Worldgen Multi-Thread", chunkyOn)
        ]

        return VStack(alignment: .leading, spacing: 10) {
            Text("Status Crossplay (Java + Bedrock)")
                .font(.headline)
                .foregroundStyle(YCColors.text)

            ForEach(items, id: \.0) { label, ok in
                HStack {
                    Text(label)
                        .font(.caption)
                        .foregroundStyle(YCColors.text)
                    Spacer()
                    YCPill(text: ok ? "Ativo" : "Pendente", color: ok ? YCColors.ok : YCColors.warn)
                }
                .padding(.vertical, 4)
            }
        }
        .ycCard()
    }

    private var uploadCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Instalar Novo Plugin (.jar)")
                .font(.headline)
                .foregroundStyle(YCColors.text)
            Text("Envie arquivos .jar compatíveis (máximo 100 MB). Reinicie o servidor após o envio.")
                .font(.caption)
                .foregroundStyle(YCColors.textMuted)

            Button {
                showImporter = true
            } label: {
                HStack(spacing: 8) {
                    if isUploading {
                        ProgressView().tint(YCColors.onPrimary)
                        Text("Enviando plugin…")
                    } else {
                        Image(systemName: "arrow.up.doc.fill")
                        Text("Selecionar arquivo .jar")
                    }
                }
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(YCColors.primary)
                .foregroundStyle(YCColors.onPrimary)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(isUploading)
        }
        .ycCard()
    }

    private var installedListCard: some View {
        let list = data?.plugins ?? []
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Plugins & Módulos Instalados")
                        .font(.headline)
                        .foregroundStyle(YCColors.text)
                    Text("\(list.count) item(ns) encontrado(s)")
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                }
                Spacer()
                if isLoading { ProgressView().scaleEffect(0.85) }
            }

            if list.isEmpty {
                Text("Nenhum plugin encontrado em /data/plugins.")
                    .font(.footnote)
                    .foregroundStyle(YCColors.textMuted)
            } else {
                VStack(spacing: 8) {
                    ForEach(list) { plugin in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(plugin.displayName)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(YCColors.text)
                                    HStack(spacing: 6) {
                                        YCPill(text: plugin.enabled ? "Ativo" : "Desativado", color: plugin.enabled ? YCColors.ok : YCColors.textMuted)
                                        if plugin.isCoreCrossplay == true {
                                            YCPill(text: "Crossplay", color: YCColors.accent)
                                        }
                                        if plugin.isNativeModule {
                                            YCPill(text: "Nativo Rust", color: YCColors.info)
                                        }
                                    }
                                    Text("\(plugin.size > 0 ? Formatters.bytes(plugin.size) + " • " : "")\(Formatters.dateBR(plugin.mtime))")
                                        .font(.caption2)
                                        .foregroundStyle(YCColors.textMuted)
                                }
                                Spacer()
                            }

                            if !plugin.isNativeModule {
                                HStack(spacing: 8) {
                                    Button(plugin.enabled ? "Desativar" : "Ativar") {
                                        Task { await togglePlugin(plugin) }
                                    }
                                    .font(.caption.weight(.bold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(YCColors.surfaceElevated)
                                    .foregroundStyle(YCColors.text)
                                    .clipShape(Capsule())

                                    Button("Excluir") {
                                        deleteTarget = plugin
                                    }
                                    .font(.caption.weight(.bold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(YCColors.danger.opacity(0.14))
                                    .foregroundStyle(YCColors.danger)
                                    .clipShape(Capsule())
                                }
                            }
                        }
                        .padding(12)
                        .background(YCColors.background)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
        }
        .ycCard()
    }

    private func loadPlugins() async {
        isLoading = true
        defer { isLoading = false }
        do {
            data = try await appState.api.plugins()
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if data == nil {
                appState.showToast("Não foi possível listar plugins.", kind: .warn)
            }
        }
    }

    private func togglePlugin(_ p: PluginItem) async {
        do {
            _ = try await appState.api.togglePlugin(fileName: p.fileName)
            appState.showToast("Status atualizado! Reinicie o servidor para aplicar.")
            await loadPlugins()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func deletePlugin(_ p: PluginItem) async {
        do {
            _ = try await appState.api.deletePlugin(fileName: p.fileName)
            appState.showToast("Plugin \(p.fileName) removido.")
            await loadPlugins()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func handleImportedFile(_ result: Result<[URL], Error>) async {
        switch result {
        case .failure(let err):
            appState.showToast(err.localizedDescription, kind: .error)
        case .success(let urls):
            guard let url = urls.first else { return }
            guard url.pathExtension.lowercased() == "jar" else {
                appState.showToast("Envie apenas arquivos .jar.", kind: .error)
                return
            }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            isUploading = true
            defer { isUploading = false }
            do {
                let bytes = try Data(contentsOf: url)
                _ = try await appState.api.uploadPlugin(fileName: url.lastPathComponent, data: bytes)
                appState.showToast("Plugin \(url.lastPathComponent) instalado com sucesso!")
                await loadPlugins()
            } catch {
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
    }
}
