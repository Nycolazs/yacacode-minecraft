package com.yacacode.minecraft.ui.ai

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Subject
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.ArrowUpward
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.PanTool
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.data.AiModelOption
import com.yacacode.minecraft.data.AiPendingAction
import com.yacacode.minecraft.data.AiStatusResponse
import com.yacacode.minecraft.ui.common.MarkdownMessageContent
import com.yacacode.minecraft.ui.common.PulsingDot
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.GeminiColors
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import com.yacacode.minecraft.ui.theme.TermiusColors
import kotlinx.coroutines.delay

private data class QuickPromptItem(
    val icon: ImageVector,
    val color: Color,
    val title: String,
    val subtitle: String,
    val prompt: String
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiChatScreen(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val palette = LocalYacaPalette.current
    val clipboard = LocalClipboardManager.current
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val haptics = LocalHapticFeedback.current
    val listState = rememberLazyListState()

    val dismissOnScroll = remember(focusManager, keyboardController) {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && available.y > 6f) {
                    focusManager.clearFocus()
                    keyboardController?.hide()
                }
                return Offset.Zero
            }
        }
    }

    val status = uiState.aiStatus
    val messages = uiState.aiMessages
    val isSending = uiState.aiSending

    var inputText by remember { mutableStateOf("") }
    var thinkingIdx by remember { mutableIntStateOf(0) }
    var showConfigSheet by remember { mutableStateOf(false) }
    var showPromptsSheet by remember { mutableStateOf(false) }
    var showHistorySheet by remember { mutableStateOf(false) }
    var expandedActionKey by remember { mutableStateOf<String?>(null) }

    val thinkingPhrases = remember {
        listOf(
            "Pensando…",
            "Consultando o servidor…",
            "Verificando dados ao vivo…",
            "Preparando resposta…"
        )
    }

    val userName = uiState.session?.displayName ?: uiState.session?.username ?: "Admin"
    val canConfigure = status?.permissions?.canConfigure == true || uiState.session?.isAdmin == true
    val canRunCmds = status?.permissions?.canRunCommands == true || uiState.session?.isModeratorOrAbove == true

    val quickPrompts = remember(canConfigure, palette) {
        buildList {
            add(QuickPromptItem(Icons.Rounded.Groups, palette.primary, "Quem tá online?", "Jogadores & nível XP", "Quem está online agora e em qual nível de XP?"))
            add(QuickPromptItem(Icons.Rounded.WbSunny, palette.accent, "Dia e clima limpo", "time set day + clear", "Deixe de dia e limpe o clima agora."))
            add(QuickPromptItem(Icons.Rounded.Favorite, palette.info, "Saúde do servidor", "CPU, RAM e temp", "Como está a saúde do servidor agora (CPU, RAM, temperatura e uptime)?"))
            add(QuickPromptItem(Icons.AutoMirrored.Rounded.Subject, GeminiColors.Violet, "Resumo dos logs", "Últimos eventos", "Resuma o que aconteceu nos últimos logs do servidor."))
            if (canConfigure) {
                add(QuickPromptItem(Icons.Rounded.CloudUpload, palette.ok, "Backup agora", "Enviar ao Drive", "Faça um backup completo do mundo para o Google Drive agora."))
            }
        }
    }

    LaunchedEffect(Unit) {
        if (uiState.aiStatus == null) viewModel.refreshAiStatus()
        viewModel.refreshAiConversations(silent = true)
        viewModel.ensureAiSyncConnected()
    }

    LaunchedEffect(isSending) {
        if (!isSending) return@LaunchedEffect
        thinkingIdx = 0
        while (isSending) {
            delay(1500)
            thinkingIdx = (thinkingIdx + 1) % thinkingPhrases.size
        }
    }

    LaunchedEffect(messages.size, isSending) {
        val total = messages.size + if (isSending) 1 else 0
        if (total > 0) {
            listState.animateScrollToItem((total - 1).coerceAtLeast(0))
        }
    }

    fun sendPrompt(raw: String) {
        focusManager.clearFocus()
        keyboardController?.hide()
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        if (status != null && !status.configured && canConfigure) {
            showConfigSheet = true
        }
        viewModel.sendAiPrompt(raw)
    }

    fun resolvePending(messageId: String, actionId: String, decision: String) {
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        viewModel.resolveAiPending(messageId, actionId, decision)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
            .imePadding()
    ) {
        TopAppBar(
            title = {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.clickable(enabled = canConfigure) { showConfigSheet = true }
                ) {
                    GeminiSparkle(size = 20.dp, spinning = isSending)
                    Column {
                        Text("YacaCode AI", fontWeight = FontWeight.Bold, fontSize = 16.sp, color = palette.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)
                        ) {
                            if (uiState.aiSyncConnected) {
                                PulsingDot(color = palette.ok, active = true, size = 6.dp)
                            }
                            Text(
                                buildString {
                                    if (uiState.aiSyncConnected) append("Sincronizado • ")
                                    append(shortModel(status?.model ?: "gemini-3.5-flash-lite"))
                                },
                                fontSize = 11.sp,
                                color = palette.textMuted,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            },
            actions = {
                IconButton(onClick = { showHistorySheet = true }) {
                    Icon(Icons.Rounded.History, contentDescription = "Conversas salvas")
                }
                IconButton(onClick = { viewModel.startNewAiConversation() }) {
                    Icon(Icons.Rounded.EditNote, contentDescription = "Nova conversa")
                }
                if (canConfigure) {
                    IconButton(onClick = { showConfigSheet = true }) {
                        Icon(Icons.Rounded.Tune, contentDescription = "Configurar IA")
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text,
                actionIconContentColor = palette.text
            )
        )

        // Setup banner if not configured
        if (status != null && !status.configured) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.warn.copy(alpha = 0.13f))
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Icon(Icons.Rounded.Key, contentDescription = null, tint = palette.warn)
                Column(modifier = Modifier.weight(1f)) {
                    Text("Gemini API Key não configurada", fontWeight = FontWeight.Bold, fontSize = 12.sp, color = palette.text)
                    Text("Configure sua chave gratuita do Google AI Studio.", fontSize = 11.sp, color = palette.textMuted)
                }
                if (canConfigure) {
                    Surface(
                        onClick = { showConfigSheet = true },
                        shape = CircleShape,
                        color = palette.primary,
                        contentColor = palette.onPrimary
                    ) {
                        Text("Configurar", fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
                    }
                }
            }
        }

        // Main Chat Area
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .nestedScroll(dismissOnScroll),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            if (messages.isEmpty() && !isSending) {
                item {
                    GeminiWelcomeSection(
                        userName = userName,
                        canConfigure = canConfigure,
                        canRunCmds = canRunCmds,
                        jorgeOn = status?.inGameChatEnabled == true,
                        prompts = quickPrompts,
                        onSelectPrompt = { sendPrompt(it) }
                    )
                }
            } else {
                items(messages, key = { it.id }) { msg ->
                    if (msg.role == "user") {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End
                        ) {
                            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Surface(
                                    shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp),
                                    color = palette.surfaceElevated,
                                    border = BorderStroke(1.dp, palette.border),
                                    modifier = Modifier.widthIn(max = 310.dp)
                                ) {
                                    Text(
                                        text = msg.text,
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = palette.text,
                                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 11.dp)
                                    )
                                }
                                Text(msg.time, fontSize = 10.sp, color = palette.textMuted)
                            }
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.Top
                        ) {
                            GeminiSparkle(size = 22.dp, spinning = false, modifier = Modifier.padding(top = 2.dp))
                            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                // Tool action pills
                                if (msg.actions.isNotEmpty()) {
                                    Row(
                                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        msg.actions.forEachIndexed { idx, act ->
                                            val key = "${msg.id}-$idx"
                                            val c = when (act.status) {
                                                "ok" -> palette.ok
                                                "denied" -> palette.warn
                                                else -> palette.danger
                                            }
                                            val ic = when (act.status) {
                                                "ok" -> Icons.Rounded.CheckCircle
                                                "denied" -> Icons.Rounded.PanTool
                                                else -> Icons.Rounded.ErrorOutline
                                            }
                                            YacaPill(
                                                text = act.label,
                                                color = c,
                                                icon = ic,
                                                modifier = Modifier.clickable {
                                                    expandedActionKey = if (expandedActionKey == key) null else key
                                                }
                                            )
                                        }
                                    }
                                    msg.actions.forEachIndexed { idx, act ->
                                        if (expandedActionKey == "${msg.id}-$idx" && !act.output.isNullOrBlank()) {
                                            Text(
                                                text = act.output,
                                                fontFamily = FontFamily.Monospace,
                                                fontSize = 11.5.sp,
                                                color = palette.textMuted,
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .clip(RoundedCornerShape(10.dp))
                                                    .background(palette.surface)
                                                    .border(1.dp, palette.border, RoundedCornerShape(10.dp))
                                                    .padding(10.dp)
                                            )
                                        }
                                    }
                                }

                                MarkdownMessageContent(text = msg.text) { viewModel.showToast(it) }

                                msg.pendingActions.forEach { pending ->
                                    PendingActionCard(
                                        pending = pending,
                                        onApprove = { resolvePending(msg.id, pending.id, "approve") },
                                        onReject = { resolvePending(msg.id, pending.id, "reject") }
                                    )
                                }

                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Icon(
                                        Icons.Rounded.ContentCopy,
                                        contentDescription = "Copiar resposta",
                                        tint = palette.textMuted,
                                        modifier = Modifier
                                            .size(16.dp)
                                            .clickable {
                                                clipboard.setText(AnnotatedString(msg.text))
                                                viewModel.showToast("Resposta copiada!")
                                            }
                                    )
                                    Text(
                                        "${shortModel(msg.model ?: status?.model ?: "Gemini")} • ${msg.time}",
                                        fontSize = 11.sp,
                                        color = palette.textMuted
                                    )
                                }
                            }
                        }
                    }
                }

                if (isSending) {
                    item(key = "thinking") {
                        GeminiThinkingBubble(phrase = thinkingPhrases[thinkingIdx])
                    }
                }
            }
        }

        // Floating Gemini Pill Composer Bar
        Surface(
            shape = RoundedCornerShape(28.dp),
            color = palette.surface,
            border = BorderStroke(1.dp, palette.borderStrong),
            shadowElevation = 4.dp,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(palette.surfaceElevated)
                        .clickable { showPromptsSheet = true },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Rounded.Add, contentDescription = "Atalhos", tint = palette.textMuted)
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .padding(vertical = 7.dp)
                ) {
                    if (inputText.isEmpty()) {
                        Text(
                            "Pergunte ao Gemini sobre o servidor…",
                            color = palette.textMuted,
                            fontSize = 15.sp
                        )
                    }
                    BasicTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        textStyle = TextStyle(color = palette.text, fontSize = 15.sp, lineHeight = 21.sp),
                        cursorBrush = SolidColor(palette.primary),
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth()
                    )
                }

                val canSend = inputText.isNotBlank() && !isSending
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(
                            if (canSend) GeminiColors.SparkleBrush
                            else SolidColor(palette.surfaceElevated)
                        )
                        .clickable(enabled = canSend) {
                            val t = inputText
                            inputText = ""
                            sendPrompt(t)
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Rounded.ArrowUpward,
                        contentDescription = "Enviar",
                        tint = if (canSend) Color.White else palette.textMuted,
                        modifier = Modifier.size(19.dp)
                    )
                }
            }
        }
    }

    if (showPromptsSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPromptsSheet = false },
            containerColor = palette.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("Atalhos Gemini IA", style = MaterialTheme.typography.titleMedium, color = palette.text)
                quickPrompts.forEach { item ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(palette.background)
                            .clickable {
                                showPromptsSheet = false
                                sendPrompt(item.prompt)
                            }
                            .padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(item.icon, contentDescription = null, tint = item.color)
                        Column {
                            Text(item.title, fontWeight = FontWeight.Bold, color = palette.text, fontSize = 14.sp)
                            Text(item.prompt, color = palette.textMuted, fontSize = 12.sp)
                        }
                    }
                }
                Spacer(modifier = Modifier.height(20.dp))
            }
        }
    }

    if (showConfigSheet && status != null) {
        AiConfigBottomSheet(
            status = status,
            onDismiss = { showConfigSheet = false },
            onSave = { apiKey, model, inGame ->
                viewModel.saveAiConfig(apiKey, model, inGame) {
                    showConfigSheet = false
                }
            }
        )
    }

    if (showHistorySheet) {
        ModalBottomSheet(
            onDismissRequest = { showHistorySheet = false },
            containerColor = palette.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Conversas Salvas", style = MaterialTheme.typography.titleMedium, color = palette.text)
                        Text(
                            "@${uiState.session?.username ?: "conta"} • Sincronizadas com o PC",
                            fontSize = 11.5.sp,
                            color = palette.textMuted
                        )
                    }
                    Surface(
                        onClick = {
                            showHistorySheet = false
                            viewModel.startNewAiConversation()
                        },
                        shape = CircleShape,
                        color = palette.primary,
                        contentColor = palette.onPrimary
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text("Nova", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                if (uiState.aiConversations.isEmpty()) {
                    Text(
                        "Nenhuma conversa salva ainda. Envie uma pergunta para criar sua primeira conversa sincronizada.",
                        fontSize = 13.sp,
                        color = palette.textMuted,
                        modifier = Modifier.padding(vertical = 18.dp)
                    )
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(bottom = 24.dp)
                    ) {
                        items(uiState.aiConversations, key = { it.id }) { conv ->
                            val isActive = conv.id == uiState.activeAiConversationId
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(if (isActive) palette.primary.copy(alpha = 0.14f) else palette.background)
                                    .border(
                                        1.dp,
                                        if (isActive) palette.primary.copy(alpha = 0.45f) else palette.border,
                                        RoundedCornerShape(14.dp)
                                    )
                                    .clickable {
                                        showHistorySheet = false
                                        viewModel.selectAiConversation(conv.id)
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                    Text(
                                        conv.title,
                                        fontWeight = if (isActive) FontWeight.Bold else FontWeight.SemiBold,
                                        fontSize = 14.sp,
                                        color = if (isActive) palette.primary else palette.text,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        "${conv.messageCount} msg • ${Formatters.dateBR(conv.updatedAt)}",
                                        fontSize = 11.sp,
                                        color = palette.textMuted,
                                        maxLines = 1
                                    )
                                }
                                IconButton(
                                    onClick = { viewModel.deleteAiConversation(conv.id) },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        Icons.Rounded.Delete,
                                        contentDescription = "Excluir conversa",
                                        tint = palette.textMuted,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun GeminiWelcomeSection(
    userName: String,
    canConfigure: Boolean,
    canRunCmds: Boolean,
    jorgeOn: Boolean,
    prompts: List<QuickPromptItem>,
    onSelectPrompt: (String) -> Unit
) {
    val palette = LocalYacaPalette.current
    Column(
        modifier = Modifier.padding(top = 18.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            GeminiSparkle(size = 38.dp, spinning = false)
            Text(
                text = "Olá, $userName",
                style = TextStyle(
                    brush = GeminiColors.GreetingBrush,
                    fontSize = 32.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = (-0.6).sp
                )
            )
            Text(
                text = "Como posso ajudar no servidor hoje?",
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
                color = palette.textMuted
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            YacaPill(
                text = if (canConfigure) "Acesso Total (Admin)" else if (canRunCmds) "Comandos (Mod)" else "Consultas (Viewer)",
                color = if (canConfigure) palette.accent else if (canRunCmds) palette.info else palette.textMuted
            )
            if (jorgeOn) {
                YacaPill("Jorge ativo no jogo", palette.ok)
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            prompts.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    row.forEach { item ->
                        Surface(
                            onClick = { onSelectPrompt(item.prompt) },
                            shape = RoundedCornerShape(18.dp),
                            color = palette.surface,
                            border = BorderStroke(1.dp, palette.border),
                            modifier = Modifier.weight(1f)
                        ) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(CircleShape)
                                        .background(item.color.copy(alpha = 0.16f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(item.icon, contentDescription = null, tint = item.color, modifier = Modifier.size(18.dp))
                                }
                                Column {
                                    Text(item.title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = palette.text)
                                    Text(item.subtitle, fontSize = 11.sp, color = palette.textMuted, maxLines = 1)
                                }
                            }
                        }
                    }
                    if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun PendingActionCard(
    pending: AiPendingAction,
    onApprove: () -> Unit,
    onReject: () -> Unit
) {
    val palette = LocalYacaPalette.current
    val isDone = pending.resolution == "executed"
    val isRejected = pending.resolution == "rejected"
    val borderColor = if (isDone) palette.ok else if (isRejected) palette.border else palette.warn
    val cmdText = pending.command?.let { "/$it" } ?: pending.label

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = palette.surface,
        border = BorderStroke(1.2.dp, borderColor.copy(alpha = 0.6f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Rounded.Warning, contentDescription = null, tint = if (isDone) palette.ok else palette.warn, modifier = Modifier.size(18.dp))
                    Text("Confirmação necessária", fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = if (isDone) palette.ok else palette.warn)
                }
                YacaPill("Destrutiva", palette.warn)
            }

            pending.reason?.takeIf { it.isNotBlank() }?.let {
                Text(it, fontSize = 12.sp, color = palette.textMuted)
            }

            Text(
                text = cmdText,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                fontSize = 13.sp,
                color = TermiusColors.Cmd,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(TermiusColors.Bg)
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            )

            when {
                isDone -> Text("✓ Executado${pending.resolvedOutput?.let { ": $it" } ?: ""}", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.ok)
                isRejected -> Text("✕ Ação cancelada pelo usuário.", fontSize = 12.sp, color = palette.textMuted)
                else -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = onApprove,
                        colors = ButtonDefaults.buttonColors(containerColor = palette.danger, contentColor = Color.White),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Confirmar e executar", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(onClick = onReject, shape = RoundedCornerShape(10.dp)) {
                        Text("Cancelar", fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun GeminiThinkingBubble(phrase: String) {
    val inf = rememberInfiniteTransition(label = "shimmer")
    val alpha by inf.animateFloat(
        initialValue = 0.25f,
        targetValue = 0.75f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "shimmerAlpha"
    )
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
        GeminiSparkle(size = 22.dp, spinning = true)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = phrase,
                style = TextStyle(brush = GeminiColors.GreetingBrush, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            )
            listOf(0.92f, 0.72f, 0.48f).forEach { frac ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth(frac)
                        .height(10.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(
                            Brush.horizontalGradient(
                                listOf(
                                    GeminiColors.Blue.copy(alpha = alpha * 0.45f),
                                    GeminiColors.Violet.copy(alpha = alpha * 0.6f),
                                    GeminiColors.Lime.copy(alpha = alpha * 0.4f)
                                )
                            )
                        )
                )
            }
        }
    }
}

@Composable
private fun GeminiSparkle(size: androidx.compose.ui.unit.Dp, spinning: Boolean, modifier: Modifier = Modifier) {
    val inf = rememberInfiniteTransition(label = "sparkleSpin")
    val angle by inf.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(2200, easing = LinearEasing)),
        label = "angle"
    )
    Box(
        modifier = modifier
            .size(size)
            .rotate(if (spinning) angle else 0f)
            .clip(CircleShape)
            .background(GeminiColors.SparkleBrush),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            Icons.Rounded.AutoAwesome,
            contentDescription = null,
            tint = Color.White,
            modifier = Modifier.size(size * 0.62f)
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AiConfigBottomSheet(
    status: AiStatusResponse,
    onDismiss: () -> Unit,
    onSave: (apiKey: String?, model: String, inGameEnabled: Boolean) -> Unit
) {
    val palette = LocalYacaPalette.current
    var apiKey by remember { mutableStateOf("") }
    var selectedModel by remember { mutableStateOf(status.model) }
    var inGame by remember { mutableStateOf(status.inGameChatEnabled) }
    var modelDropdown by remember { mutableStateOf(false) }

    val models = status.availableModels.ifEmpty {
        listOf(
            AiModelOption("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite (Recomendado)"),
            AiModelOption("gemini-3.1-flash-lite", "Gemini 3.1 Flash-Lite"),
            AiModelOption("gemini-3.8-flash", "Gemini 3.8 Flash")
        )
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.surface) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("Configurar Assistente IA (Gemini)", style = MaterialTheme.typography.titleLarge, color = palette.text)
            if (status.configured) {
                Text(
                    "Chave atual (${status.source ?: "painel"}): ${status.maskedKey ?: "configurada"}",
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    color = palette.textMuted
                )
            }

            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("Gemini API Key (vazio para manter)") },
                placeholder = { Text("AIzaSy…") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            ExposedDropdownMenuBox(expanded = modelDropdown, onExpandedChange = { modelDropdown = it }) {
                OutlinedTextField(
                    value = models.firstOrNull { it.id == selectedModel }?.label ?: selectedModel,
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Modelo Gemini") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = modelDropdown) },
                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable, true).fillMaxWidth()
                )
                ExposedDropdownMenu(expanded = modelDropdown, onDismissRequest = { modelDropdown = false }) {
                    models.forEach { m ->
                        DropdownMenuItem(
                            text = { Text(m.label) },
                            onClick = {
                                selectedModel = m.id
                                modelDropdown = false
                            }
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Bot Jorge no chat do jogo", fontWeight = FontWeight.SemiBold, color = palette.text)
                    Text("Responde apenas quando chamam \"Jorge\" (sem executar comandos).", fontSize = 11.sp, color = palette.textMuted)
                }
                Switch(checked = inGame, onCheckedChange = { inGame = it })
            }

            Button(
                onClick = { onSave(apiKey.ifBlank { null }, selectedModel, inGame) },
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                Text("Salvar Configuração", fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

private fun shortModel(raw: String): String =
    raw.replace("gemini-", "Gemini ")
        .replace("-flash-lite", " Flash-Lite")
        .replace("-flash", " Flash")
