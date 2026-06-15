import Foundation

public struct ProcessRequest: Equatable, Sendable {
    public let executableURL: URL
    public let arguments: [String]
    public let environment: [String: String]

    public init(executableURL: URL, arguments: [String], environment: [String: String]) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.environment = environment
    }
}

public struct ProcessResult: Equatable, Sendable {
    public let exitCode: Int32
    public let stdout: String
    public let stderr: String

    public init(exitCode: Int32, stdout: String, stderr: String) {
        self.exitCode = exitCode
        self.stdout = stdout
        self.stderr = stderr
    }
}

public protocol ProcessRunning: Sendable {
    func run(_ request: ProcessRequest) async throws -> ProcessResult
}

public struct AgentVoiceCLIError: Error, Equatable {
    public let exitCode: Int32
    public let stderr: String

    public init(exitCode: Int32, stderr: String) {
        self.exitCode = exitCode
        self.stderr = stderr
    }
}

public struct AgentVoiceCLI: Sendable {
    public let executableURL: URL
    public let agentVoiceHome: URL?
    public let baseEnvironment: [String: String]
    public let runner: any ProcessRunning

    public init(
        executableURL: URL,
        agentVoiceHome: URL? = nil,
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment,
        runner: any ProcessRunning = FoundationProcessRunner()
    ) {
        self.executableURL = executableURL
        self.agentVoiceHome = agentVoiceHome
        self.baseEnvironment = baseEnvironment
        self.runner = runner
    }

    public func status() async throws -> AgentVoiceStatusSnapshot {
        let result = try await run(["status", "--json"])
        return try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: Data(result.stdout.utf8))
    }

    public func doctor() async throws -> DoctorReport {
        let result = try await run(["doctor", "--json"])
        return try JSONDecoder().decode(DoctorReport.self, from: Data(result.stdout.utf8))
    }

    public func history(limit: Int = 50) async throws -> AgentVoiceHistorySnapshot {
        let result = try await run(["history", "--json", "--limit", String(limit)])
        return try JSONDecoder().decode(AgentVoiceHistorySnapshot.self, from: Data(result.stdout.utf8))
    }

    public func pause() async throws {
        _ = try await run(["pause"])
    }

    public func resume() async throws {
        _ = try await run(["resume"])
    }

    public func startDaemon() async throws {
        _ = try await run(["start"])
    }

    public func stopDaemon() async throws {
        _ = try await run(["stop"])
    }

    public func runVoiceTest(_ text: String) async throws {
        _ = try await run(["test", text])
    }

    public func setSummarizerMode(_ mode: String) async throws {
        _ = try await run(["summarizer", "mode", mode])
    }

    @discardableResult
    public func run(_ arguments: [String]) async throws -> ProcessResult {
        var environment = baseEnvironment
        environment["PATH"] = cliLookupPath(from: environment["PATH"])
        if let agentVoiceHome {
            environment["AGENT_VOICE_HOME"] = agentVoiceHome.path
        }
        let result = try await runner.run(
            ProcessRequest(executableURL: executableURL, arguments: arguments, environment: environment)
        )
        guard result.exitCode == 0 else {
            throw AgentVoiceCLIError(exitCode: result.exitCode, stderr: result.stderr)
        }
        return result
    }

    private func cliLookupPath(from existingPath: String?) -> String {
        let fallbackPath = "/usr/bin:/bin:/usr/sbin:/sbin"
        var pathParts = (existingPath?.isEmpty == false ? existingPath! : fallbackPath)
            .split(separator: ":")
            .map(String.init)
        for directory in ["/usr/local/bin", "/opt/homebrew/bin"] where !pathParts.contains(directory) {
            pathParts.insert(directory, at: 0)
        }
        return pathParts.joined(separator: ":")
    }
}

private actor PipeReader {
    private let handle: FileHandle

    init(handle: FileHandle) {
        self.handle = handle
    }

    func readToEnd() -> Data {
        handle.readDataToEndOfFile()
    }
}

public struct FoundationProcessRunner: ProcessRunning {
    public init() {}

    public func run(_ request: ProcessRequest) async throws -> ProcessResult {
        try await Task.detached {
            let process = Process()
            process.executableURL = request.executableURL
            process.arguments = request.arguments
            process.environment = request.environment

            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr

            let stdoutReader = PipeReader(handle: stdout.fileHandleForReading)
            let stderrReader = PipeReader(handle: stderr.fileHandleForReading)

            try process.run()
            async let stdoutData = stdoutReader.readToEnd()
            async let stderrData = stderrReader.readToEnd()
            process.waitUntilExit()

            let output = await (stdoutData, stderrData)
            return ProcessResult(
                exitCode: process.terminationStatus,
                stdout: String(data: output.0, encoding: .utf8) ?? "",
                stderr: String(data: output.1, encoding: .utf8) ?? ""
            )
        }.value
    }
}
