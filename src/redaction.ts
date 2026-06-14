export interface PrepareTextOptions {
	maxInputChars: number;
	redactSecrets: boolean;
}

const PRIVATE_KEY_PATTERN = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
const BEARER_PATTERN = /\bBearer\s+[^\s]+/g;
const KEY_VALUE_SECRET_PATTERN =
	/\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s]+)/gi;

export function redactSecrets(text: string): string {
	return text
		.replace(
			PRIVATE_KEY_PATTERN,
			(_match, keyType: string) =>
				`-----BEGIN ${keyType}-----[REDACTED]-----END ${keyType}-----`,
		)
		.replace(BEARER_PATTERN, "Bearer [REDACTED]")
		.replace(
			KEY_VALUE_SECRET_PATTERN,
			(_match, name: string, separator: string) => `${name}${separator}[REDACTED]`,
		);
}

export function prepareText(text: string, options: PrepareTextOptions): string {
	const redacted = options.redactSecrets ? redactSecrets(text) : text;
	return redacted.slice(0, options.maxInputChars).trimEnd();
}
