# Graph Report - .  (2026-06-20)

## Corpus Check
- 13 files · ~672,025 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1391 nodes · 2752 edges · 88 communities (68 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 64 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Swift CLI Wrapper|Swift CLI Wrapper]]
- [[_COMMUNITY_CLI Commands & Path Safety|CLI Commands & Path Safety]]
- [[_COMMUNITY_CLI Process Runner Tests|CLI Process Runner Tests]]
- [[_COMMUNITY_Config Coding Keys|Config Coding Keys]]
- [[_COMMUNITY_Diagnostic Snapshot Models|Diagnostic Snapshot Models]]
- [[_COMMUNITY_Kokoro TTS Session|Kokoro TTS Session]]
- [[_COMMUNITY_Dock Menu Controller|Dock Menu Controller]]
- [[_COMMUNITY_Database & Schema|Database & Schema]]
- [[_COMMUNITY_Kokoro Setup Progress UI|Kokoro Setup Progress UI]]
- [[_COMMUNITY_Kokoro Setup Model Tests|Kokoro Setup Model Tests]]
- [[_COMMUNITY_TS Config Validation|TS Config Validation]]
- [[_COMMUNITY_Summarizer Prompt Building|Summarizer Prompt Building]]
- [[_COMMUNITY_Job Processor & Store|Job Processor & Store]]
- [[_COMMUNITY_Menu Bar Sentinel View|Menu Bar Sentinel View]]
- [[_COMMUNITY_Swift Config Models|Swift Config Models]]
- [[_COMMUNITY_AppModel Kokoro Actions|AppModel Kokoro Actions]]
- [[_COMMUNITY_Kokoro Setup Events|Kokoro Setup Events]]
- [[_COMMUNITY_Attention Detail View|Attention Detail View]]
- [[_COMMUNITY_Summarizer Config Keys|Summarizer Config Keys]]
- [[_COMMUNITY_CLI Snapshot Tests|CLI Snapshot Tests]]
- [[_COMMUNITY_CLI Entry & Hook Parsing|CLI Entry & Hook Parsing]]
- [[_COMMUNITY_App Source Tests|App Source Tests]]
- [[_COMMUNITY_Summarizer Action Tests|Summarizer Action Tests]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_Queue & Retry Logic|Queue & Retry Logic]]
- [[_COMMUNITY_Swift History Models|Swift History Models]]
- [[_COMMUNITY_Kokoro Setup Models|Kokoro Setup Models]]
- [[_COMMUNITY_Kokoro Setup View Tests|Kokoro Setup View Tests]]
- [[_COMMUNITY_Dashboard View Helpers|Dashboard View Helpers]]
- [[_COMMUNITY_UI Source Test Helpers|UI Source Test Helpers]]
- [[_COMMUNITY_AppModel Diagnostics Actions|AppModel Diagnostics Actions]]
- [[_COMMUNITY_Doctor Report Models|Doctor Report Models]]
- [[_COMMUNITY_Kokoro Setup Contract Tests|Kokoro Setup Contract Tests]]
- [[_COMMUNITY_Claude Hook Extraction|Claude Hook Extraction]]
- [[_COMMUNITY_AppModel Queue Actions|AppModel Queue Actions]]
- [[_COMMUNITY_Kokoro Python Service|Kokoro Python Service]]
- [[_COMMUNITY_History View|History View]]
- [[_COMMUNITY_AppModel Core|AppModel Core]]
- [[_COMMUNITY_History Snapshot (TS)|History Snapshot (TS)]]
- [[_COMMUNITY_Dashboard Agent Controls|Dashboard Agent Controls]]
- [[_COMMUNITY_History Status Filter|History Status Filter]]
- [[_COMMUNITY_Setup Assistant View|Setup Assistant View]]
- [[_COMMUNITY_Setup Assistant Tests|Setup Assistant Tests]]
- [[_COMMUNITY_Daemon Processor Tests|Daemon Processor Tests]]
- [[_COMMUNITY_UI State Enums|UI State Enums]]
- [[_COMMUNITY_AppModel Action Tests|AppModel Action Tests]]
- [[_COMMUNITY_Clear Failed Jobs Tests|Clear Failed Jobs Tests]]
- [[_COMMUNITY_Summarizer Knobs Tests|Summarizer Knobs Tests]]
- [[_COMMUNITY_Dashboard View Tests|Dashboard View Tests]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_App Entry & Windows|App Entry & Windows]]
- [[_COMMUNITY_Menu Bar Smart Actions|Menu Bar Smart Actions]]
- [[_COMMUNITY_Setup Assistant Model|Setup Assistant Model]]
- [[_COMMUNITY_Dock Menu Tests|Dock Menu Tests]]
- [[_COMMUNITY_Summarizer Config Decode Tests|Summarizer Config Decode Tests]]
- [[_COMMUNITY_AppModel Daemon Refresh|AppModel Daemon Refresh]]
- [[_COMMUNITY_Settings Action Tests|Settings Action Tests]]
- [[_COMMUNITY_Bun Locator Script|Bun Locator Script]]
- [[_COMMUNITY_History Pagination|History Pagination]]
- [[_COMMUNITY_Setup Step Enum|Setup Step Enum]]
- [[_COMMUNITY_Draft Preservation Tests|Draft Preservation Tests]]
- [[_COMMUNITY_History Focus Tests|History Focus Tests]]
- [[_COMMUNITY_History View Tests|History View Tests]]
- [[_COMMUNITY_Event Validation|Event Validation]]
- [[_COMMUNITY_Auto-Refresh Loop Control|Auto-Refresh Loop Control]]
- [[_COMMUNITY_Summary Voice Refresh|Summary Voice Refresh]]
- [[_COMMUNITY_Dashboard Warnings|Dashboard Warnings]]
- [[_COMMUNITY_Attention Detail Tests|Attention Detail Tests]]
- [[_COMMUNITY_Executable Path Resolution|Executable Path Resolution]]
- [[_COMMUNITY_Dashboard View Shell|Dashboard View Shell]]
- [[_COMMUNITY_Kokoro Event Application|Kokoro Event Application]]
- [[_COMMUNITY_Setup Actions|Setup Actions]]
- [[_COMMUNITY_Daemon Signal Waiter|Daemon Signal Waiter]]
- [[_COMMUNITY_Bin Shim Tests|Bin Shim Tests]]
- [[_COMMUNITY_Kokoro Resources Tests|Kokoro Resources Tests]]
- [[_COMMUNITY_Attention Detail Shell|Attention Detail Shell]]
- [[_COMMUNITY_Summarizer Mode|Summarizer Mode]]
- [[_COMMUNITY_macOS Icon Script|macOS Icon Script]]
- [[_COMMUNITY_Swift Package Manifest|Swift Package Manifest]]
- [[_COMMUNITY_Voice Orb Icon|Voice Orb Icon]]
- [[_COMMUNITY_Voice Orb Icon (alt)|Voice Orb Icon (alt)]]
- [[_COMMUNITY_Hearth Lens Icon|Hearth Lens Icon]]
- [[_COMMUNITY_Kokoro Requirements|Kokoro Requirements]]
- [[_COMMUNITY_Clean Orb Icon|Clean Orb Icon]]
- [[_COMMUNITY_Orb Heart Core Icon|Orb Heart Core Icon]]
- [[_COMMUNITY_Quiet Beacon Icon|Quiet Beacon Icon]]
- [[_COMMUNITY_Kokoro Protocol|Kokoro Protocol]]

