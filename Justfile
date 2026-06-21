set dotenv-load := false

# List available commands.
default:
	@just --list

# Run the native app for this platform in development mode.
dev:
	@case "$(uname -s)" in \
		Darwin) just dev-swift ;; \
		Linux) just dev-electron ;; \
		*) echo "Unsupported platform for native dev: $(uname -s)" >&2; exit 1 ;; \
	esac

# Build the native app for this platform.
build:
	@case "$(uname -s)" in \
		Darwin) just build-swift ;; \
		Linux) just build-electron ;; \
		*) echo "Unsupported platform for native build: $(uname -s)" >&2; exit 1 ;; \
	esac

# Build and run the native app for this platform.
run:
	@case "$(uname -s)" in \
		Darwin) just run-swift ;; \
		Linux) just run-electron ;; \
		*) echo "Unsupported platform for native run: $(uname -s)" >&2; exit 1 ;; \
	esac

# Verify the native app checks for this platform.
verify:
	@case "$(uname -s)" in \
		Darwin) just verify-swift ;; \
		Linux) just verify-electron ;; \
		*) echo "Unsupported platform for native verify: $(uname -s)" >&2; exit 1 ;; \
	esac

# Verify and build the native app for this platform.
ship:
	@case "$(uname -s)" in \
		Darwin) just ship-swift ;; \
		Linux) just ship-electron ;; \
		*) echo "Unsupported platform for native ship: $(uname -s)" >&2; exit 1 ;; \
	esac

# Run common TypeScript/Bun checks.
verify-common:
	bun test
	bun run typecheck

# Run Electron in development mode. Works on Linux and macOS.
dev-electron:
	@just check-electron-platform
	bun run dev:linux

# Build the Electron renderer and main process.
build-electron:
	@just check-electron-platform
	bun run build:linux-renderer
	bun run build:linux-main

# Build and run the Electron app.
run-electron: build-electron
	bun x electron dist/linux-electron/main.js

# Verify Electron checks.
verify-electron: verify-common
	@just check-electron-platform
	bun run test:renderer
	bun run check:renderer
	bun run build:linux-renderer
	bun run build:linux-main
	node dist/linux-electron/main.js

# Verify and build the Electron app.
ship-electron: verify-electron build-electron

# Run the Swift app in development mode. macOS only.
dev-swift: run-swift

# Build the Swift macOS app bundle. macOS only.
build-swift:
	@just check-swift-platform
	bun run build:macos

# Build and run the Swift macOS app. macOS only.
run-swift: build-swift
	open "dist/Agent Voice.app"

# Run Swift package tests. macOS only.
test-swift:
	@just check-swift-platform
	swift test --package-path macos/AgentVoiceApp

# Verify Swift/native macOS checks.
verify-swift: verify-common test-swift

# Verify and build the Swift macOS app.
ship-swift: verify-swift build-swift

# Ensure Electron dev/build can run on this OS.
check-electron-platform:
	@case "$(uname -s)" in \
		Darwin) command -v afplay >/dev/null || { echo "Electron audio on macOS requires afplay." >&2; exit 1; } ;; \
		Linux) command -v paplay >/dev/null || command -v aplay >/dev/null || { echo "Electron audio on Linux requires paplay or aplay." >&2; exit 1; } ;; \
		*) echo "Electron app is supported on macOS and Linux only." >&2; exit 1 ;; \
	esac
	@command -v bun >/dev/null || { echo "Bun is required. Install from https://bun.sh/" >&2; exit 1; }

# Ensure Swift app commands only run on macOS.
check-swift-platform:
	@case "$(uname -s)" in \
		Darwin) ;; \
		*) echo "Swift app build/run is macOS-only." >&2; exit 1 ;; \
	esac
	@command -v bun >/dev/null || { echo "Bun is required. Install from https://bun.sh/" >&2; exit 1; }
	@command -v swift >/dev/null || { echo "Swift toolchain is required." >&2; exit 1; }
