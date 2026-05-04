---
date: 2026-04-21
topic: sdk-feature-parity
---

# percy-maestro-android SDK Feature Parity

## Problem Frame

`percy-maestro-android` is at v0.1.0 with only basic screenshot upload (device tag, testCase, labels). The sibling `percy-maestro` repo has already shipped v0.3.0 with richer SDK features: regions, sync mode, tile metadata, and thTestCaseExecutionId. Users running Percy from Maestro Android flows lose feature parity with other Percy SDKs (Espresso, Appium Python) — notably they cannot ignore dynamic UI, get synchronous comparison results, or correlate screenshots with CI test executions.

We want `percy-maestro-android` to reach parity with `percy-maestro` v0.3.0 **and** close the one remaining gap both share: element-based regions on Android. The repo stays Android-only; iOS parity is out of scope. Target ship version: **v0.3.0** (matches `percy-maestro` numerically to signal feature parity).

## Requirements

- **R1. Coordinate-based regions.** Users can pass `PERCY_REGIONS` as a JSON array of `{top, bottom, left, right, algorithm}` objects. Supported algorithms: `ignore`, `standard`, `intelliignore`, `layout`. Invalid JSON logs a warning and uploads without regions. Individual malformed regions (non-numeric coords, zero/negative area) are skipped with a per-region warning; valid ones are still sent.
- **R2. Per-region configuration.** Each region may include optional `configuration` (e.g., `diffSensitivity`, `imageIgnoreThreshold`, `carouselsEnabled`, `bannersEnabled`, `adsEnabled`), `padding`, and `assertion` fields. The SDK passes these through verbatim to the CLI relay.
- **R3. Sync mode.** `PERCY_SYNC=true` makes the SDK wait for the comparison result and log the `data` field from the relay response.
- **R4. Tile metadata.** `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, and `PERCY_FULLSCREEN` are forwarded to the relay so the CLI can exclude system chrome from the comparison tile. Non-numeric bar-height values are silently omitted and CLI defaults (0) apply.
- **R5. Test-harness execution ID.** `PERCY_TH_TEST_CASE_EXECUTION_ID` is forwarded for CI/CD correlation.
- **R6. Element-based regions via Android view hierarchy.** Users can pass regions of the form `{"element": {"resource-id": "..."}, "algorithm": "ignore"}`. Supported selector keys: `resource-id`, `text`, `content-desc`, `class`. The CLI relay resolves each selector to **exactly one element — the first match in pre-order traversal of the view hierarchy** (mirrors appium-python), via ADB + `uiautomator` dump, and converts it to the `elementSelector.boundingBox` payload. Elements not found log a per-element warning and are skipped; valid elements and valid coordinate-regions in the same call still upload.
- **R7. Android-only gate retained.** The healthcheck continues to disable Percy when `maestro.platform !== "android"` with a clear log line. Users on iOS flows should use `percy-maestro`.
- **R8. Updated YAML sub-flows.** The two flow files add `appId: _percy_subflow` + `name:` headers (matching `percy-maestro`) so they don't inherit the parent flow's appId when invoked via `runFlow`.
- **R9. Updated README.** README documents every new env var, the regions JSON schema with examples (both element-based and coordinate-based), the algorithms table, sync mode, and a "Features not supported" section explaining why XPath / POA / full-page / percyCSS / freezeAnimations are not applicable.
- **R10. BrowserStack-only runtime is an explicit scope boundary.** The CLI relay's session-dir file layout is BrowserStack-specific. README calls out that the SDK is supported only on BrowserStack Maestro sessions. No local-dev fallback is implemented.
- **R11. Identity strings bumped.** The SDK sends `clientInfo: "percy-maestro-android/0.3.0"` (separate bucket from `percy-maestro/*` in Percy's internal analytics). `environmentInfo` remains `percy-maestro`. Update the string in `percy-screenshot.js` and surface it via the healthcheck log line.

## Success Criteria

- Running a Maestro flow against a BrowserStack Android session with `PERCY_REGIONS` set (mix of coordinate and element selectors) produces a Percy comparison where only the expected regions are flagged per the chosen algorithm.
- Running with `PERCY_SYNC=true` returns comparison details in the flow log before the flow proceeds.
- Feature matrix: `percy-maestro-android` matches every applicable `percy-espresso-java` and `percy-appium-python` feature, with explicit documentation for each non-applicable one.
- Existing v0.1.0 users (no new env vars set) see zero behavior change.
- Percy analytics shows `percy-maestro-android/0.3.0` traffic as a distinct SDK source from `percy-maestro/*`.

## Scope Boundaries

- **Not in scope: iOS.** `percy-maestro` covers iOS. The Android-only gate stays.
- **Not in scope: local `maestro test` runtime.** The relay requires BrowserStack's `PERCY_SESSION_ID` + session-dir layout. Documented, not fixed.
- **Not in scope: Percy on Automate (POA).** POA requires Appium-style driver capabilities and live sessions; Maestro has no equivalent execution model.
- **Not in scope: full-page / scrollable screenshots.** Maestro's pattern is explicit `scroll` steps + separate screenshots.
- **Not in scope: XPath region selectors.** Android view hierarchy does not expose XPath; we use `resource-id` / `text` / `content-desc` / `class` instead.
- **Not in scope: DOM-specific features** (`freezeAnimations`, `percyCSS`, `enableJavascript`) — native bitmap captures have no DOM.
- **Not in scope: CLI min-version validation** — explicitly deferred.
- **Not in scope: `/percy/events` error reporting** — explicitly deferred.
- **Not in scope: cross-repo user-facing messaging** (e.g., "iOS users go to percy-maestro" notes in READMEs) — deferred until repo-consolidation decision.
- **Not in scope: SDK release/publish mechanics.** Distributed as a copy-in directory; no package version bump infrastructure to build.

## Key Decisions

- **Port from `percy-maestro` instead of rewriting.** The v0.3.0 scripts already work on Android and iOS. We copy the Android-relevant subset into `percy-maestro-android`, then strip iOS branches and restore the Android-only platform gate.
- **Element resolution lives in the CLI relay, not the Maestro script.** Maestro's GraalJS sandbox has no access to the Android view hierarchy. ADB + `uiautomator dump` only works from the host running the Percy CLI (which in BrowserStack's Maestro environment has device ADB access).
- **First match wins for element selectors.** Matches appium-python's behavior. Keeps mental model simple; pushes disambiguation onto the user when needed.
- **Validate via full E2E on BrowserStack Maestro.** This is the deployed environment; CLI unit tests and SDK unit tests are not load-bearing for sign-off since the relay depends on real session-dir state and real ADB.
- **Keep the relay payload shape that `percy-maestro` already sends.** Both SDKs will POST the same JSON schema to `/percy/maestro-screenshot`, which means one CLI change (element resolution) benefits both.
- **Keep the repo Android-only.** Explicitly chosen — preserves the current deployment story and avoids cross-platform regression risk.
- **Ship as v0.3.0 with `clientInfo: percy-maestro-android/0.3.0`.** Version parity with `percy-maestro` signals feature equivalence; distinct `clientInfo` splits analytics so we can diagnose Android-specific SDK issues independently.

## Dependencies / Assumptions

- The Percy CLI's `/percy/maestro-screenshot` endpoint (in `cli/packages/core/src/api.js`) is owned code and can be extended.
- The Percy CLI process running alongside BrowserStack's Maestro Android runner has access to the device via `adb` — required for R6.
- BrowserStack's `maestro_runner.rb` continues to inject `PERCY_SESSION_ID` into the flow environment (already true).
- A BrowserStack Maestro session is available (with an Android app) for E2E validation.

## Outstanding Questions

### Resolve Before Planning

_(none)_

### Deferred to Planning

- [Affects R6][Needs research] Does the Percy CLI process have ADB access to the device in BrowserStack's Maestro Android runtime? If not, R6 must fall back to a clear "element regions not available on this runtime" warning instead of silently skipping.
- [Affects R6][Technical] Should ADB resolution happen via streaming `uiautomator dump /dev/tty` + XML parse, or via `adb shell uiautomator dump /sdcard/...` + pull? Streaming is lower latency; file-dump is more reliable across Android versions. Pick during planning.
- [Affects R6][Technical] Where does the ADB view-hierarchy cache live per screenshot? One dump per region would be slow for flows with many regions; a per-screenshot cache keyed by `(sessionId, screenshotName)` is likely correct.
- [Affects R11][Technical] Should the healthcheck response carry the CLI's reported `sdk` identifier back so the SDK can confirm its own clientInfo survives through analytics? Nice-to-have diagnostic.

## Next Steps

→ `/ce:plan` for structured implementation planning
