#!/usr/bin/env bash
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
	SCRIPT_DIR="$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
	TARGET="$(readlink "$SOURCE")"
	if [[ "$TARGET" == /* ]]; then
		SOURCE="$TARGET"
	else
		SOURCE="$SCRIPT_DIR/$TARGET"
	fi
done
SCRIPT_DIR="$(CDPATH= cd -P -- "$(dirname -- "$SOURCE")" && pwd)"
ROOT_DIR="$(dirname -- "$SCRIPT_DIR")"
PACKAGE_DIR="$ROOT_DIR/macos/AgentVoiceApp"
APP_DIR="$ROOT_DIR/dist/Agent Voice.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
CLI_DIR="$RESOURCES_DIR/agent-voice"

swift build -c release --package-path "$PACKAGE_DIR"
BIN_DIR="$(swift build -c release --package-path "$PACKAGE_DIR" --show-bin-path)"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR" "$CLI_DIR/bin" "$CLI_DIR/bin/lib"

install -m 755 "$BIN_DIR/AgentVoiceApp" "$MACOS_DIR/AgentVoiceApp"
cp "$PACKAGE_DIR/Resources/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PACKAGE_DIR/Resources/AppIcon.icns" "$RESOURCES_DIR/AppIcon.icns"

install -m 755 "$ROOT_DIR/bin/agent-voice" "$CLI_DIR/bin/agent-voice"
cp -R "$ROOT_DIR/bin/lib/." "$CLI_DIR/bin/lib/"
cp -R "$ROOT_DIR/src" "$CLI_DIR/src"
mkdir -p "$CLI_DIR/resources"
cp -R "$ROOT_DIR/resources/kokoro" "$CLI_DIR/resources/kokoro"
cp "$ROOT_DIR/package.json" "$CLI_DIR/package.json"
if [[ -f "$ROOT_DIR/bun.lock" ]]; then
	cp "$ROOT_DIR/bun.lock" "$CLI_DIR/bun.lock"
fi

echo "$APP_DIR"
