/// Pure, view-agnostic derivations of Kokoro install progress, shared by the
/// inline installer panel and the standalone installer window so the step-glyph
/// vocabulary and progress math have a single source of truth.
public enum KokoroSetupProgress {
    /// The glyph + status text for a step id given the current snapshot.
    public static func stepState(for id: String, in snapshot: KokoroSetupSnapshot) -> (symbol: String, text: String) {
        if snapshot.completedStepIDs.contains(id) {
            return ("✓", "Completed")
        }
        if snapshot.skippedStepIDs.contains(id) {
            return ("↷", "Skipped")
        }
        if snapshot.failedStepID == id {
            return ("✕", "Failed")
        }
        if snapshot.currentStepID == id && snapshot.phase == .running {
            return ("●", "Running")
        }
        return ("○", "Pending")
    }

    /// Fraction complete in `0...1`, used to drive the install ProgressView.
    public static func value(of snapshot: KokoroSetupSnapshot) -> Double {
        guard !KokoroSetupSteps.all.isEmpty else { return 0 }
        if snapshot.phase == .succeeded { return 1 }
        let progressed = Set(snapshot.completedStepIDs + snapshot.skippedStepIDs).count
        return min(Double(progressed) / Double(KokoroSetupSteps.all.count), 1)
    }
}
