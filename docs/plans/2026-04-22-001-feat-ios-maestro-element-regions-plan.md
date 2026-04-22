---
title: iOS Maestro element-based PERCY_REGIONS (v1.0)
type: feat
status: active
date: 2026-04-22
origin: docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md
deepened: 2026-04-22
---

# iOS Maestro element-based `PERCY_REGIONS` (v1.0)

## Overview

Percy Maestro SDK + Percy CLI relay gain iOS element-based region resolution for `PERCY_REGIONS`. V1 ships two selector keys (`id`, `class`); `text` and `xpath` are deferred to V1.1 on the safe-minimum-surface principle. Resolution happens in the CLI relay (Node.js) on the BrowserStack iOS host by querying WebDriverAgent over loopback. Cross-tenant safety uses a realmobile-written `/tmp/<sid>/wda-meta.json` as the only session-scoped authoritative source for (sessionId → WDA port) with process-owner attestation. Scale factor is a width-only ratio against `GET /session/:sid/window/size`, snapped to `{2, 3}`. Landscape is explicitly detected and warn-skipped (no silent wrong-coord production). v1.0 GA is gated on the Percy↔BS baseline-linkage backend fix (tracked separately).

This is a cross-cutting Deep plan. Two Phase-0 gates (live WDA experiment + realmobile contract with security acceptance tests) must complete before implementation begins.

## Problem Frame

iOS Maestro customers on BrowserStack need to exclude **dynamic content** (ads, avatars, timestamps, animated counters) from visual diffs. Coordinate-based regions fail because those elements move between runs. Element-based selectors are the right abstraction: identify the thing to ignore, not a fixed rectangle. Today iOS `PERCY_REGIONS` silently warn-and-skips element-based regions in the SDK. (See origin: `docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md`.)

## Requirements Trace

- **R1.** V1 supports `id` (WDA `using: 'name'` → accessibilityIdentifier) + `class` (XCUIElementType\*, short-form accepted, relay-side normalization with allowlist). → Units B3, B4
- **R2.** Multi-match → first match wins. → Unit B3
- **R3.** Zero-match → warn-skip with scrubbed log (key + reason tag only; **both selector value AND value-length forbidden** — value-length is low-entropy enough to fingerprint UUIDs / emails). → Unit B3
- **R4.** Scale factor via width-ratio with explicit ordering: compute raw → validate `[1.9, 3.1]` → snap `{2, 3}`. PNG IHDR parsed before WDA calls. Per-session cache keyed by sessionId. → Units B1, B3, B4
- **R5.** Remove SDK pre-relay warn-skip gate in `percy-screenshot.js`; validation lives in the relay. → Unit B5
- **R6.** Cross-tenant safety via realmobile-written `/tmp/<sid>/wda-meta.json` (hard dep); relay validates ownership + freshness; loopback-only WDA; fail-closed on any ambiguity. → Units A2, B2, B3, B4
- **R7.** Not a security boundary. Relay guardrails: 256-char selector (iOS-only), 500ms WDA timeout, 50-region cap, scrubbed logs (no value, sessionId, port, coords, WDA bodies), bbox in-bounds + non-trivial area ≥4px, conditional source-dump hardening (20 MB cap, XXE off, parse budget). → Units B3, B4
- **R8.** README + CHANGELOG updates for V1. → Unit C1

### Success Criteria (from origin)

- Payload-level verifiable without Percy backend fix (primary done signal) — verified across B3/B4 unit tests + manual BS smoke test.
- Engineering visual-overlay spot-check as internal verification tool (reframed from original "customer-facing" ambiguity — see Key Decisions). → Unit C2 (optional, time-boxed).
- End-to-end dashboard-visible outcome — v1.0 GA gate. → Unit D1.
- Cross-tenant isolation under concurrent load — verified by A2 security acceptance tests.
- Landscape detect & warn-skip — verified by B3/B4 unit tests.
- New iPhone models work without code changes — verified by R4's width-ratio approach (no device catalog).

## Scope Boundaries

