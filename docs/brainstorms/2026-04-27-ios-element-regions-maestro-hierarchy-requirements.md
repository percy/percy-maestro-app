---
date: 2026-04-27
topic: ios-element-regions-maestro-hierarchy
supersedes: docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md (conditional on Phase 0 spike outcome)
---

# iOS element regions via `maestro hierarchy` — cross-platform parity

## Problem Frame

iOS Maestro customers on BrowserStack need element-based `PERCY_REGIONS` to mask dynamic content (ads, avatars, timestamps). Coordinate-based regions don't cut it — those elements move between runs.

A WDA-direct path (current `feat/sdk-feature-parity` work) is ~80% proven on real hardware but blocked on PER-7281 in **realmobile** (WDA's pre-spawned session is attached to the wrong app; Maestro launches via xcuitest, never re-attaches WDA). Coordination time + a tenant-scoped FS contract + 8 security acceptance tests are the carrying cost of that path.

Percy's Android Maestro SDK already resolves element regions through `maestro --udid <serial> hierarchy` (`@percy/core/src/adb-hierarchy.js` — primary path is maestro, not adb, despite the filename). The same CLI subcommand exists for iOS. If it works during an active `maestro test` on iOS, iOS and Android collapse to a single resolver, the realmobile contract goes away, and customers see one mental model across both platforms.

The brainstorm ruled this out on 2026-04-22 ("session-exclusive, can't run during active flow") but never empirically tested it on iOS. Android's own implementation contradicts the claim.

## Phase 0 — Spike before commit

> **Spike result (2026-04-27):** see `docs/experiments/2026-04-27-maestro-hierarchy-spike/findings.md`.
> **Empirical A0/A1/A2/A3 are all UNVERIFIED** — 5 BS Maestro builds in a row failed at the iOS maestro-spawn step with a deterministic 27-33 s session lifetime, including post-`restart_servers` and unpinned attempts. The same breakage blocks the WDA-direct path too. **Architectural evidence is strong**, however: maestro CLI is present on BS iOS hosts (`/nix/store/.../maestro-cli-{2.1,2.2,4,5}`), realmobile already drives it via `--device=<udid> --driver-host-port <P>` where `P = wda_port + 2700` (deterministic), and the device-side `dev.mobile.maestro-driver-iosUITests.xctrunner` xctest bundle is the iOS analogue of Android's `dev.mobile.maestro` app.
>
> **Decision: commit to B on architecture; the empirical probe becomes Phase 0.5 in the implementation plan, gating the WDA-direct delete.** Open a parallel ticket with BS Maestro infra for the spawn-step failure, since it blocks all iOS Maestro paths.

A 2-4h probe on a BS iOS host (e.g. host 52) decides A vs B. **No production code changes until spike data lands.**

Probe steps:
1. Trigger a BS Maestro iOS build pinned to a controllable host.
2. Mid-flow (~10 invocations across the run), shell into the host and run `maestro --udid <device-udid> hierarchy` against the active session's device.
3. Capture: exit code, stdout JSON (full tree), stderr, wall-clock latency per call, parent flow's per-step outcome.
4. Inspect emitted JSON for `accessibilityIdentifier` and an XCUIElement-type-equivalent attribute on at least one button-class node.

**Commit-to-B acceptance bar (all four must hold):**
- **A0.** `maestro hierarchy` exits 0 and emits parseable JSON during the active flow.
- **A1.** Parent `maestro test` still passes — every `tapOn` / `assertVisible` step succeeds. No new stale-element / session-busy failures introduced by the concurrent hierarchy calls.
- **A2.** Latency p95 < 3000 ms across the 10 calls. (Android resolver permits 15s; budget here is for customer-perceived per-screenshot overhead.)
- **A3.** Returned JSON exposes both `accessibilityIdentifier` (or an equivalent attribute carrying the iOS accessibility id) and an XCUIElement-type-equivalent class attribute on real nodes. Without both, R1's `id` and `class` selectors can't be resolved through this path.

**Spike outcomes:**
- All four pass → Phase 1 below activates; WDA-direct code is ripped out.
- Any one fails → revert to the 2026-04-22 plan (PER-7281 with realmobile).
- A2 fails by a small margin only → reconsider with a budget renegotiation; not auto-revert.

## Requirements (active only on Phase 0 success)

- **R1. One selector vocabulary across platforms.** V1 supports `id` and `class` identically on iOS and Android. The CLI relay dispatches to a single resolver module by `payload.platform`. The iOS branch maps:
  - `id` → maestro hierarchy's `accessibilityIdentifier` attribute (iOS).
  - `class` → maestro hierarchy's iOS class attribute (the equivalent of Android's `class`); short-form (`Button`) accepted as a convenience and normalized to long-form (`XCUIElementTypeButton`) in exactly one place. Allowlist-validated against the XCUI element-type set already in `wda-hierarchy.js#XCUI_ALLOWLIST` (carry that constant over).
  Android's existing `resource-id`/`text`/`content-desc`/`class` selector set is unchanged in this V1; Android-side unified-key migration (`resource-id` → `id`) stays out of scope.
