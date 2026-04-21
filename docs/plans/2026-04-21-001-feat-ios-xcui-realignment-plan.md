---
title: "feat: iOS Percy Maestro — realign with XCUI conventions and verify E2E"
type: feat
status: active
date: 2026-04-21
origin: docs/brainstorms/2026-04-21-ios-xcui-realignment-requirements.md
deepened: 2026-04-21
---

# feat: iOS Percy Maestro — realign with XCUI conventions and verify E2E

## Overview

Our v0.3.0 iOS pass took too many cues from Android Maestro. The result: customers run the documented `percyOptions: {enabled, percyToken}` payload (the v0.3.0 defect — the correct iOS shape is `appPercy: {PERCY_TOKEN, env}`), BrowserStack's iOS bridge silently drops `percyOptions` (confirmed live 2026-04-21 — the `/start_maestro_session` POST body on host `185.255.127.52` contained no `app_percy` key), realmobile's `@params['app_percy']` stays nil, Percy CLI never starts, the SDK's healthcheck fails, and the build "passes" with zero Percy uploads.

The canonical iOS Percy payload shape — proven by `percy-xcui-swift` and its example repo — is `appPercy: {PERCY_TOKEN, env}`. Switching to that shape unblocks Percy CLI startup on iOS. No SDK code change is required, and no realmobile code change is required: `AppPercy::CLIManager.start_percy_cli` already forwards `params['app_percy']['env']` keys into the `percy app exec:start` subprocess via its `cli_env` helper (verified in `lib/app_percy/cli_manager.rb`).

This plan is small and mostly verification + documentation. The single open-ended unknown is whether BrowserStack's iOS Maestro bridge actually translates the public `appPercy` field into realmobile's `@params['app_percy']` (the XCUI-side bridge does — verified from `example-percy-xcui-swift`; the Maestro-iOS-side behavior is not yet verified). Unit 1 is the diagnostic gate for that question.

## Problem Frame

Customers attempting iOS visual testing on BrowserStack today silently lose their Percy data. Every build shows `passed` in BrowserStack, with no Percy snapshots on the Percy dashboard and no error surfaced to the user. Traceable in logs only by inspecting realmobile's `/start_maestro_session` POST body and noticing the absent `app_percy` key. See origin document for full context.

Scope is mostly an API-shape correction + documentation realignment + E2E verification. This cycle explicitly does not add new SDK features; it makes the feature we already shipped actually work end-to-end on iOS.

## Requirements Trace

- **R1** — `appPercy: {PERCY_TOKEN, env}` on the BS iOS Maestro build API causes Percy CLI to start and screenshots to appear on Percy dashboard tagged `osName: "iOS"`. *(see origin)*
- **R2** — `appPercy.env` values (e.g. `PERCY_BRANCH`, `PERCY_PROJECT`, `PERCY_COMMIT`) are present in Percy CLI's environment at spawn. *(see origin)*
- **R3** — Coordinate-based `PERCY_REGIONS` is verified E2E on a real iOS device with at least one algorithm (e.g. `ignore`). *(see origin)*
- **R4** — Docs realign on `appPercy` for iOS, keep Android's `percyOptions` unchanged, label element-based regions as deferred for both platforms. *(see origin)*

## Scope Boundaries

- **Out:** Element-based `PERCY_REGIONS` on iOS (WDA resolver, session disambiguation, selector translation, device scale-factor multiplication for points→pixels conversion). Separate future brainstorm. See `Context & Research > Prior Art` for warnings gleaned from `percy-appium-python` that the future effort must inherit.
- **Out:** XCUI-parity additions (`PERCY_ALLOWED_DEVICES`, CLI version enforcement, `PERCY_LOG_LEVEL`). Deferred to a later release per user decision.
- **Out:** Android API-shape changes. Android's `percyOptions` stays; this cycle only corrects iOS.
- **Out:** Auto-detecting device metadata on iOS Maestro (blocked by GraalJS sandbox — users continue to pass env vars in the flow yaml).
- **Out:** Multi-tile composite screenshots.

## Context & Research

### Relevant Code and Patterns

- **`/Users/arumullasriram/percy-repos/percy-xcui-swift/percy-xcui/README.md`** — canonical iOS Percy SDK user-facing docs. Shows the minimal screenshot call shape and the local-usage setup (`/etc/hosts` entry + `percy app:exec start`), the latter of which does **not** apply to Maestro (our JS runs on the host, not on-device).
- **`/Users/arumullasriram/percy-repos/example-percy-xcui-swift/README.md`** — canonical iOS build-API payload: `appPercy: {PERCY_TOKEN, env: {PERCY_BRANCH, ...}}`. This is the shape to mirror in our iOS Maestro docs.
- **`/Users/arumullasriram/percy-repos/realmobile/lib/app_percy/cli_manager.rb`** — `start_percy_cli` (lines 19-26) interpolates `cli_env(params['app_percy']['env'])` (helper at lines 78-84) into the `percy app exec:start` command. Every key-value pair in `env` becomes a `KEY='VALUE'` prefix. This is the mechanism R2 depends on; it works as-is.
- **`/Users/arumullasriram/percy-repos/realmobile/lib/app_percy/app_percy_session.rb`** — `start` delegates to `CLIManager`. Wraps in `AppPercy::Util.logit` with `suppress: true` (line 27) — fails soft: no exceptions bubble up if Percy CLI doesn't start. This is the existing posture we must not break. Stop path (lines 52-65) similarly fails-soft.
- **`/Users/arumullasriram/percy-repos/realmobile/lib/session/maestro_session.rb`** (feature branch `feat/maestro-percy-ios-integration`, commit `54e2f4839`) — our one-commit-above-master branch that adds AppPercy wiring to `MaestroSession`. Already deployed on host `185.255.127.52`.
- **`/Users/arumullasriram/percy-repos/percy-maestro/percy/scripts/percy-screenshot.js`** — SDK reads `PERCY_REGIONS` JSON, accepts coord-based regions platform-agnostically, silently skips element-based with a warning. **No changes needed** for R3.
- **`/Users/arumullasriram/percy-repos/cli/packages/core/src/api.js`** (on branch `feat/maestro-multipart-upload`) — relay's `/percy/maestro-screenshot` route, already platform-aware with iOS glob `/tmp/{sid}/*_maestro_debug_*/{name}.png` and realpath canonicalization for macOS `/tmp → /private/tmp`.
- **`/Users/arumullasriram/percy-repos/percy-maestro/docs/plans/2026-04-20-001-feat-ios-support-plan.md`** — the prior iOS support plan that documents the Phase 1/2/3 rollout. It does not currently contain `percyOptions` or `appPercy` examples inline (the public-API shape was not spelled out in that plan). Needs a backlink note pointing to this realignment plan, added as part of Unit 2.

