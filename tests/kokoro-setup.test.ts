import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { defaultConfig, loadConfig, saveConfig } from "../src/config";
import {
	buildKokoroStatus,
	KOKORO_SETUP_STEP_IDS,
	kokoroManagedHome,
	kokoroManagedPython,
	kokoroManagedScript,
	runKokoroSetup,
	testKokoroService,
	type KokoroSetupDeps,
	type KokoroSetupEvent,
	type KokoroSetupRunResult,
} from "../src/kokoro-setup";
import { resolvePaths } from "../src/paths";

const resourceRoot = join(import.meta.dir, "..", "resources", "kokoro");

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "agent-voice-kokoro-setup-"));
}

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
	return spawnSync(process.env.PYTHON ?? "python3", [join(resourceRoot, "kokoro_tts_service.py")], {
		input,
		encoding: "utf8",
		env: {
			...process.env,
			PYTHONPATH: pythonPath,
		},
	});
}

function parseJsonLines(output: string): Array<Record<string, unknown>> {
	return output
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

function expectKokoroSetupFailure(outcome: KokoroSetupRunResult): Extract<KokoroSetupRunResult, { ok: false }> {
	expect(outcome.ok).toBe(false);
	if (outcome.ok) {
		throw new Error("Expected Kokoro setup to fail");
	}
	return outcome;
}

function fakeDeps(overrides: Partial<KokoroSetupDeps> = {}): KokoroSetupDeps {
	return {
		commandExists: async (cmd) => cmd === "uv",
		run: async (request) => {
			if (request.cmd === "uv" && request.args[0] === "venv" && request.cwd) {
				const binDir = join(request.cwd, ".venv", "bin");
				mkdirSync(binDir, { recursive: true });
				writeFileSync(join(binDir, "python"), "#!/bin/sh\n", "utf8");
			}
			return { ok: true, stdout: "ok", stderr: "" };
		},
		smokeTest: async () => ({ ok: true }),
		...overrides,
	};
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
		expect(source).toContain("models\" / \"huggingface");
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
});

describe("Kokoro setup module", () => {
	test("kokoro setup emits ordered JSONL-friendly progress events and updates config after smoke test", async () => {
		const home = tempHome();
		const events: KokoroSetupEvent[] = [];
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					run: async (request) => {
						runs.push(request);
						if (
							request.cmd === "uv" &&
							request.args[0] === "venv" &&
							request.cwd
						) {
							const binDir = join(request.cwd, ".venv", "bin");
							mkdirSync(binDir, { recursive: true });
							writeFileSync(join(binDir, "python"), "#!/bin/sh\n", "utf8");
						}
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: (event) => events.push(event),
			});

			expect(outcome.ok).toBe(true);
			expect(events.map((event) => event.type)).toContain("complete");
			const runningStepIds = events
				.filter(
					(event): event is Extract<KokoroSetupEvent, { type: "step" }> =>
						event.type === "step" && event.status === "running",
				)
				.map((event) => event.id);
			expect(runningStepIds).toEqual([...KOKORO_SETUP_STEP_IDS]);
			for (const stepId of runningStepIds) {
				expect(
					events.some(
						(event) =>
							event.type === "step" &&
							event.id === stepId &&
							["done", "failed", "skipped"].includes(event.status),
					),
				).toBe(true);
			}
			expect(events).toContainEqual({ type: "complete", ok: true });
			const config = loadConfig(paths, { createIfMissing: false });
			expect(config.tts.python).toBe(kokoroManagedPython(paths));
			expect(config.tts.kokoroScript).toBe(kokoroManagedScript(paths));
			expect(readFileSync(kokoroManagedScript(paths), "utf8")).toBe(
				readFileSync(join(resourceRoot, "kokoro_tts_service.py"), "utf8"),
			);
			expect(runs.map((run) => [run.cmd, ...run.args])).toEqual([
				["uv", "venv", ".venv"],
				[
					"uv",
					"pip",
					"install",
					"--python",
					kokoroManagedPython(paths),
					"-r",
					join(resourceRoot, "requirements.txt"),
				],
				expect.arrayContaining([kokoroManagedPython(paths), "-c"]),
			]);
			const modelRun = runs.at(-1);
			expect(modelRun?.env?.HF_HOME).toBe(
				join(kokoroManagedHome(paths), "models", "huggingface"),
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup fails before config mutation when uv is missing", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const before = loadConfig(paths);
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({ commandExists: async () => false }),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("uv is required");
			const after = loadConfig(paths, { createIfMissing: false });
			expect(after.tts).toEqual(before.tts);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro status is read-only and reports bundled resource availability", () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const status = buildKokoroStatus(paths);
			expect(status.managedHome).toBe(join(home, "kokoro"));
			expect(status.installed).toBe(false);
			expect(status.resourceScriptExists).toBe(true);
			expect(existsSync(paths.config)).toBe(false);
			expect(existsSync(status.managedHome)).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup refuses a concurrent managed install", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(kokoroManagedHome(paths), { recursive: true });
			writeFileSync(
				join(kokoroManagedHome(paths), "setup.lock"),
				`${process.pid}\n`,
			);
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});
			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("already running");
			expect(existsSync(join(kokoroManagedHome(paths), "setup.lock"))).toBe(
				true,
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup removes a stale empty setup lock and proceeds", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(kokoroManagedHome(paths), { recursive: true });
			writeFileSync(join(kokoroManagedHome(paths), "setup.lock"), "");

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});

			expect(outcome.ok).toBe(true);
			expect(existsSync(join(kokoroManagedHome(paths), "setup.lock"))).toBe(
				false,
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup updates only managed TTS config fields", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const before = {
				...defaultConfig,
				enabled: false,
				summarizer: { ...defaultConfig.summarizer, timeoutSeconds: 12 },
				tts: {
					...defaultConfig.tts,
					python: "python3.12",
					kokoroScript: "/manual/kokoro.py",
					voice: "af_sky",
				},
			};
			saveConfig(paths, before);

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});

			expect(outcome.ok).toBe(true);
			const after = loadConfig(paths, { createIfMissing: false });
			expect(after).toEqual({
				...before,
				tts: {
					...before.tts,
					python: kokoroManagedPython(paths),
					kokoroScript: kokoroManagedScript(paths),
				},
			});
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup is safe to repeat", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const first = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});
			const firstConfig = loadConfig(paths, { createIfMissing: false });
			const second = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});
			const secondConfig = loadConfig(paths, { createIfMissing: false });

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			expect(secondConfig).toEqual(firstConfig);
			expect(existsSync(kokoroManagedScript(paths))).toBe(true);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro service smoke test exercises synthesis after readiness", async () => {
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

	test("kokoro service smoke test rejects ready-only services", async () => {
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

	test("kokoro setup reports smoke-test failure and leaves config unchanged", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const before = loadConfig(paths);
			const events: KokoroSetupEvent[] = [];
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					smokeTest: async () => ({
						ok: false,
						error: "service never became ready",
					}),
				}),
				emit: (event) => events.push(event),
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("service never became ready");
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "step",
					id: "smoke-test",
					status: "failed",
				}),
			);
			expect(loadConfig(paths, { createIfMissing: false }).tts).toEqual(
				before.tts,
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup refuses to overwrite a managed symlink", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(kokoroManagedHome(paths), { recursive: true });
			symlinkSync(join(home, "outside.py"), kokoroManagedScript(paths));

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain(
				"Refusing to overwrite unsafe managed path",
			);
			expect(
				loadConfig(paths, { createIfMissing: false }).tts.kokoroScript,
			).toBe(defaultConfig.tts.kokoroScript);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup refuses a managed virtualenv symlink", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(kokoroManagedHome(paths), { recursive: true });
			symlinkSync(join(home, "outside-venv"), join(kokoroManagedHome(paths), ".venv"));

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Refusing to use unsafe managed path");
			expect(
				loadConfig(paths, { createIfMissing: false }).tts.kokoroScript,
			).toBe(defaultConfig.tts.kokoroScript);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro status reports missing bundled resource script", () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const status = buildKokoroStatus(paths, {
				resourceRoot: join(home, "missing-resources"),
			});
			expect(status.resourceScriptExists).toBe(false);
			expect(
				status.checks.find((check) => check.id === "resourceScript.exists")?.ok,
			).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
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

			expect(
				existsSync(join(bundledKokoroRoot, "kokoro_tts_service.py")),
			).toBe(true);
			expect(existsSync(join(bundledKokoroRoot, "requirements.txt"))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 120_000);
});

