---
date: 2026-05-06
topic: cross-platform-maestro-resolver-unification
---

# Cross-Platform Maestro View-Hierarchy Resolver Unification

## Problem Frame

Percy's element-region resolver uses a different transport on each platform, and the iOS path has a known failure class:

| Path | Where | Transport | Status |
|---|---|---|---|
| Android (master) | `cli/packages/core/src/maestro-hierarchy.js` | `maestro hierarchy` CLI shell-out | ~9s p50 (JVM cold start) |
| Android (PR #2210) | same file, branch `feat/grpc-element-region-resolver` | gRPC to `dev.mobile.maestro` device port 6790 | sub-100ms; **OPEN, gated on real-device harness + fixture capture** |
| iOS (master) | `cli/packages/core/src/wda-hierarchy.js` | WDA `/session/:sid/source` HTTP source-dump | works, but **fails when AUT bundleId is not running** (`invalid element state` / `[FBRoute raiseNoSessionException]`) |
| iOS WIP | branch `feat/ios-element-regions-maestro-hierarchy` | `maestro hierarchy` CLI shell-out behind `PERCY_IOS_RESOLVER` | slow path, parallel attempt at iOS unification |

The original brainstorm asked for "gRPC on both platforms." Source-of-truth check against Maestro upstream (`mobile-dev-inc/Maestro`):
- **Maestro has exactly one proto file:** `maestro-proto/src/main/proto/maestro_android.proto`. Package `maestro_android`, service `MaestroDriver`. There is no `maestro_ios.proto`, no unified gateway proto.
- **Maestro's iOS driver uses HTTP**, not gRPC. `maestro-ios-driver/src/main/kotlin/xcuitest/XCTestDriverClient.kt` is built on `OkHttpClient`; its `viewHierarchy(installedApps, excludeKeyboardElements)` is a JSON HTTP POST.
- **PR #2210's own scope statement** confirms iOS is out of scope and `wda-hierarchy.js` is unchanged — its authors hit the same upstream boundary.

So gRPC-on-iOS is impossible at the wire level. The unification target is one Percy-side resolver API that speaks each platform's native Maestro transport (gRPC on Android, HTTP-XCTest on iOS). The win is dropping the iOS WDA-direct failure class and reducing two divergent code paths to one resolver interface.

## Requirements

- **R1.** Percy CLI's `/percy/maestro-screenshot` relay resolves element regions by talking to Maestro's native driver transport on each platform: gRPC on Android (per PR #2210), HTTP-XCTest runner on iOS (new).
- **R2.** A single Percy-internal resolver interface dispatches to the platform-appropriate transport. The relay's external contract (request/response shape on `/percy/maestro-screenshot`) is unchanged. SDK callers see no difference.
- **R3.** iOS native-transport path calls Maestro's `XCTestDriverClient`-style HTTP runner endpoint for view hierarchy. Port discovery uses the existing `driver_host_port = wda_port + 2700` formula on realmobile, plus an env override (e.g. `PERCY_MAESTRO_IOS_DRIVER_PORT`).
- **R4.** Both platforms have a graceful fallback to `maestro hierarchy` CLI shell-out on connection-class failures. The existing `feat/ios-element-regions-maestro-hierarchy` work becomes iOS's fallback path, not its primary.
- **R5.** Both platforms surface contract drift on `/percy/healthcheck`. The existing `maestroHierarchyDrift` dirty bit from PR #2210 is extended to cover iOS (one field, with a `platform` discriminator).
- **R6.** For the same flow + same logical element selector, Android and iOS resolve to matching pixel bboxes (within ±2px tolerance for sub-pixel rounding). Verified by a cross-platform parity fixture.
- **R7.** `wda-hierarchy.js` is retired only after iOS native-transport has been stable in production for ≥1 week (mirrors PR #2210's Unit-5-split conservatism for `runAdbFallback`).
- **R8.** SDK requires zero changes — region payload contract is stable. The shipping `1.0.0-beta.1` SDK works against a CLI on either the old (WDA) or new (Maestro HTTP) iOS resolver.
- **R9.** Kill switch: `PERCY_MAESTRO_IOS_RESOLVER=wda` short-circuits to the legacy WDA-direct path during the post-rollout window. Logged at WARN on every dump call so rollback state is observable.

## Success Criteria

- iOS element-region snapshots no longer fail with WDA's "invalid element state — application under test is not running" error class. Verified by reproducing the failure on a flow that crashes/terminates/backgrounds the AUT mid-test before the snapshot.
- Percy CLI debug logs show `via maestro-grpc` (Android) and `via maestro-http` (iOS) on >99% of element-region dumps within 1 week of rollout on a single BS host.
- Cross-platform parity fixture passes: same flow + same logical selector → matching bboxes on Android and iOS.
- p95 iOS region resolution latency ≤ 1s (looser than Android's 100ms because HTTP + JSON walk is heavier than gRPC bytes; a V1.1 perf phase can tighten this if telemetry warrants).

## Testing & Validation

End-to-end validation runs against real BrowserStack hosts on both platforms. The host-deployment mechanics (branch sync, overlay verification, `cli_manager.rb` patch, `Flows.zip` shape, per-session port discovery, `appPercy` payload, `machine:<ip>:<udid>` pinning, on-host log verification) are **not** re-derived here — they live in:

> **Procedural source of truth:** `docs/solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md` — the canonical 9-step procedure, validated 2026-05-06 on Galaxy S22 (Android, host `31.6.63.33`) and iPhone 14 (iOS, host `185.255.127.52`). Includes the failure-mode → step-that-closes-it traceability table.

### Resolver-specific validation (on top of the procedural foundation)

#### V1. Unit / fixture tests in `cli/packages/core/test/unit/`

- **V1.1** Reuse PR #2210's gRPC unit suite (`maestro-hierarchy-grpc.test.js`, 45 specs) unchanged for Android.
- **V1.2** New iOS unit suite (`maestro-hierarchy-ios-http.test.js`) parallels #2210's coverage matrix:
  - Healthy `viewHierarchy` HTTP 200 → parsed bbox.
  - Connection-class failures (ECONNREFUSED, ETIMEDOUT, socket reset) → fall back to `maestro hierarchy` CLI shell-out (R4).
  - Schema-class failures (unexpected JSON shape, missing `bounds`/`children`) → no fallback; flip healthcheck dirty bit (R5).
  - 20 MB response cap, loopback-only URL guard, log scrubbing — same security properties as `wda-hierarchy.js`.
- **V1.3** Real-fixture capture: vendor an iOS `viewHierarchy` JSON response from a live BS realmobile session, following PR #2210's `grpc-capture-notes.md` shape (temp `console.log`, deploy via host overlay, capture, save, revert). Without this, V1.2 specs run against synthesized fixtures and skip the wire-format check that bit `PERCY_LABELS`.

#### V2. Cross-platform parity fixture

- **V2.1** Same example app, same logical selector (e.g. `text: "Submit"` or `class: ...FrameLayout`), same flow on Android + iOS. Both resolvers return bboxes within ±2px tolerance for sub-pixel rounding. Lives at `cli/packages/core/test/integration/cross-platform-parity.harness.js`. Env-gated on `MAESTRO_PARITY_DEVICES=<android-serial>:<ios-udid>`; skips silently in CI.
- **V2.2** Failure case: same selector that doesn't match returns `firstMatch=null` on both platforms with identical "Element region not found" warning shape (R6).

#### V3. WDA failure-class regression (the iOS motivation)

- **V3.1** Repro flow that intentionally terminates the AUT mid-test (e.g., `- killApp: <bundle>`) before a `- takeScreenshot` with element regions.
- **V3.2** Pre-fix (today's `wda-hierarchy.js`): expect HTTP 500 from WDA `/source` with `[FBRoute raiseNoSessionException]` + element regions silently skipped + `[percy] Warning: Element region not found` in maestro.log.
- **V3.3** Post-fix (Maestro HTTP runner path): expect element regions to resolve cleanly because `XCTestDriverClient.viewHierarchy` walks the system UI tree without bundleId binding.
- **V3.4** Captured as a YAML fixture under `cli/packages/core/test/integration/fixtures/ios-aut-crash-regions.yaml`.

#### V4. Concurrent-access harness (parity with #2210's R6 merge gate)

- **V4.1** Run `cli/packages/core/test/integration/maestro-hierarchy-concurrent.harness.js` on Android (existing — from #2210), capture p50/p95/p99. Bump `GRPC_HEALTHY_DEADLINE_MS` per #2210's KTD if `p99 ≥ 250ms × 0.9`.
- **V4.2** Mirror the harness for iOS (`maestro-hierarchy-ios-http-concurrent.harness.js`). Looser SLO: `HTTP_HEALTHY_DEADLINE_MS = 1500ms` (gRPC bytes vs JSON tree walk). Same paste-output-in-PR merge gate shape.

#### V5. End-to-end on real BS host (single host, both platforms)

Follows the procedural source-of-truth doc verbatim, plus these resolver-specific assertions in addition to "Percy build appears with N snapshots":

- **V5.1 Android** (host `31.6.63.33`, Galaxy S22, branch `feat/grpc-element-region-resolver` already validated by #2210's own merge gate; this re-runs once the iOS sibling lands so we exercise both transports in the same overlay):
  - `[percy:core:maestro-hierarchy] dump took Nms via grpc (N nodes)` appears in `/var/log/browserstack/percy_cli.<sid>_<port>.log` for ≥1 element-region snapshot.
  - `curl http://localhost:<cli_port>/percy/healthcheck | jq '.maestroHierarchyDrift'` returns `null`.
- **V5.2 iOS** (host `185.255.127.52`, iPhone 14, both element-region snapshot AND AUT-crash-regression flow from V3):
  - `[percy:core:maestro-hierarchy] dump took Nms via maestro-http (N nodes)` for the happy path.
  - The crash-regression flow's snapshot resolves the element region (does NOT fall through to the WDA error class).
  - Healthcheck `maestroHierarchyDrift` (with iOS platform discriminator per R5) returns `null`.
- **V5.3** Cross-platform parity: same selector resolves to within-tolerance bboxes across the V5.1 + V5.2 runs.

### Pre-merge gate

A PR is mergeable only when:

1. The procedural foundation steps (Steps 1–9 from the source-of-truth doc) all checked off.
2. V1, V2, V4 unit + harness output pasted into the PR description (matches #2210's gate shape).
3. V3 regression fixture passes both pre-fix (negative) and post-fix (positive) assertions.
4. V5 E2E on the pinned BS host pastes (a) the `dump took ... via maestro-grpc/maestro-http` log line, (b) the Percy build URL, (c) the healthcheck JSON response.

### Post-rollout monitoring

After merge, use the same observability surface PR #2210 defined — extended for iOS:

- `grep "via maestro-grpc" percy-cli-debug.log | wc -l` vs `grep "via maestro-http" ...` vs `grep "via maestro-cli-fallback"` — primary path should dominate (>99%) on each platform within 1 hour on a single host.
- `/percy/healthcheck` `maestroHierarchyDrift` field absent in steady state on both platforms.
- Failure signal: any non-null drift → re-vendor the affected proto (Android) or fixture (iOS) and ship a patch CLI release.
- Rollback: `PERCY_MAESTRO_GRPC=0` (Android, from #2210) and `PERCY_MAESTRO_IOS_RESOLVER=wda` (iOS, R9) — both route to legacy paths without redeploy.
- Validation window: 1 week post-rollout for the dominance check; ongoing for healthcheck drift.

## Scope Boundaries

- Out of scope: SDK changes. Region payload contract is stable.
- Out of scope: Web/desktop Maestro flows.
- Out of scope: Tap / launch / screenshot / any RPC other than view-hierarchy retrieval. Everything else continues through the existing Maestro CLI command surface.
- Out of scope: Pushing gRPC support upstream into Maestro iOS.
- Out of scope: Replacing WDA for non-region purposes (e.g., Maestro's own taps/screenshots stay on WDA via Maestro itself).
- Out of scope: Reducing iOS p95 below 1s in V1. Failure-class fix and unification are V1; perf tightening is a V1.1.

## Key Decisions

- **Speak Maestro's native transport on each platform; don't try to unify the wire protocol.** Maestro upstream has gRPC for Android only. Forcing gRPC onto iOS would require either upstream changes (slow, external) or running our own gRPC wrapper around WDA (carrying cost, fragile). One Percy-side resolver API + native transports is the right boundary.
- **Use Maestro's iOS HTTP runner instead of WDA-direct.** WDA's session-binding failure (`invalid element state` when AUT bundleId is not running) is a real, observed production issue. Maestro's runner walks the system UI tree without binding to a specific bundleId, eliminating that failure class structurally.
- **Match PR #2210's fallback + healthcheck + kill-switch shape on iOS.** Predictable rollback story, single mental model for ops, identical observability surface.
- **Reposition `feat/ios-element-regions-maestro-hierarchy` as the iOS fallback path.** Don't throw it away; it's the slow-but-reliable graceful-degradation tier.
- **Defer `wda-hierarchy.js` deletion until iOS native-transport is stable in production.** Same conservatism as PR #2210's `runAdbFallback` Unit-5 split.

## Dependencies / Assumptions

- PR #2210 either lands on `cli/master` before iOS work begins, OR iOS is developed on top of the same branch and they ship together. Sequencing is a planning question; both are acceptable.
- Maestro's iOS HTTP runner port is discoverable on BS realmobile hosts (the `driver_host_port = wda_port + 2700` formula is already proven by Percy's existing `wda-session-resolver.js`). Legacy mobile fleet may differ.
- Maestro's `XCTestDriverClient.viewHierarchy` JSON response shape is stable across the Maestro CLI versions vendored on BS hosts. (Will be validated during planning by capturing a real fixture, the same way PR #2210 vendored the Android proto at a pinned commit.)
- BS iOS Maestro infra is healthy enough to validate end-to-end. Recent memory: iOS Maestro spawn-step has had outages — that may block validation, not architecture.
- Percy CLI runs on the same host as Maestro's iOS driver (loopback-only HTTP), matching today's WDA-direct deployment shape.

## Outstanding Questions

### Resolve Before Planning

*(none — all blocking product questions resolved)*

### Deferred to Planning

- **[Affects R3][Needs research]** What exactly does Maestro's iOS HTTP runner expose for view hierarchy retrieval? Endpoint path, method, request body, JSON response shape, error envelope. Capture a real wire fixture from BS realmobile (same procedure as PR #2210's `grpc-capture-notes.md`) and vendor it.
- **[Affects R3][Needs research]** Does the `wda_port + 2700` driver-host-port formula hold on the legacy BS mobile fleet (Appium-based hosts), or only on realmobile? If different, port discovery needs a fleet branch.
- **[Affects R3][Technical]** Where should iOS port discovery live — extend `wda-session-resolver.js` to also surface the Maestro driver port, sibling a new `maestro-driver-resolver.js`, or env-only? Decide based on existing pattern fit.
- **[Affects R6][Needs research]** Does Maestro's iOS `ViewHierarchy` JSON shape match the UiAutomator XML that the Android gRPC path emits, or is it a different shape requiring its own flatten/parse logic? Determines how much of `flattenNodes` / `sliceXmlEnvelope` is reusable on iOS.
- **[Affects R4][Technical]** iOS fallback wiring: when Maestro HTTP fails connection-class, fall back to `maestro hierarchy` CLI shell-out (matches Android), or to WDA-direct (existing code, but has its own failure class)? Probably the former for symmetry, but worth confirming.
- **[Affects R5][Technical]** Healthcheck shape: extend existing `maestroHierarchyDrift` to a single field with a `platform` discriminator, vs. add a parallel `maestroIosDriverDrift`. Decide during planning.
- **[Affects R7][Sequencing]** Build iOS on top of `feat/grpc-element-region-resolver`, or wait for it to merge first? Both ship; choice depends on team/review bandwidth.
- **[Affects R1][Technical]** Naming: PR #2210 named the file `maestro-hierarchy.js` (post-rename from `adb-hierarchy.js`). With iOS added, does that file split into per-platform modules, or stays unified with internal platform branching?

## Next Steps

→ `/ce:plan` for structured implementation planning
