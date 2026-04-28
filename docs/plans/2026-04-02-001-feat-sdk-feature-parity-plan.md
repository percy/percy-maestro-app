---
title: "feat: Achieve Percy SDK Feature Parity for Maestro"
type: feat
status: active
date: 2026-04-02
origin: docs/brainstorms/2026-04-03-sdk-feature-parity-requirements.md
---

# feat: Achieve Percy SDK Feature Parity for Maestro

## Overview

Add support for regions (ignore/consider/custom), sync mode, status bar/nav bar heights, fullscreen flag, thTestCaseExecutionId, and comparison algorithm configuration to the Percy Maestro SDK. This requires changes across three repos: the Maestro SDK itself, the Percy CLI relay endpoint (`/percy/maestro-screenshot`), and the mobile platform's batch upload fallback.

## Problem Frame

The Percy Maestro SDK currently supports only basic screenshot capture with name, sessionId, tag metadata, testCase, and labels. Other Percy SDKs (percy-appium-python, percy-espresso-java) support a much richer set of comparison options — particularly **regions** (ignore, consider, custom with algorithm selection), **sync mode**, and **tile metadata** (statusBarHeight, navBarHeight, fullscreen). Users who adopt the Maestro SDK lose access to these capabilities that they may rely on in their existing Percy workflows.

## Requirements Trace

- R1. SDK accepts and passes **ignore regions** (custom coordinate-based regions) to the Percy CLI
- R2. SDK accepts and passes **consider regions** (custom coordinate-based regions) to the Percy CLI
- R3. SDK accepts and passes **region algorithm** configuration (standard, layout, ignore, intelliignore) with sensitivity settings
- R4. SDK supports **sync mode** — returns comparison details when enabled
- R5. SDK passes **statusBarHeight** and **navBarHeight** to control tile rendering
- R6. SDK passes **fullscreen** flag to control tile rendering
- R7. SDK passes **thTestCaseExecutionId** for test harness integration
- R8. Percy CLI `/percy/maestro-screenshot` relay endpoint accepts and forwards all new fields to the internal comparison pipeline
- R9. Mobile platform's `maestro_percy_session.rb` batch upload supports new fields as a fallback path
- R10. Document features that don't apply to Maestro with rationale

## Scope Boundaries

- **NOT implementing:** scrollableXpath, scrollableId, screenLengths, fullPage multi-tile scrolling — Maestro controls scrolling via YAML flows, not JS scripts. Users should use Maestro's `scroll` command before calling `percy-screenshot`.
- **NOT implementing:** freezeAnimations, percyCSS, enableJavascript — these are web/DOM-specific features not applicable to native mobile screenshots.
- **NOT implementing:** App Automate-specific features (freeze_animated_image, freeze_image_by_selectors) — Maestro uses the generic Percy path, not BrowserStack Automate.
- **NOT implementing:** XPath or accessibility ID-based regions — Maestro's GraalJS environment cannot resolve element coordinates. Only coordinate-based custom regions are supported.
- **NOT implementing:** iOS support (separate initiative).

## Context & Research

### Relevant Code and Patterns

**Maestro SDK (current):**
- `percy/scripts/percy-screenshot.js` — builds JSON payload with name, sessionId, tag, testCase, labels; POSTs to `/percy/maestro-screenshot`
- `percy/scripts/percy-healthcheck.js` — checks `/percy/healthcheck`, sets `output.percyEnabled`
- `percy/flows/percy-screenshot.yaml` — takes screenshot, runs JS script
- All config via Maestro env vars (global variables in GraalJS), checked with `typeof VAR !== "undefined"`

**Percy CLI relay endpoint:**
- `cli/packages/core/src/api.js:300` — `/percy/maestro-screenshot` handler accepts name, sessionId, tag, testCase, clientInfo, environmentInfo, labels
- Reads PNG from `/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`
- Internally creates a comparison with tiles (base64 content from the file)

**Percy CLI comparison schema:**
- `cli/packages/core/src/config.js:827-956` — full `/percy/comparison` schema
- Supports `regions` array with `elementSelector` (elementCSS, elementXpath, **boundingBox**), `algorithm`, `configuration`, `padding`, `assertion`
- Supports `sync`, `ignoredElementsData`, `consideredElementsData`, `thTestCaseExecutionId`
- Tiles support `statusBarHeight`, `navBarHeight`, `headerHeight`, `footerHeight`, `fullscreen`

