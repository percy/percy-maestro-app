# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Percy Maestro SDK — a Percy SDK for capturing screenshots in Maestro mobile test flows and uploading them to Percy for visual testing. Unlike traditional SDKs, this project has no build system. It consists of JS scripts and YAML sub-flows that users copy into their Maestro test projects.

## Repository Structure

- **`percy/scripts/`** — JavaScript files executed by Maestro's `runScript` command (GraalJS engine)
- **`percy/flows/`** — YAML sub-flow files invoked by Maestro's `runFlow` command

Users integrate Percy by copying the `percy/` directory into their Maestro project.

## How It Works

1. `percy-healthcheck.js` — Runs once at the start of a test flow to verify the Percy CLI is reachable at the configured server address (default `http://percy.cli:5338`). Sets `output.percyEnabled` for downstream scripts.
2. `percy-screenshot.js` — Takes a screenshot path and name, builds a multipart form with device metadata, and uploads to Percy CLI's `/percy/comparison/upload` endpoint.

## Maestro JS Environment

- Environment variables are global variables (e.g., `PERCY_SERVER`, not `process.env.PERCY_SERVER`)
- Use `typeof VAR !== 'undefined'` to check if an env var exists
- `http.get()` and `http.post()` are built-in globals
- `output` is a built-in global object for passing data between commands
- `console.log()` takes a single argument only
- `json()` is a global function to parse JSON strings
- `maestro.platform` returns "android" or "ios"
- Prefer `var` over `let`/`const` for maximum compatibility

## No Build Commands

There is no build system. To test, run Maestro flows that reference the scripts against an Android emulator with the Percy CLI running.
