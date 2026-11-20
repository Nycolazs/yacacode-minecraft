package com.yacacode.minecraft

import android.os.Bundle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Dashboard
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material.icons.rounded.Terminal
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material.icons.rounded.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yacacode.minecraft.data.BiometricHelper
import com.yacacode.minecraft.ui.ai.AiChatScreen
import com.yacacode.minecraft.ui.console.TerminalScreen
import com.yacacode.minecraft.ui.login.LoginScreen
import com.yacacode.minecraft.ui.manage.ManageTabRoot
import com.yacacode.minecraft.ui.overview.OverviewScreen
import com.yacacode.minecraft.ui.players.PlayersScreen
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import com.yacacode.minecraft.ui.theme.TermiusColors
import com.yacacode.minecraft.ui.theme.YacaCodeTheme

class MainActivity : FragmentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val uiState by viewModel.uiState.collectAsStateWithLifecycle()
            YacaCodeTheme(appearanceMode = uiState.appearanceMode) {
                YacaCodeAppRoot(uiState = uiState, viewModel = viewModel)
            }
        }
    }

    override fun onStop() {
        super.onStop()
        viewModel.onAppBackgrounded()
    }

    override fun onStart() {
        super.onStart()
        viewModel.onAppForegrounded()
    }
}

@Composable
fun YacaCodeAppRoot(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val palette = LocalYacaPalette.current
    val view = LocalView.current
    val useDarkBars = palette.isDark || (uiState.isAuthenticated && uiState.selectedTab == AppTab.TERMINAL)

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? FragmentActivity)?.window ?: return@SideEffect
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !useDarkBars
            controller.isAppearanceLightNavigationBars = !useDarkBars
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
    ) {
        when {
            uiState.isBootstrapping -> SplashScreen()
            !uiState.isAuthenticated -> LoginScreen(uiState = uiState, viewModel = viewModel)
            else -> {
                MainShell(uiState = uiState, viewModel = viewModel)
                if (uiState.isBiometricLocked) {
                    BiometricLockShield(viewModel = viewModel)
                }
            }
        }

        // Top Floating Toast Banner
        AnimatedVisibility(
            visible = uiState.toast != null,
            enter = slideInVertically { -it } + fadeIn(),
            exit = slideOutVertically { -it } + fadeOut(),
            modifier = Modifier
                .align(Alignment.TopCenter)
                .statusBarsPadding()
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            uiState.toast?.let { toast ->
                val accent = when (toast.kind) {
                    ToastKind.OK -> palette.ok
                    ToastKind.WARN -> palette.warn
                    ToastKind.ERROR -> palette.danger
                }
                val icon = when (toast.kind) {
                    ToastKind.OK -> Icons.Rounded.CheckCircle
                    ToastKind.WARN -> Icons.Rounded.Warning
                    ToastKind.ERROR -> Icons.Rounded.ErrorOutline
                }
                Surface(
                    onClick = { viewModel.dismissToast() },
                    shape = RoundedCornerShape(14.dp),
                    color = palette.surface.copy(alpha = 0.96f),
                    border = BorderStroke(1.dp, accent.copy(alpha = 0.5f)),
                    shadowElevation = 10.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(20.dp))
                        Text(toast.message, color = palette.text, fontSize = 13.5.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }

        // OTA Auto-Update Modal (GitHub Releases)
        val upd = uiState.updateState
        if (uiState.showUpdateDialog && upd.availableUpdate != null) {
            val info = upd.availableUpdate
            AlertDialog(
                onDismissRequest = { viewModel.dismissUpdateDialog() },
                containerColor = palette.surface,
                icon = {
                    Icon(Icons.Rounded.SystemUpdate, contentDescription = null, tint = palette.primary, modifier = Modifier.size(32.dp))
                },
                title = {
                    Text("Atualização Disponível", fontWeight = FontWeight.Bold, color = palette.text)
                },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(
                            "v${BuildConfig.VERSION_NAME} → v${info.versionName}" +
                                if (info.sizeBytes > 0) " • ${Formatters.bytes(info.sizeBytes)}" else "",
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.5.sp,
                            color = palette.primary
                        )
                        Text(
                            info.releaseNotes,
                            fontSize = 13.sp,
                            color = palette.textMuted,
                            lineHeight = 18.sp
                        )

                        if (upd.downloading) {
                            Spacer(modifier = Modifier.height(4.dp))
                            LinearProgressIndicator(
                                progress = { (upd.downloadPercent / 100f).coerceIn(0f, 1f) },
                                color = palette.primary,
                                trackColor = palette.surfaceElevated,
                                strokeCap = StrokeCap.Round,
                                modifier = Modifier.fillMaxWidth().height(7.dp)
                            )
                            Text(
                                if (upd.totalBytes > 0) {
                                    "Baixando… ${upd.downloadPercent}% (${Formatters.bytes(upd.downloadedBytes)} / ${Formatters.bytes(upd.totalBytes)})"
                                } else "Baixando atualização…",
                                fontSize = 11.5.sp,
                                fontFamily = FontFamily.Monospace,
                                color = palette.textMuted
                            )
                        } else if (upd.needsInstallPermission) {
                            Text(
                                "O Android precisa da sua permissão única para instalar atualizações do YacaCode. Toque em \"Permitir\" e volte ao app.",
                                fontSize = 12.5.sp,
                                color = palette.warn,
                                fontWeight = FontWeight.Medium
                            )
                        } else if (!upd.error.isNullOrBlank()) {
                            Text(upd.error, fontSize = 12.sp, color = palette.danger)
                        }
                    }
                },
                confirmButton = {
                    when {
                        upd.downloading -> TextButton(onClick = {}, enabled = false) {
                            Text("${upd.downloadPercent}%", fontWeight = FontWeight.Bold)
                        }
                        upd.needsInstallPermission -> Button(
                            onClick = { viewModel.openInstallPermissionSettings() },
                            colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary)
                        ) { Text("Permitir Instalação", fontWeight = FontWeight.Bold) }
                        !upd.downloadedApkPath.isNullOrBlank() -> Button(
                            onClick = { viewModel.installDownloadedApkIfReady() },
                            colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary)
                        ) { Text("Instalar Agora", fontWeight = FontWeight.Bold) }
                        else -> Button(
                            onClick = { viewModel.startUpdateDownload() },
                            colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary)
                        ) { Text("Atualizar Agora", fontWeight = FontWeight.Bold) }
                    }
                },
                dismissButton = {
                    if (!upd.downloading) {
                        TextButton(onClick = { viewModel.dismissUpdateDialog() }) {
                            Text("Depois", color = palette.textMuted)
                        }
                    }
                }
            )
        }
    }
}

