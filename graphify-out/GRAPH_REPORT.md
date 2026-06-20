# Graph Report - .  (2026-06-20)

## Corpus Check
- 19 files · ~670,709 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1334 nodes · 2661 edges · 74 communities (58 shown, 16 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Database & Events|Database & Events]]
- [[_COMMUNITY_Commands & Managed Paths|Commands & Managed Paths]]
- [[_COMMUNITY_App Model Core|App Model Core]]
- [[_COMMUNITY_CLI Process Runner Tests|CLI Process Runner Tests]]
- [[_COMMUNITY_Config Field Identifiers|Config Field Identifiers]]
- [[_COMMUNITY_Diagnostic Snapshot Models|Diagnostic Snapshot Models]]
- [[_COMMUNITY_Kokoro TTS Session|Kokoro TTS Session]]
- [[_COMMUNITY_Dock Menu Controller|Dock Menu Controller]]
- [[_COMMUNITY_CLI Command Methods|CLI Command Methods]]
- [[_COMMUNITY_Kokoro Setup Models|Kokoro Setup Models]]
- [[_COMMUNITY_Config Validation|Config Validation]]
- [[_COMMUNITY_Summarizers|Summarizers]]
- [[_COMMUNITY_Kokoro Setup AppModel Tests|Kokoro Setup AppModel Tests]]
- [[_COMMUNITY_Setup Assistant Model|Setup Assistant Model]]
- [[_COMMUNITY_Attention Detail View|Attention Detail View]]
- [[_COMMUNITY_Streaming Process Runner|Streaming Process Runner]]
- [[_COMMUNITY_CLI Entry & Processor|CLI Entry & Processor]]
- [[_COMMUNITY_Menu Bar Sentinel View|Menu Bar Sentinel View]]
- [[_COMMUNITY_Swift Config Models|Swift Config Models]]
- [[_COMMUNITY_Summarizer Config Keys|Summarizer Config Keys]]
- [[_COMMUNITY_CLI Snapshot Tests|CLI Snapshot Tests]]
- [[_COMMUNITY_UI & Daemon State|UI & Daemon State]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_History Models (Swift)|History Models (Swift)]]
- [[_COMMUNITY_App Source Tests|App Source Tests]]
- [[_COMMUNITY_Kokoro Setup Progress View Tests|Kokoro Setup Progress View Tests]]
- [[_COMMUNITY_CLI Process Types|CLI Process Types]]
- [[_COMMUNITY_Kokoro Setup Streaming|Kokoro Setup Streaming]]
- [[_COMMUNITY_Source Test Helpers|Source Test Helpers]]
- [[_COMMUNITY_Kokoro Setup Model Tests|Kokoro Setup Model Tests]]
- [[_COMMUNITY_Claude Hook Extraction|Claude Hook Extraction]]
- [[_COMMUNITY_Dashboard View Helpers|Dashboard View Helpers]]
- [[_COMMUNITY_Status Snapshot & History Tests|Status Snapshot & History Tests]]
- [[_COMMUNITY_Doctor Report Models|Doctor Report Models]]
- [[_COMMUNITY_AppModel Action Tests|AppModel Action Tests]]
- [[_COMMUNITY_Kokoro Python Service|Kokoro Python Service]]
- [[_COMMUNITY_Dashboard View (Swift)|Dashboard View (Swift)]]
- [[_COMMUNITY_History Snapshot (TS)|History Snapshot (TS)]]
- [[_COMMUNITY_Kokoro Setup Progress View|Kokoro Setup Progress View]]
- [[_COMMUNITY_Setup Assistant View|Setup Assistant View]]
- [[_COMMUNITY_Setup Assistant Model Tests|Setup Assistant Model Tests]]
- [[_COMMUNITY_Clear Failed Jobs Tests|Clear Failed Jobs Tests]]
- [[_COMMUNITY_Summarizer Knobs Tests|Summarizer Knobs Tests]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_App Entry & Scenes|App Entry & Scenes]]
- [[_COMMUNITY_Smart Action Menu Mode|Smart Action Menu Mode]]
- [[_COMMUNITY_Dashboard View Tests|Dashboard View Tests]]
- [[_COMMUNITY_Dock Menu Tests|Dock Menu Tests]]
- [[_COMMUNITY_Summarizer Config Decoding Tests|Summarizer Config Decoding Tests]]
- [[_COMMUNITY_Summarizer Model Validation Tests|Summarizer Model Validation Tests]]
- [[_COMMUNITY_Settings Save Tests|Settings Save Tests]]
- [[_COMMUNITY_Bun Locator Script|Bun Locator Script]]
- [[_COMMUNITY_Draft Preservation Tests|Draft Preservation Tests]]
- [[_COMMUNITY_AppModel Warnings|AppModel Warnings]]
- [[_COMMUNITY_Attention Detail View Tests|Attention Detail View Tests]]
- [[_COMMUNITY_Process Request Home|Process Request Home]]
- [[_COMMUNITY_Prompt Style Catalog Tests|Prompt Style Catalog Tests]]
- [[_COMMUNITY_Executable Path Resolution|Executable Path Resolution]]
- [[_COMMUNITY_Streaming Line Decoder|Streaming Line Decoder]]
- [[_COMMUNITY_Daemon Work Waiter|Daemon Work Waiter]]
- [[_COMMUNITY_Bin Shim Tests|Bin Shim Tests]]
- [[_COMMUNITY_Kokoro Resources Tests|Kokoro Resources Tests]]
- [[_COMMUNITY_Attention Detail View File|Attention Detail View File]]
- [[_COMMUNITY_macOS Icon Generator|macOS Icon Generator]]
- [[_COMMUNITY_Swift Package Manifest|Swift Package Manifest]]
- [[_COMMUNITY_Voice Orb Icon|Voice Orb Icon]]
- [[_COMMUNITY_Local Voice Orb Icon|Local Voice Orb Icon]]
- [[_COMMUNITY_Hearth Lens Icon|Hearth Lens Icon]]
- [[_COMMUNITY_Kokoro Requirements|Kokoro Requirements]]
- [[_COMMUNITY_Voice Orb Clean Icon|Voice Orb Clean Icon]]
- [[_COMMUNITY_Orb Heart Core Icon|Orb Heart Core Icon]]
- [[_COMMUNITY_Quiet Beacon Icon|Quiet Beacon Icon]]
- [[_COMMUNITY_Kokoro Protocol|Kokoro Protocol]]

