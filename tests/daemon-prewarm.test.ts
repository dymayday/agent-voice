import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config";
import { runDaemonLoop } from "../src/daemon";
import { openDb } from "../src/db";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import { enqueue } from "../src/store";

describe("daemon pre-warm", () => {
	test("calls prewarm once before processing any job", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-prewarm-test-"));
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const seed = openDb(paths.db);
			enqueue(seed, createEvent({ agent: "pi", text: "Warm then speak." }));
			seed.close();

			const events: string[] = [];
			await runDaemonLoop(paths, defaultConfig, {
				maxIterations: 1,
				pollIntervalMs: 0,
				processorDeps: {
					prewarm: async () => {
						events.push("prewarm");
					},
					summarize: async () => "Summary.",
					speak: async () => {
						events.push("speak");
					},
				},
			});

			expect(events).toEqual(["prewarm", "speak"]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
