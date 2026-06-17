import AgentVoiceCore
import AppKit
import SwiftUI

struct KokoroSetupProgressView: View {
    @ObservedObject var model: AppModel
    @State private var showDetails = false
    @State private var diagnosticsCopyFeedback: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Kokoro Installer")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)

            Text(statusMessage)
                .font(.headline)
                .textSelection(.enabled)

            Text(
                "Kokoro enables local voice playback. Installing may download managed uv, " +
                    "Python dependencies, and model files, and stores them under Agent Voice Home."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            ProgressView(value: progressValue, total: 1.0)
                .accessibilityLabel("Kokoro setup progress")
                .accessibilityValue(progressAccessibilityValue)

            stepList

            DisclosureGroup("Details", isExpanded: $showDetails) {
                ScrollView {
                    Text(diagnosticsText)
                        .font(.system(.caption, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 120, maxHeight: 180)
            }

            if model.kokoroSetup.phase == .failed, let error = model.kokoroSetup.error {
                Label("Setup failed: \(error)", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .accessibilityLabel("Setup failed: \(error)")
            } else if let setupDetectionError = model.kokoroSetupDetectionError {
                Label(
                    "Setup detection needs attention: \(setupDetectionError)",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .foregroundStyle(.orange)
                .textSelection(.enabled)
                .accessibilityLabel("Setup detection needs attention: \(setupDetectionError)")
            } else if model.kokoroSetup.phase == .cancelled {
                Label("Setup cancelled. You can retry when ready.", systemImage: "xmark.circle")
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            controls
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 420)
    }

    private var controls: some View {
        let phase = model.kokoroSetup.phase

        return HStack {
            if phase == .idle {
                Button("Start Installing") { Task { await model.installKokoro() } }
                    .keyboardShortcut(.defaultAction)
            } else if phase == .running {
                Button("Cancel") { model.cancelKokoroSetup() }
                    .keyboardShortcut(.cancelAction)
            } else if phase == .failed || phase == .cancelled {
                Button("Retry") { Task { await model.retryKokoroSetup() } }
            }

            if phase == .failed || phase == .cancelled {
                Button("Copy Diagnostics") {
                    copyDiagnostics()
                }
                .disabled(model.kokoroSetupDiagnostics().isEmpty)
                if let diagnosticsCopyFeedback {
                    Text(diagnosticsCopyFeedback)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if phase != .running {
                Button(doneTitle) { NSApp.keyWindow?.close() }
                    .keyboardShortcut(phase == .idle ? .cancelAction : .defaultAction)
            }
        }
    }

    private var stepList: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(KokoroSetupSteps.all) { step in
                Text(stepLabel(for: step))
                    .accessibilityLabel(stepAccessibilityLabel(for: step))
            }
        }
    }

    private var statusMessage: String {
        if let currentTitle = model.kokoroSetup.currentTitle {
            return currentTitle
        }

        switch model.kokoroSetup.phase {
        case .idle:
            return "Ready to install Kokoro"
        case .running:
            return "Installing Kokoro…"
        case .succeeded:
            return "Kokoro is ready"
        case .failed:
            return "Kokoro setup needs attention"
        case .cancelled:
            return "Kokoro setup was cancelled"
        }
    }

    private var doneTitle: String {
        model.kokoroSetup.phase == .succeeded ? "Done" : "Close"
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
        return "\(percent)% complete, \(statusMessage)"
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