@Composable
private fun SplashScreen() {
    val palette = LocalYacaPalette.current
    Box(modifier = Modifier.fillMaxSize().background(palette.background), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Image(
                painter = painterResource(id = R.drawable.yacacode_logo),
                contentDescription = null,
                modifier = Modifier.size(84.dp)
            )
            Text("YacaCode", style = MaterialTheme.typography.headlineMedium, color = palette.text)
            Text("Conectando a painel.yacacode.com…", fontSize = 13.sp, color = palette.textMuted)
            CircularProgressIndicator(color = palette.primary, modifier = Modifier.size(26.dp), strokeWidth = 2.5.dp)
        }
    }
}

@Composable
private fun BiometricLockShield(viewModel: MainViewModel) {
    val palette = LocalYacaPalette.current
    val activity = LocalContext.current as? FragmentActivity

    fun triggerUnlock() {
        val act = activity ?: return
        BiometricHelper.promptBiometric(
            activity = act,
            title = "Desbloquear YacaCode MC",
            subtitle = "Confirme sua biometria para acessar o painel",
            onSuccess = { viewModel.unlockBiometricShield() },
            onError = {}
        )
    }

    LaunchedEffect(Unit) { triggerUnlock() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background.copy(alpha = 0.96f)),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(28.dp)
        ) {
            Image(
                painter = painterResource(id = R.drawable.yacacode_logo),
                contentDescription = null,
                modifier = Modifier.size(72.dp)
            )
            Text("Painel Protegido", style = MaterialTheme.typography.headlineMedium, color = palette.text)
            Text(
                "Use sua digital ou biometria para continuar gerenciando o servidor.",
                color = palette.textMuted,
                textAlign = TextAlign.Center,
                fontSize = 14.sp
            )
            Button(
                onClick = { triggerUnlock() },
                colors = ButtonDefaults.buttonColors(containerColor = palette.primary, contentColor = palette.onPrimary),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth().height(50.dp)
            ) {
                Icon(Icons.Rounded.Fingerprint, contentDescription = null)
                Spacer(modifier = Modifier.size(8.dp))
                Text("Desbloquear com Digital", fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = { viewModel.logout(clearSavedBiometrics = false) }) {
                Text("Trocar conta", color = palette.textMuted)
            }
        }
    }
}

