# Unit 7 — End-to-End Validation on BrowserStack Maestro

**Goal:** Prove every requirement (R1–R11) works end-to-end against a real BrowserStack Maestro Android session with the Phase 2 CLI deployed.

**Gated by:** Unit 0 ADB spike must have passed (see `test/unit-0-adb-spike.md`), and the Phase 2 `@percy/core` must be built into the BrowserStack Maestro runner container image.

**Related plan:** `docs/plans/2026-04-21-001-feat-sdk-feature-parity-plan.md` → Unit 7.

---

## Prerequisites

- BrowserStack Maestro Android session available with a test Android app uploaded (App Live / App Automate).
- `PERCY_TOKEN` set for a test Percy project.
- BrowserStack Maestro runner image rebuilt and rolled out with the `@percy/core` version that contains `adb-hierarchy.js` and the updated relay.
- The `percy/` directory from this repo copied into a Maestro workspace zip that also contains a test flow (see **Test flow** below).
- At least two distinct BrowserStack device profiles available (e.g., Pixel + Samsung) for the device-matrix spot-check.

## Test flow

Prepare one Maestro flow that exercises every feature. Example (`test/e2e/full-coverage.yaml` — not committed, created at validation time):

```yaml
appId: com.example.testapp
env:
  PERCY_DEVICE_NAME: "Pixel 7"
  PERCY_OS_VERSION: "14"
  PERCY_SCREEN_WIDTH: "1080"
  PERCY_SCREEN_HEIGHT: "2400"
---
- runFlow: percy/flows/percy-init.yaml
- launchApp

# Baseline screenshot (coords only)
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Baseline

# Sync mode
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: SyncShot
      PERCY_SYNC: "true"

# Coordinate regions (one per algorithm)
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: CoordRegions
      PERCY_REGIONS: '[{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"},{"top":200,"bottom":300,"left":0,"right":1080,"algorithm":"standard"},{"top":400,"bottom":500,"left":0,"right":1080,"algorithm":"intelliignore"},{"top":600,"bottom":700,"left":0,"right":1080,"algorithm":"layout"}]'

# Element regions (one per selector type)
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: ElementRegions
      PERCY_REGIONS: '[{"element":{"resource-id":"com.example.testapp:id/header"},"algorithm":"ignore"},{"element":{"text":"Submit"},"algorithm":"ignore"},{"element":{"content-desc":"Profile"},"algorithm":"ignore"},{"element":{"class":"android.widget.Toolbar"},"algorithm":"ignore"}]'

# Deliberate miss
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: ElementMiss
      PERCY_REGIONS: '[{"element":{"resource-id":"does.not.exist:id/nope"},"algorithm":"ignore"},{"top":0,"bottom":50,"left":0,"right":100,"algorithm":"ignore"}]'

# Tile metadata + fullscreen + testCase + labels + thTestCaseExecutionId
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: TileAndMeta
      PERCY_STATUS_BAR_HEIGHT: "50"
      PERCY_NAV_BAR_HEIGHT: "48"
      PERCY_FULLSCREEN: "false"
      PERCY_TEST_CASE: "e2e-suite"
      PERCY_LABELS: "e2e,sanity"
      PERCY_TH_TEST_CASE_EXECUTION_ID: "TH-e2e-001"

# Landscape (requires flow to rotate — use Maestro's setOrientation if supported)
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: LandscapeShot
      PERCY_ORIENTATION: "landscape"
      PERCY_REGIONS: '[{"element":{"resource-id":"com.example.testapp:id/header"},"algorithm":"ignore"}]'
```

Run:

```bash
PERCY_TOKEN=<token> npx percy app:exec -- maestro test -e "..." test/e2e/full-coverage.yaml
```

## Checklist

Fill in during validation. Paste raw log excerpts for any failures.

### Core requirements

