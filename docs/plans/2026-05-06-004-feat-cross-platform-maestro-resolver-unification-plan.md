---
title: Cross-Platform Maestro View-Hierarchy Resolver Unification
type: feat
status: active
date: 2026-05-06
deepened: 2026-05-07
origin: docs/brainstorms/2026-05-06-cross-platform-maestro-resolver-unification-requirements.md
---

# Cross-Platform Maestro View-Hierarchy Resolver Unification

## Overview

Add an HTTP transport for iOS element-region resolution that talks to Maestro's `XCTestDriverClient.viewHierarchy` endpoint (`POST /viewHierarchy` with `{appIds: [], excludeKeyboardElements: false}` body, `{axElement, depth}` response), replacing the WDA-direct `/source` path that fails with `[FBRoute raiseNoSessionException]` whenever the AUT is not the foreground bundleId. The HTTP path slots in alongside the Android gRPC primary (PR #2210) under the existing `PERCY_IOS_RESOLVER=maestro-hierarchy` switch, sharing the maestro-CLI shell-out as graceful fallback. **No bundle ID discovery needed** — at the realmobile production-default Maestro version `cli-2.0.7`, PR #2365 has landed and the server detects the AUT itself via `RunningApp.getForegroundApp()`. For older Maestro versions where empty `appIds` returns SpringBoard, the parser detects the SpringBoard-only response and routes to maestro-CLI shell-out (which knows the AUT internally via Maestro's flow context). No SDK changes (R8); no realmobile control-plane changes; no test-suite YAML scraping. The default flip is **telemetry-gated AND environment-conditional** (Unit 3b — follow-up PR): `maestro-hierarchy` becomes default only when `PERCY_IOS_DRIVER_HOST_PORT` is present in env (the realmobile-deployment signal). Self-hosted iOS Percy customers running their own local Maestro keep `wda-direct` as default and preserve today's sub-second WDA happy path; they can still opt in explicitly. WDA-direct (`wda-hierarchy.js`) retirement is a further follow-up (Unit 8) after ≥1 week of post-flip stability.

## Problem Frame

(see origin: `docs/brainstorms/2026-05-06-cross-platform-maestro-resolver-unification-requirements.md`)

Today three resolver paths coexist with different transports per platform, and the iOS path has a known structural failure class:

| Path | Transport | Failure mode |
|---|---|---|
| Android master | `maestro hierarchy` CLI shell-out | ~9s p50 (JVM cold start) — slow but reliable |
| Android PR #2210 (open) | gRPC `dev.mobile.maestro:6790` | <100ms — already implemented, in review |
| iOS master | WDA `/session/:sid/source` | **Fails** with `[FBRoute raiseNoSessionException]` whenever the AUT bundleId is not the foreground app (crash, terminate, app-switch mid-flow) |
| iOS WIP branch `feat/ios-element-regions-maestro-hierarchy` | `maestro --udid --driver-host-port hierarchy` CLI shell-out, scaffolded under `PERCY_IOS_RESOLVER=maestro-hierarchy` | Slow but immune to the bundleId-binding failure |

`XCTestDriverClient.viewHierarchy(installedApps, excludeKeyboardElements)` over HTTP is what Maestro's iOS driver uses internally — it walks the system UI tree without binding to a single bundleId, so it inherits the failure-class fix from the existing iOS-WIP branch but without the JVM cold-start tax.

## Requirements Trace

(All requirements traced from origin doc.)

