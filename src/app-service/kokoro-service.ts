import { randomUUID } from "node:crypto";
import {
	buildKokoroStatus,
	runKokoroSetup,
	type KokoroManagedStatus,
	type KokoroSetupEvent,
	type KokoroSetupOptions,
	type KokoroSetupRunResult,
} from "../kokoro-setup";
import type { AgentVoicePaths } from "../paths";
import { fail, ok } from "./errors";
import type { AppServiceResult } from "./types";

export const KOKORO_SETUP_CONSENT_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface SetupConsentToken {
	id: string;
	createdAt: string;
}

export interface SetupConsentTokenOptions {
	now?: () => number;
}

export type KokoroSetupRunner = (
	paths: AgentVoicePaths,
	options: KokoroSetupOptions,
) => Promise<KokoroSetupRunResult>;

export interface KokoroSetupWithConsentOptions extends KokoroSetupOptions {
	consentToken?: SetupConsentToken;
	runner?: KokoroSetupRunner;
	now?: () => number;
}

interface IssuedConsentToken {
	createdAtMs: number;
	expiresAtMs: number;
}

const issuedConsentTokens = new Map<string, IssuedConsentToken>();

export function createSetupConsentToken(
	options: SetupConsentTokenOptions = {},
): SetupConsentToken {
	const createdAtMs = options.now?.() ?? Date.now();
	const token = {
		id: `kokoro-consent-${randomUUID()}`,
		createdAt: new Date(createdAtMs).toISOString(),
	};
	issuedConsentTokens.set(token.id, {
		createdAtMs,
		expiresAtMs: createdAtMs + KOKORO_SETUP_CONSENT_TOKEN_TTL_MS,
	});
	return token;
}

function consumeConsentToken(
	token: SetupConsentToken | undefined,
	nowMs: number,
): boolean {
	if (!token) return false;
	if (
		typeof token.id !== "string" ||
		!token.id.startsWith("kokoro-consent-") ||
		typeof token.createdAt !== "string" ||
		!Number.isFinite(Date.parse(token.createdAt))
	) {
		return false;
	}
	const issuedToken = issuedConsentTokens.get(token.id);
	if (!issuedToken) return false;
	issuedConsentTokens.delete(token.id);
	return nowMs <= issuedToken.expiresAtMs;
}

export function normalizeKokoroSetupEvent(
	event: KokoroSetupEvent,
): KokoroSetupEvent {
	if (event.type === "step") {
		return {
			type: "step",
			id: event.id,
			status: event.status,
			title: event.title,
			...(event.error ? { error: event.error } : {}),
		};
	}
	if (event.type === "log") {
		return { type: "log", stream: event.stream, message: event.message };
	}
	return {
		type: "complete",
		ok: event.ok,
		...(event.error ? { error: event.error } : {}),
	};
}

export function getKokoroStatus(
	paths: AgentVoicePaths,
	options: Parameters<typeof buildKokoroStatus>[1] = {},
): AppServiceResult<KokoroManagedStatus> {
	try {
		return ok(buildKokoroStatus(paths, options));
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}

export async function runKokoroSetupWithConsent(
	paths: AgentVoicePaths,
	options: KokoroSetupWithConsentOptions = {},
): Promise<AppServiceResult<KokoroSetupRunResult>> {
	const nowMs = options.now?.() ?? Date.now();
	if (!consumeConsentToken(options.consentToken, nowMs)) {
		return fail(
			"BAD_INPUT",
			"Kokoro setup requires an explicit consent token.",
		);
	}
	const {
		consentToken: _consentToken,
		now: _now,
		runner,
		emit,
		...runnerOptions
	} = options;
	try {
		const result = await (runner ?? runKokoroSetup)(paths, {
			...runnerOptions,
			emit: emit
				? (event) => emit(normalizeKokoroSetupEvent(event))
				: undefined,
		});
		return ok(result);
	} catch (error) {
		return fail(
			"INTERNAL",
			error instanceof Error ? error.message : String(error),
		);
	}
}
