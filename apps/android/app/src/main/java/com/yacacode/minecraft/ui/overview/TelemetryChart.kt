package com.yacacode.minecraft.ui.overview

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yacacode.minecraft.data.ContainerStats
import com.yacacode.minecraft.data.HostOverview
import com.yacacode.minecraft.data.TelemetryPoint
import com.yacacode.minecraft.ui.common.PulsingDot
import com.yacacode.minecraft.ui.common.YacaCard
import com.yacacode.minecraft.ui.theme.Formatters
import com.yacacode.minecraft.ui.theme.LocalYacaPalette
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private data class NormSample(
    val ts: Long,
    val memMB: Double,
    val cpuPct: Double,
    val tempC: Double?
)

@Composable
fun TelemetryChartCard(
    points: List<TelemetryPoint>,
    liveStats: ContainerStats?,
    host: HostOverview?
) {
    val palette = LocalYacaPalette.current
    val cores = liveStats?.onlineCpus ?: host?.cpuCores ?: 4
    val samples = remember(points, cores) {
        points.map { p ->
            val cpu = if (p.mcCpuPercent > 100.0) {
                min(100.0, p.mcCpuPercent / max(1, cores))
            } else {
                p.mcCpuPercent.coerceAtLeast(0.0)
            }
            NormSample(p.ts, p.mcMemMB.coerceAtLeast(0.0), cpu, p.tempC)
        }
    }

    val limitMB = liveStats?.let { it.memLimitBytes / (1024.0 * 1024.0) } ?: 768.0
    val peakSampleMem = samples.maxOfOrNull { it.memMB } ?: 0.0
    val maxMemMB = max(256.0, max(limitMB, peakSampleMem * 1.1))

    val curMem = liveStats?.let { (it.memUsedBytes / (1024.0 * 1024.0)).roundToInt() }
        ?: samples.lastOrNull()?.memMB?.roundToInt() ?: 0
    val curCpu = liveStats?.cpuPercent ?: samples.lastOrNull()?.cpuPct ?: 0.0
    val curTemp = host?.temperature?.celsius ?: samples.lastOrNull()?.tempC

    var selectedIdx by remember { mutableStateOf<Int?>(null) }

    YacaCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("Telemetria em Tempo Real", style = MaterialTheme.typography.titleMedium, color = palette.text)
                    Row(
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(palette.ok.copy(alpha = 0.14f))
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        PulsingDot(color = palette.ok, active = true, size = 6.dp)
                        Text("AO VIVO", color = palette.ok, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
                val spanText = if (samples.size >= 2) {
                    val sec = max(10L, (samples.last().ts - samples.first().ts) / 1000L)
                    val dur = if (sec >= 60) "${sec / 60} min" else "${sec}s"
                    "${samples.size} amostras ($dur) • Arraste para inspecionar"
                } else {
                    "Histórico de RAM (MB), CPU (%) e Temperatura (°C)"
                }
                Text(spanText, fontSize = 11.sp, color = palette.textMuted)
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Legend pills
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LegendChip(palette.primary, "RAM", "$curMem MB")
            LegendChip(palette.accent, "CPU", String.format("%.1f%%", curCpu))
            LegendChip(palette.info, "Temp", curTemp?.let { String.format("%.1f°C", it) } ?: "--°C")
        }

        Spacer(modifier = Modifier.height(12.dp))

        if (samples.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(180.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp, color = palette.primary)
                    Text("Coletando amostras do Orange Pi…", fontSize = 12.sp, color = palette.textMuted)
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(190.dp)
            ) {
                Canvas(
                    modifier = Modifier
                        .matchParentSize()
                        .pointerInput(samples) {
                            detectHorizontalDragGestures(
                                onDragEnd = { selectedIdx = null },
                                onDragCancel = { selectedIdx = null },
                                onHorizontalDrag = { change, _ ->
                                    val padL = 16f
                                    val padR = 16f
                                    val plotW = (size.width - padL - padR).coerceAtLeast(1f)
                                    val ratio = ((change.position.x - padL) / plotW).coerceIn(0f, 1f)
                                    selectedIdx = (ratio * (samples.size - 1)).roundToInt().coerceIn(0, samples.lastIndex)
                                }
                            )
                        }
                        .pointerInput(samples) {
                            detectTapGestures(onTap = { pos ->
                                val ratio = (pos.x / size.width.coerceAtLeast(1)).coerceIn(0f, 1f)
                                val idx = (ratio * (samples.size - 1)).roundToInt().coerceIn(0, samples.lastIndex)
                                selectedIdx = if (selectedIdx == idx) null else idx
                            })
                        }
                ) {
                    val padL = 12.dp.toPx()
                    val padR = 12.dp.toPx()
                    val padT = 12.dp.toPx()
                    val padB = 14.dp.toPx()
                    val plotW = (size.width - padL - padR).coerceAtLeast(10f)
                    val plotH = (size.height - padT - padB).coerceAtLeast(10f)
                    val baseY = padT + plotH
                    val stepX = if (samples.size > 1) plotW / (samples.size - 1) else 0f

                    // Grid lines
                    for (i in 0..4) {
                        val y = padT + (i / 4f) * plotH
                        drawLine(
                            color = palette.text.copy(alpha = if (i == 4) 0.18f else 0.07f),
                            start = Offset(padL, y),
                            end = Offset(size.width - padR, y),
                            strokeWidth = 1.dp.toPx()
                        )
                    }

                    val memPts = samples.mapIndexed { idx, s ->
                        val x = padL + if (samples.size > 1) idx * stepX else plotW / 2f
                        val y = padT + plotH - ((min(maxMemMB, s.memMB) / maxMemMB).toFloat() * plotH)
                        Offset(x, y)
                    }
                    val cpuPts = samples.mapIndexed { idx, s ->
                        val x = padL + if (samples.size > 1) idx * stepX else plotW / 2f
                        val y = padT + plotH - ((min(100.0, s.cpuPct) / 100.0).toFloat() * plotH)
                        Offset(x, y)
                    }
                    val tempPts = samples.mapIndexedNotNull { idx, s ->
                        val t = s.tempC ?: return@mapIndexedNotNull null
                        val x = padL + if (samples.size > 1) idx * stepX else plotW / 2f
                        val y = padT + plotH - ((min(100.0, max(0.0, t)) / 100.0).toFloat() * plotH)
                        Offset(x, y)
                    }

                    if (cpuPts.size > 1) {
                        drawPath(
                            path = buildSmoothArea(cpuPts, baseY),
                            brush = Brush.verticalGradient(
                                listOf(palette.accent.copy(alpha = 0.22f), Color.Transparent),
                                startY = padT,
                                endY = baseY
                            )
                        )
                    }
                    if (memPts.size > 1) {
                        drawPath(
                            path = buildSmoothArea(memPts, baseY),
                            brush = Brush.verticalGradient(
                                listOf(palette.primary.copy(alpha = 0.36f), Color.Transparent),
                                startY = padT,
                                endY = baseY
                            )
                        )
                    }

                    if (tempPts.size > 1) {
                        drawPath(
                            path = buildSmoothPath(tempPts),
                            color = palette.info.copy(alpha = 0.85f),
                            style = Stroke(width = 1.8.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }
                    if (cpuPts.size > 1) {
                        drawPath(
                            path = buildSmoothPath(cpuPts),
                            color = palette.accent,
                            style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }
                    if (memPts.size > 1) {
                        drawPath(
                            path = buildSmoothPath(memPts),
                            color = palette.primary,
                            style = Stroke(width = 2.6.dp.toPx(), cap = StrokeCap.Round)
                        )
                    }

                    val active = selectedIdx ?: samples.lastIndex
                    if (active in memPts.indices) {
                        val mp = memPts[active]
                        val cp = cpuPts[active]
                        if (selectedIdx != null) {
                            drawLine(
                                color = palette.text.copy(alpha = 0.35f),
                                start = Offset(mp.x, padT),
                                end = Offset(mp.x, baseY),
                                strokeWidth = 1.dp.toPx(),
                                pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f))
                            )
                        }
                        val r = if (selectedIdx != null) 5.dp.toPx() else 3.8.dp.toPx()
                        drawCircle(palette.accent, radius = r * 0.85f, center = cp)
                        drawCircle(palette.primary, radius = r, center = mp)
                    }
                }

                // Floating inspection tooltip
                val sel = selectedIdx?.let { samples.getOrNull(it) }
                if (sel != null) {
                    val isRightHalf = (selectedIdx ?: 0) > samples.size / 2
                    Box(
                        modifier = Modifier
                            .align(if (isRightHalf) Alignment.TopStart else Alignment.TopEnd)
                            .padding(8.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(palette.surface.copy(alpha = 0.94f))
                            .border(1.dp, palette.borderStrong, RoundedCornerShape(10.dp))
                            .padding(horizontal = 10.dp, vertical = 7.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                Formatters.shortTime(sel.ts),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = palette.textMuted
                            )
                            Text(
                                "RAM: ${sel.memMB.roundToInt()} MB",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = palette.primary
                            )
                            Text(
                                String.format("CPU: %.1f%%", sel.cpuPct),
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = palette.accent
                            )
                            sel.tempC?.let {
                                Text(
                                    String.format("SoC: %.1f°C", it),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = FontFamily.Monospace,
                                    color = palette.info
                                )
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Summary Footer Grid
        val peakMem = max(curMem, samples.maxOfOrNull { it.memMB.roundToInt() } ?: 0)
        val avgCpu = if (samples.isNotEmpty()) samples.map { it.cpuPct }.average() else 0.0
        val peakCpu = max(curCpu, samples.maxOfOrNull { it.cpuPct } ?: 0.0)
        val temps = samples.mapNotNull { it.tempC }.filter { it > 0 }
        val tempRange = if (temps.isNotEmpty()) {
            String.format("%.1f°C – %.1f°C", temps.min(), temps.max())
        } else curTemp?.let { String.format("%.1f°C", it) } ?: "Sensor N/D"
        val netTraffic = if (liveStats != null) {
            "↓ ${Formatters.bytes(liveStats.rxBytes)} / ↑ ${Formatters.bytes(liveStats.txBytes)}"
        } else "↓ 0 B / ↑ 0 B"

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                FooterMetric("RAM Atual / Pico", "$curMem / $peakMem MB", Modifier.weight(1f))
                FooterMetric("CPU Média / Pico", String.format("%.1f%% / %.1f%%", avgCpu, peakCpu), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                FooterMetric("Faixa Térmica SoC", tempRange, Modifier.weight(1f))
                FooterMetric("Tráfego (RX / TX)", netTraffic, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun LegendChip(color: Color, label: String, value: String) {
    val palette = LocalYacaPalette.current
    Row(
        modifier = Modifier
            .clip(CircleShape)
            .background(palette.surfaceElevated)
            .padding(horizontal = 9.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Box(modifier = Modifier.size(7.dp).clip(CircleShape).background(color))
        Text(label, fontSize = 11.sp, color = palette.textMuted)
        Text(value, fontSize = 11.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = palette.text)
    }
}

@Composable
private fun FooterMetric(title: String, value: String, modifier: Modifier) {
    val palette = LocalYacaPalette.current
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(palette.background)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(title, fontSize = 10.sp, color = palette.textMuted, maxLines = 1)
        Text(value, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, color = palette.text, maxLines = 1)
    }
}

private fun buildSmoothPath(coords: List<Offset>): Path = Path().apply {
    if (coords.isEmpty()) return@apply
    moveTo(coords[0].x, coords[0].y)
    for (i in 0 until coords.lastIndex) {
        val p0 = coords[i]
        val p1 = coords[i + 1]
        val cpx = (p0.x + p1.x) / 2f
        cubicTo(cpx, p0.y, cpx, p1.y, p1.x, p1.y)
    }
}

private fun buildSmoothArea(coords: List<Offset>, baseY: Float): Path = buildSmoothPath(coords).apply {
    if (coords.isEmpty()) return@apply
    lineTo(coords.last().x, baseY)
    lineTo(coords.first().x, baseY)
    close()
}