- [ ] **R1 — Coordinate regions with algorithms.** `CoordRegions` comparison in Percy dashboard shows four regions, each with the expected algorithm applied. The `ignore` region does not flag diffs inside its box; `intelliignore` ignores dynamic content; `layout` tolerates pixel-level diffs; `standard` applies standard sensitivity.
- [ ] **R2 — Per-region configuration pass-through.** Add a region with `configuration.diffSensitivity` and confirm Percy's comparison respects it (manual visual check or via dashboard detail view).
- [ ] **R3 — Sync mode.** `SyncShot` logs `[percy] Sync result: …` in the flow output before the next step runs.
- [ ] **R4 — Tile metadata.** `TileAndMeta` comparison in Percy shows the 50px status bar and 48px nav bar excluded from the comparison tile (visually inspect the tile in the dashboard).
- [ ] **R5 — thTestCaseExecutionId.** `TileAndMeta` comparison has `TH-e2e-001` visible in its metadata / test-harness linkage.
- [ ] **R6 — Element regions via ADB.** `ElementRegions` comparison shows four element-resolved ignore regions, each correctly placed over the corresponding view. Inspect the dashboard overlay.
- [ ] **R7 — Android-only gate.** Running the same flow with Maestro platform forced to iOS (separate test) logs the Android-only disable line and does not upload screenshots.
- [ ] **R8 — YAML sub-flow headers.** The parent flow's `appId: com.example.testapp` is NOT overridden by the sub-flows. Parent app stays launched across all percy-screenshot steps.
- [ ] **R9 — README accuracy.** Every env var referenced in this checklist is documented in README.md.
- [ ] **R10 — BrowserStack-only runtime.** Flow runs against a BrowserStack session; not run locally as a negative control.
- [ ] **R11 — clientInfo identity.** Percy dashboard / analytics shows this test's comparisons bucketed under `percy-maestro-android/0.3.0`, not `percy-maestro/*`.

### Resolver telemetry

- [ ] **Latency budget (R6).** For each element-region screenshot, the CLI log contains a `dump took Xms (kind=hierarchy)` debug line. All three of: `ElementRegions`, `ElementMiss`, `LandscapeShot`.
  - p50 wall-clock for dump-only: _____ ms (target: <500ms)
  - p99 wall-clock for dump-only: _____ ms (target: <2000ms)
- [ ] **Element miss path.** `ElementMiss` flow log contains `Element region not found: {"resource-id":"does.not.exist:id/nope"}` and still uploads the coord region + screenshot; response is 200.

### Cross-compatibility

- [ ] **Forward-compat (new SDK vs pre-Phase-2 CLI).** Run the same flow against a BrowserStack session whose runner image is a pre-Phase-2 CLI. Confirm:
  - Coordinate regions, sync, tile metadata, thTestCaseExecutionId all still work.
  - Element regions log `Element-based region selectors are not yet supported, skipping region` (the old stub warning) and the upload still succeeds.
- [ ] **Regression baseline (backward-compat via Unit 6 unit test).** Unit 6's "coordinate-only request on Android" test already covers v0.1.0-equivalent traffic against the new handler — no separate E2E needed unless a production incident calls for it.

### Device matrix

- [ ] **Pixel device profile.** Full flow passes against a BrowserStack Pixel device.
- [ ] **Non-Pixel device profile (Samsung / Xiaomi / etc.).** Full flow passes against a second distinct BrowserStack device. Element-region bounds resolve correctly on the non-AOSP skin.

### Input validation (negative tests)

Send these manually via `curl` against the BrowserStack CLI:

- [ ] `regions` not an array → HTTP 400 with `regions must be an array`.
- [ ] 51 regions → HTTP 400 with `regions exceeds maximum of 50`.
- [ ] Element region with `xpath` key → HTTP 400 with `unsupported selector key`.
- [ ] Selector value 513 chars → HTTP 400 with `exceeds maximum length of 512`.

### Backward-compat for v0.1.0 users

- [ ] Run a flow that sets **none** of the new env vars (`PERCY_REGIONS`, `PERCY_SYNC`, `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, `PERCY_FULLSCREEN`, `PERCY_TH_TEST_CASE_EXECUTION_ID`). Behavior should match v0.1.0 exactly: screenshot uploads with basic tag metadata, no regions.

## Decision

- [ ] **All checklist items pass →** Phase 2 ship approved. Update README to note `element-based regions require Percy CLI ≥ <version>` with the actual rolled-out version.
- [ ] **R6 fails (element regions consistently unavailable / dump-error) →** revisit Unit 0 results; file BrowserStack infra ticket; document R6 as known-unsupported in README until resolved.
- [ ] **Latency regresses past p50 <500ms or p99 <2s →** revisit `adb-hierarchy.js` parser config and/or timeout cap; consider if `appium-uiautomator2-server` path is warranted as a follow-up.
- [ ] **Any other checklist item fails →** file as a blocker; re-run after fix.

## Validation owner

- Run by:
- Run on (date):
- BrowserStack session URLs:
- CLI version deployed on runner image:
- Percy project URL:
- Decision committed to plan (link to commit):
