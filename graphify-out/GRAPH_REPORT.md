# Graph Report - .  (2026-06-19)

## Corpus Check
- Large corpus: 158 files · ~733,525 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 1502 nodes · 3290 edges · 89 communities (68 shown, 21 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 129 edges (avg confidence: 0.81)
- Token cost: 141,505 input · 7,308 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Kokoro Setup & Managed Paths|Kokoro Setup & Managed Paths]]
- [[_COMMUNITY_Agent Hook Installation|Agent Hook Installation]]
- [[_COMMUNITY_CLI Entrypoint & Hook Parsing|CLI Entrypoint & Hook Parsing]]
- [[_COMMUNITY_CLI Process Runner Tests|CLI Process Runner Tests]]
- [[_COMMUNITY_Job Queue & Store|Job Queue & Store]]
- [[_COMMUNITY_Swift CLI Bridge Commands|Swift CLI Bridge Commands]]
- [[_COMMUNITY_Dock Menu Controller|Dock Menu Controller]]
- [[_COMMUNITY_Daemon Lifecycle & Status|Daemon Lifecycle & Status]]
- [[_COMMUNITY_Diagnostic Snapshot Fields|Diagnostic Snapshot Fields]]
- [[_COMMUNITY_TTS Kokoro Session|TTS Kokoro Session]]
- [[_COMMUNITY_SQLite DB & Paths|SQLite DB & Paths]]
- [[_COMMUNITY_Kokoro Setup Progress UI|Kokoro Setup Progress UI]]
- [[_COMMUNITY_Config Loading & Validation|Config Loading & Validation]]
- [[_COMMUNITY_Summarizers|Summarizers]]
- [[_COMMUNITY_AppModel Action Tests|AppModel Action Tests]]
- [[_COMMUNITY_AppModel Kokoro Setup Tests|AppModel Kokoro Setup Tests]]
- [[_COMMUNITY_AppModel Auto-Refresh Tests|AppModel Auto-Refresh Tests]]
- [[_COMMUNITY_Swift Config Models|Swift Config Models]]
- [[_COMMUNITY_Menu Bar Sentinel View|Menu Bar Sentinel View]]
- [[_COMMUNITY_AppModel Kokoro Actions|AppModel Kokoro Actions]]
- [[_COMMUNITY_Setup Assistant Model|Setup Assistant Model]]
- [[_COMMUNITY_Streaming Output Decoding|Streaming Output Decoding]]
- [[_COMMUNITY_Attention Detail View|Attention Detail View]]
- [[_COMMUNITY_Status Snapshot Models|Status Snapshot Models]]
- [[_COMMUNITY_AppModel Diagnostics Actions|AppModel Diagnostics Actions]]
- [[_COMMUNITY_CLI Snapshot Trust Tests|CLI Snapshot Trust Tests]]
- [[_COMMUNITY_NPM Package Manifest|NPM Package Manifest]]
- [[_COMMUNITY_CLI Streaming Process|CLI Streaming Process]]
- [[_COMMUNITY_Diagnostic Snapshot Models|Diagnostic Snapshot Models]]
- [[_COMMUNITY_SetupHistory Coding Keys|Setup/History Coding Keys]]
- [[_COMMUNITY_Kokoro Setup State Models|Kokoro Setup State Models]]
- [[_COMMUNITY_App Source & Window Tests|App Source & Window Tests]]
- [[_COMMUNITY_Setup Progress View Tests|Setup Progress View Tests]]
- [[_COMMUNITY_App Status Snapshot Builder|App Status Snapshot Builder]]
- [[_COMMUNITY_Kokoro Python TTS Service|Kokoro Python TTS Service]]
- [[_COMMUNITY_Dashboard View|Dashboard View]]
- [[_COMMUNITY_History Pagination Models|History Pagination Models]]
- [[_COMMUNITY_AppModel Daemon Commands|AppModel Daemon Commands]]
- [[_COMMUNITY_Source Test Helpers|Source Test Helpers]]
- [[_COMMUNITY_Kokoro Setup Model Tests|Kokoro Setup Model Tests]]
- [[_COMMUNITY_Claude Hook Extraction|Claude Hook Extraction]]
- [[_COMMUNITY_Doctor Report Models|Doctor Report Models]]
- [[_COMMUNITY_Status & Diagnostics Tests|Status & Diagnostics Tests]]
- [[_COMMUNITY_Kokoro Setup Events|Kokoro Setup Events]]
- [[_COMMUNITY_AppModel Refresh Loop|AppModel Refresh Loop]]
- [[_COMMUNITY_Agent Event Validation|Agent Event Validation]]
- [[_COMMUNITY_Menu Smart Actions|Menu Smart Actions]]
- [[_COMMUNITY_Implementation Plans & Docs|Implementation Plans & Docs]]
- [[_COMMUNITY_Setup Assistant View|Setup Assistant View]]
- [[_COMMUNITY_Diagnostic Snapshot Composition|Diagnostic Snapshot Composition]]
- [[_COMMUNITY_UI State Enum|UI State Enum]]
- [[_COMMUNITY_Clear Failed Jobs Tests|Clear Failed Jobs Tests]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_App Window Definitions|App Window Definitions]]
- [[_COMMUNITY_Dock Menu Source Tests|Dock Menu Source Tests]]
- [[_COMMUNITY_History Pagination Tests|History Pagination Tests]]
- [[_COMMUNITY_Bun Locator Script|Bun Locator Script]]
- [[_COMMUNITY_Dashboard View Actions|Dashboard View Actions]]
- [[_COMMUNITY_CLI Process Protocols|CLI Process Protocols]]
- [[_COMMUNITY_Config Coding Keys|Config Coding Keys]]
- [[_COMMUNITY_Diagnostic Snapshot Root|Diagnostic Snapshot Root]]
- [[_COMMUNITY_Draft Preservation Tests|Draft Preservation Tests]]
- [[_COMMUNITY_Dashboard View Source Tests|Dashboard View Source Tests]]
- [[_COMMUNITY_Setup Assistant Tests|Setup Assistant Tests]]
- [[_COMMUNITY_Snapshot Encoding|Snapshot Encoding]]
- [[_COMMUNITY_AppModel History Paging|AppModel History Paging]]
- [[_COMMUNITY_AppModel Visibility Loop|AppModel Visibility Loop]]
- [[_COMMUNITY_AppModel Warnings|AppModel Warnings]]
- [[_COMMUNITY_App Settings|App Settings]]
- [[_COMMUNITY_Attention Detail Source Tests|Attention Detail Source Tests]]
- [[_COMMUNITY_Diagnostics Debug Console|Diagnostics Debug Console]]
- [[_COMMUNITY_macOS Build Script|macOS Build Script]]
- [[_COMMUNITY_Executable Path Resolution|Executable Path Resolution]]
- [[_COMMUNITY_Bin Shim Tests|Bin Shim Tests]]
- [[_COMMUNITY_Kokoro Resources Tests|Kokoro Resources Tests]]
- [[_COMMUNITY_macOS Icon Generator|macOS Icon Generator]]
- [[_COMMUNITY_Agent Voice Mac App Design|Agent Voice Mac App Design]]
- [[_COMMUNITY_Package.swift|Package.swift]]
- [[_COMMUNITY_Fast Mode Extension Implementation Plan|Fast Mode Extension Implementation Plan]]
- [[_COMMUNITY_Agent Voice Global One-Line TTS Summari|Agent Voice: Global One-Line TTS Summari]]
- [[_COMMUNITY_Public Release Sanitization Implementati|Public Release Sanitization Implementati]]
- [[_COMMUNITY_Fix Pi Lens Findings Implementation Plan|Fix Pi Lens Findings Implementation Plan]]
- [[_COMMUNITY_Hearth Lens Icon|Hearth Lens Icon]]
- [[_COMMUNITY_Kokoro Requirements|Kokoro Requirements]]
- [[_COMMUNITY_Kokoro Voice Picker Implementation Plan|Kokoro Voice Picker Implementation Plan]]
- [[_COMMUNITY_Local Voice Orb Clean Icon|Local Voice Orb Clean Icon]]
- [[_COMMUNITY_Orb Heart Core Icon|Orb Heart Core Icon]]
- [[_COMMUNITY_Pi Agent Install Buttons Implementation|Pi Agent Install Buttons Implementation ]]
- [[_COMMUNITY_Quiet Beacon Icon|Quiet Beacon Icon]]

