import SwiftUI

struct AIChatView: View {
    @Environment(AppState.self) private var appState

    @State private var status: AIStatusResponse? = nil
    @State private var conversations: [AIConversationSummary] = []
    @State private var activeConversationId: String? = nil
    @State private var isSyncedLive: Bool = false
    @State private var messages: [AIChatMessage] = []
    @State private var inputText: String = ""
    @State private var isSending: Bool = false
    @State private var thinkingIndex: Int = 0
    @State private var showConfigSheet: Bool = false
    @State private var showQuickPrompts: Bool = false
    @State private var showHistorySheet: Bool = false
    @State private var expandedActionId: String? = nil
    @FocusState private var isInputFocused: Bool

    private let thinkingPhrases = [
        "Pensando…",
        "Consultando o servidor…",
        "Verificando dados ao vivo…",
        "Preparando resposta…"
    ]

    private var userName: String {
        appState.session?.displayName ?? appState.session?.username ?? "Admin"
    }

    private var canConfigure: Bool {
        status?.permissions?.canConfigure == true || appState.session?.isAdmin == true
    }

    private var canRunCommands: Bool {
        status?.permissions?.canRunCommands == true || appState.session?.isModeratorOrAbove == true
    }

    private struct QuickPrompt: Identifiable {
        let id = UUID()
        let icon: String
        let color: Color
        let title: String
        let subtitle: String
        let prompt: String
    }

