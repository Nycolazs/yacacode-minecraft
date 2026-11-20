package com.yacacode.minecraft.ui.manage

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.CreateNewFolder
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.KeyOff
import androidx.compose.material.icons.rounded.KeyboardHide
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.PersonAdd
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.SubdirectoryArrowLeft
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.BuildConfig
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.ToastKind
import com.yacacode.minecraft.data.FileContentResponse
import com.yacacode.minecraft.data.FileEntry
import com.yacacode.minecraft.data.NetworkDetailResponse
import com.yacacode.minecraft.data.PanelUser
import com.yacacode.minecraft.data.isCancellation
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.AppearanceMode
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import com.yacacode.minecraft.ui.theme.TermiusColors
import kotlinx.coroutines.launch

// =============================================================================
// FILE MANAGER + CODE EDITOR
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FileManagerScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var currentPath by remember { mutableStateOf("") }
    var entries by remember { mutableStateOf<List<FileEntry>>(emptyList()) }
    var isRefreshing by remember { mutableStateOf(false) }
    var editingFile by remember { mutableStateOf<FileContentResponse?>(null) }
    var editorText by remember { mutableStateOf("") }
    var savingFile by remember { mutableStateOf(false) }
    var showMkdirDialog by remember { mutableStateOf(false) }
    var newFolderName by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<FileEntry?>(null) }

    suspend fun loadDir(path: String, manual: Boolean = false) {
        isRefreshing = true
        runCatching { viewModel.api.listFiles(path) }
            .onSuccess { res -> currentPath = res.path; entries = res.entries }
            .onFailure {
                if (!it.isCancellation() && (manual || entries.isEmpty())) {
                    viewModel.showToast("Não foi possível listar arquivos.", ToastKind.WARN)
                }
            }
        isRefreshing = false
    }

    LaunchedEffect(Unit) { loadDir("") }

    val crumbs = remember(currentPath) {
        val list = mutableListOf("/data" to "")
        var acc = ""
        currentPath.split("/").filter { it.isNotEmpty() }.forEach { p ->
            acc = if (acc.isEmpty()) p else "$acc/$p"
            list.add(p to acc)
        }
        list
    }

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text("Arquivos", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            actions = {
                IconButton(onClick = { showMkdirDialog = true }) { Icon(Icons.Rounded.CreateNewFolder, contentDescription = "Nova pasta") }
                IconButton(onClick = { scope.launch { loadDir(currentPath, manual = true) } }) { Icon(Icons.Rounded.Refresh, contentDescription = "Atualizar") }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text,
                navigationIconContentColor = palette.text,
                actionIconContentColor = palette.text
            )
        )

        // Breadcrumb strip
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(palette.surface)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            crumbs.forEachIndexed { idx, (label, path) ->
                if (idx > 0) Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = palette.textMuted, modifier = Modifier.size(16.dp))
                val isLast = idx == crumbs.lastIndex
                Text(
                    label,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    fontWeight = if (isLast) FontWeight.Bold else FontWeight.Medium,
                    color = if (isLast) palette.primary else palette.text,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (isLast) palette.primary.copy(alpha = 0.16f) else palette.surfaceElevated)
                        .clickable { scope.launch { loadDir(path) } }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                )
            }
        }
        HorizontalDivider(color = palette.border)

        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { scope.launch { loadDir(currentPath, manual = true) } },
            modifier = Modifier.fillMaxSize()
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
            if (currentPath.isNotEmpty()) {
                item {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(palette.surface)
                            .clickable {
                                val parent = currentPath.split("/").dropLast(1).joinToString("/")
                                scope.launch { loadDir(parent) }
                            }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(Icons.Rounded.SubdirectoryArrowLeft, contentDescription = null, tint = palette.primary)
                        Text("Voltar para pasta anterior", color = palette.primary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    }
                }
            }

            items(entries, key = { it.path }) { entry ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(palette.surface)
                        .clickable {
                            when {
                                entry.isDirectory -> scope.launch { loadDir(entry.path) }
                                entry.editable -> scope.launch {
                                    runCatching { viewModel.api.readFile(entry.path) }
                                        .onSuccess { f -> editorText = f.content; editingFile = f }
                                        .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                                }
                            }
                        }
                        .padding(horizontal = 12.dp, vertical = 11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        imageVector = when {
                            entry.isDirectory -> Icons.Rounded.Folder
                            entry.editable -> Icons.Rounded.Description
                            else -> Icons.Rounded.Inventory2
                        },
                        contentDescription = null,
                        tint = when {
                            entry.isDirectory -> palette.accent
                            entry.editable -> palette.primary
                            else -> palette.textMuted
                        }
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            entry.name,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.Medium,
                            color = palette.text,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            if (entry.isDirectory) "Pasta • ${Formatters.dateBR(entry.mtime)}"
                            else "${Formatters.bytes(entry.size)} • ${Formatters.dateBR(entry.mtime)}",
                            fontSize = 11.sp,
                            color = palette.textMuted
                        )
                    }
                    if (!entry.isDirectory) {
                        IconButton(
                            onClick = {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(viewModel.api.fileDownloadUrl(entry.path))))
                                }
                            },
                            modifier = Modifier.size(32.dp)
                        ) { Icon(Icons.Rounded.Download, contentDescription = "Baixar", tint = palette.info, modifier = Modifier.size(18.dp)) }
                    }
                    IconButton(onClick = { deleteTarget = entry }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Rounded.Delete, contentDescription = "Excluir", tint = palette.danger, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
        }
    }

    // Full-screen Dark Code Editor Dialog
    editingFile?.let { file ->
        Dialog(
            onDismissRequest = { editingFile = null },
            properties = DialogProperties(usePlatformDefaultWidth = false)
        ) {
            val editorFocus = LocalFocusManager.current
            val editorKeyboard = LocalSoftwareKeyboardController.current
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .background(TermiusColors.Bg)
                    .statusBarsPadding()
                    .imePadding()
            ) {
                TopAppBar(
                    title = {
                        Column {
                            Text(file.path.substringAfterLast('/'), fontWeight = FontWeight.Bold, fontSize = 15.sp, color = TermiusColors.Text)
                            Text("/data/${file.path}", fontFamily = FontFamily.Monospace, fontSize = 10.5.sp, color = TermiusColors.Muted)
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = { editingFile = null }) {
                            Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Fechar", tint = TermiusColors.Text)
                        }
                    },
                    actions = {
                        IconButton(onClick = {
                            editorFocus.clearFocus()
                            editorKeyboard?.hide()
                        }) {
                            Icon(Icons.Rounded.KeyboardHide, contentDescription = "Ocultar teclado", tint = TermiusColors.Muted)
                        }
                        TextButton(
                            enabled = !savingFile,
                            onClick = {
                                editorFocus.clearFocus()
                                editorKeyboard?.hide()
                                scope.launch {
                                    savingFile = true
                                    runCatching { viewModel.api.saveFile(file.path, editorText) }
                                        .onSuccess {
                                            viewModel.showToast("Arquivo ${file.path} salvo!")
                                            editingFile = null
                                            loadDir(currentPath)
                                        }
                                        .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro ao salvar", ToastKind.ERROR) }
                                    savingFile = false
                                }
                            }
                        ) {
                            Icon(Icons.Rounded.Save, contentDescription = null, tint = TermiusColors.Cmd, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.size(4.dp))
                            Text(if (savingFile) "Salvando…" else "Salvar", color = TermiusColors.Cmd, fontWeight = FontWeight.Bold)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = TermiusColors.Chrome)
                )
                HorizontalDivider(color = TermiusColors.Border)
                Box(modifier = Modifier.fillMaxSize().padding(12.dp)) {
                    BasicTextField(
                        value = editorText,
                        onValueChange = { editorText = it },
                        textStyle = TextStyle(
                            color = TermiusColors.Text,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.5.sp,
                            lineHeight = 18.sp
                        ),
                        cursorBrush = SolidColor(TermiusColors.Cmd),
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }

    if (showMkdirDialog) {
        AlertDialog(
            onDismissRequest = { showMkdirDialog = false; newFolderName = "" },
            title = { Text("Nova Pasta") },
            text = {
                OutlinedTextField(
                    value = newFolderName,
                    onValueChange = { newFolderName = it },
                    placeholder = { Text("minha-pasta") },
                    singleLine = true
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val name = newFolderName.trim()
                    showMkdirDialog = false
                    newFolderName = ""
                    if (name.isNotEmpty()) {
                        val target = if (currentPath.isEmpty()) name else "$currentPath/$name"
                        scope.launch {
                            runCatching { viewModel.api.mkdir(target) }
                                .onSuccess { viewModel.showToast("Pasta criada!"); loadDir(currentPath) }
                                .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                        }
                    }
                }) { Text("Criar", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { showMkdirDialog = false; newFolderName = "" }) { Text("Cancelar") } }
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Excluir item?") },
            text = { Text("Excluir \"/data/${target.path}\" permanentemente?") },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget = null
                    scope.launch {
                        runCatching { viewModel.api.deleteFile(target.path) }
                            .onSuccess { viewModel.showToast("Item excluído."); loadDir(currentPath) }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                    }
                }) { Text("Excluir", color = palette.danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Cancelar") } }
        )
    }
}

// =============================================================================
// NETWORK & CLOUDFLARE SCREEN
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NetworkScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<NetworkDetailResponse?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }

    suspend fun load(refresh: Boolean) {
        isRefreshing = true
        runCatching { viewModel.api.networkDetail(refresh) }
            .onSuccess { detail = it; if (refresh) viewModel.showToast("DNS verificado!") }
            .onFailure {
                if (!it.isCancellation() && (refresh || detail == null)) {
                    viewModel.showToast("Não foi possível verificar rede.", ToastKind.WARN)
                }
            }
        isRefreshing = false
    }

    LaunchedEffect(Unit) { load(false) }

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text("Domínio & Cloudflare", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            actions = {
                IconButton(onClick = { scope.launch { load(true) } }) { Icon(Icons.Rounded.Refresh, contentDescription = "Testar DNS") }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text,
                navigationIconContentColor = palette.text,
                actionIconContentColor = palette.text
            )
        )

        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { scope.launch { load(true) } },
            modifier = Modifier.fillMaxSize()
        ) {
            val d = detail
            if (d != null) {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            NetKpi("IP Público (Orange Pi)", d.network.publicIp ?: "Indisponível", "Cloudflare Trace", palette.info, Modifier.weight(1f))
                            NetKpi(
                                "DNS ${d.mcDomain}",
                                d.network.domainIps.joinToString(", ").ifBlank { "Sem A" },
                                if (d.network.dnsSynced == true) "Sincronizado" else "Via VPS Relay público",
                                if (d.network.dnsSynced == true) palette.ok else palette.accent,
                                Modifier.weight(1f)
                            )
                        }
                    }
                    item {
                        val tunnelOn = d.viaCloudflare || d.cloudflared?.running == true
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            NetKpi("Cloudflare Tunnel", if (tunnelOn) "Ativo" else "Inativo", d.panelDomain, if (tunnelOn) palette.ok else palette.warn, Modifier.weight(1f))
                            NetKpi("Cloudflare DDNS", if (d.ddns?.running == true) "Ativo" else "VPS Fixa", "Rota pública 24/7", palette.textMuted, Modifier.weight(1f))
                        }
                    }
                    item {
                        YacaCard {
                            Text("Mapa de Rede & Portas", style = MaterialTheme.typography.titleMedium, color = palette.text)
                            Spacer(modifier = Modifier.height(10.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                NetRuleRow("Minecraft Java Edition", "A: ${d.mcDomain} → ${d.network.domainIps.firstOrNull() ?: "—"}", "${d.javaPort}/TCP", "DNS Only", palette.textMuted)
                                NetRuleRow("Minecraft Bedrock (NetherNet)", "A: ${d.mcDomain}", "${d.bedrockPort}/UDP + TCP", "DNS Only", palette.accent)
                                NetRuleRow("Painel Admin YacaCode", "Tunnel: ${d.panelDomain}", "HTTPS 443", "Proxied HTTPS", palette.ok)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NetKpi(title: String, value: String, sub: String, color: Color, modifier: Modifier) {
    val palette = LocalYacaPalette.current
    YacaCard(modifier = modifier, padding = 13.dp, cornerRadius = 15.dp) {
        Text(title, fontSize = 10.5.sp, fontWeight = FontWeight.SemiBold, color = palette.textMuted)
        Spacer(modifier = Modifier.height(4.dp))
        Text(value, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 13.sp, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(sub, fontSize = 10.5.sp, color = palette.textMuted, maxLines = 1)
    }
}

@Composable
private fun NetRuleRow(title: String, target: String, port: String, badge: String, badgeColor: Color) {
    val palette = LocalYacaPalette.current
    Column(
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(palette.background).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = palette.text)
            YacaPill(badge, badgeColor)
        }
        Text(target, fontFamily = FontFamily.Monospace, fontSize = 11.5.sp, color = palette.textMuted)
        Text("Porta: $port", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 11.sp, color = palette.primary)
    }
}

// =============================================================================
// USERS (RBAC) + CHANGE OWN PASSWORD
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsersScreen(
    uiState: AppUiState,
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val isAdmin = uiState.session?.isAdmin == true

    var users by remember { mutableStateOf<List<PanelUser>>(emptyList()) }
    var curPass by remember { mutableStateOf("") }
    var newPass by remember { mutableStateOf("") }
    var showCreateSheet by remember { mutableStateOf(false) }
    var resetTarget by remember { mutableStateOf<PanelUser?>(null) }
    var resetPassVal by remember { mutableStateOf("") }
    var deleteTarget by remember { mutableStateOf<PanelUser?>(null) }

    suspend fun loadUsers() {
        if (!isAdmin) return
        runCatching { viewModel.api.users() }
            .onSuccess { users = it.users }
            .onFailure {
                if (!it.isCancellation() && users.isEmpty()) {
                    viewModel.showToast("Não foi possível listar usuários.", ToastKind.WARN)
                }
            }
    }

    LaunchedEffect(isAdmin) { loadUsers() }

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text(if (isAdmin) "Usuários (RBAC)" else "Minha Senha", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            actions = {
                if (isAdmin) {
                    IconButton(onClick = { showCreateSheet = true }) { Icon(Icons.Rounded.PersonAdd, contentDescription = "Novo usuário") }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text,
                navigationIconContentColor = palette.text,
                actionIconContentColor = palette.text
            )
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                YacaCard {
                    Text("Alterar Minha Senha", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = curPass,
                        onValueChange = { curPass = it },
                        label = { Text("Senha atual") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newPass,
                        onValueChange = { newPass = it },
                        label = { Text("Nova senha (mín. 6 caracteres)") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        enabled = curPass.isNotEmpty() && newPass.length >= 6,
                        onClick = {
                            scope.launch {
                                runCatching { viewModel.api.changeOwnPassword(curPass, newPass) }
                                    .onSuccess {
                                        if (viewModel.secureStore.hasSavedCredentials() && viewModel.secureStore.savedUsername == uiState.session?.username) {
                                            viewModel.secureStore.savedPassword = newPass
                                        }
                                        curPass = ""; newPass = ""
                                        viewModel.showToast("Sua senha foi atualizada!")
                                    }
                                    .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Atualizar Minha Senha", fontWeight = FontWeight.Bold) }
                }
            }

            if (isAdmin) {
                item {
                    YacaCard {
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text("Contas do Painel (${users.size})", style = MaterialTheme.typography.titleMedium, color = palette.text)
                            TextButton(onClick = { showCreateSheet = true }) { Text("+ Novo") }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            users.forEach { u ->
                                val isSelf = u.username == uiState.session?.username
                                var roleMenu by remember { mutableStateOf(false) }

                                Column(
                                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(palette.background).padding(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                        Column {
                                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                                Text(u.displayName, fontWeight = FontWeight.Bold, color = palette.text)
                                                if (u.isOwner) YacaPill("Dono", palette.accent)
                                            }
                                            Text(
                                                "@${u.username}${if (isSelf) " (você)" else ""} • ${u.lastLoginAt?.let { Formatters.dateBR(it) } ?: "Nunca"}",
                                                fontSize = 11.sp,
                                                color = palette.textMuted
                                            )
                                        }
                                        YacaPill(if (u.enabled) "Ativo" else "Inativo", if (u.enabled) palette.ok else palette.danger)
                                    }

                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Box {
                                            val roleColor = when (u.role) {
                                                "admin" -> palette.accent
                                                "moderator" -> palette.info
                                                else -> palette.textMuted
                                            }
                                            YacaPill(
                                                Formatters.roleLabel(u.role),
                                                roleColor,
                                                modifier = Modifier.clickable(enabled = !u.isOwner) { roleMenu = true }
                                            )
                                            DropdownMenu(expanded = roleMenu, onDismissRequest = { roleMenu = false }) {
                                                listOf("admin", "moderator", "viewer").forEach { r ->
                                                    DropdownMenuItem(text = { Text(Formatters.roleLabel(r)) }, onClick = {
                                                        roleMenu = false
                                                        scope.launch {
                                                            runCatching { viewModel.api.updateUser(u.username, role = r) }
                                                                .onSuccess { users = it.users; viewModel.showToast("Cargo atualizado!") }
                                                                .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                                                        }
                                                    })
                                                }
                                            }
                                        }
                                        Spacer(modifier = Modifier.weight(1f))
                                        TextButton(onClick = { resetPassVal = Formatters.generateStrongPassword(); resetTarget = u }) {
                                            Text("Senha", fontSize = 12.sp)
                                        }
                                        if (!u.isOwner) {
                                            TextButton(onClick = {
                                                scope.launch {
                                                    runCatching { viewModel.api.updateUser(u.username, enabled = !u.enabled) }
                                                        .onSuccess { users = it.users; viewModel.showToast("Status atualizado.") }
                                                }
                                            }) { Text(if (u.enabled) "Desativar" else "Ativar", fontSize = 12.sp, color = palette.warn) }
                                        }
                                        if (!u.isOwner && !isSelf) {
                                            IconButton(onClick = { deleteTarget = u }, modifier = Modifier.size(30.dp)) {
                                                Icon(Icons.Rounded.Delete, contentDescription = "Excluir", tint = palette.danger, modifier = Modifier.size(18.dp))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateSheet) {
        var newU by remember { mutableStateOf("") }
        var newDisp by remember { mutableStateOf("") }
        var newRole by remember { mutableStateOf("moderator") }
        var newPwd by remember { mutableStateOf(Formatters.generateStrongPassword()) }

        ModalBottomSheet(onDismissRequest = { showCreateSheet = false }, containerColor = palette.surface) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Criar Usuário no Painel", style = MaterialTheme.typography.titleLarge, color = palette.text)
                OutlinedTextField(value = newU, onValueChange = { newU = it }, label = { Text("Usuário (ex: joao.mod)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = newDisp, onValueChange = { newDisp = it }, label = { Text("Nome de exibição") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                SimpleDropdown("Cargo (RBAC)", newRole, listOf("moderator", "viewer", "admin"), Modifier.fillMaxWidth()) { newRole = it }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = newPwd, onValueChange = { newPwd = it }, label = { Text("Senha") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { newPwd = Formatters.generateStrongPassword() }) { Text("Gerar") }
                }
                Button(
                    enabled = newU.trim().length >= 3 && newPwd.length >= 6,
                    onClick = {
                        scope.launch {
                            runCatching { viewModel.api.createUser(newU.trim(), newDisp.trim(), newRole, newPwd) }
                                .onSuccess {
                                    users = it.users
                                    showCreateSheet = false
                                    viewModel.showToast("Usuário \"$newU\" criado!")
                                }
                                .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                    modifier = Modifier.fillMaxWidth().height(48.dp)
                ) { Text("Criar Usuário", fontWeight = FontWeight.Bold) }
                Spacer(modifier = Modifier.height(16.dp))
            }
        }
    }

    resetTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { resetTarget = null },
            title = { Text("Nova senha para @${target.username}") },
            text = { OutlinedTextField(value = resetPassVal, onValueChange = { resetPassVal = it }, singleLine = true) },
            confirmButton = {
                TextButton(onClick = {
                    val pwd = resetPassVal
                    resetTarget = null
                    scope.launch {
                        runCatching { viewModel.api.updateUser(target.username, password = pwd) }
                            .onSuccess { viewModel.showToast("Senha redefinida!") }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                    }
                }) { Text("Salvar", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { resetTarget = null }) { Text("Cancelar") } }
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Excluir @${target.username}?") },
            text = { Text("A conta perderá acesso imediatamente.") },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget = null
                    scope.launch {
                        runCatching { viewModel.api.deleteUser(target.username) }
                            .onSuccess { users = it.users; viewModel.showToast("Usuário excluído.") }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                    }
                }) { Text("Excluir", color = palette.danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Cancelar") } }
        )
    }
}

// =============================================================================
// APP PREFERENCES & BIOMETRICS
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppSettingsScreen(
    uiState: AppUiState,
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text("Biometria & Preferências", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text,
                navigationIconContentColor = palette.text
            )
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            item {
                YacaCard {
                    Text("Segurança & Digital", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Spacer(modifier = Modifier.height(10.dp))
                    if (uiState.biometricAvailable) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Rounded.Fingerprint, contentDescription = null, tint = palette.primary)
                                Text("Login rápido por Digital / Biometria", color = palette.text, fontSize = 14.sp)
                            }
                            Switch(checked = uiState.biometricLoginEnabled, onCheckedChange = { viewModel.setBiometricLoginEnabled(it) })
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Rounded.Lock, contentDescription = null, tint = palette.accent)
                                Text("Exigir biometria ao reabrir o app", color = palette.text, fontSize = 14.sp)
                            }
                            Switch(checked = uiState.biometricAppLockEnabled, onCheckedChange = { viewModel.setBiometricAppLockEnabled(it) })
                        }
                    } else {
                        Text("Biometria não cadastrada neste aparelho Android.", color = palette.textMuted, fontSize = 13.sp)
                    }

                    if (uiState.hasSavedCredentials) {
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedButton(
                            onClick = { viewModel.clearSavedCredentials() },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Rounded.KeyOff, contentDescription = null, tint = palette.danger, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.size(6.dp))
                            Text("Limpar credenciais salvas no Keystore", color = palette.danger)
                        }
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        "Suas credenciais ficam criptografadas com AES-256-GCM no Android Keystore deste aparelho.",
                        fontSize = 11.sp,
                        color = palette.textMuted
                    )
                }
            }

            item {
                YacaCard {
                    Text("Aparência", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Spacer(modifier = Modifier.height(10.dp))
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        AppearanceMode.entries.forEachIndexed { idx, mode ->
                            SegmentedButton(
                                selected = uiState.appearanceMode == mode,
                                onClick = { viewModel.updateAppearance(mode) },
                                shape = SegmentedButtonDefaults.itemShape(idx, AppearanceMode.entries.size)
                            ) { Text(mode.label, fontSize = 12.sp) }
                        }
                    }
                }
            }

            item {
                val upd = uiState.updateState
                YacaCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Rounded.SystemUpdate, contentDescription = null, tint = palette.primary)
                            Text("Atualizações Automáticas", style = MaterialTheme.typography.titleMedium, color = palette.text)
                        }
                        YacaPill("v${BuildConfig.VERSION_NAME}", palette.primary)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Verifica novas versões publicadas no GitHub (${BuildConfig.GITHUB_REPO}) e instala automaticamente.",
                        fontSize = 12.sp,
                        color = palette.textMuted
                    )
                    Spacer(modifier = Modifier.height(10.dp))

                    val avail = upd.availableUpdate
                    if (avail != null) {
                        Button(
                            onClick = { viewModel.openUpdateDialog() },
                            colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Rounded.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.size(6.dp))
                            Text("Baixar e Instalar v${avail.versionName}", fontWeight = FontWeight.Bold)
                        }
                    } else {
                        OutlinedButton(
                            onClick = { viewModel.checkAppUpdates(manual = true) },
                            enabled = !upd.checking && !upd.downloading,
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            if (upd.checking) {
                                CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = palette.primary)
                                Spacer(modifier = Modifier.size(8.dp))
                                Text("Verificando no GitHub…")
                            } else {
                                Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.size(6.dp))
                                Text("Verificar atualizações agora", fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }

                    upd.upToDateMessage?.let { msg ->
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(msg, fontSize = 11.5.sp, color = palette.ok)
                    }
                    upd.error?.let { err ->
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(err, fontSize = 11.5.sp, color = palette.danger)
                    }
                }
            }

            item {
                YacaCard {
                    Text("Servidor Conectado", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(uiState.serverUrl, fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = palette.primary)
                    Text("Versão ${BuildConfig.VERSION_NAME} (Build ${BuildConfig.VERSION_CODE}) • Native Jetpack Compose", fontSize = 12.sp, color = palette.textMuted)
                }
            }
        }
    }
}
