package com.yacacode.minecraft.ui.manage

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.UploadFile
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.ToastKind
import com.yacacode.minecraft.data.PluginItem
import com.yacacode.minecraft.data.PluginsResponse
import com.yacacode.minecraft.data.isCancellation
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerSettingsScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()

    var engine by remember { mutableStateOf<String?>(null) }
    var motd by remember { mutableStateOf("") }
    var maxPlayers by remember { mutableStateOf("6") }
    var difficulty by remember { mutableStateOf("normal") }
    var gamemode by remember { mutableStateOf("survival") }
    var viewDistance by remember { mutableStateOf("8") }
    var simDistance by remember { mutableStateOf("6") }
    var spawnProt by remember { mutableStateOf("0") }
    var pvp by remember { mutableStateOf(true) }
    var onlineMode by remember { mutableStateOf(true) }
    var whiteList by remember { mutableStateOf(false) }
    var allowNether by remember { mutableStateOf(true) }
    var allowFlight by remember { mutableStateOf(true) }
    var levelSeed by remember { mutableStateOf("") }

    var saving by remember { mutableStateOf(false) }
    var showPresetsConfirm by remember { mutableStateOf(false) }
    var showRestartPrompt by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        runCatching { viewModel.api.properties() }.onSuccess { res ->
            engine = res.engine
            val p = res.properties
            motd = p["motd"].orEmpty()
            maxPlayers = p["max-players"] ?: "6"
            difficulty = (p["difficulty"] ?: "normal").lowercase()
            gamemode = (p["gamemode"] ?: "survival").lowercase()
            viewDistance = p["view-distance"] ?: "8"
            simDistance = p["simulation-distance"] ?: "6"
            spawnProt = p["spawn-protection"] ?: "0"
            pvp = p["pvp"] != "false"
            onlineMode = p["online-mode"] != "false"
            whiteList = p["white-list"] == "true"
            allowNether = p["allow-nether"] != "false"
            allowFlight = p["allow-flight"] != "false"
            levelSeed = p["level-seed"].orEmpty()
        }.onFailure {
            if (!it.isCancellation()) {
                viewModel.showToast("Não foi possível ler configurações.", ToastKind.WARN)
            }
        }
    }

    fun saveAll() {
        scope.launch {
            saving = true
            try {
                viewModel.api.saveProperties(
                    mapOf(
                        "motd" to motd,
                        "max-players" to maxPlayers,
                        "difficulty" to difficulty,
                        "gamemode" to gamemode,
                        "view-distance" to viewDistance,
                        "simulation-distance" to simDistance,
                        "spawn-protection" to spawnProt,
                        "pvp" to pvp.toString(),
                        "online-mode" to onlineMode.toString(),
                        "white-list" to whiteList.toString(),
                        "allow-nether" to allowNether.toString(),
                        "allow-flight" to allowFlight.toString(),
                        "level-seed" to levelSeed
                    )
                )
                showRestartPrompt = true
            } catch (e: Exception) {
                if (!e.isCancellation()) viewModel.showToast(e.localizedMessage ?: "Erro ao salvar.", ToastKind.ERROR)
            } finally {
                saving = false
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text("Configurações", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            actions = {
                TextButton(onClick = { saveAll() }, enabled = !saving) {
                    Icon(Icons.Rounded.Save, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.size(4.dp))
                    Text(if (saving) "Salvando…" else "Salvar", fontWeight = FontWeight.Bold)
                }
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
                    YacaPill(if (engine == "rust-pumpkin") "ENGINE RUST PUMPKIN" else "OTIMIZAÇÃO ORANGE PI 4GB", palette.primary)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Presets Profissionais YacaCode", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Text(
                        "Aplica otimizações de entidades, redstone, spawn limits e crossplay com backup automático .bak.",
                        fontSize = 12.sp,
                        color = palette.textMuted
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        onClick = { showPresetsConfirm = true },
                        colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Rounded.Bolt, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.size(6.dp))
                        Text("Aplicar Presets YacaCode", fontWeight = FontWeight.Bold)
                    }
                }
            }

            item {
                YacaCard {
                    Text(
                        "Editor Visual — ${if (engine == "rust-pumpkin") "pumpkin.toml" else "server.properties"}",
                        style = MaterialTheme.typography.titleMedium,
                        color = palette.text
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(value = motd, onValueChange = { motd = it }, label = { Text("MOTD") }, modifier = Modifier.fillMaxWidth())
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = maxPlayers,
                            onValueChange = { maxPlayers = it.filter(Char::isDigit) },
                            label = { Text("Máx. Jogadores") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                        OutlinedTextField(
                            value = spawnProt,
                            onValueChange = { spawnProt = it.filter(Char::isDigit) },
                            label = { Text("Spawn Prot.") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SimpleDropdown("Dificuldade", difficulty, listOf("peaceful", "easy", "normal", "hard"), Modifier.weight(1f)) { difficulty = it }
                        SimpleDropdown("Modo de Jogo", gamemode, listOf("survival", "creative", "adventure", "spectator"), Modifier.weight(1f)) { gamemode = it }
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        OutlinedTextField(
                            value = viewDistance,
                            onValueChange = { viewDistance = it.filter(Char::isDigit) },
                            label = { Text("View Dist.") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                        OutlinedTextField(
                            value = simDistance,
                            onValueChange = { simDistance = it.filter(Char::isDigit) },
                            label = { Text("Sim. Dist.") },
                            singleLine = true,
                            modifier = Modifier.weight(1f)
                        )
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = levelSeed,
                        onValueChange = { levelSeed = it },
                        label = { Text("Seed do Mundo") },
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    SettingSwitchRow("PvP entre Jogadores", pvp) { pvp = it }
                    SettingSwitchRow("Online Mode (Contas Originais)", onlineMode) { onlineMode = it }
                    SettingSwitchRow("Whitelist (Privado)", whiteList) { whiteList = it }
                    SettingSwitchRow("Permitir Nether", allowNether) { allowNether = it }
                    SettingSwitchRow("Permitir Voo (Elytra / Bedrock)", allowFlight) { allowFlight = it }
                }
            }
        }
    }

    if (showPresetsConfirm) {
        AlertDialog(
            onDismissRequest = { showPresetsConfirm = false },
            title = { Text("Aplicar Presets YacaCode?") },
            text = { Text("Arquivos .bak serão criados automaticamente antes das otimizações.") },
            confirmButton = {
                TextButton(onClick = {
                    showPresetsConfirm = false
                    scope.launch {
                        runCatching { viewModel.api.applyPresets() }
                            .onSuccess { res ->
                                val applied = res.report.count { it.status == "applied" }
                                viewModel.showToast("Presets aplicados em $applied arquivo(s)!")
                            }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro nos presets.", ToastKind.ERROR) }
                    }
                }) { Text("Aplicar", fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { showPresetsConfirm = false }) { Text("Cancelar") } }
        )
    }

    if (showRestartPrompt) {
        AlertDialog(
            onDismissRequest = { showRestartPrompt = false },
            title = { Text("Configurações salvas!") },
            text = { Text("Deseja reiniciar o servidor agora para aplicar todas as alterações?") },
            confirmButton = {
                TextButton(onClick = {
                    showRestartPrompt = false
                    scope.launch {
                        runCatching { viewModel.api.serverPower("restart") }
                        viewModel.showToast("Reinício solicitado!")
                    }
                }) { Text("Reiniciar Agora", color = palette.primary, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { showRestartPrompt = false }) { Text("Depois") } }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SimpleDropdown(
    label: String,
    selected: String,
    options: List<String>,
    modifier: Modifier,
    onSelect: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable, true).fillMaxWidth()
        )
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { opt ->
                DropdownMenuItem(text = { Text(opt) }, onClick = { onSelect(opt); expanded = false })
            }
        }
    }
}

@Composable
private fun SettingSwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val palette = LocalYacaPalette.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, fontSize = 14.sp, color = palette.text, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

// =============================================================================
// PLUGINS & CROSSPLAY SCREEN
// =============================================================================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PluginsScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var data by remember { mutableStateOf<PluginsResponse?>(null) }
    var isRefreshing by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<PluginItem?>(null) }

    suspend fun loadPlugins(manual: Boolean = false) {
        isRefreshing = true
        runCatching { viewModel.api.plugins() }
            .onSuccess { data = it }
            .onFailure {
                if (!it.isCancellation() && (manual || data == null)) {
                    viewModel.showToast("Não foi possível listar plugins.", ToastKind.WARN)
                }
            }
        isRefreshing = false
    }

    val jarPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            uploading = true
            try {
                var fileName = "plugin.jar"
                context.contentResolver.query(uri, null, null, null, null)?.use { c ->
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0 && c.moveToFirst()) fileName = c.getString(idx)
                }
                if (!fileName.lowercase().endsWith(".jar")) {
                    viewModel.showToast("Envie apenas arquivos .jar.", ToastKind.ERROR)
                    return@launch
                }
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw Exception("Não foi possível ler o arquivo.")
                viewModel.api.uploadPlugin(fileName, bytes)
                viewModel.showToast("Plugin $fileName instalado com sucesso!")
                loadPlugins()
            } catch (e: Exception) {
                if (!e.isCancellation()) viewModel.showToast(e.localizedMessage ?: "Falha no upload.", ToastKind.ERROR)
            } finally {
                uploading = false
            }
        }
    }

    LaunchedEffect(Unit) { loadPlugins() }

    Column(modifier = Modifier.fillMaxSize().background(palette.background)) {
        TopAppBar(
            title = { Text("Plugins & Crossplay", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Voltar") }
            },
            actions = {
                IconButton(onClick = { scope.launch { loadPlugins(manual = true) } }) {
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
            onRefresh = { scope.launch { loadPlugins(manual = true) } },
            modifier = Modifier.fillMaxSize()
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
            item {
                val plugins = data?.plugins.orEmpty()
                val geyserOn = plugins.any { (it.fileName.contains("geyser", true) || it.fileName.contains("bedrock", true)) && it.enabled }
                val chunkyOn = plugins.any { (it.fileName.contains("chunky", true) || it.fileName.contains("chunks", true)) && it.enabled }

                YacaCard {
                    Text("Status Crossplay (Java + Bedrock)", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Spacer(modifier = Modifier.height(8.dp))
                    listOf(
                        "Ponte Bedrock → Java (NetherNet / Geyser)" to geyserOn,
                        "Login Bedrock sem conta Java" to (data?.floodgateInstalled == true),
                        "Configuração Crossplay ativa" to (data?.geyserConfigured == true),
                        "Pré-geração / Worldgen Multi-Thread" to chunkyOn
                    ).forEach { (lbl, ok) ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(lbl, fontSize = 12.5.sp, color = palette.text, modifier = Modifier.weight(1f))
                            YacaPill(if (ok) "Ativo" else "Pendente", if (ok) palette.ok else palette.warn)
                        }
                    }
                }
            }

            item {
                YacaCard {
                    Text("Instalar Novo Plugin (.jar)", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Text("Envie arquivos .jar (máx. 100 MB). Reinicie o servidor após enviar.", fontSize = 12.sp, color = palette.textMuted)
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        onClick = { jarPicker.launch(arrayOf("*/*")) },
                        enabled = !uploading,
                        colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (uploading) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = palette.onPrimary)
                            Spacer(modifier = Modifier.size(8.dp))
                            Text("Enviando…")
                        } else {
                            Icon(Icons.Rounded.UploadFile, contentDescription = null)
                            Spacer(modifier = Modifier.size(6.dp))
                            Text("Selecionar arquivo .jar", fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            item {
                val plugins = data?.plugins.orEmpty()
                YacaCard {
                    Text("Instalados (${plugins.size})", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Spacer(modifier = Modifier.height(10.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        plugins.forEach { p ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(palette.background)
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(p.displayName, fontWeight = FontWeight.SemiBold, color = palette.text, fontSize = 14.sp)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    YacaPill(if (p.enabled) "Ativo" else "Desativado", if (p.enabled) palette.ok else palette.textMuted)
                                    if (p.isCoreCrossplay) YacaPill("Crossplay", palette.accent)
                                    if (p.isNativeModule) YacaPill("Nativo Rust", palette.info)
                                }
                                Text(
                                    "${if (p.size > 0) Formatters.bytes(p.size) + " • " else ""}${Formatters.dateBR(p.mtime)}",
                                    fontSize = 11.sp,
                                    color = palette.textMuted
                                )
                                if (!p.isNativeModule) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedButton(onClick = {
                                            scope.launch {
                                                runCatching { viewModel.api.togglePlugin(p.fileName) }
                                                    .onSuccess { viewModel.showToast("Status atualizado!"); loadPlugins() }
                                                    .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                                            }
                                        }) { Text(if (p.enabled) "Desativar" else "Ativar", fontSize = 12.sp) }
                                        OutlinedButton(onClick = { deleteTarget = p }) {
                                            Text("Excluir", fontSize = 12.sp, color = palette.danger)
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

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Excluir plugin?") },
            text = { Text("Remover permanentemente \"${target.fileName}\"?") },
            confirmButton = {
                TextButton(onClick = {
                    deleteTarget = null
                    scope.launch {
                        runCatching { viewModel.api.deletePlugin(target.fileName) }
                            .onSuccess { viewModel.showToast("Plugin removido."); loadPlugins() }
                            .onFailure { if (!it.isCancellation()) viewModel.showToast(it.localizedMessage ?: "Erro", ToastKind.ERROR) }
                    }
                }) { Text("Excluir", color = palette.danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Cancelar") } }
        )
    }
}