## God Nodes (most connected - your core abstractions)
1. `AppModel` - 70 edges
2. `runCli()` - 66 edges
3. `CodingKeys` - 43 edges
4. `statusJSON()` - 38 edges
5. `fullConfigJSON()` - 38 edges
6. `AgentVoiceCLI` - 35 edges
7. `String` - 26 edges
8. `AgentVoiceDockMenuDelegate` - 25 edges
9. `AppModelTests` - 25 edges
10. `RecordingRunner` - 23 edges

## Surprising Connections (you probably didn't know these)
- `Agent Voice Mac App Implementation Plan` --references--> `Agent Voice Local Voice Orb Icon`  [EXTRACTED]
  docs/superpowers/plans/2026-06-15-agent-voice-mac-app-implementation.md → assets/app-icon/agent-voice-local-voice-orb.png
- `counts()` --calls--> `countByStatus()`  [EXTRACTED]
  tests/daemon.test.ts → src/store.ts
- `Agent Voice README` --references--> `Agent Voice Local Voice Orb Icon`  [EXTRACTED]
  README.md → assets/app-icon/agent-voice-local-voice-orb.png
- `Code Quality Cleanup Implementation Plan` --references--> `src/kokoro/protocol.ts`  [EXTRACTED]
  docs/superpowers/plans/2026-06-18-code-quality-cleanup.md → src/kokoro/protocol.ts
