import { Database as TursoDatabase } from "@tursodatabase/database/compat";

type TursoDatabaseOptions = NonNullable<
	ConstructorParameters<typeof TursoDatabase>[1]
>;
type TursoExperimentalFeature = NonNullable<
	TursoDatabaseOptions["experimental"]
>[number];

export const TURSO_MULTIPROCESS_WAL_FEATURE: TursoExperimentalFeature =
	"multiprocess_wal";
export const TURSO_FILE_EXPERIMENTAL_FEATURES: readonly TursoExperimentalFeature[] = [
	TURSO_MULTIPROCESS_WAL_FEATURE,
];

export interface AgentVoiceRunResult {
	changes: number;
	lastInsertRowid?: number | bigint;
}

export interface AgentVoiceStatement {
	run(...bindParameters: unknown[]): AgentVoiceRunResult;
	get(...bindParameters: unknown[]): unknown;
	all(...bindParameters: unknown[]): unknown[];
	close(): void;
}

export interface AgentVoiceDb {
	query(sql: string): AgentVoiceStatement;
	exec(sql: string): void;
	transaction<T extends (...args: any[]) => unknown>(fn: T): T;
	close(): void;
}

export interface AgentVoiceDbOptions {
	readonly?: boolean;
	create?: boolean;
}

interface TursoStatementLike {
	run(...bindParameters: unknown[]): AgentVoiceRunResult;
	get(...bindParameters: unknown[]): unknown;
	all(...bindParameters: unknown[]): unknown[];
	close(): void;
}

interface TursoDatabaseLike {
	prepare(sql: string): TursoStatementLike;
	exec(sql: string): void;
	transaction<T extends (...args: any[]) => unknown>(fn: T): T;
	close(): void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function normalizeSqlParams(params: unknown): unknown {
	if (!isPlainObject(params)) return params;

	const normalized: Record<string, unknown> = { ...params };
	for (const [key, value] of Object.entries(params)) {
		if (/^[$:@]/.test(key)) {
			const withoutSigil = key.slice(1);
			if (!(withoutSigil in normalized)) {
				normalized[withoutSigil] = value;
			}
		}
	}
	return normalized;
}

function toBindArgs(bindParameters: unknown[]): unknown[] {
	if (bindParameters.length === 0) return [];
	if (bindParameters.length === 1) {
		return bindParameters[0] === undefined
			? []
			: [normalizeSqlParams(bindParameters[0])];
	}
	return bindParameters.map((param) => normalizeSqlParams(param));
}

class TursoStatementAdapter implements AgentVoiceStatement {
	constructor(private readonly statement: TursoStatementLike) {}

	run(...bindParameters: unknown[]): AgentVoiceRunResult {
		return this.statement.run(...toBindArgs(bindParameters));
	}

	get(...bindParameters: unknown[]): unknown {
		return this.statement.get(...toBindArgs(bindParameters));
	}

	all(...bindParameters: unknown[]): unknown[] {
		return this.statement.all(...toBindArgs(bindParameters));
	}

	close(): void {
		this.statement.close();
	}
}

class TursoDbAdapter implements AgentVoiceDb {
	constructor(private readonly db: TursoDatabaseLike) {}

	query(sql: string): AgentVoiceStatement {
		return new TursoStatementAdapter(this.db.prepare(sql));
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	transaction<T extends (...args: any[]) => unknown>(fn: T): T {
		return this.db.transaction(fn);
	}

	close(): void {
		this.db.close();
	}
}

function isInMemoryLocation(location: string): boolean {
	return (
		location === ":memory:" ||
		location.startsWith("file::memory:") ||
		/[?&]mode=memory(?:&|$)/.test(location)
	);
}

export function tursoExperimentalFeaturesForLocation(
	location: string,
): readonly TursoExperimentalFeature[] {
	return isInMemoryLocation(location) ? [] : TURSO_FILE_EXPERIMENTAL_FEATURES;
}

export function createDb(
	location: string,
	options: AgentVoiceDbOptions = {},
): AgentVoiceDb {
	const experimental = tursoExperimentalFeaturesForLocation(location);
	const db = new TursoDatabase(location, {
		readonly: options.readonly === true,
		fileMustExist: options.readonly === true || options.create === false,
		timeout: 5000,
		...(experimental.length > 0 ? { experimental: [...experimental] } : {}),
	});
	return new TursoDbAdapter(db as unknown as TursoDatabaseLike);
}

function isUnsupportedOptionalPragma(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		/Not a valid pragma name/i.test(message) ||
		/Autovacuum is not enabled/i.test(message) ||
		/not implemented/i.test(message)
	);
}

export function runOptionalMaintenance(
	db: Pick<AgentVoiceDb, "exec">,
	sql: string,
): void {
	try {
		db.exec(sql);
	} catch (error) {
		if (isUnsupportedOptionalPragma(error)) return;
		throw error;
	}
}
