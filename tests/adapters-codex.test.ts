import { describe, expect, test } from "bun:test";
import {
	extractCodexPermission,
	extractCodexStop,
} from "../src/adapters/codex";

describe("extractCodexStop", () => {
	test("returns last_assistant_message when present", () => {
		const result = extractCodexStop({
			last_assistant_message: "Renamed foo to bar and verified the build.",
		});
		expect(result).toEqual({
			text: "Renamed foo to bar and verified the build.",
			generic: false,
		});
	});

	test("falls back to a generic line for missing/blank/non-string/non-object", () => {
		for (const payload of [
			{},
			{ last_assistant_message: "   " },
			{ last_assistant_message: 5 },
			null,
			"nope",
		]) {
			expect(extractCodexStop(payload)).toEqual({
				text: "Codex finished responding.",
				generic: true,
			});
		}
	});
});

describe("extractCodexPermission", () => {
	test("uses tool_name and description when both present", () => {
		const result = extractCodexPermission({
			tool_name: "Bash",
			tool_input: { description: "Run cargo build" },
		});
		expect(result).toEqual({
			text: "Codex is asking to approve Bash: Run cargo build",
		});
	});

	test("falls back to tool_name only when no description", () => {
		expect(
			extractCodexPermission({ tool_name: "apply_patch", tool_input: {} }),
		).toEqual({
			text: "Codex is asking for your approval to use apply_patch.",
		});
	});

	test("returns null when there is no usable tool", () => {
		for (const payload of [{}, { tool_name: "" }, { tool_name: 3 }, null]) {
			expect(extractCodexPermission(payload)).toBeNull();
		}
	});
});
