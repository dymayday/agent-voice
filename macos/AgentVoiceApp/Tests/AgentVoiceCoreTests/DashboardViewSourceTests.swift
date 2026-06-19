import XCTest

final class DashboardViewSourceTests: XCTestCase {
    func testDashboardExposesCoreOperationalSections() throws {
        let source = try appSources()

        XCTAssertTrue(source.contains("struct DashboardView: View"))
        XCTAssertTrue(source.contains("Agent Voice Dashboard"))
        XCTAssertTrue(source.contains("Status"))
        XCTAssertTrue(source.contains("Queue"))
        XCTAssertTrue(source.contains("Diagnostics"))
        XCTAssertTrue(source.contains("Failed jobs"))
        XCTAssertTrue(source.contains("Recent spoken events"))
        XCTAssertTrue(source.contains("Kokoro"))
        XCTAssertTrue(source.contains("accessibilityAddTraits(.isHeader)"))
    }

    func testDashboardPreservesSafeQueueAndWarningActions() throws {
        let source = try appSources()

        XCTAssertTrue(source.contains("Button(\"Clear Pending Queue\", role: .destructive)"))
        XCTAssertTrue(source.contains("Button(\"Clear Failed Jobs\", role: .destructive)"))
        XCTAssertTrue(source.contains(".disabled(!canClearQueue)"))
        XCTAssertTrue(source.contains(".disabled(!canClearFailedQueue)"))
        XCTAssertTrue(source.contains("model.clearQueue()"))
        XCTAssertTrue(source.contains("model.clearFailedJobs()"))
        XCTAssertTrue(source.contains("Text(\"Clear warnings\")"))
        XCTAssertTrue(source.contains("model.clearDashboardWarnings()"))
        XCTAssertTrue(source.contains("queues.pending + queues.processing > 0"))
        XCTAssertTrue(source.contains("queues.failed > 0"))
    }

    func testDashboardPreservesConfigControlsAndSetupNavigation() throws {
        let source = try appSources()

        XCTAssertTrue(source.contains("TextField(\"Kokoro voice id\""))
        XCTAssertTrue(source.contains("labeledRow(\"Summarizer thinking\""))
        XCTAssertTrue(source.contains("Picker(\"Thinking effort"))
        XCTAssertTrue(source.contains("Button(\"Save Thinking\")"))
        XCTAssertTrue(source.contains("model.saveThinking()"))
        XCTAssertTrue(source.contains("TextField(\"Model identifier\""))
        XCTAssertTrue(source.contains("model.draftSummarizerModel"))
        XCTAssertTrue(source.contains("model.saveSummarizerModel()"))
        XCTAssertTrue(source.contains("model.validateSummarizerModel()"))
        XCTAssertTrue(source.contains("Choose from models discovered at startup"))
        XCTAssertTrue(source.contains("Button(\"Open Setup\")"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.setup)"))
    }

    func testDashboardPreservesAttentionAndUnavailableStateAffordances() throws {
        let source = try appSources()

        XCTAssertTrue(source.contains("@Environment(\\.openWindow) private var openWindow"))
        XCTAssertTrue(source.contains("func openAttentionDetails()"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.attention)"))
        XCTAssertTrue(source.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
        XCTAssertTrue(source.contains("model.status?.ui.attention"))
        XCTAssertTrue(source.contains("model.doctorReport == nil"))
        XCTAssertTrue(source.contains("Diagnostics unavailable"))
        XCTAssertTrue(source.contains("model.history == nil"))
        XCTAssertTrue(source.contains("History unavailable"))
    }

    func testAgentCardShowsAppCheckedInstallState() throws {
        let source = try dashboardViewSource()
        let section = try propertyBody(named: "agentGridSection", in: source)
        let badge = try functionBody(named: "installBadge", in: source)

        // Install state drives the badge, read from the app-checked snapshot map.
        XCTAssertTrue(section.contains("model.status?.install?[name]"))
        XCTAssertTrue(section.contains("?? .unknown"))

        // Three real states + the unknown fallback, each with its own label —
        // asserted against the badge builder so an unrelated string can't pass.
        XCTAssertTrue(badge.contains("Label(\"Installed\", systemImage: \"checkmark.circle.fill\")"))
        XCTAssertTrue(badge.contains("Label(\"Not installed\", systemImage: \"xmark.circle\")"))
        XCTAssertTrue(badge.contains("Label(\"Not available yet\", systemImage: \"clock\")"))
        XCTAssertTrue(badge.contains("Label(\"Checking…\", systemImage: \"circle.dotted\")"))

        // "Voice disabled" only surfaces when installed but config-disabled.
        XCTAssertTrue(section.contains("== .installed && agent?.enabled == false"))
        XCTAssertTrue(section.contains("Text(\"Voice disabled\")"))
    }

    func testAgentCardGatesInstallButtonsOnState() throws {
        let source = try dashboardViewSource()
        let controls = try functionBody(named: "agentHookControls", in: source)

        XCTAssertTrue(controls.contains("case .notInstalled:"))
        XCTAssertTrue(controls.contains("Button(\"Install \\(name.capitalized) Hook\")"))
        XCTAssertTrue(controls.contains("case .installed:"))
        XCTAssertTrue(controls.contains("Button(\"Uninstall \\(name.capitalized) Hook\", role: .destructive)"))
        XCTAssertTrue(controls.contains("Hook install coming later"))
        XCTAssertTrue(controls.contains("model.installAgentHook(name)"))
        XCTAssertTrue(controls.contains("model.uninstallAgentHook(name)"))
    }
}
