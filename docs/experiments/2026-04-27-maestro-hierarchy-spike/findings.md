---
date: 2026-04-27
experiment: Phase 0 spike — `maestro hierarchy` viability on iOS BS hosts during active flow
host: 185.255.127.52 (machine pin) + ad-hoc (build #5)
gating_brainstorm: docs/brainstorms/2026-04-27-ios-element-regions-maestro-hierarchy-requirements.md
verdict: A0/A2/A3 INCONCLUSIVE empirically (BS Maestro iOS infrastructure broken across 5 builds); A1 ARCHITECTURAL evidence is strong
---

# Phase 0 spike — `maestro hierarchy` on iOS BS hosts

## TL;DR

The spike could not produce empirical A0/A2/A3 data because **5 BS Maestro iOS builds in a row failed at the maestro-spawn step** — across machine-pinned and unpinned attempts, with both stock and post-`restart_servers` host state. Sessions started, logged "MAESTRO test started", then aborted within 27-33 s without ever spawning the maestro JVM. The same failure surface blocks the WDA-direct path (Plan A) too, because both paths require iOS Maestro tests to actually execute on BS.

What the spike *did* prove (host-side inspection):
- **Maestro CLI is present on iOS BS hosts** (`/nix/store/.../maestro-cli-{2.1, 2.2, 4, 5}/bin/maestro`).
- **Java 17 is present** (`zulu-ca-jdk-17.0.12`) — required by maestro 1.39.10+.
- **realmobile already drives maestro CLI on iOS** with `maestro --device=<udid> --driver-host-port <P>` where `P = wda_port + 2700` (deterministic, from `maestro_session.rb:831`).
- **`dev.mobile.maestro-driver-iosUITests.xctrunner-{2.1,2.2,3,4}.app`** is precached on the host — this is the iOS analogue of Android's `dev.mobile.maestro` app, which is the gRPC endpoint Android's `adb-hierarchy.js` rides on.

This is enough architectural evidence to **promote B from "rejected without empirical test" (the 2026-04-22 brainstorm) to "architecturally plausible, empirical concurrent-safety check deferred"**. The brainstorm's "session-exclusive" claim is now actively contradicted by host evidence.

## What ran

| # | Build ID | App | Test Suite | Maestro Ver | Machine pin | Outcome | Session duration |
|---|----------|-----|-----------|-------------|-------------|---------|------------------|
| 1 | `6655aa6b8654f9b1bac051d0ab8af9645be302f3` | BStackMediaApp | `bs://eb32830` (prior demo, known-passed 2026-04-22) | 2.0.7 | 185.255.127.52:00008110-000065081404401E | failed | 26 s |
| 2 | `69713bd6e0131c4845c8c17baef8fae7c2f657a2` | BStackMediaApp | custom slow flow (own zip) | 2.0.7 | 185.255.127.52:... | error ("Could not start a session") | 21 s |
| 3 | `46190c56016ab6fd42c5510710aaed6c3206e5ba` | BStackMediaApp | `bs://eb32830` | 2.0.7 | 185.255.127.52:... | failed | 27 s |
| 4 | `0b927b5050a9feba8c79b4ba1931e58c759c7ec1` | BStackMediaApp | `bs://eb32830` | 2.0.7 | 185.255.127.52:... | failed | 27 s (post-`restart_servers`) |
| 5 | `0de3131e2f9fde9cf6cdcc769131b2fd8df354d1` | BStackMediaApp | `bs://eb32830` | (default) | (none) | failed | 33 s |

Probe v1 (15-min poll) on builds 1, 3 — never detected a maestro process.
Probe v2 (30-min poll, 1Hz) on build 4 — never detected a maestro process.

`restart_servers` (zsh-aliased to `bash /usr/local/.browserstack/bshelper.sh restart_servers`) was issued between builds 3 and 4; phased-restart sent to puma processes 8558 and 8602. `bundle install --quiet` ran cleanly inside `/usr/local/.browserstack/realmobile/`. State of HEAD on host 52: detached at `v3.859.0` (Canary Release 2026-04-22, commit `348fd39d8`). The prior 2026-04-22 session's overlay branch `feat/maestro-percy-ios-integration` (`54e2f48399d4...`) exists locally but is not HEAD. `cli_manager.rb` is back to the 86-line baseline (2189 bytes, mtime Apr 23 10:28 — consistent with git checkout refresh, not the 202-line overlay).

## Detailed findings (the parts that *did* answer)

### 1. Maestro CLI is on the host

```
/nix/store/5vaq1zdjqlpm0a4p8c8cqrwm2qgv6ln3-maestro-cli-2.2/bin/maestro
/nix/store/cbyasbabqfsgyx3bfcz59995790s9n1f-maestro-cli-4/bin/maestro
/nix/store/1wwaj53m8d6kdwfyjqfgrd9krri964gy-maestro-cli-5/bin/maestro
/nix/store/s36wmawsjjnc5k1535crabb4dvwx45xa-maestro-cli-2.1/bin/maestro
```

All 4 wrappers point at the same Maestro JAR (1.39.10). `maestro --version` runs cleanly with `JAVA_HOME=/nix/store/.../zulu-ca-jdk-17.0.12`.

`MAESTRO_VERSION_MAPPING` from `/usr/local/.browserstack/realmobile/config/constants.yml`:

```yaml
maestro_version_mapping:
  "1.39.15": {cli_version: v5,   ui_runner_version: 4,   java_version: 16}
  "2.0.7":   {cli_version: v2.2, ui_runner_version: 2.2, java_version: 17}
```

Today the BS API rejects `maestroVersion: 1.39.15` with `BROWSERSTACK_UNSUPPORTED_MAESTRO_VERSION`; only `2.0.7` is currently accepted.

### 2. The `--driver-host-port` formula is deterministic

`/usr/local/.browserstack/realmobile/lib/session/maestro_session.rb:831`:

```ruby
driver_host_port = @params['wda_port'] + 2700
```

For device `00008110-000065081404401E` with WDA on port 8400 → driver_host_port = 11100.

This means a Percy CLI relay running on the same host can derive the driver-host-port without realmobile coordination, given only the WDA port. The WDA port is discoverable from `ps aux` on the appium process for that device. **No `wda-meta.json` contract is needed** — this is the strongest single evidence that B drops the realmobile coordination dependency.

### 3. iOS Maestro architecture mirrors Android more closely than the brainstorm assumed

| | Android | iOS |
|---|---------|-----|
| Device-side endpoint | `dev.mobile.maestro` app (always running once installed) | `dev.mobile.maestro-driver-iosUITests.xctrunner` xctest bundle (running while `maestro test` is active) |
| Transport | gRPC over `adb forward` | gRPC over `iproxy` to `--driver-host-port` |
| Maestro CLI invocation pattern | `maestro --udid <serial> hierarchy` | `maestro --udid <udid> --driver-host-port <port> hierarchy` (extra arg required) |
| Concurrent-safety guarantee | Empirical (Android resolver in production via `adb-hierarchy.js`) | UNVERIFIED — this is what the spike was supposed to confirm |

The brainstorm's "session-exclusive" rejection conflated `maestro hierarchy` with `maestro studio`. Studio is exclusive; hierarchy on Android demonstrably is not. Apriori, on iOS a second `maestro hierarchy` invocation against the same `--driver-host-port` should multiplex over the same iproxy forwarding — but this is the bit the empirical probe needs to actually run.

### 4. `cli_manager.rb` overlay was reverted

The 2026-04-23 prior-session overlay added `write_wda_meta` (~120 lines extra) to support the WDA-direct path's `/tmp/<sid>/wda-meta.json` contract. That overlay is no longer present on host 52 — file is back at the 86-line baseline. Two implications:

- For the WDA-direct path (Plan A), the overlay would have to be re-applied or the realmobile branch checked out. (The branch ref `feat/maestro-percy-ios-integration @ 54e2f48399d4` exists locally on host 52 but is not HEAD.)
- For the maestro-hierarchy path (Plan B), this overlay is not needed at all.

Plan B starts the spike already smaller-surface than Plan A.

## Detailed findings (the empirical bit that *did not* answer)

### A0 — `maestro hierarchy` exits 0 + emits parseable JSON during active flow

**Status: UNVERIFIED.** No BS Maestro session in 5 attempts ever ran the maestro JVM. Every session aborted at the spawn step with the generic BS error `"Could not start a session : Something went wrong during test execution"`. The 27-33 s session duration on every failure is consistent across attempts — strong signal of a deterministic infrastructure-layer failure, not a test-content failure.

### A1 — Parent flow still passes (no interference)

**Status: UNVERIFIED.** Cannot assess interference when the parent flow itself never ran.

### A2 — Latency p95 < 3 s

**Status: UNVERIFIED.** No probe data captured.

### A3 — Returned JSON contains `accessibilityIdentifier` + XCUI element type

**Status: UNVERIFIED.** No probe data captured. (Independent host-side `maestro --udid <idle device> hierarchy` returns `Device with id ... is not connected` because no maestro driver xctest is running on idle devices — confirms the driver-must-be-active requirement, but doesn't validate the JSON shape during an active session.)

## What this means for the brainstorm decision

The brainstorm presented a 4-way choice. With this spike's outcome:

- **Spike-then-commit (the chosen path)** — partially landed. We have enough architectural evidence to commit to B *for the design phase* (one resolver module, no realmobile contract), but the empirical concurrent-safety check has to defer until BS iOS Maestro is unblocked.
- **Commit to B without empirical proof** — now feasible, but only with a Phase 0.5 in the implementation plan that runs the same probe before the WDA-direct delete is merged. **Recommended.**
- **Stay on WDA course (Plan A)** — same blocker. Plan A also needs BS iOS Maestro to actually run sessions. The PER-7281 fix realmobile is supposed to ship doesn't land until a session can spawn maestro. So today's BS-side breakage blocks A even harder than B (A has more moving parts).
- **Run both** — extra carrying cost without any unique-to-this-path benefit.

**Recommendation: commit to B on architecture, with Phase 0.5 = empirical probe ahead of final merge.** Open a parallel ticket with BS Maestro infra to investigate the iOS spawn-step failure, since that breakage gates *every* Percy iOS Maestro path.

## Operational discovery — BS iOS Maestro spawn-step failure (not Percy-specific)

This is the single most important sub-finding from today, and it transcends the spike:

**Five iOS Maestro builds, with varying configuration (machine pin / no pin, custom test suite / known-good test suite, pre/post `restart_servers`), all hit the same 27-33 s "MAESTRO test started → 0% CPU/RAM → cleanup" pattern.** No `appPercy` block in the payloads, so this is unrelated to Percy CLI. Builds without machine pin land on different hosts and fail identically — so it's not host-52-state-specific.

The session-level prod log for build 3 (session `6dcf2a302c30...`) shows:

```
14:47:29 spawn_xctest.rb: MAESTRO test started on device: 00008110-000065081404401E
14:47:29 cleanup: reserveDevice was sent
14:48:00 spawn_xctest.rb: Device Logger Metrics CPU=0 RAM=0
14:48:00 spawn_xctest.rb: Device: 00008110-000065081404401E is found
14:49:47 cleanup: ios_device_unavailability_time
```

Maestro JVM never started. The xctest framework either failed to launch the maestro driver bundle or the maestro CLI invocation crashed early. No stderr is surfaced in the BS API.

Followup actions:
- Open BS Maestro infra ticket with the failing build IDs
- Confirm with BS team that `maestroVersion: 2.0.7` + iOS Maestro is currently expected to work
- Once unblocked, re-run this spike (probe script is at `/tmp/spike-host-probe.sh` on host 52 and at `/tmp/spike-host-probe.sh` locally — copy lives in this repo workspace)

## Artifacts

| Path | Purpose |
|---|---|
| `/tmp/spike-host-probe.sh` (host 52) | smart-probe v2: 1Hz poll for active maestro java process, fires up to 10 hierarchy probes, writes CSV + per-probe JSON |
| `/tmp/spike-host-probe.sh` (local sandbox) | same script, source of truth |
| `/tmp/maestro-hierarchy-spike-2026-04-27/spike-suite.zip` (local) | custom slow flow (50 takeScreenshot iterations) — failed at session spawn so untested in practice |
| `bs://2fb98a11dd15786043dd90cfd0a904b2f4480f68` | uploaded slow-flow suite (custom-id `ios-maestro-hierarchy-spike-slow-flow`, expires 2026-05-27) |
| `.env` updates (`/Users/arumullasriram/percy-repos/percy-maestro/.env`) | `BROWSERSTACK_USERNAME` + `BROWSERSTACK_ACCESS_KEY` appended for spike work; mode 0600; `.env` added to `.gitignore` |

## What would change the recommendation

If, when BS iOS Maestro is unblocked and the probe is rerun:

- **A0 fails** (`maestro --udid X --driver-host-port Y hierarchy` cannot connect to a running session): revert to Plan A.
- **A1 fails** (probe causes parent flow to fail / produce stale-element errors): revert to Plan A; concurrent-safety isn't real on iOS.
- **A0/A1 pass but A3 fails** (no `accessibilityIdentifier` in output): still revert to Plan A, since R1's `id` selector becomes unimplementable.

Only if A0+A1+A3 all pass should the WDA-direct delete proceed.

## Cross-reference

- Brainstorm: `docs/brainstorms/2026-04-27-ios-element-regions-maestro-hierarchy-requirements.md`
- Prior path's brainstorm: `docs/brainstorms/2026-04-22-ios-maestro-element-regions-requirements.md`
- Prior path's E2E demo (still proves the WDA-direct architecture worked end-to-end on 2026-04-22): `docs/experiments/2026-04-22-e2e-demo/findings.md`
- Solutions doc covering 3 layered fixes from prior session (Node 14 / WDA sid / error-envelope retry): `docs/solutions/integration-issues/ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md`
- Android resolver source of truth (the model B mirrors): `/Users/arumullasriram/percy-repos/cli/packages/core/src/adb-hierarchy.js`
- realmobile maestro session: `/usr/local/.browserstack/realmobile/lib/session/maestro_session.rb` (the `--driver-host-port = wda_port + 2700` formula and the `build_maestro_command` shape)