## God Nodes (most connected - your core abstractions)
1. `AppModel` - 75 edges
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

## Communities (74 total, 16 thin omitted)

### Community 0 - "Database & Events"
Cohesion: 0.05
Nodes (64): AgentVoiceDb, getSchemaVersion(), hasColumn(), migrateSchema(), openDb(), AgentVoiceEvent, AgentVoiceEventName, createEvent() (+56 more)

### Community 1 - "Commands & Managed Paths"
Cohesion: 0.05
Nodes (78): commandDescription(), emitLogs(), KokoroCommandDeps, KokoroLogEmitter, runChecked(), assertExistingPathSafe(), assertManagedChild(), assertManagedRoot() (+70 more)

### Community 2 - "App Model Core"
Cohesion: 0.05
Nodes (28): AgentVoiceCLI, AppModel, SummarizerModelBinding, SummarizerModelRestoreError, SummarizerPromptStyleInfo, TerminalQueueCounts, AgentVoiceHistoryJob, Combine (+20 more)

### Community 3 - "CLI Process Runner Tests"
Cohesion: 0.09
Nodes (18): FoundationProcessRunner, AgentVoiceCLITests, RecordingRunner, RecordingStreamingRunner, RecordingStreamState, ResultBox, AgentVoiceCore, AsyncThrowingStream (+10 more)

### Community 4 - "Config Field Identifiers"
Cohesion: 0.04
Nodes (43): CodingKeys, action, agent, agents, agentVoiceHome, attempts, attention, config (+35 more)

### Community 5 - "Diagnostic Snapshot Models"
Cohesion: 0.08
Nodes (31): AgentVoiceDiagnosticSnapshot, Daemon, DiagnosticConfig, DiagnosticDoctorCheck, DiagnosticHistoryPageInfo, DiagnosticJob, Paths, Daemon (+23 more)

