---
title: "feat: Percy Maestro SDK iOS Support"
type: feat
status: active
date: 2026-04-20
deepened: 2026-04-20
origin: docs/brainstorms/2026-04-10-ios-support-requirements.md
---

# feat: Percy Maestro SDK iOS Support

## Overview

Enable Percy visual testing for Maestro flows on real iOS devices on BrowserStack. Reach feature parity with Android v0.2.0 (coordinate-based regions, sync mode, tile metadata, `thTestCaseExecutionId`) with minimal new code. Three repo changes: SDK removes the Android-only gate and passes a `platform` field; Percy CLI relay picks the right screenshot glob per platform; realmobile wires `AppPercy::CLIManager` into `MaestroSession` and injects `PERCY_SESSION_ID`.

## Problem Frame

The Percy Maestro SDK currently enforces Android-only via `maestro.platform !== "android"` in `percy-healthcheck.js:7`. BrowserStack App Automate supports Maestro on real iOS devices via `/maestro/v2/ios/build`, but iOS flows cannot capture Percy snapshots. iOS hosts (realmobile) have no Percy–Maestro integration — the existing `AppPercy::CLIManager` is wired into `XCTestSession` only. iOS Maestro screenshots land at a different host path than Android, so the relay also needs platform awareness.

(see origin: `docs/brainstorms/2026-04-10-ios-support-requirements.md`)

## Requirements Trace

From `docs/brainstorms/2026-04-10-ios-support-requirements.md`:

**SDK (percy-maestro):**
- R1. Remove Android-only gate in healthcheck; allow `ios` and `android`
- R2. Dynamic `tag.osName` from `maestro.platform` (`"iOS"` or `"Android"`)
- R3. All v0.2.0 env vars work on iOS (regions, sync, tile metadata, test case, labels, device metadata)
- R4. SDK includes `platform` field in relay payload
- R5. Bump `clientInfo` to `percy-maestro/0.3.0`

**CLI Relay (`/percy/maestro-screenshot`):**
- R6. Accept `platform` field; default to `"android"` when absent
- R7. Platform-aware screenshot glob: iOS `/tmp/{sessionId}/*_maestro_debug_*/{name}.png`, Android `/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`
- R8. Handle iOS filename variations (emoji-prefixed debug frames must not be picked accidentally)
- R9. Backward compatible with SDK v0.2.0 (no `platform` field → Android glob)

**Mobile Platform (realmobile):**
- R10. Instantiate and start `AppPercy::CLIManager` in `MaestroSession` when `@params['app_percy']` is set
- R11. Inject `PERCY_SESSION_ID` into the `maestro test` env vars
- R12. Stop Percy CLI cleanly in `stop` and `ensure_session_stop`
- R13. No batch upload fallback (real-time relay only)

**Documentation:**
- R14. README: remove Android-only language; document iOS env var guidance
- R15. README: iOS device metadata examples
- R16. Update CLAUDE.md and the Confluence architecture page for dual-platform support and the new `platform` field

## Scope Boundaries

- **NOT implementing:** element-based region selectors (resource-id, accessibility-id). Deferred for BOTH platforms.
- **NOT implementing:** iOS simulator support — BrowserStack uses real devices only.
- **NOT implementing:** iOS safe-area auto-detection or scale-factor auto-computation. Users pass pixel values directly.
- **NOT implementing:** `scrollableXpath`, `fullPage`, `freezeAnimations`, `percyCSS` — out of Maestro model on both platforms.
- **NOT implementing:** batch upload fallback on iOS — real-time relay is the only path.
- **NOT implementing:** any in-SDK iOS-specific code paths beyond platform detection and `osName` derivation. GraalJS sandbox is platform-independent.

## Context & Research

### Relevant Code and Patterns

**SDK (percy-maestro):**
- `percy/scripts/percy-healthcheck.js:7` — Android-only gate
- `percy/scripts/percy-screenshot.js:32` — hardcoded `tag.osName = "Android"`
- `percy/scripts/percy-screenshot.js:123` — `clientInfo = "percy-maestro/0.2.0"`
- Env var pattern: `typeof VAR !== "undefined" && VAR` (consistent throughout)
- `output.percyEnabled`, `output.percyServer`, `output.percyCoreVersion` already set by healthcheck

**Percy CLI (`/percy/maestro-screenshot`):**
- `cli/packages/core/src/api.js:300-315` — route handler entry + path sanitization
- `cli/packages/core/src/api.js:315` — current glob pattern (Android-specific)
- `cli/packages/core/src/api.js:345-347` — tag default (`osName: 'Android'`)
- `cli/packages/core/src/api.js:349-367` — payload construction with tile metadata
- `cli/packages/core/src/api.js:368-404` — regions transformation
- `cli/packages/core/src/api.js:407-413` — sync mode branching
- All existing backward-compat already in place (unknown fields safely ignored)

**realmobile (iOS host code):**
- `lib/session/maestro_session.rb:49` — `setup_config` method; equivalent XCTestSession line instantiates `AppPercy::Session`
- `lib/session/maestro_session.rb:51-64` — `start` method; add Percy CLI start after `super`
- `lib/session/maestro_session.rb:152-183` — `stop` method; insert Percy stop after `uninstall_maestro_app` (line 158), before `super`
- `lib/session/maestro_session.rb:200-245` — `ensure_session_stop` for emergency teardown
- `lib/session/maestro_session.rb:776-788` — `build_maestro_command()` (shell-level env vars like `SCREENSHOTS_DIR` injected inline)
- `lib/session/maestro_session.rb:389-403` — `fetch_maestro_env_variables()` parses `@params["environment_variables"]` JSON string into `-e K=V` flags
- `lib/session/maestro_session.rb:825` — `@debug_output = "/tmp/#{@session_id}/#{@device}_maestro_debug_#{classname}_#{testname}_#{test_num}"`
- `lib/session/xctest_session.rb` — reference implementation for AppPercy lifecycle:
  - `setup_config` line 76: `@app_percy_session = AppPercy::Session.new(@device) if @params['app_percy']`
  - `start` line 82: `start_app_percy` after `super`
  - `stop` line 109: `stop_app_percy` before other cleanup
  - `ensure_session_stop` line 161: `AppPercy::Session.new(@device).stop(@params['automate_session_id'])`
  - Helpers lines 236-242: `start_app_percy`, `stop_app_percy` wrappers
  - `upload_percy_logs` lines 826-834: S3 log upload
- `lib/app_percy/cli_manager.rb:64-66` — iOS CLI port mapping: `"5#{device_port}"` (Android uses `"4#{device_port}"`; transparent via Privoxy)
- `lib/app_percy/app_percy_session.rb` — orchestrates `start_percy_cli`, `stop_percy_cli` with logging and org-limit detection

**Android reference (for parity of behavior):**
- `mobile/android/maestro/scripts/maestro_runner.rb` lines ~780-786 — injects `PERCY_SESSION_ID` into `@maestro_params[:environment_variables]` hash; `fetch_maestro_env_variables` formats as `-e KEY=VALUE`
- Android does NOT gate on `@params['app_percy']` — injects `PERCY_SESSION_ID` unconditionally when `@session_id` exists (JS healthcheck handles Percy being disabled)

### Institutional Learnings

- `docs/plans/2026-04-03-001-feat-sdk-feature-parity-plan.md` — the Android v0.2.0 plan. Deploy ordering (CLI → SDK → docs), backward-compat approach, and sync response shape (`{success, link}` non-sync vs `{success, data}` sync) all transfer directly.
- `docs/brainstorms/2026-04-10-ios-support-requirements.md` — scope, feature-by-feature iOS viability assessment, and deploy differences.
- `docs/solutions/` does not exist; no prior iOS learnings.

