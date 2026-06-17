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

public protocol ProcessStreaming: Sendable {
    func stream(_ request: ProcessRequest) -> AsyncThrowingStream<String, Error>
    func cancelActiveStream()
}

public struct AgentVoiceCLIError: Error, Equatable {
    public let exitCode: Int32
    public let stderr: String

    public init(exitCode: Int32, stderr: String) {
        self.exitCode = exitCode
        self.stderr = stderr
    }
}

public struct SummarizerModelsResponse: Codable, Equatable, Sendable {
    public let providers: [String: [String]]
    public let models: [String]
}

public struct AgentVoiceCLI: Sendable {
    public let executableURL: URL
    public let agentVoiceHome: URL?
    public let baseEnvironment: [String: String]
    public let runner: any ProcessRunning
    public let streamingRunner: any ProcessStreaming

    public init(
        executableURL: URL,
        agentVoiceHome: URL? = nil,
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment,
        runner: any ProcessRunning = FoundationProcessRunner(),
        streamingRunner: any ProcessStreaming = FoundationStreamingProcessRunner()
    ) {
        self.executableURL = executableURL
        self.agentVoiceHome = agentVoiceHome
        self.baseEnvironment = baseEnvironment
        self.runner = runner
        self.streamingRunner = streamingRunner
    }

    public func status() async throws -> AgentVoiceStatusSnapshot {
        let result = try await run(["status", "--json"])
        return try JSONDecoder().decode(AgentVoiceStatusSnapshot.self, from: Data(result.stdout.utf8))
    }

    public func doctor() async throws -> DoctorReport {
        let result = try await run(["doctor", "--json"])
        return try JSONDecoder().decode(DoctorReport.self, from: Data(result.stdout.utf8))
    }

    public func history(limit: Int = 50, before cursor: String? = nil) async throws -> AgentVoiceHistorySnapshot {
        var arguments = ["history", "--json", "--limit", String(limit)]
        if let cursor {
            arguments.append(contentsOf: ["--before", cursor])
        }
        let result = try await run(arguments)
        return try JSONDecoder().decode(AgentVoiceHistorySnapshot.self, from: Data(result.stdout.utf8))
    }

    public func config() async throws -> AgentVoiceFullConfig {
        let result = try await run(["config", "get"])
        return try JSONDecoder().decode(AgentVoiceFullConfig.self, from: Data(result.stdout.utf8))
    }

    public func summarizerModels() async throws -> SummarizerModelsResponse {
        let result = try await run(["models", "list"])
        return try JSONDecoder().decode(SummarizerModelsResponse.self, from: Data(result.stdout.utf8))
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

    public func setConfigValue(_ path: String, to value: String) async throws {
        _ = try await run(["config", "set", path, value])
    }

    public func setVoice(_ voice: String) async throws {
        try await setConfigValue("tts.voice", to: voice)
    }

    public func setSummarizerThinking(_ thinking: String) async throws {
        try await setConfigValue("summarizer.thinking", to: thinking)
    }

    public func setSummarizerModel(_ path: String, to model: String) async throws {
        try await setConfigValue(path, to: model)
    }

    public func clearQueue() async throws {
        _ = try await run(["queue", "clear"])
    }

    public func clearFailedJobs() async throws {
        _ = try await run(["queue", "clear", "--failed"])
    }

    public func installAgentHook(_ agent: String) async throws {
        _ = try await run(["install", "--agents", agent])
    }

    public func uninstallAgentHook(_ agent: String) async throws {
        _ = try await run(["uninstall", "--agents", agent])
    }

    public func streamKokoroSetupEvents() -> AsyncThrowingStream<KokoroSetupEvent, Error> {
        let request = makeRequest(["kokoro", "setup", "--jsonl"])
        let streamingRunner = self.streamingRunner

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let decoder = JSONDecoder()
                    for try await line in streamingRunner.stream(request) {
                        guard !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                            continue
                        }
                        let event = try decoder.decode(KokoroSetupEvent.self, from: Data(line.utf8))
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { @Sendable termination in
                task.cancel()
                if case .cancelled = termination {
                    streamingRunner.cancelActiveStream()
                }
            }
        }
    }