- **R2. Deterministic first-match.** When a selector matches multiple nodes, use the first one in tree order. Same as Android.
- **R3. Customer-friendly warn-skip on zero-match.** Log a single line naming the selector **key** and the **length** of the value (never the value — selector strings are customer-controlled and may carry PII). Skip that region; other regions in the same `PERCY_REGIONS` array still go through; the screenshot upload still succeeds.
- **R4. Scale factor handling — direction set, magnitude TBD.** Spike output determines whether maestro hierarchy returns bounds in **points** or **pixels** on iOS:
  - If pixels: no scale conversion; bounds flow directly into the outbound payload (subject to R7 validation).
  - If points: apply the existing width-ratio approach from `wda-hierarchy.js` (`raw = pixel_width ÷ logical_width`; snap to {2, 3}; fail-closed outside [1.9, 3.1]). PNG IHDR parsing (B1 module) survives; the WDA `/wda/screen` round-trip does not.
  Decision deferred to planning, gated on Phase 0 evidence.
- **R5. SDK pre-relay gate stays removed.** B5 (`812563e`) already removed the SDK-side element-region warn-and-skip and bumped clientInfo to `1.0.0`. No further SDK changes for this path. Shape validation lives in the CLI relay.
- **R6. Cross-tenant safety via udid scoping (no shared FS state).** Percy CLI passes `--udid <iOS-device-udid>` to maestro. The udid is sourced from a Percy-CLI-controlled env var that BrowserStack sets per-session (e.g. `IOS_DEVICE_UDID` or equivalent — confirm during spike). The maestro CLI process is the only addressing surface; no `/tmp/<sid>/wda-meta.json` file, no FS race attack surface, no realmobile coordination required. The 8 security acceptance tests from the WDA-direct path do not carry over.
- **R7. Customer-friendly relay-side hardening:**
  - Maximum selector string length: 256 chars (iOS path) / 512 chars (Android path, unchanged).
  - Spawn timeout: 15s (Android parity; covers JVM cold start). On timeout, warn-skip with a distinct reason tag.
  - Output size cap: 20 MB (iOS apps with WebViews emit large trees). Streamed read with the cap enforced before any parse begins. The Android module's 5 MB cap stays unchanged for V1; revisit after one production cycle.
  - No selector values, no full hierarchy response bodies, and no element-tree contents in Maestro stdout on any path. Logs carry only: selector key, value length, result status, duration, scrubbed reason tag.
  - Bbox validation: in-bounds (`0 ≤ left < right ≤ width`, `0 ≤ top < bottom ≤ height`) and non-trivial area (`≥ 4×4 px`). Carries over from R7 of the WDA-direct doc.
  - Per-screenshot region cap: reuse the existing validator (~50 regions).
- **R8. Documentation written for one mental model.**
  - One `PERCY_REGIONS` table covering both platforms with a single selector vocabulary column.
  - Copy-pasteable Maestro flow examples for **both** iOS and Android, side-by-side, demonstrating that the same yaml works on both.
  - The R7 disclaimer that `PERCY_REGIONS` is not a security boundary.
  - V1.1 follow-ups (`text`, `xpath`) named with a single roadmap entry — applies to both platforms simultaneously.
  - Local-dev gap (running outside BrowserStack) explicitly called out: the maestro binary path may need configuration via `MAESTRO_BIN`. Same caveat as Android's existing module.
