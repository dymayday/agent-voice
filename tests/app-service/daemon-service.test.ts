import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDaemonLock } from "../../src/daemon";
import { resolvePaths } from "../../src/paths";
import {
	startDaemonService,
	stopDaemonService,
} from "../../src/app-service/daemon-service";

function fixture() {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-daemon-service-"));
	return { home, paths: resolvePaths({ AGENT_VOICE_HOME: home }) };
}

function cleanup(home: string) {
	rmSync(home, { recursive: true, force: true });
}

describe("daemon service", () => {
	test("start returns running status when background start succeeds", async () => {
		const { home, paths } = fixture();
		try {
			const result = await startDaemonService(paths, {
				startBackground: () => 12345,
				isPidAlive: (pid) => pid === 12345,
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value).toEqual({ running: true, pid: 12345 });
		} finally {
			cleanup(home);
		}
	});

	test("start returns typed internal failure when background start throws", async () => {
		const { home, paths } = fixture();
		try {
			const result = await startDaemonService(paths, {
				startBackground: () => {
					throw new Error("boom");
				},
				isPidAlive: () => false,
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected failure");
			expect(result.error.code).toBe("INTERNAL");
			expect(result.error.message).toContain("boom");
		} finally {
			cleanup(home);
		}
	});

	test("start returns typed conflict when daemon is already running", async () => {
		const { home, paths } = fixture();
		try {
			writeDaemonLock(paths, 24680);

			const result = await startDaemonService(paths, {
				isPidAlive: (pid) => pid === 24680,
				startBackground: () => {
					throw new Error("should not start");
				},
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected failure");
			expect(result.error.code).toBe("CONFLICT");
			expect(result.error.message).toContain("already running");
		} finally {
			cleanup(home);
		}
	});

	test("stop returns stopped status without exposing process primitives", async () => {
		const { home, paths } = fixture();
		try {
			writeDaemonLock(paths, 13579);

			const result = await stopDaemonService(paths, {
				isPidAlive: () => false,
				stopProcess: async () => undefined,
			});

			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error(result.error.message);
			expect(result.value).toEqual({ running: false, pid: null });
			expect(Object.keys(result.value).sort()).toEqual(["pid", "running"]);
		} finally {
			cleanup(home);
		}
	});

	test("stop returns typed internal failure when stop process throws", async () => {
		const { home, paths } = fixture();
		try {
			writeDaemonLock(paths, 97531);

			const result = await stopDaemonService(paths, {
				isPidAlive: () => true,
				stopProcess: () => {
					throw new Error("cannot stop");
				},
			});

			expect(result.ok).toBe(false);
			if (result.ok) throw new Error("expected failure");
			expect(result.error.code).toBe("INTERNAL");
			expect(result.error.message).toContain("cannot stop");
		} finally {
			cleanup(home);
		}
	});
});
