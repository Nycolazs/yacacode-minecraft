import SwiftUI

struct NetworkView: View {
    @Environment(AppState.self) private var appState

    @State private var detail: NetworkDetailResponse? = nil
    @State private var isLoading: Bool = false

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if let d = detail {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                        netCard(
                            title: "IP Público (Orange Pi)",
                            value: d.network.publicIp ?? "Indisponível",
                            sub: "Via Cloudflare Trace",
                            color: YCColors.info
                        )
                        netCard(
                            title: "DNS \(d.mcDomain)",
                            value: d.network.domainIps?.joined(separator: ", ") ?? "Sem A",
                            sub: d.network.dnsSynced == true ? "Sincronizado" : "Via VPS Relay público",
                            color: d.network.dnsSynced == true ? YCColors.ok : YCColors.accent
                        )
                        netCard(
                            title: "Cloudflare Tunnel",
                            value: (d.viaCloudflare == true || d.cloudflared?.running == true) ? "Ativo" : "Inativo",
                            sub: d.panelDomain,
                            color: (d.viaCloudflare == true || d.cloudflared?.running == true) ? YCColors.ok : YCColors.warn
                        )
                        netCard(
                            title: "Cloudflare DDNS",
                            value: d.ddns?.running == true ? "Ativo" : "Externo/VPS",
                            sub: "Rota pública fixa",
                            color: YCColors.textMuted
                        )
                    }

                    // Rules Summary
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Mapa de Rede & Portas")
                                    .font(.headline)
                                    .foregroundStyle(YCColors.text)
                                Text("Regras ativas para Java, Bedrock e Painel")
                                    .font(.caption)
                                    .foregroundStyle(YCColors.textMuted)
                            }
                            Spacer()
                            Button {
                                Haptics.light()
                                Task { await loadNetwork(refresh: true) }
                            } label: {
                                Label("Testar DNS", systemImage: "arrow.clockwise")
                                    .font(.caption.weight(.bold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(YCColors.surfaceElevated)
                                    .foregroundStyle(YCColors.text)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                        }

                        ruleRow(
                            title: "Minecraft Java Edition",
                            target: "A: \(d.mcDomain) → \(d.network.domainIps?.first ?? d.network.publicIp ?? "—")",
                            port: "\(d.javaPort)/TCP",
                            badge: "DNS Only",
                            badgeColor: YCColors.textMuted
                        )
                        ruleRow(
                            title: "Minecraft Bedrock (NetherNet)",
                            target: "A: \(d.mcDomain)",
                            port: "\(d.bedrockPort)/UDP + TCP",
                            badge: "DNS Only",
                            badgeColor: YCColors.accent
                        )
                        ruleRow(
                            title: "Painel Admin YacaCode",
                            target: "Tunnel: \(d.panelDomain)",
                            port: "HTTPS 443",
                            badge: "Proxied HTTPS",
                            badgeColor: YCColors.ok
                        )
                    }
                    .ycCard()
                } else if isLoading {
                    ProgressView().tint(YCColors.primary).padding(.top, 50)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(YCColors.background.ignoresSafeArea())
        .navigationTitle("Domínio & Cloudflare")
        .refreshable { await loadNetwork(refresh: true) }
        .task { await loadNetwork(refresh: false) }
    }

    private func netCard(title: String, value: String, sub: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(YCColors.textMuted)
            Text(value)
                .font(.system(.subheadline, design: .monospaced).bold())
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(sub)
                .font(.caption2)
                .foregroundStyle(YCColors.textMuted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .ycCard(padding: 13, cornerRadius: 15)
    }

    private func ruleRow(title: String, target: String, port: String, badge: String, badgeColor: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.subheadline.weight(.bold)).foregroundStyle(YCColors.text)
                Spacer()
                YCPill(text: badge, color: badgeColor)
            }
            Text(target)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(YCColors.textMuted)
            Text("Porta: \(port)")
                .font(.system(.caption2, design: .monospaced).bold())
                .foregroundStyle(YCColors.primary)
        }
        .padding(12)
        .background(YCColors.background)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func loadNetwork(refresh: Bool) async {
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await appState.api.networkDetail(refresh: refresh)
            if refresh { appState.showToast("DNS verificado com sucesso!") }
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if detail == nil || refresh {
                appState.showToast("Não foi possível verificar a rede.", kind: .warn)
            }
        }
    }
}
