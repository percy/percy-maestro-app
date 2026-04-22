---
title: "feat: Tile + Test Metadata Validation Demos (Demo 3 + Demo 4)"
type: feat
status: completed
date: 2026-04-22
deepened: 2026-04-22
executed: 2026-04-23
origin: docs/brainstorms/2026-04-22-tile-and-test-metadata-validation-requirements.md
---

## Post-Execution Notes (2026-04-23)

Plan shipped, with one material course-correction during execution:

- **Demo 3 pivoted from the deepened two-build design to a single-build feature-forwarding demo.** The original R3/R4 design used a same-branch baseline+compare pair with airplane-mode chrome drift between runs to make `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` ignore-band semantics visible in the Percy diff UI. On mid-execution review this was judged over-engineered for the stated scope — "show that the SDK forwards these v0.3.0 fields to Percy end-to-end." The demo that shipped (Percy build #4 below) is a clean single-build capture of three snapshots, each exercising one field. The deeper ignore-band-visible demo is deferred.
- **`PERCY_LABELS` has a CLI schema gap** uncovered during Demo 4 execution. The SDK forwards `labels: "smoke,home,critical"` correctly per the relay contract, but `percy/core` 1.31.11-beta.0 (deployed on the overlay) rejects it with `Invalid upload options: - labels: unknown property`. Snapshot still uploads, labels silently stripped. Not an SDK bug — needs a percy-core schema update or version bump. Captured in `test/demos/demo-4-test-metadata/notes.md` as a known gap and folded into README's "Under evaluation" row.

**Shipped Percy builds** (host `31.6.63.33:28201FDH300J1S`, device Google Pixel 7 Pro-13.0, project `extraFeatures-fdd21397`):

| Demo | Percy build | BS build id | BS session id |
|---|---|---|---|
| Demo 3 (tile metadata) | [#4](https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49003917) | `7f02db596b25bafa57a1dad059ca2a926d5c99be` | `79faf7c4bfb15ada16e5eaf9be3f3ecb01269003` |
| Demo 4 (test metadata) | [#5](https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49004182) | `b3fd5e8f384ba900ed98949795fbd61888d5b534` | `abdd66e6a35097e175f6ad584a0969becbd56d77` |

Overlay SHA baseline `88f09ee6d3fbe19e727d33bc9aa84551683b1ad7919cc854be6e4cc1ba029ff7` unchanged post-flight — no shared-infra drift introduced.

**Deferred out of this round, surfaced by execution:**

- Ignore-band visible demo (the original two-build Demo 3). Deferred until it's actually customer-needed or asked for.
- `labels` CLI schema gap — file a `cli/packages/core` issue; reference Percy build #5 as evidence.
- `thTestCaseExecutionId` JSON-API confirmation probe — blocked on read-scoped Percy token; write-scoped `app_*` token returned `unauthorized` on `GET /builds/:id/snapshots`. Deferred until admin-token access is available; document-review already established no `percy-api` serializer surfaces the field.

---


# feat: Tile + Test Metadata Validation Demos (Demo 3 + Demo 4)

## Overview

Produce two new reproducible Percy demo builds on BrowserStack Maestro Android, alongside the existing Demo 1 (coordinate regions, Percy build #19) and Demo 2 (element regions, Percy build #20). Demo 3 proves `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` / `PERCY_FULLSCREEN` flow end-to-end and render correctly as ignore-bands in the Percy diff. Demo 4 proves `PERCY_TEST_CASE`, `PERCY_LABELS`, and `PERCY_TH_TEST_CASE_EXECUTION_ID` reach the Percy payload and (where possible) the Percy dashboard. Also split the existing README "Features not supported" section into *Architectural limits* vs *Deferred / on roadmap* so customers comparing SDKs can distinguish can't-build from haven't-built-yet.

This is a validation round, not a feature round. No new SDK code is expected — `percy/scripts/percy-screenshot.js` already forwards every field. The CLI relay at `cli/packages/core/src/api.js:466-478` already handles every field. The work is in constructing the right Maestro flows, dispatching them against the pinned BrowserStack overlay host with correct Percy branch/commit pinning, and committing the reproduction artifacts under `test/demos/` (a new convention for this repo).

## Problem Frame

When a customer or Percy support asks "does `percy-maestro-android` support tile cropping / test-case grouping like the other SDKs?", we need a URL per feature that visibly demonstrates the answer. Regions already have that artifact (Demo 1 build #19, Demo 2 build #20). The remaining v0.3.0 fields are wired through the SDK scripts and the CLI relay but have no comparable demo URL — so the parity answer today is "yes, trust us, the code is there", which is not a deliverable.

This round also produces the first committed *demo* artifacts under `test/demos/`. Demo 1 and Demo 2 lived in `/tmp/demo-1/` and `/tmp/demo-2/` (per memory doc) and were not reproducible after host cleanup. `test/demos/` becomes the durable home for subsequent rounds.

### Customer-facing artifacts

Two Percy build URLs are the product deliverable. Each is legible without narration from an engineer:

- **Demo 3 hero URL.** Open the Percy compare build → 3 snapshots visible. Click `ChromeUnmasked` → status-bar drift between Run 1 and Run 2 (an airplane-mode icon appeared) is flagged as a diff. Click `ChromeMasked` → the same pixel drift is visible but overlaid with the ignore band; it does not count toward the diff. **Takeaway for a customer:** "Set `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` to your device's chrome heights; flaky status/nav bar drift stops showing up as a diff." The third snapshot (`ChromeFullscreen`) is a payload-forwarding check; it has no dashboard signal and is called out as such in `notes.md` so readers do not treat its absence of a diff as confusing.
- **Demo 4 hero URL.** Open the Percy build → filter by test case → two groupings visible (`HomeFlow`, `SettingsFlow`). Click either snapshot → labels appear as split tags (`smoke`, `home`, `critical` shown separately, not concatenated). **Takeaway for a customer:** "Use `PERCY_TEST_CASE` to group snapshots in the Percy dashboard; use `PERCY_LABELS` to tag them; both behave the same as the other Percy SDKs." `PERCY_TH_TEST_CASE_EXECUTION_ID` is a payload-forwarding check only — *the field has no customer-visible rendering surface in Percy today* (verified: no `percy-api` serializer exposes `testhub_testcase_execution_id`); `notes.md` is explicit about this and points TestHub integrators at the CLI debug log for proof.

See origin: [docs/brainstorms/2026-04-22-tile-and-test-metadata-validation-requirements.md](../brainstorms/2026-04-22-tile-and-test-metadata-validation-requirements.md).

## Requirements Trace

Direct mapping to requirements in the origin document:

- **R1** — Tile metadata (status/nav bar heights, fullscreen flag) suppress chrome noise in the Percy diff via ignore-band semantics.
- **R2** — Test metadata (testCase groups, labels split on comma, thTestCaseExecutionId reaches payload) propagates to Percy.
- **R3** — Demo 3 Tile Metadata build: two builds on the same Percy branch, two snapshots per run (`ChromeUnmasked` heights=0 + `ChromeMasked` heights=200/200), deliberate chrome-region pixel drift between runs.
- **R4** — Demo 4 Test Metadata build: single build, ≥2 `testCase` values, `labels` with at least one comma, single `thTestCaseExecutionId`. Dashboard verifies grouping + labels (customer-visible); CLI debug log verifies `thTestCaseExecutionId` payload forwarding (no `percy-api` serializer exposes the field today — pre-resolved during document review; see Key Technical Decisions).
- **R5** — Reproducibility artifacts committed to the repo under `test/demos/<demo>/` — not `/tmp/`. Includes flow YAML, notes with Percy/BS URLs and caption.
- **R6** — README split into *Architectural limits* (with workaround pointers) and *Deferred / on roadmap*.
- **R7** — No SDK code changes assumed. If validation exposes a gap, minimum patch + doc note — not redesign.

## Scope Boundaries

Carried forward from the origin document:

- **Not in scope: Sync mode (`PERCY_SYNC`) demo.** Deferred to a later round; previous 403 is believed unrelated backend behavior.
- **Not in scope: net-new env vars** (`PERCY_IGNORE_ERRORS`, `PERCY_ENABLED`). Appium-equivalent; revisit after this round.
- **Not in scope: `/percy/events` failure telemetry.** Still deferred.
- **Not in scope: BrowserStack `browserstack_executor: percyScreenshot begin/end` session correlation.** Architectural limit — Maestro GraalJS has no Appium driver / `executeScript` surface. README gains a row explaining this; no attempt made here.
- **Not in scope: full-page / scrollable screenshots.** Already documented.
- **Not in scope: SDK or CLI relay code changes** beyond a minimum-patch fix if validation reveals a gap.
- **Not in scope: iOS, POA, XPath, DOM features.** Already documented.
- **Not in scope: committing a BS-dispatch helper script** (e.g., `bin/preflight-host.sh`). The overlay runbook already documents the dispatch flow inline; helper scripts are a separate hygiene round.
- **Not in scope: CI automation of the demos.** Manual dispatch matches existing pattern (`test/e2e-checklist.md`, `test/unit-0-adb-spike.md` are manual checklists).

## Context & Research

### Relevant Code and Patterns

**This repo (percy-maestro-android):**
- `percy/scripts/percy-screenshot.js` — already forwards `statusBarHeight`, `navBarHeight`, `fullscreen`, `testCase`, `labels`, `thTestCaseExecutionId` to the relay. No code change expected.
- `percy/flows/percy-init.yaml` + `percy/flows/percy-screenshot.yaml` — consumer-facing sub-flows. Demos invoke these via `runFlow:` from a parent flow. **Demo flows must not live in `percy/` — that directory is customer-copy-in territory.**
- `test/e2e-checklist.md`, `test/unit-0-adb-spike.md` — existing manual-checklist convention under `test/`. New demos extend this pattern.
- `README.md:237-249` — existing "Features not supported" table; Unit 4 splits this into two sub-sections.
- `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md` — authoritative BrowserStack dispatch runbook (Layer 2 at lines 133-184). Pre-flight check extends this.

**Sibling repo (percy-maestro):**
- `test/multipart-file-test.{yaml,js}` — only precedent for a non-SDK `test/` flow+script pair. Demo layout borrows this naming (flow.yaml + optional .js).

**CLI relay (owned code, no changes planned):**
- `cli/packages/core/src/api.js:466-478` — `/percy/maestro-screenshot` handler already forwards `statusBarHeight`, `navBarHeight`, `fullscreen`, `testCase`, `labels`, `thTestCaseExecutionId`.
- `cli/packages/client/src/client.js:485-492` — `createSnapshot` attaches `th-test-case-execution-id` to the snapshot payload.
- `cli/packages/client/src/client.js:466` — `tagsList(labels)` splits labels on comma.

**Percy API (backend, no changes planned):**
- `percy-api/app/controllers/api/v1/comparisons_controller.rb:96-97` — `ignored_top = tiles.first.status_bar_height`, `ignored_bottom = tiles.last.nav_bar_height`. Confirms ignore-band (not pixel-crop) semantics.
- `percy-api/app/services/percy/ignored_region_service.rb:45-75` — converts heights to full-width ignore rectangles.

### Institutional Learnings

- `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md` — BS `machine:<ip>:<serial>` pinning is mandatory; overlay must live at `/nix/store/*/lib/node_modules/@percy/core/dist/api.js`; `PERCY_COMMIT` must match `/\A[0-9a-f]{40}\z/` or the compare leg aborts. Validated Percy branch pairing: build #25 ↔ #26 on `percy-demo-d1-coord-20260422`, #27 ↔ #28 on `percy-demo-d2-elem-20260422`.
- `docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md` — cross-reference for overlay deployment + `ANDROID_SERIAL` / `MAESTRO_BIN` injection in `cli_manager.rb`. Not load-bearing for this round (no element regions in Demo 3/4) but confirms host state expectations.
- Memory `project_e2e_validation_state.md` — Demo 1 (build #19) + Demo 2 (build #20) live on `/tmp/demo-1/` and `/tmp/demo-2/` and are not committed. New round establishes `test/demos/` as the durable home.
- Memory `project_multipart_test_results.md` — multipart `filePath` uploads fail from GraalJS on BrowserStack; relay is the only upload path. Not affected by this round (no file-handling changes).

### External References

None gathered. Percy CLI / BrowserStack Maestro / Android ADB surfaces are already well-documented in repo artifacts. Topic is operational validation of a known-shipping payload path, not architectural greenfield.

## Key Technical Decisions

- **Demos live at `test/demos/<demo-name>/` — not `percy/demos/`, not `docs/demos/`, not `/tmp/`.** `percy/` is customer-copy-in territory (README:33). `test/` is the existing home for manual-validation artifacts (`e2e-checklist.md`, `unit-0-adb-spike.md`) and matches the sibling's `test/multipart-file-test.{yaml,js}` precedent. `docs/demos/` considered and rejected — demos are runnable artifacts, not narrative docs; the narrative already lives in the memory doc and the solutions runbook.
- **Percy branch/commit pinning via `appPercy.env` with an 8-hex run-token suffix on the branch name.** `PERCY_BRANCH` + `PERCY_COMMIT` + `PERCY_TARGET_BRANCH` on the BS dispatch payload is the institutionally-proven mechanism (build pairs #25/#26 and #27/#28 validated the path). Pairing is driven by `percy-api/lib/percy/base_build_strategy/latest_commit.rb:99-111` — it selects the most recent `finished` non-rejected build on `target_branch` with `id < current_build.id`, with **no commit-level affinity**. That means any concurrent build (another engineer, a retry, a replayed dispatch) on the same branch between Run 1 and Run 2 silently becomes the baseline. Mitigate by suffixing the branch name with an 8-hex run token: Demo 3 uses `percy-demo-d3-tile-20260422-<token8>` where `<token8>` is the first 8 hex of `PERCY_COMMIT` (e.g., `percy-demo-d3-tile-20260422-d3b00000`). Branches are free; isolated lineage eliminates the concurrency hijack. Demo 4 uses the same `-<token8>` suffix even though it's a single run (future-proof + consistency).
- **`PERCY_COMMIT` is a 40-char hex per run, validated by `percy-api/app/models/percy/commit.rb:10`.** Non-hex aborts the compare leg mid-build after BS minutes are already burned. Use `d3b0000000000000000000000000000000aaaaaa` (Demo 3 baseline), `d3c0000000000000000000000000000000bbbbbb` (Demo 3 compare), `d4000000000000000000000000000000aaaaaa00` (Demo 4). Pre-dispatch gate: `echo "<c>" | grep -qE '^[0-9a-f]{40}$'`. `PERCY_COMMIT` does not affect pairing with no VCS integration (we have none); it is used for display/dedup. If a GitHub integration is ever added to the demo project, `percy-api/lib/percy/base_build_strategy/target_commit.rb:78-91` engages and pairing becomes commit-specific — re-validate the plan if that happens.
- **Chrome-region drift via `adb shell` status-bar-only techniques, not Maestro `swipeDown`.** `swipeDown` pulls the notification shade, which covers the top 40-60% of the screen — the resulting pixel drift lands **outside** the 200-px ignore band, which means `ChromeMasked` does NOT suppress it and the demo's thesis breaks. Use one of (in order of preference): (a) **airplane-mode toggle** between runs — adds/removes the airplane icon in the status bar, pure chrome diff, zero body impact; (b) **wifi toggle** — signal-bar icon changes; (c) **`adb shell cmd statusbar disable NOTIFICATION_ICONS`** between runs. All three guarantee pixel drift inside the status-bar band only. Clock advance (≥60s wait) is retained only as a secondary signal, not the primary — it's probabilistic on AA-rendered Pixel 7 Pro fonts and can silently produce sub-pixel diffs that Percy's default threshold classifies as no-diff.
- **Pre-compare-leg chrome-drift dry run.** Before dispatching Run 2, use `adb -s 28201FDH300J1S exec-out screencap -p` to capture two PNGs 60 seconds apart (or one before + one after the status-bar manipulation step above), and pixel-diff the top 200-px band only. If the diff is empty or sub-threshold, switch drift technique before burning a BS compare-leg dispatch. ~30 seconds of adb time per dry run; saves a failed compare leg.
- **Stable-screen invariant is required, not optional.** Demo 3's `ChromeMasked` only cleanly suppresses diff if the *non-chrome* pixels are identical between Run 1 and Run 2. Wikipedia Alpha's home feed rotates (article-of-the-day, prefetch). Demo 3's parent flow must `tapOn`/`navigate` to **Settings** (or equivalent fully-static screen) before the screenshot steps. This was "optional but recommended" in the first plan pass; it is now mandatory.
- **Demo 3 shape: two snapshots per run, both runs on the same Percy branch.** Snapshot `ChromeUnmasked` always uploaded with `PERCY_STATUS_BAR_HEIGHT=0` / `PERCY_NAV_BAR_HEIGHT=0` → flags chrome drift as a real diff. Snapshot `ChromeMasked` always uploaded with heights=200/200 → suppresses the same chrome drift via ignore-band overlays. Side-by-side diff in Run 2 visually proves the feature by showing the same pixel difference rendered two different ways.
- **Demo 3 also exercises `PERCY_FULLSCREEN=true` on one snapshot (`ChromeFullscreen`), verified via CLI debug log only.** The flag has no independent dashboard signal today; its verification is `grep 'fullscreen.*true' <cli.log>` on the host. Not a third diff surface; a lightweight forwarding check that travels with Demo 3.
- **Demo 4 shape: single build, 2–3 snapshots, different `testCase` values.** Dashboard grouping proof = navigating to the Percy build and confirming the test-case filter/grouping. Labels proof = navigating to a snapshot and confirming the split (`smoke,home,critical` becomes three tags). `thTestCaseExecutionId` proof = CLI debug log shows `thTestCaseExecutionId: "TH-DEMO-4-20260422"` in the outgoing payload (primary); Percy snapshot JSON API response confirms it persisted (secondary, if `GET /builds/:id/snapshots` surfaces it).
- **`thTestCaseExecutionId` proof is CLI debug log only; the dashboard/JSON-API investigation is pre-resolved as "no surface exists today."** During document review, a feasibility reviewer grep-traced the field through `percy-api`: it is written to the `test_case_executions.testhub_testcase_execution_id` column (schema.rb:1192) via `percy-api/app/controllers/api/v1/snapshots_controller.rb:168`, but **no serializer exposes it** — not `Percy::SnapshotSerializer`, not `Percy::TestCaseExecutionSerializer`, and `percy-web` has zero references. The ≤1hr Unit 5 investigation is therefore reframed from "find a surface" to "confirm absence as of this date and re-probe only if a percy-api serializer change lands in the interim." Demo 4's `notes.md` is explicit: the payload proof lives in the CLI debug log; TestHub integrators who need a customer-visible surface should track the percy-api serializer gap, not this demo.
- **Pre-flight check reuses the existing `preflight-host.sh` from the overlay runbook, not a narrower grep subset.** The grep-only proposal from the first plan pass would pass while any of the overlay's other four documented failure modes is active: missing `busboy`/`streamsearch` node_modules (multipart parser for tile uploads), missing `computeResponsiveWidths` sed shim on `api.js` (imported from `utils.js`; crashes boot), stale Puma master process (file on disk correct, running code stale), or `cli_manager.rb` patch missing on the mobile repo. The existing script at `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md:219-257` already covers overlay hash + deps-present loop + shim grep + Puma PID + mobile repo. Unit 1 references that script rather than introducing a regression subset. For the two demos in scope here, `adb-hierarchy.js` / `fast-xml-parser` / `strnum` / the mobile-repo `cli_manager.rb` patch are not load-bearing (no element regions), but reusing the full pre-flight keeps the runbook coherent for the next round.
- **README split: two subsections, not two separate files.** Keep all "what isn't supported" content in one README section so customers find it in one place. Use `### Architectural limits (not feasible on this runtime)` and `### Deferred / on roadmap` as clearly labeled sub-headings. Each architectural-limit row that has a workaround gets a one-line pointer.
- **Unit 5 (execution) is gated on Units 1–4.** The demo YAML, notes, and README edits must be final before we burn BrowserStack minutes. This mirrors the prior plan's Unit 7 pattern — validation is always the last unit, never interleaved.

## Open Questions

### Resolved During Planning

- **Where do demo flows live?** → `test/demos/demo-3-tile-metadata/` and `test/demos/demo-4-test-metadata/`. Matches `test/` convention + sibling `test/multipart-file-test.*` precedent. Brainstorm R5 explicitly allowed this.
- **Percy branch pinning mechanism?** → `PERCY_BRANCH` + `PERCY_COMMIT` + `PERCY_TARGET_BRANCH` via `appPercy.env` on the BS build dispatch payload. Branch names include an 8-hex run-token suffix (`-<token8>`) to isolate lineage against concurrent-operator hijack, given that `latest_commit.rb:99-111` has no commit-level affinity. Validated path: build pairs #25/#26 and #27/#28 in the prior round.
- **`PERCY_COMMIT` value format?** → 40-char hex, validated pre-dispatch by `grep -qE '^[0-9a-f]{40}$'`. Non-hex fails `percy-api/app/models/percy/commit.rb:10` regex and aborts mid-compare-leg.
- **Chrome-drift technique?** → Primary: `adb shell` status-bar-only manipulation between runs — airplane-mode toggle preferred (cheapest, most reliable), wifi toggle and `cmd statusbar disable NOTIFICATION_ICONS` as equivalents. `swipeDown` **removed** — it produces drift outside the ignore band and falsifies the demo thesis. Clock advance retained only as a secondary signal, not relied on.
- **How do we know chrome drift is detectable before burning BS minutes?** → Unit 5 runs a short `adb exec-out screencap` dry-run before the compare-leg dispatch, pixel-diffing the top 200-px band to confirm the drift is above Percy's default threshold.
- **Wikipedia Alpha home feed rotation?** → Mitigated by navigating to Settings (stable screen) before any screenshot in Demo 3.
- **Does `PERCY_FULLSCREEN=true` need a dashboard proof?** → No. Its only current observable effect is `fullscreen: true` in the outgoing upload payload. Proof = CLI debug log grep.
- **Should Demo 4 ship even if `thTestCaseExecutionId` has no dashboard surface?** → Yes. CLI debug log proves the field leaves the SDK → reaches the relay → reaches the Percy upload payload. Dashboard surface is a nice-to-have, boxed to ≤1 hour of planning investigation.
- **Pre-flight check shape?** → Reuse the existing `preflight-host.sh` at runbook L219-257 (overlay hash + deps-present + shim + Puma PID + `cli_manager.rb`). A grep-only subset is a regression — it passes while four of five documented failure modes are active.
- **README split format?** → Two subsections in the existing section, not two separate docs. Keeps discovery in one place.
- **Baseline-then-compare safety for Demo 3?** → Pre-dispatch gate for Run 2: `curl` the Percy API and assert exactly one `finished` non-rejected build exists on the run-token-suffixed branch. Catches rejected-baseline trap + concurrent-build hijack before BS minutes are spent.

### Deferred to Implementation

- **Exact wait interval for clock advance on Demo 3.** 60s is the lower bound to guarantee a minute-digit change. First dry run may reveal BrowserStack's Android clock format (12h vs 24h, whether seconds are shown on status bar) and inform the interval. Adjust in `flow.yaml` during first dry run.
- **Whether the Percy snapshot JSON API renders `thTestCaseExecutionId`.** ≤1 hour investigation during Unit 5 execution. If yes → Demo 4 notes record the JSON curl recipe; if no → field goes to R6 Deferred/roadmap subsection in Unit 4.
- **Exact device profile for demos.** Default: same host/device as prior rounds (`31.6.63.33:28201FDH300J1S`). If host is re-imaged between now and execution, may need re-pinning or overlay re-apply — runbook handles this.
- **Whether to keep both demos on the same pinned host or split.** Default: same host for cache/build-throughput simplicity. No technical reason to split.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Demo 3 flow shape (one file, invoked twice with different `PERCY_COMMIT`s; chrome drift is an out-of-flow adb step, not a flow step):**

```
  parent flow: test/demos/demo-3-tile-metadata/flow.yaml
  ┌─────────────────────────────────────────────────────┐
  │ appId: org.wikipedia.alpha                          │
  │ - runFlow: ../../percy/flows/percy-init.yaml        │
  │ - launchApp                                         │
  │ - tapOn: "More"  / tapOn: "Settings"   (REQUIRED —  │
  │     lands on a fully-static screen so non-chrome    │
  │     pixels are identical Run1↔Run2)                 │
  │                                                     │
  │ - runFlow:                                          │
  │     file: ../../percy/flows/percy-screenshot.yaml   │
  │     env:                                            │
  │       SCREENSHOT_NAME: ChromeUnmasked               │
  │       PERCY_STATUS_BAR_HEIGHT: "0"                  │
  │       PERCY_NAV_BAR_HEIGHT: "0"                     │
  │                                                     │
  │ - runFlow:                                          │
  │     file: ../../percy/flows/percy-screenshot.yaml   │
  │     env:                                            │
  │       SCREENSHOT_NAME: ChromeMasked                 │
  │       PERCY_STATUS_BAR_HEIGHT: "200"                │
  │       PERCY_NAV_BAR_HEIGHT: "200"                   │
  │                                                     │
  │ - runFlow:                                          │
  │     file: ../../percy/flows/percy-screenshot.yaml   │
  │     env:                                            │
  │       SCREENSHOT_NAME: ChromeFullscreen             │
  │       PERCY_FULLSCREEN: "true"                      │
  └─────────────────────────────────────────────────────┘

  Run 1 (baseline)              Run 2 (compare)
  ─────────────────            ────────────────────────
  PERCY_COMMIT=d3b00000...    PERCY_COMMIT=d3c00000...
  PERCY_BRANCH=          →    PERCY_BRANCH=
    percy-demo-d3-tile            percy-demo-d3-tile
    -20260422-d3b00000            -20260422-d3b00000
  PERCY_TARGET_BRANCH=        PERCY_TARGET_BRANCH=
    percy-demo-d3-tile            percy-demo-d3-tile
    -20260422-d3b00000            -20260422-d3b00000

  Between runs (out-of-flow, on pinned host):
    adb -s 28201FDH300J1S shell cmd connectivity \
      airplane-mode enable
    (verify via adb exec-out screencap + diff top 200px)
    → status-bar icon changes; drift guaranteed inside
      the ignore band

  Expected Percy diff on Run 2:
    ChromeUnmasked   → diff flags the status-bar band
                       (airplane icon appeared/changed)
    ChromeMasked     → same pixel difference, overlaid with
                       the ignore band; does NOT count toward
                       the diff
    ChromeFullscreen → verified via CLI log only
                       (fullscreen: true in payload)
```

**Demo 4 flow shape (one file, invoked once):**

```
  parent flow: test/demos/demo-4-test-metadata/flow.yaml
  ┌─────────────────────────────────────────────────────┐
  │ appId: org.wikipedia.alpha                          │
  │ - runFlow: ../../percy/flows/percy-init.yaml        │
  │ - launchApp                                         │
  │                                                     │
  │ - runFlow:                                          │
  │     file: ../../percy/flows/percy-screenshot.yaml   │
  │     env:                                            │
  │       SCREENSHOT_NAME: HomeFlow_Landing             │
  │       PERCY_TEST_CASE: HomeFlow                     │
  │       PERCY_LABELS: smoke,home,critical             │
  │       PERCY_TH_TEST_CASE_EXECUTION_ID:              │
  │         TH-DEMO-4-20260422                          │
  │                                                     │
  │ - <navigate to Settings>                            │
  │                                                     │
  │ - runFlow:                                          │
  │     file: ../../percy/flows/percy-screenshot.yaml   │
  │     env:                                            │
  │       SCREENSHOT_NAME: SettingsFlow_Main            │
  │       PERCY_TEST_CASE: SettingsFlow                 │
  │       PERCY_LABELS: smoke,settings                  │
  │       PERCY_TH_TEST_CASE_EXECUTION_ID:              │
  │         TH-DEMO-4-20260422                          │
  └─────────────────────────────────────────────────────┘

  Single run on branch percy-demo-d4-meta-20260422-d4000000.
  PERCY_COMMIT=d400000000000000000000000000000000aaaaaa00

  Expected Percy build:
    - 2 snapshots, grouped under 2 test cases in the dashboard
    - Labels visible on each snapshot (split on comma)
    - thTestCaseExecutionId visible in CLI debug log + snapshot
      JSON (if the API surfaces it); documented either way
```

## Implementation Units

- [ ] **Unit 1: Pre-flight verification + chrome-drift technique spike**

**Goal:** (a) Promote the existing `preflight-host.sh` at `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md:219-257` to a first-class runbook section, capturing overlay-baseline SHA for post-flight comparison. (b) Run a 15-minute on-host spike to pick the chrome-drift `adb shell` command that actually works on the pinned device image — airplane-mode / wifi-toggle / `cmd statusbar disable NOTIFICATION_ICONS` gate on independent permissions and none is pre-validated on `31.6.63.33:28201FDH300J1S` (Pixel 7 Pro, Android 13). Pick the proven one; Unit 2's `notes.md` records it as primary.

**Requirements:** R3, R4 (prerequisite for execution).

**Dependencies:** None.

**Files:**
- Modify: `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md`

**Approach:**

*Part (a) — runbook edits:*
- Add a new top-level sub-section titled "Pre-flight: verify overlay before each demo run" near the start of Layer 2 (before the dispatch payloads).
- Reference the existing `preflight-host.sh` block at L219-257 — do **not** introduce a narrower grep-only alternative. The existing script already checks: overlay file SHAs, four node_modules present (`busboy`, `streamsearch`, `fast-xml-parser`, `strnum`), `computeResponsiveWidths` shim in `api.js`, Puma master PID vs overlay mtime, and mobile-repo branch + `cli_manager.rb` patch. A grep-only subset is a regression — it passes while any of four other documented failure modes is active.
- Add a new "Baseline SHA capture" step immediately after the pre-flight: `ssh <host> 'sha256sum /nix/store/*-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/api.js'` (specific glob matches the runbook's Layer 1 path pin at L101; prevents false positives from other `@percy/core` derivations surviving a Nix GC). Save the result as `OVERLAY_BASELINE_SHA`.
- Document failure branches explicitly:
  - Pre-flight fails → run Layer 1 re-apply runbook, re-run pre-flight, proceed only when green.
  - Co-tenant detected (another `@percy/cli` process active, port 5338 already bound) → either accept co-tenancy risk with explicit ack, or wait for the concurrent session to complete.
  - Layer 1 re-apply during an active Maestro session on host → forbidden; wait for in-flight sessions to finalize before touching overlay files.

*Part (b) — chrome-drift technique spike (15 min on host, one-time):*
- `ssh <host>` (post-pre-flight). Run each of these and screencap before/after (`adb -s 28201FDH300J1S exec-out screencap -p > /tmp/<name>.png`), confirming the status-bar icon changes visibly in each case:
  - `adb shell cmd connectivity airplane-mode enable` (primary candidate)
  - `adb shell svc wifi disable` (secondary)
  - `adb shell cmd statusbar disable NOTIFICATION_ICONS` (tertiary)
- For each command, also run the corresponding "off" command and re-screencap to confirm the icon reverts. The chosen primary is the one that (i) works with the host's `adb` permissions, (ii) produces a visible pixel change inside the top 200 px, and (iii) has a reliable off-switch that restores baseline.
- Record the winner + any permission errors or device-specific quirks in the overlay runbook under "Chrome-drift probe results (YYYY-MM-DD)".
- If **none** of the three commands produces a visible status-bar-region pixel change, stop and re-scope Demo 3 — the ignore-band demo cannot be constructed without some mechanism for deliberate status-bar drift. Unlikely but possible on a locked-down BS image; would feed into the Next Steps overlay retirement ask.

No scripts checked into `bin/` (matches brainstorm scope boundary); all spike results are recorded in the runbook alongside the existing pre-flight block.

**Patterns to follow:**
- The runbook's existing Layer 1 / Layer 2 / Layer 3 structure.
- Existing L219-257 `preflight-host.sh` block.

**Test scenarios:** N/A — docs-only unit.

**Verification:**
- Reader finds the "Pre-flight" block in <30 seconds from runbook top.
- Running the full `preflight-host.sh` against host `31.6.63.33` completes in ≤30 seconds and exits 0 when overlay is healthy.
- `OVERLAY_BASELINE_SHA` capture step is clearly stated and easy to paste into later post-flight checks.
- Chrome-drift technique spike produces a named winner (`airplane-mode` preferred); Unit 2's `notes.md` references the chosen command with no ambiguity.
- Runbook carries a "Chrome-drift probe results" block with screencaps-or-descriptions and any observed permission errors.

- [ ] **Unit 2: Demo 3 — Tile Metadata flow and notes**

**Goal:** Author the Maestro flow and notes doc that, when dispatched twice with different `PERCY_COMMIT` values, produces two Percy builds on the same branch whose diff visibly proves the ignore-band behavior of `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` and forwards the `PERCY_FULLSCREEN` flag through to the CLI.

**Requirements:** R1, R3, R5.

**Dependencies:** None (pre-flight is Unit 5's concern).

**Files:**
- Create: `test/demos/demo-3-tile-metadata/flow.yaml`
- Create: `test/demos/demo-3-tile-metadata/notes.md`

**Approach:**
- **`flow.yaml`:**
  - Header: `appId: org.wikipedia.alpha` (match prior-round app for continuity; change only if that app goes away). Followed by `---`.
  - Step 1: `runFlow: ../../percy/flows/percy-init.yaml`.
  - Step 2: `launchApp`.
  - **Step 3 (REQUIRED, not optional): navigate to Settings** — e.g., `tapOn: "More"` → `tapOn: "Settings"`, or the equivalent deterministic path for Wikipedia Alpha. This lands the flow on a fully-static screen so the non-chrome pixels are identical between Run 1 and Run 2. The home feed rotates (article-of-the-day, prefetch) and contaminates `ChromeMasked` with body-region diffs that the 200-px ignore band cannot suppress. Validate the exact tap sequence against the current APK in a dry run during Unit 5.
  - Step 4: `runFlow: ../../percy/flows/percy-screenshot.yaml` with env `SCREENSHOT_NAME: ChromeUnmasked`, `PERCY_STATUS_BAR_HEIGHT: "0"`, `PERCY_NAV_BAR_HEIGHT: "0"`, device metadata (`PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH`, `PERCY_SCREEN_HEIGHT`) matching the pinned device (Pixel-like or whatever `28201FDH300J1S` reports).
  - Step 5: `runFlow` for `ChromeMasked` with `PERCY_STATUS_BAR_HEIGHT: "200"`, `PERCY_NAV_BAR_HEIGHT: "200"`, same device metadata.
  - Step 6: `runFlow` for `ChromeFullscreen` with `PERCY_FULLSCREEN: "true"`. Forwarding-proof only; diff interpretation lives in the CLI log, not the dashboard.
  - No custom JS script. Everything the demo needs is expressed via env vars on `percy-screenshot.yaml`.
  - **The chrome-drift step does NOT live in `flow.yaml`.** It lives in Unit 5's dispatch procedure (toggle airplane mode on the device between Run 1's finalize and Run 2's dispatch). Keeping it out of the flow keeps the same flow file reusable across Run 1 and Run 2 with only `PERCY_COMMIT` differing.
- **`notes.md`:**
  - Caption (one line): "Demo 3 — Tile Metadata: `ChromeMasked` suppresses status-bar drift that `ChromeUnmasked` flags; `ChromeFullscreen` is a forwarding-only check."
  - Percy branch: `percy-demo-d3-tile-20260422-d3b00000` (baseline) / `percy-demo-d3-tile-20260422-d3c00000` are **the same branch** — the 8-hex run-token comes from the first 8 hex of `PERCY_COMMIT` on Run 1 (`d3b00000`). Both runs share `PERCY_BRANCH=percy-demo-d3-tile-20260422-d3b00000` and `PERCY_TARGET_BRANCH=percy-demo-d3-tile-20260422-d3b00000` so pairing is strictly isolated to this demo round. (Any concurrent operator attempting a Demo 3 of their own uses a different Run 1 commit, yielding a different branch.)
  - `PERCY_COMMIT` values: `d3b0000000000000000000000000000000aaaaaa` (40 hex — baseline) and `d3c0000000000000000000000000000000bbbbbb` (40 hex — compare). Pre-dispatch gate: `echo "<c>" | grep -qE '^[0-9a-f]{40}$'`.
  - Chrome-drift mechanism (between Run 1 finalize and Run 2 dispatch): **`adb -s 28201FDH300J1S shell cmd connectivity airplane-mode enable`** (primary), verify via `adb exec-out screencap` that the status bar shows the airplane icon, then proceed with Run 2. Toggle off after the run to leave the device in a clean state. Alternatives if airplane-mode isn't available on this Android image: wifi toggle (`adb shell svc wifi disable` / `enable`) or `adb shell cmd statusbar disable NOTIFICATION_ICONS`. Swipe-down notification shade is **NOT** a valid technique — produces drift outside the ignore band.
  - Pre-compare-leg dry-run: capture two screencaps via `adb exec-out screencap -p > /tmp/before.png` and `/tmp/after.png` (before and after airplane toggle), pixel-diff the top 200-px band. Confirm the diff is non-empty and visually localized to the status bar before committing to the BS compare-leg dispatch.
  - Dispatch commands: pointer to the runbook's `percy_maestro_build` function plus the specific env vars for Run 1 and Run 2.
  - "What to look at in Percy": URL template + three bullets — one per snapshot. `ChromeUnmasked`: diff flagged in status bar. `ChromeMasked`: same pixel drift, overlaid with ignore band, not flagged. `ChromeFullscreen`: no diff signal; proof lives in host CLI log.
  - Reproduction prerequisites: full `preflight-host.sh` pass, `machine:31.6.63.33:28201FDH300J1S` pinning, test-suite zip must have a single parent folder at root, same `app_url` reused across Run 1 and Run 2 (do not re-upload between runs; a re-upload could pull a newer Wikipedia Alpha APK that introduces non-chrome pixel drift).
- **No script changes.** `percy-screenshot.js` already handles all three env vars.

**Patterns to follow:**
- `test/unit-0-adb-spike.md` for notes-file shape (sections, checklist cadence).
- Sibling `percy-maestro/test/multipart-file-test.yaml` for the parent-flow-invokes-subflow pattern against BrowserStack.
- Existing `percy/flows/percy-screenshot.yaml` env-passing convention.

**Test scenarios (authoring-time validation, before dispatch):**
- Relative path `../../percy/flows/percy-screenshot.yaml` resolves correctly from `test/demos/demo-3-tile-metadata/` (double-check `../..`).
- YAML parses with `maestro --help test <file>` or equivalent offline check.
- `PERCY_COMMIT` values pass `grep -E '^[0-9a-f]{40}$'`.

**Verification:**
- Files exist at the specified paths.
- Notes file contains Percy branch name, both `PERCY_COMMIT` values, caption, dispatch command reference, and "what to look at" block.
- Dispatch is exercised in Unit 5; this unit is artifact-authoring only.

- [ ] **Unit 3: Demo 4 — Test Metadata flow and notes**

**Goal:** Author the Maestro flow and notes doc that produces a single Percy build with ≥2 snapshots covering distinct `PERCY_TEST_CASE` values, comma-containing `PERCY_LABELS`, and a shared `PERCY_TH_TEST_CASE_EXECUTION_ID`.

**Requirements:** R2, R4, R5.

**Dependencies:** None.

**Files:**
- Create: `test/demos/demo-4-test-metadata/flow.yaml`
- Create: `test/demos/demo-4-test-metadata/notes.md`

**Approach:**
- **`flow.yaml`:**
  - Header: `appId: org.wikipedia.alpha` followed by `---`.
  - Step 1: `runFlow: ../../percy/flows/percy-init.yaml`.
  - Step 2: `launchApp`.
  - Step 3: first `runFlow` for `HomeFlow_Landing` with env `PERCY_TEST_CASE: HomeFlow`, `PERCY_LABELS: smoke,home,critical` (explicit comma for split-behavior proof), `PERCY_TH_TEST_CASE_EXECUTION_ID: TH-DEMO-4-20260422`. Device metadata as in Demo 3.
  - Step 4: navigate to Settings (e.g., `tapOn: "Settings"` or similar Wikipedia-Alpha-specific step — verify against app in Unit 5 dry run).
  - Step 5: second `runFlow` for `SettingsFlow_Main` with env `PERCY_TEST_CASE: SettingsFlow`, `PERCY_LABELS: smoke,settings`, same `PERCY_TH_TEST_CASE_EXECUTION_ID`.
  - Optional Step 6: a third snapshot to exercise a third test case if time permits.
- **`notes.md`:**
  - Caption: "Demo 4 — Test Metadata: test-case grouping + labels split on comma visible in Percy dashboard; thTestCaseExecutionId verified via CLI debug log (and snapshot JSON if surfaced)."
  - Percy branch: `percy-demo-d4-meta-20260422-d4000000` (run-token suffix for consistency with Demo 3 and future-proofing against any concurrent-operator collision, even though this is a single run).
  - `PERCY_COMMIT`: `d4000000000000000000000000000000aaaaaa00` (40 hex).
  - Dispatch: same runbook pointer as Demo 3.
  - "What to look at in Percy": dashboard → filter by test case (HomeFlow vs SettingsFlow) → confirm two groupings; open each snapshot → labels visible as split tags.
  - "What to look at in logs": `grep 'thTestCaseExecutionId' <cli.log>` expected to show `"thTestCaseExecutionId":"TH-DEMO-4-20260422"` in the outgoing payload.
  - JSON-API proof (optional/≤1hr): `curl -u <token>: https://percy.io/api/v1/builds/<id>/snapshots` and grep for `th-test-case-execution-id`. If present, document the JSON path; if absent, note as a known gap and add to R6.

**Patterns to follow:**
- Demo 3 notes.md for structure consistency.
- Existing `README.md:100` labels doc line ("comma-separated labels for the snapshot") for user-facing language.

**Test scenarios (authoring-time validation):**
- Relative path resolution verified (same check as Demo 3).
- YAML parses.
- `PERCY_LABELS` value contains at least one comma (split-behavior exercise).
- `PERCY_TH_TEST_CASE_EXECUTION_ID` is a non-empty string.

**Verification:**
- Files exist at the specified paths.
- Notes file has Percy branch, `PERCY_COMMIT`, caption, dashboard verification block, log verification block, optional JSON-API verification block.
- Dispatch is exercised in Unit 5.

- [ ] **Unit 4: README split — Architectural limits vs Deferred/roadmap**

**Goal:** Restructure the existing `README.md` "Features not supported" section into two clearly labeled subsections so customers reading the README can distinguish *can't build on this runtime* from *haven't built yet*.

**Requirements:** R6.

**Dependencies:** None.

**Files:**
- Modify: `README.md` (specifically the "Features not supported" block around lines 237-249).

**Approach:**
- Replace the single table with two subsections under the existing `## Features not supported` heading.
- **Subsection A: `### Architectural limits (not feasible on this runtime)`.** Table with rows for:
  - `browserstack_executor: percyScreenshot begin/end` BS-session correlation — reason: Maestro GraalJS has no Appium driver or `executeScript` surface; the `browserstack_executor:` string is interpreted by Appium, not Maestro. Workaround pointer: match `--build-name` between `percy app:exec` and the BrowserStack Maestro build request; or read `BROWSERSTACK_*` env vars from the Maestro flow. *(Final workaround wording to validate in Unit 5; use best-effort phrasing here.)*
  - `fullPage` / `scrollableXpath` / `scrollableId` / `screenLengths` — existing reason.
  - `freezeAnimations` / `percyCSS` / `enableJavascript` — existing reason.
  - XPath region selectors — existing reason.
  - Percy on Automate (POA) — existing reason.
  - iOS — existing reason.
  - Local `maestro test` runtime — existing reason.
- **Subsection B: `### Deferred / on roadmap`.** Split into two tiers so "next round" and "under evaluation" read differently to customers comparing SDKs:
  - *Planned for the next round* — `PERCY_IGNORE_ERRORS` / `PERCY_ENABLED` kill-switch options. Single-env-var early-returns in `percy-screenshot.js`, ~half-day of work; see follow-up plan `docs/plans/2026-04-23-001-feat-kill-switches-plan.md` (filed as part of this round's commit; target: next sprint). **Interim workaround** (include this line in the README so customers are not blocked): "Unset `PERCY_TOKEN` to disable Percy without code changes; or remove the `percy-init` / `percy-screenshot` runFlow steps from your Maestro flow."
  - *Under evaluation (no committed timeline)* — `/percy/events` failure telemetry; sync mode (`PERCY_SYNC`) validation (implemented in SDK but unproven E2E on BrowserStack — 403 seen in prior round believed to be unrelated backend behavior); `PERCY_TH_TEST_CASE_EXECUTION_ID` dashboard surfacing (payload reaches Percy and Demo 4 proves this, but no `percy-api` serializer exposes `testhub_testcase_execution_id` today; this is a backend/serializer gap separate from the SDK, tracked independently).
- Keep the existing "Links" section and everything after the block unchanged.
- No changes elsewhere in README.

**Patterns to follow:**
- Existing README table style (pipe-delimited, two columns).
- Existing tone (concise, customer-facing).

**Test scenarios:** N/A — docs unit.

**Verification:**
- README renders on GitHub with both subsections under the single "Features not supported" heading.
- Every existing row is preserved (re-categorized, not deleted).
- New rows match the brainstorm's R6 list.
- The executor-correlation row includes a workaround pointer (even if Unit 5 later refines the wording).

- [ ] **Unit 5: E2E demo execution and memory/checklist update**

**Goal:** Run both demos against BrowserStack, capture the resulting Percy + BS build URLs in the project memory doc. `thTestCaseExecutionId`'s lack of a JSON-API/dashboard surface is pre-resolved during document review (Key Technical Decisions) — the demo ships with CLI-debug-log proof only. Unit 5 does a short **confirmation probe** (not an investigation) against the percy-api snapshot JSON to record whether a surface has newly landed since the review; default outcome is "still absent, row stays in Deferred/roadmap."

**Requirements:** R1–R7 (validation only).

**Dependencies:** Units 1–4 complete.

**Files:**
- Create or extend: `test/e2e-checklist.md` (append Demo 3 + Demo 4 sections, matching the Unit 7-style checklist pattern from the prior plan).
- Update: memory doc `project_e2e_validation_state.md` (append "Demo 3 (...)" and "Demo 4 (...)" entries alongside existing Demo 1 / Demo 2 entries).
- Potentially update: `README.md` (R6 row for `thTestCaseExecutionId` — promote or keep deferred based on investigation outcome).

**Approach:**

**Pre-flight gates (ALL must pass before any dispatch):**
- **Gate A — overlay integrity:** run the full `preflight-host.sh` from `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md:219-257`. If any check fails, execute Layer 1 re-apply per the same runbook — **but not while other Maestro sessions are active on the host** (forbidden per Unit 1).
- **Gate B — baseline SHA capture:** `ssh <host> 'sha256sum /nix/store/*/lib/node_modules/@percy/core/dist/api.js && stat -c "%y %s" ...'`. Save as `OVERLAY_BASELINE_SHA` + mtime. Used at post-flight to prove we did not mutate shared infra.
- **Gate C — Percy branch cleanliness:** for each demo branch (run-token-suffixed), `curl -s -u "$PERCY_TOKEN:" "https://percy.io/api/v1/projects/<id>/builds?filter[branch]=<branch>" | jq '.data | length'` → must return `0`. Non-zero = branch collision; rotate to `-v2` suffix before dispatching.
- **Gate D — commit hex validation:** `for c in <three values>; do echo "$c" | grep -qE '^[0-9a-f]{40}$' || echo "FAIL $c"; done`. Any FAIL → fix notes.md and re-read.
- **Gate E — APK identity lock:** upload APK once, record the `app_url` returned by BS. Reuse this exact `app_url` for both Run 1 and Run 2 of Demo 3; do not re-upload between runs (prevents app-store-update drift).

**Demo 3 dispatch:**
- Zip `test/demos/demo-3-tile-metadata/` + referenced `percy/` subtree into a test-suite zip with a single parent folder at root.
- Upload test-suite via documented `curl`. App is the `app_url` from Gate E.
- **Run 1 (baseline):** POST Android build with `machine: "31.6.63.33:28201FDH300J1S"`, `appPercy.env` containing `PERCY_TOKEN`, `PERCY_LOGLEVEL=debug`, `PERCY_BRANCH=percy-demo-d3-tile-20260422-d3b00000`, `PERCY_TARGET_BRANCH=percy-demo-d3-tile-20260422-d3b00000`, `PERCY_COMMIT=d3b0000000000000000000000000000000aaaaaa`. Wait for BS build to reach `done`, then poll Percy API until Run 1 is `finished`. Record Percy build # + BS build id + session id.
- **Chrome-drift step between runs (with guaranteed cleanup):** on the pinned host, wrap the airplane-mode toggle in a restore-on-exit trap plus an `at`-scheduled backstop so a dropped SSH session or aborted dispatch cannot leave the shared device stuck in airplane mode:
  ```
  SERIAL=28201FDH300J1S
  # Primary restore: unconditional on script exit or signal
  trap 'adb -s $SERIAL shell cmd connectivity airplane-mode disable || true' EXIT INT TERM
  # Backstop: restores after 30 min even if the trap doesn't fire (SSH drop)
  echo "adb -s $SERIAL shell cmd connectivity airplane-mode disable" | at now + 30 minutes
  adb -s $SERIAL shell cmd connectivity airplane-mode enable
  # ... proceed with Run 2 dispatch ...
  ```
  (Exact command is the winner from Unit 1's drift-technique spike; substitute wifi toggle or `cmd statusbar disable NOTIFICATION_ICONS` if the spike named a different primary.)
- **Drift verification dry-run:** `adb -s 28201FDH300J1S exec-out screencap -p > /tmp/before.png` pre-toggle, `/tmp/after.png` post-toggle. Crop to the top 200 px and pixel-diff using the first available tool in this fallback chain, documented in Demo 3 notes:
  1. **ImageMagick `compare`:** `compare -metric AE -extract 1080x200+0+0 /tmp/before.png /tmp/after.png null: 2>&1` — expected: AE count > 100 (clearly non-zero).
  2. **Python + Pillow fallback:** `python3 -c "from PIL import Image, ImageChops; a=Image.open('/tmp/before.png').crop((0,0,1080,200)); b=Image.open('/tmp/after.png').crop((0,0,1080,200)); print(ImageChops.difference(a,b).getbbox())"` — expected: non-None bbox.
  3. **scp-and-eyeball fallback:** `scp <host>:/tmp/before.png /tmp/after.png ./ && open *.png` — visually confirm the icon change.
  Pick whichever tool is installed (ImageMagick usually not on Nix-managed BS hosts; Python 3 + Pillow usually is). If none, fall through to eyeball. If drift is empty or sub-threshold, switch to the spike's secondary technique and re-verify before dispatching Run 2.
- **Pre-Run-2 gate (rejected-baseline trap):** `curl ...?filter[branch]=percy-demo-d3-tile-20260422-d3b00000 | jq '.data[] | {state, "review-state": .attributes."review-state"}'` → must show exactly one build with `state: finished` and `review-state != rejected`. If not, investigate before dispatching Run 2.
- **Run 2 (compare):** identical dispatch to Run 1 but with `PERCY_COMMIT=d3c0000000000000000000000000000000bbbbbb`. Wait for finalize. Record URLs. Toggle airplane mode off after the run to leave the device clean.
- **In-flight overlay sentinel:** every 2 minutes during Run 2, `ssh <host> 'sha256sum ...'` must equal `OVERLAY_BASELINE_SHA`. A mismatch mid-run = another process mutated shared infra; pause and investigate before trusting Run 2's result.
- **Open Percy build** and confirm: `ChromeUnmasked` flags the status-bar drift as a diff; `ChromeMasked` shows the same pixel drift but overlaid with the ignore band (does not flag); `ChromeFullscreen` uploads without a diff signal (proof lives in the host CLI log).
- **Grep CLI debug log:** `grep 'fullscreen.*true' <percy.log>` on host → shows payload with `fullscreen: true` from the `ChromeFullscreen` snapshot.

**Demo 4 dispatch (single build):**
- Package `test/demos/demo-4-test-metadata/`. Re-run Gates A–D for Demo 4's branch (Gate E not needed — single run).
- Dispatch with `PERCY_BRANCH=percy-demo-d4-meta-20260422-d4000000`, `PERCY_TARGET_BRANCH=percy-demo-d4-meta-20260422-d4000000`, `PERCY_COMMIT=d4000000000000000000000000000000aaaaaa00`. Keep the in-flight overlay SHA check running.
- On finalize: Percy dashboard shows two test-case groupings (`HomeFlow` + `SettingsFlow`); opening each snapshot shows labels split on comma as separate tags.
- Grep CLI debug log: `grep 'thTestCaseExecutionId' <percy.log>` → `"thTestCaseExecutionId":"TH-DEMO-4-20260422"` appears twice.
- **JSON-API confirmation probe (5 min, not 1 hour):** document review pre-resolved that no `percy-api` serializer exposes `testhub_testcase_execution_id` as of 2026-04-22. Run `curl -u "$PERCY_TOKEN:" https://percy.io/api/v1/builds/<id>/snapshots | grep -i 'testhub\|th-test-case\|th_test_case'` to confirm absence on the day of execution (in case a percy-api change landed in the interim). If absent (expected): R6 row stays in Deferred/roadmap. If unexpectedly present: update Unit 4's R6 row to "Supported (payload + JSON API; no dashboard surface)" and record the exact JSON path in memory doc.

**Mid-run abort handling (the half-pair problem):**
- **Run 1 aborts before finalize:** safe — re-dispatch with same `PERCY_COMMIT`; Percy dedupes by commit on the same branch.
- **Run 1 finalized but Run 2 aborts:** Percy has **no customer-facing build-delete API** — the stale Run 1 cannot be removed. Options: (a) if the failure was transient, re-dispatch Run 2 unchanged; Run 1 is still the baseline, demo still valid; (b) if substantive (overlay corrupted, flow bug), rotate to `-v2` branches (e.g., `percy-demo-d3-tile-20260422-d3b00000-v2`) and redo; document the orphaned Run 1 in memory doc with a `[SUPERSEDED]` tag.
- **Overlay SHA drifts mid-run:** pause, do not start the next dispatch. Let any in-flight BS session finalize or time out. Re-run Gate A + Gate B; re-apply Layer 1 **only after all concurrent Maestro sessions on host have quiesced**.

**Post-flight (after Demo 3 AND Demo 4 complete):**
- **P.1 — Overlay post-flight SHA:** `ssh <host> 'sha256sum ...'` must equal `OVERLAY_BASELINE_SHA`. Unchanged = we did not corrupt shared infra. Changed = document under a new institutional learning in memory doc ("pinned host overlay is not as stable as previously assumed"); either re-verify or redo on `-v2` branches.
- **P.2 — Memory doc append:** add Demo 3 + Demo 4 entries to `project_e2e_validation_state.md` matching the Demo 1 / Demo 2 style (Percy URL, BS build id, BS session id, caption, branch name with run-token).
- **P.3 — Checklist append:** extend `test/e2e-checklist.md` with Demo 3 + Demo 4 sections (dispatch → finalize → expected visual outcome → CLI log grep → overlay SHA match).
- **P.4 — notes.md URL backfill:** fill in actual Percy build URLs in both `test/demos/*/notes.md` files (replacing `TBD` placeholders from Units 2/3).
- **P.5 — Conditional README update:** if Demo 4 JSON-API investigation surfaced `thTestCaseExecutionId`, update Unit 4's README row; otherwise leave deferred.
- **P.6 — Cleanup:** expire the BS test-suite upload (delete `test_suite` id) to avoid accidental re-dispatch; record any `-v2` branches created during abort recovery in memory doc.

**Patterns to follow:**
- Prior plan's Unit 7 E2E approach (manual checklist, memory-doc URL ledger).
- Existing memory-doc entry style for Demo 1 / Demo 2 (see `project_e2e_validation_state.md:130-139`).

**Test scenarios:**
- Pre-flight grep returns expected matches before either dispatch.
- Demo 3 Run 2 diff visibly distinguishes `ChromeUnmasked` (chrome-drift flagged) vs `ChromeMasked` (chrome-drift suppressed under ignore overlay).
- Demo 3 CLI log shows `fullscreen: true` in the `ChromeFullscreen` upload payload.
- Demo 4 Percy dashboard shows two test-case groupings and per-snapshot labels.
- Demo 4 CLI log shows `thTestCaseExecutionId` in outgoing payload.
- No behavior regression on the SDK side — existing users running flows without any of these env vars see no change. *(Implicit: confirmed via the fact that `percy-screenshot.js` only reads these env vars when defined and non-empty; any regression would indicate an SDK code change, which this plan explicitly forbids.)*

**Verification:**
- All checklist items in `test/e2e-checklist.md` (new Demo 3 + Demo 4 sections) pass.
- Memory doc `project_e2e_validation_state.md` has Demo 3 + Demo 4 entries with Percy + BS URLs.
- `notes.md` files in both `test/demos/demo-3-*` and `test/demos/demo-4-*` directories are updated with the actual Percy build URLs (replacing "TBD" placeholders from Units 2/3).
- Unit 4's README either reflects a promoted `thTestCaseExecutionId` row (if a surface was found) or retains the deferred row with a memory-doc cross-reference.

## System-Wide Impact

- **Interaction graph:** The demos exercise the SDK → CLI relay → Percy backend path that ships to customers today. They do not add new code paths, but they do pin branch lineage server-side. If the branch `percy-demo-d3-tile-20260422-d3b00000` or `percy-demo-d4-meta-20260422-d4000000` already exists in Percy's project history, Demo 3's baseline may unexpectedly diff against whatever snapshot currently holds that branch. Mitigation: (a) Gate C (pre-dispatch) asserts zero prior builds on the target branch; (b) run-token branch suffix isolates each demo pair from any concurrent operator (see Risk 7); (c) Unit 5's half-pair abort playbook rotates to `-v2` if recovery is ever needed.
- **Error propagation:** If dispatch fails (wrong `machine:` pin, test-suite zip parse error, overlay missing), the brainstorm and runbook both document the symptoms. Unit 5 runs under the existing manual-checklist contract; failures re-enter the checklist with known-failure branches, no silent skipping.
- **State lifecycle risks:** The pinned-host overlay is shared across all demo rounds. Unit 5 may trigger a re-apply if the pre-flight check fails; that re-apply affects every other user of the host until the overlay is again updated by a future round. Not a new risk — documented in the runbook.
- **API surface parity:** No changes to the SDK or CLI relay. The README split is purely customer-facing documentation — it does not change what the SDK *does*, only what it *says it does not do*.
- **Integration coverage:** Demo 3 is the first end-to-end exercise of tile-metadata semantics on BrowserStack Maestro. Demo 4 is the first end-to-end exercise of test-metadata fields. Neither replaces automated CI — they are reproducible manual artifacts.

## Risks & Dependencies

**Risk 1 — Pinned-host overlay absent at execution time.**
- Probability: moderate. Every demo round has so far required overlay maintenance; accumulating dependency is a known concern (brainstorm Follow-up item).
- Impact: Demos silently drop tile/test metadata — `/percy/maestro-screenshot` 404s or the relay handler pre-dates the fields.
- Mitigation: Unit 1 makes the full `preflight-host.sh` check a required step. Unit 5 invokes it explicitly before either dispatch. If empty, run the full overlay re-apply runbook (existing, in the solutions doc).

**Risk 2 — Chrome drift lands outside the 200-px ignore band, or is sub-threshold, invalidating Demo 3's thesis.**
- Probability: moderate. Clock advance produces sub-pixel AA drift on Pixel 7 Pro that Percy's default threshold may classify as no-diff. The original `swipeDown` fallback was actively broken — it lands drift in the top 40-60% of the screen, *outside* the 200-px ignore band, which means `ChromeMasked` does NOT suppress it and the demo's thesis inverts.
- Impact: Demo 3 fails in one of two ways: (a) no visible diff on either snapshot, proving nothing; (b) `ChromeMasked` flags the diff (because drift is outside the ignore band), which is the opposite of what the demo claims.
- Mitigation:
  - Primary drift technique is `adb shell cmd connectivity airplane-mode enable` — pure status-bar icon change, pixel drift guaranteed inside the ignore band.
  - Fallback techniques (`adb shell svc wifi disable`, `adb shell cmd statusbar disable NOTIFICATION_ICONS`) are equivalent status-bar-only. `swipeDown` is **forbidden**.
  - Unit 5 runs a pre-compare-leg `adb exec-out screencap` dry-run and pixel-diffs the top 200-px band before dispatching Run 2. If the diff is empty or sub-threshold, switch technique before burning BS minutes.
  - Stable-screen invariant: Demo 3's flow always navigates to Settings before any screenshot, removing home-feed rotation from the non-chrome pixels.

**Risk 3 — `PERCY_COMMIT` validation failure mid-compare-leg.**
- Probability: low if the commit values pass the pre-dispatch `grep -E '^[0-9a-f]{40}$'` check. High if a human typo slips through.
- Impact: baseline leg completes and consumes BS minutes; compare leg aborts mid-build; no diff; minutes wasted.
- Mitigation: the `PERCY_COMMIT` values in Unit 2 / Unit 3 notes are 40-char hex by construction. Unit 5 checklist includes an explicit "validate hex" step before dispatch.

**Risk 4 — `thTestCaseExecutionId` has no customer-visible rendering anywhere.**
- Probability: moderate. Payload demonstrably reaches Percy (verified via CLI client code), but dashboard surface is unconfirmed.
- Impact: Demo 4 can only prove "payload reaches Percy" via log / JSON — weaker signal than regions demos.
- Mitigation: pre-resolved during document review — no `percy-api` serializer exposes the field as of 2026-04-22. Demo 4 ships with CLI-debug-log proof only. Unit 5 runs a 5-minute confirmation probe to record whether the gap has closed server-side, but does not block on it.

**Risk 5 — BrowserStack host re-provisioning between Unit 1 and Unit 5.**
- Probability: low-moderate, not under our control.
- Impact: pre-flight check fails; Unit 5 must run the full overlay re-apply runbook before dispatch, adding 30-60 minutes of SSH/SCP work.
- Mitigation: runbook is already written; this is a cost, not a blocker. Memory doc captures the deploy steps. Follow-up item (brainstorm) tracks retiring this dependency when `@percy/cli` main includes the overlay code.

**Risk 6 — Labels split-on-comma misrendering in the Percy dashboard.**
- Probability: low. `tagsList(labels)` at `cli/packages/client/src/client.js:466` is clean split-on-comma; server rendering should preserve it.
- Impact: Demo 4 labels appear as one concatenated tag instead of three, weakening the demo.
- Mitigation: CLI debug log still proves the split happened client-side; any backend rendering issue is documented in the Demo 4 notes and filed as a separate ticket, not as a Demo 4 failure.

**Risk 7 — Concurrent-build lineage hijack on the demo branch.**
- Probability: moderate. The Percy pairing algorithm at `percy-api/lib/percy/base_build_strategy/latest_commit.rb:99-111` selects the most recent `finished` non-rejected build on the branch with `id < current_build.id`, with **no commit-level affinity**. If any other build (another engineer, a retry, a replayed dispatch, a stale open BS tab) finalizes on the same branch between Run 1 and Run 2, *that* build silently becomes the baseline, not Run 1. The dated branch name (`percy-demo-d3-tile-20260422`) protects against prior-round collisions but not concurrent-round collisions.
- Impact: Demo 3 Run 2 diffs against the wrong baseline; visible output appears to prove something unrelated to tile metadata, or shows spurious "already accepted" behavior.
- Mitigation:
  - Branch names carry an 8-hex run-token suffix (first 8 hex of Run 1's `PERCY_COMMIT`, e.g., `-d3b00000`). Branches are free; each demo pair lives on its own isolated lineage.
  - Gate C (pre-dispatch): assert `.data.length == 0` on the target branch before Run 1 dispatches.
  - Pre-Run-2 gate: assert exactly one `finished` non-rejected build exists on the branch before dispatching Run 2 (also catches the rejected-baseline trap).

**Risk 8 — Shared-infra overlay mutation during our dispatch window.**
- Probability: low-moderate. The `@percy/core` overlay at `/nix/store/.../node_modules/@percy/core/` is read by every Percy Maestro session that lands on host `31.6.63.33`. BrowserStack may re-image, Nix may GC, or another engineer may apply a different overlay concurrent with our run.
- Impact: (a) our dispatch silently produces bogus results if the overlay loses the tile/test-metadata handling; (b) if *we* re-apply during another session's in-flight Maestro run, we corrupt that other session.
- Mitigation:
  - Gate B (pre-flight) captures `OVERLAY_BASELINE_SHA`; in-flight sentinel re-checks every 2 minutes; post-flight P.1 verifies the SHA is unchanged — demo is only trustworthy if the overlay is byte-identical start-to-end.
  - Layer 1 re-apply is forbidden while any Maestro session is active on the host. Wait for all in-flight sessions to quiesce before touching overlay files. Unit 1 documents this rule.
  - If overlay drift is detected post-flight, document under a new institutional learning in memory doc and redo demos on `-v2` branches.

**Risk 9 — Mid-run abort on Run 2 leaves a half-pair that cannot be deleted.**
- Probability: low per run, but unrecoverable when it happens.
- Impact: Percy has no customer-facing build-delete API. If Run 1 finalizes and Run 2 aborts for a substantive reason (overlay corruption, flow bug), the stale Run 1 stays on the branch and future attempts at the same `PERCY_COMMIT` pair against it — potentially misleadingly.
- Mitigation:
  - Unit 5 documents an explicit mid-run abort playbook: Run 1 aborts before finalize = safe re-dispatch with same commit; Run 1 finalized + Run 2 transient abort = retry Run 2; Run 1 finalized + Run 2 substantive abort = rotate to `-v2` branches, tag orphaned Run 1 in memory doc with `[SUPERSEDED]`.
  - `-v2` rotation cost is cheap (new branch = isolated lineage per Risk 7 mitigation); cost is cosmetic (orphaned build visible in Percy project history).

## Documentation / Operational Notes

- README split (Unit 4) is the only user-facing doc change.
- Pre-flight check (Unit 1 — the full `preflight-host.sh`) is internal-only — extends an internal runbook.
- Unit 5's `notes.md` edits (filling in actual Percy URLs) are internal-only but discoverable by anyone with repo access.
- Memory-doc append (Unit 5) is internal-only; the memory doc is not in `percy-maestro-android` — it lives at `~/.claude/projects/-Users-arumullasriram-percy-repos-percy-maestro/memory/project_e2e_validation_state.md`.
- No migration; no feature flag; no rollback plan. Failing a demo means "the demo didn't work, investigate"; the SDK continues to function for existing users regardless.

## Next Steps

Concrete follow-ups filed as part of this plan's commit — not deferred bullets, real tickets:

- **File `cli` ticket: mainline the Maestro overlay.** Every demo round extends the pinned-host dependency; customers literally cannot reproduce these demos on their own BrowserStack tenant because they cannot apply the overlay. File a GitHub issue against `cli` requesting that the overlay patches land in `cli/packages/core/src/api.js` (specifically the `/percy/maestro-screenshot` handler at L466-478), along with the `busboy` / `streamsearch` / `fast-xml-parser` / `strnum` dependencies and the `computeResponsiveWidths` shim from the runbook's Layer 1 file list. Name an owner on the CLI team and tie retirement to Demo 5 ("Demo 5 must not require the overlay"). **Owner for filing:** the engineer executing this plan. **Ticket title suggestion:** "cli/core: mainline Maestro-screenshot relay + host overlay so percy-maestro-android does not require host pinning."
- **File `percy-api` ticket: optional commit-affinity or explicit baseline pinning for `BaseBuildStrategy::LatestCommit`.** The run-token branch suffix in this plan works around `percy-api/lib/percy/base_build_strategy/latest_commit.rb:99-111` — the pairing logic has no commit affinity, so concurrent builds on the same branch hijack each other's baseline. File a product ask for either (a) a new strategy that prefers exact-commit match on the same branch before falling back to latest-id, or (b) an explicit `previous_build_id` parameter on the build-create API. Reference this plan's Risk 7 as the motivating case. **Owner for filing:** same engineer; file after Unit 5 completes so we cite the actual-demo branch pair as evidence.
- **File follow-up plan: `docs/plans/2026-04-23-001-feat-kill-switches-plan.md` for `PERCY_IGNORE_ERRORS` + `PERCY_ENABLED`.** Scope: single-env-var early-returns in `percy-screenshot.js`; README additions; one integration-test screenshot. Target: next sprint. This plan's Unit 4 references the follow-up plan path by name in the README's Deferred/roadmap subsection, so the path must land before or alongside Unit 4 ships.

None of these are in-scope for the current plan's Units 1–5 — they are tracked artifacts that land alongside this plan to give customer-facing deferrals weight and start the clock on retiring the pinned-host dependency.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-22-tile-and-test-metadata-validation-requirements.md](../brainstorms/2026-04-22-tile-and-test-metadata-validation-requirements.md)
- **Prior plan (completed):** [docs/plans/2026-04-21-001-feat-sdk-feature-parity-plan.md](./2026-04-21-001-feat-sdk-feature-parity-plan.md)
- **BrowserStack dispatch + overlay runbook:** `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md` (Layer 1 deploy, Layer 2 dispatch, Layer 3 evidence)
- **Element-region resolver follow-up (cross-reference for overlay state):** `docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`
- **SDK script:** `percy/scripts/percy-screenshot.js` (already forwards all fields — verified during brainstorm)
- **CLI relay:** `~/percy-repos/cli/packages/core/src/api.js:466-478`
- **Percy client snapshot payload:** `~/percy-repos/cli/packages/client/src/client.js:485-492` (thTestCaseExecutionId path) and `:466` (labels split)
- **Percy API ignore-band semantics:** `~/percy-repos/percy-api/app/controllers/api/v1/comparisons_controller.rb:96-97`, `~/percy-repos/percy-api/app/services/percy/ignored_region_service.rb:45-75`
- **Percy API pairing logic (load-bearing for Demo 3 two-build diff strategy):**
  - `~/percy-repos/percy-api/app/services/percy/base_build_service.rb:213-220` — `ideal_branch_strategy` (resolves to `:target` when `target_branch` is set).
  - `~/percy-repos/percy-api/app/services/percy/base_build_service.rb:231-238` — `active_strategy` precedence chain (`manual_diff_base → target_commit → merge_base_commit → latest_commit`).
  - `~/percy-repos/percy-api/lib/percy/base_build_strategy/latest_commit.rb:99-111` — `BranchStrategy#latest_build` SQL (branch-filtered, no commit affinity).
  - `~/percy-repos/percy-api/lib/percy/base_build_strategy/target_commit.rb:78-91` — commit-specific path (engages only with VCS integration; dormant here).
  - `~/percy-repos/percy-api/app/models/percy/project.rb:329-331` — `allowed_base_build_states` (project setting affects whether waitable in-flight builds count as pairing candidates).
  - `~/percy-repos/percy-api/app/models/percy/commit.rb:10` — `[0-9a-fA-F]{40}` SHA regex that aborts a build mid-compare-leg if `PERCY_COMMIT` contains non-hex chars.
- **Overlay file dependency reference:** `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md:85-130` (Layer 1 file list) and `:219-257` (existing `preflight-host.sh` reused by Unit 1).
- **Institutional learnings (auto-memory):** `project_e2e_validation_state.md` (Demo 1 / Demo 2 URLs + prior overlay deployment evidence), `project_maestro_repo_split.md`, `project_multipart_test_results.md`.
- **Existing demo builds to link alongside:** Demo 1 Percy build #19 `https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48975403`; Demo 2 Percy build #20 `.../builds/48975492`.
