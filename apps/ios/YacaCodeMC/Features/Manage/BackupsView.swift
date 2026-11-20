import SwiftUI

struct BackupsView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.openURL) private var openURL

    @State private var gdrive: GDriveStatusResponse? = nil
    @State private var localBackups: [LocalBackupItem] = []
    @State private var isLoading: Bool = false
    @State private var progress: GDriveProgress? = nil
    @State private var wasActive: Bool = false
    @State private var pollTask: Task<Void, Never>? = nil
    @State private var showOptionsSheet: Bool = false
    @State private var showConnectSheet: Bool = false
    @State private var deleteRemoteTarget: GDriveRemoteFile? = nil
    @State private var deleteLocalTarget: LocalBackupItem? = nil

    private var isAdmin: Bool { gdrive?.canConfigure == true || appState.session?.isAdmin == true }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if let gd = gdrive {
                    if gd.connected {
                        connectedDriveCard(gd)
                        remoteFilesCard(gd)
                    } else {
                        disconnectedDriveCard(gd)
                    }
                } else if isLoading {
                    ProgressView().tint(YCColors.primary).padding(.top, 50)
                }

                if !localBackups.isEmpty {
                    localBackupsCard
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 28)
        }
        .background(YCColors.background.ignoresSafeArea())
        .navigationTitle("Backups")
        .navigationBarTitleDisplayMode(.large)
        .refreshable { await loadAll() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await loadAll() }
                } label: {
                    Label("Atualizar", systemImage: "arrow.clockwise")
                }
            }
        }
        .sheet(isPresented: $showOptionsSheet) {
            if let gd = gdrive {
                GDriveOptionsSheet(status: gd) {
                    Task { await loadAll() }
                }
            }
        }
        .sheet(isPresented: $showConnectSheet) {
            if let gd = gdrive {
                GDriveConnectSheet(status: gd) {
                    Task { await loadAll() }
                }
            }
        }
        .confirmationDialog("Excluir backup do Google Drive?", isPresented: Binding(
            get: { deleteRemoteTarget != nil },
            set: { if !$0 { deleteRemoteTarget = nil } }
        ), titleVisibility: .visible) {
            Button("Excluir da Nuvem", role: .destructive) {
                if let target = deleteRemoteTarget {
                    deleteRemoteTarget = nil
                    Task { await deleteRemote(target) }
                }
            }
            Button("Cancelar", role: .cancel) { deleteRemoteTarget = nil }
        } message: {
            Text("Remover \"\(deleteRemoteTarget?.name ?? "")\" permanentemente do Google Drive?")
        }
        .confirmationDialog("Excluir backup local?", isPresented: Binding(
            get: { deleteLocalTarget != nil },
            set: { if !$0 { deleteLocalTarget = nil } }
        ), titleVisibility: .visible) {
            Button("Excluir do Orange Pi", role: .destructive) {
                if let target = deleteLocalTarget {
                    deleteLocalTarget = nil
                    Task { await deleteLocal(target) }
                }
            }
            Button("Cancelar", role: .cancel) { deleteLocalTarget = nil }
        }
        .task { await loadAll() }
        .onDisappear { pollTask?.cancel() }
    }

    // MARK: - Disconnected Card

    private func disconnectedDriveCard(_ gd: GDriveStatusResponse) -> some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(YCColors.info.opacity(0.15))
                    .frame(width: 64, height: 64)
                Image(systemName: "icloud.and.arrow.up.fill")
                    .font(.title)
                    .foregroundStyle(YCColors.info)
            }
            Text("Backup automático no Google Drive")
                .font(.title3.bold())
                .foregroundStyle(YCColors.text)
                .multilineTextAlignment(.center)

            Text("Envie cópias seguras do seu mundo direto para o seu Google Drive pessoal — zero espaço ocupado no Orange Pi.")
                .font(.subheadline)
                .foregroundStyle(YCColors.textMuted)
                .multilineTextAlignment(.center)

            if isAdmin {
                Button {
                    Task { await handleQuickConnect(gd) }
                } label: {
                    Label("Conectar com Google Drive", systemImage: "link")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(YCColors.primary)
                        .foregroundStyle(YCColors.onPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                if gd.hasCredentials == true {
                    Button("Alterar credenciais OAuth") {
                        showConnectSheet = true
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(YCColors.textMuted)
                }
            }

            if let err = gd.lastError, !err.isEmpty {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(YCColors.danger)
            }
        }
        .ycCard(padding: 20)
    }

    // MARK: - Connected Card + Live Progress

    private func connectedDriveCard(_ gd: GDriveStatusResponse) -> some View {
        let activeProg = progress ?? gd.progress
        let isRunning = activeProg?.active == true
        let autoOn = gd.enabled == true && (gd.scheduleHours ?? 0) > 0

        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text("Google Drive")
                            .font(.headline)
                            .foregroundStyle(YCColors.text)
                        YCPill(text: "Conectado", color: YCColors.ok, icon: "checkmark.circle.fill")
                        if autoOn {
                            YCPill(text: "Auto • \(gd.scheduleHours ?? 24)h", color: YCColors.info)
                        }
                    }
                    Text("\(gd.accountEmail ?? "Conta Google") • Pasta \"\(gd.folderName ?? "Backups")\"")
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                }
                Spacer()
                if isAdmin {
                    Button {
                        showOptionsSheet = true
                    } label: {
                        Image(systemName: "gearshape.fill")
                            .font(.subheadline)
                            .foregroundStyle(YCColors.text)
                            .frame(width: 34, height: 34)
                            .background(YCColors.surfaceElevated)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                }
            }

            // Primary Action Row
            HStack(spacing: 10) {
                if isAdmin {
                    Button {
                        Haptics.medium()
                        Task { await triggerBackupNow() }
                    } label: {
                        HStack(spacing: 8) {
                            if isRunning {
                                ProgressView().tint(YCColors.onPrimary).scaleEffect(0.85)
                                Text("Enviando \(activeProg?.percent ?? 0)%")
                            } else {
                                Image(systemName: "icloud.and.arrow.up.fill")
                                Text("Fazer Backup Agora")
                            }
                        }
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(YCColors.primary)
                        .foregroundStyle(YCColors.onPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .disabled(isRunning)
                }

                if let urlStr = gd.folderUrl, let url = URL(string: urlStr) {
                    Button {
                        openURL(url)
                    } label: {
                        Image(systemName: "arrow.up.right.square")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(YCColors.text)
                            .frame(width: 44, height: 44)
                            .background(YCColors.surfaceElevated)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            // Live Progress Box
            if let p = activeProg, (p.active || p.stage == "done" || p.stage == "error") {
                liveProgressBox(p)
            }

            // Metrics Row
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                metricBox(title: "Último backup", value: Formatters.dateBR(gd.lastBackupAt))
                metricBox(title: "Próximo auto", value: gd.nextScheduledAt != nil ? Formatters.dateBR(gd.nextScheduledAt) : "Manual")
                metricBox(title: "Livre no Drive", value: freeQuotaText(gd.storageQuota))
            }

            // Quota Bar
            if let q = gd.storageQuota, q.limitBytes > 0 {
                let ratio = min(1.0, max(0.0, Double(q.usageBytes) / Double(q.limitBytes)))
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Uso da nuvem: \(Formatters.bytes(q.usageBytes)) de \(Formatters.bytes(q.limitBytes))")
                            .font(.caption2)
                            .foregroundStyle(YCColors.textMuted)
                        Spacer()
                        Text("\(Int(round(ratio * 100)))%")
                            .font(.system(.caption2, design: .monospaced).bold())
                            .foregroundStyle(YCColors.textMuted)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(YCColors.surfaceElevated)
                            Capsule()
                                .fill(ratio > 0.9 ? YCColors.danger : YCColors.info)
                                .frame(width: geo.size.width * ratio)
                        }
                    }
                    .frame(height: 5)
                }
            }

            if let err = gd.lastError, !err.isEmpty {
                Text("Último aviso: \(err)")
                    .font(.caption)
                    .foregroundStyle(YCColors.danger)
            }
        }
        .ycCard()
    }

    private func liveProgressBox(_ p: GDriveProgress) -> some View {
        let stageInfo: (icon: String, title: String, color: Color) = {
            switch p.stage {
            case "compressing": return ("archivebox.fill", "Compactando mundo…", YCColors.accent)
            case "uploading": return ("icloud.and.arrow.up.fill", "Enviando para o Google Drive…", YCColors.info)
            case "pruning": return ("sparkles", "Limpando backups antigos…", YCColors.primary)
            case "done": return ("checkmark.circle.fill", "Backup concluído no Google Drive!", YCColors.ok)
            case "error": return ("xmark.octagon.fill", "Falha durante o backup", YCColors.danger)
            default: return ("clock.fill", "Em andamento…", YCColors.primary)
            }
        }()

        let pct = min(100, max(0, p.percent))
        var details: [String] = []
        if let msg = p.message, !msg.isEmpty { details.append(msg) }
        if p.active, let speed = p.speedBps, speed > 0 { details.append("\(Formatters.bytes(speed))/s") }

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(stageInfo.title, systemImage: stageInfo.icon)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(stageInfo.color)
                Spacer()
                Text("\(pct)%")
                    .font(.system(.caption, design: .monospaced).bold())
                    .foregroundStyle(YCColors.text)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(YCColors.surfaceElevated)
                    Capsule()
                        .fill(stageInfo.color)
                        .frame(width: geo.size.width * (Double(pct) / 100.0))
                        .animation(.easeOut(duration: 0.3), value: pct)
                }
            }
            .frame(height: 7)

            if !details.isEmpty {
                Text(details.joined(separator: " • "))
                    .font(.caption2)
                    .foregroundStyle(YCColors.textMuted)
            }
        }
        .padding(12)
        .background(stageInfo.color.opacity(0.09))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(stageInfo.color.opacity(0.35), lineWidth: 1)
        )
    }

    private func metricBox(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(YCColors.textMuted)
            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(YCColors.text)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9)
        .background(YCColors.background)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func freeQuotaText(_ q: GDriveQuota?) -> String {
        guard let q, q.limitBytes > 0 else { return "Disponível" }
        let free = max(0, q.limitBytes - q.usageBytes)
        return Formatters.bytes(free)
    }

    // MARK: - Remote Files Card

    private func remoteFilesCard(_ gd: GDriveStatusResponse) -> some View {
        let files = gd.remoteFiles ?? []
        let total = files.reduce(Int64(0)) { $0 + $1.size }

        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Backups Salvos no Google Drive")
                    .font(.headline)
                    .foregroundStyle(YCColors.text)
                Text("\(files.count) backup(s) • \(Formatters.bytes(total)) • Retenção máx. \(gd.maxBackups ?? 10)")
                    .font(.caption)
                    .foregroundStyle(YCColors.textMuted)
            }

            if files.isEmpty {
                Text("Nenhum backup salvo no Drive ainda.")
                    .font(.footnote)
                    .foregroundStyle(YCColors.textMuted)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 8) {
                    ForEach(files) { f in
                        HStack(spacing: 10) {
                            Image(systemName: "doc.zipper")
                                .font(.title3)
                                .foregroundStyle(YCColors.info)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.name)
                                    .font(.system(.caption, design: .monospaced).weight(.semibold))
                                    .foregroundStyle(YCColors.text)
                                    .lineLimit(1)
                                Text("\(Formatters.dateBR(f.createdTime)) • \(Formatters.bytes(f.size))")
                                    .font(.caption2)
                                    .foregroundStyle(YCColors.textMuted)
                            }
                            Spacer()
                            if let link = f.webViewLink, let url = URL(string: link) {
                                Button {
                                    openURL(url)
                                } label: {
                                    Image(systemName: "arrow.up.right.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(YCColors.primary)
                                }
                                .buttonStyle(.plain)
                            }
                            if isAdmin {
                                Button {
                                    deleteRemoteTarget = f
                                } label: {
                                    Image(systemName: "trash.fill")
                                        .font(.subheadline)
                                        .foregroundStyle(YCColors.danger)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(11)
                        .background(YCColors.background)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            }
        }
        .ycCard()
    }

    // MARK: - Residual Local Backups

    private var localBackupsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Backups Locais Residuais (Orange Pi)")
                .font(.headline)
                .foregroundStyle(YCColors.text)
            ForEach(localBackups) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name)
                            .font(.system(.caption, design: .monospaced).bold())
                            .foregroundStyle(YCColors.text)
                        Text("\(Formatters.dateBR(item.mtime)) • \(Formatters.bytes(item.size))")
                            .font(.caption2)
                            .foregroundStyle(YCColors.textMuted)
                    }
                    Spacer()
                    if isAdmin && gdrive?.connected == true {
                        Button("☁ Enviar") {
                            Task { await syncLocal(item.name) }
                        }
                        .font(.caption.bold())
                        .foregroundStyle(YCColors.info)
                    }
                    if isAdmin {
                        Button {
                            deleteLocalTarget = item
                        } label: {
                            Image(systemName: "trash").foregroundStyle(YCColors.danger)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(10)
                .background(YCColors.background)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .ycCard()
    }

    // MARK: - Logic & Polling

    private func loadAll() async {
        isLoading = true
        defer { isLoading = false }
        async let gdReq = appState.api.gdriveStatus(includeFiles: true)
        async let localReq = appState.api.localBackups()
        do {
            let gd = try await gdReq
            gdrive = gd
            progress = gd.progress
            if gd.progress?.active == true {
                wasActive = true
                startProgressPolling()
            }
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if gdrive == nil {
                appState.showToast("Não foi possível consultar o Google Drive.", kind: .warn)
            }
        }
        if let local = try? await localReq {
            localBackups = local.backups
        }
    }

    private func triggerBackupNow() async {
        do {
            let res = try await appState.api.triggerBackupNow()
            if let p = res.progress {
                progress = p
                wasActive = true
                startProgressPolling()
            }
            appState.showToast(res.output ?? "Backup iniciado!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func syncLocal(_ name: String) async {
        do {
            let res = try await appState.api.syncBackupToGDrive(fileName: name)
            if let p = res.progress {
                progress = p
                wasActive = true
                startProgressPolling()
            }
            appState.showToast(res.output ?? "Envio iniciado!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func startProgressPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(1200))
                guard !Task.isCancelled else { break }
                if let gd = try? await appState.api.gdriveStatus(includeFiles: false) {
                    await MainActor.run {
                        progress = gd.progress
                    }
                    if gd.progress?.active != true {
                        if wasActive {
                            wasActive = false
                            if gd.progress?.stage == "done" {
                                appState.showToast(gd.progress?.message ?? "Backup enviado ao Google Drive!")
                                await loadAll()
                            } else if gd.progress?.stage == "error" {
                                appState.showToast(gd.progress?.error ?? "Falha no backup.", kind: .error)
                            }
                        }
                        break
                    }
                }
            }
        }
    }

    private func handleQuickConnect(_ gd: GDriveStatusResponse) async {
        if gd.hasCredentials == true {
            do {
                let auth = try await appState.api.gdriveAuthUrl()
                if let url = URL(string: auth.url) {
                    openURL(url)
                    return
                }
            } catch {
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
        showConnectSheet = true
    }

    private func deleteRemote(_ file: GDriveRemoteFile) async {
        do {
            _ = try await appState.api.deleteGDriveFile(id: file.id)
            appState.showToast("Backup removido do Google Drive.")
            await loadAll()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func deleteLocal(_ item: LocalBackupItem) async {
        do {
            _ = try await appState.api.deleteLocalBackup(name: item.name)
            appState.showToast("Backup local excluído.")
            await loadAll()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}

// MARK: - Google Drive Options Sheet

struct GDriveOptionsSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let status: GDriveStatusResponse
    let onChanged: () -> Void

    @State private var folderName: String = ""
    @State private var scheduleHours: Int = 24
    @State private var maxBackups: Int = 10
    @State private var skipIfNoActivity: Bool = true
    @State private var busy: Bool = false
    @State private var showDisconnectConfirm: Bool = false

    private let scheduleOptions: [(Int, String)] = [
        (0, "Desativado (somente manual)"),
        (6, "A cada 6 horas"),
        (12, "A cada 12 horas"),
        (24, "Diário (a cada 24 horas)"),
        (72, "A cada 3 dias (72 horas)")
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section("Pasta & Agendamento") {
                    TextField("Nome da pasta", text: $folderName)
                    Picker("Frequência automática", selection: $scheduleHours) {
                        ForEach(scheduleOptions, id: \.0) { opt in
                            Text(opt.1).tag(opt.0)
                        }
                    }
                    Stepper("Manter últimos \(maxBackups) backups", value: $maxBackups, in: 1...100)
                    Toggle("Pular se o mundo não mudou", isOn: $skipIfNoActivity)
                        .tint(YCColors.primary)
                }

                Section("Conexão") {
                    Button {
                        Task { await testConn() }
                    } label: {
                        Label("Testar conexão com Google Drive", systemImage: "checkmark.icloud")
                    }
                    .disabled(busy)

                    Button(role: .destructive) {
                        showDisconnectConfirm = true
                    } label: {
                        Label("Desconectar conta Google", systemImage: "xmark.icloud")
                    }
                    .disabled(busy)
                }
            }
            .navigationTitle("Opções Google Drive")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Salvando…" : "Salvar") {
                        Task { await save() }
                    }
                    .disabled(busy)
                }
            }
            .confirmationDialog("Desconectar Google Drive?", isPresented: $showDisconnectConfirm, titleVisibility: .visible) {
                Button("Desconectar", role: .destructive) {
                    Task { await disconnect() }
                }
                Button("Cancelar", role: .cancel) {}
            } message: {
                Text("Os arquivos já enviados serão mantidos na nuvem, mas o backup automático será pausado.")
            }
            .onAppear {
                folderName = status.folderName ?? "YacaCode Minecraft Backups"
                scheduleHours = (status.enabled == true) ? (status.scheduleHours ?? 24) : 0
                maxBackups = status.maxBackups ?? 10
                skipIfNoActivity = status.skipIfNoActivity != false
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await appState.api.updateGDriveConfig([
                "folderName": folderName.trimmingCharacters(in: .whitespacesAndNewlines),
                "scheduleHours": scheduleHours,
                "enabled": scheduleHours > 0,
                "maxBackups": maxBackups,
                "skipIfNoActivity": skipIfNoActivity
            ])
            appState.showToast("Opções do Google Drive salvas!")
            onChanged()
            dismiss()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func testConn() async {
        busy = true
        defer { busy = false }
        do {
            let res = try await appState.api.testGDrive()
            appState.showToast("Conexão OK! Conta: \(res.status?.accountEmail ?? "Google Drive")")
            onChanged()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func disconnect() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await appState.api.disconnectGDrive()
            appState.showToast("Conta Google Drive desconectada.", kind: .warn)
            onChanged()
            dismiss()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}

struct GDriveConnectSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    let status: GDriveStatusResponse
    let onDone: () -> Void

    @State private var clientId: String = ""
    @State private var clientSecret: String = ""
    @State private var busy: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Credenciais OAuth 2.0 (Google Cloud)") {
                    TextField("Client ID", text: $clientId)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(status.hasClientSecret == true ? "Salvo (\(status.maskedClientSecret ?? ""))" : "Client Secret (GOCSPX-…)", text: $clientSecret)
                        .textInputAutocapitalization(.never)
                }

                if let uri = status.redirectUri {
                    Section("URL de Retorno") {
                        HStack {
                            Text(uri)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(YCColors.textMuted)
                            Spacer()
                            Button("Copiar") {
                                UIPasteboard.general.string = uri
                                appState.showToast("URL copiada!")
                            }
                            .font(.caption.bold())
                        }
                    }
                }
            }
            .navigationTitle("Conectar Google Drive")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Abrindo…" : "Continuar") {
                        Task { await submit() }
                    }
                    .disabled(busy)
                }
            }
            .onAppear { clientId = status.clientId ?? "" }
        }
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        do {
            var payload: [String: Any] = [:]
            if !clientId.trimmingCharacters(in: .whitespaces).isEmpty {
                payload["clientId"] = clientId.trimmingCharacters(in: .whitespaces)
            }
            if !clientSecret.trimmingCharacters(in: .whitespaces).isEmpty {
                payload["clientSecret"] = clientSecret.trimmingCharacters(in: .whitespaces)
            }
            if !payload.isEmpty {
                _ = try await appState.api.updateGDriveConfig(payload)
            }
            let auth = try await appState.api.gdriveAuthUrl()
            if let url = URL(string: auth.url) {
                openURL(url)
            }
            onDone()
            dismiss()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