## God Nodes (most connected - your core abstractions)
1. `AppModel` - 81 edges
2. `CodingKeys` - 43 edges
3. `AgentVoiceCLI` - 41 edges
4. `RecordingRunner` - 30 edges
5. `String` - 28 edges
6. `AgentVoiceCLITests` - 28 edges
7. `AgentVoiceDockMenuDelegate` - 25 edges
8. `MenuBarSentinelView` - 21 edges
9. `runCli()` - 21 edges
10. `Data` - 20 edges

## Surprising Connections (you probably didn't know these)
- `counts()` --calls--> `countByStatus()`  [EXTRACTED]
  tests/daemon.test.ts → src/store.ts
- `pendingCount()` --calls--> `openDb()`  [EXTRACTED]
  tests/enqueue-cli.test.ts → src/db.ts
- `pendingJobs()` --calls--> `openDb()`  [EXTRACTED]
  tests/enqueue-cli.test.ts → src/db.ts
- `withDb()` --calls--> `openDb()`  [EXTRACTED]
  tests/processor.test.ts → src/db.ts
- `pendingCount()` --calls--> `resolvePaths()`  [EXTRACTED]
  tests/enqueue-cli.test.ts → src/paths.ts

## Import Cycles
- None detected.

## Communities (88 total, 20 thin omitted)

