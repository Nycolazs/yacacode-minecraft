import SwiftUI

struct PlayersView: View {
    @Environment(AppState.self) private var appState

    private enum ListTab: Int, CaseIterable {
        case whitelist, ops, bans
        var title: String {
            switch self {
            case .whitelist: return "Whitelist"
            case .ops: return "OPs"
            case .bans: return "Banidos"
            }
        }
    }

    @State private var data: PlayersResponse? = nil
    @State private var isLoading: Bool = false
    @State private var broadcastText: String = ""
    @State private var selectedList: ListTab = .whitelist
    @State private var addInput: String = ""

    // Modals / Confirmations
    @State private var whisperTarget: String? = nil
    @State private var whisperMessage: String = ""
    @State private var confirmAction: (action: String, player: String, title: String)? = nil
    @State private var actionReason: String = ""

    private var isModOrAbove: Bool { appState.session?.isModeratorOrAbove == true }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    if isModOrAbove {
                        broadcastCard
                    }
                    onlinePlayersCard
                    listsManagementCard
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(YCColors.background.ignoresSafeArea())
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await loadPlayers() }
            .navigationTitle("Jogadores")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Haptics.light()
                        Task { await loadPlayers() }
                    } label: {
                        Label("Atualizar", systemImage: "arrow.clockwise")
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button {
                        KeyboardHelper.dismiss()
                    } label: {
                        Label("Ocultar teclado", systemImage: "keyboard.chevron.compact.down")
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .alert("Mensagem privada para \(whisperTarget ?? "")", isPresented: Binding(
                get: { whisperTarget != nil },
                set: { if !$0 { whisperTarget = nil; whisperMessage = "" } }
            )) {
                TextField("Digite a mensagem…", text: $whisperMessage)
                Button("Enviar") {
                    if let target = whisperTarget {
                        let msg = whisperMessage
                        whisperTarget = nil
                        whisperMessage = ""
                        Task { await runAction("whisper", player: target, message: msg) }
                    }
                }
                Button("Cancelar", role: .cancel) {
                    whisperTarget = nil
                    whisperMessage = ""
                }
            }
            .alert(confirmAction?.title ?? "Confirmar ação", isPresented: Binding(
                get: { confirmAction != nil },
                set: { if !$0 { confirmAction = nil; actionReason = "" } }
            )) {
                TextField("Motivo (opcional)", text: $actionReason)
                Button(confirmAction?.action == "ban" ? "Banir" : "Expulsar", role: .destructive) {
                    if let c = confirmAction {
                        let reason = actionReason
                        confirmAction = nil
                        actionReason = ""
                        Task { await runAction(c.action, player: c.player, reason: reason) }
                    }
                }
                Button("Cancelar", role: .cancel) {
                    confirmAction = nil
                    actionReason = ""
                }
            } message: {
                Text("Confirma executar \"\(confirmAction?.action ?? "")\" em \(confirmAction?.player ?? "")?")
            }
        }
        .task { await loadPlayers() }
    }

    // MARK: - Broadcast Card

    private var broadcastCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "megaphone.fill")
                    .foregroundStyle(YCColors.accent)
                Text("Aviso Global no Chat")
                    .font(.headline)
                    .foregroundStyle(YCColors.text)
            }
            Text("Envia uma mensagem visível para todos os jogadores Java e Bedrock conectados.")
                .font(.caption)
                .foregroundStyle(YCColors.textMuted)

            HStack(spacing: 8) {
                TextField("Ex: Reinício em 5 minutos!", text: $broadcastText)
                    .font(.subheadline)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(YCColors.background)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(YCColors.borderStrong, lineWidth: 1)
                    )

                Button {
                    let msg = broadcastText.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !msg.isEmpty else { return }
                    broadcastText = ""
                    Task { await runAction("say", message: msg) }
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(YCColors.onPrimary)
                        .frame(width: 40, height: 40)
                        .background(YCColors.primary)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .ycCard()
    }

    // MARK: - Online Players

    private var onlinePlayersCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Conectados Agora")
                        .font(.headline)
                        .foregroundStyle(YCColors.text)
                    Text("\(data?.online.count ?? 0) de \(data?.max ?? 6) jogadores")
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                }
                Spacer()
                if isLoading {
                    ProgressView().scaleEffect(0.85)
                }
            }

            if let online = data?.online, !online.isEmpty {
                VStack(spacing: 10) {
                    ForEach(online) { player in
                        onlinePlayerRow(player)
                    }
                }
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "person.slash")
                        .foregroundStyle(YCColors.textMuted)
                    Text("Nenhum jogador conectado no momento.")
                        .font(.subheadline)
                        .foregroundStyle(YCColors.textMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(YCColors.background)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .ycCard()
    }

    private func onlinePlayerRow(_ player: OnlinePlayer) -> some View {
        let skinName = player.isBedrock ? "Steve" : (player.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "Steve")
        let avatarURL = URL(string: "https://mc-heads.net/avatar/\(skinName)/64")

        return VStack(spacing: 10) {
            HStack(spacing: 12) {
                AsyncImage(url: avatarURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().interpolation(.none).scaledToFill()
                    default:
                        ZStack {
                            YCColors.surfaceElevated
                            Image(systemName: "person.fill").foregroundStyle(YCColors.textMuted)
                        }
                    }
                }
                .frame(width: 42, height: 42)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(player.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(YCColors.text)
                    YCPill(
                        text: player.isBedrock ? "BEDROCK" : "JAVA",
                        color: player.isBedrock ? YCColors.accent : YCColors.primary
                    )
                }
                Spacer()
            }

            if isModOrAbove {
                HStack(spacing: 6) {
                    playerActionPill("Msg", icon: "bubble.left.fill", color: YCColors.info) {
                        whisperTarget = player.name
                    }
                    if appState.session?.isAdmin == true {
                        playerActionPill("OP", icon: "crown.fill", color: YCColors.accent) {
                            Task { await runAction("op", player: player.name) }
                        }
                    }
                    playerActionPill("Kick", icon: "figure.walk.departure", color: YCColors.warn) {
                        confirmAction = ("kick", player.name, "Expulsar \(player.name)?")
                    }
                    playerActionPill("Ban", icon: "nosign", color: YCColors.danger) {
                        confirmAction = ("ban", player.name, "Banir \(player.name)?")
                    }
                }
            }
        }
        .padding(12)
        .background(YCColors.background)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func playerActionPill(_ title: String, icon: String, color: Color, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Label(title, systemImage: icon)
                .font(.caption2.weight(.bold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .foregroundStyle(color)
                .background(color.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Whitelist / OPs / Bans Segmented Card

    private var listsManagementCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Picker("Lista", selection: $selectedList) {
                ForEach(ListTab.allCases, id: \.self) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)

            if selectedList == .whitelist {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Whitelist do Servidor")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(YCColors.text)
                        Text(data?.whitelistEnabled == true ? "Ativada (Privado)" : "Desativada (Aberto)")
                            .font(.caption)
                            .foregroundStyle(data?.whitelistEnabled == true ? YCColors.ok : YCColors.textMuted)
                    }
                    Spacer()
                    if isModOrAbove {
                        Button(data?.whitelistEnabled == true ? "Desativar" : "Ativar") {
                            let next = data?.whitelistEnabled == true ? "whitelist-off" : "whitelist-on"
                            Task { await runAction(next) }
                        }
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(YCColors.surfaceElevated)
                        .foregroundStyle(YCColors.text)
                        .clipShape(Capsule())
                    }
                }
            }

            if isModOrAbove {
                HStack(spacing: 8) {
                    TextField(addPlaceholder, text: $addInput)
                        .font(.subheadline)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(YCColors.background)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .strokeBorder(YCColors.borderStrong, lineWidth: 1)
                        )

                    Button(addButtonTitle) {
                        let name = addInput.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !name.isEmpty else { return }
                        addInput = ""
                        switch selectedList {
                        case .whitelist:
                            Task { await runAction("whitelist-add", player: name) }
                        case .ops:
                            Task { await runAction("op", player: name) }
                        case .bans:
                            confirmAction = ("ban", name, "Banir \(name)?")
                        }
                    }
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(selectedList == .bans ? YCColors.danger : YCColors.primary)
                    .foregroundStyle(selectedList == .bans ? .white : YCColors.onPrimary)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                if selectedList == .whitelist {
                    Text("Para Bedrock (Floodgate), use ponto antes do gamertag (ex: .Steve).")
                        .font(.caption2)
                        .foregroundStyle(YCColors.textMuted)
                }
            }

            let items = currentEntities
            if items.isEmpty {
                Text(emptyListMessage)
                    .font(.footnote)
                    .foregroundStyle(YCColors.textMuted)
                    .padding(.vertical, 10)
            } else {
                VStack(spacing: 8) {
                    ForEach(items) { entity in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entity.name)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(YCColors.text)
                                if let lvl = entity.level {
                                    Text("OP Nível \(lvl)")
                                        .font(.caption2)
                                        .foregroundStyle(YCColors.accent)
                                } else if let reason = entity.reason, !reason.isEmpty {
                                    Text(reason)
                                        .font(.caption2)
                                        .foregroundStyle(YCColors.textMuted)
                                }
                            }
                            Spacer()
                            if isModOrAbove {
                                Button(removeButtonLabel) {
                                    Task { await runAction(removeActionName, player: entity.name) }
                                }
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(YCColors.danger.opacity(0.13))
                                .foregroundStyle(YCColors.danger)
                                .clipShape(Capsule())
                            }
                        }
                        .padding(11)
                        .background(YCColors.background)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                }
            }
        }
        .ycCard()
    }

    private var addPlaceholder: String {
        switch selectedList {
        case .whitelist: return "Nick Java ou .NickBedrock"
        case .ops: return "Nick para dar OP"
        case .bans: return "Nick para banir"
        }
    }

    private var addButtonTitle: String {
        switch selectedList {
        case .whitelist: return "Adicionar"
        case .ops: return "Dar OP"
        case .bans: return "Banir"
        }
    }

    private var removeButtonLabel: String {
        selectedList == .bans ? "Desbanir" : "Remover"
    }

    private var removeActionName: String {
        switch selectedList {
        case .whitelist: return "whitelist-remove"
        case .ops: return "deop"
        case .bans: return "pardon"
        }
    }

    private var currentEntities: [PlayerEntity] {
        switch selectedList {
        case .whitelist: return data?.whitelist ?? []
        case .ops: return data?.ops ?? []
        case .bans: return data?.bannedPlayers ?? []
        }
    }

    private var emptyListMessage: String {
        switch selectedList {
        case .whitelist: return "Nenhum jogador na whitelist."
        case .ops: return "Nenhum operador cadastrado."
        case .bans: return "Nenhum jogador banido."
        }
    }

    // MARK: - API Calls

    private func loadPlayers() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let res = try await appState.api.players()
            data = res
            appState.onlinePlayersCount = res.online.count
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if data == nil {
                appState.showToast("Não foi possível carregar jogadores.", kind: .warn)
            }
        }
    }

    private func runAction(_ action: String, player: String? = nil, reason: String? = nil, message: String? = nil) async {
        do {
            let res = try await appState.api.playerAction(action: action, player: player, reason: reason, message: message)
            appState.showToast(res.output?.isEmpty == false ? res.output! : "Ação \"\(action)\" executada!")
            await loadPlayers()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