**Percy Appium Python (reference SDK):**
- `percy/providers/generic_provider.py` — builds `ignored_elements_data` and `considered_elements_data` from element coordinates
- `percy/lib/cli_wrapper.py` — sends all fields to `/percy/comparison`
- Region class at `percy/lib/region.py` — `Region(top, bottom, left, right)`

**Mobile platform:**
- `mobile/android/maestro/app_percy/maestro_percy_session.rb:81-98` — batch upload path; hardcodes statusBarHeight=0, navBarHeight=0, fullscreen=false
- `mobile/android/espresso/app_percy/cli_manager.rb` — starts Percy CLI, manages lifecycle

### Key API Contract

The Percy CLI `/percy/comparison` endpoint accepts `regions` in this format:
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

This is the modern regions API. The legacy `ignoredElementsData`/`consideredElementsData` format is also supported but regions is preferred.

## Key Technical Decisions

- **Use modern `regions` API over legacy `ignoredElementsData`:** The CLI's `regions` schema supports algorithm selection per region, which is more powerful and forward-compatible. The legacy format only supports ignore/consider binary.

- **Encode complex options as JSON env vars:** Regions and algorithm configuration are complex objects. In Maestro's env var model, these must be passed as JSON strings (e.g., `PERCY_REGIONS='[{"top":0,"bottom":100,"left":0,"right":200,"algorithm":"ignore"}]'`). The SDK parses these in JS.

- **Extend the `/percy/maestro-screenshot` relay endpoint:** Switching the SDK to `/percy/comparison/upload` (multipart) is not viable. Verified via BrowserStack testing on 2026-04-03 (build `e057728543394c2b5707e575ad7fd50cd5bfb0b6` and `5cdb2b5b8f8576053131ec55e24032924be6ab4d`). Three compounding constraints prevent the JS sandbox from sending files directly:
  1. **No Java interop** — `Java.type()` returns null; GraalJS sandbox blocks it. Cannot discover CWD or list directories.
  2. **Unknown working directory** — OkHttp3 resolves `filePath` relative to the JVM's CWD, which doesn't match the Maestro workspace where `takeScreenshot` saves files. All relative paths fail with `java.io.FileNotFoundException`.
  3. **No path construction** — `PERCY_SESSION_ID` (needed for absolute path `/tmp/{sessionId}_test_suite/.maestro/{name}.png`) is not reliably available in the JS scope.
  The relay pattern (SDK sends metadata, Percy CLI reads file from disk using sessionId + glob) is the only viable approach.

- **SDK version bump to 0.2.0:** These are significant new capabilities warranting a minor version bump.

- **Flat env var structure for simple options:** statusBarHeight, navBarHeight, fullscreen, sync, thTestCaseExecutionId each get their own `PERCY_*` env var. Only regions use JSON encoding.

## Open Questions

### Resolved During Planning

- **Q: Should regions use XPath/accessibility ID selectors?** No. Maestro's GraalJS environment cannot resolve element coordinates from selectors. Only coordinate-based (boundingBox) regions are supported. Document this limitation.

- **Q: Should the SDK send the file via multipart upload to `/percy/comparison/upload`?** No. Verified via BrowserStack testing (2026-04-03). The GraalJS sandbox blocks `Java.type()` (returns null), so the script cannot discover its CWD or list directories. OkHttp3 resolves `filePath` relative to the JVM's CWD which doesn't match the Maestro workspace. All relative AND absolute path attempts fail with `java.io.FileNotFoundException`. The relay pattern is the only viable approach.

- **Q: Modern `regions` array or legacy `ignoredElementsData`?** Modern `regions` — it supports per-region algorithm selection and is the current CLI schema.

### Deferred to Implementation

- **Q: Exact sync mode response handling in GraalJS.** The sync response includes comparison details; need to verify the response shape matches what `json()` can parse.

- **Q: Percy CLI version check for sync mode.** Sync requires CLI v1.28.0+. May want to add version checking in healthcheck. Decide during implementation based on effort.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
User YAML Flow
    │
    ├── env: SCREENSHOT_NAME, PERCY_REGIONS (JSON), PERCY_SYNC, PERCY_STATUS_BAR_HEIGHT, etc.
    │
    ▼
