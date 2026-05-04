---
title: Android view hierarchy resolver SIGKILLed by uiautomator lock during live Maestro flows
date: 2026-04-22
problem_type: integration_issue
component: tooling
root_cause: wrong_api
resolution_type: code_fix
severity: high
category: integration-issues
tags:
  - maestro
  - android
  - uiautomator
  - view-hierarchy
  - adb
  - grpc
  - percy-cli-relay
  - sigkill
  - browserstack
  - element-regions
---

# Android view hierarchy resolver SIGKILLed by uiautomator lock during live Maestro flows

## Problem

Percy Maestro SDK's element-based region resolver (`PERCY_REGIONS` with `{"element": {...}}` selectors) needs to fetch the Android view hierarchy during an active Maestro flow on BrowserStack to compute pixel bounding boxes. The initial CLI-side implementation shelled out to `adb exec-out uiautomator dump /dev/tty`. It passed 27 unit tests against fixture XMLs and worked when invoked from a host shell on an idle device — but SIGKILLed every time during a live Maestro session, blocking every element-based region resolution in production.

## Symptoms

- **BS build `a187ed12...`** — primary adb path failed fast:
  - `[percy:core:adb-hierarchy] primary dump returned no-xml-envelope, trying fallback`
  - File-dump fallback `adb shell uiautomator dump /sdcard/window_dump.xml` exited **137 (SIGKILL)**
- **BS build `6b4ce699...`** — after adding exponential-backoff retry (500ms → 1s → 2s, 3.5s total budget):
  - All three retries logged `fallback dump was killed (exit 137), retrying after Nms`
  - Final classification: `dump-error (fallback-dump-exit-137)`