### Community 6 - "Kokoro TTS Session"
Cohesion: 0.08
Nodes (16): KokoroProtocolSession, messageToAudio(), audioDir(), BunKokoroSession, defaultPlaybackRunner(), KokoroClient, KokoroSession, KokoroSessionFactory (+8 more)

### Community 7 - "Dock Menu Controller"
Cohesion: 0.10
Nodes (19): AgentVoiceDockMenuDelegate, DockMenuWindowBridge, AgentVoiceCore, AppKit, AppModel, Bool, Never, String (+11 more)

### Community 8 - "CLI Command Methods"
Cohesion: 0.13
Nodes (7): AgentVoiceCLI, AgentVoiceFullConfig, AgentVoiceHistorySnapshot, Bool, DoctorReport, Int, String

### Community 9 - "Kokoro Setup Models"
Cohesion: 0.11
Nodes (25): CodingKeys, error, id, message, ok, status, stream, title (+17 more)

### Community 10 - "Config Validation"
Cohesion: 0.15
Nodes (26): AGENT_NAMES, AgentName, assertBoolean(), assertIntegerInRange(), assertOneOf(), assertSafePath(), assertString(), cloneConfig() (+18 more)

### Community 11 - "Summarizers"
Cohesion: 0.14
Nodes (24): AgentVoiceConfig, SummarizerName, baseRequest(), buildPrompt(), cleanForSpeech(), describeFailure(), envWithoutUndefined(), firstNSentences() (+16 more)

### Community 12 - "Kokoro Setup AppModel Tests"
Cohesion: 0.14
Nodes (10): AppModelKokoroSetupTests, ThrowingProcessRunner, AgentVoiceCore, Error, Int, ProcessRequest, ProcessResult, RecordingStreamingRunner (+2 more)

### Community 13 - "Setup Assistant Model"
Cohesion: 0.11
Nodes (20): SetupAction, disableAgent, enableAgent, summarizerMode, SetupAssistantModel, SetupCheck, SetupStep, agents (+12 more)

### Community 14 - "Attention Detail View"
Cohesion: 0.20
Nodes (11): AttentionDetailView, text, AgentVoiceHistoryJob, AppModel, Color, Content, DoctorCheck, HistoryJobStatus (+3 more)

### Community 15 - "Streaming Process Runner"
Cohesion: 0.12
Nodes (11): FoundationStreamingProcessRunner, ProcessStreaming, AgentVoiceCLIStreamingTests, Double, AgentVoiceCore, Int, ProcessRequest, RecordingStreamingRunner (+3 more)

### Community 16 - "CLI Entry & Processor"
Cohesion: 0.16
Nodes (22): availableSummarizerModels(), ClaudeHookPayloadContext, CliIo, CliResult, createClaudeHookEvent(), defaultProcessorDeps(), defaultProcessorDepsFactory(), getOption() (+14 more)

### Community 17 - "Menu Bar Sentinel View"
Cohesion: 0.13
Nodes (13): MenuBarSentinelView, ButtonRole, AgentVoiceHistoryJob, AppModel, Bool, Color, Content, DoctorCheck (+5 more)

### Community 18 - "Swift Config Models"
Cohesion: 0.20
Nodes (15): AgentSummary, AgentSummary, AgentVoiceFullConfig, ConfigSummary, SummarizerConfig, TTSConfig, Decoder, AgentSummary (+7 more)

### Community 19 - "Summarizer Config Keys"
Cohesion: 0.10
Nodes (20): CodingKeys, codexModel, maxSentences, maxSummaryChars, opencodeModel, piModel, priority, promptStyle (+12 more)

### Community 20 - "CLI Snapshot Tests"
Cohesion: 0.21
Nodes (8): AgentVoiceCLISnapshotTests, AgentVoiceCLI, AgentVoiceCore, Bool, Int, RecordingRunner, URL, XCTest

### Community 21 - "UI & Daemon State"
Cohesion: 0.14
Nodes (17): SummarizerModelsResponse, AgentVoiceUIState, daemonStopped, needsAttention, paused, processing, ready, DaemonRunState (+9 more)

### Community 22 - "Package Manifest"
Cohesion: 0.11
Nodes (17): bin, agent-voice, voice-codex, voice-opencode, devDependencies, bun-types, @types/node, typescript (+9 more)

