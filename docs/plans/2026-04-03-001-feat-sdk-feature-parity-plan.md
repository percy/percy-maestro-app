---
title: "feat: Achieve Percy SDK Feature Parity for Maestro"
type: feat
status: active
date: 2026-04-03
origin: docs/brainstorms/2026-04-03-sdk-feature-parity-requirements.md
---

# feat: Achieve Percy SDK Feature Parity for Maestro

## Overview

Add support for regions (ignore/consider via coordinate-based bounding boxes with per-region algorithm selection), sync mode, tile metadata (statusBarHeight, navBarHeight, fullscreen), and thTestCaseExecutionId to the Percy Maestro SDK. This requires changes in two repos: the Maestro SDK and the Percy CLI relay endpoint. The mobile platform batch upload (R15) is deferred pending deprecation confirmation.

## Problem Frame

The Percy Maestro SDK supports only basic screenshot capture with name, sessionId, tag metadata, testCase, and labels. Other Percy mobile SDKs (percy-appium-python, percy-espresso-java) support regions, sync mode, and tile metadata. Users adopting the Maestro SDK lose access to these capabilities. (see origin: `docs/brainstorms/2026-04-03-sdk-feature-parity-requirements.md`)

## Requirements Trace

**SDK Features:**
- R1. Regions via **element selectors** (resource-id, text, content-desc, class) OR coordinate fallback, with per-region algorithm selection (ignore, layout, standard, intelliignore). "Consider region" behavior = using standard or intelliignore on a bounded area. CLI relay resolves element selectors to bounding boxes via ADB uiautomator dump.
- R2. Per-region algorithm configuration (diffSensitivity, imageIgnoreThreshold, etc.)
- R3. Sync mode — relay waits, SDK logs best-effort summary (link + status or full response)
- R4. Status bar height via `PERCY_STATUS_BAR_HEIGHT`
- R5. Navigation bar height via `PERCY_NAV_BAR_HEIGHT`
- R6. Fullscreen flag via `PERCY_FULLSCREEN`
- R7. Test harness execution ID via `PERCY_TH_TEST_CASE_EXECUTION_ID`
- R8. Graceful degradation — invalid JSON skips regions, malformed individual regions skipped per-region, invalid bar heights omitted
- R9. SDK version bump to 0.2.0

**CLI Relay:**
- R10. Accept new fields (regions, sync, statusBarHeight, navBarHeight, fullscreen, thTestCaseExecutionId); silently ignore unknown fields
- R11. Apply tile metadata from request instead of hardcoding 0/false
- R12. Forward regions, sync, thTestCaseExecutionId to comparison pipeline
- R13. Sync response: wait for comparison, return details in response body
- R14. Backward compatibility with SDK 0.1.0

