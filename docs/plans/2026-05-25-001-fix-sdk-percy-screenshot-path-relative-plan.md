---
title: "fix: Revert SDK to relative SCREENSHOT_NAME path; drop filePath payload"
type: fix
status: active
date: 2026-05-25
deepened: 2026-05-25
---

# fix: Revert SDK to relative SCREENSHOT_NAME path; drop filePath payload

## Overview

`@percy/maestro-app@1.0.0-beta.2` introduced an "SDK-owns-the-path" mode in `percy-prepare-screenshot.js`: when the running Percy CLI is `≥ 1.31.11-beta.1`, the SDK sets `output.percyScreenshotPath` to an **absolute** path under the BS session root (`/tmp/<sid>_test_suite/percy/<NAME>` on Android, `/tmp/<sid>/percy/<NAME>` on iOS) and forwards that path to the CLI relay as `payload.filePath`.

This works in isolated unit reasoning but breaks on the actual Maestro runtimes shipped with BrowserStack. The **Android** failure mode is verified end-to-end; the **iOS** failure mode is empirically broken at the same gate but the exact mechanism differs and needs the explicit verification carried in Unit 4.

**Android pool (Maestro 1.39.13, and any BS-internal patched derivative thereof — sometimes labelled "1.39.15" in BS internal logs):** `takeScreenshot:` uses Java's `new File(screenshotsDir, suppliedPath)` constructor at [`Orchestra.kt:812-820`](https://github.com/mobile-dev-inc/maestro/blob/cli-1.39.13/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L812-L820). Per [`File(File, String)` Javadoc](https://docs.oracle.com/javase/8/docs/api/java/io/File.html#File-java.io.File-java.lang.String-), when the child pathname is absolute on POSIX, it is **converted to a relative pathname in a system-dependent way** and then joined with the parent. The result on disk: `<SCREENSHOTS_DIR>/tmp/<sid>_test_suite/percy/<NAME>.png` — exactly the doubled path captured in `maestro.log` on 2026-05-24 smoke runs against host `31.6.63.67`. The SDK then sends `payload.filePath = /tmp/<sid>_test_suite/percy/<NAME>.png` to the relay, the relay's realpath check resolves the SDK's path (which doesn't exist), returns `404 Screenshot not found`, and the build fails with `"Snapshot command was not called"`.

**iOS pool (Maestro 2.0.7):** `takeScreenshot:` uses Kotlin's `screenshotsDir.resolve(pathStr).toFile()` at [`Orchestra.kt:943-952`](https://github.com/mobile-dev-inc/maestro/blob/cli-2.0.7/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L943-L952). Per [`Path.resolve(String)` Javadoc](https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html#resolve-java.lang.String-), when `other` is absolute, the method returns `other` **trivially unchanged** — no doubling. By the JDK contract, Maestro 2.0.7 should write the file at exactly the SDK-supplied absolute path, the relay should find it, and the upload should succeed. **But empirically it doesn't** — iOS host `185.255.127.52` with `@percy/core` overlaid to `1.31.15-beta.0` also fails with `"Snapshot command was not called"` until rolled back to `1.30.0`. The most likely actual failure modes (not yet captured live):
- The realmobile wrapper layer (`realmobile/lib/session/`) injects `SCREENSHOTS_DIR` with a path that has additional concatenation downstream of Maestro
- Maestro 2.0.7's iOS driver doesn't `mkdir -p` the SDK's chosen `/tmp/<sid>/percy/` directory before writing → file write fails silently → glob fallback would have rescued it but the SDK sent `filePath`, so the relay short-circuits straight to 404
- The path interpolation `${output.percyScreenshotPath}` in `percy-screenshot.yaml` drops a leading `/` somewhere in the GraalJS→YAML boundary, so Maestro receives a relative path that gets concatenated under `SCREENSHOTS_DIR`

The fix is platform-symmetric and works for any of those iOS failure modes — going back to relative `SCREENSHOT_NAME` sidesteps all of them — but **Unit 4 must capture live `maestro.log` evidence on iOS** to confirm which mechanism is actually firing, so the next person hitting this gets a real diagnostic trail.

This manifests as soon as `bs-nixpkgs` bumps the percy-cli Nix derivation to a release containing PR `cli#2217`. Today both Android and iOS hosts pin `@percy/core@1.30.0`, which fails the SDK's version gate and silently falls back to the legacy relative `SCREENSHOT_NAME` mode — masking the bug. Once the Nix bump lands, every Maestro+Percy build on BrowserStack regresses on day one across both platforms.

The fix: stop trying to override the path. Always use the bare relative `SCREENSHOT_NAME`. Always rely on the CLI relay's existing legacy glob to find the file. Drop the `payload.filePath` field entirely. The relay's `filePath` acceptance code stays in place (no breakage for hypothetical external clients) but is unused by our SDK.

## Problem Frame

