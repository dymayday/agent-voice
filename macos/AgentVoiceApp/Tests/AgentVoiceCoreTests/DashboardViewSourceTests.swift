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
}
