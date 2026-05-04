---
title: "End-to-end testing pattern for Percy Maestro SDK changes (host overlay + App Automate + Percy git branchline)"
date: 2026-04-22
problem_type: developer_experience
component: testing_framework
root_cause: inadequate_documentation
resolution_type: documentation_update
severity: high
category: developer-experience
tags:
  - percy-maestro
  - browserstack
  - app-automate
  - e2e-testing
  - git-branchline
  - android
  - percy-cli-overlay
  - baseline-pairing
  - runbook
---

# End-to-end testing pattern for Percy Maestro SDK changes

> A runbook. Run through this for any Percy Maestro Android change that
> needs verification on a real BrowserStack device. Composed of three
> layers that must be synchronized — skip any one and failures surface
> at the *next* layer with misleading error messages.

## Problem

Percy Maestro Android E2E validation requires synchronizing three independent systems — a Nix-immutable BrowserStack device host, the App Automate REST API, and Percy's git-based baseline pairing logic — where each layer has silent failure modes that only surface at the *next* layer. Skipping any single step (e.g., forgetting `machine:` pinning, omitting a 40-char hex `PERCY_COMMIT`, or leaving the mobile repo on its default Canary HEAD) produces errors that look unrelated to the root cause, making iteration expensive at ~3–5 min per BS session.

## Symptoms

### Layer 1 — Host

| Missed step | Symptom | Evidence |
|---|---|---|
| No overlay copied to `/nix/store/.../@percy/core/dist/` | Old 1.30.0 CLI ignores `/percy/maestro-screenshot` → 404 on screenshot upload | `curl: (22) 404` in Percy CLI log |
| `computeResponsiveWidths` shim missing | Percy CLI process crashes at boot | `TypeError: computeResponsiveWidths is not a function` in Puma log |
| Mobile repo on default detached HEAD (Canary) | No Percy wiring → session never starts | BS error: `"Could not start a session"` (pre-pin session `ff7c79b241a5342c3e07239c05f6fafe01860ad6`) |
| `cli_manager.rb` not patched with `ANDROID_SERIAL` + `MAESTRO_BIN` prefix | `maestro hierarchy` hits the wrong device → element regions never resolve | Percy CLI debug log: `multi-device-no-serial` |
| Puma not restarted after patch | Stale code still served | Patch visible on disk but behavior unchanged |

### Layer 2 — App Automate

| Missed step | Symptom |
|---|---|
| Test-suite zip without parent folder at root | Upload rejects with `error_reason: "testsuite-parse-failed"` |
| No `machine:"<ip>:<serial>"` capability | BS load-balancer routes to a different host → overlay never exercised → generic `"Could not start a session"` |
| Wrong poll URL (`/build/` singular) | `404 Not Found`. Correct path uses plural `/builds/` |
| No `appPercy` field | Percy CLI never spawned — session passes but no Percy build created |

### Layer 3 — Percy

| Missed step | Symptom |
|---|---|
| No `PERCY_COMMIT` override | Every build resolves to host's mobile-repo SHA `d30de7401a` → Percy dedupes them → regions have no baseline to pair against |
| `PERCY_COMMIT` contains non-hex chars | Build aborts mid-flow: `Error: Sha must be 40 hexadecimal characters`. Session minutes already spent |
| Missing `PERCY_TARGET_BRANCH` | Pairing defaults to `master` → no baseline found on your feature branch |
| Comparison build run BEFORE baseline on the same branch | Percy pairs against a stale unrelated build → diff noise on the dashboard |

## What Didn't Work

1. **Launching builds without `machine:` pin** — session `ff7c79b2...` landed on a different host whose CLI was stock 1.30.0. Symptom: generic "Could not start a session". Wasted ~30 min assuming the overlay was broken before realizing routing.

2. **Reusing host mobile repo's natural git state** — all demo builds showed as the same commit (`d30de7401a`) to Percy. Regions rendered inside individual builds but the dashboard showed no baseline pairing between them.

3. **Human-readable fake SHAs** — `PERCY_COMMIT="demo1baseline0000000000000000000000000"` failed with `Error: Sha must be 40 hexadecimal characters` because it contains `l`, `i`, `n`, `s` (not in `[0-9a-f]`). The compare leg aborted *after* the baseline leg had already succeeded — wasted one full BS session.

