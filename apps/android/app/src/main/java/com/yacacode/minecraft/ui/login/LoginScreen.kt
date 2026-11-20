package com.yacacode.minecraft.ui.login

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Fingerprint
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.yacacode.minecraft.AppUiState
import com.yacacode.minecraft.MainViewModel
import com.yacacode.minecraft.R
import com.yacacode.minecraft.data.BiometricHelper
import com.yacacode.minecraft.data.YacaCodeApiClient
import com.yacacode.minecraft.ui.common.PulsingDot
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    uiState: AppUiState,
    viewModel: MainViewModel
) {
    val palette = LocalYacaPalette.current
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    val activity = LocalContext.current as? FragmentActivity

    var username by remember(uiState.savedUsername) { mutableStateOf(uiState.savedUsername.orEmpty()) }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var rememberBio by remember { mutableStateOf(true) }
    var showServerBox by remember { mutableStateOf(false) }
    var serverUrl by remember(uiState.serverUrl) { mutableStateOf(uiState.serverUrl) }
    var isLoading by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var didAutoPrompt by remember { mutableStateOf(false) }

    val showBioQuickLogin = uiState.biometricAvailable && uiState.biometricLoginEnabled && uiState.hasSavedCredentials

    fun triggerBiometricLogin() {
        val act = activity ?: return
        errorMsg = null
        viewModel.updateServerUrl(serverUrl)
        BiometricHelper.promptBiometric(
            activity = act,
            onSuccess = {
                scope.launch {
                    isLoading = true
                    val res = viewModel.loginWithSavedCredentials()
                    isLoading = false
                    res.onFailure { errorMsg = it.localizedMessage ?: "Falha ao autenticar." }
                }
            },
            onError = { err -> errorMsg = err }
        )
    }

    fun submitLogin() {
        focusManager.clearFocus()
        errorMsg = null
        viewModel.updateServerUrl(serverUrl)
        scope.launch {
            isLoading = true
            val res = viewModel.login(
                username = username,
                password = password,
                rememberForBiometrics = rememberBio && uiState.biometricAvailable
            )
            isLoading = false
            res.onSuccess { password = "" }
                .onFailure { errorMsg = it.localizedMessage ?: "Credenciais inválidas." }
        }
    }

    LaunchedEffect(showBioQuickLogin) {
        if (showBioQuickLogin && !didAutoPrompt) {
            didAutoPrompt = true
            delay(350)
            triggerBiometricLogin()
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
            .background(
                Brush.radialGradient(
                    colors = listOf(palette.primary.copy(alpha = 0.16f), Color.Transparent),
                    radius = 900f
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Spacer(modifier = Modifier.height(10.dp))

            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(86.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(palette.surfaceElevated)
                        .border(1.dp, palette.borderStrong, RoundedCornerShape(24.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Image(
                        painter = painterResource(id = R.drawable.yacacode_logo),
                        contentDescription = "Logo YacaCode",
                        modifier = Modifier.size(64.dp)
                    )
                }

                Text(
                    text = "MINECRAFT CONTROL PLANE",
                    color = palette.primary,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.6.sp
                )
                Text(
                    text = "YacaCode",
                    style = MaterialTheme.typography.headlineLarge,
                    color = palette.text
                )
                Text(
                    text = "Pumpkin Rust 26.3 • Java & Bedrock • 24/7",
                    style = MaterialTheme.typography.bodySmall,
                    color = palette.textMuted
                )

                Row(
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(palette.ok.copy(alpha = 0.12f))
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    PulsingDot(color = palette.ok, active = true, size = 7.dp)
                    Text(
                        text = "painel.yacacode.com • Cloudflare HTTPS",
                        color = palette.ok,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }

            if (showBioQuickLogin) {
                Surface(
                    onClick = { if (!isLoading) triggerBiometricLogin() },
                    shape = RoundedCornerShape(18.dp),
                    color = palette.primary,
                    contentColor = palette.onPrimary,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 15.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        Icon(
                            Icons.Rounded.Fingerprint,
                            contentDescription = null,
                            modifier = Modifier.size(30.dp)
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Entrar com Digital / Biometria",
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp
                            )
                            uiState.savedUsername?.let {
                                Text(
                                    text = "Conta salva: @$it",
                                    fontSize = 12.sp,
                                    color = palette.onPrimary.copy(alpha = 0.8f)
                                )
                            }
                        }
                        Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null)
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    HorizontalDivider(modifier = Modifier.weight(1f), color = palette.border)
                    Text("ou entre com senha", fontSize = 12.sp, color = palette.textMuted)
                    HorizontalDivider(modifier = Modifier.weight(1f), color = palette.border)
                }
            }

            YacaCard(padding = 20.dp, cornerRadius = 22.dp) {
                val fieldColors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = palette.primary,
                    unfocusedBorderColor = palette.borderStrong,
                    focusedContainerColor = palette.background,
                    unfocusedContainerColor = palette.background,
                    focusedTextColor = palette.text,
                    unfocusedTextColor = palette.text
                )

                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("Usuário") },
                    placeholder = { Text("ex: nycolas") },
                    leadingIcon = { Icon(Icons.Rounded.Person, contentDescription = null) },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    colors = fieldColors,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Down) }),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(12.dp))

                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Senha") },
                    placeholder = { Text("••••••••••••") },
                    leadingIcon = { Icon(Icons.Rounded.Lock, contentDescription = null) },
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                                contentDescription = "Mostrar senha"
                            )
                        }
                    },
                    singleLine = true,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    shape = RoundedCornerShape(14.dp),
                    colors = fieldColors,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done
                    ),
                    keyboardActions = KeyboardActions(onDone = { submitLogin() }),
                    modifier = Modifier.fillMaxWidth()
                )

                if (uiState.biometricAvailable) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Rounded.Fingerprint, contentDescription = null, tint = palette.primary)
                            Text(
                                text = "Habilitar login por Digital",
                                style = MaterialTheme.typography.bodyMedium,
                                color = palette.text
                            )
                        }
                        Switch(
                            checked = rememberBio,
                            onCheckedChange = { rememberBio = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = palette.onPrimary, checkedTrackColor = palette.primary)
                        )
                    }
                }

                if (errorMsg != null) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(palette.danger.copy(alpha = 0.12f))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = palette.danger, modifier = Modifier.size(18.dp))
                        Text(errorMsg!!, color = palette.danger, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Button(
                    onClick = { submitLogin() },
                    enabled = !isLoading,
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (showBioQuickLogin) palette.surfaceElevated else palette.primary,
                        contentColor = if (showBioQuickLogin) palette.text else palette.onPrimary
                    ),
                    border = if (showBioQuickLogin) BorderStroke(1.dp, palette.borderStrong) else null,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = if (showBioQuickLogin) palette.text else palette.onPrimary
                        )
                        Spacer(modifier = Modifier.size(10.dp))
                        Text("Autenticando…", fontWeight = FontWeight.Bold)
                    } else {
                        Text("Entrar no Painel", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { showServerBox = !showServerBox }
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Icon(Icons.Rounded.Dns, contentDescription = null, tint = palette.textMuted, modifier = Modifier.size(16.dp))
                        Text("Endereço do servidor", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.textMuted)
                    }
                    Icon(
                        if (showServerBox) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                        contentDescription = null,
                        tint = palette.textMuted
                    )
                }

                AnimatedVisibility(visible = showServerBox) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        OutlinedTextField(
                            value = serverUrl,
                            onValueChange = { serverUrl = it },
                            singleLine = true,
                            textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            shape = RoundedCornerShape(12.dp),
                            colors = fieldColors,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            TextButton(onClick = {
                                serverUrl = YacaCodeApiClient.DEFAULT_PROD_URL
                                viewModel.updateServerUrl(serverUrl)
                            }) {
                                Text("Produção", color = palette.primary, fontSize = 12.sp)
                            }
                            TextButton(onClick = {
                                serverUrl = "http://100.73.198.14:8080"
                                viewModel.updateServerUrl(serverUrl)
                            }) {
                                Text("Tailscale (Orange Pi)", color = palette.primary, fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            Text(
                text = "© 2026 YacaCode • yacacode.com",
                fontSize = 12.sp,
                color = palette.textMuted
            )
        }
    }
}
