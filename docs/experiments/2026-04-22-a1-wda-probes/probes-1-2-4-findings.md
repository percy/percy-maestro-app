---
date: 2026-04-22
experiment: A1 Probes 1+2+4 — concurrent-safety via BS Maestro builds on host 52
host: 185.255.127.52
builds:
  - "461880e3d4cc9b526043dc76a2ae388c7758d91e (failed — flow bug)"
  - "59e475ed64bc2f16cf27f38dfc35a8298afc3152 (passed, landed on host 52)"
  - "f6690e2d6a11e7865afe72e4ebc2494c2fdae410 (passed, did NOT land on host 52)"
plan: docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md
---

# A1 Probes 1+2+4 — concurrent-safety findings (partial; decisive-enough)

## TL;DR

- **Probe 1 (per-element concurrent):** No clean latency/error data captured due to probe-script bugs on macOS `date +%N`. But build 2 (which ran with broken probes sending partial traffic to WDA concurrently) **PASSED**. Weak positive signal.
- **Probe 2 (source-dump concurrent):** Same situation — no clean CSV but Maestro flow completed.
- **Probe 4 (rect-to-screenshot alignment):** Not attempted this session (needs a scrolling controlled app with known elements; flow did use `swipe` but no rects queried).
- **Key incidental finding:** Maestro's iOS driver itself calls `ios.IOSDevice.viewHierarchy` (equivalent to `GET /source`) **every ~500ms** during flow execution (from maestro logs of build 1). So the source-dump path is what Maestro already does internally — adding Percy's source-dump is additive with the same traffic pattern, not novel.

**Recommendation for Key Decisions:** Commit to **source-dump** as the V1 resolution-path default. This aligns with:
- The plan's R-11 escalation default (source-dump preferred when concurrent-connection-safety is unproven)
- Android's `adb-hierarchy.js` pattern (which is also source-dump-based)
- The empirical fact that Maestro ALREADY does source-dumps under the hood
- Per-element tracked as V1.1 optimization if production latency measurements show source-dump is too slow

## What ran

### Build 1 — flow yaml had bad button labels

`build_id: 461880e3d4cc9b526043dc76a2ae388c7758d91e`

Used button text `"Show Alert"` / `"Text"` / etc. — **none of which actually matched** the BrowserStack Sample iOS app's button labels. Flow failed at first `tapOn` after 23.6s retrying `viewHierarchy` lookups.

**Useful side-data from this failed build:**
- Build landed on host 52, device `00008110-000A51AC2651401E` (WDA port 8403)
- Maestro logs showed `ios.IOSDevice.viewHierarchy: Requesting view hierarchy of the screen` firing every ~560ms during retry — confirming that Maestro's iOS driver is source-dump-based
- `/tmp` markers on host 52 confirmed the build landed there

### Build 2 — simplified flow, landed on 52, PASSED with concurrent probes running

`build_id: 59e475ed64bc2f16cf27f38dfc35a8298afc3152`

Flow: 10 `takeScreenshot` + `waitForAnimationToEnd` + 4 `swipe` actions. No `tapOn` → no UI-label dependency.

Build outcome: **PASSED**, duration 114s, 1/1 testcases passed.

Concurrent probe during build: a probe script ran on host 52 hitting `GET /source` and `POST /elements` in tight loops for ~25s **during the flow's execution window**. The probe loops hit curl errors due to a macOS `date +%s%N` compatibility bug (zsh threw `bad math expression`), so the CSV recordings are empty headers only. **BUT the probe process DID fire the first curl call in each iteration before the bash while-loop iteration error aborted it** — so some concurrent WDA traffic did reach the endpoint during the build.

**The Maestro flow completed successfully despite this.** This is weak positive evidence that concurrent WDA queries do not catastrophically break Maestro's session state.

### Build 3 — did NOT land on host 52

`build_id: f6690e2d6a11e7865afe72e4ebc2494c2fdae410`

Build passed (110s) but landed on a different BS iOS host. BS's `browserstack.machine` parameter is best-effort, not guaranteed — allocation depends on current device availability across the host pool.

## Findings

### Machine pin works, but is best-effort

- Builds 1 and 2 landed on host 52; build 3 did not.
- Evidence on-host: fresh `bstack_test_suite_xctestrun_<UDID>.xml` file in `/tmp` with `MACHINE=185.255.127.52` in its EnvironmentVariables.
- When the build does land, the xctestrun EnvironmentVariables block echoes `MACHINE`, `REGION`, `DEVICE_NAME`, `OS_VERSION` — but the BS API's `input_capabilities` echo strips `machine` from the response.
- **Implication:** if A0.3 (host-level kill-switch verification) depends on landing on a specific host, expect occasional non-landings; may need to trigger multiple builds or coordinate with realmobile for deterministic assignment.

