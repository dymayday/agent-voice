import { describe, expect, test } from "bun:test";
import { createCapsuleController } from "../../linux/electron/main";

describe("capsule lifecycle", () => {
	test("setting gates capsule creation and destruction", () => {
		const events: string[] = [];
		const controller = createCapsuleController({
			create: () => events.push("create"),
			destroy: () => events.push("destroy"),
			focusConsole: () => events.push("focus"),
		});
		controller.setEnabled(true);
		controller.setEnabled(false);
		expect(events).toEqual(["create", "destroy"]);
	});

	test("capsule action surface excludes destructive actions", () => {
		const controller = createCapsuleController({
			create() {},
			destroy() {},
			focusConsole() {},
		});
		expect(controller.allowedActions()).toEqual([
			"openConsole",
			"speakLatest",
			"viewQueue",
		]);
		expect(controller.allowedActions()).not.toContain("clearFailed");
		expect(controller.allowedActions()).not.toContain("installHook");
	});
});
