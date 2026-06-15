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
}

export function resolvePaths(
	env: Record<string, string | undefined> = process.env,
): AgentVoicePaths {
	const home = resolve(env.AGENT_VOICE_HOME || join(homedir(), ".agent-voice"));

	return {
		home,
		config: join(home, "config.json"),
		logs: join(home, "logs"),
		backups: join(home, "backups"),
		run: join(home, "run"),
		db: join(home, "queue.db"),
		launchdOutLog: join(home, "logs", "launchd.out.log"),
		launchdErrLog: join(home, "logs", "launchd.err.log"),
	};
}