### Community 23 - "History Models (Swift)"
Cohesion: 0.21
Nodes (13): AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo, AgentVoiceHistorySnapshot, HistoryJobStatus, done, failed, skipped, AgentVoiceHistoryJob (+5 more)

### Community 24 - "App Source Tests"
Cohesion: 0.16
Nodes (3): AgentVoiceAppSourceTests, sourceSlice(), XCTest

### Community 25 - "Kokoro Setup Progress View Tests"
Cohesion: 0.21
Nodes (3): KokoroSetupProgressViewSourceTests, String, XCTest

### Community 26 - "CLI Process Types"
Cohesion: 0.18
Nodes (11): AgentVoiceCLIError, ProcessResult, ProcessRunning, ProcessStream, StreamingOutputError, invalidUTF8, Darwin, AsyncThrowingStream (+3 more)

### Community 27 - "Kokoro Setup Streaming"
Cohesion: 0.23
Nodes (8): PipeReader, StreamingProcessState, FileHandle, KokoroSetupEvent, Never, Task, Void, Process

### Community 28 - "Source Test Helpers"
Cohesion: 0.22
Nodes (11): appSource(), appSources(), attentionBody(), dashboardBody(), dashboardViewSource(), offset(), offsets(), propertyBody() (+3 more)

### Community 29 - "Kokoro Setup Model Tests"
Cohesion: 0.16
Nodes (4): KokoroSetupModelTests, AgentVoiceCore, String, XCTest

### Community 30 - "Claude Hook Extraction"
Cohesion: 0.25
Nodes (11): ClaudeExtractionResult, ClaudeQuestionResult, extractClaudeQuestion(), extractClaudeStopHook(), findText(), findTextValue(), formatOptionList(), isRecord() (+3 more)

### Community 31 - "Dashboard View Helpers"
Cohesion: 0.24
Nodes (9): DashboardView, AgentVoiceHistoryJob, Bool, Color, Content, DoctorCheck, Int, QueueCounts (+1 more)

### Community 32 - "Status Snapshot & History Tests"
Cohesion: 0.20
Nodes (5): HistoryModelsTests, Data, AgentVoiceStatusSnapshot, AgentVoiceCore, XCTest

### Community 33 - "Doctor Report Models"
Cohesion: 0.21
Nodes (11): DoctorCheck, DoctorReport, Severity, error, info, warning, Bool, DoctorCheck (+3 more)

### Community 34 - "AppModel Action Tests"
Cohesion: 0.14
Nodes (4): AppModelActionTests, SetupAssistantViewSourceTests, XCTest, XCTestCase

### Community 35 - "Kokoro Python Service"
Cohesion: 0.29
Nodes (13): Any, audio_chunk_to_array(), audio_to_base64_wav(), error_message(), load_pipeline(), main(), parse_request(), Write a single JSON object to stdout. (+5 more)

### Community 36 - "Dashboard View (Swift)"
Cohesion: 0.19
Nodes (7): DashboardView, InstallState, AgentVoiceCore, AppKit, AppModel, String, SwiftUI

### Community 37 - "History Snapshot (TS)"
Cohesion: 0.19
Nodes (11): AppHistoryJob, AppHistoryPageInfo, AppHistorySnapshot, buildHistorySnapshot(), decodeHistoryCursor(), emptyHistorySnapshot(), encodeHistoryCursor(), formatHistoryJson() (+3 more)

### Community 38 - "Kokoro Setup Progress View"
Cohesion: 0.26
Nodes (7): KokoroSetupProgressView, KokoroSetupStepDefinition, AgentVoiceCore, AppKit, AppModel, String, SwiftUI

### Community 39 - "Setup Assistant View"
Cohesion: 0.18
Nodes (10): AgentSetupSummary, SetupAssistantView, Identifiable, AgentVoiceCore, AppKit, AppModel, Bool, SetupStep (+2 more)

### Community 40 - "Setup Assistant Model Tests"
Cohesion: 0.17
Nodes (5): SetupAssistantModelTests, DoctorCheck, AgentVoiceCore, XCTest, QueueCounts