- **R9. Single resolver module, platform dispatch.** `@percy/core/src/adb-hierarchy.js` is renamed to `maestro-hierarchy.js`. The exported `dump()` and `firstMatch()` functions accept platform-tagged input; the platform branch lives at the top of `dump()`. The shape returned to the caller is identical across platforms — the caller (`api.js`) doesn't branch on platform when consuming the resolver output. Tests for both platforms live in one test file.
- **R10. Customer fail-open for non-element regions.** A maestro-hierarchy failure (binary missing, timeout, parse error) warn-skips **only** the element-based regions in that screenshot's `PERCY_REGIONS` array. Coordinate-based regions in the same array still ship; the screenshot still uploads. Customers never see a screenshot upload fail because of a region resolution issue.

## Success Criteria

- **Customer-visible parity:** an iOS Maestro flow with `PERCY_REGIONS: '[{"element":{"id":"my-button"}, "algorithm":"ignore"}]'` produces the same outbound CLI payload shape as the equivalent Android flow. Customers writing one yaml-block work on both platforms.
- **Payload-level verifiable without backend fix:** the outbound POST to Percy's comparison-upload endpoint contains the resolved element region with correct pixel coordinates. Verifiable from CLI debug logs alone.
- **Visual-overlay spot-check:** a debug-channel PNG with red-rectangle overlays of resolved regions, locally composited from the captured screenshot. Carries over from the 2026-04-22 doc.
- **End-to-end dashboard outcome (V1.0 GA gate):** once Percy's BrowserStack baseline-linkage limitation is resolved, the region appears as a visual overlay in the snapshot detail page and as a populated `applied-regions` field on the comparison API. Same gate as the WDA-direct doc — independent of resolver path.
- **Adding a new iPhone model is zero-code.** No device catalog, no scale-factor table.
- **Code-surface reduction:** WDA-direct modules (`wda-hierarchy.js`, `wda-session-resolver.js`, `png-dimensions.js` if R4 lands "pixels"), the `realmobile-wda-meta.md` contract, and realmobile's `cli_manager.rb#write_wda_meta` are all deleted in the same commit-set that lands B. Net code change is meaningfully negative.

## Scope Boundaries

- **Out:** `text` and `xpath` selectors. V1.1 on both platforms simultaneously.
- **Out:** Landscape mode. V1 portrait-only, with explicit detection + warn-skip when rotated. Detection signal: maestro hierarchy output may carry orientation; otherwise screenshot aspect-ratio heuristic.
- **Out:** Multi-element selector composition (AND / OR within one `element: {}`).
- **Out:** Local-dev parity beyond BrowserStack. `npx percy app:exec -- maestro test` outside BS works only if the local environment has a maestro binary on PATH; same constraint as Android's resolver.
- **Out:** realmobile coordination. No `/tmp/<sid>/wda-meta.json`, no security acceptance tests against realmobile, no contract sign-off blocking V1.
- **Out:** Android `resource-id` → `id` unified-key migration. Tracked separately.
- **Out:** Percy↔BS baseline-linkage fix. V1.0 GA gates on it but the SDK-layer work doesn't.

## Key Decisions

- **Customer-first principle drives architectural choice.** "Same yaml, same docs, same mental model" outweighs the local engineering preference to finish what's already built. The customer-friendly bar (per the user's spec) wins over the sunk-cost bar.
- **Spike-gated commitment.** No code change before Phase 0 lands. If the spike fails, the WDA-direct path resumes — no work lost beyond the spike script.
- **Rip out WDA-direct entirely on success, no fallback.** Mirroring Android's `maestro hierarchy → adb` fallback was rejected: it doubles test surface, doubles failure modes for customer support to reason about, and the maestro path is the only one that works during an active flow on Android (the adb fallback is theoretical for off-BS environments). For iOS, the equivalent fallback (WDA-direct) is dead code on BS once maestro works. Less code, fewer paths to ship and own.
- **realmobile dependency dropped.** This is the largest unlock. The 2026-04-22 doc treated `wda-meta.json` as a hard dependency; B has zero realmobile coordination requirement. PER-7281 becomes irrelevant for this feature.
- **One resolver module across platforms.** `maestro-hierarchy.js` (renamed from `adb-hierarchy.js`). The XCUI allowlist constant moves from `wda-hierarchy.js` into the renamed module. `firstMatch()` extends to accept iOS attribute keys.

