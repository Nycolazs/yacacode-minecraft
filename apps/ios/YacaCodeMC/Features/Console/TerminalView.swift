import SwiftUI

struct TerminalView: View {
    @Environment(AppState.self) private var appState

    @State private var lines: [ConsoleLogLine] = []
    @State private var connectionState: ConnectionState = .disconnected
    @State private var containerName: String = "yacacode-mc"
    @State private var commandText: String = ""
    @State private var cmdHistory: [String] = []
    @State private var historyIndex: Int = -1
    @State private var filterText: String = ""
    @State private var showSearchBar: Bool = false
    @State private var autoScroll: Bool = true
    @State private var fontSize: CGFloat = 12.0
    @State private var streamTask: Task<Void, Never>? = nil
    @State private var sendingCommand: Bool = false
    @FocusState private var isPromptFocused: Bool
    @FocusState private var isFilterFocused: Bool

    private var isKeyboardOpen: Bool {
        isPromptFocused || isFilterFocused
    }

    private func closeKeyboard() {
        isPromptFocused = false
        isFilterFocused = false
        KeyboardHelper.dismiss()
    }

    private enum ConnectionState {
        case connecting, connected, reconnecting, disconnected, error(String)

        var label: String {
            switch self {
            case .connecting: return "Conectando…"
            case .connected: return "Conectado"
            case .reconnecting: return "Reconectando…"
            case .disconnected: return "Desconectado"
            case .error(let m): return m
            }
        }
        var color: Color {
            switch self {
            case .connected: return YCColors.termInfo
            case .connecting, .reconnecting: return YCColors.termWarn
            case .disconnected: return YCColors.termMuted
            case .error: return YCColors.termError
            }
        }
    }

    private let quickCommands = [
        "list", "tps", "save-all", "time set day", "weather clear",
        "whitelist reload", "say Olá!", "gamemode creative ", "xp query "
    ]

    private var canAccessConsole: Bool {
        appState.session?.isModeratorOrAbove == true
    }

