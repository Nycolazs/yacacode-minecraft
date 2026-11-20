import SwiftUI

struct TelemetryChartView: View {
    let points: [TelemetryPoint]
    let liveStats: ContainerStats?
    let host: HostOverview?

    @State private var selectedIndex: Int? = nil

    private var cores: Int {
        liveStats?.onlineCpus ?? host?.cpuCores ?? 4
    }

    private var normalizedPoints: [(ts: Double, memMB: Double, cpuPct: Double, tempC: Double?)] {
        points.map { p in
            let cpu = p.mcCpuPercent > 100
                ? min(100.0, (p.mcCpuPercent / Double(max(1, cores))))
                : max(0.0, p.mcCpuPercent)
            return (p.ts, max(0.0, p.mcMemMB), cpu, p.tempC)
        }
    }

    private var maxMemMB: Double {
        let limit = liveStats.map { Double($0.memLimitBytes) / (1024 * 1024) } ?? 768
        let peak = normalizedPoints.map(\.memMB).max() ?? 0
        return max(256, max(limit, peak * 1.1))
    }

    private var currentMemMB: Int {
        if let stats = liveStats {
            return Int(round(Double(stats.memUsedBytes) / (1024 * 1024)))
        }
        return Int(round(normalizedPoints.last?.memMB ?? 0))
    }

    private var currentCpu: Double {
        liveStats?.cpuPercent ?? normalizedPoints.last?.cpuPct ?? 0
    }

