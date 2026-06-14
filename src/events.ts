import { randomUUID } from "node:crypto";
import type { AgentName } from "./config";
import { AGENT_NAMES } from "./config";

export type AgentVoiceEventName = "turn_end";

export interface AgentVoiceEvent {
	id: string;
	version: 1;
	agent: AgentName;
	event: AgentVoiceEventName;
	text: string;
	cwd?: string;
	sessionId?: string;
	createdAt: string;
	metadata?: Record<string, unknown>;
}

export type ValidationResult =
	| { ok: true; event: AgentVoiceEvent }
	| { ok: false; reason: string };

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUnsafeKey(value: unknown, seen = new WeakSet<object>()): boolean {
	if (!value || typeof value !== "object") return false;
	if (seen.has(value)) return false;
	seen.add(value);

	for (const key of Reflect.ownKeys(value)) {
		if (typeof key === "string" && UNSAFE_KEYS.has(key)) return true;
		const child = (value as Record<PropertyKey, unknown>)[key];
		if (hasUnsafeKey(child, seen)) return true;
	}

	return false;
}

export function createEvent(input: {
	agent: AgentName;
	text: string;
	cwd?: string;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}): AgentVoiceEvent {
	return {
		id: randomUUID(),
		version: 1,
		agent: input.agent,
		event: "turn_end",
		text: input.text,
		...(input.cwd ? { cwd: input.cwd } : {}),
		...(input.sessionId ? { sessionId: input.sessionId } : {}),
		createdAt: new Date().toISOString(),
		...(input.metadata ? { metadata: input.metadata } : {}),
	};
}

export function validateEvent(input: unknown): ValidationResult {
	if (!isRecord(input)) return { ok: false, reason: "Invalid event" };

	if (input.version !== 1) {
		return { ok: false, reason: "Unsupported event version" };
	}

	if (typeof input.agent !== "string" || !AGENT_NAMES.includes(input.agent as AgentName)) {
		return { ok: false, reason: "Unknown agent" };
	}

	if (input.event !== "turn_end") {
		return { ok: false, reason: "Unsupported event type" };
	}

	if (typeof input.text !== "string" || input.text.trim().length === 0) {
		return { ok: false, reason: "Missing event text" };
	}

	if (typeof input.id !== "string" || input.id.length === 0) {
		return { ok: false, reason: "Missing event id" };
	}

	if (typeof input.createdAt !== "string" || input.createdAt.length === 0) {
		return { ok: false, reason: "Missing event timestamp" };
	}

	if (input.metadata !== undefined) {
		if (!isRecord(input.metadata)) {
			return { ok: false, reason: "Invalid metadata" };
		}
		if (hasUnsafeKey(input.metadata)) {
			return { ok: false, reason: "Unsafe metadata key" };
		}
	}

	return { ok: true, event: input as unknown as AgentVoiceEvent };
}
