import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createEvent } from "../src/events";
import { resolvePaths } from "../src/paths";
import {
	cleanupRetention,
	enqueueEvent,
	ensureHome,
	listJobs,
	moveJob,
	writeJob,
} from "../src/spool";

async function withTempHome<T>(
	fn: (home: string) => T | Promise<T>,
): Promise<T> {
	const home = mkdtempSync(join(tmpdir(), "agent-voice-spool-test-"));
	try {
		return await fn(home);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

describe("agent-voice spool", () => {
	test("ensureHome creates all spool directories", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });

			ensureHome(paths);

			expect(existsSync(paths.spool.root)).toBe(true);
			expect(existsSync(paths.spool.incoming)).toBe(true);
			expect(existsSync(paths.spool.processing)).toBe(true);
			expect(existsSync(paths.spool.done)).toBe(true);
			expect(existsSync(paths.spool.failed)).toBe(true);
			expect(existsSync(paths.spool.skipped)).toBe(true);
			expect(existsSync(paths.logs)).toBe(true);
			expect(existsSync(paths.run)).toBe(true);
			expect(existsSync(paths.backups)).toBe(true);
		});
	});

	test("ensureHome rejects managed spool directories that are symlinks", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			ensureHome(paths);
			const outsideDir = join(home, "outside-incoming");
			mkdirSync(outsideDir);
			rmSync(paths.spool.incoming, { recursive: true, force: true });
			symlinkSync(outsideDir, paths.spool.incoming);

			expect(() => ensureHome(paths)).toThrow(
				"Managed directory cannot be a symlink",
			);
			expect(() =>
				enqueueEvent(
					paths,
					createEvent({ agent: "claude", text: "No escape." }),
				),
			).toThrow("Managed directory cannot be a symlink");
			expect(readdirSync(outsideDir)).toEqual([]);
		});
	});

	test("ensureHome rejects caller-provided spool paths outside the managed root", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const outsideDir = join(home, "outside-incoming");
			const unsafePaths = {
				...paths,
				spool: { ...paths.spool, incoming: outsideDir },
			};

			expect(() => ensureHome(unsafePaths)).toThrow(
				"Invalid managed spool path",
			);
			expect(() => listJobs(unsafePaths, "incoming")).toThrow(
				"Invalid managed spool path",
			);
			expect(() =>
				enqueueEvent(
					unsafePaths,
					createEvent({ agent: "claude", text: "No escape." }),
				),
			).toThrow("Invalid managed spool path");
			expect(existsSync(outsideDir)).toBe(false);
		});
	});

	test("ensureHome rejects intermediate symlinks in managed spool paths", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			ensureHome(paths);
			const outsideDir = join(home, "outside-parent");
			const linkedParent = join(paths.spool.root, "linked-parent");
			mkdirSync(outsideDir);
			symlinkSync(outsideDir, linkedParent);
			const unsafePaths = {
				...paths,
				spool: {
					...paths.spool,
					incoming: join(linkedParent, "incoming"),
				},
			};

			expect(() => ensureHome(unsafePaths)).toThrow(
				"Managed path cannot traverse a symlink",
			);
			expect(existsSync(join(outsideDir, "incoming"))).toBe(false);
		});
	});

	test("ensureHome rejects duplicate managed spool state directories", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const unsafePaths = {
				...paths,
				spool: { ...paths.spool, processing: paths.spool.incoming },
			};

			expect(() => ensureHome(unsafePaths)).toThrow(
				"Duplicate managed spool path",
			);
		});
	});

	test("enqueueEvent writes one atomic incoming file with sortable event filename", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Done." });

			const filePath = enqueueEvent(paths, event);

			const incomingFiles = readdirSync(paths.spool.incoming);
			expect(incomingFiles).toHaveLength(1);
			expect(filePath).toBe(join(paths.spool.incoming, incomingFiles[0]));
			expect(basename(filePath)).toMatch(/^\d{8}T\d{6}\.\d{3}Z_claude_/);
			expect(basename(filePath)).toContain(event.id);
			expect(
				readdirSync(paths.spool.incoming).some((name) =>
					name.startsWith(".tmp-"),
				),
			).toBe(false);
			expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual(event);
		});
	});

	test("enqueueEvent never clobbers an existing incoming event file", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "claude", text: "Duplicate." });

			const firstPath = enqueueEvent(paths, event);
			const secondPath = enqueueEvent(paths, event);

			expect(secondPath).not.toBe(firstPath);
			expect(existsSync(firstPath)).toBe(true);
			expect(existsSync(secondPath)).toBe(true);
			expect(listJobs(paths, "incoming")).toHaveLength(2);
			expect(
				readdirSync(paths.spool.incoming).some((name) =>
					name.startsWith(".tmp-"),
				),
			).toBe(false);
		});
	});

	test("writeJob and listJobs write sorted jobs for a target state", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const newer = createEvent({ agent: "codex", text: "Second." });
			const older = createEvent({ agent: "pi", text: "First." });

			const newerPath = writeJob(paths, "processing", newer, {
				createdAt: "2026-06-12T00:00:02.000Z",
			});
			const olderPath = writeJob(paths, "processing", older, {
				createdAt: "2026-06-12T00:00:01.000Z",
			});

			expect(listJobs(paths, "processing")).toEqual([olderPath, newerPath]);
			expect(
				readdirSync(paths.spool.processing).some((name) =>
					name.startsWith(".tmp-"),
				),
			).toBe(false);
		});
	});

	test("writeJob never clobbers an existing job with the same event id and timestamp", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "codex", text: "Same event." });
			const createdAt = "2026-06-12T00:00:01.000Z";

			const firstPath = writeJob(paths, "processing", event, { createdAt });
			const secondPath = writeJob(paths, "processing", event, { createdAt });

			expect(secondPath).not.toBe(firstPath);
			expect(existsSync(firstPath)).toBe(true);
			expect(existsSync(secondPath)).toBe(true);
			expect(listJobs(paths, "processing")).toHaveLength(2);
		});
	});

	test("writeJob skips a target filename while that job lock is held", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			ensureHome(paths);
			const event = createEvent({ agent: "codex", text: "Locked target." });
			const createdAt = "2026-06-12T00:00:01.000Z";
			const lockedName = `20260612T000001.000Z_codex_${event.id}.json`;
			const lockPath = join(paths.spool.processing, `.lock-${lockedName}`);
			mkdirSync(lockPath);

			const writtenPath = writeJob(paths, "processing", event, { createdAt });

			expect(basename(writtenPath)).toBe(
				`20260612T000001.000Z_codex_${event.id}_001.json`,
			);
			expect(existsSync(lockPath)).toBe(true);
			expect(listJobs(paths, "processing")).toEqual([writtenPath]);
		});
	});

	test("enqueueEvent and writeJob reject unsafe job identity before writing", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "codex", text: "Unsafe." });

			expect(() => enqueueEvent(paths, { ...event, id: "../outside" })).toThrow(
				"Invalid job id",
			);
			expect(() =>
				writeJob(paths, "processing", { ...event, agent: "unknown" }),
			).toThrow("Invalid job agent");
			expect(listJobs(paths, "incoming")).toEqual([]);
			expect(listJobs(paths, "processing")).toEqual([]);
		});
	});

	test("moveJob atomically moves a job between states", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const event = createEvent({ agent: "opencode", text: "Done." });
			const incomingPath = enqueueEvent(paths, event);

			const processingPath = moveJob(paths, incomingPath, "processing");

			expect(existsSync(incomingPath)).toBe(false);
			expect(existsSync(processingPath)).toBe(true);
			expect(processingPath).toBe(
				join(paths.spool.processing, basename(incomingPath)),
			);
			expect(listJobs(paths, "processing")).toEqual([processingPath]);
		});
	});

	test("moveJob rejects files outside managed spool state directories", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			ensureHome(paths);
			const outsidePath = join(home, "outside.json");
			writeFileSync(outsidePath, "{}\n", "utf8");

			expect(() => moveJob(paths, outsidePath, "processing")).toThrow(
				"outside spool state directories",
			);
			expect(existsSync(outsidePath)).toBe(true);
			expect(listJobs(paths, "processing")).toEqual([]);
		});
	});

	test("moveJob rejects nested or invalid spool job paths", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			ensureHome(paths);
			const validJob = enqueueEvent(
				paths,
				createEvent({ agent: "opencode", text: "Done." }),
			);
			const nestedPath = join(
				paths.spool.incoming,
				"nested",
				basename(validJob),
			);
			mkdirSync(dirname(nestedPath), { recursive: true });
			writeFileSync(nestedPath, "{}\n", "utf8");
			const invalidNamePath = join(paths.spool.incoming, "not-a-job.json");
			writeFileSync(invalidNamePath, "{}\n", "utf8");

			expect(() => moveJob(paths, nestedPath, "processing")).toThrow(
				"direct spool job",
			);
			expect(() => moveJob(paths, invalidNamePath, "processing")).toThrow(
				"Invalid spool job filename",
			);
		});
	});

	test("moveJob rejects symlink spool entries", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			ensureHome(paths);
			const outsidePath = join(home, "outside-target.json");
			writeFileSync(outsidePath, "{}\n", "utf8");
			const event = createEvent({ agent: "pi", text: "Symlink." });
			const symlinkPath = join(
				paths.spool.incoming,
				`20260612T000001.000Z_pi_${event.id}.json`,
			);
			symlinkSync(outsidePath, symlinkPath);

			expect(() => moveJob(paths, symlinkPath, "processing")).toThrow(
				"regular file",
			);
			expect(existsSync(outsidePath)).toBe(true);
			expect(listJobs(paths, "incoming")).toEqual([]);
		});
	});

	test("moveJob refuses to overwrite an existing target job", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const incomingPath = enqueueEvent(
				paths,
				createEvent({ agent: "opencode", text: "Done." }),
			);
			const targetPath = join(paths.spool.processing, basename(incomingPath));
			writeFileSync(targetPath, "{}\n", "utf8");

			expect(() => moveJob(paths, incomingPath, "processing")).toThrow(
				"already exists",
			);
			expect(existsSync(incomingPath)).toBe(true);
			expect(existsSync(targetPath)).toBe(true);
		});
	});

	test("moveJob refuses to overwrite a dangling symlink target", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const incomingPath = enqueueEvent(
				paths,
				createEvent({ agent: "opencode", text: "Dangling target." }),
			);
			const targetPath = join(paths.spool.processing, basename(incomingPath));
			symlinkSync(join(home, "missing-target"), targetPath);

			expect(() => moveJob(paths, incomingPath, "processing")).toThrow(
				"already exists",
			);
			expect(existsSync(incomingPath)).toBe(true);
			expect(listJobs(paths, "processing")).toEqual([]);
		});
	});

	test("moveJob refuses to move while the target job lock is held", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const incomingPath = enqueueEvent(
				paths,
				createEvent({ agent: "opencode", text: "Locked." }),
			);
			const targetPath = join(paths.spool.processing, basename(incomingPath));
			mkdirSync(
				join(paths.spool.processing, `.lock-${basename(incomingPath)}`),
			);

			expect(() => moveJob(paths, incomingPath, "processing")).toThrow(
				"locked",
			);
			expect(existsSync(incomingPath)).toBe(true);
			expect(existsSync(targetPath)).toBe(false);
		});
	});

	test("moveJob refuses to move while the source job lock is held", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const incomingPath = enqueueEvent(
				paths,
				createEvent({ agent: "opencode", text: "Source locked." }),
			);
			mkdirSync(join(paths.spool.incoming, `.lock-${basename(incomingPath)}`));

			expect(() => moveJob(paths, incomingPath, "processing")).toThrow(
				"locked",
			);
			expect(existsSync(incomingPath)).toBe(true);
			expect(listJobs(paths, "incoming")).toEqual([]);
		});
	});

	test("cleanupRetention rejects invalid retention values without deleting jobs", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const oldDone = writeJob(
				paths,
				"done",
				createEvent({ agent: "claude", text: "Old done." }),
			);
			const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
			utimesSync(oldDone, oldTime, oldTime);

			expect(() => cleanupRetention(paths, -1)).toThrow(
				"Invalid retentionDays",
			);
			expect(() => cleanupRetention(paths, Number.NaN)).toThrow(
				"Invalid retentionDays",
			);
			expect(existsSync(oldDone)).toBe(true);
		});
	});

	test("cleanupRetention deletes only old terminal-state records", async () => {
		await withTempHome((home) => {
			const paths = resolvePaths({ AGENT_VOICE_HOME: home });
			const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
			const freshTime = new Date();

			const oldDone = writeJob(
				paths,
				"done",
				createEvent({ agent: "claude", text: "Old done." }),
			);
			const oldFailed = writeJob(
				paths,
				"failed",
				createEvent({ agent: "codex", text: "Old failed." }),
			);
			const oldSkipped = writeJob(
				paths,
				"skipped",
				createEvent({ agent: "pi", text: "Old skipped." }),
			);
			const oldIncoming = writeJob(
				paths,
				"incoming",
				createEvent({ agent: "opencode", text: "Old incoming." }),
			);
			const freshDone = writeJob(
				paths,
				"done",
				createEvent({ agent: "claude", text: "Fresh done." }),
			);
			const invalidTerminalFile = join(paths.spool.done, "not-a-job.json");

			for (const filePath of [oldDone, oldFailed, oldSkipped, oldIncoming]) {
				utimesSync(filePath, oldTime, oldTime);
			}
			utimesSync(freshDone, freshTime, freshTime);
			writeFileSync(invalidTerminalFile, "{}\n", "utf8");
			utimesSync(invalidTerminalFile, oldTime, oldTime);

			const removed = cleanupRetention(paths, 7);

			expect(removed.sort()).toEqual([oldDone, oldFailed, oldSkipped].sort());
			expect(existsSync(oldDone)).toBe(false);
			expect(existsSync(oldFailed)).toBe(false);
			expect(existsSync(oldSkipped)).toBe(false);
			expect(existsSync(oldIncoming)).toBe(true);
			expect(existsSync(freshDone)).toBe(true);
			expect(existsSync(invalidTerminalFile)).toBe(true);
		});
	});
});
