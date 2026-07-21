# Graph Report - .  (2026-07-21)

## Corpus Check
- 118 files · ~708,865 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2120 nodes · 4544 edges · 141 communities (106 shown, 35 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 246 edges (avg confidence: 0.81)
- Token cost: 552,280 input · 0 output

## Community Hubs (Navigation)
- Kokoro Setup Infrastructure
- Application State Orchestration
- Menu Diagnostics Interface
- Setup Readiness Evaluation
- macOS Interface Source Tests
- Database Integration Tests
- Voice Playback Service
- Project Package Tooling
- Swift CLI Command Tests
- Daemon Command Services
- Configuration Service Validation
- Streaming Process Integration
- Setup Interface Source Tests
- Diagnostics Serialization Keys
- Dock Menu Controller
- Queue Job Processing
- Kokoro Setup Data Models
- Kokoro Speech Client
- Electron Service Bridge
- Swift CLI Operations
- Swift Process Runners
- Setup Board Components
- Summary Generation Pipeline
- Daemon Runtime Loop
- Kokoro App Model Tests
- Electron Main Process
- History Window Interface
- Setup Assistant Model
- System Status Services
- Codex Hook Installation
- Voice Setup Experience
- Configuration Coding Keys
- Swift Configuration Models
- Daemon Snapshot Tests
- Dashboard Interface Tests
- CLI Streaming Tests
- Capsule Window Lifecycle
- Electron Renderer Routes
- Renderer Component Tests
- Renderer Service API
- Electron TypeScript Configuration
- Setup Window Navigation
- Privacy Safe Diagnostics
- Application Service Types
- Diagnostics Snapshot Models
- History Data Models
- Electron Build Contracts
- Preload Event Subscriptions
- Renderer Navigation Types
- Root TypeScript Configuration
- History Pagination Service
- Agent Hook Service
- Queue Retry Scheduling
- Kokoro Model Contract Tests
- Claude Event Extraction
- Doctor Report Models
- Python Speech Service
- Kokoro Progress Window
- Preload IPC Contract
- macOS Application Views
- Dashboard Status Components
- Diagnostics Configuration Snapshot
- Application Runtime States
- Failed History Cleanup Tests
- Event Input Validation
- Voice Meter Animation
- Setup Session Consent
- Renderer Privacy Controls
- Trusted Status Snapshot
- Summarizer Model Action Tests
- Settings Action Tests
- Bun Executable Discovery
- Inline Kokoro Installer
- Diagnostics Snapshot Structure
- Diagnostics Refresh Tests
- Prompt Style Catalog
- Application Command Action Tests
- Draft Preservation Tests
- History Focus Tests
- History View Source Tests
- Setup Assistant Tests
- Setup IPC Test Doubles
- Diagnostics Encoding Methods
- Dashboard Warning Management
- Prompt Catalog Tests
- Hook Confirmation Interface
- Guarded Destructive Actions
- Summarizer Decoding Tests
- Lifetime Completion Counter
- Electron Development Runner
- Accessible Renderer Shell
- Setup Repair Route Tests
- Executable Path Resolution
- Renderer Application Entry
- Daemon Work Signaling
- Shell Shim Tests
- Electron Script Tests
- Bridge Protocol Tests
- Kokoro Resource Tests
- Queue History Loading
- Summarizer Mode Settings
- Hook Installation Detection
- Development Launch Tests
- Electron Main Builder
- Home Status Feed
- Settings Panel Actions
- Voice Bench Configuration
- macOS Icon Generator
- Native Workflow Contracts
- Platform Boundary Tests
- Swift Package Definition
- Hook Panel Actions
- Settings Panel Interface
- Application Voice Orb
- Generated Voice Orb
- Hearth Lens Artwork
- Diagnostics Check Reader
- Hook Target Reader
- Status Action Derivation
- Home Status Loader
- Home Voice Testing
- Latest Summary Playback
- Status Tone Mapping
- Hook Diagnostics Copying
- Voice Bench Testing
- Clean Voice Orb
- Orb Heart Artwork
- Quiet Beacon Artwork
- Kokoro Python Requirements
- Kokoro Protocol Types
- Built Main Entry Test
- Electron Tooling Contract
- Renderer Test Discovery

## God Nodes (most connected - your core abstractions)
1. `AppModel` - 94 edges
2. `AgentVoiceCLI` - 76 edges
3. `CodingKeys` - 43 edges
4. `runCli()` - 42 edges
5. `RecordingRunner` - 36 edges
6. `SetupWindowModelTests` - 33 edges
7. `openDb()` - 33 edges
8. `AgentVoiceCLITests` - 31 edges
9. `ok` - 31 edges
10. `fail` - 29 edges

## Surprising Connections (you probably didn't know these)
- `createMainWindowOptions` --rationale_for--> `Narrow Typed Preload IPC Surface`  [INFERRED]
  linux/electron/main.ts → README.md
- `createSetupSessionRegistry` --implements--> `Consent-Gated Kokoro Setup`  [INFERRED]
  linux/electron/main.ts → README.md
- `handleRequest` --implements--> `Local-First Voice Pipeline`  [INFERRED]
  linux/electron/service-bridge.ts → README.md
- `createCapsuleWindowOptions` --rationale_for--> `Narrow Typed Preload IPC Surface`  [INFERRED]
  linux/electron/main.ts → README.md
- `Main Renderer Preload API` --implements--> `Narrow Typed Preload IPC Surface`  [INFERRED]
  linux/electron/preload.ts → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Linux Electron IPC Request Flow** — linux_electron_preload_api, linux_electron_ipc_contract_agent_voice_channels, linux_electron_main_registeripchandlers, linux_electron_main_createbridgeappserviceclient, linux_electron_service_bridge_dispatch, linux_electron_service_bridge_handlerequest [EXTRACTED 1.00]
- **Desktop Capsule Safe Action Flow** — linux_electron_renderer_src_capsule_capsuleapp_safe_capsule_actions, linux_electron_capsule_preload_capsuleapi, linux_electron_main_registeripchandlers, linux_electron_main_createdesktopcapsulecontroller [EXTRACTED 1.00]
- **Renderer Accessibility Pattern** — linux_electron_renderer_src_app_accessible_route_focus, linux_electron_renderer_src_components_confirmdialog_accessible_focus_trap, src_accessibility_renderer_accessibility_contract [EXTRACTED 1.00]
- **Diagnostics privacy preview flow** — linux_electron_renderer_src_routes_diagnosticspanel_loaddiagnostics, linux_electron_renderer_src_routes_diagnosticspanel_normalizepreview, linux_electron_renderer_src_routes_diagnosticspanel_truncatediagnosticstrings, linux_electron_renderer_src_routes_diagnosticspanel_copypreview, linux_electron_renderer_src_routes_diagnosticspanel_privacy_safe_diagnostics [EXTRACTED 1.00]
- **Managed Kokoro setup session flow** — linux_electron_renderer_src_routes_setuprepair_startsetup, linux_electron_renderer_src_routes_setuprepair_handlesetupenvelope, linux_electron_renderer_src_routes_setuprepair_handlesetupevent, linux_electron_renderer_src_routes_setuprepair_cancelsetup, linux_electron_renderer_src_routes_setuprepair_session_scoped_progress [EXTRACTED 1.00]
- **Guarded destructive action pattern** — linux_electron_renderer_src_components_confirmdialog_vitest_confirmdialog_tests, linux_electron_renderer_src_routes_hookspanel_guarded_hook_changes, linux_electron_renderer_src_routes_queuehistory_typed_queue_cleanup [INFERRED 0.85]
- **Derived Two-Face Setup Flow** — macos_agentvoiceapp_sources_agentvoiceapp_setupwindowview_setupwindowview, macos_agentvoiceapp_sources_agentvoiceapp_soundcheckview_soundcheckview, macos_agentvoiceapp_sources_agentvoiceapp_setupboardview_setupboardview, macos_agentvoiceapp_sources_agentvoicecore_setupwindowmodel_setupreadiness [EXTRACTED 1.00]
- **Kokoro Install Progress Flow** — macos_agentvoiceapp_sources_agentvoicecore_appmodel_appmodel, macos_agentvoiceapp_sources_agentvoicecore_agentvoicecli_agentvoicecli, macos_agentvoiceapp_sources_agentvoicecore_kokorosetupprogress_kokorosetupprogress, macos_agentvoiceapp_sources_agentvoiceapp_kokoroinstallinlineview_kokoroinstallinlineview, macos_agentvoiceapp_sources_agentvoiceapp_kokorosetupprogressview_kokorosetupprogressview [INFERRED 0.95]
- **Summarizer Configuration Flow** — macos_agentvoiceapp_sources_agentvoicecore_agentvoiceconfig_summarizerconfig, macos_agentvoiceapp_sources_agentvoicecore_appmodel_appmodel, macos_agentvoiceapp_sources_agentvoiceapp_setupboardview_summaryvoicesection, macos_agentvoiceapp_sources_agentvoiceapp_summarizermodelcontrols_summarizermodelcontrols, macos_agentvoiceapp_sources_agentvoicecore_agentvoicecli_agentvoicecli [INFERRED 0.95]
- **Agent Event to Speech Pipeline** — src_cli_runcli, src_events_createevent, src_store_enqueue, src_daemon_rundaemonloop, src_summarizers_summarizewithsource, src_tts_kokoroclient, src_tts_playwav [INFERRED 0.95]
- **App Service Result Contract** — src_app_service_types_appserviceresult, src_app_service_errors_ok, src_app_service_errors_fail, src_app_service_daemon_service_startdaemonservice, src_app_service_status_service_getstatus, src_app_service_voice_service_testspeech [INFERRED 0.95]
- **Monotonic Done Status Flow** — src_db_opendb, src_store_seeddonetotal, src_store_markdone, src_store_countsforsnapshot, src_daemon_createstatuspublisher, src_app_service_status_service_getqueuesnapshot [INFERRED 0.95]
- **Summarization Pipeline Contracts** — tests_config_test_summarizer_prompt_knobs_config, tests_summarizers_test_summarizer_fallback_chain, tests_app_service_voice_service_test_voice_app_service [INFERRED 0.85]
- **Desktop Application Service Flow** — tests_app_service_config_service_test_app_service_config, tests_app_service_status_history_service_test_status_and_history_service, tests_app_service_voice_service_test_voice_app_service, tests_electron_capsule_lifecycle_test_capsule_lifecycle [INFERRED 0.75]
- **Audio Delivery Flow** — tests_tts_test_kokoro_tts_bridge, tests_playback_test_playback_backend_detection, tests_app_service_voice_service_test_voice_app_service [INFERRED 0.85]
- **Preload subscription cleanup flow** — tests_electron_preload_subscriptions_test_unsubscribe_before_subscribe_resolves, tests_electron_preload_subscriptions_test_idempotent_unsubscribe, tests_electron_preload_contract_test_preload_unsubscribe_cleanup, tests_electron_setup_session_ipc_test_explicit_main_process_unsubscribe [INFERRED 0.95]
- **Setup session lifecycle contract** — tests_electron_setup_session_ipc_test_setup_consent_requirement, tests_electron_setup_session_ipc_test_best_effort_session_cancel, tests_electron_setup_session_ipc_test_buffered_setup_events, tests_electron_setup_session_ipc_test_cancelled_session_event_suppression, tests_electron_setup_session_ipc_test_nonblocking_setup_start [INFERRED 0.85]
- **Electron security boundary contract** — tests_electron_main_security_test_sandboxed_isolated_renderer, tests_electron_main_security_test_ipc_payload_validation, tests_electron_preload_contract_test_allowlisted_preload_methods, tests_electron_preload_contract_test_no_generic_shell_or_filesystem_channels, tests_electron_no_swift_touch_test_linux_electron_sibling_boundaries [INFERRED 0.85]

## Communities (141 total, 35 thin omitted)

### Community 0 - "Kokoro Setup Infrastructure"
Cohesion: 0.05
Nodes (80): commandDescription(), emitLogs(), KokoroCommandDeps, KokoroLogEmitter, runChecked(), assertExistingPathSafe(), assertManagedChild(), assertManagedRoot() (+72 more)

### Community 1 - "Application State Orchestration"
Cohesion: 0.05
Nodes (25): Combine, CustomStringConvertible, KokoroSetupSnapshot, AppModel, SummarizerModelBinding, SummarizerModelRestoreError, AgentVoiceHistoryJob, AgentVoiceHistorySnapshot (+17 more)

### Community 2 - "Menu Diagnostics Interface"
Cohesion: 0.06
Nodes (35): AttentionDetailView, MenuBarSentinelView, SmartActionMenuMode, daemonStopped, daily, needsAttention, unavailable, String (+27 more)

### Community 3 - "Setup Readiness Evaluation"
Cohesion: 0.10
Nodes (20): AgentVoiceUIState, Foundation, KokoroSetupPhase, SetupConcernHealth, SetupConcernStatus, attention, critical, ok (+12 more)

### Community 4 - "macOS Interface Source Tests"
Cohesion: 0.06
Nodes (19): AgentVoiceAppSourceTests, AttentionDetailViewSourceTests, DockMenuSourceTests, appSource(), appSources(), attentionBody(), dashboardBody(), dashboardViewSource() (+11 more)

### Community 5 - "Database Integration Tests"
Cohesion: 0.10
Nodes (20): AgentVoiceDb, getSchemaVersion(), hasColumn(), migrateSchema(), openDb(), createEvent(), resolvePaths(), countByStatus() (+12 more)

### Community 6 - "Voice Playback Service"
Cohesion: 0.10
Nodes (36): backendName(), boundedMessage(), defaultSynthesizeAndPlay(), errorMessage(), findLatestSpeakableSummary, isPlaybackUnavailable(), SpeakableSummary, SpeakableSummaryRow (+28 more)

### Community 7 - "Project Package Tooling"
Cohesion: 0.05
Nodes (43): bun-types, electron, jsdom, bin, agent-voice, voice-codex, voice-opencode, devDependencies (+35 more)

### Community 8 - "Swift CLI Command Tests"
Cohesion: 0.15
Nodes (6): AgentVoiceCLI, ProcessResult, AgentVoiceCLITests, RecordingRunner, Int32, AppModelSummarizerKnobsTests

### Community 9 - "Daemon Command Services"
Cohesion: 0.11
Nodes (39): DaemonActionResult, messageFromError(), startDaemonService, startFailureCode(), stopDaemonService, availableSummarizerModels(), ClaudeHookPayloadContext, CliIo (+31 more)

### Community 10 - "Configuration Service Validation"
Cohesion: 0.12
Nodes (35): AppConfig, ConfigPaths, errorMessage(), getAppConfig, isSummarizerThinking(), pathsOrDefault(), setCapsuleEnabled, SUMMARIZER_THINKING_VALUES (+27 more)

### Community 11 - "Streaming Process Integration"
Cohesion: 0.10
Nodes (17): HistoryModelsTests, Data, FileHandle, FoundationStreamingProcessRunner, PipeReader, ProcessStream, StreamingLineDecoder, StreamingProcessState (+9 more)

### Community 12 - "Setup Interface Source Tests"
Cohesion: 0.09
Nodes (4): KokoroSetupProgressViewSourceTests, String, SetupWindowViewSourceTests, XCTest

### Community 13 - "Diagnostics Serialization Keys"
Cohesion: 0.05
Nodes (39): CodingKeys, action, agent, agents, agentVoiceHome, attempts, attention, config (+31 more)

### Community 14 - "Dock Menu Controller"
Cohesion: 0.10
Nodes (19): AgentVoiceDockMenuDelegate, DockMenuWindowBridge, AgentVoiceCore, AppKit, AppModel, Bool, Never, String (+11 more)

### Community 15 - "Queue Job Processing"
Cohesion: 0.11
Nodes (27): AgentVoiceEvent, errorMessage(), fallbackSummarizerLabel(), processNextJob(), ProcessNextJobResult, ProcessorDeps, claimNextDue(), getNextDueTime() (+19 more)

### Community 16 - "Kokoro Setup Data Models"
Cohesion: 0.10
Nodes (28): CodingKeys, error, id, message, ok, status, stream, title (+20 more)

### Community 17 - "Kokoro Speech Client"
Cohesion: 0.09
Nodes (12): defaultSynthesize(), defaultProcessorDeps(), BunKokoroSession, KokoroClient, KokoroSession, PlaybackRunRequest, Kokoro Setup Consent, Voice App Service (+4 more)

### Community 18 - "Electron Service Bridge"
Cohesion: 0.16
Nodes (26): BridgeRequest, dispatch, emitEvent(), handleRequest, installEnv(), isRecord(), writeProtocol(), fail (+18 more)

### Community 19 - "Swift CLI Operations"
Cohesion: 0.11
Nodes (6): AgentVoiceCLIError, AgentVoiceHistorySnapshot, DoctorReport, Int, Int32, String

### Community 20 - "Swift Process Runners"
Cohesion: 0.13
Nodes (14): Darwin, FoundationProcessRunner, ProcessRequest, ProcessRunning, ProcessStreaming, StreamingOutputError, invalidUTF8, RecordingStreamingRunner (+6 more)

### Community 21 - "Setup Board Components"
Cohesion: 0.15
Nodes (20): AgentsChannelContent, AgentSummary, DaemonChannelContent, ModelChannelContent, SetupBoardView, SummariesChannelContent, SummaryVoiceSection, AppModel (+12 more)

### Community 22 - "Summary Generation Pipeline"
Cohesion: 0.14
Nodes (27): defaultConfig, SummarizerPromptStyle, baseRequest(), buildPrompt(), cleanForSpeech(), describeFailure(), envWithoutUndefined(), firstNSentences() (+19 more)

### Community 23 - "Daemon Runtime Loop"
Cohesion: 0.11
Nodes (24): clearIntentionalStop(), createStatusPublisher(), currentDaemonConfig(), daemonEntrypointPath(), DaemonLoopResult, DaemonStatusOptions, DetachedDaemonRequest, emptyQueueCounts() (+16 more)

### Community 24 - "Kokoro App Model Tests"
Cohesion: 0.14
Nodes (10): AppModelKokoroSetupTests, ThrowingProcessRunner, AgentVoiceCore, Error, Int, ProcessRequest, ProcessResult, RecordingStreamingRunner (+2 more)

### Community 25 - "Electron Main Process"
Cohesion: 0.12
Nodes (24): AppServiceClient, AppServiceEventEmitter, AppServiceMethod, assertNoUnexpectedKeys(), bootstrapElectron, CAPSULE_ACTIONS, CapsuleAction, capsuleEnabledInConfig() (+16 more)

### Community 26 - "History Window Interface"
Cohesion: 0.11
Nodes (18): HistoryStatusFilter, all, done, failed, skipped, HistoryView, CaseIterable, HistoryJobStatus (+10 more)

### Community 27 - "Setup Assistant Model"
Cohesion: 0.10
Nodes (19): SetupAction, disableAgent, enableAgent, summarizerMode, SetupAssistantModel, SetupCheck, SetupStep, agents (+11 more)

### Community 28 - "System Status Services"
Cohesion: 0.13
Nodes (21): deriveFirstRunActions, FirstRunAction, FirstRunProbeState, FirstRunStatus, emptyCounts(), getQueueSnapshot, getStatus, mapPlayback() (+13 more)

### Community 29 - "Codex Hook Installation"
Cohesion: 0.18
Nodes (22): AGENT_VOICE_HOOK_EVENTS, CODEX_HOOK_EVENT_KEYS, codexConfigPath(), codexHooksDisabled, codexHooksPath(), codexHookState, dropAgentVoiceGroups(), ensureEventGroups() (+14 more)

### Community 30 - "Voice Setup Experience"
Cohesion: 0.13
Nodes (16): SetupAccessibility, SetupNarration, String, Panel, engine, speak, voice, SoundcheckView (+8 more)

### Community 31 - "Configuration Coding Keys"
Cohesion: 0.10
Nodes (21): CodingKeys, hasMore, jobs, limit, nextCursor, pageInfo, version, CodingKey (+13 more)

### Community 32 - "Swift Configuration Models"
Cohesion: 0.29
Nodes (14): AgentSummary, Codable, Decoder, Equatable, SummarizerModelsResponse, AgentSummary, AgentVoiceFullConfig, ConfigSummary (+6 more)

### Community 33 - "Daemon Snapshot Tests"
Cohesion: 0.21
Nodes (8): AgentVoiceCLISnapshotTests, AgentVoiceCLI, AgentVoiceCore, Bool, Int, RecordingRunner, URL, XCTest

### Community 34 - "Dashboard Interface Tests"
Cohesion: 0.12
Nodes (5): DashboardView, AppModel, InstallState, String, DashboardViewSourceTests

### Community 35 - "CLI Streaming Tests"
Cohesion: 0.15
Nodes (8): AgentVoiceCLIStreamingTests, AgentVoiceCore, Int, ProcessRequest, RecordingStreamingRunner, String, UInt64, XCTest

### Community 36 - "Capsule Window Lifecycle"
Cohesion: 0.14
Nodes (5): createCapsuleController, createDesktopCapsuleController, BrowserWindowFake, Capsule Lifecycle, FakeBrowserWindow

### Community 37 - "Electron Renderer Routes"
Cohesion: 0.19
Nodes (5): active, ../lib/api, ./lib/types, ../../../../../src/app-service, ../../../../../src/history

### Community 38 - "Renderer Component Tests"
Cohesion: 0.16
Nodes (6): createMockAgentVoice, installMockAgentVoice, success(), diagnosticsPreview, failedJob, config()

### Community 39 - "Renderer Service API"
Cohesion: 0.14
Nodes (17): agentVoice proxy, getAgentVoice, requireAgentVoice, loadDiagnostics, normalizePreview, resultValue, cancelSetup, failForSession (+9 more)

### Community 40 - "Electron TypeScript Configuration"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, checkJs, isolatedModules, types, extends, include, bun-types (+9 more)

### Community 41 - "Setup Window Navigation"
Cohesion: 0.12
Nodes (13): Face, board, soundcheck, SetupWindowView, AppModel, SetupConcern, agents, daemon (+5 more)

### Community 42 - "Privacy Safe Diagnostics"
Cohesion: 0.18
Nodes (17): DiagnosticsPreview, DiagnosticsPreviewOptions, DiagnosticsSnapshot, getDiagnosticsPreview, hasKey(), hasPathLikeValue(), JobRow, mapPlaybackDiagnostics() (+9 more)

### Community 43 - "Application Service Types"
Cohesion: 0.18
Nodes (15): QueueSnapshotJob, APP_SERVICE_ERROR_CODES, AppConfigDraft, AppServiceError, AppServiceErrorCode, IsoDateString, LatestEventSummary, QueueCounts (+7 more)

### Community 44 - "Diagnostics Snapshot Models"
Cohesion: 0.21
Nodes (13): Daemon, DiagnosticDoctorCheck, DiagnosticHistoryPageInfo, DiagnosticJob, Paths, Encodable, AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo (+5 more)

### Community 45 - "History Data Models"
Cohesion: 0.21
Nodes (13): AgentVoiceHistoryJob, AgentVoiceHistoryPageInfo, AgentVoiceHistorySnapshot, HistoryJobStatus, done, failed, skipped, AgentVoiceHistoryJob (+5 more)

### Community 46 - "Electron Build Contracts"
Cohesion: 0.15
Nodes (15): Linux Renderer Build and Test Configuration, Electron Main and Preload Build Pipeline, AgentVoiceCapsulePreloadApi, Capsule Preload API, Linux Electron Development Orchestration, Agent Voice IPC Channels, createCapsuleWindowOptions, Main Renderer Preload API (+7 more)

### Community 47 - "Preload Event Subscriptions"
Cohesion: 0.24
Nodes (11): eventChannel, PreloadIpcRenderer, subscribeToAgentVoiceEvent, subscriptionIdFromResult(), Preload unsubscribe cleanup contract, deferred, FakeIpcRenderer, Idempotent unsubscribe after subscription (+3 more)

### Community 48 - "Renderer Navigation Types"
Cohesion: 0.17
Nodes (11): Operator Rail, activeRoute store, routeLabel, AgentVoiceRendererApi, RouteDefinition, RouteId, Renderer routes, UnknownResult (+3 more)

### Community 49 - "Root TypeScript Configuration"
Cohesion: 0.12
Nodes (15): linux/electron/**/*.ts, src/**/*.ts, tests/**/*.ts, compilerOptions, allowImportingTsExtensions, module, moduleResolution, noEmit (+7 more)

### Community 50 - "History Pagination Service"
Cohesion: 0.15
Nodes (12): DiagnosticsJobContext, QueueRow, DaemonStatus, AppHistoryJob, AppHistoryPageInfo, AppHistorySnapshot, buildHistorySnapshot(), emptyHistorySnapshot() (+4 more)

### Community 51 - "Agent Hook Service"
Cohesion: 0.28
Nodes (13): assertSupportedAgent(), getHookStates, HookAgentState, HookMutationResult, HookStatesSnapshot, hookTargetLabel(), installAgent(), installHook (+5 more)

### Community 52 - "Queue Retry Scheduling"
Cohesion: 0.20
Nodes (13): isDue(), markAttempt(), matchesPattern(), matchesSegment(), matchesSegments(), QueueJob, RetryDecision, scheduleRetry() (+5 more)

### Community 53 - "Kokoro Model Contract Tests"
Cohesion: 0.16
Nodes (4): KokoroSetupModelTests, AgentVoiceCore, String, XCTest

### Community 54 - "Claude Event Extraction"
Cohesion: 0.25
Nodes (11): ClaudeExtractionResult, ClaudeQuestionResult, extractClaudeQuestion(), extractClaudeStopHook(), findText(), findTextValue(), formatOptionList(), isRecord() (+3 more)

### Community 55 - "Doctor Report Models"
Cohesion: 0.21
Nodes (11): DoctorCheck, DoctorReport, Severity, error, info, warning, Bool, DoctorCheck (+3 more)

### Community 56 - "Python Speech Service"
Cohesion: 0.29
Nodes (13): Any, audio_chunk_to_array(), audio_to_base64_wav(), error_message(), load_pipeline(), main(), parse_request(), Write a single JSON object to stdout. (+5 more)

### Community 57 - "Kokoro Progress Window"
Cohesion: 0.22
Nodes (9): App, AgentVoiceApplication, AppModel, KokoroSetupProgressView, AppModel, Double, KokoroSetupStepDefinition, String (+1 more)

### Community 58 - "Preload IPC Contract"
Cohesion: 0.18
Nodes (10): Agent Voice Events, Agent Voice Preload Methods, AgentVoiceChannel, AgentVoiceEventName, AgentVoicePreloadMethod, AgentVoicePreloadApi, IPC payload validation before service calls, Allowlisted preload methods (+2 more)

### Community 59 - "macOS Application Views"
Cohesion: 0.29
Nodes (5): AgentVoiceCore, AppKit, AgentVoiceWindowID, StatusBarIconLabel, SwiftUI

### Community 60 - "Dashboard Status Components"
Cohesion: 0.27
Nodes (8): DashboardView, AgentVoiceHistoryJob, Bool, Color, Content, DoctorCheck, Int, String

### Community 61 - "Diagnostics Configuration Snapshot"
Cohesion: 0.20
Nodes (9): DiagnosticConfig, AgentSummary, AgentVoiceFullConfig, AgentVoiceHistorySnapshot, AgentVoiceStatusSnapshot, ConfigSummary, DoctorReport, SummarizerConfig (+1 more)

### Community 62 - "Application Runtime States"
Cohesion: 0.18
Nodes (10): AgentVoiceUIState, daemonStopped, needsAttention, paused, processing, ready, DaemonRunState, running (+2 more)

### Community 63 - "Failed History Cleanup Tests"
Cohesion: 0.27
Nodes (9): AppModelClearFailedJobsTests, clearFailedHistoryJobJSON(), clearFailedHistoryPageJSON(), clearFailedStatusJSON(), AgentVoiceCore, Bool, Int, String (+1 more)

### Community 64 - "Event Input Validation"
Cohesion: 0.29
Nodes (9): AGENT_NAMES, AgentVoiceEventName, hasUnsafeKey(), isRecord(), normalizeIgnoredText(), shouldIgnoreEventText(), UNSAFE_KEYS, validateEvent() (+1 more)

### Community 65 - "Voice Meter Animation"
Cohesion: 0.22
Nodes (9): CGFloat, SetupConcernStatus, SoundwaveBloom, Bool, Color, Double, Int, VoiceMeter (+1 more)

### Community 66 - "Setup Session Consent"
Cohesion: 0.24
Nodes (10): createSetupSessionRegistry, Agent Voice, Consent-Gated Kokoro Setup, Linux Electron Operator Console, Local-First Voice Pipeline, Allowlisted session-scoped setup events, Best-effort setup session cancellation, Buffered setup events for late subscribers (+2 more)

### Community 67 - "Renderer Privacy Controls"
Cohesion: 0.24
Nodes (10): Privacy Label, copyPreview, Diagnostics Panel, Privacy-safe diagnostics preview, truncateDiagnosticStrings, truncateText, Diagnostics privacy and copy tests, Summarizer privacy matrix (+2 more)

### Community 68 - "Trusted Status Snapshot"
Cohesion: 0.22
Nodes (3): AgentVoiceStatusSnapshot, Bool, URL

### Community 69 - "Summarizer Model Action Tests"
Cohesion: 0.22
Nodes (3): AppModelSummarizerActionTests, AgentVoiceCore, XCTest

### Community 71 - "Bun Executable Discovery"
Cohesion: 0.39
Nodes (6): _agent_voice_cache_bun(), _agent_voice_use_bun(), _agent_voice_use_bun_path_file(), _agent_voice_use_cached_bun(), find_agent_voice_bun(), find-bun.sh script

### Community 72 - "Inline Kokoro Installer"
Cohesion: 0.39
Nodes (5): KokoroInstallInlineView, AppModel, Double, KokoroSetupStepDefinition, String

### Community 73 - "Diagnostics Snapshot Structure"
Cohesion: 0.25
Nodes (8): AgentVoiceDiagnosticSnapshot, Daemon, DiagnosticConfig, DiagnosticDoctorCheck, DiagnosticHistoryPageInfo, DiagnosticJob, QueueCounts, Paths

### Community 74 - "Diagnostics Refresh Tests"
Cohesion: 0.25
Nodes (4): historyPageInfo, AppModelDiagnosticSnapshotTests, AgentVoiceCore, XCTest

### Community 75 - "Prompt Style Catalog"
Cohesion: 0.36
Nodes (5): KokoroSetupStepDefinition, Identifiable, AppModel, SummarizerPromptStyleInfo, String

### Community 77 - "Draft Preservation Tests"
Cohesion: 0.36
Nodes (6): AppModelDraftPreservationTests, draftFullConfigJSON(), draftStatusJSON(), AgentVoiceCore, String, XCTest

### Community 78 - "History Focus Tests"
Cohesion: 0.32
Nodes (4): AppModelHistoryFocusTests, AgentVoiceCore, AppModel, XCTest

### Community 80 - "Setup Assistant Tests"
Cohesion: 0.25
Nodes (3): SetupAssistantModelTests, AgentVoiceCore, XCTest

### Community 83 - "Dashboard Warning Management"
Cohesion: 0.33
Nodes (4): AppModel, Bool, Foundation, String

### Community 84 - "Prompt Catalog Tests"
Cohesion: 0.29
Nodes (4): SummarizerPromptStyleCatalogTests, AgentVoiceCore, XCTest, XCTestCase

### Community 85 - "Hook Confirmation Interface"
Cohesion: 0.29
Nodes (4): confirmExpected, confirmLabel, confirmMessage, confirmTitle

### Community 86 - "Guarded Destructive Actions"
Cohesion: 0.29
Nodes (7): ConfirmDialog confirmation and focus tests, Guarded hook configuration changes, Hooks Panel, Hook state and guarded action tests, Queue and History Panel, Typed confirmation for destructive queue cleanup, Queue history and cleanup tests

### Community 88 - "Lifetime Completion Counter"
Cohesion: 0.43
Nodes (7): countsForSnapshot(), getDoneTotal(), Lifetime Completion Counter, liveDoneCount(), readMetaInt(), seedDoneTotal(), Lifetime Done Total

### Community 89 - "Electron Development Runner"
Cohesion: 0.40
Nodes (4): electron, kill(), shutdown(), vite

### Community 90 - "Accessible Renderer Shell"
Cohesion: 0.33
Nodes (6): Accessible Route Focus Management, Operator Console Shell, Accessible Dialog Focus Trap, Typed Destructive Confirmation, Renderer View Router, Renderer Accessibility Contract

### Community 91 - "Setup Repair Route Tests"
Cohesion: 0.40
Nodes (3): ok(), setupApi(), SetupStartResult

### Community 92 - "Executable Path Resolution"
Cohesion: 0.47
Nodes (4): ExecutablePathInput, ExecutablePaths, realpathOrResolved(), resolveExecutablePaths()

### Community 93 - "Renderer Application Entry"
Cohesion: 0.40
Nodes (3): app, target, view

### Community 94 - "Daemon Work Signaling"
Cohesion: 0.60
Nodes (3): createSignalWorkWaiter(), SignalWorkWaiter, WorkWaiter

### Community 96 - "Electron Script Tests"
Cohesion: 0.40
Nodes (4): devRunner, pkg, tsconfig, viteConfig

### Community 97 - "Bridge Protocol Tests"
Cohesion: 0.50
Nodes (4): BridgeResponse, isRecord, Narrow JSON-line app-service protocol, readProtocolResponse

### Community 99 - "Queue History Loading"
Cohesion: 0.50
Nodes (4): confirmClear, loadHistory, loadQueueSnapshot, reloadInitial

### Community 101 - "Hook Installation Detection"
Cohesion: 0.50
Nodes (4): Hook Service, Codex Hooks Feature Flag Detection, Codex Installer, Agent Install State Detection

### Community 102 - "Development Launch Tests"
Cohesion: 0.50
Nodes (3): devRunner, main, pkg

### Community 104 - "Home Status Feed"
Cohesion: 0.67
Nodes (3): Status Badge, Home Signal Feed, Home signal feed action tests

### Community 105 - "Settings Panel Actions"
Cohesion: 0.67
Nodes (3): applyConfig, loadConfig, toggleCapsule

### Community 106 - "Voice Bench Configuration"
Cohesion: 0.67
Nodes (3): applyConfig, loadConfig, saveConfig

### Community 109 - "Native Workflow Contracts"
Cohesion: 1.00
Nodes (3): Electron Dev Launch Contract, Electron Main Build, Native Developer Workflow

## Knowledge Gaps
- **462 isolated node(s):** `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore`, `AppKit`, `SwiftUI` (+457 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **35 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppModel` connect `Application State Orchestration` to `Swift Configuration Models`, `Dashboard Interface Tests`, `Setup Readiness Evaluation`, `Inline Kokoro Installer`, `Swift CLI Command Tests`, `Setup Board Components`, `Kokoro Progress Window`, `Voice Setup Experience`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `CodingKeys` connect `Diagnostics Serialization Keys` to `Diagnostics Refresh Tests`, `Menu Diagnostics Interface`, `Diagnostics Snapshot Models`, `Configuration Coding Keys`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `SetupWindowViewSourceTests` connect `Setup Interface Source Tests` to `Inline Kokoro Installer`, `Setup Window Navigation`, `Prompt Catalog Tests`, `Setup Board Components`, `Voice Setup Experience`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `AppModel` (e.g. with `KokoroSetupSnapshot` and `AgentVoiceFullConfig`) actually correct?**
  _`AppModel` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `AgentVoiceCLI` (e.g. with `.testAddsAgentVoiceHomeToEnvironment()` and `.testAddsCommonCliLookupPathsToEnvironment()`) actually correct?**
  _`AgentVoiceCLI` has 30 INFERRED edges - model-reasoned connections that need verification._
- **What connects `find-bun.sh script`, `PackageDescription`, `AgentVoiceCore` to the rest of the system?**
  _462 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Kokoro Setup Infrastructure` be split into smaller, more focused modules?**
  _Cohesion score 0.05174190888476603 - nodes in this community are weakly interconnected._