import { constants, accessSync, lstatSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentVoicePaths } from "../paths";

export function kokoroManagedHome(paths: AgentVoicePaths): string {
	return join(paths.home, "kokoro");
}

export function kokoroManagedScript(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "kokoro_tts_service.py");
}

export function kokoroManagedPython(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), ".venv", "bin", "python");
}

export function kokoroManagedUv(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "bin", "uv");
}

export function kokoroManagedBin(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "bin");
}

export function kokoroSetupLockPath(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "setup.lock");
}

export function kokoroModelsHome(paths: AgentVoicePaths): string {
	return join(kokoroManagedHome(paths), "models");
}

export function kokoroHuggingFaceHome(paths: AgentVoicePaths): string {
	return join(kokoroModelsHome(paths), "huggingface");
}

export function defaultResourceRoot(): string {
	return resolve(import.meta.dir, "..", "..", "resources", "kokoro");
}

export function resourcePath(root: string, ...parts: string[]): string {
	return resolve(root, ...parts);
}

export function resourceScriptPath(root: string): string {
	return resourcePath(root, "kokoro_tts_service.py");
}

export function resourceRequirementsPath(root: string): string {
	return resourcePath(root, "requirements.txt");
}

export function assertManagedChild(
	paths: AgentVoicePaths,
	target: string,
): void {
	const home = resolve(kokoroManagedHome(paths));
	const resolved = resolve(target);
	if (resolved !== home && !resolved.startsWith(`${home}/`)) {
		throw new Error(`Refusing to write outside managed Kokoro home: ${target}`);
	}
}

export function lstatIfExists(
	path: string,
): ReturnType<typeof lstatSync> | undefined {
	try {
		return lstatSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function assertExistingPathSafe(path: string): void {
	const stat = lstatIfExists(path);
	if (!stat) return;
	if (stat.isSymbolicLink()) {
		throw new Error(`Refusing to use unsafe managed path: ${path}`);
	}
}

export function assertManagedRoot(paths: AgentVoicePaths): void {
	const managedHome = kokoroManagedHome(paths);
	assertManagedChild(paths, managedHome);
	const stat = lstatIfExists(managedHome);
	if (stat) {
		if (stat.isSymbolicLink() || !stat.isDirectory()) {
			throw new Error(`Refusing to use unsafe managed path: ${managedHome}`);
		}
		return;
	}
	mkdirSync(managedHome, { recursive: true });
}

export function assertSafeOverwrite(
	paths: AgentVoicePaths,
	target: string,
): void {
	assertManagedChild(paths, target);
	const stat = lstatIfExists(target);
	if (!stat) return;
	if (stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`Refusing to overwrite unsafe managed path: ${target}`);
	}
}

export function ensureManagedDirectory(
	paths: AgentVoicePaths,
	target: string,
): void {
	assertManagedChild(paths, target);
	assertExistingPathSafe(target);
	const stat = lstatIfExists(target);
	if (stat) {
		if (!stat.isDirectory()) {
			throw new Error(`Refusing to use unsafe managed path: ${target}`);
		}
		return;
	}
	mkdirSync(target, { recursive: true });
}

export function assertSafeManagedDirectoryTarget(
	paths: AgentVoicePaths,
	target: string,
): void {
	assertManagedChild(paths, target);
	const stat = lstatIfExists(target);
	if (!stat) return;
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`Refusing to use unsafe managed path: ${target}`);
	}
}

export function assertManagedUvExecutable(
	paths: AgentVoicePaths,
	target: string,
): void {
	assertManagedChild(paths, target);
	const stat = lstatIfExists(target);
	if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
		throw new Error(`Refusing to use unsafe managed path: ${target}`);
	}
	try {
		accessSync(target, constants.X_OK);
	} catch {
		throw new Error(`Managed uv is not executable: ${target}`);
	}
}