    private var filteredLines: [ConsoleLogLine] {
        let q = filterText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return lines }
        return lines.filter { $0.text.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                YCColors.termBg.ignoresSafeArea()

                if !canAccessConsole {
                    VStack(spacing: 14) {
                        Image(systemName: "lock.rectangle.on.rectangle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(YCColors.termWarn)
                        Text("Console restrito")
                            .font(.title3.bold())
                            .foregroundStyle(YCColors.termText)
                        Text("O console ao vivo e comandos RCON requerem cargo Moderador ou Administrador.")
                            .font(.subheadline)
                            .foregroundStyle(YCColors.termMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                } else {
                    VStack(spacing: 0) {
                        // Termius Top Session Chrome
                        termiusHeaderBar

                        if showSearchBar {
                            termiusSearchBar
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }

                        // OLED Log Viewport
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(alignment: .leading, spacing: 3) {
                                    if filteredLines.isEmpty {
                                        Text(lines.isEmpty ? "Aguardando saída de logs do container \(containerName)…" : "Nenhuma linha encontrada para \"\(filterText)\"")
                                            .font(.system(size: fontSize, design: .monospaced))
                                            .foregroundStyle(YCColors.termMuted)
                                            .padding(16)
                                    } else {
                                        ForEach(filteredLines) { entry in
                                            terminalLineRow(entry)
                                                .id(entry.id)
                                        }
                                    }
                                    Color.clear.frame(height: 6).id("term-bottom")
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 8)
                            }
                            .scrollDismissesKeyboard(.interactively)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                if isKeyboardOpen {
                                    Haptics.light()
                                    closeKeyboard()
                                }
                            }
                            .onChange(of: lines.count) { _, _ in
                                if autoScroll {
                                    proxy.scrollTo("term-bottom", anchor: .bottom)
                                }
                            }
                        }

                        // Termius Snippet Strip + Keyboard Accessory + Prompt
                        termiusBottomDock
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Button("/") { commandText += "/" }
                        .font(.system(.subheadline, design: .monospaced).bold())
                    Button("-") { commandText += "-" }
                        .font(.system(.subheadline, design: .monospaced).bold())
                    Spacer()
                    Button {
                        Haptics.light()
                        closeKeyboard()
                    } label: {
                        Label("Ocultar", systemImage: "keyboard.chevron.compact.down")
                            .font(.subheadline.weight(.semibold))
                    }
                }
            }
            .preferredColorScheme(.dark)
        }
        .onAppear {
            if canAccessConsole && streamTask == nil {
                startStream()
            }
        }
        .onDisappear {
            // Keep stream only while app is active; disconnect cleanly when leaving view if desired
        }
    }

    // MARK: - Termius Header Bar

    private var termiusHeaderBar: some View {
        HStack(spacing: 10) {
            // Session pill
            HStack(spacing: 8) {
                PulsingDot(color: connectionState.color, active: isConnected)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 5) {
                        Text(containerName)
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundStyle(YCColors.termText)
                        Text("SSH/SSE")
                            .font(.system(size: 9, weight: .heavy, design: .monospaced))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1.5)
                            .background(YCColors.termCmd.opacity(0.18))
                            .foregroundStyle(YCColors.termCmd)
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                    Text("\(connectionState.label) • \(filteredLines.count) linhas")
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(YCColors.termMuted)
                }
            }

            Spacer()

            // Quick keyboard dismiss button whenever keyboard is open
            if isKeyboardOpen {
                headerIconBtn(icon: "keyboard.chevron.compact.down", active: true) {
                    Haptics.light()
                    closeKeyboard()
                }
            }

            // Search toggle
            headerIconBtn(icon: "magnifyingglass", active: showSearchBar) {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showSearchBar.toggle()
                    if !showSearchBar {
                        filterText = ""
                        isFilterFocused = false
                    }
                }
            }

            // Auto-scroll lock
            headerIconBtn(icon: autoScroll ? "arrow.down.to.line.compact" : "pause.fill", active: autoScroll) {
                Haptics.selection()
                autoScroll.toggle()
            }

            // More Menu (Font size, Copy, Clear, Reconnect)
            Menu {
                Section("Tamanho da fonte (\(Int(fontSize))pt)") {
                    Button { fontSize = min(18, fontSize + 1) } label: {
                        Label("Aumentar fonte (A+)", systemImage: "textformat.size.larger")
                    }
                    Button { fontSize = max(9, fontSize - 1) } label: {
                        Label("Diminuir fonte (A-)", systemImage: "textformat.size.smaller")
                    }
                }
                Section("Sessão") {
                    Button {
                        let dump = filteredLines.map(\.text).joined(separator: "\n")
                        UIPasteboard.general.string = dump
                        appState.showToast("Logs copiados (\(filteredLines.count) linhas).")
                    } label: {
                        Label("Copiar todos os logs", systemImage: "doc.on.doc")
                    }
                    Button {
                        Haptics.medium()
                        restartStream()
                    } label: {
                        Label("Reconectar stream", systemImage: "arrow.triangle.2.circlepath")
                    }
                    Button(role: .destructive) {
                        Haptics.light()
                        lines.removeAll()
                    } label: {
                        Label("Limpar terminal", systemImage: "trash")
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(YCColors.termText)
                    .frame(width: 32, height: 32)
                    .background(YCColors.termSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .strokeBorder(YCColors.termBorder, lineWidth: 1)
                    )
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(YCColors.termChrome)
        .overlay(alignment: .bottom) {
            Rectangle().fill(YCColors.termBorder).frame(height: 1)
        }
    }

    private func headerIconBtn(icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(active ? YCColors.termCmd : YCColors.termMuted)
                .frame(width: 32, height: 32)
                .background(active ? YCColors.termCmd.opacity(0.16) : YCColors.termSurface)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .strokeBorder(active ? YCColors.termCmd.opacity(0.45) : YCColors.termBorder, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var termiusSearchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .foregroundStyle(YCColors.termCmd)
                .font(.footnote)
            TextField("Filtrar logs (WARN, ERROR, chat, Geyser…)", text: $filterText)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(YCColors.termText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($isFilterFocused)
                .onSubmit { closeKeyboard() }
            if !filterText.isEmpty {
                Button {
                    filterText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(YCColors.termMuted)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(YCColors.termSurface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(YCColors.termBorder).frame(height: 1)
        }
    }

    // MARK: - Syntax-Highlighted Terminal Line

    private func terminalLineRow(_ entry: ConsoleLogLine) -> some View {
        let rowTint: Color = {
            switch entry.kind {
            case .error: return YCColors.termError.opacity(0.10)
            case .warn: return YCColors.termWarn.opacity(0.08)
            case .command: return YCColors.termCmd.opacity(0.09)
            default: return .clear
            }
        }()

        return Button {
            if isKeyboardOpen {
                Haptics.light()
                closeKeyboard()
            } else {
                UIPasteboard.general.string = entry.text
                appState.showToast("Linha copiada!")
            }
        } label: {
            Text(styledAttributedLine(entry))
                .font(.system(size: fontSize, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 6)
                .padding(.vertical, 2.5)
                .background(rowTint)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func styledAttributedLine(_ entry: ConsoleLogLine) -> AttributedString {
        var attr = AttributedString(entry.text)
        let baseColor: Color = {
            switch entry.kind {
            case .error: return YCColors.termError
            case .warn: return YCColors.termWarn
            case .geyser: return YCColors.termGeyser
            case .chat: return YCColors.termChat
            case .command: return YCColors.termCmd
            case .system: return YCColors.termSys
            case .info: return YCColors.termText
            case .normal: return YCColors.termText.opacity(0.9)
            }
        }()
        attr.foregroundColor = baseColor

        if entry.kind == .command {
            attr.inlinePresentationIntent = .stronglyEmphasized
        }

        // Highlight leading timestamp HH:MM:SS in muted slate
        let raw = entry.text
        if raw.count >= 8 {
            let prefix = String(raw.prefix(8))
            if prefix.range(of: #"^\d{2}:\d{2}:\d{2}$"#, options: .regularExpression) != nil,
               let range = attr.range(of: prefix) {
                attr[range].foregroundColor = YCColors.termMuted
            }
        }
        // Highlight INFO keyword in crisp emerald
        if let infoRange = attr.range(of: " INFO ") {
            attr[infoRange].foregroundColor = YCColors.termInfo
        }
        // Highlight active search filter match
        let q = filterText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty, let matchRange = attr.range(of: q, options: .caseInsensitive) {
            attr[matchRange].backgroundColor = YCColors.termWarn.opacity(0.35)
            attr[matchRange].foregroundColor = .white
        }
        return attr
    }

    // MARK: - Termius Quick Snippets & Prompt Dock

    private var termiusBottomDock: some View {
        VStack(spacing: 0) {
            Rectangle().fill(YCColors.termBorder).frame(height: 1)

            // Quick Command Snippets Strip (Termius Keyboard Bar Style)
            HStack(spacing: 0) {
                if isKeyboardOpen {
                    Button {
                        Haptics.light()
                        closeKeyboard()
                    } label: {
                        Image(systemName: "keyboard.chevron.compact.down")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(YCColors.termCmd)
                            .frame(width: 38, height: 30)
                            .background(YCColors.termCmd.opacity(0.16))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(YCColors.termCmd.opacity(0.45), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .padding(.leading, 10)
                    .padding(.vertical, 6)
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(quickCommands, id: \.self) { cmd in
                            Button {
                                Haptics.light()
                                if cmd.hasSuffix(" ") {
                                    commandText = cmd
                                    isPromptFocused = true
                                } else {
                                    Task { await sendCommand(cmd) }
                                }
                            } label: {
                                Text(cmd.trimmingCharacters(in: .whitespaces))
                                    .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(YCColors.termText)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(YCColors.termSurface)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .strokeBorder(YCColors.termBorder, lineWidth: 1)
                                    )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                }
            }
            .background(YCColors.termChrome)

            // Prompt Bar with History Up/Down
            HStack(spacing: 8) {
                Text("❯")
                    .font(.system(size: 16, weight: .black, design: .monospaced))
                    .foregroundStyle(YCColors.termCmd)

                TextField("comando (ex: time set day, op Nick)…", text: $commandText)
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(YCColors.termText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .focused($isPromptFocused)
                    .onSubmit {
                        let c = commandText.trimmingCharacters(in: .whitespacesAndNewlines)
                        commandText = ""
                        if c.isEmpty {
                            closeKeyboard()
                        } else {
                            Task { await sendCommand(c) }
                        }
                    }

                // Mobile-friendly command history arrows
                if !cmdHistory.isEmpty {
                    HStack(spacing: 4) {
                        Button {
                            Haptics.selection()
                            historyIndex = min(cmdHistory.count - 1, historyIndex + 1)
                            commandText = cmdHistory[historyIndex]
                        } label: {
                            Image(systemName: "chevron.up")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(YCColors.termMuted)
                                .frame(width: 26, height: 28)
                                .background(YCColors.termSurface)
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                        .buttonStyle(.plain)

                        Button {
                            Haptics.selection()
                            historyIndex = max(-1, historyIndex - 1)
                            commandText = historyIndex >= 0 ? cmdHistory[historyIndex] : ""
                        } label: {
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(YCColors.termMuted)
                                .frame(width: 26, height: 28)
                                .background(YCColors.termSurface)
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }

                let hasCmd = !commandText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                Button {
                    let c = commandText
                    commandText = ""
                    Task { await sendCommand(c) }
                } label: {
                    Image(systemName: sendingCommand ? "hourglass" : "return")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(hasCmd ? YCColors.onPrimary : YCColors.termMuted)
                        .frame(width: 34, height: 32)
                        .background(hasCmd ? YCColors.termCmd : YCColors.termSurface)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(!hasCmd || sendingCommand)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(YCColors.termChrome)
        }
    }

    private var isConnected: Bool {
        if case .connected = connectionState { return true }
        return false
    }

    // MARK: - SSE Stream & RCON Commands

    private func startStream() {
        streamTask?.cancel()
        streamTask = Task {
            var retryDelay: UInt64 = 2
            while !Task.isCancelled {
                await MainActor.run {
                    connectionState = retryDelay == 2 ? .connecting : .reconnecting
                }
                do {
                    for try await ev in appState.api.streamConsole(tail: 220) {
                        if Task.isCancelled { break }
                        retryDelay = 2
                        await handleSSEEvent(ev)
                    }
                } catch {
                    if Task.isCancelled || error.isCancellation { break }
                    await MainActor.run {
                        connectionState = .reconnecting
                    }
                }
                try? await Task.sleep(nanoseconds: retryDelay * 1_000_000_000)
                retryDelay = min(15, retryDelay * 2)
            }
        }
    }

    private func restartStream() {
        streamTask?.cancel()
        streamTask = nil
        startStream()
    }

    @MainActor
    private func handleSSEEvent(_ ev: SSEEvent) {
        let data = Data(ev.data.utf8)
        if ev.event == "meta" {
            if let meta = try? JSONDecoder().decode(ConsoleStreamMeta.self, from: data) {
                if meta.connected == true {
                    connectionState = .connected
                    if let c = meta.container { containerName = c }
                }
                if let err = meta.error {
                    connectionState = .error("Erro")
                    appendLine("[Painel] \(err)", kind: .error)
                }
            }
        } else if ev.event == "log" {
            if let log = try? JSONDecoder().decode(ConsoleStreamLog.self, from: data) {
                appendLine(log.line, kind: nil)
            }
        }
    }

    @MainActor
    private func appendLine(_ text: String, kind: ConsoleLogKind?) {
        let resolved = kind ?? ConsoleLogLine.classify(text)
        lines.append(ConsoleLogLine(text: text, kind: resolved, timestamp: Date()))
        if lines.count > 1200 {
            lines.removeFirst(lines.count - 1200)
        }
    }

    private func sendCommand(_ raw: String) async {
        let clean = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }

        cmdHistory.insert(clean, at: 0)
        if cmdHistory.count > 50 { cmdHistory.removeLast() }
        historyIndex = -1

        appendLine("❯ \(clean)", kind: .command)
        sendingCommand = true
        Haptics.light()
        defer { sendingCommand = false }

        do {
            let res = try await appState.api.runConsoleCommand(clean)
            if let out = res.output, !out.isEmpty {
                for l in out.components(separatedBy: "\n") where !l.isEmpty {
                    appendLine(l, kind: .system)
                }
            }
        } catch {
            appendLine("[Erro RCON] \(error.localizedDescription)", kind: .error)
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
