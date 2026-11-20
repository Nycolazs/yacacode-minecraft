package com.yacacode.minecraft.ui.console

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.KeyboardHide
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SubdirectoryArrowLeft
import androidx.compose.material.icons.rounded.VerticalAlignBottom
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.TerminalConnState
import com.yacacode.minecraft.data.ConsoleLogKind
import com.yacacode.minecraft.data.ConsoleLogLine
import com.yacacode.minecraft.ui.common.PulsingDot
import com.yacacode.minecraft.ui.theme.TermiusColors

@Composable
fun TerminalScreen(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val clipboard = LocalClipboardManager.current
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val haptics = LocalHapticFeedback.current
    val listState = rememberLazyListState()

    val canAccess = uiState.session?.isModeratorOrAbove == true
    val lines = uiState.terminalLines
    val containerName = uiState.terminalContainer
    val connState = uiState.terminalConnState
    val cmdHistory = uiState.terminalHistory
    val sendingCmd = uiState.terminalSending

    val isConnected = connState == TerminalConnState.CONNECTED
    val connColor = when (connState) {
        TerminalConnState.CONNECTED -> TermiusColors.Info
        TerminalConnState.CONNECTING, TerminalConnState.RECONNECTING -> TermiusColors.Warn
        TerminalConnState.ERROR -> TermiusColors.Error
        TerminalConnState.DISCONNECTED -> TermiusColors.Muted
    }

    var commandText by remember { mutableStateOf("") }
    var historyIdx by remember { mutableIntStateOf(-1) }
    var showSearch by remember { mutableStateOf(false) }
    var filterText by remember { mutableStateOf("") }
    var autoScroll by remember { mutableStateOf(true) }
    var fontSizeSp by remember { mutableFloatStateOf(12f) }
    var showMenu by remember { mutableStateOf(false) }

    val quickCommands = remember {
        listOf("list", "tps", "save-all", "time set day", "weather clear", "whitelist reload", "say ", "gamemode creative ", "xp query ")
    }

    fun dismissKeyboard() {
        focusManager.clearFocus()
        keyboardController?.hide()
    }

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

    // Persistent SSE connection managed by MainViewModel (never lost on tab switch)
    LaunchedEffect(canAccess) {
        if (canAccess) viewModel.ensureTerminalConnected()
    }

    val filteredLines = remember(lines, filterText) {
        val q = filterText.trim().lowercase()
        if (q.isEmpty()) lines else lines.filter { it.text.lowercase().contains(q) }
    }

    LaunchedEffect(filteredLines.size, autoScroll) {
        if (autoScroll && filteredLines.isNotEmpty()) {
            listState.scrollToItem(filteredLines.lastIndex)
        }
    }

    fun runCommand(raw: String) {
        val clean = raw.trim()
        if (clean.isEmpty()) {
            dismissKeyboard()
            return
        }
        if (sendingCmd) return
        historyIdx = -1
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        viewModel.sendTerminalCommand(clean)
    }

    if (!canAccess) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(TermiusColors.Bg)
                .statusBarsPadding(),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(32.dp)
            ) {
                Icon(Icons.Rounded.Lock, contentDescription = null, tint = TermiusColors.Warn, modifier = Modifier.size(48.dp))
                Text("Console restrito", color = TermiusColors.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                Text(
                    "O console ao vivo e comandos RCON requerem cargo Moderador ou Administrador.",
                    color = TermiusColors.Muted,
                    fontSize = 14.sp,
                    textAlign = TextAlign.Center
                )
            }
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(TermiusColors.Bg)
            .statusBarsPadding()
            .imePadding()
    ) {
        // Termius Header Chrome
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(TermiusColors.Chrome)
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            PulsingDot(connColor, active = isConnected, size = 8.dp)
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        containerName,
                        color = TermiusColors.Text,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.5.sp
                    )
                    Text(
                        "SSH/SSE",
                        color = TermiusColors.Cmd,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 9.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(TermiusColors.Cmd.copy(alpha = 0.18f))
                            .padding(horizontal = 5.dp, vertical = 1.dp)
                    )
                }
                Text(
                    "${connState.label} • ${filteredLines.size} linhas",
                    color = TermiusColors.Muted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.5.sp
                )
            }

            TermHeaderBtn(Icons.Rounded.KeyboardHide, active = false) {
                dismissKeyboard()
            }
            TermHeaderBtn(Icons.Rounded.Search, active = showSearch) {
                showSearch = !showSearch
                if (!showSearch) {
                    filterText = ""
                    dismissKeyboard()
                }
            }
            TermHeaderBtn(
                if (autoScroll) Icons.Rounded.VerticalAlignBottom else Icons.Rounded.Pause,
                active = autoScroll
            ) {
                autoScroll = !autoScroll
            }

            Box {
                TermHeaderBtn(Icons.Rounded.MoreVert, active = false) { showMenu = true }
                DropdownMenu(expanded = showMenu, onDismissRequest = { showMenu = false }) {
                    DropdownMenuItem(
                        text = { Text("Aumentar fonte (${fontSizeSp.toInt()}sp)") },
                        onClick = { fontSizeSp = (fontSizeSp + 1f).coerceAtMost(18f); showMenu = false }
                    )
                    DropdownMenuItem(
                        text = { Text("Diminuir fonte") },
                        onClick = { fontSizeSp = (fontSizeSp - 1f).coerceAtLeast(9f); showMenu = false }
                    )
                    DropdownMenuItem(
                        text = { Text("Copiar todos os logs") },
                        leadingIcon = { Icon(Icons.Rounded.ContentCopy, null) },
                        onClick = {
                            clipboard.setText(AnnotatedString(filteredLines.joinToString("\n") { it.text }))
                            viewModel.showToast("Logs copiados (${filteredLines.size} linhas).")
                            showMenu = false
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Reconectar stream") },
                        leadingIcon = { Icon(Icons.Rounded.Refresh, null) },
                        onClick = { viewModel.reconnectTerminal(); showMenu = false }
                    )
                    DropdownMenuItem(
                        text = { Text("Limpar terminal") },
                        leadingIcon = { Icon(Icons.Rounded.DeleteSweep, null) },
                        onClick = { viewModel.clearTerminal(); showMenu = false }
                    )
                }
            }
        }
        HorizontalDivider(color = TermiusColors.Border)

        // Search filter bar
        AnimatedVisibility(visible = showSearch) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TermiusColors.Surface)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Rounded.Search, contentDescription = null, tint = TermiusColors.Cmd, modifier = Modifier.size(16.dp))
                Box(modifier = Modifier.weight(1f)) {
                    if (filterText.isEmpty()) {
                        Text("Filtrar logs (WARN, ERROR, chat, Geyser…)", color = TermiusColors.Muted, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp)
                    }
                    BasicTextField(
                        value = filterText,
                        onValueChange = { filterText = it },
                        singleLine = true,
                        textStyle = TextStyle(color = TermiusColors.Text, fontFamily = FontFamily.Monospace, fontSize = 12.5.sp),
                        cursorBrush = SolidColor(TermiusColors.Cmd),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { dismissKeyboard() }),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (filterText.isNotEmpty()) {
                    Icon(
                        Icons.Rounded.Close,
                        contentDescription = "Limpar filtro",
                        tint = TermiusColors.Muted,
                        modifier = Modifier.size(18.dp).clickable { filterText = "" }
                    )
                }
            }
        }

        // OLED Log Stream Viewport
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .nestedScroll(dismissOnScroll)
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null
                ) { dismissKeyboard() },
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            if (filteredLines.isEmpty()) {
                item {
                    Text(
                        text = if (lines.isEmpty()) "Aguardando saída de logs de $containerName…" else "Nenhuma linha encontrada para \"$filterText\"",
                        color = TermiusColors.Muted,
                        fontFamily = FontFamily.Monospace,
                        fontSize = fontSizeSp.sp,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            } else {
                items(filteredLines, key = { it.id }) { entry ->
                    val rowBg = when (entry.kind) {
                        ConsoleLogKind.ERROR -> TermiusColors.Error.copy(alpha = 0.10f)
                        ConsoleLogKind.WARN -> TermiusColors.Warn.copy(alpha = 0.08f)
                        ConsoleLogKind.COMMAND -> TermiusColors.Cmd.copy(alpha = 0.09f)
                        else -> Color.Transparent
                    }
                    Text(
                        text = formatLogLine(entry, filterText),
                        fontFamily = FontFamily.Monospace,
                        fontSize = fontSizeSp.sp,
                        lineHeight = (fontSizeSp + 5f).sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(4.dp))
                            .background(rowBg)
                            .clickable {
                                dismissKeyboard()
                                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                clipboard.setText(AnnotatedString(entry.text))
                                viewModel.showToast("Linha copiada!")
                            }
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
        }

        // Termius Snippet Strip with pinned KeyboardHide + Prompt Dock
        HorizontalDivider(color = TermiusColors.Border)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(TermiusColors.Chrome)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // Pinned one-thumb Keyboard Hide button on the left of snippet strip
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(TermiusColors.Surface)
                    .border(1.dp, TermiusColors.Border, RoundedCornerShape(8.dp))
                    .clickable { dismissKeyboard() },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.KeyboardHide,
                    contentDescription = "Ocultar teclado",
                    tint = TermiusColors.Cmd,
                    modifier = Modifier.size(16.dp)
                )
            }

            Row(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                quickCommands.forEach { cmd ->
                    Text(
                        text = cmd.trim(),
                        color = TermiusColors.Text,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 11.5.sp,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(TermiusColors.Surface)
                            .border(1.dp, TermiusColors.Border, RoundedCornerShape(8.dp))
                            .clickable {
                                if (cmd.endsWith(" ")) {
                                    commandText = cmd
                                } else {
                                    runCommand(cmd)
                                }
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(TermiusColors.Chrome)
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("❯", color = TermiusColors.Cmd, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Black, fontSize = 16.sp)

            Box(modifier = Modifier.weight(1f)) {
                if (commandText.isEmpty()) {
                    Text("comando (ex: time set day, op Nick)…", color = TermiusColors.Muted, fontFamily = FontFamily.Monospace, fontSize = 13.5.sp)
                }
                BasicTextField(
                    value = commandText,
                    onValueChange = { commandText = it },
                    singleLine = true,
                    textStyle = TextStyle(color = TermiusColors.Text, fontFamily = FontFamily.Monospace, fontSize = 13.5.sp),
                    cursorBrush = SolidColor(TermiusColors.Cmd),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = {
                        val c = commandText
                        commandText = ""
                        runCommand(c)
                    }),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (cmdHistory.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(TermiusColors.Surface)
                            .clickable {
                                historyIdx = (historyIdx + 1).coerceAtMost(cmdHistory.lastIndex)
                                commandText = cmdHistory[historyIdx]
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Rounded.KeyboardArrowUp, contentDescription = "Anterior", tint = TermiusColors.Muted, modifier = Modifier.size(16.dp))
                    }
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(TermiusColors.Surface)
                            .clickable {
                                historyIdx = (historyIdx - 1).coerceAtLeast(-1)
                                commandText = if (historyIdx >= 0) cmdHistory[historyIdx] else ""
                            },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = "Próximo", tint = TermiusColors.Muted, modifier = Modifier.size(16.dp))
                    }
                }
            }

            val hasCmd = commandText.isNotBlank() && !sendingCmd
            Box(
                modifier = Modifier
                    .size(34.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(if (hasCmd) TermiusColors.Cmd else TermiusColors.Surface)
                    .clickable(enabled = hasCmd) {
                        val c = commandText
                        commandText = ""
                        runCommand(c)
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.SubdirectoryArrowLeft,
                    contentDescription = "Enviar comando",
                    tint = if (hasCmd) Color(0xFF0A1006) else TermiusColors.Muted,
                    modifier = Modifier.size(18.dp)
                )
            }
        }
    }
}