- **BS build `5148139d...`** — same SIGKILL after adding `ANDROID_SERIAL` injection (ruling out the serial-resolution path as the cause)
- Fallback behavior (by design): snapshot uploaded as full-screen comparison with a `Element region not found` warning; element selectors silently dropped
- **Control test** (confirms it's contention, not capability): `adb -s <serial> exec-out uiautomator dump /dev/tty` from the host shell with **no active Maestro session** returned 44KB of valid XML in ~1s. Same command during a live session → SIGKILL

## What Didn't Work

### ❌ Approach A: `adb exec-out uiautomator dump /dev/tty` as primary

Stream XML directly to stdout via adb's exec-out (no filesystem round-trip, no PTY mangling). Textbook Android hierarchy-query pattern.

**Failed** — returned empty stdout during every live Maestro session (classified `no-xml-envelope`). Manual invocation from the host shell when no session is active works fine. Evidence: BS build `a187ed12...`.

### ❌ Approach B: `adb shell uiautomator dump /sdcard/window_dump.xml && adb pull` as fallback

Classic two-step dump-to-file + pull. Standard Appium/Espresso recipe.

**Failed** — `uiautomator` binary on-device exited 137 (SIGKILL) mid-dump because `dev.mobile.maestro` already owned the single available uiautomator session. Evidence: BS build `a187ed12...` (fallback leg).

### ❌ Approach C: Exponential-backoff retry (500ms / 1s / 2s = 3.5s budget)

Hypothesis: the lock is held intermittently; a short retry window would find a quiescent moment.

**Failed** — all three retries SIGKILLed identically. The lock is held **continuously** for the entire flow duration, not intermittently. Evidence: BS build `6b4ce699...` showed three sequential exit 137 events.

### ❌ Approach D (considered, rejected): Pause the Maestro flow, dump, resume

Would require injecting synthetic wait steps or `stopApp` / `launchApp` transitions into user flows. Mutates user test semantics; defeats the point of element selectors resolved in situ during real navigation.

## Solution

Switch the primary path to **`maestro --udid <serial> hierarchy`** — an undocumented Maestro CLI subcommand that emits the current view tree as JSON over Maestro's existing gRPC connection to `dev.mobile.maestro` on the device (port 6790, pre-forwarded by BrowserStack). Keep adb as the fallback for non-Maestro dev environments where the maestro binary isn't on PATH.

Key parts of `cli/packages/core/src/adb-hierarchy.js`:

```js
// Primary: reuse Maestro's own gRPC channel via `maestro hierarchy`.
// Works concurrently with an active `maestro test` flow because it doesn't
// open a second uiautomator session — it talks to the one Maestro already owns.
async function runMaestroDump(serial, execMaestro, getEnv) {
  const result = await execMaestro(['--udid', serial, 'hierarchy'], getEnv);
  const fail = classifyMaestroFailure(result);
  if (fail) return fail;
  if ((result.exitCode ?? 1) !== 0) {
    return { kind: 'dump-error', reason: `maestro-exit-${result.exitCode}` };
  }
  const stdout = result.stdout || '';
  const start = stdout.indexOf('{');   // tolerate banner/notice prefix
  if (start < 0) return { kind: 'dump-error', reason: 'maestro-no-json' };
  try {
    const parsed = JSON.parse(stdout.slice(start));
    return { kind: 'hierarchy', nodes: flattenMaestroNodes(parsed) };
  } catch (err) {
    return { kind: 'dump-error', reason: `maestro-parse-error:${err.message}` };
  }
}

// Entry point: try maestro first, fall through to adb on maestro-not-found.
export async function dump({ execMaestro, execAdb, getEnv } = {}) {
  const { serial, classification } = await resolveSerial({ execAdb, getEnv });
  if (classification) return classification;

  const maestroResult = await runMaestroDump(serial, execMaestro, getEnv);
  if (maestroResult.kind === 'hierarchy') return maestroResult;

  // Only falls here when maestro CLI isn't installed on the host
  // (dev environments). On BrowserStack, maestro is always present.
  return runAdbFallback(serial, execAdb);
}

// Maestro emits `accessibilityText` — rename to `content-desc` so the rest
// of the resolver (firstMatch) stays agnostic about which tool produced the tree.
function flattenMaestroNodes(root) {
  const nodes = [];
  const walk = obj => {
    if (!obj || typeof obj !== 'object') return;
    const attrs = obj.attributes;
    if (attrs && typeof attrs === 'object') {
      const node = {
        'resource-id': attrs['resource-id'],
        text: attrs.text,
        'content-desc': attrs.accessibilityText,   // ← critical rename
        class: attrs.class,
        bounds: attrs.bounds                         // "[x1,y1][x2,y2]"
      };
      if (node['resource-id'] || node.text || node['content-desc'] || node.class) {
        nodes.push(node);
      }
    }
    for (const child of obj.children || []) walk(child);
  };
  walk(root);
  return nodes;
}
```

Additional wiring needed on the BrowserStack runner (mobile repo `cli_manager.rb#start_percy_cli`):

```ruby
# Inject the two env vars that the Percy CLI's hierarchy resolver needs
cli_start_command =
  "#{cli_env(app_percy_params['env'])}" \
  "ANDROID_SERIAL=#{@device['device_serial']} " \
  "MAESTRO_BIN=/nix/store/.../maestro-cli-X.Y.Z/bin/maestro " \
  "percy app exec:start --port #{CLIManager.cli_port(@device['port'])} " \
  " > #{cli_log_file_path(session_id)} 2>&1"
```

**Verification** — BS build `4f04e76a...`, first clean E2E success:

```
[percy:core:adb-hierarchy] dump took 9902ms via maestro (107 nodes)
[percy:core] Snapshot taken: Smoke_ElementRegion_Resolved
[percy:client] Uploading comparison tiles for 4440129988...
[percy:core] Finalized build #16: https://percy.io/.../builds/48974694
```

Follow-up verification with a debug log injected before `percy.upload(payload)` — BS build `3f88a00c...` — confirmed the resolved bounding box reaches the outgoing Percy payload:

```
payload.ignored_elements_data: {
  "ignoreElementsData": [{
    "selector": "class: android.widget.FrameLayout",
    "coOrdinates": {"top": 0, "left": 0, "right": 1080, "bottom": 2340}
  }]
}
```

Cost: ~9s JVM cold start per `maestro` invocation (measured p50 = 9.0s / p99 = 9.4s across three runs). Acceptable interim for Phase 2 ship. Phase 2.2 follow-up: direct Node gRPC client against device port 6790 (protobuf schema `maestro_android.MaestroAndroid.ViewHierarchy` already in `maestro-client-X.Y.Z.jar`), target p50 <100ms.

## Why This Works

Android's `uiautomator` service enforces **one active session per device** at the OS/framework level. When `maestro test` runs, the `dev.mobile.maestro` process on the device (visible in `adb shell ps -A | grep maestro`) owns that session for the entire flow duration — not just during a `takeScreenshot` or `assertVisible` step, but continuously from flow start to flow end. Any parallel `adb ... uiautomator dump` invocation from a second client:

- **Primary path** (`exec-out ... /dev/tty`): uiautomator refuses to start a second session, returns empty stdout
- **Fallback path** (`shell uiautomator dump`): the secondary `uiautomator` binary process is SIGKILLed by the framework on launch

Exponential backoff cannot help because the lock is held **continuously**, not transiently.

`maestro --udid <serial> hierarchy` sidesteps the lock entirely: the Maestro CLI connects over the gRPC channel at `tcp:6790` (adb-forwarded to host port 8206 on BrowserStack's standard setup) and asks the **already-running** `dev.mobile.maestro` process to emit its current hierarchy snapshot. No new uiautomator session is opened — the existing one is reused. Verified empirically by probing `maestro hierarchy` twice during a live flow (2026-04-22); both calls returned valid JSON with 107 nodes and the concurrent `maestro test` was unaffected.

The 9s cost is Maestro CLI's JVM cold start, not hierarchy retrieval itself. A direct gRPC client would skip that entirely.

## Prevention

### 1. Framework-first introspection rule

When integrating with **any test framework that holds a device-level lock** (Appium, XCTest / xcuitest, Maestro, Detox, Espresso's UiAutomator bridge, UIAutomator2, WebdriverIO mobile drivers), always check whether the framework exposes its **own hierarchy / introspection API** *before* reaching for the OS-level tool the framework is already using.

OS-level tools like `uiautomator`, `xcuitest`, and `instruments` are routinely single-session-per-device. Concurrent access from a second client usually fails *silently* (empty output, SIGKILL) rather than with a clean error — so the bug ships and only manifests when both the framework and your tooling run against the same device.

Add this as a checklist item in any mobile-SDK integration design doc:
> **"Which process currently owns the device's `[uiautomator|xcuitest|…]` session during the target scenario? Can our tool coexist with it, or do we need to ask the owner for data through its own API?"**

### 2. Integration tests must run during an *active* flow

Unit tests with fixture XMLs and smoke tests against an idle emulator both passed — the bug only manifested under concurrent access. Any hierarchy resolver for a mobile test framework MUST have at least one integration test that runs the query **during** an active flow step, not just against a quiescent device.

### 3. Concurrent-access test harness

Example harness (pseudocode, Jasmine/Node — adapt to the project's framework):

```js
// test/integration/concurrent-hierarchy.test.js
import { spawn } from 'child_process';
import { dump } from '../../src/adb-hierarchy.js';

it('hierarchy resolves while a maestro flow is active', async () => {
  // 1. Start a flow that pauses on a known step (e.g., waitForAnimationToEnd:30000)
  const flow = spawn('maestro', ['test', 'fixtures/pause-30s.yaml'], { stdio: 'pipe' });

  // 2. Wait for the flow to reach the pause marker
  await waitForStdout(flow, />> PAUSED_FOR_PROBE/);

  // 3. Invoke resolver under contention — this is the production path
  const result = await dump({ execMaestro, execAdb: realExecAdb, getEnv });
  expect(result.kind).toBe('hierarchy');
  expect(result.nodes.length).toBeGreaterThan(0);

  // 4. Confirm the flow is still alive and unaffected
  expect(flow.exitCode).toBeNull();
  flow.kill('SIGTERM');
});
```

This harness would have caught the SIGKILL before merge: the `adb exec-out` implementation passes all fixture tests but fails this one deterministically. If setting up a local Maestro flow is infeasible in CI, the alternative is the next prevention item.

### 4. Probe environmental differences early with a small experiment

Before investing in implementation, run this 5-minute experiment:

```bash
# Idle device control
adb -s <serial> exec-out uiautomator dump /dev/tty | wc -c

# Start the framework that holds the lock (e.g., maestro test on a pause flow)
maestro test fixtures/pause-30s.yaml &
sleep 5

# Same command under contention
adb -s <serial> exec-out uiautomator dump /dev/tty | wc -c
echo "exit: $?"
```

If the two outputs differ (especially: the second returns 0 bytes or exits non-zero), there's a lock contention and the textbook approach won't work. This one experiment would have saved days of debugging on the Percy Maestro Android Phase 2 rollout.

### 5. Log the dump path + duration in production

`[percy:core:adb-hierarchy] dump took Nms via <maestro|adb>` makes the path selection observable. Any unexpected shift to the fallback path (or unexpected latency) becomes an alertable signal rather than silent full-screen snapshot uploads with dropped regions.

### 6. Document the lock semantics alongside the solution

Put a comment at the top of the resolver source file explaining *why* maestro is primary and adb is fallback, not the other way around. Future maintainers seeing "adb is more universal, let's flip the order" will otherwise reintroduce the bug.

```js
// Primary mechanism is `maestro hierarchy` (not `adb uiautomator dump`) because
// Android allows only one uiautomator session per device, and `maestro test`
// holds it for the entire flow duration. Concurrent `adb uiautomator dump`
// gets SIGKILLed. `maestro hierarchy` reuses Maestro's existing gRPC channel
// to dev.mobile.maestro on the device, which shares — rather than contends for —
// the single uiautomator session.
```

## Related

- **Phase 1 relay architecture (prerequisite)**: [`percy-espresso-java/docs/solutions/integration-issues/percy-maestro-browserstack-sandbox-screenshot-relay-2026-03-31.md`](../../../../percy-espresso-java/docs/solutions/integration-issues/percy-maestro-browserstack-sandbox-screenshot-relay-2026-03-31.md) — the BrowserStack sandbox relay pattern this resolver runs inside. Moderate overlap (2/5 dimensions): same SDK/platform, different subproblem (upload transport vs. hierarchy resolution).
- **Planning artifacts (superseded)**: `docs/brainstorms/2026-04-21-sdk-feature-parity-requirements.md` R6 originally specified "ADB + uiautomator dump" — that's the approach this solution supersedes. `docs/plans/2026-04-21-001-feat-sdk-feature-parity-plan.md` Unit 5 captures the rewrite to the maestro-primary resolver.
- **Architecture doc**: [Percy Maestro SDK — Architecture & Design Decisions](https://browserstack.atlassian.net/wiki/spaces/ENG/pages/6120702011/Percy+Maestro+SDK+Architecture+Design+Decisions) — full Phase 2 journey with evidence (BS build IDs for each failed attempt).
- **Jira**: PER-7281 — has a comment thread summarizing this solution + the full end-to-end validation session details (including the payload-verification session with debug-log output).
- **Auto memory**: `project_e2e_validation_state.md` captures the deployment playbook (CLI overlay in Nix store, mobile branch checkout, puma SIGTERM restart because `pumactl` is missing on BS hosts) — reference it before attempting another overlay on a BrowserStack Android host.
