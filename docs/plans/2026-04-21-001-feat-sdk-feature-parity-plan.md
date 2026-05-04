---
title: "feat: percy-maestro-android SDK Feature Parity + Element-Based Regions"
type: feat
status: completed
date: 2026-04-21
deepened: 2026-04-21
origin: docs/brainstorms/2026-04-21-sdk-feature-parity-requirements.md
---

# feat: percy-maestro-android SDK Feature Parity + Element-Based Regions

## Overview

Bring `percy-maestro-android` from v0.1.0 to v0.3.0 by porting feature parity work already landed in the sibling `percy-maestro` repo (coordinate regions, per-region configuration, sync mode, tile metadata, thTestCaseExecutionId, updated YAML headers, updated README), while preserving the Android-only platform gate. Simultaneously close the one remaining gap shared by both SDKs — element-based region resolution via Android view hierarchy — by extending the Percy CLI's `/percy/maestro-screenshot` relay with an ADB-backed resolver.

The SDK parity work is a straightforward port. The element-resolution work is genuinely new territory: there is no existing ADB integration anywhere in the CLI codebase, and no institutional learnings from `docs/solutions/`. It must ship behind a Phase 2 milestone so the Phase 1 SDK parity release is not blocked by CLI deployment.

## Problem Frame

Users running Percy against BrowserStack Maestro Android sessions today can only take basic screenshots with name + device tag + testCase/labels. Every other Percy SDK (Espresso, Appium Python, and the sibling cross-platform `percy-maestro`) supports a richer feature set: ignore/consider regions, sync mode, tile metadata for excluding system chrome, and CI execution-id correlation. Adopting percy-maestro-android today means giving up those capabilities.

The immediate product pressure is parity with `percy-maestro` v0.3.0. The additional pressure is that element-based regions — the single most-requested region-API ergonomics upgrade across SDKs — remain stubbed in both `percy-maestro` and `percy-maestro-android`. This plan closes both gaps together so users opting into the Android-only SDK are not behind on either axis.

## Requirements Trace

Direct mapping to requirements in `docs/brainstorms/2026-04-21-sdk-feature-parity-requirements.md`:

