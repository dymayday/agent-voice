import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const resourceRoot = join(import.meta.dir, "..", "resources", "kokoro");

describe("Kokoro setup resources", () => {
	test("ships a Kokoro JSONL service script", () => {
		const script = join(resourceRoot, "kokoro_tts_service.py");
		expect(existsSync(script)).toBe(true);
		const source = readFileSync(script, "utf8");
		expect(source).toContain("KPipeline");
		expect(source).toContain("MAX_TEXT_CHARS");
		expect(source).toContain("KOKORO_REPO_ID");
		expect(source).toContain('"status": "ready"');
		expect(source).toContain('"audio"');
	});

	test("pins Python dependencies for managed Kokoro install", () => {
		const requirements = readFileSync(
			join(resourceRoot, "requirements.txt"),
			"utf8",
		);
		expect(requirements).toContain("kokoro==0.9.4");
		expect(requirements).toContain("soundfile==0.14.0");
		expect(requirements).toContain("numpy==2.4.6");
		expect(requirements).not.toMatch(/>=|~/);
	});
});
