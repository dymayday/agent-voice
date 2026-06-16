import XCTest

final class AgentVoiceAppSourceTests: XCTestCase {
    func testWindowIDsStayStableForMenuOpenActions() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let dashboard = \"dashboard\""))
        XCTAssertTrue(source.contains("static let setup = \"setup\""))
        XCTAssertTrue(source.contains("static let attention = \"attention\""))
    }

    func testAttentionWindowIDAndSceneAreRegistered() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(source.contains("static let attention = \"attention\""))
        XCTAssertTrue(source.contains("Window(\"Attention\", id: AgentVoiceWindowID.attention)"))
        XCTAssertTrue(source.contains("AttentionDetailView(model: model)"))
        XCTAssertFalse(
            source.contains("WindowGroup(\"Attention"),
            "Attention should be a singleton Window so repeated clicks focus the same detail surface."
        )
    }

    func testMenuBarUsesNativeTemplateWaveformIcon() throws {
        let applicationSource = try appSource("AgentVoiceApp.swift")
        let statusLabel = try sourceSlice(
            in: applicationSource,
            from: "struct StatusBarIconLabel",
            to: "extension DashboardView"
        )

        XCTAssertTrue(applicationSource.contains("MenuBarExtra {"))
        XCTAssertTrue(applicationSource.contains("StatusBarIconLabel()"))
        XCTAssertTrue(statusLabel.contains("Image(systemName: \"waveform\")"))
        XCTAssertTrue(statusLabel.contains(".accessibilityLabel(\"Agent Voice\")"))
        XCTAssertFalse(
            statusLabel.contains("forResource: \"AppIcon\", withExtension: \"icns\""),
            "The status item should not use the full-color app icon."
        )
        XCTAssertFalse(
            statusLabel.contains("Image(nsImage:"),
            "The status item should be a native template-style SF Symbol, not a full-color NSImage."
        )
        XCTAssertFalse(
            statusLabel.contains(".clipShape(Circle())"),
            "The menu-bar glyph should be transparent, not a clipped app-icon circle."
        )
    }

    func testDashboardSceneIsSingletonWindow() throws {
        let source = try appSource("AgentVoiceApp.swift")

        XCTAssertTrue(
            source.contains("Window(\"Dashboard\", id: AgentVoiceWindowID.dashboard)"),
            "Dashboard should use a singleton SwiftUI Window with the shared dashboard window id."
        )
        XCTAssertFalse(
            source.contains("WindowGroup(\"Dashboard"),
            "Dashboard must not use WindowGroup because menu clicks should not spawn multiple dashboard windows."
        )
        XCTAssertTrue(
            source.contains(".defaultSize(width: 960, height: 720)"),
            "Dashboard should define a comfortable default size for the operations cockpit layout."
        )
    }

    func testDashboardAndMenuRegisterVisibleAutoRefresh() throws {
        let dashboardSource = try appSource("DashboardView.swift")
        let menuSource = try appSource("MenuBarSentinelView.swift")

        for source in [dashboardSource, menuSource] {
            XCTAssertTrue(source.contains(".onAppear { model.startAutoRefresh() }"))
            XCTAssertTrue(source.contains(".onDisappear { model.stopAutoRefresh() }"))
            XCTAssertFalse(
                source.contains(".task {\n            await model.refresh()\n        }"),
                "Visible surfaces should use the shared AppModel auto-refresh loop, not independent one-shot tasks."
            )
        }
    }

    func testMenuDashboardActionUsesSharedWindowIDAndActivatesApp() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let footer = try sourceSlice(in: source, from: "private var footer", to: "private func openDashboard")
        let openDashboard = try sourceSlice(
            in: source,
            from: "private func openDashboard",
            to: "private func sectionTitle"
        )

        XCTAssertTrue(footer.contains("actionButton(\"Dashboard\", systemImage: \"gauge\")"))
        XCTAssertTrue(footer.contains("openDashboard()"))
        XCTAssertTrue(openDashboard.contains("openWindow(id: AgentVoiceWindowID.dashboard)"))
        XCTAssertTrue(openDashboard.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
        XCTAssertTrue(footer.contains("openWindow(id: AgentVoiceWindowID.setup)"))
    }

    func testMenuAttentionBannerOpensAttentionWindowAndActivatesApp() throws {
        let source = try appSource("MenuBarSentinelView.swift")
        let attentionBanner = try sourceSlice(
            in: source,
            from: "private var attentionBanner",
            to: "private var queueOverview"
        )
        let openAttention = try sourceSlice(
            in: source,
            from: "private func openAttentionDetails",
            to: "private func openDashboard"
        )

        XCTAssertTrue(attentionBanner.contains("openAttentionDetails()"))
        XCTAssertTrue(openAttention.contains("openWindow(id: AgentVoiceWindowID.attention)"))
        XCTAssertTrue(openAttention.contains("NSApplication.shared.activate(ignoringOtherApps: true)"))
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
