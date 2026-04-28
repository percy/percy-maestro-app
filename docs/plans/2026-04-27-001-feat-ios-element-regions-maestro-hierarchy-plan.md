---
title: "iOS element regions via `maestro hierarchy` — cross-platform parity"
type: feat
status: active
date: 2026-04-27
deepened: 2026-04-27
origin: docs/brainstorms/2026-04-27-ios-element-regions-maestro-hierarchy-requirements.md
spike: docs/experiments/2026-04-27-maestro-hierarchy-spike/findings.md
---

# iOS element regions via `maestro hierarchy` — cross-platform parity

## Overview

Replace the iOS-specific WDA-direct element-region resolver in `@percy/cli` with a single cross-platform `maestro hierarchy` resolver shared with Android. Customers get one mental model: the same `PERCY_REGIONS` yaml shape, the same warn-skip behaviour, the same docs structure on both platforms. Realmobile coordination collapses from a security-tested file contract to two env vars.

The Phase 0 spike (2026-04-27) proved Plan B is architecturally sound (maestro CLI is on iOS BS hosts, `driver_host_port = wda_port + 2700` is deterministic in `realmobile/maestro_session.rb:831`, the iOS `dev.mobile.maestro-driver-iosUITests.xctrunner` xctest bundle is present). Empirical concurrent-safety is unverified because BS iOS Maestro session-spawn is broken across 5 builds today; the same breakage blocks the WDA-direct path too. Phase 0.5 of this plan re-runs the empirical probe once BS infra is healthy and gates the WDA-direct delete on the result.

## Problem Frame

iOS Maestro customers on BrowserStack need element-based `PERCY_REGIONS` to mask dynamic content. The 2026-04-22 plan addressed this with a WDA-direct path that depends on a `/tmp/<sid>/wda-meta.json` contract from realmobile, an upstream realmobile PR (PER-7281) for WDA app re-attach, eight cross-tenant security acceptance tests, and ~3 KLOC of iOS-specific resolver code. Customers see two platform shapes; engineering owns two resolver architectures forever.

The pivot inverts that: one resolver module, no realmobile contract, no security suite, and the iOS code path mirrors the Android code path so customers and engineers learn the feature once.

(see origin: `docs/brainstorms/2026-04-27-ios-element-regions-maestro-hierarchy-requirements.md`)

## Requirements Trace

- **R1.** **Vocabulary parity in V1 via Android `id` alias.** iOS V1 supports `id` (→ `attributes.identifier`) and `class` (→ XCUIElementType\* via integer-to-name table, with short-form normalization). **Android V1 accepts `id` as an alias for the existing `resource-id` selector** so customers running the same Maestro flow on both platforms write the same `PERCY_REGIONS` yaml. Android also keeps `resource-id`, `text`, `content-desc`, `class` (no removals). Full unified-key migration (deprecating `resource-id`) deferred to V1.1.
- **R2.** Deterministic first-match.
- **R3.** Customer-friendly zero-match warn-skip; log selector key + value length only (never the value).
- **R4.** Scale handling: iOS bounds are floats in points (resolved 2026-04-27 from Maestro source), so width-ratio scale conversion is required. `png-dimensions.js` is consumed by the iOS branch. Phase 0.5 confirms empirical viability and latency bounds; it does not re-litigate the architecture.
- **R5.** SDK pre-relay gate stays removed (already shipped in `812563e`).
- **R6.** Cross-tenant safety via per-session env vars set by realmobile (`PERCY_IOS_DEVICE_UDID`, `PERCY_IOS_DRIVER_HOST_PORT`); realmobile must filter customer-supplied `appPercy.env.*` keys against a denylist for these names + `MAESTRO_BIN` + `JAVA_HOME` to prevent cross-tenant override. No `wda-meta.json`, no filesystem-contract security acceptance tests, but one focused subprocess-env spec on the override path replaces them.
- **R7.** Customer-friendly relay-side hardening (selector cap 256, spawn timeout 15 s, output cap 20 MB iOS / 5 MB Android, log scrubbing, bbox validation, region cap reuse).
- **R8.** One docs structure across platforms; copy-pasteable side-by-side examples.
- **R9.** One resolver module dispatched by platform; identical caller contract.
- **R10.** Customer fail-open — element-region failures never break screenshot uploads or coordinate-region resolution.

## Scope Boundaries

- `text` and `xpath` selectors — V1.1 on both platforms simultaneously.
- Landscape mode — V1 portrait only with explicit warn-skip on rotation.
- Multi-element selector composition — V1 requires exactly one selector key per region.
- Local-dev (`npx percy app:exec` outside BS) — same constraint as Android's resolver: requires `maestro` on PATH or `MAESTRO_BIN` set.
- Android `resource-id` deprecation (in favor of `id`) — V1 accepts both keys; deprecation timeline tracked separately as a V1.1 follow-up. Per R1, vocabulary parity is achieved in V1 via the alias; full migration is V1.1.
- Percy↔BS baseline-linkage fix — V1.0 GA gates on it but SDK-layer work doesn't.
- WDA-direct delete is gated by Phase 0.5 — does not land in the same PR set as Phase 1 additive code.

## Context & Research

### Relevant Code and Patterns

- **`cli/packages/core/src/adb-hierarchy.js`** — the Android resolver to be renamed. Already uses `maestro --udid <serial> hierarchy` as primary path (the file misnamed itself; the body is maestro-first with adb fallback). Spawn-with-timeout pattern, classify-failure helpers, `flattenMaestroNodes`, allowlisted selector keys, scrubbed log reasons. This is the structural template the iOS branch mirrors.
- **`cli/packages/core/src/api.js:480-560`** — the relay's `/percy/maestro-screenshot` handler. Currently dispatches iOS to `resolveIosRegions` (all-at-once shape) and Android to `adbDump` + `adbFirstMatch` (lazy + per-region). The plan unifies these to Android's lazy pattern for both platforms.
- **`cli/packages/core/src/wda-hierarchy.js`** + **`wda-session-resolver.js`** + **`png-dimensions.js`** — WDA-direct path, gated for deletion in Phase 4 after Phase 0.5 passes.
- **`/usr/local/.browserstack/realmobile/lib/session/maestro_session.rb:831`** — the `driver_host_port = @params['wda_port'] + 2700` formula and the `build_maestro_command` env construction shape. Reference only — no plan-time edits to realmobile in Phase 1.
- **`percy/scripts/percy-screenshot.js`** (this repo) — already removes the pre-relay gate (commit `812563e`); no SDK changes needed in this plan.

### Institutional Learnings

- **`docs/solutions/integration-issues/ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md`** — the Node 14 `AbortController` feature-detection pattern is required on BS hosts; carry it to any new spawn/HTTP code in maestro-hierarchy.js.
- Memory: BS iOS hosts have maestro CLI in `/nix/store` not on PATH; realmobile invokes via `JAVA_HOME=… <maestro_cli_path>` per `MAESTRO_VERSION_MAPPING` in `realmobile/config/constants.yml`. The iOS branch must either inherit env from realmobile's spawn or accept `MAESTRO_BIN` (Android resolver already supports this).
- Memory: BS iOS Maestro is currently spawn-broken across builds today — Phase 0.5 cannot run until that is resolved (independent of this plan).
- Memory: cross-tenant safety on shared hosts is a hard requirement; rely on realmobile's per-session env-var injection (process-isolation level) rather than tenant-influenced filesystem paths.

### External References

None required at plan time. Maestro CLI source (`https://github.com/mobile-dev-inc/maestro`) is the authoritative reference for the JSON shape returned by `hierarchy`; a brief read in Unit 2 is enough.

## Key Technical Decisions