### Prior Art — percy-appium-python (reference for future iOS element-region work)

Deepen pass 2026-04-21: scanned `~/percy-repos/percy-appium-python` to understand how the existing Percy iOS SDK handles regions. **Findings are knowledge for the deferred element-based iOS regions effort; nothing from here is replicated in this cycle.**

- **`percy-appium-python/percy/providers/generic_provider.py:87-162`** — `_find_regions` resolves element selectors by calling `driver.find_element(by=AppiumBy.XPATH|ACCESSIBILITY_ID)` in-process. Uses Appium's live driver connection to the device. **Architectural note:** this approach is unreachable from Maestro. GraalJS sandbox blocks direct driver calls (see `project_multipart_test_results.md`). The Maestro equivalent must be CLI-side WDA integration, confirming our deferred design direction for element-based iOS regions.
- **`percy-appium-python/percy/providers/generic_provider.py:95-104`** — `get_region_object` multiplies `element.location` (x, y) and `element.size` (width, height) by `metadata.scale_factor` before constructing the `{top, bottom, left, right}` tuple. **Critical prior-art warning:** iOS WDA returns element rects in points, not pixels. A future Maestro CLI-side element resolver must multiply by the device scale factor (typically 2× or 3× for retina iPhones) before emitting coordinates. Skipping this produces 1/2- or 1/3-size regions that miss the intended target. `percy-appium-python/percy/metadata/ios_metadata.py:72-77` shows the `scale_factor` lookup pattern (per-device from static `devices.json`, with viewport-ratio fallback).
- **`percy-appium-python/percy/lib/region.py`** — `Region` validates `top >= 0`, `top < bottom`, `left >= 0`, `left < right`, and in-screen bounds. Our Maestro `percy-screenshot.js` already enforces equivalent shape validation (skips regions with `bottom <= top` or `right <= left`). Confirmation that our coord-region contract is consistent with the Appium prior art.
- **Payload-shape divergence (accepted):** Appium sends `ignoreElementsData[]` and `considerElementsData[]` as separate top-level keys with selectors + coordinates. Our Maestro SDK sends a unified `regions[]` with `algorithm` per region, and the CLI relay adapts on the backend side. Our shape is more expressive (supports `intelliignore`, `layout`, `standard`, not just ignore/consider) and does not need to change for either the current cycle's coord work or any future element-based work.
- **Selector-string format convention:** Appium emits selectors as human-readable strings like `"xpath: //..."`, `"id: <accessibility-id>"`, `"custom ignore region: <idx>"`. Used for debugging on the Percy dashboard. When we build iOS element-region support, mirroring this convention keeps the cross-SDK debug experience consistent.

### Institutional Learnings

- **`.claude/projects/-Users-arumullasriram-percy-repos-percy-maestro/memory/project_multipart_test_results.md`** — GraalJS sandbox blocks Java interop, file I/O, and native bindings. Explains why we can't mirror XCUI's `XCUIScreen.main.screenshot()` → base64 → POST pattern in Maestro; the relay is the only viable path. This constraint justifies keeping our transport design untouched.
- **`.claude/projects/-Users-arumullasriram-percy-repos-percy-maestro/memory/feedback_dont_change_other_repos.md`** — only fix bugs we introduced, not pre-existing issues in other repos. Keeps the realmobile diff scoped to our single cherry-picked commit.

### External References

Skipped — strong local patterns (XCUI SDK + example repo already model the iOS payload shape), no new technology stack, user has deep context.

## Key Technical Decisions

- **iOS build-API param is `appPercy: {PERCY_TOKEN, env}` (not `percyOptions`)** — matches XCUI convention, matches BS's iOS appautomate bridge. *(see origin)*
- **Zero SDK code change required** — our v0.3.0 SDK already emits the correct relay payload; the only iOS-specific SDK behavior is `tag.osName = "iOS"` + `payload.platform = "ios"`, both already present.
- **Zero realmobile code change required** — `AppPercy::CLIManager.cli_env` already splats `env` dict into the Percy CLI subprocess environment.
- **Keep Android's `percyOptions` unchanged** — no customer-visible Android migration.
- **Coord-based `PERCY_REGIONS` on iOS is a verification-only requirement (no new SDK code required, only E2E testing)** — existing SDK logic is platform-agnostic for coord regions; prove it E2E rather than reimplement.
- **Version bump to `v0.4.0`** — iOS API-shape change is customer-visible (breaking for early iOS adopters on v0.3.0). Minor bump, not patch. Android users unaffected.
- **Surface Percy-disable state visibly in the SDK's healthcheck log (v0.4.0 scope)** — converged across product, security, and scope-guardian review personas. Today the SDK logs `Percy CLI healthcheck failed with status: <n>` when CLI isn't reachable, but many builds go uninspected. Since v0.4.0 still lives in a partial-rollout window (the same silent-failure posture that v0.3.0 had), the release must ship a louder signal. Scope for this cycle: ~2-line SDK change to `percy-healthcheck.js` that emits a prominent `[percy] DISABLED — this build will have zero Percy snapshot coverage` banner on healthcheck failure, and distinguishes "CLI unreachable" from "CLI reachable but rejected token/auth" so compromised-token failures don't present identically to misspelled env vars. Fail-soft posture still stays (no raised exceptions); this is pure logging.

## Open Questions

### Resolved During Planning

