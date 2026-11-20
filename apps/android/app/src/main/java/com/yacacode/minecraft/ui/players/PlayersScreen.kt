package com.yacacode.minecraft.ui.players

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
import androidx.compose.material.icons.automirrored.rounded.ExitToApp
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Campaign
import androidx.compose.material.icons.rounded.ChatBubble
import androidx.compose.material.icons.rounded.PersonOff
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.ToastKind
import com.yacacode.minecraft.data.OnlinePlayer
import com.yacacode.minecraft.data.isCancellation
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import kotlinx.coroutines.launch
import java.net.URLEncoder

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayersScreen(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val isMod = uiState.session?.isModeratorOrAbove == true
    val isAdmin = uiState.session?.isAdmin == true

    val data = uiState.players
    val isRefreshing = uiState.playersRefreshing
    var broadcastText by remember { mutableStateOf("") }
    var selectedTab by remember { mutableIntStateOf(0) } // 0=Whitelist, 1=OPs, 2=Banidos
    var addInput by remember { mutableStateOf("") }

    var whisperTarget by remember { mutableStateOf<String?>(null) }
    var whisperMsg by remember { mutableStateOf("") }
    var confirmAction by remember { mutableStateOf<Triple<String, String, String>?>(null) }
    var actionReason by remember { mutableStateOf("") }

    fun runAction(action: String, player: String? = null, reason: String? = null, message: String? = null) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        scope.launch {
            try {
                val res = viewModel.api.playerAction(action, player, reason, message)
                viewModel.showToast(res.output?.ifBlank { null } ?: "Ação \"$action\" executada!")
                viewModel.refreshPlayers(silent = true)
            } catch (e: Exception) {
                if (!e.isCancellation()) {
                    viewModel.showToast(e.localizedMessage ?: "Erro na ação.", ToastKind.ERROR)
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        if (uiState.players == null) {
            viewModel.refreshPlayers(silent = false)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
    ) {
        TopAppBar(
            title = { Text("Jogadores", fontWeight = FontWeight.Bold) },
            actions = {
                IconButton(onClick = { viewModel.refreshPlayers(silent = false) }) {
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
            onRefresh = { viewModel.refreshPlayers(silent = false) },
            modifier = Modifier.fillMaxSize()
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                if (isMod) {
                    item {
                        YacaCard {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Rounded.Campaign, contentDescription = null, tint = palette.accent)
                                Text("Aviso Global no Chat", style = MaterialTheme.typography.titleMedium, color = palette.text)
                            }
                            Text(
                                "Envia uma mensagem visível para todos os jogadores Java e Bedrock conectados.",
                                fontSize = 12.sp,
                                color = palette.textMuted
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedTextField(
                                    value = broadcastText,
                                    onValueChange = { broadcastText = it },
                                    placeholder = { Text("Ex: Reinício em 5 minutos!") },
                                    singleLine = true,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.weight(1f)
                                )
                                Surface(
                                    onClick = {
                                        val m = broadcastText.trim()
                                        if (m.isNotEmpty()) {
                                            broadcastText = ""
                                            runAction("say", message = m)
                                        }
                                    },
                                    shape = RoundedCornerShape(12.dp),
                                    color = palette.primary,
                                    contentColor = palette.onPrimary,
                                    modifier = Modifier.size(50.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "Enviar")
                                    }
                                }
                            }
                        }
                    }
                }

                // Online players
                item {
                    YacaCard {
                        Text("Conectados Agora", style = MaterialTheme.typography.titleMedium, color = palette.text)
                        Text(
                            "${data?.online?.size ?: 0} de ${data?.max ?: 6} jogadores",
                            fontSize = 12.sp,
                            color = palette.textMuted
                        )
                        Spacer(modifier = Modifier.height(10.dp))

                        val online = data?.online.orEmpty()
                        if (online.isEmpty()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(palette.background)
                                    .padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(Icons.Rounded.PersonOff, contentDescription = null, tint = palette.textMuted)
                                Text("Nenhum jogador conectado no momento.", color = palette.textMuted, fontSize = 13.5.sp)
                            }
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                online.forEach { player ->
                                    OnlinePlayerCard(
                                        player = player,
                                        isMod = isMod,
                                        isAdmin = isAdmin,
                                        onWhisper = { whisperTarget = player.name },
                                        onOp = { runAction("op", player = player.name) },
                                        onKick = { confirmAction = Triple("kick", player.name, "Expulsar ${player.name}?") },
                                        onBan = { confirmAction = Triple("ban", player.name, "Banir ${player.name}?") }
                                    )
                                }
                            }
                        }
                    }
                }

                // Whitelist / OPs / Bans
                item {
                    val tabs = listOf("Whitelist", "OPs", "Banidos")
                    YacaCard {
                        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                            tabs.forEachIndexed { idx, label ->
                                SegmentedButton(
                                    selected = selectedTab == idx,
                                    onClick = { selectedTab = idx },
                                    shape = SegmentedButtonDefaults.itemShape(idx, tabs.size)
                                ) {
                                    Text(label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        if (selectedTab == 0) {
                            val wlOn = data?.whitelistEnabled == true
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column {
                                    Text("Whitelist do Servidor", fontWeight = FontWeight.Bold, color = palette.text)
                                    Text(
                                        if (wlOn) "Ativada (Privado)" else "Desativada (Aberto)",
                                        fontSize = 12.sp,
                                        color = if (wlOn) palette.ok else palette.textMuted
                                    )
                                }
                                if (isMod) {
                                    Surface(
                                        onClick = { runAction(if (wlOn) "whitelist-off" else "whitelist-on") },
                                        shape = CircleShape,
                                        color = palette.surfaceElevated
                                    ) {
                                        Text(
                                            if (wlOn) "Desativar" else "Ativar",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = palette.text,
                                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp)
                                        )
                                    }
                                }
                            }
                            Spacer(modifier = Modifier.height(10.dp))
                        }

                        if (isMod) {
                            val placeholder = when (selectedTab) {
                                0 -> "Nick Java ou .NickBedrock"
                                1 -> "Nick para dar OP"
                                else -> "Nick para banir"
                            }
                            val btnLabel = when (selectedTab) {
                                0 -> "Adicionar"
                                1 -> "Dar OP"
                                else -> "Banir"
                            }
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedTextField(
                                    value = addInput,
                                    onValueChange = { addInput = it },
                                    placeholder = { Text(placeholder, fontSize = 13.sp) },
                                    singleLine = true,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.weight(1f)
                                )
                                Button(
                                    onClick = {
                                        val name = addInput.trim()
                                        if (name.isEmpty()) return@Button
                                        addInput = ""
                                        when (selectedTab) {
                                            0 -> runAction("whitelist-add", player = name)
                                            1 -> runAction("op", player = name)
                                            else -> confirmAction = Triple("ban", name, "Banir $name?")
                                        }
                                    },
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = if (selectedTab == 2) palette.danger else palette.primary,
                                        contentColor = if (selectedTab == 2) Color.White else palette.onPrimary
                                    )
                                ) {
                                    Text(btnLabel, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                            if (selectedTab == 0) {
                                Text(
                                    "Para Bedrock (Floodgate), use ponto antes do gamertag (ex: .Steve).",
                                    fontSize = 11.sp,
                                    color = palette.textMuted,
                                    modifier = Modifier.padding(top = 6.dp)
                                )
                            }
                            Spacer(modifier = Modifier.height(12.dp))
                        }

                        val items = when (selectedTab) {
                            0 -> data?.whitelist.orEmpty()
                            1 -> data?.ops.orEmpty()
                            else -> data?.bannedPlayers.orEmpty()
                        }
                        val emptyMsg = when (selectedTab) {
                            0 -> "Nenhum jogador na whitelist."
                            1 -> "Nenhum operador cadastrado."
                            else -> "Nenhum jogador banido."
                        }
                        val removeAct = when (selectedTab) {
                            0 -> "whitelist-remove"
                            1 -> "deop"
                            else -> "pardon"
                        }
                        val removeLbl = if (selectedTab == 2) "Desbanir" else "Remover"

                        if (items.isEmpty()) {
                            Text(emptyMsg, fontSize = 13.sp, color = palette.textMuted, modifier = Modifier.padding(vertical = 8.dp))
                        } else {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                items.forEach { entity ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(11.dp))
                                            .background(palette.background)
                                            .padding(11.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(entity.name, fontWeight = FontWeight.SemiBold, color = palette.text, fontSize = 14.sp)
                                            entity.level?.let {
                                                Text("OP Nível $it", fontSize = 11.sp, color = palette.accent)
                                            } ?: entity.reason?.takeIf { it.isNotBlank() }?.let {
                                                Text(it, fontSize = 11.sp, color = palette.textMuted)
                                            }
                                        }
                                        if (isMod) {
                                            Text(
                                                removeLbl,
                                                color = palette.danger,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Bold,
                                                modifier = Modifier
                                                    .clip(CircleShape)
                                                    .background(palette.danger.copy(alpha = 0.13f))
                                                    .clickable { runAction(removeAct, player = entity.name) }
                                                    .padding(horizontal = 10.dp, vertical = 6.dp)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                item { Spacer(modifier = Modifier.height(12.dp)) }
            }
        }
    }

    if (whisperTarget != null) {
        AlertDialog(
            onDismissRequest = { whisperTarget = null; whisperMsg = "" },
            title = { Text("Mensagem para $whisperTarget") },
            text = {
                OutlinedTextField(
                    value = whisperMsg,
                    onValueChange = { whisperMsg = it },
                    placeholder = { Text("Digite a mensagem privada…") },
                    singleLine = true
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val t = whisperTarget!!
                    val m = whisperMsg.trim()
                    whisperTarget = null
                    whisperMsg = ""
                    if (m.isNotEmpty()) runAction("whisper", player = t, message = m)
                }) { Text("Enviar", fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { whisperTarget = null; whisperMsg = "" }) { Text("Cancelar") }
            }
        )
    }

    if (confirmAction != null) {
        val (act, player, title) = confirmAction!!
        AlertDialog(
            onDismissRequest = { confirmAction = null; actionReason = "" },
            title = { Text(title) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Confirma executar \"$act\" em $player?")
                    OutlinedTextField(
                        value = actionReason,
                        onValueChange = { actionReason = it },
                        placeholder = { Text("Motivo (opcional)") },
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val r = actionReason.trim()
                    confirmAction = null
                    actionReason = ""
                    runAction(act, player = player, reason = r.ifEmpty { null })
                }) { Text(if (act == "ban") "Banir" else "Expulsar", color = palette.danger, fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = { confirmAction = null; actionReason = "" }) { Text("Cancelar") }
            }
        )
    }
}

@Composable
private fun OnlinePlayerCard(
    player: OnlinePlayer,
    isMod: Boolean,
    isAdmin: Boolean,
    onWhisper: () -> Unit,
    onOp: () -> Unit,
    onKick: () -> Unit,
    onBan: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val skin = if (player.isBedrock) "Steve" else URLEncoder.encode(player.name, "UTF-8")

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(palette.background)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AsyncImage(
                model = "https://mc-heads.net/avatar/$skin/64",
                contentDescription = player.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .size(42.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(palette.surfaceElevated)
                    .border(1.dp, palette.border, RoundedCornerShape(10.dp))
            )
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(player.name, fontWeight = FontWeight.Bold, color = palette.text, fontSize = 15.sp)
                YacaPill(
                    text = if (player.isBedrock) "BEDROCK" else "JAVA",
                    color = if (player.isBedrock) palette.accent else palette.primary
                )
            }
        }
        if (isMod) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                PlayerActionChip("Msg", Icons.Rounded.ChatBubble, palette.info, Modifier.weight(1f), onWhisper)
                if (isAdmin) {
                    PlayerActionChip("OP", Icons.Rounded.Shield, palette.accent, Modifier.weight(1f), onOp)
                }
                PlayerActionChip("Kick", Icons.AutoMirrored.Rounded.ExitToApp, palette.warn, Modifier.weight(1f), onKick)
                PlayerActionChip("Ban", Icons.Rounded.Block, palette.danger, Modifier.weight(1f), onBan)
            }
        }
    }
}

@Composable
private fun PlayerActionChip(
    label: String,
    icon: ImageVector,
    color: Color,
    modifier: Modifier,
    onClick: () -> Unit
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(color.copy(alpha = 0.14f))
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(13.dp))
        Spacer(modifier = Modifier.size(4.dp))
        Text(label, color = color, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}
