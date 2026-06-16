import { runCli } from "./cli";

async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return "";

	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function writeAll(stream: NodeJS.WriteStream, data: string): Promise<void> {
	return new Promise((resolve) => {
		if (!data) {
			resolve();
			return;
		}
		// The callback fires only once the chunk is flushed to the OS, so a large
		// payload behind a back-pressured pipe (e.g. the macOS app reading status
		// or history JSON) is delivered in full before the process exits. Calling
		// process.exit() right after write() would drop everything past the pipe
		// buffer and hand the reader a truncated, undecodable document.
		stream.write(data, () => resolve());
	});
}

const stdin = await readStdin();
const result = await runCli(process.argv.slice(2), {
	stdin,
	env: process.env,
});

await Promise.all([
	writeAll(process.stdout, result.stdout),
	writeAll(process.stderr, result.stderr),
]);
process.exit(result.exitCode);
