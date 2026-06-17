import Foundation

public struct KokoroSetupEvent: Codable, Equatable, Sendable {
    public enum EventType: String, Codable, Sendable {
        case step
        case log
        case complete
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case id
        case status
        case title
        case stream
        case message
        case ok
        case error
    }

    private static let allowedStepStatuses: Set<String> = [
        "pending",
        "running",
        "done",
        "failed",
        "skipped"
    ]
    private static let allowedLogStreams: Set<String> = ["stdout", "stderr"]
    private static let allowedStepIDs = Set(KokoroSetupSteps.all.map(\.id))

    public let type: EventType
    public let id: String?
    public let status: String?
    public let title: String?
    public let stream: String?
    public let message: String?
    public let ok: Bool?
    public let error: String?

    init(
        type: EventType,
        id: String? = nil,
        status: String? = nil,
        title: String? = nil,
        stream: String? = nil,
        message: String? = nil,
        ok: Bool? = nil,
        error: String? = nil
    ) {
        self.type = type
        self.id = id
        self.status = status
        self.title = title
        self.stream = stream
        self.message = message
        self.ok = ok
        self.error = error
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(EventType.self, forKey: .type)
        let id = try container.decodeIfPresent(String.self, forKey: .id)
        let status = try container.decodeIfPresent(String.self, forKey: .status)
        let title = try container.decodeIfPresent(String.self, forKey: .title)
        let stream = try container.decodeIfPresent(String.self, forKey: .stream)
        let message = try container.decodeIfPresent(String.self, forKey: .message)
        let ok = try container.decodeIfPresent(Bool.self, forKey: .ok)
        let error = try container.decodeIfPresent(String.self, forKey: .error)

        switch type {
        case .step:
            try Self.validateStep(id: id, status: status, title: title, container: container)
        case .log:
            try Self.validateLog(stream: stream, message: message, container: container)
        case .complete:
            try Self.validateComplete(ok: ok, container: container)
        }

        self.init(
            type: type,
            id: id,
            status: status,
            title: title,
            stream: stream,
            message: message,
            ok: ok,
            error: error
        )
    }

    private static func validateStep(
        id: String?,
        status: String?,
        title: String?,
        container: KeyedDecodingContainer<CodingKeys>
    ) throws {
        guard let id, allowedStepIDs.contains(id) else {
            throw DecodingError.dataCorruptedError(
                forKey: .id,
                in: container,
                debugDescription: "Unknown Kokoro setup step id"
            )
        }
        guard let status, allowedStepStatuses.contains(status) else {
            throw DecodingError.dataCorruptedError(
                forKey: .status,
                in: container,
                debugDescription: "Unknown Kokoro setup step status"
            )
        }
        guard let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .title,
                in: container,
                debugDescription: "Kokoro setup step title is required"
            )
        }
    }

    private static func validateLog(
        stream: String?,
        message: String?,
        container: KeyedDecodingContainer<CodingKeys>
    ) throws {
        guard let stream, allowedLogStreams.contains(stream) else {
            throw DecodingError.dataCorruptedError(
                forKey: .stream,
                in: container,
                debugDescription: "Unknown Kokoro setup log stream"
            )
        }
        guard message != nil else {
            throw DecodingError.dataCorruptedError(
                forKey: .message,
                in: container,
                debugDescription: "Kokoro setup log message is required"
            )
        }
    }

    private static func validateComplete(
        ok: Bool?,
        container: KeyedDecodingContainer<CodingKeys>
    ) throws {
        guard ok != nil else {
            throw DecodingError.dataCorruptedError(
                forKey: .ok,
                in: container,
                debugDescription: "Kokoro setup complete event requires ok"
            )
        }
    }
}

public enum KokoroSetupPhase: String, Equatable, Sendable {
    case idle
    case running
    case succeeded
    case failed
    case cancelled
}

public struct KokoroSetupStepDefinition: Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String

    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}

public enum KokoroSetupSteps {
    public static let all: [KokoroSetupStepDefinition] = [
        .init(id: "prepare", title: "Prepare install directory"),
        .init(id: "uv-check", title: "Check uv"),
        .init(id: "script", title: "Install service script"),
        .init(id: "venv", title: "Create Python environment"),
        .init(id: "deps", title: "Install Python dependencies"),
        .init(id: "model", title: "Download model assets"),
        .init(id: "smoke-test", title: "Verify Kokoro"),
        .init(id: "config", title: "Save Agent Voice config")
    ]
}

public struct KokoroSetupSnapshot: Equatable, Sendable {
    public internal(set) var phase: KokoroSetupPhase
    public internal(set) var currentStepID: String?
    public internal(set) var currentTitle: String?
    public internal(set) var completedStepIDs: [String]
    public internal(set) var skippedStepIDs: [String]
    public internal(set) var failedStepID: String?
    public internal(set) var logs: [String]
    public internal(set) var error: String?

    public init(
        phase: KokoroSetupPhase = .idle,
        currentStepID: String? = nil,
        currentTitle: String? = nil,
        completedStepIDs: [String] = [],
        skippedStepIDs: [String] = [],
        failedStepID: String? = nil,
        logs: [String] = [],
        error: String? = nil
    ) {
        let completedStepIDs = Self.validUniqueStepIDs(completedStepIDs)
        let skippedStepIDs = Self.validUniqueStepIDs(skippedStepIDs, excluding: Set(completedStepIDs))

        self.phase = phase
        self.currentStepID = Self.validStepID(currentStepID)
        self.currentTitle = currentTitle
        self.completedStepIDs = completedStepIDs
        self.skippedStepIDs = skippedStepIDs
        self.failedStepID = Self.validStepID(failedStepID)
        self.logs = logs
        self.error = error
    }

    private static let knownStepIDs = Set(KokoroSetupSteps.all.map(\.id))

    private static func validStepID(_ id: String?) -> String? {
        guard let id, knownStepIDs.contains(id) else { return nil }
        return id
    }

    private static func validUniqueStepIDs(_ ids: [String], excluding excludedIDs: Set<String> = []) -> [String] {
        var seen = Set<String>()
        return ids.filter { id in
            knownStepIDs.contains(id) &&
                !excludedIDs.contains(id) &&
                seen.insert(id).inserted
        }
    }
}
