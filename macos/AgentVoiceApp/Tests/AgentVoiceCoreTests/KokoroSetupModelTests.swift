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

    func testDecodesUnknownStepIdsAndStatusesForForwardCompatibility() throws {
        let decoder = JSONDecoder()

        let renamedStep = try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"step","id":"renamed-step","status":"running","title":"Renamed"}"#.utf8)
        )
        let unknownStatus = try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"step","id":"prepare","status":"warming","title":"Preparing"}"#.utf8)
        )

        XCTAssertEqual(renamedStep.id, "renamed-step")
        XCTAssertEqual(renamedStep.status, "running")
        XCTAssertEqual(unknownStatus.id, "prepare")
        XCTAssertEqual(unknownStatus.status, "warming")
        XCTAssertThrowsError(try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"step","id":"prepare","status":"running"}"#.utf8)
        ))
    }

    func testRejectsMalformedLogAndCompleteEvents() {
        let decoder = JSONDecoder()

        XCTAssertThrowsError(try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"log","stream":"debug","message":"ok"}"#.utf8)
        ))
        XCTAssertThrowsError(try decoder.decode(
            KokoroSetupEvent.self,
            from: Data(#"{"type":"complete"}"#.utf8)
        ))
    }

    func testStepDefinitionsMatchCLIContractOrder() {
        XCTAssertEqual(KokoroSetupSteps.all.map(\.id), [
            "prepare",
            "uv-check",
            "script",
            "venv",
            "deps",
            "model",
            "smoke-test",
            "config"
        ])
        XCTAssertEqual(KokoroSetupSteps.all.first?.title, "Prepare install directory")
        XCTAssertEqual(KokoroSetupSteps.all.last?.title, "Save Agent Voice config")
    }

    func testStepDefinitionsMatchTypeScriptContract() throws {
        let source = try repositorySource("src/kokoro-setup.ts")
        guard let start = source.range(of: "export const KOKORO_SETUP_STEP_IDS")?.lowerBound,
              let end = source[start...].range(of: "];" )?.upperBound else {
            return XCTFail("KOKORO_SETUP_STEP_IDS contract not found")
        }

        let declaration = String(source[start..<end])
        let regex = try NSRegularExpression(pattern: #"\"([a-z-]+)\""#)
        let nsDeclaration = declaration as NSString
        let ids = regex.matches(
            in: declaration,
            range: NSRange(location: 0, length: nsDeclaration.length)
        ).map { nsDeclaration.substring(with: $0.range(at: 1)) }

        XCTAssertEqual(ids, KokoroSetupSteps.all.map(\.id))
    }

    func testSnapshotDefaultsToIdle() {
        let snapshot = KokoroSetupSnapshot()

        XCTAssertEqual(snapshot.phase, .idle)
        XCTAssertNil(snapshot.currentStepID)
        XCTAssertTrue(snapshot.completedStepIDs.isEmpty)
        XCTAssertTrue(snapshot.logs.isEmpty)
        XCTAssertNil(snapshot.error)
    }

    func testSnapshotRejectsUnknownAndDuplicateStepState() {
        let snapshot = KokoroSetupSnapshot(
            phase: .running,
            currentStepID: "renamed-step",
            currentTitle: "Installing",
            completedStepIDs: ["prepare", "prepare", "unknown"],
            skippedStepIDs: ["prepare", "config", "missing"],
            failedStepID: "not-a-step",
            logs: [],
            error: nil
        )

        XCTAssertNil(snapshot.currentStepID)
        XCTAssertEqual(snapshot.completedStepIDs, ["prepare"])
        XCTAssertEqual(snapshot.skippedStepIDs, ["config"])
        XCTAssertNil(snapshot.failedStepID)
    }

    func testEventCatchAllInitializerIsNotPublic() throws {
        let source = try repositorySource("macos/AgentVoiceApp/Sources/AgentVoiceCore/KokoroSetupModels.swift")

        XCTAssertFalse(source.contains("public init(\n        type: EventType"))
    }

    func testSnapshotStepStateIsPublicReadOnly() throws {
        let source = try repositorySource("macos/AgentVoiceApp/Sources/AgentVoiceCore/KokoroSetupModels.swift")

        XCTAssertTrue(source.contains("public internal(set) var currentStepID"))
        XCTAssertTrue(source.contains("public internal(set) var completedStepIDs"))
        XCTAssertTrue(source.contains("public internal(set) var skippedStepIDs"))
        XCTAssertTrue(source.contains("public internal(set) var failedStepID"))
    }

    private func repositorySource(_ relativePath: String) throws -> String {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let repositoryRoot = packageRoot
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceFile = repositoryRoot.appendingPathComponent(relativePath)
        return try String(contentsOf: sourceFile, encoding: .utf8)
    }
}
