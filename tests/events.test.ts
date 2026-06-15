import { describe, expect, test } from "bun:test";
import { createEvent, validateEvent } from "../src/events";

describe("event validation", () => {
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
				metadata: JSON.parse(
					'{"nested":{"constructor":{"prototype":{"polluted":true}}}}',
				),
			}),
		).toEqual({ ok: false, reason: "Unsafe metadata key" });
	});
});
