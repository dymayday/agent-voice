import AgentVoiceCore
import SwiftUI

/// The redesigned Setup window ("Soundcheck"). One window, two faces, switched
/// by *derived* readiness — never a stored flag. A new user gets the guided
/// Soundcheck strip and stays on it through the "Speak it" climax; once finished
/// (or if setup was already healthy on open) the same window is the Board. Later
/// breakage re-discloses inline on the Board rather than flipping back.
struct SetupWindowView: View {
    @ObservedObject var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Face { case soundcheck, board }

    @State private var mode: Face?
    @State private var preferredConcern: SetupConcern?

    private var readiness: SetupReadiness {
        SetupReadiness.evaluate(
            status: model.status,
            config: model.config,
            doctor: model.doctorReport,
            kokoroPhase: model.kokoroSetup.phase
        )
    }

    var body: some View {
        content
            .frame(minWidth: 560, minHeight: 560)
            .task { await model.refresh() }
            .task(id: model.preferredSetupStep) { applyPreferredStepIfNeeded() }
            .onAppear {
                if mode == nil {
                    mode = readiness.isReady ? .board : .soundcheck
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch mode ?? (readiness.isReady ? .board : .soundcheck) {
        case .board:
            SetupBoardView(model: model, readiness: readiness, preferredConcern: preferredConcern)
                .transition(.opacity)
        case .soundcheck:
            SoundcheckView(model: model, readiness: readiness) { concern in
                preferredConcern = concern
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                    mode = .board
                }
            }
            .transition(.opacity)
        }
    }

    private func applyPreferredStepIfNeeded() {
        guard let step = model.preferredSetupStep else { return }
        preferredConcern = SetupConcern.from(step: step)
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) {
            mode = .board
        }
        model.clearPreferredSetupStep(step)
    }
}
