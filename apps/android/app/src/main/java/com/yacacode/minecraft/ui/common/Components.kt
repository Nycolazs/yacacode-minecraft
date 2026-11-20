package com.yacacode.minecraft.ui.common

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
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.data.MarkdownBlock
import com.yacacode.minecraft.data.MarkdownParser
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import com.yacacode.minecraft.ui.theme.TermiusColors

@Composable
fun YacaCard(
    modifier: Modifier = Modifier,
    padding: Dp = 16.dp,
    cornerRadius: Dp = 18.dp,
    borderColor: Color? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    val palette = LocalYacaPalette.current
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(cornerRadius),
        color = palette.surface,
        border = BorderStroke(1.dp, borderColor ?: palette.border)
    ) {
        Column(modifier = Modifier.padding(padding), content = content)
    }
}

@Composable
fun YacaPill(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null
) {
    Row(
        modifier = modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        if (icon != null) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(12.dp)
            )
        }
        Text(
            text = text,
            color = color,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
fun PulsingDot(
    color: Color,
    active: Boolean = true,
    size: Dp = 8.dp
) {
    val infinite = rememberInfiniteTransition(label = "pulse")
    val scale by infinite.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.65f,
        animationSpec = infiniteRepeatable(tween(1300), RepeatMode.Reverse),
        label = "pulseScale"
    )
    val alpha by infinite.animateFloat(
        initialValue = 0.55f,
        targetValue = 0.1f,
        animationSpec = infiniteRepeatable(tween(1300), RepeatMode.Reverse),
        label = "pulseAlpha"
    )

    Box(modifier = Modifier.size(size * 1.8f), contentAlignment = Alignment.Center) {
        if (active) {
            Box(
                modifier = Modifier
                    .size(size)
                    .scale(scale)
                    .clip(CircleShape)
                    .background(color.copy(alpha = alpha))
            )
        }
        Box(
            modifier = Modifier
                .size(size)
                .clip(CircleShape)
                .background(color)
        )
    }
}

@Composable
fun MarkdownMessageContent(
    text: String,
    onCopied: (String) -> Unit = {}
) {
    val palette = LocalYacaPalette.current
    val clipboard = LocalClipboardManager.current
    val blocks = MarkdownParser.parse(text)

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        blocks.forEach { block ->
            when (block) {
                is MarkdownBlock.Heading -> {
                    Text(
                        text = renderInlineMarkdown(block.text, palette.primary, palette.surfaceElevated),
                        style = when (block.level) {
                            1 -> MaterialTheme.typography.titleLarge
                            2 -> MaterialTheme.typography.titleMedium
                            else -> MaterialTheme.typography.titleSmall
                        },
                        color = palette.text
                    )
                }

                is MarkdownBlock.Paragraph -> {
                    Text(
                        text = renderInlineMarkdown(block.text, palette.primary, palette.surfaceElevated),
                        style = MaterialTheme.typography.bodyLarge,
                        color = palette.text
                    )
                }

                is MarkdownBlock.BulletList -> {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        block.items.forEach { item ->
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.Top
                            ) {
                                Box(
                                    modifier = Modifier
                                        .padding(top = 8.dp)
                                        .size(5.dp)
                                        .clip(CircleShape)
                                        .background(palette.primary)
                                )
                                Text(
                                    text = renderInlineMarkdown(item, palette.primary, palette.surfaceElevated),
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = palette.text,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                }

                is MarkdownBlock.CodeBlock -> {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .border(1.dp, TermiusColors.Border, RoundedCornerShape(12.dp))
                            .background(TermiusColors.Bg)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(TermiusColors.Chrome)
                                .padding(horizontal = 12.dp, vertical = 7.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = (block.language ?: "comando").uppercase(),
                                color = TermiusColors.Muted,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace
                            )
                            Spacer(modifier = Modifier.weight(1f))
                            Row(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable {
                                        clipboard.setText(AnnotatedString(block.code))
                                        onCopied("Código copiado!")
                                    }
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    Icons.Rounded.ContentCopy,
                                    contentDescription = "Copiar",
                                    tint = TermiusColors.Cmd,
                                    modifier = Modifier.size(13.dp)
                                )
                                Text(
                                    "Copiar",
                                    color = TermiusColors.Cmd,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState())
                                .padding(12.dp)
                        ) {
                            Text(
                                text = block.code,
                                color = TermiusColors.Text,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.5.sp,
                                lineHeight = 18.sp
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun renderInlineMarkdown(
    source: String,
    accent: Color,
    codeBg: Color
): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < source.length) {
        if (i + 1 < source.length && source[i] == '*' && source[i + 1] == '*') {
            val end = source.indexOf("**", i + 2)
            if (end > i + 2) {
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                    append(source.substring(i + 2, end))
                }
                i = end + 2
                continue
            }
        }
        if (source[i] == '`') {
            val end = source.indexOf('`', i + 1)
            if (end > i + 1) {
                withStyle(
                    SpanStyle(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        color = accent,
                        background = codeBg
                    )
                ) {
                    append(" ${source.substring(i + 1, end)} ")
                }
                i = end + 1
                continue
            }
        }
        append(source[i])
        i++
    }
}
