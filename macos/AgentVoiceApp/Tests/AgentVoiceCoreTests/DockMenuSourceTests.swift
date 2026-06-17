import XCTest

final class DockMenuSourceTests: XCTestCase {
    func testApplicationInstallsDockMenuDelegateAndWindowBridge() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("@NSApplicationDelegateAdaptor(AgentVoiceDockMenuDelegate.self)"))
        XCTAssertTrue(source.contains("AgentVoiceDockMenuDelegate.configure(model: appModel)"))
        XCTAssertTrue(source.contains("DockMenuWindowBridge()"))
    }

    func testDockMenuControllerProvidesUsefulDockMenuItems() throws {
        let source = try appSource("DockMenuController.swift")

        XCTAssertTrue(source.contains("func applicationDockMenu(_ sender: NSApplication) -> NSMenu?"))
        XCTAssertTrue(source.contains("NSMenu(title: \"Agent Voice\")"))
        XCTAssertTrue(source.contains("Open Dashboard"))
        XCTAssertTrue(source.contains("Open Setup"))
        XCTAssertTrue(source.contains("Start Daemon"))
        XCTAssertTrue(source.contains("Stop Daemon"))
        XCTAssertTrue(source.contains("Pause Speech"))
        XCTAssertTrue(source.contains("Resume Speech"))
        XCTAssertTrue(source.contains("Run Voice Test"))
        XCTAssertTrue(source.contains("Reveal Agent Voice Home"))
        XCTAssertTrue(source.contains("Copy Diagnostic Snapshot"))
        XCTAssertTrue(source.contains("Quit Agent Voice"))
    }

    func testDockMenuControllerRoutesItemsToExistingAppCapabilities() throws {
        let source = try appSource("DockMenuController.swift")

        XCTAssertTrue(source.contains("static weak var model: AppModel?"))
        XCTAssertTrue(source.contains("static var openDashboardWindow: (() -> Void)?"))
        XCTAssertTrue(source.contains("static var openSetupWindow: (() -> Void)?"))
        XCTAssertTrue(source.contains("await model.startDaemon()"))
        XCTAssertTrue(source.contains("await model.stopDaemon()"))
        XCTAssertTrue(source.contains("await model.pause()"))
        XCTAssertTrue(source.contains("await model.resume()"))
        XCTAssertTrue(source.contains("await model.testVoice()"))
        XCTAssertTrue(source.contains("model.diagnosticSnapshotJSON()"))
        XCTAssertTrue(source.contains("NSPasteboard.general"))
        XCTAssertTrue(source.contains("NSWorkspace.shared.open"))
        XCTAssertTrue(source.contains("await model.stopDaemonBeforeQuit()"))
    }

    func testDockMenuWindowBridgeOpensSwiftUIWindowsAndActivatesApp() throws {
        let source = try appSource("DockMenuController.swift")
        let bridge = try sourceSlice(
            in: source,
            from: "struct DockMenuWindowBridge",
            to: "@MainActor"
        )

        XCTAssertTrue(bridge.contains("@Environment(\\.openWindow)"))
        XCTAssertTrue(bridge.contains("openWindow(id: AgentVoiceWindowID.dashboard)"))
        XCTAssertTrue(bridge.contains("openWindow(id: AgentVoiceWindowID.setup)"))
        XCTAssertTrue(bridge.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
    }

    private func sourceSlice(in source: String, from startMarker: String, to endMarker: String) throws -> String {
        guard
            let start = source.range(of: startMarker),
            let end = source.range(of: endMarker, range: start.upperBound..<source.endIndex)
        else {
            XCTFail("Could not isolate source slice from \(startMarker) to \(endMarker)")
            throw XCTSkip("Cannot verify source action binding without expected markers.")
        }
        return String(source[start.lowerBound..<end.lowerBound])
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
