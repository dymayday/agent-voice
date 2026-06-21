import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const outdir = resolve("dist/linux-electron");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

async function buildOrExit(options: Bun.BuildConfig): Promise<void> {
	const result = await Bun.build(options);
	if (result.success) return;

	for (const log of result.logs) {
		console.error(log.message);
	}
	process.exit(1);
}

await buildOrExit({
	entrypoints: ["linux/electron/main.ts"],
	outdir,
	target: "node",
	format: "esm",
	external: ["electron"],
	sourcemap: "external",
	splitting: false,
});

await buildOrExit({
	entrypoints: [
		"linux/electron/preload.ts",
		"linux/electron/capsule-preload.ts",
	],
	outdir,
	target: "node",
	format: "cjs",
	external: ["electron"],
	sourcemap: "external",
	splitting: false,
});
