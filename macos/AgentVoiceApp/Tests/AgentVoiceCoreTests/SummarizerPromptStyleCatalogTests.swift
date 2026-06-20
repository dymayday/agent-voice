import XCTest
@testable import AgentVoiceCore

final class SummarizerPromptStyleCatalogTests: XCTestCase {
    func testCatalogIdsMatchAllowlistInOrder() {
        XCTAssertEqual(
            AppModel.summarizerPromptStyleCatalog.map(\.id),
            ["default", "terse", "status-about", "triage", "conversational", "adaptive"]
        )
        XCTAssertEqual(AppModel.summarizerPromptStyleOptions, AppModel.summarizerPromptStyleCatalog.map(\.id))
    }

    func testEveryCatalogEntryHasNameDetailAndExample() {
        for info in AppModel.summarizerPromptStyleCatalog {
            XCTAssertFalse(info.name.isEmpty, "name empty for \(info.id)")
            XCTAssertFalse(info.detail.isEmpty, "detail empty for \(info.id)")
            XCTAssertFalse(info.example.isEmpty, "example empty for \(info.id)")
        }
    }
}
