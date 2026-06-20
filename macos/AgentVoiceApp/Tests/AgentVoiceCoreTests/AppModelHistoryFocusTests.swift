import XCTest
@testable import AgentVoiceCore

@MainActor
final class AppModelHistoryFocusTests: XCTestCase {
    private func makeModel() -> AppModel {
        let cli = AgentVoiceCLI(
            executableURL: URL(fileURLWithPath: "/repo/bin/agent-voice"),
            runner: RecordingRunner(results: [])
        )
        return AppModel(cli: cli)
    }

    func testFocusHistoryJobSetsFocusedID() {
        let model = makeModel()
        XCTAssertNil(model.focusedHistoryJobID)

        model.focusHistoryJob("done-1")

        XCTAssertEqual(model.focusedHistoryJobID, "done-1")
    }

    func testFocusHistoryJobNilClearsFocusedID() {
        let model = makeModel()
        model.focusHistoryJob("done-1")

        model.focusHistoryJob(nil)

        XCTAssertNil(model.focusedHistoryJobID)
    }
}