percy-screenshot.yaml
    │
    ├── takeScreenshot: ${SCREENSHOT_NAME}
    │
    ▼
percy-screenshot.js
    │  Parse env vars → Build payload with:
    │    name, sessionId, tag, testCase, labels,
    │    regions[], sync, statusBarHeight, navBarHeight,
    │    fullscreen, thTestCaseExecutionId
    │
    ▼
POST /percy/maestro-screenshot (Percy CLI)
    │  Reads screenshot from disk
    │  Creates tile with base64 content + statusBarHeight/navBarHeight/fullscreen
    │  Maps regions to comparison schema
    │
    ▼
Internal /percy/comparison pipeline
    │  Processes regions, algorithm config
    │  If sync=true, waits for result
    │
    ▼
Response → SDK logs link (or comparison details if sync)
```

## Implementation Units

- [ ] **Unit 1: Extend Percy CLI `/percy/maestro-screenshot` relay endpoint**

  **Goal:** Accept new fields (regions, sync, statusBarHeight, navBarHeight, fullscreen, thTestCaseExecutionId) and forward them to the internal comparison pipeline.

  **Requirements:** R1, R2, R3, R4, R5, R6, R7, R8

  **Dependencies:** None — this is the foundational change.

  **Files:**
  - Modify: `cli/packages/core/src/api.js` (maestro-screenshot handler ~line 300)
  - Modify: `cli/packages/core/src/config.js` (maestro-screenshot schema validation)
  - Test: `cli/packages/core/test/api.test.js` (or equivalent test file)

  **Approach:**
  - Add new optional fields to the maestro-screenshot request schema: `regions` (array), `sync` (boolean), `statusBarHeight` (integer), `navBarHeight` (integer), `fullscreen` (boolean), `thTestCaseExecutionId` (string)
  - In the handler, when building the internal comparison object:
    - Pass `statusBarHeight`, `navBarHeight`, `fullscreen` into the tile object (currently hardcoded to 0/false)
    - Pass `regions` array directly to the comparison
    - Pass `sync` and `thTestCaseExecutionId` to the comparison
  - If `sync` is true, return comparison details in the response instead of just the link

  **Patterns to follow:**
  - Follow the existing `/percy/comparison` schema at `config.js:827` for field definitions
  - Follow the existing maestro-screenshot handler pattern for field extraction

  **Test scenarios:**
  - POST with regions array → regions forwarded to comparison
  - POST with statusBarHeight/navBarHeight → tile created with correct heights
  - POST with sync=true → response includes comparison details
  - POST with no new fields → backward compatible, works as before
  - POST with invalid regions format → appropriate error response

  **Verification:**
  - The relay endpoint accepts and forwards all new fields
  - Existing SDK behavior is unbroken (backward compatible)

---

- [ ] **Unit 2: Add new options to Maestro SDK percy-screenshot.js**

  **Goal:** Parse new env vars and include them in the payload sent to the relay endpoint.

  **Requirements:** R1, R2, R3, R4, R5, R6, R7

  **Dependencies:** Unit 1 (CLI must accept the fields; can be developed in parallel but tested together)

  **Files:**
  - Modify: `percy/scripts/percy-screenshot.js`

  **Approach:**
  - Add env var parsing for:
    - `PERCY_REGIONS` — JSON string, parse with `json()`, validate it's an array. Each item has: `top`, `bottom`, `left`, `right` (coordinates), `algorithm` (optional, defaults to "ignore"), plus optional `padding`, `configuration`, `assertion`
    - `PERCY_SYNC` — string "true"/"false", convert to boolean
    - `PERCY_STATUS_BAR_HEIGHT` — integer, parse with parseInt
    - `PERCY_NAV_BAR_HEIGHT` — integer, parse with parseInt
    - `PERCY_FULLSCREEN` — string "true"/"false", convert to boolean
    - `PERCY_TH_TEST_CASE_EXECUTION_ID` — string, pass through
  - Transform `PERCY_REGIONS` from the simplified coordinate format to the CLI's `regions` schema (wrapping coordinates in `elementSelector.boundingBox` format: `{x: left, y: top, width: right-left, height: bottom-top}`)
  - Add all parsed fields to the payload object conditionally (only if defined)
  - Use `var` for all declarations (GraalJS compatibility)
  - Wrap JSON parsing in try/catch with `[percy]` prefixed error logging

  **Patterns to follow:**
  - Existing env var parsing pattern: `typeof VAR !== "undefined" && VAR`
  - Existing parseInt pattern for screen dimensions
  - Existing conditional field inclusion pattern

  **Test scenarios:**
  - PERCY_REGIONS with valid JSON → regions array in payload
  - PERCY_REGIONS with invalid JSON → logged error, screenshot still uploads without regions
  - PERCY_SYNC=true → sync field in payload
  - PERCY_STATUS_BAR_HEIGHT=50 → statusBarHeight: 50 in payload
  - All new env vars undefined → payload unchanged (backward compatible)
  - Combined: regions + sync + bar heights → all fields present

  **Verification:**
  - Payload sent to relay includes all new fields when env vars are set
  - No new fields sent when env vars are absent
  - Invalid JSON for regions doesn't crash the script

---

- [ ] **Unit 3: Update mobile platform batch upload fallback**

  **Goal:** Ensure `maestro_percy_session.rb` batch upload supports the new fields when used as a fallback.

  **Requirements:** R9

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `mobile/android/maestro/app_percy/maestro_percy_session.rb`

  **Approach:**
  - The batch upload currently hardcodes `statusBarHeight: 0`, `navBarHeight: 0`, `fullscreen: false` in tile objects
  - Read additional Percy options from a sidecar JSON file (e.g., `{screenshot_name}_percy_options.json`) alongside each screenshot if present
  - If the sidecar file exists, extract: regions, sync, statusBarHeight, navBarHeight, fullscreen, thTestCaseExecutionId
  - Apply statusBarHeight/navBarHeight/fullscreen to tile objects
  - Pass regions, sync, thTestCaseExecutionId to the comparison payload
  - If no sidecar file, maintain current behavior (backward compatible)

  **Patterns to follow:**
  - Existing `build_tag` method pattern for reading config
  - Existing error handling pattern with `rescue StandardError`

  **Test scenarios:**
  - Screenshot with sidecar options file → options applied to upload
  - Screenshot without sidecar file → current behavior preserved
  - Sidecar file with partial options → only provided options applied
  - Malformed sidecar JSON → logged error, upload proceeds with defaults

  **Verification:**
  - Batch upload path supports all new fields
  - Backward compatible when sidecar file absent

---

- [ ] **Unit 4: Update SDK healthcheck for CLI version awareness**

  **Goal:** Store the Percy CLI version from healthcheck and use it to warn about feature availability.

  **Requirements:** R4 (sync requires CLI v1.28.0+)

  **Dependencies:** None

  **Files:**
  - Modify: `percy/scripts/percy-healthcheck.js`

  **Approach:**
  - The healthcheck already extracts `x-percy-core-version` from the response header
  - Store the version in `output.percyCoreVersion` so percy-screenshot.js can access it
  - In percy-screenshot.js, when sync mode is requested, check the version and warn if < 1.28.0
  - Parse version as major.minor.patch integers for comparison

  **Patterns to follow:**
  - Existing `output.percyEnabled` pattern for persisting data between flows
  - Existing header extraction in healthcheck

  **Test scenarios:**
  - CLI version 1.28.0+ with sync=true → no warning
  - CLI version < 1.28.0 with sync=true → warning logged, sync still attempted
  - CLI version header missing → version stored as empty, no crash

  **Verification:**
  - Percy CLI version is available to screenshot script
  - Version warning is informational only, doesn't block functionality

---

- [ ] **Unit 5: Update SDK version and documentation**

  **Goal:** Bump SDK version, update README with new options, document excluded features.

  **Requirements:** R10

  **Dependencies:** Units 2, 4

  **Files:**
  - Modify: `percy/scripts/percy-screenshot.js` (version string)
  - Modify: `percy/scripts/percy-healthcheck.js` (if version referenced)
  - Modify: `README.md`
  - Modify: `CLAUDE.md`

  **Approach:**
  - Bump `clientInfo` from `percy-maestro/0.1.0` to `percy-maestro/0.2.0`
  - Update README with new env var documentation table
  - Add a "Supported Features" section listing what's available
  - Add a "Feature Exclusions" section documenting what's not supported and why:
    - scrollableXpath/scrollableId — Maestro handles scrolling via YAML `scroll` command
    - fullPage/screenLengths — same reason; capture multiple screenshots with Maestro scroll between them
    - freezeAnimations/percyCSS — web/DOM-specific, not applicable to native screenshots
    - XPath/accessibility ID regions — GraalJS cannot resolve element coordinates
  - Add usage examples for regions and sync mode

  **Patterns to follow:**
  - Existing README format and structure

  **Test scenarios:**
  - Version string updated in all locations
  - Documentation accurately reflects supported options

  **Verification:**
  - README documents all new env vars with types and examples
  - Feature exclusions are documented with rationale

---

- [ ] **Unit 6: Add a `PERCY_REGIONS` helper/example for common patterns**

  **Goal:** Provide a convenience YAML sub-flow or documentation showing how to use regions for common use cases (e.g., ignoring a dynamic clock/timestamp area).

  **Requirements:** R1, R2, R10

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `README.md` (add examples section)

  **Approach:**
  - Document the PERCY_REGIONS JSON format with concrete examples:
    - Ignoring a status bar area: `[{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"}]`
    - Considering only a specific widget: `[{"top":200,"bottom":600,"left":50,"right":1030,"algorithm":"intelliignore"}]`
    - Multiple regions with different algorithms
  - Show full YAML flow example with regions env var
  - Explain the coordinate system (pixels from top-left of screenshot)

  **Test scenarios:**
  - Examples use valid JSON that parses correctly
  - Coordinate examples are realistic for common devices

  **Verification:**
  - Examples are copy-pasteable and functional

## System-Wide Impact

- **API surface parity:** The `/percy/maestro-screenshot` relay endpoint schema changes must be backward compatible — existing SDK versions (0.1.0) should continue to work without sending new fields.
- **Error propagation:** Invalid regions JSON in the SDK should be caught locally with a warning log; the screenshot should still upload without regions rather than failing entirely.
- **State lifecycle:** The `output.percyCoreVersion` value persists across flow steps. Ensure it doesn't conflict with other output keys.
- **Integration coverage:** End-to-end testing requires: Android emulator + Maestro + Percy CLI (with updated relay) + test flow using new env vars.

## Risks & Dependencies

- **Percy CLI repo changes required first:** Unit 1 (CLI relay extension) must be deployed before the SDK can use new features. This is the critical path dependency.
- **GraalJS JSON parsing limitations:** The `json()` global may have edge cases with deeply nested structures. The regions JSON should be validated early in implementation.
- **Sidecar file approach for batch upload (Unit 3):** This is a design decision that may need revision if the batch upload path is being deprecated. The comment in `maestro_runner.rb` suggests batch upload is "no longer needed."
- **Coordinate system mismatch risk:** If the screenshot resolution differs from the coordinate system the user specifies regions in (e.g., due to device scaling), regions may be misaligned. Document that coordinates should match the screenshot pixel dimensions.

## Feature Exclusion Rationale

| Feature | Why Excluded |
|---------|-------------|
| `scrollableXpath` / `scrollableId` | Maestro controls scrolling via YAML `scroll` command. Users capture multiple screenshots with scrolling between them. |
| `fullPage` / `screenLengths` | Same as above — Maestro's flow-based model handles this differently. |
| `freezeAnimations` / `percyCSS` | DOM/web-specific features. Native mobile screenshots are bitmap captures; there is no DOM to inject CSS into. |
| `enableJavascript` | Web-specific. |
| XPath/accessibility ID regions | Maestro's GraalJS environment cannot resolve element bounding boxes from selectors. Only coordinate-based regions are possible. |
| App Automate features | Maestro uses the generic Percy path, not BrowserStack Automate. |

## Documentation / Operational Notes

- README must document the new `PERCY_REGIONS` JSON format clearly with examples
- CLAUDE.md should be updated to reflect new env vars and the regions JSON contract
- Consider adding a troubleshooting section for common region coordinate issues

## Sources & References

- Related code: `cli/packages/core/src/api.js:300` (maestro-screenshot handler)
- Related code: `cli/packages/core/src/config.js:827-956` (comparison schema with regions)
- Related code: `percy-appium-python/percy/providers/generic_provider.py` (reference region implementation)
- Related code: `mobile/android/maestro/app_percy/maestro_percy_session.rb` (batch upload)
- Percy CLI comparison schema defines `regions[].elementSelector.boundingBox` format: `{x, y, width, height}`