4. **`pumactl restart`** — command not installed on BS hosts. Had to fall back to `kill -TERM <master-pid>` and rely on `supervise mobile-server` for respawn.

5. **Zipping workspace contents directly** (no parent folder at root) — upload response contained `testsuite-parse-failed`. Re-zipping with `zip -rq workspace.zip my-workspace-parent/` fixed it.

## Solution — End-to-End Runbook

### Layer 1 — Host prep (once per overlay change)

```bash
# From dev machine — build overlay tarball
cd ~/percy-repos/cli/packages/core
yarn build
cd /tmp
mkdir -p percy-overlay/dist percy-overlay/node_modules
cp ~/percy-repos/cli/packages/core/dist/api.js percy-overlay/dist/
cp ~/percy-repos/cli/packages/core/dist/adb-hierarchy.js percy-overlay/dist/
for dep in busboy streamsearch fast-xml-parser strnum; do
  cp -R ~/percy-repos/cli/node_modules/$dep percy-overlay/node_modules/
done
tar czf /tmp/overlay.tgz -C /tmp/percy-overlay .

# SCP via hop
scp -o ProxyJump=arumulla@hop.browserstack.com -P 4022 \
  /tmp/overlay.tgz ritesharora@31.6.63.33:/tmp/
```

On the host (via `android_ssh` alias):

```bash
# Apply overlay into the Nix store — sudo required, chmod for writability
CORE_DIR=$(ls -d /nix/store/*-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core)
LIB_DIR=$(dirname $CORE_DIR)
cd /tmp && mkdir -p percy-overlay && tar xzf overlay.tgz -C percy-overlay
sudo chmod -R u+w "$LIB_DIR"
sudo cp percy-overlay/dist/api.js           "$CORE_DIR/dist/"
sudo cp percy-overlay/dist/adb-hierarchy.js "$CORE_DIR/dist/"
sudo cp -R percy-overlay/node_modules/busboy percy-overlay/node_modules/streamsearch \
           percy-overlay/node_modules/fast-xml-parser percy-overlay/node_modules/strnum \
           "$LIB_DIR/"

# 1.30.0 compat shim (utils.js doesn't export computeResponsiveWidths;
# 1.31.11-beta.0 api.js imports it — stub to empty array so widths-config returns nothing)
sudo sed -i 's|computeResponsiveWidths } from \x27\\./utils\\.js\x27|} from \x27./utils.js\x27;\nconst computeResponsiveWidths = () => []|' \
  "$CORE_DIR/dist/api.js"

# Check out feature branch on mobile repo
cd /usr/local/.browserstack/mobile
sudo git fetch origin feat/maestro-percy-integration
sudo git checkout feat/maestro-percy-integration
sudo bundle install

# Patch cli_manager.rb — inject ANDROID_SERIAL + MAESTRO_BIN into Percy CLI spawn env
MAESTRO_BIN=$(ls /nix/store/*-maestro-cli-*/bin/maestro | head -1)
sudo sed -i "s|percy app exec:start|ANDROID_SERIAL=#{@device[\\x27device_serial\\x27]} MAESTRO_BIN=$MAESTRO_BIN percy app exec:start|" \
  android/espresso/app_percy/cli_manager.rb

# Restart Puma (pumactl unavailable)
MASTER_PID=$(pgrep -f "^puma 6" | head -1)
sudo kill -TERM $MASTER_PID
# `supervise mobile-server` respawns workers automatically within ~10s
```

### Pre-flight: verify overlay before each demo run (REQUIRED)

Run this before every Layer 2 dispatch. Layer 1 is a one-time deploy; this section is the "is the deploy still in place?" check that every subsequent demo round depends on.

#### 1. Run the full host pre-flight script

