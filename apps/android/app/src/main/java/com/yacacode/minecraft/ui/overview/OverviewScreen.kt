package com.yacacode.minecraft.ui.overview

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.People
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.RestartAlt
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Speed
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.R
import com.yacacode.minecraft.ToastKind
import com.yacacode.minecraft.data.OverviewResponse
import com.yacacode.minecraft.data.StackService
import com.yacacode.minecraft.data.isCancellation
import com.yacacode.minecraft.ui.common.PulsingDot
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OverviewScreen(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val haptics = LocalHapticFeedback.current

    val data = uiState.overview
    val isRefreshing = uiState.overviewRefreshing
    var powerBusy by remember { mutableStateOf(false) }
    var confirmPowerAction by remember { mutableStateOf<String?>(null) }

    val isAdmin = uiState.session?.isAdmin == true
    val isModOrAbove = uiState.session?.isModeratorOrAbove == true

    fun executePower(action: String) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch {
            powerBusy = true
            try {
                viewModel.api.serverPower(action)
                viewModel.showToast("Comando \"$action\" enviado com sucesso!")
                delay(1500)
                viewModel.refreshOverview(silent = true)
            } catch (e: Exception) {
                if (!e.isCancellation()) viewModel.showToast(e.localizedMessage ?: "Falha no comando.", ToastKind.ERROR)
            } finally {
                powerBusy = false
            }
        }
    }

    LaunchedEffect(Unit) {
        if (uiState.overview == null) {
            viewModel.refreshOverview(silent = false)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
    ) {
        TopAppBar(
            title = {
                Text("Visão Geral", fontWeight = FontWeight.Bold)
            },
            actions = {
                IconButton(onClick = { viewModel.refreshOverview(silent = false) }) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Atualizar")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text,
                actionIconContentColor = palette.text
            )
        )

        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = { viewModel.refreshOverview(silent = false) },
            modifier = Modifier.fillMaxSize()
        ) {
            val overview = data
            if (overview == null && isRefreshing) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CircularProgressIndicator(color = palette.primary)
                        Text("Carregando telemetria do Orange Pi…", fontSize = 13.sp, color = palette.textMuted)
                    }
                }
            } else if (overview == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(32.dp)
                    ) {
                        Text("Sem dados de telemetria ainda", fontWeight = FontWeight.Bold, color = palette.text, fontSize = 16.sp)
                        Text("Toque abaixo para reconectar ao painel.", fontSize = 13.sp, color = palette.textMuted)
                        Surface(
                            onClick = { viewModel.refreshOverview(silent = false) },
                            shape = RoundedCornerShape(12.dp),
                            color = palette.primary,
                            contentColor = palette.onPrimary
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                                Text("Atualizar agora", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    item {
                        HeroServerCard(
                            overview = overview,
                            isAdmin = isAdmin,
                            isModOrAbove = isModOrAbove,
                            busy = powerBusy,
                            onStart = { executePower("start") },
                            onRestart = { confirmPowerAction = "restart" },
                            onStop = { confirmPowerAction = "stop" },
                            onSave = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                scope.launch {
                                    powerBusy = true
                                    try {
                                        val res = viewModel.api.runConsoleCommand("save-all")
                                        viewModel.showToast(res.output?.ifBlank { null } ?: "Mundo salvo com sucesso!")
                                    } catch (e: Exception) {
                                        if (!e.isCancellation()) viewModel.showToast(e.localizedMessage ?: "Erro ao salvar.", ToastKind.ERROR)
                                    } finally {
                                        powerBusy = false
                                    }
                                }
                            },
                            onBackup = {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                viewModel.triggerBackupNow()
                            }
                        )
                    }

                    item {
                        val javaAddr = if (overview.connection.javaPort == 25565) {
                            overview.connection.mcDomain
                        } else "${overview.connection.mcDomain}:${overview.connection.javaPort}"
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                            ConnectionTile(
                                edition = "JAVA",
                                color = palette.primary,
                                address = javaAddr,
                                detail = "Porta ${overview.connection.javaPort} TCP",
                                modifier = Modifier.weight(1f)
                            ) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                clipboard.setText(AnnotatedString(javaAddr))
                                viewModel.showToast("Copiado: $javaAddr")
                            }
                            ConnectionTile(
                                edition = "BEDROCK",
                                color = palette.accent,
                                address = overview.connection.mcDomain,
                                detail = "Porta ${overview.connection.bedrockPort} UDP/TCP",
                                modifier = Modifier.weight(1f)
                            ) {
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                clipboard.setText(AnnotatedString(overview.connection.mcDomain))
                                viewModel.showToast("Copiado: ${overview.connection.mcDomain}")
                            }
                        }
                    }

                    item {
                        KpiGridSection(overview)
                    }

                    item {
                        TelemetryChartCard(
                            points = overview.history,
                            liveStats = overview.server.stats,
                            host = overview.host
                        )
                    }

                    item {
                        StackHealthCard(overview.stack)
                    }

                    item { Spacer(modifier = Modifier.height(12.dp)) }
                }
            }
        }
    }

    if (confirmPowerAction != null) {
        val isStop = confirmPowerAction == "stop"
        AlertDialog(
            onDismissRequest = { confirmPowerAction = null },
            title = { Text(if (isStop) "Parar o servidor?" else "Reiniciar o servidor?") },
            text = { Text("O painel enviará um aviso no chat e salvará o mundo antes de concluir a ação.") },
            confirmButton = {
                TextButton(onClick = {
                    val act = confirmPowerAction!!
                    confirmPowerAction = null
                    executePower(act)
                }) {
                    Text(
                        if (isStop) "Parar Servidor" else "Reiniciar",
                        color = if (isStop) palette.danger else palette.primary,
                        fontWeight = FontWeight.Bold
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmPowerAction = null }) { Text("Cancelar") }
            }
        )
    }
}