- **Rename `adb-hierarchy.js` → `maestro-hierarchy.js`.** The current name is already a misnomer (the file is maestro-first with adb fallback). Renaming makes the cross-platform intent explicit. Keep an `adb-hierarchy.js` re-export shim for one release to avoid breaking external imports — drop in V1.1.
- **Unify api.js dispatch to Android's lazy + per-region pattern.** Both platforms call `dump({ platform })` once per request, then `firstMatch(result, selector)` per element region. Drops the iOS-only `resolvedRegions` sparse-array shape; api.js becomes truly platform-agnostic for element regions.
- **No realmobile contract; env vars only.** Realmobile injects `PERCY_IOS_DEVICE_UDID` and `PERCY_IOS_DRIVER_HOST_PORT` (already-computed `wda_port + 2700`) when spawning Percy CLI on iOS sessions. **The formula stays in realmobile, not Percy CLI** — if realmobile's port-mapping ever changes, realmobile updates the env-var value without Percy CLI needing a release. Plus `MAESTRO_BIN` and `JAVA_HOME` (also realmobile-owned). If any required env var is absent on iOS, warn-skip element regions with reason `'env-missing'` — same fail-closed shape as Android's `'no-device'`. Customer-supplied `appPercy.env.*` is filtered against a hard denylist (`PERCY_IOS_DEVICE_UDID`, `PERCY_IOS_DRIVER_HOST_PORT`, `MAESTRO_BIN`, `JAVA_HOME`) before passthrough — defense-in-depth against cross-tenant override.
- **`MAESTRO_BIN` env var honored on both platforms.** Android resolver already does this (`adb-hierarchy.js:99`). iOS branch reuses the same `defaultMaestroBin(getEnv)` helper. Realmobile sets `MAESTRO_BIN` to the Nix-store path matching the active maestro version.
- **iOS-side selector vocabulary is `{id, class}` (R1).** From the Maestro source (`maestro-ios-xctest-runner/MaestroDriverLib/Sources/MaestroDriverLib/Models/AXElement.swift`): `id` maps to `attributes.identifier`; `class` maps to `attributes.elementType` which is **an integer** (XCUIElementType raw value), so the resolver carries a static integer→name map (Apple's `XCUIElement.ElementType` enum, ~80 entries). Android's existing vocabulary (`resource-id`, `text`, `content-desc`, `class`) stays unchanged.
- **Phase 0.5 gates the WDA-direct delete, not Phase 1 additive code.** Phase 1 lands the new resolver behind a `PERCY_IOS_RESOLVER` env switch (default: `wda-direct`). Customers see no behaviour change. After Phase 0.5 passes, a single small PR flips the default and deletes the WDA-direct modules.
- **Carry the Node 14 `AbortController` feature-detect pattern.** Any new spawn timeouts or fetch usage in `maestro-hierarchy.js` must feature-detect; do not introduce a fresh `ReferenceError` failure mode on BS hosts. Specifically banned without `typeof globalThis.X === 'function'` guard: `AbortController`, `structuredClone`, `fetch`, `Blob` (per `docs/solutions/integration-issues/ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md` Rule 1). The existing Android template (`adb-hierarchy.js`) is already Node-14-clean — verified via grep; the iOS branch's template-mirroring stance keeps the surface clean by default.

## Open Questions

### Resolved During Planning

- **Where does platform dispatch live?** Inside `dump({ platform })` — single entry point, branches internally on `platform === 'ios' | 'android'`. Caller in api.js stays platform-agnostic.
- **What happens to the existing iOS dispatch in api.js?** Replaced — iOS path drops the all-at-once `resolveIosRegions` shape and follows Android's lazy `dump` + per-region `firstMatch`.
- **How is the WDA port discovered by Percy CLI?** Read from `PERCY_IOS_DRIVER_HOST_PORT` env var set by realmobile. Plan does NOT add a process-scan fallback — process-scan adds shell-out fragility for marginal gain on a rare failure mode. If `PERCY_IOS_DRIVER_HOST_PORT` is missing, warn-skip with `'env-missing'`. (Android's `ANDROID_SERIAL` resolver is the parity reference: env-first; if missing, probe; on iOS the probe equivalent is risky cross-tenant.)
- **What happens during the BS infra outage window?** Phase 1 ships with the env switch defaulting to `wda-direct`. Customers see exactly the current behaviour. The new code path lives behind the switch and is exercisable in CI but not in production until Phase 0.5 passes.
- **Should the brainstorm/contract docs be deleted in Phase 4?** Yes for `docs/contracts/realmobile-wda-meta.md` (it describes a contract no longer implemented). The 2026-04-22 brainstorm gets a "superseded by 2026-04-27 brainstorm + Phase 0.5 result" note rather than deletion — preserves the historical reasoning.
- **What is the exact iOS attribute key in maestro hierarchy JSON for `accessibilityIdentifier`?** RESOLVED via Maestro source. The key is `attributes.identifier`, defined in `maestro-ios-xctest-runner/MaestroDriverLib/Sources/MaestroDriverLib/Models/AXElement.swift`. Note: `accessibilityLabel` would be `attributes.label` and is the V1.1 `text` selector target.
- **What is the iOS attribute key for element type / class?** RESOLVED via Maestro source. The key is `attributes.elementType` and the value is an **integer** XCUIElementType raw value (e.g. `9` for button), not a string. The resolver carries a static integer→name table (Apple's `XCUIElement.ElementType` enum) to map `9 → "XCUIElementTypeButton"` so customer-supplied selectors like `class: "Button"` and `class: "XCUIElementTypeButton"` work the same.
- **Does maestro hierarchy on iOS return bounds in points or pixels?** RESOLVED — points. iOS bounds live at `attributes.frame = {x, y, width, height}` (floats in **points**) per `AXFrame.swift`. The width-ratio scale-factor logic from `wda-hierarchy.js` survives and migrates into the iOS branch of `maestro-hierarchy.js`. **`png-dimensions.js` stays** (Unit 9's delete list narrows accordingly).
- **What is the iOS bounds shape?** RESOLVED — `{x, y, width, height}` object, NOT the Android `[x1,y1][x2,y2]` regex string. `parseBounds` becomes platform-aware: Android keeps the regex parse, iOS reads the structured object directly. Both branches return the canonical `{x, y, width, height}` shape to the caller.
- **Does realmobile already inject `PERCY_IOS_DEVICE_UDID` / `PERCY_IOS_DRIVER_HOST_PORT` / `MAESTRO_BIN` / `JAVA_HOME` into the spawned Percy CLI process?** RESOLVED — NO. realmobile today only forwards customer-controlled `params['app_percy']['env']` keys (per `cli_manager.rb#cli_env`, lines 77-83 baseline). All four env vars are NEW exports realmobile must add. This widens Unit 10's surface to four env vars, not two.

### Deferred to Implementation

- **Latency p95.** Phase 0.5 measurement decides whether per-screenshot resolution stays inline or needs caching. Default is inline; cache only if p95 exceeds 3 s on real hardware.
- **Output size cap for iOS hierarchy JSON.** Phase 0.5 measurement informs a tightening from the initial 20 MB. Revisit after one production cycle.
- **Final env-var names** (`PERCY_IOS_DEVICE_UDID`, `PERCY_IOS_DRIVER_HOST_PORT`). Coordinate with realmobile owner before realmobile PR (Unit 10a). If they prefer different names, accept theirs — the resolver reads via `getEnv` so the name is a one-line change.
- **Whether `flattenMaestroNodes(iOS)` should also surface `attributes.label` (= iOS `accessibilityLabel`) under a canonical key for V1.1 `text` selector.** Surface during V1.1 planning, not V1; flagged here so the V1.1 cycle starts with the answer in hand.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
  participant SDK as percy-screenshot.js (Maestro flow)
  participant Relay as @percy/cli relay (api.js)
  participant Resolver as maestro-hierarchy.js (single module)
  participant MaestroCLI as maestro --udid X --driver-host-port Y hierarchy
  participant DriverXCT as dev.mobile.maestro-driver-iosUITests.xctrunner (iOS)<br/>or dev.mobile.maestro app (Android)

  SDK->>Relay: POST /percy/maestro-screenshot<br/>{regions: [{element:{id:"X"}}, …], platform: "ios" | "android"}
  Relay->>Relay: parse PNG dims (iOS only, if scale needed)
  Relay->>Resolver: dump({platform, getEnv})
  alt platform == ios
    Resolver->>Resolver: read PERCY_IOS_DEVICE_UDID + PERCY_IOS_DRIVER_HOST_PORT<br/>(realmobile owns the wda_port + 2700 formula)
    Resolver->>MaestroCLI: spawn(maestro --udid <udid> --driver-host-port <P> hierarchy)
    MaestroCLI->>DriverXCT: gRPC over iproxy
    DriverXCT-->>MaestroCLI: JSON tree
    MaestroCLI-->>Resolver: stdout JSON
    Resolver->>Resolver: flattenMaestroNodes(iOS) → {id, class, bounds}
  else platform == android
    Resolver->>Resolver: read ANDROID_SERIAL or probe `adb devices`
    Resolver->>MaestroCLI: spawn(maestro --udid <serial> hierarchy) [unchanged]
    MaestroCLI->>DriverXCT: gRPC over adb
    DriverXCT-->>MaestroCLI: JSON tree
    MaestroCLI-->>Resolver: stdout JSON
    Resolver->>Resolver: flattenMaestroNodes(Android) → {resource-id, text, content-desc, class, bounds}
  end
  Resolver-->>Relay: {kind:"hierarchy", platform, nodes:[…]}
  loop per element region in request
    Relay->>Resolver: firstMatch(result, region.element)
    Resolver-->>Relay: bbox | null
    alt bbox null
      Relay->>Relay: log warn-skip (key + value-length only)
    end
  end
  Relay-->>SDK: {success, link} (screenshot uploaded; warn-skips logged but not blocking)
```

The key observation: post-rename, the platform-specific code is two functions inside `maestro-hierarchy.js` (`runMaestroIosDump`, `runMaestroAndroidDump`) plus one map in `flattenMaestroNodes` (per-platform attribute-name keys). The caller in api.js does not branch on platform for element regions.

## Implementation Units

### Phase 1 — Additive: bring up cross-platform resolver behind an env switch

- [ ] **Unit 1: Rename `adb-hierarchy.js` → `maestro-hierarchy.js` + extract platform-agnostic seams**

**Goal:** Establish the new file name and structure without changing Android behaviour.

**Requirements:** R9 (one resolver module).

**Dependencies:** None.

**Files:**
- Move: `cli/packages/core/src/adb-hierarchy.js` → `cli/packages/core/src/maestro-hierarchy.js`
- Modify: `cli/packages/core/src/api.js` (update import)
- Move: `cli/packages/core/test/unit/adb-hierarchy.test.js` → `cli/packages/core/test/unit/maestro-hierarchy.test.js`
- Create (one-release shim): `cli/packages/core/src/adb-hierarchy.js` re-exporting from `maestro-hierarchy.js` for any external imports

**Approach:**
- Pure rename; no behaviour change.
- The shim is a 3-line re-export with a deprecation comment; remove in V1.1.
- Verify Android tests still green before moving on.

**Patterns to follow:**
- Existing `adb-hierarchy.js` exports (`dump`, `firstMatch`, `SELECTOR_KEYS_WHITELIST`).

**Test scenarios:**
- Existing 100% of Android resolver test cases pass under the new module path.
- The shim re-export resolves and exports the same symbols.

**Verification:**
- `yarn workspace @percy/core test` passes with no skipped Android resolver tests.
- `git grep adb-hierarchy` shows only the shim file and intentional historical references.

---

- [ ] **Unit 2: Add iOS branch to `dump()` in `maestro-hierarchy.js`**

**Goal:** Resolve element regions on iOS by spawning `maestro --udid <udid> --driver-host-port <P> hierarchy` and flattening the JSON tree to canonical nodes.

**Requirements:** R1, R2, R6, R7, R9, R10.

**Dependencies:** Unit 1.

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js`
  - New: `runMaestroIosDump({ udid, driverHostPort, execMaestro, getEnv })` returning `{ kind, ... }` shape parallel to the existing Android `runMaestroDump`.
  - New: `flattenMaestroNodes(parsedJson, platform)` extension. When `platform === 'ios'`, the per-node attribute map is:
    - `attributes.identifier` → canonical `id` key (NOT `accessibilityIdentifier`).
    - `attributes.elementType` (integer) → canonical `class` key, after lookup in `XCUI_ELEMENT_TYPE_BY_INTEGER` (~80-entry map mirroring Apple's `XCUIElement.ElementType` enum).
    - `attributes.frame = {x, y, width, height}` (floats in points) → canonical `{x, y, width, height}` after **points→pixels scale conversion** (multiply by `scale ∈ {2, 3}`).
    - `attributes.label` → reserved for V1.1 `text` selector; not surfaced in V1.
  - New: iOS branch inside `dump()` reading `PERCY_IOS_DEVICE_UDID` and `PERCY_IOS_DRIVER_HOST_PORT` env vars (realmobile-set; Percy CLI does NOT compute the port formula), and warn-skipping with `'env-missing'` if either is unset.
  - New: `XCUI_ELEMENT_TYPE_BY_INTEGER` constant — static integer→name lookup (e.g. `9 → 'XCUIElementTypeButton'`). Reverse map of Apple's `XCUIElement.ElementType` raw values. Extending: append new entries with new Xcode SDK releases.
  - Carry from `wda-hierarchy.js`: `XCUI_ALLOWLIST` constant + short-form normalization helper. After Unit 9 deletes `wda-hierarchy.js`, this constant lives in `maestro-hierarchy.js` only.
  - Extend: `firstMatch(nodes, selector)` to accept iOS selector keys (`id`, `class`).
  - Extend: `SELECTOR_KEYS_WHITELIST` to include the iOS keys (used by api.js validation).
  - **Android `id` alias** (R1 vocabulary parity for V1): in `flattenMaestroNodes` for the Android branch, surface the `resource-id` value under both `resource-id` and `id` canonical keys on each node. Customer selectors `{id: "submit-btn"}` and `{resource-id: "submit-btn"}` both match. SELECTOR_KEYS_WHITELIST gains `id` for Android too. **Side effect on `firstMatch` semantics:** if a customer specifies the same value under `id` and a different value under `resource-id` on Android (impossible in V1 — selectors are single-key per region per Scope Boundaries), the alias is the only resolution. Document in unit test as a no-op edge case.
- Modify: `cli/packages/core/test/unit/maestro-hierarchy.test.js` (add iOS-branch test cases).
- Reference (read-only, don't modify): `cli/packages/core/src/png-dimensions.js` and the width-ratio scale logic in `cli/packages/core/src/wda-hierarchy.js` lines ~80-130. **Migrate the scale logic into the iOS branch of `maestro-hierarchy.js`** since Unit 9 deletes `wda-hierarchy.js`. `png-dimensions.js` stays for reuse.

**Approach:**
- Mirror `runMaestroDump` (Android) shape exactly — spawn-with-timeout, JSON slice from first `{`, parse, classify failure, return `{ kind: 'hierarchy', nodes }` on success.
- Output size cap: 20 MB (vs Android's 5 MB) — see brainstorm R7.
- The iOS attribute-key map (resolved this round) and the points→pixels scaling are the only iOS-specific code paths beyond environment plumbing.
- Bounds normalization: Android returns regex-parsed `[x1,y1][x2,y2]` strings → `{x, y, width, height}` integers. iOS returns `{x, y, width, height}` floats in points → multiply by scale factor (snap to {2, 3} per `wda-hierarchy.js` width-ratio logic), round to integers, clamp to in-bounds. Caller sees identical canonical shape.
- Per-screenshot scale factor: cache by `sessionId` (already the pattern in `wda-hierarchy.js`); compute once via `screenshot_pixel_width ÷ wda_window_logical_width` if needed, fail-closed outside `[1.9, 3.1]`. For maestro-hierarchy path, the logical width is derivable from the root node's frame; if absent, fall back to the WDA `/wda/screen` round-trip pattern only when scale cannot be computed locally — preferred path is local-only.
- Carry the Node 14 banned-globals discipline: any new code uses `typeof globalThis.X === 'function'` guards before referencing `AbortController`/`structuredClone`/`fetch`/`Blob`. The Android template (`adb-hierarchy.js`) is already clean — verified via grep — so mirroring it preserves the property.

**Execution note:** Test-first AND fixture-prerequisite. The iOS attribute-key claims (`attributes.identifier`, `attributes.elementType` integer, `attributes.frame` points) come from the Maestro Swift source (`MaestroDriverLib/.../AXElement.swift`). The Maestro CLI's JSON-emit layer is a *different* code path that could re-key or re-shape the data before stdout (e.g., the CLI may wrap responses in an envelope). **Do not start Unit 2 implementation until one of:**
- (a) Unit 8 (Phase 0.5) captures a live iOS hierarchy JSON sample and checks it into `cli/packages/core/test/unit/fixtures/ios-hierarchy-sample.json`, OR
- (b) An agent reads `https://github.com/mobile-dev-inc/maestro/tree/main/maestro-cli/.../HierarchyCommand.kt` (or the equivalent CLI-side serializer) to confirm the JSON shape matches the Swift source.

Path (a) is preferred (real fixture > inferred shape). Path (b) is a fallback if BS infra remains broken longer than Phase 1 review takes. As a defensive structuring option, Unit 2 may be split into 2a (resolver scaffolding + Android pass-through preserved + iOS branch *stubbed* with `FIXME-PHASE-0.5`) and 2b (iOS attribute keys + frame parser + integer table, blocked on fixture). Splitting unblocks Units 3-4 immediately and limits rework if the fixture surprises.

**Patterns to follow:**
- `cli/packages/core/src/adb-hierarchy.js` → `runMaestroDump`, `flattenMaestroNodes`, `classifyMaestroFailure`, `defaultExecMaestro`.
- `cli/packages/core/src/wda-hierarchy.js` → `XCUI_ALLOWLIST`, short-form normalization (carry as direct copy then delete the source file in Unit 9).
- `cli/packages/core/src/wda-hierarchy.js` → log-scrubbing pattern (selector key + value length, no full values).

**Test scenarios:**
- iOS happy path: env vars set, maestro CLI returns parseable JSON with `attributes.identifier` and `attributes.elementType` integer → `flattenMaestroNodes` maps integer 9 to `XCUIElementTypeButton`, scale factor applied to `attributes.frame`, `firstMatch` resolves the bbox.
- iOS unknown elementType integer (e.g. integer not in `XCUI_ELEMENT_TYPE_BY_INTEGER` map): node still appears in flattened set with `class` undefined; selectors targeting `class` simply don't match it (no error).
- iOS env-var missing: `PERCY_IOS_DEVICE_UDID` unset → warn-skip with `'env-missing'`.
- iOS env-var missing partial: `PERCY_IOS_DEVICE_UDID` set, `PERCY_IOS_DRIVER_HOST_PORT` unset → warn-skip with `'env-missing'`.
- iOS maestro CLI not found: spawn ENOENT → warn-skip with `'maestro-not-found'`.
- iOS maestro CLI timeout: 15 s exceed → warn-skip with `'maestro-timeout'`.
- iOS maestro CLI nonzero exit (e.g., driver port unreachable) → warn-skip with `'maestro-exit-N'`.
- iOS oversize output (> 20 MB) → warn-skip with `'maestro-oversize'`.
- iOS class short-form normalization: `Button` → `XCUIElementTypeButton`, allowlist match.
- iOS class allowlist miss: `NotARealElementType` → warn-skip with `'class-not-allowlisted'`.
- iOS zero-match: selector resolves nothing → `firstMatch` returns `null`, region warn-skip in api.js layer.
- iOS bbox below min-area threshold (< 4×4 px after scale): warn-skip with `'bbox-too-small'`. Edge case to test specifically: a sub-pixel `frame` like `{width: 1.2, height: 0.8}` in points × scale 2 = `{width: 2.4, height: 1.6}` px → still below threshold → warn-skip.
- iOS scale factor out of range: synthesized PNG with width that yields scale outside `[1.9, 3.1]` → fail-closed warn-skip with `'scale-out-of-range'`.
- Selector value length cap exceeded (> 256 chars) → warn-skip with `'selector-too-long'`.
- Cross-platform parity: same `{element: {id: "X"}}` input shape, same resolved-bbox output shape across iOS and Android branches. **For Android, `{id: "X"}` and `{resource-id: "X"}` both resolve to the same node — alias parity test asserts this.** Different attribute internals (Android `resource-id` regex parse vs iOS `identifier` direct read with frame-scaling); same external `{x, y, width, height}` integer-pixel contract.
- Log scrubbing: stdout contains no selector values, no full hierarchy contents.
- Node 14 compat: each new code path that might touch a Node 15+ global is tested under a fake `globalThis` with the global removed (`AbortController` removed → fall back to Promise.race timeout; etc.).

**Verification:**
- 100% branch coverage on the new iOS code paths under the existing NYC threshold.
- A focused `describe('iOS branch')` block in the test file with all the scenarios above.
- Cross-platform parity test asserting both branches return the same `{kind, platform, nodes: [{<canonical>}, …]}` envelope.

---

- [ ] **Unit 3: Update api.js dispatch to unify both platforms on the lazy `dump` + per-region `firstMatch` pattern, behind a `PERCY_IOS_RESOLVER` env switch**

**Goal:** Make the relay's iOS path consume the same resolver shape Android already uses, gated by an env switch defaulting to the existing WDA-direct path.

**Requirements:** R5, R9, R10.

**Dependencies:** Unit 2.

**Files:**
- Modify: `cli/packages/core/src/api.js` (480-560 region; extend imports; replace iOS branch with platform-agnostic dispatch when `PERCY_IOS_RESOLVER === 'maestro-hierarchy'`).
- Modify: `cli/packages/core/test/unit/api.test.js` (or equivalent integration test) — add cases for both env switch values.

**Approach:**
- Add `import { dump as maestroDump, firstMatch as maestroFirstMatch } from './maestro-hierarchy.js';`
- Read `PERCY_IOS_RESOLVER` from `process.env`; treat unset as `'wda-direct'` (current behaviour).
- When `PERCY_IOS_RESOLVER === 'maestro-hierarchy'` AND `platform === 'ios'`:
  - Call `maestroDump({ platform: 'ios' })` once per request (lazy memoize like Android already does).
  - For each element region, call `maestroFirstMatch(result, region.element)` and emit warn-skip on `null`.
  - Drop the `iosResult.resolvedRegions[iosIndex++]` sparse-array indirection.
- Coord-region behaviour and SDK contract unchanged on both branches.
- The dual-path scaffolding is intentional and short-lived — Unit 9 deletes the WDA-direct branch entirely.

**Patterns to follow:**
- Existing api.js Android branch (`adbDump`, `adbFirstMatch`, `cachedDump = await adbDump()`).

**Test scenarios:**
- `PERCY_IOS_RESOLVER` unset: iOS request flows through `resolveIosRegions` (existing behaviour).
- `PERCY_IOS_RESOLVER='maestro-hierarchy'`: iOS request flows through `maestroDump` + `maestroFirstMatch`.
- `PERCY_IOS_RESOLVER='maestro-hierarchy'` + Android request: unchanged Android behaviour.
- Mixed coord+element regions on iOS via maestro path: both succeed, ordering preserved.
- Element region with selector not in `SELECTOR_KEYS_WHITELIST`: warn-skip at api.js validation layer.

**Verification:**
- Existing api.js tests still pass with switch unset.
- New test block "iOS via maestro-hierarchy" exercises the maestro-path scenarios above.
- Hand-trace: with switch on, no calls to `resolveIosRegions`, `resolveWdaSession`, or `parsePngDimensions` happen for iOS element regions (modulo the points-vs-pixels question — see Phase 0.5).

---

- [ ] **Unit 4: Add cross-platform resolver parity test**

**Goal:** Lock in the contract that both platforms return the same external shape, so future changes to one platform don't silently regress parity.

**Requirements:** R8, R9.

**Dependencies:** Unit 2.

**Files:**
- Create: `cli/packages/core/test/unit/maestro-hierarchy.parity.test.js`

**Approach:**
- Pair fixtures for Android and iOS that contain the "same" element (a button labelled "Submit" with id `submit-btn` and class `Button`/`XCUIElementTypeButton`).
- Assert `dump()` returns the same envelope shape on both platforms.
- Assert `firstMatch(result, {id: "submit-btn"})` returns equivalent `{x, y, width, height}` on both.
- Assert log scrubbing produces messages with the same structure.

**Patterns to follow:**
- Existing fixture patterns in `test/unit/adb-hierarchy.test.js`.

**Test scenarios:**
- Same selector input, both platforms, same envelope output.
- Same warn-skip reason taxonomy (`'env-missing'`, `'maestro-not-found'`, `'maestro-timeout'`, `'maestro-oversize'`, `'class-not-allowlisted'`, `'bbox-too-small'`, `'selector-too-long'` — verify each maps to the equivalent classification on the other platform where relevant).

**Verification:**
- The parity test file exists and its assertions pass.
- A reviewer can read this file alone and understand the cross-platform contract.

### Phase 2 — Documentation and probe artifact

- [ ] **Unit 5: Update percy-maestro README for cross-platform parity**

**Goal:** One docs structure customers can read once and apply on both platforms.

**Requirements:** R7 (security disclaimer), R8.

**Dependencies:** None code-side; can land before Unit 1 if desired.

**Files:**
- Modify: `README.md`
- Modify: `docs/contracts/realmobile-wda-meta.md` (mark as superseded; deletion in Unit 11).

**Approach:**
- One `PERCY_REGIONS` selector table covering both platforms, columns: Selector key | Android maps to | iOS maps to | Notes.
- The example yamls use `id` and `class` for both platforms (per R1 alias). Customers writing one yaml-block work on both.
- A migration callout for Android customers using `resource-id`: "still supported in V1; recommend `id` going forward; `resource-id` deprecation timeline TBD in V1.1."
- Side-by-side iOS and Android example yamls demonstrating the same masking intent (now actually identical, post-alias).
- R7 security disclaimer (`PERCY_REGIONS` is not a security boundary).
- V1.1 follow-up named (`text`, `xpath` on both platforms; `resource-id` deprecation on Android).
- Local-dev gap callout: requires `maestro` on PATH or `MAESTRO_BIN` set.
- Document `PERCY_IOS_RESOLVER` env switch with a "currently defaults to wda-direct; will flip after Phase 0.5" note. Remove that note in Unit 9.
- **Customer debugging hint:** add a "How to inspect what Maestro sees on iOS" subsection showing how to run `maestro hierarchy` locally and confirm `accessibilityIdentifier` is set in their app code. (Addresses P2-7 from document review — high-leverage debugging affordance.)

**Patterns to follow:**
- Existing README region-doc section (if any) and the percy-maestro-android README (Unit 6 mirrors it).

**Test scenarios:**
- N/A (docs).

**Verification:**
- Both example yamls work as paste-and-run fragments inside a Maestro flow.
- Mention parity (a customer reading just this README understands they don't need a separate doc per platform).

---

- [ ] **Unit 6: Mirror cross-platform docs in percy-maestro-android README**

**Goal:** Same docs structure on the sibling repo so customers landing on either README see the same vocabulary.

**Requirements:** R8.

**Dependencies:** Unit 5 (use the same content).

**Files:**
- Modify: `../percy-maestro-android/README.md`

**Approach:**
- Lift the cross-platform region table and side-by-side examples from Unit 5.
- Note Android's `resource-id`/`text`/`content-desc`/`class` selector vocabulary explicitly; defer the unified-key migration to V1.1.

**Test scenarios:** N/A.

**Verification:**
- Two READMEs read consistently; a reader can swap between them with no surprise.

---

- [ ] **Unit 7: Check the Phase 0 spike probe into the repo**

**Goal:** Make the empirical probe re-runnable when BS infra is unblocked, without requiring someone to reconstruct the script from session memory.

**Requirements:** Phase 0.5 gate.

**Dependencies:** None.

**Files:**
- Create: `docs/experiments/2026-04-27-maestro-hierarchy-spike/probe.sh`
- Create: `docs/experiments/2026-04-27-maestro-hierarchy-spike/README.md` (how to deploy and run; expected output schema; A0/A1/A2/A3 acceptance bar).

**Approach:**
- Move the smart-probe v2 script (currently at `/tmp/spike-host-probe.sh` locally and on host 52) into the repo.
- Document the BS build trigger + machine-pin pattern (curl payload, env var sourcing, `bare-key machine` shape from auto-memory).
- Document the on-host setup (Nix-store maestro path discovery, JAVA_HOME selection from `MAESTRO_VERSION_MAPPING` in `realmobile/config/constants.yml`).

**Test scenarios:** N/A (operational artifact).

**Verification:**
- The probe runs on host 52 from the repo-checked-in copy without any path edits.
- The README explains how to interpret each CSV column and what counts as A0/A1/A2/A3 PASS.

### Phase 0.5 — Empirical probe gate (BLOCKING; cannot be merged through code)

- [ ] **Unit 8: Re-run the Phase 0 spike on a healthy BS iOS Maestro session and update findings.md**

**Goal:** Capture the empirical A0/A1/A2/A3 evidence the spike couldn't get on 2026-04-27.

**Requirements:** Phase 0.5 gate per origin doc.

**Dependencies:**
- BS Maestro infra ticket resolved (sessions actually spawn maestro CLI on iOS).
- Unit 7 (probe artifact in repo).
- Unit 1+2 LANDED so the new resolver code exists for fixture-shape validation; the probe itself does not depend on Phase 1 code.

**Files:**
- Modify: `docs/experiments/2026-04-27-maestro-hierarchy-spike/findings.md` (append "Re-run YYYY-MM-DD" section with A0/A1/A2/A3 pass/fail and supporting CSV/JSON excerpts).

**Approach:**
- Trigger BS Maestro iOS build pinned to host 52 + `00008110-000065081404401E` (or any BS iOS host where sessions are healthy), using the slow-flow zip from Unit 7's README.
- SSH to host, run `probe.sh` with 30 min deadline.
- Capture A0 (parseable JSON during active flow), A1 (parent flow passes during a single probe burst), **A1.5 (probe interleaved with active `tapOn`/`scroll` from parent flow — both succeed)**, A2 (latency p95 < 3 s — measurement only, not strict gate), A3 (`attributes.identifier` + `attributes.elementType` integer both present in JSON), **A4 (end-to-end flow latency added on a 10-screenshot flow with element regions; target < 30% of session timeout — i.e., < 3 min added to a typical 10 min budget)**.
- Decision tree:
  - **A0 + A1 + A1.5 + A3 PASS, A4 measured within target**: proceed to Phase 4 deletes.
  - **A0 fails**: revert Phase 1 additive code; resume the 2026-04-22 WDA-direct plan; chase PER-7281 in realmobile.
  - **A1 OR A1.5 fails**: revert Phase 1; concurrent-safety isn't real on iOS; same fallback as A0 fail.
  - **A3 fails** (no identifier or elementType in JSON): revert Phase 1; R1 cannot be implemented through this path.
  - **A2 fails by a small margin**: re-evaluate with the full team; not auto-revert.
  - **A4 fails (latency budget exceeded)**: do not auto-revert, but add JVM-pool design to V1.1 plan AND consider gating production rollout behind a more aggressive scale-factor cache before Unit 9 ships. Document in findings.md.
- Discover and record the iOS attribute-name keys (`accessibilityIdentifier`/equivalent, element type/class). Update Unit 2's `flattenMaestroNodes(iOS)` map with the actual keys, lift the corresponding `Deferred to Implementation` items.
- Discover and record the bounds shape (points or pixels). If pixels → mark `png-dimensions.js` deletable in Unit 9. If points → keep `png-dimensions.js` and pull the width-ratio scale logic from `wda-hierarchy.js` into the iOS branch of `maestro-hierarchy.js`.

**Execution note:** Operational task, not a code commit. The plan parks here until BS infra is healthy. Track with a 2026-05-XX scheduled retry agent (see `/schedule` follow-up offer below).

**Test scenarios:**
- Same scenarios as Phase 0 spike (A0/A1/A2/A3) — see `docs/brainstorms/2026-04-27-...md` Phase 0 section.

**Verification:**
- `docs/experiments/2026-04-27-maestro-hierarchy-spike/findings.md` has a new "Re-run YYYY-MM-DD" section with PASS/FAIL for each acceptance item and supporting evidence (CSV excerpts, JSON sample, BS build IDs).
- Either Phase 4 is unblocked or the plan is reverted to A.

### Phase 4 — Delete WDA-direct (gated by Phase 0.5 PASS)

- [ ] **Unit 9: Delete WDA-direct modules + flip `PERCY_IOS_RESOLVER` default**

**Goal:** Reduce surface area; finalize cross-platform parity in code.

**Requirements:** R6 (no realmobile contract), R7, R9, R10.

**Dependencies:** Unit 8 (Phase 0.5 PASS) AND Unit 10a deployed in production (env vars must be live before Percy CLI commits to consuming them as the only iOS resolver path).

**Files:**
- Delete: `cli/packages/core/src/wda-hierarchy.js`
- Delete: `cli/packages/core/src/wda-session-resolver.js`
- **KEEP**: `cli/packages/core/src/png-dimensions.js` — iOS bounds are points (resolved during deepening), so `png-dimensions.js`'s scale-factor computation is consumed by the iOS branch of `maestro-hierarchy.js`. Update its only caller (api.js → no longer iOS-direct; called from inside `maestro-hierarchy.js` instead).
- Delete: `cli/packages/core/test/unit/wda-hierarchy.test.js`
- Delete: `cli/packages/core/test/unit/wda-session-resolver.test.js`
- KEEP: `cli/packages/core/test/unit/png-dimensions.test.js`
- Modify: `cli/packages/core/src/api.js` (remove WDA-direct branch and `PERCY_IOS_RESOLVER` env switch; iOS goes through `maestroDump` unconditionally; remove the iOS-only PNG-parse-up-front because scale logic now lives inside the resolver).
- Modify: `README.md` (remove the "currently defaults to wda-direct" note from Unit 5).

**Approach:**
- Single PR per repo; small footprint.
- Before merge: confirm 100% test coverage on `@percy/core` with the WDA-direct files removed.
- After merge: bump `@percy/core` minor version; coordinate release with realmobile cleanup (Unit 10).

**Patterns to follow:**
- Existing module-deletion patterns in `@percy/core` (see `git log --diff-filter=D --summary --no-renames`).

**Test scenarios:**
- iOS request with element regions → routed through `maestroDump`; no path through `resolveIosRegions`.
- Coord regions on iOS → still work (no resolver involved).
- Tests for the deleted modules removed; remaining test coverage holds.

**Verification:**
- `git grep -l 'wda-hierarchy\|wda-session-resolver\|resolveIosRegions\|resolveWdaSession\|PERCY_IOS_RESOLVER'` returns no hits in `cli/`.
- `yarn workspace @percy/core test` passes.
- `yarn workspace @percy/core build` produces a smaller dist (verify file sizes).

---

- [ ] **Unit 10a: realmobile env-var exports for Percy CLI iOS spawn** *(Phase 1 prerequisite — must deploy before Unit 8 production rollout / Unit 9 default flip)*

**Goal:** Realmobile injects the four env vars Percy CLI's iOS resolver requires, additively. No code is removed in this unit. Old Percy CLI versions ignore the new vars; new Percy CLI versions consume them.

**Requirements:** R6.

**Dependencies:** None — purely additive change to realmobile.

**Files (in realmobile repo, NOT this repo):**
- Modify: `lib/app_percy/cli_manager.rb` — extend `cli_env` (or the equivalent spawn helper) to: (1) **filter** `params['app_percy']['env']` against a hard denylist (`PERCY_IOS_DEVICE_UDID`, `PERCY_IOS_DRIVER_HOST_PORT`, `MAESTRO_BIN`, `JAVA_HOME`) — drop denylisted keys with a single warn line; (2) **inject** the four env vars from realmobile's own values, AFTER the filtered customer passthrough so realmobile's values are last-write-wins on the subprocess command line.
- Modify: `spec/lib/app_percy/cli_manager_spec.rb` — add env-var passthrough tests AND a focused subprocess-env spec for the cross-tenant override path (P0 of the document review).

**Approach:**
- realmobile baseline (verified during deepening) injects ZERO Percy-specific env vars beyond the customer-controlled `params['app_percy']['env']` passthrough. This unit adds four explicit injections, each guarded by `platform == 'ios'` so Android sessions are unaffected.
- **Source of truth for each — all derived inside realmobile, not in Percy CLI:**
  - `PERCY_IOS_DEVICE_UDID` ← `@params['device']` (the udid already used as `--device=#{@device}` in `maestro_session.rb#build_maestro_command`).
  - `PERCY_IOS_DRIVER_HOST_PORT` ← `@params['wda_port'] + 2700` (already computed on `maestro_session.rb:831`). **Realmobile owns the formula; Percy CLI just reads the value.** Future realmobile port-mapping changes update the env-var value without requiring a Percy CLI release.
  - `MAESTRO_BIN` ← `@maestro_cli_path` (already computed in `maestro_session.rb:140` as `"#{BS_DIR_PATH}/deps/maestro-cli/#{cli_version}/bin/maestro"`).
  - `JAVA_HOME` ← `@java_home` (already read from `ENV["JAVA_ZULU_#{java_version}"]` in `maestro_session.rb:138`).
- All four values are already known to realmobile at session start; this unit is plumbing, not new computation.
- **Cross-tenant override defense (P0):** A malicious customer could attempt `appPercy.env.PERCY_IOS_DEVICE_UDID = '<other-tenant-udid>'`. The denylist filter rejects this BEFORE the customer hash reaches the subprocess command line. `MAESTRO_BIN` is especially dangerous as a customer-controlled value — pointing it at an attacker-controlled binary path could execute arbitrary code in Percy CLI's process. Filter-then-inject ensures realmobile's values reach the subprocess regardless of customer input.
- Naming: `PERCY_IOS_DEVICE_UDID` and `PERCY_IOS_DRIVER_HOST_PORT` are proposed names. Coordinate with realmobile owner before merge; if they prefer different names, accept theirs and update `getEnv` reads in `maestro-hierarchy.js`. The denylist must update lockstep with any rename.

**Execution note:** This unit is a separate PR in realmobile, not in `percy-maestro` or `cli`. Track as a cross-team coordination item. **It is purely additive — no Percy CLI version cares whether these env vars are present until the resolver code in Unit 2 lands AND `PERCY_IOS_RESOLVER='maestro-hierarchy'` is set.** Therefore Unit 10a has no production risk and can deploy in any order relative to Phase 1 code; it just needs to be deployed BEFORE Unit 8 is run with the env switch flipped, and before Unit 9 lands.

**Patterns to follow:**
- Existing env-var-export pattern in `realmobile/lib/session/maestro_session.rb#build_maestro_command` (the `JAVA_HOME=… JAVA_OPTS=…` shape that wraps the maestro CLI subprocess command line).
- Existing customer-passthrough pattern in `cli_manager.rb#cli_env` (lines 77-83 baseline).

**Test scenarios:**
- realmobile spawns Percy CLI on iOS session with iOS Maestro → child process env contains all four vars with realmobile-derived values.
- realmobile spawns Percy CLI on Android Maestro session → none of the four iOS-specific vars present (Android has its own surface).
- **Cross-tenant override (P0 acceptance test):** Customer payload includes `appPercy.env.PERCY_IOS_DEVICE_UDID = 'evil-udid'` AND `appPercy.env.MAESTRO_BIN = '/tmp/evil-binary'`. Spec must inspect the spawned Percy CLI process env directly (parse `/proc/<pid>/environ` on Linux, or the equivalent macOS approach with explicit env-var-name extraction — NOT just "the env var is set", which would pass either way). Assert: realmobile-injected values present; customer-injected denylisted values absent; one warn-log line "filtered N denylisted keys".
- Same override test applied to `PERCY_IOS_DRIVER_HOST_PORT` and `JAVA_HOME`.
- Customer payload with non-denylisted key (`appPercy.env.PERCY_BRANCH = 'main'`) → still passes through unchanged.

**Verification:**
- realmobile PR merged and deployed to staging then production.
- On host 52 during an active iOS Maestro session: `ps eaxww | grep -E 'percy.*PERCY_IOS_DEVICE_UDID|PERCY_IOS_DRIVER_HOST_PORT|MAESTRO_BIN|JAVA_HOME'` shows all four set with the expected (realmobile-derived) values.
- Old Percy CLI versions deployed during the staging rollout window continue to function (regression check — adding env vars is a safe-deploy primitive).

---

- [ ] **Unit 10b: realmobile cleanup — remove `write_wda_meta` / `cleanup_wda_meta`** *(Phase 4 — after Unit 9 is in production)*

**Goal:** Realmobile stops writing `/tmp/<sid>/wda-meta.json`, since no Percy CLI version reads it anymore.

**Requirements:** R6.

**Dependencies:** Unit 9 deployed in production AND **stable for at least one Percy CLI release cycle** (rollback-protection — see Risks & Dependencies). Without this gate, a post-merge Unit 9 defect would require re-landing the wda-meta writer in realmobile, multiplying rollback complexity.

**Files (in realmobile repo, NOT this repo):**
- Modify: `lib/app_percy/cli_manager.rb` — delete `write_wda_meta` and `cleanup_wda_meta` methods.
- Modify: `spec/lib/app_percy/cli_manager_spec.rb` — drop wda-meta tests.

**Approach:**
- Pure deletion. The wda-meta writer was added in the 2026-04-23 prior-session work (the overlay was reverted on host 52 by 2026-04-27, but the methods may still exist on the `feat/maestro-percy-ios-integration` branch); confirm current state before merging.
- **Safe-deploy property:** Even if Unit 10b deploys before all Percy CLI clients have updated to Unit 9, the worst case is "realmobile stops writing a file Percy CLI's old code expects" → old Percy CLI warn-skips iOS element regions with `'missing'`/`'malformed-json'` (the existing wda-direct fail-closed path). Element regions broken for stragglers; coordinate-regions and screenshot uploads unaffected. Acceptable failure mode for a known-deprecated path.
- **Race window analysis:** No race in the cutover. Unit 10a deployed → both old and new Percy CLI clients work (old ignores new env vars; new uses them). Unit 9 deployed → all Percy CLI clients on the new path; wda-meta writer becomes dead code. Unit 10b deletes the dead code. Each step is a safe transition; there is no window where a coherent Percy CLI version expects something the deployed realmobile doesn't provide.

**Patterns to follow:**
- Standard realmobile method-deletion pattern (see `git log --diff-filter=D --summary`).

**Test scenarios:**
- realmobile spawns Percy CLI on iOS session → no `wda-meta.json` file written under `/tmp/<sid>/`.
- realmobile spec covers absence of write call.

**Verification:**
- realmobile PR merged and deployed.
- Host 52 audit (e.g. one week post-deploy): `find /tmp -name 'wda-meta.json' -mtime -7` returns no recent files for any Maestro session.
- No new error reports from Percy CLI customers about iOS element regions.

---

- [ ] **Unit 11: Delete the realmobile contract document and consolidate brainstorms**

**Goal:** Remove documentation for the abandoned contract and leave a clean trail for future readers.

**Requirements:** R8.

**Dependencies:** Unit 10 (contract no longer relevant).

**Files:**
- Delete: `docs/contracts/realmobile-wda-meta.md`
- Modify: `docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md` — add a top "Superseded" banner pointing at `2026-04-27-...-requirements.md` and the Phase 0.5 result.
- Modify: `docs/brainstorms/2026-04-27-ios-element-regions-maestro-hierarchy-requirements.md` — remove the "active only on Phase 0 success" qualifier from the Requirements section header (Phase 0.5 has now passed).
- Modify: `docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md` — front-matter `status: superseded`.

**Approach:**
- Preserve the historical reasoning; supersede rather than delete the older brainstorm.

**Test scenarios:** N/A.

**Verification:**
- `git grep realmobile-wda-meta` shows no remaining references in active docs (PR descriptions are fine).
- The two brainstorm docs read coherently in chronological order.

## System-Wide Impact

- **Interaction graph:** Phase 1 dispatch change touches `api.js` request handler. The new code path runs only when `PERCY_IOS_RESOLVER='maestro-hierarchy'`, so default flows are unchanged. Downstream callers of `@percy/core` exported symbols see the same exports.
- **Error propagation:** All errors from the maestro CLI subprocess (spawn fail, timeout, oversize, parse error) classify into scrubbed reason tags and reach customers as warn-skip log lines. Screenshot uploads never fail because of region resolution.
- **State lifecycle risks:** The maestro CLI subprocess spawns inherit Percy CLI's env vars. Cross-tenant safety relies on realmobile's process-isolation guarantees PLUS the explicit denylist filter on `appPercy.env.*` (see Unit 10a). No shared filesystem state introduced.
- **API surface parity:** The relay's `/percy/maestro-screenshot` request/response contract is unchanged. SDK clients on both platforms continue to send the same payload.
- **Customer-visible V1.0 GA gate (Percy↔BS baseline-linkage):** This SDK-layer plan resolves regions in the outbound payload, but Percy's BrowserStack-orchestrated builds today are treated as `branchline_first_build_empty` because BS assigns a unique `parallel-nonce` per build, preventing auto-baselining. **Customer-facing symptom until that fix lands:** element regions resolve correctly server-side; coordinate-regions show as overlays on snapshot detail pages; **but `applied-regions` is empty on the comparison API and the dashboard does not render the element-region overlays.** Customer who configures element regions sees zero visual evidence the masks landed. Mitigation pre-fix: (a) Phase 1+4 ship behind a "beta" label in release notes with a known-issue callout pointing at the percy-api/percy-web ticket; (b) docs explicitly tell customers to verify behaviour via CLI debug logs (`PERCY_LOGLEVEL=debug` shows resolved bboxes) until dashboard parity lands; (c) v1.0 GA does not announce until the fix is in production. Track the baseline-linkage fix as a separate ticket; this plan is not blocked on it for SDK-layer work but customer launch is.
- **Integration coverage:** Unit tests with mocked `execMaestro` cover the resolver. The cross-platform parity test (Unit 4) is the contract assertion. Phase 0.5 is the only place real iOS hardware exercises the path; that's by design — see brainstorm Scope Boundaries on local-dev.

## Risks & Dependencies

- **BS iOS Maestro infra outage** (project memory: `project_bs_ios_maestro_spawn_breakage.md`) — gates Phase 0.5. Open the BS infra ticket as a parallel track today; do not make Unit 8 progress depend on Phase 1 timing.
- **Realmobile coordination latency on Unit 10a** — Unit 10a is in a different team's repo. Phase 1 code (Units 1-7) can review and merge without it, but Unit 8 (Phase 0.5 production rollout) and Unit 9 (delete) cannot proceed until Unit 10a is **fleet-wide deployed** (not just canary). Mitigation: Unit 10a is purely additive (no risk to existing Percy CLI versions), so realmobile owners can land and deploy it the moment they have bandwidth, in parallel with Phase 1 review.
- **Unit 9 / 10a / 10b sequencing — analyzed across all permutations; safe-degraded under bad orderings; concrete failure modes named.** Worst case in any ordering is iOS element regions warn-skip with `'env-missing'` or `'missing'` for affected customers; coordinate-regions and screenshot uploads unaffected — **no data corruption or upload failure.** Specific permutations:
  - *Canonical (10a fleet-wide → Phase 0.5 PASS → 9 → 10b):* every step is safe.
  - *Bad: 10b before 9 in production:* every Percy CLI customer on the previous CLI minor warn-skips iOS element regions with `'missing'`/`'malformed-json'` until they upgrade. Affects more than just "stragglers" — *every* Maestro customer on the prior minor. Mitigation: Unit 10b PR description specifies a CLI minor-version cutoff (the version that contains Unit 9) and rejects merge until that cutoff is the published latest.
  - *Bad: 9 before 10a fleet-wide:* new Percy CLI tries to read env vars and finds them unset on partial-rollout hosts → `'env-missing'`. Mitigation: Unit 9 PR description requires "Unit 10a deployed across all production hosts" (not just one host) verified before approving.
  - *Bad: 10a partial canary + 9 deployed:* mixed-state where some hosts inject env vars and some don't. Same `'env-missing'` failure mode as above on affected hosts. Mitigation: same as previous — fleet-wide deploy of 10a, not canary, before Unit 9 ships.
  - *Bad: Phase 0.5 false-positive triggers Unit 9 ship → defects discovered post-merge:* Unit 9 rollback is NOT a simple `git revert` — by the time defects are observed in production, Unit 10b may have shipped (deleting the wda-meta writer). Rollback then requires re-landing the writer in realmobile too. Mitigation: **Unit 10b does not merge until Unit 9 has been in production for at least one release cycle without incident** (was implicit; now explicit gate in Unit 10b dependencies).
- **Intra-flow concurrent contention not covered by single-probe Phase 0.5.** A0/A1 only probe one hierarchy call at a time. A1.5 (added during document review) interleaves the probe with parent-flow `tapOn`/`scroll` to catch contention on the gRPC-over-iproxy transport. If A1.5 surprises, no production data corruption — Phase 0.5 is gating, so any failure reverts before Phase 4.
- **Deprecation shim from Unit 1** — `adb-hierarchy.js` re-export. Document in V1.1 release notes; remove in V1.2.
- **Node 14 compat regression** — any new code in `maestro-hierarchy.js` that touches `AbortController`/`fetch`/`Blob`/`structuredClone` must feature-detect via `typeof globalThis.X === 'function'` per `docs/solutions/integration-issues/ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md` Rule 1. The Android template (`adb-hierarchy.js`) is already Node-14-clean (verified during deepening — no risky globals); mirroring it preserves the property by default. Add a CI lint rule or code-review checklist item to catch new violations.
- **XCUI integer→name table maintenance** — Apple introduces new `XCUIElement.ElementType` values with each Xcode SDK release (rarely; ~1-2 per major release). The `XCUI_ELEMENT_TYPE_BY_INTEGER` map needs occasional updates. Track via a once-yearly audit task (or scheduled agent) rather than reactive — missing entries gracefully fall through (selector simply doesn't match), so a stale table is degraded-coverage, not a bug.
- **Test fixture freshness** — the iOS hierarchy fixture captured during Unit 8 should be re-captured on each major iOS / Maestro version bump to catch JSON-shape drift. Schedule the same way as the XCUI table audit.

## Documentation / Operational Notes

- `README.md` (this repo) and `../percy-maestro-android/README.md` updated in Phase 2.
- A short Slack/Confluence post in the percy-maestro coordination channel announcing Phase 1 merged + Phase 0.5 pending.
- `/schedule` an agent for 2026-05-04 (one week) to re-check BS infra health and re-run the Phase 0 spike.
- After Phase 0.5 PASS and Unit 9 merge: bump `@percy/core` minor version; coordinate release with realmobile owner (Unit 10).
- After Unit 10 deploy: `/schedule` a one-time agent for 2026-06-XX to verify no `wda-meta.json` writes show up in production realmobile logs (sanity check that the cleanup actually shipped).

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-27-ios-element-regions-maestro-hierarchy-requirements.md`
- **Spike findings:** `docs/experiments/2026-04-27-maestro-hierarchy-spike/findings.md`
- **Prior plan (superseded by this one + Phase 0.5):** `docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md`
- **Prior brainstorm:** `docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md`
- **Solutions doc carrying the Node 14 / WDA sid lessons:** `docs/solutions/integration-issues/ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md`
- **Android resolver template:** `cli/packages/core/src/adb-hierarchy.js`
- **realmobile `--driver-host-port` formula:** `/usr/local/.browserstack/realmobile/lib/session/maestro_session.rb:831`
- **Maestro CLI source (for JSON shape verification):** `https://github.com/mobile-dev-inc/maestro`

## Alternative Approaches Considered

- **Finish Plan A (WDA-direct via PER-7281)** — rejected. Sunk cost on iOS-specific resolver doesn't outweigh the carrying cost of two architectures, eight security tests, and the cross-team realmobile coordination lock-step. (Memory: `feedback_cross_platform_parity_over_sunk_cost.md`.)
- **Dual-path in production (B primary, A fallback)** — rejected. Doubles failure modes for support; the fallback is theoretical on BS hosts where maestro CLI is always present.
- **Process-scan fallback when env vars missing** — rejected for V1. Adds shell-out fragility for a marginal robustness gain. If env vars missing on iOS, warn-skip cleanly and surface the misconfiguration in the deploy README.
- **Land Phase 1 code only after Phase 0.5 passes** — rejected in favour of env-switch gating. Lets the code merge in review while spike result is fresh; switch flip is the small final step.

## Phased Delivery

- **Phase 1** (Units 1-4 in `@percy/cli` + Unit 10a in realmobile, parallelizable): land additive resolver code in `@percy/cli` behind `PERCY_IOS_RESOLVER` env switch (default off); land additive env-var exports in realmobile `cli_manager.rb`. No customer-visible behaviour change. Unit 10a is purely additive — existing Percy CLI versions ignore the new env vars.
- **Phase 2** (Units 5-7): docs and probe artifact. Can land in parallel with Phase 1.
- **Phase 0.5** (Unit 8): empirical probe re-run when BS infra is healthy AND Unit 10a is deployed (env vars must be present for the maestro-hierarchy path to work end-to-end). **Blocks Phase 4.**
- **Phase 4** (Units 9, 10b, 11): WDA-direct deletes in `@percy/cli` (Unit 9) → realmobile wda-meta writer cleanup (Unit 10b) → contract document removal + brainstorm consolidation (Unit 11). Sequencing inside Phase 4: Unit 9 must reach production before Unit 10b. Released as a `@percy/core` minor bump.
