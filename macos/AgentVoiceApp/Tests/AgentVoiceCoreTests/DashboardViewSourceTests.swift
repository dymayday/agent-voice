import XCTest

final class DashboardViewSourceTests: XCTestCase {
    func testRecentEventsSectionStaysAtBottomWithItsOwnScrollRegion() throws {
        let source = try dashboardViewSource()
        let body = try dashboardBody(in: source)

        let bodyOrder = try offsets(
            in: body,
            markers: ["queueCards", "failedJobsSection", "agentGridSection", "recentEventsSection"]
        )
        XCTAssertLessThan(bodyOrder["agentGridSection"]!, bodyOrder["recentEventsSection"]!)

        XCTAssertTrue(
            source.contains("private let recentEventsListMaxHeight: CGFloat"),
            "Recent events should use a named max-height cap so long history does not stretch the dashboard."
        )
        XCTAssertTrue(
            source.contains("ScrollView {\n                        LazyVStack"),
            "Recent events should render inside its own scroll view."
        )
        XCTAssertTrue(
            source.contains(".frame(maxHeight: recentEventsListMaxHeight)"),
            "Recent events scroll view should be height-constrained."
        )
    }

    private func dashboardViewSource() throws -> String {
        let testFile = URL(fileURLWithPath: #filePath)
        let packageRoot = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let dashboardView = packageRoot.appendingPathComponent("Sources/AgentVoiceApp/DashboardView.swift")
        return try String(contentsOf: dashboardView, encoding: .utf8)
    }

    private func dashboardBody(in source: String) throws -> String {
        guard
            let start = source.range(of: "    var body: some View"),
            let end = source.range(of: "    private var header", range: start.upperBound..<source.endIndex)
        else {
            XCTFail("Could not isolate DashboardView body")
            throw XCTSkip("Cannot verify dashboard section order without DashboardView body.")
        }
        return String(source[start.lowerBound..<end.lowerBound])
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
