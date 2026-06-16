import { describe, expect, test } from "bun:test";
import { extractClaudeQuestion } from "../src/adapters/claude";

// A realistic Claude Code PreToolUse payload for the AskUserQuestion tool, as
// delivered on stdin when Claude presents a question and waits for the answer.
function questionPayload(
	questions: unknown[],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		session_id: "claude-session-1",
		transcript_path: "/tmp/example-transcript.jsonl",
		cwd: "/project",
		hook_event_name: "PreToolUse",
		tool_name: "AskUserQuestion",
		tool_input: { questions },
		...extra,
	};
}

describe("extractClaudeQuestion", () => {
	test("returns null when the payload is not an AskUserQuestion tool call", () => {
		expect(extractClaudeQuestion(null)).toBeNull();
		expect(extractClaudeQuestion({})).toBeNull();
		expect(
			extractClaudeQuestion({ tool_name: "Bash", tool_input: { command: "ls" } }),
		).toBeNull();
	});

	test("returns null when there are no usable questions", () => {
		expect(extractClaudeQuestion(questionPayload([]))).toBeNull();
		expect(
			extractClaudeQuestion(questionPayload([{ options: [{ label: "Yes" }] }])),
		).toBeNull();
	});

	test("speaks the question and its options as natural prose", () => {
		const result = extractClaudeQuestion(
			questionPayload([
				{
					question: "How far should this migration go?",
					header: "Migration scope",
					options: [
						{ label: "Full cutover" },
						{ label: "Phased dual-write" },
						{ label: "Additive layer only" },
					],
				},
			]),
		);

		expect(result).not.toBeNull();
		expect(result?.text).toContain("How far should this migration go?");
		expect(result?.text).toContain(
			"Full cutover, Phased dual-write, or Additive layer only",
		);
	});

	test("joins exactly two options with 'or' and no comma", () => {
		const result = extractClaudeQuestion(
			questionPayload([
				{
					question: "Proceed?",
					options: [{ label: "Yes" }, { label: "No" }],
				},
			]),
		);

		expect(result?.text).toContain("Yes or No");
		expect(result?.text).not.toContain("Yes, or No");
	});

	test("falls back to the bare question when no options are present", () => {
		const result = extractClaudeQuestion(
			questionPayload([{ question: "What should I name the module?" }]),
		);

		expect(result?.text).toContain("What should I name the module?");
		expect(result?.text).not.toContain("options");
	});

	test("includes every question when several are asked", () => {
		const result = extractClaudeQuestion(
			questionPayload([
				{ question: "Pick a language.", options: [{ label: "Go" }] },
				{ question: "Pick a database.", options: [{ label: "Postgres" }] },
			]),
		);

		expect(result?.text).toContain("Pick a language.");
		expect(result?.text).toContain("Pick a database.");
	});
});