- **Affected users:** every Percy-Maestro customer running on BrowserStack App Automate, both Android and iOS, the moment a percy-cli release containing PR `cli#2217` lands in `bs-nixpkgs` and gets deployed to the BS host fleet.
- **Severity:** P0 prod blocker. The symptom is `"Snapshot command was not called"` — i.e., builds appear to pass at the BS layer, but Percy receives zero snapshots, so visual regression coverage silently goes to zero.
- **Surfaced by:** end-to-end smoke runs on host `31.6.63.67` (Android, Pixel 8, Maestro 1.39.13/"1.39.15") and `185.255.127.52` (iOS, iPhone 14, Maestro 2.0.7) on 2026-05-24, after manually overlaying the CLI code + bumping `@percy/core/package.json` to `1.31.15-beta.0` on the host. Repro is fully captured in memory `project-sdk-filepath-prod-blocker`.
- **Root cause (Android):** the SDK's "absolute path" branch hits Maestro 1.39.13's `File(File, String)` constructor at [`Orchestra.kt:812-820`](https://github.com/mobile-dev-inc/maestro/blob/cli-1.39.13/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L812-L820), which by JDK spec converts an absolute child to a relative pathname and joins it with the parent — producing the doubled path observed in `maestro.log`. No Maestro flag opts out of this.
- **Root cause (iOS):** unverified. Maestro 2.0.7's `Path.resolve(String).toFile()` at [`Orchestra.kt:943-952`](https://github.com/mobile-dev-inc/maestro/blob/cli-2.0.7/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L943-L952) should honor absolute paths per JDK spec, yet the iOS host still fails with the same surface symptom. Three live hypotheses (see Problem Frame, Documentation / Operational Notes Unit 4); the fix sidesteps all three. Confirming which one is firing on iOS is a follow-up diagnostic, not a blocker for this fix.

## Requirements Trace

- **R1.** When deployed on BS hosts running Maestro 1.39.13 / 1.39.15 (Android) or 2.0.7 (iOS), the SDK must produce snapshots that the CLI relay finds on disk and uploads to Percy — regardless of whether the host's `@percy/core` reports a pre- or post-`1.31.11-beta.1` version.
- **R2.** No customer-visible YAML change. Customer flows continue to call `runFlow: percy/flows/percy-screenshot.yaml` unchanged.
- **R3.** No change to the CLI relay's incoming request contract for hypothetical external clients (the `filePath` field stays accepted with its existing validation).
- **R4.** No regression in tag-dimension derivation (PNG-header parse in the relay continues to fill `tag.width` / `tag.height` from the screenshot bytes, independent of how the file path is discovered).
- **R5.** Regions (`PERCY_REGIONS`, `PERCY_IGNORE_REGIONS`, `PERCY_CONSIDER_REGIONS`) continue to flow through unchanged.
- **R6.** The change is shipped as `@percy/maestro-app@1.0.0-beta.3` and lands in `bs-nixpkgs` **before** the percy-cli Nix derivation is bumped to a version containing PR `cli#2217`. Sequencing is the load-bearing requirement — once the cli bump lands without this SDK fix, prod is broken.

## Scope Boundaries

- **Out of scope:** Removing the CLI relay's `filePath` request-body handling at `cli/packages/core/src/api.js:375-385`. That field stays accepted; it just becomes unused by our SDK. Removing it is a follow-up cleanup and a breaking API change we don't need.
- **Out of scope:** Teaching Maestro to honor absolute paths. That's an upstream change to `mobile-dev-inc/maestro` — out of our control and not required.
- **Out of scope:** Updating BS host `SCREENSHOTS_DIR` injection logic in `mobile/maestro_runner.rb` / `realmobile/lib/session/`. The current injection already lands at the right legacy-glob-compatible location. Changing it would break the legacy SDK code paths still in customer flows.
- **Out of scope:** Adding JS unit tests for the GraalJS scripts. The scripts run inside Maestro's embedded JVM with `maestro.platform`, `output`, `http`, `json`, `console` globals injected by Maestro — they're not unit-testable outside that runtime. Verification is via BS integration smoke runs.
- **Out of scope:** Changing the version gate semantics for any **other** SDK capability that may be added later. We're removing the absolute-path branch, not the version-gate utility function `coreSupportsFilePath` (which can stay or go — covered below as a decision).

## Context & Research

### Relevant Code and Patterns

- `percy/scripts/percy-prepare-screenshot.js:113-139` — the `canUseFilePath` gate and the broken absolute-path branch.
- `percy/scripts/percy-prepare-screenshot.js:79-99` — `coreSupportsFilePath` version-parse helper; becomes dead code after the fix.
- `percy/scripts/percy-screenshot.js:240-242` — the `payload.filePath = output.percyScreenshotPath + ".png"` send; must be removed.
- `percy/flows/percy-screenshot.yaml:8` — `takeScreenshot: ${output.percyScreenshotPath}`; unchanged. The prepare script's `fallbackName = SCREENSHOT_NAME` default at line 105-106 already produces a valid relative path.
- `cli/packages/core/src/api.js:336-451` — CLI relay's `/percy/maestro-screenshot` route. Two key constraints:
  - Lines `375-385`: relay **rejects** any non-absolute `filePath` with `400`. Confirms we cannot send a relative `filePath`; must drop the field.
  - Lines `444-446`: legacy Android glob is `/tmp/${sessionId}_test_suite/logs/*/screenshots/${name}.png` — no `**`. Means the SDK's relative path must be a **bare** `SCREENSHOT_NAME` (no `percy/` subdir), so Maestro writes the file at the depth the glob expects.
  - Lines `444-446`: legacy iOS glob is `/tmp/${sessionId}/*_maestro_debug_*/**/${name}.png` — uses `**`, so iOS would tolerate a subdir, but we keep the SDK platform-symmetric.
- `CHANGELOG.md:9-25` — `1.0.0-beta.2` entry documents the original intent (SDK owns the path so a host-side `SCREENSHOTS_DIR` change can't silently break the glob). Worth preserving in the new entry: the underlying goal was right, but the implementation didn't survive contact with Maestro's actual `takeScreenshot:` behavior. The fix preserves the prepare-script scaffolding (healthcheck self-init, fallback default) for future re-attempts that don't rely on absolute paths.

### Institutional Learnings

- `docs/solutions/best-practices/` exists but contains no prior solution for this exact failure mode. The prod blocker is documented in `~/.claude/projects/-Users-arumullasriram-percy-repos-cli/memory/project_sdk_filepath_prod_blocker.md` (carry forward as a `docs/solutions/` entry post-merge — see Documentation / Operational Notes).
- The cli#2217 PR description and validation memory `project-unit5-validation-final-state-2026-05-24` both confirm: the iOS PNG-header tag-dim pivot ships fine, and the Android relay code ships fine. This SDK fix is the last gating piece.
- Memory `feedback-percy-regions-apply-silently` is relevant for verification: the Percy comparison API does **not** echo `applied-regions` metadata. Confirm region functionality post-fix by diff-image bitmap inspection, not by API field presence.

### External References

- Maestro `takeScreenshot:` source code, verified via `mobile-dev-inc/maestro` upstream on 2026-05-25:
  - [`Orchestra.kt` at cli-1.39.13, lines 812-820](https://github.com/mobile-dev-inc/maestro/blob/cli-1.39.13/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L812-L820) — uses `new File(screenshotsDir, pathStr)`. Per [JDK `File(File, String)` Javadoc](https://docs.oracle.com/javase/8/docs/api/java/io/File.html#File-java.io.File-java.lang.String-): "If the child pathname string is absolute then it is converted into a relative pathname in a system-dependent way." On POSIX, this **produces the observed doubled path**.
  - [`Orchestra.kt` at cli-2.0.7, lines 943-952](https://github.com/mobile-dev-inc/maestro/blob/cli-2.0.7/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L943-L952) — uses `screenshotsDir.resolve(pathStr).toFile()`. Per [JDK `Path.resolve(String)` Javadoc](https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html#resolve-java.lang.String-): "If the other parameter is an absolute path then this method trivially returns other." On POSIX, this should NOT double the path — meaning the iOS failure mechanism is something other than the Android one (see Problem Frame).
- "1.39.15" is **not a published upstream tag** — the latest 1.39.x release upstream is 1.39.13. The version string seen in BS Android session logs is either a BS-internal patched derivative of 1.39.13 or a misread. Treat it as Maestro 1.39.13-class behavior for this plan.
- No open upstream PR, issue, or RFC offers a "use-this-path-as-is" toggle on `takeScreenshot:`. Adjacent issues exist ([#1280](https://github.com/mobile-dev-inc/maestro/issues/1280), [#1911](https://github.com/mobile-dev-inc/maestro/issues/1911), [#2164](https://github.com/mobile-dev-inc/maestro/issues/2164), [#2535](https://github.com/mobile-dev-inc/maestro/issues/2535)) but none target this exact behavior. Risk R3 in "Risks & Dependencies" stays "future opportunity, not actionable upstream-pin."

## Key Technical Decisions

- **Drop `payload.filePath` entirely; do not send a relative `filePath`.** The CLI relay enforces `path.isAbsolute()` on the field. Sending a relative value would cause the relay to return 400. Sending no field at all routes the relay to the legacy glob path, which works correctly with the BS-infra `SCREENSHOTS_DIR` contract. *Rationale:* matches the constraint the relay already enforces; avoids a parallel breaking change to the CLI.
- **Use bare `SCREENSHOT_NAME` (no `percy/` subdir) as `output.percyScreenshotPath`.** Android's legacy glob has no `**`, so any subdir under `<SCREENSHOTS_DIR>` would put the file out of glob reach. *Rationale:* keeps the SDK platform-symmetric and stays compatible with both the existing Android and iOS legacy globs without requiring a relay change.
- **Keep the `runScript: percy-prepare-screenshot.js` step in the subflow.** The script still does the inline healthcheck self-init (sets `output.percyEnabled` / `output.percyServer` / `output.percyCoreVersion`) — that's useful for the customer-callable subflow contract regardless of the path-mode decision. *Rationale:* preserves the architectural improvement of "prepare runs once per screenshot subflow" even though the path-mode branch is going away.
- **Remove the absolute-path branch, `canUseFilePath` evaluation, `output.percyUsesFilePath` flag, and the `coreSupportsFilePath` helper.** With `payload.filePath` gone and `percyScreenshotPath` always set to the fallback default, none of these pull any weight. *Rationale:* don't leave dead code behind that future readers will misinterpret as a planned re-entry. The version gate utility can be re-introduced cleanly if and when a future SDK capability needs it.
- **Bump `@percy/maestro-app` version to `1.0.0-beta.3`.** Customers (and `bs-nixpkgs`) need a single SemVer pin to bump. *Rationale:* one-step sequencing; `bs-nixpkgs` PRs are easier to review when SDK + CLI move together by version.
- **Sequencing constraint: this SDK release MUST land in `bs-nixpkgs` before the percy-cli derivation is bumped to anything containing PR `cli#2217`.** If `bs-nixpkgs` bumps cli first, the SDK's broken path mode activates in prod. *Rationale:* deployment ordering is the only thing protecting prod right now; capturing this as a hard constraint with documented rollout sequencing in the PR.

## Open Questions

### Resolved During Planning

- **Should we send a "discovery hint" (relative path under SCREENSHOTS_DIR) to the relay so it can read the file directly without globbing?** *Resolved:* no. The relay enforces absolute paths on `filePath`, and we cannot construct a correct absolute path inside GraalJS because `<flow-id>` isn't knowable at SDK runtime. The glob is fast enough and already correct.
- **Should we also remove the CLI relay's `filePath` accept code in `api.js:375-385`?** *Resolved:* no, leave it. Removing it is a breaking change to a hypothetical external client and gives us nothing — the validation cost is negligible.
- **Should we update the Android legacy glob to add `**` for symmetry with iOS?** *Resolved:* no. The current glob works with the bare-name layout. Adding `**` is a CLI change with extra surface area (false matches in Maestro debug frames) and not required for this fix.
- **Should the customer-facing subflow YAML change?** *Resolved:* no. `percy-screenshot.yaml` already references `${output.percyScreenshotPath}` and that variable still gets a valid relative-name default from the prepare script's existing fallback at line 105-106.

### Deferred to Implementation

- **Whether to delete `coreSupportsFilePath` and `output.percyUsesFilePath` or leave them dormant** for a future re-attempt at SDK-owned paths. *Why deferred:* both are reasonable; the implementer should choose based on whether deleting them would force any unrelated downstream cleanup in the BS percy-cli-support tooling. Default: delete them — dead code accumulates risk.
- **Exact `package.json` version string** — `1.0.0-beta.3` is the obvious next step, but if `1.0.0-beta.2` was never actually published to npm, the implementer should reuse `1.0.0-beta.2` instead and republish. *Why deferred:* requires checking `npm view @percy/maestro-app versions` at implementation time.
- **CHANGELOG wording for the regression and the fix.** *Why deferred:* the writer should match the existing voice (see `1.0.0-beta.2` entry).

## Implementation Units

- [ ] **Unit 1: Strip the absolute-path branch from `percy-prepare-screenshot.js`**

**Goal:** Make the prepare script always set `output.percyScreenshotPath` to a bare relative `SCREENSHOT_NAME`. Remove the absolute-path branch, the `canUseFilePath` gate, the `coreSupportsFilePath` helper, and the `output.percyUsesFilePath` flag. Keep the inline healthcheck self-init and the fallback-default behavior intact.

**Requirements:** R1, R2, R4, R5

**Dependencies:** none

**Files:**
- Modify: `percy/scripts/percy-prepare-screenshot.js`

**Approach:**
- Delete the `coreSupportsFilePath` function (lines 74-99) — no remaining caller after the next step.
- Delete the `canUseFilePath` block (lines 113-138) — both branches go away.
- Keep the top-of-`try` defaults (lines 102-107) — `output.percyScreenshotPath = SCREENSHOT_NAME || "percy-screenshot"` becomes the only setter. Delete the `output.percyUsesFilePath = false` line; the flag is gone.
- Keep `runPercyHealthcheckInline()` and its invocation at line 110-111. The script still does the self-init; that's its remaining job.
- Update the file-top header comment (lines 1-21) to reflect the new, narrower responsibility: "Sets `output.percyScreenshotPath = SCREENSHOT_NAME` for the next `takeScreenshot:` step, and self-initializes Percy via the inline healthcheck."

**Patterns to follow:**
- The remaining `try/catch` around the body matches the pattern in `percy-screenshot.js:63-268` — never fail the customer's flow because of Percy bookkeeping.
- The healthcheck function is duplicated across both scripts. Don't deduplicate as part of this fix — that's a separate refactor with its own risk surface.

**Test scenarios:**
- Customer flow with `runFlow: percy/flows/percy-screenshot.yaml` on Android 14 + Maestro 1.39.13 → `output.percyScreenshotPath == "<SCREENSHOT_NAME>"`, file lands at `/tmp/<sid>_test_suite/logs/<flow-id>/screenshots/<NAME>.png`, relay glob finds it, snapshot uploads.
- Same on Android 14 + Maestro 1.39.15 → same outcome.
- Same on iOS 16.4 + Maestro 2.0.7 → file lands at `/tmp/<sid>/<device>_maestro_debug_<id>/<deep-path>/<NAME>.png`, relay glob (which uses `**`) finds it, snapshot uploads.
- Same on a host pinning `@percy/cli@1.30.0` → identical behavior (no version gate to fail; prepare script's output is the same).
- Customer flow with no `PERCY_SESSION_ID` injected → script returns gracefully without throwing; `takeScreenshot:` still runs because `percyScreenshotPath` has a default.
- Customer flow with `SCREENSHOT_NAME` containing only valid `[a-zA-Z0-9_-]` chars but legacy customers using e.g. `My_Login_Screen` → works (no validation regression — the prepare script never validated; that lives in `percy-screenshot.js`).

**Verification:**
- Running `git diff` on the script shows `coreSupportsFilePath` and the absolute-path branch removed, with no other behavior changed.
- The remaining script body is < 50 lines.
- `output.percyScreenshotPath` is set exactly once in the script (in the top-of-`try` default).

- [ ] **Unit 2: Drop `payload.filePath` send from `percy-screenshot.js`**

**Goal:** Remove the `payload.filePath = output.percyScreenshotPath + ".png"` assignment. The CLI relay rejects relative paths and we have no way to produce a correct absolute path; the field must not be sent.

**Requirements:** R1, R3

**Dependencies:** Unit 1 (because `output.percyUsesFilePath` is being removed there)

**Files:**
- Modify: `percy/scripts/percy-screenshot.js`

**Approach:**
- Delete lines 232-242 (the `// filePath: ...` comment block and the `if (output.percyUsesFilePath && output.percyScreenshotPath) { payload.filePath = ... }` block).
- Everything above and below stays — payload still gets `name`, `sessionId`, `tag`, `regions`, `ignoreRegions`, `considerRegions`, etc. The POST shape changes only by omitting the now-unused `filePath` field.
- Sanity-check: no other reference to `output.percyUsesFilePath` or `payload.filePath` anywhere in the file after the edit.

**Patterns to follow:**
- The pre-existing `1.0.0-beta.1` payload shape — recover it from `git show <tag>:percy/scripts/percy-screenshot.js` if you want a byte-level reference for what the on-the-wire payload should look like after the edit.

**Test scenarios:**
- POST to `/percy/maestro-screenshot` from the SDK contains exactly: `name`, `sessionId`, `tag`, `clientInfo`, `environmentInfo`, `platform`, and any of `regions` / `ignoreRegions` / `considerRegions` / `testCase` / `labels` / `sync` / `statusBarHeight` / `navBarHeight` / `fullscreen` / `thTestCaseExecutionId` that the customer set. No `filePath`.
- Relay receives the payload and falls through to the legacy glob path. Glob finds the file. Upload succeeds.
- A region-bearing screenshot still produces a diff image where the masked area is zero-pixel-diff (verify via diff-image bitmap, not API `applied-regions` field — see memory `feedback-percy-regions-apply-silently`).

**Verification:**
- `grep "filePath" percy/scripts/percy-screenshot.js` returns nothing.
- `grep "percyUsesFilePath" percy/` returns nothing across both scripts and the YAML.

- [ ] **Unit 3: Bump version and update CHANGELOG**

**Goal:** Cut `@percy/maestro-app@1.0.0-beta.3` with a CHANGELOG entry that (a) honestly describes the regression introduced in `1.0.0-beta.2`, (b) calls out the rollout-sequencing requirement with `bs-nixpkgs`, and (c) credits the smoke runs that caught it.

**Requirements:** R6

**Dependencies:** Units 1, 2

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

**Approach:**
- `package.json`: change `"version": "1.0.0-beta.2"` to `"version": "1.0.0-beta.3"`. (If `1.0.0-beta.2` was never published, see "Deferred to Implementation" — the implementer may reuse the same version instead.)
- Also update `clientInfo: "percy-maestro-app/1.0.0-beta.2"` at `percy/scripts/percy-screenshot.js:229` to match the new version. This string is sent in every payload for telemetry; keep it accurate.
- `CHANGELOG.md`: add a new `## [1.0.0-beta.3] — 2026-05-25` entry. Match the existing format (Added / Changed / Compatibility sections). Make sure to mention:
  - The doubled-path failure mode Maestro 1.39.x / 2.0.x produces when given an absolute path.
  - That the CLI relay's `filePath` field stays accepted (no breaking change for external clients).
  - The rollout-sequencing requirement: this SDK release must land in `bs-nixpkgs` before any percy-cli release containing PR cli#2217.
- Keep the `1.0.0-beta.2` entry in CHANGELOG untouched — it's history. Don't rewrite it; the new entry supersedes it.

**Patterns to follow:**
- The existing `1.0.0-beta.2` entry in `CHANGELOG.md` lines 9-25 is the voice/structure reference.
- `RELEASING.md` documents the npm publish flow; follow it as-is.

**Test scenarios:**
- `npm view @percy/maestro-app dist-tags` (after publish) shows `beta: 1.0.0-beta.3`.
- The CHANGELOG entry renders correctly on the npm package page.

**Verification:**
- `package.json` version matches the `clientInfo` string in `percy-screenshot.js`.
- `CHANGELOG.md` has a new entry dated 2026-05-25.

- [ ] **Unit 4: BS host smoke validation across Maestro versions**

**Goal:** Prove the fix on real BS hosts across all three relevant Maestro versions, then update the prod-blocker memory and capture a `docs/solutions/` entry so this exact failure mode is grepable for the next person.

**Requirements:** R1, R4, R5

**Dependencies:** Units 1, 2, 3 (the npm package needs to exist so we can either install it locally on the host or pin it in a percy-maestro-bs-overlay).

**Execution note:** This unit is **integration testing on real hardware**, not unit testing. The verification step requires producing valid Percy builds across both platforms — there is no faster harness. The cycle is constrained by the Nomad `code_update` job reverting Android hosts ~hourly (see memory `project-nomad-update-revert-android-hosts`); plan one Android validation pass per cycle.

**Files:**
- Test (manual, not committed): a smoke YAML under `test/` that exercises a known-good calculator/sample app on each platform with both a plain screenshot and a region-bearing screenshot.
- Update: memory file `~/.claude/projects/-Users-arumullasriram-percy-repos-cli/memory/project_sdk_filepath_prod_blocker.md` — mark resolved with the Percy build links.
- Create: `docs/solutions/2026-05-25-sdk-filepath-doubling-on-maestro.md` summarizing the failure mode + the fix + the rollout-sequencing constraint, so the next engineer who sees `"Snapshot command was not called"` plus a doubled-path in `maestro.log` finds this in one grep.

**Approach:**
- On Android host `31.6.63.67`: install `@percy/maestro-app@1.0.0-beta.3` into the mobile clone's `percy-maestro-app` overlay, ensure `@percy/core` is at a version containing PR cli#2217 (overlay manually if `bs-nixpkgs` hasn't bumped yet). Trigger a BS Maestro v2 build with `appPercy` and a flow that takes one plain screenshot + one region-bearing screenshot. Confirm via Percy build that both snapshots uploaded with correct tag dims and the region masked area is zero-pixel-diff in the diff image.
- Repeat on iOS host `185.255.127.52` against Maestro 2.0.7.
- **iOS pre-fix diagnostic capture (separate, before applying the SDK fix):** run one build on iOS with the BROKEN `@percy/core@1.31.15-beta.0` overlay + the current `1.0.0-beta.2` SDK (absolute path mode). Immediately capture `/tmp/<sid>/<*_maestro_debug_*>/maestro.log` before session cleanup. Record the `Taking screenshot to a file: <PATH>` line verbatim. This tells us which of the three iOS failure-mode hypotheses (realmobile wrapper double-concat / missing mkdir-p / YAML-interpolation leading-`/` drop) is actually firing. Append the finding to memory `project-sdk-filepath-prod-blocker` and to the new `docs/solutions/` entry. Without this capture, the iOS root cause stays a hypothesis.
- Audit `percy-maestro-android` sibling SDK (per Risks R6): check out the repo locally, grep for the same absolute-path construction in its prepare script, and document whether a parallel fix is required. If yes, the parallel PR must coordinate with this one — same release window.
- If Android Maestro 1.39.13 is available on a separate host with the upstream-tagged release (vs. BS-internal patched "1.39.15"), repeat there. Otherwise skip — both versions hit Java's `File(parent, child)` constructor in `Orchestra.kt`, which behaves identically; verification on whichever is available is sufficient.

**Patterns to follow:**
- The smoke-run recipe in memory `project-snapshot-not-called-root-cause-2026-05-24` (the package.json version bump trick).
- Restart server recipe in memory `feedback-bs-android-restart-servers-recipe`: `bash -ilc 'restart_servers'` on Android, `zsh -ilc 'restart_servers'` on iOS, from `/usr/local/.browserstack/mobile`. No sudo on git operations (memory `feedback-no-sudo-for-git-on-bs-hosts`).
- Region functionality is verified via diff-image bitmap inspection (memory `feedback-percy-regions-apply-silently`), not via Percy API `applied-regions` metadata.

**Test scenarios:**
- Android + Maestro 1.39.13 (or BS "1.39.15") + CLI containing cli#2217 → no doubled path in `maestro.log`, file lands at `/tmp/<sid>_test_suite/logs/<flow-id>/screenshots/<NAME>.png`, relay glob finds it, Percy build has snapshots with correct tag dims.
- iOS + Maestro 2.0.7 + CLI containing cli#2217 → same end-state on the iOS file layout (`/tmp/<sid>/<device>_maestro_debug_<id>/.../<NAME>.png`).
- Same build trigger, but with the host's `@percy/core` rolled back to `1.30.0` → still works (legacy mode; identical to today's prod).
- Region-bearing screenshot on both platforms → diff image shows masked area as zero-pixel-diff, unmasked area shows expected diff.
- **iOS pre-fix diagnostic build** → `maestro.log` captured live; the `Taking screenshot to a file:` line is recorded verbatim so the iOS failure mechanism is documented, not guessed.

**Verification:**
- A green Percy build with at least 2 snapshots on each platform.
- `maestro.log` from the Percy session shows `Taking screenshot to a file: <SCREENSHOTS_DIR>/<NAME>.png` — single-rooted, no `/tmp/<sid>` doubling.
- iOS pre-fix `maestro.log` line is captured and added to memory + `docs/solutions/` entry, identifying which of the three iOS failure-mode hypotheses was the real cause.
- `percy-maestro-android` audit complete: either confirmed-not-affected or a parallel fix PR is filed.
- Memory `project-sdk-filepath-prod-blocker` updated to "resolved" with links + iOS root-cause correction.
- A new `docs/solutions/2026-05-25-sdk-filepath-doubling-on-maestro.md` exists and is grepable by `"Snapshot command was not called" doubled path` or similar.

## System-Wide Impact

- **Interaction graph:** the change is contained to `percy-maestro-app`'s two GraalJS scripts and its `package.json` / `CHANGELOG.md`. No other repo's code changes. The CLI relay's `/percy/maestro-screenshot` handler keeps both its `filePath`-accept path and its legacy-glob path; we exercise only the glob path going forward.
- **Cross-workspace consumer audit (verified 2026-05-25):**
  - **Producers of `payload.filePath`:** only the SDK file being modified at `percy/scripts/percy-screenshot.js:240-241`, the vendored copy in `example-percy-maestro/flows/percy/scripts/percy-screenshot.js:235-236` (follow-up resync), and a one-off spike test `percy-maestro/test/multipart-file-test.js:51` (not part of SDK runtime; unrelated `multipartForm` exploration). No external SDK constructs the field.
  - **Readers of `payload.filePath`:** only the CLI relay at `cli/packages/core/src/api.js:375-385`. Zero hits in `percy-debug-mcp/`, `percy-cli-support/`, `percy-ops/`, `browserstack-node-agent/`, `percy-api/`. (The unrelated `filePath` references in `percy-cli-support/src/htmlValidator.js` and `browserstack-node-agent/src/bin/**` are local variable names for HTML/Playwright file paths, not Maestro request payloads.)
  - **Readers of `output.percyUsesFilePath` / `coreSupportsFilePath`:** only the percy-maestro SDK itself plus its example-repo vendored copy. Safe to delete.
  - **Test fixtures that pin `filePath` presence:** `cli/packages/core/test/api.test.js:1474-1586, 1702-1710` exercise the relay's `filePath` branch with their own POST bodies — they do NOT depend on the SDK sending the field. Stay green after the SDK fix.
  - **Sibling SDK `percy-maestro-android`:** repo is not checked out in this workspace (referenced in workspace `CLAUDE.md` but absent on disk). **Cannot confirm** whether the sibling SDK has the same absolute-path bug. Treated as a parallel verification task — see Risks R6.
- **Error propagation:** with `payload.filePath` removed, all upload failures funnel through the same legacy-glob "file not found → 404" path that has been in prod since before PR cli#2217. The "Snapshot command was not called" symptom now means "Maestro didn't write the file where the glob expects" — same diagnostic burden as pre-cli#2217.
- **State lifecycle risks:** none new. The screenshot file lives in `SCREENSHOTS_DIR`, which is session-scoped and cleaned up by BS infra at session end. Removing the absolute-path branch removes the per-session `/tmp/<sid>{_test_suite}/percy/` directory the SDK was creating; that directory was never read or cleaned by anything else, so its disappearance is invisible.
- **API surface parity:** the SDK's outgoing payload shape becomes a strict subset of `1.0.0-beta.2`'s payload (only `filePath` is dropped). Verified via the consumer audit above — no telemetry / dashboard impact.
- **Integration coverage:** the CLI's legacy-glob path is already covered by `cli/packages/core/test/api.test.js` and was the only path in prod before PR cli#2217. We're returning the SDK to exercising that battle-tested path. The new-code-path (`filePath`-supplied) in the relay continues to be covered by its own unit tests but is no longer exercised end-to-end by our SDK.
- **Follow-up (non-blocking):** the `example-percy-maestro` repo's vendored copies of `percy-prepare-screenshot.js` and `percy-screenshot.js` need a resync after this SDK release. Not blocking the prod fix — the example repo is docs/tutorial, not a customer-load-bearing surface.

## Risks & Dependencies

- **R1. Rollout-sequencing failure.** If `bs-nixpkgs` bumps the percy-cli derivation before `@percy/maestro-app@1.0.0-beta.3` lands on customer flows, prod regresses. *Mitigation:* ship the SDK derivation bump in its **own** `bs-nixpkgs` PR — separate from any `@percy/cli` pin change. PR description states "Blocks any future @percy/cli pin bump to ≥1.31.11-beta.1; merge + deploy this first." The percy-cli `bs-nixpkgs` bump PR (whenever it's filed) must link this SDK release as a hard prerequisite.
- **R2. Customer flows pinning a specific older SDK version.** If any customer pins `1.0.0-beta.2` explicitly (e.g., in a vendored `node_modules`), they'll regress when the cli bump lands. *Mitigation:* deprecate `1.0.0-beta.2` on npm with a deprecation notice referencing 1.0.0-beta.3. Most customers don't pin; BS distributes the SDK via the host overlay anyway.
- **R3. Maestro could change its `takeScreenshot:` path semantics in a future release.** Maestro 2.0.7 already honors absolute paths on iOS (per JDK contract) — a hypothetical Android Maestro release that switches to `Path.resolve()` would let us re-introduce SDK-owned paths cleanly on Android too. *Mitigation:* none needed today; no upstream PR/issue in flight to change Android Maestro's `File(parent, child)` use (confirmed via upstream issue search 2026-05-25 — see Context & Research). Deleted code can be re-added cleanly if/when this changes.
- **R4. Customers running a Maestro version we haven't tested.** BS pins specific Maestro versions per pool, but a customer running their own Maestro CI outside BS could be on any version. *Mitigation:* `takeScreenshot:`'s path-joining behavior for **relative** paths has been consistent and well-defined across all known Maestro releases since v0 (it joins under `SCREENSHOTS_DIR`); the relative-name approach has worked since v0. We're not introducing new fragility, we're removing it.
- **R5. The "Snapshot command was not called" symptom remains diagnostically opaque.** This fix removes one cause; other causes (e.g., `PERCY_SESSION_ID` not injected, healthcheck failing) produce the same surface symptom. *Mitigation:* none in this PR. Improving the diagnostic surface is a separate task — out of scope here, capture as a follow-up.
- **R6. Sibling SDK `percy-maestro-android` not audited.** Per System-Wide Impact, that repo isn't checked out in this workspace; we cannot confirm whether it has the same bug. *Mitigation:* before this SDK release ships to npm, the implementer checks out `percy-maestro-android`, greps for the same absolute-path construction in its prepare script, and either (a) confirms no fix needed, or (b) files a parallel PR with the same fix and coordinates a joint release.
- **R7. Stale Nix store / mixed-fleet deployment.** BS hosts may cache `/nix/store` paths from prior derivation evaluations. After `bs-nixpkgs` deploys the new SDK derivation, hosts may run a mixed fleet (some on new SDK, some on old) for hours until the Nomad `code_update` job + Nix derivation refresh both converge. *Mitigation:* post-deploy verification samples SDK version on a **stratified sample** of hosts across both Android and iOS pools — not just one host. Block "deploy complete" declaration until both cadences have converged.

## Documentation / Operational Notes

### Rollout: Go/No-Go gates

The deployment is two-step (npm publish → `bs-nixpkgs` derivation bump → host-fleet deploy). Each gate must be green before the next opens.

**Gate 1 — Pre-merge on this SDK PR.** All checks below before squash-merge:
- Diff scope confirmed: only `percy/scripts/percy-prepare-screenshot.js`, `percy/scripts/percy-screenshot.js`, `package.json`, `CHANGELOG.md`. No healthcheck or env-flag changes leaked in.
- `output.percyScreenshotPath` set exactly once, to a relative `SCREENSHOT_NAME`-class string with no leading `/`.
- POST body to `/percy/maestro-screenshot` contains no `filePath` key (grep the rendered script).
- **PR description includes**: Percy build URL on Android + iOS; BS session IDs for both; `percy_cli.log` snippet showing successful snapshot upload (NOT `"Snapshot command was not called"`); `maestro.log` snippet showing the screenshot path is single-rooted (not doubled).
- Smoke test passes against both pre-cli#2217 prod CLI and a local install of cli#2217 head.

**Gate 2 — Pre-publish on npm.**
- `npm pack` artifact inspected; tarball contains patched scripts and version `1.0.0-beta.3` only.
- Fresh `npm install @percy/maestro-app@1.0.0-beta.3` into a scratch Maestro flow → snapshot lands.
- Publish with `--tag beta`, NOT `--tag latest`. Verify `npm dist-tag ls @percy/maestro-app` shows `latest` unchanged.

**Gate 3 — bs-nixpkgs SDK-derivation bump PR (sequencing is the load-bearing constraint).**
- Ship as a **standalone** `bs-nixpkgs` PR. Do not co-mingle with any `@percy/cli` pin change.
- PR description explicitly states: *"Blocks any future @percy/cli pin bump to ≥1.31.11-beta.1. Merge + deploy this first."*
- Reviewer comment links this checklist and PR cli#2217 (the downstream dependency that must wait).
- After deploy: confirm SDK version on a stratified sample of hosts across Android AND iOS pools: `cat /usr/local/.browserstack/mobile/node_modules/@percy/maestro-app/package.json | jq .version` returns `1.0.0-beta.3`.

**Gate 4 — Post-deploy monitoring, 48h window.**

| Signal | Source | Filter | Threshold |
|---|---|---|---|
| Zero-snapshot Maestro builds | Honeycomb (`service.name=percy-api`) | `build.client=maestro` AND `snapshot_count=0`, grouped by `build.id` | Baseline + 2σ over 1h = alert |
| `"Snapshot command was not called"` | BS internal session logs | `framework=maestro` AND `log_source=percy_cli.log` | Any occurrence = page |
| Snapshot upload success rate (Maestro client) | Percy admin dashboard | 1h rolling | < 95% sustained 15 min = page |
| Per-host SDK version drift | BS host inventory | `@percy/maestro-app` version != `1.0.0-beta.3` | Any host on old version after declared-deployed = investigate |

Owner: arumulla@browserstack.com (Percy SDK on-call backup). Cross-post snapshot count to `#percy-maestro` daily for the first 48h.

### Rollback

**Triggers (any one fires):**
- Snapshot upload success rate < 90% for 10 min on Maestro client
- `"Snapshot command was not called"` appears in ≥ 5 distinct BS sessions within 30 min
- Maestro build `snapshot_count=0` rate > 3× pre-deploy baseline over 1h
- Any customer ticket explicitly citing zero snapshots post-deploy

**Procedure (30-min target, accounting for Nomad's ~50-min `code_update` revert cycle):**
1. **0-5 min:** bs-host-local `sed`-patch the two scripts back to a known-good state on the affected host pool. Buys an immediate fix window before Nomad reverts.
2. **0-25 min in parallel:** open a `bs-nixpkgs` revert PR pinning the SDK derivation back to the prior version. Fast-track review.
3. **Bridge the Nomad revert gap:** before the next ~50-min `code_update` cycle hits, either (a) the `bs-nixpkgs` revert is merged + deployed, OR (b) the cli derivation is rolled back to a pre-cli#2217 version. Whichever lands first wins.
4. **Verify recovery:** snapshot upload success rate returns to baseline within 15 min of the derivation redeploy.

### Memory + solutions corpus

- **Update the memory** at `~/.claude/projects/-Users-arumullasriram-percy-repos-cli/memory/project_sdk_filepath_prod_blocker.md` after the fix is verified on BS smoke runs — mark resolved with the Percy build links. Also correct the "Maestro joins SCREENSHOTS_DIR unconditionally" claim in that memory to reflect the per-version Orchestra.kt findings (Android File-constructor double; iOS Path.resolve does NOT double per JDK spec — actual iOS failure mechanism still TBD).
- **Add a `docs/solutions/` entry** at `docs/solutions/2026-05-25-sdk-filepath-doubling-on-maestro.md` capturing: the empirical doubled-path log signature, the JDK `File(File, String)` vs `Path.resolve(String)` contract divergence, the per-version Orchestra.kt source links, and the relative-path fix. So the next engineer who greps `"Snapshot command was not called" doubled path` finds the explanation in one hop.
- **No customer-facing docs change.** The README's installation + usage flow doesn't mention path-mode internals.

## Sources & References

- **Memory: prod-blocker dossier** — `project_sdk_filepath_prod_blocker.md` (the canonical statement of the failure mode and the recommended fix).
- **Memory: companion context** — `project_snapshot_not_called_root_cause_2026-05-24.md`, `project_unit5_validation_final_state_2026_05_24.md`, `project_host_deps_solved_by_cli_bump.md`, `feedback_percy_regions_apply_silently.md`, `feedback_bs_android_restart_servers_recipe.md`, `feedback_no_sudo_for_git_on_bs_hosts.md`.
- **CLI relay code that constrains the fix:** `cli/packages/core/src/api.js:336-451` (the `/percy/maestro-screenshot` handler with the `filePath` absolute-path enforcement and the legacy-glob fallback).
- **SDK files being modified:** `percy/scripts/percy-prepare-screenshot.js`, `percy/scripts/percy-screenshot.js`, `package.json`, `CHANGELOG.md`.
- **Related PR (CLI):** cli#2217 (PNG-header pivot for Maestro tag dims). This SDK fix is a hard rollout prerequisite for the `bs-nixpkgs` bump that follows cli#2217 merge.
- **Companion PRs in the 4-PR bundle** (memory `project-maestro-percy-4pr-bundle`): mobile#13206, realmobile#9840, percy-maestro-app#3 (this fix lands as a follow-up to that #3).
