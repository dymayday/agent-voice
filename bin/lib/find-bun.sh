_agent_voice_cache_file() {
	if [[ -n "${AGENT_VOICE_HOME:-}" ]]; then
		printf '%s\n' "$AGENT_VOICE_HOME/cache/bun-path"
		return 0
	fi

	if [[ -n "${HOME:-}" ]]; then
		printf '%s\n' "$HOME/.agent-voice/cache/bun-path"
		return 0
	fi

	return 1
}

_agent_voice_cache_bun() {
	local candidate="$1"
	local cache_file
	cache_file="$(_agent_voice_cache_file)" || return 0
	mkdir -p "$(dirname -- "$cache_file")" 2>/dev/null || return 0
	printf '%s\n' "$candidate" >"$cache_file" 2>/dev/null || return 0
}

_agent_voice_use_bun() {
	local candidate="$1"
	if [[ -n "$candidate" && -x "$candidate" ]]; then
		_agent_voice_cache_bun "$candidate" || true
		printf '%s\n' "$candidate"
		return 0
	fi
	return 1
}

_agent_voice_bundled_bun_path_file() {
	local helper_source="${BASH_SOURCE[0]}"
	local helper_dir
	helper_dir="$(
		CDPATH=
		cd -P -- "$(dirname -- "$helper_source")" && pwd
	)" || return 1
	printf '%s\n' "$(dirname -- "$helper_dir")/.bun-path"
}

_agent_voice_use_bun_path_file() {
	local path_file="$1"
	local candidate=""
	if [[ -n "$path_file" && -f "$path_file" ]]; then
		IFS= read -r candidate <"$path_file" || true
		_agent_voice_use_bun "$candidate"
		return $?
	fi
	return 1
}

_agent_voice_use_cached_bun() {
	local cache_file
	cache_file="$(_agent_voice_cache_file)" || return 1
	_agent_voice_use_bun_path_file "$cache_file"
}

find_agent_voice_bun() {
	local candidate
	local path_file

	if _agent_voice_use_bun "${AGENT_VOICE_BUN:-}"; then
		return 0
	fi

	if _agent_voice_use_bun "${AGENT_VOICE_BUN_PATH:-}"; then
		return 0
	fi

	if [[ -n "${AGENT_VOICE_BUN_PATH_FILE:-}" ]] && _agent_voice_use_bun_path_file "$AGENT_VOICE_BUN_PATH_FILE"; then
		return 0
	fi

	path_file="$(_agent_voice_bundled_bun_path_file 2>/dev/null || true)"
	if _agent_voice_use_bun_path_file "$path_file"; then
		return 0
	fi

	if command -v bun >/dev/null 2>&1; then
		candidate="$(command -v bun)"
		if _agent_voice_use_bun "$candidate"; then
			return 0
		fi
	fi

	for candidate in \
		"${BUN_INSTALL:-}/bin/bun" \
		"${HOME:-}/.bun/bin/bun" \
		"${HOME:-}/.nvm/current/bin/bun"; do
		if _agent_voice_use_bun "$candidate"; then
			return 0
		fi
	done

	if _agent_voice_use_cached_bun; then
		return 0
	fi

	if [[ -n "${HOME:-}" ]]; then
		local nvm_bun=""
		for candidate in "$HOME"/.nvm/versions/node/*/bin/bun; do
			if [[ -x "$candidate" ]]; then
				nvm_bun="$candidate"
			fi
		done
		if _agent_voice_use_bun "$nvm_bun"; then
			return 0
		fi
	fi

	return 1
}