### External References

None consulted — codebase patterns and origin doc are sufficient.

## Key Technical Decisions

- **SDK sends `platform: maestro.platform` in the payload.** Cleanest wire: the SDK already knows the platform at runtime; sending it explicitly avoids guessing on the CLI. (see origin)

- **CLI relay picks glob by request `platform` with a strict whitelist.** Primary (and only) signal is `req.body.platform`, normalized via `String(req.body.platform).toLowerCase()` and whitelisted to `"ios"`/`"android"`. A present-but-non-whitelisted value returns **400 Bad Request** (not a silent demote). Missing `platform` defaults to Android for SDK v0.2.0 backward compatibility (R9). Two tiers only; keeps the contract narrow and input validation unambiguous.

- **iOS glob pattern: `/tmp/{sessionId}/*_maestro_debug_*/{name}.png`.** Confirmed from `realmobile/lib/session/maestro_session.rb:825` (`@debug_output` construction). One session can have multiple `_maestro_debug_` dirs (one per flow). The `{name}.png` exact match filters out Maestro's emoji-prefixed debug frames. If multiple files match (rare — same name across flows), pick the most recently modified for determinism.

- **Path-safety hardening required for the iOS glob.** The iOS pattern's wildcard sits directly under the sessionId-owned `/tmp/{sessionId}/` directory (a level higher than Android's `_test_suite`-suffixed anchor). Mitigation layers: (a) tighten sessionId sanitization from the current blocklist (`..`, `/`, `\\`) to a strict character-class check (`^[a-zA-Z0-9_-]+$`) that also rejects shell metacharacters, NUL, and newlines; apply the same to `name`; (b) after glob resolution, call `fs.realpath` on the matched path and reject any result that does not canonicalize under `/tmp/{sessionId}/` — defeats symlink swap. (These hardenings are platform-independent; apply to the Android glob in the same pass.)

- **Inject `PERCY_SESSION_ID` as a Maestro `-e` flag, NOT inline in the shell prefix.** The SDK reads `PERCY_SESSION_ID` as a GraalJS global at `percy-screenshot.js:17` (`typeof PERCY_SESSION_ID`). GraalJS globals come from Maestro's `-e KEY=VALUE` flags, not from the calling shell's process environment. Inlining next to `SCREENSHOTS_DIR` (which is a Maestro-CLI *process* env — category 1) would make the var invisible to the flow's JS context → SDK would see `undefined` → "PERCY_SESSION_ID not set" log → silent no-op on every screenshot. Mirror Android exactly (`mobile/android/maestro/scripts/maestro_runner.rb:780-786`): build a small helper returning `-e PERCY_SESSION_ID=#{Shellwords.escape(@session_id)}` and concatenate alongside `fetch_maestro_env_variables`'s output in `build_maestro_command`. A separate helper (not mutating `@params["environment_variables"]`) is cleaner on iOS because that param is stored as a JSON string, not a hash. `@session_id` is server-generated by realmobile; add a defensive regex guard (`\A[a-f0-9-]+\z` or the actual session-id format) before injection as belt-and-suspenders against an upstream change that ever lets user input into `@session_id`.

- **Follow Android's posture: inject `PERCY_SESSION_ID` unconditionally when `@session_id` exists, regardless of `@params['app_percy']`.** The JS healthcheck disables Percy when it cannot reach `percy.cli:5338`, so an injected-but-unused `PERCY_SESSION_ID` is harmless. This is consistent with Android and with the SDK's existing graceful-degrade path. Add a dedicated test scenario in Unit 3 that exercises this (`app_percy=false` + `PERCY_SESSION_ID` in the command + healthcheck disables Percy) so the "harmless when unused" argument is verified, not asserted.

- **`tag.osName = maestro.platform === "ios" ? "iOS" : "Android"`.** Simple conditional in the SDK. Keep the CLI relay's default `osName: "Android"` unchanged — it's the fallback when no tag is sent (old SDK), and old SDK is Android-only anyway.

- **Privoxy routing of `percy.cli:5338` on iOS is VERIFIED transparent.** `realmobile/templates/generic_privoxy_conf.erb:34` writes `forward percy.cli:5338 :<%= percy_cli_port(current_device_config) %>` unconditionally; `lib/privoxy_manager.rb:239-241` resolves the port via `AppPercy::CLIManager.cli_port` (line 64-66: `"5#{device_port}"` on iOS, `"4#{device_port}"` on Android). The SDK sends to `percy.cli:5338` unchanged on both platforms — no platform awareness needed in the SDK for networking.

- **Reuse `AppPercy::CLIManager` on iOS Maestro as-is.** No refactor to the shared class; call sites from `MaestroSession` mirror `XCTestSession`'s existing usage. Telemetry will tag Maestro events with `framework="XCUI"` (same as XCTest today) — accepted limitation for v1. If observability disambiguation becomes a priority, a follow-up can parameterize `FRAMEWORK` in `AppPercy::Session`. Not in scope here.

- **`stop_app_percy` placement: `ensure` block of `MaestroSession#stop`, not the "first action after log_start" position used by XCTestSession.** This is a deliberate deviation from the mirror. Reason: `MaestroSession#stop` has a trailing `rescue => e` (line 177) that swallows errors and falls through to `ensure`; if `stop_app_percy` is in the main body and a prior step (mitm stop, summary upload) raises, the rescue swallows and Percy teardown is skipped. `XCTestSession#stop` does not have this swallow-rescue pattern, so first-action placement is safe there. For Maestro, `ensure`-block placement is the only safe choice. Same reasoning applies to `force_stop`: place `stop_app_percy` AFTER the timeout-marking and `kill_idle_process` steps (those must run regardless) with an inner `begin/rescue(log and continue)` around it.

- **`ensure_session_stop` placement: BEFORE the early-return check.** `maestro_session.rb:200-211` short-circuits when the spawn_xctest pid file is gone. Placing Percy stop AFTER this early-return (the natural "mirror XCTestSession:161" spot) would leak the CLI in cases where Maestro never launched but Percy CLI did. Place the `AppPercy::Session.new(@device).stop(...)` call BEFORE the early-return so the port is always freed.

- **No SDK-side branching for tile metadata defaults.** `PERCY_NAV_BAR_HEIGHT` on iOS: user omits it → SDK does not add the field → CLI relay defaults to `0` → correct behavior. No iOS-specific SDK logic needed.

- **Rely on operational discipline for partial-rollout protection, not in-SDK version gating.** Phase 2 (SDK v0.3.0) broad release is gated on Phase 1 reaching 100% of iOS hosts (see Phased Delivery). If a partial-rollout incident actually surfaces in production, a v0.3.1 follow-up can add CLI version gating to the healthcheck — not added speculatively in v1.

## Open Questions

### Resolved During Planning

