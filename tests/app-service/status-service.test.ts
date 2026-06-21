import { describe, expect, test } from "bun:test";
import {
	getQueueSnapshot,
	getStatus,
} from "../../src/app-service/status-service";

describe("status-service module", () => {
	test("exports status service entry points", () => {
		expect(getStatus).toEqual(expect.any(Function));
		expect(getQueueSnapshot).toEqual(expect.any(Function));
	});
});
