import { describe, expect, test } from "bun:test";
import {
	createMainWindowOptions,
	validateIpcPayload,
} from "../../linux/electron/main";

describe("electron main security", () => {
	test("main window uses sandboxed isolated renderer options", () => {
		const options = createMainWindowOptions("/tmp/preload.js");
		expect(options.webPreferences?.contextIsolation).toBe(true);
		expect(options.webPreferences?.nodeIntegration).toBe(false);
		expect(options.webPreferences?.sandbox).toBe(true);
		expect(options.webPreferences?.preload).toBe("/tmp/preload.js");
	});

	test("rejects invalid primitive payloads before service calls", () => {
		expect(() => validateIpcPayload("voice.test", { text: 123 })).toThrow(
			"Invalid voice.test payload",
		);
		expect(() => validateIpcPayload("hooks.install", { agent: "bad" })).toThrow(
			"Unsupported agent",
		);
	});
});
