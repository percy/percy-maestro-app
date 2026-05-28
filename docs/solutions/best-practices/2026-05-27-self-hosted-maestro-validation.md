---
date: 2026-05-27
status: stub-pending-real-device-validation
topic: self-hosted-maestro-percy-validation
---

# Self-Hosted Maestro + Percy — End-to-End Validation Runbook

**Stub status.** The Self-Hosted Maestro + Percy feature ships in cli#2248 (Units 1, 2) and the companion percy-maestro PR (Units 3, 4). This runbook captures **what to validate** once the changes are deployable; the **verified commands and Percy build IDs** must be backfilled from a real Android + iOS run (per `feedback_defer_real_device_testing`: real-device validation is a discrete step, not run inline at implementation end). The acceptance gate from the plan is: a non-BS Android device **and** a non-BS iOS device each produce a Percy build via `percy app:exec -- maestro test` with correct device tags, one passing coordinate region, and one passing element region.

## Why this runbook exists

The shipped BrowserStack runbook
([`test-percy-maestro-app-on-browserstack-2026-05-06.md`](./test-percy-maestro-app-on-browserstack-2026-05-06.md))
is host-lifecycle-heavy (cli_manager, percy_env_flags, privoxy, SCREENSHOTS_DIR injection, the `appPercy` build API). On self-hosted, every one of those host-side responsibilities disappears — replaced by a single `percy app:exec` invocation the customer owns. This is the first time anyone has run Percy + Maestro fully off BrowserStack, and the validation steps don't map 1:1.

## Pre-conditions

1. A real device (Android phone or iOS simulator/device) connected to the host where you will run `maestro test`. `maestro list-devices` shows it.
2. `@percy/cli` containing **cli#2248** installed (the `sessionId`-optional handler + `dot:true` self-hosted glob + iOS port cascade).
3. `@percy/maestro-app` containing the companion percy-maestro changes (server-default + session-id gate relaxation + this runbook).
4. `PERCY_TOKEN` available in the shell (project-scoped recommended).
5. A small Maestro flow that calls the percy screenshot subflow at least once with a coordinate region and once with an element region. The example app at `example-percy-maestro` is sufficient.

## Validation flow

### Android (zero-config baseline)

```bash
export PERCY_TOKEN=<token>
export PERCY_MAESTRO_SCREENSHOT_DIR="$PWD/.percy-out-android"

npx percy app:exec -- maestro test \
  --test-output-dir "$PERCY_MAESTRO_SCREENSHOT_DIR" \
  -e PERCY_DEVICE_NAME="<device-name>" \
  -e PERCY_OS_VERSION="<os-version>" \
  flows/your-flow.yaml
```

**Expected:**
- Percy CLI logs include `Percy CLI healthcheck passed.`
- For each `runFlow: percy/flows/percy-screenshot.yaml` step, a `[percy] Uploading: <name>` line followed by `[percy] Done: https://percy.io/...`.
- The resulting Percy build has snapshots with correct `tag.name` / `tag.osVersion` / `tag.width` / `tag.height`.
- Coordinate regions appear masked in the diff image (verify by inspecting the diff bitmap, **not** by API `applied-regions` metadata — see `feedback_percy_regions_apply_silently`).
- Element regions resolve (CLI logs `hierarchy:` lines via `maestro-cli` succeeded-via, no `warn-skip` for element regions).

**Backfill on first real run:** Percy build ID, Maestro version, ADB device serial, screenshot count, exact `maestro test` exit code.

### iOS simulator (zero-config baseline)

```bash
xcrun simctl boot "<simulator-udid>"

export PERCY_TOKEN=<token>
export PERCY_MAESTRO_SCREENSHOT_DIR="$PWD/.percy-out-ios"

npx percy app:exec -- maestro test \
  --test-output-dir "$PERCY_MAESTRO_SCREENSHOT_DIR" \
  -e PERCY_DEVICE_NAME="iPhone 14" \
  -e PERCY_OS_VERSION="17" \
  flows/your-flow.yaml
```

**Expected (same as Android, plus):**
- iOS element-region resolution path: the CLI logs `runIosHttpDump ok` against `127.0.0.1:7001` (probe succeeded — the source-verified deterministic port for current Maestro), **without** any `lsof` fallback firing.

**Backfill on first real run:** confirm the simulator's actual host port matches `7001` for current Maestro version. If it doesn't, capture the `--driver-host-port`-supplied path (set `PERCY_IOS_DRIVER_HOST_PORT` explicitly) and document the Maestro version where the deterministic port changed (this is the trigger for shipping the `lsof` extension, per the plan).

### iOS real device (override path)

```bash
export PERCY_IOS_DRIVER_HOST_PORT=<host-port-from-your-maestro-invocation>
export PERCY_IOS_DEVICE_UDID=<device-udid>

# Same as the simulator block above, plus an explicit --driver-host-port
# on your `maestro test` command so the host port is deterministic and
# matches PERCY_IOS_DRIVER_HOST_PORT.
```

**Backfill on first real run:** the actual host port realmobile-style derivation finds on a real device (community references cite ~6001 forwarded to device-side 22087 — confirm or correct).

## What MUST hold on every run

- **R7 — BrowserStack path unchanged.** Any BS Maestro session that runs in parallel to / before / after the self-hosted validation must continue to produce snapshots normally. The cli PR's existing 45+ BS-path tests stay green on every CI run on cli#2248; that's the unit-test gate. Real-device confirmation: trigger one BS App Automate Maestro build against the same flow on the same `bs-nixpkgs` cli pin and confirm it produces snapshots identically to pre-deploy.
- **Detection signal invariant.** A self-hosted request omits `sessionId` from the upload payload; a BS request includes it. Verify by grepping the CLI log: self-hosted should NOT show `sessionId=` on the maestro-screenshot relay request, BS should.

## Known limitations to confirm at validation time

- Whether Maestro's GraalJS context inherits `PERCY_SERVER_ADDRESS` from the parent process env. If yes, no `-e PERCY_SERVER` is ever needed self-hosted; if no, the customer must pass `-e PERCY_SERVER=http://localhost:5338`.
- iOS-only `id` selector restriction (Maestro's iOS TreeNode does not carry `class`/`text`) — confirm element regions using `text=` or `class=` selectors silently no-op on iOS as expected, and that the `id=` selector resolves correctly.
- For Maestro `main`/2.6.0 (when released): the `lsof` discovery branch fires only when the `7001` probe fails. Re-validate end-to-end on that release.

## When to update this file

After the first successful real-device run, replace the `status: stub-pending-real-device-validation` frontmatter with `status: validated-2026-MM-DD`, fill in the Percy build IDs + Maestro versions + device names actually used, and capture any deviations from the expected behavior above.
