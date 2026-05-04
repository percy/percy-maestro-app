---
date: 2026-04-22
topic: tile-and-test-metadata-validation
---

# Tile Metadata + Test Metadata Validation & Demos

## Problem Frame

When a customer or Percy support asks "does `percy-maestro-android` support tile cropping / test-case grouping like the other SDKs?", we need a URL per feature that visibly demonstrates the answer. Regions already have that artifact (Demo 1 build #19, Demo 2 build #20). The remaining v0.3.0 fields are wired through the Maestro scripts and the CLI relay (`cli/packages/core/src/api.js:466-478`), but there is no comparable demo URL for them — so the parity answer today is "yes, trust us, the code is there," which is not a deliverable.

This round produces the missing demo URLs for two feature tracks: **tile metadata** (system-chrome noise suppression in the Percy diff) and **test metadata** (test-case grouping, labels, and test-harness correlation in the Percy dashboard). Internally, the demos also serve as the first end-to-end verification that the fields survive the full SDK → CLI relay → Percy backend path on a real BrowserStack Android session.

### Env-var ↔ payload field mapping

| Maestro env var | Outgoing relay field | Persisted field |
|---|---|---|
| `PERCY_TEST_CASE` | `testCase` | `testCase` on snapshot |
| `PERCY_LABELS` | `labels` (comma-separated string) | `tagsList` on snapshot (split by `,`) |
| `PERCY_TH_TEST_CASE_EXECUTION_ID` | `thTestCaseExecutionId` | `th-test-case-execution-id` on snapshot |
| `PERCY_STATUS_BAR_HEIGHT` | `statusBarHeight` | `ignored_top` full-width rectangle on comparison |
| `PERCY_NAV_BAR_HEIGHT` | `navBarHeight` | `ignored_bottom` full-width rectangle on comparison |
| `PERCY_FULLSCREEN` | `fullscreen` | `fullscreen` flag on tile (no visible diff effect unless heights are also set — see R3) |

## Requirements

- **R1. Tile metadata suppresses chrome noise in the Percy diff.** On a BrowserStack Android session, non-zero `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` cause Percy to treat the corresponding top/bottom pixel bands as ignored regions in the comparison — real pixel differences inside those bands do not count toward the diff. The raw screenshot pixels are unchanged; only the diff ignores those bands. `PERCY_FULLSCREEN=true` is a tile flag that currently has no independently visible diff effect; it is covered as a forwarding check, not a separate demo surface (see R3).
- **R2. Test metadata propagates to Percy.** `PERCY_TEST_CASE` groups snapshots under that test case in the Percy dashboard. `PERCY_LABELS` surfaces on the snapshot (at least one demo value must contain a comma so the split-on-comma behavior is exercised). `PERCY_TH_TEST_CASE_EXECUTION_ID` reaches the Percy snapshot payload; its verification point (dashboard surface vs. raw `GET /builds/:id/snapshots` JSON vs. BrowserStack Test Observability correlation) is unresolved — see R4 scope note.
- **R3. Demo 3 — Tile Metadata build.** A single Percy project with two consecutive builds on the same Percy branch (`demo-3-tile-metadata` or equivalent, explicitly passed via `--branch` to both runs so Run 2 diffs against Run 1). Each build takes **two snapshots** per run: `TileMeta_ChromeUnmasked` (always uploaded with `PERCY_STATUS_BAR_HEIGHT=0` / `PERCY_NAV_BAR_HEIGHT=0`) and `TileMeta_ChromeMasked` (always uploaded with large heights, e.g., 200 / 200 px). Between Run 1 and Run 2 the flow deliberately triggers real chrome-region pixel drift — e.g., screenshots captured 60 s apart so the status-bar clock advances, or navigating to a screen where system notification icons differ. Expected result in Run 2's diff view: `TileMeta_ChromeUnmasked` flags the chrome bands as changed pixels, while `TileMeta_ChromeMasked` shows those same pixel differences overlaid with the Percy "ignored region" mask and therefore does not flag them. Side-by-side, these two snapshots prove the ignore-band behavior. Additionally, the `PERCY_FULLSCREEN=true` flag is exercised on at least one snapshot and verified via CLI debug log (not via dashboard diff), since it has no independent visible signal today.
- **R4. Demo 4 — Test Metadata build.** One Percy build on BrowserStack with 2–3 snapshots spanning at least two distinct `PERCY_TEST_CASE` values, `PERCY_LABELS` values including at least one comma-separated list (e.g., `smoke,home,critical`), and a single `PERCY_TH_TEST_CASE_EXECUTION_ID`. Percy dashboard visibly shows test-case grouping and labels on each snapshot. `PERCY_TH_TEST_CASE_EXECUTION_ID` is verified via `GET` on the Percy snapshot JSON API (or the Percy CLI debug log showing the payload) — **not** via dashboard rendering, because no customer-visible rendering surface has been confirmed. If a dashboard surface is found during planning, the demo is upgraded; otherwise the JSON-level proof stands and the field's dashboard-visibility status is added to R6.
- **R5. Reproducibility artifacts checked into the repo.** Each demo commits its Maestro flow YAML under `docs/demos/` (or `test/demos/`, chosen during planning) — not `/tmp`, so the demo stays reproducible after the host workspace is cleaned. Alongside each flow, the memory/activity log records: Percy build URL(s), BrowserStack build/session ID(s), a one-line caption of the form "*Demo N (Feature): what to look at in Percy — link*" suitable for a support-facing walkthrough, and any non-obvious re-run prerequisites (e.g., the `--branch` value for Demo 3, the chrome-drift mechanism used).
- **R6. README split into "Architectural limits" and "Deferred / on roadmap".** The existing `README.md` "Features not supported" section is split into two clearly labeled subsections so customers can distinguish *can't do this* from *haven't done this yet*:
  - **Architectural limits (not feasible on this runtime):** `browserstack_executor: percyScreenshot begin/end` BS-session correlation (Maestro GraalJS has no Appium driver / `executeScript` surface; equivalent correlation would need a BrowserStack Maestro-runner infra change, not an SDK change); full-page / scrollable capture (existing); XPath region selectors (existing); iOS (existing); POA (existing); DOM-specific features (existing); local `maestro test` runtime (existing).
  - **Deferred / on roadmap:** `PERCY_IGNORE_ERRORS` / `PERCY_ENABLED` kill-switch options; `/percy/events` failure telemetry; sync mode (`PERCY_SYNC`) validation (implemented but unproven E2E); `PERCY_TH_TEST_CASE_EXECUTION_ID` dashboard surfacing (payload reaches Percy; no confirmed customer-visible rendering).
  - For each "Architectural limits" entry that has a workaround, include a one-line pointer. For BS-session correlation specifically: note that customers needing Percy ↔ BrowserStack-session correlation today can match the BrowserStack build name to the Percy build name (both are set by `percy app:exec --build-name`), or read `BROWSERSTACK_*` env vars from the Maestro flow. If no workaround exists, say so explicitly.
- **R7. No SDK code changes assumed.** Fields are already present in `percy-screenshot.js` and `api.js`. If validation exposes a missing or broken field, the scope is a minimum patch plus a note in the requirements — not a redesign.

## Success Criteria

- Two new reproducible Percy builds (Demo 3 + Demo 4) linked alongside Demo 1 / Demo 2 in the memory doc `project_e2e_validation_state.md`.
- Each demo includes a one-line "this is what the feature does, look here in Percy to see it" caption suitable for a customer-facing walkthrough.
- Every v0.3.0 environment variable except `PERCY_SYNC` has at least one demo covering it (`PERCY_REGIONS` via Demo 1/2, tile-metadata vars via Demo 3, test-metadata vars via Demo 4).
- Any field that fails to propagate through the deployed CLI overlay is logged with a root cause and either fixed inline or captured as a named follow-up with the exact file and field that needs changing.

## Scope Boundaries

- **Not in scope: Sync mode (`PERCY_SYNC`) demo.** Deferred to a later round; previous session saw a 403 we believe is unrelated backend behavior. Revisit after these two demos ship.
- **Not in scope: `PERCY_IGNORE_ERRORS` / `PERCY_ENABLED` net-new env vars.** Appium-equivalent config; add only after the current parity is fully validated.
- **Not in scope: `/percy/events` failure telemetry.** Still deferred from the v0.3.0 parity brainstorm.
- **Not in scope: BrowserStack `browserstack_executor: percyScreenshot begin/end` correlation.** Not feasible from Maestro GraalJS — Maestro has no Appium driver or `executeScript` surface through which the `browserstack_executor:` string is interpreted. Implementing equivalent BS-session tagging would require a BrowserStack Maestro-runner infra change (similar to how `ANDROID_SERIAL` injection had to live in `cli_manager.rb`), not an SDK change. Flag for BrowserStack mobile team; do not attempt from this repo.
- **Not in scope: full-page / scrollable screenshots.** Explicitly excluded; Maestro's pattern is explicit scroll steps + separate screenshots.
- **Not in scope: SDK code changes beyond a minimum-patch fix if validation reveals a gap.**
- **Not in scope: iOS, POA, XPath, DOM features.** Already documented as not applicable in README.

## Key Decisions

- **Validate, don't extend.** The v0.3.0 parity brainstorm already shipped the port; this round turns that port into proof. No new env vars, no new handler logic — we are buying confidence, not surface area.
- **One Percy build per track.** Matches the Demo 1 / Demo 2 pattern so support and customers can point to a single URL per feature.
- **Tile metadata is ignore-band behavior, not pixel cropping.** `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` tell the Percy backend to treat top/bottom bands as ignored regions in the diff. The raw screenshot is unchanged. Demo 3 is designed around this reality: it introduces real pixel drift in chrome bands between Run 1 and Run 2 and then shows that `ChromeMasked` suppresses the diff there while `ChromeUnmasked` flags it. Without deliberate chrome-band drift there is no diff to suppress and no demo.
- **Two-build design with explicit Percy-branch pinning.** Both runs pass `--branch=demo-3-tile-metadata` (or equivalent override) to `percy app:exec` so Run 2 diffs against Run 1 on the same lineage. Without this, BrowserStack's branch inference can split the two runs into independent lineages and Run 2 opens with no comparison.
- **Asymmetric demo shape is intentional.** Demo 3 needs two builds because its proof is a pixel-level diff; Demo 4 needs one because its proof is dashboard metadata. Same principle (show the feature as Percy renders it), different artifact.
- **`PERCY_FULLSCREEN` proven via debug log, not dashboard.** The flag is forwarded end-to-end, but has no independent customer-visible diff effect when `statusBarHeight` / `navBarHeight` are 0. Verifying it means grepping the CLI debug log for `fullscreen: true` in the upload payload, not asking the Percy UI to render something.
- **`thTestCaseExecutionId` proven via snapshot JSON, not dashboard.** Dashboard surface is unconfirmed; Demo 4 uses the Percy snapshot JSON API response (or CLI debug log) as the signal. If a dashboard surface is found during planning, the demo is upgraded.
- **BrowserStack session pinning still required.** Use the `machine:<ip>:<serial>` capability when dispatching the demo builds so they land on the overlay host (per memory doc — scheduler otherwise picks random hosts without the Percy overlay).
- **Pre-flight check is a concrete runbook step.** Before each demo run, SSH into the pinned host and `grep -n "statusBarHeight\\|navBarHeight\\|thTestCaseExecutionId" /nix/store/…/node_modules/@percy/core/dist/api.js` to confirm the overlay lines are present. If the host has been re-provisioned, re-apply the overlay from cli branch `feat/maestro-multipart-upload` (deployment steps captured in prior E2E memory doc). Exact command sequence is finalized during planning.
- **R6 split: architectural limits vs roadmap.** Customers reading the README must be able to distinguish "can't build" from "haven't built yet" — the two classes of exclusion get different sub-sections, and architectural limits include a workaround pointer where one exists.

## Dependencies / Assumptions

- Deployed CLI overlay on host 31.6.63.33 (or successor) still includes the `maestro-screenshot` handler at `api.js:466-478` with tile/test metadata forwarding. Verify before Demo 3 runs.
- `ANDROID_SERIAL` + `MAESTRO_BIN` env injection in mobile repo's `cli_manager.rb` remains in place on the pinned host (same production wiring the regions demos used).
- Wikipedia Alpha (`org.wikipedia.alpha`) or equivalent BrowserStack-compatible Android app remains available; `testsuite/` zip layout and parent-folder quirk from the E2E memory still applies.
- Percy dashboard surfaces `testCase` as a grouping dimension and `labels` as snapshot metadata — to be confirmed during planning via the Percy web UI.

## Outstanding Questions

### Resolve Before Planning

_(none — P0 ambiguities from the first review pass have been reworked into R1–R6 directly)_

### Deferred to Planning

- [Affects R3][Technical] Exact chrome-drift mechanism for Demo 3: rely on status-bar-clock advance between runs (simplest), inject a deliberate overlay via a Maestro `swipe`/`tapOn` that reveals different chrome content, or use a pull-down notification shade between runs. Pick whichever gives the most reliably-different chrome pixels across runs.
- [Affects R3][Technical] Maestro `runFlow` env scoping: confirm via one throwaway dry-run that passing different `PERCY_STATUS_BAR_HEIGHT` values per `runFlow` invocation actually scopes them to that invocation only. If env vars leak across sub-flow invocations, restructure into separate sub-flow files per variant.
- [Affects R4][Needs research] Is there any customer-visible dashboard surface for `thTestCaseExecutionId`? A one-hour poke at a Percy staging build + TH-linked BrowserStack build would answer this definitively. If yes, Demo 4 upgrades to dashboard proof; if no, JSON-API proof stands and the limitation goes into R6's "Deferred / on roadmap" subsection.
- [Affects R3][Operational] Exact pre-flight bash command to verify the overlay on host 31.6.63.33. Candidate: `ssh <host> 'grep -n "statusBarHeight\\|thTestCaseExecutionId" /nix/store/*/lib/node_modules/@percy/core/dist/api.js | head'`. Finalize during planning along with re-apply runbook if the check fails.
- [Affects R6][Needs research] Concrete workaround phrasing for the BS-session correlation limit. Candidates: matching `--build-name` between `percy app:exec` and the BrowserStack Maestro build request; reading `BROWSERSTACK_BUILD_ID` / session ID from Maestro flow env. Confirm one works end-to-end before putting it in the README.

## Next Steps

→ `/ce:plan` for structured implementation planning.

### Follow-up (out of scope for this round, but track)

- **Retire the pinned-host overlay dependency.** Each new demo round adds another artifact that silently breaks if host 31.6.63.33 is re-provisioned. Track when `cli` branch `feat/maestro-multipart-upload` lands in `main` + ships in a published `@percy/cli` release, after which overlay-pinning is no longer required. Until then, pre-flight checks stay mandatory.
