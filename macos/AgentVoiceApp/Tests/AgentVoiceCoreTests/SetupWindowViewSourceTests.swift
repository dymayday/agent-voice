import XCTest

/// Source-contract tests for the redesigned Setup window ("Soundcheck"): a
/// single window with two derived faces, inline Kokoro install (no second
/// window opened from Setup), a single repair rail, and the preserved
/// summary-voice and install-safety invariants.
final class SetupWindowViewSourceTests: XCTestCase {
    // MARK: Derived two-face architecture

    func testSetupWindowDerivesReadinessWithoutAStoredFlag() throws {
        let source = try appSource("SetupWindowView.swift")
        XCTAssertTrue(source.contains("SetupReadiness.evaluate"))
        XCTAssertTrue(source.contains("SoundcheckView("))
        XCTAssertTrue(source.contains("SetupBoardView("))
        XCTAssertTrue(
            source.contains("private var readiness: SetupReadiness"),
            "Readiness must be a live computed value, not a persisted flag."
        )
    }

    func testSetupWindowHandlesPreferredStepDeepLinkWithoutInstalling() throws {
        let source = try appSource("SetupWindowView.swift")
        XCTAssertTrue(source.contains("model.preferredSetupStep"))
        XCTAssertTrue(source.contains("model.clearPreferredSetupStep(step)"))
        XCTAssertTrue(source.contains("SetupConcern.from(step:"))
        XCTAssertFalse(
            source.contains("installKokoro"),
            "Opening Setup (even to a requested concern) must never start a Kokoro install."
        )
    }

    // MARK: Inline Kokoro install (two-window collapse for the Setup surface)

    func testSetupViewsDoNotOpenASeparateKokoroWindow() throws {
        for file in ["SetupWindowView.swift", "SoundcheckView.swift", "SetupBoardView.swift", "KokoroInstallInlineView.swift"] {
            let source = try appSource(file)
            XCTAssertFalse(
                source.contains("openWindow(id: AgentVoiceWindowID.kokoroSetup)"),
                "\(file) should install Kokoro inline, not open the standalone installer window."
            )
        }
    }

    func testInlineInstallerStartsOnlyOnExplicitButtonPress() throws {
        let source = try appSource("KokoroInstallInlineView.swift")
        XCTAssertTrue(source.contains("Button(\"Install Kokoro\") { Task { await model.installKokoro() } }"))
        XCTAssertFalse(
            source.contains(".onAppear"),
            "Inline installer must not begin install work on appearance."
        )
        XCTAssertFalse(
            source.contains(".task"),
            "Inline installer must not begin install work from a lifecycle task."
        )
    }

    func testInlineInstallerDisclosesInstallRequirements() throws {
        let source = try appSource("KokoroInstallInlineView.swift")
        XCTAssertTrue(source.localizedCaseInsensitiveContains("uv"))
        XCTAssertTrue(source.localizedCaseInsensitiveContains("network"))
        XCTAssertTrue(source.localizedCaseInsensitiveContains("disk"))
    }

    func testInlineInstallerKeepsDiagnosticsAndDetectionSurfaces() throws {
        let source = try appSource("KokoroInstallInlineView.swift")
        XCTAssertTrue(source.contains("DisclosureGroup(\"Details\""))
        XCTAssertTrue(source.contains("Copy Diagnostics"))
        XCTAssertTrue(source.contains("model.cancelKokoroSetup()"))
        XCTAssertTrue(source.contains("KokoroSetupSteps.all"))
        XCTAssertTrue(source.contains("model.kokoroSetupDetectionError"))
        XCTAssertTrue(source.contains("model.cliDetectionError"))
    }

    func testInlineInstallerDetailsLogIsHeightBoundedAndAutoScrolls() throws {
        let source = try appSource("KokoroInstallInlineView.swift")
        XCTAssertTrue(source.contains(".frame(minHeight: 120, maxHeight: 180)"))
        XCTAssertTrue(source.contains("ScrollViewReader"))
        XCTAssertTrue(source.contains("scrollTo(detailsLogBottomID, anchor: .bottom)"))
        XCTAssertTrue(source.contains(".onChange(of: model.kokoroSetup.logs)"))
    }

    // MARK: Soundcheck face — the "hear it work" climax

    func testSoundcheckEndsOnSpeakItClimaxWithCelebration() throws {
        let source = try appSource("SoundcheckView.swift")
        XCTAssertTrue(source.contains("Speak it"))
        XCTAssertTrue(source.contains("model.testVoice"))
        XCTAssertTrue(source.contains("SoundwaveBloom"))
        XCTAssertTrue(source.contains("VoiceMeter("))
    }

    // MARK: Board face — single repair rail (no per-step duplication)

    func testBoardRendersASingleRepairRailFromRepairItems() throws {
        let source = try appSource("SetupBoardView.swift")
        XCTAssertTrue(source.contains("SetupConcernHealth.repairItems"))
        XCTAssertTrue(source.contains("All clear"))
        // Fixes route to real model actions, not invented ones.
        XCTAssertTrue(source.contains("await model.startDaemon()"))
        XCTAssertTrue(source.contains("await model.resume()"))
    }

    // MARK: Summary-voice controls + live preview preserved

    func testSummaryVoiceControlsAndDebouncedPreviewArePreserved() throws {
        let source = try appSource("SetupBoardView.swift")
        XCTAssertTrue(source.contains("AppModel.summarizerPromptStyleCatalog"))
        XCTAssertTrue(source.contains("model.draftMaxSentences"))
        XCTAssertTrue(source.contains("model.draftMaxSummaryChars"))
        XCTAssertTrue(source.contains("model.draftSpeakQuestionsVerbatim"))
        XCTAssertTrue(source.contains("Speak questions and approvals word-for-word"))
        XCTAssertTrue(source.contains("model.saveSummaryVoice()"))
        XCTAssertTrue(source.contains("model.summaryVoiceCanSave"))
        XCTAssertTrue(source.contains("What the model is told"))
        XCTAssertTrue(source.contains("model.summaryVoicePromptPreview"))
        XCTAssertTrue(source.contains("model.refreshSummaryVoicePrompt()"))
        XCTAssertTrue(source.contains("isExpanded: $promptExpanded"))
        XCTAssertTrue(source.contains("guard promptExpanded else { return }"))
    }
}