@Composable
private fun MainShell(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val palette = LocalYacaPalette.current
    val isTerminal = uiState.selectedTab == AppTab.TERMINAL

    // Pressing system Back on any non-Overview tab smoothly returns to Overview
    BackHandler(enabled = uiState.selectedTab != AppTab.OVERVIEW && uiState.selectedTab != AppTab.MANAGE) {
        viewModel.selectTab(AppTab.OVERVIEW)
    }

    Scaffold(
        containerColor = if (isTerminal) TermiusColors.Bg else palette.background,
        bottomBar = {
            NavigationBar(
                containerColor = if (isTerminal) TermiusColors.Chrome else palette.surface,
                contentColor = if (isTerminal) TermiusColors.Text else palette.text,
                tonalElevation = 0.dp,
                modifier = Modifier.navigationBarsPadding()
            ) {
                val navItems = listOf(
                    Triple(AppTab.OVERVIEW, "Início", Icons.Rounded.Dashboard),
                    Triple(AppTab.AI, "Gemini IA", Icons.Rounded.AutoAwesome),
                    Triple(AppTab.TERMINAL, "Terminal", Icons.Rounded.Terminal),
                    Triple(AppTab.PLAYERS, "Jogadores", Icons.Rounded.Groups),
                    Triple(AppTab.MANAGE, "Gerenciar", Icons.Rounded.Tune)
                )

                navItems.forEach { (tab, label, icon) ->
                    val selected = uiState.selectedTab == tab
                    NavigationBarItem(
                        selected = selected,
                        onClick = { viewModel.selectTab(tab) },
                        icon = {
                            if (tab == AppTab.PLAYERS && uiState.onlinePlayersCount > 0) {
                                BadgedBox(badge = {
                                    Badge(containerColor = palette.primary, contentColor = palette.onPrimary) {
                                        Text("${uiState.onlinePlayersCount}")
                                    }
                                }) {
                                    Icon(icon, contentDescription = label)
                                }
                            } else if (tab == AppTab.MANAGE && uiState.updateState.availableUpdate != null) {
                                BadgedBox(badge = {
                                    Badge(containerColor = palette.accent)
                                }) {
                                    Icon(icon, contentDescription = label)
                                }
                            } else {
                                Icon(icon, contentDescription = label)
                            }
                        },
                        label = { Text(label, fontSize = 11.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = palette.primary,
                            selectedTextColor = palette.primary,
                            indicatorColor = palette.primary.copy(alpha = 0.16f),
                            unselectedIconColor = if (isTerminal) TermiusColors.Muted else palette.textMuted,
                            unselectedTextColor = if (isTerminal) TermiusColors.Muted else palette.textMuted
                        )
                    )
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(bottom = innerPadding.calculateBottomPadding())
                .consumeWindowInsets(innerPadding)
        ) {
            Crossfade(
                targetState = uiState.selectedTab,
                animationSpec = tween(180),
                label = "tabCrossfade"
            ) { tab ->
                when (tab) {
                    AppTab.OVERVIEW -> OverviewScreen(uiState = uiState, viewModel = viewModel)
                    AppTab.AI -> AiChatScreen(uiState = uiState, viewModel = viewModel)
                    AppTab.TERMINAL -> TerminalScreen(uiState = uiState, viewModel = viewModel)
                    AppTab.PLAYERS -> PlayersScreen(uiState = uiState, viewModel = viewModel)
                    AppTab.MANAGE -> ManageTabRoot(uiState = uiState, viewModel = viewModel)
                }
            }
        }
    }
}
