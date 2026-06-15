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

SOURCE_PNG="$ROOT_DIR/assets/app-icon/agent-voice-local-voice-orb.png"
OUTPUT_DIR="$ROOT_DIR/macos/AgentVoiceApp/Resources"
OUTPUT_ICNS="$OUTPUT_DIR/AppIcon.icns"

if [[ ! -f "$SOURCE_PNG" ]]; then
  echo "Missing source icon: $SOURCE_PNG" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
ICONSET="$TMP_DIR/AppIcon.iconset"
mkdir -p "$ICONSET" "$OUTPUT_DIR"

make_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$SOURCE_PNG" --out "$ICONSET/$name" >/dev/null
}

make_icon 16 "icon_16x16.png"
make_icon 32 "icon_16x16@2x.png"
make_icon 32 "icon_32x32.png"
make_icon 64 "icon_32x32@2x.png"
make_icon 128 "icon_128x128.png"
make_icon 256 "icon_128x128@2x.png"
make_icon 256 "icon_256x256.png"
make_icon 512 "icon_256x256@2x.png"
make_icon 512 "icon_512x512.png"
make_icon 1024 "icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUTPUT_ICNS"
echo "$OUTPUT_ICNS"