### Community 0 - "Swift CLI Wrapper"
Cohesion: 0.05
Nodes (38): AgentVoiceCLI, AgentVoiceCLIError, PipeReader, ProcessRequest, ProcessResult, ProcessRunning, ProcessStream, ProcessStreaming (+30 more)

### Community 1 - "CLI Commands & Path Safety"
Cohesion: 0.05
Nodes (78): commandDescription(), emitLogs(), KokoroCommandDeps, KokoroLogEmitter, runChecked(), assertExistingPathSafe(), assertManagedChild(), assertManagedRoot() (+70 more)

### Community 2 - "CLI Process Runner Tests"
Cohesion: 0.09
Nodes (18): FoundationProcessRunner, AgentVoiceCLITests, RecordingRunner, RecordingStreamingRunner, RecordingStreamState, ResultBox, AgentVoiceCore, AsyncThrowingStream (+10 more)

### Community 3 - "Config Coding Keys"
Cohesion: 0.04
Nodes (43): CodingKeys, action, agent, agents, agentVoiceHome, attempts, attention, config (+35 more)

### Community 4 - "Diagnostic Snapshot Models"
Cohesion: 0.08
Nodes (31): AgentVoiceDiagnosticSnapshot, Daemon, DiagnosticConfig, DiagnosticDoctorCheck, DiagnosticHistoryPageInfo, DiagnosticJob, Paths, Daemon (+23 more)

### Community 5 - "Kokoro TTS Session"
Cohesion: 0.08
Nodes (16): KokoroProtocolSession, messageToAudio(), audioDir(), BunKokoroSession, defaultPlaybackRunner(), KokoroClient, KokoroSession, KokoroSessionFactory (+8 more)

### Community 6 - "Dock Menu Controller"
Cohesion: 0.10
Nodes (19): AgentVoiceDockMenuDelegate, DockMenuWindowBridge, AgentVoiceCore, AppKit, AppModel, Bool, Never, String (+11 more)

### Community 7 - "Database & Schema"
Cohesion: 0.13
Nodes (15): AgentVoiceDb, getSchemaVersion(), hasColumn(), migrateSchema(), openDb(), createEvent(), resolvePaths(), countByStatus() (+7 more)

### Community 8 - "Kokoro Setup Progress UI"
Cohesion: 0.09
Nodes (17): KokoroSetupProgressView, FoundationStreamingProcessRunner, AgentVoiceCLIStreamingTests, Double, KokoroSetupStepDefinition, AgentVoiceCore, AppKit, AppModel (+9 more)

### Community 9 - "Kokoro Setup Model Tests"
Cohesion: 0.14
Nodes (10): AppModelKokoroSetupTests, ThrowingProcessRunner, AgentVoiceCore, Error, Int, ProcessRequest, ProcessResult, RecordingStreamingRunner (+2 more)

### Community 10 - "TS Config Validation"
Cohesion: 0.16
Nodes (25): AGENT_NAMES, AgentName, assertBoolean(), assertIntegerInRange(), assertOneOf(), assertSafePath(), assertString(), cloneConfig() (+17 more)

### Community 11 - "Summarizer Prompt Building"
Cohesion: 0.14
Nodes (23): AgentVoiceConfig, SummarizerPromptStyle, baseRequest(), buildPrompt(), cleanForSpeech(), describeFailure(), envWithoutUndefined(), firstNSentences() (+15 more)

### Community 12 - "Job Processor & Store"
Cohesion: 0.16
Nodes (24): errorMessage(), fallbackSummarizerLabel(), processNextJob(), ProcessNextJobResult, claimNextDue(), clearActiveQueue(), clearFailedJobs(), clearQueueByStatus() (+16 more)

### Community 13 - "Menu Bar Sentinel View"
Cohesion: 0.13
Nodes (13): MenuBarSentinelView, ButtonRole, AgentVoiceHistoryJob, AppModel, Bool, Color, Content, DoctorCheck (+5 more)

