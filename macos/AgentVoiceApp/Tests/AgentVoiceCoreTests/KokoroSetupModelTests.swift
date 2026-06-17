import XCTest
@testable import AgentVoiceCore

final class KokoroSetupModelTests: XCTestCase {
    func testDecodesStepLogAndCompleteEvents() throws {
        let decoder = JSONDecoder()
        let step = try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"step","id":"prepare","status":"running","title":"Preparing"}"#.utf8)
        )
        let log = try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"log","stream":"stdout","message":"ok"}"#.utf8)
        )
        let complete = try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"complete","ok":true}"#.utf8)
        )

        XCTAssertEqual(step.type, .step)
        XCTAssertEqual(step.id, "prepare")
        XCTAssertEqual(step.status, "running")
        XCTAssertEqual(step.title, "Preparing")
        XCTAssertEqual(log.type, .log)
        XCTAssertEqual(log.stream, "stdout")
        XCTAssertEqual(log.message, "ok")
        XCTAssertEqual(complete.type, .complete)
        XCTAssertEqual(complete.ok, true)
    }

    func testStepDefinitionsMatchCLIContractOrder() {
        XCTAssertEqual(KokoroSetupSteps.all.map(\.id), [
            "prepare",
            "uv-check",
            "script",
            "venv",
            "deps",
            "model",
            "config",
            "smoke-test"
        ])
        XCTAssertEqual(KokoroSetupSteps.all.first?.title, "Prepare install directory")
        XCTAssertEqual(KokoroSetupSteps.all.last?.title, "Verify Kokoro")
    }

    func testSnapshotDefaultsToIdle() {
        let snapshot = KokoroSetupSnapshot()

        XCTAssertEqual(snapshot.phase, .idle)
        XCTAssertNil(snapshot.currentStepID)
        XCTAssertTrue(snapshot.completedStepIDs.isEmpty)
        XCTAssertTrue(snapshot.logs.isEmpty)
        XCTAssertNil(snapshot.error)
    }
}
