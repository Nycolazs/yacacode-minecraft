import SwiftUI
import UIKit

// MARK: - YacaCode Official Design Tokens (Adaptive Light & Dark)

enum YCColors {
    static func adaptive(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light)
        })
    }

    // Brand Core
    static let primary = adaptive(light: 0x527215, dark: 0x8AB840)
    static let primaryHover = adaptive(light: 0x384E0C, dark: 0x9ECC52)
    static let onPrimary = adaptive(light: 0xFFFFFF, dark: 0x0A1006)
    static let accent = adaptive(light: 0xB88400, dark: 0xF0C040)

    // Surfaces
    static let background = adaptive(light: 0xF6F8F2, dark: 0x0B0D09)
    static let surface = adaptive(light: 0xFFFFFF, dark: 0x131710)
    static let surfaceElevated = adaptive(light: 0xEDF2E4, dark: 0x1A2115)
    static let border = adaptive(light: 0xD8E2C4, dark: 0x1F2B19)
    static let borderStrong = adaptive(light: 0xBFD0A1, dark: 0x2E4025)

    // Text
    static let text = adaptive(light: 0x111311, dark: 0xEAECE5)
    static let textMuted = adaptive(light: 0x525B47, dark: 0x8E9984)

    // Semantic
    static let ok = adaptive(light: 0x217A34, dark: 0x4ADE80)
    static let warn = adaptive(light: 0xB45309, dark: 0xFBBF24)
    static let danger = adaptive(light: 0xB91C1C, dark: 0xF87171)
    static let info = adaptive(light: 0x0369A1, dark: 0x38BDF8)

    // Gemini-inspired AI Accents
    static let geminiBlue = Color(hex: 0x4285F4)
    static let geminiViolet = Color(hex: 0x9B72CB)
    static let geminiCoral = Color(hex: 0xD96570)

    static var geminiGradient: LinearGradient {
        LinearGradient(
            colors: [geminiBlue, geminiViolet, Color(hex: 0x8AB840)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var geminiTextGradient: LinearGradient {
        LinearGradient(
            colors: [Color(hex: 0x4E8CF7), Color(hex: 0x9B72CB), Color(hex: 0x8AB840)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    // Termius-inspired Always-Dark Terminal Palette
    static let termBg = Color(hex: 0x090D12)
    static let termChrome = Color(hex: 0x111720)
    static let termSurface = Color(hex: 0x161E2B)
    static let termBorder = Color(hex: 0x232E40)
    static let termText = Color(hex: 0xD7E1EE)
    static let termMuted = Color(hex: 0x6E8099)
    static let termInfo = Color(hex: 0x4ADE80)
    static let termWarn = Color(hex: 0xFBBF24)
    static let termError = Color(hex: 0xF87171)
    static let termChat = Color(hex: 0x38BDF8)
    static let termGeyser = Color(hex: 0xC084FC)
    static let termCmd = Color(hex: 0x8AB840)
    static let termSys = Color(hex: 0x7DD3FC)
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1.0) {
        let r = CGFloat((hex >> 16) & 0xFF) / 255.0
        let g = CGFloat((hex >> 8) & 0xFF) / 255.0
        let b = CGFloat(hex & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b, alpha: alpha)
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}

// MARK: - Reusable Native Modifiers & Components

struct YCCardModifier: ViewModifier {
    var padding: CGFloat = 16
    var cornerRadius: CGFloat = 18

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(YCColors.surface)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(YCColors.border, lineWidth: 1)
            )
    }
}

extension View {
    func ycCard(padding: CGFloat = 16, cornerRadius: CGFloat = 18) -> some View {
        modifier(YCCardModifier(padding: padding, cornerRadius: cornerRadius))
    }
}

struct YCPill: View {
    let text: String
    var color: Color = YCColors.primary
    var icon: String? = nil

    var body: some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon)
                    .font(.caption2.weight(.bold))
            }
            Text(text)
                .font(.caption2.weight(.bold))
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .foregroundStyle(color)
        .background(color.opacity(0.15))
        .clipShape(Capsule())
    }
}

struct PulsingDot: View {
    let color: Color
    var active: Bool = true
    @State private var pulsing = false

    var body: some View {
        ZStack {
            if active {
                Circle()
                    .fill(color.opacity(0.35))
                    .frame(width: 14, height: 14)
                    .scaleEffect(pulsing ? 1.35 : 0.8)
                    .opacity(pulsing ? 0.1 : 0.7)
                    .animation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true), value: pulsing)
            }
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
        }
        .onAppear { pulsing = active }
        .onChange(of: active) { _, newValue in pulsing = newValue }
    }
}

// MARK: - Haptics

enum Haptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

enum KeyboardHelper {
    @MainActor
    static func dismiss() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}

// MARK: - Formatters

enum Formatters {
    static func bytes(_ bytes: Double?) -> String {
        let n = max(0, bytes ?? 0)
        if n < 1024 { return "\(Int(n)) B" }
        if n < 1024 * 1024 { return String(format: "%.1f KB", n / 1024) }
        if n < 1024 * 1024 * 1024 { return String(format: "%.1f MB", n / (1024 * 1024)) }
        return String(format: "%.2f GB", n / (1024 * 1024 * 1024))
    }

    static func bytes(_ bytes: Int64?) -> String {
        self.bytes(bytes.map { Double($0) })
    }

    static func uptime(from iso: String?) -> String {
        guard let iso, !iso.isEmpty, !iso.hasPrefix("0001-"),
              let start = parseISO(iso) else { return "Parado" }
        let sec = max(0, Int(Date().timeIntervalSince(start)))
        let d = sec / 86400
        let h = (sec % 86400) / 3600
        let m = (sec % 3600) / 60
        if d > 0 { return "\(d)d \(h)h \(m)m" }
        if h > 0 { return "\(h)h \(m)m" }
        return "\(m)m"
    }

    static func parseISO(_ iso: String) -> Date? {
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f1.date(from: iso) { return d }
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        return f2.date(from: iso)
    }

    static func dateBR(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return "—" }
        let df = DateFormatter()
        df.locale = Locale(identifier: "pt_BR")
        df.dateFormat = "dd/MM/yy HH:mm"
        return df.string(from: date)
    }

    static func shortTime(ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000.0)
        let df = DateFormatter()
        df.locale = Locale(identifier: "pt_BR")
        df.dateFormat = "HH:mm:ss"
        return df.string(from: date)
    }

    static func nowHHMM() -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "pt_BR")
        df.dateFormat = "HH:mm"
        return df.string(from: Date())
    }

    static func roleLabel(_ role: String?) -> String {
        switch role?.lowercased() {
        case "admin": return "Administrador"
        case "moderator": return "Moderador"
        case "viewer": return "Visualizador"
        default: return role ?? "Visitante"
        }
    }

    static func roleColor(_ role: String?) -> Color {
        switch role?.lowercased() {
        case "admin": return YCColors.accent
        case "moderator": return YCColors.info
        default: return YCColors.textMuted
        }
    }

    static func generateStrongPassword(length: Int = 12) -> String {
        let chars = Array("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%")
        return String((0..<length).map { _ in chars[Int.random(in: 0..<chars.count)] })
    }
}
