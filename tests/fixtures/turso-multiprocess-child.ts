import { openDb } from "../../src/db";
import { createEvent } from "../../src/events";
import { enqueue } from "../../src/store";

const dbPath = process.argv[2];
if (!dbPath) {
	console.error("missing db path");
	process.exit(2);
}

const db = openDb(dbPath);
try {
	const event = createEvent({ agent: "codex", text: "Child process." });
	enqueue(db, event);
	console.log(event.id);
} finally {
	db.close();
}
