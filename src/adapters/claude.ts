export interface ClaudeExtractionResult {
	text: string;
	generic: boolean;
}

const GENERIC_CLAUDE_COMPLETION = "Claude finished responding.";
const TEXT_KEYS = [
	"last_assistant_message",
	"assistant_response",
	"final_response",
	"response_text",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findTextValue(value: unknown, depth: number): string | null {
	if (depth > 4) return null;
	if (typeof value === "string" && value.trim()) return value;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findTextValue(item, depth + 1);
			if (found) return found;
		}
	}
	return null;
}

function findText(value: unknown, depth = 0): string | null {
	if (depth > 4 || !isRecord(value)) return null;

	for (const key of TEXT_KEYS) {
		if (!Object.hasOwn(value, key)) continue;
		const found = findTextValue(value[key], depth + 1);
		if (found) return found;
	}

	for (const child of Object.values(value)) {
		if (!child || typeof child !== "object") continue;
		if (Array.isArray(child)) {
			for (const item of child) {
				const found = findText(item, depth + 1);
				if (found) return found;
			}
			continue;
		}
		const found = findText(child, depth + 1);
		if (found) return found;
	}

	return null;
}

export function extractClaudeStopHook(
	payload: unknown,
): ClaudeExtractionResult {
	const text = findText(payload);
	if (text) return { text, generic: false };
	return { text: GENERIC_CLAUDE_COMPLETION, generic: true };
}
