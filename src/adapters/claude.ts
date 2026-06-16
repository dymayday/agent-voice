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

export interface ClaudeQuestionResult {
	text: string;
}

function optionLabels(options: unknown): string[] {
	if (!Array.isArray(options)) return [];
	const labels: string[] = [];
	for (const option of options) {
		if (
			isRecord(option) &&
			typeof option.label === "string" &&
			option.label.trim()
		) {
			labels.push(option.label.trim());
		}
	}
	return labels;
}

function formatOptionList(items: string[]): string {
	if (items.length <= 1) return items.join("");
	if (items.length === 2) return `${items[0]} or ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function questionSentence(question: unknown): string | null {
	if (!isRecord(question)) return null;
	const prompt =
		typeof question.question === "string" ? question.question.trim() : "";
	if (!prompt) return null;
	const labels = optionLabels(question.options);
	if (labels.length === 0) return prompt;
	return `${prompt} The options are ${formatOptionList(labels)}.`;
}

// Build a TTS-friendly line from a Claude Code `PreToolUse` payload for the
// `AskUserQuestion` tool. Returns null for any other tool or a payload with no
// usable question so the caller can stay silent instead of fabricating speech.
export function extractClaudeQuestion(
	payload: unknown,
): ClaudeQuestionResult | null {
	if (!isRecord(payload)) return null;
	if (payload.tool_name !== "AskUserQuestion") return null;
	const toolInput = payload.tool_input;
	if (!isRecord(toolInput)) return null;
	const questions = toolInput.questions;
	if (!Array.isArray(questions) || questions.length === 0) return null;

	const sentences: string[] = [];
	for (const question of questions) {
		const sentence = questionSentence(question);
		if (sentence) sentences.push(sentence);
	}
	if (sentences.length === 0) return null;

	return { text: `Claude is asking for your input: ${sentences.join(" ")}` };
}
