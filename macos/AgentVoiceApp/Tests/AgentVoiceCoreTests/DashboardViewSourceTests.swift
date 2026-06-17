import XCTest

final class DashboardViewSourceTests: XCTestCase {
    func testDashboardUsesOperationsCockpitInformationArchitecture() throws {
        let source = try dashboardViewSource()
        let body = try dashboardBody(in: source)

        let bodyOrder = try offsets(
            in: body,
            markers: ["header", "statusHero", "queueOverviewCard", "operationsGrid", "activityGrid", "agentGridSection"]
        )

        XCTAssertLessThan(bodyOrder["statusHero"]!, bodyOrder["queueOverviewCard"]!)
        XCTAssertLessThan(bodyOrder["queueOverviewCard"]!, bodyOrder["operationsGrid"]!)
        XCTAssertLessThan(bodyOrder["operationsGrid"]!, bodyOrder["activityGrid"]!)
        XCTAssertLessThan(bodyOrder["activityGrid"]!, bodyOrder["agentGridSection"]!)

        XCTAssertTrue(source.contains("private let recentEventsPreviewLimit"))
        XCTAssertTrue(source.contains("private let dashboardColumns"))
        XCTAssertTrue(source.contains("private var diagnosticsCard"))
        XCTAssertTrue(source.contains("accessibilityAddTraits(.isHeader)"))
    }

    func testRecentEventsUsePreviewInsteadOfNestedScrollRegion() throws {
        let source = try dashboardViewSource()
        let recentEvents = try propertyBody(named: "recentEventsSection", in: source)

        XCTAssertTrue(
            source.contains("prefix(recentEventsPreviewLimit)"),
            "Recent events should render as a bounded preview so the dashboard keeps one primary scroll region."
        )
        XCTAssertFalse(
            recentEvents.contains("ScrollView"),
            "Recent events should not add a nested vertical scroll region inside the dashboard scroll view."
        )
    }

    func testOperationsGridNowHostsRecentEvents() throws {
        let source = try dashboardViewSource()
        let operationsGrid = try propertyBody(named: "operationsGrid", in: source)

        XCTAssertTrue(operationsGrid.contains("recentEventsSection"))
        XCTAssertTrue(operationsGrid.contains("kokoroCard"))
    }

    func testOperationsGridUsesTwoReadableColumnsForConfigAndRecentEvents() throws {
        let source = try dashboardViewSource()
        let operationsGrid = try propertyBody(named: "operationsGrid", in: source)
        let readableColumnCount = source.components(
            separatedBy: "GridItem(.flexible(minimum: 340), spacing: 16)"
        ).count - 1

        XCTAssertTrue(operationsGrid.contains("LazyVGrid(columns: dashboardOperationsColumns"))
        XCTAssertEqual(
            readableColumnCount,
            2,
            "Voice/local config and recent spoken events should use two balanced readable columns."
        )
        XCTAssertFalse(
            source.contains("GridItem(.flexible(minimum: 220), spacing: 16)"),
            "The operations cards should not be squeezed into three narrow dashboard columns."
        )
    }

    func testOperationsCardsStretchToEqualHeight() throws {
        let source = try dashboardViewSource()
        let appSource = try appSource("AgentVoiceApp.swift")
        let kokoroCard = try propertyBody(named: "kokoroCard", in: source)
        let recentEvents = try propertyBody(named: "recentEventsSection", in: source)

        XCTAssertTrue(kokoroCard.contains("fillHeight: true"))
        XCTAssertTrue(recentEvents.contains("fillHeight: true"))
        XCTAssertTrue(appSource.contains("fillHeight: Bool = false"))
        XCTAssertTrue(appSource.contains("maxHeight: fillHeight ? .infinity : nil"))
    }

    func testActivityGridShowsDiagnosticsLeftOfFailedJobs() throws {
        let source = try dashboardViewSource()
        let activityGrid = try propertyBody(named: "activityGrid", in: source)

        let diagnosticsIndex = try offset(of: "diagnosticsCard", in: activityGrid)
        let failedIndex = try offset(of: "failedJobsSection", in: activityGrid)
        XCTAssertTrue(activityGrid.contains("diagnosticsCard"))
        XCTAssertTrue(activityGrid.contains("failedJobsSection"))
        XCTAssertLessThan(diagnosticsIndex, failedIndex)
    }

    func testHealthCardExposesClearWarningsAction() throws {
        let source = try dashboardViewSource()
        let health = try propertyBody(named: "healthCard", in: source)
        let appSource = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(health.contains("if canClearWarningState"))
        XCTAssertTrue(health.contains("model.clearDashboardWarnings()"))
        XCTAssertTrue(health.contains("Text(\"Clear warnings\")"))
        XCTAssertTrue(appSource.contains("var canClearWarningState"))
    }

