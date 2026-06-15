public struct AgentVoiceHistorySnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let jobs: [AgentVoiceHistoryJob]

    public init(version: Int, jobs: [AgentVoiceHistoryJob]) {
        self.version = version
        self.jobs = jobs
    }
}

public struct AgentVoiceHistoryJob: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let agent: String
    public let status: HistoryJobStatus
    public let text: String
    public let cwd: String?
    public let createdAt: String
    public let finishedAt: String?
    public let summary: String?
    public let summarizerUsed: String?
    public let skipReason: String?
    public let lastError: String?
    public let attempts: Int

    public init(
        id: String,
        agent: String,
        status: HistoryJobStatus,
        text: String,
        cwd: String?,
        createdAt: String,
        finishedAt: String?,
        summary: String?,
        summarizerUsed: String?,
        skipReason: String?,
        lastError: String?,
        attempts: Int
    ) {
        self.id = id
        self.agent = agent
        self.status = status
        self.text = text
        self.cwd = cwd
        self.createdAt = createdAt
        self.finishedAt = finishedAt
        self.summary = summary
        self.summarizerUsed = summarizerUsed
        self.skipReason = skipReason
        self.lastError = lastError
        self.attempts = attempts
    }
}

public enum HistoryJobStatus: String, Codable, Equatable, Sendable {
    case done
    case failed
    case skipped
}
