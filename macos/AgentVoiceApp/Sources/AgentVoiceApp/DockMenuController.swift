import AgentVoiceCore
import AppKit
import SwiftUI

struct DockMenuWindowBridge: View {
    @ObservedObject var model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .onAppear {
                AgentVoiceDockMenuDelegate.configureWindowOpeners(
                    openDashboard: {
                        NSApplication.shared.activate(ignoringOtherApps: true)
                        openWindow(id: AgentVoiceWindowID.dashboard)
                    },
                    openSetup: {
                        NSApplication.shared.activate(ignoringOtherApps: true)
                        openWindow(id: AgentVoiceWindowID.setup)
                    },
                    openKokoroSetup: {
                        NSApplication.shared.activate(ignoringOtherApps: true)
                        openWindow(id: AgentVoiceWindowID.kokoroSetup)
                    }
                )
                AgentVoiceDockMenuDelegate.routeInitialWindowIfNeeded(model: model)
            }
    }
}

@MainActor
final class AgentVoiceDockMenuDelegate: NSObject, NSApplicationDelegate {
    static weak var model: AppModel?
    static var openDashboardWindow: (() -> Void)?
    static var openSetupWindow: (() -> Void)?
    static var openKokoroSetupWindow: (() -> Void)?
    private static var didRouteInitialWindow = false
    private static var didUserOpenWindow = false
    private static var initialWindowRoutingTask: Task<Void, Never>?

    static func configure(model: AppModel) {
        self.model = model
    }

    static func configureWindowOpeners(
        openDashboard: @escaping () -> Void,
        openSetup: @escaping () -> Void,
        openKokoroSetup: @escaping () -> Void
    ) {
        openDashboardWindow = {
            didUserOpenWindow = true
            openDashboard()
        }
        openSetupWindow = {
            didUserOpenWindow = true
            openSetup()
        }
        openKokoroSetupWindow = {
            didUserOpenWindow = true
            openKokoroSetup()
        }
        if let model {
            routeInitialWindowIfNeeded(model: model)
        }
    }

    static func routeInitialWindowIfNeeded(model: AppModel) {
        guard !didRouteInitialWindow, initialWindowRoutingTask == nil else { return }
        guard openDashboardWindow != nil, openKokoroSetupWindow != nil else { return }
        guard !didUserOpenWindow else {
            didRouteInitialWindow = true
            return
        }

        didRouteInitialWindow = true
        openDashboardWindow?()
        initialWindowRoutingTask = Task { @MainActor in
            defer { initialWindowRoutingTask = nil }
            await model.refresh()
            guard !Task.isCancelled else { return }
            if model.status?.daemon.running != true {
                await model.startDaemon()
            }
            guard !Task.isCancelled else { return }
            promptForKokoroSetupIfNeeded(model: model)
        }
    }

