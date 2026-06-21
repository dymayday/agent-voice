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
        XCTAssertTrue(source.contains("private var boardRepairItems: [SetupCheck]"))
        XCTAssertTrue(source.contains("SetupConcernHealth.repairItems"))
        XCTAssertTrue(source.contains("let items = boardRepairItems"))
        XCTAssertTrue(source.contains("All clear"))
        // Assert routing INSIDE performFix so an unrelated startDaemon() elsewhere
        // in the file cannot satisfy the contract.
        let performFix = try sourceSlice(in: source, from: "private func performFix", to: "// MARK: - Channel contents")
        XCTAssertTrue(performFix.contains("case \"daemon.running\":"))
        XCTAssertTrue(performFix.contains("await model.startDaemon()"))
        XCTAssertTrue(performFix.contains("case \"system.paused\":"))
        XCTAssertTrue(performFix.contains("await model.resume()"))
        XCTAssertTrue(performFix.contains("case \"queue.failed.empty\":"))
        XCTAssertTrue(performFix.contains("openWindow(id: AgentVoiceWindowID.dashboard)"))
        XCTAssertTrue(performFix.contains("case SetupReadiness.kokoroScriptCheckID"))
        XCTAssertTrue(performFix.contains("case \"summarizer.model.available\":"))
        XCTAssertTrue(performFix.contains("expanded = .model"))
    }

    func testBoardIncludesDedicatedModelChannel() throws {
        let source = try appSource("SetupBoardView.swift")
        XCTAssertTrue(source.contains("private var channels: [SetupConcern] { [.voice, .summaries, .model, .agents, .daemon] }"))
        XCTAssertTrue(source.contains("case .model:"))
        XCTAssertTrue(source.contains("ModelChannelContent(model: model)"))
    }

    func testModelChannelHealthAndSummaryUseModelAvailability() throws {
        let source = try appSource("SetupBoardView.swift")
        XCTAssertTrue(source.contains("summarizerModelEditable: model.isSummarizerModelEditable"))
        XCTAssertTrue(source.contains("summarizerModelValue: model.summarizerModelInUseValue"))
        XCTAssertTrue(source.contains("private var modelSummary: String"))
        XCTAssertTrue(source.contains("SetupConcernHealth.hasUsableSummarizerModelValue"))
        XCTAssertTrue(source.contains("id: \"summarizer.model.available\""))
        XCTAssertTrue(source.contains("title: \"Model unavailable\""))
        XCTAssertTrue(source.contains("action: \"Open Model\""))
        XCTAssertTrue(source.contains("Model unavailable"))
    }

    func testSetupAndDashboardUseSharedSummarizerModelControls() throws {
        let board = try appSource("SetupBoardView.swift")
        let modelChannel = try sourceSlice(in: board, from: "struct ModelChannelContent", to: "/// Agents channel")
        XCTAssertTrue(modelChannel.contains("SummarizerModelControls(model: model)"))

        let dashboard = try appSource("DashboardView.swift")
        XCTAssertTrue(dashboard.contains("SummarizerModelControls(model: model)"))
        XCTAssertFalse(dashboard.contains("private var summarizerModelControls"))
    }

    func testSharedSummarizerModelControlsMirrorDashboardBehavior() throws {
        let source = try appSource("SummarizerModelControls.swift")
        XCTAssertTrue(source.contains("struct SummarizerModelControls: View"))
        XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
        XCTAssertTrue(source.contains("model.summarizerModelInUseLabel"))
        XCTAssertTrue(source.contains("model.summarizerModelInUseValue"))
        XCTAssertTrue(source.contains("TextField(\"Model identifier\", text: $model.draftSummarizerModel)"))
        XCTAssertTrue(source.contains("model.saveSummarizerModel()"))
        XCTAssertTrue(source.contains("model.validateSummarizerModel()"))
        XCTAssertTrue(source.contains("model.availableSummarizerModels"))
        XCTAssertTrue(source.contains("Use known model"))
        XCTAssertTrue(source.contains(".textSelection(.enabled)"))
        XCTAssertTrue(source.contains(".accessibilityElement(children: .combine)"))
        XCTAssertTrue(source.contains("Summarizer model cannot be determined from current config"))
    }

    func testAgentsChannelMirrorsDashboardInstallStateBehavior() throws {
        let source = try appSource("SetupBoardView.swift")
        let agentsChannel = try sourceSlice(in: source, from: "struct AgentsChannelContent", to: "/// Daemon channel")
        let badge = try functionBody(named: "installBadge", in: agentsChannel)
        let controls = try functionBody(named: "agentHookControls", in: agentsChannel)

        XCTAssertTrue(agentsChannel.contains("let installState = model.status?.install?[item.name] ?? .unknown"))
        XCTAssertTrue(agentsChannel.contains("installBadge(installState)"))
        XCTAssertTrue(agentsChannel.contains("installState == .installed && item.enabled == false"))
        XCTAssertTrue(agentsChannel.contains("Text(\"Voice disabled\")"))
        XCTAssertTrue(agentsChannel.contains("Text(item.mode)"))

        XCTAssertTrue(badge.contains("Label(\"Installed\", systemImage: \"checkmark.circle.fill\")"))
        XCTAssertTrue(badge.contains("Label(\"Not installed\", systemImage: \"xmark.circle\")"))
        XCTAssertTrue(badge.contains("Label(\"Not available yet\", systemImage: \"clock\")"))
        XCTAssertTrue(badge.contains("Label(\"Checking…\", systemImage: \"circle.dotted\")"))

        XCTAssertTrue(controls.contains("case .notInstalled:"))
        XCTAssertTrue(controls.contains("Button(\"Install \\(name.capitalized) Hook\")"))
        XCTAssertTrue(controls.contains("case .installed:"))
        XCTAssertTrue(controls.contains("Button(\"Uninstall \\(name.capitalized) Hook\", role: .destructive)"))
        XCTAssertTrue(controls.contains("Hook install coming later"))
        XCTAssertTrue(controls.contains("case .unknown:"))
        XCTAssertTrue(controls.contains("EmptyView()"))

        XCTAssertFalse(agentsChannel.contains("Button(\"Install Hook\")"))
        XCTAssertFalse(agentsChannel.contains("Button(\"Uninstall Hook\")"))
        XCTAssertFalse(agentsChannel.contains("supportedHookAgents"))
    }

    func testClimaxGatesCelebrationOnTestSuccessAndAnnouncesToVoiceOver() throws {
        let source = try appSource("SoundcheckView.swift")
        // Celebration is gated on the Bool result, not flipped unconditionally.
        XCTAssertTrue(source.contains("let ok = await model.testVoice"))
        XCTAssertTrue(source.contains("if ok {"))
        // A failed test surfaces the error on Face A instead of claiming success.
        XCTAssertTrue(source.contains("model.lastError"))
        // VoiceOver live-region equivalent announcements at the climax.
        XCTAssertTrue(source.contains("SetupAccessibility.announce"))
        XCTAssertTrue(source.contains("Speaking test line"))
    }

    func testFinishAwaitsDaemonStartBeforeFlippingToBoard() throws {
        let source = try appSource("SoundcheckView.swift")
        let finish = try functionBody(named: "finish", in: source)
        XCTAssertTrue(finish.contains("await model.startDaemon()"))
        XCTAssertTrue(finish.contains("onFinish(concern)"))
        // startDaemon must precede the face flip.
        XCTAssertLessThan(
            try offset(of: "await model.startDaemon()", in: finish),
            try offset(of: "onFinish(concern)", in: finish)
        )
    }

    func testCardsHonorReduceTransparency() throws {
        let theater = try appSource("SetupTheater.swift")
        XCTAssertTrue(theater.contains("accessibilityReduceTransparency"))
        XCTAssertTrue(theater.contains("windowBackgroundColor"))
        let board = try appSource("SetupBoardView.swift")
        XCTAssertTrue(board.contains("accessibilityReduceTransparency"))
    }

    func testInlineInstallerShowsInstallPulseWaveform() throws {
        let source = try appSource("KokoroInstallInlineView.swift")
        XCTAssertTrue(source.contains("VoiceMeter(isActive: model.kokoroSetup.phase == .running"))
    }

    func testInlineInstallerRetryIsButtonGated() throws {
        let source = try appSource("KokoroInstallInlineView.swift")
        XCTAssertTrue(source.contains("Button(\"Retry\") { Task { await model.retryKokoroSetup() } }"))
    }

    func testInlineInstallerCopyDiagnosticsReportsPasteboardFailures() throws {
        let copyDiagnostics = try functionBody(named: "copyDiagnostics", in: appSource("KokoroInstallInlineView.swift"))
        XCTAssertTrue(copyDiagnostics.contains("if NSPasteboard.general.setString"))
        XCTAssertTrue(copyDiagnostics.contains("Diagnostics copied."))
        XCTAssertTrue(copyDiagnostics.contains("Copy failed."))
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
