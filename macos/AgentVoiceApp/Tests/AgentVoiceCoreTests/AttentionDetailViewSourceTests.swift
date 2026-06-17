import XCTest

final class AttentionDetailViewSourceTests: XCTestCase {
    func testAttentionDetailViewIncludesRequiredSectionsAndDataSources() throws {
        let source = try appSource("AttentionDetailView.swift")

        XCTAssertTrue(source.contains("struct AttentionDetailView: View"))
        XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
        XCTAssertTrue(source.contains("Diagnostics"))
        XCTAssertTrue(source.contains("Health summary"))
        XCTAssertTrue(source.contains("Runtime and paths"))
        XCTAssertTrue(source.contains("Queue and activity"))
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
        XCTAssertTrue(source.contains("model.diagnosticSnapshotJSON()"))
        XCTAssertTrue(source.contains("NSPasteboard.general"))
        XCTAssertTrue(source.contains("model.startAutoRefresh()"))
        XCTAssertTrue(source.contains("model.stopAutoRefresh()"))
        XCTAssertTrue(source.contains("textSelection(.enabled)"))
    }

    func testAttentionDetailViewUsesOnePrimaryScrollRegion() throws {
        let source = try appSource("AttentionDetailView.swift")

        XCTAssertTrue(source.contains("ScrollView"))
        XCTAssertEqual(source.components(separatedBy: "ScrollView").count - 1, 1)
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
}