- `Agent Voice Mac App Design` --references--> `Local Voice Orb Icon`  [EXTRACTED]
  docs/superpowers/specs/2026-06-15-agent-voice-mac-app-design.md → /Users/meidhy/junk/repo/agent-voice/generated-images/agent-voice-icons/05-local-voice-orb.png

## Import Cycles
- None detected.

## Communities (89 total, 21 thin omitted)

### Community 0 - "Kokoro Setup & Managed Paths"
Cohesion: 0.05
Nodes (78): commandDescription(), emitLogs(), KokoroCommandDeps, KokoroLogEmitter, runChecked(), assertExistingPathSafe(), assertManagedChild(), assertManagedRoot() (+70 more)

### Community 1 - "Agent Hook Installation"
Cohesion: 0.07
Nodes (58): agentVoiceHome(), assertOwnedIfPresent(), backupExistingSettings(), buildClaudeQuestionHook(), buildClaudeStopHook(), buildPiExtensionSource(), buildTextExtractor(), ClaudeInstallOptions (+50 more)

### Community 2 - "CLI Entrypoint & Hook Parsing"
Cohesion: 0.07
Nodes (47): availableSummarizerModels(), ClaudeHookPayloadContext, CliIo, CliResult, createClaudeHookEvent(), defaultProcessorDeps(), defaultProcessorDepsFactory(), getOption() (+39 more)

### Community 3 - "CLI Process Runner Tests"
Cohesion: 0.10
Nodes (16): FoundationProcessRunner, AgentVoiceCLITests, RecordingRunner, RecordingStreamingRunner, RecordingStreamState, ResultBox, AgentVoiceCore, AsyncThrowingStream (+8 more)

### Community 4 - "Job Queue & Store"
Cohesion: 0.09
Nodes (41): SQLite Queue Migration — Design, Code Quality Cleanup Implementation Plan, AgentVoiceConfig, DaemonConfigCache, src/kokoro/protocol.ts, errorMessage(), fallbackSummarizerLabel(), processNextJob() (+33 more)

### Community 5 - "Swift CLI Bridge Commands"
Cohesion: 0.11
Nodes (13): AgentVoiceCLI, AgentVoiceCLIError, ProcessRequest, ProcessResult, AgentVoiceFullConfig, AgentVoiceHistorySnapshot, AgentVoiceStatusSnapshot, Bool (+5 more)

### Community 6 - "Dock Menu Controller"
Cohesion: 0.09
Nodes (20): AgentVoiceDockMenuDelegate, DockMenuWindowBridge, AgentVoiceCore, AppKit, AppModel, Bool, Never, String (+12 more)

