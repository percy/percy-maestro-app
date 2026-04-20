# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Percy Maestro SDK — a Percy SDK for capturing screenshots in Maestro mobile test flows and uploading them to Percy for visual testing. Unlike traditional SDKs, this project has no build system. It consists of JS scripts and YAML sub-flows that users copy into their Maestro test projects. Supports **Android and iOS** as of v0.3.0 (healthcheck allowlist; `maestro.platform` gates unsupported platforms like `web`).

## Repository Structure

- **`percy/scripts/`** — JavaScript files executed by Maestro's `runScript` command (GraalJS engine)
- **`percy/flows/`** — YAML sub-flow files invoked by Maestro's `runFlow` command

Users integrate Percy by copying the `percy/` directory into their Maestro project.

## How It Works

1. **`percy/flows/percy-init.yaml`** → runs `percy-healthcheck.js`. Sets `output.percyEnabled`, `output.percyServer`, and `output.percyCoreVersion` (persist across subsequent flow steps).
2. **`percy/flows/percy-screenshot.yaml`** → calls Maestro's `takeScreenshot` (saves PNG to disk), then runs `percy-screenshot.js`.
3. **`percy-screenshot.js`** builds a JSON payload (name, sessionId, tag, regions, tile metadata, sync, `platform`, etc.) and POSTs to `/percy/maestro-screenshot`. The Percy CLI relay picks the screenshot glob based on the `platform` field (iOS: `/tmp/{sessionId}/*_maestro_debug_*/{name}.png`, Android: `/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`), reads the file, base64-encodes it, and processes the comparison. `tag.osName` is derived from `maestro.platform` by the SDK (`"iOS"` or `"Android"`).

The YAML flows use relative paths (`../scripts/...`) — this means the `percy/` directory structure must stay intact.

## Percy CLI API

- **GET `/percy/healthcheck`** — returns `x-percy-core-version` header on success
- **POST `/percy/maestro-screenshot`** — JSON relay endpoint; accepts name, sessionId, tag, **platform** (`"ios"` or `"android"`; whitelist-enforced with 400 on unknown; absent → Android for SDK v0.2.0 compat), regions, sync, statusBarHeight, navBarHeight, fullscreen, thTestCaseExecutionId, testCase, labels, clientInfo, environmentInfo. Returns `{ success, link }` (non-sync) or `{ success, data }` (sync). `name` and `sessionId` must match `^[a-zA-Z0-9_-]+$`.

Default server: `http://percy.cli:5338` (overridable via `PERCY_SERVER` env var).

## Maestro JS Environment

- Environment variables are global variables (e.g., `PERCY_SERVER`, not `process.env.PERCY_SERVER`)
- Use `typeof VAR !== 'undefined'` to check if an env var exists
- `http.get()` and `http.post()` are built-in globals
- `output` is a built-in global object for passing data between commands
- `console.log()` takes a single argument only
- `json()` is a global function to parse JSON strings
- `maestro.platform` returns "android" or "ios"
- Prefer `var` over `let`/`const` for maximum compatibility
- `http.post()` accepts `{ multipartForm: { ... } }` for file uploads; file fields use `{ filePath, mediaType }` — **however**, multipartForm filePath is broken on BrowserStack (GraalJS sandbox blocks Java interop, CWD unknown). Use JSON POST to relay endpoint instead.
- `PERCY_REGIONS` env var accepts a JSON array string. Two region types: element-based `{"element":{"resource-id":"..."},"algorithm":"ignore"}` and coordinate-based `{"top":0,"bottom":100,"left":0,"right":500,"algorithm":"ignore"}`. Algorithms: `ignore`, `layout`, `standard`, `intelliignore`. Optional per-region `configuration`, `padding`, `assertion` objects are passed through.

## No Build Commands

There is no build system. To test, run Maestro flows that reference the scripts against an Android emulator or iOS device with the Percy CLI running.

## Platform Differences

- **Android**: `tag.osName = "Android"`, `PERCY_NAV_BAR_HEIGHT` typically `48`, relay glob pattern `/tmp/{sessionId}_test_suite/logs/*/screenshots/`.
- **iOS**: `tag.osName = "iOS"`, `PERCY_NAV_BAR_HEIGHT` typically omitted (no persistent nav bar), `PERCY_STATUS_BAR_HEIGHT` should include notch/Dynamic Island on modern iPhones. Relay glob pattern `/tmp/{sessionId}/*_maestro_debug_*/`. iOS hosts run macOS; `/tmp` symlinks to `/private/tmp` — relay handles this via `realpath` on both file and session root.
- SDK itself has no platform-specific branching beyond `tag.osName` and `payload.platform`; all env vars work identically across both platforms.
