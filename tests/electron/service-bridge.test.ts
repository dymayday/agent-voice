import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRIDGE_PROTOCOL_PREFIX = "__AGENT_VOICE_BRIDGE__";

type BridgeResponse = {
	type: string;
	id: string;
	result?: unknown;
	bridgeError?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readProtocolResponse(stdout: ReadableStream<Uint8Array>) {
	const reader = stdout.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) throw new Error("bridge exited before response");
			buffer += decoder.decode(value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (line.startsWith(BRIDGE_PROTOCOL_PREFIX)) {
					return JSON.parse(
						line.slice(BRIDGE_PROTOCOL_PREFIX.length),
					) as BridgeResponse;
				}
				newline = buffer.indexOf("\n");
			}
		}
	} finally {
		reader.releaseLock();
	}
}

describe("electron app-service bridge", () => {
	test("serves app-service requests over a narrow JSON-line protocol", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-voice-bridge-"));
		const bridge = Bun.spawn(["bun", "linux/electron/service-bridge.ts"], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, AGENT_VOICE_HOME: home },
		});
		try {
			bridge.stdin.write(
				`${JSON.stringify({ id: "one", method: "config.get" })}\n`,
			);
			const response = await readProtocolResponse(bridge.stdout);

			expect(response.type).toBe("response");
			expect(response.id).toBe("one");
			expect(response.bridgeError).toBeUndefined();
			expect(isRecord(response.result)).toBe(true);
			expect(
				(
					response.result as {
						ui?: { desktopCapsule?: { enabled?: boolean } };
					}
				).ui?.desktopCapsule?.enabled,
			).toBe(false);
		} finally {
			bridge.kill();
			rmSync(home, { recursive: true, force: true });
		}
	});
});
