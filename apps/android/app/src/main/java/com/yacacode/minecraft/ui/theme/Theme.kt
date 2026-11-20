package com.yacacode.minecraft.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale

@Immutable
data class YacaPalette(
    val primary: Color,
    val onPrimary: Color,
    val accent: Color,
    val background: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val border: Color,
    val borderStrong: Color,
    val text: Color,
    val textMuted: Color,
    val ok: Color,
    val warn: Color,
    val danger: Color,
    val info: Color,
    val isDark: Boolean
)

val DarkYacaPalette = YacaPalette(
    primary = Color(0xFF8AB840),
    onPrimary = Color(0xFF0A1006),
    accent = Color(0xFFF0C040),
    background = Color(0xFF0B0D09),
    surface = Color(0xFF131710),
    surfaceElevated = Color(0xFF1A2115),
    border = Color(0xFF1F2B19),
    borderStrong = Color(0xFF2E4025),
    text = Color(0xFFEAECE5),
    textMuted = Color(0xFF8E9984),
    ok = Color(0xFF4ADE80),
    warn = Color(0xFFFBBF24),
    danger = Color(0xFFF87171),
    info = Color(0xFF38BDF8),
    isDark = true
)

val LightYacaPalette = YacaPalette(
    primary = Color(0xFF527215),
    onPrimary = Color(0xFFFFFFFF),
    accent = Color(0xFFB88400),
    background = Color(0xFFF6F8F2),
    surface = Color(0xFFFFFFFF),
    surfaceElevated = Color(0xFFEDF2E4),
    border = Color(0xFFD8E2C4),
    borderStrong = Color(0xFFBFD0A1),
    text = Color(0xFF111311),
    textMuted = Color(0xFF525B47),
    ok = Color(0xFF217A34),
    warn = Color(0xFFB45309),
    danger = Color(0xFFB91C1C),
    info = Color(0xFF0369A1),
    isDark = false
)

object GeminiColors {
    val Blue = Color(0xFF4285F4)
    val Violet = Color(0xFF9B72CB)
    val Coral = Color(0xFFD96570)
    val Lime = Color(0xFF8AB840)

    val SparkleBrush = Brush.linearGradient(listOf(Blue, Violet, Lime))
    val GreetingBrush = Brush.horizontalGradient(listOf(Color(0xFF4E8CF7), Violet, Lime))
}

object TermiusColors {
    val Bg = Color(0xFF090D12)
    val Chrome = Color(0xFF111720)
    val Surface = Color(0xFF161E2B)
    val Border = Color(0xFF232E40)
    val Text = Color(0xFFD7E1EE)
    val Muted = Color(0xFF6E8099)
    val Info = Color(0xFF4ADE80)
    val Warn = Color(0xFFFBBF24)
    val Error = Color(0xFFF87171)
    val Chat = Color(0xFF38BDF8)
    val Geyser = Color(0xFFC084FC)
    val Cmd = Color(0xFF8AB840)
    val Sys = Color(0xFF7DD3FC)
}

val LocalYacaPalette = staticCompositionLocalOf { DarkYacaPalette }

private val DarkM3Scheme = darkColorScheme(
    primary = DarkYacaPalette.primary,
    onPrimary = DarkYacaPalette.onPrimary,
    primaryContainer = Color(0xFF223314),
    onPrimaryContainer = Color(0xFFD4F19E),
    secondary = DarkYacaPalette.accent,
    onSecondary = Color(0xFF1A1400),
    secondaryContainer = Color(0xFF332908),
    onSecondaryContainer = Color(0xFFFFE599),
    tertiary = DarkYacaPalette.info,
    background = DarkYacaPalette.background,
    onBackground = DarkYacaPalette.text,
    surface = DarkYacaPalette.surface,
    onSurface = DarkYacaPalette.text,
    surfaceVariant = DarkYacaPalette.surfaceElevated,
    onSurfaceVariant = DarkYacaPalette.textMuted,
    outline = DarkYacaPalette.borderStrong,
    outlineVariant = DarkYacaPalette.border,
    error = DarkYacaPalette.danger,
    onError = Color.White
)

