import Foundation

public struct KokoroSetupEvent: Codable, Equatable, Sendable {
    public enum EventType: String, Codable, Sendable {
        case step
        case log
        case complete
    }

    public let type: EventType
    public let id: String?
    public let status: String?
    public let title: String?
    public let stream: String?
    public let message: String?
    public let ok: Bool?
    public let error: String?

    public init(
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
        .init(id: "config", title: "Save Agent Voice config"),
        .init(id: "smoke-test", title: "Verify Kokoro")
    ]
}

public struct KokoroSetupSnapshot: Equatable, Sendable {
    public var phase: KokoroSetupPhase
    public var currentStepID: String?
    public var currentTitle: String?
    public var completedStepIDs: [String]
    public var skippedStepIDs: [String]
    public var failedStepID: String?
    public var logs: [String]
    public var error: String?

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
        self.phase = phase
        self.currentStepID = currentStepID
        self.currentTitle = currentTitle
        self.completedStepIDs = completedStepIDs
        self.skippedStepIDs = skippedStepIDs
        self.failedStepID = failedStepID
        self.logs = logs
        self.error = error
    }
}
