---
date: 2026-05-27
status: validated-2026-05-28
topic: self-hosted-maestro-percy-validation
---

# Self-Hosted Maestro + Percy — End-to-End Validation Runbook

**Status: V1 acceptance gate met on Android (2026-05-28).** Validated end-to-end against a real Pixel 10 running Android 16 with Maestro 2.4.0. Baseline build #13 + comparison build #14 confirmed:

- `/percy/maestro-screenshot` relay resolves `PERCY_MAESTRO_SCREENSHOT_DIR`-scoped screenshots with no `sessionId` (Unit 1).
- SDK uploads successfully self-hosted with `PERCY_SESSION_ID` omitted from the payload (Unit 3).
- Coordinate regions are forwarded through the SDK → relay → Percy comparison engine. With the calculation result area covered by a coordinate region, build #14 (`9×9=81`) reported `02_CalcResult` as **Unchanged** against baseline #13 (`7×8=56`) — the canonical "regions are working" demonstration.

Verified Percy builds:
- Baseline (approved): https://percy.io/9560f98d/app/RegionsIos-3d2ab5a4/builds/50215463
- Comparison: https://percy.io/9560f98d/app/RegionsIos-3d2ab5a4/builds/50215516

iOS validation is still pending (no iOS device connected at validation time). Same pipeline; the iOS-specific cli code (Unit 2's port cascade) is exercised when an iOS device + Maestro session are present.

## Why this runbook exists

The shipped BrowserStack runbook ([`test-percy-maestro-app-on-browserstack-2026-05-06.md`](./test-percy-maestro-app-on-browserstack-2026-05-06.md)) is host-lifecycle-heavy (cli_manager, percy_env_flags, privoxy, SCREENSHOTS_DIR injection, the `appPercy` build API). On self-hosted, every one of those host-side responsibilities disappears — replaced by a single `percy app:exec` invocation the customer owns.

## Pre-conditions

1. A real device (Android phone or iOS simulator/device) connected to the host where you will run `maestro test`. `maestro list-devices` must show it.
2. `@percy/cli` containing **cli#2248** installed. The system `percy` should resolve to that build — confirm with `percy --version` ≥ `1.32.0-beta.2`.
3. `@percy/maestro-app` containing the companion percy-maestro changes (Unit 3's `PERCY_SERVER_ADDRESS` read + session-id gate relaxation + this runbook).
4. `PERCY_TOKEN` available in the shell. Project-scoped recommended — `app_…` works.
5. A small Maestro flow that calls the percy screenshot subflow at least once. The example flow in this runbook drives Google Calculator using resource IDs.

## Two gotchas that *will* bite the first run on a fresh machine

Both were discovered during the 2026-05-28 validation; both are required to make the canonical flow run end-to-end.

### Gotcha #1 — Maestro hangs on the device-driver install without `-Djava.net.preferIPv4Stack=true`

On macOS hosts (Apple Silicon, macOS 15.5) talking to a USB-attached Pixel 10 on Android 16, both **Maestro 2.6.0** and **Maestro 2.4.0** hung silently during the driver-APK install step:

```
[shard 1] Selected device 61031VDCR0004B using port 7001 with execution plan …
[then nothing for 3+ minutes, no logs, no error]
```

The hang is in Maestro's `dadb` library trying to talk to adb over IPv6 loopback (`::1`). Forcing the JVM to prefer IPv4 makes the install path complete in seconds:

```bash
export JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true"
```

This is **completely independent of Percy** — `maestro test` alone (no `percy app:exec` wrapping) hangs identically, and unhangs identically with the env var set. Confirmed both with disabled Play Protect and reset `adb` servers; neither helped. The env var is the load-bearing fix.

### Gotcha #2 — Maestro's GraalJS does not inherit the parent process's environment

`percy app:exec` exports `PERCY_SERVER_ADDRESS` into the child `maestro test` process. The SDK reads it as a fallback. But Maestro **does not** make the parent process's env visible to its GraalJS `runScript` context — GraalJS only sees Maestro `-e` flags and Maestro's own top-level/runFlow `env:` blocks.

Empirical confirmation from the validation run: without `-e PERCY_SERVER=…`, the SDK fell back to its `http://percy.cli:5338` default (which is the safe BS DNS-aliased default), the healthcheck failed (`percy.cli` doesn't resolve self-hosted), and the SDK logged `[percy] DISABLED — this build will have zero Percy screenshot coverage`. The maestro flow ran to completion, no upload happened, the Percy build was finalized with `Snapshot command was not called`.

**Fix:** pass `PERCY_SERVER` explicitly as a Maestro `-e` flag on every `maestro test` invocation:

```bash
maestro test \
  -e PERCY_SERVER=http://localhost:5338 \
  …
```

This is the *one* extra config item required for self-hosted vs. BrowserStack. It is documented in the README's "Self-Hosted Maestro" section troubleshooting table.

## Validation flow

### Android (verified 2026-05-28)

```bash
# 1. Workspace + vendored SDK
WORKSPACE=/tmp/percy-self-hosted-validation
mkdir -p "$WORKSPACE/.percy-out-android"
cp -r node_modules/@percy/maestro-app/percy "$WORKSPACE/percy"
cd "$WORKSPACE"

# 2. Flow targeting Google Calculator (pre-installed on every Pixel).
cat > flow.yaml <<'EOF'
appId: com.google.android.calculator
---
- launchApp:
    appId: com.google.android.calculator
    clearState: true
- waitForAnimationToEnd: { timeout: 5000 }

- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: 01_CalcEmpty
      PERCY_REGIONS: '[{"top":0,"bottom":130,"left":0,"right":1080,"algorithm":"ignore"}]'

# Calculation: 7 × 8 = 56 (use resource IDs — operator buttons have
# accessibility text "multiply" not "×", so tapOn:"×" fails).
- tapOn: { id: ".*digit_7" }
- tapOn: { id: ".*op_mul" }
- tapOn: { id: ".*digit_8" }
- tapOn: { id: ".*eq" }
- waitForAnimationToEnd: { timeout: 2000 }

- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: 02_CalcResult
      # Mask the entire display+expression area so the snapshot stays
      # stable even when the calculation differs across runs (region
      # masking demonstration).
      PERCY_REGIONS: '[{"top":0,"bottom":130,"left":0,"right":1080,"algorithm":"ignore"},{"top":130,"bottom":1100,"left":0,"right":1080,"algorithm":"ignore"}]'

- tapOn: { id: ".*clr" }
- waitForAnimationToEnd: { timeout: 2000 }

- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: 03_CalcClearedAfter
      PERCY_REGIONS: '[{"top":0,"bottom":130,"left":0,"right":1080,"algorithm":"ignore"}]'
EOF

# 3. Run — note BOTH gotcha-fixes.
export PERCY_TOKEN=<your-app-token>
export JAVA_TOOL_OPTIONS="-Djava.net.preferIPv4Stack=true"          # gotcha #1
export PERCY_MAESTRO_SCREENSHOT_DIR="$PWD/.percy-out-android"
export ANDROID_SERIAL=<your-device-serial>

percy app:exec -- maestro test \
  --test-output-dir "$PERCY_MAESTRO_SCREENSHOT_DIR" \
  -e PERCY_SERVER=http://localhost:5338                          \
  -e PERCY_DEVICE_NAME="Pixel 10"                                \
  -e PERCY_OS_VERSION="16"                                       \
  flow.yaml
```

**Expected** (verified 2026-05-28 on Pixel 10 / Android 16 / Maestro 2.4.0 / cli 1.32.0-beta.2):

- Percy CLI logs `Percy CLI healthcheck passed. Core version: 1.32.0-beta.2`.
- For each `runFlow: percy/flows/percy-screenshot.yaml`: `[percy] Uploading: <name>` → `[percy] Done: https://percy.io/api/v1/comparisons/redirect?build_id=…&snapshot[name]=…&tag[name]=Pixel%2010&tag[os_name]=Android&tag[os_version]=16&tag[width]=1080&tag[height]=2424`.
- Maestro exits `status: 0`. Build finalized cleanly (no `Snapshot command was not called`).
- Total runtime: ~50–60s for 3 snapshots on this hardware.

### Region-pass-through verification

Run the flow once → approve as baseline. Run a second time with one different calculation (e.g. swap `digit_7→digit_9` and `digit_8→digit_9`) to produce `02_CalcResult` showing `81` instead of `56`. Snapshot #02's display area diff should be **masked** by the coordinate region → Percy reports it as **Unchanged**.

Verified on 2026-05-28: baseline #13 (`7×8=56`) approved; comparison #14 (`9×9=81`) reported all three snapshots as Unchanged. The masked area showed no flagged diff despite content differing — i.e. regions are honored end-to-end through SDK → relay → Percy.

### iOS — runtime-verify items for the next validation

When an iOS device or simulator becomes available, repeat with:

```bash
xcrun simctl boot "<simulator-udid>"   # for simulator
export PERCY_MAESTRO_SCREENSHOT_DIR="$PWD/.percy-out-ios"
percy app:exec -- maestro test \
  --test-output-dir "$PERCY_MAESTRO_SCREENSHOT_DIR" \
  -e PERCY_SERVER=http://localhost:5338 \
  -e PERCY_DEVICE_NAME="iPhone 14" \
  -e PERCY_OS_VERSION="17" \
  flows/your-flow.yaml
```

Things to verify on first iOS run:

- **`7001` probe hit**: on Maestro ≤2.4.0, the CLI relay should log `runIosHttpDump ok` against `127.0.0.1:7001` without firing the `lsof` fallback (per the spike + source verification of `TestCommand.kt#selectPort`).
- **`lsof` fallback exercised**: on Maestro `main`/`2.6.0+` (ephemeral port via `ServerSocket(0)`), the `7001` probe will miss and the `lsof` fallback should find the `maestro-driver-ios…xctrunner` LISTEN port.
- **Real-device override**: for an iOS *device* (not simulator), set `PERCY_IOS_DRIVER_HOST_PORT=<host-port>` explicitly — the host-forwarded port (community references ~6001 forwarded to device-side 22087) needs runtime confirmation per device.

## What MUST hold on every run (regardless of platform)

- **R7 — BrowserStack path unchanged.** Trigger one BS App Automate Maestro build against the same flow on the same `bs-nixpkgs` cli pin and confirm it produces snapshots identically to pre-deploy.
- **Detection-signal invariant.** A self-hosted request omits `sessionId` from the upload payload; a BS request includes it. Verify by grepping the CLI log: self-hosted should NOT show `sessionId=` on the maestro-screenshot relay request; BS should.

## Known device-class gotchas (Android 16-era)

- **Pixel 10 + Android 16 + macOS host:** Maestro hangs without `-Djava.net.preferIPv4Stack=true`. See Gotcha #1.
- **Disabling Play Protect did not help.** The hang is IPv6-vs-IPv4 in `dadb`, not Play Protect filtering.
- **Maestro version downgrade did not help.** Both 2.4.0 and 2.6.0 hang identically without the IPv4 env var.

## References

- Plan: `docs/plans/2026-05-27-001-feat-self-hosted-maestro-percy-plan.md`
- cli PR: https://github.com/percy/cli/pull/2248
- percy-maestro PR: https://github.com/percy/percy-maestro-app/pull/7
- Jira: PER-8599