@Composable
private fun HeroServerCard(
    overview: OverviewResponse,
    isAdmin: Boolean,
    isModOrAbove: Boolean,
    busy: Boolean,
    onStart: () -> Unit,
    onRestart: () -> Unit,
    onStop: () -> Unit,
    onSave: () -> Unit,
    onBackup: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val running = overview.server.container?.running == true
    val pingOk = overview.server.ping?.online == true
    val statusText = when {
        running && pingOk -> "Online"
        running -> "Iniciando…"
        else -> "Offline"
    }
    val statusColor = when {
        running && pingOk -> palette.ok
        running -> palette.warn
        else -> palette.danger
    }

    Surface(
        shape = RoundedCornerShape(20.dp),
        color = palette.surface,
        border = BorderStroke(1.dp, palette.borderStrong),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier
                .background(
                    Brush.linearGradient(
                        listOf(palette.primary.copy(alpha = 0.10f), Color.Transparent, palette.accent.copy(alpha = 0.08f))
                    )
                )
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(58.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(palette.surfaceElevated)
                        .border(1.dp, palette.borderStrong, RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.yacacode_logo),
                        contentDescription = null,
                        modifier = Modifier.size(44.dp)
                    )
                }

                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            "${overview.server.name} MC",
                            style = MaterialTheme.typography.titleLarge,
                            color = palette.text
                        )
                        Row(
                            modifier = Modifier
                                .clip(CircleShape)
                                .background(statusColor.copy(alpha = 0.15f))
                                .padding(horizontal = 9.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)
                        ) {
                            PulsingDot(statusColor, active = running, size = 7.dp)
                            Text(statusText, color = statusColor, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    Text(
                        "Pumpkin Rust • v${overview.server.runningVersion} • Uptime ${Formatters.uptime(overview.server.container?.startedAt)}",
                        fontSize = 12.sp,
                        color = palette.textMuted
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        YacaPill("Java + Bedrock", palette.accent)
                        YacaPill(overview.host.arch.uppercase(), palette.info)
                        overview.host.temperature?.celsius?.let { temp ->
                            val c = when (overview.host.temperature.status) {
                                "critical" -> palette.danger
                                "warm" -> palette.warn
                                else -> palette.ok
                            }
                            YacaPill(String.format("%.1f°C", temp), c, icon = Icons.Rounded.Thermostat)
                        }
                    }
                }
            }

            if (isModOrAbove) {
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    PowerChip("Iniciar", Icons.Rounded.PlayArrow, palette.primary, palette.onPrimary, !busy, onStart)
                    PowerChip("Reiniciar", Icons.Rounded.RestartAlt, palette.surfaceElevated, palette.text, !busy, onRestart)
                    if (isAdmin) {
                        PowerChip("Parar", Icons.Rounded.Stop, palette.danger.copy(alpha = 0.15f), palette.danger, !busy, onStop)
                    }
                    PowerChip("Salvar", Icons.Rounded.Save, palette.surfaceElevated, palette.text, !busy, onSave)
                    if (isAdmin) {
                        PowerChip("Backup", Icons.Rounded.CloudUpload, palette.info.copy(alpha = 0.15f), palette.info, !busy, onBackup)
                    }
                }
            }
        }
    }
}

