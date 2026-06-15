import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface AgentVoicePaths {
	home: string;
	config: string;
	logs: string;
	backups: string;
	run: string;
	db: string;
	launchdOutLog: string;
	launchdErrLog: string;
	spool: {
		root: string;
		incoming: string;
		processing: string;
		done: string;
		failed: string;
		skipped: string;
	};
}

export function resolvePaths(
	env: Record<string, string | undefined> = process.env,
): AgentVoicePaths {
	const home = resolve(env.AGENT_VOICE_HOME || join(homedir(), ".agent-voice"));
	const spoolRoot = join(home, "spool");

	return {
		home,
		config: join(home, "config.json"),
		logs: join(home, "logs"),
		backups: join(home, "backups"),
		run: join(home, "run"),
		db: join(home, "queue.db"),
		launchdOutLog: join(home, "logs", "launchd.out.log"),
		launchdErrLog: join(home, "logs", "launchd.err.log"),
		spool: {
			root: spoolRoot,
			incoming: join(spoolRoot, "incoming"),
			processing: join(spoolRoot, "processing"),
			done: join(spoolRoot, "done"),
			failed: join(spoolRoot, "failed"),
			skipped: join(spoolRoot, "skipped"),
		},
	};
}