describe("Kokoro setup CLI", () => {
	test("CLI kokoro status returns managed status json", async () => {
		const home = tempHome();
		try {
			const result = await runCli(["kokoro", "status", "--json"], {
				env: { AGENT_VOICE_HOME: home },
			});
			expect(result.exitCode).toBe(0);
			const payload = JSON.parse(result.stdout);
			expect(payload.managedHome).toBe(join(home, "kokoro"));
			expect(payload.installed).toBe(false);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("CLI kokoro setup --jsonl emits json lines", async () => {
		const home = tempHome();
		try {
			const result = await runCli(["kokoro", "setup", "--jsonl"], {
				env: { AGENT_VOICE_HOME: home },
				kokoroSetupDeps: fakeDeps(),
			});
			expect(result.exitCode).toBe(0);
			const lines = result.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(lines.at(-1)).toMatchObject({ type: "complete", ok: true });
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("CLI kokoro setup --jsonl streams only parseable JSON lines", async () => {
		const home = tempHome();
		try {
			const chunks: string[] = [];
			const result = await runCli(["kokoro", "setup", "--jsonl"], {
				env: { AGENT_VOICE_HOME: home },
				kokoroSetupDeps: fakeDeps({
					run: async (request) => {
						if (
							request.cmd === "uv" &&
							request.args[0] === "venv" &&
							request.cwd
						) {
							const binDir = join(request.cwd, ".venv", "bin");
							mkdirSync(binDir, { recursive: true });
							writeFileSync(join(binDir, "python"), "#!/bin/sh\n", "utf8");
						}
						return {
							ok: true,
							stdout: "raw child stdout that is not JSON",
							stderr: "raw child stderr that is not JSON",
						};
					},
				}),
				writeStdout: async (chunk) => {
					chunks.push(chunk);
				},
			});

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			const events = chunks
				.join("")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(events.some((event) => event.type === "log")).toBe(true);
			expect(events.at(-1)).toMatchObject({ type: "complete", ok: true });
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("CLI kokoro setup --jsonl exits 1 on setup failure", async () => {
		const home = tempHome();
		try {
			const result = await runCli(["kokoro", "setup", "--jsonl"], {
				env: { AGENT_VOICE_HOME: home },
				kokoroSetupDeps: fakeDeps({ commandExists: async () => false }),
			});
			expect(result.exitCode).toBe(1);
			const lines = result.stdout
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line));
			expect(lines.at(-1)).toMatchObject({
				type: "complete",
				ok: false,
			});
			expect(lines.at(-1).error).toContain("uv is required");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
