// Adapters that turn a Codex lifecycle-hook payload (delivered as JSON on stdin)
// into the text agent-voice speaks. Both functions are defensive: a payload
// that is not a usable object yields a generic line (Stop) or null (permission),
// so the caller can stay silent rather than fabricate or crash.

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const GENERIC_CODEX_COMPLETION = "Codex finished responding.";

export interface CodexStopExtraction {
	text: string;
	/** True when we fell back to the generic line (no real assistant message). */
	generic: boolean;
}

/**
 * `Stop` event: speak `last_assistant_message` when present, else a generic
 * completion line. Mirrors `extractClaudeStopHook`.
 */
export function extractCodexStop(payload: unknown): CodexStopExtraction {
	if (isRecord(payload)) {
		const message = payload.last_assistant_message;
		if (typeof message === "string" && message.trim().length > 0) {
			return { text: message, generic: false };
		}
	}
	return { text: GENERIC_CODEX_COMPLETION, generic: true };
}

export interface CodexPermissionExtraction {
	text: string;
}

/**
 * `PermissionRequest` event: build a TTS line from `tool_name` and the optional
 * human-readable `tool_input.description`. Returns null when there is no usable
 * tool name so the caller stays silent.
 */
export function extractCodexPermission(
	payload: unknown,
): CodexPermissionExtraction | null {
	if (!isRecord(payload)) return null;
	const tool =
		typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
	if (!tool) return null;
	const input = payload.tool_input;
	const description =
		isRecord(input) && typeof input.description === "string"
			? input.description.trim()
			: "";
	if (description) {
		return { text: `Codex is asking to approve ${tool}: ${description}` };
	}
	return { text: `Codex is asking for your approval to use ${tool}.` };
}