@Composable
private fun TermHeaderBtn(
    icon: ImageVector,
    active: Boolean,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(if (active) TermiusColors.Cmd.copy(alpha = 0.16f) else TermiusColors.Surface)
            .border(1.dp, if (active) TermiusColors.Cmd.copy(alpha = 0.45f) else TermiusColors.Border, RoundedCornerShape(9.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = null, tint = if (active) TermiusColors.Cmd else TermiusColors.Muted, modifier = Modifier.size(16.dp))
    }
}

private fun formatLogLine(entry: ConsoleLogLine, filter: String): AnnotatedString {
    val baseColor = when (entry.kind) {
        ConsoleLogKind.ERROR -> TermiusColors.Error
        ConsoleLogKind.WARN -> TermiusColors.Warn
        ConsoleLogKind.GEYSER -> TermiusColors.Geyser
        ConsoleLogKind.CHAT -> TermiusColors.Chat
        ConsoleLogKind.COMMAND -> TermiusColors.Cmd
        ConsoleLogKind.SYSTEM -> TermiusColors.Sys
        ConsoleLogKind.INFO -> TermiusColors.Text
        ConsoleLogKind.NORMAL -> TermiusColors.Text.copy(alpha = 0.9f)
    }

    return buildAnnotatedString {
        val raw = entry.text
        withStyle(
            SpanStyle(
                color = baseColor,
                fontWeight = if (entry.kind == ConsoleLogKind.COMMAND) FontWeight.Bold else FontWeight.Normal
            )
        ) {
            append(raw)
        }
        // Highlight leading HH:MM:SS timestamp
        if (raw.length >= 8 && raw.substring(0, 8).matches(Regex("""\d{2}:\d{2}:\d{2}"""))) {
            addStyle(SpanStyle(color = TermiusColors.Muted), 0, 8)
        }
        // Highlight INFO badge
        val infoIdx = raw.indexOf(" INFO ")
        if (infoIdx >= 0) {
            addStyle(SpanStyle(color = TermiusColors.Info, fontWeight = FontWeight.SemiBold), infoIdx, infoIdx + 6)
        }
        // Highlight filter match
        val q = filter.trim()
        if (q.isNotEmpty()) {
            val mIdx = raw.indexOf(q, ignoreCase = true)
            if (mIdx >= 0) {
                addStyle(SpanStyle(background = TermiusColors.Warn.copy(alpha = 0.35f), color = Color.White), mIdx, mIdx + q.length)
            }
        }
    }
}
