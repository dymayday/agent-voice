import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Build metadata stamped into the packaged macOS app by
 * `scripts/build-macos-app.sh`. Only `buildId` is load-bearing (it gates the
 * app's version-skew daemon restart); the rest is diagnostic.
 */
export interface BuildInfo {
	buildId: string;
	commit?: string;
	version?: string;
	builtAt?: string;
}

/**
 * Read the `buildId` the build script stamped next to the bundled CLI. The file
 * lives at `<cli-dir>/build-info.json`, one level up from this module's `src/`
 * dir, so the default location resolves from `import.meta.dir`.
 *
 * Returns `null` when the file is absent or unparseable — the dev / source-tree
 * case (no build step ran), where the app intentionally suppresses the
 * version-skew auto-restart rather than thrash a daemon it cannot compare.
 */
export function readBuildId(
	buildInfoDir: string = join(import.meta.dir, ".."),
): string | null {
	const path = join(buildInfoDir, "build-info.json");
	if (!existsSync(path)) return null;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			"buildId" in parsed &&
			typeof (parsed as { buildId: unknown }).buildId === "string" &&
			(parsed as { buildId: string }).buildId.length > 0
		) {
			return (parsed as { buildId: string }).buildId;
		}
		return null;
	} catch {
		return null;
	}
}