### Community 7 - "Daemon Lifecycle & Status"
Cohesion: 0.08
Nodes (31): clearIntentionalStop(), clearStatusSnapshot(), createStatusPublisher(), currentDaemonConfig(), daemonEntrypointPath(), DaemonLoopResult, DaemonStatusOptions, DetachedDaemonRequest (+23 more)

### Community 8 - "Diagnostic Snapshot Fields"
Cohesion: 0.05
Nodes (40): CodingKeys, action, agent, agents, agentVoiceHome, attempts, attention, config (+32 more)

### Community 9 - "TTS Kokoro Session"
Cohesion: 0.08
Nodes (16): KokoroProtocolSession, messageToAudio(), audioDir(), BunKokoroSession, defaultPlaybackRunner(), KokoroClient, KokoroSession, KokoroSessionFactory (+8 more)

### Community 10 - "SQLite DB & Paths"
Cohesion: 0.13
Nodes (17): daemonLockPath(), writeDaemonLock(), AgentVoiceDb, getSchemaVersion(), hasColumn(), migrateSchema(), openDb(), createEvent() (+9 more)

### Community 11 - "Kokoro Setup Progress UI"
Cohesion: 0.09
Nodes (17): KokoroSetupProgressView, FoundationStreamingProcessRunner, AgentVoiceCLIStreamingTests, Double, KokoroSetupStepDefinition, AgentVoiceCore, AppKit, AppModel (+9 more)

### Community 12 - "Config Loading & Validation"
Cohesion: 0.15
Nodes (23): loadConfigForEnqueue(), assertBoolean(), assertIntegerInRange(), assertOneOf(), assertSafePath(), assertString(), cloneConfig(), defaultConfig (+15 more)

### Community 13 - "Summarizers"
Cohesion: 0.13
Nodes (23): agent-voice latency reduction — design, SummarizerName, baseRequest(), buildPrompt(), cleanForSpeech(), describeFailure(), envWithoutUndefined(), firstSentence() (+15 more)

### Community 14 - "AppModel Action Tests"
Cohesion: 0.15
Nodes (7): AppModelActionTests, AppModelSettingsActionTests, AppModelSummarizerActionTests, fullConfigJSON(), statusJSON(), AgentVoiceCore, XCTest

### Community 15 - "AppModel Kokoro Setup Tests"
Cohesion: 0.14
Nodes (10): AppModelKokoroSetupTests, ThrowingProcessRunner, AgentVoiceCore, Error, Int, ProcessRequest, ProcessResult, RecordingStreamingRunner (+2 more)

### Community 16 - "AppModel Auto-Refresh Tests"
Cohesion: 0.19
Nodes (6): AppModelTests, refreshResults(), waitForRequestCount(), ProcessResult, RecordingRunner, UInt64

### Community 17 - "Swift Config Models"
Cohesion: 0.15
Nodes (20): StreamingOutputError, invalidUTF8, AgentSummary, AgentVoiceFullConfig, ConfigSummary, SummarizerConfig, TTSConfig, HistoryJobStatus (+12 more)

### Community 18 - "Menu Bar Sentinel View"
Cohesion: 0.13
Nodes (13): MenuBarSentinelView, ButtonRole, AgentVoiceHistoryJob, AppModel, Bool, Color, Content, DoctorCheck (+5 more)

### Community 19 - "AppModel Kokoro Actions"
Cohesion: 0.13
Nodes (10): AppModel, AgentVoiceCLI, AgentVoiceFullConfig, DoctorReport, KokoroSetupEvent, Never, SetupStep, Task (+2 more)

### Community 20 - "Setup Assistant Model"
Cohesion: 0.11
Nodes (18): SetupAction, disableAgent, enableAgent, summarizerMode, SetupAssistantModel, SetupCheck, SetupStep, agents (+10 more)

### Community 21 - "Streaming Output Decoding"
Cohesion: 0.14
Nodes (7): PipeReader, StreamingLineDecoder, HistoryModelsTests, Data, FileHandle, AgentVoiceCore, XCTest

