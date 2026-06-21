import {
	clearActive,
	clearFailed,
	createSetupConsentToken,
	getAppConfig,
	getDiagnosticsPreview,
	getHistory,
	getKokoroStatus,
	getStatus,
	installHook,
	runKokoroSetupWithConsent,
	setCapsuleEnabled,
	speakLatest,
	startDaemonService,
	testSpeech,
	uninstallHook,
	updateSummarizerSettings,
	stopDaemonService,
} from "../../src/app-service";
import { resolvePaths } from "../../src/paths";

const BRIDGE_PROTOCOL_PREFIX = "__AGENT_VOICE_BRIDGE__";

type BridgeRequest = {
	id: string;
	method: string;
	payload?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeProtocol(message: Record<string, unknown>): void {
	process.stdout.write(`${BRIDGE_PROTOCOL_PREFIX}${JSON.stringify(message)}\n`);
}

function installEnv() {
	return {
		HOME: process.env.HOME,
		AGENT_VOICE_HOME: process.env.AGENT_VOICE_HOME,
		AGENT_VOICE_EXECUTABLE: process.env.AGENT_VOICE_EXECUTABLE,
	};
}

function emitEvent(id: string, event: unknown): void {
	writeProtocol({ type: "event", id, event });
}

async function handleRequest(request: BridgeRequest): Promise<unknown> {
	const paths = resolvePaths(process.env);
	const payload = isRecord(request.payload) ? request.payload : {};

	switch (request.method) {
		case "status.get":
			return getStatus(paths);
		case "daemon.start":
			return startDaemonService(paths);
		case "daemon.stop":
			return stopDaemonService(paths);
		case "voice.test":
			return testSpeech({ text: payload.text }, paths);
		case "voice.speakLatest":
			return speakLatest(paths);
		case "kokoro.status":
			return getKokoroStatus(paths);
		case "kokoro.setup.run": {
			const consentToken = createSetupConsentToken();
			return runKokoroSetupWithConsent(paths, {
				consentToken,
				emit: (event) => emitEvent(request.id, event),
			});
		}
		case "history.list":
			return getHistory(
				{
					limit: typeof payload.limit === "number" ? payload.limit : undefined,
					before: typeof payload.before === "string" ? payload.before : undefined,
				},
				paths,
			);
		case "queue.clearActive":
			return clearActive(paths);
		case "queue.clearFailed":
			return clearFailed(paths);
		case "diagnostics.snapshot":
			return getDiagnosticsPreview(paths);
		case "hooks.install":
			return installHook(
				typeof payload.agent === "string" ? payload.agent : "",
				installEnv(),
			);
		case "hooks.uninstall":
			return uninstallHook(
				typeof payload.agent === "string" ? payload.agent : "",
				installEnv(),
			);
		case "config.get":
			return getAppConfig(paths);
		case "config.update":
			return updateSummarizerSettings(
				{
					mode: typeof payload.mode === "string" ? payload.mode : undefined,
					thinking:
						typeof payload.thinking === "string" ? payload.thinking : undefined,
					model: typeof payload.model === "string" ? payload.model : undefined,
				},
				paths,
			);
		case "capsule.setEnabled":
			return setCapsuleEnabled(payload.enabled === true, paths);
		default:
			throw new Error(`Unsupported app-service method: ${request.method}`);
	}
}

async function dispatch(line: string): Promise<void> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch (error) {
		writeProtocol({ type: "response", id: "unknown", bridgeError: String(error) });
		return;
	}
	if (!isRecord(parsed) || typeof parsed.id !== "string") return;
	const request = parsed as BridgeRequest;
	try {
		const result = await handleRequest(request);
		writeProtocol({ type: "response", id: request.id, result });
	} catch (error) {
		writeProtocol({
			type: "response",
			id: request.id,
			bridgeError: error instanceof Error ? error.message : String(error),
		});
	}
}

process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk: string) => {
	buffer += chunk;
	let newline = buffer.indexOf("\n");
	while (newline >= 0) {
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (line) void dispatch(line);
		newline = buffer.indexOf("\n");
	}
});
