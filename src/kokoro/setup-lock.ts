import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AgentVoicePaths } from "../paths";
import {
	assertManagedChild,
	assertManagedRoot,
	kokoroSetupLockPath,
	lstatIfExists,
} from "./managed-paths";

function processExists(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return false;
		if (code === "EPERM") return true;
		return true;
	}
}

function removeStaleSetupLock(lockPath: string): boolean {
	const stat = lstatIfExists(lockPath);
	if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;

	const pidText = readFileSync(lockPath, "utf8").trim();
	if (!pidText) {
		rmSync(lockPath, { force: true });
		return true;
	}

	const pid = Number(pidText);
	if (!Number.isInteger(pid) || processExists(pid)) return false;

	rmSync(lockPath, { force: true });
	return true;
}

function openSetupLock(lockPath: string): number {
	try {
		return openSync(lockPath, "wx");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EEXIST") {
			throw new Error(
				"Kokoro setup is already running for this Agent Voice home",
			);
		}
		throw error;
	}
}

export function acquireSetupLock(paths: AgentVoicePaths): () => void {
	assertManagedRoot(paths);
	const lockPath = kokoroSetupLockPath(paths);
	assertManagedChild(paths, lockPath);
	let fd: number;
	try {
		fd = openSetupLock(lockPath);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("already running") &&
			removeStaleSetupLock(lockPath)
		) {
			fd = openSetupLock(lockPath);
		} else {
			throw error;
		}
	}

	let closed = false;
	try {
		writeFileSync(fd, `${process.pid}\n`, "utf8");
	} catch (error) {
		closeSync(fd);
		rmSync(lockPath, { force: true });
		throw error;
	}

	return () => {
		if (!closed) {
			closed = true;
			closeSync(fd);
		}
		rmSync(lockPath, { force: true });
	};
}