Use the script at [`### 1. Pre-flight host verification script`](#1-pre-flight-host-verification-script) (below, under **Prevention**) — **do not substitute a narrower grep**. A grep on `api.js` alone passes while any of four other documented failure modes is active:

- Missing `busboy` / `streamsearch` / `fast-xml-parser` / `strnum` node_modules (multipart parser for tile uploads).
- Missing `computeResponsiveWidths = () => []` shim on `api.js` (crashes Puma at boot).
- Stale Puma master PID (overlay on disk but running code pre-overlay).
- `cli_manager.rb` patch reverted (element regions break; not load-bearing for tile/test-metadata demos, but the script still surfaces it).

If the script reports **any** `MISSING`, follow the failure-branch procedure below.

#### 2. Capture overlay baseline SHA

Record the SHA before any dispatch so post-flight can prove the shared overlay was not mutated during our window:

```bash
ssh -J arumulla@hop.browserstack.com -p 4022 ritesharora@31.6.63.33 \
  'sha256sum /nix/store/*-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/api.js && \
   stat -c "%y %s" /nix/store/*-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/api.js'
```

Save as `OVERLAY_BASELINE_SHA` + baseline mtime. Re-check post-flight; equality proves we did not corrupt shared infrastructure for other tenants. The specific-glob form `*-node-dependencies-percy-cli-1.30.0/*` matches Layer 1's pin (line 221) and avoids false positives from other `@percy/core` derivations surviving a Nix GC.

#### 3. Chrome-drift technique spike (one-time, 15 min)

Demo 3 (tile metadata) requires deliberate pixel drift inside the status-bar ignore band between Run 1 and Run 2. The spike picks the `adb shell` command that actually works on the pinned device image — the three candidates below gate on independent permissions, not a shared permission class, so "equivalent fallbacks" is misleading without on-host validation.

On the pinned host, for each candidate, capture a screencap before, run the command, capture after, and confirm the status-bar icon visibly changed:

```bash
SERIAL=28201FDH300J1S

# Candidate A — airplane-mode toggle (preferred — cheapest, most reliable)
adb -s $SERIAL exec-out screencap -p > /tmp/before-a.png
adb -s $SERIAL shell cmd connectivity airplane-mode enable
adb -s $SERIAL exec-out screencap -p > /tmp/after-a.png
adb -s $SERIAL shell cmd connectivity airplane-mode disable  # restore

# Candidate B — wifi toggle
adb -s $SERIAL exec-out screencap -p > /tmp/before-b.png
adb -s $SERIAL shell svc wifi disable
adb -s $SERIAL exec-out screencap -p > /tmp/after-b.png
adb -s $SERIAL shell svc wifi enable  # restore

# Candidate C — statusbar disable NOTIFICATION_ICONS
adb -s $SERIAL exec-out screencap -p > /tmp/before-c.png
adb -s $SERIAL shell cmd statusbar disable NOTIFICATION_ICONS
adb -s $SERIAL exec-out screencap -p > /tmp/after-c.png
adb -s $SERIAL shell cmd statusbar disable NONE  # restore
```

Pick the candidate that (i) does not error on `adb` permissions, (ii) produces a visible pixel change inside the top 200 px, and (iii) has a reliable off-switch that restores baseline. Record the winner and any candidate-specific quirks in the "Chrome-drift probe results" block below. If **none** of the three produces visible status-bar-region drift, stop and escalate: Demo 3's ignore-band proof cannot be constructed without some mechanism for deliberate status-bar drift.

#### Chrome-drift probe results (YYYY-MM-DD)

*To be filled in after running the spike. Template:*

| Candidate | Worked? | Notes |
|---|---|---|
| A — airplane-mode | TBD | |
| B — wifi toggle | TBD | |
| C — statusbar disable | TBD | |

**Winner:** (pick one — referenced by Demo 3's `notes.md` as the primary drift mechanism)

#### Failure branches

- **Pre-flight script reports `MISSING`:** run the full Layer 1 re-apply runbook, re-run the pre-flight, and proceed only when every check is `OK`. Do not proceed with dispatch on a partial overlay.
- **Co-tenant detected** (another `@percy/cli` process active on host, port 5338 already bound to a PID you did not spawn): either accept the co-tenancy risk with explicit ack (document in the dispatch notes) or wait for the concurrent session to finalize before proceeding. The overlay is byte-read-only during normal CLI operation, so co-tenancy is a *result* concern (another operator's session may finalize against our overlay mid-dispatch), not a *corruption* concern.
- **Layer 1 re-apply needed while an active Maestro session is running on the host: FORBIDDEN.** Wait for all in-flight sessions on the host to finalize (or time out after 5 min) before touching files in `/nix/store/*-node-dependencies-percy-cli-1.30.0/`. Re-applying mid-session can corrupt concurrent tenants' uploads (their CLI processes read mid-write files); the observable symptom is identical to a broken overlay (404 on `/percy/maestro-screenshot`) but the blame falls on us.

### Layer 2 — App Automate build submission

```bash
export BS_USER="<browserstack_user>"
export BS_KEY="<browserstack_access_key>"
export PERCY_TOKEN="app_<your_percy_project_token>"

# 1. Upload app (or reuse an existing bs:// URL)
APP_URL=$(curl -s -u "$BS_USER:$BS_KEY" -X POST \
  "https://api-cloud.browserstack.com/app-automate/upload" \
  -F 'url=https://www.browserstack.com/app-automate/sample-apps/android/WikipediaSample.apk' \
  | jq -r .app_url)

# 2. Upload test suite — MUST have a single parent folder at zip root
cd /tmp && rm -rf ws-stage && mkdir -p ws-stage/my-workspace
cp -R /path/to/flows/* ws-stage/my-workspace/        # your Maestro flows + percy/
(cd ws-stage && zip -rq /tmp/workspace.zip my-workspace)
TS_URL=$(curl -s -u "$BS_USER:$BS_KEY" -X POST \
  "https://api-cloud.browserstack.com/app-automate/maestro/v2/test-suite" \
  -F "file=@/tmp/workspace.zip" | jq -r .test_suite_url)

# 3. Generate a valid 40-char hex SHA (Percy requires /^[0-9a-f]{40}$/)
COMMIT=$(python3 -c "import secrets; print(secrets.token_hex(20))")

# 4. Submit build with machine pinning + appPercy.env forwarding
BRANCH="percy-demo-d1-coord-20260422"
curl -u "$BS_USER:$BS_KEY" -X POST \
  "https://api-cloud.browserstack.com/app-automate/maestro/v2/android/build" \
  -H "Content-Type: application/json" \
  -d "{
    \"app\": \"$APP_URL\",
    \"testSuite\": \"$TS_URL\",
    \"devices\": [\"Google Pixel 7 Pro-13.0\"],
    \"machine\": \"31.6.63.33:28201FDH300J1S\",
    \"project\": \"percy-maestro-android-demo\",
    \"buildName\": \"demo-d1-baseline-$(date +%s)\",
    \"deviceLogs\": \"true\",
    \"appPercy\": {
      \"PERCY_TOKEN\": \"$PERCY_TOKEN\",
      \"env\": {
        \"PERCY_LOGLEVEL\": \"debug\",
        \"PERCY_BRANCH\": \"$BRANCH\",
        \"PERCY_COMMIT\": \"$COMMIT\",
        \"PERCY_TARGET_BRANCH\": \"$BRANCH\"
      }
    }
  }"

# 5. Poll (note: /builds/ PLURAL; /build/ returns 404)
curl -s -u "$BS_USER:$BS_KEY" \
  "https://api-cloud.browserstack.com/app-automate/maestro/v2/builds/$BUILD_ID" | jq .
```

### Layer 3 — Percy pairing sequence

For a demo with visible baseline → comparison pairing:

1. Submit the **baseline** build first (flows **without** regions) with `PERCY_BRANCH=X`, `PERCY_COMMIT=<hex-A>`, `PERCY_TARGET_BRANCH=X`. Wait until BS reports `status: passed` (or `done`).
2. Submit the **comparison** build (flows **with** regions) with the same `PERCY_BRANCH=X`, a **different** `PERCY_COMMIT=<hex-B>`, and the same `PERCY_TARGET_BRANCH=X`. Percy's pairing picks "most recent finished build on the same branch" — i.e., your baseline.
3. Verify in Percy dashboard: the comparison build should show baseline thumbnails alongside the new screenshot with region overlays rendered on the tile.

**Validated example:** `percy-demo-d1-coord-20260422` branch with baseline `4283fefc63f0cd0e873a0000c6d07ef7b77e90d3` → Percy build #25; comparison `122b598615dcbe810beacd557705a54b5edbbbe5` → Percy build #26. Baseline + comparison paired correctly on dashboard.

## Why This Works

- **Overlay + sudo + Nix writability** — the Nix store is read-only by design; `chmod u+w` on the immutable lib dir is the only way to splice in new `dist/` files without rebuilding the Nix derivation (which would take hours and require BrowserStack infra involvement).
- **`computeResponsiveWidths` shim** — host's 1.30.0 `utils.js` predates that export; our 1.31.11-beta.0 `api.js` imports it at module load. Returning `[]` is safe because Maestro flows don't use responsive widths (`/percy/widths-config` is a web-SDK endpoint).
- **`machine:<ip>:<serial>` pin** — BrowserStack's load balancer otherwise picks any free host matching the device spec. Pinning is the ONLY way to guarantee your overlay gets exercised. Before discovering this, we wasted 2–3 sessions trying to debug "broken overlays" when the session was landing on a pristine host entirely.
- **`ANDROID_SERIAL` + `MAESTRO_BIN` in `cli_manager.rb`** — the Percy CLI's element-region resolver shells out to `maestro --udid $ANDROID_SERIAL hierarchy`. Without `ANDROID_SERIAL` and with 8 devices on the host, the fallback `adb devices` probe returns `multi-device-no-serial` → element regions silently don't resolve. `MAESTRO_BIN` is needed because the maestro binary isn't on the Percy CLI process's PATH by default (it lives in a different Nix-store derivation).
- **40-char hex `PERCY_COMMIT`** — Percy's Rails API validates SHAs against `/\A[0-9a-f]{40}\z/`. Server-side enforcement, so invalid commits abort mid-build *after* BS minutes are already spent. The host's mobile-repo SHA is static across sessions, so we MUST override to get distinct commits per build.
- **Same-branch pairing** — Percy's default pairing logic looks at `PERCY_TARGET_BRANCH` (defaults to `master`). Setting it equal to `PERCY_BRANCH` forces pairing against the most recent finished build on *this* branch rather than defaulting to master (where we have nothing). See [BrowserStack docs: Baseline management via git](https://www.browserstack.com/docs/percy/visual-testing-workflows/baseline-management/git).
- **Parent folder in zip** — BS's test-suite parser expects a single top-level directory; a flat zip of files triggers `testsuite-parse-failed`. Not documented in the public API reference; the only way to discover is to read the error response.
- **`kill -TERM` on Puma master** — `pumactl` isn't in the Nix closure on BS hosts; sending SIGTERM to the master triggers graceful worker restart, and `daemontools supervise` respawns the master transparently. `pgrep -f "^puma 6"` finds the master reliably because BS pins Puma to version 6.x.

## Prevention

### 1. Pre-flight host verification script

Save as `bin/preflight-host.sh` and run before any test session. Verifies all three layers of host state in one go.

```bash
#!/usr/bin/env bash
set -euo pipefail
HOST=${1:-31.6.63.33}
SERIAL=${2:-28201FDH300J1S}

ssh -J arumulla@hop.browserstack.com -p 4022 ritesharora@$HOST bash -s <<'REMOTE'
set -e
CORE_DIR=$(ls -d /nix/store/*-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core)

echo "=== Overlay hash ==="
sha256sum "$CORE_DIR/dist/api.js" "$CORE_DIR/dist/adb-hierarchy.js"

echo
echo "=== Overlay deps present ==="
LIB=$(dirname $CORE_DIR)
for d in busboy streamsearch fast-xml-parser strnum; do
  test -d "$LIB/$d" && echo "  OK $d" || echo "  MISSING $d"
done

echo
echo "=== computeResponsiveWidths shim ==="
grep -q "computeResponsiveWidths = () => \[\]" "$CORE_DIR/dist/api.js" \
  && echo "  OK shim present" || echo "  MISSING shim"

echo
echo "=== Mobile repo branch ==="
cd /usr/local/.browserstack/mobile
git rev-parse --abbrev-ref HEAD
git log -1 --oneline

echo
echo "=== cli_manager.rb patch ==="
grep -q "ANDROID_SERIAL" android/espresso/app_percy/cli_manager.rb \
  && echo "  OK patched" || echo "  MISSING patch"

echo
echo "=== Puma health ==="
pgrep -fa "^puma 6" | head -3

echo
echo "=== ADB devices ==="
adb devices | grep -v "^List" | grep -c device
REMOTE
```

### 2. Reusable BS build submission function

Source this from your shell. Client-side SHA validation prevents wasted BS sessions.

```bash
# bash/zsh function
percy_maestro_build() {
  local build_name="$1" test_suite="$2" branch="$3" commit="$4" app_url="$5"

  # Client-side SHA validation
  if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: PERCY_COMMIT must be 40 hex chars. Got: $commit" >&2
    return 1
  fi

  curl -sS -u "$BS_USER:$BS_KEY" -X POST \
    "https://api-cloud.browserstack.com/app-automate/maestro/v2/android/build" \
    -H "Content-Type: application/json" \
    -d "{
      \"app\": \"$app_url\",
      \"testSuite\": \"$test_suite\",
      \"devices\": [\"Google Pixel 7 Pro-13.0\"],
      \"machine\": \"${BS_MACHINE:-31.6.63.33:28201FDH300J1S}\",
      \"project\": \"percy-maestro-android-demo\",
      \"buildName\": \"$build_name\",
      \"deviceLogs\": \"true\",
      \"appPercy\": {
        \"PERCY_TOKEN\": \"$PERCY_TOKEN\",
        \"env\": {
          \"PERCY_LOGLEVEL\": \"debug\",
          \"PERCY_BRANCH\": \"$branch\",
          \"PERCY_COMMIT\": \"$commit\",
          \"PERCY_TARGET_BRANCH\": \"$branch\"
        }
      }
    }" | jq .
}

# Valid fake SHA helper
percy_fake_sha() { python3 -c "import secrets; print(secrets.token_hex(20))"; }
```

Usage:

```bash
BASE_SHA=$(percy_fake_sha)
COMP_SHA=$(percy_fake_sha)
BRANCH="percy-demo-$(date +%Y%m%d)"

percy_maestro_build "baseline-$(date +%s)" "$TS1" "$BRANCH" "$BASE_SHA" "$APP"
# wait for baseline to finish...
percy_maestro_build "compare-$(date +%s)"  "$TS2" "$BRANCH" "$COMP_SHA" "$APP"
```

### 3. Validate `PERCY_COMMIT` client-side before submission

Add a quick assertion to catch non-hex SHAs before you spend BS session time:

```bash
# bin/validate-percy-commit.sh
assert_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { echo "FAIL: '$1' not 40-char hex"; exit 1; }
}
assert_sha "$(percy_fake_sha)"                                                 # passes
assert_sha "demo1baseline0000000000000000000000000000" && \
  { echo "FAIL: accepted non-hex"; exit 1; } || echo "OK: rejected non-hex"
```

Or in Ruby (CI-friendly):

```ruby
# spec/percy/commit_validation_spec.rb
RSpec.describe 'PERCY_COMMIT validation' do
  it 'rejects non-hex SHAs' do
    expect('demo1baseline0000000000000000000000000000').not_to match(/\A[0-9a-f]{40}\z/)
  end
  it 'accepts 40-char hex SHAs' do
    expect(SecureRandom.hex(20)).to match(/\A[0-9a-f]{40}\z/)
  end
end
```

### 4. Checklist — adding a new Percy Maestro feature touching all 3 layers

- [ ] **CLI (`@percy/core`)**: new `dist/` files identified; new npm deps listed; `yarn build` clean; overlay tarball regenerated
- [ ] **Compat shims**: audit new imports against host's 1.30.0 `utils.js` exports — add sed-based shim for any missing symbol (currently: `computeResponsiveWidths`)
- [ ] **Mobile repo**: if CLI process env changes, update `android/espresso/app_percy/cli_manager.rb` AND cut a new branch off `feat/maestro-percy-integration` (or land the patch on that branch)
- [ ] **Host state**: run `preflight-host.sh`; confirm overlay SHA, branch, cli_manager.rb patch, Puma PID, adb device count
- [ ] **Workspace zip**: verify parent folder exists at zip root (`unzip -l workspace.zip | head`)
- [ ] **BS payload**: if new env var required, add to `appPercy.env`; update `percy_maestro_build` function
- [ ] **Percy pairing**: baseline-first, comparison-second on same branch; never reuse commit SHAs across runs; use `percy_fake_sha` to generate valid hex
- [ ] **Validation**: run 1 baseline + 1 compare build; verify Percy dashboard shows baseline thumbnail + region overlays
- [ ] **Rollback**: keep previous overlay tarball on host at `/tmp/overlay-prev.tgz` in case new overlay breaks unrelated flows
- [ ] **Document** any new gotcha discovered during this run — this doc exists precisely because "tribal knowledge" about the 3-layer pattern was expensive to re-derive

## Reference evidence

All examples below produced working Percy baseline + comparison pairs on 2026-04-22:

| Demo | Baseline Percy build | Comparison Percy build | Branch |
|---|---|---|---|
| Coordinate regions (3 algorithms) | [#25](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48981276) | [#26](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48981372) | `percy-demo-d1-coord-20260422` |
| Element regions (`maestro hierarchy`) | [#27](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48981572) | [#28](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48981678) | `percy-demo-d2-elem-20260422` |

Failure modes that surfaced during the session (use as regression tests against the prevention script):

- Session `ff7c79b241a5342c3e07239c05f6fafe01860ad6` — missing `machine:` pin → landed on non-overlay host, generic session-start error
- Session `dcc55564c1650aa20a953fefdf46e4c41001ec29` — first test-suite zip had files at root (no parent folder) → `testsuite-parse-failed`
- Previous demo attempt with `PERCY_COMMIT="demo1baseline..."` → `Error: Sha must be 40 hexadecimal characters` aborted the compare leg

## Related

- **Sibling solution (complementary, low overlap 1/5)**: [`integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`](../integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md) — the element-region resolver fix that motivated the need for this runbook. This runbook describes *how* to test it; the sibling describes *what* the fix is.
- **Related prior art (moderate overlap 2/5)**: [`percy-espresso-java/docs/solutions/integration-issues/percy-maestro-browserstack-sandbox-screenshot-relay-2026-03-31.md`](../../../../percy-espresso-java/docs/solutions/integration-issues/percy-maestro-browserstack-sandbox-screenshot-relay-2026-03-31.md) — the original Maestro+BrowserStack relay architecture doc. Note: that doc's "What Didn't Work" item about the `machine` parameter "never resolved" is now superseded — this runbook confirms `machine:<ip>:<serial>` works when paired with the three-layer overlay.
- **Verification runbook prior art (moderate overlap 2/5)**: [`percy-ops/docs/solutions/developer-experience/verifying-fixes-on-staging-2026-04-17.md`](../../../../percy-ops/docs/solutions/developer-experience/verifying-fixes-on-staging-2026-04-17.md) — sister runbook pattern for percy-api/staging verification. Different stack but same shape.
- **Planning artifacts** (in this repo):
  - `docs/brainstorms/2026-04-21-sdk-feature-parity-requirements.md`
  - `docs/plans/2026-04-21-001-feat-sdk-feature-parity-plan.md`
  - `docs/confluence-update-2026-04-22.md` — Confluence addendum that mirrors this doc's findings with a narrative, architecture-focused framing
- **Architecture doc**: [Percy Maestro SDK — Architecture & Design Decisions](https://browserstack.atlassian.net/wiki/spaces/ENG/pages/6120702011/Percy+Maestro+SDK+Architecture+Design+Decisions) — full Phase 2 journey with BS build IDs for every failed and successful attempt.
- **Jira**: PER-7281 — has two comment threads summarizing the feature + the validation session details.
- **Auto memory**: `project_e2e_validation_state.md` (auto memory [claude]) — canonical in-repo playbook, used as primary supplementary evidence for this runbook.