- **Out (V1.1):** `text` and `xpath` selector keys. `text` requires WDA predicate-string construction with single-quote injection-escape; `xpath` requires a complexity heuristic. Both deferred on safe-minimum-surface grounds.
- **Out (separate brainstorm):** Android unified-key migration and cross-platform selector vocabulary.
- **Out:** Landscape transforms (explicitly detected + warn-skipped, not silently resolved).
- **Out:** Percy dashboard baseline-linkage — tracked separately with Percy backend + BrowserStack teams; v1.0 GA gates on it but this plan does not implement it.
- **Out:** Multi-element selector composition (AND/OR in one `element: {...}`).
- **Out:** Non-BrowserStack execution paths (local `npx percy app:exec` warn-and-skips element regions; coord regions unchanged).
- **Out:** Maestro Studio / `maestro hierarchy` CLI-based resolution (session-exclusive, can't run during active flow).

## Context & Research

### Relevant Code and Patterns

- **`cli/packages/core/src/adb-hierarchy.js`** — architectural template for the iOS resolver. Shape to mirror: `SELECTOR_KEYS` whitelist, `firstMatch()` pattern, XML parsing via `fast-xml-parser`, size/timeout guards (`MAX_DUMP_BYTES`, `DUMP_TIMEOUT_MS`), logger namespace `core:<platform>-hierarchy`, stdout-only communication (logger scrubs).
- **`cli/packages/core/test/unit/adb-hierarchy.test.js`** — test-structure template (unit-level spec with mocked `execAdb` and `getEnv` injections). iOS equivalent mocks WDA HTTP client + filesystem reader.
- **`cli/packages/core/src/api.js`** — `/percy/maestro-screenshot` relay route. Existing Android element-regions branch already integrates `adb-hierarchy`. iOS branch adds parallel integration.
- **`percy-maestro/percy/scripts/percy-screenshot.js`** — SDK script. Current element-region warn-skip gate lives around `if (region.element) { console.log("Warning: element-based regions are not yet supported..."); }`. R5 removes this block.
- **`percy-appium-python/percy/metadata/ios_metadata.py`** — reference for width-over-window-size scale factor pattern (same-unit-family ratio; `percy-maestro` mirrors the math, not the library).
- **fast-xml-parser** is already a `@percy/core` dependency (used by `adb-hierarchy.js`). No new dep for source-dump path.
- **No PNG-parsing dependency** — hand-parse IHDR bytes 16–23 big-endian (24-byte prefix read). Per-origin-doc R4 decision.

### Institutional Learnings

- v0.4.0 iOS realignment (completed 2026-04-21, commit `85d07d2`) proved: BS appPercy bridge forwards iOS Maestro env vars correctly; percy-maestro SDK runs end-to-end on BS iOS hosts; iOS glob pattern `*_maestro_debug_*/**/<name>.png` (recursive) handles realmobile's deeply-nested SCREENSHOTS_DIR.
- Percy↔BS baseline-linkage: BS assigns unique `parallel-nonce` per build → Percy treats every BS build as `branchline_first_build_empty` → no `applied-regions` on dashboard. Affects all Percy+BS integrations, not percy-maestro-specific.
- Maestro YAML 1.39+ requires `appId:` stub for subflow parse (applies if sub-flow yamls change; V1 doesn't change them).
- `multipartForm` filePath fails on BS (GraalJS sandbox + unknown CWD); relay is the only option. V1 stays on the relay path.

### External References

- W3C WebDriver Classic spec for `GET /session/:sid/window/size` (logical CSS pixels contract; Maestro-bundled WDA returns iOS logical points that equal CSS pixels for our purposes — confirmed by the P1-2 probe in Unit A1).
- PNG IHDR chunk format (libpng spec): signature `\x89PNG\r\n\x1a\n` (8 bytes) + length (4 bytes) + `IHDR` (4 bytes) + width (4 bytes, big-endian) + height (4 bytes, big-endian) at fixed offsets 16–23 post-signature.

## Key Technical Decisions

- **iOS resolver as a new module (`wda-hierarchy.js`) mirroring `adb-hierarchy.js` shape.** Platform dispatch stays in `api.js`. Rationale: adb uses `child_process`; wda uses HTTP. Different implementation shapes; shared-file abstraction would be premature.

- **PNG IHDR parsing: extract the existing `PNG_MAGIC_BYTES` constant (`cli/packages/core/src/api.js:190`) into a new `png-dimensions.js` module; reuse from both the `/percy/comparison/upload` route (already consumer) and the new iOS branch.** Two call sites = extract. Hand-parse the 24-byte prefix (`fileBuffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)` + big-endian uint32 at bytes 16–19 and 20–23). No new dependency. Rationale: avoids constant drift between the two routes; tiny surface; matches the existing `Buffer.equals` idiom.

- **Landscape detection: A1 Probe 5 decides tiering.** If `GET /wda/screen` works reliably on BS iOS hosts (Probe 5 positive), V1 ships **WDA-query-only** orientation detection — drop the aspect-ratio fallback, drop Probe 6, drop `isPortrait`/`isLandscape` helpers from B1 (B1 stays scoped to dimension parsing). If Probe 5 is negative or unreliable, V1 ships two-tier: WDA-query primary + aspect-ratio fallback with empirical threshold from Probe 6. Starting-point threshold 1.25; A1 Probe 6 confirms or adjusts per `min(0.80 × observed-5th-percentile, 1.25)`. Rationale: two-tier is belt-and-braces complexity that only matters if WDA orientation fails; de-scoping saves ~50 lines across B1/B4 + removes an entire probe. Keyboard-visible iOS screenshots do NOT change aspect ratio (`XCUIScreen.main.screenshot()` captures full device composite — Apple XCTest docs) — one less thing to defend against either way.

- **Scale-factor cache: bounded LRU Map (cap 64 entries, 30-minute idle TTL), hand-rolled, no new dep.** Rationale: on shared BS iOS hosts, Percy CLI can serve sequential Maestro sessions across hours (`realmobile`'s `CLIManager#start_percy_cli` reuses CLI across same-device sessions). Unbounded Map growth conflicts with long-running CLI semantics. 64 entries = ~1h of parallel-6-device activity with margin. Eviction hooked to `percy.stop()` via the same shutdown coordinator as AbortController cleanup. ~20 lines using `Map` insertion order + `delete(key); set(key, value)` on hit.

- **Single-path resolver in V1: A1 picks per-element OR source-dump; the other path captured as a `docs/experiments/` writeup for V1.1 if the shipped path regresses in production.** Rationale: the runtime kill-switch (`PERCY_DISABLE_IOS_ELEMENT_REGIONS=1`) already provides incident-response optionality — if the shipped path fails in production, flip kill-switch → warn-skip all element regions → ship V1.1 with the other path in a patch release. This is the same optionality as the dual-path-env-var approach but at half the maintenance cost (one code path, one test matrix, no drift on the unused path, no customer-observable env-var surface that future removal would break). A1's 6-probe experiment + R-11 both-paths-fail escalation gives enough confidence to commit to one path. If production regression forces a V1.1 path switch within 6 months post-GA, we ship it; that timeline is acceptable. **Exception:** if A1 reveals that neither path is robust but both work in complementary regimes (e.g., per-element wins on simple screens, source-dump wins on WebView apps), revisit dual-path at plan time — do not retrofit.

(V1 selector scope — `id` + `class` only, `text`/`xpath` deferred to V1.1 — is already captured in Requirements R1 and Scope Boundaries. Tracked risk: R-1 customer-value concern.)

- **XCUI `class` allowlist is a DoS guardrail, not tidiness.** Citation: [WebDriverAgent issue #292](https://github.com/facebookarchive/WebDriverAgent/issues/292) — unknown class names passed to WDA caused internal mapping to `XCUIElementTypeAny` and full accessibility-tree walks, freezing WDA for tens of seconds on element-dense screens. Pre-WDA-call allowlist rejection at the relay is the defensive primitive. **The allowlist is committed as a named constant in the plan** — see Unit B3's Approach for the full list (extracted from the named Xcode SDK version, snapshot in time). Post-V1 follow-up: `scripts/regenerate-xcui-allowlist.js` to regenerate from Apple's XCUIElement.h.
- **`PERCY_MAESTRO_XCUI_ALLOWLIST_EXTRA` env override — runtime-probed, not format-only.** Customer-settable (comma-separated `XCUIElementType*` names; ≤64 chars each; ≤20 entries). **On Percy CLI startup, each extras entry is probed against the live WDA instance** — the relay issues a no-op existence query; entries that don't resolve on this WDA build are dropped with a scrubbed log. This closes SEC-04: format validation alone (starts-with-`XCUIElementType`, alphanumeric) does not prevent the WDA-side freeze from crafted "looks-valid-but-unknown" class names; runtime verification does. Additional defense: when `PERCY_MAESTRO_XCUI_ALLOWLIST_EXTRA` is set, regions-per-screenshot cap tightens from 50 → 10 for that session (limits blast radius if probe verification is somehow bypassed).

- **Cross-tenant safety via realmobile-written `/tmp/<sid>/wda-meta.json` (hard dependency) with `schema_version` field.** Contract includes `schema_version: "1.0.0"` (semver); relay validates major === 1; rejects with `'schema-version-unsupported'`. Rationale: realmobile and Percy CLI ship independently; contract drift is the highest-probability silent-failure mode (R-12). Version negotiation gives us a breaking-change detection signal. Apple Secure Coding Guide (CVE-2005-2519, Directory Server private-key substitution) documents that `/tmp` trust on Apple platforms is an attested anti-pattern — we're operating there knowingly because realmobile can't currently write to per-tenant `confstr(_CS_DARWIN_USER_TEMP_DIR)` paths; defense depth in A2 + B2 is correspondingly rigorous.

- **`wda-session-resolver` file-ordering follows SEI CERT POS35-C:** `open(path, O_NOFOLLOW | O_RDONLY | O_NONBLOCK)` → `fstat` → verify `mode === 0100600` AND `uid === getuid()` AND `st_nlink === 1` AND `S_ISREG`. **Do NOT use `lstat` before `open`** — it introduces a TOCTOU window and is redundant once `O_NOFOLLOW` is set (see LWN:472071). The `st_nlink === 1` check closes the hardlink-attack vector documented in Apple Secure Coding Guide. Filesystem mtime/ctime is treated as untrusted — only the JSON-internal `flowStartTimestamp` participates in freshness.

- **Runtime kill-switch: `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` short-circuits the iOS element-region branch with a warn-skip.** Lives in Unit B4. **Read from host-level config only, NOT from tenant-forwarded `appPercy.env`.** Mechanism: the relay reads the flag from the Percy CLI process's **initial environment at startup** (set by Percy CLI invocation on the BS iOS host by Percy incident responders or realmobile, not by customer build payload). Rationale: `appPercy.env` is per-build customer-controlled and forwarded to `percy app exec:start` subprocess env per realmobile's `CLIManager#start_percy_cli` plumbing. If the Percy CLI process is shared across tenants (see System-Wide Impact for CLI lifecycle analysis), a tenant-forwarded kill-switch could disable element regions for co-tenant builds on the same host — cross-tenant correctness regression. Host-level = safe from tenant tampering.

- **wda-hierarchy shutdown integration is a direct edit to `cli/packages/core/src/percy.js`, not a hook registration.** `@percy/core` has no shutdown coordinator or plugin hook API today (verified: `percy.js`'s `stop(force)` method is linear from line 311–380; no `onExit`/`beforeExit`/`addListener` surface exists). The plan invokes `wdaHierarchy.shutdown()` inline inside `percy.stop()` before `await this.server?.close()` (around line 362). Rationale: natural lifecycle point — we're about to close inbound sockets, and outbound WDA requests should abort in the same pass. Creating a generic coordinator API would be over-abstraction for one caller.

- **v1.0 GA gates on Percy↔BS baseline-linkage fix** (Risk R-2). RC channel (`@percy/cli@next`, `percy-maestro@1.0.0-rc.N`) runs during the wait, with explicit adopter communication (Unit C3) and multi-condition promotion checklist (Phased Delivery Phase 3).

- **Telemetry emission: structured log meta via `percy.log.info` (Option A — V1).** Fields: `{event: 'ios-region-resolution', outcome: <reason-tag>, durationMs, sessionIdHash, platform: 'ios', cli_version}` where `sessionIdHash = HMAC-SHA256(sessionId, process_startup_salt).digest('hex').slice(0, 16)` — **16 hex chars (64 bits)**, not 8. Rationale: 32-bit collisions hit at ~65k sessions (Percy runs >>65k/day), allowing cross-tenant log aggregation pivots to surface other tenants' events. Also, 32-bit preimage is brute-forceable offline (~4 billion candidates) against a sessionId generation scheme of limited entropy — de-anonymization risk. HMAC with per-process startup salt prevents offline rainbow-table preimage. **Forbidden fields:** selector value, selector value length, raw sessionId, WDA port, bbox coords, WDA response bodies, customer ID, `flowStartTimestamp`. The scrubbing allowlist is a single named constant (`TELEMETRY_SAFE_FIELDS`) referenced by B2, B3, B4, and C2 — prevents drift between units. Rationale: `@percy/core` has no structured-metric channel today; `sendBuildEvents` (`cli/packages/core/src/utils.js:274`) is event/crash-oriented and extending its schema blocks on Percy backend. Option B (backend schema extension) is V1.1.

- **realmobile contract has a post-commit-change protocol.** Breaking schema changes require 2-week heads-up + joint regression run on staging before production ship, via a named channel (Slack `#percy-maestro-realmobile-sync` or equivalent — confirmed at Unit A2 signing). Weekly contract-conformance canary runs Unit A2's acceptance harness against a staging BS iOS host post-GA.

- **Visual-overlay spot-check reframed as JSON side-channel** (not PNG composite). When `PERCY_MAESTRO_DEBUG_REGIONS=1`, the relay writes `/tmp/<sid>/debug/<name>_regions.json` with `[{name, x, y, width, height, selector_key_only}]`. Rationale: `pako` (the only deflate-capable dep in `@percy/core`) is gzip-only — full PNG composite requires zlib deflate + CRC-32 per chunk + scanline filter selection, which exceeds C2's "time-box" threshold. JSON side-channel delivers the same engineering value (can be overlaid in any image tool) at ~20 lines of code. PNG composite is tracked as a post-V1 stretch goal.

## Open Questions

### Resolved During Planning

- **Where does PNG parsing live?** Inline helper in `api.js` (or small export if other code needs it). No new file required unless compiled code exceeds ~30 lines.
- **How does the iOS resolver cache scale factor?** Per-sessionId, in-memory Map scoped to the Percy CLI process lifetime. Evicted on session end (when relay observes `sessionId` absence for > N minutes, optional — V1 can leak Map entries for short-lived CLI processes).
- **Does the SDK change need a feature flag for forward-compat with old CLIs?** No. Old relay warn-skips unknown region shapes already. R5 removes the SDK gate unconditionally; relay is the single source of truth per R5.
- **Where do security acceptance tests live?** `test/security/` in the realmobile coordination repo (not in percy-maestro or cli). Run against a staging BS iOS host before implementation begins.

### Open Decisions Owned by Plan Owner (Coordinates with External Teams)

- **[Affects D1] Percy API version-signaling mechanism.** Three options: (a) Percy API adds an acknowledgment field on `POST /comparisons` response; (b) version-gate via a build-info endpoint; (c) none — manual verification via admin-token inspection + README compatibility table. **Decision owner: Percy CLI maintainer + Percy backend EM.** Target decision date: before Phase 1 begins (parallel with realmobile A2 coordination — both are plan-owner coordination work, not coding-blocking). Default assumption absent an explicit answer: option (c) ships in V1 (compatibility table in README); ability to upgrade to (a) or (b) in V1.1 if backend adds the field later. This is an explicit assumption, not an unresolved blocker — it does not block engineering Phase 1.

### Deferred to Implementation

- **Single resolution path default.** A1 picks `per-element` OR `source-dump`. Only the selected path is implemented in V1. The losing path's findings are captured in the A1 writeup for V1.1 reference if the shipped path regresses.
- **XCUI allowlist baseline.** V1 extracts the allowlist from Apple's `XCUIElement.h` at Xcode 16.0 SDK (the most recent stable at plan time; implementer confirms or picks a later-than-16.0 version if available when Phase 1 starts). The list lives as a `Set` constant in `cli/packages/core/src/wda-hierarchy.js` with a header comment naming the Xcode version + a link to Apple's `XCUIElement.ElementType` docs. Post-V1 follow-up: `scripts/regenerate-xcui-allowlist.js` automates future updates.
- **Exact WDA endpoint paths for per-element resolution.** Standard: `POST /session/:sid/elements` + `GET /element/:eid/rect`. Implementer confirms the BS Maestro-bundled WDA build matches W3C WebDriver classic; A1 probe will surface any divergence.
- **XML parse depth and cleanup semantics for source-dump path.** Specific to the fast-xml-parser config (already tuned for adb-hierarchy — reuse or fork). Implementer decides at code time.
- **Final scrubbed log message format.** Origin doc specifies content (key + value length + reason-tag + duration); implementer picks final string format consistent with existing relay log style.
- **memfs + mode bit support verification.** Unit B2 uses memfs via the existing `mockfs` helper (`cli/packages/config/test/helpers.js:35-95`). Pre-B2 spike (~1h): confirm memfs `fromJSON` supports `chmodSync`-level mode setting, OR post-create `fs.chmodSync` works on the memfs volume. If neither works, the test harness falls back to a real tmpdir with cleanup (still within Jasmine scope).
- **Whether to retire `PERCY_MAESTRO_DEBUG_REGIONS` JSON side-channel after v1.0 GA.** Review post-GA.
- **PNG composite as a stretch follow-up.** C2 ships JSON side-channel in V1; full PNG pixel-overlay composite tracked as post-V1 work if engineering demand is non-zero.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant MF as Maestro Flow (GraalJS)
    participant SDK as percy-screenshot.js
    participant Relay as Percy CLI Relay (@percy/core)
    participant FS as /tmp/<sid>/
    participant WDA as WebDriverAgent (loopback)
    participant RM as realmobile (host-privileged)
    participant Percy as Percy API

    Note over RM,FS: Before Maestro session<br/>(Unit A2 contract)
    RM->>FS: Write wda-meta.json<br/>{sessionId, wdaPort, processOwner, flowStartTimestamp}<br/>mode 0600, parent 0700

    MF->>SDK: Maestro takeScreenshot writes PNG
    MF->>SDK: runScript percy-screenshot.js (PERCY_REGIONS env)
    SDK->>Relay: POST /percy/maestro-screenshot<br/>+ regions[] (element + coord)

    Relay->>FS: Read PNG; parse IHDR → (width, height)
    alt width ≥ height × 0.83 (landscape or ambiguous)
        Relay->>Relay: Warn-skip all element regions;<br/>coord regions preserved
    else height > width × 1.2 (portrait)
        Relay->>FS: Read wda-meta.json;<br/>validate owner+mode+freshness+no-symlink
        alt wda-meta invalid
            Relay->>Relay: Fail-closed on all element regions
        else valid
            Relay->>WDA: GET /session/:sid/window/size → logical_w<br/>(first-screenshot-only per session)
            Relay->>Relay: raw = pixel_w ÷ logical_w<br/>validate ∈ [1.9, 3.1]<br/>snap → {2, 3}; cache by sessionId
            loop each element region
                Relay->>Relay: Normalize class short→long-form<br/>Validate against XCUI allowlist
                alt per-element path (A1 outcome)
                    Relay->>WDA: POST /session/:sid/elements {using, value}
                    Relay->>WDA: GET /element/:eid/rect
                else source-dump path (A1 outcome)
                    Relay->>WDA: GET /session/:sid/source (cached per screenshot)
                    Relay->>Relay: Parse XML; match id/class selectors
                end
                Relay->>Relay: First-match; points→pixels via scale;<br/>validate in-bounds + area ≥ 4×4 px
            end
        end
    end

    Relay->>Percy: POST /comparisons w/ resolved regions
    Percy-->>Relay: {success, link}
```

## Implementation Units

### Phase 0 — Pre-implementation Gates

- [ ] **Unit A0: Infrastructure verification spikes (small, ~half-day total)**

Three ~30min spikes to verify load-bearing assumptions before Phase 1 begins. If any fails, surface as an explicit plan revision.

**A0.1 — AbortController pass-through on `@percy/client/utils#request`** (verifies F5 assumption):
- Dispatch `request()` with `{signal: controller.signal, retries: 0}` against a deliberately-slow local server; abort after 50ms.
- Expect: rejection with an abort-class error within 100ms; no retry-storm.
- If fails: B3 must import Node's `http` directly and wrap manually; flag as a pattern change.

**A0.2 — memfs + mode bit support**:
- Construct a memfs volume via `mockfs`; `fs.chmodSync('/tmp/<sid>/wda-meta.json', 0o600)`.
- Verify `fs.fstatSync(fd).mode === 0o100600`.
- If fails: B2 test harness falls back to a real tmpdir with `afterEach` cleanup (still Jasmine-scope; existing pattern in other `@percy/core` tests).

**A0.3 — Kill-switch env lifecycle on BS iOS hosts** (verifies Rollback Scenario B + SEC-01 assumption):
- On a staging BS iOS host, set `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` in the Percy CLI startup env; confirm it's read by the relay at request time.
- Confirm the same env var set in a customer's `appPercy.env` block does NOT reach the relay's process env (if it does, the kill-switch is tenant-tamperable — raise immediately as a cross-tenant security blocker; fix the read-scope before B4).
- If both checks pass: the host-level kill-switch mechanism is viable as documented.

**Verification:** A0 writeup (one page) captures findings. Any failure surfaces as a revision to the relevant unit before Phase 1 code starts.


- [ ] **Unit A1: P1-2 live WDA experiment on BS iOS host**

**Goal:** Determine per-element vs source-dump resolution path. Confirm WDA semantic + endpoint assumptions.

**Requirements:** Gates R1, R4 path selection. Gates Unit B3.

**Dependencies:** Access to a BS iOS Maestro session with the v0.4.0 SDK installed; ability to issue localhost WDA HTTP calls from the host shell.

**Files:**
- Experiment scripts (throwaway): `~/percy-repos/percy-maestro/docs/experiments/2026-04-22-p1-2-wda-probe/`
- Writeup: `~/percy-repos/percy-maestro/docs/experiments/2026-04-22-p1-2-wda-probe/findings.md`

**Approach:**
- On a BS iOS host with an active Maestro flow (≥10 `tapOn` per screenshot, ≥20 consecutive screenshots):
  - **Probe 1 — Per-element concurrent safety:** trigger `POST /session/:sid/elements` + `GET /element/:eid/rect` mid-flow. Measure flow-completion rate, count `stale element reference` errors in Maestro logs.
  - **Probe 2 — Source-dump concurrent safety:** trigger `GET /session/:sid/source` mid-flow. Measure the same; also record p50/p95 response size (Risk R-5 input — WebView-heavy apps may exceed 20 MB).
  - **Probe 3 — Selector semantics:** in a test iOS app with a button where `accessibilityIdentifier="submit-btn"` and visible label is `"Sign in"`, assert `POST /session/:sid/elements {using:'name', value:'submit-btn'}` returns the button, not a label-only match.
  - **Probe 4 — Rect-to-screenshot temporal alignment:** during a scrolling flow, overlay the returned `/element/:eid/rect` on the captured screenshot; measure drift.
  - **Probe 5 — `window/size` units:** call `GET /session/:sid/window/size` on iPhone 13, iPhone 14, iPhone 15 Pro Max. Assert returned `width` matches Apple's published logical-point width (not pixel width). Also call `GET /wda/screen` on the same devices; record the response shape (expected: `{value: {scale, orientation, statusBarSize}}`) for Unit B1's orientation primary signal.
  - **Probe 6 — Portrait-screenshot aspect-ratio distribution:** capture ≥20 iPhone + ≥10 iPad portrait screenshots across (a) full-screen, (b) keyboard-visible, (c) modal-presented, (d) in-call status bar, (e) iPad Split View 1/2 and 1/3 width. Record `pngHeight ÷ pngWidth` for each. Compute 5th percentile. Set B1's aspect-ratio-fallback threshold to `min(0.80 of observed-min, 1.25)`. Rationale: iPad portrait is 1.33; the default 1.25 needs empirical confirmation, and keyboard/modal/Split-View cases are the uncertain ones. (XCUITest screenshots include keyboard composite per Apple docs, so aspect ratio should remain the device-native ratio — this probe confirms that on real BS iOS hosts.)

**Execution note:** Live experiment; observational, not test-driven. Hard-to-reverse architectural decision.

**Test scenarios:** N/A (experiment, not production code).

**Verification:**
- Findings writeup classifies outcome as one of four: `per-element OK`, `source-dump OK`, `both OK` (pick per-element per plan preference), `**both fail** — escalate per R-11`.
- Probes 3, 5 pass; if either fails, R1/R4 need revisiting (escalate before Unit B3).
- Probe 4 drift: acceptable if rect lands on intended element in ≥95% of scrolling screenshots; otherwise source-dump wins regardless of Probe 1/2 outcome.
- Probe 6 produces empirical threshold for B1; if 5th-percentile observation < 1.05, escalate (suggests aspect-ratio detection is unreliable on BS iOS host; fall back to WDA-query-primary only with no aspect fallback).
- Both-paths-fail outcome invokes R-11 escalation: V1-lite ships as a no-op SDK change; version becomes v0.5.0 (not v1.0 marquee).

---

- [ ] **Unit A2: realmobile `wda-meta.json` contract + security acceptance tests**

**Goal:** Write the binding realmobile ↔ Percy CLI contract for session-scoped WDA port discovery. Validate on a staging BS iOS host before any Percy implementation begins.

**Requirements:** Gates R6 and all iOS implementation.

**Dependencies:** realmobile team commit signal (product decision — surface to user if not yet confirmed). Staging BS iOS host with privileged access.

**Files:**
- Create: `docs/contracts/realmobile-wda-meta.md` (contract specification)
- Create: `test/security/wda-meta-acceptance/` (bash + smoke test harness, per test)

**Files clarification:** contract doc + acceptance harness live in percy-maestro / realmobile repos, NOT in `cli/packages/core/test/` (core's test runner only globs `**/*.test.js` per `cli/scripts/test.js:109-115`, so a bash harness under core/test would silently not run).

**Approach:**
- **Contract fields (`schema_version: "1.0.0"` mandatory):** `sessionId` (string), `wdaPort` (integer, 8400–8410 range), `processOwner` (uid integer from `getuid()` of the Maestro-spawning process), `flowStartTimestamp` (epoch ms), `schema_version` (semver string).
- **Write semantics:** temp-file + rename atomic write within `/tmp/<sid>/` (same filesystem); parent dir mode 0700 created with `O_NOFOLLOW` analogue; file mode 0600; single hard-link (`nlink === 1`).
- **Write point:** realmobile session start (before `percy app exec:start`). Rewrite on WDA restart (port may change; timestamp updates). Rewrite on Percy CLI restart detection if realmobile exposes a hook — without the hook, Percy CLI applies a 5-minute freshness tolerance in B2 to absorb common restart scenarios.
- **Cleanup:** realmobile deletes `/tmp/<sid>/` at session end.
- **Post-commit-change protocol:** breaking schema changes require 2-week heads-up in the named coordination channel (confirmed at sign-off, e.g., `#percy-maestro-realmobile-sync`) + joint regression run on staging. Non-breaking additive changes may ship with a minor `schema_version` bump.
- **Percy CLI validation contract (specified here, implemented in B2):**
  - `open(path, O_NOFOLLOW | O_RDONLY | O_NONBLOCK)` — NOT `lstat` first (TOCTOU; see SEI CERT POS35-C, LWN:472071).
  - `fstat` on the opened fd; reject if `mode !== 0100600`, `uid !== getuid()`, `st_nlink !== 1`, or `!S_ISREG(mode)`.
  - Parse JSON; reject if fields missing, `schema_version` major !== 1, or `wdaPort` outside 8400–8410.
  - Freshness: reject if `flowStartTimestamp` < (Percy CLI startup epoch − 5min tolerance). Filesystem mtime/ctime is untrusted; only JSON-internal timestamp participates.
- **Security acceptance tests (all must pass on staging BS iOS host; contract not considered signed-off until all 8 green):**
  1. **Two-tenant concurrent write:** two tenants' realmobile instances write to `/tmp/<sidA>/` and `/tmp/<sidB>/` concurrently; Percy CLI for tenant A reads only tenant A's file.
  2. **Permission/ownership verification:** deliberately wrong mode (0666), wrong owner, wrong parent-dir mode; relay must reject each.
  3. **Atomicity under crash:** simulate realmobile crash mid-write (truncated JSON); relay rejects, never partial-parses.
  4. **Symlink attack:** pre-create `/tmp/<sid>/wda-meta.json` as a symlink → `/etc/passwd`; `open(O_NOFOLLOW)` must return `ELOOP`.
  5. **Pre-creation race:** co-tenant pre-creates `/tmp/<sid>/` with attacker-controlled mode; realmobile write refuses-if-exists and fail-closes (session cannot start).
  6. **Hard-link attack:** attacker pre-creates `/tmp/<sid>/wda-meta.json` as a hardlink to their own regular file; realmobile rewrites via temp+rename. `fstat.st_nlink` on Percy CLI's opened fd must be 1; relay rejects if ≥2 with reason `'multi-link'`. (Apple Secure Coding Guide; `/tmp` on macOS/iOS does not consistently enforce `fs.protected_hardlinks`.)
  7. **TOCTOU atomicity stress:** co-tenant process tight-loop-swaps `/tmp/<sidA>/wda-meta.json` between a valid file and a symlink to `/etc/passwd`. Run Percy CLI validation 1000 iterations; zero successful symlink-substitutions; all invalid iterations return `symlink`-class or `multi-link` reason, never a successful `/etc/passwd` open.
  8. **Inode/dentry exhaustion resilience:** fill `/tmp` to the tenant's file-count quota before realmobile creates `/tmp/<sidA>/`; realmobile fails cleanly (no crash, no partial state); Percy CLI returns `missing`; element regions warn-skip; coord regions + screenshots unaffected. (Verifies fail-closed behavior under ops-layer DoS.)

**Execution note:** Coordination-heavy. No percy-maestro / cli code changes until all 8 acceptance tests pass. Cite Apple CVE-2005-2519 (Directory Server private-key temp-file substitution) in the contract doc as the precedent justifying the depth of validation — `/tmp` trust on Apple platforms is an attested anti-pattern we're knowingly mitigating rather than avoiding.

**Test scenarios:** Above 8 security acceptance scenarios.

**Verification:**
- Contract reviewed + signed off by realmobile EM, Percy security, and Percy CLI maintainers.
- All 8 acceptance tests green on staging BS iOS host.
- Post-commit-change coordination channel named in writing.
- No Phase-1 unit begins until the above is documented.

---

### Phase 1 — Core Implementation

- [ ] **Unit B1: PNG IHDR dimension parser — extracted module serving both routes**

**Goal:** Extract `PNG_MAGIC_BYTES` from `api.js:190` into a new shared module; add IHDR width/height parse + `isPortrait` / `isLandscape` helpers. Serves R4 scale factor and fallback landscape detection.

**Requirements:** R4, Landscape detect & warn-skip success criterion.

**Dependencies:** None.

**Files:**
- Create: `cli/packages/core/src/png-dimensions.js` — exports `PNG_MAGIC_BYTES` (moved from `api.js:190`), `parsePngDimensions(buffer) → {width, height}`, `isPortrait({width, height}, threshold=1.25)`, `isLandscape({width, height}, threshold=1.25)`.
- Modify: `cli/packages/core/src/api.js` — import `PNG_MAGIC_BYTES` from the new module; remove the inline constant.
- Test: `cli/packages/core/test/unit/png-dimensions.test.js`
- Fixtures: hand-construct minimal IHDR-only PNG buffers inline in the test file via `Buffer.concat([PNG_MAGIC_BYTES, ...])` (24 bytes per fixture) — matches the existing `Buffer.from([...])` idiom at `api.js:190`. No new binary fixtures in `test/fixtures/`.

**Approach:**
- Read first 24 bytes. Verify signature via `buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES)` — mirrors `api.js:248` style. Throw `Error('invalid-png')` on mismatch.
- Width: bytes 16–19, big-endian uint32 (`buffer.readUInt32BE(16)`). Height: bytes 20–23 (`buffer.readUInt32BE(20)`).
- Reject width === 0 or height === 0 with `Error('invalid-png-dimensions')`.
- `isPortrait`: `height > width * threshold` (default 1.25).
- `isLandscape`: `width > height * threshold` (default 1.25).
- A1 Probe 6 may adjust threshold; if so, B1 accepts an injected constant (the API stays the same).

**Execution note:** Test-first. Also the Phase 1 **coverage preflight gate** — implement + push to feature branch first; confirm 100% NYC line+branch coverage passes CI before B2/B3 begin (catches coverage-bar friction early; R-10).

**Test scenarios:**
- Valid iPhone 14 portrait (1170×2532) → `{width: 1170, height: 2532}`.
- iPad Pro 12.9" portrait (2048×2732, ratio 1.334) → `isPortrait` returns `true` at threshold 1.25.
- iPhone landscape (2532×1170) → `isPortrait` false; `isLandscape` true.
- iPad Split View 1/3 width portrait (≈1024×2732, ratio 2.67) → `isPortrait` true.
- Near-square (500×550, ratio 1.1) → both `isPortrait` and `isLandscape` false (ambiguous, caller warn-skips).
- Square (500×500) → both false.
- Truncated buffer (< 24 bytes) → throws `'invalid-png'`.
- Non-PNG signature → throws `'invalid-png'`.
- Width = 0 → throws `'invalid-png-dimensions'`.
- Height = 0 → throws `'invalid-png-dimensions'`.
- Dimensions > 65535 → accepted (PNG spec allows 2³¹ − 1).

**Patterns to follow:** `cli/packages/core/src/api.js:190, 248` — `PNG_MAGIC_BYTES` declaration + `Buffer.equals` check. `cli/packages/core/src/adb-hierarchy.js:18-25` — pure-function module shape with no side effects.

**Verification:** Unit tests pass; `/percy/comparison/upload` route still works after the constant extraction (no regression); **100% line + branch coverage under @percy/core NYC config, CI green**.

---

- [ ] **Unit B2: `wda-session-resolver.js` — read + validate wda-meta.json**

**Goal:** Given a Maestro `sessionId`, read `/tmp/<sid>/wda-meta.json`, validate per A2 contract, return `{wdaPort}` on success or a scrubbed fail-closed reason on failure.

**Requirements:** R6.

**Dependencies:** Unit A2 (contract signed off + security acceptance tests passing).

**Files:**
- Create: `cli/packages/core/src/wda-session-resolver.js`
- Test: `cli/packages/core/test/unit/wda-session-resolver.test.js`

**Approach:**
- Import `fs` directly (not via DI). Dep injection narrows to `{getuid, getStartupTimestamp}` — the side-effectful external primitives. Mirrors `adb-hierarchy.js:193` pattern (inject only side-effectful abstractions; let `fs` be mocked at the memfs layer via the existing `mockfs` helper at `cli/packages/config/test/helpers.js:35-95`).
- **Steps (SEI CERT POS35-C ordering — no `lstat` prefix):**
  1. `fs.openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)` — catches `ELOOP` on symlink (reject with `'symlink'`), `ENOENT` on missing (reject `'missing'`).
  2. `fs.fstatSync(fd)` — verify all of: `stat.mode === 0o100600`, `stat.uid === getuid()`, `stat.nlink === 1`, `stat.isFile()`. Any mismatch rejects with distinct reason tag (`'wrong-mode'`, `'wrong-owner'`, `'multi-link'`, `'not-regular-file'`).
  3. Read file via fd; `fs.closeSync(fd)` in a `finally`.
  4. `JSON.parse` inside try/catch → `'malformed-json'` on throw.
  5. Schema validate: `schema_version` (semver; reject major !== 1 with `'schema-version-unsupported'`), `sessionId` (string, matches payload sessionId), `wdaPort` (integer, 8400–8410; else `'out-of-range-port'`), `processOwner` (integer uid), `flowStartTimestamp` (integer ms).
  6. Freshness: reject if `flowStartTimestamp < getStartupTimestamp() - 5*60*1000` with `'stale-timestamp'`.
- Return `{ok: true, port}` or `{ok: false, reason}`.
- Logger namespace `core:wda-session`. Log message shape: `'[wda-session] fail-closed: <reason>'` — reason tag only; no file contents, port, path, uid, or timestamp in stdout.

**Execution note:** Test-first — security-critical.

**Pre-B2 spike:** covered by Unit A0.2 above.

**Why sync `fs.openSync` + `fs.fstatSync` and not `fs.promises.open` + handle.stat():** sync primitives preserve atomic fd-state between the `open` and the `stat` — no microtask can fire between them. `fs.promises.open()` then `handle.stat()` would also be atomic on the fd (the handle binds the fd for its lifetime), so async is defensible. The plan's choice here is intentional: sync is simpler in a route handler that already does synchronous payload validation, the file is small (< 200 bytes), and the `@percy/core` relay is not IO-throughput-critical at the wda-meta read path. If an implementer prefers the async-handle variant, that's acceptable — the security property is equivalent. **Do not** replace with `fs.lstat` + `fs.open` + `fs.fstat` — that breaks the TOCTOU-safety property (see Key Decisions + SEI CERT POS35-C).

**Patterns to follow:** `cli/packages/core/src/adb-hierarchy.js:193, 255-256` — DI + export shape. `cli/packages/core/test/helpers/index.js:7-30` — `mockfs` + `setupTest`. `cli/packages/core/test/snapshot-multiple.test.js:335` — `fs.$vol.fromJSON` idiom.

**Test scenarios:**
- Missing file → `{ok: false, reason: 'missing'}`.
- Symlink → `/etc/passwd` → `'symlink'` via `ELOOP`.
- Hardlink (nlink === 2) → `'multi-link'` (acceptance-test #6 mirror).
- Non-regular-file type → `'not-regular-file'`.
- Wrong mode (0644, 0666) → `'wrong-mode'`.
- Wrong owner (uid ≠ `getuid()`) → `'wrong-owner'`.
- Malformed JSON (truncated) → `'malformed-json'`.
- `schema_version: "2.0.0"` → `'schema-version-unsupported'`.
- Missing `schema_version` field → `'malformed-json'` (required field).
- Port 7999 or 8411 → `'out-of-range-port'`.
- `flowStartTimestamp` older than startup minus 5-minute tolerance → `'stale-timestamp'`.
- Valid happy-path file → `{ok: true, port: 8408}`.
- Race: file opened mid-rewrite (partial content) → `'malformed-json'` (atomicity contract protects happy path).
- **Log-scrubbing assertion** (new pattern for this module; see Finding 6 from repo-research): `expect(logger.stderr.join('\n')).not.toContain(port)` + `not.toContain(sessionId)` + `not.toContain(path)` in every failure scenario.

**Verification:** All 13 test scenarios pass. Zero selector values, sessionIds, ports, or paths in logger output across all scenarios. **100% line + branch coverage under NYC.**

---

- [ ] **Unit B3: `wda-hierarchy.js` — iOS element resolver**

**Goal:** Core iOS element-resolution module. Resolves `{element: {id}}` and `{element: {class}}` selectors to pixel rectangles by querying WDA on the host.

**Requirements:** R1, R2, R3, R4, R7.

**Dependencies:** Units A1 (resolution path selected), A2 (wda-meta contract), B1 (PNG dims), B2 (session resolver).

**Files:**
- Create: `cli/packages/core/src/wda-hierarchy.js`
- Test: `cli/packages/core/test/unit/wda-hierarchy.test.js`

**Approach:**
- Exports `async function resolveIosRegions({regions, sessionId, pngWidth, pngHeight, isPortrait, deps})` returning `{resolvedRegions, warnings}`.
- `deps` injection bundle: `{httpClient, readWdaMeta, log, abortController}` — all side-effectful externals injected; `fs` is not (memfs mock covers it, mirrors B2).
- **HTTP client:** default `defaultWdaRequest()` wraps `@percy/client/utils#request` (the only HTTP client in `@percy/core`; no `fetch`/`axios`/`got`) with **`retries: 0`** (disable default retry-on-ECONNREFUSED; otherwise 500ms timeout is meaningless) and an `AbortController` whose signal is passed into every request. Module exports `shutdown()` that aborts all live controllers; B4 registers this with the Percy CLI process-exit coordinator.
- **Single path: implement only the A1-selected resolution path** (per-element OR source-dump). The losing path from A1 is captured as a `docs/experiments/2026-04-22-p1-2-wda-probe/findings.md` section for V1.1 reference; no runtime env-var toggle. If the shipped path regresses in production, incident response uses the kill-switch → coord-only fallback + V1.1 path switch in a patch release (per Key Decisions).
- High-level steps per call:
  1. **Landscape gate:** if `!isPortrait`, return empty resolvedRegions + `'landscape-or-ambiguous'` warning. (`isPortrait` is computed by the caller from B1's helpers AND/OR a successful WDA `GET /wda/screen` orientation query — B4 decides based on availability.)
  2. **Kill-switch:** if `process.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS === '1'`, return empty + `'kill-switch-engaged'`.
  3. **Session resolution:** call B2's `readWdaMeta(sessionId)` → port OR fail-closed reason.
  4. **Loopback guard:** construct URL as `http://127.0.0.1:<port>/…`. If any deps-supplied override reaches a non-loopback address, throw and fail-closed with `'loopback-required'`.
  5. **Scale factor:** on first call per session, `GET /session/<sid>/window/size` → logical_w. `raw = pngWidth / logical_w`. Validate `raw ∈ [1.9, 3.1]` → else fail-closed session-wide `'scale-out-of-range'`. Snap to nearest integer in `{2, 3}`. Cache in bounded LRU `Map` (cap 64, 30-min idle TTL).
  6. **Per-region resolution:**
     - If `class`: normalize short-form (prepend `XCUIElementType` if missing), validate against `XCUI_ALLOWLIST` + optional `PERCY_MAESTRO_XCUI_ALLOWLIST_EXTRA` env extras. Unknown → warn-skip `'class-not-allowlisted'`. **This is a DoS guardrail per WDA issue #292** — unknown class names passed to older WDA caused full accessibility-tree walks and tens-of-seconds freezes; the allowlist prevents this regardless of the client-side timeout.
     - Selector value length > 256 → warn-skip `'selector-too-long'`.
     - Issue WDA call(s) per selected path; use 500ms `AbortController` timeout on each.
     - **Per-element path:** `POST /session/<sid>/elements {using: 'name'|'class name', value}` → first element; `GET /element/:eid/rect`.
     - **Source-dump path:** on first element region per screenshot, `GET /session/<sid>/source` with:
       - **20 MB response-size cap** enforced before parse begins (reject with `'source-oversize'` if exceeded);
       - **Pre-parse DOCTYPE rejection guard**: regex-scan the response for `<!DOCTYPE` or `<!ENTITY` (case-insensitive) **before handing to the parser**; reject with `'xml-rejected'` if found. The reused `processEntities: false` parser config (mirroring `adb-hierarchy.js:18-25`) does NOT reject entities — it silently ignores them — so it's defense-in-depth, not the primary defense. The pre-parse regex IS the rejection primitive;
       - **1s parse-time budget via AbortController** (abort with `'parse-timeout'` if exceeded).
       Cache parsed tree per screenshot. Walk tree, match first occurrence.
     - Zero-match → warn-skip `'zero-match'`.
     - Scale points → pixels.
     - **Bbox validation:** `0 ≤ left < right ≤ pngWidth`, `0 ≤ top < bottom ≤ pngHeight`, `right - left ≥ 4`, `bottom - top ≥ 4`. Out-of-bounds → `'bbox-out-of-bounds'`; too-small → `'bbox-too-small'`.
     - Push to resolvedRegions.
- **Telemetry emission** (per Key Decisions): after each region (success or warn-skip), call `log.info({event: 'ios-region-resolution', outcome: <reason>, durationMs, sessionIdHash})` where `sessionIdHash = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8)`.
- All logs: reason tag + durationMs + `sessionIdHash` only. Forbidden: selector value, selector value length, raw sessionId, WDA port, bbox coords, WDA response bodies.

**Execution note:** Test-first — complex logic, security-bearing. Implement both resolution paths; A1 picks the default.

**Technical design (directional):**

```
const XCUI_ALLOWLIST = new Set([
  'XCUIElementTypeButton', 'XCUIElementTypeStaticText', 'XCUIElementTypeImage',
  'XCUIElementTypeTextField', 'XCUIElementTypeSecureTextField', 'XCUIElementTypeSwitch',
  // ... full list from Apple's XCUIElement.h; ~70 entries. Maintained inline.
]);

async function resolveIosRegions({regions, sessionId, pngWidth, pngHeight, deps}) {
  if (!deps.isPortrait) return { resolvedRegions: [], warnings: ['landscape-or-ambiguous'] };
  const meta = await deps.readWdaMeta(sessionId);
  if (!meta.ok) return { resolvedRegions: [], warnings: [meta.reason] };
  const scale = await resolveScale(sessionId, meta.port, pngWidth, deps);
  if (!scale.ok) return { resolvedRegions: [], warnings: [scale.reason] };
  // Per-element OR source-dump branch (one of these; A1 picks).
  // ...
}
```

> *The above is a shape sketch only, not implementation. Real code uses the adb-hierarchy.js style (dependency injection, named helpers, explicit error tags).*

**Patterns to follow:** `cli/packages/core/src/adb-hierarchy.js:193, 201-218` — DI shape, logger namespace `core:wda-hierarchy`, error-tag enum, allowlist-first selector validation, dual-path-with-fallback pattern. `cli/packages/client/src/utils.js:128, 142` — house HTTP client (`@percy/client/utils#request`). `test/helpers/expect-scrubbed.js` — NEW helper this unit creates and exports for future reuse (log-scrubbing assertions).

**Test scenarios (organized by concern; single-path V1 per Key Decisions):**

*Selector resolution:*
- Happy path: `id: "submit-btn"` matches a single element → 1 scaled rect.
- `class: "Button"` (short-form) → relay-side resolver prefixes to `XCUIElementTypeButton` → matches; long-form `"XCUIElementTypeButton"` matches identically (no double-prefix).
- `class: "NotAnXcuiType"` → warn-skip `'class-not-allowlisted'` BEFORE any WDA call.
- `class: "SomeWeirdValue"` via `PERCY_MAESTRO_XCUI_ALLOWLIST_EXTRA=XCUIElementTypeSomeWeirdValue` → allowed.
- Zero-match → warn-skip `'zero-match'`.
- Multi-match → first element wins.
- Selector value > 256 chars → warn-skip `'selector-too-long'`.

*DoS guardrails (WDA issue #292 class):*
- **Pathological class-name simulation:** mocked WDA hangs 30s on unknown class; relay must reject an unknown class via allowlist BEFORE the WDA call — timeout never reached.

*Scale factor:*
- Raw 1.5 (out-of-range) → session-wide fail-closed `'scale-out-of-range'`.
- Raw 1.95 → validates + snaps to 2.
- Raw 3.1 → validates + snaps to 3.
- Second call same sessionId → cache hit (mock call count = 1, not 2).

*Landscape gate:*
- WDA returns `orientation: "LANDSCAPE"` → empty resolvedRegions, `'landscape-or-ambiguous'`.
- If A1 Probe 5 picks two-tier: aspect-ratio 1.1 (ambiguous) → warn-skip.

*Cross-tenant + runtime:*
- `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` → empty resolvedRegions, `'kill-switch-engaged'`. Verify kill-switch is read from process startup env, not from per-request payload.
- wda-meta missing → propagated reason from B2.
- Non-loopback WDA attempt (mocked URL override) → refuse `'loopback-required'`.

*WDA error handling:*
- 500ms timeout → warn-skip `'wda-timeout'`; AbortController signal fires.
- HTTP 404 → warn-skip `'wda-error'`.
- **In-flight HTTP shutdown:** dispatch request; call `wda-hierarchy.shutdown()` 50ms in; promise rejects with abort-class error within 100ms.

*Bbox validation:*
- Partially out-of-bounds → `'bbox-out-of-bounds'`.
- Zero-area / < 4×4 → `'bbox-too-small'`.
- Valid → pushed to resolvedRegions.

*Source-dump-specific (only if A1 selects source-dump path):*
- 20 MB cap exceeded → warn-skip all element regions for screenshot, `'source-oversize'`; response never parsed.
- XXE defense: mock `/source` containing `<!DOCTYPE ...>` → behavior depends on chosen XXE strategy (see Open Questions: pre-parse DOCTYPE-regex rejection → `'xml-rejected'`; OR `processEntities: false` parse-succeeds-with-entities-unexpanded → assert no memory amplification, no entity expansion observable in parsed tree).
- Parse-time budget: mock 1.5s parse → abort, `'parse-timeout'`.

*Per-element-specific (only if A1 selects per-element path):*
- Stale-element-reference WDA response → warn-skip `'stale-element-reference'` (this was a fallback trigger in the dual-path design; now surfaces as a distinct tag for telemetry R-11 observation).

*Log scrubbing (cross-cutting):*
- `expectScrubbed` helper (see Patterns to follow) applied across ≥10 scenarios: `logger.stderr.join('\n')` contains NONE of: selector value, selector value length, raw sessionId, WDA port, any bbox coordinate, WDA response body fragment, `flowStartTimestamp`, customer ID.
- Telemetry emission: inspect `log.info` calls; assert `event: 'ios-region-resolution'` + `sessionIdHash` present with 16-hex-char length (per SEC-02); raw sessionId NOT present.
- `id` selector matches single element → returns 1 scaled rect.
- `class` short-form (`Button`) matches → returns rect; verify `XCUIElementType` prefix applied.
- `class` long-form (`XCUIElementTypeButton`) matches → same outcome as short-form.
- `class` unknown (`NotAnXcuiType`) → warn-skip `'class-not-allowlisted'`.
- Zero-match → warn-skip `'zero-match'`, no value in log.
- Multi-match → first-match returned (element order from WDA preserved).
- Landscape input (isPortrait=false) → empty resolvedRegions, warning `'landscape-or-ambiguous'`.
- wda-meta missing → empty resolvedRegions, propagated reason.
- Scale out of [1.9, 3.1] → session-wide fail-closed, warning `'scale-out-of-range'`.
- Scale within range: 1.95 → validates + snaps to 2 → rect scaled × 2.
- Scale at boundary: 3.1 → validates + snaps to 3.
- Selector value > 256 chars → warn-skip `'selector-too-long'`.
- WDA timeout on POST /elements (> 500ms) → warn-skip `'wda-timeout'`.
- WDA returns HTTP 404 → warn-skip `'wda-error'`.
- Non-loopback WDA address attempted → refuse with `'loopback-required'`.
- Bbox partially out-of-bounds → warn-skip `'bbox-out-of-bounds'`.
- Bbox zero-area (1×1) → warn-skip `'bbox-too-small'`.
- Bbox valid → scaled + pushed to resolvedRegions.
- **Source-dump path only:** 20 MB `/source` response → truncated + warn-skip all element regions with `'source-oversize'`.
- **Source-dump path only:** XML with external entity (`<!DOCTYPE ...>`) → parser rejects; warn-skip `'xml-rejected'`.
- **Source-dump path only:** Parse-time budget exceeded (> 1s) → abort, warn-skip `'parse-timeout'`.
- Log scrubbing verification: inspect all logger calls across 5+ scenarios; assert no selector values, ports, coords, WDA bodies appear.

**Verification:** All scenarios pass. Module passes full Jasmine + 100% coverage bar for `@percy/core`.

---

- [ ] **Unit B4: Integrate `wda-hierarchy` into `/percy/maestro-screenshot` relay**

**Goal:** Wire iOS platform branch into the existing relay route. Add PNG-parse + portrait-gate + scale-cache + wda-hierarchy invocation. Keep Android branch unchanged.

**Requirements:** R1, R4, R5 (relay is the single validation source), R6, R7.

**Dependencies:** Units B1, B2, B3.

**Files:**
- Modify: `cli/packages/core/src/api.js` — maestro-screenshot handler (iOS platform branch + kill-switch check + PNG parse + landscape gate + wda-hierarchy invocation).
- Modify: `cli/packages/core/src/percy.js` — call `wdaHierarchy.shutdown()` inline inside `stop(force)` just before `await this.server?.close()` (around line 362). No new coordinator API; direct edit.
- Modify: `cli/packages/core/test/api.test.js` — replace existing iOS stub test at `api.test.js:1106-1126` (asserts pre-V1 warn message); ADD Android happy-path regression test (currently absent per review).
- Replace inline: at `api.test.js:1020-1022`, swap the `'PNGBYTES-IOS'` string fixture for a minimal IHDR-only buffer (24 bytes) constructed inline via `Buffer.concat([PNG_MAGIC_BYTES, ...])`. Preserve the `'PNGBYTES-ANDROID'` string for Android branch regression coverage (Android doesn't parse PNG dimensions).

**Approach:**
- At the top of the maestro-screenshot handler (iOS branch only), after file-glob + file-read, call `parsePngDimensions(fileBuffer)` from B1. If it throws `'invalid-png'` or `'invalid-png-dimensions'` → warn-skip all element regions with `'png-unparseable'`; coord regions + screenshot upload continue.
- Branch on `payload.platform`: `ios` → new iOS resolver pipeline; `android` → existing adb-hierarchy pipeline; absent/other → coord-only (unchanged).
- **iOS pipeline landscape gate (two-tier):**
  1. If a scale-factor cache entry exists for the sessionId AND includes a cached `orientation` field from a prior `GET /wda/screen` call, use it. Else:
  2. Attempt `GET /wda/screen` as part of the same session-first-screenshot warm-up (same call batch as `window/size`). If WDA responds with `orientation: "PORTRAIT"` → proceed; else → warn-skip `'landscape-or-ambiguous'`.
  3. If `GET /wda/screen` fails/404s, fall back to B1's aspect-ratio check with threshold from A1 Probe 6 findings (default 1.25).
- Call `wda-hierarchy.resolveIosRegions({regions, sessionId, pngWidth, pngHeight, isPortrait, deps})`. Scale-factor cache lives inside `wda-hierarchy`.
- **Runtime kill-switch:** honor `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` at the platform-branch entry point (warn-skip all element regions; coord regions unaffected). Also honored inside wda-hierarchy as belt-and-braces.
- **Shutdown wiring:** at module load, register `wdaHierarchy.shutdown` as a cleanup callback on the Percy CLI process-exit coordinator (grep `cli/packages/core/src/percy.js` during implementation for the existing `server.close()` + queue-teardown path; integrate alongside).
- Merge `resolvedRegions` from wda-hierarchy into the payload's regions field using the same `{elementSelector: {boundingBox}, algorithm}` shape the relay already uses for Android.
- Coord-based regions: unchanged path; skip iOS resolver entirely.
- Warnings from wda-hierarchy surface in the Maestro stdout response; one log line per warning, scrubbed per R7.
- **Test harness seam:** export `setWdaHierarchyForTesting(impl)` override (mirrors `createPercyServer` / `percy.testing` pattern at `api.js:66-79`). `api.test.js` uses this to inject a stub `resolveIosRegions` — no need for `createTestServer` at the integration level.
- **iOS PNG fixture for integration tests:** replace the `'PNGBYTES-IOS'` string at `api.test.js:1020-1022` with a real minimal IHDR-only buffer constructed inline (24 bytes). Preserve the Android stub string for regression coverage of the Android branch (Android doesn't parse PNG dimensions).
- **Regression backfill:** `api.test.js:1106-1126` currently asserts the pre-V1 iOS stub message `"Element-based region selectors are not yet supported on iOS"` — this test must be **replaced** (not extended) with the V1 happy-path.

**Execution note:** Test-first for the platform-branch logic; add a missing Android happy-path regression test as well (currently untested per `api.test.js:1012-1160`).

**Patterns to follow:** Existing Android branch in `api.js`. Test harness: `api.test.js:1012-1160` + `setupTest` from `test/helpers/index.js:7-30`.

**Test scenarios:**
- **Android happy-path regression (new — currently untested per `api.test.js:1012-1160`):** stub `adbDump` to return `{kind: 'hierarchy', nodes: [...]}`; assert resolved payload shape matches `elementSelector: {boundingBox: ...}`.
- iOS payload + 1 element region happy path → resolvedRegions populated; payload shape matches Android.
- iOS payload + mix of element + coord regions → element resolved, coord passed through.
- iOS payload + no element regions → `resolveIosRegions` not invoked (short-circuit).
- iOS payload + wda-meta missing → all element regions warn-skipped; coord regions unchanged; upload succeeds.
- iOS payload + WDA returns `orientation: "LANDSCAPE"` → all element regions warn-skipped `'landscape-or-ambiguous'`.
- iOS payload + `GET /wda/screen` 404 + portrait aspect ratio → iOS resolver runs (aspect-ratio fallback).
- iOS payload + `GET /wda/screen` 404 + aspect ratio 1.1 (ambiguous) → all element regions warn-skipped.
- iOS payload + `'PNGBYTES-IOS'` stub → `parsePngDimensions` throws → warn-skip all element regions `'png-unparseable'`; coord regions + screenshot continue.
- `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` set → element regions warn-skipped `'kill-switch-engaged'`; coord regions + screenshot continue.
- **Shutdown integration:** dispatch iOS request with pending WDA calls; trigger `percy.stop()`; assert all in-flight AbortControllers fire within 100ms, no orphaned sockets, no dangling promises.
- Android payload (unchanged regression test) → existing adb-hierarchy path still works.
- Payload with no platform field → treat as Android (existing fallback behavior).

**Verification:** All scenarios pass. End-to-end manual smoke on BS iOS host: payload outbound to Percy API includes element-region bboxes. **100% line + branch coverage on modified `api.js` lines under NYC.** Existing iOS stub test at `api.test.js:1106-1126` replaced with V1 scenarios.

---

- [ ] **Unit B5: SDK — remove pre-relay warn-skip gate + clientInfo bump**

**Goal:** Let iOS element regions flow from SDK through to relay. Bump SDK clientInfo to `percy-maestro/1.0.0`.

**Requirements:** R5.

**Dependencies:** Unit B4 (relay handles iOS element regions correctly).

**Files:**
- Modify: `percy-maestro/percy/scripts/percy-screenshot.js` — remove element-region warn-skip block. Bump `payload.clientInfo` string.
- Modify: `percy-maestro/percy/scripts/percy-healthcheck.js` — bump version string if referenced there.

**Approach:**
- Locate the `if (region.element) { console.log("[percy] Warning: element-based regions are not yet supported, skipping..."); }` block around line 67. Delete the guard. Let element regions pass through to the relay payload.
- Bump `clientInfo: 'percy-maestro/0.4.0'` → `'percy-maestro/1.0.0'`.
- Confirm coord-based region handling is unchanged (no regression for v0.4.0 customers).

**Execution note:** Small mechanical change; no test-first requirement (no logic added, only gate removed).

**Test scenarios:** Manual smoke test on BS iOS host — send a PERCY_REGIONS with an element selector; verify relay receives the element shape (not warn-skipped).

**Verification:** Manual smoke test succeeds. No regressions in coord-region behavior.

---

### Phase 2 — Documentation + Engineering Debug Tool

- [ ] **Unit C1: README + CHANGELOG + version bumps**

**Goal:** R8 — user-facing docs for iOS V1 element regions. CHANGELOG entries. Version bumps to `1.0.0` for percy-maestro and coordinated bump for @percy/core (release version TBD by CLI maintainers).

**Requirements:** R8.

**Dependencies:** Unit B5 (feature complete end-to-end).

**Files:**
- Modify: `percy-maestro/README.md` — new "iOS element regions" section covering:
  - Selector table (`id`, `class`) with key → WDA-resolver-mapping column.
  - Copy-pasteable iOS Maestro flow example using `element: {id: "my-btn"}`.
  - **Common mistakes subsection** (wrong → right examples for both selector keys; e.g., `class: "my-button"` → wrong, `class: "Button"` → right).
  - **Troubleshooting table** keyed on scrubbed reason tags (`zero-match`, `class-not-allowlisted`, `wda-timeout`, `bbox-out-of-bounds`, etc.) with investigation steps — customer-readable, not ops-runbook style.
  - **Accessibility-identifier how-to** (2–3 sentences pointing at Apple's Swift/Obj-C docs for setting `accessibilityIdentifier`).
  - **Percy API compatibility table** if Percy backend cannot commit to an acknowledgment field (CLI ≥ X requires Percy API ≥ Y; depends on the pre-planning-exit resolution).
  - DLP disclaimer (R7).
  - V1.1 roadmap note (`text`, `xpath`).
  - Local-dev-loop gap note.
  - Realmobile dependency note (abbreviated).
- Modify: `percy-maestro/CHANGELOG.md` — `[1.0.0] — 2026-MM-DD` entry with Added / Changed / Security / **Upgrade Notes** subsections. RC entries carry `[Experimental]` marker.
- Modify: `percy-maestro/percy/scripts/percy-healthcheck.js` + `percy-screenshot.js` — final `percy-maestro/1.0.0` version strings (B5 bumps clientInfo; C1 cross-checks consistency across files).
- Modify: `cli/packages/core/CHANGELOG.md` — add `@percy/core` iOS element-regions entry (version TBD by CLI release team).
- Modify: `cli/packages/core/package.json` — version bump per CLI team convention.

**Approach:** No implementation logic. Documentation + versioning.

**Execution note:** None.

**Test scenarios:** N/A.

**Verification:** README renders correctly; example yaml parses on Maestro 1.39+; CHANGELOG entries are customer-readable.

---

- [ ] **Unit C2: Engineering debug log line (PERCY_MAESTRO_DEBUG_REGIONS) — minimal scope**

**Goal:** When `PERCY_MAESTRO_DEBUG_REGIONS=1` is set in the Percy CLI process startup env, the relay emits one additional structured log line per iOS screenshot summarizing resolved regions. Engineering-internal verification during the v1.0 GA wait; removable post-GA if unused.

**Rationale for the cut-down approach:** Original C2 spec was a full security-hardened filesystem side-channel (new module, atomic temp+rename, 0600/0700 modes, TOCTOU defense on the debug path, 100% coverage). Review flagged (a) engineers already have `admin-token` access to the Percy comparisons API to inspect resolved bbox coords, (b) customers on shared BS iOS hosts cannot retrieve `/tmp`-written files cross-tenant-safely, (c) the debug path itself introduces a second hardened-filesystem attack surface next to wda-meta.json. A one-line log delivers the same engineering value at ~3 LOC with no new module, no new security surface, no coverage burden.

**Requirements:** Optional engineering convenience; not a V1 must-have.

**Dependencies:** Unit B4 complete.

**Files:**
- Modify: `cli/packages/core/src/api.js` — one `if (process.env.PERCY_MAESTRO_DEBUG_REGIONS === '1') percy.log.debug({event: 'ios-region-resolution-debug', regions: [...scrubbed list]})` after `resolveIosRegions` returns.

**Approach:**
- Env flag read from **process startup env only** (same rule as kill-switch; never tenant-forwarded via `appPercy.env`).
- Emitted line uses the same scrubbing rules as R7 telemetry (`TELEMETRY_SAFE_FIELDS`): region `selector_key`, `outcome`, bbox `width`/`height` dimensions only (not x/y coords — coords may leak screen geometry). No selector values, no sessionId, no port.
- No new module, no file writes.

**Execution note:** Tiny, optional. If the kill-switch env-var read shape (host-level only, not appPercy-forwarded) needs a helper, share it with B4 rather than duplicate.

**Test scenarios:**
- Env flag unset → no debug log emitted; main upload path unchanged.
- Env flag set + 1 resolved region → one `log.debug` call with event `'ios-region-resolution-debug'`, no selector value present.
- Scrub-assertion on the debug log line.

**Verification:** Unit tests pass. **100% coverage** — trivial to hit for a 3-line addition.

---

**Note — RC / GA rollout operational work:** Adopter recruitment, communication channel creation, and pre-GA tenant outreach are coordination activities owned by Product + DevRel, **not an engineering implementation unit.** They are tracked in a separate GA-readiness doc (see Documentation / Operational Notes → "RC rollout"). This plan owns only the engineering artifacts that make them possible: the `@percy/cli@next` tag flow (mechanics) and the percy-maestro versioning story (see below).

**percy-maestro distribution model:** percy-maestro is NOT published to npm today (no `package.json`; customers copy the `percy/` directory into their Maestro workspace per README). This has implications the plan must address:

- **`@percy/cli` RC**: standard npm `@next` dist-tag flow applies (Percy CLI maintainers own the release script that enforces `@next` for RC tags).
- **percy-maestro RC**: not an npm operation. RC is a **git tag** (`v1.0.0-rc.N`) on the percy-maestro repo + a GitHub release; adopters clone/copy that tag's `percy/` directory. README temporarily documents the RC tag under an "Early Access" section.
- **percy-maestro GA**: git tag `v1.0.0` + GitHub release. README "Early Access" section removed; `percy/scripts/percy-screenshot.js`'s `clientInfo` string becomes `percy-maestro/1.0.0` (this is the only version identity customers observe at runtime).
- **Rollback for percy-maestro**: git-revert or point customers at a prior tag; `npm deprecate` / `dist-tag` operations are **not applicable** (see Rollback Plan).

---

### Phase 3 — GA Gate (External Dependency)

- [ ] **Unit D1: v1.0 GA release gate — Percy↔BS baseline-linkage verification**

**Goal:** Confirm end-to-end: Percy dashboard shows `applied-regions` populated on iOS Maestro BS builds. Gating milestone for v1.0 GA.

**Requirements:** End-to-end dashboard-visible success criterion.

**Dependencies:** External — Percy backend team fix for `branchline_first_build_empty` handling on BS-orchestrated builds.

**Files:** None (external dependency).

**Approach:**
- Percy CLI + percy-maestro releases from Phase 1-2 ship as `@percy/cli@next` + `percy-maestro@1.0.0-rc.N` when Phase 1 exit gate passes (CI coverage + A2 + A1 findings positive).
- GA promotion requires the full multi-condition checklist below.

**RC → GA promotion gate (4 ship-critical conditions; all must be true before `@latest` flip):**

| Condition | Owner | Evidence |
|---|---|---|
| End-to-end dashboard verified: Percy dashboard shows populated `applied-regions` on ≥1 real iOS Maestro BS build (admin-token API also confirms) | Percy CLI release captain + Percy backend EM | Screenshot + admin-token comparison-object inspection |
| 14-day RC soak on `@next` with **zero** customer-reported Sev-1/Sev-2 | percy-maestro maintainer | Incident tracker |
| A2 security acceptance suite re-run against **production** (not staging) BS iOS hosts — all 8 scenarios green | Percy security reviewer | Acceptance harness output |
| Percy API version-signaling decision resolved (acknowledgment field shipped in Percy API, OR relay version-gate live, OR README compatibility table published per Open Decisions default) | Percy backend EM + Percy CLI maintainer | One of the three above observable |

**Post-ship verification within 30 days (not ship gates — confidence builders):**
- ≥3 distinct adopter tenants at steady-state; telemetry within SLO bands per Monitoring table; ≥2 consecutive weekly contract-canary runs green.

**Execution note:** Non-code gate. If any condition fails, GA blocks; RC soak clock resets depending on which condition failed (see Rollback Plan).

**Test scenarios:** N/A.

**Verification:** All 9 promotion-gate rows green, signed off in writing by named owners.

---

## System-Wide Impact

- **Interaction graph:**
  - `@percy/core` relay route `/percy/maestro-screenshot` gains iOS branch; Android branch unchanged.
  - `PNG_MAGIC_BYTES` constant moves from `api.js:190` to new `png-dimensions.js`; `/percy/comparison/upload` route gains an import (no behavior change).
  - `@percy/client/utils#request` gets a new consumer (wda-hierarchy HTTP calls).
  - Percy CLI process-exit coordinator gains a new cleanup callback (`wda-hierarchy.shutdown`).
  - realmobile: new hard dependency on `/tmp/<sid>/wda-meta.json` write contract (schema_version 1). Does not affect Android Maestro path.
  - BrowserStack App Automate appPercy bridge: unchanged. v0.4.0 iOS integration already ships env-var forwarding.

- **Error propagation:**
  - iOS element-resolution failures (wda-meta missing, landscape, scale-out-of-range, zero-match, bbox-invalid, schema-version-unsupported, kill-switch-engaged, loopback-required, multi-link) warn-skip the region; screenshot upload + coord regions unaffected.
  - PNG-unparseable: warn-skip all element regions; screenshot still uploads.
  - WDA network errors (connection refused, timeout, 5xx): warn-skip with scrubbed log; upload succeeds.
  - Source-dump oversize / XXE / parse-timeout: warn-skip all element regions for the screenshot; upload succeeds.

- **State lifecycle risks:**
  - **Scale-factor cache:** bounded LRU (cap 64, 30-min idle TTL) keyed by sessionId. Eviction hooked to `percy.stop()`. Map resets on process restart (handles R-4 WDA-stale-session scenario).
  - **wda-hierarchy in-flight HTTP on CLI shutdown:** AbortController per-request wired to the process-exit coordinator. Without this, `http.request`-based calls have no kill-equivalent to adb's `SIGKILL` (the `server.close()` pattern at `cli/packages/core/src/server.js:148-153` aborts inbound sockets only, not outbound). `wda-hierarchy.shutdown()` cancels all live controllers; B4 registers it alongside `server.close()` in the stop sequence.
  - **`/tmp/<sid>/wda-meta.json` stale file across session boundaries:** mitigated by realmobile session-end cleanup (A2 contract) + 5-min freshness tolerance in B2.
  - **Debug JSON side-channel artifacts** (`/tmp/<sid>/debug/*.json` — C2): created under 0700 parent dir / 0600 file mode; cleaned by realmobile's session-end cleanup alongside wda-meta.

- **API surface parity:**
  - Android `adb-hierarchy` integration in relay is unchanged. iOS path is parallel.
  - `POST /percy/maestro-screenshot` request shape unchanged. Response shape may add new warning tags (iOS-specific reasons); non-breaking.
  - **Percy API ↔ Percy CLI version signaling (unresolved):** No field today tells the relay whether Percy API has the `applied-regions` fix. Either Percy backend adds an acknowledgment field to the `POST /comparisons` response, OR the README publishes a compatibility table (CLI ≥ X requires Percy API ≥ Y). Surfaced as a pre-planning-exit blocker — coordinate with Percy backend EM before Phase 1.

- **Telemetry emission:**
  - `log.info({event: 'ios-region-resolution', outcome: <reason-tag>, durationMs, sessionIdHash, platform: 'ios', cli_version: <v>})` — one emission per region. Emitted via `percy.log.info` (matches existing `@percy/core` convention). **Forbidden fields:** selector value, selector value length, raw sessionId, WDA port, bbox coords, WDA response bodies, customer ID.
  - No structured-metric channel exists in `@percy/core` today; `sendBuildEvents` (`cli/packages/core/src/utils.js:274`) is event/crash-oriented with a closed schema. V1 uses grep-based structured-log telemetry; V1.1 tracks schema-extension of `sendBuildEvents` as a backend-coordination follow-up.

- **Integration coverage:** B4 integration tests hit the iOS platform branch with real minimal-IHDR PNG fixtures + mocked `resolveIosRegions` via `setWdaHierarchyForTesting`. A2 security acceptance tests on staging BS iOS host cover the realmobile ↔ relay contract end-to-end (8 scenarios). Missing Android happy-path regression test backfilled in B4.

## Risks & Dependencies

### Risks

- **R-1 (Medium-leaning-High): `id` + `class` undercuts customer value if iOS apps lack accessibility identifiers.** Product reviewer flagged: Maestro iOS flows often use visible-label (`tapOn: "Sign in"`) because IDs are missing. **Mitigation:** (a) Monitor zero-match rate in telemetry post-GA; warn at 20% per-customer-per-day, page at 50% sustained 3 days. (b) README has an expanded "iOS element regions" section (Unit C1) with common-mistakes subsection, troubleshooting table keyed on reason tags, and a 2-3 sentence pointer to setting `accessibilityIdentifier` in Swift/Obj-C. (c) On first zero-match per session, emit a one-time stdout hint referencing the README troubleshooting table (not repeat-per-screenshot spam, no selector content in the hint). (d) If zero-match > 30% per-customer-per-7-days rolling, escalate `text` selector to V1.1-urgent.

- **R-2 (Medium): v1.0 GA gated on Percy backend fix with no timeline.** If backend slips 6 months, no iOS shipping surface. **Mitigation:** (a) RC channel (`@percy/cli@next`, `percy-maestro@1.0.0-rc.N`) + C3 adopter playbook lets explicit early adopters use the feature payload-side. (b) Runtime kill-switch `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` gives incident response a non-code-deploy remediation path. (c) If backend slips beyond an agreed window (plan owner escalates to Product), consider a v1.0-beta with documented known-issue language.

- **R-3 (High): realmobile cooperation is a hard dependency with no fallback.** If realmobile can't commit, implementation cannot begin. **Mitigation:** (a) Unit A2 is a gate before B1-B5. (b) **B2 design fails-closed gracefully on any realmobile bug post-commit** — wrong uid, stale timestamp, malformed JSON, schema-version-unsupported, multi-link — all produce scrubbed warn-skip with distinct reason tags; coord regions + screenshots continue. (c) **Contract canary probe:** Percy CLI startup performs a one-time wda-meta.json readability + schema probe; if it fails, log `'realmobile-contract-broken'` tag (pages `#percy-cli-oncall` + `#realmobile-oncall`). (d) Post-commit-change protocol (see Dependencies) requires 2-week heads-up + joint regression on staging for breaking schema changes. (e) If realmobile can't deliver V1 contract, re-scope in a follow-up brainstorm.

- **R-4 (Low): Stale WDA session after Percy CLI restart.** **Mitigation:** A2 contract specifies realmobile rewrites wda-meta.json on Percy CLI restart detection (if hook available); B2's 5-minute freshness tolerance absorbs common restarts.

- **R-5 (Medium — upgraded from Low): WebView-heavy iOS apps exceed source-dump 20 MB cap.** If A1 picks source-dump AND a customer's WebView-heavy app's UI tree exceeds 20 MB (Appium docs warn this is real: WebView DOMs render recursively as XCUIElementTypeOther trees; > 10 MB observed on commerce product pages), element regions warn-skip. **Mitigation:** (a) A1 Probe 2 measures p50/p95 `/source` response sizes on a representative WebView-heavy test app; if p95 > 15 MB, flag to re-evaluate source-dump before selecting it. (b) 20 MB conservative vs 5 MB (Android reference). (c) Post-GA: make cap configurable via `PERCY_MAESTRO_SOURCE_DUMP_MAX_MB` if observed.

- **R-6 (Medium — upgraded from Low): V1 XCUI class allowlist drift.** Apple adds XCUIElementType constants ~1–2 per major iOS release. Customers using newly-added types get `'class-not-allowlisted'` warn-skip until a release catches up. **Mitigation:** (a) `PERCY_MAESTRO_XCUI_ALLOWLIST_EXTRA` env override gives customers a release-independent escape hatch. (b) Inline allowlist comment points at Apple's XCUIElement.h header with an annual-drift-check note. (c) Post-V1 follow-up: `scripts/regenerate-xcui-allowlist.js` to generate the list from Apple docs, committed for reproducibility.

- **R-7 (High): TOCTOU / symlink / hard-link attacks on shared `/tmp`.** `/tmp` on macOS/iOS is shared across tenants and doesn't consistently enforce `fs.protected_hardlinks` (unlike Linux). **Mitigation:** B2 uses `open(O_NOFOLLOW) + fstat` (no `lstat` prefix) per SEI CERT POS35-C; `st_nlink === 1` check closes hardlink vector (Apple Secure Coding Guide). A2 acceptance tests #4 (symlink), #6 (hard-link), #7 (TOCTOU stress, 1000 iterations) verify. Cited precedent: CVE-2005-2519 (Apple Directory Server temp-file substitution).

- **R-8 (Medium): Percy CLI graceful-shutdown regression from HTTP in-flight.** Node `http.request` has no kill-equivalent to `SIGKILL`; a dangling WDA call can block `percy.stop()`. **Mitigation:** AbortController per WDA request + `wda-hierarchy.shutdown()` wired to Percy CLI process-exit coordinator. Test scenario in B3 covers in-flight-abort.

- **R-9 (High): Post-RC security finding with no rollback path.** Without a kill-switch, a CVE or regression in wda-hierarchy post-RC/post-GA forces a full minor release cycle for remediation. **Mitigation:** (a) Runtime kill-switch `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` lives in B4, not post-GA. (b) RC CHANGELOG carries `[Experimental]` marker. (c) `@percy/cli@next` is explicit opt-in; release script enforces no `@latest` flip for RC tags.

- **R-10 (Medium): CI 100% NYC coverage gate may block new modules.** `@percy/core` enforces 100% line + branch coverage. New modules (wda-hierarchy, wda-session-resolver, png-dimensions, debug-regions) + modified `api.js` lines must meet it. Defensive fail-closed branches (e.g., `flowStartTimestamp < startup - 5min`) are depedency-of-injection-pattern-hard to hit naturally. **Mitigation:** (a) Phase-0 coverage preflight: Unit B1 ships first + pushed to feature branch; CI green before B2/B3 begin. (b) DI-complete design: no direct `require('fs')` calls in production code where a test-seam is needed. (c) `/* istanbul ignore next */` allowed only for platform-impossible branches (non-POSIX fstat shapes); never for fail-closed security branches. (d) C2 coverage difficulty is an explicit defer-trigger per the unit's time-boxed framing.

- **R-11 (High): P1-2 experiment invalidates both resolution paths.** If per-element AND source-dump both fail concurrent-safety on BS iOS hosts, V1 cannot ship. **Mitigation:** (a) Dual product+eng-lead sign-off on re-scope decision. (b) Predefined V1-lite: no-op SDK change (keep warn-skip) + documentation-only entry; version becomes v0.5.0 (not v1.0 marquee). (c) Escalation path written before A1 runs.

- **R-12 (High): realmobile contract drift post-sign-off.** realmobile ships on independent cadence; silent schema changes break relay fail-closed logic as "transient flake." **Mitigation:** (a) `schema_version` field in wda-meta.json; relay rejects major !== 1. (b) Named coordination channel for deprecation announcements (2-week heads-up for breaking changes). (c) Weekly contract-conformance canary (Unit A2 acceptance harness re-run) against staging BS iOS hosts post-GA. (d) GA gate requires 2 consecutive green canary weeks.

### Dependencies

- **realmobile team:** wda-meta.json write contract (Unit A2) with `schema_version: "1.0.0"` + post-commit-change protocol (2-week heads-up, named coordination channel confirmed at A2 signing). Hard dep; blocks Phase 1. Weekly contract-conformance canary post-GA.
- **Percy backend team:** `branchline_first_build_empty` fix for BS builds; ideally also `applied-regions`-acknowledgment field on `POST /comparisons` response (resolves the version-signaling blocker). Hard dep for v1.0 GA (not for RC).
- **BrowserStack App Automate:** appPercy bridge forwarding (already shipping; v0.4.0 dep).
- **No new npm dependencies** for `@percy/core`: PNG IHDR hand-parsed; `fast-xml-parser` already imported for Android source-dump (reuse config); `@percy/client/utils#request` is the house HTTP client (no `fetch`/`axios`/`got`/`node-fetch`); `pako` is gzip-only (**not** PNG-composite-capable — see C2).

## Documentation / Operational Notes

### Documentation
- **README (Unit C1):** iOS element regions section; selector table (`id`, `class`) with key→WDA-resolver mapping; copy-paste iOS example; DLP disclaimer (R7); V1.1 roadmap (`text`, `xpath`); local-dev-loop gap; **common-mistakes subsection** (wrong → right examples for `id` and `class`); **troubleshooting table** keyed on scrubbed reason tags; **accessibility-identifier how-to** (2–3 sentence pointer to Apple Swift/Obj-C docs); **Percy API compatibility table** (CLI ≥ X requires Percy API ≥ Y) if Percy backend cannot add acknowledgment field.
- **Version-support policy for percy-maestro 0.x after 1.0 ships** is a cross-product decision owned by Percy SDK product + support leadership (not this plan). If a README statement is required at GA, link to the canonical SDK support policy rather than inlining a specific commitment here.
- **CHANGELOG:** `[1.0.0]` entry with Added / Changed / Security / **Upgrade Notes** sub-sections; RC entries carry `[Experimental]` marker. Upgrade Notes: breaking changes (none for coord-region customers), upgrade command, rollback command.
- **Contract doc:** `percy-maestro/docs/contracts/realmobile-wda-meta.md` (Unit A2) — full schema, write semantics, post-commit-change protocol, named coordination channel, signed-off parties, CVE-2005-2519 citation. Cross-referenced from realmobile repo.
- **RC adopter playbook:** `percy-maestro/docs/release/1.0.0-rc-adopter-playbook.md` (Unit C3).

### Rollout
- **`@percy/cli` RC**: pre-release `@next` npm tag; release script enforces no accidental `@latest` flip for RC tags.
- **`percy-maestro` RC**: git tag `v1.0.0-rc.N` + GitHub release; README temporary "Early Access" section documents the RC tag. Not an npm operation.
- v1.0 GA ships to `@latest` (`@percy/cli`) + `v1.0.0` git tag (percy-maestro) only after full Unit D1 multi-condition promotion checklist passes.
- After GA, `@percy/cli@next` continues to point at latest stable for 30 days (prevents auto-jump for pinned adopters).

### RC rollout (GA-readiness doc cross-reference)
Coordination work (adopter recruitment, outreach, Slack channel, 72-hour pre-GA notice) is owned by Product + DevRel and tracked in a separate **GA-readiness doc** — NOT inside this engineering plan. The plan owns only the engineering artifacts that make the rollout mechanically possible (RC tags, `@next` dist-tag enforcement, temporary README section). When the GA-readiness doc exists, link it here.

### Monitoring post-GA

Emission: structured log via `percy.log.info` (Option A — V1; see Key Decisions). Target observability surface: Honeycomb (matches `@percy/core` convention) + Datadog alert wiring.

| Metric | Warn | Page | Alert surface |
|---|---|---|---|
| `wda_meta_fail_closed_rate` (aggregate) | > 2% / 1h (tightened from 5%/15min to cut daily-drift window per SEC-06) | > 5% / 15min | `#percy-cli-oncall` |
| `wda_meta_reason:*` (security tags: `symlink`, `wrong-owner`, `wrong-mode`, `multi-link`) | any non-zero | > 3 events/h | **`#percy-security` (pages)** |
| `scale_out_of_range_rate` | > 0.5% / 1h | > 2% / 1h | `#percy-cli-oncall` |
| `wda_timeout_rate` | > 2% / 1h | > 10% / 1h | `#percy-cli-oncall` |
| `realmobile_contract_broken` (canary tag) | any non-zero | any non-zero | **Pages `#percy-cli-oncall` + `#realmobile-oncall`** |
| `source_dump_oversize_rate` (if source-dump path shipped) | > 5% / 1d | > 20% / 1d | `#percy-cli-oncall` |

**Weekly health report (not SLO-paged — customer-behavior signals):**
- `zero_match_rate` per-tenant rolling 7-day. Threshold for V1.1-urgent escalation: **tentative 30%**; basis is "roughly 2× Android's observed zero-match baseline" — confirm Android baseline before GA; adjust if needed. Product + Percy CLI maintainer jointly review after 30 days of post-GA data and re-set the threshold based on observed 75th-percentile.
- `landscape_warn_skip_rate` — customer behavior, no SLO; anomaly detection only.
- `png_unparseable_rate` — malformed input rate; < 0.1% expected, investigate if rising.

- Metric tags scrubbed per R7: reason tag, `sha256(sessionId).slice(0,8)`, platform, cli_version, duration_ms. **Forbidden:** selector value, selector length, raw sessionId, WDA port, bbox coords, WDA bodies, customer ID.
- Owner for metric instrumentation: B3/B4 implementer. Owner for alert setup: Percy CLI release captain before Unit D1 GA gate.
- Weekly contract canary run (A2 acceptance harness) post-GA; any failure pages `#realmobile-oncall`.

### Support runbook
- Scrubbed log reason tags (`zero-match`, `class-not-allowlisted`, `wda-timeout`, `wda-meta.{missing, symlink, wrong-mode, wrong-owner, multi-link, not-regular-file, malformed-json, schema-version-unsupported, out-of-range-port, stale-timestamp}`, `scale-out-of-range`, `landscape-or-ambiguous`, `bbox-out-of-bounds`, `bbox-too-small`, `png-unparseable`, `loopback-required`, `kill-switch-engaged`, `source-oversize`, `xml-rejected`, `parse-timeout`) are the primary customer-facing debugging signal — document each in the support runbook with investigation steps.

## Rollback Plan

Distribution asymmetry: `@percy/cli` is published to npm (dist-tag operations valid); `percy-maestro` is copy-the-directory (git-tag operations only; no `npm deprecate` / `npm dist-tag` for percy-maestro).

**Scenario A — CVE / regression found during RC (pre-GA):**
1. `@percy/cli`: `npm deprecate @percy/cli@<rc-version> "…"`; publish fixed `@percy/cli@next+1` OR dist-tag-downgrade `@next` to prior RC.
2. `percy-maestro`: update README "Early Access" section to point away from the bad tag; optionally delete the GitHub release. Publish fixed `v1.0.0-rc.N+1` git tag.
3. Notify RC adopter channel (per GA-readiness doc).
4. RC soak clock resets to day 0.

**Scenario B — CVE / regression found post-GA (after `@latest` flip):**
1. **Immediate feature-disable** via host-level runtime kill-switch: Percy CLI maintainers (or realmobile on-call) set `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` in the Percy CLI process's startup env on BS iOS hosts (host-level config, not tenant-forwarded — see Key Decisions). Relay warn-skips all element regions; coord regions + screenshots unaffected. **This is the only non-code-deploy remediation path.** The kill-switch must be a host-level config to prevent tenant-tampering (see SEC-01 in Risks).
2. `@percy/cli`: publish `@percy/cli@1.0.1` with fix on `@latest`; OR if fix > 24h out, dist-tag-downgrade `@latest` back to the previous stable version (coord-only fallback).
3. `percy-maestro`: publish `v1.0.1` git tag + GitHub release; update README to point at `v1.0.1`; point adopter channel at the rollback.
4. Security advisory on GitHub Security Advisories for affected repo(s) if CVE-class.

**Scenario C — realmobile implementation ships buggy post-commit:** Addressed by R-12's mitigations (see Risks). Summary: B2 fail-closes on any validation failure → buggy realmobile write produces scrubbed warn-skip; coord regions + screenshots continue. `realmobile_contract_broken` canary metric (and `wda_meta_reason:*` rate alerts) page oncall within minutes of the daily monitoring window. No Percy-side code rollback needed while realmobile ships a fix.

## Alternative Approaches Considered

- **Extend `adb-hierarchy.js` to support iOS via internal platform dispatch.** Rejected: adb uses `child_process`, WDA uses HTTP; shared-file abstraction is premature and obscures test boundaries. Parallel `wda-hierarchy.js` is cleaner.
- **Use `pngjs` or `image-size` npm dep for PNG parsing.** Rejected: 24-byte hand-parse is 10 lines of code; new dep requires review/audit of @percy/core package. Hand-parse wins.
- **SDK-driven session discovery** (SDK POSTs `sessionId + WDA port` to a relay init endpoint). Rejected in brainstorm (R6 cross-tenant safety requires attested source, not tenant-influenceable env/config).
- **Hardcoded device catalog for scale factor** (percy-xcui-swift pattern). Rejected: maintenance cost per new iPhone; width-ratio is zero-maintenance.
- **Ship text + xpath in V1.** Rejected at brainstorm time: security review load + injection/DoS surface too large for V1 safe-minimum principle. Product reviewer flagged this may undercut value (R-1); accepted tradeoff with telemetry-monitored exit criteria.
- **Beta channel (`PERCY_ELEMENT_REGIONS_BETA=1` opt-in) during Percy backend wait.** Rejected at brainstorm time: v1.0 GA gates on backend fix, no explicit beta. Product reviewer flagged timeline risk (R-2); RC channel (`@percy/cli@next`) is the V1 compromise.

## Phased Delivery

### Phase 0 — Gates (must pass before Phase 1)

- Unit A0: Three ~30min spikes (AbortController pass-through; memfs mode bits; kill-switch host-level vs appPercy.env).
- Unit A1: P1-2 WDA experiment (6 probes if two-tier landscape kept, 5 if WDA-query-only suffices) + findings writeup.
- Unit A2: realmobile contract signed off + 8 security acceptance tests green on staging BS iOS host.
- Coordination (parallel to A0/A1/A2, not Phase-1 blocking): Percy backend EM discusses API version-signaling preference. Absent an explicit answer, V1 ships the README-compatibility-table default (per Open Decisions).

### Phase 1 — Core Implementation

- Unit B1: PNG IHDR parser (also the Phase-1 CI coverage preflight gate).
- Unit B2: wda-session-resolver.
- Unit B3: wda-hierarchy resolver (dual-path; A1 picks default).
- Unit B4: Relay integration (+ kill-switch + shutdown wiring + Android regression backfill).
- Unit B5: SDK gate removal + clientInfo bump.

**Phase 1 exit gate: CI coverage.** All new modules + modified `api.js` lines hit 100% line + branch coverage under `@percy/core` NYC. CI green on `cli` main branch before Phase 2 begins. Owner: Unit implementer; verified by Percy CLI release captain.

### Phase 2 — Ship

- Unit C1: README + CHANGELOG + version bumps.
- Unit C2: Debug log line behind env flag (cut-down to a 3-line addition).
- RC releases: `@percy/cli@next` (npm dist-tag) + `percy-maestro v1.0.0-rc.N` git tag + GitHub release.
- RC rollout coordination (adopter recruitment, outreach, Slack) tracked in a separate GA-readiness doc owned by Product + DevRel.

### Phase 3 — v1.0 GA Gate

- Unit D1: 9-condition promotion checklist (see D1 unit for the full table); ship to `@latest` only when all green.
- `@next` tag continues pointing at latest stable for 30 days post-GA.

## Success Metrics

- All B1-B5 unit tests pass; `@percy/core` 100% line + branch coverage maintained (Phase 1 CI exit gate).
- A2 security acceptance tests (8 scenarios) green on staging BS iOS host + re-run on production BS iOS host as part of GA checklist.
- A1 experiment writeup classifies one of four outcomes: per-element OK / source-dump OK / both OK / both fail (R-11 escalation).
- Manual smoke on BS iOS Maestro build: element regions resolved end-to-end; payload to Percy API includes resolved rects (admin-token verified).
- RC soak: 14 days / ≥3 tenants / ≥100 screenshots per tenant with zero Sev-1/Sev-2.
- v1.0 GA (post-D1 checklist): Percy dashboard shows `applied-regions` populated; weekly contract canary green 2 consecutive weeks.
- Post-GA telemetry (Monitoring table) within SLO bands for 30 days; zero-match per-tenant < 30% rolling 7-day (else R-1 escalation to V1.1-urgent).

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md](../brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md)
- **Prior plan (v0.4.0 iOS realignment):** [docs/plans/2026-04-21-001-feat-ios-xcui-realignment-plan.md](2026-04-21-001-feat-ios-xcui-realignment-plan.md)
- **Android reference implementation:** `cli/packages/core/src/adb-hierarchy.js` (DI shape, dual-path-with-fallback, 5MB dump cap, fast-xml-parser config)
- **Existing PNG magic-bytes constant:** `cli/packages/core/src/api.js:190` (`PNG_MAGIC_BYTES`) — extracted by B1
- **House HTTP client:** `cli/packages/client/src/utils.js:128, 142` (`@percy/client/utils#request`)
- **Existing element-regions integration test block:** `cli/packages/core/test/api.test.js:1012-1160` (iOS stub at 1106-1126 replaced by B4)
- **iOS Appium reference:** `percy-appium-python/percy/metadata/ios_metadata.py` (width-over-window-size pattern)
- **W3C WebDriver Classic spec:** `GET /session/:sid/window/size` (logical CSS pixels)
- **PNG IHDR format:** libpng spec §11.2.2
- **WDA class-name DoS precedent:** [WebDriverAgent issue #292](https://github.com/facebookarchive/WebDriverAgent/issues/292) — unknown class name caused full accessibility-tree walk; grounds the XCUI allowlist decision
- **Apple Secure Coding Guide (CVE-2005-2519):** [Race Conditions and Secure File Operations](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html) — grounds the `/tmp` trust model depth
- **SEI CERT POS35-C:** [Avoid race conditions while checking for the existence of a symbolic link](https://wiki.sei.cmu.edu/confluence/display/c/POS35-C.+Avoid+race+conditions+while+checking+for+the+existence+of+a+symbolic+link) — grounds the `open(O_NOFOLLOW) + fstat` ordering (drop `lstat` prefix)
- **LWN — Fixing the symlink race problem:** https://lwn.net/Articles/472071/
- **Apple XCUIScreenshot docs:** [XCUIScreenshot](https://developer.apple.com/documentation/xctest/xcuiscreenshot) — confirms keyboard does not crop iOS screenshot aspect ratio
- **iOS resolution catalog:** https://www.ios-resolution.com/ — iPad portrait 1.33 aspect; grounds threshold 1.25 (not 1.2)
- **Previous v0.4.0 commit:** `85d07d2` (appPercy realignment)