- **R1** — Coordinate-based regions with `algorithm` (ignore/standard/intelliignore/layout); graceful degradation on malformed JSON or individual regions.
- **R2** — Per-region `configuration`, `padding`, `assertion` pass-through.
- **R3** — Sync mode via `PERCY_SYNC=true`.
- **R4** — Tile metadata: `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, `PERCY_FULLSCREEN`.
- **R5** — `PERCY_TH_TEST_CASE_EXECUTION_ID` forwarding.
- **R6** — Element-based regions via ADB + `uiautomator` hierarchy; first-match resolution; per-element skip with warning on miss.
- **R7** — Android-only healthcheck gate retained.
- **R8** — YAML sub-flows gain `appId: _percy_subflow` + `name:` headers.
- **R9** — README documents every env var, regions schema, algorithms table, and "Features not supported" section.
- **R10** — BrowserStack-only runtime as explicit README scope boundary.
- **R11** — `clientInfo: percy-maestro-android/0.3.0`; version bumped to v0.3.0.

## Scope Boundaries

Carried forward from the origin document:

- **No iOS.** `percy-maestro` covers iOS; Android-only gate stays.
- **No local `maestro test` runtime.** Relay requires BrowserStack's session-dir layout. Documented, not fixed.
- **No Percy on Automate (POA).** No Appium-style driver/capabilities in Maestro's execution model.
- **No full-page / scrollable screenshots.** Maestro's idiom is explicit `scroll` steps + separate screenshots.
- **No XPath region selectors.** Android view hierarchy does not expose XPath.
- **No DOM-specific features** (`freezeAnimations`, `percyCSS`, `enableJavascript`) — native bitmap captures have no DOM.
- **No CLI min-version validation.** Deferred.
- **No `/percy/events` error reporting.** Deferred.
- **No cross-repo user-facing messaging** (e.g., "iOS users go to percy-maestro" README notes). Deferred.

## Context & Research

### Relevant Code and Patterns

**percy-maestro-android (this repo, v0.1.0 baseline):**
- `percy/scripts/percy-healthcheck.js` — Android-only gate enforced; sets `output.percyEnabled`. Target for version string update.
- `percy/scripts/percy-screenshot.js` — baseline payload: name, sessionId, tag, testCase, labels. Target of the port.
- `percy/flows/percy-init.yaml` — minimal header; needs `appId: _percy_subflow` + `name:` additions.
- `percy/flows/percy-screenshot.yaml` — same.
- `README.md` — documents only baseline env vars; full rewrite needed.

**percy-maestro (sibling, v0.3.0 — source of the port):**
- `percy/scripts/percy-screenshot.js` — canonical implementation of regions, sync, tile metadata, thTestCaseExecutionId, platform tag handling. Strip iOS branches on copy.
- `percy/scripts/percy-healthcheck.js` — writes `output.percyServer` + `output.percyCoreVersion` for downstream use; mirrors the pattern, keeps Android-only gate.
- `percy/flows/*.yaml` — the `appId: _percy_subflow` + `name:` header pattern.
- `README.md` — reference structure; drop iOS-specific guidance section.

**Percy CLI relay (owned code):**
- `cli/packages/core/src/api.js:300-495` — `/percy/maestro-screenshot` handler. Already transforms coordinate regions into `elementSelector.boundingBox`. Element-based regions currently warn+skip at line 456 (`percy.log.warn('Element-based region selectors are not yet supported, skipping region')`).
- `cli/packages/core/src/install.js:6,115` — the only current `child_process` usage in `core`. Pattern to mirror: `import cp from 'child_process'; cp.execSync(...)`. No existing ADB utility to reuse.
- No existing tests for `/percy/maestro-screenshot` in `cli/packages/core/test/api.test.js` — greenfield for this endpoint.

**Reference SDKs (behavior spec):**
- `percy-espresso-java/espresso/src/main/java/io/percy/espresso/lib/ScreenshotOptions.java` — mirror its optional fields.
- `percy-appium-python/percy/providers/generic_provider.py` — canonical first-match-per-selector behavior; mirrors our R6 decision.
- `percy-appium-python/percy/lib/region.py` — region validation (`is_valid(screen_height, screen_width)`); mirror the "skip non-positive area" rule.

### Institutional Learnings

- `project_multipart_test_results.md` — verified: multipart `filePath` uploads from GraalJS fail on BrowserStack. The relay endpoint with file-read-on-CLI-side is the only option. This plan does not break that contract.
- `feedback_dont_change_other_repos.md` — only change code we introduced. The `/percy/maestro-screenshot` relay is our code (introduced in CLI commits `d65c83b0`, `615bfb56`, `a724039f`); extending it is fair game.
- `project_maestro_repo_split.md` — both repos share the same relay; CLI changes for R6 benefit both.

### External References

None gathered. External docs would mostly confirm standard `adb shell uiautomator dump` usage, which is well-established; the risk is runtime availability, not mechanism, so external research adds little.

## Key Technical Decisions

- **Port rather than rewrite.** The `percy-maestro` v0.3.0 scripts already implement R1–R5 cleanly and are known-good. Copy them into this repo and strip iOS branches rather than reimplementing.
- **Element resolution in the CLI relay, not the Maestro script.** GraalJS cannot run `adb`. The CLI already reads the screenshot from disk — running ADB on the same host is the natural extension.
- **Device serial comes from the CLI process environment, never the request body.** The resolver reads `process.env.ANDROID_SERIAL` at dump time. If unset, it runs `adb devices` **once per request**: exactly one device → use it; zero or more than one → classify `unavailable` with reason `no-serial` or `multi-device-no-serial`. The serial never flows from the HTTP request, so there is nothing to validate from untrusted input. This closes the flag-injection / cross-tenant-targeting surface without adding request-body validation. Side effect: the SDK (Unit 1) sends no device-serial field; Unit 1's payload shape is unchanged from the port.
- **Dump primary: `adb -s <serial> exec-out uiautomator dump /dev/tty`; fallback: `adb -s <serial> shell uiautomator dump /sdcard/window_dump.xml` + `adb -s <serial> exec-out cat /sdcard/window_dump.xml`.** `exec-out` is binary-safe (no PTY/CRLF mangling); uiautomator often appends a trailer `UI hierarchy dumped to: /dev/tty` — the parser slices between the outermost `<?xml` prefix and the first `</hierarchy>` close tag to discard trailers and reject embedded duplicates. The `-s <serial>` flag is always passed (serial from the process env or the single-device probe above). Fallback trigger: `exit code != 0 OR stdout does not start with '<?xml'`. Empty-but-valid XML is a legitimate empty hierarchy, not a fallback signal.
- **Request-local memoization, always cached — including errors.** Within a single `/percy/maestro-screenshot` handler invocation, dump at most once across all element regions. The first `dump()` result is cached in a local `const`; every subsequent element region reads the cached result. **Both `unavailable` and `dump-error` poison the rest of the request** with one warning — they do not trigger per-region retries. This closes two gaps at once: it matches the "resolver.dump called exactly once per request" test assertion, and it eliminates the timeout-accumulation DoS vector (N element regions × 2s = 2s total, not 2N). Coordinate regions always upload regardless.
- **Three failure classes, uniform "poison remainder" handling.** The resolver returns one of: `{ kind: 'unavailable', reason }` (binary missing, `no devices`, `device unauthorized`, `device offline`, ENOENT, first-call timeout, no-serial / multi-device-no-serial), `{ kind: 'dump-error', reason }` (non-zero exit, empty stdout after normally-working ADB, XML parse error, 5MB size cap exceeded), or `{ kind: 'hierarchy', nodes }`. The handler treats `unavailable` and `dump-error` the same way — one warning, skip all remaining element regions.
- **Hard `execFile` timeout of 2s from day one.** Not a follow-up. An unbounded `execFile` hangs indefinitely if `adbd` wedges. Timeout on any call → classify as `unavailable` (same-request) → subsequent regions skip without a second dump.
- **Input validation on element-region payload.** The handler validates `regions` before invoking the resolver: per region, exactly one key among the whitelist `{resource-id, text, content-desc, class}`; selector value is a string of length ≤512; total regions per request ≤50. Violations return `400 ServerError` with a clear message. This mirrors the existing strict validation on `name`/`sessionId`/`platform` at `api.js:308-327`.
- **Full-DOM XML parse with `fast-xml-parser`, 5MB input cap, entities disabled.** `stopNodes` does not abort parsing — the library is a synchronous full-DOM parser. Attempting SAX-style early exit via `stopNodes` would be a misuse. Instead: reject dump stdout before parse if it exceeds 5MB (classify `dump-error`); parse fully with `{ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, trimValues: true, processEntities: false, allowBooleanAttributes: false }`; walk the resulting node tree pre-order DFS for first-match. On typical ~200-node screens parse is <20ms; on the 1–3MB / 5–10k-node worst case parse runs 100–300ms — still within the 2s timeout budget. Ship `fast-xml-parser` as a new dep of `cli/packages/core`, pinned to a known-safe major version.
- **Bounds regex is strictly anchored.** `/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/` — defends against ReDoS from crafted `bounds` attributes on a malicious app-under-test. Non-matching `bounds` → node treated as a non-match (not parsed).
- **Latency budget: p50 <500ms, p99 <2s per screenshot** (realistic per research). Dump dominates. Unit 7 records per-screenshot resolver timing. Performance is asserted against real-device data in Unit 7, not against a synthetic fixture in unit tests (unit-test perf asserts are CI-brittle).
- **Resolver seam: plain exported `dump(deviceSerial, { execAdb } = {})` and `firstMatch(nodes, selector)` — no factory.** One production consumer, one test consumer. Tests pass a Jasmine-spy `execAdb` via the options bag. Drops the `createResolver({ execAdb })` indirection.
- **iOS element regions warn-and-skip, matching existing behavior.** Previously the plan introduced a 400 rejection on iOS element regions. Rolling back to the existing warn-and-skip semantics from `api.js:456` avoids shipping a breaking change in the same release as the Phase 2 resolver. Coordinate-only iOS requests remain unaffected. R6 documentation explicitly states element regions are Android-only; the log line makes the no-op visible to users. If telemetry later shows zero iOS+element callers, a future release can tighten to 400.
- **First-match wins** (see origin document). Mirrors `percy-appium-python`; simpler mental model. Traversal is pre-order DFS. API: `firstMatch(nodes, selector)` where `nodes` is the flat pre-order node list extracted during parse.
- **Resolver logic inlined in `api.js`, not extracted to a new module file.** ~30–50 lines specific to one handler; a new sibling file adds no reuse. The resolver *module* is `adb-hierarchy.js`; the *handler glue* (region loop, validation, 400 branching) stays in `api.js`.
- **Cross-SDK payload contract.** `percy-maestro` and `percy-maestro-android` send identical JSON to `/percy/maestro-screenshot`. One CLI update lights up R6 for both SDKs.
- **Phased delivery.** Phase 0 = 30-minute ADB access spike on BrowserStack Maestro Android. Phase 1 = SDK-only port (R1–R5, R7–R11). Phase 2 = CLI ADB resolver + element-region resolution (R6), gated on Phase 0 success. Phase 2 rollout explicitly includes a BrowserStack-infra step to rebuild their Maestro runner image with the new CLI.

## Open Questions

### Resolved During Planning

- **Multi-match element selectors** → first match in pre-order DFS traversal (matches appium-python).
- **ADB dump mechanism** → `adb -s <serial> exec-out uiautomator dump /dev/tty`; fallback is `adb shell uiautomator dump /sdcard/…` + `adb exec-out cat`. Fallback trigger: exit != 0 or stdout missing `<?xml` prefix.
- **Device serial source** → `process.env.ANDROID_SERIAL` on the CLI host; fallback to `adb devices` probe, `unavailable` if not exactly one device. Never from request body.
- **Dump scope** → request-local memoization; one dump per request maximum. Cached results (including errors) are reused across the loop.
- **Failure taxonomy** → three classes (`unavailable`, `dump-error`, `hierarchy`). Both error classes poison the rest of the request with one warning — eliminates the timeout-accumulation DoS.
- **Day-one timeout** → `execFile` hard timeout 2s. Fires on any call → classify as `unavailable` for the rest of the request.
- **Input validation** → whitelist `{resource-id, text, content-desc, class}` one-per-region; selector-value type + length ≤512; total regions ≤50; 400 on violation.
- **iOS element regions** → warn-and-skip (preserves existing `api.js:456` behavior; no breaking change). Coordinate-only iOS requests unaffected.
- **`firstMatch` signature** → `firstMatch(nodes, selector)`. `nodes` is the flat pre-order list from `dump()`.
- **Latency budget** → p50 <500ms, p99 <2s. Unit 7 records per-screenshot resolver timing on real hardware; unit tests do not assert performance.
- **XML parser** → `fast-xml-parser`, new dep on `cli/packages/core`, pinned major version; full-DOM parse (no streaming); 5MB input cap before parse; `processEntities: false`; `bounds` regex strictly anchored.
- **Resolver seam** → plain exported functions with optional `execAdb` parameter; no factory.
- **Resolver location** → `cli/packages/core/src/adb-hierarchy.js` (flat `src/` layout, verified). Handler glue stays inline in `api.js`; no new `maestro-regions.js` file.
- **Phase 0 spike** → ADB reachability verified on BrowserStack Maestro Android as a prerequisite, before Unit 5/6 coding begins.
- **Version + clientInfo** → v0.3.0; `clientInfo: percy-maestro-android/0.3.0` (distinct analytics bucket).
- **Silent-skip vs logged-skip (Phase 1 SDK)** → logged-skip. Match sibling `percy-maestro` behavior: `console.log("[percy] Skipping screenshot — Percy is not enabled")` when disabled. Better signal, no downside.

### Deferred to Implementation

- **Exact uiautomator XML shape on BrowserStack's Android image.** AOSP `DumpCommand.java` emits a stable shape across API 24–34, but BrowserStack's image should be spot-checked during Unit 7; adjust parser if non-AOSP attributes appear.
- **`clientInfo` diagnostic echo from the healthcheck response** — low-priority nice-to-have.
- **Future iOS 400 tightening.** Today's fallback-to-warn-and-skip is intentional. Once analytics confirms zero iOS+element callers, a future CLI release can tighten to 400 without a migration concern.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Phase 1 — SDK port, no CLI changes:**

```
┌────────────────────────────────┐
│ Maestro flow (user)            │
│  - PERCY_REGIONS (JSON)        │
│  - PERCY_SYNC / tile metadata  │
│  - PERCY_TH_TEST_CASE_EXEC_ID  │
└────────────┬───────────────────┘
             │ env vars
             ▼
┌────────────────────────────────┐
│ percy-screenshot.js  (ported)  │
│  - builds JSON payload         │
│  - POSTs to relay              │
└────────────┬───────────────────┘
             │ JSON (coord regions resolved, element regions forwarded raw)
             ▼
┌────────────────────────────────┐
│ /percy/maestro-screenshot relay│
│  (already handles coord rgns + │
│   sync + tile metadata today)  │
└────────────┬───────────────────┘
             │ /percy/comparison
             ▼
          Percy API
```

**Phase 2 — CLI ADB resolver lights up element regions:**

```
 SDK payload includes:
 { regions: [ { element: { "resource-id": "…" }, algorithm: "ignore" }, … ],
   platform: "android" }

                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ /percy/maestro-screenshot handler                   │
│                                                     │
│  validate regions shape:                            │
│    not-array | >50 items | bad selector            │
│    → 400 "Invalid element selector"                 │
│                                                     │
│  iOS + element region → existing warn-and-skip      │
│                                                     │
│  regions loop (inline):                             │
│    let dump = null   ◀── request-local memoization  │
│                           (always cache, incl errs) │
│    for region in regions:                           │
│      if region.element && platform === "android":   │
│        dump ??= dump()   ◀── reads ANDROID_SERIAL   │
│        if dump.kind !== "hierarchy":                │
│          one warning (pre-scanned N), skip          │
│          all remaining element regions              │
│        else:                                        │
│          firstMatch(dump.nodes, region.element)     │
│            → boundingBox or miss-warn               │
│      else if coord → existing transform             │
└─────────────────────────────────────────────────────┘
                          │
        dump():
          serial ← process.env.ANDROID_SERIAL
                 ?? single-device-from(adb devices)
                 ?? unavailable(multi-device-no-serial)
          spawn: adb -s <serial> exec-out uiautomator dump /dev/tty
          execFile timeout: 2s  → unavailable
          stdout >5MB          → dump-error
          slice outermost <?xml … first </hierarchy>
          fast-xml-parser (full-DOM, entities off, 5MB cap)
          fallback: adb -s <serial> shell uiautomator dump /sdcard/…
                    adb -s <serial> exec-out cat /sdcard/…
                    (triggered on: exit≠0 OR stdout missing "<?xml")
```

Resolver responsibility boundary:
- **Inputs:** none from the caller except optional `execAdb` seam for tests. Reads `process.env.ANDROID_SERIAL`; probes `adb devices` as fallback.
- **Outputs:** `{ kind: 'unavailable'|'dump-error'|'hierarchy', ... }` from `dump()`; `{x, y, width, height}` or `null` from `firstMatch(nodes, selector)`.
- **Side effect:** at most one `adb dump` invocation per `/percy/maestro-screenshot` request (enforced by the `??= ` memoization in the handler — always cached, including error classes).
- **Not in scope for the resolver:** platform gating, HTTP status codes, Percy payload shape, selector validation (all handler responsibilities).

## Implementation Units

- [ ] **Unit 0: ADB-on-BrowserStack feasibility spike** *(Phase 0 prerequisite; gate on Phase 2)*

**Goal:** Verify the single biggest Phase 2 assumption before spending Unit 5/6 effort: that the Percy CLI process running inside a BrowserStack Maestro Android session can execute `adb` against the test device.

**Requirements:** R6 (prerequisite validation).

**Dependencies:** Access to a BrowserStack Maestro Android session with an Android app under test.

**Files:** None — this is a runtime experiment, not a code change.

**Approach:**
- Launch a minimal Maestro flow on BrowserStack Android that runs `percy-init` + one `percy-screenshot`.
- Before the flow exits, have the Percy CLI shell out once to each of: `adb version`, `adb devices`, `adb -s <serial> exec-out uiautomator dump /dev/tty | head -c 200`.
- Log stdout + stderr + exit code from each.
- Read `process.env.ANDROID_SERIAL` from the CLI process and log its presence/value.

**Verification (any failure = Phase 2 re-scope):**
- `adb version` exits 0.
- `adb devices` lists at least the test device.
- `exec-out uiautomator dump /dev/tty` returns output starting with `<?xml`.
- Either `ANDROID_SERIAL` is set, or `adb devices` lists exactly one device when invoked from the CLI process.
- Total wall-clock for the dump call is <2s (validates the day-one timeout is not tripping).

**Outcome branches:**
- All checks pass → proceed to Units 5–7 as planned.
- ADB absent or unauthorized → document R6 as "unsupported on current BrowserStack Maestro runtime"; close Phase 2 as deferred; revisit when BrowserStack infra exposes ADB.
- ADB present but multi-device or no `ANDROID_SERIAL` → Phase 2 proceeds, but document the `multi-device-no-serial` fallback is expected to fire; discuss serial-injection with BrowserStack infra.

- [ ] **Unit 1: Port `percy-screenshot.js` into percy-maestro-android**

**Goal:** Replace the v0.1.0 screenshot script with the v0.3.0 logic from `percy-maestro`, stripped of iOS branches and with the Android-only identity.

**Requirements:** R1, R2, R3, R4, R5, R11

**Dependencies:** None.

**Files:**
- Modify: `percy/scripts/percy-screenshot.js`

**Approach:**
- Copy `percy-maestro/percy/scripts/percy-screenshot.js` as the structural basis.
- Hard-code `tag.osName = "Android"` (remove the `maestro.platform === "ios" ? "iOS" : "Android"` ternary).
- Set `payload.platform = "android"` (remove `maestro.platform` read — safe under the Android-only healthcheck gate).
- Change `clientInfo` to `"percy-maestro-android/0.3.0"`.
- **Adopt sibling's logged-skip behavior** when `output.percyEnabled` is false: log `"[percy] Skipping screenshot — Percy is not enabled (run percy-init first)"`. Replaces the current silent-skip comment. Better signal, zero downside.
- Keep all other env-var handling identical: `PERCY_REGIONS` JSON parsing with algorithm/configuration/padding/assertion pass-through, `PERCY_SYNC`, `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, `PERCY_FULLSCREEN`, `PERCY_TH_TEST_CASE_EXECUTION_ID`.
- **No device-serial env var.** The SDK does not need to send one — the CLI resolver reads `ANDROID_SERIAL` from its own process environment or probes `adb devices` (see Key Technical Decisions).
- **Element regions remain a Phase 1 stub.** The script forwards them verbatim in `payload.regions`; the CLI warns-and-skips them until Phase 2. The four supported element-selector keys (`resource-id`, `text`, `content-desc`, `class`) are Android-specific and defined in Unit 5.
- Preserve graceful-degradation behavior: invalid `PERCY_REGIONS` JSON logs warning and uploads without regions; individual malformed regions are skipped with a per-region warning.

**Patterns to follow:**
- `percy-maestro/percy/scripts/percy-screenshot.js` for structure.
- `typeof VAR !== "undefined" && VAR` env-var guard (CLAUDE.md convention).
- Single-argument `console.log` (GraalJS constraint per CLAUDE.md).
- `var` over `let`/`const` for GraalJS compatibility.

**Test scenarios:**
- Payload shape is byte-identical to `percy-maestro`'s when identical env vars are set, **except** `clientInfo` and `platform`.
- No env vars set → payload equals today's v0.1.0 payload plus the new `clientInfo`/`platform` fields (backward compatible).
- `PERCY_REGIONS` with coordinate regions → forwarded with algorithm applied.
- `PERCY_REGIONS` with element regions → warning logged but valid coordinate regions still forwarded.
- `PERCY_REGIONS` = `"not-json"` → warning, no regions in payload, other fields intact.
- `PERCY_REGIONS` with one malformed coordinate region (e.g., `top > bottom`, non-numeric `left`, negative width) mixed with one valid coordinate region → per-region warning, valid region forwarded, malformed region skipped. *Covers R1 graceful degradation at the individual-region granularity.*
- `PERCY_SYNC="true"` → `payload.sync === true` and response `data` field logged on success.
- Non-numeric `PERCY_STATUS_BAR_HEIGHT` → silently omitted from payload.

**Verification:**
- Running against a BrowserStack Maestro Android session with mixed env vars produces the expected Percy comparison (deferred to Unit 7).
- Local smoke: stub `http.post` in a small Node harness and snapshot the JSON payload for each env-var combination above.

- [ ] **Unit 2: Port `percy-healthcheck.js` updates**

**Goal:** Keep the Android-only gate, surface the new identity in logs, and write `output.percyServer` + `output.percyCoreVersion` for downstream use (matching `percy-maestro`'s convention).

**Requirements:** R7, R11

**Dependencies:** None.

**Files:**
- Modify: `percy/scripts/percy-healthcheck.js`

**Approach:**
- Keep the current `maestro.platform !== "android"` gate and log line.
- Add `output.percyServer = percyServer` and `output.percyCoreVersion = coreVersion || ""` on success (matching `percy-maestro`).
- Update the success log line to include `percy-maestro-android/0.3.0` so the SDK identity is visible in the flow log from the start.

**Patterns to follow:**
- `percy-maestro/percy/scripts/percy-healthcheck.js`.

**Test scenarios:**
- Non-Android platform → `output.percyEnabled = false`; log line mentions Android-only.
- Android + healthy CLI → `output.percyEnabled = true`, `output.percyServer` set, `output.percyCoreVersion` set when header present.
- Android + unreachable CLI → `output.percyEnabled = false`, clear error log.

**Verification:**
- Log line reads `[percy] Percy CLI healthcheck passed. Core version: X.Y.Z (percy-maestro-android/0.3.0)` (or similar) on a healthy Android session.

- [ ] **Unit 3: Update YAML sub-flows**

**Goal:** Match `percy-maestro`'s sub-flow header convention so `runFlow` calls don't inherit the parent flow's `appId`.

**Requirements:** R8

**Dependencies:** None.

**Files:**
- Modify: `percy/flows/percy-init.yaml`
- Modify: `percy/flows/percy-screenshot.yaml`

**Approach:**
- Add `appId: _percy_subflow` and `name: percy-init` / `name: percy-screenshot` before the `---` separator, mirroring `percy-maestro/percy/flows/*.yaml` byte-for-byte.

**Patterns to follow:**
- `percy-maestro/percy/flows/percy-init.yaml` and `percy-screenshot.yaml`.

**Test scenarios:**
- Maestro `lint`/`validate` (if applicable) accepts both files.
- Parent flow with `appId: com.example.foo` + `runFlow: percy/flows/percy-screenshot.yaml` does not get overridden by the sub-flow.

**Verification:**
- Smoke test: a sample parent flow against an emulator still launches the correct app.

- [ ] **Unit 4: Rewrite README**

**Goal:** Document every new env var, the regions JSON schema, algorithms table, BrowserStack-only runtime boundary, and a "Features not supported" section with explicit reasons.

**Requirements:** R9, R10

**Dependencies:** Units 1–3 (behavior must be final before documenting it).

**Files:**
- Modify: `README.md`

**Approach:**
- Base on `percy-maestro/README.md`; strip the "iOS-specific guidance" section entirely.
- Add a top-of-README callout: **"This SDK is supported on BrowserStack Maestro Android sessions. For local `maestro test` runs, see limitations below. For iOS Maestro flows, use [percy-maestro](../percy-maestro/)."** (Second sentence only if the user later decides to add cross-repo messaging; today omit it per origin doc decision.)
- Include the full env-var table (Core Options + Comparison Options).
- Include the regions section with element-based syntax example (`resource-id` / `text` / `content-desc` / `class`), coordinate-based syntax, the four algorithms, per-region configuration, and multi-region examples.
- "Features not supported" table: XPath selectors, Percy on Automate, full-page/scrollable, `freezeAnimations`, `percyCSS`, `enableJavascript`, iOS — each with the reason from the origin document's Scope Boundaries.
- Note that element-based regions require CLI ≥ the version that ships Phase 2 (fill in the actual version string during Phase 2 release).

**Patterns to follow:**
- `percy-maestro/README.md` structure.

**Test scenarios:** N/A — documentation.

**Verification:**
- Preview renders on GitHub; every env var from Units 1–2 is documented.
- Every item in the origin document's Scope Boundaries has a matching entry in the "Features not supported" section.

- [ ] **Unit 5: CLI ADB view-hierarchy resolver module**

**Goal:** New utility in `cli/packages/core` that dumps the Android view hierarchy via ADB, parses it, and exposes a `firstMatch(nodes, selector)` lookup for the four supported selector keys. The module is Android-only by contract; the caller is responsible for platform gating.

**Requirements:** R6 (prerequisite)

**Dependencies:** Unit 0 (ADB-feasibility spike) must pass. Adds `fast-xml-parser` as a new dependency of `cli/packages/core`.

**Files:**
- Create: `cli/packages/core/src/adb-hierarchy.js` *(flat `src/` layout — no `src/lib/` exists in `core`)*
- Create: `cli/packages/core/test/fixtures/adb-hierarchy/` *(fixture XML files for parser/selector tests)*
- Modify: `cli/packages/core/package.json` *(add `fast-xml-parser` to `dependencies`, pinned major version)*
- Test: `cli/packages/core/test/unit/adb-hierarchy.test.js`

**Approach:**
- Export two plain functions — no factory, no hidden state:
  - `export async function dump({ execAdb = defaultExecAdb } = {})` — resolves the device serial and performs the dump.
  - `export function firstMatch(nodes, selector)` — pure function over a pre-order node list.
- Default `execAdb` wraps `cross-spawn` with the async spawn + timeout + cleanup pattern from `browser.js:256-297` — the established long-running-process pattern in `core`. Do **not** use `execSync` (`install.js`'s pattern has no timeout).
- **Device serial resolution** (inside `dump`): read `process.env.ANDROID_SERIAL` first. If unset, run `adb devices` (parse stdout for `\tdevice` lines); exactly one → use it; zero → `{ kind: 'unavailable', reason: 'no-device' }`; more than one → `{ kind: 'unavailable', reason: 'multi-device-no-serial' }`. Never accept serial from a request body or any caller-supplied input.
- `dump()` returns `{ kind: 'unavailable', reason }`, `{ kind: 'dump-error', reason }`, or `{ kind: 'hierarchy', nodes }`. Classification rules:
  - ENOENT on spawn; stderr matching `/no devices|unauthorized|device offline/i`; `execFile` timeout (2s); device-serial resolution failure → `unavailable`.
  - Exit `0` with stdout ≤5MB and starting with `<?xml` → slice from the outermost `<?xml` to the first `</hierarchy>` (inclusive), discarding trailer and rejecting any content after the first close tag; parse; return `hierarchy`.
  - stdout >5MB, or exit 0 but stdout does not start with `<?xml`, or non-zero exit without unavailable-signature stderr, or parse error → try fallback once: `adb -s <serial> shell uiautomator dump /sdcard/window_dump.xml` + `adb -s <serial> exec-out cat /sdcard/window_dump.xml`. If fallback also fails any of the checks above → `dump-error`.
- Primary command: `adb -s <serial> exec-out uiautomator dump /dev/tty`.
- Parse with `fast-xml-parser` configured `{ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, trimValues: true, processEntities: false, allowBooleanAttributes: false }`. Full-DOM parse — `fast-xml-parser` does not support SAX/streaming/early-exit; `stopNodes` is a descend-suppression flag, not an abort. The 5MB input cap + fast-xml-parser's native performance keeps 1–3MB worst-case parse under 300ms, within the 2s timeout budget.
- `firstMatch(nodes, selector)` walks the flattened pre-order `nodes` list returned by parse, returns the first node whose specified attribute exactly matches. Converts `bounds` via strictly-anchored regex `/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/`; non-matching bounds → node treated as non-match. Nodes where `x2 <= x1` or `y2 <= y1` are non-matches (zero-area). Negative coordinates (partially-clipped views) are allowed.
- Module header comment: "Android-only. Caller is responsible for platform gating. Reads `process.env.ANDROID_SERIAL` — never accepts serial from user input."
- Logger: `import logger from '@percy/logger'` then `const log = logger('core:adb-hierarchy')`. `log.warn` for recoverable issues; `log.debug` for dump timing.

**Execution note:** Test-first on the parser, selector, and classification logic — these are pure functions over fixture XML. Keep the spawn call behind the `execAdb` seam so tests never shell out.

**Patterns to follow:**
- `cli/packages/core/src/browser.js:256-297` — async `cross-spawn` + timeout + cleanup + listener teardown. This is the canonical long-running subprocess pattern in `core`.
- `cli/packages/core/src/utils.js:8, 42, 164` — utility-module logger instantiation (`logger('core:<namespace>')`).
- Unit-test scaffold: import only `@percy/logger/test/helpers`; inject a Jasmine spy as `execAdb` via `createResolver({ execAdb })`; drive fixtures from `cli/packages/core/test/fixtures/adb-hierarchy/*.xml`. Do **not** pull in `mockfs`/`mockRequests`/`mockgit` (as `install.test.js` does) — none apply to an `execAdb`-injected resolver.

**Test scenarios (fixture XML — parser / `firstMatch`):**
- Single node matching `resource-id` → returns its bounds.
- Two nodes matching `text` → returns the first in pre-order.
- Nested hierarchy (~200 nodes, typical real-world tree) → first match found correctly across depths.
- Node with negative `y1` → returned (valid off-screen ignore target).
- Zero-area node (`x2 == x1`) → skipped as non-match.
- No node matches → returns `null`.
- Malformed `bounds` attribute (fails anchored regex, e.g. `[0,0][100]` or `junk`) → node treated as non-match; no warning spam.
- Empty `<hierarchy/>` (no children) → returns `null` for any query.
- XML size >5MB → `{ kind: 'dump-error', reason: 'oversize' }`.
- Trailer line pollution: stdout contains `<?xml ... </hierarchy>\nUI hierarchy dumped to: /dev/tty` → parse succeeds, ignores trailer.
- Adversarial trailer: stdout contains two `<?xml ... </hierarchy>` blocks back to back → only the first is parsed; second is discarded.

**Test scenarios (classification — fake `execAdb`):**
- ENOENT on spawn → `{ kind: 'unavailable', reason: 'adb-not-found' }`.
- stderr `error: no devices/emulators found` → `{ kind: 'unavailable', reason: 'no-device' }`.
- stderr `error: device unauthorized` → `{ kind: 'unavailable', reason: 'device-unauthorized' }`.
- 2s timeout on first call → `{ kind: 'unavailable', reason: 'timeout' }`.
- `process.env.ANDROID_SERIAL` unset + `adb devices` returns zero devices → `{ kind: 'unavailable', reason: 'no-device' }`.
- `ANDROID_SERIAL` unset + `adb devices` returns two devices → `{ kind: 'unavailable', reason: 'multi-device-no-serial' }`.
- `ANDROID_SERIAL` set → `-s <serial>` flag appears in every dump call; `adb devices` is not invoked.
- Exit 0, empty stdout → fallback invoked; if fallback also empty → `{ kind: 'dump-error' }`.
- Fallback path succeeds after primary fails → `{ kind: 'hierarchy', nodes }`.
- Primary returns garbage → fallback invoked; garbage there too → `{ kind: 'dump-error' }`.
- XML parse throws → `{ kind: 'dump-error' }`.

Performance is **not** asserted in unit tests (CI-brittle). Real-device latency is measured in Unit 7.

**Verification:**
- Unit tests pass with the `execAdb` seam.
- Manual local smoke: run the resolver against an attached Android emulator with a known-good layout; confirm one dump → N lookups works, and timing logs show p50 <500ms.

- [ ] **Unit 6: Wire element-region resolution into the relay**

**Goal:** Replace the `percy.log.warn('Element-based region selectors are not yet supported, skipping region'); continue;` stub at `cli/packages/core/src/api.js:456` with an actual call to the Unit 5 resolver. Extract the regions-resolution loop into a testable helper.

**Requirements:** R6

**Dependencies:** Unit 5.

**Files:**
- Modify: `cli/packages/core/src/api.js` (the `/percy/maestro-screenshot` handler, lines ~300–495, specifically the regions loop at ~436–471 including the warn-stub at 456).
- Test: `cli/packages/core/test/api.test.js` *(add first-ever tests for `/percy/maestro-screenshot`: happy-path coordinate, element-hit, element-miss, ADB-unavailable, iOS-rejection).*

**Approach:**
- **Input validation — reject bad element regions with 400.** Early in the handler, alongside the existing strict validation at `api.js:308-327`, add:
  - If `req.body.regions` is present and not an array → `400 ServerError('regions must be an array')`.
  - If `regions.length > 50` → `400 ServerError('regions exceeds maximum of 50')`.
  - Per region with `element` key: exactly one of `{resource-id, text, content-desc, class}` must be present; value must be a string; value length ≤512. Violation → `400 ServerError('Invalid element selector')`.
- **iOS element regions: warn-and-skip, not 400.** Match the existing `api.js:456` behavior. If `platform === 'ios'` and a region has `element`, log the existing warning and skip. Coordinate-only iOS requests are unaffected. This explicitly avoids shipping a breaking change alongside the Phase 2 resolver; a future release can tighten to 400 after telemetry confirms zero iOS+element callers.
- **Regions-resolution logic inlined** in the existing handler regions loop (~436-471). Do not create a new sibling module file. The logic is specific to this one handler.
- Inside the handler's region loop:
  - Iterate `regions`. Coordinate regions (existing `region.top/bottom/left/right` branch at lines ~440–452) are transformed in place, unchanged from today.
  - For element regions on Android, **lazily call `dump()` on the first element region, cache in a local `const dump`**. Read only: subsequent element regions reuse the cached result regardless of `kind`.
  - On `dump.kind === 'unavailable'` or `'dump-error'`: pre-scan (`regions.filter(r => r.element).length`) to compute `N`, emit one `percy.log.warn('Element-region resolver <kind>: <reason> — skipping N element regions')`, skip all element regions in this request. Coordinate regions still upload.
  - On `dump.kind === 'hierarchy'`: call `firstMatch(dump.nodes, region.element)`. Hit → transform to `elementSelector.boundingBox` + apply `algorithm`/`configuration`/`padding`/`assertion` (same shape as coordinate branch). Miss → warn `element-region not found: <selector-json>` and skip that region.
- **No device-serial plumbing in the handler.** The resolver reads its serial from `process.env.ANDROID_SERIAL` or `adb devices`. The handler passes no serial-related data.
- Do not change the coordinate-region path.
- Logger: continue using the in-scope `percy.log.warn` in the handler to match existing relay warnings at lines 456, 459.

**Patterns to follow:**
- Existing coordinate-region transformation block at `api.js:440-452` — mirror structure for the element branch.
- Existing strict validation at `api.js:308-327` — mirror for iOS element-region rejection.

**Test scenarios (handler-level, `execAdb` mocked):**
- **Coordinate-only request on Android** → unchanged from today; regression test baseline.
- **Coordinate-only request on iOS** → succeeds (no iOS-specific validation for coord-only).
- **Mixed regions on Android** (two coords + one element hit + one element miss) → payload has three regions (two coord + one resolved), one "not found" warning logged, response 200.
- **All-element regions on Android with `unavailable` classification** → one "resolver unavailable" warning, payload omits `regions` field, rest of comparison uploads, response 200.
- **Mixed regions with `dump-error` classification** → coord regions upload, one "resolver dump-error" warning covering all element regions, response 200 (partial success).
- **iOS request with element region** → warn-and-skip (matches existing stub behavior), coord regions and other fields upload, response 200. No 400.
- **`dump()` called exactly once** per request regardless of element-region count (memoization assertion).
- **Regions input validation (400 path):**
  - `regions` not an array → 400.
  - 51 regions → 400.
  - Region with two keys `{resource-id: "a", text: "b"}` → 400.
  - Region with empty-string selector value → 400.
  - Region with 513-char selector value → 400.
  - Region with `element: { xpath: "..." }` (unsupported key) → 400.
- **Element selector matching multiple nodes** → first match used (covered end-to-end in Unit 5; handler test just asserts resolver invocation shape).

**Verification:**
- Handler tests are the first `/percy/maestro-screenshot` tests in the suite; full correctness is proven in Unit 7.
- Integration with Unit 5 validated in Unit 7.

- [ ] **Unit 7: End-to-end validation on BrowserStack Maestro**

**Goal:** Prove every requirement works end-to-end against a real BrowserStack Maestro Android session with the CLI carrying Units 5–6.

**Requirements:** R1–R11 (validation only).

**Dependencies:** Units 1–6 deployed (SDK changes in this repo; CLI changes in the `cli` repo's `core` package, built and deployed to the BrowserStack Maestro runner environment).

**Files:**
- Create: `test/e2e-checklist.md` *(a plain checklist — not automated — to drive and record validation)*

**Approach:**
- Prepare one Maestro flow that exercises: baseline screenshot, sync-mode screenshot, screenshot with coordinate regions (all four algorithms), screenshot with element regions (each supported selector), screenshot with tile metadata + fullscreen, screenshot with thTestCaseExecutionId.
- Run on BrowserStack Maestro against `example-percy-maestro` (or a minimal throwaway app) with `PERCY_TOKEN` set to a test project.
- Verify in the Percy dashboard:
  - Each comparison appears with the expected tag (Android, device name, dimensions).
  - Coordinate regions behave per algorithm (ignore hides the diff; intelliignore handles dynamic content; etc.).
  - Element regions resolve correctly — the ignored area matches the expected view on screen.
  - Sync mode returns comparison details in the flow log.
  - Tile metadata visibly excludes status/nav bars from comparisons when set.
  - thTestCaseExecutionId is recorded on the comparison record.
- Check `clientInfo` analytics: the comparison records under `percy-maestro-android/0.3.0`, not `percy-maestro/*`.

**Test scenarios:** The checklist doubles as the scenario list; each requirement has at least one check item. Key additions driven by deepening:
- **Resolver latency telemetry** — record per-screenshot dump + parse + lookup time; flag any run where p50 > 500ms or p99 > 2s.
- **Forward-compat (Phase 2 SDK ↔ Phase 1 CLI)** — run v0.3.0 SDK against a pre-Phase-2 CLI build. Element regions should warn-and-skip through the existing stub; coordinate regions, sync, tile metadata, thTestCaseExecutionId all work. This is the contract that justifies the phasing. *(Unit 6's "coordinate-only regression baseline" test covers v0.1.0-SDK-against-Phase-2-CLI, so no separate backward-compat scenario needed.)*
- **Device matrix spot-check** — run against at least two distinct BrowserStack device profiles (e.g., Pixel + Samsung) to surface OEM-specific XML differences early.
- **Landscape screen** — capture a screenshot in landscape and verify element-region bounds resolve correctly (hierarchy `rotation` attribute semantics).

**Verification:**
- All checklist items pass.
- No regressions for existing v0.1.0 users: re-run a baseline flow with no new env vars; payload and behavior match pre-change.
- On at least one test run, deliberately set an unresolvable element selector and confirm: the warning appears, the other regions still upload, the flow does not fail.
- Latency telemetry within budget on BrowserStack's standard device profile.

## System-Wide Impact

- **Interaction graph:** The SDK is a narrow caller of `/percy/maestro-screenshot`. Unit 6 widens the relay's responsibilities into shell-out territory; any error path must not escape as a 500 or the user loses the whole screenshot. Wrap ADB failures cleanly and keep the relay response shape stable.
- **Error propagation:** SDK side — every failure must log clearly and not crash the Maestro flow (existing try/catch envelope preserves this). CLI side — ADB errors become warnings, not relay errors; a Unit 5 bug must not brick the relay for coordinate-region users.
- **State lifecycle risks:** The per-screenshot hierarchy cache is request-scoped, not process-wide. No cross-request contamination. If the relay is ever refactored to share state across requests, revisit.
- **API surface parity:** The relay serves both `percy-maestro` and `percy-maestro-android` with identical JSON contract. Unit 6 lights element regions up for both SDKs simultaneously. `percy-maestro`'s iOS code path continues to warn-and-skip element regions (matches existing `api.js:456` behavior) — **no breaking change for iOS callers**. Platform gating lives in the handler, not the resolver; the resolver module is Android-only by contract. A new breaking behavior is the `400 ServerError` on invalid element-region input shape (e.g., selector value >512 chars, >50 regions, unsupported selector keys) — but this only surfaces errors for malformed requests that had no chance of succeeding anyway.
- **Integration coverage:** Unit 5's unit tests over fixture XML cover the parser. Unit 6's narrow relay test covers the wiring. Only Unit 7 covers the real ADB host / device / hierarchy chain, which is where 95% of the real-world failure modes live.

## Risks & Dependencies

**Risk 1 — ADB unavailable in BrowserStack's Maestro runtime.**
- Probability: moderate. Maestro's Android runner shells out to ADB internally, so the binary should be present, but whether the Percy CLI process runs in the same namespace with device auth is not yet verified.
- Impact: R6 does not light up; Phase 1 is unaffected; Phase 2 element regions degrade to warn-and-skip.
- Detection: **Unit 0 spike front-loads this check** — 30 minutes on BrowserStack before any Unit 5/6 code. If ADB is unreachable, Phase 2 re-scopes without wasted implementation work. At runtime, the three-class resolver design (`unavailable` / `dump-error` / `hierarchy`) classifies ENOENT, `no devices`, `device unauthorized`, timeout, and missing-serial conditions as `unavailable`.
- Mitigation: graceful-degradation design handles this without breaking coordinate regions. If Phase 0 proves ADB unreachable, document the limitation in README's "Features not supported" section and move R6 to a follow-up plan that tackles the deployment gap.

**Risk 2 — Resolver latency regression.**
- Probability: moderate. p50 ~250–400ms and p99 ~1.5–3s are realistic for `adb exec-out` pipelines; USB-over-IP on cloud hosts adds 200–500ms RTT. For a 15-screenshot flow, p50 drift past 500ms/screenshot adds 7.5s wall-clock.
- Impact: Maestro flows visibly slow down when element regions are used.
- Mitigation:
  - Hard 2s `execFile` timeout from day one. An unbounded spawn on a wedged `adbd` hangs indefinitely.
  - **Always-memoize with timeout-poisons-remainder** bounds worst-case per-request ADB time to 2s regardless of region count. Also closes the timeout-accumulation DoS vector.
  - 5MB hard cap on dump stdout prevents memory blowup from adversarial apps emitting huge hierarchies.
  - Full-DOM `fast-xml-parser` on typical ~200-node screens is <20ms; 1–3MB worst case runs 100–300ms, well under budget.
  - Unit 7 records real-device per-screenshot timing and flags anything above p50 <500ms / p99 <2s. Unit tests do not assert performance (CI-brittle).
  - Follow-up levers if budget slips: longer timeout + configurable skip, or switch to Appium's `appium-uiautomator2-server` (persistent instrumentation agent) — both rejected for Phase 2 as premature complexity.

**Risk 3 — Android OEM / API-level XML dialect differences.**
- Probability: low. AOSP `DumpCommand.java` emits a stable shape across API 24–34 and is not typically overridden by Samsung One UI, Xiaomi MIUI, or Pixel stock — OEMs don't re-implement the dumper. Attributes (`resource-id`, `text`, `content-desc`, `class`, `bounds`, root `rotation`) are consistently hyphenated-lowercase without namespaces.
- Impact: Parser extracts wrong bounds or misses nodes on an uncommon device.
- Mitigation: Unit 5 fixture tests cover the standard AOSP shape. Unit 7 spot-checks against two distinct BrowserStack device profiles (Pixel + Samsung).

**Risk 4 — R8 `resource-id` renaming in release builds.**
- Probability: high for customers testing release builds with AGP 8.12+ (late-2025 onward) using R8's resource optimization. `resource-id="com.pkg:id/submit_button"` can become `resource-id="com.pkg:id/a"`.
- Impact: `resource-id` selectors break against shrunk release APKs; users get silent element-region misses.
- Mitigation: README explicitly warns that `resource-id` selectors are unreliable against release builds with `shrinkResources` + R8 optimization. Recommends `content-desc` (a11y-stable, R8 does not rename) or keeping IDs via `keep.xml` / `tools:keep`. This is a docs-level mitigation — not something the SDK can fix.

**Risk 5 — Multi-session CLI host concurrency.**
- Probability: low with `process.env.ANDROID_SERIAL` set per process; higher with the `adb devices` fallback.
- Impact: Element regions resolve against the wrong device, or fail entirely, in multi-session environments.
- Mitigation: The resolver always passes `-s <serial>`. The serial comes from `process.env.ANDROID_SERIAL` (preferred — set per-CLI-process by BrowserStack infra) or, as a fallback, a single `adb devices` probe that requires exactly one device. If multiple devices are attached with no `ANDROID_SERIAL`, the resolver classifies `unavailable` with reason `multi-device-no-serial` rather than guessing. Unit 0 spike verifies which source is in use on BrowserStack's runner.

**Risk 6 — Race between `takeScreenshot` and ADB dump.**
- Probability: low. Maestro's `takeScreenshot` is synchronous; the JS step runs after the PNG is on disk. ADB is called when the CLI receives the POST — after the JS step.
- Impact: View hierarchy drifts from the image if animations or transitions run in the interim.
- Mitigation: README notes that flows with element regions should quiesce animations before `takeScreenshot`. Add a `--settle-ms` or equivalent knob later only if customer reports appear.

**Risk 7 — Phase 2 cross-team deployment coordination.**
- Probability: high. Phase 2 involves publishing `@percy/core`, tagging `@percy/cli`, **and a BrowserStack-infra-owned rebuild of the Maestro runner container image** followed by device-node rollout. Those last two steps are not a Percy-team `npm publish`.
- Impact: Phase 2 feature ships to npm but isn't actually available on BrowserStack Maestro sessions until the runner image rolls. The README's "element-based regions require CLI ≥ X" note must match the version BrowserStack has deployed, not the version on npm.
- Mitigation:
  - Phased Delivery section now names the infra steps explicitly (publish → consume → **BrowserStack image rebuild** → device-node rollout).
  - File the BrowserStack-infra ticket alongside the `@percy/core` release; track the image version.
  - Users running Phase 2 SDK against a pre-Phase-2 CLI see the existing warn-and-skip — zero functional regression on coordinate regions and other features.
  - Unit 7 explicitly exercises the forward-compat path (v0.3.0 SDK + old CLI) to prove this contract holds.

**Risk 8 — Silent drift between `percy-maestro` and `percy-maestro-android` over time.**
- Probability: moderate if the two repos diverge in bug-fix cadence.
- Impact: One SDK falls behind the other; debugging reports harder to correlate.
- Mitigation: `project_maestro_repo_split.md` memory captures the relationship; cross-repo relay contract is the forcing function. Not a Phase 1/2 concern, but worth a follow-up on whether to consolidate after Phase 2 ships.

**Risk 9 — New `fast-xml-parser` dependency in `cli/packages/core`.**
- Probability: low. `fast-xml-parser` is zero-dep, ~50KB, actively maintained in 2026, widely used.
- Impact: Minor install footprint increase for all CLI users — even those who don't use Maestro.
- Mitigation: accept the cost. `@percy/core` already pulls chromium and other heavier deps; one pure-JS parser is negligible. Pin a known-safe major version. If the team objects, fall back to a hand-rolled walker in Unit 5 — slightly more code, no new dep.

**Risk 10 — XML parser attack surface (defense-in-depth).**
- Probability: low. The XML comes from `adb` + device-side uiautomator, not directly from an HTTP request — the trust boundary is one hop removed.
- Impact: A malicious app-under-test could craft text/content-desc values containing XML-like content intended to confuse the parser (e.g., embedded `<?xml ... </hierarchy>` fragments, entity expansion attempts, extremely nested structures, crafted `bounds` strings targeting ReDoS).
- Mitigation:
  - 5MB cap on dump stdout before parse.
  - Parser config explicitly disables entity expansion (`processEntities: false`) and boolean-attribute shorthand.
  - Trailer-trim slices between the outermost `<?xml` and the **first** `</hierarchy>`, discarding duplicate XML blocks in the remainder.
  - `bounds` regex is strictly anchored (`^[...]$`) with no backtracking quantifiers.
  - `fast-xml-parser` pinned to a known-safe major; track upstream advisories.

**Risk 11 — Fixed device-side `/sdcard/window_dump.xml` path under multi-session-per-device.**
- Probability: very low today (BrowserStack's model is one session per device), but latent.
- Impact: Two concurrent dumps against the same device would race on the fixed filename; one could overwrite the other's output.
- Mitigation: document the single-session-per-device invariant. If it ever changes, switch the fallback path to a per-request unique filename (e.g., `window_dump_${sessionId}.xml`). Not worth doing speculatively.

## Phased Delivery

### Phase 0 — ADB feasibility spike (prerequisite)

Unit 0. ~30 minutes. Verify ADB is reachable from the Percy CLI process inside a BrowserStack Maestro Android session. **Gates the entire Phase 2**: if ADB is unreachable, Phase 2 re-scopes before any Unit 5/6 code is written.

### Phase 1 — SDK parity (ships first, no CLI dependency)

Units 1–4. Unlocks R1–R5, R7–R11 immediately. Element-region attempts log warn+skip exactly as they do in `percy-maestro` today; no behavior regression. Ship as v0.3.0.

### Phase 2 — Element regions

Units 5–6, then Unit 7. Requires coordinated cross-team deployment:
1. Publish `@percy/core` with the Unit 5/6 changes (internal npm).
2. Update `@percy/cli` meta-package to consume it; tag release.
3. **BrowserStack infra team rebuilds the Maestro runner container image** with the new CLI — this step is owned by BrowserStack, not the Percy team. Name the owner, file the ticket, track the image version.
4. Rollout across device nodes.
5. Unit 7 validation runs against the post-rollout runner image; records the specific CLI version that's deployed.

README note becomes "element-based regions require Percy CLI ≥ <version>", where `<version>` matches the version actually rolled out in step 4 (not the npm published version).

Lights up R6 for both `percy-maestro` and `percy-maestro-android` simultaneously since they share the relay contract.

## Documentation / Operational Notes

- README rewrite (Unit 4) is the user-facing surface.
- On Phase 2 release, update both `percy-maestro-android/README.md` and `percy-maestro/README.md` with the CLI version requirement.
- No monitoring/alerting added for ADB failures in Phase 2 — the relay's existing log stream surfaces warnings; observability can be a follow-up if adoption warrants it.
- No migration required for existing v0.1.0 users — every new field is optional; behavior is identical when env vars are unset.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-21-sdk-feature-parity-requirements.md](../brainstorms/2026-04-21-sdk-feature-parity-requirements.md)
- **Sibling SDK (source of the port):** `~/percy-repos/percy-maestro/percy/scripts/*.js`, `percy/flows/*.yaml`, `README.md`
- **CLI relay (owned code, target of Unit 6):** `~/percy-repos/cli/packages/core/src/api.js:300-495` (specifically the warn+skip stub at line 456)
- **CLI `child_process` reference pattern:** `~/percy-repos/cli/packages/core/src/install.js:6,115`
- **Prior art (cross-platform parity plan):** `~/percy-repos/percy-maestro/docs/plans/2026-04-02-001-feat-sdk-feature-parity-plan.md`
- **Reference SDKs:**
  - `~/percy-repos/percy-espresso-java/espresso/src/main/java/io/percy/espresso/lib/ScreenshotOptions.java`
  - `~/percy-repos/percy-appium-python/percy/providers/generic_provider.py`
  - `~/percy-repos/percy-appium-python/percy/lib/region.py`
- **Institutional learnings:** `project_multipart_test_results.md`, `feedback_dont_change_other_repos.md`, `project_maestro_repo_split.md`
- **Deepening research (2026-04-21):**
  - AOSP `DumpCommand.java` (uiautomator XML schema stability) — https://cs.android.com/android/platform/superproject/+/master:frameworks/base/cmds/uiautomator/cmds/uiautomator/src/com/android/commands/uiautomator/DumpCommand.java
  - Android R8 resource optimization (`resource-id` renaming in release builds, AGP 8.12+) — https://developer.android.com/build/shrink-code
  - UI Automator testing reference — https://developer.android.com/training/testing/other-components/ui-automator
  - Google issuetracker 36988576 (`adb` PTY / CRLF polluting uiautomator dump output)
  - `fast-xml-parser` (chosen 2026 parser for `core`) — https://github.com/NaturalIntelligence/fast-xml-parser
  - Alternative hierarchy-access paths considered and rejected for Phase 2: `appium-uiautomator2-server`, `openatx/uiautomator2` (too heavy — require APK install + persistent agent).
