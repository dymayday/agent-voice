import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testKokoroService } from "../src/kokoro-setup";

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "agent-voice-kokoro-smoke-"));
}

describe("Kokoro setup smoke test", () => {
	test("exercises synthesis after readiness", async () => {
		const home = tempHome();
		try {
			const script = join(home, "fake-kokoro-service.js");
			writeFileSync(
				script,
				[
					'process.stdout.write(JSON.stringify({ status: "ready" }) + "\\n");',
					"process.stdin.setEncoding('utf8');",
					"process.stdin.on('data', (chunk) => {",
					"  const request = JSON.parse(chunk.trim());",
					"  if (request.text === 'Agent Voice Kokoro setup smoke test.') {",
					'    process.stdout.write(JSON.stringify({ audio: "UklGRg==", duration: 0.1 }) + "\\n");',
					"  } else {",
					'    process.stdout.write(JSON.stringify({ error: "unexpected text" }) + "\\n");',
					"  }",
					"});",
				].join("\n"),
			);

			const result = await testKokoroService(process.execPath, script, {});

			expect(result).toEqual({ ok: true });
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("rejects ready-only services", async () => {
		const home = tempHome();
		try {
			const script = join(home, "ready-only-service.js");
			writeFileSync(
				script,
				'process.stdout.write(JSON.stringify({ status: "ready" }) + "\\n");\n',
			);

			const result = await testKokoroService(process.execPath, script, {});

			expect(result.ok).toBe(false);
			expect(result.error).toContain("audio");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
