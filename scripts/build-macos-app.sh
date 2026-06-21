#!/usr/bin/env bash
set -euo pipefail
unset CDPATH

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
	SCRIPT_DIR="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
	TARGET="$(readlink "$SOURCE")"
	if [[ "$TARGET" == /* ]]; then
		SOURCE="$TARGET"
	else
		SOURCE="$SCRIPT_DIR/$TARGET"
	fi
done
SCRIPT_DIR="$(cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
ROOT_DIR="$(dirname -- "$SCRIPT_DIR")"
PACKAGE_DIR="$ROOT_DIR/macos/AgentVoiceApp"
APP_DIR="$ROOT_DIR/dist/Agent Voice.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
CLI_DIR="$RESOURCES_DIR/agent-voice"
CLEAN_CACHE_BEFORE_BUILD=0

usage() {
	cat <<'EOF'
Usage:
  build-macos-app.sh [--clean-cache]
  build-macos-app.sh clean-cache

Options:
  --clean-cache  Remove SwiftPM build cache before building.
  clean-cache    Remove SwiftPM build cache and exit.
EOF
}

clean_build_cache() {
	rm -rf "$PACKAGE_DIR/.build"
}

is_stale_swift_cache_error() {
	local output="$1"
	[[ "$output" == *"was compiled with module cache path"* ]] ||
		[[ "$output" == *"missing required module 'SwiftShims'"* ]]
}

run_release_build() {
	swift build -c release --package-path "$PACKAGE_DIR"
}

case "${1:-}" in
clean-cache)
	clean_build_cache
	echo "Cleaned Swift build cache: $PACKAGE_DIR/.build"
	exit 0
	;;
--clean-cache)
	CLEAN_CACHE_BEFORE_BUILD=1
	shift
	;;
-h | --help)
	usage
	exit 0
	;;
"")
	;;
*)
	usage >&2
	exit 2
	;;
esac

if [[ $# -gt 0 ]]; then
	usage >&2
	exit 2
fi

if [[ "$CLEAN_CACHE_BEFORE_BUILD" -eq 1 ]]; then
	clean_build_cache
fi

. "$ROOT_DIR/bin/lib/find-bun.sh"
PINNED_BUN_BIN="$(find_agent_voice_bun)" || PINNED_BUN_BIN=""
if [[ -z "$PINNED_BUN_BIN" ]]; then
	printf '%s\n' "Error: Bun was not found while building; cannot install bundled CLI runtime dependencies." >&2
	exit 1
fi

set +e
BUILD_OUTPUT="$(run_release_build 2>&1)"
BUILD_STATUS=$?
set -e

if [[ "$BUILD_STATUS" -ne 0 ]]; then
	if [[ -n "$BUILD_OUTPUT" ]]; then
		printf '%s\n' "$BUILD_OUTPUT" >&2
	fi
	if is_stale_swift_cache_error "$BUILD_OUTPUT"; then
		printf '%s\n' "Swift build cache appears stale; cleaning Swift build cache and retrying once." >&2
		clean_build_cache
		run_release_build
	else
		exit "$BUILD_STATUS"
	fi
elif [[ -n "$BUILD_OUTPUT" ]]; then
	printf '%s\n' "$BUILD_OUTPUT"
fi

BIN_DIR="$(swift build -c release --package-path "$PACKAGE_DIR" --show-bin-path)"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$CLI_DIR/bin" "$CLI_DIR/bin/lib"

install -m 755 "$BIN_DIR/AgentVoiceApp" "$MACOS_DIR/AgentVoiceApp"
cp "$PACKAGE_DIR/Resources/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PACKAGE_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"

install -m 755 "$ROOT_DIR/bin/agent-voice" "$CLI_DIR/bin/agent-voice"
cp -R "$ROOT_DIR/bin/lib/." "$CLI_DIR/bin/lib/"
if [[ -n "$PINNED_BUN_BIN" ]]; then
	printf '%s\n' "$PINNED_BUN_BIN" >"$CLI_DIR/bin/.bun-path"
fi
cp -R "$ROOT_DIR/src" "$CLI_DIR/src"
mkdir -p "$CLI_DIR/resources"
cp -R "$ROOT_DIR/resources/kokoro" "$CLI_DIR/resources/kokoro"
cp "$ROOT_DIR/package.json" "$CLI_DIR/package.json"
if [[ -f "$ROOT_DIR/bun.lock" ]]; then
	cp "$ROOT_DIR/bun.lock" "$CLI_DIR/bun.lock"
fi
(
	cd "$CLI_DIR"
	"$PINNED_BUN_BIN" install --production --frozen-lockfile
)

# Stamp a per-build id next to the bundled CLI. The daemon captures it at
# startup and reports it in status.json; the app compares it against its own
# bundle's id and restarts the daemon on a mismatch. The build epoch makes every
# build unique, so ANY rebuild — even on the same commit — is detected and the
# stale in-memory daemon gets reloaded.
BUILD_EPOCH="$(date -u +%s)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PKG_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT_DIR/package.json" | head -1)"
if GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD 2>/dev/null)"; then
	if [[ -n "$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null)" ]]; then
		GIT_COMMIT="${GIT_COMMIT}-dirty"
	fi
else
	GIT_COMMIT="nogit"
fi
BUILD_ID="${GIT_COMMIT}+${BUILD_EPOCH}"
cat >"$CLI_DIR/build-info.json" <<EOF
{
  "buildId": "${BUILD_ID}",
  "commit": "${GIT_COMMIT}",
  "version": "${PKG_VERSION}",
  "builtAt": "${BUILT_AT}"
}
EOF

echo "$APP_DIR"
