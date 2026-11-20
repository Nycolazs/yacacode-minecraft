package com.yacacode.minecraft.ui.manage

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.Extension
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.ManageAccounts
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.AppTab
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.common.YacaPill
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.GeminiColors
import com.yacacode.minecraft.ui.theme.LocalYacaPalette

enum class ManageDestination {
    HUB, BACKUPS, SETTINGS, PLUGINS, FILES, NETWORK, USERS, APP_PREFS
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManageTabRoot(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    var destination by remember { mutableStateOf(ManageDestination.HUB) }

    BackHandler(enabled = true) {
        if (destination != ManageDestination.HUB) {
            destination = ManageDestination.HUB
        } else {
            viewModel.selectTab(AppTab.OVERVIEW)
        }
    }

    when (destination) {
        ManageDestination.HUB -> ManageHubScreen(uiState, viewModel) { destination = it }
        ManageDestination.BACKUPS -> BackupsScreen(uiState, viewModel) { destination = ManageDestination.HUB }
        ManageDestination.SETTINGS -> ServerSettingsScreen(viewModel) { destination = ManageDestination.HUB }
        ManageDestination.PLUGINS -> PluginsScreen(viewModel) { destination = ManageDestination.HUB }
        ManageDestination.FILES -> FileManagerScreen(viewModel) { destination = ManageDestination.HUB }
        ManageDestination.NETWORK -> NetworkScreen(viewModel) { destination = ManageDestination.HUB }
        ManageDestination.USERS -> UsersScreen(uiState, viewModel) { destination = ManageDestination.HUB }
        ManageDestination.APP_PREFS -> AppSettingsScreen(uiState, viewModel) { destination = ManageDestination.HUB }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ManageHubScreen(
    uiState: AppUiState,
    viewModel: MainViewModel,
    onNavigate: (ManageDestination) -> Unit
) {
    val palette = LocalYacaPalette.current
    val isAdmin = uiState.session?.isAdmin == true
    var showLogoutDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
    ) {
        TopAppBar(
            title = { Text("Gerenciar", fontWeight = FontWeight.Bold) },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = palette.background,
                titleContentColor = palette.text
            )
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // Account Card
            item {
                val displayName = uiState.session?.displayName ?: uiState.session?.username ?: "Usuário"
                val role = uiState.session?.role
                val roleColor = when (role) {
                    "admin" -> palette.accent
                    "moderator" -> palette.info
                    else -> palette.textMuted
                }
                YacaCard {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(52.dp)
                                .clip(CircleShape)
                                .background(palette.primary.copy(alpha = 0.18f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                displayName.take(1).uppercase(),
                                color = palette.primary,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 22.sp
                            )
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(displayName, style = MaterialTheme.typography.titleMedium, color = palette.text)
                                YacaPill(Formatters.roleLabel(role), roleColor)
                            }
                            Text(
                                "@${uiState.session?.username ?: "—"} • ${uiState.session?.brand?.panelDomain ?: "painel.yacacode.com"}",
                                fontSize = 12.sp,
                                color = palette.textMuted
                            )
                        }
                    }
                }
            }

            // Server & Cloud Section
            item {
                Text(
                    "SERVIDOR & NUVEM",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = palette.textMuted,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)
                )
                YacaCard(padding = 6.dp) {
                    HubTile(
                        icon = Icons.Rounded.CloudUpload,
                        color = palette.info,
                        title = "Backups (Google Drive)",
                        subtitle = "Backup em 1 toque, progresso ao vivo e agendamento"
                    ) { onNavigate(ManageDestination.BACKUPS) }

                    if (isAdmin) {
                        HorizontalDivider(color = palette.border, modifier = Modifier.padding(horizontal = 12.dp))
                        HubTile(
                            icon = Icons.Rounded.Settings,
                            color = palette.primary,
                            title = "Configurações do Servidor",
                            subtitle = "pumpkin.toml / server.properties e Presets YacaCode"
                        ) { onNavigate(ManageDestination.SETTINGS) }

                        HorizontalDivider(color = palette.border, modifier = Modifier.padding(horizontal = 12.dp))
                        HubTile(
                            icon = Icons.Rounded.Extension,
                            color = palette.accent,
                            title = "Plugins & Crossplay",
                            subtitle = "Módulos Rust, Geyser, Floodgate e envio .jar"
                        ) { onNavigate(ManageDestination.PLUGINS) }

                        HorizontalDivider(color = palette.border, modifier = Modifier.padding(horizontal = 12.dp))
                        HubTile(
                            icon = Icons.Rounded.Folder,
                            color = Color(0xFFF97316),
                            title = "Gerenciador de Arquivos",
                            subtitle = "Explorar /data e editar arquivos com editor de código"
                        ) { onNavigate(ManageDestination.FILES) }
                    }

                    HorizontalDivider(color = palette.border, modifier = Modifier.padding(horizontal = 12.dp))
                    HubTile(
                        icon = Icons.Rounded.Language,
                        color = Color(0xFF14B8A6),
                        title = "Domínio & Cloudflare",
                        subtitle = "DNS mc.yacacode.com, Tunnel HTTPS e portas"
                    ) { onNavigate(ManageDestination.NETWORK) }
                }
            }