    func testDashboardDoesNotClaimEmptySuccessWhenHistoryOrDiagnosticsAreUnavailable() throws {
        let source = try dashboardViewSource()
        let failedJobs = try propertyBody(named: "failedJobsSection", in: source)
        let recentEvents = try propertyBody(named: "recentEventsSection", in: source)
        let health = try propertyBody(named: "healthCard", in: source)

        XCTAssertTrue(failedJobs.contains("model.history == nil"))
        XCTAssertTrue(recentEvents.contains("model.history == nil"))
        XCTAssertTrue(failedJobs.contains("History unavailable"))
        XCTAssertTrue(recentEvents.contains("History unavailable"))
        XCTAssertTrue(health.contains("model.doctorReport == nil"))
        XCTAssertTrue(health.contains("Diagnostics unavailable"))

        let attentionOffset = try offset(of: "model.status?.ui.attention", in: health)
        let diagnosticsUnavailableOffset = try offset(of: "model.doctorReport == nil", in: health)
        XCTAssertLessThan(attentionOffset, diagnosticsUnavailableOffset)
    }

    func testQueueClearActionsAreDestructiveAndConditioned() throws {
        let source = try dashboardViewSource()
        let queueOverview = try propertyBody(named: "queueOverviewCard", in: source)
        let helpers = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(queueOverview.contains("Button(\"Clear Pending Queue\", role: .destructive)"))
        XCTAssertTrue(queueOverview.contains("Button(\"Clear Failed Jobs\", role: .destructive)"))
        XCTAssertTrue(queueOverview.contains(".disabled(!canClearQueue)"))
        XCTAssertTrue(queueOverview.contains(".disabled(!canClearFailedQueue)"))
        XCTAssertTrue(helpers.contains("queues.pending + queues.processing > 0"))
        XCTAssertTrue(helpers.contains("queues.failed > 0"))
    }

    func testDashboardExposesSummarizerThinkingInLocalConfigCard() throws {
        let source = try dashboardViewSource()
        let kokoroCard = try propertyBody(named: "kokoroCard", in: source)
        let thinkingControls = try propertyBody(named: "thinkingControls", in: source)

        XCTAssertTrue(kokoroCard.contains("labeledRow(\"Summarizer thinking\""))
        XCTAssertTrue(kokoroCard.contains("thinkingControls"))
        XCTAssertTrue(source.contains("private var thinkingControls"))
        XCTAssertTrue(source.contains("AppModel.summarizerThinkingOptions"))
        XCTAssertTrue(thinkingControls.contains("Button(\"Save Thinking\")"))
        XCTAssertTrue(thinkingControls.contains("model.saveThinking()"))
        XCTAssertTrue(thinkingControls.contains("Picker(\"Thinking effort\", selection: $model.draftThinking)"))
        XCTAssertTrue(thinkingControls.contains("ForEach(options, id: \\.self)"))
        XCTAssertTrue(thinkingControls.contains(".disabled("))
        XCTAssertTrue(thinkingControls.contains("options.contains"))
    }

    func testDashboardExposesSummarizerModelSaveAndValidateControls() throws {
        let source = try dashboardViewSource()
        let kokoroCard = try propertyBody(named: "kokoroCard", in: source)
        let summarizerModelControls = try propertyBody(named: "summarizerModelControls", in: source)

        XCTAssertTrue(kokoroCard.contains("summarizerModelControls"))
        XCTAssertTrue(kokoroCard.contains("labeledRow(model.summarizerModelInUseLabel"))
        XCTAssertTrue(source.contains("private var summarizerModelControls"))
        XCTAssertTrue(summarizerModelControls.contains("TextField(\"Model identifier\""))
        XCTAssertTrue(summarizerModelControls.contains("model.draftSummarizerModel"))
        XCTAssertTrue(summarizerModelControls.contains("Button(\"Save\")"))
        XCTAssertTrue(summarizerModelControls.contains("Button(\"Validate\")"))
        XCTAssertTrue(summarizerModelControls.contains("model.saveSummarizerModel()"))
        XCTAssertTrue(summarizerModelControls.contains("model.validateSummarizerModel()"))
        XCTAssertTrue(summarizerModelControls.contains("Choose from models discovered at startup"))
    }

    func testDashboardAttentionSurfacesOpenAttentionWindow() throws {
        let source = try dashboardViewSource()
        let health = try propertyBody(named: "healthCard", in: source)
        let diagnostics = try propertyBody(named: "diagnosticsCard", in: source)

        XCTAssertTrue(source.contains("@Environment(\\.openWindow) private var openWindow"))
        XCTAssertTrue(source.contains("func openAttentionDetails()"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.attention)"))
        XCTAssertTrue(source.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
        XCTAssertTrue(health.contains("openAttentionDetails()"))
        XCTAssertTrue(diagnostics.contains("openAttentionDetails()"))
    }

}