    static func promptForKokoroSetupIfNeeded(model: AppModel) {
        guard model.shouldPromptForKokoroSetup else { return }
        openKokoroSetupWindow?()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows _: Bool) -> Bool {
        Self.openDashboardWindow?()
        guard let model = Self.model else { return true }
        Task { @MainActor in
            await model.refresh()
            Self.promptForKokoroSetupIfNeeded(model: model)
        }
        return true
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu(title: "Agent Voice")
        menu.addItem(menuItem(title: "Open Dashboard", action: #selector(openDashboardFromDockMenu(_:))))
        menu.addItem(menuItem(title: "Open Setup", action: #selector(openSetupFromDockMenu(_:))))
        menu.addItem(.separator())

        let daemonTitle = currentModel?.status?.daemon.running == true ? "Stop Daemon" : "Start Daemon"
        menu.addItem(menuItem(
            title: daemonTitle,
            action: #selector(toggleDaemonFromDockMenu(_:)),
            enabled: currentModel != nil
        ))

        menu.addItem(menuItem(
            title: "Run Voice Test",
            action: #selector(runVoiceTestFromDockMenu(_:)),
            enabled: currentModel != nil
        ))
        menu.addItem(.separator())

        menu.addItem(menuItem(
            title: "Reveal Agent Voice Home",
            action: #selector(revealAgentVoiceHomeFromDockMenu(_:)),
            enabled: canRevealAgentVoiceHome
        ))
        menu.addItem(menuItem(
            title: "Copy Diagnostic Snapshot",
            action: #selector(copyDiagnosticSnapshotFromDockMenu(_:)),
            enabled: currentModel != nil
        ))
        menu.addItem(.separator())
        menu.addItem(menuItem(title: "Quit Agent Voice", action: #selector(quitAgentVoiceFromDockMenu(_:))))
        return menu
    }

    // Gate the GUI's auto-refresh loop on real app visibility/focus. `onAppear`/
    // `onDisappear` only fire on window open/close, so an open-but-occluded or
    // backgrounded window would otherwise keep polling. Occlusion drives a hard
    // suspend; activation drives the focused/unfocused cadence.
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Handlers hop through Task { @MainActor } to reach the main-actor model:
        // MainActor.assumeIsolated would be synchronous but is macOS 14+, and this
        // target deploys to macOS 13. Ordering across the hops is benign — each
        // visibility handler reads NSApp.occlusionState live (not a captured value)
        // and setHostActive is a last-writer-wins cadence flag.
        let center = NotificationCenter.default
        center.addObserver(
            forName: NSApplication.didChangeOcclusionStateNotification,
            object: NSApp,
            queue: .main
        ) { _ in
            Task { @MainActor in Self.syncHostVisibility() }
        }
        center.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: NSApp,
            queue: .main
        ) { _ in
            Task { @MainActor in
                Self.model?.setHostActive(true)
                // Re-seed visibility in case an occlusion change was missed while
                // the app was inactive.
                Self.syncHostVisibility()
            }
        }
        center.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: NSApp,
            queue: .main
        ) { _ in
            Task { @MainActor in Self.model?.setHostActive(false) }
        }
        // Seed initial visibility and focus so a launch that is occluded or not
        // frontmost (login item, `open -g`) starts in the right state.
        Self.syncHostVisibility()
        Self.model?.setHostActive(NSApp.isActive)
    }

    private static func syncHostVisibility() {
        model?.setHostVisibility(NSApp.occlusionState.contains(.visible))
    }

    @objc private func openDashboardFromDockMenu(_ sender: NSMenuItem) {
        Self.openDashboardWindow?()
    }

    @objc private func openSetupFromDockMenu(_ sender: NSMenuItem) {
        Self.openSetupWindow?()
    }

    @objc private func toggleDaemonFromDockMenu(_ sender: NSMenuItem) {
        guard let model = currentModel else { return }
        Task { @MainActor in
            if model.status?.daemon.running == true {
                await model.stopDaemon()
            } else {
                await model.startDaemon()
            }
        }
    }

    @objc private func runVoiceTestFromDockMenu(_ sender: NSMenuItem) {
        guard let model = currentModel else { return }
        Task { @MainActor in
            await model.testVoice()
        }
    }

    @objc private func revealAgentVoiceHomeFromDockMenu(_ sender: NSMenuItem) {
        guard let homePath = currentModel?.status?.paths.home.trimmingCharacters(in: .whitespacesAndNewlines),
              !homePath.isEmpty
        else {
            NSSound.beep()
            return
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: homePath, isDirectory: &isDirectory), isDirectory.boolValue else {
            NSSound.beep()
            return
        }

        if !NSWorkspace.shared.open(URL(fileURLWithPath: homePath, isDirectory: true)) {
            NSSound.beep()
        }
    }

    @objc private func copyDiagnosticSnapshotFromDockMenu(_ sender: NSMenuItem) {
        guard let model = currentModel else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        if !pasteboard.setString(model.diagnosticSnapshotJSON(), forType: .string) {
            NSSound.beep()
        }
    }

    @objc private func quitAgentVoiceFromDockMenu(_ sender: NSMenuItem) {
        guard let model = currentModel else {
            NSApplication.shared.terminate(nil)
            return
        }

        Task { @MainActor in
            if await model.stopDaemonBeforeQuit() {
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private var currentModel: AppModel? {
        Self.model
    }

    private var canRevealAgentVoiceHome: Bool {
        currentModel?.status?.paths.home.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    private func menuItem(title: String, action: Selector, enabled: Bool = true) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        item.isEnabled = enabled
        return item
    }
}
