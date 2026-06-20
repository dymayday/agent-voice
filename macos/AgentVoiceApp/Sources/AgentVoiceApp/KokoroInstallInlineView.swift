import AgentVoiceCore
import AppKit
import SwiftUI

/// The Kokoro installer rendered *inline* inside the Setup window's Voice-engine
/// panel — the same install flow the standalone window drives, but without any
/// window-close semantics. Install starts only on an explicit button press;
/// expanding or opening the panel never begins network/download work.
struct KokoroInstallInlineView: View {
    @ObservedObject var model: AppModel
    @State private var showDetails = false
    @State private var diagnosticsCopyFeedback: String?

    private let detailsLogBottomID = "kokoro-inline-log-bottom"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(
                "Installing downloads managed uv, pinned Python dependencies, and Kokoro model files " +
                    "from the network, using local disk under Agent Voice Home."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            if model.kokoroSetup.phase == .running || model.kokoroSetup.phase == .succeeded {
                ProgressView(value: progressValue, total: 1.0)
                    .accessibilityLabel("Kokoro setup progress")
                    .accessibilityValue(progressAccessibilityValue)
            }

            if let caption = narrationCaption {
                Label(caption, systemImage: "waveform")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(caption)
            }

            stepList

            DisclosureGroup("Details", isExpanded: $showDetails) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(diagnosticsText)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)

                            Color.clear
                                .frame(height: 1)
                                .id(detailsLogBottomID)
                        }
                    }
                    .onChange(of: model.kokoroSetup.logs) { _ in
                        proxy.scrollTo(detailsLogBottomID, anchor: .bottom)
                    }
                }
                .frame(minHeight: 120, maxHeight: 180)
            }

            errorBanner

            controls
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if model.kokoroSetup.phase == .failed, let error = model.kokoroSetup.error {
            Label("Setup failed: \(error)", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .textSelection(.enabled)
                .accessibilityLabel("Setup failed: \(error)")
        } else if let cliDetectionError = model.cliDetectionError {
            Label("Agent Voice CLI unavailable: \(cliDetectionError)", systemImage: "terminal.fill")
                .foregroundStyle(.orange)
                .textSelection(.enabled)
                .accessibilityLabel("Agent Voice CLI unavailable: \(cliDetectionError)")
        } else if let setupDetectionError = model.kokoroSetupDetectionError {
            Label("Setup detection needs attention: \(setupDetectionError)", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .textSelection(.enabled)
                .accessibilityLabel("Setup detection needs attention: \(setupDetectionError)")
        } else if model.kokoroSetup.phase == .cancelled {
            Label("Setup cancelled. You can retry when ready.", systemImage: "xmark.circle")
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
    }

    private var controls: some View {
        let phase = model.kokoroSetup.phase
        return HStack {
            if phase == .idle {
                Button("Install Kokoro") { Task { await model.installKokoro() } }
                    .keyboardShortcut(.defaultAction)
            } else if phase == .running {
                Button("Cancel") { model.cancelKokoroSetup() }
                    .keyboardShortcut(.cancelAction)
            } else if phase == .failed || phase == .cancelled {
                Button("Retry") { Task { await model.retryKokoroSetup() } }
            }

            if phase == .failed || phase == .cancelled {
                Button("Copy Diagnostics") { copyDiagnostics() }
                    .disabled(model.kokoroSetupDiagnostics().isEmpty)
                if let diagnosticsCopyFeedback {
                    Text(diagnosticsCopyFeedback)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
    }

    private var stepList: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(KokoroSetupSteps.all) { step in
                Text(stepLabel(for: step))
                    .font(.callout)
                    .accessibilityLabel(stepAccessibilityLabel(for: step))
            }
        }
    }

    private var narrationCaption: String? {
        switch model.kokoroSetup.phase {
        case .running:
            return SetupNarration.installing(model.kokoroSetup.currentTitle)
        case .succeeded:
            return SetupNarration.engineReady
        default:
            return nil
        }
    }

    private var diagnosticsText: String {
        let diagnostics = model.kokoroSetupDiagnostics()
        return diagnostics.isEmpty ? "No log output yet." : diagnostics
    }

    private var progressValue: Double {
        guard !KokoroSetupSteps.all.isEmpty else { return 0 }
        if model.kokoroSetup.phase == .succeeded { return 1 }
        let progressed = Set(model.kokoroSetup.completedStepIDs + model.kokoroSetup.skippedStepIDs).count
        return min(Double(progressed) / Double(KokoroSetupSteps.all.count), 1)
    }

    private var progressAccessibilityValue: String {
        let percent = Int((progressValue * 100).rounded())
        return "\(percent)% complete"
    }

    private func stepLabel(for step: KokoroSetupStepDefinition) -> String {
        let state = stepState(for: step.id)
        return "\(state.symbol) \(state.text): \(step.title)"
    }

    private func stepAccessibilityLabel(for step: KokoroSetupStepDefinition) -> String {
        let state = stepState(for: step.id)
        return "\(step.title), \(state.text)"
    }

    private func stepState(for id: String) -> (symbol: String, text: String) {
        if model.kokoroSetup.completedStepIDs.contains(id) {
            return ("✓", "Completed")
        }
        if model.kokoroSetup.skippedStepIDs.contains(id) {
            return ("↷", "Skipped")
        }
        if model.kokoroSetup.failedStepID == id {
            return ("✕", "Failed")
        }
        if model.kokoroSetup.currentStepID == id && model.kokoroSetup.phase == .running {
            return ("●", "Running")
        }
        return ("○", "Pending")
    }

    private func copyDiagnostics() {
        NSPasteboard.general.clearContents()
        if NSPasteboard.general.setString(model.kokoroSetupDiagnostics(), forType: .string) {
            diagnosticsCopyFeedback = "Diagnostics copied."
        } else {
            diagnosticsCopyFeedback = "Copy failed."
        }
    }
}
