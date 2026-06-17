import XCTest

final class DockMenuSourceTests: XCTestCase {
    func testApplicationInstallsDockMenuDelegateAndWindowBridge() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("@NSApplicationDelegateAdaptor(AgentVoiceDockMenuDelegate.self)"))
        XCTAssertTrue(source.contains("AgentVoiceDockMenuDelegate.configure(model: appModel)"))
        XCTAssertTrue(source.contains("DockMenuWindowBridge(model: model)"))
    }

    func testDockMenuControllerProvidesUsefulDockMenuItems() throws {
        let source = try appSource("DockMenuController.swift")

        XCTAssertTrue(source.contains("func applicationShouldHandleReopen"))
        XCTAssertTrue(source.contains("func applicationDockMenu(_ sender: NSApplication) -> NSMenu?"))
        XCTAssertTrue(source.contains("NSMenu(title: \"Agent Voice\")"))
        XCTAssertTrue(source.contains("Open Dashboard"))
        XCTAssertTrue(source.contains("Open Setup"))
        XCTAssertTrue(source.contains("Start Daemon"))
        XCTAssertTrue(source.contains("Stop Daemon"))
        XCTAssertFalse(source.contains("Pause Speech"))
        XCTAssertFalse(source.contains("Resume Speech"))
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
        XCTAssertTrue(source.contains("private static var didRouteInitialWindow = false"))
        XCTAssertTrue(source.contains("private static var didUserOpenWindow = false"))
        XCTAssertTrue(source.contains("static func routeInitialWindowIfNeeded(model: AppModel)"))
        XCTAssertFalse(
            source.contains("static var openKokoroSetupWindow"),
            "Launch diagnostics should prompt in Setup, not open the installing Kokoro window directly."
        )
        XCTAssertTrue(source.contains("await model.startDaemon()"))
        XCTAssertTrue(source.contains("await model.stopDaemon()"))
        XCTAssertFalse(source.contains("await model.pause()"))
        XCTAssertFalse(source.contains("await model.resume()"))
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
            to: "@MainActor\nfinal class AgentVoiceDockMenuDelegate"
        )

        XCTAssertTrue(bridge.contains("@Environment(\\.openWindow)"))
        XCTAssertTrue(bridge.contains("openWindow(id: AgentVoiceWindowID.dashboard)"))
        XCTAssertTrue(bridge.contains("openWindow(id: AgentVoiceWindowID.setup)"))
        XCTAssertFalse(
            bridge.contains("openWindow(id: AgentVoiceWindowID.kokoroSetup)"),
            "The bridge must not open Kokoro setup progress automatically because that starts downloads."
        )
        XCTAssertFalse(
            bridge.contains("installKokoro"),
            "Launch routing must never start Kokoro installation directly."
        )
        XCTAssertTrue(bridge.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
    }

    func testDockMenuWindowBridgePromptsForKokoroSetupWhenLaunchDiagnosticsNeedIt() throws {
        let source = try appSource("DockMenuController.swift")
        let bridge = try sourceSlice(
            in: source,
            from: "struct DockMenuWindowBridge",
            to: "@MainActor\nfinal class AgentVoiceDockMenuDelegate"
        )

        XCTAssertTrue(bridge.contains("@ObservedObject var model: AppModel"))
        XCTAssertTrue(bridge.contains("AgentVoiceDockMenuDelegate.routeInitialWindowIfNeeded(model: model)"))

        let delegate = try sourceSlice(
            in: source,
            from: "@MainActor\nfinal class AgentVoiceDockMenuDelegate",
            to: "    func applicationShouldHandleReopen"
        )
        XCTAssertTrue(delegate.contains("await model.refresh()"))
        XCTAssertTrue(delegate.contains("promptForKokoroSetupIfNeeded(model: model)"))
        XCTAssertTrue(delegate.contains("model.requestSetupStep(.kokoro)"))
        XCTAssertTrue(delegate.contains("openSetupWindow?()"))
        XCTAssertTrue(delegate.contains("openDashboardWindow?()"))
        XCTAssertLessThan(
            try offset(of: "openDashboardWindow?()", in: delegate),
            try offset(of: "promptForKokoroSetupIfNeeded(model: model)", in: delegate),
            "Cold launch must always show the dashboard, then separately prompt for Kokoro setup when needed."
        )
        XCTAssertFalse(
            bridge.contains("AgentVoiceDockMenuDelegate.openKokoroSetupWindow?()"),
            "Downloads must wait until the user clicks Install Kokoro."
        )
        XCTAssertFalse(
            delegate.contains("installKokoro"),
            "Cold launch may request the Kokoro setup step but must not start installation."
        )
    }

    func testDockMenuWindowBridgeOpensDashboardOnInitialAppearance() throws {
        let source = try appSource("DockMenuController.swift")
        let bridge = try sourceSlice(
            in: source,
            from: "struct DockMenuWindowBridge",
            to: "@MainActor\nfinal class AgentVoiceDockMenuDelegate"
        )

        XCTAssertFalse(
            bridge.contains("@State private var didOpenInitialWindowOnLaunch"),
            "Cold-launch routing should use delegate-level state that survives bridge view re-creation."
        )

        let delegate = try sourceSlice(
            in: source,
            from: "@MainActor\nfinal class AgentVoiceDockMenuDelegate",
            to: "    func applicationShouldHandleReopen"
        )
        XCTAssertTrue(
            delegate.contains("guard !didRouteInitialWindow, initialWindowRoutingTask == nil else { return }"),
            "The cold-launch window open should only start once."
        )
        XCTAssertTrue(
            delegate.contains("guard !didUserOpenWindow else"),
            "The cold-launch route should not steal focus after a user-opened window."
        )
        XCTAssertTrue(
            delegate.contains("openDashboardWindow?()"),
            "Cold launch should always reuse the same Dashboard-opening behavior as Dock/menu actions."
        )
        let replacesDashboardWithSetup = """
            if model.shouldPromptForKokoroSetup {
                model.requestSetupStep(.kokoro)
                openSetupWindow?()
            } else {
                openDashboardWindow?()
            }
            """
        XCTAssertFalse(
            delegate.contains(replacesDashboardWithSetup),
            "Kokoro prompting must not replace the Dashboard launch window."
        )
    }

    func testDockReopenAlsoPromptsForKokoroSetupAfterOpeningDashboard() throws {
        let source = try appSource("DockMenuController.swift")
        let reopen = try sourceSlice(
            in: source,
            from: "func applicationShouldHandleReopen",
            to: "    func applicationDockMenu"
        )

        XCTAssertTrue(reopen.contains("Self.openDashboardWindow?()"))
        let promptsForSetup = reopen.contains("Self.promptForKokoroSetupIfNeeded")
            || reopen.contains("await Self.promptForKokoroSetupIfNeeded")
        XCTAssertTrue(
            promptsForSetup,
            "Clicking the Dock icon should open Dashboard and still evaluate whether Setup should be shown for missing Kokoro."
        )
    }

}
