import SwiftUI

struct UsersView: View {
    @Environment(AppState.self) private var appState

    @State private var users: [PanelUser] = []
    @State private var isLoading: Bool = false

    // Own password
    @State private var currentPassword: String = ""
    @State private var newOwnPassword: String = ""
    @State private var changingOwnPass: Bool = false

    // Admin create user
    @State private var showCreateSheet: Bool = false
    @State private var resetPassTarget: PanelUser? = nil
    @State private var resetPassValue: String = ""
    @State private var deleteTarget: PanelUser? = nil

    private var isAdmin: Bool { appState.session?.isAdmin == true }

    var body: some View {
        List {
            // Change Own Password (all roles)
            Section("Alterar Minha Senha") {
                SecureField("Senha atual", text: $currentPassword)
                SecureField("Nova senha (mín. 6 caracteres)", text: $newOwnPassword)
                Button {
                    Task { await changeOwnPassword() }
                } label: {
                    HStack {
                        Spacer()
                        Text(changingOwnPass ? "Atualizando…" : "Atualizar Minha Senha")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(changingOwnPass || currentPassword.isEmpty || newOwnPassword.count < 6)
            }

            if isAdmin {
                Section {
                    if users.isEmpty && isLoading {
                        ProgressView()
                    } else {
                        ForEach(users) { user in
                            userRow(user)
                        }
                    }
                } header: {
                    HStack {
                        Text("Contas com Acesso (\(users.count))")
                        Spacer()
                        Button("+ Novo") { showCreateSheet = true }
                            .font(.caption.bold())
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(YCColors.background.ignoresSafeArea())
        .navigationTitle(isAdmin ? "Usuários (RBAC)" : "Minha Senha")
        .refreshable { if isAdmin { await loadUsers() } }
        .toolbar {
            if isAdmin {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showCreateSheet = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                }
            }
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateUserSheet {
                Task { await loadUsers() }
            }
        }
        .alert("Nova senha para @\(resetPassTarget?.username ?? "")", isPresented: Binding(
            get: { resetPassTarget != nil },
            set: { if !$0 { resetPassTarget = nil; resetPassValue = "" } }
        )) {
            TextField("Nova senha (mín. 6 chars)", text: $resetPassValue)
            Button("Salvar") {
                if let target = resetPassTarget {
                    let pass = resetPassValue
                    resetPassTarget = nil
                    resetPassValue = ""
                    Task { await resetPassword(target, newPass: pass) }
                }
            }
            Button("Cancelar", role: .cancel) {
                resetPassTarget = nil
                resetPassValue = ""
            }
        }
        .confirmationDialog("Excluir @\(deleteTarget?.username ?? "")?", isPresented: Binding(
            get: { deleteTarget != nil },
            set: { if !$0 { deleteTarget = nil } }
        ), titleVisibility: .visible) {
            Button("Excluir Usuário", role: .destructive) {
                if let target = deleteTarget {
                    deleteTarget = nil
                    Task { await deleteUser(target) }
                }
            }
            Button("Cancelar", role: .cancel) { deleteTarget = nil }
        } message: {
            Text("A conta perderá o acesso ao painel imediatamente.")
        }
        .task {
            if isAdmin { await loadUsers() }
        }
    }

    private func userRow(_ u: PanelUser) -> some View {
        let isSelf = u.username == appState.session?.username

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(u.displayName)
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(YCColors.text)
                        if u.isOwner {
                            YCPill(text: "Dono", color: YCColors.accent)
                        }
                    }
                    Text("@\(u.username)\(isSelf ? " (você)" : "") • Último acesso: \(u.lastLoginAt != nil ? Formatters.dateBR(u.lastLoginAt) : "Nunca")")
                        .font(.caption2)
                        .foregroundStyle(YCColors.textMuted)
                }
                Spacer()
                YCPill(text: u.enabled ? "Ativo" : "Inativo", color: u.enabled ? YCColors.ok : YCColors.danger)
            }

            HStack(spacing: 8) {
                if !u.isOwner {
                    Menu {
                        ForEach(["admin", "moderator", "viewer"], id: \.self) { role in
                            Button(Formatters.roleLabel(role)) {
                                Task { await changeRole(u, role: role) }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(Formatters.roleLabel(u.role))
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 9))
                        }
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Formatters.roleColor(u.role).opacity(0.15))
                        .foregroundStyle(Formatters.roleColor(u.role))
                        .clipShape(Capsule())
                    }
                } else {
                    YCPill(text: "Administrador", color: YCColors.accent)
                }

                Spacer()

                Button("Nova Senha") {
                    resetPassValue = Formatters.generateStrongPassword()
                    resetPassTarget = u
                }
                .font(.caption.weight(.semibold))
                .buttonStyle(.borderless)

                if !u.isOwner {
                    Button(u.enabled ? "Desativar" : "Ativar") {
                        Task { await toggleUser(u) }
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(YCColors.warn)
                    .buttonStyle(.borderless)
                }

                if !u.isOwner && !isSelf {
                    Button {
                        deleteTarget = u
                    } label: {
                        Image(systemName: "trash").foregroundStyle(YCColors.danger)
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func loadUsers() async {
        isLoading = true
        defer { isLoading = false }
        do {
            users = try await appState.api.users().users
        } catch {
            if error.isCancellation || Task.isCancelled { return }
            if users.isEmpty {
                appState.showToast("Não foi possível listar usuários.", kind: .warn)
            }
        }
    }

    private func changeOwnPassword() async {
        changingOwnPass = true
        defer { changingOwnPass = false }
        do {
            _ = try await appState.api.changeOwnPassword(currentPassword: currentPassword, newPassword: newOwnPassword)
            if KeychainStore.hasSavedCredentials(), appState.savedUsername == appState.session?.username {
                KeychainStore.set(newOwnPassword, for: .password)
            }
            currentPassword = ""
            newOwnPassword = ""
            appState.showToast("Sua senha foi atualizada!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func changeRole(_ user: PanelUser, role: String) async {
        do {
            let res = try await appState.api.updateUser(username: user.username, role: role)
            users = res.users
            appState.showToast("Cargo de @\(user.username) atualizado!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func toggleUser(_ user: PanelUser) async {
        do {
            let res = try await appState.api.updateUser(username: user.username, enabled: !user.enabled)
            users = res.users
            appState.showToast("Conta @\(user.username) \(user.enabled ? "desativada" : "ativada").")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func resetPassword(_ user: PanelUser, newPass: String) async {
        do {
            _ = try await appState.api.updateUser(username: user.username, password: newPass)
            appState.showToast("Senha de @\(user.username) redefinida!")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }

    private func deleteUser(_ user: PanelUser) async {
        do {
            let res = try await appState.api.deleteUser(username: user.username)
            users = res.users
            appState.showToast("Usuário @\(user.username) excluído.")
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}

struct CreateUserSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let onCreated: () -> Void

    @State private var username: String = ""
    @State private var displayName: String = ""
    @State private var role: String = "moderator"
    @State private var password: String = ""
    @State private var creating: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Dados da Nova Conta") {
                    TextField("Usuário (ex: joao.mod)", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Nome de exibição", text: $displayName)
                    Picker("Permissão (RBAC)", selection: $role) {
                        Text("Moderador").tag("moderator")
                        Text("Visualizador").tag("viewer")
                        Text("Administrador").tag("admin")
                    }
                }
                Section("Senha (hash scrypt)") {
                    HStack {
                        TextField("Senha forte (mín. 6 chars)", text: $password)
                            .font(.system(.body, design: .monospaced))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("Gerar") {
                            password = Formatters.generateStrongPassword()
                        }
                        .font(.caption.bold())
                    }
                }
            }
            .navigationTitle("Novo Usuário")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(creating ? "Criando…" : "Criar") {
                        Task { await create() }
                    }
                    .disabled(creating || username.count < 3 || password.count < 6)
                }
            }
        }
    }

    private func create() async {
        creating = true
        defer { creating = false }
        do {
            _ = try await appState.api.createUser(
                username: username.trimmingCharacters(in: .whitespaces),
                displayName: displayName.trimmingCharacters(in: .whitespaces),
                role: role,
                password: password
            )
            appState.showToast("Usuário \"\(username)\" criado!")
            onCreated()
            dismiss()
        } catch {
            appState.showToast(error.localizedDescription, kind: .error)
        }
    }
}
