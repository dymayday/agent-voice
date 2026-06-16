public struct ConfigSummary: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let agents: [String: AgentSummary]

    public init(enabled: Bool, agents: [String: AgentSummary]) {
        self.enabled = enabled
        self.agents = agents
    }
}

public struct AgentSummary: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let mode: String

    public init(enabled: Bool, mode: String) {
        self.enabled = enabled
        self.mode = mode
    }
}

public struct AgentVoiceFullConfig: Codable, Equatable, Sendable {
    public let tts: TTSConfig

    public init(tts: TTSConfig) {
        self.tts = tts
    }
}

public struct TTSConfig: Codable, Equatable, Sendable {
    public let kokoroScript: String
    public let python: String
    public let voice: String
    public let timeoutSeconds: Int

    public init(kokoroScript: String, python: String, voice: String, timeoutSeconds: Int) {
        self.kokoroScript = kokoroScript
        self.python = python
        self.voice = voice
        self.timeoutSeconds = timeoutSeconds
    }
}