### Community 22 - "Attention Detail View"
Cohesion: 0.21
Nodes (10): AttentionDetailView, AgentVoiceHistoryJob, AppModel, Color, Content, DoctorCheck, HistoryJobStatus, QueueCounts (+2 more)

### Community 23 - "Status Snapshot Models"
Cohesion: 0.17
Nodes (15): AgentVoiceStatusSnapshot, DaemonStatus, PathSummary, QueueCounts, UIStatus, AgentVoiceUIState, DaemonRunState, DaemonStatus (+7 more)

### Community 24 - "AppModel Diagnostics Actions"
Cohesion: 0.12
Nodes (9): SummarizerModelBinding, SummarizerModelRestoreError, Combine, CustomStringConvertible, Error, Foundation, String, SummarizerConfig (+1 more)

### Community 25 - "CLI Snapshot Trust Tests"
Cohesion: 0.21
Nodes (8): AgentVoiceCLISnapshotTests, AgentVoiceCLI, AgentVoiceCore, Bool, Int, RecordingRunner, URL, XCTest

### Community 26 - "NPM Package Manifest"
Cohesion: 0.11
Nodes (17): bin, agent-voice, voice-codex, voice-opencode, devDependencies, bun-types, @types/node, typescript (+9 more)

### Community 27 - "CLI Streaming Process"
Cohesion: 0.24
Nodes (9): ProcessStream, StreamingProcessState, AsyncThrowingStream, Error, KokoroSetupEvent, Never, Task, Void (+1 more)

### Community 28 - "Diagnostic Snapshot Models"
Cohesion: 0.21
Nodes (13): Daemon, DiagnosticDoctorCheck, DiagnosticHistoryPageInfo, DiagnosticJob, Paths, Encodable, AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo (+5 more)

### Community 29 - "Setup/History Coding Keys"
Cohesion: 0.12
Nodes (17): CodingKeys, hasMore, jobs, limit, nextCursor, pageInfo, version, CodingKeys (+9 more)

### Community 30 - "Kokoro Setup State Models"
Cohesion: 0.22
Nodes (11): KokoroSetupPhase, cancelled, failed, idle, running, succeeded, KokoroSetupSnapshot, KokoroSetupStepDefinition (+3 more)

### Community 31 - "App Source & Window Tests"
Cohesion: 0.16
Nodes (3): AgentVoiceAppSourceTests, sourceSlice(), XCTest

### Community 32 - "Setup Progress View Tests"
Cohesion: 0.21
Nodes (3): KokoroSetupProgressViewSourceTests, String, XCTest

### Community 33 - "App Status Snapshot Builder"
Cohesion: 0.18
Nodes (14): DaemonStatus, AppHistoryJob, AppStatusSnapshot, buildAppStatusSnapshot(), composeStatusSnapshot(), deriveDaemonRunState(), deriveUiState(), formatAppStatusJson() (+6 more)

### Community 34 - "Kokoro Python TTS Service"
Cohesion: 0.23
Nodes (15): Kokoro Bootstrap Setup Design, Kokoro Bootstrap Setup Implementation Plan, Any, audio_chunk_to_array(), audio_to_base64_wav(), error_message(), load_pipeline(), main() (+7 more)

### Community 35 - "Dashboard View"
Cohesion: 0.22
Nodes (10): DashboardView, text, AgentVoiceHistoryJob, Bool, Color, Content, DoctorCheck, Int (+2 more)

### Community 36 - "History Pagination Models"
Cohesion: 0.26
Nodes (11): Diagnostic History Pagination Design, Diagnostic History Pagination Implementation Plan, AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo, AgentVoiceHistorySnapshot, AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo, Bool (+3 more)

### Community 38 - "Source Test Helpers"
Cohesion: 0.23
Nodes (10): appSource(), attentionBody(), dashboardBody(), dashboardViewSource(), offset(), offsets(), propertyBody(), Foundation (+2 more)

### Community 39 - "Kokoro Setup Model Tests"
Cohesion: 0.16
Nodes (4): KokoroSetupModelTests, AgentVoiceCore, String, XCTest

