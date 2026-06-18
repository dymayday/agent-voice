import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const resourceRoot = join(import.meta.dir, "..", "resources", "kokoro");

function withFakePythonKokoroDeps<T>(fn: (pythonPath: string) => T): T {
	const pythonPath = mkdtempSync(join(tmpdir(), "agent-voice-kokoro-python-"));
	try {
		writeFileSync(
			join(pythonPath, "kokoro.py"),
			`
class KPipeline:
	def __init__(self, **kwargs):
		self.kwargs = kwargs

	def __call__(self, text, voice):
		yield None, None, [0.0, 0.25, -0.25]
`,
			"utf8",
		);
		writeFileSync(
			join(pythonPath, "numpy.py"),
			`
float32 = "float32"

class FakeArray:
	def __init__(self, values):
		self.values = list(values)
		self.size = len(self.values)

	def reshape(self, *args):
		return self

	def __len__(self):
		return len(self.values)

def asarray(values, dtype=None):
	return FakeArray(values)

def concatenate(chunks):
	combined = []
	for chunk in chunks:
		combined.extend(chunk.values)
	return FakeArray(combined)
`,
			"utf8",
		);
		writeFileSync(
			join(pythonPath, "soundfile.py"),
			`
def write(buffer, audio_data, sample_rate, format=None, subtype=None):
	buffer.write(b"fake-wav")
`,
			"utf8",
		);
		return fn(pythonPath);
	} finally {
		rmSync(pythonPath, { recursive: true, force: true });
	}
}

function runKokoroPythonService(input: string, pythonPath: string) {
	return spawnSync(
		process.env.PYTHON ?? "python3",
		[join(resourceRoot, "kokoro_tts_service.py")],
		{
			input,
			encoding: "utf8",
			env: {
				...process.env,
				PYTHONPATH: pythonPath,
			},
		},
	);
}

function parseJsonLines(output: string): Array<Record<string, unknown>> {
	return output
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

describe("Kokoro setup resources", () => {
	test("ships a Kokoro JSONL service script", () => {
		const script = join(resourceRoot, "kokoro_tts_service.py");
		expect(existsSync(script)).toBe(true);
		const source = readFileSync(script, "utf8");
		expect(source).toContain("KPipeline");
		expect(source).toContain("MAX_TEXT_CHARS");
		expect(source).toContain("KOKORO_REPO_ID");
		expect(source).toContain("HF_HOME");
		expect(source).toContain('models" / "huggingface');
		expect(source).toContain('"status": "ready"');
		expect(source).toContain('"audio"');
	});

	test("Kokoro JSONL service emits ready and audio responses with fake dependencies", () => {
		withFakePythonKokoroDeps((pythonPath) => {
			const result = runKokoroPythonService(
				JSON.stringify({ text: "hello", voice: "af_heart", lang: "a" }) + "\n",
				pythonPath,
			);

			expect(result.status, result.stderr).toBe(0);
			const lines = parseJsonLines(result.stdout);
			expect(lines[0]).toEqual({ status: "ready" });
			expect(lines[1]?.audio).toBeTypeOf("string");
			expect(lines[1]?.duration).toBe(0);
		});
	});

	test("Kokoro JSONL service reports protocol errors as JSON", () => {
		withFakePythonKokoroDeps((pythonPath) => {
			const oversizedText = "x".repeat(1001);
			const result = runKokoroPythonService(
				[
					"not json",
					JSON.stringify({ text: "" }),
					JSON.stringify({ text: oversizedText }),
					JSON.stringify({ text: "hello", voice: "../bad" }),
					JSON.stringify({ text: "hello", lang: "en" }),
				].join("\n") + "\n",
				pythonPath,
			);

			expect(result.status, result.stderr).toBe(0);
			const lines = parseJsonLines(result.stdout);
			expect(lines[0]).toEqual({ status: "ready" });
			expect(lines.slice(1).map((line) => line.error)).toEqual([
				expect.stringContaining("Invalid JSON"),
				"Invalid input: text must be a non-empty string",
				"Invalid input: text exceeds 1000 characters",
				"Invalid input: voice id is not allowed",
				"Invalid input: lang must be one lowercase letter",
			]);
		});
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

	test("macOS app build bundles Kokoro resources", () => {
		if (process.platform !== "darwin") {
			return;
		}

		const repositoryRoot = join(import.meta.dir, "..");
		const script = join(repositoryRoot, "scripts", "build-macos-app.sh");
		const appDir = join(repositoryRoot, "dist", "Agent Voice.app");

		try {
			const result = Bun.spawnSync({
				cmd: ["bash", script],
				cwd: repositoryRoot,
				stdout: "pipe",
				stderr: "pipe",
			});
			const stdout = result.stdout.toString();
			const stderr = result.stderr.toString();

			expect(result.exitCode, stderr).toBe(0);
			const builtApp = stdout.trim().split("\n").at(-1) ?? appDir;
			const bundledKokoroRoot = join(
				builtApp,
				"Contents",
				"Resources",
				"agent-voice",
				"resources",
				"kokoro",
			);

			expect(existsSync(join(bundledKokoroRoot, "kokoro_tts_service.py"))).toBe(
				true,
			);
			expect(existsSync(join(bundledKokoroRoot, "requirements.txt"))).toBe(
				true,
			);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 120_000);
});
