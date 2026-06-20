import XCTest

final class AgentVoiceAppSourceTests: XCTestCase {
    func testWindowIDsStayStableForMenuOpenActions() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let dashboard = \"dashboard\""))
        XCTAssertTrue(source.contains("static let setup = \"setup\""))
        XCTAssertTrue(source.contains("static let attention = \"attention\""))
    }

    func testAttentionWindowIDAndSceneAreRegistered() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let attention = \"attention\""))
        XCTAssertTrue(source.contains("Window(\"Attention\", id: AgentVoiceWindowID.attention)"))
        XCTAssertTrue(source.contains("AttentionDetailView(model: model)"))
        XCTAssertFalse(
            source.contains("WindowGroup(\"Attention"),
            "Attention should be a singleton Window so repeated clicks focus the same detail surface."
        )
    }

    func testHistoryWindowIDAndSceneAreRegistered() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let history = \"history\""))
        XCTAssertTrue(source.contains("Window(\"History\", id: AgentVoiceWindowID.history)"))
        XCTAssertTrue(source.contains("HistoryView(model: model)"))
        XCTAssertTrue(source.contains(".defaultSize(width: 820, height: 680)"))
        XCTAssertFalse(
            source.contains("WindowGroup(\"History"),
            "History should be a singleton Window so repeated clicks focus the same surface."
        )
    }

    func testMenuBarUsesNativeTemplateWaveformIcon() throws {
        let applicationSource = try appSource("AgentVoiceApp.swift")
        let statusLabel = try sourceSlice(
            in: applicationSource,
            from: "struct StatusBarIconLabel",
            to: "extension DashboardView"
        )

        XCTAssertTrue(applicationSource.contains("MenuBarExtra {"))
        XCTAssertTrue(applicationSource.contains("StatusBarIconLabel()"))
        XCTAssertTrue(statusLabel.contains("Image(systemName: \"waveform\")"))
        XCTAssertTrue(statusLabel.contains(".accessibilityLabel(\"Agent Voice\")"))
        XCTAssertFalse(
            statusLabel.contains("forResource: \"AppIcon\", withExtension: \"icns\""),
            "The status item should not use the full-color app icon."
        )
        XCTAssertFalse(
            statusLabel.contains("Image(nsImage:"),
            "The status item should be a native template-style SF Symbol, not a full-color NSImage."
        )
        XCTAssertFalse(
            statusLabel.contains(".clipShape(Circle())"),
            "The menu-bar glyph should be transparent, not a clipped app-icon circle."
        )
    }

    func testMenuHeaderUsesStatusHaloWaveformIcon() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let header = try propertyBody(named: "header", in: source)
        let icon = try propertyBody(named: "menuHeaderStatusIcon", in: source)

        XCTAssertTrue(header.contains("menuHeaderStatusIcon"))
        XCTAssertTrue(icon.contains("Image(systemName: \"waveform\")"))
        XCTAssertTrue(icon.contains(".foregroundStyle(statusTint)"))
        XCTAssertTrue(icon.contains(".stroke(statusTint.opacity(0.12), lineWidth: 6)"))
        XCTAssertTrue(icon.contains(".stroke(statusTint.opacity(0.78), lineWidth: 2)"))
        XCTAssertTrue(icon.contains(".frame(width: 40, height: 40)"))
        XCTAssertTrue(icon.contains(".accessibilityHidden(true)"))
        XCTAssertFalse(
            icon.contains(".offset("),
            "The dropdown header waveform should stay centered inside the halo helper."
        )
        XCTAssertFalse(
            icon.contains(".frame(width: 10, height: 10)"),
            "The halo helper should not reintroduce a separate status dot."
        )
        XCTAssertFalse(
            header.contains(".offset(y: 11)"),
            "The dropdown header waveform should be centered, not visually offset."
        )
        XCTAssertFalse(
            header.contains(".frame(width: 10, height: 10)"),
            "The dropdown header should not use a separate centered status dot."
        )
    }

    func testDashboardSceneIsSingletonWindow() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(
            source.contains("Window(\"Dashboard\", id: AgentVoiceWindowID.dashboard)"),
            "Dashboard should use a singleton SwiftUI Window with the shared dashboard window id."
        )
        XCTAssertFalse(
            source.contains("WindowGroup(\"Dashboard"),
            "Dashboard must not use WindowGroup because menu clicks should not spawn multiple dashboard windows."
        )
        XCTAssertTrue(
            source.contains(".defaultSize(width: 960, height: 720)"),
            "Dashboard should define a comfortable default size for the operations cockpit layout."
        )
    }

    func testColdLaunchDoesNotDefaultToSetupWindowGroup() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertFalse(
            source.contains("WindowGroup(\"Setup\", id: AgentVoiceWindowID.setup)"),
            "Setup must not be the automatic cold-launch WindowGroup; "
                + "launching the app from the Dock should open Dashboard by default."
        )
        XCTAssertTrue(
            source.contains("Window(\"Setup\", id: AgentVoiceWindowID.setup)"),
            "Setup should remain available as an explicit singleton window."
        )
    }

    func testDashboardAndMenuRegisterVisibleAutoRefresh() throws {
        let dashboardSource = try appSource("DashboardView.swift")
        let menuSource = try appSource("MenuBarSentinelView.swift")

        for source in [dashboardSource, menuSource] {
            XCTAssertTrue(source.contains(".onAppear { model.startAutoRefresh() }"))
            XCTAssertTrue(source.contains(".onDisappear { model.stopAutoRefresh() }"))
            XCTAssertFalse(
                source.contains(".task {\n            await model.refresh()\n        }"),
                "Visible surfaces should use the shared AppModel auto-refresh loop, not independent one-shot tasks."
            )
        }
    }

    func testMenuDashboardActionUsesSharedWindowIDAndActivatesApp() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let footer = try sourceSlice(in: source, from: "private var footer", to: "private var smartActionsMenu")
        let openSetup = try sourceSlice(
            in: source,
            from: "private func openSetup",
            to: "private func openDashboard"
        )
        let openDashboard = try sourceSlice(
            in: source,
            from: "private func openDashboard",
            to: "private func sectionTitle"
        )

        XCTAssertTrue(footer.contains("actionButton(\"Dashboard\", systemImage: \"gauge\")"))
        XCTAssertTrue(footer.contains("openDashboard()"))
        XCTAssertTrue(openDashboard.contains("openWindow(id: AgentVoiceWindowID.dashboard)"))
        XCTAssertTrue(openDashboard.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
        XCTAssertTrue(footer.contains("openSetup()"))
        XCTAssertTrue(source.contains("private func openSetup()"))
        XCTAssertTrue(openSetup.contains("openWindow(id: AgentVoiceWindowID.setup)"))
        XCTAssertTrue(openSetup.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
    }

    func testMenuFooterKeepsExistingActionsAndAddsSmartActionsMenu() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let footer = try sourceSlice(in: source, from: "private var footer", to: "private var smartActionsMenu")

        XCTAssertTrue(footer.contains("smartActionsMenu"))
        XCTAssertTrue(footer.contains("actionButton(\"Dashboard\", systemImage: \"gauge\")"))
        XCTAssertTrue(footer.contains("actionButton(\"Setup\", systemImage: \"wrench.and.screwdriver\")"))
        XCTAssertTrue(footer.contains("actionButton(\"Quit Agent Voice\", systemImage: \"power\", role: .destructive)"))
    }

    func testMenuControlIncludesClearFailedJobsButton() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let controls = try sourceSlice(in: source, from: "private var controls", to: "private var footer")

        XCTAssertTrue(controls.contains("actionButton(\"Clear Queue\", systemImage: \"trash\", role: .destructive"))
        XCTAssertTrue(controls.contains("actionButton(\n                    \"Clear Failed Jobs\""))
        XCTAssertFalse(controls.contains("actionButton(\"Pause\""))
        XCTAssertFalse(controls.contains("actionButton(\"Resume\""))
        XCTAssertFalse(controls.contains("await model.pause()"))
        XCTAssertFalse(controls.contains("await model.resume()"))
        XCTAssertTrue(controls.contains("!canClearQueue"))
        XCTAssertTrue(controls.contains("!canClearFailedQueue"))
    }

    func testSmartActionsExposeStateAwareEntries() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let smartActions = try sourceSlice(
            in: source,
            from: "private var smartActionsMenu",
            to: "private func openAttentionDetails"
        )

        XCTAssertTrue(smartActions.contains("Menu {"))
        XCTAssertTrue(smartActions.contains("Label(\"Smart Actions\", systemImage: \"sparkles\")"))
        XCTAssertTrue(source.contains("SmartActionMenuMode"))
        XCTAssertTrue(source.contains("case needsAttention"))
        XCTAssertTrue(source.contains("case daemonStopped"))
        XCTAssertTrue(source.contains("case unavailable"))
        XCTAssertTrue(source.contains("case daily"))
        XCTAssertTrue(smartActions.contains("Button(\"Open Attention Details\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Refresh Diagnostics\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Copy Diagnostic Snapshot\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Reveal Agent Voice Home\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Start Daemon\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Open Setup\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Replay Last Summary\")"))
        XCTAssertTrue(smartActions.contains("Button(\"Run Voice Test\")"))
        XCTAssertFalse(smartActions.contains("await model.pause()"))
        XCTAssertFalse(smartActions.contains("await model.resume()"))
    }

    func testSmartActionModePrioritizesAttentionBeforeDaemonStoppedAndUnknownStatus() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let mode = try sourceSlice(
            in: source,
            from: "private var smartActionMenuMode",
            to: "private var hasAttentionWork"
        )

        XCTAssertLessThan(
            try offset(of: "if hasAttentionWork", in: mode),
            try offset(of: "if model.status?.daemon.running == false", in: mode)
        )
        XCTAssertLessThan(
            try offset(of: "if model.status?.daemon.running == false", in: mode),
            try offset(of: "if model.status == nil", in: mode)
        )
        XCTAssertTrue(mode.contains("return .unavailable"))
    }

    func testSmartActionsRouteToExistingSafeActions() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let smartActions = try sourceSlice(
            in: source,
            from: "private var smartActionsMenu",
            to: "private func openAttentionDetails"
        )

        XCTAssertTrue(smartActions.contains("openAttentionDetails()"))
        XCTAssertTrue(smartActions.contains("Task { await model.refresh() }"))
        XCTAssertTrue(smartActions.contains("copyDiagnosticSnapshot()"))
        XCTAssertTrue(smartActions.contains("revealAgentVoiceHome()"))
        XCTAssertTrue(smartActions.contains("Task { await model.startDaemon() }"))
        XCTAssertTrue(smartActions.contains("openSetup()"))
        XCTAssertTrue(smartActions.contains("Task { await model.testVoice(summary) }"))
        XCTAssertTrue(smartActions.contains("Task { await model.testVoice() }"))
        XCTAssertFalse(smartActions.contains("Task { await model.pause() }"))
        XCTAssertFalse(smartActions.contains("Task { await model.resume() }"))
    }

    func testSmartActionsSnapshotAndRevealAreGuardedByAvailableData() throws {
        let source = try appSource("MenuBarSentinelView.swift")

        XCTAssertTrue(source.contains("private func diagnosticSnapshotJSON() -> String"))
        XCTAssertTrue(source.contains("model.diagnosticSnapshotJSON()"))
        XCTAssertTrue(source.contains("NSPasteboard.general"))
        XCTAssertTrue(source.contains("NSWorkspace.shared.open"))
        XCTAssertTrue(source.contains("guard let homePath = model.status?.paths.home"))
        XCTAssertTrue(source.contains("localActionError"))
        XCTAssertTrue(source.contains("FileManager.default.fileExists"))
    }

    func testMenuAttentionBannerOpensAttentionWindowAndActivatesApp() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let attentionBanner = try sourceSlice(
            in: source,
            from: "private var attentionBanner",
            to: "private var queueOverview"
        )
        let openAttention = try sourceSlice(
            in: source,
            from: "private func openAttentionDetails",
            to: "private func openSetup"
        )

        XCTAssertTrue(attentionBanner.contains("openAttentionDetails()"))
        XCTAssertTrue(openAttention.contains("openWindow(id: AgentVoiceWindowID.attention)"))
        XCTAssertTrue(openAttention.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
    }

}