            // Security & App Section
            item {
                Text(
                    "CONTAS & SEGURANÇA",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = palette.textMuted,
                    letterSpacing = 1.sp,
                    modifier = Modifier.padding(start = 4.dp, bottom = 6.dp)
                )
                YacaCard(padding = 6.dp) {
                    HubTile(
                        icon = Icons.Rounded.ManageAccounts,
                        color = GeminiColors.Violet,
                        title = if (isAdmin) "Usuários do Painel (RBAC)" else "Alterar Minha Senha",
                        subtitle = if (isAdmin) "Criar contas, cargos, senhas e acessos" else "Atualize a senha da sua conta"
                    ) { onNavigate(ManageDestination.USERS) }

                    HorizontalDivider(color = palette.border, modifier = Modifier.padding(horizontal = 12.dp))
                    HubTile(
                        icon = Icons.Rounded.Fingerprint,
                        color = palette.ok,
                        title = "Biometria & Preferências",
                        subtitle = "Login por Digital, bloqueio do app e aparência"
                    ) { onNavigate(ManageDestination.APP_PREFS) }
                }
            }

            // Logout
            item {
                YacaCard(padding = 6.dp) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { showLogoutDialog = true }
                            .padding(horizontal = 12.dp, vertical = 14.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.Logout, contentDescription = null, tint = palette.danger, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.size(8.dp))
                        Text("Sair da Conta", color = palette.danger, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    }
                }
            }

            item { Spacer(modifier = Modifier.height(14.dp)) }
        }
    }

    if (showLogoutDialog) {
        AlertDialog(
            onDismissRequest = { showLogoutDialog = false },
            title = { Text("Sair do Painel?") },
            text = { Text("Você pode manter suas credenciais criptografadas no Android Keystore para entrar novamente com Digital.") },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout(clearSavedBiometrics = false)
                }) { Text("Sair (manter Digital)", fontWeight = FontWeight.Bold) }
            },
            dismissButton = {
                TextButton(onClick = {
                    showLogoutDialog = false
                    viewModel.logout(clearSavedBiometrics = true)
                }) { Text("Sair e esquecer", color = palette.danger) }
            }
        )
    }
}

@Composable
private fun HubTile(
    icon: ImageVector,
    color: Color,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    val palette = LocalYacaPalette.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(color.copy(alpha = 0.16f)),
            contentAlignment = Alignment.Center
        ) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(20.dp))
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.5.sp, color = palette.text)
            Text(subtitle, fontSize = 12.sp, color = palette.textMuted, maxLines = 1)
        }
        Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = palette.textMuted)
    }
}
