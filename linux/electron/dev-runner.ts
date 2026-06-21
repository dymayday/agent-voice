import { spawn, type ChildProcess } from "node:child_process";

const rendererUrl =
	process.env.AGENT_VOICE_RENDERER_URL ?? "http://127.0.0.1:5173";

const vite = spawn(
	"bun",
	[
		"x",
		"vite",
		"--config",
		"linux/electron/vite.config.ts",
		"--host",
		"127.0.0.1",
	],
	{ stdio: "inherit" },
);

const electron = spawn("bun", ["x", "electron", "linux/electron/main.ts"], {
	stdio: "inherit",
	env: { ...process.env, AGENT_VOICE_RENDERER_URL: rendererUrl },
});

function kill(child: ChildProcess): void {
	if (!child.killed) {
		child.kill();
	}
}

function shutdown(): void {
	kill(electron);
	kill(vite);
}

vite.on("exit", (code) => {
	if (code !== null && code !== 0) {
		kill(electron);
		process.exitCode = code;
	}
});

electron.on("exit", (code) => {
	kill(vite);
	process.exitCode = code ?? 0;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
