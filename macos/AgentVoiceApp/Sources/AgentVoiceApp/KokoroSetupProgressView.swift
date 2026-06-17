import AgentVoiceCore
import AppKit
import SwiftUI

struct KokoroSetupProgressView: View {
    @ObservedObject var model: AppModel
    @State private var showDetails = false
    @State private var copiedDiagnostics = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Installing Kokoro")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)

            Text(statusMessage)
                .font(.headline)
                .textSelection(.enabled)

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
                .frame(minHeight: 120)
            }

            if model.kokoroSetup.phase == .failed, let error = model.kokoroSetup.error {
                Label("Setup failed: \(error)", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
                    .accessibilityLabel("Setup failed: \(error)")
            } else if model.kokoroSetup.phase == .cancelled {
                Label("Setup cancelled. You can retry when ready.", systemImage: "xmark.circle")
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            controls
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 420)
        .task {
            if model.kokoroSetup.phase == .idle {
                await model.installKokoro()
            }
        }
    }

    private var controls: some View {
        HStack {
            if model.kokoroSetup.phase == .running {
                Button("Cancel") { model.cancelKokoroSetup() }
                    .keyboardShortcut(.cancelAction)
            } else if model.kokoroSetup.phase == .failed || model.kokoroSetup.phase == .cancelled {
                Button("Retry") { Task { await model.retryKokoroSetup() } }
            }

            if model.kokoroSetup.phase == .failed || model.kokoroSetup.phase == .cancelled {
                Button("Copy Diagnostics") {
                    copyDiagnostics()
                }
                .disabled(model.kokoroSetupDiagnostics().isEmpty)
                if copiedDiagnostics {
                    Text("Diagnostics copied.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if model.kokoroSetup.phase != .running {
                Button(doneTitle) { NSApp.keyWindow?.close() }
                    .keyboardShortcut(.defaultAction)
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
        NSPasteboard.general.setString(model.kokoroSetupDiagnostics(), forType: .string)
        copiedDiagnostics = true
    }
}