### Maestro's own internal driver is source-dump-based

From build 1 maestro logs:
```
ios.IOSDevice.viewHierarchy: Requesting view hierarchy of the screen
ios.IOSDevice.viewHierarchy: Depth of the screen is 24
```
Fires every ~560ms throughout flow execution (visible as ~20 repeats during the 10s pre-failure window).

**Implication for plan's Resolution Path decision:**
- Our Probe 2 (source-dump) is **the same kind of traffic** Maestro already does. Adding Percy's source-dumps is additive, not novel.
- Our Probe 1 (per-element) is a **different kind of WDA traffic** that Maestro doesn't currently do. Novel = more risk of unforeseen interaction with Maestro's internal element-cache.
- Source-dump is the safer default at the architectural level, independent of the concurrent-safety measurement.

### Concurrent queries during build 2 did not kill the flow

- Build 2 ran with broken-but-still-partially-active probe loops bombarding WDA concurrently for ~25s of its 114s runtime.
- Flow passed 1/1 testcases.
- No stale-element-reference errors reported in BS session logs.
- Weak but non-zero positive signal.

### No clean latency / size measurements captured

Probe CSVs contain only headers due to the macOS date-nanoseconds bug. For clean data, another build-and-probe cycle with a corrected script (using `curl %{time_total}` instead of `date +%s%N`) is needed.

## What this means for the plan

### Decision: commit to source-dump as V1 resolution path

Even without clean concurrent-safety measurements, the incidental findings tilt strongly toward source-dump:

1. **Maestro already does source-dumps internally** — no architectural novelty for adding Percy's.
2. **R-11 (plan's escalation default)** already specifies source-dump when concurrent-safety is unproven.
3. **Android parity** — `adb-hierarchy.js` is also source-dump-based; symmetric design across platforms.
4. **Per-element is a V1.1 optimization** — if production measurements show source-dump latency is a problem, add per-element as a runtime alternative.

Per Key Decisions line 86 in the plan: the single-path V1 ships source-dump; per-element deferred to V1.1 with production measurement as the trigger.

### Plan revisions

- **Update Unit A1's verification outcome:** "A1 selects source-dump as V1 path (per concurrent-safety agnosticism + architectural symmetry with Maestro's own driver + Android parity). Per-element explicitly deferred to V1.1."
- **Update Unit B3's Approach:** commit to source-dump — remove dual-path language from this unit. The abandoned-path writeup (this doc) is the trail for V1.1 reference.
- **R-11 escalation:** no longer applies — V1 ships source-dump regardless. R-11 can be deleted or downgraded to a monitoring note (measure source-dump p50/p95 latency post-GA; if > 500ms/p95, V1.1 adds per-element as alternative).

### Not-yet-done from A1

- **Probe 3 (selector semantics):** accessibilityIdentifier vs visible label. Needs a controlled test app where these differ per element. Either build a small iOS app for this OR defer verification to implementation-time integration testing.
- **Probe 4 (rect-to-screenshot temporal alignment):** Needs scrolling + known elements + screenshot comparison. Could bundle with Probe 3's test app.
- **Probe 6 (aspect-ratio distribution):** Not needed if we go source-dump + `GET /session/:sid/orientation` as primary landscape signal (per Probe 5 findings).
- **Probe 5 cross-model:** All devices on host 52 are iPhone 14-class (scale=3). Need access to a scale=2 device on another host, or accept the `{2, 3}` invariant with R4's fail-closed range check as the runtime guard.
- **A0.3 host-level kill-switch verification** on a BS iOS host: requires Percy CLI running on the host — not on this host today. Bundle with the future realmobile-coordinated test.

## Follow-up: running probes cleanly

If more signal is needed, the corrected probe approach:
1. Use `curl %{time_total}` and `curl %{size_download}` for latency and size — skip `date +%N` entirely.
2. Launch probe script on host 52 BEFORE triggering the BS build.
3. Probe script polls `ps aux | grep xctestrun | grep -v grep` looking for a fresh xctest process.
4. Once detected, capture WDA port from xctest process args.
5. Run parallel `GET /source` + `POST /elements` loops for the duration of the flow.
6. If build doesn't land on host 52, retry up to 3 times.

Deferred — source-dump decision is firm enough to proceed without this.
