import XCTest

final class KokoroSetupProgressViewSourceTests: XCTestCase {
    func testApplicationRegistersKokoroSetupWindow() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let kokoroSetup"))
        XCTAssertTrue(source.contains("Window(\"Kokoro Installer\", id: AgentVoiceWindowID.kokoroSetup)"))
        XCTAssertTrue(source.contains("KokoroSetupProgressView(model: model)"))
    }

    func testSetupAssistantShowsOpenKokoroInstallerButton() throws {
        let source = try appSource("SetupAssistantView.swift")

        XCTAssertTrue(source.contains("Open Kokoro Installer"))
        XCTAssertTrue(source.contains("openWindow(id: AgentVoiceWindowID.kokoroSetup)"))
        XCTAssertFalse(
            source.contains("model.installKokoro()"),
            "SetupAssistant should only open the installer window; installation starts after explicit consent there."
        )
    }

    func testSetupAssistantCanOpenDirectlyToRequestedKokoroStepWithoutInstalling() throws {
        let source = try appSource("SetupAssistantView.swift")

        XCTAssertTrue(source.contains("applyPreferredSetupStepIfNeeded()"))
        XCTAssertTrue(source.contains("model.preferredSetupStep"))
        XCTAssertTrue(source.contains("model.clearPreferredSetupStep(step)"))
        XCTAssertFalse(
            source.contains("await model.installKokoro()"),
            "Opening Setup to the Kokoro step must not start downloads."
        )
    }

    func testProgressViewRequiresExplicitStartBeforeInstalling() throws {
        let source = try appSource("KokoroSetupProgressView.swift")
        let body = try sourceSlice(
            in: source,
            from: "    var body: some View",
            to: "    private var controls"
        )
        let controls = try sourceSlice(
            in: source,
            from: "    private var controls: some View",
            to: "    private var stepList"
        )

        XCTAssertTrue(source.contains("Ready to install Kokoro"))
        XCTAssertTrue(controls.contains("Button(\"Start Installing\") { Task { await model.installKokoro() } }"))
        XCTAssertFalse(
            body.contains("installKokoro"),
            "Opening the Kokoro installer window must not start network/download work without a button click."
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

    func testProgressViewSurfacesKokoroDetectionErrors() throws {
        let source = try appSource("KokoroSetupProgressView.swift")

        XCTAssertTrue(source.contains("model.kokoroSetupDetectionError"))
        XCTAssertTrue(source.contains("Setup detection needs attention"))
    }

    func testCopyDiagnosticsReportsPasteboardFailures() throws {
        let source = try appSource("KokoroSetupProgressView.swift")
        let copyDiagnostics = try functionBody(named: "copyDiagnostics", in: source)

        XCTAssertTrue(copyDiagnostics.contains("if NSPasteboard.general.setString"))
        XCTAssertTrue(copyDiagnostics.contains("Diagnostics copied."))
        XCTAssertTrue(copyDiagnostics.contains("Copy failed."))
    }

    func testDetailsLogIsHeightBoundedSoItScrollsInsideInstallerWindow() throws {
        let source = try appSource("KokoroSetupProgressView.swift")
        let details = try sourceSlice(
            in: source,
            from: "DisclosureGroup(\"Details\"",
            to: "if model.kokoroSetup.phase == .failed"
        )

        XCTAssertTrue(details.contains("ScrollView"))
        XCTAssertTrue(
            details.contains(".frame(minHeight: 120, maxHeight:"),
            "Details log must have a maximum height so long diagnostics " +
                "scroll instead of expanding the installer window."
        )
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
