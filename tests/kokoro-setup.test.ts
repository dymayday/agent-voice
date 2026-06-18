import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
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
const fakeUvArchive = "fake uv archive";
const fakeUvRelease = {
	version: "test-uv-version",
	target: "uv-test-target",
	checksum: createHash("sha256").update(fakeUvArchive).digest("hex"),
};

function tempHome(): string {
	return mkdtempSync(join(tmpdir(), "agent-voice-kokoro-setup-"));
}

function expectKokoroSetupFailure(
	outcome: KokoroSetupRunResult,
): Extract<KokoroSetupRunResult, { ok: false }> {
	expect(outcome.ok).toBe(false);
	if (outcome.ok) {
		throw new Error("Expected Kokoro setup to fail");
	}
	return outcome;
}

function createFakeUvArchive(
	request: Parameters<KokoroSetupDeps["run"]>[0],
): void {
	const outputIndex = request.args.indexOf("-o");
	const outputPath =
		outputIndex === -1 ? undefined : request.args[outputIndex + 1];
	if (!outputPath) throw new Error("Fake curl request missing -o path");
	writeFileSync(outputPath, fakeUvArchive, "utf8");
}

function extractFakeUvArchive(
	request: Parameters<KokoroSetupDeps["run"]>[0],
): void {
	const targetIndex = request.args.indexOf("-C");
	const targetDir =
		targetIndex === -1 ? undefined : request.args[targetIndex + 1];
	if (!targetDir) throw new Error("Fake tar request missing -C path");
	const extractedDir = join(targetDir, fakeUvRelease.target);
	mkdirSync(extractedDir, { recursive: true });
	const uvPath = join(extractedDir, "uv");
	writeFileSync(uvPath, "#!/bin/sh\n", "utf8");
	chmodSync(uvPath, 0o755);
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

function fakeDepsFailingIfVenvRuns(
	commands: Array<Parameters<KokoroSetupDeps["run"]>[0]>,
): KokoroSetupDeps {
	return fakeDeps({
		run: async (request) => {
			commands.push(request);
			if (request.cmd === "uv" && request.args[0] === "venv") {
				return {
					ok: false,
					stdout: "uv 0.11.20",
					stderr: "A virtual environment already exists at: .venv",
					exitCode: 2,
				};
			}
			return { ok: true, stdout: "ok", stderr: "" };
		},
	});
}

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
					"--quiet",
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

	test("kokoro setup suppresses known third-party Python warning noise", async () => {
		const home = tempHome();
		const pythonEnvs: Record<string, string>[] = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const pythonPath = kokoroManagedPython(paths);
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
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
						if (request.cmd === pythonPath) {
							pythonEnvs.push(request.env ?? {});
						}
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
			});

			expect(outcome.ok).toBe(true);
			expect(pythonEnvs.length).toBeGreaterThan(0);
			const pythonWarnings = pythonEnvs[0]?.PYTHONWARNINGS ?? "";
			expect(pythonWarnings).toContain("dropout option adds dropout");
			expect(pythonWarnings).toContain("torch.nn.utils.weight_norm");
			expect(pythonEnvs[0]?.HF_HUB_VERBOSITY).toBe("error");

			const warningsResult = spawnSync(
				process.env.PYTHON ?? "python3",
				[
					"-c",
					[
						"import warnings",
						'warnings.warn_explicit("dropout option adds dropout after all but last recurrent layer", UserWarning, "rnn.py", 1009, module="torch.nn.modules.rnn")',
						'warnings.warn_explicit("`torch.nn.utils.weight_norm` is deprecated in favor of `torch.nn.utils.parametrizations.weight_norm`.", FutureWarning, "weight_norm.py", 144, module="torch.nn.utils.weight_norm")',
						'print("ok")',
					].join("\n"),
				],
				{
					encoding: "utf8",
					env: { ...process.env, PYTHONWARNINGS: pythonWarnings },
				},
			);
			expect(warningsResult.status, warningsResult.stderr).toBe(0);
			expect(warningsResult.stdout.trim()).toBe("ok");
			expect(warningsResult.stderr).toBe("");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup installs managed uv when uv is missing from PATH", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const managedUv = join(kokoroManagedHome(paths), "bin", "uv");
			const outcome = await runKokoroSetup(paths, {
				uvRelease: fakeUvRelease,
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						if (request.cmd === "curl") createFakeUvArchive(request);
						if (request.cmd === "tar") extractFakeUvArchive(request);
						if (
							request.cmd === managedUv &&
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
				emit: () => {},
			});

			expect(outcome.ok).toBe(true);
			expect(runs[0]?.cmd).toBe("curl");
			expect(runs[0]?.args).toEqual(
				expect.arrayContaining(["--proto", "=https", "--tlsv1.2"]),
			);
			expect(runs[0]?.args.at(-1)).toBe(
				"https://github.com/astral-sh/uv/releases/download/test-uv-version/uv-test-target.tar.gz",
			);
			expect(runs.map((run) => [run.cmd, ...run.args]).slice(1)).toEqual([
				expect.arrayContaining(["tar", "-xzf"]),
				[managedUv, "--version"],
				[managedUv, "venv", ".venv"],
				[
					managedUv,
					"pip",
					"install",
					"--quiet",
					"--python",
					kokoroManagedPython(paths),
					"-r",
					join(resourceRoot, "requirements.txt"),
				],
				expect.arrayContaining([kokoroManagedPython(paths), "-c"]),
			]);
			const modelRun = runs.at(-1);
			const pathEntries = (modelRun?.env?.PATH ?? "").split(delimiter);
			expect(pathEntries).toContain(join(kokoroManagedHome(paths), "bin"));
			expect(pathEntries).toContain(
				join(kokoroManagedHome(paths), ".venv", "bin"),
			);
			expect(modelRun?.env?.VIRTUAL_ENV).toBe(
				join(kokoroManagedHome(paths), ".venv"),
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup fails before config mutation when managed uv install fails", async () => {
		const home = tempHome();
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const before = loadConfig(paths);
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						if (request.cmd === "curl") {
							return {
								ok: false,
								stdout: "",
								stderr: "network down",
								exitCode: 1,
							};
						}
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("network down");
			const after = loadConfig(paths, { createIfMissing: false });
			expect(after.tts).toEqual(before.tts);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup rejects managed uv checksum mismatch before extraction", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		const events: KokoroSetupEvent[] = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const before = loadConfig(paths);
			const outcome = await runKokoroSetup(paths, {
				uvRelease: { ...fakeUvRelease, checksum: "0".repeat(64) },
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						if (request.cmd === "curl") createFakeUvArchive(request);
						if (request.cmd === "tar") extractFakeUvArchive(request);
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: (event) => events.push(event),
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("checksum mismatch");
			expect(runs.map((run) => run.cmd)).toEqual(["curl"]);
			expect(events.at(-1)).toMatchObject({ type: "complete", ok: false });
			expect(loadConfig(paths, { createIfMissing: false }).tts).toEqual(
				before.tts,
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup reports managed uv validation failure after install", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const managedUv = join(kokoroManagedHome(paths), "bin", "uv");
			const outcome = await runKokoroSetup(paths, {
				uvRelease: fakeUvRelease,
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						if (request.cmd === "curl") createFakeUvArchive(request);
						if (request.cmd === "tar") extractFakeUvArchive(request);
						if (request.cmd === managedUv && request.args[0] === "--version") {
							return { ok: false, stdout: "", stderr: "bad uv", exitCode: 1 };
						}
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("bad uv");
			expect(runs.map((run) => [run.cmd, ...run.args])).toEqual([
				expect.arrayContaining(["curl"]),
				expect.arrayContaining(["tar", "-xzf"]),
				[managedUv, "--version"],
			]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup preflights local inputs before managed uv download", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(kokoroManagedHome(paths), { recursive: true });
			symlinkSync(
				join(home, "outside-venv"),
				join(kokoroManagedHome(paths), ".venv"),
			);

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Refusing to use unsafe managed path");
			expect(runs).toEqual([]);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup rejects a non-executable managed uv before dependency commands", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const binDir = join(kokoroManagedHome(paths), "bin");
			const managedUv = join(binDir, "uv");
			mkdirSync(binDir, { recursive: true });
			writeFileSync(managedUv, "not executable", "utf8");
			chmodSync(managedUv, 0o644);

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Managed uv is not executable");
			expect(runs).toEqual([]);
			expect(loadConfig(paths, { createIfMissing: false }).tts).toEqual(
				defaultConfig.tts,
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup revalidates managed uv before dependency commands", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const managedUv = join(kokoroManagedHome(paths), "bin", "uv");
			const outcome = await runKokoroSetup(paths, {
				uvRelease: fakeUvRelease,
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						if (request.cmd === "curl") createFakeUvArchive(request);
						if (request.cmd === "tar") extractFakeUvArchive(request);
						if (request.cmd === managedUv && request.args[0] === "--version") {
							rmSync(managedUv, { force: true });
							symlinkSync(join(home, "outside-uv"), managedUv);
						}
						return { ok: true, stdout: "uv 0.9.0", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Refusing to use unsafe managed path");
			expect(runs.map((run) => [run.cmd, ...run.args])).toEqual([
				expect.arrayContaining(["curl"]),
				expect.arrayContaining(["tar", "-xzf"]),
				[managedUv, "--version"],
			]);
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
		const secondRunEvents: KokoroSetupEvent[] = [];
		const secondRunCommands: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const first = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: () => {},
			});
			const firstConfig = loadConfig(paths, { createIfMissing: false });
			const second = await runKokoroSetup(paths, {
				deps: fakeDepsFailingIfVenvRuns(secondRunCommands),
				emit: (event) => secondRunEvents.push(event),
			});
			const secondConfig = loadConfig(paths, { createIfMissing: false });

			expect(first.ok).toBe(true);
			expect(second.ok).toBe(true);
			expect(secondConfig).toEqual(firstConfig);
			expect(existsSync(kokoroManagedScript(paths))).toBe(true);
			expect(
				secondRunCommands.map((run) => run.args.slice(0, 2)),
			).not.toContainEqual(["venv", ".venv"]);
			expect(secondRunEvents).toContainEqual(
				expect.objectContaining({
					type: "step",
					id: "venv",
					status: "skipped",
				}),
			);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup explains the first model download before preloading assets", async () => {
		const home = tempHome();
		const events: KokoroSetupEvent[] = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps(),
				emit: (event) => events.push(event),
			});

			expect(outcome.ok).toBe(true);
			const modelRunningIndex = events.findIndex(
				(event) =>
					event.type === "step" &&
					event.id === "model" &&
					event.status === "running",
			);
			const modelDoneIndex = events.findIndex(
				(event) =>
					event.type === "step" &&
					event.id === "model" &&
					event.status === "done",
			);
			const explanatoryLogIndex = events.findIndex(
				(event) =>
					event.type === "log" &&
					event.message.includes("first run can take several minutes"),
			);

			expect(modelRunningIndex).toBeGreaterThanOrEqual(0);
			expect(explanatoryLogIndex).toBeGreaterThan(modelRunningIndex);
			expect(explanatoryLogIndex).toBeLessThan(modelDoneIndex);
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

	test("kokoro setup refuses a managed uv symlink", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const binDir = join(kokoroManagedHome(paths), "bin");
			mkdirSync(binDir, { recursive: true });
			symlinkSync(join(home, "outside-uv"), join(binDir, "uv"));

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					commandExists: async () => false,
					run: async (request) => {
						runs.push(request);
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Refusing to use unsafe managed path");
			expect(runs).toEqual([]);
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
			symlinkSync(
				join(home, "outside-venv"),
				join(kokoroManagedHome(paths), ".venv"),
			);

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

	test("kokoro setup refuses a managed models symlink before dependency commands", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			mkdirSync(kokoroManagedHome(paths), { recursive: true });
			symlinkSync(
				join(home, "outside-models"),
				join(kokoroManagedHome(paths), "models"),
			);

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					run: async (request) => {
						runs.push(request);
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Refusing to use unsafe managed path");
			expect(runs).toEqual([]);
			expect(
				loadConfig(paths, { createIfMissing: false }).tts.kokoroScript,
			).toBe(defaultConfig.tts.kokoroScript);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("kokoro setup refuses a managed Hugging Face cache symlink before dependency commands", async () => {
		const home = tempHome();
		const runs: Array<Parameters<KokoroSetupDeps["run"]>[0]> = [];
		try {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const modelsHome = join(kokoroManagedHome(paths), "models");
			mkdirSync(modelsHome, { recursive: true });
			symlinkSync(
				join(home, "outside-hf-cache"),
				join(modelsHome, "huggingface"),
			);

			const outcome = await runKokoroSetup(paths, {
				deps: fakeDeps({
					run: async (request) => {
						runs.push(request);
						return { ok: true, stdout: "ok", stderr: "" };
					},
				}),
				emit: () => {},
			});

			const failure = expectKokoroSetupFailure(outcome);
			expect(failure.error).toContain("Refusing to use unsafe managed path");
			expect(runs).toEqual([]);
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

});
