# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Percy Maestro SDK — a Percy SDK for capturing screenshots in Maestro mobile test flows and uploading them to Percy for visual testing. Unlike traditional SDKs, this project has no build system. It consists of JS scripts and YAML sub-flows that users copy into their Maestro test projects. Currently **Android-only** (the healthcheck enforces this).

## Repository Structure

- **`percy/scripts/`** — JavaScript files executed by Maestro's `runScript` command (GraalJS engine)
- **`percy/flows/`** — YAML sub-flow files invoked by Maestro's `runFlow` command

Users integrate Percy by copying the `percy/` directory into their Maestro project.

## How It Works

1. **`percy/flows/percy-init.yaml`** → runs `percy-healthcheck.js`. Sets `output.percyEnabled` (persists across subsequent flow steps).
2. **`percy/flows/percy-screenshot.yaml`** → calls Maestro's `takeScreenshot` (saves to `../../.maestro/${SCREENSHOT_NAME}.png`), then runs `percy-screenshot.js` with `SCREENSHOT_PATH` pointing to that file.
3. **`percy-screenshot.js`** builds a multipart form (`screenshot` file, `name`, `tag` JSON with device info, `clientInfo`, `environmentInfo`, optional `testCase`/`labels`) and POSTs to `/percy/comparison/upload`.

The YAML flows use relative paths (`../scripts/...`) — this means the `percy/` directory structure must stay intact.

## Percy CLI API

- **GET `/percy/healthcheck`** — returns `x-percy-core-version` header on success
- **POST `/percy/comparison/upload`** — multipart form upload; returns JSON with `link` field on success

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
- `http.post()` accepts `{ multipartForm: { ... } }` for file uploads; file fields use `{ filePath, mediaType }`

## No Build Commands

There is no build system. To test, run Maestro flows that reference the scripts against an Android emulator with the Percy CLI running.