- **Does `AppPercy::CLIManager` forward `appPercy.env` to Percy CLI?** Yes — verified in `cli_manager.rb:19-26` via the `cli_env` helper at lines 78-84. Every `env` entry becomes a `KEY='VALUE'` prefix on the subprocess command line.
- **Does our SDK accept coord-based regions on iOS?** Yes — `percy-screenshot.js` handles the region shape platform-agnostically; the per-region type check is on `element` presence, not platform.
- **Is the relay on host 52 set up to receive iOS payloads?** Yes — Nix overlay applied, smoke-probed (iOS glob + platform whitelist respond correctly). Validated earlier this session.
- **Local-usage contract for iOS Maestro** — identical to Android (`npx percy app:exec -- maestro test ...`). No `/etc/hosts` hack needed; XCUI needs it only because the XCUI test binary runs on-device.

### Deferred to Implementation

- **Does BrowserStack's iOS Maestro bridge translate `appPercy` → `app_percy` in the realmobile POST body?** Unverified — the XCUI-side bridge does, the Maestro-iOS-side behavior is unknown and only knowable via a live E2E probe. Unit 1 gates the rest of the plan on this answer. If negative, escalate to BrowserStack's appautomate team (see Risks); the rest of this plan's doc/version work can still proceed but E2E verification waits on the BS change.
- **What's the exact order of env-var expansion inside `cli_env`?** The helper interpolates with single quotes (`KEY='VALUE'`). **This is a security concern, not merely a functional edge case** — see the Risks section's HIGH security bullet on `cli_env` as a command-injection primitive. A customer-controlled value containing `'; <cmd>; '` would break out of the quoting and execute in the Percy CLI subprocess context. Recommended realmobile hardening (out-of-scope for this plan, tracked for the realmobile team): replace string interpolation with argv-array process spawning or `Shellwords.escape`, plus whitelist env keys to `PERCY_*` and constrain values to `[A-Za-z0-9._\-]+`. **Customer-facing mitigation in Unit 2's README:** document that `appPercy.env` values should contain only alphanumeric plus `._-` characters — mirrors the recommended realmobile validation so customers building CI pipelines with special characters in branch/project/commit names don't accidentally exercise the vulnerable path.
- **Whether `example-percy-maestro` needs an iOS section** — the repo exists with Android-only content today. Scope decision to defer: iOS is new, and one documentation entry point (percy-maestro's own README) is enough until the feature is stable. Flag for a future doc pass.
- **Exact choice of iOS test app for coord-region verification** — `BStackSampleApp.ipa` (bundle id `com.browserstack.Sample-iOS`, already uploaded as `bs://fdf0aa75c2ae6d98107027e3949b8c50b0b96419`) keeps iterations fast. No reason to pick a different app unless it proves unsuitable.

### Future-Work Notes (reference learnings from the deepen pass — not pre-approved design decisions)

Element-based iOS `PERCY_REGIONS` is deferred. The notes below are research findings from `percy-appium-python`, recorded here so the team that eventually plans this work doesn't have to re-discover them. **These are reference learnings only; the next cycle's brainstorm and plan should re-evaluate each point rather than treat it as settled design.**

- **Scale-factor multiplication is load-bearing.** iOS WDA (the equivalent of Appium's driver) returns element rects in points. Screenshots are in pixels. The CLI-side resolver must multiply `(x, y, width, height) × deviceScaleFactor` before emitting `{top, bottom, left, right}`. Reference: `percy-appium-python/percy/providers/generic_provider.py:95-104`. A scale-factor database keyed on device name already exists in Appium's world (`percy-appium-python/percy/configs/devices.json`); reusing or linking against it would save rebuilding the catalog.
- **Selector dialect on iOS WDA is richer than Android's ADB model.** WDA supports `xpath`, `accessibility id`, `class name`, `link text`, and predicate strings. Our Android element-region deferred work targets `resource-id`, `text`, `content-desc`, `class` via ADB. The two dialects do not map 1:1, which is one reason this plan keeps element-based regions deferred for both platforms — a shared design pass would avoid asymmetric selector support between platforms.
- **Session disambiguation on shared hosts matters more for WDA than for ADB.** Android's ADB is device-scoped (one device, one `adb -s <id>` channel). iOS WDA is port-scoped (one device, one WDA port, but multiple WDA sessions can exist per port). Picking "the right" WDA session when multiple Maestro runs land on the same host simultaneously requires a signal from realmobile (e.g., the session id passed to WDA at session creation), not just a port scan.
- **Payload shape does not need to change.** Our unified `regions[]` with per-region `algorithm` field accommodates both coord- and element-based regions without a protocol redesign. The CLI relay is already the translation boundary.

## Implementation Units

- [ ] **Unit 1: Diagnostic — verify BS iOS Maestro bridge translates `appPercy` to `app_percy`**

**Goal:** Confirm the hypothesis that changing the public-API payload from `percyOptions` to `appPercy: {PERCY_TOKEN, env}` is sufficient to make `@params['app_percy']` populated in realmobile's `/start_maestro_session` POST body. Gates the rest of the plan.

**Requirements:** R1

**Dependencies:** Host `185.255.127.52` setup already in place (Nix overlay applied, feat branch `54e2f4839` checked out, Percy CLI patched). Devices from `cs` listing — pick a device currently `✓` (e.g. `00008110-000E35D41A7A401E`).

**Files:**
- Inspect: `/var/log/browserstack/prod.log` on host 52 (via `ios_ssh`)

**Approach:**
- Pre-flight (~30 seconds): verify on host 52 that `@percy/core/dist/api.js` contains `maestro-screenshot` and that realmobile's HEAD is the clean feature-branch commit. Re-apply overlay or re-checkout branch if state drifted.
- Trigger one BS iOS Maestro build with payload `appPercy: {PERCY_TOKEN: "<app token>", env: {PERCY_BRANCH: "ios-bridge-probe"}}`, pinned to the patched host + a free device
- Observe the primary signal (below) on the host, then interpret
- Outcome A — Percy CLI log file created + `app_percy` in POST body: BS bridge works for iOS Maestro → proceed with Units 2-6
- Outcome B — no Percy CLI log file AND no `app_percy` in POST body: BS bridge missing for iOS Maestro → open escalation with BrowserStack appautomate team. Units 3-4 (E2E) pause. Units 2 (docs), 5 (louder signal), and 6 (version + CHANGELOG) can still ship with explicit "requires BS backend change — tracking link" banners in README and CHANGELOG (see Unit 2 Outcome-B guardrail and Unit 6 Outcome-B guardrail)

**Execution note:** This is a characterization probe, not a behavior change. No code is modified. The unit's value is information.

**Test scenarios:**
- Trigger build, poll until status=`passed` or `error`, session start time populated
- **Primary signal (more robust):** `ls /var/log/browserstack/percy_cli.<session_id>_*.log` — file presence implies Percy CLI started, which implies `@params['app_percy']` was populated, which implies the bridge translated `appPercy`. Not log-format-dependent.
- **Secondary signal:** grep the `/start_maestro_session` POST body for `"app_percy"` — direct evidence but depends on realmobile's log format staying stable. If the grep misses, the primary signal still tells the truth.
- **Tertiary signal:** Percy dashboard shows a snapshot under `PERCY_BRANCH=ios-bridge-probe` — end-to-end confirmation; also proves R2 (`env` pass-through) in the same build.

**Verification:**
- Outcome recorded in the PR description with session id and primary-signal observation (file exists or does not). Tertiary-signal dashboard URL also recorded when positive.

---

- [ ] **Unit 2: Realign percy-maestro public documentation on `appPercy`**

**Goal:** Update the user-facing docs so customers copy the correct iOS payload shape. Preserve Android examples using `percyOptions` (still correct for Android).

**Requirements:** R4 (docs realignment — user-facing iOS Maestro usage docs)

**Dependencies:** Unit 1 outcome observed. If Outcome B, the docs ship with an Outcome-B guardrail banner (below) rather than promising the feature works today.

**Files:**
- Modify: `/Users/arumullasriram/percy-repos/percy-maestro/README.md`
- Modify: `/Users/arumullasriram/percy-repos/percy-maestro/CLAUDE.md`
- Modify: `/Users/arumullasriram/percy-repos/percy-maestro/docs/plans/2026-04-20-001-feat-ios-support-plan.md` (one-bullet backlink to this plan; absorbed from the dropped standalone Unit 3)

**Approach:**
- Add an iOS "Running on BrowserStack" section to README that mirrors `example-percy-xcui-swift`'s `appPercy` shape for the build API call
- Keep the Android section using `percyOptions` — do not change it
- Add an "API payload asymmetry" note explaining why iOS uses `appPercy` and Android uses `percyOptions` (historical; may converge in a future cycle)
- **Casing note:** explicitly state that the public BrowserStack API parameter is camelCase `appPercy`, while realmobile's internal `@params` key is snake_case `app_percy`. The BS appautomate bridge translates between them; customers use `appPercy`.
- **Credential hygiene note for customers:** recommend per-project Percy tokens (rotatable, scoped) when running on BrowserStack App Automate. The token transits BS infrastructure; customers should not reuse an org-scoped master token for CI builds.
- **Safe-character guidance for `appPercy.env` values:** document that env values should contain only alphanumeric plus `._-` characters (branch names, project slugs, commit SHAs all fit). Avoid spaces, quotes, semicolons, backticks, and other shell metacharacters — these can cause unexpected behavior in realmobile's env-passing mechanism and, in adversarial cases, become a shell-escape surface. See the cli_env security risk in the plan's Risks section for the underlying mechanism.
- Update the "Features not supported" table: label element-based regions as "deferred for both iOS and Android" (not "iOS-only")
- Add a local-usage note: same command as Android (`npx percy app:exec -- maestro test your-flow.yaml`); no `/etc/hosts` hack required for Maestro (contrast with XCUI which does)
- CLAUDE.md: add a "Platform Differences > BrowserStack build-API payload" bullet pointing to the iOS vs Android shape asymmetry
- **Prior iOS support plan backlink:** in `docs/plans/2026-04-20-001-feat-ios-support-plan.md`, add one bullet in its Resolved During Planning section: "2026-04-21 follow-up: The BrowserStack iOS Maestro build-API payload shape is documented in `2026-04-21-001-feat-ios-xcui-realignment-plan.md`. iOS customers use `appPercy: {PERCY_TOKEN, env}`; Android keeps `percyOptions`."
- **Outcome-B guardrail (conditional):** if Unit 1 is Outcome B, the README iOS section leads with a callout: "**BrowserStack iOS Maestro bridge support is in progress; this payload shape is documented for tracking and will work once BS's backend change lands. See `<tracking link>` for status.**" Remove the callout only when Unit 3 (basic E2E) is green.

**Patterns to follow:**
- `/Users/arumullasriram/percy-repos/example-percy-xcui-swift/README.md` — Step 5 `curl` example for the exact `appPercy` shape
- `/Users/arumullasriram/percy-repos/example-percy-maestro/README.md` — Step 5 `curl` example for the Android `percyOptions` shape (reference for the Android side of the docs)

**Test scenarios:**
- N/A (docs unit)

**Verification:**
- README has one `curl` example for iOS Maestro using `appPercy: {PERCY_TOKEN, env: {PERCY_BRANCH: ...}}`
- README has one `curl` example for Android Maestro using `percyOptions: {enabled, percyToken}` (unchanged from whatever is there today or just matching example-percy-maestro)
- Explicit asymmetry note is present and points to BrowserStack's public API as the reason
- Casing note (camelCase public / snake_case internal) present in both README and CLAUDE.md
- Per-project token recommendation present in README near the build-API example
- Element-based regions labeled "deferred for both platforms" in the not-supported table
- Prior iOS support plan has a one-bullet backlink to this realignment plan
- If Outcome B: the README iOS section has the "in progress" callout at the top of the iOS subsection

---

- [ ] **Unit 3: E2E — iOS Percy upload with `appPercy` and env pass-through**

**Goal:** Prove R1 + R2 on a real BS iOS device. Use the already-patched host + already-uploaded app/test suite (fast iteration).

**Requirements:** R1, R2

**Dependencies:** Unit 1 Outcome A (BS bridge works). If Unit 1 is Outcome B, this unit is paused pending BS backend change.

**Files:**
- None modified — pure E2E verification

**Approach:**
- Pre-flight (~30 seconds): verify on host 52 that `@percy/core/dist/api.js` contains `maestro-screenshot` and that realmobile's HEAD is the clean feature-branch commit. Re-apply overlay or re-checkout branch if state drifted.
- Build payload (sanitized for journaling — real token stays out of the PR): `{app: "bs://fdf0aa75c2ae6d98107027e3949b8c50b0b96419", testSuite: "bs://a6b9791e9bc227853478895fe1635c09f2901d82", devices: ["iPhone 14-16"], machine: "185.255.127.52:<device-id>", appPercy: {PERCY_TOKEN: "<REDACTED>", env: {PERCY_BRANCH: "ios-e2e-v4", PERCY_PROJECT: "<same project>"}}}`
- Kick off, poll, confirm session routes to the patched host
- On host: `ls /var/log/browserstack/percy_cli.<sid>_*.log` — must exist (confirms Percy CLI started)
- On Percy dashboard: confirm snapshot appears under the `ios-e2e-v4` branch
- Inspect snapshot metadata: `osName: iOS`, `osVersion: 16`, device matches `PERCY_DEVICE_NAME` from the flow yaml
- If snapshot appears under the correct branch + project, R2 is green (env pass-through proven)

**Execution note:** Characterization-first — record the **redacted** curl command (PERCY_TOKEN and BS basic-auth replaced with `<REDACTED>`), the build id, the session id, and the dashboard URL in the PR so future failures can be bisected against this known-good state. See `Documentation / Operational Notes > Credential Hygiene` for the full redaction checklist. Real PERCY_TOKEN and BS basic-auth values must never appear in the PR description.

**Test scenarios:**
- **Golden path:** build payload as above → build passes → Percy CLI log file exists → one snapshot on Percy dashboard under `PERCY_BRANCH=ios-e2e-v4`, `osName=iOS`
- **Missing token:** omit `PERCY_TOKEN` from `appPercy` → expect build to complete at the Maestro layer (fail-soft), Percy CLI log file exists but no snapshot on dashboard. Do not assert on specific log-line contents — the CLI may surface several failure modes (missing-token, revoked-token, plan-limit). Assert only on outcome-level signals: (a) build completes, (b) no snapshot on Percy dashboard, (c) log file is non-empty.
- **Env key propagation:** confirm `PERCY_PROJECT` from `env` reaches Percy CLI by checking the resulting build's project on Percy dashboard

**Verification:**
- Percy dashboard URL for the successful snapshot recorded in PR description (dashboard URL is behind Percy auth; safe to record)
- Session id recorded (session id is not a credential); `grep "<sid>" /var/log/browserstack/prod.log | grep -F "PERCY_SESSION_ID"` shows our percy_env_flags contribution (the `-e PERCY_SESSION_ID=...` in the Maestro command)

---

- [ ] **Unit 4: E2E — iOS Percy with coordinate-based `PERCY_REGIONS`**

**Goal:** Prove R3 by running one iOS build that applies a coordinate region (algorithm `ignore`) and confirming Percy's comparison displays it.

**Requirements:** R3

**Dependencies:** Unit 3 green (basic upload works). Uses the same app + test suite + host.

**Files:**
- Modify: `/tmp/ios-maestro-flows/ios-screenshot-test.yaml` (test-only; add `PERCY_REGIONS` env block for one flow step)
- The modified flow needs to be re-zipped and re-uploaded to BS as a new test suite

**Approach:**
- Pre-flight (~30 seconds): verify on host 52 that `@percy/core/dist/api.js` contains `maestro-screenshot` and that realmobile's HEAD is the clean feature-branch commit. Re-apply overlay or re-checkout branch if state drifted.
- Copy the existing iOS test suite, edit the yaml to add `PERCY_REGIONS: '[{"top":0,"bottom":59,"left":0,"right":1179,"algorithm":"ignore"}]'` to one screenshot step (simulates excluding Dynamic Island area)
- Re-zip + re-upload → new `bs://` URL (confirm the response's `test_suite_url` differs from Unit 3's to rule out client-side cache)
- Trigger a build with the new test suite and the `appPercy` payload from Unit 3
- **On-host stale-cache check:** `grep "<sid>" /var/log/browserstack/prod.log | grep -F "PERCY_REGIONS"` must show the region JSON in the Maestro command's `-e` flags. If absent, the BS device sandbox may have reused a cached copy of the old test suite — investigate before drawing diff-based conclusions.
- On Percy dashboard: the snapshot has the ignore region visibly applied. Run the same flow twice with a time-sensitive element inside the region to verify ignore actually suppresses the diff

**Execution note:** Run this AFTER Unit 3 succeeds to isolate variables. If Unit 3 is green but this fails, the issue is in region handling — not in the overall pipeline.

**Test scenarios:**
- **Ignore region applied:** run 1 and run 2 differ only inside the region → diff = 0% (region successfully excluded)
- **Control:** run 3 without the region → diff > 0% (same content change that was previously masked now shows)
- **Invalid region coords:** coords where `bottom <= top` or `right <= left` → SDK warns and skips; upload still succeeds (existing behavior per our earlier SDK code review)

**Verification:**
- On-host stale-cache check passed (PERCY_REGIONS appears in the Maestro command line for the build's session)
- Two iOS builds with the same app/flow/device differing only in content inside the region produce a zero-diff comparison when region `algorithm: ignore` is active
- A third control build without regions produces a non-zero diff for the same content change, proving the region actually suppressed

---

- [ ] **Unit 5: Louder SDK healthcheck failure message + distinguish CLI-unreachable vs auth-rejected**

**Goal:** Close the silent-failure gap that v0.4.0 would otherwise re-expose during its own partial-rollout window. Make it impossible for a customer to get a green build with zero Percy coverage and no signal.

**Requirements:** R1 (closes the loop — today R1 success depends on customers noticing they have no snapshots; after this unit, the SDK actively tells them)

**Dependencies:** None (independent of Unit 1's outcome — louder logs help whether the bridge is translating yet or not; they are specifically useful during the Outcome-B window)

**Files:**
- Modify: `/Users/arumullasriram/percy-repos/percy-maestro/percy/scripts/percy-healthcheck.js`
- Modify: `/Users/arumullasriram/percy-repos/percy-maestro/percy/scripts/percy-screenshot.js` (emit a one-line warning on each skipped screenshot if `output.percyEnabled === false` — see Approach below)

**Approach:**
- In `percy-healthcheck.js`: when the healthcheck fails, emit a prominent multi-line banner hard to miss in Maestro output. Three mutually exclusive failure paths based on where the error landed in the existing try/catch:
  - **Caught exception** (the script's current `catch (error)` block — covers connection refused, DNS failure, timeout, or any JS runtime error): banner line `[percy] ⚠️  DISABLED — this build will have zero Percy screenshot coverage`, second line `Percy CLI is not reachable at <percyServer>`, third line pointing to docs
  - **`response.ok === false` with 4xx status**: banner line same as above, second line `Percy CLI reachable but authentication/session rejected (<status>)`, third line pointing to docs
  - **`response.ok === false` with 5xx status**: banner line same as above, second line `Percy CLI error (server-side, status <status>)`, third line pointing to docs
  - **Unsupported platform** (existing `maestro.platform !== "android" && !== "ios"` branch): do NOT emit the DISABLED banner. Keep the existing "Percy Maestro SDK supports Android and iOS only" line as-is — the banner's "zero Percy coverage" message is semantically different from "platform not supported" (the latter is a configuration issue, not a runtime failure).
- **Banner lines MUST be hardcoded strings keyed on the failure-path bucket.** Do NOT interpolate `response.body`, response headers, or any server-controlled text into the banner. If including a status code for diagnostics, cast it to an integer first (prevents log-injection / banner-spoofing via crafted upstream responses).
- In `percy-screenshot.js`: when the screenshot step runs but `output.percyEnabled === false`, log a one-line warning per skipped screenshot: `[percy] ⚠️  Skipped "<SCREENSHOT_NAME>" — Percy disabled (see [percy] DISABLED banner above)`. **Note:** GraalJS runs each `runScript` as an isolated evaluation with no flow-complete hook; per-screenshot logging is the only implementable "make it visible in stdout" path. The per-screenshot log is deliberately verbose-but-unmissable rather than a once-per-flow summary (which is not architecturally available).
- Fail-soft posture preserved — no raised exceptions, no flow failures introduced. Pure logging changes.

**Patterns to follow:**
- Existing `console.log("[percy] ...")` format in both scripts — match the prefix for greppability.
- GraalJS constraints: `console.log` takes one argument only (see `/Users/arumullasriram/percy-repos/percy-maestro/CLAUDE.md`). Emit each line as a separate `console.log` call.

**Test scenarios:**
- **Healthcheck connection refused** (CLI not running): caught-exception path → banner + "not reachable" message appear
- **Healthcheck 4xx** (theoretical future — Percy CLI today doesn't 4xx on `/percy/healthcheck`, but if/when that changes): `response.ok === false` path → banner + "auth rejected" message
- **Healthcheck 5xx**: `response.ok === false` path → banner + "server-side error" message
- **Healthcheck 200** (happy path): no banner; existing log lines stay
- **Unsupported platform (web)**: existing platform-allowlist message stays; DISABLED banner does NOT fire
- **Screenshot called with Percy disabled**: `[percy] ⚠️ Skipped "<name>"` warning logs once per skipped screenshot
- **Banner log-injection safety**: upstream response with `\n[percy] OK` in body → banner still shows hardcoded DISABLED lines, no injection surface

**Verification:**
- Pre-flight (~5 seconds): `maestro test --dry-run` against a trivial flow that calls `percy-init` confirms the modified scripts parse in GraalJS without errors
- Manually run a Maestro flow locally (no Percy CLI running) — the DISABLED banner is visible in stdout at a glance; no response-body text in the banner
- Run the same flow with an allowlisted-but-crafted upstream returning multi-line body content → banner is still hardcoded

---

- [ ] **Unit 6: Version bump to v0.4.0 + CHANGELOG**

**Goal:** Mark the customer-visible iOS API-shape change with a minor version bump and a clear changelog entry. Android users get a no-op release.

**Requirements:** R4 (version signaling + release communication)

**Dependencies:** Unit 3 green (never ship a "fix" that isn't proven to fix anything). Also depends on Unit 5 being merged — the louder signal is the mitigation that makes v0.4.0 safe to ship into a partial-rollout world.

**Files:**
- Modify: `/Users/arumullasriram/percy-repos/percy-maestro/percy/scripts/percy-screenshot.js` (the `clientInfo: "percy-maestro/0.3.0"` string)
- Create: `/Users/arumullasriram/percy-repos/percy-maestro/CHANGELOG.md` (new file at repo root, Keep-a-Changelog style)

**Approach:**
- Update the `clientInfo` string from `percy-maestro/0.3.0` to `percy-maestro/0.4.0`
- **CHANGELOG convention chosen now: create `CHANGELOG.md` at repo root using Keep-a-Changelog structure.** No existing convention to follow (verified — `CHANGELOG.md` does not exist today; README has no "Recent changes" section). Start with:
  - `## [0.4.0] — 2026-04-21` entry (top) describing this release
  - `## [0.3.0] — <prior release date>` entry (below) as a single "initial iOS support (superseded by 0.4.0 — iOS required `appPercy` payload change)" bullet to preserve historical signal
- v0.4.0 changelog entry contents:
  - **Breaking for iOS users on v0.3.0:** rename the BrowserStack build-API param from `percyOptions` to `appPercy: {PERCY_TOKEN, env: {...}}` (matches iOS-native Percy convention, per XCUI SDK)
  - Add supported `appPercy.env` pass-through for `PERCY_BRANCH`, `PERCY_PROJECT`, `PERCY_COMMIT` (values reach Percy CLI's environment when it starts)
  - SDK now emits a prominent `[percy] ⚠️ DISABLED` banner when healthcheck fails (Unit 5) — customers can detect the partial-rollout silent-failure mode
  - Android users: no change required; `percyOptions` continues to work
  - Verified on iOS 16.3 and iOS 16.4 via BrowserStack App Automate (link the verification build URLs from Unit 3)
  - **Outcome-B guardrail:** if Unit 1 was Outcome B (bridge not yet deployed fleet-wide), add an explicit "Requires BrowserStack appautomate bridge update — tracked at `<link>`" note; the changelog entry for v0.4.0 should not promise "iOS works now" unconditionally when it actually requires a BS deploy too.

**Test scenarios:**
- N/A (release signaling)

**Verification:**
- `grep -F "clientInfo" percy/scripts/percy-screenshot.js` shows `"percy-maestro/0.4.0"`
- `CHANGELOG.md` exists at repo root with v0.4.0 and v0.3.0 entries
- v0.4.0 entry has concrete before/after curl example for iOS migration
- If Outcome B: changelog entry explicitly states the BS backend dependency

## System-Wide Impact

- **Interaction graph:** BrowserStack `POST /app-automate/maestro/v2/ios/build` → appautomate bridge (translates `appPercy` → `app_percy` hash in realmobile params) → realmobile `/start_maestro_session` → `MaestroSession#start` → `AppPercy::Session#start` → `AppPercy::CLIManager#start_percy_cli` (env-prefixed `percy app exec:start`). This plan depends on the appautomate bridge translation for iOS Maestro — the only non-code unknown.
- **Error propagation:** Fails soft all the way through. `AppPercy::Util.logit ... suppress: true` in `app_percy_session.rb:27` never raises. The SDK's healthcheck catches CLI-unreachable and disables Percy for the flow. Unit 5 adds a prominent `[percy] ⚠️ DISABLED` banner + end-of-flow "0 snapshots uploaded" summary so the failure mode stops being invisible — fail-soft posture preserved (no raised exceptions, no flow failures) but the signal is visible. Auth-rejected (future) is distinguished from CLI-unreachable in the banner.
- **State lifecycle risks:** Unchanged from the prior iOS support plan. Percy CLI per-device port (`5{device_port}`), start after mitm/privoxy boot, stop in `ensure` block of `MaestroSession#stop` and in `ensure_session_stop` before the early-return check.
- **API surface parity:** After this cycle, iOS Maestro uses `appPercy` and Android Maestro uses `percyOptions`. Asymmetric but intentional. Documentation makes the asymmetry explicit.
- **Integration coverage:** Unit 3 + Unit 4 provide iOS E2E coverage. Android E2E is already covered by prior Android work on host `193.186.253.201`.

## Risks & Dependencies

- **HIGH — BS iOS Maestro bridge may not translate `appPercy`.** This is the single blocking unknown. If Unit 1 returns Outcome B, Units 3-4 pause pending a BrowserStack backend change. Mitigation: Unit 1 runs first precisely to surface this early. Escalation path: BrowserStack appautomate team, reference the working XCUI translation as prior art (`example-percy-xcui-swift/README.md:Step 5`). Units 2, 5, and 6 can still land in the Outcome-B branch (docs with "in progress" guardrail + SDK louder-signal + version bump with "requires BS backend change" changelog note).
- **HIGH (security) — `cli_env` uses shell single-quote wrapping; this is a command-injection primitive if any `env` value reaches it from untrusted input.** Acknowledged by security review. Threat model: the `env` hash originates from a customer-controlled payload posted to BrowserStack's public API, crosses the appautomate bridge, and is interpolated into `percy app exec:start KEY='VALUE' ...` on shared BS device infrastructure. A value like `'; attacker-cmd; '` closes the quote, runs arbitrary shell, and re-opens. Compensating control today: BrowserStack's own request validation + tenant isolation. Mitigation for this plan: (a) document the threat-model explicitly (done — here), (b) file a follow-up in realmobile to replace `cli_env`'s string interpolation with argv-array process spawning or `Shellwords.escape`, cross-repo and out-of-scope for this cycle, (c) until (b) lands, realmobile's `cli_env` should conservatively whitelist `env` keys (`PERCY_*`) and validate values against `[A-Za-z0-9._\-]+` before interpolation. Note: per workspace memory, modifications to realmobile outside of changes we introduced are out of scope; this item is a **recommendation for the realmobile team**, not a change this plan makes.
- **MEDIUM — Host `185.255.127.52` state can be reset by automated deploys.** Happened on host `.127.11` earlier this session (realmobile branch reverted to `APS-18773-staging-pwios-nix`). Mitigation: pre-flight checks in Units 1, 3, and 4 verify `@percy/core/dist/api.js` has the `maestro-screenshot` route and realmobile is on the clean feature-branch commit; re-apply overlay or re-checkout branch if state drifted.
- **MEDIUM — Nix overlay could be wiped by a realmobile redeploy.** We're writing into a read-only Nix path via `chmod u+w`. Any nix-store sync or realmobile deploy that rebuilds this derivation removes our patch. Mitigation: re-apply overlay (the tarballs stay on the host; `percy-overlay.tgz` is reusable). The `chmod u+w` is a temporary test-host posture, not a production pattern; before decommissioning the cycle, consider restoring the original 0555 mode on the Nix-store path.
- **MEDIUM — BS device-sandbox may cache re-uploaded test suites.** Unit 4 re-uploads a modified flow zip and expects the new `PERCY_REGIONS` to take effect on-device. If BS caches test-suite contents per bs:// URL on the device sandbox, a trivial yaml edit might not reach Maestro. Mitigation: Unit 4's verification includes an on-host grep for `PERCY_REGIONS` in the Maestro command line for the build's session before drawing diff-based conclusions.
- **LOW — v0.4.0 bump breaks copy-paste migrations for v0.3.0 iOS users.** Mitigation: clear CHANGELOG with before/after curl examples + Unit 5's louder banner so current v0.3.0 adopters notice they need to migrate.

## Documentation / Operational Notes

- **Customer communication:** Blog post or release note highlighting the iOS correction. The "iOS Maestro builds passed but uploaded nothing" failure mode is silent on v0.3.0 (Unit 5 makes it visible starting v0.4.0). **Identify affected population proactively:** query Percy telemetry for orgs with `clientInfo: percy-maestro/0.3.0` on iOS in the last 90 days, and directly notify those account owners with migration instructions **before** or **at** v0.4.0 release. Do not rely on passive adoption signals — the affected population is defined by their inability to see the problem.
- **Monitoring (measures bug closure, not just adoption):**
  - Count of **distinct Percy orgs** uploading iOS Maestro snapshots week-over-week post-release. Target: the count recovers toward (or exceeds) the pre-v0.3.0 baseline.
  - Ratio of iOS Maestro builds with zero snapshots to total iOS Maestro builds, from BS telemetry. Target: ratio trends down.
  - Volume of snapshots tagged `osName: iOS, clientInfo: percy-maestro/0.4.0` — volume should be non-zero within a day or two of release if adoption is starting. (Adoption signal only; not a bug-closure signal.)
  - Cross-reference: for each identified affected org from the proactive query, confirm they show up in the post-release snapshot data. Any that don't are candidates for direct follow-up.
- **Operational discipline — fleet-wide bridge rollout:** Unit 1 is a single-host probe. If the BS appautomate change needs fleet-wide rollout, **confirm deploy status across production iOS Maestro hosts** before public v0.4.0 release. Options if fleet rollout is incomplete at release time: (a) scope v0.4.0 as a beta (use `v0.4.0-rc` or `v0.4.0-beta` labeling) until the bridge is fleet-wide, (b) delay public release, (c) ship with an explicit "iOS Percy Maestro is rolling out by host during {{date range}}" banner in the README.
- **Credential hygiene (applies to every Unit that records a payload in journals/PRs/logs):**
  - **Before capturing any build payload in a PR description or issue comment, redact:** `PERCY_TOKEN` → `<REDACTED>`; BrowserStack basic-auth `username:access_key` → `<REDACTED>`; any customer-provided env value that could be sensitive → `<REDACTED>`.
  - **After the cycle, rotate:** the test `PERCY_TOKEN` used in Units 1/3/4 should be rotated when the cycle completes — it has transited **multiple log sinks**:
    1. Realmobile `prod.log` (inbound POST body on `/start_maestro_session`)
    2. Percy CLI log file at `/var/log/browserstack/percy_cli.<sid>_*.log`
    3. BrowserStack session recording (may capture on-screen/network content)
    4. **Host-level process telemetry** — `cli_env` interpolates `PERCY_TOKEN='<value>'` into the `percy app exec:start` command line, visible in `ps`, `/proc/<pid>/cmdline`, and any host-level audit/process-accounting daemons on the BS shared host
    5. **Realmobile's Maestro-command log entry** — `prod.log` records the full Maestro invocation with `-e` flags; if any PERCY_* env flows through our `percy_env_flags` helper onto that line, it lands here even if POST-body scrubbing works
    6. PR descriptions or chat messages (if not redacted per this checklist)
    7. Operator terminal history (`~/.zsh_history`, `~/.bash_history`) and local terminal scrollback during SSH sessions to the host
  - **Verify realmobile log scrubbing:** before Unit 1 grep of `prod.log`, confirm that realmobile scrubs credential-shaped fields from both POST bodies **and command-line logging**. If it does not, search by `session_id` only and avoid `cat`-ing full bodies or command-line entries; the primary signal (Percy CLI log file presence) does not require reading the body.
  - **Safe artifacts to record:** session id, BS build id, Percy dashboard URL (behind Percy auth), `-e PERCY_SESSION_ID=...` flag (session id only, not a credential). **Unsafe:** the full `appPercy` hash contents, raw `Authorization:` headers, any `env` values containing sensitive data, the full Maestro command line if it contains PERCY_TOKEN env prefix.
  - **Operator SSH hygiene:** when running `ios_ssh` into the host during Units 1/3/4, avoid pasting the PERCY_TOKEN at a shell prompt. Pass it via the BrowserStack build API only. Clear terminal scrollback after the cycle if the token was visible locally.
  - **Host posture:** the `chmod u+w` on the Nix-store path is a temporary test posture. **Plan to restore** `0555` on `@percy/core/dist/` and its parent dirs at cycle teardown (tracked as Task #15 in this session's task list: "Teardown: restore Nix overlay + clean host artifacts"), and to remove the overlay tarballs from `/tmp` on the host. Teardown is not part of v0.4.0 shipping but is mandatory before the cycle is considered closed.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-21-ios-xcui-realignment-requirements.md](../brainstorms/2026-04-21-ios-xcui-realignment-requirements.md)
- **Prior iOS plan (to correct):** [docs/plans/2026-04-20-001-feat-ios-support-plan.md](./2026-04-20-001-feat-ios-support-plan.md)
- **Canonical iOS API shape:** `/Users/arumullasriram/percy-repos/example-percy-xcui-swift/README.md` (Step 5 `curl` example)
- **Realmobile CLI manager (R2 mechanism):** `/Users/arumullasriram/percy-repos/realmobile/lib/app_percy/cli_manager.rb` (lines 19-26, 78-84)
- **Realmobile AppPercy session:** `/Users/arumullasriram/percy-repos/realmobile/lib/app_percy/app_percy_session.rb`
- **Feature branch (already deployed on host 52):** `feat/maestro-percy-ios-integration` at commit `54e2f4839`
- **Host 52 state record:** Nix overlay applied, smoke-tested; `@percy/core/dist/*` + `@percy/monitoring` + `busboy` + `streamsearch` + `systeminformation` installed under `/nix/store/6h379s...node-dependencies-percy-cli-1.30.0/lib/node_modules/`
- **Uploaded test artifacts (reusable for Units 4-5):**
  - App: `bs://fdf0aa75c2ae6d98107027e3949b8c50b0b96419` (`BStackSampleApp.ipa`, bundle id `com.browserstack.Sample-iOS`)
  - Test suite: `bs://a6b9791e9bc227853478895fe1635c09f2901d82` (`iOS-Flows.zip` with fixed-yaml subflows)
- **Memory:** `.claude/projects/-Users-arumullasriram-percy-repos-percy-maestro/memory/project_multipart_test_results.md` (GraalJS sandbox constraints), `feedback_dont_change_other_repos.md` (scope discipline)
