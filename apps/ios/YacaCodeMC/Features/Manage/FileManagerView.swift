import SwiftUI

struct FileManagerView: View {
    @Environment(AppState.self) private var appState

    @State private var currentPath: String = ""
    @State private var entries: [FileEntry] = []
    @State private var isLoading: Bool = false

    @State private var editingFile: FileContentResponse? = nil
    @State private var editorContent: String = ""
    @State private var isSavingFile: Bool = false

    @State private var showNewFolderAlert: Bool = false
    @State private var newFolderName: String = ""
    @State private var deleteTarget: FileEntry? = nil
    @State private var shareFileURL: URL? = nil

    private var breadcrumbs: [(label: String, path: String)] {
        var list: [(String, String)] = [("/data", "")]
        let parts = currentPath.split(separator: "/").map(String.init)
        var acc = ""
        for p in parts {
            acc = acc.isEmpty ? p : "\(acc)/\(p)"
            list.append((p, acc))
        }
        return list
    }

    var body: some View {
        VStack(spacing: 0) {
            // Breadcrumb bar
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(breadcrumbs.enumerated()), id: \.offset) { idx, crumb in
                        if idx > 0 {
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(YCColors.textMuted)
                        }
                        Button {
                            Haptics.selection()
                            Task { await loadDir(crumb.path) }
                        } label: {
                            Text(crumb.label)
                                .font(.system(.caption, design: .monospaced).weight(idx == breadcrumbs.count - 1 ? .bold : .medium))
                                .padding(.horizontal, 9)
                                .padding(.vertical, 5)
                                .background(idx == breadcrumbs.count - 1 ? YCColors.primary.opacity(0.18) : YCColors.surfaceElevated)
                                .foregroundStyle(idx == breadcrumbs.count - 1 ? YCColors.primary : YCColors.text)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
            .background(YCColors.surface)
            .overlay(alignment: .bottom) {
                Rectangle().fill(YCColors.border).frame(height: 1)
            }

            List {
                if !currentPath.isEmpty {
                    Button {
                        let parent = currentPath.split(separator: "/").dropLast().joined(separator: "/")
                        Task { await loadDir(parent) }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "arrow.turn.up.left")
                                .foregroundStyle(YCColors.primary)
                            Text("Voltar para pasta anterior")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(YCColors.primary)
                        }
                    }
                }

                if entries.isEmpty && !isLoading {
                    Text("Pasta vazia.")
                        .foregroundStyle(YCColors.textMuted)
                } else {
                    ForEach(entries) { entry in
                        Button {
                            if entry.isDirectory {
                                Task { await loadDir(entry.path) }
                            } else if entry.editable {
                                Task { await openEditor(entry.path) }
                            } else {
                                Task { await downloadAndShare(entry) }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: entry.isDirectory ? "folder.fill" : entry.editable ? "doc.text.fill" : "shippingbox.fill")
                                    .font(.title3)
                                    .foregroundStyle(entry.isDirectory ? YCColors.accent : entry.editable ? YCColors.primary : YCColors.textMuted)
                                    .frame(width: 26)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.name)
                                        .font(.system(.subheadline, design: .monospaced).weight(.medium))
                                        .foregroundStyle(YCColors.text)
                                        .lineLimit(1)
                                    Text(entry.isDirectory ? "Pasta • \(Formatters.dateBR(entry.mtime))" : "\(Formatters.bytes(entry.size)) • \(Formatters.dateBR(entry.mtime))")
                                        .font(.caption2)
                                        .foregroundStyle(YCColors.textMuted)
                                }
                                Spacer()
                                if entry.isDirectory {
                                    Image(systemName: "chevron.right")
                                        .font(.caption2)
                                        .foregroundStyle(YCColors.textMuted)
                                } else if entry.editable {
                                    YCPill(text: "Editar", color: YCColors.primary)
                                }
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                deleteTarget = entry
                            } label: {
                                Label("Excluir", systemImage: "trash")
                            }
                            if !entry.isDirectory {
                                Button {
                                    Task { await downloadAndShare(entry) }
                                } label: {
                                    Label("Baixar", systemImage: "square.and.arrow.down")
                                }
                                .tint(YCColors.info)
                            }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(YCColors.background)
            .refreshable { await loadDir(currentPath) }
        }
        .navigationTitle("Arquivos")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showNewFolderAlert = true
                } label: {
                    Label("Nova pasta", systemImage: "folder.badge.plus")
                }
                Button {
                    Task { await loadDir(currentPath) }
                } label: {
                    Label("Atualizar", systemImage: "arrow.clockwise")
                }
            }
        }
        .alert("Nova Pasta", isPresented: $showNewFolderAlert) {
            TextField("Nome da pasta", text: $newFolderName)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Criar") {
                let name = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
                newFolderName = ""
                guard !name.isEmpty else { return }
                let target = currentPath.isEmpty ? name : "\(currentPath)/\(name)"
                Task { await createFolder(target) }
            }
            Button("Cancelar", role: .cancel) { newFolderName = "" }
        }
        .confirmationDialog("Excluir item?", isPresented: Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        ), titleVisibility: .visible) {
            Button("Excluir permanentemente", role: .destructive) {
                if let target = deleteTarget {
                    deleteTarget = nil
                    Task { await deleteEntry(target) }
                }
            }
            Button("Cancelar", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("Excluir \"/data/\(deleteTarget?.path ?? "")\" permanentemente?")
        }
        .sheet(item: Binding(
            get: { editingFile.map { IdentifiableFile(file: $0) } },
            set: { if $0 == nil { editingFile = nil } }
        )) { wrapper in
            codeEditorSheet(wrapper.file)
        }
        .sheet(isPresented: Binding(
            get: { shareFileURL != nil },
            set: { if !$0 { shareFileURL = nil } }
        )) {
            if let url = shareFileURL {
                ActivityShareSheet(items: [url])
            }
        }
        .task { await loadDir("") }
    }

    private struct IdentifiableFile: Identifiable {
        var id: String { file.path }
        let file: FileContentResponse
    }

    private func codeEditorSheet(_ file: FileContentResponse) -> some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Text("/data/\(file.path)")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(YCColors.termMuted)
                    Spacer()
                    Text("\(editorContent.count) chars")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(YCColors.termMuted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(YCColors.termChrome)

                TextEditor(text: $editorContent)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(YCColors.termText)
                    .scrollContentBackground(.hidden)
                    .background(YCColors.termBg)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            .background(YCColors.termBg)
            .navigationTitle(file.path.components(separatedBy: "/").last ?? "Editor")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar") { editingFile = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSavingFile ? "Salvando…" : "Salvar") {
                        Task { await saveEditedFile(file.path) }
                    }
                    .fontWeight(.bold)
                    .disabled(isSavingFile)
                }
            }
            .preferredColorScheme(.dark)
        }
    }

    private func loadDir(_ path: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let res = try await appState.api.listFiles(path: path)
            currentPath = res.path
            entries = res.entries
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if entries.isEmpty {
                appState.showToast("Não foi possível listar arquivos.", kind: .warn)
            }
        }
    }

    private func openEditor(_ relPath: String) async {
        do {
            let file = try await appState.api.readFile(path: relPath)
            editorContent = file.content
            editingFile = file
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func saveEditedFile(_ relPath: String) async {
        isSavingFile = true
        defer { isSavingFile = false }
        do {
            _ = try await appState.api.saveFile(path: relPath, content: editorContent)
            appState.showToast("Arquivo \(relPath) salvo!")
            editingFile = nil
            await loadDir(currentPath)
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func createFolder(_ relPath: String) async {
        do {
            _ = try await appState.api.mkdir(path: relPath)
            appState.showToast("Pasta criada!")
            await loadDir(currentPath)
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func deleteEntry(_ entry: FileEntry) async {
        do {
            _ = try await appState.api.deleteFile(path: entry.path)
            appState.showToast("Item excluído.")
            await loadDir(currentPath)
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func downloadAndShare(_ entry: FileEntry) async {
        do {
            let (data, _) = try await appState.api.downloadFile(
                path: "/api/files/download",
                queryItems: [URLQueryItem(name: "path", value: entry.path)]
            )
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(entry.name)
            try data.write(to: tmp)
            shareFileURL = tmp
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}

struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
