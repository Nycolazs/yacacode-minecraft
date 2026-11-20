import SwiftUI

struct OverviewView: View {
    @Environment(AppState.self) private var appState

    @State private var data: OverviewResponse? = nil
    @State private var isLoading: Bool = false
    @State private var powerBusy: Bool = false
    @State private var pendingPowerAction: String? = nil

    private var isAdmin: Bool { appState.session?.isAdmin == true }
    private var isModOrAbove: Bool { appState.session?.isModeratorOrAbove == true }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    if let overview = data {
                        heroCard(overview)
                        connectionCards(overview)
                        kpiGrid(overview)
                        TelemetryChartView(
                            points: overview.history,
                            liveStats: overview.server.stats,
                            host: overview.host
                        )
                        stackCard(overview.stack)
                    } else if isLoading {
                        VStack(spacing: 12) {
                            ProgressView().tint(YCColors.primary)
                            Text("Carregando telemetria do Orange Pi…")
                                .font(.footnote)
                                .foregroundStyle(YCColors.textMuted)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 80)
                    } else {
                        ContentUnavailableView(
                            "Sem dados do servidor",
                            systemImage: "wifi.exclamationmark",
                            description: Text("Puxe para baixo para tentar novamente.")
                        )
                        .padding(.top, 60)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(YCColors.background.ignoresSafeArea())
            .refreshable {
                await loadOverview(silent: false)
            }
            .navigationTitle("Visão Geral")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.light()
                        Task { await loadOverview(silent: false) }
                    } label: {
                        Label("Atualizar", systemImage: "arrow.clockwise")
                    }
                }
            }
            .confirmationDialog(
                pendingPowerAction == "stop" ? "Parar o servidor?" : "Reiniciar o servidor?",
                isPresented: Binding(
                    get: { pendingPowerAction != nil },
                    set: { if !$0 { pendingPowerAction = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(pendingPowerAction == "stop" ? "Parar Servidor" : "Reiniciar Agora", role: pendingPowerAction == "stop" ? .destructive : nil) {
                    if let act = pendingPowerAction {
                        pendingPowerAction = nil
                        Task { await executePower(act) }
                    }
                }
                Button("Cancelar", role: .cancel) {
                    pendingPowerAction = nil
                }
            } message: {
                Text("O painel enviará um aviso no chat e salvará o mundo antes de concluir a ação.")
            }
        }
        .task {
            await loadOverview(silent: false)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                if appState.selectedTab == .overview && appState.isAuthenticated && !appState.isBiometricLocked {
                    await loadOverview(silent: true)
                }
            }
        }
    }

    // MARK: - Hero Server Card

    private func heroCard(_ o: OverviewResponse) -> some View {
        let running = o.server.container?.running == true
        let pingOnline = o.server.ping?.online == true
        let statusText = running && pingOnline ? "Online" : running ? "Iniciando…" : "Offline"
        let statusColor = running && pingOnline ? YCColors.ok : running ? YCColors.warn : YCColors.danger

        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(YCColors.surfaceElevated)
                        .frame(width: 58, height: 58)
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .strokeBorder(YCColors.borderStrong, lineWidth: 1)
                        )
                    Image("YacaCodeLogo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 44, height: 44)
                }

                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text("\(o.server.name) MC")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(YCColors.text)
                        HStack(spacing: 5) {
                            PulsingDot(color: statusColor, active: running)
                            Text(statusText)
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(statusColor)
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(statusColor.opacity(0.15))
                        .clipShape(Capsule())
                    }

                    Text("Pumpkin Rust • v\(o.server.runningVersion) • Uptime \(Formatters.uptime(from: o.server.container?.startedAt))")
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        YCPill(text: "Java + Bedrock", color: YCColors.accent)
                        YCPill(text: o.host.arch.uppercased(), color: YCColors.info)
                        if let temp = o.host.temperature?.celsius {
                            let tColor: Color = o.host.temperature?.status == "critical"
                                ? YCColors.danger
                                : o.host.temperature?.status == "warm" ? YCColors.warn : YCColors.ok
                            YCPill(text: String(format: "%.1f°C", temp), color: tColor, icon: "thermometer.medium")
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            if isModOrAbove {
                // Power & Quick Actions
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        powerButton("Iniciar", icon: "play.fill", bg: YCColors.primary, fg: YCColors.onPrimary) {
                            Task { await executePower("start") }
                        }
                        powerButton("Reiniciar", icon: "arrow.triangle.2.circlepath", bg: YCColors.surfaceElevated, fg: YCColors.text) {
                            pendingPowerAction = "restart"
                        }
                        if isAdmin {
                            powerButton("Parar", icon: "stop.fill", bg: YCColors.danger.opacity(0.14), fg: YCColors.danger) {
                                pendingPowerAction = "stop"
                            }
                        }
                        powerButton("Salvar", icon: "externaldrive.fill", bg: YCColors.surfaceElevated, fg: YCColors.text) {
                            Task { await quickSave() }
                        }
                        if isAdmin {
                            powerButton("Backup", icon: "icloud.and.arrow.up.fill", bg: YCColors.info.opacity(0.14), fg: YCColors.info) {
                                Task { await quickBackup() }
                            }
                        }
                    }
                }
                .disabled(powerBusy)
            }
        }
        .padding(16)
        .background(
            ZStack {
                YCColors.surface
                LinearGradient(
                    colors: [YCColors.primary.opacity(0.10), .clear, YCColors.accent.opacity(0.08)],
                    startPoint: .topTrailing,
                    endPoint: .bottomLeading
                )
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(YCColors.borderStrong, lineWidth: 1)
        )
    }

    private func powerButton(_ title: String, icon: String, bg: Color, fg: Color, action: @escaping () -> Void) -> some View {
        Button(action: {
            Haptics.medium()
            action()
        }) {
            Label(title, systemImage: icon)
                .font(.caption.weight(.bold))
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(bg)
                .foregroundStyle(fg)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Connection Cards

    private func connectionCards(_ o: OverviewResponse) -> some View {
        let javaAddr = o.connection.javaPort == 25565 ? o.connection.mcDomain : "\(o.connection.mcDomain):\(o.connection.javaPort)"
        return HStack(spacing: 10) {
            connectionTile(
                edition: "JAVA",
                editionColor: YCColors.primary,
                address: javaAddr,
                detail: "Porta \(o.connection.javaPort) TCP"
            )
            connectionTile(
                edition: "BEDROCK",
                editionColor: YCColors.accent,
                address: o.connection.mcDomain,
                detail: "Porta \(o.connection.bedrockPort) UDP/TCP"
            )
        }
    }

    private func connectionTile(edition: String, editionColor: Color, address: String, detail: String) -> some View {
        Button {
            UIPasteboard.general.string = address
            appState.showToast("Copiado: \(address)")
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(edition)
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(0.8)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(editionColor.opacity(0.16))
                        .foregroundStyle(editionColor)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    Spacer()
                    Image(systemName: "doc.on.doc")
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                }
                Text(address)
                    .font(.system(.subheadline, design: .monospaced).weight(.bold))
                    .foregroundStyle(YCColors.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(detail)
                    .font(.caption2)
                    .foregroundStyle(YCColors.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .ycCard(padding: 13, cornerRadius: 16)
        }
        .buttonStyle(.plain)
    }

    // MARK: - 6 KPI Cards

    private func kpiGrid(_ o: OverviewResponse) -> some View {
        let mcMemUsedMB = o.server.stats.map { Int(round(Double($0.memUsedBytes) / (1024 * 1024))) } ?? 0
        let mcMemLimitMB = o.server.stats.map { Int(round(Double($0.memLimitBytes) / (1024 * 1024))) } ?? 768
        let mcMemPct = o.server.stats?.memPercent ?? 0

        let tpsText: String = {
            if let tps = o.server.tps {
                return String(format: "%.1f TPS", tps.tps1m)
            }
            return o.server.ping?.online == true ? "20.0*" : "--"
        }()

        let tempText = o.host.temperature?.celsius.map { String(format: "%.1f°C", $0) }
            ?? String(format: "%.1f%%", o.server.stats?.cpuPercent ?? 0)

        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            kpiCard(
                icon: "person.2.fill",
                iconColor: YCColors.primary,
                label: "Jogadores Online",
                value: "\(o.server.players.online) / \(o.server.players.max)",
                sub: "\(o.server.players.javaCount) Java • \(o.server.players.bedrockCount) Bedrock",
                progress: o.server.players.max > 0 ? Double(o.server.players.online) / Double(o.server.players.max) : nil
            )
            kpiCard(
                icon: "gauge.with.needle.fill",
                iconColor: YCColors.ok,
                label: "Desempenho",
                value: tpsText,
                sub: "Ping: \(o.server.ping?.latencyMs.map { "\($0) ms" } ?? "--")",
                progress: nil
            )
            kpiCard(
                icon: "memorychip",
                iconColor: YCColors.primary,
                label: "RAM Minecraft",
                value: "\(mcMemUsedMB) MB",
                sub: "de \(mcMemLimitMB) MB (\(String(format: "%.0f", mcMemPct))%)",
                progress: mcMemPct / 100.0
            )
            kpiCard(
                icon: "cpu",
                iconColor: YCColors.accent,
                label: "RAM Orange Pi",
                value: "\(String(format: "%.0f", o.host.memory.percent))%",
                sub: "\(Formatters.bytes(o.host.memory.usedBytes)) / \(Formatters.bytes(o.host.memory.totalBytes))",
                progress: o.host.memory.percent / 100.0
            )
            kpiCard(
                icon: "thermometer.medium",
                iconColor: YCColors.info,
                label: "CPU & Temperatura",
                value: tempText,
                sub: String(format: "CPU %.1f%% • Load %.2f", o.server.stats?.cpuPercent ?? 0, o.host.loadAvg.first ?? 0),
                progress: nil
            )
            kpiCard(
                icon: "internaldrive.fill",
                iconColor: YCColors.accent,
                label: "Armazenamento SD",
                value: o.host.disk.map { String(format: "%.0f%%", $0.percent) } ?? "--%",
                sub: o.host.disk.map { "Livre: \(Formatters.bytes($0.freeBytes))" } ?? "—",
                progress: o.host.disk.map { $0.percent / 100.0 }
            )
        }
    }

    private func kpiCard(icon: String, iconColor: Color, label: String, value: String, sub: String, progress: Double?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(iconColor)
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(YCColors.textMuted)
                    .lineLimit(1)
            }
            Text(value)
                .font(.title3.weight(.bold))
                .foregroundStyle(YCColors.text)
                .lineLimit(1)
                .minimumScaleFactor(0.8)

            if let progress {
                let clamped = min(1, max(0, progress))
                let barColor = clamped >= 0.88 ? YCColors.danger : clamped >= 0.72 ? YCColors.warn : YCColors.primary
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(YCColors.surfaceElevated)
                        Capsule()
                            .fill(barColor)
                            .frame(width: geo.size.width * clamped)
                            .animation(.easeOut(duration: 0.35), value: clamped)
                    }
                }
                .frame(height: 5)
            }

            Text(sub)
                .font(.caption2)
                .foregroundStyle(YCColors.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ycCard(padding: 13, cornerRadius: 16)
    }

    // MARK: - Docker Stack 24/7

    private func stackCard(_ services: [StackService]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Serviços 24/7 (Docker Stack)")
                    .font(.headline)
                    .foregroundStyle(YCColors.text)
                Text("Saúde automática dos containers no Orange Pi")
                    .font(.caption)
                    .foregroundStyle(YCColors.textMuted)
            }

            VStack(spacing: 8) {
                ForEach(services) { svc in
                    let dotColor = svc.running ? YCColors.ok : svc.exists ? YCColors.danger : YCColors.textMuted
                    let statusLabel = svc.running ? "Ativo" : svc.exists ? (svc.state ?? "Parado") : "Host / Inativo"

                    HStack(spacing: 10) {
                        PulsingDot(color: dotColor, active: svc.running)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(svc.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(YCColors.text)
                            Text("\(svc.container)\(svc.running ? " • \(Formatters.uptime(from: svc.startedAt))" : "")")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(YCColors.textMuted)
                        }
                        Spacer()
                        YCPill(text: statusLabel, color: dotColor)
                    }
                    .padding(11)
                    .background(YCColors.background)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
        .ycCard()
    }

    // MARK: - Actions

    private func loadOverview(silent: Bool) async {
        if !silent { isLoading = true }
        defer { if !silent { isLoading = false } }
        do {
            let res = try await appState.api.overview()
            data = res
            appState.onlinePlayersCount = res.server.players.online
            appState.serverOnline = res.server.container?.running == true && res.server.ping?.online == true
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if !silent && data == nil {
                appState.showToast("Não foi possível atualizar a visão geral.", kind: .warn)
            }
        }
    }

    private func executePower(_ action: String) async {
        powerBusy = true
        defer { powerBusy = false }
        do {
            _ = try await appState.api.serverPower(action: action)
            appState.showToast("Comando \"\(action)\" enviado ao servidor!")
            try? await Task.sleep(for: .seconds(1.5))
            await loadOverview(silent: true)
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func quickSave() async {
        powerBusy = true
        defer { powerBusy = false }
        do {
            let res = try await appState.api.runConsoleCommand("save-all")
            appState.showToast(res.output?.isEmpty == false ? res.output! : "Mundo salvo com sucesso!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func quickBackup() async {
        powerBusy = true
        defer { powerBusy = false }
        do {
            let res = try await appState.api.triggerBackupNow()
            appState.showToast(res.output ?? "Backup iniciado no Google Drive!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
