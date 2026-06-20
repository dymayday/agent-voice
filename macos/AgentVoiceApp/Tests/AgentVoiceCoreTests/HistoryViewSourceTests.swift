import XCTest

final class HistoryViewSourceTests: XCTestCase {
    func testHistoryViewExists() throws {
        let source = try appSource("HistoryView.swift")
        XCTAssertTrue(source.contains("struct HistoryView: View"))
        XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
    }

    func testHistoryViewScrollsToAndHighlightsFocusedJob() throws {
        let source = try appSource("HistoryView.swift")

        XCTAssertTrue(source.contains("ScrollViewReader { proxy in"))
        XCTAssertTrue(source.contains("proxy.scrollTo(id, anchor: .top)"))
        XCTAssertTrue(source.contains(".onChange(of: model.focusedHistoryJobID) { _ in"))
        XCTAssertTrue(source.contains("guard let id = model.focusedHistoryJobID"))
        // Consumes the request so re-selecting the same job re-focuses.
        XCTAssertTrue(source.contains("model.focusHistoryJob(nil)"))
        // Transient highlight that fades.
        XCTAssertTrue(source.contains("highlightedJobID"))
        XCTAssertTrue(source.contains("Task.sleep"))
        // Focus always resets the filter so the target row is visible.
        XCTAssertTrue(source.contains("statusFilter = .all"))
    }

    func testHistoryViewHasStatusFilterDefaultingToAll() throws {
        let source = try appSource("HistoryView.swift")

        XCTAssertTrue(source.contains("enum HistoryStatusFilter"))
        XCTAssertTrue(source.contains("case all"))
        XCTAssertTrue(source.contains("case done"))
        XCTAssertTrue(source.contains("case failed"))
        XCTAssertTrue(source.contains("case skipped"))
        XCTAssertTrue(source.contains("@State private var statusFilter: HistoryStatusFilter = .all"))
        XCTAssertTrue(source.contains("Picker(\"Filter\", selection: $statusFilter)"))
        XCTAssertTrue(source.contains(".pickerStyle(.segmented)"))
    }

    func testHistoryViewReusesSharedHistoryPlumbing() throws {
        let source = try appSource("HistoryView.swift")

        XCTAssertTrue(source.contains("model.startAutoRefresh()"))
        XCTAssertTrue(source.contains(".onDisappear { model.stopAutoRefresh() }"))
        XCTAssertTrue(source.contains("model.refreshHistory()"))
        XCTAssertTrue(source.contains("model.loadMoreHistory()"))
        XCTAssertTrue(source.contains("Load more"))
        XCTAssertTrue(source.contains("History unavailable"))
    }
}