private val LightM3Scheme = lightColorScheme(
    primary = LightYacaPalette.primary,
    onPrimary = LightYacaPalette.onPrimary,
    primaryContainer = Color(0xFFDCEBC0),
    onPrimaryContainer = Color(0xFF1A2804),
    secondary = LightYacaPalette.accent,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFEDC2),
    onSecondaryContainer = Color(0xFF2E2000),
    tertiary = LightYacaPalette.info,
    background = LightYacaPalette.background,
    onBackground = LightYacaPalette.text,
    surface = LightYacaPalette.surface,
    onSurface = LightYacaPalette.text,
    surfaceVariant = LightYacaPalette.surfaceElevated,
    onSurfaceVariant = LightYacaPalette.textMuted,
    outline = LightYacaPalette.borderStrong,
    outlineVariant = LightYacaPalette.border,
    error = LightYacaPalette.danger,
    onError = Color.White
)

private val YacaTypography = Typography(
    headlineLarge = TextStyle(fontWeight = FontWeight.ExtraBold, fontSize = 28.sp, lineHeight = 34.sp, letterSpacing = (-0.5).sp),
    headlineMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, lineHeight = 22.sp),
    titleSmall = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 15.sp),
    labelSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 10.sp, lineHeight = 13.sp, fontFamily = FontFamily.Monospace)
)

enum class AppearanceMode(val key: String, val label: String) {
    SYSTEM("system", "Sistema"),
    DARK("dark", "Escuro"),
    LIGHT("light", "Claro");

    companion object {
        fun fromKey(key: String?): AppearanceMode = entries.firstOrNull { it.key == key } ?: SYSTEM
    }
}

@Composable
fun YacaCodeTheme(
    appearanceMode: AppearanceMode = AppearanceMode.SYSTEM,
    content: @Composable () -> Unit
) {
    val useDark = when (appearanceMode) {
        AppearanceMode.SYSTEM -> isSystemInDarkTheme()
        AppearanceMode.DARK -> true
        AppearanceMode.LIGHT -> false
    }
    val palette = if (useDark) DarkYacaPalette else LightYacaPalette
    val colorScheme = if (useDark) DarkM3Scheme else LightM3Scheme

    CompositionLocalProvider(LocalYacaPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = YacaTypography,
            content = content
        )
    }
}

object Formatters {
    private val ptBr = Locale("pt", "BR")
    private val brDateFmt = DateTimeFormatter.ofPattern("dd/MM/yy HH:mm", ptBr).withZone(ZoneId.systemDefault())
    private val shortTimeFmt = SimpleDateFormat("HH:mm:ss", ptBr)
    private val hhmmFmt = SimpleDateFormat("HH:mm", ptBr)

    fun bytes(bytes: Long?): String = bytes(bytes?.toDouble())

    fun bytes(bytes: Double?): String {
        val n = (bytes ?: 0.0).coerceAtLeast(0.0)
        return when {
            n < 1024.0 -> "${n.toLong()} B"
            n < 1024.0 * 1024.0 -> String.format(ptBr, "%.1f KB", n / 1024.0)
            n < 1024.0 * 1024.0 * 1024.0 -> String.format(ptBr, "%.1f MB", n / (1024.0 * 1024.0))
            else -> String.format(ptBr, "%.2f GB", n / (1024.0 * 1024.0 * 1024.0))
        }
    }

    fun uptime(iso: String?): String {
        if (iso.isNullOrBlank() || iso.startsWith("0001-")) return "Parado"
        return try {
            val instant = Instant.parse(iso)
            val sec = ((System.currentTimeMillis() - instant.toEpochMilli()) / 1000L).coerceAtLeast(0L)
            val d = sec / 86400
            val h = (sec % 86400) / 3600
            val m = (sec % 3600) / 60
            when {
                d > 0 -> "${d}d ${h}h ${m}m"
                h > 0 -> "${h}h ${m}m"
                else -> "${m}m"
            }
        } catch (_: Exception) {
            "Parado"
        }
    }

    fun dateBR(iso: String?): String {
        if (iso.isNullOrBlank()) return "—"
        return try {
            brDateFmt.format(Instant.parse(iso))
        } catch (_: Exception) {
            iso
        }
    }

    fun shortTime(ms: Long): String = shortTimeFmt.format(Date(ms))
    fun nowHHMM(): String = hhmmFmt.format(Date())

    fun roleLabel(role: String?): String = when (role?.lowercase()) {
        "admin" -> "Administrador"
        "moderator" -> "Moderador"
        "viewer" -> "Visualizador"
        else -> role ?: "Visitante"
    }

    fun generateStrongPassword(length: Int = 12): String {
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"
        val rng = SecureRandom()
        return buildString(length) {
            repeat(length) { append(chars[rng.nextInt(chars.length)]) }
        }
    }
}
