import XCTest

final class AttentionDetailViewSourceTests: XCTestCase {
    func testAttentionDetailViewIncludesRequiredSectionsAndDataSources() throws {
        let source = try appSource("AttentionDetailView.swift")

        XCTAssertTrue(source.contains("struct AttentionDetailView: View"))
        XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
        XCTAssertTrue(source.contains("Diagnostics"))
        XCTAssertTrue(source.contains("Health summary"))
        XCTAssertTrue(source.contains("Runtime and paths"))
        XCTAssertTrue(source.contains("Queue summary"))
        XCTAssertTrue(source.contains("Recent jobs"))
        XCTAssertTrue(source.contains("Configuration context"))
        XCTAssertTrue(source.contains("Doctor checks"))
        XCTAssertTrue(source.contains("Raw diagnostic snapshot"))
        XCTAssertTrue(source.contains("model.status?.ui.attention"))
        XCTAssertTrue(source.contains("model.status?.queues"))
        XCTAssertTrue(source.contains("model.config"))
        XCTAssertTrue(source.contains("model.doctorReport?.checks"))
        XCTAssertTrue(source.contains("model.history?.jobs"))
        XCTAssertTrue(source.contains("job.text"))
        XCTAssertTrue(source.contains("job.summarizerUsed"))
        XCTAssertTrue(source.contains("Refresh history"))
        XCTAssertTrue(source.contains("Load more"))
        XCTAssertTrue(source.contains("model.refreshHistory()"))
        XCTAssertTrue(source.contains("model.loadMoreHistory()"))
        XCTAssertTrue(source.contains("loaded jobs"))
        XCTAssertTrue(source.contains("model.diagnosticSnapshotJSON()"))
        XCTAssertTrue(source.contains("NSPasteboard.general"))
        XCTAssertTrue(source.contains("model.startAutoRefresh()"))
        XCTAssertTrue(source.contains("model.stopAutoRefresh()"))
        XCTAssertTrue(source.contains("textSelection(.enabled)"))
        XCTAssertTrue(source.contains("model.clearFailedJobs()"))
    }

    func testAttentionDetailViewUsesPageScrollPlusJobCardScroll() throws {
        let source = try appSource("AttentionDetailView.swift")
        let jobCard = try functionBody(named: "jobCard", in: source)

        XCTAssertTrue(source.contains("ScrollView"))
        XCTAssertEqual(
            source.components(separatedBy: "ScrollView").count - 1,
            2,
            "Diagnostics should keep one page ScrollView and one intentional job-card ScrollView in source."
        )
        XCTAssertTrue(jobCard.contains("ScrollView"))
    }

    func testRecentJobsSectionIsBottomSectionSeparateFromQueueSummary() throws {
        let source = try appSource("AttentionDetailView.swift")
        let body = try attentionBody(in: source)
        let queueSummary = try propertyBody(named: "queueSummarySection", in: source)
        let recentJobs = try propertyBody(named: "recentJobsSection", in: source)

        let order = try offsets(
            in: body,
            markers: [
                "healthSummarySection",
                "runtimeSection",
                "queueSummarySection",
                "configurationSection",
                "doctorChecksSection",
                "rawSnapshotSection",
                "recentJobsSection"
            ]
        )

        XCTAssertLessThan(order["healthSummarySection"]!, order["runtimeSection"]!)
        XCTAssertLessThan(order["runtimeSection"]!, order["queueSummarySection"]!)
        XCTAssertLessThan(order["queueSummarySection"]!, order["configurationSection"]!)
        XCTAssertLessThan(order["configurationSection"]!, order["doctorChecksSection"]!)
        XCTAssertLessThan(order["doctorChecksSection"]!, order["rawSnapshotSection"]!)
        XCTAssertLessThan(order["rawSnapshotSection"]!, order["recentJobsSection"]!)

        XCTAssertTrue(queueSummary.contains("Pending"))
        XCTAssertTrue(queueSummary.contains("Processing"))
        XCTAssertTrue(queueSummary.contains("Done"))
        XCTAssertTrue(queueSummary.contains("Failed"))
        XCTAssertTrue(queueSummary.contains("Skipped"))
        XCTAssertTrue(queueSummary.contains("Clear Failed Jobs"))
        XCTAssertTrue(queueSummary.contains(".disabled(queues.failed == 0)"))
        XCTAssertFalse(queueSummary.contains("Refresh history"))
        XCTAssertFalse(queueSummary.contains("ForEach(recentJobs)"))

        XCTAssertTrue(recentJobs.contains("Refresh history"))
        XCTAssertTrue(recentJobs.contains("ForEach(recentJobs)"))
        XCTAssertTrue(recentJobs.contains("model.loadMoreHistory()"))
    }

    func testRecentJobCardsHaveFixedBalancedHeightAndIndependentScroll() throws {
        let source = try appSource("AttentionDetailView.swift")
        let jobCard = try functionBody(named: "jobCard", in: source)

        XCTAssertTrue(jobCard.contains("ScrollView"))
        XCTAssertTrue(jobCard.contains(".frame(height: 300)"))
        XCTAssertTrue(jobCard.contains("diagnosticTextBlock(job.summary"))
        XCTAssertTrue(jobCard.contains("diagnosticTextBlock(job.lastError"))
        XCTAssertTrue(jobCard.contains("diagnosticTextBlock(job.text.isEmpty"))
    }

}
