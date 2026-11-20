import SwiftUI

enum MarkdownBlock: Equatable {
    case heading(Int, String)
    case paragraph(String)
    case bulletList([String])
    case codeBlock(language: String?, code: String)
}

enum MarkdownBlockParser {
    static func parse(_ raw: String) -> [MarkdownBlock] {
        let lines = raw.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [MarkdownBlock] = []
        var i = 0

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code block
            if trimmed.hasPrefix("```") {
                let lang = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var codeLines: [String] = []
                i += 1
                while i < lines.count && !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    codeLines.append(lines[i])
                    i += 1
                }
                i += 1
                blocks.append(.codeBlock(language: lang.isEmpty ? nil : lang, code: codeLines.joined(separator: "\n")))
                continue
            }

            if trimmed.isEmpty {
                i += 1
                continue
            }

            // Heading
            if trimmed.hasPrefix("### ") {
                blocks.append(.heading(3, String(trimmed.dropFirst(4))))
                i += 1
                continue
            } else if trimmed.hasPrefix("## ") {
                blocks.append(.heading(2, String(trimmed.dropFirst(3))))
                i += 1
                continue
            } else if trimmed.hasPrefix("# ") {
                blocks.append(.heading(1, String(trimmed.dropFirst(2))))
                i += 1
                continue
            }

            // Bullet list
            if isBullet(trimmed) {
                var items: [String] = []
                while i < lines.count && isBullet(lines[i].trimmingCharacters(in: .whitespaces)) {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    items.append(stripBullet(t))
                    i += 1
                }
                blocks.append(.bulletList(items))
                continue
            }

            // Paragraph
            var paraLines: [String] = []
            while i < lines.count {
                let t = lines[i].trimmingCharacters(in: .whitespaces)
                if t.isEmpty || t.hasPrefix("```") || t.hasPrefix("# ") || t.hasPrefix("## ") || t.hasPrefix("### ") || isBullet(t) {
                    break
                }
                paraLines.append(lines[i])
                i += 1
            }
            blocks.append(.paragraph(paraLines.joined(separator: "\n")))
        }
        return blocks
    }

    private static func isBullet(_ s: String) -> Bool {
        s.hasPrefix("- ") || s.hasPrefix("* ") || s.hasPrefix("• ")
    }

    private static func stripBullet(_ s: String) -> String {
        String(s.dropFirst(2)).trimmingCharacters(in: .whitespaces)
    }
}

struct MarkdownMessageView: View {
    let text: String
    var onCopyCode: ((String) -> Void)? = nil

    private var blocks: [MarkdownBlock] {
        MarkdownBlockParser.parse(text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let level, let content):
                    inlineText(content)
                        .font(level == 1 ? .title3.bold() : level == 2 ? .headline.bold() : .subheadline.bold())
                        .foregroundStyle(YCColors.text)
                        .padding(.top, 2)

                case .paragraph(let content):
                    inlineText(content)
                        .font(.body)
                        .foregroundStyle(YCColors.text)
                        .lineSpacing(3)

                case .bulletList(let items):
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Circle()
                                    .fill(YCColors.primary)
                                    .frame(width: 5, height: 5)
                                    .offset(y: -2)
                                inlineText(item)
                                    .font(.body)
                                    .foregroundStyle(YCColors.text)
                                    .lineSpacing(2)
                            }
                        }
                    }

                case .codeBlock(let lang, let code):
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            Text((lang ?? "comando").uppercased())
                                .font(.system(size: 10, weight: .bold, design: .monospaced))
                                .foregroundStyle(YCColors.termMuted)
                            Spacer()
                            Button {
                                UIPasteboard.general.string = code
                                Haptics.light()
                                onCopyCode?(code)
                            } label: {
                                Label("Copiar", systemImage: "doc.on.doc")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(YCColors.termCmd)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(YCColors.termChrome)

                        ScrollView(.horizontal, showsIndicators: false) {
                            Text(code)
                                .font(.system(size: 12.5, design: .monospaced))
                                .foregroundStyle(YCColors.termText)
                                .textSelection(.enabled)
                                .padding(12)
                        }
                        .background(YCColors.termBg)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(YCColors.termBorder, lineWidth: 1)
                    )
                }
            }
        }
        .textSelection(.enabled)
    }

    private func inlineText(_ source: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(source)
    }
}
