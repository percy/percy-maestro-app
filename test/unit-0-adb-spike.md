# Unit 0 — ADB Feasibility Spike on BrowserStack Maestro Android

**Goal:** Verify the Percy CLI process running inside a BrowserStack Maestro Android session can execute `adb` against the test device.

**This gates Phase 2.** If any required check fails, Phase 2 (element-based regions) re-scopes before any Unit 5/6 code is merged.

**Time budget:** ~30 minutes.

**Related plan:** `docs/plans/2026-04-21-001-feat-sdk-feature-parity-plan.md` → Unit 0.

---

## Prerequisites

- Access to a BrowserStack Maestro Android session (real device or emulator in BrowserStack's pool).
- An Android app uploaded to BrowserStack App Live / App Automate.
- `PERCY_TOKEN` set for a test Percy project.
- This repo's `percy/` directory present in the Maestro workspace zip uploaded to BrowserStack.

## What the spike does

Adds four shell-outs to the Percy CLI relay handler **temporarily** — enough to prove ADB reachability. The changes are throwaway; they do not ship in any PR.

Preferred mechanism: run these commands from the CLI process by adding a one-off debug endpoint, a log line in the existing `/percy/maestro-screenshot` handler, or a manual `docker exec` into the BrowserStack runner container. Whichever is easiest for the environment you have access to — the goal is "does this work," not "does this work cleanly."

## Commands to capture

Run each from the Percy CLI process (Node, on the BrowserStack Maestro runner host — **not** from inside the Maestro JS flow, which runs in GraalJS on the device).

| # | Command | What to capture |
|---|---------|-----------------|
| 1 | `adb version` | stdout, exit code |
| 2 | `echo "$ANDROID_SERIAL"` | value, or empty string |
| 3 | `adb devices` | full stdout |
| 4 | `adb -s <serial> exec-out uiautomator dump /dev/tty \| head -c 400` | first 400 bytes of stdout, exit code, wall-clock time |

For #4, use the serial from #2 if set, else the only device listed in #3.

## Results

Fill in during the spike. Paste raw output; do not summarize.

### 1. `adb version`

```
exit_code:
stdout:
```

**Pass criteria:** exit 0 and stdout contains `Android Debug Bridge version`.

### 2. `process.env.ANDROID_SERIAL`

```
value:
```

**Pass criteria:** either a non-empty serial string OR empty (in which case #3 must list exactly one device).

### 3. `adb devices`

```
exit_code:
stdout:
```

**Pass criteria:** exit 0; at least one device listed with state `device` (not `unauthorized`, `offline`, or `no permissions`).

**Warning case:** more than one device listed AND `$ANDROID_SERIAL` from #2 was empty → Phase 2 works but falls back to `multi-device-no-serial` → needs BrowserStack infra to inject `$ANDROID_SERIAL`.

### 4. `adb -s <serial> exec-out uiautomator dump /dev/tty`

```
serial_used:
exit_code:
wall_clock_ms:
first_400_bytes:
```

**Pass criteria:**
- exit 0
- first 400 bytes start with `<?xml` (possibly after whitespace / a `Streaming` line)
- `wall_clock_ms < 2000` (validates the 2s day-one timeout won't be tripping on healthy dumps)

**Warning case:** stdout contains a `UI hierarchy dumped to: /dev/tty` line before `<?xml` or after `</hierarchy>` — this is expected, the resolver's trailer-trim handles it. Record for reference.

**Failure case:** stdout doesn't contain `<?xml` — capture stderr in full; file a BrowserStack infra question.

### 5. Fallback path (only run if #4 fails with `exit 0` + no `<?xml`)

```
cmd: adb -s <serial> shell uiautomator dump /sdcard/window_dump.xml
exit_code:
stdout:

cmd: adb -s <serial> exec-out cat /sdcard/window_dump.xml | head -c 400
exit_code:
first_400_bytes:
```

## Decision

Check exactly one:

- [ ] **All four (or three of four with #4 passing) checks pass →** Phase 2 proceeds as planned. Record `ANDROID_SERIAL` behavior in the Phase 2 PR description.
- [ ] **#1 or #3 fails (ADB unreachable / device unauthorized) →** Phase 2 blocks. Document R6 as "unsupported on current BrowserStack Maestro runtime" in README. File a BrowserStack infra ticket.
- [ ] **#4 fails but fallback succeeds →** Phase 2 proceeds; expect the `exec-out /dev/tty` path to trigger the fallback frequently. Record for Unit 7 latency telemetry.
- [ ] **#4 p99 wall-clock > 2s on a static screen →** revisit the day-one timeout value; may need a tighter cap or a configurable knob.

## Spike owner

Fill in:

- Run by:
- Run on (date):
- BrowserStack session URL:
- Device profile:
- Decision committed to plan (link to commit):