### Community 14 - "Swift Config Models"
Cohesion: 0.21
Nodes (16): AgentSummary, AgentSummary, AgentVoiceFullConfig, ConfigSummary, SummarizerConfig, TTSConfig, Decoder, Equatable (+8 more)

### Community 15 - "AppModel Kokoro Actions"
Cohesion: 0.13
Nodes (12): AgentVoiceCLI, AppModel, AgentVoiceFullConfig, DoctorReport, AgentVoiceFullConfig, DoctorReport, Never, SetupStep (+4 more)

### Community 16 - "Kokoro Setup Events"
Cohesion: 0.13
Nodes (18): CodingKeys, error, id, message, ok, status, stream, title (+10 more)

### Community 17 - "Attention Detail View"
Cohesion: 0.20
Nodes (10): AttentionDetailView, text, AgentVoiceHistoryJob, AppModel, Color, Content, DoctorCheck, HistoryJobStatus (+2 more)

### Community 18 - "Summarizer Config Keys"
Cohesion: 0.10
Nodes (20): CodingKeys, codexModel, maxSentences, maxSummaryChars, opencodeModel, piModel, priority, promptStyle (+12 more)

### Community 19 - "CLI Snapshot Tests"
Cohesion: 0.21
Nodes (8): AgentVoiceCLISnapshotTests, AgentVoiceCLI, AgentVoiceCore, Bool, Int, RecordingRunner, URL, XCTest

### Community 20 - "CLI Entry & Hook Parsing"
Cohesion: 0.20
Nodes (19): availableSummarizerModels(), ClaudeHookPayloadContext, CliIo, CliResult, createClaudeHookEvent(), defaultProcessorDeps(), defaultProcessorDepsFactory(), getOption() (+11 more)

### Community 21 - "App Source Tests"
Cohesion: 0.15
Nodes (3): AgentVoiceAppSourceTests, sourceSlice(), XCTest

### Community 22 - "Summarizer Action Tests"
Cohesion: 0.11
Nodes (7): AppModelSummarizerActionTests, SetupAssistantViewSourceTests, SummarizerPromptStyleCatalogTests, XCTest, AgentVoiceCore, XCTest, XCTestCase

### Community 23 - "Package Manifest"
Cohesion: 0.11
Nodes (17): bin, agent-voice, voice-codex, voice-opencode, devDependencies, bun-types, @types/node, typescript (+9 more)

### Community 24 - "Queue & Retry Logic"
Cohesion: 0.18
Nodes (15): AgentVoiceEvent, isDue(), markAttempt(), matchesPattern(), matchesSegment(), matchesSegments(), QueueJob, RetryDecision (+7 more)

### Community 25 - "Swift History Models"
Cohesion: 0.21
Nodes (13): AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo, AgentVoiceHistorySnapshot, HistoryJobStatus, done, failed, skipped, AgentVoiceHistoryJob (+5 more)

### Community 26 - "Kokoro Setup Models"
Cohesion: 0.22
Nodes (11): KokoroSetupPhase, cancelled, failed, idle, running, succeeded, KokoroSetupSnapshot, KokoroSetupStepDefinition (+3 more)

### Community 27 - "Kokoro Setup View Tests"
Cohesion: 0.21
Nodes (3): KokoroSetupProgressViewSourceTests, String, XCTest

### Community 28 - "Dashboard View Helpers"
Cohesion: 0.21
Nodes (11): DashboardView, Content, DoctorCheck, AgentVoiceHistoryJob, Bool, Color, Content, DoctorCheck (+3 more)

### Community 29 - "UI Source Test Helpers"
Cohesion: 0.22
Nodes (11): appSource(), appSources(), attentionBody(), dashboardBody(), dashboardViewSource(), offset(), offsets(), propertyBody() (+3 more)

### Community 30 - "AppModel Diagnostics Actions"
Cohesion: 0.17
Nodes (7): SummarizerModelRestoreError, CustomStringConvertible, Error, Error, SummarizerConfig, SummarizerConfig, SummarizerModelBinding

### Community 31 - "Doctor Report Models"
Cohesion: 0.21
Nodes (12): DoctorCheck, DoctorReport, Severity, error, info, warning, Codable, Bool (+4 more)

