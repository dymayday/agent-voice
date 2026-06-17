import XCTest

final class KokoroSetupProgressViewSourceTests: XCTestCase {
    func testApplicationRegistersKokoroSetupWindow() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let kokoroSetup"))
        XCTAssertTrue(source.contains("Window(\"Installing Kokoro\", id: AgentVoiceWindowID.kokoroSetup)"))
        XCTAssertTrue(source.contains("KokoroSetupProgressView(model: model)"))
    }

    func testSetupAssistantShowsInstallKokoroButton() throws {
        let source = try appSource("SetupAssistantView.swift")

        XCTAssertTrue(source.contains("Install Kokoro"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.kokoroSetup)"))
        XCTAssertFalse(
            source.contains("model.installKokoro()"),
            "SetupAssistant should only open the setup window; the progress window owns starting the install."
        )
    }

    func testSetupAssistantCanOpenDirectlyToRequestedKokoroStepWithoutInstalling() throws {
        let source = try appSource("SetupAssistantView.swift")

        XCTAssertTrue(source.contains("applyPreferredSetupStepIfNeeded()"))
        XCTAssertTrue(source.contains("model.preferredSetupStep"))
        XCTAssertTrue(source.contains("model.clearPreferredSetupStep(step)"))
        XCTAssertFalse(
            source.contains("await model.installKokoro()"),
            "Opening Setup to the Kokoro step must not start downloads until Install Kokoro is clicked."
        )
    }

    func testSetupAssistantDisclosesInstallRequirements() throws {
        let source = try appSource("SetupAssistantView.swift")

        XCTAssertTrue(source.localizedCaseInsensitiveContains("uv"))
        XCTAssertTrue(source.localizedCaseInsensitiveContains("network"))
        XCTAssertTrue(source.localizedCaseInsensitiveContains("disk"))
    }

    func testProgressViewHasDiagnosticsControls() throws {
        let source = try appSource("KokoroSetupProgressView.swift")

        XCTAssertTrue(source.contains("Details"))
        XCTAssertTrue(source.contains("Copy Diagnostics"))
        XCTAssertTrue(source.contains("Retry"))
        XCTAssertTrue(source.contains("Cancel"))
        XCTAssertTrue(source.contains("model.cancelKokoroSetup()"))
        XCTAssertTrue(source.contains("KokoroSetupSteps.all"))
    }

    func testProgressViewHasAccessibleProgressAndErrorText() throws {
        let source = try appSource("KokoroSetupProgressView.swift")

        XCTAssertTrue(source.contains("accessibilityLabel(\"Kokoro setup progress\")"))
        XCTAssertTrue(source.contains("Setup failed"))
        XCTAssertTrue(source.contains("textSelection(.enabled)"))
    }

    private func appSource(_ fileName: String) throws -> String {
        let packageRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let sourceFile = packageRoot.appendingPathComponent("Sources/AgentVoiceApp/\(fileName)")
        return try String(contentsOf: sourceFile, encoding: .utf8)
    }
}