### Community 40 - "Claude Hook Extraction"
Cohesion: 0.25
Nodes (11): ClaudeExtractionResult, ClaudeQuestionResult, extractClaudeQuestion(), extractClaudeStopHook(), findText(), findTextValue(), formatOptionList(), isRecord() (+3 more)

### Community 41 - "Doctor Report Models"
Cohesion: 0.21
Nodes (11): DoctorCheck, DoctorReport, Severity, error, info, warning, Bool, DoctorCheck (+3 more)

### Community 42 - "Status & Diagnostics Tests"
Cohesion: 0.14
Nodes (7): AgentVoiceStatusTests, AppModelDiagnosticSnapshotTests, AgentVoiceCore, XCTest, AgentVoiceCore, XCTest, XCTestCase

### Community 43 - "Kokoro Setup Events"
Cohesion: 0.26
Nodes (9): EventType, complete, log, step, KokoroSetupEvent, KeyedDecodingContainer, Bool, Decoder (+1 more)

### Community 44 - "AppModel Refresh Loop"
Cohesion: 0.20
Nodes (5): TerminalQueueCounts, AgentVoiceStatusSnapshot, Int, QueueCounts, UInt64

### Community 45 - "Agent Event Validation"
Cohesion: 0.23
Nodes (10): AGENT_NAMES, AgentName, AgentVoiceEvent, AgentVoiceEventName, hasUnsafeKey(), isRecord(), UNSAFE_KEYS, validateEvent() (+2 more)

### Community 46 - "Menu Smart Actions"
Cohesion: 0.18
Nodes (10): Menu-Bar Dropdown Header Icon Implementation Plan, SmartActionMenuMode, daemonStopped, daily, needsAttention, unavailable, String, AgentVoiceCore (+2 more)

### Community 47 - "Implementation Plans & Docs"
Cohesion: 0.18
Nodes (11): Agent Voice Implementation Plan, agent-voice Latency Reduction Implementation Plan, Agent Voice Local Voice Orb Icon, Agent Voice Mac App Implementation Plan, Attention Detail Window Implementation Plan, Dashboard Summarizer Thinking Implementation Plan, Diagnostics Window Debug Console Implementation Plan, Menu Bar Template Icon Implementation Plan (+3 more)

### Community 48 - "Setup Assistant View"
Cohesion: 0.20
Nodes (9): AgentSetupSummary, SetupAssistantView, Identifiable, AgentVoiceCore, AppModel, Bool, SetupStep, String (+1 more)

### Community 49 - "Diagnostic Snapshot Composition"
Cohesion: 0.20
Nodes (9): DiagnosticConfig, AgentSummary, AgentVoiceFullConfig, AgentVoiceHistorySnapshot, AgentVoiceStatusSnapshot, ConfigSummary, DoctorReport, SummarizerConfig (+1 more)

### Community 50 - "UI State Enum"
Cohesion: 0.18
Nodes (10): AgentVoiceUIState, daemonStopped, needsAttention, paused, processing, ready, DaemonRunState, running (+2 more)

### Community 51 - "Clear Failed Jobs Tests"
Cohesion: 0.27
Nodes (9): AppModelClearFailedJobsTests, clearFailedHistoryJobJSON(), clearFailedHistoryPageJSON(), clearFailedStatusJSON(), AgentVoiceCore, Bool, Int, String (+1 more)

### Community 52 - "TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 53 - "App Window Definitions"
Cohesion: 0.22
Nodes (8): AgentVoiceApplication, AgentVoiceWindowID, StatusBarIconLabel, App, AgentVoiceCore, AppModel, SwiftUI, Scene

### Community 55 - "History Pagination Tests"
Cohesion: 0.28
Nodes (7): historyJobJSON(), historyPageJSON(), AgentVoiceCore, Bool, Int, String, XCTest

### Community 56 - "Bun Locator Script"
Cohesion: 0.39
Nodes (6): _agent_voice_cache_bun(), _agent_voice_use_bun(), _agent_voice_use_bun_path_file(), _agent_voice_use_cached_bun(), find_agent_voice_bun(), find-bun.sh script