### Community 32 - "Kokoro Setup Contract Tests"
Cohesion: 0.16
Nodes (4): KokoroSetupModelTests, AgentVoiceCore, String, XCTest

### Community 33 - "Claude Hook Extraction"
Cohesion: 0.25
Nodes (11): ClaudeExtractionResult, ClaudeQuestionResult, extractClaudeQuestion(), extractClaudeStopHook(), findText(), findTextValue(), formatOptionList(), isRecord() (+3 more)

### Community 35 - "Kokoro Python Service"
Cohesion: 0.29
Nodes (13): Any, audio_chunk_to_array(), audio_to_base64_wav(), error_message(), load_pipeline(), main(), parse_request(), Write a single JSON object to stdout. (+5 more)

### Community 36 - "History View"
Cohesion: 0.23
Nodes (8): HistoryView, AgentVoiceHistoryJob, AppModel, Color, Never, Task, Void, ScrollViewProxy

### Community 37 - "AppModel Core"
Cohesion: 0.18
Nodes (6): SummarizerModelBinding, SummarizerPromptStyleInfo, Combine, Foundation, Foundation, String

### Community 38 - "History Snapshot (TS)"
Cohesion: 0.19
Nodes (11): AppHistoryJob, AppHistoryPageInfo, AppHistorySnapshot, buildHistorySnapshot(), decodeHistoryCursor(), emptyHistorySnapshot(), encodeHistoryCursor(), formatHistoryJson() (+3 more)

### Community 39 - "Dashboard Agent Controls"
Cohesion: 0.27
Nodes (5): DashboardView, InstallState, AppModel, String, View

### Community 40 - "History Status Filter"
Cohesion: 0.17
Nodes (10): HistoryStatusFilter, all, done, failed, skipped, CaseIterable, HistoryJobStatus, AgentVoiceCore (+2 more)

### Community 41 - "Setup Assistant View"
Cohesion: 0.18
Nodes (10): AgentSetupSummary, SetupAssistantView, Identifiable, AgentVoiceCore, AppKit, AppModel, Bool, SetupStep (+2 more)

### Community 42 - "Setup Assistant Tests"
Cohesion: 0.17
Nodes (5): SetupAssistantModelTests, QueueCounts, AgentVoiceCore, XCTest, QueueCounts

### Community 43 - "Daemon Processor Tests"
Cohesion: 0.17
Nodes (6): SummarizerName, ProcessorDeps, SummarizeOptions, SummarizeOutcome, ConfigOverrides, JobRecord

### Community 44 - "UI State Enums"
Cohesion: 0.18
Nodes (10): AgentVoiceUIState, daemonStopped, needsAttention, paused, processing, ready, DaemonRunState, running (+2 more)

### Community 45 - "AppModel Action Tests"
Cohesion: 0.18
Nodes (3): AppModelActionTests, AgentVoiceCore, XCTest

### Community 46 - "Clear Failed Jobs Tests"
Cohesion: 0.27
Nodes (9): AppModelClearFailedJobsTests, clearFailedHistoryJobJSON(), clearFailedHistoryPageJSON(), clearFailedStatusJSON(), AgentVoiceCore, Bool, Int, String (+1 more)

### Community 47 - "Summarizer Knobs Tests"
Cohesion: 0.18
Nodes (3): AppModelSummarizerKnobsTests, AgentVoiceCore, XCTest

### Community 49 - "TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 50 - "App Entry & Windows"
Cohesion: 0.22
Nodes (8): AgentVoiceApplication, AgentVoiceWindowID, StatusBarIconLabel, App, AgentVoiceCore, AppModel, SwiftUI, Scene

### Community 51 - "Menu Bar Smart Actions"
Cohesion: 0.20
Nodes (9): SmartActionMenuMode, daemonStopped, daily, needsAttention, unavailable, String, AgentVoiceCore, AppKit (+1 more)

### Community 52 - "Setup Assistant Model"
Cohesion: 0.29
Nodes (6): SetupAssistantModel, SetupCheck, AgentVoiceStatusSnapshot, Bool, DoctorCheck, DoctorReport

