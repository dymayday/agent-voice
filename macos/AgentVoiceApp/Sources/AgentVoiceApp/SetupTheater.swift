import AgentVoiceCore
import AppKit
import SwiftUI

// MARK: - Shared styling

extension SetupConcernStatus {
    /// Canonical app tints: green = ok, orange = attention, red = critical.
    var tint: Color {
        switch self {
        case .ok: .green
        case .attention: .orange
        case .critical: .red
        }
    }

    /// Status glyph — always paired with text/tint, never color alone.
    var glyph: String {
        switch self {
        case .ok: "checkmark.circle.fill"
        case .attention: "exclamationmark.triangle.fill"
        case .critical: "xmark.octagon.fill"
        }
    }

    var label: String {
        switch self {
        case .ok: "Ready"
        case .attention: "Needs attention"
        case .critical: "Not set up"
        }
    }
}

/// A material card matching the Dashboard's visual language (`.regularMaterial`,
/// continuous radius 16, 1px tint stroke).
struct SetupCard<Content: View>: View {
    var tint: Color = .secondary
    var fill: Double = 0.0
    @ViewBuilder var content: Content

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            // Reduce Transparency → opaque fill instead of vibrant material.
            .background(reduceTransparency ? AnyShapeStyle(Color(nsColor: .windowBackgroundColor)) : AnyShapeStyle(.regularMaterial))
            .background(tint.opacity(fill))
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(tint.opacity(0.26), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// Posts a VoiceOver announcement (live-region equivalent for AppKit-backed
/// SwiftUI on the macOS 13 target, where SwiftUI has no declarative live region).
@MainActor
enum SetupAccessibility {
    static func announce(_ message: String, priority: NSAccessibilityPriorityLevel = .high) {
        let message = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        NSAccessibility.post(
            element: NSApp as Any,
            notification: .announcementRequested,
            userInfo: [
                .announcement: message,
                .priority: priority.rawValue,
            ]
        )
    }
}

/// Small status dot used on channel/panel headers. Symbol + tint, with an
/// accessibility label so health is never conveyed by color alone.
struct SetupStatusDot: View {
    let status: SetupConcernStatus

    var body: some View {
        Image(systemName: status.glyph)
            .foregroundStyle(status.tint)
            .accessibilityLabel(status.label)
    }
}

// MARK: - Voice meter (the one signature visual)

/// A level-meter waveform that animates *only* while real audio/work is in
/// flight. `testVoice()` is fire-and-forget (no amplitude tap), so this is an
/// honest synthetic envelope — not true lip-sync. Respects Reduce Motion by
/// freezing to a static glyph row.
struct VoiceMeter: View {
    var isActive: Bool
    var tint: Color = .accentColor
    var height: CGFloat = 28

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let barCount = 13

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isActive || reduceMotion)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0 ..< barCount, id: \.self) { index in
                    Capsule(style: .continuous)
                        .fill(tint.opacity(isActive ? 0.9 : 0.35))
                        .frame(width: 3, height: barHeight(index: index, time: t))
                }
            }
            .frame(height: height, alignment: .center)
            .animation(.easeInOut(duration: 0.15), value: isActive)
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }

    private func barHeight(index: Int, time: TimeInterval) -> CGFloat {
        let minBar: CGFloat = 4
        guard isActive, !reduceMotion else { return minBar + (CGFloat(index % 3) * 2) }
        let phase = Double(index) * 0.55
        let wave = (sin(time * 6 + phase) + 1) / 2
        let envelope = (sin(time * 2.3 + phase * 0.5) + 1) / 2
        return minBar + CGFloat(wave * envelope) * (height - minBar)
    }
}

// MARK: - Soundwave bloom (first-spoken-summary celebration)

/// A one-time celebration when the user first hears the voice. Expanding rings
/// under normal motion; a gentle fade under Reduce Motion. Purely decorative and
/// never gates progress.
struct SoundwaveBloom: View {
    var tint: Color = .green

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animate = false

    var body: some View {
        ZStack {
            if reduceMotion {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 44))
                    .foregroundStyle(tint)
                    .opacity(animate ? 1 : 0)
            } else {
                ForEach(0 ..< 3, id: \.self) { ring in
                    Circle()
                        .stroke(tint.opacity(0.5), lineWidth: 2)
                        .scaleEffect(animate ? 1.6 + Double(ring) * 0.5 : 0.2)
                        .opacity(animate ? 0 : 0.8)
                        .animation(
                            .easeOut(duration: 1.1).delay(Double(ring) * 0.12),
                            value: animate
                        )
                }
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(tint)
                    .scaleEffect(animate ? 1 : 0.4)
                    .opacity(animate ? 1 : 0)
                    .animation(.spring(response: 0.4, dampingFraction: 0.6), value: animate)
            }
        }
        .frame(width: 80, height: 80)
        .onAppear { animate = true }
        .accessibilityHidden(true)
    }
}

// MARK: - First-person narration (rationed)

/// First-person copy, used only on first-run and just-fixed moments. The Board's
/// steady state stays neutral.
enum SetupNarration {
    static func installing(_ stepTitle: String?) -> String {
        if let stepTitle, !stepTitle.isEmpty {
            return "Setting up my voice — \(stepTitle.lowercased())"
        }
        return "Setting up my voice…"
    }

    static let engineReady = "My voice engine is ready."
    static let speakPrompt = "Ready when you are — let me say something."
    static func heardVoice(_ voice: String) -> String { "You just heard \(voice)" }
}