## Dependencies / Assumptions

- **maestro binary is on PATH on BS iOS hosts.** Same assumption as Android. BS hosts run `maestro test` already, so this holds.
- **iOS device UDID is reachable to Percy CLI as an env var.** Spike confirms which env var (likely `IOS_DEVICE_UDID` or set by realmobile alongside `PERCY_SESSION_ID`). If realmobile already exports a usable variable, no realmobile change. If not, a single env-var addition is the minimal coordination — far smaller than the wda-meta contract.
- **maestro CLI on iOS supports `hierarchy` subcommand at parity with Android.** Plausible (Maestro is a unified CLI) but verified during Phase 0.
- **Phase 0 outcome will be empirically clear within one BS Maestro build cycle (~3 min run + a few re-runs).**

## Outstanding Questions

### Resolve Before Planning

(None. Phase 0 spike is the gating artifact and lives ahead of planning, not behind it.)

### Deferred to Planning

- **[Affects R4][Spike-data-driven]** Does iOS `maestro hierarchy` return bounds in points or pixels? Determines whether scale-factor handling (and the PNG IHDR module) survives.
- **[Affects R6][Tech]** Which env var carries the iOS device UDID into the Percy CLI process on BS hosts? If none does today, what's the minimal realmobile-side change to surface one? Document the env-var name in a short README addendum to the contract folder.
- **[Affects R1, customer DX][Tech]** What's the exact iOS attribute name in maestro hierarchy JSON for the XCUI element type? Confirms the resolver mapping. Falls out of A3 inspection.
- **[Affects R7][Needs measurement]** What's a realistic max output size from a real iOS app (especially WebView-heavy apps)? Re-check the 20 MB cap against actual telemetry once one production cycle has run.
- **[Affects R10][Needs research]** Does maestro hierarchy on iOS exhibit any unique transient failure modes (xcuitest connection drops, device-locked timeouts) that the Android module hasn't seen? Surface during planning's E2E checklist.

## Alternatives Considered

- **Option A — finish WDA-direct + PER-7281 in realmobile.** Closer to done in absolute terms (~80% of code already shipped/proven). Rejected because: (a) blocked on cross-team coordination with no committed timeline, (b) carries 8 security acceptance tests as ongoing operational debt, (c) creates an iOS-specific mental model the customer has to learn, (d) leaves Percy with two resolver architectures to maintain forever.
- **Option D — dual-path (maestro hierarchy primary, WDA-direct fallback).** Rejected because: (a) the failure modes maestro hierarchy fallback would catch are theoretical on BS hosts, where maestro is always present, (b) doubles the test matrix for support, (c) the WDA-direct fallback would never be exercised in production and would rot. Customer wins from one mental model are bigger than the marginal robustness gain.
- **Reverse direction — port iOS WDA-direct to Android too.** Briefly considered for symmetry. Rejected: Android's `maestro hierarchy` path is the primary mechanism that *works during a live flow*; the adb fallback is for off-device scenarios. Asking Android to adopt WDA-equivalent (uiautomator with shared-state lock-fighting) would make the resolver worse, not better.

## Next Steps

→ Run Phase 0 spike on a BS iOS host. Capture data per A0–A3.
→ If spike passes: `/ce:plan` with this doc as input. The plan should explicitly enumerate the deletes (wda-hierarchy.js, wda-session-resolver.js, realmobile-wda-meta.md, cli_manager.rb#write_wda_meta) alongside the additions.
→ If spike fails: this brainstorm closes; resume `/ce:plan` against the 2026-04-22 WDA-direct doc and chase PER-7281 with realmobile.
