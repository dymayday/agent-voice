import AgentVoiceCore
import AppKit
import SwiftUI

struct DockMenuWindowBridge: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .onAppear {
                AgentVoiceDockMenuDelegate.openDashboardWindow = {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    openWindow(id: AgentVoiceWindowID.dashboard)
                }
                AgentVoiceDockMenuDelegate.openSetupWindow = {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    openWindow(id: AgentVoiceWindowID.setup)
                }
            }
    }
}

@MainActor
final class AgentVoiceDockMenuDelegate: NSObject, NSApplicationDelegate {
    static weak var model: AppModel?
    static var openDashboardWindow: (() -> Void)?
    static var openSetupWindow: (() -> Void)?

    static func configure(model: AppModel) {
        self.model = model
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

        let speechTitle = currentModel?.status?.ui.state == .paused ? "Resume Speech" : "Pause Speech"
        menu.addItem(menuItem(
            title: speechTitle,
            action: #selector(toggleSpeechFromDockMenu(_:)),
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

    @objc private func toggleSpeechFromDockMenu(_ sender: NSMenuItem) {
        guard let model = currentModel else { return }
        Task { @MainActor in
            if model.status?.ui.state == .paused {
                await model.resume()
            } else {
                await model.pause()
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