    public func cancelKokoroSetup() {
        streamingRunner.cancelActiveStream()
    }

    @discardableResult
    public func run(_ arguments: [String]) async throws -> ProcessResult {
        let result = try await runner.run(makeRequest(arguments))
        guard result.exitCode == 0 else {
            throw AgentVoiceCLIError(exitCode: result.exitCode, stderr: result.stderr)
        }
        return result
    }

    private func makeRequest(_ arguments: [String]) -> ProcessRequest {
        var environment = baseEnvironment
        environment["PATH"] = cliLookupPath(from: environment["PATH"])
        if let agentVoiceHome {
            environment["AGENT_VOICE_HOME"] = agentVoiceHome.path
        }
        return ProcessRequest(executableURL: executableURL, arguments: arguments, environment: environment)
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
            // Hand the child an already-closed stdin (/dev/null) instead of
            // letting it inherit the app's. The CLI's entrypoint reads stdin to
            // EOF before doing anything, so an inherited stdin that never closes
            // (e.g. when the app is not launched with stdin = /dev/null) would
            // block it forever and hang status/history refreshes.
            process.standardInput = FileHandle.nullDevice

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


public final class FoundationStreamingProcessRunner: ProcessStreaming, @unchecked Sendable {
    private let lock = NSLock()
    private var activeProcess: Process?

    public init() {}

    public func stream(_ request: ProcessRequest) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task.detached {
                let process = Process()
                process.executableURL = request.executableURL
                process.arguments = request.arguments
                process.environment = request.environment

                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr
                process.standardInput = FileHandle.nullDevice

                self.setActiveProcess(process)
                defer { self.clearActiveProcess(process) }

                do {
                    try process.run()
                    let stderrReader = PipeReader(handle: stderr.fileHandleForReading)
                    async let stderrData = stderrReader.readToEnd()

                    try self.emitStdoutLines(from: stdout.fileHandleForReading, to: continuation)
                    process.waitUntilExit()

                    let stderrText = String(data: await stderrData, encoding: .utf8) ?? ""
                    if Task.isCancelled {
                        throw CancellationError()
                    }
                    guard process.terminationStatus == 0 else {
                        throw AgentVoiceCLIError(exitCode: process.terminationStatus, stderr: stderrText)
                    }
                    continuation.finish()
                } catch {
                    if process.isRunning {
                        process.terminate()
                    }
                    continuation.finish(throwing: error)
                }
            }

            continuation.onTermination = { @Sendable termination in
                task.cancel()
                if case .cancelled = termination {
                    self.cancelActiveStream()
                }
            }
        }
    }

    public func cancelActiveStream() {
        let process = currentActiveProcess()
        if process?.isRunning == true {
            process?.terminate()
        }
    }

    private func setActiveProcess(_ process: Process) {
        lock.lock()
        activeProcess = process
        lock.unlock()
    }

    private func clearActiveProcess(_ process: Process) {
        lock.lock()
        if activeProcess === process {
            activeProcess = nil
        }
        lock.unlock()
    }

    private func currentActiveProcess() -> Process? {
        lock.lock()
        let process = activeProcess
        lock.unlock()
        return process
    }

    private func emitStdoutLines(
        from handle: FileHandle,
        to continuation: AsyncThrowingStream<String, Error>.Continuation
    ) throws {
        var pending = ""

        while true {
            if Task.isCancelled {
                throw CancellationError()
            }

            let data = handle.availableData
            if data.isEmpty {
                break
            }

            guard let chunk = String(data: data, encoding: .utf8) else {
                continue
            }
            pending.append(chunk)

            while let newline = pending.firstIndex(of: "\n") {
                var line = String(pending[..<newline])
                if line.last == "\r" {
                    line.removeLast()
                }
                continuation.yield(line)
                pending.removeSubrange(...newline)
            }
        }

        if !pending.isEmpty {
            var line = pending
            if line.last == "\r" {
                line.removeLast()
            }
            continuation.yield(line)
        }
    }
}
