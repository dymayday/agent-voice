public struct AgentVoiceHistorySnapshot: Codable, Equatable, Sendable {
    public let version: Int
    public let jobs: [AgentVoiceHistoryJob]
    public let pageInfo: AgentVoiceHistoryPageInfo

    public init(
        version: Int,
        jobs: [AgentVoiceHistoryJob],
        pageInfo: AgentVoiceHistoryPageInfo? = nil
    ) {
        self.version = version
        self.jobs = jobs
        self.pageInfo = pageInfo ?? AgentVoiceHistoryPageInfo(limit: jobs.count, hasMore: false, nextCursor: nil)
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case jobs
        case pageInfo
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decode(Int.self, forKey: .version)
        let jobs = try container.decode([AgentVoiceHistoryJob].self, forKey: .jobs)
        let pageInfo = try container.decodeIfPresent(AgentVoiceHistoryPageInfo.self, forKey: .pageInfo)
        self.init(version: version, jobs: jobs, pageInfo: pageInfo)
    }
}

public struct AgentVoiceHistoryPageInfo: Codable, Equatable, Sendable {
    public let limit: Int
    public let hasMore: Bool
    public let nextCursor: String?

    public init(limit: Int, hasMore: Bool, nextCursor: String?) {
        self.limit = limit
        self.hasMore = hasMore
        self.nextCursor = nextCursor
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
