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

    func testQueueClearActionIsDestructiveAndOnlyEnabledForActiveQueue() throws {
        let source = try dashboardViewSource()
        let queueOverview = try propertyBody(named: "queueOverviewCard", in: source)
        let helpers = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(queueOverview.contains("Button(\"Clear Pending Queue\", role: .destructive)"))
        XCTAssertTrue(queueOverview.contains(".disabled(!canClearQueue)"))
        XCTAssertTrue(helpers.contains("queues.pending + queues.processing > 0"))
    }

    private func dashboardViewSource() throws -> String {
        try appSource("DashboardView.swift")
    }

    private func appSource(_ fileName: String) throws -> String {
        let testFile = URL(fileURLWithPath: #filePath)
        let packageRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceFile = packageRoot.appendingPathComponent("Sources/AgentVoiceApp/\(fileName)")
        return try String(contentsOf: sourceFile, encoding: .utf8)
    }

    private func dashboardBody(in source: String) throws -> String {
        guard
            let start = source.range(of: "    var body: some View"),
            let end = source.range(of: "    var header", range: start.upperBound..<source.endIndex)
        else {
            XCTFail("Could not isolate DashboardView body")
            throw XCTSkip("Cannot verify dashboard section order without DashboardView body.")
        }
        return String(source[start.lowerBound..<end.lowerBound])
    }

    private func propertyBody(named propertyName: String, in source: String) throws -> String {
        let marker = "private var \(propertyName): some View"
        guard let start = source.range(of: marker) else {
            XCTFail("Could not find property: \(propertyName)")
            throw XCTSkip("Cannot verify missing property.")
        }
        let remaining = source[start.upperBound..<source.endIndex]
        let nextProperty = remaining.range(of: "\n    private var ")?.lowerBound ?? source.endIndex
        return String(source[start.lowerBound..<nextProperty])
    }

    private func offset(of marker: String, in source: String) throws -> String.Index {
        guard let range = source.range(of: marker) else {
            XCTFail("Missing marker: \(marker)")
            throw XCTSkip("Cannot verify source order without \(marker).")
        }
        return range.lowerBound
    }

    private func offsets(in source: String, markers: [String]) throws -> [String: String.Index] {
        var offsets: [String: String.Index] = [:]

        for marker in markers {
            guard let range = source.range(of: marker) else {
                XCTFail("Missing marker: \(marker)")
                throw XCTSkip("Cannot verify dashboard section order without \(marker).")
            }
            offsets[marker] = range.lowerBound
        }

        return offsets
    }
}