- **iOS screenshot filename format.** Confirmed: `takeScreenshot: "MyName"` writes `{name}.png` to `@debug_output` verbatim. Emoji-prefixed debug frames co-exist but do not collide with the user-named file.
- **Multiple PNGs per flow on iOS.** Confirmed: Maestro emits debug frames (e.g., `screenshot-❌-<timestamp>-(flow).png`) alongside the user-named capture. The exact-name glob (`{name}.png`) filters them out cleanly.
- **`MaestroSession` teardown hook.** `stop` (line 152-183) has a clear insertion point after `uninstall_maestro_app` (line 158) before `super`. `ensure_session_stop` (line 200-245) handles forced termination.
- **Env var injection mechanism.** `PERCY_SESSION_ID` must be injected as a Maestro `-e KEY=VALUE` flag (via a helper concatenated alongside `fetch_maestro_env_variables`'s output), NOT inline in `build_maestro_command`'s shell prefix. The SDK reads `PERCY_SESSION_ID` as a GraalJS global, which only sees `-e`-injected values — not shell-prefix process env. Inlining like `SCREENSHOTS_DIR` would make the var invisible to the flow's JS context.
- **Percy CLI path on iOS host.** ~~Confirmed: `/usr/local/.browserstack/realmobile/deps/lib/node_modules/@percy/core/dist/api.js` (writable; no `/nix/store` immutability issue).~~ **Corrected 2026-04-21 after first-contact verification on host `185.255.127.11`:** that path does **not** exist on iOS. Real path is `/nix/store/<hash>-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/api.js` — version **1.30.0** pinned via `realmobile/packages/percy/percy-setup.nix`, mode `-r--r--r--`, Nix-store immutable. Single-file overwrite of `api.js` is not viable because our 1.31.11-beta.0 `api.js` imports `Busboy`, `ServerError from './server.js'`, and `computeResponsiveWidths` — none present in 1.30.0's sibling dist files. Any in-place overlay would need to replace multiple files and add `busboy` to `@percy/core/node_modules/`. Production deploy path is therefore: publish a new `@percy/cli` version and bump the pin in `percy-setup.nix` (new version + sha256). No quick-patch analog to Android's writable path exists on iOS hosts.
- **iOS build-API payload shape (follow-up, 2026-04-21).** This plan's examples assumed `percyOptions: {enabled, percyToken}` (the Android Maestro shape) would also work on iOS. It does not — BrowserStack's iOS Maestro bridge silently drops `percyOptions` and never populates realmobile's `@params['app_percy']`. Correction captured in follow-up plan [`2026-04-21-001-feat-ios-xcui-realignment-plan.md`](./2026-04-21-001-feat-ios-xcui-realignment-plan.md): iOS customers use `appPercy: {PERCY_TOKEN, env: {...}}` (matches `percy-xcui-swift` convention). Android's `percyOptions` is unchanged.

### Deferred to Implementation

- **Node version on iOS host.** Unknown until first deploy. Verified proactively in Phase 1 First-Contact Verification — check `node --version` before `scp`; apply `||=` → `||` transforms if Node < 16.
- **SSH user and port for iOS hosts.** Android uses `ritesharora@<ip>` on port 4022; iOS may differ. Resolve at first deploy attempt.
- **Exact sync response parsing in GraalJS.** Already resolved for Android (`body.data` vs `body.link`); reuse as-is. Flag if the iOS path exposes any different parse behavior — unlikely.
- **Whether `AppPercy::Session.new(@device)` in `ensure_session_stop` may raise if the device config is stale.** Mirror XCTestSession's `ensure_session_stop` exactly — it handles this today. Test during iOS validation.
- **Exact `@session_id` format regex for the injection guard.** Verify the actual format emitted by realmobile (likely hex + dashes) and tune the regex in `percy_env_flags` accordingly. Placeholder in the plan is `/\A[a-f0-9-]+\z/`.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
iOS Maestro flow lifecycle (realmobile):

  start_maestro_session
    ├─> setup_config
    │     └─> @app_percy_session = AppPercy::Session.new(@device) if @params['app_percy']   [NEW]
    ├─> start
    │     ├─> super
    │     ├─> setup_params  (mitm/privoxy boot — must precede Percy CLI)
    │     ├─> start_app_percy   [NEW — AFTER setup_params, BEFORE run_maestro_session]
    │     └─> run_maestro_session
    │           └─> build_maestro_command(...)
    │                 ├─> SCREENSHOTS_DIR=... (existing shell-prefix env)
    │                 ├─> fetch_maestro_env_variables  (existing; unchanged)
    │                 └─> percy_env_flags  [NEW — returns "-e PERCY_SESSION_ID=..."; NOT shell prefix]
    ├─> stop
    │     └─> (ensure block)
    │           └─> stop_app_percy   [NEW — in ensure block, NOT first-action (stop's rescue swallows)]
    ├─> force_stop
    │     ├─> timeout-file + kill_idle_process  (must run first)
    │     └─> stop_app_percy  [NEW — wrapped in begin/rescue to not skip critical cleanup]
    └─> ensure_session_stop
          ├─> AppPercy::Session.new(@device).stop(...)  [NEW — BEFORE early-return check]
          └─> (existing cleanup steps)


SDK → CLI relay data flow:

  percy-screenshot.js
    ├─ payload.tag.osName = maestro.platform === "ios" ? "iOS" : "Android"
    ├─ payload.platform   = maestro.platform              [NEW field]
    └─ payload.clientInfo = "percy-maestro/0.3.0"

  POST /percy/maestro-screenshot
    ├─ sanitize name, sessionId (existing)
    ├─ platform = req.body.platform || "android"           [NEW]
    ├─ searchPattern = platform === "ios"
    │                    ? `/tmp/${sessionId}/*_maestro_debug_*/${name}.png`
    │                    : `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png`
    ├─ glob → read file → base64 → comparison pipeline
    └─ rest of handler unchanged (tile metadata, regions, sync)
```

## Implementation Units

- [ ] **Unit 1: CLI relay platform-aware screenshot discovery**

  **Goal:** Extend `/percy/maestro-screenshot` to accept a `platform` field in the request body and pick the correct screenshot glob. Preserve full backward compatibility with SDK v0.2.0 clients (no `platform` → Android glob).

  **Requirements:** R6, R7, R8, R9

  **Dependencies:** None. Foundational change; ships first.

  **Files:**
  - Modify: `cli/packages/core/src/api.js` (route `/percy/maestro-screenshot`, near line 300-340)
  - Test: existing CLI test files for `/percy/maestro-screenshot` (add iOS glob coverage alongside existing Android tests)

  **Approach:**
  - Resolve platform signal with a strict two-tier contract:
    1. If `req.body.platform` is a string: normalize with `String(req.body.platform).toLowerCase()`, then strictly whitelist to `"ios"` or `"android"`. Non-whitelisted or non-string values → respond **400 Bad Request** (no silent demote).
    2. If `req.body.platform` is missing entirely (SDK v0.2.0 backward compat): default to Android glob.
  - For iOS: build glob `/tmp/${sessionId}/*_maestro_debug_*/${name}.png` (wildcard across per-flow debug dirs; exact `{name}.png` match filters out Maestro's emoji-prefixed debug frames).
  - For Android: keep existing `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png`.
  - **Path-safety hardening** (apply to both platforms in the same pass):
    - Tighten `name` and `sessionId` validation from the current blocklist (`..`, `/`, `\\`) to a strict character-class allowlist: `/^[a-zA-Z0-9_-]+$/`. The current blocklist accepts shell metacharacters (`*`, `?`, `[`, `]`, `{`, `}`), NUL, and newlines — all of which cause trouble with glob pattern interpretation even when not interpolated as path separators.
    - After glob resolution, call `fs.realpath` on the matched path and reject (404) any result whose canonical path does not start with `/tmp/{sessionId}/` — defeats symlink swap where a sessionId-named dir/symlink redirects the glob to an unintended file.
  - Use the same `fast-glob` → manual fallback pattern already in the handler (one iOS-aware fallback mirroring today's).
  - If multiple files match (possible on iOS if a name is reused across flows), pick the most recently modified for determinism. Document this in a relay code comment.
  - Do not change tile metadata, regions, sync, or response shape — those are platform-agnostic.

  **Patterns to follow:**
  - Existing `searchPattern` construction and fallback in the same file
  - Existing `backward-compat-by-default` ethos (tag default Android; new fields silently handled)

  **Test scenarios:**
  - POST with `platform: "ios"` → uses iOS glob; finds file in simulated `/tmp/{sid}/{device}_maestro_debug_Foo_Bar_1/{name}.png`
  - POST with `platform: "android"` → uses Android glob (unchanged behavior)
  - POST with no `platform` → uses Android glob (backward compat with SDK v0.2.0)
  - POST with unrecognized platform (`"windows"`) → returns **400 Bad Request** (strict whitelist, no demote)
  - POST with non-string `platform` (e.g., object or array) → returns 400
  - POST with `name` containing `*` or newline → returns 400 (strict character-class allowlist)
  - POST where glob resolves to a symlinked path outside `/tmp/{sessionId}/` → returns 404 (realpath check)
  - iOS path with emoji-prefixed frame alongside user-named file → user-named file is selected
  - iOS path with multiple `_maestro_debug_*` dirs for same session → the matching name.png is found (most recent if duplicates)
  - iOS path with no matching file → 404 error with diagnostic message including the glob pattern

  **Verification:**
  - Existing CLI tests pass (no regression for Android)
  - New tests cover iOS glob and mixed scenarios
  - Manual: start CLI locally, POST with `platform: "ios"` and a fixture PNG placed at an iOS-style path — response returns expected link

---

- [ ] **Unit 2: SDK platform detection and payload updates**

  **Goal:** Allow the SDK to run on iOS; set `tag.osName` dynamically from `maestro.platform`; include `platform` in the payload so the CLI relay can route screenshot discovery correctly. Bump version.

  **Requirements:** R1, R2, R3, R4, R5

  **Dependencies:** Unit 1 (functionally; iOS SDK sends `platform: "ios"` which requires the CLI to know what to do with it). Can be developed in parallel, must ship after (or together with) Unit 1.

  **Files:**
  - Modify: `percy/scripts/percy-healthcheck.js`
  - Modify: `percy/scripts/percy-screenshot.js`

  **Approach:**
  - `percy-healthcheck.js`:
    - Replace the `maestro.platform !== "android"` gate with an allowlist (`android`, `ios`). All other platforms (e.g., web) remain disabled with the existing log message.
  - `percy-screenshot.js`:
    - Replace the hardcoded `tag.osName = "Android"` with `tag.osName = maestro.platform === "ios" ? "iOS" : "Android"`.
    - Set `payload.platform = maestro.platform` alongside the existing payload fields (before the POST).
    - Bump `payload.clientInfo` from `"percy-maestro/0.2.0"` to `"percy-maestro/0.3.0"`.
  - Use `var` only (GraalJS sandbox); keep single-arg `console.log`; re-use the existing `typeof VAR !== "undefined" && VAR` pattern throughout.
  - Do not add platform-specific env var handling — all existing v0.2.0 env vars (`PERCY_REGIONS`, `PERCY_SYNC`, `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, `PERCY_FULLSCREEN`, `PERCY_TH_TEST_CASE_EXECUTION_ID`, `PERCY_TEST_CASE`, `PERCY_LABELS`, device metadata) work as-is on iOS.
  - `PERCY_NAV_BAR_HEIGHT` on iOS: user simply omits it; SDK does not add the field; CLI relay defaults to `0`. No iOS-specific default in the SDK.
  - No CLI version gating in v1. Partial-rollout protection is operational (Phase 1 must reach 100% before Phase 2 broad release — see Phased Delivery).

  **Patterns to follow:**
  - Existing env var parsing at top of `percy-screenshot.js`
  - Existing `output.percyEnabled` / `output.percyServer` / `output.percyCoreVersion` use
  - Existing sync response handling (unchanged)

  **Test scenarios:**
  - Healthcheck on `maestro.platform === "android"` → `output.percyEnabled = true` (unchanged)
  - Healthcheck on `maestro.platform === "ios"` → `output.percyEnabled = true` (new)
  - Healthcheck on any other platform value → `output.percyEnabled = false` with log
  - Screenshot script on Android (fake `maestro.platform`) → payload has `osName: "Android"`, `platform: "android"`, `clientInfo: "percy-maestro/0.3.0"`
  - Screenshot script on iOS → payload has `osName: "iOS"`, `platform: "ios"`, `clientInfo: "percy-maestro/0.3.0"`
  - iOS without `PERCY_NAV_BAR_HEIGHT` → payload omits `navBarHeight` (CLI will default to 0)
  - iOS with `PERCY_STATUS_BAR_HEIGHT="47"` → payload includes `statusBarHeight: 47`
  - iOS with `PERCY_REGIONS` JSON → valid regions included; parser is platform-agnostic
  - iOS with `PERCY_SYNC="true"` → `sync: true` in payload; response parsed identically to Android

  **Verification:**
  - Running an iOS Maestro flow locally with Percy CLI passes the healthcheck and uploads a screenshot tagged `osName: "iOS"`
  - Existing Android flows continue to work unchanged (payload now also contains `platform: "android"` but this is a no-op on the relay's default path)

---

- [ ] **Unit 3: realmobile — Percy CLI lifecycle in `MaestroSession` and `PERCY_SESSION_ID` injection**

  **Goal:** Start `AppPercy::CLIManager` when an iOS Maestro session begins with Percy enabled; inject `PERCY_SESSION_ID` into Maestro's `-e` flags so the flow's JS context sees it; stop the Percy CLI cleanly on every teardown path (normal stop, forced stop, emergency cleanup) without jeopardizing other cleanup steps.

  **Requirements:** R10, R11, R12, R13

  **Dependencies:** Unit 1 (the patched CLI must be present on the host for the iOS glob to work). Unit 2 (SDK sends `platform: "ios"`). Scope is confined to `realmobile/lib/session/maestro_session.rb` — no changes to shared `AppPercy::Session` or `AppPercy::CLIManager` classes.

  **Files:**
  - Modify: `realmobile/lib/session/maestro_session.rb` (`setup_config`, `start`, `stop`, `force_stop`, `ensure_session_stop`, `build_maestro_command`, plus small helpers: `start_app_percy`, `stop_app_percy`, `percy_env_flags`)
  - No new classes; no changes to `realmobile/lib/app_percy/*` (those are shared with XCTestSession and out of scope for iOS Maestro support).

  **Approach:**

  - **`setup_config` (~line 49):** add `@app_percy_session = AppPercy::Session.new(@device) if @params['app_percy']`. Mirrors `xctest_session.rb:76` exactly. Percy lifecycle events will be tagged `framework="XCUI"` in telemetry (same as XCTest today) — accepted v1 limitation.

  - **`start` (~line 51-64):** insert `start_app_percy` AFTER `setup_params` (which boots mitm/privoxy — Percy CLI routes through Privoxy so proxies must be up first) and BEFORE `run_maestro_session`. This differs from XCTestSession's literal "after `super`" position because Maestro has a proxy-setup step in between; XCTest does not. Helper body mirrors `xctest_session.rb:236-238`: `@app_percy_session&.start(@params)`. No additional liveness assertion — match XCTestSession's behavior exactly.

  - **`stop` (~line 152-183): place `stop_app_percy` in the `ensure` block, NOT as the first action after `log_start`.** `MaestroSession#stop` has a trailing `rescue => e` (line 177) that swallows errors and falls through to `ensure`; first-action placement (XCTestSession's pattern at line 109) would be skipped when a prior step raises. The outer rescue does not re-raise. Ensure-block placement alongside `cleanup_files` and `inform_rails` is the only safe choice here. Helper: `@app_percy_session&.stop(@params['automate_session_id'])` with safe navigation (handles the nil-when-app_percy-disabled case). Add a short code comment explaining the deviation from XCTestSession.

  - **`force_stop` (~line 256):** add `stop_app_percy` call wrapped in its own `begin/rescue` (log and continue), placed AFTER the critical timeout-marking and `kill_idle_process` steps. Those must run first regardless of Percy state — if `stop_app_percy` were placed at the top and raised, the outer `rescue => e; raise e` would skip timeout-marking, leaving a timed-out session without its timeout marker. XCTestSession gets away with top placement because `AppPercy::Util.logit` uses `suppress: true` and does not raise in practice — defensive wrapping here is belt-and-suspenders for the Maestro path.

  - **`ensure_session_stop` (~line 200-245): place `AppPercy::Session.new(@device).stop(@params['automate_session_id'])` BEFORE the early-return check at line 200-211.** That early-return short-circuits when the `spawn_xctest` pid file is gone. If Percy stop were placed mid-sequence (the natural "mirror XCTestSession:161" position), a session where Maestro never launched but the Percy CLI started would leak the CLI on that teardown path. Placing Percy stop at the top guarantees the port is always freed.

  - **`build_maestro_command` (~line 776-788):** add a new helper method `percy_env_flags` that returns `"-e PERCY_SESSION_ID=#{Shellwords.escape(@session_id)}"` when `@session_id` matches the expected session-id format (e.g., `/\A[a-f0-9-]+\z/` — verify the realmobile session-id format and adapt the regex; reject and return empty string otherwise as belt-and-suspenders). Concatenate its output alongside `fetch_maestro_env_variables` in the shell command assembly. Do NOT inject inline as a shell-prefix env var (e.g., next to `SCREENSHOTS_DIR`) — `PERCY_SESSION_ID` must reach the flow's GraalJS context via Maestro's `-e` flag, not via the calling shell's process env. Keep injection unconditional when `@session_id` exists (matches Android posture; harmless when Percy is not enabled because the SDK's healthcheck handles CLI absence).

  **Patterns to follow:**
  - `realmobile/lib/session/xctest_session.rb` lines 76, 82, 236-242 (Percy lifecycle helpers). Note that stop placement in Maestro deviates — see above.
  - Existing `fetch_maestro_env_variables` at `maestro_session.rb:389-403` for the `-e K=V` shellwords-escape pattern
  - Android `mobile/android/maestro/scripts/maestro_runner.rb:780-786` for unconditional `PERCY_SESSION_ID` injection intent

  **Test scenarios:**
  - iOS Maestro session with `app_percy` enabled → Percy CLI starts on port `5{device_port}` after proxies, before Maestro runs; `ps aux` shows the process.
  - iOS Maestro session without `app_percy` → Percy CLI not started; `PERCY_SESSION_ID` STILL injected into the `maestro test -e` flags (matches Android posture); SDK healthcheck disables Percy on the JS side; Maestro runs normally with no new log noise.
  - `maestro test` command includes `-e PERCY_SESSION_ID=<session_id>` in its argv (visible in realmobile's Maestro command log). This must be a flag, NOT a process-env prefix.
  - Mid-stop failure: inject a raise in mitm-stop (or summary-upload) → Percy CLI still stopped via `ensure`-block placement in `stop`.
  - `force_stop` path: force-terminate a session → timeout-marker file is created, `kill_idle_process` runs, Percy CLI is stopped (in that order); even if `stop_app_percy` raises, critical cleanup is not skipped.
  - `ensure_session_stop` path with no spawn_xctest pid file → Percy stop runs BEFORE the early-return; CLI port is freed.
  - `ensure_session_stop` path with a prior-step failure (e.g., `MaestroTimeoutManager.new` raises) → Percy stop (placed at top) runs before the raise propagates.
  - R13 verification: realmobile config on iOS does not enable batch upload for Maestro; Percy CLI log shows only relay endpoint activity, no batch upload activity.

  **Verification:**
  - On a BrowserStack iOS host with the feature branch checked out and servers restarted: trigger a test build with `app_percy` enabled → Percy CLI process visible (`ps aux | grep 'percy app exec:start'`); `-e PERCY_SESSION_ID=...` visible in the Maestro command log; after session ends, Percy CLI is stopped and the port is free.
  - Trigger a test build without `app_percy` → Maestro runs normally; no Percy CLI started; no orphan processes; no new log noise.
  - Run 2-3 consecutive sessions on the same device → no regressions from port reuse; each session cleanly starts/stops its own Percy CLI.

---

- [ ] **Unit 4: Documentation**

  **Goal:** Reflect iOS support in README, CLAUDE.md, and the Confluence architecture page.

  **Requirements:** R14, R15, R16

  **Dependencies:** Units 1-3 (documented behavior must match implementation). Can start in parallel but lands after code is stable.

  **Files:**
  - Modify: `percy-maestro/README.md` (Prerequisites, Configuration table notes, "Features not supported" table — remove iOS row; add iOS-specific env var examples)
  - Modify: `percy-maestro/CLAUDE.md` (relay contract includes `platform` field; platform list; iOS/Android osName behavior; iOS screenshot path)
  - Update: Confluence page `Percy Maestro SDK — Architecture & Design Decisions` (iOS addition, platform-aware glob, realmobile + AppPercy reuse)

  **Approach:**
  - README: drop line 220 ("iOS support | Android-only for now..."); update line 9 ("An Android or iOS app under test"); add a short iOS guidance block covering `PERCY_NAV_BAR_HEIGHT: "0"` recommendation (or omit), `PERCY_STATUS_BAR_HEIGHT` with notch/Dynamic Island note, orientation/OS version examples for common iPhone + iPad
  - CLAUDE.md: add `platform` field to the `/percy/maestro-screenshot` contract; note that `tag.osName` is derived from `maestro.platform`; note iOS screenshot path pattern
  - Confluence: add an iOS section to the architecture page; update the "Features not supported" table (remove iOS row); note realmobile + AppPercy integration

  **Patterns to follow:**
  - Existing README structure (table-heavy, copy-pasteable YAML examples)
  - Existing Confluence page layout

  **Test scenarios:**
  - README examples for iOS are copy-pasteable and correct (verified by running at least one on BrowserStack during Unit 3 validation)
  - CLAUDE.md relay contract matches actual implementation in `api.js`
  - Confluence page's "repos & branches" table includes iOS branch names

  **Verification:**
  - `grep -i "android.only\|only supports android\|iOS support" percy/README.md` returns no stale claims
  - CLAUDE.md's `platform` field documentation matches Unit 1's actual parsing logic
  - Confluence page reviewed and published

## Phased Delivery

### Phase 1: CLI relay (Unit 1)

Ship CLI changes first. Backward compatible (Android SDKs unchanged).

**2026-04-21 update:** The Android-style single-file scp deploy does **not** apply to iOS hosts (see corrected Resolved During Planning note on "Percy CLI path on iOS host"). Phase 1 on iOS has two distinct deploy paths:

**Android hosts:** unchanged — scp patched `api.js` to the realmobile deps path, `restart_servers`.

**iOS hosts (production):** requires a proper release cycle — publish `@percy/cli` with the iOS relay changes, bump the version + sha256 pin in `realmobile/packages/percy/percy-setup.nix`, merge realmobile, wait for the tag-based deploy to roll to the iOS host fleet. There is no in-place patch alternative that respects Nix-store immutability and leaves the host in a clean state.

**iOS hosts (pre-release validation — completed 2026-04-21):** the relay logic was validated on iOS host `185.255.127.11` via a sandbox approach that does **not** touch the production CLI:
1. Tar the local cli repo (minus `.git`, `coverage`, `packages/*/src`, `packages/*/test`), scp to `/usr/local/.browserstack/deps/percy-cli-dev/`.
2. Start a standalone `@percy/core` relay server in `testing: true` mode (bypasses token/build creation, see `packages/core/src/percy.js`) on a non-default port via a minimal `sandbox-runner.mjs` bootstrap using `new Percy({ testing: true, server: true, port })`.
3. Use Node 20 from the host's Nix store (`/nix/store/92ij887c5wdm37grzzy3z8i0ppqk0x07-nodejs-20.12.2/bin/node`) — the nvm-installed Node 14 on arm64 fails with a wasm OOM on cold start.
4. Run single-session probes (start + curl + teardown in one ssh invocation — the process dies if ssh exits between start and probe).
5. Teardown: `pkill -f sandbox-runner && rm -rf /usr/local/.browserstack/deps/percy-cli-dev`.

This validates every Go/No-Go check that doesn't require live Maestro/AppPercy wiring (see "Phase 1 (CLI relay) Go/No-Go — validation evidence" below). It does not validate end-to-end Maestro session behavior — that requires the full release path above, plus Phase 3, plus an App Automate session.

**First-Contact Verification (any iOS host, pre-sandbox or pre-release):**
- `node --version` — confirm a Node ≥14 binary is available. Nix-store Node 20 is the safest target on arm64.
- Real Percy CLI path: `/nix/store/<hash>-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/api.js` — confirm the version pinned in `realmobile/packages/percy/percy-setup.nix` matches what's on disk.
- `/usr/local/.browserstack/deps/percy-cli-dev/` — confirm writability under the `app` user for sandbox staging.
- macOS `/tmp → /private/tmp` symlink — realpath canonicalization in the relay must handle this; a live probe with a file under `/tmp/<sessionId>/*_maestro_debug_*/` verifies it.

### Phase 2: SDK (Unit 2)

Ship SDK changes. Bump to `percy-maestro/0.3.0`. SDK is distributed by copy-paste (per CLAUDE.md) — customers adopt at their pace.

**Do not release SDK v0.3.0 to customers running iOS flows until Phase 1 reaches 100% of the iOS host fleet.** v1 has no in-SDK version-gate, so the mitigation is operational discipline: maintain a fleet inventory and confirm patch status on every iOS host before broad Phase 2 release. If a partial-rollout incident is observed in production, a v0.3.1 follow-up can add CLI version gating to `percy-healthcheck.js`.

### Phase 3: realmobile integration (Unit 3)

Create feature branch `feat/maestro-percy-ios-integration`. On iOS host, manually `git fetch + git checkout` the branch, then `restart_servers`. Note this overrides the tag-based deploy; a production release requires a proper tag containing the branch commits.

**Pre-deploy step:** record the currently-deployed tag/sha on each iOS host to the deploy ticket. This is the rollback reference.

### Phase 4: Documentation (Unit 4)

Ship alongside or after Phase 3. Must reflect actual verified behavior.

### Cross-Phase Compatibility Matrix

During rollout, four states are possible on any given iOS host. The matrix identifies which states are safe to dwell in vs. which must be transient:

| State | Android flows | iOS flows | Safe to dwell? |
|---|---|---|---|
| Old CLI + Old SDK v0.2.0 (pre-rollout baseline) | Works | SDK gates iOS off → Percy disabled | Yes (baseline) |
| **New CLI + Old SDK v0.2.0** (Phase 1 only) | Works; SDK sends no `platform` → CLI defaults to Android glob (R9) | SDK still gates iOS off → Percy disabled | Yes — designed backward-compat path |
| **Old CLI + New SDK v0.3.0** (Phase 2 before Phase 1 finishes) | Works; new `platform: "android"` field silently ignored by old relay | **Silent 404 per screenshot** — SDK sends `platform: "ios"` to the old relay, which ignores unknown fields and uses Android glob, producing "screenshot not found" errors. No in-SDK gate in v1. | No — avoid by operational gating (Phase 1 must reach 100% before Phase 2 broad release) |
| New CLI + New SDK + Old realmobile (Phase 2 before Phase 3) | Works | **Silent degradation:** Percy CLI never starts on iOS host; SDK healthcheck fails (CLI unreachable) → `percyEnabled = false`. User sees "successful" build with no Percy coverage. | **No** — this is the most dangerous state. Phase 3 must follow Phase 2 quickly on the same host |

## Go/No-Go Per Phase

Phase-level exit criteria distinct from per-unit dev verification. Each phase must satisfy all items before advancing.

### Phase 1 (CLI relay) Go/No-Go

Two tracks — sandbox (pre-release validation on iOS) and release (production). Sandbox track was executed 2026-04-21 on host `185.255.127.11`; evidence recorded inline.

**Sandbox track (iOS, validated 2026-04-21):**
- [x] ~~Pre-deploy: backup of existing `api.js` captured on the host.~~ **N/A in sandbox mode** — the production Nix-pinned CLI at `/nix/store/...-percy-cli-1.30.0/...` is not touched.
- [x] Post-deploy: sandbox `@percy/core` server starts and logs `Percy relay listening on :5999`. Healthcheck route is not registered in `testing: true` mode; equivalence was established via the POST relay probes below.
- [x] Manual relay probe with `platform: "android"` and a known-nonexistent sessionId → `404 Screenshot not found: probe.png (searched /tmp/nosuchsession_test_suite/logs/*/screenshots/probe.png)`.
- [x] Manual relay probe with `platform: "ios"` → `404 Screenshot not found: probe.png (searched /tmp/nosuchsession/*_maestro_debug_*/probe.png)`.
- [x] Manual relay probe with non-whitelisted `platform` (e.g., `"windows"`) → `400 Invalid platform: must be "ios" or "android", got "windows"`.
- [x] Manual relay probe with `name` containing a shell metacharacter (`*`) → `400 Invalid screenshot name`.
- [x] Bonus: manual relay probe with path-traversal `sessionId` (`../etc`) → `400 Invalid sessionId`.
- [x] Bonus: no `platform` field → Android glob used (R9 backward compatibility for SDK v0.2.0).
- [x] Bonus: real file placed at iOS glob pattern on the host (`/tmp/<sid>/xx_maestro_debug_yy/<name>.png`) is found through the macOS `/tmp → /private/tmp` symlink via realpath canonicalization — pipeline completes without throwing.
- [x] No regression to production Android paths — sandbox ran on port 5999; production Percy CLI on its default port was never touched.

**Release track (Android + iOS, pending):**
- [ ] Android hosts: scp patched `api.js` to realmobile deps path, `restart_servers`; backup of prior `api.js` captured.
- [ ] iOS hosts: `@percy/cli` publishes the iOS relay changes; `percy-setup.nix` bump lands in realmobile; tag-based deploy rolls to iOS host fleet.
- [ ] Post-deploy: `GET /percy/healthcheck` returns 200 with `x-percy-core-version` matching the intended patched version on both platforms.
- [ ] Re-run all probes above against the production CLI on its default port.
- [ ] No new errors in an existing Android Maestro build run on an Android host (regression gate).
- [ ] No new errors in an existing iOS Maestro build run on an iOS host without `app_percy` (regression gate — confirms the relay doesn't perturb unrelated routes).

### Phase 2 (SDK v0.3.0) Go/No-Go

- [ ] Single iOS test flow on a Phase-1-patched host completes with a Percy snapshot uploaded, tagged `osName: "iOS"` on the Percy dashboard.
- [ ] Single Android test flow with the new SDK completes unchanged — Android dashboard tagged `osName: "Android"` and coverage count matches baseline.
- [ ] Payload inspection during the iOS test: POST body contains `platform: "ios"`, `osName: "iOS"`, `clientInfo: "percy-maestro/0.3.0"`.

### Phase 3 (realmobile) Go/No-Go

- [ ] Pre-deploy: current deployed tag/sha on each iOS host recorded in deploy ticket.
- [ ] `restart_servers` completes without error; realmobile process is up.
- [ ] **Non-Percy regression gate:** test build *without* `app_percy` → iOS Maestro session completes end-to-end; no Percy CLI process spawned; no new log noise mentioning AppPercy or Percy.
- [ ] Test build *with* `app_percy`:
  - [ ] Percy CLI process running on port `5{device_port}` during the session.
  - [ ] `-e PERCY_SESSION_ID=<session_id>` visible in the Maestro command log (as an `-e` flag, not a shell prefix).
  - [ ] Percy CLI log file exists at `/var/log/browserstack/percy_cli.<session_id>_<port>.log`.
  - [ ] After session ends: Percy CLI process is gone; port `5{device_port}` is free.
  - [ ] Percy dashboard shows screenshots with `osName: "iOS"` and correct device metadata.
- [ ] Emergency-stop test: abort a session mid-flow if feasible → `ensure_session_stop` cleans up the Percy CLI (placement BEFORE the early-return verified).
- [ ] Mid-stop-failure test: inject a raise in a pre-Percy cleanup step (if feasible) → Percy CLI still stopped via `ensure`-block placement.
- [ ] Run 2-3 consecutive sessions on the same device → no port-reuse regressions on normal exits.

## System-Wide Impact

- **Interaction graph:** `MaestroSession` gains a new lifecycle dependency on `AppPercy::Session`. Percy CLI start/stop are wrapped in helpers (`start_app_percy`, `stop_app_percy`) that fail-soft via the `logit` wrapper. Failure in `start_app_percy` must not kill Maestro session start — `AppPercy::Util.logit` suppresses exceptions and returns false on failure.
- **Error propagation:** Percy CLI failures are non-fatal to the Maestro session. If the SDK's healthcheck fails at runtime (CLI unreachable), Percy is silently disabled for the JS side; Maestro continues. Matches Android and XCTestSession posture — no new error-handling layer introduced.
- **State lifecycle risks:**
  - *Mid-stop failure:* Placing `stop_app_percy` in the `ensure` block of `MaestroSession#stop` guarantees Percy teardown even when earlier steps (mitm stop, summary upload) raise — required because the outer `rescue => e` at line 177 swallows without re-raising.
  - *Timeout teardown:* Placing `stop_app_percy` AFTER timeout-marking and `kill_idle_process` in `force_stop` ensures critical timeout handling runs regardless of Percy state; the Percy call is wrapped with inner `begin/rescue` as belt-and-suspenders.
  - *Emergency teardown:* Placing Percy stop BEFORE the early-return check in `ensure_session_stop` (line 200-211) guarantees port cleanup even when Maestro never launched.
  - *Partial start failure:* If `start_app_percy` fails between `setup_params` and `run_maestro_session`, `stop`'s `ensure` block invokes `@app_percy_session&.stop(...)`, which is a no-op when the CLI is not running.
- **API surface parity:** The new `platform` field is added to the `/percy/maestro-screenshot` request body only. The response shape is unchanged. No other endpoints (`/percy/comparison`, `/percy/comparison/upload`, `/percy/snapshot`, `/percy/automateScreenshot`) consume sessionId-derived disk paths, so no sibling endpoint needs platform awareness.
- **Observability (accepted limitation):** `AppPercy::Session`'s `FRAMEWORK` constant remains hardcoded to `"XCUI"`. Maestro Percy lifecycle events will be tagged `framework="XCUI"` in telemetry — support debugging Percy+Maestro iOS will correlate via `session_id` and `device_id` rather than framework tag. If this becomes a debugging blocker, a follow-up can parameterize `FRAMEWORK` (out of scope for v1 iOS support per the scope boundaries — it refactors a class shared with XCTest).
- **Partial-rollout blast radius:** The worst case is **new SDK against old CLI on an unpatched iOS host** — SDK sends `platform: "ios"` → old relay ignores the unknown field → uses Android glob → 404 silent degrade per screenshot. Mitigated operationally by gating Phase 2 broad release on Phase 1 reaching 100% of the iOS fleet. See the Cross-Phase States section for the full matrix.
- **Integration coverage:** End-to-end on BrowserStack iOS is the only way to fully validate — unit tests for the CLI glob and SDK payload cover the isolated logic, but session wiring, Percy CLI start/stop, and cross-phase behavior require a real BrowserStack iOS host. Plan for at least one end-to-end validation session during Unit 3 per phase in the Go/No-Go section below.

## Risks & Dependencies

- **Critical path:** Unit 1 must deploy to the iOS host before Unit 3 is meaningful. Verify the patched `dist/api.js` is in place and Node runs it cleanly.

- **Node version on iOS host unknown.** If the patched file fails to load, use the same `||=` → `||` fix applied for Android. See First-Contact Verification below for the safe pre-restart load test.

- **SSH user/port unknown for iOS hosts.** Resolve on first deploy; document in the solutions folder after.

- **realmobile tag-based deploy may reset manual branch checkouts.** Acceptable for testing; a production rollout requires a real release tag containing the feature branch commits. After a production deploy overwrites our branch, a re-checkout + `restart_servers` is needed until the release tag catches up.

- **Stale Percy CLI from crashed prior session (pre-existing, accepted).** `AppPercy::CLIManager#start_percy_cli` has no pre-start cleanup; `cli_running?` is process-grep-based (`cli_manager.rb:45-47`) and can false-positive on stale processes. This is a pre-existing issue in a shared class (affects XCTest too) and is out of scope for iOS Maestro v1 per the "don't fix bugs we didn't introduce" guardrail. If this surfaces as an iOS Maestro production issue, file a scoped follow-up against `AppPercy::CLIManager`.

- **Silent Percy-CLI boot timeout.** `cli_check` rescues `Timeout::Error` after 5s with only a log. The session proceeds, healthcheck disables Percy, zero screenshots upload. Matches Android and XCTestSession posture — no mitigation added in v1. If this is observed as a common failure mode, consider extending the timeout to 15s for iOS hosts as an operational follow-up.

- **Partial-rollout blast radius (Phase 1 not 100% complete when Phase 2 ships).** SDK v0.3.0 on an unpatched CLI host → Android glob used against an iOS file path → 404 silent degrade per screenshot. Mitigated **operationally**: Phase 2 broad release is gated on Phase 1 reaching 100% of the iOS fleet. If a partial-rollout incident actually materializes in production, a v0.3.1 SDK follow-up can add CLI version gating.

- **Org plan-limit-reached silent degrade.** `AppPercy::Session#start_percy_cli` detects and logs plan-limit-reached but returns false. Session proceeds with Percy disabled. Matches Android; consider surfacing via session annotation in a follow-up, not in scope here.

- **iOS Maestro may emit multiple PNGs per flow.** Mitigated by exact-name glob in Unit 1. If Maestro ever renames user captures (unlikely), revisit. Debug frames with emoji prefixes are explicitly filtered by the exact `{name}.png` match.

- **`maestro.platform` returning an unexpected value (e.g., `"web"` on a mis-targeted flow).** Healthcheck allowlist handles this — Percy disables silently.

- **Legacy SDK (v0.2.0) on iOS.** Not a supported configuration; SDK v0.3.0 is the iOS-capable version. The v0.2.0 healthcheck gate blocks iOS at the SDK layer, so this fails safely. Document in release notes.

- **Trust-input: `platform` field value.** The `platform` field is user-controlled via the SDK's `maestro.platform` value. A malicious/misconfigured SDK sending `platform: "../../etc"` hits the CLI relay — mitigated by whitelist validation in Unit 1 (only `"ios"`/`"android"` accepted; anything else → default Android). The value does not interpolate into the glob path.

## Rollback Procedures

### Rollback triggers (any one triggers the corresponding phase's rollback)

**Phase 1 triggers:**
- `/percy/healthcheck` returns non-200 on the patched host.
- Any Android session on the patched host reports a Percy relay 4xx/5xx where baseline had none.
- Sustained 4xx rate on `/percy/maestro-screenshot` from that host's logs.

**Phase 3 triggers:**
- Any iOS Maestro session (with OR without `app_percy`) hangs or fails in `MaestroSession#start` that did not fail pre-deploy.
- Orphan `percy app exec:start` processes observed after a session ends.
- `EADDRINUSE` signatures in Percy CLI logs indicating port-reuse failures.
- New exception stack frames from `maestro_session.rb` in the realmobile server log.
- Baseline iOS Maestro success rate on the host drops vs. prior 24h by more than a small threshold (define during Unit 3 baselining).

### Rollback procedures

**Phase 1 rollback (CLI relay):**

*Android hosts:*
1. Restore the pre-deploy `api.js` backup (`api.js.pre-ios-support`) over the patched file.
2. `restart_servers`.
3. Confirm `/percy/healthcheck` returns 200 and an existing Android Maestro build on the host produces Percy snapshots as before.

*iOS hosts:* the production Percy CLI on iOS is Nix-pinned — there is no in-place `api.js` to back up or restore. Rollback is a realmobile revert of the `percy-setup.nix` version + sha256 pin, followed by the standard realmobile tag-based deploy. Sandbox validation leaves no artifacts on the host, so sandbox-mode rollback is `pkill -f sandbox-runner && rm -rf /usr/local/.browserstack/deps/percy-cli-dev` — effectively a no-op against production.

**Phase 3 rollback (realmobile branch):**
1. On the host, `git checkout <previously-deployed-tag>` (the tag/sha captured pre-deploy).
2. `restart_servers`.
3. Confirm no orphan `percy app exec:start` processes on port range `5*`.
4. **Critical baseline-recovery verification:** test build *without* `app_percy` completes end-to-end (proves non-Percy regression is gone). Test build *with* `app_percy` returns to pre-Phase-3 behavior (no Percy CLI starts, no `PERCY_SESSION_ID` injected).

**Phase 2 rollback (SDK v0.3.0):** 
- SDK rollback is customer-initiated (copy-paste distribution). Revert requires restoring the v0.2.0 `percy/` directory. This is slower than host-side rollbacks and must be communicated via release notes and customer outreach.

### Do NOT trigger revert for

- Individual session failures when `app_percy` is enabled and the flow has issues unrelated to Percy (check it reproduces without `app_percy`).
- Percy CLI log 4xx on `/percy/maestro-screenshot` alone — investigate the payload + glob, not the full rollout.

## Monitoring Signatures

### Success signatures (what "working" looks like)

- **Percy CLI started on iOS:** `percy` process bound to port `5{device_port}`; `/var/log/browserstack/percy_cli.<session_id>_<port>.log` exists with Percy startup banner matching the `x-percy-core-version` header.
- **`PERCY_SESSION_ID` injected correctly:** the Maestro command log shows `-e PERCY_SESSION_ID=<session_id>` as a flag (not as an inline shell prefix). The `<session_id>` matches the Percy CLI log filename.
- **Screenshot matched:** POST to `/percy/maestro-screenshot` resolves to a file path containing `_maestro_debug_`. Response: 200 with `{success: true, link: ...}` (non-sync) or `{success: true, data: ...}` (sync).
- **Correct OS tagging:** Percy dashboard shows the snapshot's tag with `osName: "iOS"`.

### Failure signatures (what to alert on)

- **Port in use:** Percy CLI startup log contains `EADDRINUSE` on port `5{device_port}`. Root cause: prior session's CLI not stopped. Investigate Phase 3 teardown wiring — check `stop` `ensure`-block, `force_stop` placement, and `ensure_session_stop` placement for the session that left the stale process.
- **Screenshot not found — wrong glob:** relay error message contains `_test_suite/logs` pattern on an iOS session. Root cause: `platform` field absent from payload. Likely the SDK is a pre-v0.3.0 version, or Phase 2 has not reached this user.
- **Screenshot not found — correct glob:** relay error contains `_maestro_debug_` pattern but no file. Root cause: genuine missing file — investigate `takeScreenshot` write path, `@debug_output` dir layout, or filename mismatch.
- **SDK healthcheck disabled Percy:** `[percy]` log line matching "Percy disabled" or "CLI unreachable" in the Maestro command output. Root cause: Percy CLI never started on the host (Phase 3 wiring broken) or Phase 1 CLI patch missing.
- **Strict whitelist rejection:** relay returns 400 with message about `platform` value. Root cause: a client sent a non-whitelisted platform string — investigate client source.

## Documentation / Operational Notes

- **Confluence architecture page** at `https://browserstack.atlassian.net/wiki/spaces/ENG/pages/6120702011` needs an iOS section covering the `platform` field, the iOS path glob, and the realmobile `AppPercy` integration.
- **Release notes / changelog:** Percy Maestro SDK v0.3.0 — "iOS support on BrowserStack real devices. Feature parity with v0.2.0 Android (regions, sync, tile metadata)."
- **Jira:** PER-7281 already has comments tracking progress; update on completion with the monitoring signatures and rollback procedures documented here.
- **Percy CLI logs on iOS are host-local and ephemeral** (at `/var/log/browserstack/percy_cli.<session_id>_<port>.log`). They are not uploaded to S3 in v1. For post-mortem support, collect logs from the host within the session's lifetime or file a follow-up to mirror `XCTestSession`'s `upload_percy_logs`.
- **Post-deploy watch cadence:**
  - First 30 minutes: active watch. Run at least one `app_percy`-enabled iOS build and one non-`app_percy` iOS build. Confirm all Go/No-Go items green.
  - First 4 hours: passive watch. Compare error rate on the host to the prior 24h baseline.
  - First 24 hours: monitor daily batch metrics — iOS session success rate, Percy snapshot count (zero for non-`app_percy`, non-zero for `app_percy`), orphan Percy CLI process count at day end.
  - Declare stable: 24 hours of clean operation with ≥ 1 successful `app_percy` build and ≥ 10 non-`app_percy` iOS Maestro builds completing without regression.

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-10-ios-support-requirements.md`
- **Android prior art (plan):** `docs/plans/2026-04-03-001-feat-sdk-feature-parity-plan.md`
- **Percy CLI relay:** `cli/packages/core/src/api.js` (route `/percy/maestro-screenshot`, lines ~300-413)
- **SDK healthcheck:** `percy-maestro/percy/scripts/percy-healthcheck.js:7`
- **SDK screenshot script:** `percy-maestro/percy/scripts/percy-screenshot.js:32, 123`
- **realmobile MaestroSession:** `realmobile/lib/session/maestro_session.rb` (lines 49, 51-64, 152-183, 200-245, 389-403, 776-788, 825)
- **realmobile XCTestSession (pattern reference):** `realmobile/lib/session/xctest_session.rb` (lines 76, 82, 109, 161, 236-242, 826-834)
- **realmobile AppPercy:** `realmobile/lib/app_percy/cli_manager.rb`, `realmobile/lib/app_percy/app_percy_session.rb`
- **Android env var injection reference:** `mobile/android/maestro/scripts/maestro_runner.rb` lines ~780-786
- **Confluence architecture:** `https://browserstack.atlassian.net/wiki/spaces/ENG/pages/6120702011`
- **Jira ticket:** PER-7281
