import Foundation

public struct AppSettings: Equatable, Sendable {
    public var executableURL: URL
    public var agentVoiceHome: URL?
    /// The running app bundle's own build id, read from `build-info.json` next to
    /// the bundled CLI. `nil` for unstamped / dev builds. The app compares this to
    /// each daemon snapshot's build id to detect — and restart — a daemon still
    /// running an older bundle.
    public var appBuildId: String?

    public init(executableURL: URL, agentVoiceHome: URL? = nil, appBuildId: String? = nil) {
        self.executableURL = executableURL
        self.agentVoiceHome = agentVoiceHome
        self.appBuildId = appBuildId
    }

    public static func defaultSettings(
        env: [String: String] = ProcessInfo.processInfo.environment,
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> AppSettings {
        let home = env["AGENT_VOICE_HOME"].map { URL(fileURLWithPath: $0) }
        // Resolve from the app's own bundle (not executableURL): even with an
        // AGENT_VOICE_EXECUTABLE override, the build id we compare against is the
        // one this app shipped with.
        let appBuildId = bundleResourceURL.flatMap {
            BuildInfo.readBuildId(
                fromDirectory: $0.appendingPathComponent("agent-voice", isDirectory: true)
            )
        }
        if let override = env["AGENT_VOICE_EXECUTABLE"], !override.isEmpty {
            return AppSettings(
                executableURL: URL(fileURLWithPath: override),
                agentVoiceHome: home,
                appBuildId: appBuildId
            )
        }
        if let bundled = bundleResourceURL?.appendingPathComponent("agent-voice/bin/agent-voice"),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return AppSettings(executableURL: bundled, agentVoiceHome: home, appBuildId: appBuildId)
        }
        return AppSettings(
            executableURL: currentDirectory.appendingPathComponent("bin/agent-voice"),
            agentVoiceHome: home,
            appBuildId: appBuildId
        )
    }
}
