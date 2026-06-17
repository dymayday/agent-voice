find_agent_voice_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi

  local candidate
  for candidate in \
    "${BUN_INSTALL:-}/bin/bun" \
    "${HOME:-}/.bun/bin/bun" \
    "${HOME:-}/.nvm/current/bin/bun"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [[ -n "${HOME:-}" ]]; then
    local nvm_bun=""
    local found_bun
    while IFS= read -r found_bun; do
      if [[ -x "$found_bun" ]]; then
        nvm_bun="$found_bun"
      fi
    done < <(find "$HOME/.nvm/versions/node" -path '*/bin/bun' \( -type f -o -type l \) 2>/dev/null | sort -V)
    if [[ -n "$nvm_bun" ]]; then
      printf '%s\n' "$nvm_bun"
      return 0
    fi
  fi

  return 1
}
