package com.yacacode.minecraft.ui.manage

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.FolderZip
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.ToastKind
import com.yacacode.minecraft.data.GDriveProgress
import com.yacacode.minecraft.data.GDriveRemoteFile
import com.yacacode.minecraft.data.GDriveStatusResponse
import com.yacacode.minecraft.data.LocalBackupItem
import com.yacacode.minecraft.data.isCancellation
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupsScreen(
    uiState: AppUiState,
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current

    val gdrive = uiState.gdriveStatus
    val localBackups = uiState.localBackups
    val progress = uiState.backupProgress
    val isRefreshing = uiState.backupsRefreshing
    var showOptionsSheet by remember { mutableStateOf(false) }
    var deleteRemoteTarget by remember { mutableStateOf<GDriveRemoteFile?>(null) }
    var deleteLocalTarget by remember { mutableStateOf<LocalBackupItem?>(null) }

    val isAdmin = gdrive?.canConfigure == true || uiState.session?.isAdmin == true

    LaunchedEffect(Unit) {
        viewModel.refreshBackups(silent = uiState.gdriveStatus != null)
    }

    fun openExternalUrl(url: String) {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text("Backups (Google Drive)", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            actions = {
                IconButton(onClick = { viewModel.refreshBackups(silent = false) }) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Atualizar")
                }
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
            onRefresh = { viewModel.refreshBackups(silent = false) },
            modifier = Modifier.fillMaxSize()
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                val gd = gdrive
                if (gd == null && isRefreshing) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = palette.primary)
                        }
                    }
                } else if (gd != null) {
                    if (gd.connected) {
                        item {
                            ConnectedDriveCard(
                                gd = gd,
                                activeProgress = progress ?: gd.progress,
                                isAdmin = isAdmin,
                                onBackupNow = {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    viewModel.triggerBackupNow()
                                },
                                onOpenFolder = { gd.folderUrl?.let { openExternalUrl(it) } },
                                onOpenOptions = { showOptionsSheet = true }
                            )
                        }

                        item {
                            val files = gd.remoteFiles.orEmpty()
                            val totalBytes = files.sumOf { it.size }
                            YacaCard {
                                Text("Backups Salvos no Google Drive", style = MaterialTheme.typography.titleMedium, color = palette.text)
                                Text(
                                    "${files.size} backup(s) • ${Formatters.bytes(totalBytes)} • Retenção máx. ${gd.maxBackups}",
                                    fontSize = 12.sp,
                                    color = palette.textMuted
                                )
                                Spacer(modifier = Modifier.height(10.dp))
                                if (files.isEmpty()) {
                                    Text("Nenhum backup no Drive ainda.", fontSize = 13.sp, color = palette.textMuted)
                                } else {
                                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        files.forEach { f ->
                                            Row(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .clip(RoundedCornerShape(12.dp))
                                                    .background(palette.background)
                                                    .padding(11.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                                            ) {
                                                Icon(Icons.Rounded.FolderZip, contentDescription = null, tint = palette.info)
                                                Column(modifier = Modifier.weight(1f)) {
                                                    Text(
                                                        f.name,
                                                        fontFamily = FontFamily.Monospace,
                                                        fontSize = 12.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        color = palette.text,
                                                        maxLines = 1,
                                                        overflow = TextOverflow.Ellipsis
                                                    )
                                                    Text(
                                                        "${Formatters.dateBR(f.createdTime)} • ${Formatters.bytes(f.size)}",
                                                        fontSize = 11.sp,
                                                        color = palette.textMuted
                                                    )
                                                }
                                                f.webViewLink?.let { url ->
                                                    IconButton(onClick = { openExternalUrl(url) }, modifier = Modifier.size(34.dp)) {
                                                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = "Abrir", tint = palette.primary, modifier = Modifier.size(18.dp))
                                                    }
                                                }
                                                if (isAdmin) {
                                                    IconButton(onClick = { deleteRemoteTarget = f }, modifier = Modifier.size(34.dp)) {
                                                        Icon(Icons.Rounded.Delete, contentDescription = "Excluir", tint = palette.danger, modifier = Modifier.size(18.dp))
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        item {
                            YacaCard(padding = 20.dp) {
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(Icons.Rounded.CloudUpload, contentDescription = null, tint = palette.info, modifier = Modifier.size(44.dp))
                                    Text("Backup automático no Google Drive", style = MaterialTheme.typography.titleMedium, color = palette.text)
                                    Text(
                                        "Envie cópias seguras do mundo direto para o seu Google Drive pessoal — zero espaço ocupado no Orange Pi.",
                                        fontSize = 13.sp,
                                        color = palette.textMuted
                                    )
                                    if (isAdmin && gd.hasCredentials) {
                                        Button(
                                            onClick = {
                                                scope.launch {
                                                    runCatching { viewModel.api.gdriveAuthUrl() }
                                                        .onSuccess { if (it.url.isNotBlank()) openExternalUrl(it.url) }
                                                        .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro OAuth", ToastKind.ERROR) }
                                                }
                                            },
                                            colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                                            modifier = Modifier.fillMaxWidth()
                                        ) { Text("Conectar com Google Drive", fontWeight = FontWeight.Bold) }
                                    }
                                }
                            }
                        }
                    }
                }

                if (localBackups.isNotEmpty()) {
                    item {
                        YacaCard {
                            Text("Backups Locais Residuais", style = MaterialTheme.typography.titleMedium, color = palette.text)
                            Spacer(modifier = Modifier.height(8.dp))
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                localBackups.forEach { b ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(palette.background)
                                            .padding(10.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(b.name, fontFamily = FontFamily.Monospace, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.text)
                                            Text("${Formatters.dateBR(b.mtime)} • ${Formatters.bytes(b.size)}", fontSize = 11.sp, color = palette.textMuted)
                                        }
                                        if (isAdmin && gdrive?.connected == true) {
                                            TextButton(onClick = {
                                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                                viewModel.syncLocalBackupToDrive(b.name)
                                            }) { Text("☁ Drive", fontSize = 12.sp) }
                                        }
                                        if (isAdmin) {
                                            IconButton(onClick = { deleteLocalTarget = b }) {
                                                Icon(Icons.Rounded.Delete, contentDescription = "Excluir", tint = palette.danger)
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

    if (showOptionsSheet && gdrive != null) {
        GDriveOptionsBottomSheet(
            gd = gdrive,
            onDismiss = { showOptionsSheet = false },
            onSave = { folder, hours, maxB, skipIdle ->
                scope.launch {
                    try {
                        viewModel.api.updateGDriveConfig(
                            mapOf(
                                "folderName" to JsonPrimitive(folder),
                                "scheduleHours" to JsonPrimitive(hours),
                                "enabled" to JsonPrimitive(hours > 0),
                                "maxBackups" to JsonPrimitive(maxB),
                                "skipIfNoActivity" to JsonPrimitive(skipIdle)
                            )
                        )
                        showOptionsSheet = false
                        viewModel.showToast("Opções do Google Drive salvas!")
                        viewModel.refreshBackups(silent = true)
                    } catch (e: Exception) {
                        if (!e.isCancellation()) viewModel.showToast(e.localizedMessage ?: "Erro ao salvar.", ToastKind.ERROR)
                    }
                }
            },
            onTest = {
                scope.launch {
                    runCatching { viewModel.api.testGDrive() }
                        .onSuccess { viewModel.showToast("Conexão OK! ${it.status?.accountEmail ?: "Google Drive"}"); viewModel.refreshBackups(silent = true) }
                        .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Falha no teste", ToastKind.ERROR) }
                }
            },
            onDisconnect = {
                scope.launch {
                    runCatching { viewModel.api.disconnectGDrive() }
                        .onSuccess { showOptionsSheet = false; viewModel.showToast("Conta desconectada.", ToastKind.WARN); viewModel.refreshBackups(silent = true) }
                        .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Falha ao desconectar", ToastKind.ERROR) }
                }
            }
        )
    }

    deleteRemoteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteRemoteTarget = null },
            title = { Text("Excluir backup da nuvem?") },
            text = { Text("Remover \"${target.name}\" permanentemente do Google Drive?") },
            confirmButton = {
                TextButton(onClick = {
                    deleteRemoteTarget = null
                    scope.launch {
                        runCatching { viewModel.api.deleteGDriveFile(target.id) }
                            .onSuccess { viewModel.showToast("Removido do Google Drive."); viewModel.refreshBackups(silent = true) }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro ao excluir.", ToastKind.ERROR) }
                    }
                }) { Text("Excluir", color = palette.danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { deleteRemoteTarget = null }) { Text("Cancelar") } }
        )
    }

    deleteLocalTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteLocalTarget = null },
            title = { Text("Excluir backup local?") },
            text = { Text("Remover \"${target.name}\" do Orange Pi?") },
            confirmButton = {
                TextButton(onClick = {
                    deleteLocalTarget = null
                    scope.launch {
                        runCatching { viewModel.api.deleteLocalBackup(target.name) }
                            .onSuccess { viewModel.showToast("Backup local removido."); viewModel.refreshBackups(silent = true) }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro ao excluir.", ToastKind.ERROR) }
                    }
                }) { Text("Excluir", color = palette.danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { deleteLocalTarget = null }) { Text("Cancelar") } }
        )
    }
}

@Composable
private fun ConnectedDriveCard(
    gd: GDriveStatusResponse,
    activeProgress: GDriveProgress?,
    isAdmin: Boolean,
    onBackupNow: () -> Unit,
    onOpenFolder: () -> Unit,
    onOpenOptions: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val isRunning = activeProgress?.active == true
    val autoOn = gd.enabled && gd.scheduleHours > 0

    YacaCard {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Google Drive", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    YacaPill("Conectado", palette.ok, icon = Icons.Rounded.CloudDone)
                    if (autoOn) YacaPill("Auto • ${gd.scheduleHours}h", palette.info)
                }
                Text(
                    "${gd.accountEmail ?: "Conta Google"} • Pasta \"${gd.folderName ?: "Backups"}\"",
                    fontSize = 12.sp,
                    color = palette.textMuted
                )
            }
            if (isAdmin) {
                IconButton(onClick = onOpenOptions) {
                    Icon(Icons.Rounded.Settings, contentDescription = "Opções", tint = palette.text)
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            if (isAdmin) {
                Button(
                    onClick = onBackupNow,
                    enabled = !isRunning,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                    modifier = Modifier.weight(1f).height(46.dp)
                ) {
                    if (isRunning) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = palette.onPrimary)
                        Spacer(modifier = Modifier.size(8.dp))
                        Text("Enviando ${activeProgress?.percent ?: 0}%", fontWeight = FontWeight.Bold)
                    } else {
                        Icon(Icons.Rounded.CloudUpload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.size(8.dp))
                        Text("Fazer Backup Agora", fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (!gd.folderUrl.isNullOrBlank()) {
                OutlinedButton(
                    onClick = onOpenFolder,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.height(46.dp)
                ) {
                    Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = "Abrir pasta", modifier = Modifier.size(18.dp))
                }
            }
        }

        // Live Progress Bar Box
        if (activeProgress != null && (activeProgress.active || activeProgress.stage == "done" || activeProgress.stage == "error")) {
            Spacer(modifier = Modifier.height(12.dp))
            val stageColor = when (activeProgress.stage) {
                "compressing" -> palette.accent
                "uploading" -> palette.info
                "done" -> palette.ok
                "error" -> palette.danger
                else -> palette.primary
            }
            val stageLabel = when (activeProgress.stage) {
                "compressing" -> "Compactando mundo…"
                "uploading" -> "Enviando para o Google Drive…"
                "pruning" -> "Limpando backups antigos…"
                "done" -> "✓ Backup concluído no Google Drive!"
                "error" -> "✕ Falha durante o backup"
                else -> "Processando…"
            }
            val pct = activeProgress.percent.coerceIn(0, 100)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(stageColor.copy(alpha = 0.10f))
                    .border(1.dp, stageColor.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stageLabel, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = stageColor)
                    Text("$pct%", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 12.sp, color = palette.text)
                }
                LinearProgressIndicator(
                    progress = { pct / 100f },
                    color = stageColor,
                    trackColor = palette.surfaceElevated,
                    strokeCap = StrokeCap.Round,
                    modifier = Modifier.fillMaxWidth().height(7.dp)
                )
                val detail = buildList {
                    activeProgress.message?.takeIf { it.isNotBlank() }?.let { add(it) }
                    if (activeProgress.active && activeProgress.speedBps > 0) add("${Formatters.bytes(activeProgress.speedBps)}/s")
                }.joinToString(" • ")
                if (detail.isNotEmpty()) {
                    Text(detail, fontSize = 11.sp, color = palette.textMuted)
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        val freeQuota = gd.storageQuota?.takeIf { it.limitBytes > 0 }?.let {
            Formatters.bytes((it.limitBytes - it.usageBytes).coerceAtLeast(0))
        } ?: "Disponível"

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            DriveMetric("Último", Formatters.dateBR(gd.lastBackupAt), Modifier.weight(1f))
            DriveMetric("Próximo", gd.nextScheduledAt?.let { Formatters.dateBR(it) } ?: "Manual", Modifier.weight(1f))
            DriveMetric("Livre", freeQuota, Modifier.weight(1f))
        }

        gd.storageQuota?.takeIf { it.limitBytes > 0 }?.let { q ->
            Spacer(modifier = Modifier.height(10.dp))
            val ratio = (q.usageBytes.toFloat() / q.limitBytes.toFloat()).coerceIn(0f, 1f)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("${Formatters.bytes(q.usageBytes)} / ${Formatters.bytes(q.limitBytes)}", fontSize = 11.sp, color = palette.textMuted)
                Text("${(ratio * 100).roundToInt()}%", fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = palette.textMuted)
            }
            Spacer(modifier = Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { ratio },
                color = if (ratio > 0.9f) palette.danger else palette.info,
                trackColor = palette.surfaceElevated,
                strokeCap = StrokeCap.Round,
                modifier = Modifier.fillMaxWidth().height(5.dp)
            )
        }
    }
}

@Composable
private fun DriveMetric(label: String, value: String, modifier: Modifier) {
    val palette = LocalYacaPalette.current
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(palette.background)
            .padding(9.dp)
    ) {
        Text(label, fontSize = 10.sp, color = palette.textMuted)
        Text(value, fontSize = 11.5.sp, fontWeight = FontWeight.Bold, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GDriveOptionsBottomSheet(
    gd: GDriveStatusResponse,
    onDismiss: () -> Unit,
    onSave: (String, Int, Int, Boolean) -> Unit,
    onTest: () -> Unit,
    onDisconnect: () -> Unit
) {
    val palette = LocalYacaPalette.current
    var folder by remember { mutableStateOf(gd.folderName ?: "YacaCode Minecraft Backups") }
    var scheduleHours by remember { mutableIntStateOf(if (gd.enabled) gd.scheduleHours else 0) }
    var maxBackups by remember { mutableStateOf(gd.maxBackups.toString()) }
    var skipIdle by remember { mutableStateOf(gd.skipIfNoActivity) }
    var scheduleExpanded by remember { mutableStateOf(false) }

    val schedules = listOf(
        0 to "Desativado (manual)",
        6 to "A cada 6 horas",
        12 to "A cada 12 horas",
        24 to "Diário (24h)",
        72 to "A cada 3 dias (72h)"
    )

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.surface) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Opções do Google Drive", style = MaterialTheme.typography.titleLarge, color = palette.text)
            OutlinedTextField(
                value = folder,
                onValueChange = { folder = it },
                label = { Text("Pasta no Google Drive") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            ExposedDropdownMenuBox(expanded = scheduleExpanded, onExpandedChange = { scheduleExpanded = it }) {
                OutlinedTextField(
                    value = schedules.firstOrNull { it.first == scheduleHours }?.second ?: "${scheduleHours}h",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Frequência automática") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(scheduleExpanded) },
                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable, true).fillMaxWidth()
                )
                ExposedDropdownMenu(expanded = scheduleExpanded, onDismissRequest = { scheduleExpanded = false }) {
                    schedules.forEach { (h, lbl) ->
                        DropdownMenuItem(text = { Text(lbl) }, onClick = { scheduleHours = h; scheduleExpanded = false })
                    }
                }
            }
            OutlinedTextField(
                value = maxBackups,
                onValueChange = { maxBackups = it.filter(Char::isDigit) },
                label = { Text("Manter últimos backups (1–100)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Pular se o mundo não mudou", color = palette.text, fontSize = 14.sp)
                Switch(checked = skipIdle, onCheckedChange = { skipIdle = it })
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(onClick = onTest, modifier = Modifier.weight(1f)) { Text("Testar") }
                OutlinedButton(onClick = onDisconnect, modifier = Modifier.weight(1f)) { Text("Desconectar", color = palette.danger) }
            }
            Button(
                onClick = { onSave(folder.trim(), scheduleHours, maxBackups.toIntOrNull()?.coerceIn(1, 100) ?: 10, skipIdle) },
                colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) { Text("Salvar Opções", fontWeight = FontWeight.Bold) }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