    private var quickPrompts: [QuickPrompt] {
        var list: [QuickPrompt] = [
            QuickPrompt(
                icon: "person.2.wave.2.fill",
                color: YCColors.primary,
                title: "Quem tá online?",
                subtitle: "Jogadores & nível XP",
                prompt: "Quem está online agora e em qual nível de XP?"
            ),
            QuickPrompt(
                icon: "sun.max.fill",
                color: YCColors.accent,
                title: "Dia e clima limpo",
                subtitle: "time set day + clear",
                prompt: "Deixe de dia e limpe o clima agora."
            ),
            QuickPrompt(
                icon: "heart.text.square.fill",
                color: YCColors.info,
                title: "Saúde do servidor",
                subtitle: "CPU, RAM e temp",
                prompt: "Como está a saúde do servidor agora (CPU, RAM, temperatura e uptime)?"
            ),
            QuickPrompt(
                icon: "text.alignleft",
                color: YCColors.geminiViolet,
                title: "Resumo dos logs",
                subtitle: "Últimos eventos",
                prompt: "Resuma o que aconteceu nos últimos logs do servidor."
            )
        ]
        if canConfigure {
            list.append(
                QuickPrompt(
                    icon: "icloud.and.arrow.up.fill",
                    color: YCColors.ok,
                    title: "Backup agora",
                    subtitle: "Enviar ao Google Drive",
                    prompt: "Faça um backup completo do mundo para o Google Drive agora."
                )
            )
        }
        return list
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Subtle status strip when not configured or Jorge status
                statusStrip

                // Conversation Canvas (Gemini Style)
                ScrollViewReader { proxy in
                    ScrollView {
                        if messages.isEmpty && !isSending {
                            geminiWelcomeView
                                .padding(.horizontal, 20)
                                .padding(.top, 28)
                                .padding(.bottom, 24)
                        } else {
                            LazyVStack(alignment: .leading, spacing: 20) {
                                ForEach(messages) { msg in
                                    messageRow(msg)
                                        .id(msg.id)
                                }
                                if isSending {
                                    geminiThinkingRow
                                        .id("thinking-anchor")
                                }
                                Color.clear.frame(height: 8).id("bottom-anchor")
                            }
                            .padding(.horizontal, 16)
                            .padding(.top, 16)
                            .padding(.bottom, 12)
                        }
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: messages.count) { _, _ in
                        withAnimation(.easeOut(duration: 0.25)) {
                            proxy.scrollTo("bottom-anchor", anchor: .bottom)
                        }
                    }
                    .onChange(of: isSending) { _, sending in
                        if sending {
                            withAnimation(.easeOut(duration: 0.25)) {
                                proxy.scrollTo("thinking-anchor", anchor: .bottom)
                            }
                        }
                    }
                }

                // Floating Gemini-Style Composer Bar
                geminiComposerBar
            }
            .background(YCColors.background.ignoresSafeArea())
            .navigationTitle("YacaCode AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Haptics.light()
                        showHistorySheet = true
                    } label: {
                        Label("Conversas", systemImage: "clock.arrow.circlepath")
                    }
                }

                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Haptics.light()
                        Task { await createNewConversation() }
                    } label: {
                        Label("Nova conversa", systemImage: "square.and.pencil")
                    }
                    if canConfigure {
                        Button {
                            showConfigSheet = true
                        } label: {
                            Label("Configurar IA", systemImage: "slider.horizontal.3")
                        }
                    }
                }

                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button {
                        isInputFocused = false
                        KeyboardHelper.dismiss()
                    } label: {
                        Label("Ocultar teclado", systemImage: "keyboard.chevron.compact.down")
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .sheet(isPresented: $showConfigSheet) {
                if let current = status {
                    AIConfigSheet(status: current) { updated in
                        status = updated
                        appState.showToast("Configuração da IA Gemini salva!")
                    }
                }
            }
            .sheet(isPresented: $showQuickPrompts) {
                quickPromptsSheet
            }
            .sheet(isPresented: $showHistorySheet) {
                conversationHistorySheet
            }
        }
        .task {
            await loadStatus()
            await loadConversations()
            await runSyncStream()
        }
        .task(id: isSending) {
            guard isSending else { return }
            thinkingIndex = 0
            while !Task.isCancelled && isSending {
                try? await Task.sleep(for: .milliseconds(1500))
                if isSending {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        thinkingIndex = (thinkingIndex + 1) % thinkingPhrases.count
                    }
                }
            }
        }
    }

    // MARK: - Status Strip

    @ViewBuilder
    private var statusStrip: some View {
        if let s = status, !s.configured {
            HStack(spacing: 10) {
                Image(systemName: "key.fill")
                    .foregroundStyle(YCColors.warn)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Gemini API Key não configurada")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(YCColors.text)
                    Text(canConfigure ? "Toque para cadastrar sua chave do Google AI Studio." : "Peça a um Administrador para ativar a IA.")
                        .font(.caption2)
                        .foregroundStyle(YCColors.textMuted)
                }
                Spacer()
                if canConfigure {
                    Button("Configurar") { showConfigSheet = true }
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(YCColors.primary)
                        .foregroundStyle(YCColors.onPrimary)
                        .clipShape(Capsule())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(YCColors.warn.opacity(0.12))
        } else if let s = status, s.configured {
            let jorgeOn = s.inGameChatEnabled != false
            HStack(spacing: 8) {
                if isSyncedLive {
                    Circle()
                        .fill(YCColors.ok)
                        .frame(width: 6, height: 6)
                }
                Text(isSyncedLive ? "Sincronizado • \(shortModelName(s.model))" : shortModelName(s.model))
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(YCColors.textMuted)
                    .lineLimit(1)
                Spacer()
                HStack(spacing: 4) {
                    Circle()
                        .fill(jorgeOn ? YCColors.ok : YCColors.textMuted)
                        .frame(width: 6, height: 6)
                    Text(jorgeOn ? "Jorge: ON" : "Jorge: OFF")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(jorgeOn ? YCColors.ok : YCColors.textMuted)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(YCColors.surface.opacity(0.65))
        }
    }

    // MARK: - Gemini Welcome Screen

    private var geminiWelcomeView: some View {
        VStack(alignment: .leading, spacing: 26) {
            VStack(alignment: .leading, spacing: 10) {
                GeminiSparkleIcon(size: 38, spinning: false)
                    .padding(.bottom, 2)

                Text("Olá, \(userName)")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(YCColors.geminiTextGradient)

                Text("Como posso ajudar no servidor hoje?")
                    .font(.title3.weight(.medium))
                    .foregroundStyle(YCColors.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Role & Live Capability Pill
            HStack(spacing: 8) {
                YCPill(
                    text: canConfigure ? "Acesso Total (Admin)" : canRunCommands ? "Comandos (Mod)" : "Consultas (Viewer)",
                    color: canConfigure ? YCColors.accent : canRunCommands ? YCColors.info : YCColors.textMuted,
                    icon: "bolt.shield.fill"
                )
                if status?.inGameChatEnabled == true {
                    YCPill(text: "Jorge ativo no jogo", color: YCColors.ok, icon: "bubble.left.and.text.bubble.right.fill")
                }
            }

            // Gemini-Style Suggestion Cards Grid
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(quickPrompts) { item in
                    Button {
                        Haptics.light()
                        sendMessage(item.prompt)
                    } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            ZStack {
                                Circle()
                                    .fill(item.color.opacity(0.16))
                                    .frame(width: 34, height: 34)
                                Image(systemName: item.icon)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(item.color)
                            }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(YCColors.text)
                                    .multilineTextAlignment(.leading)
                                Text(item.subtitle)
                                    .font(.caption2)
                                    .foregroundStyle(YCColors.textMuted)
                                    .lineLimit(1)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(YCColors.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(YCColors.border, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Conversation Message Rows (Gemini Layout)

    @ViewBuilder
    private func messageRow(_ msg: AIChatMessage) -> some View {
        if msg.role == "user" {
            // Trailing User Prompt Bubble (Gemini-style soft surface capsule)
            HStack {
                Spacer(minLength: 44)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(msg.text)
                        .font(.body)
                        .foregroundStyle(YCColors.text)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(YCColors.surfaceElevated)
                        .clipShape(
                            UnevenRoundedRectangle(
                                topLeadingRadius: 20,
                                bottomLeadingRadius: 20,
                                bottomTrailingRadius: 6,
                                topTrailingRadius: 20,
                                style: .continuous
                            )
                        )
                        .overlay(
                            UnevenRoundedRectangle(
                                topLeadingRadius: 20,
                                bottomLeadingRadius: 20,
                                bottomTrailingRadius: 6,
                                topTrailingRadius: 20,
                                style: .continuous
                            )
                            .strokeBorder(YCColors.border, lineWidth: 1)
                        )
                    Text(msg.time)
                        .font(.caption2)
                        .foregroundStyle(YCColors.textMuted)
                }
            }
        } else {
            // Full-width Gemini AI Response Row
            HStack(alignment: .top, spacing: 12) {
                GeminiSparkleIcon(size: 22, spinning: false)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 10) {
                    // Executed Function Calls / Tools Pills
                    if !msg.actions.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(msg.actions) { action in
                                        let color: Color = action.status == "ok" ? YCColors.ok : action.status == "denied" ? YCColors.warn : YCColors.danger
                                        let icon = action.status == "ok" ? "checkmark.circle.fill" : action.status == "denied" ? "hand.raised.fill" : "exclamationmark.circle.fill"
                                        Button {
                                            withAnimation(.easeInOut(duration: 0.2)) {
                                                expandedActionId = expandedActionId == action.id ? nil : action.id
                                            }
                                        } label: {
                                            HStack(spacing: 5) {
                                                Image(systemName: icon)
                                                    .font(.caption2)
                                                Text(action.label)
                                                    .font(.caption2.weight(.semibold))
                                            }
                                            .padding(.horizontal, 9)
                                            .padding(.vertical, 5)
                                            .foregroundStyle(color)
                                            .background(color.opacity(0.13))
                                            .clipShape(Capsule())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                            }
                            if let expanded = msg.actions.first(where: { $0.id == expandedActionId }),
                               let out = expanded.output, !out.isEmpty {
                                Text(out)
                                    .font(.system(size: 11.5, design: .monospaced))
                                    .foregroundStyle(YCColors.textMuted)
                                    .padding(10)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(YCColors.surface)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(YCColors.border, lineWidth: 1)
                                    )
                            }
                        }
                    }

                    // Rich Markdown Reply
                    MarkdownMessageView(text: msg.text) { _ in
                        appState.showToast("Código copiado!")
                    }

                    // Pending 1-Click Destructive Action Confirmation Cards
                    ForEach(msg.pendingActions) { pending in
                        pendingActionCard(messageId: msg.id, pending: pending)
                    }

                    // Footer: Copy + Model + Time
                    HStack(spacing: 12) {
                        Button {
                            UIPasteboard.general.string = msg.text
                            appState.showToast("Resposta copiada!")
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.caption)
                                .foregroundStyle(YCColors.textMuted)
                        }
                        .buttonStyle(.plain)

                        Text("\(shortModelName(msg.model ?? status?.model ?? "Gemini")) • \(msg.time)")
                            .font(.caption2)
                            .foregroundStyle(YCColors.textMuted)
                    }
                    .padding(.top, 2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func pendingActionCard(messageId: String, pending: AIPendingAction) -> some View {
        let cmdDisplay = pending.command.map { "/\($0)" } ?? pending.label
        let isDone = pending.resolution == "executed"
        let isRejected = pending.resolution == "rejected"
        let borderColor = isDone ? YCColors.ok : isRejected ? YCColors.border : YCColors.warn

        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Confirmação necessária", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(isDone ? YCColors.ok : YCColors.warn)
                Spacer()
                YCPill(text: "Ação destrutiva", color: YCColors.warn)
            }

            if let reason = pending.reason, !reason.isEmpty {
                Text(reason)
                    .font(.caption)
                    .foregroundStyle(YCColors.textMuted)
            }

            Text(cmdDisplay)
                .font(.system(.footnote, design: .monospaced).weight(.semibold))
                .foregroundStyle(YCColors.termCmd)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(YCColors.termBg)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            if isDone {
                Label("Executado\(pending.resolvedOutput.map { ": \($0)" } ?? "")", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(YCColors.ok)
            } else if isRejected {
                Label("Ação cancelada pelo usuário.", systemImage: "xmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(YCColors.textMuted)
            } else {
                HStack(spacing: 10) {
                    Button {
                        Haptics.medium()
                        Task { await resolvePending(messageId: messageId, actionId: pending.id, decision: "approve") }
                    } label: {
                        Text("Confirmar e executar")
                            .font(.caption.weight(.bold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(YCColors.danger)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    Button {
                        Haptics.light()
                        Task { await resolvePending(messageId: messageId, actionId: pending.id, decision: "reject") }
                    } label: {
                        Text("Cancelar")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(YCColors.surfaceElevated)
                            .foregroundStyle(YCColors.text)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(14)
        .background(YCColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(borderColor.opacity(0.55), lineWidth: 1.2)
        )
    }

    // MARK: - Gemini Animated Thinking Row

    private var geminiThinkingRow: some View {
        HStack(alignment: .top, spacing: 12) {
            GeminiSparkleIcon(size: 22, spinning: true)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 10) {
                Text(thinkingPhrases[thinkingIndex])
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(YCColors.geminiTextGradient)
                    .contentTransition(.numericText())

                // Gemini-like shimmer skeleton bars
                VStack(alignment: .leading, spacing: 7) {
                    GeminiShimmerBar(widthFraction: 0.92)
                    GeminiShimmerBar(widthFraction: 0.74)
                    GeminiShimmerBar(widthFraction: 0.48)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Floating Gemini Composer Bar

    private var geminiComposerBar: some View {
        VStack(spacing: 0) {
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    Haptics.light()
                    showQuickPrompts = true
                } label: {
                    Image(systemName: "plus")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(YCColors.textMuted)
                        .frame(width: 34, height: 34)
                        .background(YCColors.surfaceElevated)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)

                TextField("Pergunte ao Gemini sobre o servidor…", text: $inputText, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.body)
                    .focused($isInputFocused)
                    .padding(.vertical, 6)

                let canSend = !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
                Button {
                    sendCurrentInput()
                } label: {
                    Image(systemName: isSending ? "ellipsis" : "arrow.up")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(canSend ? .white : YCColors.textMuted)
                        .frame(width: 34, height: 34)
                        .background(
                            Group {
                                if canSend {
                                    YCColors.geminiGradient
                                } else {
                                    YCColors.surfaceElevated
                                }
                            }
                        )
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(YCColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .strokeBorder(isInputFocused ? YCColors.primary.opacity(0.6) : YCColors.borderStrong, lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.14), radius: 12, y: 4)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .background(YCColors.background)
    }

    private var quickPromptsSheet: some View {
        NavigationStack {
            List {
                Section("Sugestões rápidas para o servidor") {
                    ForEach(quickPrompts) { item in
                        Button {
                            showQuickPrompts = false
                            sendMessage(item.prompt)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: item.icon)
                                    .foregroundStyle(item.color)
                                    .frame(width: 24)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title).foregroundStyle(YCColors.text).fontWeight(.semibold)
                                    Text(item.prompt).font(.caption).foregroundStyle(YCColors.textMuted)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Atalhos IA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar") { showQuickPrompts = false }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var conversationHistorySheet: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        showHistorySheet = false
                        Task { await createNewConversation() }
                    } label: {
                        Label("Nova conversa", systemImage: "plus.bubble.fill")
                            .fontWeight(.semibold)
                            .foregroundStyle(YCColors.primary)
                    }
                }

                Section(header: Text("Salvas em @\(appState.session?.username ?? "conta") • PC & Celular")) {
                    if conversations.isEmpty {
                        Text("Nenhuma conversa salva ainda.")
                            .foregroundStyle(YCColors.textMuted)
                            .font(.subheadline)
                    } else {
                        ForEach(conversations) { conv in
                            let isActive = conv.id == activeConversationId
                            Button {
                                showHistorySheet = false
                                Task { await selectConversation(conv.id) }
                            } label: {
                                HStack(spacing: 10) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(conv.title)
                                            .font(.subheadline.weight(isActive ? .bold : .medium))
                                            .foregroundStyle(isActive ? YCColors.primary : YCColors.text)
                                            .lineLimit(1)
                                        Text("\(conv.messageCount ?? 0) msg • \(Formatters.dateBR(conv.updatedAt))")
                                            .font(.caption2)
                                            .foregroundStyle(YCColors.textMuted)
                                    }
                                    Spacer()
                                    if isActive {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundStyle(YCColors.primary)
                                    }
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await deleteConversation(conv.id) }
                                } label: {
                                    Label("Excluir", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Conversas Salvas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fechar") { showHistorySheet = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - Networking & Real-Time Sync

    private func loadStatus() async {
        do {
            status = try await appState.api.aiStatus()
        } catch {
            // silent initial load failure
        }
    }

    private func loadConversations() async {
        do {
            let data = try await appState.api.aiConversations()
            conversations = data.conversations
            let targetId = activeConversationId.flatMap { cur in
                data.conversations.contains(where: { $0.id == cur }) ? cur : nil
            } ?? data.activeConversationId

            if !isSending {
                if let targetId {
                    if let active = data.activeConversation, active.id == targetId {
                        activeConversationId = targetId
                        messages = (active.messages ?? []).map { $0.toChatMessage() }
                    } else if let detail = try? await appState.api.aiConversation(id: targetId, select: false) {
                        activeConversationId = targetId
                        messages = (detail.conversation.messages ?? []).map { $0.toChatMessage() }
                    }
                } else {
                    activeConversationId = nil
                    messages = []
                }
            }
        } catch {
            // silent sync failure
        }
    }

    private func runSyncStream() async {
        while !Task.isCancelled {
            do {
                let stream = appState.api.streamAiEvents()
                for try await ev in stream {
                    if Task.isCancelled { break }
                    if ev.event == "connected" {
                        isSyncedLive = true
                    } else if ev.event == "sync", !isSending {
                        await loadConversations()
                    }
                }
            } catch {
                // reconnect silently
            }
            isSyncedLive = false
            if Task.isCancelled { break }
            try? await Task.sleep(for: .seconds(4))
        }
    }

    private func selectConversation(_ id: String) async {
        guard !isSending else { return }
        do {
            let detail = try await appState.api.aiConversation(id: id, select: true)
            activeConversationId = detail.conversation.id
            messages = (detail.conversation.messages ?? []).map { $0.toChatMessage() }
        } catch {
            if !error.isCancellation {
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
    }

    private func createNewConversation() async {
        guard !isSending else { return }
        do {
            let created = try await appState.api.aiCreateConversation()
            conversations = created.conversations
            activeConversationId = created.conversation?.id ?? created.activeConversationId
            withAnimation { messages.removeAll() }
        } catch {
            if !error.isCancellation {
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
    }

    private func deleteConversation(_ id: String) async {
        guard !isSending else { return }
        do {
            let res = try await appState.api.aiDeleteConversation(id: id)
            conversations = res.conversations
            activeConversationId = res.activeConversationId
            messages = (res.activeConversation?.messages ?? []).map { $0.toChatMessage() }
            appState.showToast("Conversa excluída.")
        } catch {
            if !error.isCancellation {
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
    }

    private func sendCurrentInput() {
        let clean = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        inputText = ""
        isInputFocused = false
        sendMessage(clean)
    }

    private func sendMessage(_ text: String) {
        guard !isSending else { return }
        if let s = status, !s.configured {
            appState.showToast("Configure a Gemini API Key primeiro.", kind: .warn)
            if canConfigure { showConfigSheet = true }
            return
        }

        let history = messages.suffix(14).map { AIChatHistoryItem(role: $0.role, text: $0.text) }
        let targetConvId = activeConversationId
        messages.append(
            AIChatMessage(role: "user", text: text, model: nil, actions: [], pendingActions: [], time: Formatters.nowHHMM())
        )
        isSending = true
        Haptics.light()

        Task {
            defer { isSending = false }
            do {
                let res = try await appState.api.aiChat(message: text, history: history, conversationId: targetConvId)
                if let cid = res.conversationId {
                    activeConversationId = cid
                }
                let replyMsg = res.assistantMessage?.toChatMessage() ?? AIChatMessage(
                    role: "model",
                    text: res.reply,
                    model: res.model ?? status?.model,
                    actions: res.actions ?? [],
                    pendingActions: res.pendingActions ?? [],
                    time: Formatters.nowHHMM()
                )
                messages.append(replyMsg)
                Haptics.success()
                await loadConversations()
            } catch {
                if error.isCancellation { return }
                messages.append(
                    AIChatMessage(
                        role: "model",
                        text: "Não consegui concluir: \(error.localizedDescription)",
                        model: status?.model,
                        actions: [AIActionLog(tool: nil, command: nil, label: "Erro na solicitação", status: "error", output: error.localizedDescription)],
                        pendingActions: [],
                        time: Formatters.nowHHMM()
                    )
                )
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
    }

    private func resolvePending(messageId: String, actionId: String, decision: String) async {
        do {
            let res = try await appState.api.aiConfirm(actionId: actionId, decision: decision)
            if let mIdx = messages.firstIndex(where: { $0.id == messageId }),
               let pIdx = messages[mIdx].pendingActions.firstIndex(where: { $0.id == actionId }) {
                messages[mIdx].pendingActions[pIdx].resolution = res.status
                messages[mIdx].pendingActions[pIdx].resolvedOutput = res.output ?? res.summary
            }
            appState.showToast(res.summary ?? "Ação processada.", kind: res.status == "executed" ? .ok : .warn)
        } catch {
            if !error.isCancellation {
                appState.showToast(error.localizedDescription, kind: .error)
            }
        }
    }

    private func shortModelName(_ raw: String) -> String {
        raw.replacingOccurrences(of: "gemini-", with: "Gemini ")
            .replacingOccurrences(of: "-flash-lite", with: " Flash-Lite")
            .replacingOccurrences(of: "-flash", with: " Flash")
    }
}

// MARK: - Gemini Animated Sparkle & Shimmer

struct GeminiSparkleIcon: View {
    let size: CGFloat
    let spinning: Bool
    @State private var angle: Double = 0

    var body: some View {
        Image(systemName: "sparkle")
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(YCColors.geminiGradient)
            .rotationEffect(.degrees(spinning ? angle : 0))
            .onAppear {
                if spinning { startSpin() }
            }
            .onChange(of: spinning) { _, active in
                if active { startSpin() } else { angle = 0 }
            }
    }

    private func startSpin() {
        angle = 0
        withAnimation(.linear(duration: 2.2).repeatForever(autoreverses: false)) {
            angle = 360
        }
    }
}

struct GeminiShimmerBar: View {
    let widthFraction: CGFloat
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            YCColors.geminiBlue.opacity(0.18),
                            YCColors.geminiViolet.opacity(0.35),
                            YCColors.primary.opacity(0.22),
                            YCColors.geminiBlue.opacity(0.18)
                        ],
                        startPoint: UnitPoint(x: phase, y: 0.5),
                        endPoint: UnitPoint(x: phase + 1.2, y: 0.5)
                    )
                )
                .frame(width: geo.size.width * widthFraction)
        }
        .frame(height: 11)
        .onAppear {
            withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) {
                phase = 1.0
            }
        }
    }
}

// MARK: - Admin AI Configuration Sheet

struct AIConfigSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let status: AIStatusResponse
    let onSaved: (AIStatusResponse) -> Void

    @State private var apiKey: String = ""
    @State private var selectedModel: String = ""
    @State private var inGameChatEnabled: Bool = true
    @State private var saving: Bool = false

    private var models: [AIModelOption] {
        if let list = status.availableModels, !list.isEmpty {
            return list
        }
        return [
            AIModelOption(id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (Recomendado)"),
            AIModelOption(id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite"),
            AIModelOption(id: "gemini-3.8-flash", label: "Gemini 3.8 Flash")
        ]
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Chave API do Google AI Studio") {
                    if status.configured {
                        HStack {
                            Text("Chave atual (\(status.source ?? "painel"))")
                                .foregroundStyle(YCColors.textMuted)
                            Spacer()
                            Text(status.maskedKey ?? "Configurada")
                                .font(.system(.caption, design: .monospaced))
                        }
                    }
                    SecureField("AIzaSy… (vazio para manter atual)", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Modelo Gemini") {
                    Picker("Modelo ativo", selection: $selectedModel) {
                        ForEach(models) { m in
                            Text(m.label).tag(m.id)
                        }
                    }
                }

                Section {
                    Toggle("Bot Jorge no chat global do jogo", isOn: $inGameChatEnabled)
                        .tint(YCColors.primary)

                    if let stats = status.inGameChat {
                        HStack {
                            Text("Status da ponte")
                            Spacer()
                            YCPill(
                                text: stats.connected == true ? "Conectado" : "Offline",
                                color: stats.connected == true ? YCColors.ok : YCColors.warn
                            )
                        }
                        HStack {
                            Text("Perguntas respondidas")
                            Spacer()
                            Text("\(stats.totalAnswered ?? 0)").foregroundStyle(YCColors.textMuted)
                        }
                    }
                } header: {
                    Text("Jorge In-Game")
                } footer: {
                    Text("O Jorge responde no chat global apenas quando jogadores chamam por \"Jorge\" — sem executar comandos no servidor.")
                }
            }
            .navigationTitle("Configurar IA Gemini")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Salvando…" : "Salvar") {
                        Task { await save() }
                    }
                    .disabled(saving)
                }
            }
            .onAppear {
                selectedModel = status.model
                inGameChatEnabled = status.inGameChatEnabled != false
            }
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let updated = try await appState.api.updateAiConfig(
                apiKey: apiKey.isEmpty ? nil : apiKey,
                model: selectedModel,
                inGameChatEnabled: inGameChatEnabled
            )
            onSaved(updated)
            dismiss()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
