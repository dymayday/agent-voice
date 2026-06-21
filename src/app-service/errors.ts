import type { AppServiceErrorCode, AppServiceResult } from "./types";

export function ok<T>(value: T): AppServiceResult<T> {
	return { ok: true, value };
}

export function fail(
	code: AppServiceErrorCode,
	message: string,
	options: { details?: unknown; recoverable?: boolean } = {},
): AppServiceResult<never> {
	return {
		ok: false,
		error: {
			code,
			message,
			...(options.details === undefined ? {} : { details: options.details }),
			recoverable: options.recoverable ?? true,
		},
	};
}