**Deferred:**
- R15. [DEFERRED] Batch upload in `maestro_percy_session.rb` — likely deprecated, cannot use sidecar files (GraalJS can't write files)

**Documentation:**
- R16. Document all new env vars; fix stale README (currently says multipart upload, should say relay)
- R17. Region format examples (copy-pasteable YAML)
- R18. Document excluded features with rationale

## Scope Boundaries

- **NOT implementing:** scrollableXpath, scrollableId, screenLengths, fullPage multi-tile — Maestro controls scrolling via YAML
- **NOT implementing:** freezeAnimations, percyCSS, enableJavascript — DOM/web-specific
- **NOT implementing:** XPath region selectors — element resolution uses Android view hierarchy attributes (resource-id, text, content-desc, class) via ADB uiautomator dump, not XPath expressions
- **NOT implementing:** App Automate features — Maestro uses generic Percy path
- **NOT implementing:** iOS support — separate initiative
- **NOT implementing (DEFERRED):** Batch upload parity (R15) — pending platform team confirmation

## Context & Research

### Relevant Code and Patterns

**Maestro SDK:**
- `percy/scripts/percy-screenshot.js` — current payload builder; env var pattern: `typeof VAR !== "undefined" && VAR`, parseInt for dimensions, conditional field inclusion
- `percy/scripts/percy-healthcheck.js` — extracts `x-percy-core-version` header, sets `output.percyEnabled`
- `percy/flows/percy-screenshot.yaml` — takes screenshot, runs JS script
- GraalJS constraints: `var` only, `json()` global, `console.log()` single arg, no Java interop

**Percy CLI relay:**
- `cli/packages/core/src/api.js:300-380` — `/percy/maestro-screenshot` handler: accepts name, sessionId, tag, testCase, labels, clientInfo, environmentInfo; reads PNG from disk via glob; creates tile with hardcoded `statusBarHeight: 0, navBarHeight: 0, fullscreen: false`; calls `percy.upload(payload, null, 'app')`
- `cli/packages/core/src/api.js:158-185` — `/percy/comparison` handler: reference pattern for sync mode using `percy.syncMode()` + `handleSyncJob()`
- `cli/packages/core/src/config.js:827-956` — full comparison schema with regions, algorithm, sync
- `cli/packages/core/src/snapshot.js:238-252` — `handleSyncJob()` returns `{ ...comparisonDetails }` or `{ error: "..." }`

**Sync response shape (resolved):**
- Non-sync: `{ success: true, link: "https://..." }`
- Sync: `{ success: true, data: { ...comparisonDetails } }` or `{ success: true, data: { error: "..." } }`
- SDK can check for `body.data` vs `body.link`

### Key API Contract

CLI `/percy/comparison` accepts regions in this format:
```
regions: [
  {
    elementSelector: { boundingBox: { x, y, width, height } },
    algorithm: "standard" | "layout" | "ignore" | "intelliignore",
    padding: { top, bottom, left, right },
    configuration: { diffSensitivity, imageIgnoreThreshold, carouselsEnabled, bannersEnabled, adsEnabled },
    assertion: { diffIgnoreThreshold }
  }
]
```

## Key Technical Decisions

- **Relay pattern only:** Verified via BrowserStack testing (2026-04-03). GraalJS sandbox blocks Java interop, CWD is unknown, multipartForm filePath fails with FileNotFoundException. (see origin)

- **Modern `regions` API:** Per-region algorithm selection. No legacy `ignoredElementsData`.

- **Element-based regions resolved by CLI relay:** SDK accepts regions identified by **element selectors** (`resource-id`, `text`, `content-desc`, `class`) — matching how other Percy SDKs work. The CLI relay resolves element selectors to bounding boxes via `adb shell uiautomator dump` on the host, then transforms to CLI format `{elementSelector: {boundingBox: {x, y, width, height}}}`. Coordinate-based regions (`{top, bottom, left, right}`) are also supported as a fallback. This keeps element resolution and coordinate transformation in Node.js (full debugging, ADB access, test infrastructure) rather than the constrained GraalJS sandbox.

- **Forward compatibility:** Old CLI relay handlers extract only specific known fields from `req.body` and construct their own payload — extra fields (regions, sync, etc.) are naturally ignored. SDK 0.2.0 payloads work against old CLI relays without error; the new fields are simply not forwarded to the comparison pipeline.

- **No `"consider"` algorithm value:** The CLI schema doesn't have it. "Consider region" behavior = `"standard"` or `"intelliignore"` on a bounded region.

## Open Questions

### Resolved During Planning

- **Sync response shape:** Non-sync returns `{ success, link }`, sync returns `{ success, data }` where data has comparison details or `{ error }`. SDK parses with `json()` and logs `data.link` or stringified response. Resolved by reading `handleSyncJob()` in `snapshot.js:238`.

- **Tile metadata validation:** The comparison pipeline accepts the values as-is. The CLI doesn't validate statusBarHeight against image dimensions. SDK-side validation (R8) rejects non-numeric values; the pipeline handles the rest.

- **Batch upload status:** R15 deferred. The `maestro_runner.rb` comment says batch upload is "no longer needed." Additionally, GraalJS can't write sidecar files so the proposed mechanism is infeasible.

### Deferred to Implementation

- **Exact `json()` behavior with nested sync response:** Verify during implementation that GraalJS `json()` handles the nested comparison details object. If it fails, fall back to logging the raw response body string.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
User YAML Flow
    │
    ├── env: SCREENSHOT_NAME, PERCY_REGIONS (JSON), PERCY_SYNC,
    │        PERCY_STATUS_BAR_HEIGHT, PERCY_NAV_BAR_HEIGHT,
    │        PERCY_FULLSCREEN, PERCY_TH_TEST_CASE_EXECUTION_ID
    │
    ▼
percy-screenshot.yaml
    ├── takeScreenshot: ${SCREENSHOT_NAME}
    ▼
percy-screenshot.js
    │  1. Parse env vars (JSON for regions, parseInt for heights, bool for sync/fullscreen)
    │  2. Validate region format (must have element selector OR coordinates)
    │  3. Build payload: name, sessionId, tag, testCase, labels,
    │     + regions[] (element selectors or coordinates), sync, statusBarHeight,
    │     navBarHeight, fullscreen, thTestCaseExecutionId
    │
    ▼
POST /percy/maestro-screenshot (Percy CLI relay)
    │  1. Read screenshot file from disk (existing glob logic)
    │  2. Create tile with base64 content + statusBarHeight/navBarHeight/fullscreen from request
    │  3. Resolve element-based regions:
    │     a. Run `adb -s {deviceId} shell uiautomator dump /dev/stdout`
    │     b. Parse XML, find elements by resource-id/text/content-desc/class
    │     c. Extract bounds → {elementSelector:{boundingBox:{x,y,w,h}}}
    │  4. Transform coordinate-based regions: {top,bottom,left,right} → same format
    │  5. Build comparison payload with resolved regions, sync, thTestCaseExecutionId
    │  6. If sync: percy.upload() with resolve/reject → handleSyncJob() → return data
    │     If !sync: percy.upload() → return link
    │
    ▼
Response → SDK logs link (non-sync) or comparison summary (sync)
```

## Implementation Units

- [ ] **Unit 1: Extend Percy CLI `/percy/maestro-screenshot` relay**

  **Goal:** Accept new fields and forward them to the comparison pipeline. Support sync mode.

  **Requirements:** R10, R11, R12, R13, R14

  **Dependencies:** None — foundational change, critical path.

  **Files:**
  - Modify: `/Users/arumullasriram/percy-repos/cli/packages/core/src/api.js` (maestro-screenshot handler, ~line 300-380)
  - Test: `/Users/arumullasriram/percy-repos/cli/packages/core/test/api.test.js`

  **Approach:**
  - Extract optional fields from `req.body`: `regions`, `sync`, `statusBarHeight`, `navBarHeight`, `fullscreen`, `thTestCaseExecutionId`
  - In the tile object construction (~line 351-358), replace hardcoded `0`/`false` with request values, defaulting to `0`/`false` when absent
  - If `req.body.regions` is present, resolve each region to CLI format:
    - **Element-based regions** (have `element` key with `resource-id`, `text`, `content-desc`, or `class`):
      1. Get the ADB device ID from the session config (`/usr/local/.browserstack/config/config.json`) using the `sessionId` from the request
      2. Run `adb -s {deviceId} shell uiautomator dump /dev/stdout` to get the view hierarchy XML (cache the dump per request — one dump serves all regions)
      3. Parse XML, find the matching node by the specified attribute(s)
      4. Extract `bounds="[x1,y1][x2,y2]"` → convert to `{elementSelector: {boundingBox: {x: x1, y: y1, width: x2-x1, height: y2-y1}}, algorithm, configuration?}`
      5. If element not found, log warning and skip that region (graceful degradation)
    - **Coordinate-based regions** (have `top`, `bottom`, `left`, `right` — fallback): transform `{top, bottom, left, right}` → `{elementSelector: {boundingBox: {x: left, y: top, width: right-left, height: bottom-top}}, algorithm, configuration?}`
  - Add resolved `regions` and `thTestCaseExecutionId` to the payload if present
  - For sync mode: add `req.body.sync` to the constructed `payload` object (if present) before the upload call. Replace the current upload block (lines 367-380) with a conditional branch:
    - **If `percy.syncMode(payload)` is true:** wrap `percy.upload(payload, {resolve, reject}, 'app')` in a new Promise, `await handleSyncJob(snapshotPromise, percy, 'comparison')`, and return `{ success: true, data }` (no `link` field)
    - **If not sync:** keep existing fire-and-forget `percy.upload(payload, null, 'app')` and return `{ success: true, link }` (no `data` field)
    - Important: call `percy.syncMode()` on the constructed `payload`, NOT on `req.body`
  - Unknown fields in `req.body` are naturally ignored — the handler only reads specific fields it knows about

  **Patterns to follow:**
  - `/percy/comparison` sync pattern at `api.js:158-165`
  - Existing field extraction pattern in maestro-screenshot handler

  **Test scenarios:**
  - POST with element-based region `{element:{"resource-id":"clock"}}` → ADB dump called, element resolved to boundingBox in comparison payload
  - POST with element-based region for non-existent element → warning logged, region skipped, upload proceeds
  - POST with coordinate-based region `{top,bottom,left,right}` → transformed to boundingBox in comparison payload
  - POST with mixed element + coordinate regions → both resolved correctly
  - POST with statusBarHeight=100, navBarHeight=50 → tile has correct values
  - POST with fullscreen=true → tile.fullscreen is true
  - POST with sync=true → response has `data` field with comparison details
  - POST with no new fields → backward compatible, identical behavior
  - POST with unknown field `futureField` → silently ignored, no error

  **Verification:**
  - All new fields forwarded correctly to comparison pipeline
  - Sync mode returns comparison details
  - SDK 0.1.0 payloads work unchanged

---

- [ ] **Unit 2: Add new options to Maestro SDK percy-screenshot.js**

  **Goal:** Parse new env vars, validate regions, transform to CLI format, include in relay payload.

  **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9

  **Dependencies:** Unit 1 (can develop in parallel, must test together)

  **Files:**
  - Modify: `/Users/arumullasriram/percy-repos/percy-maestro/percy/scripts/percy-screenshot.js`
  - Modify: `/Users/arumullasriram/percy-repos/percy-maestro/percy/scripts/percy-healthcheck.js` (add `output.percyCoreVersion` and fix missing `output.percyServer`)

  **Approach:**
  - **Healthcheck changes (formerly Unit 3):** In `percy-healthcheck.js`, store the CLI version from the `x-percy-core-version` header as `output.percyCoreVersion`. Also set `output.percyServer = percyServer` (pre-existing bug: `percy-screenshot.js` reads `output.percyServer` but healthcheck never sets it).
  - **PERCY_REGIONS:** Parse JSON with `json()` in a **local inner try/catch** (separate from the outer error handler — if json() throws, log warning and continue upload without regions, per R8). If valid array, iterate each region:
    - **Element-based:** Must have an `element` key with at least one of: `resource-id`, `text`, `content-desc`, `class`. Pass through as-is with `algorithm` (default `"ignore"`).
    - **Coordinate-based (fallback):** Must have numeric `top`, `bottom`, `left`, `right` with `bottom > top` and `right > left`.
    - Skip invalid regions (neither valid element selector nor valid coordinates) with `[percy] Warning: skipping invalid region...` log
    - Pass `configuration`, `padding`, `assertion` through if present
    - Add validated array as `payload.regions` (CLI relay handles element resolution via ADB and coordinate transformation)
  - **PERCY_SYNC:** Check `typeof !== "undefined"`, compare to string `"true"` (must be exactly `"true"`), set `payload.sync = true`. When sync is requested, log `[percy] Sync mode requested. CLI version: <output.percyCoreVersion>` for diagnostics — no semver parsing needed, just informational logging.
  - **PERCY_STATUS_BAR_HEIGHT / PERCY_NAV_BAR_HEIGHT:** parseInt, check `!isNaN`, add to payload
  - **PERCY_FULLSCREEN:** Compare to string `"true"`, add `payload.fullscreen = true`
  - **PERCY_TH_TEST_CASE_EXECUTION_ID:** String passthrough
  - **Version bump:** Change `clientInfo` to `"percy-maestro/0.2.0"`
  - **Sync response handling:** After successful POST, check response body. If `body.data` exists (sync response): log `body.data.link` if present, otherwise log the full response body as a string. If `body.link` exists (non-sync response): log as current behavior. Start simple — log raw response string for sync; add structured parsing if `json()` handles nested objects correctly during implementation.
  - **Forward compatibility:** Old CLI relays extract only known fields from `req.body` and ignore the rest naturally. New fields silently degrade — no error handling needed for forward compat.

  **Patterns to follow:**
  - Existing env var pattern: `typeof VAR !== "undefined" && VAR`
  - Existing parseInt pattern for PERCY_SCREEN_WIDTH/HEIGHT
  - Existing conditional inclusion: `if (typeof ... !== "undefined") payload.field = value`
  - Use `var` exclusively

  **Test scenarios:**
  - `PERCY_REGIONS='[{"element":{"resource-id":"com.app:id/clock"},"algorithm":"ignore"}]'` → element-based region passed to relay
  - `PERCY_REGIONS='[{"element":{"text":"Submit"},"algorithm":"standard","configuration":{"diffSensitivity":3}}]'` → element + config passed through (R2)
  - `PERCY_REGIONS='[{"top":0,"bottom":100,"left":0,"right":500,"algorithm":"ignore"}]'` → coordinate-based fallback region in payload
  - `PERCY_REGIONS='[{"top":100,"bottom":50,"left":0,"right":500}]'` → skipped with warning (bottom <= top)
  - `PERCY_REGIONS='invalid json'` → warning logged, no regions in payload, screenshot still uploads
  - `PERCY_REGIONS='[{"element":{"resource-id":"clock"}},{"bad":true}]'` → first region sent, second skipped with warning
  - `PERCY_SYNC=true` → `sync: true` in payload, comparison details logged from response
  - `PERCY_STATUS_BAR_HEIGHT=50` → `statusBarHeight: 50` in payload
  - `PERCY_STATUS_BAR_HEIGHT=abc` → field omitted (parseInt returns NaN)
  - `PERCY_FULLSCREEN=true` → `fullscreen: true` in payload
  - All env vars undefined → payload identical to current 0.1.0 behavior
  - `PERCY_REGIONS='[{"top":0,"bottom":100,"left":0,"right":500}]'` (no algorithm) → defaults to `"ignore"` algorithm
  - `PERCY_REGIONS='[{"top":0,"bottom":100,"left":0,"right":500,"algorithm":"standard","configuration":{"diffSensitivity":3}}]'` → region with configuration passed through (R2)
  - All env vars combined → all fields present in single payload

  **Verification:**
  - Payload includes all new fields when env vars set
  - No new fields when env vars absent (backward compatible)
  - Invalid regions don't crash script
  - Per-region validation skips bad regions, keeps good ones
  - Version string is `percy-maestro/0.2.0`

---

- [ ] **Unit 3: Update documentation**

  **Goal:** Update README, CLAUDE.md with new options, examples, and excluded feature rationale. Fix stale README architecture description.

  **Requirements:** R16, R17, R18

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `/Users/arumullasriram/percy-repos/percy-maestro/README.md`
  - Modify: `/Users/arumullasriram/percy-repos/percy-maestro/CLAUDE.md`

  **Approach:**
  - **Fix stale README:** Replace "multipart POST to `/percy/comparison/upload`" with correct description of JSON POST to `/percy/maestro-screenshot` relay
  - **Env var table:** Add complete table with all env vars (existing + new), types, defaults, examples
  - **Region examples (R17):** Copy-pasteable YAML showing:
    - Ignoring an element by resource ID: `PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/clock"},"algorithm":"ignore"}]'`
    - Focusing on a widget by text with intelliignore: `[{"element":{"text":"Submit Button"},"algorithm":"intelliignore"}]`
    - Region with per-region configuration (R2): `[{"element":{"resource-id":"com.app:id/header"},"algorithm":"standard","configuration":{"diffSensitivity":3}}]`
    - Coordinate fallback for complex cases: `[{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"}]`
    - Mixed element + coordinate regions
    - Full YAML flow example with all new env vars
  - **Feature exclusions (R18):** Table with excluded features and rationale (scrollable, freezeAnimations, percyCSS, XPath regions, App Automate, iOS)
  - **CLAUDE.md:** Add new env vars to the "Maestro JS Environment" section, document PERCY_REGIONS JSON contract

  **Patterns to follow:**
  - Existing README structure and format

  **Test scenarios:**
  - All new env vars documented with correct types
  - Region examples contain valid, parseable JSON
  - Stale multipart upload reference is corrected
  - Feature exclusion rationale is clear and accurate

  **Verification:**
  - README is comprehensive and accurate
  - Examples are functional when copy-pasted into a YAML flow

## System-Wide Impact

- **API surface parity:** The relay endpoint changes are additive — new optional fields, existing fields unchanged. SDK 0.1.0 continues to work.
- **Error propagation:** SDK catches invalid regions locally (per-region warnings), relay catches unknown fields silently. Screenshot uploads proceed even when new features fail.
- **State lifecycle:** `output.percyCoreVersion` added to healthcheck output — persists across flow steps. No conflict with existing keys.
- **Forward compatibility:** SDK 0.2.0 against old CLI — old relay handlers extract only known fields from `req.body` and ignore the rest naturally. New fields (regions, sync, etc.) are simply not forwarded to the comparison pipeline. No error, no rejection — features silently degrade.
- **Integration coverage:** Full end-to-end testing requires BrowserStack + Percy CLI (with updated relay) + SDK + test flow with new env vars. Unit-level testing is possible for each repo independently.

## Risks & Dependencies

- **Critical path:** CLI relay changes (Unit 1) must be deployed before SDK features are usable on BrowserStack. BrowserStack must update their Percy CLI version.
- **GraalJS `json()` with nested objects:** The sync response contains nested comparison details. If `json()` fails on deeply nested structures, fall back to logging raw response string. Low risk — `json()` is a standard JSON parser.
- **ADB uiautomator dump latency:** Each dump takes ~200-500ms. Mitigated by caching one dump per request (all regions in a single screenshot use the same dump).
- **View hierarchy timing:** The dump captures the current UI state at resolution time, which may differ slightly from screenshot capture time. Mitigated by the fact that `takeScreenshot` and `runScript` execute sequentially in Maestro — the UI should be stable between them.
- **Element not found:** If a specified element isn't in the hierarchy (e.g., scrolled off screen, wrong ID), that region is skipped with a warning — graceful degradation per R8.
- **Coordinate fallback for edge cases:** If uiautomator dump fails or ADB is unavailable (e.g., local development without ADB), coordinate-based regions still work as a fallback.
- **R15 batch upload:** Deferred. If the platform team confirms it's still active, a follow-up plan is needed. The sidecar file mechanism is infeasible; an alternative (session-level config from maestro_runner.rb) would need to be designed.

## Phased Delivery

### Phase 1: CLI Relay (Unit 1)
Ship CLI changes first. This is the foundational change that unblocks everything. Can be deployed independently — backward compatible with SDK 0.1.0.

### Phase 2: SDK + Healthcheck (Unit 2)
Ship SDK and healthcheck changes together. Unit 2 includes both `percy-screenshot.js` and `percy-healthcheck.js` modifications.

### Phase 3: Documentation (Unit 3)
Ship alongside or after Phase 2. Must accurately reflect implemented behavior.

## Documentation / Operational Notes

- README correction is overdue — currently describes wrong upload mechanism
- CLAUDE.md updates keep AI-assisted development accurate
- Consider a troubleshooting section for region coordinate issues (device scaling, orientation)

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-03-sdk-feature-parity-requirements.md](docs/brainstorms/2026-04-03-sdk-feature-parity-requirements.md)
- Percy CLI relay handler: `cli/packages/core/src/api.js:300-380`
- Percy CLI comparison schema: `cli/packages/core/src/config.js:827-956`
- Percy CLI sync handler: `cli/packages/core/src/snapshot.js:238-252`
- Percy CLI sync pattern reference: `cli/packages/core/src/api.js:158-165`
- Maestro SDK screenshot script: `percy/scripts/percy-screenshot.js`
- Maestro SDK healthcheck: `percy/scripts/percy-healthcheck.js`
- BrowserStack test verification: builds `e057728543394c2b5707e575ad7fd50cd5bfb0b6`, `5cdb2b5b8f8576053131ec55e24032924be6ab4d`
- Reference SDK: `percy-appium-python/percy/providers/generic_provider.py`
