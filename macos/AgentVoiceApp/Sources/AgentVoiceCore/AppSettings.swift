import Foundation

public struct AppSettings: Equatable, Sendable {
    public var executableURL: URL
    public var agentVoiceHome: URL?

    public init(executableURL: URL, agentVoiceHome: URL? = nil) {
        self.executableURL = executableURL
        self.agentVoiceHome = agentVoiceHome
    }

    public static func defaultSettings(
        env: [String: String] = ProcessInfo.processInfo.environment,
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        currentDirectory: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    ) -> AppSettings {
        let home = env["AGENT_VOICE_HOME"].map { URL(fileURLWithPath: $0) }
        if let override = env["AGENT_VOICE_EXECUTABLE"], !override.isEmpty {
            return AppSettings(executableURL: URL(fileURLWithPath: override), agentVoiceHome: home)
        }
        if let bundled = bundleResourceURL?.appendingPathComponent("agent-voice/bin/agent-voice"),
           FileManager.default.isExecutableFile(atPath: bundled.path) {
            return AppSettings(executableURL: bundled, agentVoiceHome: home)
        }
        return AppSettings(
            executableURL: currentDirectory.appendingPathComponent("bin/agent-voice"),
            agentVoiceHome: home
        )
    }
}
