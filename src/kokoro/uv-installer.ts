import { createHash } from "node:crypto";
import {
	chmodSync,
	copyFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentVoicePaths } from "../paths";
import {
	DEFAULT_COMMAND_TIMEOUT_MS,
	runChecked,
	type KokoroCommandDeps,
	type KokoroLogEmitter,
} from "./commands";
import {
	assertManagedChild,
	assertManagedUvExecutable,
	assertSafeOverwrite,
	ensureManagedDirectory,
	kokoroManagedBin,
	kokoroManagedUv,
	lstatIfExists,
} from "./managed-paths";

const MANAGED_UV_VERSION = "0.11.20";

export interface UvReleaseAsset {
	version: string;
	target: string;
	checksum: string;
}

interface UvInstallerDeps extends KokoroCommandDeps {
	commandExists(command: string): Promise<boolean>;
}

const MANAGED_UV_RELEASES: Record<string, UvReleaseAsset> = {
	"darwin-arm64": {
		version: MANAGED_UV_VERSION,
		target: "uv-aarch64-apple-darwin",
		checksum:
			"0a2b6a757d5693671a7ce0002554ae869604e1e69acb10313ac14d08374be01a",
	},
	"darwin-x64": {
		version: MANAGED_UV_VERSION,
		target: "uv-x86_64-apple-darwin",
		checksum:
			"bef01a86faab997f6022b45cfa29bfc5b090f2f72cd4a91d2ecefe641efdabe7",
	},
	"linux-arm64": {
		version: MANAGED_UV_VERSION,
		target: "uv-aarch64-unknown-linux-gnu",
		checksum:
			"c8b5b7f9c804b640da0bb66cddddf0a00ce971f64d8076622d70bd141bc80857",
	},
	"linux-x64": {
		version: MANAGED_UV_VERSION,
		target: "uv-x86_64-unknown-linux-gnu",
		checksum:
			"5de211d9278af365497d387e25316907b3b4a9f25b4476dd6dbf238d6f85cff3",
	},
};

export function resolveUvRelease(
	override?: UvReleaseAsset,
): UvReleaseAsset {
	if (override) return override;
	const key = `${process.platform}-${process.arch}`;
	const release = MANAGED_UV_RELEASES[key];
	if (!release) {
		throw new Error(
			`Automatic managed uv install is unsupported on ${process.platform}/${process.arch}. Install uv manually and rerun setup.`,
		);
	}
	return release;
}

function uvArchiveName(release: UvReleaseAsset): string {
	return `${release.target}.tar.gz`;
}

function uvArchiveUrl(release: UvReleaseAsset): string {
	return `https://github.com/astral-sh/uv/releases/download/${release.version}/${uvArchiveName(release)}`;
}

function verifySha256(path: string, expected: string): void {
	const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
	if (actual !== expected) {
		throw new Error(
			`Managed uv archive checksum mismatch: expected ${expected}, got ${actual}`,
		);
	}
}

function existingManagedUv(paths: AgentVoicePaths): string | undefined {
	const managedUv = kokoroManagedUv(paths);
	const stat = lstatIfExists(managedUv);
	if (!stat) return undefined;
	assertManagedUvExecutable(paths, managedUv);
	return managedUv;
}

async function validateManagedUv(
	paths: AgentVoicePaths,
	deps: KokoroCommandDeps,
	emit: KokoroLogEmitter,
): Promise<string | undefined> {
	const managedUv = existingManagedUv(paths);
	if (!managedUv) return undefined;
	await runChecked(deps, emit, {
		cmd: managedUv,
		args: ["--version"],
		timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
	});
	return existingManagedUv(paths);
}

export async function runUvChecked(
	paths: AgentVoicePaths,
	deps: KokoroCommandDeps,
	emit: KokoroLogEmitter,
	uvCommand: string,
	request: Omit<Parameters<KokoroCommandDeps["run"]>[0], "cmd">,
): Promise<void> {
	const cmd = uvCommand === "uv" ? uvCommand : existingManagedUv(paths);
	if (!cmd) {
		throw new Error(`Managed uv is missing: ${kokoroManagedUv(paths)}`);
	}
	await runChecked(deps, emit, { ...request, cmd });
}

async function installManagedUv(
	paths: AgentVoicePaths,
	deps: KokoroCommandDeps,
	emit: KokoroLogEmitter,
	release: UvReleaseAsset,
): Promise<string> {
	const installDir = kokoroManagedBin(paths);
	ensureManagedDirectory(paths, installDir);
	const existing = await validateManagedUv(paths, deps, emit);
	if (existing) return existing;

	const stagingDir = join(
		installDir,
		`.uv-download-${process.pid}-${Date.now()}`,
	);
	assertManagedChild(paths, stagingDir);
	mkdirSync(stagingDir, { recursive: true });

	try {
		const archiveName = uvArchiveName(release);
		const archivePath = join(stagingDir, archiveName);
		await runChecked(deps, emit, {
			cmd: "curl",
			args: [
				"-LfS",
				"--proto",
				"=https",
				"--tlsv1.2",
				"-o",
				archivePath,
				uvArchiveUrl(release),
			],
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});
		verifySha256(archivePath, release.checksum);

		await runChecked(deps, emit, {
			cmd: "tar",
			args: ["-xzf", archivePath, "-C", stagingDir],
			timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		});

		const extractedUv = join(stagingDir, release.target, "uv");
		assertManagedUvExecutable(paths, extractedUv);
		assertSafeOverwrite(paths, kokoroManagedUv(paths));
		copyFileSync(extractedUv, kokoroManagedUv(paths));
		chmodSync(kokoroManagedUv(paths), 0o755);
	} finally {
		rmSync(stagingDir, { recursive: true, force: true });
	}

	const installed = await validateManagedUv(paths, deps, emit);
	if (!installed) {
		throw new Error(
			`Managed uv install did not create ${kokoroManagedUv(paths)}`,
		);
	}
	return installed;
}

export async function resolveUvCommand(
	paths: AgentVoicePaths,
	deps: UvInstallerDeps,
	emit: KokoroLogEmitter,
	release: UvReleaseAsset,
): Promise<string> {
	if (await deps.commandExists("uv")) return "uv";
	return await installManagedUv(paths, deps, emit, release);
}