### Community 41 - "Clear Failed Jobs Tests"
Cohesion: 0.27
Nodes (9): AppModelClearFailedJobsTests, clearFailedHistoryJobJSON(), clearFailedHistoryPageJSON(), clearFailedStatusJSON(), AgentVoiceCore, Bool, Int, String (+1 more)

### Community 42 - "Summarizer Knobs Tests"
Cohesion: 0.18
Nodes (3): AppModelSummarizerKnobsTests, AgentVoiceCore, XCTest

### Community 43 - "TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 44 - "App Entry & Scenes"
Cohesion: 0.22
Nodes (8): AgentVoiceApplication, AgentVoiceWindowID, StatusBarIconLabel, App, AgentVoiceCore, AppModel, SwiftUI, Scene

### Community 45 - "Smart Action Menu Mode"
Cohesion: 0.20
Nodes (9): SmartActionMenuMode, daemonStopped, daily, needsAttention, unavailable, String, AgentVoiceCore, AppKit (+1 more)

### Community 48 - "Summarizer Config Decoding Tests"
Cohesion: 0.27
Nodes (5): SummarizerConfigDecodingTests, AgentVoiceCore, AgentVoiceFullConfig, String, XCTest

### Community 49 - "Summarizer Model Validation Tests"
Cohesion: 0.22
Nodes (3): AppModelSummarizerActionTests, AgentVoiceCore, XCTest

### Community 51 - "Bun Locator Script"
Cohesion: 0.39
Nodes (6): _agent_voice_cache_bun(), _agent_voice_use_bun(), _agent_voice_use_bun_path_file(), _agent_voice_use_cached_bun(), find_agent_voice_bun(), find-bun.sh script

### Community 52 - "Draft Preservation Tests"
Cohesion: 0.36
Nodes (6): AppModelDraftPreservationTests, draftFullConfigJSON(), draftStatusJSON(), AgentVoiceCore, String, XCTest

### Community 53 - "AppModel Warnings"
Cohesion: 0.33
Nodes (4): AppModel, Bool, Foundation, String

### Community 54 - "Attention Detail View Tests"
Cohesion: 0.33
Nodes (3): AttentionDetailViewSourceTests, functionBody(), XCTest

### Community 55 - "Process Request Home"
Cohesion: 0.60
Nodes (3): ProcessRequest, URL, URL

### Community 56 - "Prompt Style Catalog Tests"
Cohesion: 0.33
Nodes (3): SummarizerPromptStyleCatalogTests, AgentVoiceCore, XCTest

### Community 57 - "Executable Path Resolution"
Cohesion: 0.47
Nodes (4): ExecutablePathInput, ExecutablePaths, realpathOrResolved(), resolveExecutablePaths()

### Community 59 - "Daemon Work Waiter"
Cohesion: 0.60
Nodes (3): createSignalWorkWaiter(), SignalWorkWaiter, WorkWaiter

### Community 62 - "Attention Detail View File"
Cohesion: 0.50
Nodes (3): AgentVoiceCore, AppKit, SwiftUI

## Knowledge Gaps
- **327 isolated node(s):** `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore`, `SwiftUI`, `AgentVoiceWindowID` (+322 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CodingKeys` connect `Config Field Identifiers` to `Summarizer Config Keys`, `Diagnostic Snapshot Models`, `Attention Detail View`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `SummarizerPromptStyleInfo` connect `App Model Core` to `UI & Daemon State`, `Setup Assistant Model`, `Setup Assistant View`?**
  _High betweenness centrality (0.076) - this node is a cross-community bridge._
- **What connects `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore` to the rest of the system?**
  _330 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Database & Events` be split into smaller, more focused modules?**
  _Cohesion score 0.051089108910891086 - nodes in this community are weakly interconnected._
- **Should `Commands & Managed Paths` be split into smaller, more focused modules?**
  _Cohesion score 0.05326460481099656 - nodes in this community are weakly interconnected._
- **Should `App Model Core` be split into smaller, more focused modules?**
  _Cohesion score 0.052604698672114404 - nodes in this community are weakly interconnected._
- **Should `CLI Process Runner Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.09376890502117362 - nodes in this community are weakly interconnected._