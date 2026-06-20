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
    public let piModel: String
    public let codexModel: String
    public let opencodeModel: String?
    public let priority: [String]
    public let promptStyle: String
    public let maxSentences: Int
    public let maxSummaryChars: Int
    public let speakQuestionsVerbatim: Bool

    public init(
        thinking: String = "off",
        piModel: String = "openai-codex/gpt-5.5",
        codexModel: String = "gpt-5.3-codex",
        opencodeModel: String? = nil,
        priority: [String] = ["pi-fast", "codex-fast", "heuristic"],
        promptStyle: String = "default",
        maxSentences: Int = 1,
        maxSummaryChars: Int = 180,
        speakQuestionsVerbatim: Bool = false
    ) {
        self.thinking = thinking
        self.piModel = piModel
        self.codexModel = codexModel
        self.opencodeModel = opencodeModel
        self.priority = priority
        self.promptStyle = promptStyle
        self.maxSentences = maxSentences
        self.maxSummaryChars = maxSummaryChars
        self.speakQuestionsVerbatim = speakQuestionsVerbatim
    }

    private enum CodingKeys: String, CodingKey {
        case thinking
        case piModel = "piModel"
        case codexModel = "codexModel"
        case opencodeModel = "opencodeModel"
        case priority
        case promptStyle
        case maxSentences
        case maxSummaryChars
        case speakQuestionsVerbatim
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        thinking = try container.decodeIfPresent(String.self, forKey: .thinking) ?? "off"
        piModel = try container.decodeIfPresent(String.self, forKey: .piModel) ?? "openai-codex/gpt-5.5"
        codexModel = try container.decodeIfPresent(String.self, forKey: .codexModel) ?? "gpt-5.3-codex"
        opencodeModel = try container.decodeIfPresent(String.self, forKey: .opencodeModel)
        priority = try container.decodeIfPresent([String].self, forKey: .priority)
            ?? ["pi-fast", "codex-fast", "heuristic"]
        promptStyle = try container.decodeIfPresent(String.self, forKey: .promptStyle) ?? "default"
        maxSentences = try container.decodeIfPresent(Int.self, forKey: .maxSentences) ?? 1
        maxSummaryChars = try container.decodeIfPresent(Int.self, forKey: .maxSummaryChars) ?? 180
        speakQuestionsVerbatim = try container.decodeIfPresent(Bool.self, forKey: .speakQuestionsVerbatim) ?? false
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