- **R1.** `/percy/maestro-screenshot` resolves iOS regions via HTTP-XCTest primary (this plan) + maestro-CLI fallback (existing iOS-WIP branch).
- **R2.** Single Percy-internal resolver interface; relay request/response shape unchanged.
- **R3.** iOS path reuses realmobile-injected `PERCY_IOS_DRIVER_HOST_PORT` (formula `wda_port + 2700`, owned by `realmobile/lib/maestro_session.rb:831`). No new port-discovery code in CLI.
- **R4.** Connection-class HTTP failures fall through to maestro CLI shell-out. Schema-class failures flip drift bit and skip element regions (no fallback).
- **R5.** Healthcheck `maestroHierarchyDrift` extended with `platform` discriminator.
- **R6.** Cross-platform parity (±2px) verified by extending the scaffolded harness from the iOS-WIP branch.
- **R7.** `wda-hierarchy.js` retired in a follow-up PR after ≥1 week of `via maestro-http` log dominance. Mirrors PR #2210's `runAdbFallback` Unit 5 split.
- **R8.** SDK unchanged. `1.0.0-beta.1` works against any CLI (master / PR #2210 / iOS-HTTP).
- **R9.** Kill switch: `PERCY_IOS_RESOLVER=wda-direct` (existing env name from iOS-WIP branch — preserved for consistency, not renamed) routes back to legacy WDA-direct path.

Validation (Testing & Validation section of origin doc):
- V1 unit + fixture
- V2 cross-platform parity
- V3 WDA failure-class regression
- V4 concurrent-access harness
- V5 BS host E2E (procedural source-of-truth: `docs/solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md`)

## Scope Boundaries

- Out of scope: SDK changes (`@percy/maestro-app` / `percy-maestro/percy/scripts/`).
- Out of scope: realmobile / mobile control-plane changes. `PERCY_IOS_DRIVER_HOST_PORT` is already injected by realmobile (see R3); mobile (legacy fleet) iOS support is a deferred research item.
- Out of scope: Pushing gRPC support into Maestro upstream.
- Out of scope: Tap / launch / screenshot / any non-`viewHierarchy` RPC.
- Out of scope: Reducing iOS p95 below 1s in V1. V1.1 perf phase is a separate plan.
- Out of scope: WDA-direct deletion in this PR (R7 — follow-up).

## Context & Research

### Relevant Code and Patterns

**Files to mirror or extend:**
- `cli/packages/core/src/maestro-hierarchy.js` — cross-platform resolver. `feat/grpc-element-region-resolver` adds `runGrpcDump` + `classifyGrpcFailure` for Android (the shape we mirror for iOS HTTP).
- `cli/packages/core/src/wda-hierarchy.js` — existing iOS WDA-direct resolver (558 lines). Its security guards (loopback-only URL, response cap, log scrubbing, bbox sanity, XCUI allowlist) carry over to the new HTTP module.
- `cli/packages/core/src/wda-session-resolver.js` — TOCTOU-safe meta reader. Pattern reference for the iOS env-read helper (no actual code change here per R3).
- `cli/packages/core/src/api.js` — relay handler at `/percy/maestro-screenshot`. The `PERCY_IOS_RESOLVER === 'maestro-hierarchy'` branch already exists on `feat/ios-element-regions-maestro-hierarchy` (api.js:493).
- `cli/packages/core/src/proto/` — proto vendor pattern (#2210). For iOS, vendored fixture is JSON, not proto.

**Existing dispatch shape on `feat/ios-element-regions-maestro-hierarchy`:**

```js
// api.js:493 — already on the iOS-WIP branch
const useMaestroHierarchyForIos = process.env.PERCY_IOS_RESOLVER === 'maestro-hierarchy';
```

The iOS branch of `maestroDump({platform: 'ios'})` is currently a stub returning `'not-implemented'` until "Unit 2b" of an adjacent plan lands the real iOS attribute mapping (XCUI integer-to-name table). This plan's Unit 2 lands HTTP transport on top of that scaffold once Unit 2b is in.

**Maestro upstream references (from brainstorm research):**
- `mobile-dev-inc/Maestro:maestro-ios-driver/src/main/kotlin/xcuitest/XCTestDriverClient.kt` — `fun viewHierarchy(installedApps, excludeKeyboardElements)` HTTP call, OkHttp-based.
- `mobile-dev-inc/Maestro:maestro-proto/src/main/proto/maestro_android.proto` — Android gRPC `MaestroDriver.viewHierarchy` RPC (Android only — iOS has no proto).

### Institutional Learnings

- **`docs/solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md`** — canonical 9-step BS host validation procedure. V5 in this plan reuses it verbatim; do not re-derive deploy mechanics.
- **`project_e2e_validation_state_2026_05_06.md`** — Android validated at Percy build #7; iOS validated at #9. Working overlay state on hosts `31.6.63.33` and `185.255.127.52`.
- **`project_ios_maestro_driver_host_port.md`** — `driver_host_port = wda_port + 2700` formula. Realmobile owns the formula; CLI just reads `PERCY_IOS_DRIVER_HOST_PORT`.
- **`feedback_percy_cli_bs_hosts_node14.md`** — Percy CLI runs Node 14.17.3 on BS hosts. Feature-detect modern Node globals; `node-fetch` v2 / native `http` module are safe.
- **`project_realmobile_canary_overlay_revert.md`** — host realmobile checkouts auto-revert nightly. Validation runs are ephemeral; don't depend on host-local patches surviving.
- **`feedback_dont_change_other_repos.md`** — only fix bugs we introduced. Realmobile's port-injection contract stays as-is; we read the env, not modify the contract.

### External References

None warranted — Maestro upstream code already inspected during brainstorm; PR #2210 establishes the in-repo pattern for this work; @grpc/grpc-js + Node `http` are well-understood layers in this codebase.

## Key Technical Decisions

- **Single env switch (`PERCY_IOS_RESOLVER`), three values.** Preserve the existing env name from the iOS-WIP branch. Values: `wda-direct` (legacy, kill switch); `maestro-hierarchy` (HTTP primary, CLI fallback). Don't introduce a parallel `PERCY_MAESTRO_IOS_RESOLVER`. Requirements doc R9 used `PERCY_MAESTRO_IOS_RESOLVER` as a placeholder; the actual codebase uses `PERCY_IOS_RESOLVER`. Reconciled here.
- **Default flip is phased AND environment-conditional.** Unit 3 splits into 3a (opt-in: ship HTTP path with default unchanged on every environment) and 3b (telemetry-gated default flip — but **only flip when `PERCY_IOS_DRIVER_HOST_PORT` is present in env**, never globally). The env-presence test is the correct deployment-shape signal: realmobile injects this env per `maestro_session.rb:831`, so its presence is functionally equivalent to "this is a BS realmobile session that has Maestro's HTTP runner reachable on a known port and `/tmp/<sid>_test_suite/flows/` populated." Self-hosted customers running their own local Maestro setup do **not** have this env set; they keep `wda-direct` as default after Unit 3b ships, preserving today's sub-second WDA happy path. They can still opt in by explicitly setting `PERCY_IOS_RESOLVER=maestro-hierarchy` if they've manually configured the runner. Two phasing rationales: (1) opt-in window in 3a guards against Maestro wire-format drift discovery in production; (2) env-conditional flip in 3b prevents the silent ~9s JVM cold-start regression on self-hosted customers that the document review surfaced as the P0 risk. This matches #2210's "gate validation before default" conservatism while honoring the deployment-shape coupling that bundleId YAML discovery + driver-host-port both implicitly require.
- **No AUT bundleId discovery needed at cli-2.0.7+** *(revised 2026-05-07 from Unit 1 source research)*. PR #2365 has landed in Maestro upstream — `ViewHierarchyHandler.swift:22` calls `RunningApp.getForegroundApp()` with no parameters and ignores the request's `appIds` field. Percy CLI sends `{"appIds": [], "excludeKeyboardElements": false}` and the server returns the foreground AUT's hierarchy directly. The original deepening pass's bundleId-from-YAML scraping plan was a mitigation for pre-#2365 behavior (where empty `appIds` returned SpringBoard); that mitigation is no longer needed for the realmobile production default `cli-2.0.7`. For older Maestro versions (`cli-1.39.x` is also supported by realmobile per `maestro_version_mapping`), empty `appIds` returns a SpringBoard-only tree; the parser detects this case and routes to maestro-CLI shell-out fallback (which knows the AUT internally via Maestro's flow context). Net Unit 2 simplification: drop `discoverAutBundleId` helper, `maestro-ios-bundleid-resolver.js` file, TOCTOU-safe YAML reader, multiple-app-ids defense, YAML size cap. No SDK change (R8); no realmobile change.
- **HTTP transport built inside the existing cross-platform `maestro-hierarchy.js`, not a sibling module.** Same shape as #2210's `runGrpcDump` + `classifyGrpcFailure` for Android. iOS gets `runIosHttpDump` + `classifyIosHttpFailure`. The cross-platform module already dispatches on `platform`; a sibling file would split the maestro-CLI fallback path that both platforms share.
- **No new port-discovery module.** `PERCY_IOS_DRIVER_HOST_PORT` is already injected by realmobile; CLI reads it, never derives or scans. Realmobile owns the formula at `maestro_session.rb:831`; replicating it in CLI risks divergence if BS infra changes the formula.
- **JSON fixture vendoring (source-synthesized, not wire-captured).** PR #2210 vendored `maestro_android.proto`; we vendor a source-synthesized JSON response sample. iOS has no proto; the JSON shape is determined by Swift `Codable` + Kotlin Jackson serialization, which is deterministic given source types. Pin to Maestro `cli-2.0.7` (realmobile production default per `maestro_version_mapping`); confirmed via Unit 1 that PR #2365 (drops `appIds` server-requirement) and PR #2402 (changes wrap from `[springboard, AUT]` to `[appHierarchy, statusBarsContainer]`) are both landed in `cli-2.0.7`. Wire-bytes confidence is deferred to Unit 5/6/7 BS validation; no live BS session is required for Unit 1.
- **Healthcheck dirty bit uses two-slot shape, not single-field-with-discriminator.** `maestroHierarchyDrift: { android: {code, reason, firstSeenAt} | null, ios: {code, reason, firstSeenAt} | null }`. Rationale: single-field-last-writer-wins (the original deepened-from decision) loses simultaneous-drift signal — exactly the case that ops most needs to see (e.g., a Maestro CLI version bump on BS hosts breaking both transports). Two-slot keeps one envelope-level read, monotonic per platform until process restart, no diagnostic loss.
- **Add per-snapshot `resolver` field to relay-payload as ops escape valve.** `/percy/maestro-screenshot` accepts an optional `resolver` body field that overrides `PERCY_IOS_RESOLVER` for that single request. SDK doesn't set it today (R8 stands); ops can `curl` a single snapshot with `wda-direct` for diagnostics without redeploying the CLI. Foundation for future cohort rollouts and A/B telemetry.
- **Branch off `feat/ios-element-regions-maestro-hierarchy`**, not master. That branch already has the `PERCY_IOS_RESOLVER` dispatch, the cross-platform `maestroDump({platform})` API, and the scaffolded parity test. This plan is additive on top. Rebase onto cli/master after `feat/grpc-element-region-resolver` (PR #2210) and the iOS-WIP branch's parent (#2202) merge — see Risks for the merge-order matrix.
- **Connection-class fallback to maestro-CLI shell-out, not WDA-direct.** Both platforms share the same fallback shape for symmetry. WDA-direct fallback would re-introduce the `[FBRoute raiseNoSessionException]` failure class on the fallback path — pointless. The CLI shell-out path (already in the iOS-WIP branch) walks the system UI without bundleId binding, same as the HTTP primary, and (post Unit 1 finding) is also the **graceful path for older Maestro versions** where empty `appIds` returns SpringBoard — when Percy detects a SpringBoard-only response, route to maestro-CLI fallback which knows the AUT internally.

- **iOS selector vocabulary is `id` only** *(decided 2026-05-07 from Unit 1 source research)*. Maestro upstream's `IOSDriver.mapViewHierarchy` (cli-2.0.7 `IOSDriver.kt:192-220`) does NOT populate a `class` attribute when converting iOS `AXElement` → `TreeNode` for the maestro-CLI stdout path. Only `resource-id` (from `identifier`), `bounds`, `accessibilityText`, `title`, `value`, `text`, `hintText`, `enabled`, `focused`, `selected`, `checked` are set. The originally absorbed Unit 2b's XCUI `elementType` integer-to-name table was framed as enabling `class: "XCUIElementTypeButton"` selectors, but Maestro itself doesn't expose that capability. Plan keeps iOS selector vocabulary aligned with Maestro's actual capability: `IOS_SELECTOR_KEYS_WHITELIST = ['id']`. The HTTP path could in principle expose `class` from raw `AXElement.elementType` (the table is purely informational), but that would create an asymmetry between HTTP primary and CLI fallback paths (`class` selectors silently lose matches when fallback fires). Symmetric `id`-only is the cleaner V1 choice. Net Unit 2 simplification: drop `xcui-element-types.js` standalone file; drop XCUI table-based selector matching; drop `class` from `IOS_SELECTOR_KEYS_WHITELIST`.

## Open Questions

### Resolved During Planning

- **Q: Where does iOS port discovery live?** → CLI reads `PERCY_IOS_DRIVER_HOST_PORT` injected by realmobile. No CLI-side discovery.
- **Q: Healthcheck shape — single field with discriminator vs separate fields?** → **Two-slot shape** `{android, ios}` (revised from the original "single field with discriminator" decision after the deepening pass; the original would have lost simultaneous-drift signal in the case that matters most for ops correlation).
- **Q: Sequencing — wait for #2210 to merge or build on top of iOS-WIP?** → Build on iOS-WIP branch (it has dispatch + parity scaffold). Rebase as upstream merges. See Risks for explicit merge-order matrix.
- **Q: Module structure — split `maestro-hierarchy.js` per platform vs unified?** → Unified file with internal platform branching (existing pattern from #2210 + iOS-WIP).
- **Q: Env name — `PERCY_IOS_RESOLVER` vs `PERCY_MAESTRO_IOS_RESOLVER`?** → Use existing `PERCY_IOS_RESOLVER` from iOS-WIP branch. Update R9 in the requirements doc to match.
- **Q: iOS fallback target?** → maestro-CLI shell-out (matches Android), not WDA-direct.
- **Q: Wire format request field name** *(resolved post-deepening from Maestro upstream source at `cli-1.39.13`)* → JSON field is **`appIds`** (Kotlin `ViewHierarchyRequest.kt: data class ViewHierarchyRequest(val appIds: Set<String>, ...)`), NOT `installedApps`. The Kotlin *parameter* is named `installedApps` for readability but the wire field is `appIds`. Without this fix, every request 4xx's at the Swift `Codable` decoder.
- **Q: `appIds` semantics — empty set means "walk foreground" or "fail"?** *(resolved post-deepening from `ViewHierarchyHandler.swift:17–46` at `cli-1.39.13`)* → **Empty set returns SpringBoard's hierarchy at HTTP 200**, which is wrong for Percy (we want the AUT tree). The handler iterates `appIds`, picks whichever has `state == .runningForeground`, falls back to `XCUIApplication("com.apple.springboard")` if none match. Bundle ID **must** be supplied for Percy's use case to get the AUT tree.
- **Q: AUT bundleId source** *(resolved post-deepening — replaces the now-obsolete "thread bundleId through SDK" mitigation)* → **Parse `/tmp/<sessionId>_test_suite/flows/*.yaml` for top-level `appId:` directives.** Skip subflows (those use `_percy_subflow`). The customer's main flow YAML carries the AUT bundleId; the test-suite zip is already extracted to that path on every BS host (per validation skill). Zero scope expansion: no SDK change (R8), no realmobile change (out of scope per requirements). Fallback if YAML parse fails or no `appId:` found: maestro-CLI shell-out (which Maestro already knows the bundleId internally).
- **Q: Wire format response shape** *(resolved post-deepening from `AXElement.kt` Kotlin + Swift)* → Root is `{axElement: AXElement, depth: Int}`, NOT a flat tree. Wrapped in `axElement` envelope. `AXElement` keys are camelCase (`identifier`, `value`, `title`, `label`, `elementType`, `children`, etc.). **`elementType` is `Int`** (XCUI raw values: 1=app, 9=button, 49=textField, etc.), not a string. **`frame` keys are PascalCase** (`{X, Y, Width, Height}`) — `@JsonProperty("X")` etc. Children omitted from JSON when leaf (no empty array — `encodeIfPresent`). **Unit 2 parser must handle the `axElement` wrapper, the `Int` elementType, and the PascalCase frame keys explicitly.**
- **Q: `excludeKeyboardElements` value choice** *(resolved post-deepening from `ViewHierarchyHandler.swift:67–82`)* → Hard-code **`false`**. We want keyboard in the snapshot when on screen; filtering is `excludeKeyboardElements && keyboard.exists`, so `false` is the safe default that returns the unfiltered tree.
- **Q: Forward-compat with newer Maestro versions** *(resolved post-deepening, refined post-document-review)* → Maestro PR #2365 (post-v1.39.13) makes `appIds` server-ignored — Kotlin client still sends it, but the server uses `XCUIApplication.activeAppsInfo()`. PR #2402 (post-v1.39.13) drops the SpringBoard wrap when an AUT is found (single-root response instead of two-children root). **Unit 2 parser must walk the tree to find the first node with `elementType == 1` whose `identifier != 'com.apple.springboard'`** — both children of the v1.39.13 wrapped response have `elementType == 1`, so a naïve "first elementType==1" walk picks SpringBoard, not the AUT. This is the correctness rule for both v1.39.13 (skips the SpringBoard sibling) and post-PR-2402 (no SpringBoard child to skip; single AUT root is selected). BS realmobile hosts auto-advance to canary nightly so future drift is real risk.
- **Q: How to prevent silent latency regression on self-hosted customers when Unit 3b flips the default?** *(resolved post-document-review, P0 finding from product-lens)* → **Make Unit 3b's flip environment-conditional.** The new HTTP path requires `PERCY_IOS_DRIVER_HOST_PORT` (realmobile-injected). Unit 3b's default cascade reads that env: present → default = `maestro-hierarchy`, absent → default = `wda-direct`. Self-hosted customers (without the env) keep the sub-second WDA happy path automatically; realmobile customers get the failure-class fix. Zero scope expansion — the env presence is a deployment-shape signal that already exists. Operators on either side can still explicitly opt in or kill-switch via `PERCY_IOS_RESOLVER`.
- **Q: PR #2365 status at `cli-2.0.7`** *(resolved 2026-05-07 from Unit 1 source research)* → **LANDED.** `ViewHierarchyHandler.swift:22` calls `RunningApp.getForegroundApp()` with no parameters. Server detects the foreground AUT itself; the request's `appIds` field is wire-vestigial (Kotlin client still sends `Set<String>`, server ignores). Percy CLI sends `appIds: []` and gets the AUT tree on cli-2.0.7+.
- **Q: PR #2402 status at `cli-2.0.7`** *(resolved 2026-05-07 from Unit 1 source research)* → **LANDED with a different wrap shape than the deepening pass assumed.** `getAppViewHierarchy` (`ViewHierarchyHandler.swift:73, 84, 86`) returns `AXElement(children: [appHierarchy, AXElement(children: statusBars)])` — the wrap is `[AUT, statusBarsContainer]`, not `[springboard, AUT]`. The statusBars wrapper has `elementType == 0` (defaulted by `AXElement.init(children:)` at `AXElement.swift:39-56`). Parser rule "first `elementType == 1` whose `identifier != 'com.apple.springboard'`" still works: it skips the outer wrap (elementType=0) and the statusBars wrapper (elementType=0), finds the AUT (elementType=1).
- **Q: AUT bundleId discovery on cli-2.0.7+** *(resolved 2026-05-07 from Unit 1)* → **Not needed.** Per the PR #2365 finding, server detects AUT itself; no client-side discovery required. Drop `discoverAutBundleId` helper, `maestro-ios-bundleid-resolver.js` file, YAML reader, multiple-app-ids defense, YAML size cap from Unit 2 scope.
- **Q: iOS selector vocabulary at the Maestro-API layer** *(resolved 2026-05-07 from Unit 1 source research)* → **`id` only.** `IOSDriver.mapViewHierarchy` (`IOSDriver.kt:192-220`) does not populate `class` in `TreeNode`. iOS-WIP scaffold's `IOS_SELECTOR_KEYS_WHITELIST = ['id', 'class']` is updated to `['id']` in this plan's Unit 2. The originally absorbed XCUI elementType integer-to-name table (`xcui-element-types.js`) is dropped from Unit 2 scope.
- **Q: Variant 6 (maestro CLI iOS stdout) shape** *(resolved 2026-05-07)* → **Maestro's normalized `TreeNode` shape**, identical to Android's stdout. `IOSDriver.viewHierarchy` (line 174) returns `TreeNode` (mapped from `AXElement` via `mapViewHierarchy` lines 192-220); `PrintHierarchyCommand.kt:153-156` serializes that with `JsonInclude.Include.NON_NULL`. Existing `flattenMaestroNodes` consumes this without iOS-specific branching. Source-derived fixture committed at `cli/packages/core/test/fixtures/maestro-ios-hierarchy/maestro-cli-ios-stdout.json`.

### Deferred to Implementation

- **Mobile (legacy fleet) iOS support.** Whether `PERCY_IOS_DRIVER_HOST_PORT` is injected on the legacy Appium-based mobile fleet. Defer until first mobile-fleet customer surfaces; expected to be a small env-injection patch if needed. Without the env, the resolver classifies as connection-class and falls through to maestro-CLI shell-out — graceful degradation.
- **HTTP keep-alive / connection reuse strategy.** Match #2210's module-scope client cache per (host, port) with eager-close-and-evict on connection-class failure. Exact `http.Agent` options (`keepAliveMsecs`, `maxSockets`) tunable during implementation.
- **HTTP timeout values.** PR #2210 uses 250ms healthy / 2s circuit-breaker for gRPC. iOS HTTP + JSON walk is heavier; start at 1500ms healthy / 5s circuit-breaker, tune from Unit 7's concurrent-harness output before flipping the default in Unit 3b.
- ~~YAML parser dependency for bundleId discovery~~ — *no longer applicable.* Per Unit 1's PR #2365 finding, Percy CLI sends `appIds: []` and the server detects the AUT itself; no YAML reading needed.

## Plan Viability Gates

These conditions are *not* risks — they are pre-conditions that must hold for this plan to ship as written. If any gate fails during execution, the plan author must escalate (not paper over): pause work, write up the finding, and either re-scope via `/ce:brainstorm` or coordinate the necessary cross-repo change.

- **Gate 1: ~~AUT bundleId discoverable from `/tmp/<sessionId>_test_suite/flows/*.yaml`~~ → DROPPED (2026-05-07).** Per Unit 1 source research at `cli-2.0.7`: PR #2365 has landed and the server detects the AUT itself via `RunningApp.getForegroundApp()`. Percy CLI sends `appIds: []` and the server returns the AUT's tree directly. The YAML scraping mitigation is no longer needed for the realmobile fast path. For older Maestro versions where empty `appIds` returns SpringBoard, the parser detects that case and routes to maestro-CLI shell-out fallback. **No bundleId discovery code in Unit 2.** This entire gate is obviated by upstream Maestro evolution. See `cli/packages/core/test/fixtures/maestro-ios-hierarchy/capture-notes.md` for the full source-citation chain.
- **Gate 2: ~~`cli-2.0.7` source confirms PR #2365 + #2402 status~~ → RESOLVED (2026-05-07).** Unit 1 source research confirmed both PRs landed in `cli-2.0.7`. PR #2365: `ViewHierarchyHandler.swift:22` `let foregroundApp = RunningApp.getForegroundApp()` — no `appIds` parameter, server-side detection. PR #2402: `getAppViewHierarchy` returns `AXElement(children: [appHierarchy, statusBarsContainer])` — wrap is `[AUT, statusBarsContainer]` (not `[springboard, AUT]` from cli-1.39.13). Plan's parser rule "first `elementType == 1` whose `identifier != 'com.apple.springboard'`" remains correct because the statusBars wrapper has `elementType == 0`. Vendored fixtures committed to `cli/packages/core/test/fixtures/maestro-ios-hierarchy/` on `feat/maestro-ios-http-resolver` commit `65e54b9f`.
- **Gate 3: ~~iOS-WIP "Unit 2b" attribute mapping landed~~ → RESOLVED (2026-05-07).** Single ownership confirmed (Sriram567 across PR #2202, PR #2210, this plan). **Option B chosen:** keep PR #2202 narrow (ships Plan A WDA-direct + Plan B Phase 1 scaffold); this plan's PR carries the new HTTP transport alongside whatever's still needed from Unit 2b's intended scope. **Reduced absorption scope** (per Unit 1 finding): Maestro's iOS TreeNode does not carry a `class` attribute — only `resource-id` (from `identifier`). The XCUI `elementType` integer-to-name table that was the bulk of "Unit 2b's intended work" is not needed for selector matching; iOS selector vocabulary is `id` only. So Unit 2 absorbs the iOS branch of `flattenMaestroNodes` (small adapter — convert raw `AXElement` HTTP shape to `{attributes: {id, bounds}, children}` shape) and replaces the `runMaestroIosDump` stub body, but does NOT need the XCUI table. Net Unit 2 absorbed scope is ~⅓ of what the deepening pass + document-review framing assumed.
- **Gate 4: ~~Coordinate with PR #2210 author~~ → FULLY OBVIATED (2026-05-07).** Sriram567 closed #2202 and #2210; the entire iOS-regions+drift bundle merges as a single PR from this branch. The two-slot drift surface (`setMaestroHierarchyDrift({platform})` + `getMaestroHierarchyDrift()` + `__testing.resetMaestroHierarchyDrift()`) landed natively in Unit 4. Android slot stays unwritten because there's no Android-resolver work in this PR. The `2026-05-06-004-pr2210-coordination-comment.md` artifact is obsolete — its diff targeted #2210 specifically.
- **Gate 5: BS realmobile iOS infra is healthy enough for Unit 6 (V3 regression) and Unit 7 (V4.2 concurrent harness) to run end-to-end before Unit 3b's default flip.** If BS infra is down for the validation window (recent memory: 5 builds failed 2026-04-27, 4 failed 2026-04-29), Unit 3b's flip pauses until validation can complete. Unit 3a (opt-in) can ship without this gate.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Dispatch flow (post-Unit-1: empty `appIds` works at cli-2.0.7+; no YAML scraping)

```mermaid
sequenceDiagram
    participant SDK as percy-screenshot.js<br/>(GraalJS, unchanged)
    participant API as Percy CLI api.js
    participant Resolver as maestro-hierarchy.js
    participant HTTP as XCTestDriverClient<br/>POST /viewHierarchy<br/>(127.0.0.1:wda+2700)
    participant CLI as maestro hierarchy<br/>(shell-out fallback)

    SDK->>API: POST /percy/maestro-screenshot<br/>{regions[], sessionId, ...}
    API->>API: Resolver choice cascade:<br/>1. request.body.resolver (per-snapshot override)<br/>2. PERCY_IOS_RESOLVER env (explicit operator)<br/>3. Env-conditional default:<br/>   • Unit 3a: always "wda-direct"<br/>   • Unit 3b: "maestro-hierarchy" iff<br/>     PERCY_IOS_DRIVER_HOST_PORT set<br/>     else "wda-direct"<br/>4. Final fallback "wda-direct"

    alt resolver = wda-direct (default in 3a; kill switch in 3b)
        API->>API: resolveIosRegions() — legacy WDA path
    else resolver = maestro-hierarchy
        API->>Resolver: maestroDump({platform: 'ios', sessionId})
        Resolver->>HTTP: POST /viewHierarchy<br/>{appIds: [], excludeKeyboardElements: false}<br/>(server detects AUT internally — PR #2365)

        alt Healthy 200 (post-#2402 wrap: [AUT, statusBars])
            HTTP-->>Resolver: {axElement: {children: [AUT, statusBars]}, depth}
            Resolver->>Resolver: walk to first elementType==1<br/>where identifier != com.apple.springboard
            Resolver-->>API: {kind: 'hierarchy', nodes}<br/>via maestro-http
        else SpringBoard-only response<br/>(older Maestro version OR AUT crashed)
            Resolver->>CLI: spawn maestro --udid --driver-host-port hierarchy<br/>(Maestro CLI knows AUT internally)
            CLI-->>Resolver: TreeNode JSON (Maestro's normalized shape)
            Resolver-->>API: {kind: 'hierarchy', nodes}<br/>via maestro-cli-fallback (springboard-only)
        else Connection-class (ECONNREFUSED, ETIMEDOUT, socket reset)
            Resolver->>CLI: spawn maestro hierarchy
            Resolver-->>API: via maestro-cli-fallback
        else Schema-class (missing axElement, wrong frame keys, etc.)
            Resolver->>API: setMaestroHierarchyDrift.ios = {code, reason, firstSeenAt}
            Resolver-->>API: {kind: 'dump-error'}<br/>schema-drift (no fallback)
        end
    end

    API->>API: per-region firstMatch on flattened nodes<br/>(iOS: id selector → attributes['resource-id'])
    API->>API: build comparison payload
    API-->>SDK: 200 OK
```

### Module boundary

`cli/packages/core/src/maestro-hierarchy.js` (single file) keeps its current shape:

```
maestroDump({ platform })
├── platform === 'android'
│   ├── runGrpcDump (primary)         ← from PR #2210
│   └── runMaestroCliDump (fallback)  ← from PR #2210
└── platform === 'ios'
    ├── runIosHttpDump (primary)      ← THIS PLAN, Unit 2
    └── runMaestroCliDump (fallback)  ← from feat/ios-element-regions-maestro-hierarchy
```

Both platforms share `runMaestroCliDump`, `flattenMaestroNodes` (with internal platform branching for attribute keys per the existing scaffold), `firstMatch`, error classification table shape, and the healthcheck dirty bit setter (extended in Unit 4).

## Implementation Units

- [x] **Unit 1: Source-research Maestro `cli-2.0.7` wire format; synthesize fixture (V1.3)** — completed 2026-05-07 on branch `feat/maestro-ios-http-resolver` commit `65e54b9f`. See `cli/packages/core/test/fixtures/maestro-ios-hierarchy/capture-notes.md` for findings (notably: PR #2365 + #2402 both landed; iOS TreeNode has no `class` attribute; bundleId YAML scraping not needed; Unit 2 scope reduced).

**Goal:** Determine the actual wire format shape Unit 2's parser must handle, by reading upstream Maestro source code at the production-target tag `cli-2.0.7`. Synthesize a fixture from the source-derived types. **No live BS session required for Unit 1** — wire-bytes-vs-source-types validation is deferred to Unit 5/6/7's BS validation step, where source-vs-wire divergence surfaces as a parser bug rather than a Unit-1 prerequisite (lighter cycle, lower infra coupling). For HTTP+JSON the source-vs-wire gap is small enough that this trade is favorable. Resolve Plan Viability Gates 1 (bundleId YAML discovery — verifiable on-host without a session) and Gate 2 (cli-2.0.7 source confirms PR #2365 + #2402 status).

**Requirements:** R3, V1.3, V1 unit suite foundation, Plan Viability Gates 1 + 2.

**Dependencies:** None. ~1–2 hours of source-research + fixture-synthesis (vs. multi-hour BS session orchestration).

**Files:**
- Create: `cli/packages/core/test/fixtures/maestro-ios-hierarchy/viewHierarchy-response.json`
- Create: `cli/packages/core/test/fixtures/maestro-ios-hierarchy/viewHierarchy-request.json`
- Create: `cli/packages/core/test/fixtures/maestro-ios-hierarchy/capture-notes.md`

**Expected wire format (source-derived from Maestro `cli-1.39.13`; HOST RECONCILIATION REQUIRED — see note below):**

> ℹ **Host-vs-source version reconciliation (2026-05-07).** Memory `project_ios_maestro_cli_paths.md` documents the BS realmobile version mapping: Maestro Nix-v5 = upstream `cli-1.39.15` (Java 16), Maestro Nix-v2.2 = upstream `cli-2.0.7` (Java 17). Realmobile's *current accepted* production version is **`cli-2.0.7`**. PR #2210 vendored against `cli-1.39.13` — two patch versions before `cli-1.39.15`, but a full minor-major step before `cli-2.0.7`. The expectations table below is the `cli-1.39.13` source-derived hypothesis; it is **likely accurate for sessions running Maestro `1.39.15`** (close enough patch distance) but **uncertain for sessions running `2.0.7`** (where PR #2365's `appIds` change and PR #2402's SpringBoard-wrap change may have landed). Unit 1's primary job: capture against whatever Maestro version the BS Maestro v2 build payload actually selects (default = `2.0.7` per realmobile constants). Reconcile any drift before Unit 2 implements.

| Field | Expected at cli-1.39.13 | Likely state on host's `maestro-cli-5` | Source citation |
|---|---|---|---|
| Endpoint | `POST http://127.0.0.1:${PERCY_IOS_DRIVER_HOST_PORT}/viewHierarchy` | Probably unchanged (route name is stable in Maestro upstream) | `XCTestClient.kt:10–16`, `XCTestHTTPServer.swift:17,21–23,33` |
| Request body field name | **`appIds`** (Set\<String\>), NOT `installedApps` | Server-ignored post-#2365 — Kotlin client still sends it for Maestro's own consumption; if Percy CLI sends an empty `appIds`, post-#2365 server may auto-detect AUT via `XCUIApplication.activeAppsInfo()` | `ViewHierarchyRequest.kt`, `ViewHierarchyRequest.swift:3–6` |
| Request body field 2 | `excludeKeyboardElements` (Boolean) | Probably unchanged | same |
| Response root | `{axElement: AXElement, depth: Int}` (wrapped, not flat) | Probably unchanged at envelope; **but AUT-found case post-#2402 returns single AUT root instead of `[springboard, AUT]` wrap** | `AXElement.kt:18–21`, `AXElement.swift:5–8` |
| `AXElement.frame` keys | PascalCase: `{X, Y, Width, Height}` (Float) | Probably unchanged | `AXElement.kt:5–10` `@JsonProperty("X")` etc. |
| `AXElement.elementType` | **Int** (XCUI raw values: 1=app, 9=button, 49=textField, etc.), not string | Probably unchanged | `AXElement.kt` |
| `AXElement.children` | omitted from JSON when leaf (no empty array — `encodeIfPresent`) | Probably unchanged | `AXElement.swift:90` |
| Empty `appIds` semantics | Returns 200 with **SpringBoard hierarchy** (wrong tree for Percy) | Post-#2365: server uses internal AUT detection; empty `appIds` may now return AUT correctly. **If true, Percy's bundleId-YAML discovery becomes optional rather than required.** Verify in Unit 1 capture variant 5. | `ViewHierarchyHandler.swift:17–46`, `25–30` |

**Approach (revised 2026-05-07 — source-research-first, lighter than the original wire-capture framing):**

*Primary path: source-research at `mobile-dev-inc/Maestro` ref=`cli-2.0.7` (≈10–15 min).*

The wire format for HTTP+JSON is determined by Kotlin Jackson + Swift Codable serialization, both of which are deterministic given the type definitions. The deepening pass already extracted the relevant types from `cli-1.39.13`; rerun the same procedure against `cli-2.0.7` to confirm what's changed:

```bash
# Drop-in pattern (use gh search code + gh api against ref=cli-2.0.7):
gh api 'repos/mobile-dev-inc/Maestro/contents/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/ViewHierarchyHandler.swift?ref=cli-2.0.7'
gh api 'repos/mobile-dev-inc/Maestro/contents/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Models/AXElement.swift?ref=cli-2.0.7'
gh api 'repos/mobile-dev-inc/Maestro/contents/maestro-ios-driver/src/main/kotlin/hierarchy/AXElement.kt?ref=cli-2.0.7'
gh api 'repos/mobile-dev-inc/Maestro/contents/maestro-ios-driver/src/main/kotlin/xcuitest/api/ViewHierarchyRequest.kt?ref=cli-2.0.7'
```

Diff each against the `cli-1.39.13` version pulled during the deepening pass. Document any divergences in `capture-notes.md` — specifically: did PR #2365 (drops `appIds` server-requirement, March 2025) land before `cli-2.0.7`? Did PR #2402 (drops SpringBoard wrap on AUT-found case, March 2025) land? If yes to either, document the resulting wire-shape implications for Unit 2's parser.

*Variant 6 (maestro CLI iOS stdout shape) — two sub-options:*
- *(a)* Read `maestro-cli/src/main/java/maestro/cli/util/PrintHierarchyCommand.kt` (or whatever the iOS-stdout-emitter is — `gh search code` against the cli-2.0.7 ref) to derive the stdout shape. ~15 min, no infra.
- *(b)* Defer: assume it matches Android's `TreeNode` shape (the existing `flattenMaestroNodes` consumer); let Unit 5/6/7 BS validation surface any divergence as a parser bug. Lighter, accepts a small known-unknown.

Implementer's call between (a) and (b). Default: (a) — same low-cost source-research as variants 1–5; gives the parser a concrete shape to target rather than an assumption.

*Fixture synthesis:* Hand-construct `viewHierarchy-response.json` from the source-derived `AXElement` Codable shape (variant 2 = canonical happy path, foreground AUT, no keyboard). Use a synthetic example bundle ID (`com.example.app`) to satisfy the fixture privacy rules. Match the source's `encodeIfPresent` semantics: leaf nodes have no `children` key (not an empty array). Frame keys are PascalCase. `elementType` is Int.

*Plan Viability Gate 1 verification (still needed regardless of source-vs-wire path):* On-host check, no session needed — `sudo ls -la /tmp/` shows the realmobile-extracted test-suite layout pattern. If past sessions left `*_test_suite/` directories visible (or if you can SSH to a host *during* an unrelated active Percy-Maestro session triggered for any reason), confirm `flows/*.yaml` is the path and the YAML format matches the bundleId-from-`appId:` discovery assumption. Verify against `realmobile/lib/maestro_session.rb` source-of-truth code on the host for the extraction logic.

*Optional confidence-boost capture (deferred — do during whatever next BS Percy-Maestro session you trigger anyway, not as a Unit 1 blocker):*
- During an active session window, `sudo curl -X POST http://127.0.0.1:<driver-port>/viewHierarchy -d '{"appIds":[],"excludeKeyboardElements":false}' -H 'Content-Type: application/json'` — captures variant 5 (empty `appIds`, post-#2365 behavior) directly without overlay deploys.
- `sudo cat /var/log/browserstack/percy_cli.<sid>_<port>.log` for any captured wire bytes that Percy CLI's debug logging happens to surface.
- Diff against the source-synthesized fixture; commit any divergence as a `capture-notes.md` "real-bytes-vs-source addendum" — does not block Unit 2.

*Why the lighter path is acceptable here:* PR #2210 captured gRPC binary bytes because Protocol Buffers serialization has a real source-vs-wire gap (varint encoding, oneof handling, repeated-field framing). For HTTP+JSON with Jackson/Codable, source types determine wire bytes deterministically up to documented serialization rules (`@JsonProperty`, `encodeIfPresent`). The remaining wire-vs-source risk surface is small enough that source-research + Unit 5/6/7 BS validation covers it without a Unit-1-blocking capture step.

**Variant matrix (source-derived per the lighter path; covers the same six scenarios as before, but each is a "what does the source say should happen?" rather than "what comes off the wire?" — synthesize each variant's expected JSON from `AXElement.swift` + `ViewHierarchyHandler.swift` at `cli-2.0.7`):**
1. App-just-launched (baseline). Source-derive: AXElement root for the AUT, depth=N.
2. Foreground app + element-region request (canonical happy path). **Primary fixture committed as `viewHierarchy-response.json`.**
3. Foreground app with keyboard visible. Source-derive: AXElement subtree includes keyboard children when `excludeKeyboardElements: false`.
4. AUT terminated, only SpringBoard running. Source-derive: per `ViewHierarchyHandler.swift:25–30` the response is `axElement.identifier == 'com.apple.springboard'` only.
5. Empty `appIds`. Source-derive: pre-#2365 returns SpringBoard; post-#2365 server detects AUT internally. **Determines the bundleId-discovery requirement** — if `cli-2.0.7` is post-#2365, Unit 2's bundleId YAML scraper becomes optional/redundant on the realmobile fast path.
6. `maestro --udid <udid> --driver-host-port <port> hierarchy` stdout (iOS CLI fallback path). Source-derive from `PrintHierarchyCommand.kt` (or equivalent emitter) at `cli-2.0.7`. **Determines whether iOS CLI stdout matches Android's `TreeNode` shape** (so existing `flattenMaestroNodes` consumes both) or is a separate shape that needs its own adapter in Unit 2.

The source-derivation approach trades wire-bytes confidence for execution speed. Unit 5/6/7 BS validation catches any source-vs-wire divergence — the plan accepts that as the cost of avoiding Unit-1-as-infra-blocker.

**Fixture privacy rules (committed to repo):**
- Source-synthesized fixtures use synthetic example bundle IDs (`com.example.app`, `com.example.calculator`) by construction — no privacy concern in the synthesis path.
- IF an optional confidence-boost wire capture is later done on a BS session, the same scrubbing rules apply: `grep -E '"identifier"\s*:|appId:|bundleId' cli/packages/core/test/fixtures/maestro-ios-hierarchy/` and verify every match resolves to an example-app pattern. Fail merge gate if any match is unrecognized. The BS validation pass is verification, not source — keep raw captures local; commit only scrubbed/example-only fixtures.

For each variant, document the source-derived shape in `capture-notes.md` with citations to the `cli-2.0.7` source files that determine it. Variant 2 becomes the primary `viewHierarchy-response.json`; variant 6 becomes `maestro-cli-ios-stdout.json` (or a placeholder + comment if you take sub-option (b) for variant 6).

**Resolve Plan Viability Gate 1 in this unit:** before any HTTP capture, on a BS realmobile session, run `sudo ls /tmp/<sid>_test_suite/flows/` and `sudo cat /tmp/<sid>_test_suite/flows/*.yaml` to confirm the customer's main flow YAML is present and contains a top-level `appId:` directive. If yes, Unit 2's bundleId-discovery path is valid. If no, escalate per the gate.

**Document in `capture-notes.md`:**
- Pinned `MAESTRO_SOURCE_VERSION` = `cli-2.0.7` (the realmobile production-default version, per memory `project_ios_maestro_cli_paths.md` version-mapping table).
- Source citations for each wire field (file path, line numbers, commit/tag) mirroring the deepening pass's citation table. Update if any of the deepening's `cli-1.39.13` citations have moved or changed in `cli-2.0.7`.
- PR #2365 status at `cli-2.0.7`: landed / not landed (determined by reading `ViewHierarchyHandler.swift` at the tag — does the server still iterate `request.appIds` to detect foreground app, or use `XCUIApplication.activeAppsInfo()`?).
- PR #2402 status at `cli-2.0.7`: landed / not landed (determined by reading the same handler — does the AUT-found case still wrap `[springboardHierarchy, appHierarchy]` or return single AUT root?).
- Variant 6 disposition: sub-option (a) result (source-derived stdout shape) or (b) "deferred to Unit 5/6/7 validation; Unit 2 assumes Android `TreeNode` shape with documented divergence-handling".
- Bundle ID YAML probe result (Plan Viability Gate 1) — from on-host `sudo ls /tmp/` of past sessions, OR from reading `realmobile/lib/maestro_session.rb`'s extraction logic.
- Forward-compat note: parser walks to the first `elementType == 1` node **whose `identifier != 'com.apple.springboard'`** — handles both wrapped (pre-#2402) and unwrapped (post-#2402) shapes. (Doc-review caught: both pre-#2402 wrapped children have `elementType==1`; SpringBoard-skip is required.)
- Optional: post-Unit-1 BS-session wire-capture diff against this source-derived synthesis, when convenient.

**Patterns to follow:**
- `cli/packages/core/test/fixtures/maestro-hierarchy/grpc-capture-notes.md` (PR #2210 vendor procedure).
- `cli/packages/core/src/proto/README.md` (version-pin convention).

**Test scenarios:** N/A — research artifact. Unit 2's specs consume the output.

**Verification:**
- `viewHierarchy-response.json` (variant 2 source-synthesized) is committed and parses cleanly with `JSON.parse`. Frame keys are PascalCase; `elementType` is Int; `axElement` is the root with `depth` sibling.
- `maestro-cli-ios-stdout.json` (variant 6 source-derived OR documented as deferred to Unit 5/6/7) is committed.
- `capture-notes.md` documents:
  - The `cli-2.0.7` source-derivation procedure with `gh api` commands for reproducibility.
  - PR #2365 + #2402 status at `cli-2.0.7` (landed / not-landed) with source citations.
  - Variant 6 disposition.
  - Bundle ID YAML probe result for Gate 1.
  - Note: this fixture is source-synthesized; wire-bytes confidence comes from Unit 5/6/7 BS validation.
- Plan Viability Gate 1 resolved (bundleId-from-YAML procedure documented from realmobile source code or past-session traces).
- Plan Viability Gate 2 resolved (source confirms or invalidates the deepening pass's `cli-1.39.13` shape; any drift recorded for Unit 2's parser).
- `MAESTRO_SOURCE_VERSION` recorded as `cli-2.0.7`.

---

- [x] **Unit 2: Build iOS resolver — `runIosHttpDump` HTTP transport + replace `runMaestroIosDump` stub + iOS branch of `flattenMaestroNodes`** — completed 2026-05-07 on branch `feat/maestro-ios-http-resolver` commit `dbc7b277`. 77/77 maestro-hierarchy specs pass (26 new iOS-path scenarios + existing Android tests unchanged). Drift-bit handling deferred to Unit 4 per plan.

**Goal:** Add an HTTP-based primary dump path to the iOS branch of `maestroDump({platform: 'ios'})`. Mirrors the shape of #2210's `runGrpcDump` for Android, with one iOS-specific addition: SpringBoard-only response detection. Send `{"appIds": [], "excludeKeyboardElements": false}` to the runner — server detects AUT itself (PR #2365 landed in cli-2.0.7). Replace the iOS-WIP branch's `runMaestroIosDump` stub with a real maestro-CLI fallback parser. Add the iOS branch of `flattenMaestroNodes` (small adapter from raw `AXElement` → `{attributes: {id, bounds}, children}` shape; existing `flattenMaestroNodes` already consumes Maestro's `TreeNode` shape so the CLI fallback path needs no iOS-specific changes).

**Requirements:** R1, R3, R4 (primary path), R6 (parity-test feasibility — iOS nodes flatten to same `id`-keyed shape as Android nodes).

**Dependencies:** Unit 1 (fixtures committed at `cli/packages/core/test/fixtures/maestro-ios-hierarchy/`, Plan Viability Gates 1+2+3 resolved per their now-collapsed state).

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js` (add `runIosHttpDump`, replace stub `runMaestroIosDump` body, add iOS branch of `flattenMaestroNodes`, update `IOS_SELECTOR_KEYS_WHITELIST` from `['id', 'class']` to `['id']`).
- Modify: `cli/packages/core/test/unit/maestro-hierarchy.test.js` (extend with iOS HTTP cases, iOS CLI-fallback cases, iOS branch of `flattenMaestroNodes` cases — three `describe(...)` blocks).
- *(No new files.)* The originally planned `cli/packages/core/src/xcui-element-types.js` and `cli/packages/core/src/maestro-ios-bundleid-resolver.js` are dropped per Unit 1's findings — Maestro's iOS TreeNode doesn't expose `class`, and PR #2365 makes server-side AUT detection the default at cli-2.0.7+.

**Approach:**

*HTTP dump (the primary work):*
- Add `runIosHttpDump({port, sessionId, deps})` helper. Reads `PERCY_IOS_DRIVER_HOST_PORT` env var. Validate the env value as an integer in the expected range derived from realmobile's formula (`wda_port + 2700`, so `11100–11110` for `wda_port` `8400–8410`). Refuse out-of-range values with reason `out-of-range-port` (mirrors `wda-session-resolver.js`); do not fall back to scanning. Refuses non-127.0.0.1/loopback URLs as a runtime guard.
- Thread `sessionId` from the relay request through to the dump helper. The existing call site at `api.js:559` (`await adbDump({ platform })`) needs updating to `await maestroDump({ platform, sessionId })`. `sessionId` is already validated against the `SAFE_ID = /^[a-zA-Z0-9_-]+$/` regex at `api.js:316`. Inside `runIosHttpDump`, `sessionId` is used only for log-scrubbed correlation; it does NOT drive any filesystem read (the deepening pass's `discoverAutBundleId` helper is dropped per Unit 1's PR #2365 finding).
- Use Node's native `http` module (matches `wda-hierarchy.js` pattern; avoids `node-fetch` dep; Node-14-safe per institutional learning).
- POST `Content-Type: application/json` body **`{"appIds": [], "excludeKeyboardElements": false}`** to `http://127.0.0.1:${port}/viewHierarchy`. The empty `appIds` is intentional and recommended — at cli-2.0.7+ the server detects the AUT internally via `RunningApp.getForegroundApp()` (PR #2365). Older Maestro versions return SpringBoard for empty `appIds`; the parser detects that case (see SpringBoard-only handling below) and routes to maestro-CLI fallback. `excludeKeyboardElements: false` keeps keyboards in snapshots.
- Two-tier deadline matching #2210's pattern: `IOS_HTTP_HEALTHY_DEADLINE_MS = 1500` (looser than Android gRPC's 250 because JSON tree walks are heavier) + `IOS_HTTP_CIRCUIT_BREAKER_MS = 5000` (Promise.race bound). Tunable from Unit 7 harness output before Unit 3b's flip.
- Module-scope HTTP keep-alive `http.Agent` cache per (host, port). Eager-close-and-evict on connection-class failure (mirrors #2210's gRPC channel cache).
- Response cap: 20 MB hard limit before parse (matches `wda-hierarchy.js` SOURCE_MAX_BYTES).
- Pre-parse safety: response must be `application/json`, must JSON.parse cleanly, must have `axElement` root + `depth` sibling.

*Response shape parsing (cli-2.0.7 source-confirmed):*
- Walk the response: `response.axElement` is the root; recursive `.children?.[]`. **Find the first node with `elementType === 1` (XCUI application) whose `identifier !== 'com.apple.springboard'`** — that is the AUT root. At cli-2.0.7 the AUT-found wrap is `[appHierarchy, statusBarsContainer]` where the statusBars wrapper has `elementType: 0` (defaulted via `AXElement.init(children:)`), so the rule naturally selects the AUT. At cli-1.39.13 the wrap was `[springboardHierarchy, appHierarchy]` where both have `elementType: 1`; the SpringBoard-skip handled that. Either way the rule picks the AUT.
- If no `elementType === 1` node with `identifier !== 'com.apple.springboard'` exists (the AUT-not-running case — server returns SpringBoard hierarchy directly with `axElement.identifier = 'com.apple.springboard'`), return `{kind: 'springboard-only', reason}` so caller routes to maestro-CLI fallback. **Do NOT use SpringBoard's tree as if it were the AUT's.**
- Frame keys are PascalCase on the wire: `frame.X`, `frame.Y`, `frame.Width`, `frame.Height` (Float). Convert to a `bounds` string `[X,Y][X+W,Y+H]` for the iOS branch of `flattenMaestroNodes` (matches Maestro `TreeNode`'s `attributes.bounds` format that the Android path produces and `firstMatch` already consumes).
- `children` may be absent on leaves (not empty array — `encodeIfPresent` semantics per `AXElement.swift:118`). Tolerate.
- The `elementType` Int is observed but NOT propagated to `attributes.class` — Maestro's iOS TreeNode doesn't expose `class`, and we keep parity (`id`-only iOS selector vocabulary). The Int is logged in debug for diagnostic purposes only.

*Error classification:*
- Add `classifyIosHttpFailure(err, response)` parallel to `classifyGrpcFailure` from #2210. Schema-class vs connection-class table — minimum 11 rows covering: ECONNREFUSED, ETIMEDOUT, socket-reset, 4xx status (likely malformed body), 5xx status, non-JSON content-type, malformed JSON, missing `axElement` root, missing `depth` field, no `elementType === 1` node, missing `frame` field on a node, frame key mismatch (lowercase vs PascalCase — defensive guard).
- Connection-class returns `{kind: 'connection-fail', reason}` so caller routes to fallback (R4).
- Schema-class returns `{kind: 'schema-drift', reason, code}` so caller routes to drift bit + skip (no fallback per R4).
- SpringBoard-only response classifies as `{kind: 'no-aut-tree', reason: 'springboard-only'}` — caller routes to maestro-CLI fallback (the slow path knows the AUT internally).

*Security guards (mirrored from `wda-hierarchy.js`):*
- Loopback-only URL (refuse non-127.0.0.1/`localhost`).
- Response cap before parse.
- Log scrubbing: reason tag + duration + sessionIdHash only — no port numbers, no raw JSON, no full hierarchy bytes.

*Replace `runMaestroIosDump` stub body (absorbed from iOS-WIP):*
- The current iOS-WIP branch has `runMaestroIosDump(udid, driverHostPort, execMaestro, getEnv)` returning `{kind: 'unavailable', reason: 'not-implemented'}` (with a `FIXME-PHASE-0.5` comment). Replace with:
  - Spawn `maestro --udid <udid> --driver-host-port <port> hierarchy` via the existing `execMaestro` injection point. `MAESTRO_BIN` env override already supported.
  - Slice stdout from first `{` (matches existing Android `runMaestroDump`).
  - `JSON.parse`. Result is Maestro's normalized `TreeNode` shape (per `IOSDriver.kt:174-220` — iOS uses the same `TreeNode` shape as Android via `mapViewHierarchy`).
  - Feed directly to existing `flattenMaestroNodes` — **no iOS-specific branching needed**, since `mapViewHierarchy` produces `attributes.{resource-id, bounds, ...}` keyed identically to Android's `TreeNode` output.
  - Error classification mirrors Android: `maestro-no-json`, `maestro-parse-error:<msg>`, `maestro-exit-<code>`.
- This is the iOS connection-class fallback path for `runIosHttpDump`. Maestro CLI knows the AUT internally so SpringBoard-only responses from the HTTP path are handled gracefully here.

*Add iOS branch of `flattenMaestroNodes` (HTTP path adapter):*
- The Android `flattenMaestroNodes` reads `obj.attributes.*` (Maestro `TreeNode` shape: `{attributes: {resource-id, text, content-desc, class}, children: [...]}`).
- The iOS HTTP path returns raw `AXElement` (different shape: `{identifier, frame.X/Y/Width/Height, elementType, children?, ...}`). Add an iOS branch that walks the AXElement tree starting at the AUT root (per the SpringBoard-skip rule above) and emits `{attributes: {'resource-id': identifier, bounds: '[X,Y][X+W,Y+H]'}, children: [...]}` — same shape `firstMatch` already consumes for Android. **No `class` attribute** (matches Maestro's iOS TreeNode capability).
- The maestro-CLI fallback path consumes `TreeNode` directly (no iOS-specific code needed there).

*iOS selector vocabulary:*
- `IOS_SELECTOR_KEYS_WHITELIST = ['id']` only. The existing iOS-WIP scaffold exports this with `['id', 'class']`; Unit 2 narrows it to `['id']` per Unit 1's finding that Maestro doesn't expose `class` on iOS. SDK-side selector validation should reject `class` on iOS at the relay layer with a clear warning ("class selectors are not supported on iOS — use id").

**Execution note:** Test-first. Specs that consume Unit 1's vendored fixture as the wire body should be written before the parser logic. This catches schema drift if the fixture is updated.

**Patterns to follow:**
- `cli/packages/core/src/maestro-hierarchy.js` `runGrpcDump` + `classifyGrpcFailure` (PR #2210) — primary structural reference for HTTP transport, two-tier deadline, agent caching, error classification.
- `cli/packages/core/src/maestro-hierarchy.js` `runMaestroDump` (Android CLI shell-out) — model for the iOS CLI fallback's spawn + stdout-slice + JSON.parse pattern.
- `cli/packages/core/src/wda-hierarchy.js` security guards (loopback URL refusal, response cap before parse, scrubbed logs).

**Test scenarios:**
- *bundleId discovery:* `flows/*.yaml` with one `appId:` → returns `[bundleId]`. **Two flow files with different (non-`_percy_subflow`) `appId:` → returns `{kind: 'no-aut-tree', reason: 'multiple-app-ids'}` and routes to fallback** (refuses to forward both, per multi-tenant defense). Subflows excluded. Missing test-suite dir → `test-suite-dir-missing` reason. Empty dir → `no-flow-files`. YAML malformed → `parse-error`. **Symlink at `/tmp/<sid>_test_suite` → `test-suite-dir-symlink` reason. Symlink at `/tmp/<sid>_test_suite/flows` → `flows-dir-symlink` reason.** YAML file > 1MB → `yaml-too-large`. > 50 flow files → `too-many-flow-files`. Invalid sessionId → `invalid-session-id`.
- *Port range validation:* `PERCY_IOS_DRIVER_HOST_PORT` set to `9999` (out of `11100–11110` range) → `out-of-range-port`, route to maestro-CLI fallback (no HTTP call attempted). `PERCY_IOS_DRIVER_HOST_PORT` unset → connection-fail/`port-unset`.
- *HTTP healthy at cli-2.0.7 (canonical happy path):* 200 with `viewHierarchy-response.json` fixture body — outer wrap with `[appHierarchy, statusBarsContainer]`, statusBars wrapper has `elementType: 0`. Walk to first `elementType === 1` whose `identifier !== 'com.apple.springboard'` → finds `com.example.app`. Returns `{kind: 'hierarchy', nodes: [...]}` with N flattened nodes; `attributes.bounds` is bracket-format string.
- *HTTP healthy at cli-1.39.13 SpringBoard wrap (regression guard):* 200 with synthetic root containing `[springboardHierarchy, appHierarchy]` children, **both with `elementType === 1`** → walk skips SpringBoard, finds AUT, returns its tree. Catches the naïve "first elementType==1" parser bug.
- *HTTP healthy with PR-2402 single AUT root (forward-compat):* 200 with no wrap, `axElement` IS the AUT directly with `elementType: 1, identifier: 'com.example.app'`. Walk returns AUT tree.
- *SpringBoard-only response (`viewHierarchy-response-springboard-only.json` fixture):* 200 with `axElement.identifier === 'com.apple.springboard'` and no AUT child → returns `{kind: 'no-aut-tree', reason: 'springboard-only'}`.
- ECONNREFUSED on connect → `{kind: 'connection-fail', reason: 'connection-refused'}`.
- ETIMEDOUT past `IOS_HTTP_HEALTHY_DEADLINE_MS` → connection-fail.
- Socket reset mid-response → connection-fail.
- 5xx status → connection-fail.
- 4xx status with body `"incorrect request body provided"` (the v1.39.13 4xx signature when fields are wrong shape) → schema-drift `bad-request-shape`.
- 200 with `Content-Type: text/html` → schema-drift `non-json-content-type`.
- 200 with body that JSON.parses but has no `axElement` root key → schema-drift `missing-root`.
- 200 with hierarchy but a node missing `frame` → schema-drift `missing-frame`.
- 200 with `frame.x/y/width/height` lowercase (defensive) → schema-drift `frame-key-case-mismatch`.
- Response > 20 MB → schema-drift `response-too-large` (cap before parse).
- Loopback-only guard: passing `host: '0.0.0.0'` → throws synchronously.
- *Port-range validation:* `PERCY_IOS_DRIVER_HOST_PORT` set to `9999` (out of `11100–11110`) → `{kind: 'connection-fail', reason: 'out-of-range-port'}` without making the HTTP call. Unset → connection-fail/`port-unset`.
- Concurrent calls to `runIosHttpDump` reuse the same `http.Agent`; calls after a connection-class failure get a fresh agent.

**`runMaestroIosDump` (replacement of stub) — test scenarios:**
- *Happy path:* mock `execMaestro` returns the `maestro-cli-ios-stdout.json` fixture from Unit 1. Parser walks TreeNode, returns `{kind: 'hierarchy', nodes: [...]}` with non-empty nodes. Log shows `via maestro-cli (N nodes)`.
- *No-JSON:* stdout has no `{` → `{kind: 'dump-error', reason: 'maestro-no-json'}`.
- *Parse error:* stdout has `{` but invalid JSON → `{kind: 'dump-error', reason: 'maestro-parse-error:<msg>'}`.
- *Non-zero exit:* `execMaestro` returns `exitCode: 137` → `{kind: 'dump-error', reason: 'maestro-exit-137'}`.
- *Stub-removed verification:* grep the source confirms `runMaestroIosDump` no longer returns `{ kind: 'unavailable', reason: 'not-implemented' }` and the `FIXME-PHASE-0.5` comment block is gone.

**`flattenMaestroNodes` iOS branch — test scenarios:**
- *iOS HTTP path:* given the `viewHierarchy-response.json` fixture's AUT subtree, the iOS adapter emits flattened nodes with `attributes['resource-id'] = 'com.example.app'`, `attributes.bounds = '[0,0][390,844]'`, etc. **No `class` attribute.**
- *iOS CLI fallback path:* given the `maestro-cli-ios-stdout.json` fixture (already in Maestro `TreeNode` shape with `attributes.{resource-id, bounds, ...}`), existing `flattenMaestroNodes` consumes it unchanged. iOS-specific code is not invoked on this path.
- *Selector vocabulary:* `firstMatch(nodes, {id: 'submitBtn'})` returns the button's bbox (matches `attributes['resource-id']`). `firstMatch(nodes, {class: 'whatever'})` returns `null` on iOS — `class` is not in the iOS selector whitelist.
- *Cross-path equivalence:* given the Unit 1 fixtures (HTTP variant 2 and CLI variant 6 representing the same logical AUT), both paths flatten to node sets with matching `attributes['resource-id']` and `attributes.bounds` for the same logical elements. Tolerance: bracket-format `bounds` string equality after both paths normalize.

**Verification:**
- All ≥18 test scenarios pass (HTTP path scenarios + `runMaestroIosDump` scenarios + `flattenMaestroNodes` iOS scenarios).
- `runIosHttpDump` does not import `wda-hierarchy.js` (decoupled module boundary).
- `console.log` / `log.debug` output never contains port numbers, raw response bytes, or full hierarchy fragments.
- Unit 1's vendored HTTP fixture (`viewHierarchy-response.json`) round-trips through the parser to a non-empty `nodes` array with bracket-format `bounds`.
- Unit 1's vendored CLI stdout fixture (`maestro-cli-ios-stdout.json`) round-trips through the existing `flattenMaestroNodes` to a non-empty `nodes` array — no iOS-specific branching invoked.
- `runMaestroIosDump` is no longer a stub — verified by grep: the function body spawns `execMaestro(['--udid', udid, '--driver-host-port', driverHostPort, 'hierarchy'], ...)`. The `FIXME-PHASE-0.5` comment block from the iOS-WIP scaffold is removed.
- `IOS_SELECTOR_KEYS_WHITELIST` is `['id']` (was `['id', 'class']` on the iOS-WIP scaffold). A test asserts `class` selectors return `null` on iOS-flattened nodes.

---

- [x] **Unit 3a: Wire iOS HTTP as opt-in primary; CLI shell-out as fallback; per-snapshot relay-payload override (default REMAINS `wda-direct`)** — completed 2026-05-07 on branch `feat/maestro-ios-http-resolver` commit `7e048935`. 6/6 cascade tests pass + existing tests unchanged. Resolver cascade landed in api.js: per-snapshot body.resolver → PERCY_IOS_RESOLVER env → default wda-direct. Unknown body.resolver returns HTTP 400; unknown env values warn + fall back to wda-direct. sessionId threaded through to maestroDump.

**Goal:** Make the iOS branch of `maestroDump` call `runIosHttpDump` first when opted in, fall through to maestro-CLI on connection-class / no-AUT-tree failures, set drift bit on schema-class failures. **Default behavior unchanged** — `PERCY_IOS_RESOLVER` remains effectively `wda-direct` when unset; customers must explicitly opt in to the HTTP path during the validation window. Add per-snapshot relay-payload `resolver` override for ops diagnostics.

**Requirements:** R1, R2, R4, R9.

**Dependencies:** Unit 2.

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js` (iOS branch of `maestroDump`)
- Modify: `cli/packages/core/src/api.js` (`PERCY_IOS_RESOLVER` dispatch + new `request.body.resolver` override)
- Modify: `cli/packages/core/test/unit/maestro-hierarchy.test.js`
- Modify: `cli/packages/core/test/unit/api.test.js`

**Approach:**
- In `maestroDump({platform: 'ios'})`: call `runIosHttpDump` first. Routing:
  - `{kind: 'hierarchy', nodes}` → return as-is. Log `[percy:core:maestro-hierarchy] dump took Nms via maestro-http (N nodes)` (matches #2210's `via grpc` / `via maestro` wording).
  - `{kind: 'connection-fail', reason}` → log `via maestro-cli-fallback (connection-fail/${reason})`, call `runMaestroCliDump`.
  - `{kind: 'no-aut-tree', reason}` → log `via maestro-cli-fallback (no-aut-tree/${reason})`, call `runMaestroCliDump`. Maestro CLI knows the AUT internally so this fallback succeeds even when bundleId discovery failed.
  - `{kind: 'schema-drift', code, reason}` → set the healthcheck dirty bit's iOS slot (Unit 4) and return `{kind: 'dump-error', reason}`. **No fallback** per R4 — schema drift is a signal that needs human attention, not silent degradation.
- In `api.js` dispatch:
  - Resolver choice precedence: `request.body.resolver` (per-snapshot override) → `PERCY_IOS_RESOLVER` env (explicit operator choice) → **environment-conditional default** → final fallback `'wda-direct'`.
  - Environment-conditional default in Unit 3a: **always `wda-direct`** regardless of `PERCY_IOS_DRIVER_HOST_PORT` presence. Opt-in only — no silent transport switch for any customer.
  - Environment-conditional default after Unit 3b's flip: `'maestro-hierarchy'` if `PERCY_IOS_DRIVER_HOST_PORT` is present in env, otherwise `'wda-direct'`. The env presence is the realmobile-deployment signal; absence indicates self-hosted Maestro where the runner port isn't injected and the default WDA path keeps working.
  - Validate the per-snapshot override against the same value set as the env (`'wda-direct' | 'maestro-hierarchy'`); reject with HTTP 400 if unknown rather than silently fall through.
  - When the resolver in effect is `'maestro-hierarchy'`, log INFO `[percy:core] iOS resolver: maestro-hierarchy (HTTP primary, maestro-cli fallback)` once per CLI process startup. When `'wda-direct'`, log INFO `iOS resolver: wda-direct (legacy; set PERCY_IOS_RESOLVER=maestro-hierarchy to opt in to the new transport)` so opt-in path is discoverable. After Unit 3b ships and the resolver defaulted because `PERCY_IOS_DRIVER_HOST_PORT` was unset, the WDA log line should also include `(env-conditional default; PERCY_IOS_DRIVER_HOST_PORT not set)` so self-hosted customers see why they're on the legacy path.
  - When `'wda-direct'` is explicit (env set, not env-conditional defaulted) AND Unit 3b has flipped, log a WARN per dump call so rollback state is observable.

**Execution note:** Make sure existing `feat/ios-element-regions-maestro-hierarchy` test cases still pass — they were written against the maestro-CLI primary; they now describe the fallback path. The default-unchanged stance lets this PR ship without behavior regression for any customer.

**Patterns to follow:**
- `maestroDump` Android branch's primary→fallback wiring (PR #2210).
- PR #2210's `PERCY_MAESTRO_GRPC=0` kill-switch logging shape.

**Test scenarios:**
- iOS happy path with `PERCY_IOS_RESOLVER=maestro-hierarchy`: `runIosHttpDump` returns hierarchy → no fallback invoked → log shows `via maestro-http`.
- iOS HTTP connection-fail → `runMaestroCliDump` invoked → log shows `via maestro-cli-fallback (connection-fail/...)`.
- iOS HTTP no-aut-tree (bundleId not discovered) → `runMaestroCliDump` invoked → log shows `via maestro-cli-fallback (no-aut-tree/no-bundleid-discovered)`.
- iOS HTTP no-aut-tree (SpringBoard-only) → fallback invoked, log shows `via maestro-cli-fallback (no-aut-tree/springboard-only)`.
- iOS HTTP schema-drift → drift bit's iOS slot set → element regions skipped with warn → no fallback → no further `dump` calls in this request.
- `PERCY_IOS_RESOLVER` unset, `PERCY_IOS_DRIVER_HOST_PORT` unset → legacy `wda-hierarchy.js` invoked (env-conditional default falls to `wda-direct`; opt-in path in 3a, also self-hosted-default in 3b).
- `PERCY_IOS_RESOLVER` unset, `PERCY_IOS_DRIVER_HOST_PORT` SET (realmobile case): in 3a, still legacy `wda-hierarchy.js` (opt-in only); in 3b, `runIosHttpDump` invoked (env-conditional default flipped because driver port is present).
- `PERCY_IOS_RESOLVER=wda-direct` (explicit) → legacy `wda-hierarchy.js` invoked, regardless of `PERCY_IOS_DRIVER_HOST_PORT` presence.
- `PERCY_IOS_RESOLVER=maestro-hierarchy` (explicit), `PERCY_IOS_DRIVER_HOST_PORT` unset → operator opted-in but env signal is missing. Run `runIosHttpDump`; it will fail port-validation and route to maestro-CLI fallback. Log INFO line is clear about the env mismatch.
- `PERCY_IOS_RESOLVER` set to unknown value (e.g. `''`, `garbage`) → defaults to env-conditional behavior (graceful) and emits a one-time WARN about the unknown value.
- Per-snapshot override: request body `{resolver: 'maestro-hierarchy'}` with `PERCY_IOS_RESOLVER` unset → HTTP path used for that single snapshot.
- Per-snapshot override: request body `{resolver: 'wda-direct'}` with `PERCY_IOS_RESOLVER=maestro-hierarchy` → WDA path used for that single snapshot.
- Per-snapshot override: request body `{resolver: 'invalid'}` → HTTP 400 with clear error message; no resolver invoked.

**Verification:**
- All scenarios pass at unit test level.
- Existing `wda-hierarchy.js` specs still pass — that path is the default in 3a.
- Existing iOS-WIP branch's `maestroDump` shell-out specs are repositioned as fallback-path specs and still pass.
- Default-unchanged stance verified: a customer upgrading the CLI with no env changes sees identical behavior to today.

---

- [ ] **Unit 3b: Environment-conditional default flip (follow-up PR)**

**Goal:** After Unit 3a has been shipped and the validation window has passed, change the dispatch default from "always `wda-direct`" to "**`maestro-hierarchy` IF `PERCY_IOS_DRIVER_HOST_PORT` is present in env, otherwise `wda-direct`**." This delivers the failure-class fix to BS realmobile customers (where the env IS injected) without silently regressing self-hosted iOS Percy customers (where it is NOT and where the WDA happy path still works at sub-second latency).

**Requirements:** R7-equivalent (validation-gated rollout), R9 (kill-switch preserved). Closes the P0 self-hosted-regression risk surfaced by document review.

**Gating conditions (ALL must hold):**
- ≥2 calendar weeks since Unit 3a shipped to a CLI release with `via maestro-http` log dominance >99% on opt-in BS realmobile production traffic (operator opt-in via host env — operator already controls this on per-host basis).
- Zero non-null `maestroHierarchyDrift.ios` on opt-in customers across the validation window.
- Unit 6 (V3 regression) green on at least one BS realmobile real-device run with the AUT-crash fixture.
- Unit 7 (V4.2 concurrent harness) green with the production-tuned `IOS_HTTP_HEALTHY_DEADLINE_MS` value.
- Plan Viability Gates 1, 2, 3 all confirmed resolved (`capture-notes.md` documents wire-format match against actual Maestro versions deployed to BS hosts during the window).

**Files:**
- Modify: `cli/packages/core/src/api.js` (env-conditional default in resolver-choice cascade)
- Modify: `cli/packages/core/test/unit/api.test.js` (extend default-test cases for both env-set and env-unset paths)
- Modify: relevant CHANGELOG / release notes

**Approach:**
- Open a separate, narrow PR. Title: `feat(core): env-conditional default for iOS resolver after validation window`.
- Behavior change: in the resolver-choice cascade, the third-tier default (after per-snapshot override and explicit env) reads `PERCY_IOS_DRIVER_HOST_PORT`. If set, default = `'maestro-hierarchy'`. If unset, default = `'wda-direct'`. Final fallback if all three unset = `'wda-direct'`.
- Keep `PERCY_IOS_RESOLVER=wda-direct` as the documented rollback knob (works for both realmobile and self-hosted) in the validation skill addendum.
- PR description must paste the production-evidence numbers (grep counts for `via maestro-http` vs `via maestro-cli-fallback` vs `via wda-direct`, healthcheck-drift query results, V3/V4 harness output) — same shape as PR #2210's R6 merge gate.

**Execution note:** Split to follow-up PR. Do NOT bundle with Units 1–7 in the main work. Same conservatism as Unit 8's WDA-direct deletion — validation is more important than shipping speed.

**Patterns to follow:**
- PR #2210's deferred `runAdbFallback` deletion (same shape: validate first, narrow follow-up PR).
- The validation skill's "Validated builds" table — extend with a new row when 3b lands.

**Test scenarios:**
- All Unit 3a scenarios continue to pass (no behavior regression for explicitly-set values).
- *Realmobile case:* `PERCY_IOS_RESOLVER` unset, `PERCY_IOS_DRIVER_HOST_PORT` SET (e.g. `11103`) → resolver defaults to `maestro-hierarchy`; `runIosHttpDump` invoked.
- *Self-hosted case:* `PERCY_IOS_RESOLVER` unset, `PERCY_IOS_DRIVER_HOST_PORT` unset → resolver defaults to `wda-direct`; legacy `wda-hierarchy.js` invoked. **No silent regression.** Log INFO line is the only customer-visible artifact: `[percy:core] iOS resolver: wda-direct (env-conditional default; PERCY_IOS_DRIVER_HOST_PORT not set — set PERCY_IOS_RESOLVER=maestro-hierarchy to opt in)`.
- *Explicit opt-in by self-hosted operator:* `PERCY_IOS_RESOLVER=maestro-hierarchy`, `PERCY_IOS_DRIVER_HOST_PORT` unset → operator's choice respected; `runIosHttpDump` invoked, fails port-validation, falls through to maestro-CLI shell-out per Unit 2's existing flow. Operator sees the explicit-opt-in WARN once.
- *Explicit kill switch on realmobile:* `PERCY_IOS_RESOLVER=wda-direct`, `PERCY_IOS_DRIVER_HOST_PORT=11103` → legacy `wda-hierarchy.js` invoked + WARN log per dump call (rollback state observable).
- Customer who explicitly sets `PERCY_IOS_RESOLVER=wda-direct` after 3b lands gets the legacy path + WARN log per dump call (kill switch works regardless of env).

**Verification:**
- Unit tests cover the four cases of `(PERCY_IOS_RESOLVER set/unset) × (PERCY_IOS_DRIVER_HOST_PORT set/unset)`.
- Production telemetry on realmobile continues to show `via maestro-http` dominance in the week after 3b ships.
- Production telemetry on self-hosted customers (if any are reachable via observability) shows continued `via wda-direct` dominance — no silent regression.
- Customer-facing notes (release notes, README addendum, validation skill) document the env-conditional default and the explicit kill knob, including the self-hosted-customer guidance.

---

- [x] **Unit 4: Refactor healthcheck `maestroHierarchyDrift` to two-slot shape (coordinate with #2210 author)** — completed 2026-05-07 on branch `feat/maestro-ios-http-resolver` commit `35957fc7`. 6/6 new Unit 4 tests pass + existing /healthcheck test updated for two-slot envelope. iOS schema-class failures now flip the ios slot; android slot reserved for #2210's retrofit when it rebases atop this PR (worst-case path from Plan Viability Gate 4 — fresh greenfield setter, single-author owns both PRs so rebase coordination is internal).

**Goal:** `/percy/healthcheck` exposes a two-slot `{android, ios}` drift envelope. Refactor #2210's setter to take a platform argument and write to the correct slot. Both platforms can drift simultaneously without losing signal.

**Requirements:** R5.

**Dependencies:** Unit 2 (iOS path uses the setter); cross-PR coordination with PR #2210's author per Plan Viability Gate 4.

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js` (drift bit setter — change shape)
- Modify: `cli/packages/core/src/api.js` (healthcheck handler — emit two-slot envelope)
- Modify: `cli/packages/core/test/unit/api.test.js` (healthcheck cases — extend to cover both slots, simultaneous-drift case)

**Approach:**

*Coordination with PR #2210 (Plan Viability Gate 4):*
- Before opening this plan's PR, post a comment on #2210 announcing the upcoming arg addition and the shape change from single-field-with-discriminator (which the deepening pass rejected) to two-slot.
- **Preferred path:** persuade #2210's author to land the platform arg + two-slot shape pre-emptively in #2210 itself (no behavior change since only Android writes into `slot.android` for now). This eliminates the post-merge refactor and lets this plan's PR purely *consume* the existing setter.
- **Fallback path:** if #2210's author declines, this plan's Unit 4 refactors the setter post-merge. The PR description for Unit 4 must explicitly call out the cross-PR coordination, and a Percy CLI integration test must guard against missed Android call sites (drift bit must still fire on Android for the same conditions PR #2210's specs cover).
- **Worst case:** #2210 is rejected/abandoned. Then this plan's Unit 4 ports the setter from the iOS-WIP branch baseline and adds the platform arg from scratch — Android slot stays unwritten until a future Android-resolver work lands. Document this as a known-empty slot.

*Setter shape:*
- Note on actual #2210 names: PR #2210 currently exports the drift surface as `recordSchemaDrift(code, reason)` (write) + `getSchemaDriftSeen()` (read). Unit 4 renames to `setMaestroHierarchyDrift({platform, code, reason})` + `getMaestroHierarchyDrift()` as part of this refactor. Wherever this plan refers to `setMaestroHierarchyDrift` it means *the post-Unit-4 name* of #2210's existing function, not a new function in addition to it.
- Final shape: `setMaestroHierarchyDrift({platform, code, reason})` where `platform: 'android' | 'ios'`. Module-state holds two slots; first occurrence per-platform sets `firstSeenAt`; subsequent same-platform same-`code` writes are no-ops (preserves `firstSeenAt`).

*Healthcheck JSON shape:*
```
{
  "maestroHierarchyDrift": {
    "android": { "code": "...", "reason": "...", "firstSeenAt": "ISO-8601" } | null,
    "ios":     { "code": "...", "reason": "...", "firstSeenAt": "ISO-8601" } | null
  }
}
```
- Both slots `null` in steady state.
- Two slots populated independently. Simultaneous drift on both platforms preserves both signals — directly fixes the loss-of-correlation gap that the deepening pass identified in the original single-field-with-discriminator design.
- Backward compat: this is an additive shape change. Existing healthcheck consumers reading `maestroHierarchyDrift` and checking `=== null` will see `{android: null, ios: null}` instead and need to update — coordinate with any internal/Percy ops dashboards before flip. The change is small (object-vs-null check) and the field is undocumented as public.

**Patterns to follow:**
- PR #2210's existing `maestroHierarchyDrift` setter and healthcheck wiring at `api.js` (the in-flight version this Unit refactors).

**Test scenarios:**
- Steady state — `maestroHierarchyDrift` is `{android: null, ios: null}`.
- iOS schema-drift fires once → `{android: null, ios: {code, reason, firstSeenAt}}`.
- Android schema-drift fires after iOS → `{android: {...}, ios: {...}}` — both populated, neither overwritten.
- Same-platform same-code fires twice → `firstSeenAt` preserved from first, no overwrite.
- Same-platform different-code fires after first → first occurrence wins; subsequent codes logged but not promoted to the slot (alternative: keep latest code; pick during implementation, document choice). Recommend: **first-occurrence wins** to preserve initial-cause diagnostic value.
- Existing Android-only specs from PR #2210 (or wherever the setter currently lives) → continue to pass after refactor; assertion targets become `maestroHierarchyDrift.android` instead of `maestroHierarchyDrift`.

**Verification:**
- All scenarios pass.
- All existing Android-side specs pass after retargeting their assertions to the `android` slot.
- Plan Viability Gate 4 documented as resolved (cross-PR coordination outcome recorded in PR description).

---

- [x] **Unit 5: Cross-platform parity integration harness (V2)** — completed 2026-05-07 on branch `feat/maestro-ios-http-resolver` commit `8c34f2d2`. V1 is log-only (manual eyeball of Percy side-by-side); V1.1 may tighten to programmatic ±2px once example-app dimension table is documented.

**Goal:** Same example app, same logical selector, same flow → bboxes within ±2px on both platforms. Extend the existing scaffolded harness from `feat/ios-element-regions-maestro-hierarchy`.

**Requirements:** R6, V2.1, V2.2.

**Dependencies:** Unit 3 (HTTP path live).

**Files:**
- Modify: `cli/packages/core/test/integration/cross-platform-parity.harness.js` (existing — extend to invoke HTTP path)
- Modify: `cli/packages/core/test/integration/fixtures/parity-flow-android.yaml` (existing if present, else create)
- Create: `cli/packages/core/test/integration/fixtures/parity-flow-ios.yaml`
- Modify: `cli/packages/core/test/integration/README.md`

**Approach:**
- Env-gated on `MAESTRO_PARITY_DEVICES=<android-serial>:<ios-udid>`. Skips silently in CI.
- Same example app build, same logical selector (e.g. `text: "Submit"` if the example app exposes one, else `class: ...Layout` with platform-specific class translation handled by `flattenMaestroNodes`'s mapping).
- Run flow on both devices, compare resolved bboxes after normalizing for device DPI and orientation. Assert `|Δ| ≤ 2px` per side.
- V2.2: same selector with no match returns `firstMatch=null` on both platforms with identical "Element region not found" warning shape.

**Patterns to follow:**
- Existing `cross-platform-parity.harness.js` from iOS-WIP branch.
- PR #2210's `maestro-hierarchy-concurrent.harness.js` for env-gate skip pattern.

**Test scenarios:**
- Element exists on both: bboxes within ±2px.
- Element does not exist on either: both return null + identical warning text.
- Element exists on Android only / iOS only: documented as a known cross-platform-app divergence; harness logs but does not assert (this is example-app limitation, not resolver bug).

**Verification:**
- Harness output pasted into PR description shows green parity assertions.
- Skip-path: with env unset, harness exits 0 with `skip: MAESTRO_PARITY_DEVICES not set`.

---

- [x] **Unit 6: WDA failure-class regression harness (V3)** — completed 2026-05-07 commit `8c34f2d2`. Runs `ios-aut-crash-regions.yaml` twice (wda-direct vs maestro-hierarchy) and logs Percy warnings + build URLs for human verification.

**Goal:** Reproducible test that proves the `[FBRoute raiseNoSessionException]` failure class is fixed by the HTTP path. Pre-fix run (with `PERCY_IOS_RESOLVER=wda-direct`) must reproduce the failure; post-fix run (default) must not.

**Requirements:** Success criterion #1, V3.1–V3.4.

**Dependencies:** Unit 3.

**Files:**
- Create: `cli/packages/core/test/integration/fixtures/ios-aut-crash-regions.yaml`
- Create: `cli/packages/core/test/integration/maestro-ios-hierarchy-regression.harness.js`
- Modify: `cli/packages/core/test/integration/README.md`

**Approach:**
- Maestro flow that intentionally `killApp` or `stopApp`s the AUT mid-flow, then immediately `takeScreenshot` with element regions referencing system UI elements (Settings app's `Search` field — present after AUT exit).
- Harness runs the flow twice on the same device:
  1. With `PERCY_IOS_RESOLVER=wda-direct`: assert the `[percy] Warning: Element region not found` warning fires for all element regions; assert the resolver log shows `dump-error` with `wda-no-session` or equivalent reason.
  2. With default (`maestro-hierarchy`): assert the element regions resolve to non-null bboxes; assert the resolver log shows `via maestro-http (N nodes)`.
- Env-gated on `MAESTRO_IOS_TEST_DEVICE=<udid>`.

**Patterns to follow:**
- PR #2210's concurrent-access harness file structure.

**Test scenarios:**
- Pre-fix (kill switch): AUT crash → element regions skipped + warning, matches today's broken behavior. Test asserts the broken behavior still reproduces (negative assertion — proves the regression target is real).
- Post-fix (default): AUT crash → element regions resolve via HTTP path. Test asserts the fix works.
- The flow itself is also deployable for manual demo (high-leverage as a "before/after" capture for stakeholders).

**Verification:**
- Both runs (pre- and post-fix) produce expected log lines.
- Run output pasted into PR description.

---

- [x] **Unit 7: iOS HTTP concurrent-access harness (V4.2)** — completed 2026-05-07 commit `8c34f2d2`. Mirrors the originally-planned PR #2210's gRPC concurrent harness shape: 100 iterations of runIosHttpDump while a Maestro pause flow holds the device active, captures p50/p95/p99 + KTD threshold check (p95 vs IOS_HTTP_HEALTHY_DEADLINE_MS=1500ms).

**Goal:** Mirror PR #2210's R6 merge gate harness for iOS. Captures p50/p95/p99 timings under realistic concurrent load. Output drives the final `IOS_HTTP_HEALTHY_DEADLINE_MS` choice.

**Requirements:** V4.2.

**Dependencies:** Unit 3.

**Files:**
- Create: `cli/packages/core/test/integration/maestro-hierarchy-ios-http-concurrent.harness.js`
- Modify: `cli/packages/core/test/integration/README.md`

**Approach:**
- Same shape as PR #2210's `maestro-hierarchy-concurrent.harness.js`. Env-gated on `MAESTRO_IOS_TEST_DEVICE=<udid>`. Skips silently in CI.
- 30s pause flow + repeated `runIosHttpDump` calls during the pause window. Capture p50/p95/p99.
- KTD-style threshold check: align the threshold with the success-criterion percentile. The success criterion targets **p95 ≤ 1000ms** (origin doc); the harness reports p50/p95/p99. Use **p95** as the canonical merge-gate metric: if `p95 ≥ IOS_HTTP_HEALTHY_DEADLINE_MS × 0.9` (i.e., approaching the deadline), bump the deadline to `p95 × 2` before merge. The 5s circuit-breaker is independent and stays at 5000. p99 is observability data only — log it but do not gate on it (avoids the prior version's mismatch where Unit 7 gated on p99 while the success criterion measured p95).

**Patterns to follow:**
- `cli/packages/core/test/integration/maestro-hierarchy-concurrent.harness.js` (PR #2210).
- `cli/packages/core/test/integration/fixtures/pause-30s-flow.yaml` (PR #2210 — reusable, no platform-specific content).

**Test scenarios:** N/A — operational harness, not a unit test. Output is paste-into-PR data.

**Verification:**
- Harness output pasted into PR description.
- p99 timing meets the configured deadline (or deadline is bumped per the KTD check before merge).

---

- [ ] **Unit 8: Retire `wda-hierarchy.js` and `PERCY_IOS_RESOLVER=wda-direct` arm (deferred follow-up PR — Phase 5)**

**Goal:** Delete the WDA-direct path after Unit 3b's default flip has been live for ≥1 week of post-flip production stability. This is the iOS analog of PR #2210's `runAdbFallback` Unit-5 split.

**Requirements:** R7.

**Dependencies:** Unit 3b shipped and live for ≥1 calendar week. Production telemetry shows `via maestro-http` > 99% across all element-region dumps for the post-flip window. Zero non-null `maestroHierarchyDrift.ios` for the same window.

**Files:**
- Delete: `cli/packages/core/src/wda-hierarchy.js`
- Delete: `cli/packages/core/test/unit/wda-hierarchy.test.js`
- Modify: `cli/packages/core/src/api.js` (remove `PERCY_IOS_RESOLVER === 'wda-direct'` branch + the legacy `resolveIosRegions` import)
- Possibly delete: `cli/packages/core/src/wda-session-resolver.js` if it has no other consumers after the deletion (verify by grep).

**Approach:**
- Verify telemetry gate has held for ≥1 week (grep counts on a representative BS host's debug logs + healthcheck-drift query).
- Open a separate, narrow PR that deletes the legacy code. No behavior change beyond removal.
- After this lands: `PERCY_IOS_RESOLVER` env is functionally a no-op (only one branch left); deprecate the env name with a one-version warning, then remove in a subsequent CLI minor.

**Execution note:** Split to follow-up PR. Do NOT bundle with the main work in Units 1–7. Same conservatism as PR #2210's Unit 5 split.

**Patterns to follow:**
- PR #2210's PR description, "Unit 5 (delete dead `runAdbFallback`) is split to a follow-up PR, gated on ≥1 week of `via grpc` log dominance in production."

**Test scenarios:** Existing iOS HTTP + fallback specs continue to pass.

**Verification:**
- After deletion, `wda-hierarchy.js` is gone; `grep -r 'wda-hierarchy' packages/core/src/` returns no matches.
- Healthcheck still returns the unified `maestroHierarchyDrift` shape.

## System-Wide Impact

- **Interaction graph:**
  - `/percy/maestro-screenshot` relay (api.js) → resolver-choice dispatch (env + per-snapshot override + default) → `maestroDump({platform, sessionId})` (maestro-hierarchy.js) → primary HTTP transport (`runIosHttpDump`, sends `appIds: []`) → optional maestro-CLI fallback (`runMaestroIosDump`) → `flattenMaestroNodes` (iOS HTTP path: AXElement→TreeNode-shape adapter; iOS CLI path: consumes Maestro's TreeNode unchanged) → per-region `firstMatch` (iOS: `id` selector matches `attributes['resource-id']`) → comparison payload.
  - `/percy/healthcheck` (api.js) → reads `maestroHierarchyDrift` module-state, emits `{android, ios}` two-slot envelope.
  - SDK (`percy-screenshot.js`) → unchanged; never sees the dispatch.
  - Realmobile (`maestro_session.rb`) → unchanged; already injects `PERCY_IOS_DRIVER_HOST_PORT` + `ANDROID_SERIAL` + `MAESTRO_BIN`.
  - Test-suite YAML at `/tmp/<sid>_test_suite/` → unchanged. Plan does not read these files (Unit 1's PR #2365 finding obviated bundleId YAML scraping). The validation skill cites `/tmp/<sid>_test_suite/logs/` for log inspection during BS validation runs — that's unrelated to Percy CLI's own behavior.
- **Error propagation:** Connection-class HTTP failures cascade silently to maestro-CLI fallback (slow but reliable). `no-aut-tree` (no bundleId discovered, or SpringBoard-only response) also routes to fallback. Schema-class failures flip drift bit's iOS slot and skip element regions with `[percy] Warning: Element region not found` — snapshot still uploads, missing only the region overlay. SDK/customer never sees a hard failure for hierarchy issues.
- **State lifecycle risks:**
  - Module-scope `http.Agent` per (host, port) keeps connections warm across requests. Eager-close-and-evict on connection-class failure prevents the "stuck CONNECTING" symptom (analogous to grpc-node#2620 risk PR #2210 mitigates with the same pattern).
  - `maestroHierarchyDrift` module state is process-lifetime; CLI restart clears both slots (acceptable — drift is recapturable on the next request).
  - No filesystem reads from Percy CLI's iOS path (Unit 1 obviated the bundleId YAML reader). State surface is HTTP socket + module-scope drift bit only.
- **API surface parity:**
  - Relay request shape: **additive** — accepts a new optional `resolver` field in the request body for per-snapshot override. Existing SDKs that don't set the field see no behavior change.
  - Relay response shape: unchanged.
  - Healthcheck shape: **breaking-but-trivial** — `maestroHierarchyDrift` was a single nullable field; becomes `{android: ... | null, ios: ... | null}`. Existing consumers checking `=== null` need to update to check both slots. Coordinate with internal Percy ops dashboards if any depend on the shape (the field is undocumented as public, so external surface is low risk).
- **Integration coverage:** Cross-platform parity (Unit 5) + WDA-failure regression (Unit 6) + concurrent harness (Unit 7) + BS-host E2E (procedure source-of-truth doc) collectively prove the system-wide story unit tests cannot.

**Affected stakeholders:**
- Percy SDK consumers — no change.
- BS realmobile operations — operator can opt in via `PERCY_IOS_RESOLVER=maestro-hierarchy` env (Unit 3a) and roll back via `=wda-direct` env without redeploy.
- Percy support (debugging) — new `via maestro-http` / `via maestro-cli-fallback` log lines; two-slot healthcheck envelope; per-snapshot resolver override for one-off diagnostics; rollback knob documented in the validation skill.
- Internal Percy ops dashboards (if any) consuming `/percy/healthcheck` `maestroHierarchyDrift` field — schema-update coordination needed before Unit 4 lands.

## Risks & Dependencies

### Risks

- **Maestro CLI version diversity in customer environments — clarified 2026-05-07.** Per the version mapping in memory `project_ios_maestro_cli_paths.md` (cross-checked against the host's `/usr/local/.browserstack/realmobile/config/constants.yml`), BS realmobile supports two Maestro versions: `cli-1.39.15` (Nix-v5, Java 16) and `cli-2.0.7` (Nix-v2.2, Java 17). Production default is `cli-2.0.7`. PR #2210 vendored against `cli-1.39.13`, two patch versions older than `cli-1.39.15` but a full step before `cli-2.0.7`. Maestro upstream PR #2365 (drops `appIds` server-requirement, March 2025) and PR #2402 (drops SpringBoard wrap, March 2025) — landing in `cli-2.0.x` is plausible. Customers running Percy CLI against their own local Maestro install can be on any version. Mitigation: Unit 1 captures against the production-default version on a live BS session (will be `cli-2.0.7` unless the build payload specifies otherwise); the parser handles both wrapped (pre-#2402) and unwrapped (post-#2402) shapes via the "first `elementType == 1` whose `identifier != 'com.apple.springboard'`" rule; schema-class drift bit catches future drift on first occurrence; the env-conditional default flip in Unit 3b is a key mitigation — opt-in customers eat the first wave of any drift; the default flip waits for telemetry-confirmed stability AND is keyed on `PERCY_IOS_DRIVER_HOST_PORT` presence (only realmobile-deployed sessions get the new default).
- **BS realmobile canary auto-deploy reverts host overlays nightly + advances Maestro versions.** *Discovered 2026-05-07.* For Unit 1 (source-research-first path) this is now a non-issue — no host-side overlay is deployed. The risk applies to: (a) the optional confidence-boost wire-capture if/when done in a later session — re-apply any temporary instrumentation since canary may have reverted overnight; (b) Unit 5/6/7 BS validation runs — schedule them in a single working window so the operator-set `PERCY_IOS_RESOLVER` env doesn't get reverted between validation steps. Memory `project_realmobile_canary_overlay_revert.md` documented this for percy CLI overlays; same shape applies to operator env-var sets.
- **Maestro `/viewHierarchy` endpoint is HTTP-public but treated as Maestro-internal API.** No `internal` Kotlin modifier, no `@RestrictTo`, but also no published Maestro-consumer documentation — semantic stability is lower than syntactic stability. Maintainers reshape request/response without CHANGELOG mentions (PR #2365 silently changed `appIds` from required to ignored). Mitigation: pin Maestro version on BS hosts (already true at `cli-1.39.13`); add a CI smoke test that fetches a fixture against a known-good driver and diffs the JSON shape; tolerate forward-compatible additions in the response (extra fields), fail loudly on missing required fields.
- **`PERCY_IOS_DRIVER_HOST_PORT` not injected on legacy mobile fleet OR on self-hosted customer environments.** *Resolved-by-design via Unit 3b's environment-conditional default flip:* in environments where this env is unset (legacy mobile fleet, self-hosted customers), the resolver defaults to `wda-direct` post-3b, preserving today's WDA happy path. Customers who explicitly opt in via `PERCY_IOS_RESOLVER=maestro-hierarchy` without the env get a port-validation failure that falls through to maestro-CLI shell-out (graceful but slow) — they self-diagnosed by opting in without setup. Originally surfaced as P0 by document review; the env-conditional cascade closes the silent-regression gap. Symptom in legitimate cases is observable in `via maestro-cli-fallback (connection-fail)` log dominance on mobile-fleet hosts where customers explicitly opted in.
- **HTTP keep-alive misbehavior on long-lived BS sessions.** Mitigation: bounded `http.Agent` cache + eager close on connection-class failure (mirrors #2210's gRPC channel cache). Surface via Unit 7 concurrent-harness output before Unit 3b's flip.
- **Maestro runner only listens on `127.0.0.1`** (FlyingFox `HTTPServer(address: .loopback(port: ...))`). Percy CLI must run co-located on the same host as the Maestro driver. BS realmobile already satisfies this; if Percy CLI deploy topology changes (e.g., centralized CLI service), this constraint becomes a blocker. Mitigation: document the constraint in the validation skill addendum; add a startup check that emits a clear error if `PERCY_IOS_DRIVER_HOST_PORT` is set but `127.0.0.1` is unreachable.
- **BS iOS Maestro infra outages (per memory 2026-04-29: 4 builds failed in one day) block Units 6/7 validation.** Mitigation: Unit 1 captures locally first to de-risk the fixture; Units 6/7 can run on a developer Mac with local Maestro + iOS Simulator if BS realmobile is down; only Unit 3b's gating telemetry strictly requires BS to be healthy, and Unit 3b is a follow-up PR — the main work doesn't block on it.
- **Cross-PR setter signature change ~~(Plan Viability Gate 4)~~ — collapsed.** Single ownership across PR #2202, #2210, and this plan. The `recordSchemaDrift` → `setMaestroHierarchyDrift` rename is a self-sequencing decision: land in #2210 directly (cleaner) or refactor post-merge in this plan (acceptable for a single author). No external coordination friction.
- ~~AUT bundleId discovery edge cases~~ — *no longer applicable.* Per Unit 1's PR #2365 finding, no client-side bundleId discovery is performed; the server detects AUT itself when Percy sends `appIds: []`. The original deepening pass's YAML-related edge cases (`appId: ${SOME_VAR}`, missing `appId`, multiple flow files with different `appId`) are obviated. The remaining iOS-side risk surface is the SpringBoard-only response on older Maestro versions, mitigated by maestro-CLI shell-out fallback (which knows the AUT internally via Maestro's flow context).
- **iOS selector vocabulary mismatch with SDK customers expecting `class` selectors.** Unit 1 surfaced that iOS Maestro's `TreeNode` does not carry `class` (only `resource-id`), so iOS Percy snapshots support `id` selectors only. Customers who write `region.element = {class: "XCUIElementTypeButton"}` against iOS get no match. Mitigation: SDK-side validation (V1.0 SDK already validates region shape — extend to reject `class` on iOS with a clear error message OR document iOS-Android selector vocabulary divergence in the README). Decision deferred to V1 release notes — for now Unit 2 silently skips iOS `class` selectors with a `[percy] Warning: class selectors not supported on iOS` log line per `firstMatch` invocation.

### Branch sequencing — collapsed to single-PR (2026-05-07)

**Final consolidation:** Sriram567 closed PRs #2202 (iOS regions Phase 1) and #2210 (Android gRPC) and merged the entire iOS-regions+drift bundle as a single PR from this branch. The previously-tracked merge-order matrix is moot.

The single PR contains 13 commits:
1. **9 commits from the originally-planned PR #2202** (Plan A WDA-direct + Plan B Phase 1 scaffold): `d097f077` (PNG dims) → `1792e376` (wda-session-resolver) → `d0cae9c3` (wda-hierarchy) → `d2eb348f` (api.js iOS branch) → `e7b9938b` (Node 14 fixes) → `a6942df6` (maestro hierarchy primary) → `9e2f3815` (rename adb→maestro hierarchy) → `403d89fc` (iOS scaffold) → `1b98ece6` (api.js dispatch) → `616cdd56` (parity test).
2. **4 commits from this plan's units 1–4**: `65e54b9f` (Unit 1 fixtures) → `dbc7b277` (Unit 2 HTTP transport) → `7e048935` (Unit 3a resolver cascade) → `35957fc7` (Unit 4 two-slot drift envelope).
3. **1 commit for units 5/6/7** integration harnesses: `8c34f2d2`.

**Implications of consolidation:**
- The Android gRPC fast path (originally PR #2210) is **not in this PR**. Android keeps the existing `maestro --udid <serial> hierarchy` CLI shell-out (~9s p50). Re-landing the gRPC path is a separate future PR if/when needed.
- The android slot of `maestroHierarchyDrift` stays unwritten in production. Surface is forward-compat — any future Android-resolver work plugs into the existing setter without API change.
- Plan Viability Gate 4 (cross-PR coordination on `recordSchemaDrift` rename) is fully obviated: the rename landed natively in Unit 4 with the two-slot shape designed from the start.
- The `2026-05-06-004-pr2210-coordination-comment.md` artifact is obsolete; its diff was for refactoring #2210, not this PR.

### Dependencies

- **PR #2210** (`feat/grpc-element-region-resolver`) — non-blocking for code, but Plan Viability Gate 4 requires coordination with its author on the setter signature change before Unit 4.
- **iOS-WIP branch `feat/ios-element-regions-maestro-hierarchy`'s "Unit 2b"** (XCUI integer-to-name attribute mapping) — Plan Viability Gate 3, blocking for Unit 2.
- **PR #2202** (iOS regions Phase 1 — WDA-direct) — both #2210 and the iOS-WIP branch sit on top of #2202. Hard prerequisite for any iOS work merging.
- **Realmobile `PERCY_IOS_DRIVER_HOST_PORT` env injection** — already in production at `realmobile/lib/maestro_session.rb:831`; not blocking.
- **Realmobile test-suite extraction to `/tmp/<sid>_test_suite/`** — already in production per the validation skill; not blocking. Plan Viability Gate 1 verifies this on the actual host.
- **BS iOS realmobile infra availability** for Unit 7 (V4.2 concurrent harness) and Unit 3b's telemetry window — soft-blocking. Local Maestro + iOS Simulator validation is acceptable for the main PR (Units 1–7); Unit 3b's flip is the only step that strictly requires BS realmobile health, and it is a follow-up PR.
- ~~**Cross-PR coordination with #2210's author** for Plan Viability Gate 4~~ — collapsed (single author across all involved PRs).

## Phased Delivery

### Phase 1: Foundation (Unit 1) — source research only, no infra
Read upstream Maestro at `cli-2.0.7`; synthesize fixture from source types; resolve Plan Viability Gates 1 + 2. **~1–2 hours, no BS session, no Mac toolchain install.** Wire-bytes-vs-source-types validation is moved to Unit 5/6/7 BS validation; Unit 1 is a pure source-research + fixture-synthesis step. Dramatically lighter than the original "trigger BS build → host overlay → console.log capture" framing, which inherited PR #2210's gRPC binary-bytes precedent inappropriately for HTTP+JSON.

### Phase 2: Resolver + Dispatch (Units 2, 3a, 4)
Land the HTTP transport, wire the opt-in dispatch (default UNCHANGED — `wda-direct`), refactor the healthcheck to two-slot shape. This is the bulk of the engineering work and the merge target for the main PR. **Default behavior unchanged for any customer who doesn't explicitly opt in via `PERCY_IOS_RESOLVER=maestro-hierarchy`.**

### Phase 3: Validation (Units 5, 6, 7)
Cross-platform parity, WDA regression, concurrent harness. Each pastes its output into the PR description as a merge gate. Unit 5's scaffold extension can start in parallel with Unit 2 (it depends on the dispatch shape, not the HTTP path).

### Phase 4: Environment-conditional default flip (Unit 3b — follow-up PR)
After ≥2 weeks of `via maestro-http` log dominance on opt-in BS realmobile production, zero non-null `maestroHierarchyDrift.ios`, and Unit 6/7 green output, change the dispatch default cascade so that `maestro-hierarchy` becomes default **iff `PERCY_IOS_DRIVER_HOST_PORT` is present in env**, otherwise `wda-direct` remains default. Narrow follow-up PR with production-evidence pasted in the description. Closes the P0 self-hosted-regression risk: BS realmobile customers (env-injected) get the failure-class fix; self-hosted customers (no env) keep today's sub-second WDA happy path.

### Phase 5: WDA-direct retirement (Unit 8 — follow-up PR)
After ≥1 week of production stability following Unit 3b, delete `wda-hierarchy.js`. Same conservatism shape as PR #2210's `runAdbFallback` Unit-5 split.

## Documentation / Operational Notes

- Update `docs/solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md` with three addenda:
  1. **Opt-in instructions** (post Unit 3a): operators set `PERCY_IOS_RESOLVER=maestro-hierarchy` on a per-host basis to enable the new transport during the validation window. Document the expected log lines (`via maestro-http`, `via maestro-cli-fallback`, schema-drift if it fires).
  2. **Rollback section** (always): `PERCY_IOS_RESOLVER=wda-direct` returns to the legacy WDA path. Per-snapshot diagnostic via `curl ... -d '{"resolver":"wda-direct",...}'` for one-off comparisons. Operator does not need to redeploy.
  3. **Post-flip behavior** (post Unit 3b): default behavior is now `maestro-hierarchy`; legacy WDA path remains as kill switch.
- Update CLAUDE.md / AGENTS.md in `cli/` if either documents per-platform resolver paths.
- **Self-sequencing notes for the setter rename** (single ownership, no external coordination):
  - Recommended: land the `recordSchemaDrift` → `setMaestroHierarchyDrift({platform})` + two-slot shape change in PR #2210 itself as a separate commit before #2210 merges. Diff is in `2026-05-06-004-pr2210-coordination-comment.md` (rename the artifact mentally — it's now self-notes, not a comment for an external author). Lower rebase friction.
  - Acceptable: refactor in this plan's PR after #2210 merges. Single author editing own merged code is fine.
- **Post-Unit-3a monitoring** (during opt-in validation window):
  - On opt-in BS realmobile hosts: `grep "via maestro-http" percy-cli-debug.log` — expect >99% dominance within 1 hour of opting in.
  - `grep "via maestro-cli-fallback" percy-cli-debug.log` — investigate if >5% (likely Plan Viability Gate signal).
  - `curl http://localhost:<cli_port>/percy/healthcheck | jq '.maestroHierarchyDrift.ios'` — null in steady state.
  - Track per-host opt-in rate so Unit 3b's evidence has volume to back the flip.
- **Unit 3b flip-readiness checklist** (paste into the follow-up PR description):
  - [ ] ≥2 weeks of opt-in `via maestro-http` >99% on BS realmobile production.
  - [ ] Zero non-null `maestroHierarchyDrift.ios` for the same window.
  - [ ] Unit 6 (V3 regression) green on BS realmobile real device.
  - [ ] Unit 7 (V4.2 concurrent harness) green; `IOS_HTTP_HEALTHY_DEADLINE_MS` tuned per harness output.
  - [ ] Plan Viability Gates 1, 2 confirmed against production Maestro versions deployed during the window.
  - [ ] **Self-hosted-customer safety check:** confirmed via grep that the env-conditional default cascade in `api.js` reads `PERCY_IOS_DRIVER_HOST_PORT` and falls back to `wda-direct` when unset. Unit-test suite for Unit 3b includes the four-quadrant matrix `(PERCY_IOS_RESOLVER set/unset) × (PERCY_IOS_DRIVER_HOST_PORT set/unset)` — all four cases pass.
- **Rollback escalation signals** (post-flip):
  - Any non-null `maestroHierarchyDrift.ios` → investigate immediately; re-vendor fixture if Maestro upstream wire format drifted.
  - `via maestro-cli-fallback` rate >5% per host → investigate; consider `PERCY_IOS_RESOLVER=wda-direct` rollback if customer impact is severe.
  - V3 regression (AUT-crash) re-fires in production logs (`raiseNoSessionException` + `via wda-direct` correlation) → indicates a customer hit the kill switch and bumped into the old failure class; resolve with re-flip after fixing root cause.

## Sources & References

### Plan inputs

- **Origin document:** [docs/brainstorms/2026-05-06-cross-platform-maestro-resolver-unification-requirements.md](../brainstorms/2026-05-06-cross-platform-maestro-resolver-unification-requirements.md)
- **Procedural validation foundation:** [docs/solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md](../solutions/best-practices/test-percy-maestro-app-on-browserstack-2026-05-06.md)

### Adjacent / parent branches

- **Reference PR (Android gRPC):** [percy/cli#2210](https://github.com/percy/cli/pull/2210) `feat/grpc-element-region-resolver` — primary structural reference for the HTTP path. Open. Plan Viability Gate 4 requires coordination with this PR's author.
- **Branch this work sits on:** `cli` `feat/ios-element-regions-maestro-hierarchy` — already has dispatch + parity scaffold + maestro-CLI iOS path.
- **Parent PR:** [percy/cli#2202](https://github.com/percy/cli/pull/2202) — iOS regions Phase 1 (WDA-direct).

### Maestro upstream source citations (Unit 1 — `cli-2.0.7`, the realmobile production default)

Pulled by Unit 1 via `gh api repos/mobile-dev-inc/Maestro/contents/<path>?ref=cli-2.0.7`:

- `maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/ViewHierarchyHandler.swift:22, 23–29, 30–37, 73, 84, 86` — server-side AUT detection (PR #2365 landed: `RunningApp.getForegroundApp()` with no params); SpringBoard fallback at lines 23–29; PR #2402 landed with new wrap shape `[appHierarchy, statusBarsContainer]`.
- `maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Models/AXElement.swift:5–8, 22–37, 39–56, 104–121` — `ViewHierarchy = {axElement, depth}` envelope; full `AXElement` Codable struct; synthetic `init(children:)` defaults; `encode(to:)` with `encodeIfPresent` for `value`/`title`/`placeholderValue`/`children`.
- `maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Models/ViewHierarchyRequest.swift:3–6` — Swift Codable confirms wire fields are `appIds: [String]` + `excludeKeyboardElements: Bool`.
- `maestro-ios-driver/src/main/kotlin/hierarchy/AXElement.kt:5–10, 18–21, 23–39` — Kotlin response shape; `frame` `@JsonProperty` PascalCase; `boundsString` formula `[x,y][x+w,y+h]`.
- `maestro-ios-driver/src/main/kotlin/xcuitest/api/ViewHierarchyRequest.kt` — Kotlin client wire field is `appIds: Set<String>`.
- `maestro-client/src/main/java/maestro/drivers/IOSDriver.kt:174-220` — `viewHierarchy(excludeKeyboardElements)` and `mapViewHierarchy(element: AXElement): TreeNode`. Critical: maps to `attributes['resource-id'] = identifier`, `attributes['bounds'] = frame.boundsString`, etc. **Does NOT set `attributes['class']`** — basis for the `id`-only iOS selector vocabulary decision.
- `maestro-client/src/main/java/maestro/TreeNode.kt:23-32` — `data class TreeNode(attributes: MutableMap<String, String>, children: List<TreeNode>, clickable/enabled/focused/checked/selected: Boolean?)`. The Maestro-normalized shape that `flattenMaestroNodes` consumes; iOS CLI fallback path produces this directly.
- `maestro-cli/src/main/java/maestro/cli/command/PrintHierarchyCommand.kt:131, 153-156` — `session.maestro.viewHierarchy().root` invocation; serialization via `jacksonObjectMapper().setSerializationInclusion(JsonInclude.Include.NON_NULL).writerWithDefaultPrettyPrinter()`.
- Forward-compat references: Maestro PR #2365 (drops `appIds` server-side requirement; landed in cli-2.0.7), Maestro PR #2402 (changes wrap shape; landed in cli-2.0.7).
- Vendored fixtures: `cli/packages/core/test/fixtures/maestro-ios-hierarchy/{viewHierarchy-response,viewHierarchy-response-springboard-only,viewHierarchy-request,maestro-cli-ios-stdout}.json` + `capture-notes.md` on commit `65e54b9f` of `feat/maestro-ios-http-resolver`.

### Earlier deepening-pass citations (`cli-1.39.13` — historical reference)

Used to derive the original wire-format hypothesis; the cli-2.0.7 citations above supersede where they differ. Retained for audit trail of how the parser rules evolved.

- `maestro-ios-driver/src/main/kotlin/xcuitest/XCTestDriverClient.kt:49–55, 207–219` — `viewHierarchy` Kotlin client, POST mechanics.
- `maestro-ios-driver/src/main/kotlin/xcuitest/XCTestClient.kt:10–16` — URL builder (`/viewHierarchy` path; route name unchanged in cli-2.0.7).
- `maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Handlers/ViewHierarchyHandler.swift:17–46` (cli-1.39.13) — original empty-`appIds` → SpringBoard fallback at lines 25–30 (changed in PR #2365).
- `maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/XCTestHTTPServer.swift:17,21–23,29,33` — FlyingFox loopback bind (unchanged in cli-2.0.7).

### Memory anchors

- `project_ios_maestro_driver_host_port.md` — `wda_port + 2700` formula.
- `project_e2e_validation_state_2026_05_06.md` — Android #7 + iOS #9 validated builds.
- `feedback_percy_cli_bs_hosts_node14.md` — BS hosts run Node 14.17.3.
- `feedback_dont_change_other_repos.md` — bias against cross-repo changes; informs the bundleId-from-YAML decision.