### Community 54 - "Summarizer Config Decode Tests"
Cohesion: 0.27
Nodes (5): SummarizerConfigDecodingTests, AgentVoiceCore, AgentVoiceFullConfig, String, XCTest

### Community 55 - "AppModel Daemon Refresh"
Cohesion: 0.36
Nodes (3): TerminalQueueCounts, AgentVoiceStatusSnapshot, AgentVoiceStatusSnapshot

### Community 57 - "Bun Locator Script"
Cohesion: 0.39
Nodes (6): _agent_voice_cache_bun(), _agent_voice_use_bun(), _agent_voice_use_bun_path_file(), _agent_voice_use_cached_bun(), find_agent_voice_bun(), find-bun.sh script

### Community 58 - "History Pagination"
Cohesion: 0.32
Nodes (4): AgentVoiceHistoryJob, AgentVoiceHistorySnapshot, AgentVoiceHistoryJob, AgentVoiceHistorySnapshot

### Community 59 - "Setup Step Enum"
Cohesion: 0.25
Nodes (8): SetupStep, agents, daemon, finish, kokoro, summaries, summaryVoice, welcome

### Community 60 - "Draft Preservation Tests"
Cohesion: 0.36
Nodes (6): AppModelDraftPreservationTests, draftFullConfigJSON(), draftStatusJSON(), AgentVoiceCore, String, XCTest

### Community 61 - "History Focus Tests"
Cohesion: 0.32
Nodes (4): AppModelHistoryFocusTests, AgentVoiceCore, AppModel, XCTest

### Community 63 - "Event Validation"
Cohesion: 0.36
Nodes (6): AgentVoiceEventName, hasUnsafeKey(), isRecord(), UNSAFE_KEYS, validateEvent(), ValidationResult

### Community 66 - "Dashboard Warnings"
Cohesion: 0.33
Nodes (4): AppModel, Bool, Foundation, String

### Community 67 - "Attention Detail Tests"
Cohesion: 0.33
Nodes (3): AttentionDetailViewSourceTests, functionBody(), XCTest

### Community 68 - "Executable Path Resolution"
Cohesion: 0.47
Nodes (4): ExecutablePathInput, ExecutablePaths, realpathOrResolved(), resolveExecutablePaths()

### Community 69 - "Dashboard View Shell"
Cohesion: 0.40
Nodes (4): AppKit, AgentVoiceCore, AppKit, SwiftUI

### Community 71 - "Setup Actions"
Cohesion: 0.40
Nodes (4): SetupAction, disableAgent, enableAgent, summarizerMode

### Community 72 - "Daemon Signal Waiter"
Cohesion: 0.60
Nodes (3): createSignalWorkWaiter(), SignalWorkWaiter, WorkWaiter

### Community 75 - "Attention Detail Shell"
Cohesion: 0.50
Nodes (3): AgentVoiceCore, AppKit, SwiftUI

### Community 76 - "Summarizer Mode"
Cohesion: 0.50
Nodes (3): isSummarizerMode(), setSummarizerMode(), SummarizerMode

## Knowledge Gaps
- **351 isolated node(s):** `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore`, `SwiftUI`, `AgentVoiceWindowID` (+346 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CodingKeys` connect `Config Coding Keys` to `Attention Detail View`, `Summarizer Config Keys`, `Diagnostic Snapshot Models`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Why does `AppModel` connect `AppModel Kokoro Actions` to `Auto-Refresh Loop Control`, `Summary Voice Refresh`, `AppModel Queue Actions`, `AppModel Core`, `Kokoro Event Application`, `AppModel Daemon Refresh`, `History Pagination`, `AppModel Diagnostics Actions`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `SummarizerPromptStyleInfo` connect `AppModel Core` to `Swift CLI Wrapper`, `Setup Assistant View`, `Swift Config Models`, `AppModel Kokoro Actions`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **What connects `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore` to the rest of the system?**
  _354 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Swift CLI Wrapper` be split into smaller, more focused modules?**
  _Cohesion score 0.05283505154639175 - nodes in this community are weakly interconnected._
- **Should `CLI Commands & Path Safety` be split into smaller, more focused modules?**
  _Cohesion score 0.05326460481099656 - nodes in this community are weakly interconnected._
- **Should `CLI Process Runner Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.09376890502117362 - nodes in this community are weakly interconnected._