    private var currentTemp: Double? {
        host?.temperature?.celsius ?? normalizedPoints.last?.tempC
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text("Telemetria em Tempo Real")
                            .font(.headline)
                            .foregroundStyle(YCColors.text)
                        HStack(spacing: 5) {
                            PulsingDot(color: YCColors.ok, active: true)
                            Text("AO VIVO")
                                .font(.system(size: 10, weight: .heavy))
                                .tracking(0.6)
                                .foregroundStyle(YCColors.ok)
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(YCColors.ok.opacity(0.14))
                        .clipShape(Capsule())
                    }
                    Text(windowSubtitle)
                        .font(.caption)
                        .foregroundStyle(YCColors.textMuted)
                }
                Spacer()
            }

            // Legend Pills
            HStack(spacing: 8) {
                legendPill(color: YCColors.primary, label: "RAM", value: "\(currentMemMB) MB")
                legendPill(color: YCColors.accent, label: "CPU", value: String(format: "%.1f%%", currentCpu))
                legendPill(color: YCColors.info, label: "Temp", value: currentTemp.map { String(format: "%.1f°C", $0) } ?? "--°C")
            }

            // Interactive Canvas Chart
            ZStack(alignment: .topLeading) {
                if normalizedPoints.isEmpty {
                    VStack(spacing: 8) {
                        ProgressView()
                        Text("Coletando amostras do Orange Pi…")
                            .font(.caption)
                            .foregroundStyle(YCColors.textMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 190)
                } else {
                    GeometryReader { geo in
                        let w = geo.size.width
                        let h = geo.size.height
                        let padL: CGFloat = 34
                        let padR: CGFloat = 38
                        let padT: CGFloat = 14
                        let padB: CGFloat = 22
                        let plotW = max(10, w - padL - padR)
                        let plotH = max(10, h - padT - padB)
                        let pts = normalizedPoints
                        let stepX = pts.count > 1 ? plotW / CGFloat(pts.count - 1) : 0

                        let memCoords: [CGPoint] = pts.enumerated().map { idx, p in
                            let x = padL + (pts.count > 1 ? CGFloat(idx) * stepX : plotW / 2)
                            let y = padT + plotH - CGFloat(min(maxMemMB, p.memMB) / maxMemMB) * plotH
                            return CGPoint(x: x, y: y)
                        }
                        let cpuCoords: [CGPoint] = pts.enumerated().map { idx, p in
                            let x = padL + (pts.count > 1 ? CGFloat(idx) * stepX : plotW / 2)
                            let y = padT + plotH - CGFloat(min(100, p.cpuPct) / 100.0) * plotH
                            return CGPoint(x: x, y: y)
                        }
                        let tempCoords: [CGPoint] = pts.enumerated().compactMap { idx, p in
                            guard let t = p.tempC else { return nil }
                            let x = padL + (pts.count > 1 ? CGFloat(idx) * stepX : plotW / 2)
                            let y = padT + plotH - CGFloat(min(100, max(0, t)) / 100.0) * plotH
                            return CGPoint(x: x, y: y)
                        }

                        Canvas { ctx, _ in
                            // Gridlines + Dual Y Axis Labels
                            for i in 0...4 {
                                let ratio = CGFloat(i) / 4.0
                                let y = padT + ratio * plotH
                                var gridPath = Path()
                                gridPath.move(to: CGPoint(x: padL, y: y))
                                gridPath.addLine(to: CGPoint(x: w - padR, y: y))
                                ctx.stroke(
                                    gridPath,
                                    with: .color(YCColors.text.opacity(i == 4 ? 0.18 : 0.07)),
                                    lineWidth: 1
                                )

                                let pctText = "\(Int((1.0 - ratio) * 100))%"
                                ctx.draw(
                                    Text(pctText).font(.system(size: 9, design: .monospaced)).foregroundStyle(YCColors.textMuted),
                                    at: CGPoint(x: padL - 16, y: y)
                                )

                                let memVal = maxMemMB * Double(1.0 - ratio)
                                let memLabel = memVal >= 1024 ? String(format: "%.1fG", memVal / 1024) : "\(Int(round(memVal)))M"
                                ctx.draw(
                                    Text(memLabel).font(.system(size: 9, design: .monospaced)).foregroundStyle(YCColors.primary),
                                    at: CGPoint(x: w - padR + 18, y: y)
                                )
                            }

                            // Area fills
                            let baseY = padT + plotH
                            if cpuCoords.count > 1 {
                                let area = smoothAreaPath(coords: cpuCoords, baseY: baseY)
                                ctx.fill(area, with: .linearGradient(
                                    Gradient(colors: [YCColors.accent.opacity(0.22), YCColors.accent.opacity(0.0)]),
                                    startPoint: CGPoint(x: 0, y: padT),
                                    endPoint: CGPoint(x: 0, y: baseY)
                                ))
                            }
                            if memCoords.count > 1 {
                                let area = smoothAreaPath(coords: memCoords, baseY: baseY)
                                ctx.fill(area, with: .linearGradient(
                                    Gradient(colors: [YCColors.primary.opacity(0.38), YCColors.primary.opacity(0.02)]),
                                    startPoint: CGPoint(x: 0, y: padT),
                                    endPoint: CGPoint(x: 0, y: baseY)
                                ))
                            }

                            // Curves
                            if tempCoords.count > 1 {
                                ctx.stroke(
                                    smoothLinePath(coords: tempCoords),
                                    with: .color(YCColors.info.opacity(0.88)),
                                    style: StrokeStyle(lineWidth: 1.8, lineCap: .round)
                                )
                            }
                            if cpuCoords.count > 1 {
                                ctx.stroke(
                                    smoothLinePath(coords: cpuCoords),
                                    with: .color(YCColors.accent),
                                    style: StrokeStyle(lineWidth: 2.0, lineCap: .round)
                                )
                            }
                            if memCoords.count > 1 {
                                ctx.stroke(
                                    smoothLinePath(coords: memCoords),
                                    with: .color(YCColors.primary),
                                    style: StrokeStyle(lineWidth: 2.6, lineCap: .round)
                                )
                            }

                            // X axis timestamps (start, middle, Agora)
                            let xIndices = pts.count >= 3 ? [0, pts.count / 2, pts.count - 1] : [0, pts.count - 1]
                            for (pos, idx) in xIndices.enumerated() where idx < memCoords.count {
                                let label = pos == xIndices.count - 1 ? "Agora" : Formatters.shortTime(ms: pts[idx].ts)
                                ctx.draw(
                                    Text(label).font(.system(size: 9, design: .monospaced)).foregroundStyle(YCColors.textMuted),
                                    at: CGPoint(x: memCoords[idx].x, y: h - 8)
                                )
                            }

                            // Latest point dots or active crosshair
                            let activeIdx = selectedIndex ?? (pts.count - 1)
                            if activeIdx >= 0 && activeIdx < memCoords.count {
                                let mPt = memCoords[activeIdx]
                                let cPt = cpuCoords[activeIdx]
                                if selectedIndex != nil {
                                    var line = Path()
                                    line.move(to: CGPoint(x: mPt.x, y: padT))
                                    line.addLine(to: CGPoint(x: mPt.x, y: baseY))
                                    ctx.stroke(
                                        line,
                                        with: .color(YCColors.text.opacity(0.35)),
                                        style: StrokeStyle(lineWidth: 1, dash: [3, 3])
                                    )
                                }
                                drawDot(ctx: ctx, pt: cPt, color: YCColors.accent, radius: selectedIndex != nil ? 4.5 : 3.2)
                                drawDot(ctx: ctx, pt: mPt, color: YCColors.primary, radius: selectedIndex != nil ? 5.0 : 3.8)
                                if let t = pts[activeIdx].tempC {
                                    let ty = padT + plotH - CGFloat(min(100, max(0, t)) / 100.0) * plotH
                                    drawDot(ctx: ctx, pt: CGPoint(x: mPt.x, y: ty), color: YCColors.info, radius: selectedIndex != nil ? 4.0 : 2.8)
                                }
                            }
                        }
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onChanged { value in
                                    let clampedX = min(max(value.location.x, padL), w - padR)
                                    let ratio = (clampedX - padL) / max(1, plotW)
                                    let idx = Int(round(ratio * CGFloat(max(0, pts.count - 1))))
                                    let safeIdx = min(max(0, idx), pts.count - 1)
                                    if selectedIndex != safeIdx {
                                        selectedIndex = safeIdx
                                        Haptics.selection()
                                    }
                                }
                                .onEnded { _ in
                                    selectedIndex = nil
                                }
                        )

                        // Floating Glass Tooltip when scrubbing
                        if let idx = selectedIndex, idx < pts.count {
                            let sample = pts[idx]
                            let isRightHalf = idx > pts.count / 2
                            VStack(alignment: .leading, spacing: 3) {
                                Text(Formatters.shortTime(ms: sample.ts))
                                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                                    .foregroundStyle(YCColors.textMuted)
                                HStack(spacing: 4) {
                                    Circle().fill(YCColors.primary).frame(width: 6, height: 6)
                                    Text("RAM: \(Int(round(sample.memMB))) MB")
                                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                                        .foregroundStyle(YCColors.primary)
                                }
                                HStack(spacing: 4) {
                                    Circle().fill(YCColors.accent).frame(width: 6, height: 6)
                                    Text(String(format: "CPU: %.1f%%", sample.cpuPct))
                                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                                        .foregroundStyle(YCColors.accent)
                                }
                                if let t = sample.tempC {
                                    HStack(spacing: 4) {
                                        Circle().fill(YCColors.info).frame(width: 6, height: 6)
                                        Text(String(format: "SoC: %.1f°C", t))
                                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                                            .foregroundStyle(YCColors.info)
                                    }
                                }
                            }
                            .padding(8)
                            .background(.ultraThickMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(YCColors.borderStrong, lineWidth: 1)
                            )
                            .padding(.top, 8)
                            .padding(isRightHalf ? .leading : .trailing, 42)
                            .frame(maxWidth: .infinity, alignment: isRightHalf ? .topLeading : .topTrailing)
                            .allowsHitTesting(false)
                        }
                    }
                    .frame(height: 200)
                }
            }

            // Telemetry Footer Stats
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                footerStat(title: "RAM Atual / Pico", value: ramPeakSummary)
                footerStat(title: "CPU Média / Pico", value: cpuPeakSummary)
                footerStat(title: "Faixa Térmica SoC", value: tempRangeSummary)
                footerStat(title: "Tráfego (RX / TX)", value: networkTrafficSummary)
            }
        }
        .ycCard()
    }

    private func legendPill(color: Color, label: String, value: String) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label)
                .font(.caption2)
                .foregroundStyle(YCColors.textMuted)
            Text(value)
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(YCColors.text)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(YCColors.surfaceElevated)
        .clipShape(Capsule())
    }

    private func footerStat(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(YCColors.textMuted)
            Text(value)
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(YCColors.text)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(YCColors.background)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var windowSubtitle: String {
        guard let first = normalizedPoints.first, let last = normalizedPoints.last else {
            return "Histórico de RAM (MB), CPU (%) e Temperatura (°C)"
        }
        let spanSec = max(10, Int(round((last.ts - first.ts) / 1000.0)))
        let spanLabel = spanSec >= 60 ? "\(spanSec / 60) min" : "\(spanSec)s"
        return "\(normalizedPoints.count) amostras (\(spanLabel)) • Arraste para inspecionar"
    }

    private var ramPeakSummary: String {
        let peak = max(currentMemMB, Int(round(normalizedPoints.map(\.memMB).max() ?? 0)))
        return "\(currentMemMB) / \(peak) MB"
    }

    private var cpuPeakSummary: String {
        guard !normalizedPoints.isEmpty else { return "-- / --%" }
        let avg = normalizedPoints.map(\.cpuPct).reduce(0, +) / Double(normalizedPoints.count)
        let peak = max(currentCpu, normalizedPoints.map(\.cpuPct).max() ?? 0)
        return String(format: "%.1f%% / %.1f%%", avg, peak)
    }

    private var tempRangeSummary: String {
        let temps = normalizedPoints.compactMap(\.tempC).filter { $0 > 0 }
        let minT = temps.min() ?? currentTemp
        let maxT = temps.max() ?? currentTemp
        if let minT, let maxT {
            return String(format: "%.1f°C – %.1f°C", minT, maxT)
        }
        return "Sensor N/D"
    }

    private var networkTrafficSummary: String {
        guard let stats = liveStats else { return "↓ 0 B / ↑ 0 B" }
        return "↓ \(Formatters.bytes(stats.rxBytes)) / ↑ \(Formatters.bytes(stats.txBytes))"
    }

    private func smoothLinePath(coords: [CGPoint]) -> Path {
        var path = Path()
        guard let first = coords.first else { return path }
        path.move(to: first)
        for i in 0..<(coords.count - 1) {
            let p0 = coords[i]
            let p1 = coords[i + 1]
            let cpx = (p0.x + p1.x) / 2
            path.addCurve(to: p1, control1: CGPoint(x: cpx, y: p0.y), control2: CGPoint(x: cpx, y: p1.y))
        }
        return path
    }

    private func smoothAreaPath(coords: [CGPoint], baseY: CGFloat) -> Path {
        var path = smoothLinePath(coords: coords)
        guard let first = coords.first, let last = coords.last else { return path }
        path.addLine(to: CGPoint(x: last.x, y: baseY))
        path.addLine(to: CGPoint(x: first.x, y: baseY))
        path.closeSubpath()
        return path
    }

    private func drawDot(ctx: GraphicsContext, pt: CGPoint, color: Color, radius: CGFloat) {
        let rect = CGRect(x: pt.x - radius, y: pt.y - radius, width: radius * 2, height: radius * 2)
        ctx.fill(Path(ellipseIn: rect), with: .color(color))
        ctx.stroke(Path(ellipseIn: rect), with: .color(YCColors.background), lineWidth: 1.5)
    }
}
