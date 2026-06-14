import { describe, expect, test } from "bun:test";
import { createEvent, validateEvent } from "../src/events";
import { prepareText, redactSecrets } from "../src/redaction";

describe("event validation and redaction", () => {
	test("createEvent builds a valid canonical turn_end event", () => {
		const event = createEvent({
			agent: "claude",
			text: "Claude updated the docs.",
			cwd: "/repo",
			sessionId: "session-1",
			metadata: { source: "test" },
		});

		expect(event.version).toBe(1);
		expect(event.agent).toBe("claude");
		expect(event.event).toBe("turn_end");
		expect(event.text).toBe("Claude updated the docs.");
		expect(event.cwd).toBe("/repo");
		expect(event.sessionId).toBe("session-1");
		expect(event.id.length).toBeGreaterThan(10);
		expect(validateEvent(event).ok).toBe(true);
	});

	test("validateEvent rejects unsupported versions and missing text", () => {
		const base = createEvent({ agent: "codex", text: "Done." });

		expect(validateEvent({ ...base, version: 2 })).toEqual({
			ok: false,
			reason: "Unsupported event version",
		});
		expect(validateEvent({ ...base, text: "" })).toEqual({
			ok: false,
			reason: "Missing event text",
		});
	});

	test("validateEvent rejects unknown agents and unsafe metadata keys", () => {
		const base = createEvent({ agent: "pi", text: "Done." });

		expect(validateEvent({ ...base, agent: "unknown" })).toEqual({
			ok: false,
			reason: "Unknown agent",
		});
		expect(
			validateEvent({
				...base,
				metadata: JSON.parse('{"__proto__":"polluted"}'),
			}),
		).toEqual({ ok: false, reason: "Unsafe metadata key" });
		expect(
			validateEvent({
				...base,
				metadata: JSON.parse('{"nested":{"constructor":{"prototype":{"polluted":true}}}}'),
			}),
		).toEqual({ ok: false, reason: "Unsafe metadata key" });
	});

	test("redactSecrets removes common secret-shaped values", () => {
		const text = [
			"Authorization: Bearer sk-secret123",
			"OPENAI_API_KEY=sk-test456",
			"ANTHROPIC_API_KEY=\"sk-ant-secret\"",
			"password: super-secret-password",
			"token = 'ghp_secret123'",
			"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
		].join("\n");

		const redacted = redactSecrets(text);

		expect(redacted).toContain("Bearer [REDACTED]");
		expect(redacted).toContain("OPENAI_API_KEY=[REDACTED]");
		expect(redacted).toContain("ANTHROPIC_API_KEY=[REDACTED]");
		expect(redacted).toContain("password: [REDACTED]");
		expect(redacted).toContain("token = [REDACTED]");
		expect(redacted).toContain("-----BEGIN PRIVATE KEY-----[REDACTED]-----END PRIVATE KEY-----");
		expect(redacted).not.toContain("sk-secret123");
		expect(redacted).not.toContain("sk-test456");
		expect(redacted).not.toContain("sk-ant-secret");
		expect(redacted).not.toContain("super-secret-password");
		expect(redacted).not.toContain("ghp_secret123");
	});

	test("prepareText redacts before truncating", () => {
		const prepared = prepareText("Bearer sk-secret123 followed by details", {
			maxInputChars: 18,
			redactSecrets: true,
		});

		expect(prepared).toBe("Bearer [REDACTED]");
		expect(prepared).not.toContain("sk-secret123");
	});
});
