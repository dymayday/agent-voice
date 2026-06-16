import XCTest

final class AttentionDetailViewSourceTests: XCTestCase {
    func testAttentionDetailViewIncludesRequiredSectionsAndDataSources() throws {
        let source = try appSource("AttentionDetailView.swift")

        XCTAssertTrue(source.contains("struct AttentionDetailView: View"))
        XCTAssertTrue(source.contains("@ObservedObject var model: AppModel"))
        XCTAssertTrue(source.contains("Attention messages"))
        XCTAssertTrue(source.contains("Doctor checks needing review"))
        XCTAssertTrue(source.contains("Failed jobs and recent errors"))
        XCTAssertTrue(source.contains("model.status?.ui.attention"))
        XCTAssertTrue(source.contains("model.doctorReport == nil"))
        XCTAssertTrue(source.contains("model.history == nil"))
        XCTAssertTrue(source.contains("$0.status == .failed"))
        XCTAssertTrue(source.contains("model.startAutoRefresh()"))
        XCTAssertTrue(source.contains("model.stopAutoRefresh()"))
        XCTAssertTrue(source.contains("Text(check.message)"))
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
