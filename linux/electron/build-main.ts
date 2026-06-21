import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const outdir = resolve("dist/linux-electron");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
	entrypoints: ["linux/electron/main.ts", "linux/electron/preload.ts"],
	outdir,
	target: "node",
	format: "esm",
	external: ["electron"],
	sourcemap: "external",
	splitting: false,
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log.message);
	}
	process.exit(1);
}