@Composable
private fun PowerChip(
    label: String,
    icon: ImageVector,
    bg: Color,
    fg: Color,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(10.dp),
        color = bg,
        contentColor = fg
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ConnectionTile(
    edition: String,
    color: Color,
    address: String,
    detail: String,
    modifier: Modifier,
    onClick: () -> Unit
) {
    val palette = LocalYacaPalette.current
    YacaCard(
        modifier = modifier.clickable(onClick = onClick),
        padding = 13.dp,
        cornerRadius = 16.dp
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                edition,
                fontSize = 10.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 0.8.sp,
                color = color,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .background(color.copy(alpha = 0.16f))
                    .padding(horizontal = 7.dp, vertical = 3.dp)
            )
            Icon(Icons.Rounded.ContentCopy, contentDescription = "Copiar", tint = palette.textMuted, modifier = Modifier.size(15.dp))
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            address,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            fontSize = 13.sp,
            color = palette.text,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
        Text(detail, fontSize = 11.sp, color = palette.textMuted, maxLines = 1)
    }
}

@Composable
private fun KpiGridSection(o: OverviewResponse) {
    val palette = LocalYacaPalette.current
    val mcMemMB = o.server.stats?.let { (it.memUsedBytes / (1024.0 * 1024.0)).roundToInt() } ?: 0
    val mcLimitMB = o.server.stats?.let { (it.memLimitBytes / (1024.0 * 1024.0)).roundToInt() } ?: 768
    val mcMemPct = o.server.stats?.memPercent ?: 0.0
    val tpsVal = o.server.tps?.let { String.format("%.1f TPS", it.tps1m) }
        ?: if (o.server.ping?.online == true) "20.0*" else "--"
    val tempVal = o.host.temperature?.celsius?.let { String.format("%.1f°C", it) }
        ?: String.format("%.1f%%", o.server.stats?.cpuPercent ?: 0.0)

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            KpiTile(
                icon = Icons.Rounded.People,
                iconColor = palette.primary,
                label = "Jogadores Online",
                value = "${o.server.players.online} / ${o.server.players.max}",
                sub = "${o.server.players.javaCount} Java • ${o.server.players.bedrockCount} Bedrock",
                progress = if (o.server.players.max > 0) o.server.players.online.toFloat() / o.server.players.max else null,
                modifier = Modifier.weight(1f)
            )
            KpiTile(
                icon = Icons.Rounded.Speed,
                iconColor = palette.ok,
                label = "Desempenho",
                value = tpsVal,
                sub = "Ping: ${o.server.ping?.latencyMs?.let { "$it ms" } ?: "--"}",
                progress = null,
                modifier = Modifier.weight(1f)
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            KpiTile(
                icon = Icons.Rounded.Memory,
                iconColor = palette.primary,
                label = "RAM Minecraft",
                value = "$mcMemMB MB",
                sub = "de $mcLimitMB MB (${mcMemPct.roundToInt()}%)",
                progress = (mcMemPct / 100.0).toFloat(),
                modifier = Modifier.weight(1f)
            )
            KpiTile(
                icon = Icons.Rounded.Memory,
                iconColor = palette.accent,
                label = "RAM Orange Pi",
                value = "${o.host.memory.percent.roundToInt()}%",
                sub = "${Formatters.bytes(o.host.memory.usedBytes)} / ${Formatters.bytes(o.host.memory.totalBytes)}",
                progress = (o.host.memory.percent / 100.0).toFloat(),
                modifier = Modifier.weight(1f)
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            KpiTile(
                icon = Icons.Rounded.Thermostat,
                iconColor = palette.info,
                label = "CPU & Temperatura",
                value = tempVal,
                sub = String.format("CPU %.1f%% • Load %.2f", o.server.stats?.cpuPercent ?: 0.0, o.host.loadAvg.firstOrNull() ?: 0.0),
                progress = null,
                modifier = Modifier.weight(1f)
            )
            KpiTile(
                icon = Icons.Rounded.Storage,
                iconColor = palette.accent,
                label = "Armazenamento SD",
                value = o.host.disk?.let { "${it.percent.roundToInt()}%" } ?: "--%",
                sub = o.host.disk?.let { "Livre: ${Formatters.bytes(it.freeBytes)}" } ?: "—",
                progress = o.host.disk?.let { (it.percent / 100.0).toFloat() },
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun KpiTile(
    icon: ImageVector,
    iconColor: Color,
    label: String,
    value: String,
    sub: String,
    progress: Float?,
    modifier: Modifier
) {
    val palette = LocalYacaPalette.current
    YacaCard(modifier = modifier, padding = 13.dp, cornerRadius = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Icon(icon, contentDescription = null, tint = iconColor, modifier = Modifier.size(14.dp))
            Text(label, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = palette.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(modifier = Modifier.height(5.dp))
        Text(value, style = MaterialTheme.typography.titleLarge, color = palette.text, maxLines = 1)
        if (progress != null) {
            Spacer(modifier = Modifier.height(5.dp))
            val clamped = progress.coerceIn(0f, 1f)
            val barColor = when {
                clamped >= 0.88f -> palette.danger
                clamped >= 0.72f -> palette.warn
                else -> palette.primary
            }
            LinearProgressIndicator(
                progress = { clamped },
                color = barColor,
                trackColor = palette.surfaceElevated,
                strokeCap = StrokeCap.Round,
                modifier = Modifier.fillMaxWidth().height(5.dp)
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(sub, fontSize = 10.5.sp, color = palette.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun StackHealthCard(services: List<StackService>) {
    val palette = LocalYacaPalette.current
    YacaCard {
        Text("Serviços 24/7 (Docker Stack)", style = MaterialTheme.typography.titleMedium, color = palette.text)
        Text("Saúde automática dos containers no Orange Pi", fontSize = 12.sp, color = palette.textMuted)
        Spacer(modifier = Modifier.height(10.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            services.forEach { svc ->
                val color = when {
                    svc.running -> palette.ok
                    svc.exists -> palette.danger
                    else -> palette.textMuted
                }
                val label = when {
                    svc.running -> "Ativo"
                    svc.exists -> svc.state ?: "Parado"
                    else -> "Host / Inativo"
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(palette.background)
                        .padding(11.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    PulsingDot(color, active = svc.running, size = 7.dp)
                    Column(modifier = Modifier.weight(1f)) {
                        Text(svc.label, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = palette.text)
                        Text(
                            "${svc.container}${if (svc.running) " • ${Formatters.uptime(svc.startedAt)}" else ""}",
                            fontSize = 11.sp,
                            fontFamily = FontFamily.Monospace,
                            color = palette.textMuted
                        )
                    }
                    YacaPill(label, color)
                }
            }
        }
    }
}
