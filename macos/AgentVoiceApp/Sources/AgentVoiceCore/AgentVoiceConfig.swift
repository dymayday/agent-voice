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
    public let summarizer: SummarizerConfig

    public init(tts: TTSConfig, summarizer: SummarizerConfig = SummarizerConfig()) {
        self.tts = tts
        self.summarizer = summarizer
    }

    private enum CodingKeys: String, CodingKey {
        case tts
        case summarizer
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tts = try container.decode(TTSConfig.self, forKey: .tts)
        summarizer = try container.decodeIfPresent(SummarizerConfig.self, forKey: .summarizer) ?? SummarizerConfig()
    }
}

public struct SummarizerConfig: Codable, Equatable, Sendable {
    public let thinking: String

    public init(thinking: String = "off") {
        self.thinking = thinking
    }

    private enum CodingKeys: String, CodingKey {
        case thinking
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        thinking = try container.decodeIfPresent(String.self, forKey: .thinking) ?? "off"
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
