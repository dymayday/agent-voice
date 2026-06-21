import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: "linux/electron",
	plugins: [svelte()],
	resolve: {
		conditions: ["browser"],
	},
	test: {
		environment: "jsdom",
		include: ["renderer/src/**/*.test.ts"],
		setupFiles: ["renderer/src/test-setup.ts"],
	},
	build: {
		outDir: "../../dist/linux-renderer",
		emptyOutDir: true,
	},
});