### Community 57 - "Dashboard View Actions"
Cohesion: 0.25
Nodes (5): DashboardView, AgentVoiceCore, AppKit, AppModel, SwiftUI

### Community 58 - "CLI Process Protocols"
Cohesion: 0.36
Nodes (6): ProcessRunning, ProcessStreaming, SummarizerModelsResponse, Darwin, Foundation, Sendable

### Community 59 - "Config Coding Keys"
Cohesion: 0.25
Nodes (8): CodingKeys, codexModel, opencodeModel, piModel, priority, summarizer, thinking, tts

### Community 60 - "Diagnostic Snapshot Root"
Cohesion: 0.25
Nodes (8): AgentVoiceDiagnosticSnapshot, Daemon, DiagnosticConfig, DiagnosticDoctorCheck, DiagnosticHistoryPageInfo, DiagnosticJob, QueueCounts, Paths

### Community 61 - "Draft Preservation Tests"
Cohesion: 0.36
Nodes (6): AppModelDraftPreservationTests, draftFullConfigJSON(), draftStatusJSON(), AgentVoiceCore, String, XCTest

### Community 62 - "Dashboard View Source Tests"
Cohesion: 0.36
Nodes (3): DashboardViewSourceTests, appSources(), XCTest

### Community 63 - "Setup Assistant Tests"
Cohesion: 0.25
Nodes (3): SetupAssistantModelTests, AgentVoiceCore, XCTest

### Community 67 - "AppModel Warnings"
Cohesion: 0.33
Nodes (4): AppModel, Bool, Foundation, String

### Community 68 - "App Settings"
Cohesion: 0.38
Nodes (4): AppSettings, Foundation, String, URL

### Community 69 - "Attention Detail Source Tests"
Cohesion: 0.33
Nodes (3): AttentionDetailViewSourceTests, functionBody(), XCTest

### Community 70 - "Diagnostics Debug Console"
Cohesion: 0.33
Nodes (5): Diagnostics Window Debug Console Design, Diagnostics Recent Jobs Layout Implementation Plan, AgentVoiceCore, AppKit, SwiftUI

### Community 71 - "macOS Build Script"
Cohesion: 0.60
Nodes (5): clean_build_cache(), is_stale_swift_cache_error(), run_release_build(), usage(), build-macos-app.sh script

### Community 72 - "Executable Path Resolution"
Cohesion: 0.47
Nodes (4): ExecutablePathInput, ExecutablePaths, realpathOrResolved(), resolveExecutablePaths()

## Knowledge Gaps
- **342 isolated node(s):** `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore`, `SwiftUI`, `AgentVoiceWindowID` (+337 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **21 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Plan: lower idle power — status snapshot file + visibility-gated GUI refresh` connect `Dock Menu Controller` to `App Status Snapshot Builder`, `CLI Process Protocols`, `CLI Entrypoint & Hook Parsing`, `Daemon Lifecycle & Status`?**
  _High betweenness centrality (0.246) - this node is a cross-community bridge._
- **Why does `Diagnostic History Pagination Implementation Plan` connect `History Pagination Models` to `Community None`, `AppModel Diagnostics Actions`, `CLI Entrypoint & Hook Parsing`, `Diagnostics Debug Console`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._
- **Why does `AppModel` connect `AppModel Kokoro Actions` to `AppModel History Paging`, `AppModel Visibility Loop`, `AppModel Daemon Commands`, `AppModel Refresh Loop`, `AppModel Diagnostics Actions`?**
  _High betweenness centrality (0.143) - this node is a cross-community bridge._
- **Are the 22 inferred relationships involving `statusJSON()` (e.g. with `.testClearFailedJobsDelegatesToCLIAndRefreshes()` and `.testClearFailedJobsDropsDeletedFailedRowsFromCachedHistory()`) actually correct?**
  _`statusJSON()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **What connects `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore` to the rest of the system?**
  _355 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Kokoro Setup & Managed Paths` be split into smaller, more focused modules?**
  _Cohesion score 0.05350877192982456 - nodes in this community are weakly interconnected._
- **Should `Agent Hook Installation` be split into smaller, more focused modules?**
  _Cohesion score 0.06526806526806526 - nodes in this community are weakly interconnected._