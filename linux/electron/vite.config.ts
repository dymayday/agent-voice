import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: "linux/electron",
	base: "./",
	plugins: [svelte()],
	resolve: {
		conditions: ["browser"],
	},
	test: {
		environment: "jsdom",
		include: ["renderer/src/**/*.vitest.ts"],
		setupFiles: ["renderer/src/test-setup.ts"],
	},
	build: {
		outDir: "../../dist/linux-renderer",
		emptyOutDir: true,
	},
});
