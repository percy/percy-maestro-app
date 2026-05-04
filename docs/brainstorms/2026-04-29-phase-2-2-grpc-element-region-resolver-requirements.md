---
date: 2026-04-29
topic: phase-2-2-grpc-element-region-resolver
---

# Phase 2.2 — Direct gRPC View-Hierarchy Resolver for Android Element Regions

## Problem Frame

Element-based regions on `percy-maestro-android` work end-to-end today, but every
element-region screenshot pays a ~9 second wall-clock cost. The cost is JVM cold
start: the Percy CLI relay shells out to `maestro --udid <serial> hierarchy`,
which boots a fresh JVM, opens a one-shot gRPC channel to `dev.mobile.maestro`
on device port 6790, makes a single RPC, and exits. Measured p50 / p99 ≈ 9.0s /
9.4s on BrowserStack hosts. A 10-screenshot flow with element regions adds ~90s
of pure JVM startup. The actual hierarchy fetch is sub-100ms.

Customers using element regions today have a real incentive to avoid them on
long flows or revert to coordinate regions. After this lands, element regions
become competitive on perf with coordinate regions, and the choice between them
becomes purely a maintainability decision.

The infrastructure needed is already in place: `dev.mobile.maestro` is running
on the device throughout any Maestro session, listening on device port 6790
for gRPC; BrowserStack hosts already configure `adb forward tcp:<host-port>
tcp:6790` per device session; the protobuf schema for the `ViewHierarchy` RPC
is published in `maestro-client-X.Y.Z.jar`. No BrowserStack-infra change is
required beyond one extra env var injection in the existing
`cli_manager.rb#start_percy_cli` patch.

## Requirements

- **R1 — gRPC client as primary view-hierarchy source on Android.** The
  `dump()` function in `cli/packages/core/src/maestro-hierarchy.js` calls the
  `maestro_android.MaestroAndroid.ViewHierarchy` RPC over gRPC against the
  host-side port forwarded to device port 6790. Returns the same
  `{ kind: 'hierarchy', nodes }` shape as today.
- **R2 — Maestro CLI shell-out preserved as graceful fallback.** When the gRPC
  primary is unavailable (env var unset and `adb forward --list` probe finds
  nothing) or fails with a connection-class error (port unreachable, TCP
  refused, channel closed), fall back to the existing
  `maestro --udid <serial> hierarchy` shell-out. Logged at INFO level so the
  fallback firing is observable. Local `maestro test` development continues to
  work with no env var.
- **R3 — Schema/protocol failures are loud, not silently masked.** When the
  gRPC primary fails with a schema-class error (RPC parse error, unexpected
  field types, deserialization failure), classify as `dump-error` and skip
  element regions for that request with a single WARN line. Do **not** fall
  back to the maestro CLI on schema-class failures — silent fallback would mask
  Maestro version drift behind a 9s perf regression that's hard to alert on.
- **R4 — Port discovery: production-quality probe; env var as optimization.**
  Phase 2.2 must work on BS today without waiting for the
  `feat/maestro-percy-integration` mobile-repo PR to merge. Primary path:
  parse `adb -s <serial> forward --list` for a line matching
  `tcp:<host-port> tcp:6790` and use that host port. The probe is treated as
  production-quality and is cached per-request alongside the existing dump
  memoization. The `MAESTRO_GRPC_PORT` env var is a perf optimization that
  skips the probe shell-out (saves ~50–100ms per first-dump-of-request); the
  mobile-repo PR adds it when convenient. Resolver classifies `unavailable`
  with a clear reason if both signals fail.
- **R5 — Adb-fallback path removed.** The existing
  `adb exec-out uiautomator dump /dev/tty` + retry-with-backoff code is removed
  from the resolver in the same PR. It is provably SIGKILL-bound under any
  live Maestro flow (see
  `docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`)
  and only fires when both gRPC and maestro CLI are unavailable — implausible
  in any real deployment.
- **R6 — Concurrent-access regression test.** A new integration test asserts
  that `dump()` returns `{ kind: 'hierarchy', ... }` while a Maestro flow is
  actively holding the uiautomator lock on the same device. The test is a hard
  merge gate. Covers gRPC primary; the test harness pauses a real `maestro
  test` flow at a known step and probes the resolver under contention.
- **R7 — Observability: the path served by each resolution is logged.** The
  existing `dump took Nms via <maestro|adb>` log line is extended to include
  `via grpc`. Surfaces unexpected fallback firings as a debuggable signal in
  the Percy CLI debug log, without adding new metrics infrastructure.
- **R8 — Coordinate-region behavior is unchanged.** This work touches only the
  element-region resolution path. Coordinate regions, sync mode, tile metadata,
  test metadata, and the iOS WDA-direct path are not modified.
- **R9 — Kill switch.** A `PERCY_MAESTRO_GRPC=0` env var on the Percy CLI
  process forces the resolver to skip the gRPC primary entirely and use the
  maestro CLI fallback. Lets BS infra disable Phase 2.2 in seconds without a
  runner-image rebuild if a regression is detected post-rollout. Logged loudly
  on every dump call when the kill switch is active so the rollback state is
  observable.

## Success Criteria

- **Latency.** Per-resolver-call p50 < 100ms, p99 < 500ms, measured on
  BrowserStack against a real device under a live Maestro flow. Roughly a
  90× speedup vs. the current ~9s per call.
- **Wall-clock impact.** A representative 10-shot flow with element regions
  drops from ~90s of resolver overhead to under 2s.
- **Reliability under contention.** Concurrent-access integration test (R6)
  passes against `maestro test`'s active uiautomator lock — the same condition
  that broke the original `adb uiautomator dump` approach.
- **Zero coordinate-region regressions.** Existing Unit 6 handler tests and the
  Unit 7 e2e checklist coord-only items continue to pass unchanged.
- **No silent perf regression.** When the gRPC path is healthy, the maestro
  CLI fallback never fires for schema-class reasons (see R3). The dump-path
  log (R7) lets ops verify this on production sessions.

## Scope Boundaries

- **iOS is out of scope.** iOS element regions resolve via `wda-hierarchy.js`
  (WDA-direct) on the default code path, and via maestro CLI's
  `--driver-host-port` arg on the `PERCY_IOS_RESOLVER=maestro-hierarchy`
  branch. Both paths remain unchanged. The gRPC service ports and protobuf
  schemas differ on iOS (XCUITest), and the iOS perf profile is dominated by
  WDA, not JVM startup. A separate brainstorm if it ever becomes worth doing.
- **No changes to the SDK** (`percy-maestro-android/percy/scripts/*.js`,
  `percy/flows/*.yaml`). The contract between SDK and CLI relay is unchanged.
- **No changes to the request-local memoization in `api.js`.** The handler
  continues to call `dump()` at most once per `/percy/maestro-screenshot`
  request and reuses the result across element regions.
- **No channel pooling across requests.** One channel per `dump()` call;
  channel torn down at the end. A 5–30s test session sees ~10–30 dumps; pool
  setup overhead is not worth the lifecycle complexity for that volume.
- **No retries on gRPC failures.** A single attempt with a tight deadline.
  Connection-class failures fall back to maestro CLI (R2); schema-class
  failures skip element regions (R3). Retry would add latency without
  recovering from either failure mode.
- **No new structured metrics / Honeycomb fields.** The debug log line (R7) is
  the only observability addition. Wiring metrics to a dashboard is a follow-up
  if adoption warrants it.
- **No removal of the `MAESTRO_BIN` env var or its mobile-repo injection.**
  Still required for the maestro CLI fallback in R2.

## Key Decisions

- **Primary gRPC + maestro CLI fallback (vs. pure replacement):** Chosen for
  graceful degradation. Local `maestro test` development continues to work
  without manual port-forward setup, and Maestro version drift falls back to a
  slow-but-working path rather than a broken feature.
- **Failover only on connection-class errors (vs. silent failover on any
  error):** Prevents a Maestro upgrade that breaks the protobuf schema from
  silently regressing perf to 9s/shot. Schema drift becomes a loud, alertable
  WARN instead.
- **Env-var-preferred port discovery (vs. probe-only or env-var-only):**
  Mobile repo already injects `ANDROID_SERIAL` + `MAESTRO_BIN` per CLI process;
  adding `MAESTRO_GRPC_PORT` is one more line in the same patch. Probe
  fallback keeps local dev and pre-mobile-PR-merge BS hosts working.
- **Concurrent-access test as hard merge gate (vs. deferred to e2e
  checklist):** The original `adb uiautomator dump` bug shipped because no
  test ran under contention. Same risk applies to gRPC against a busy
  `dev.mobile.maestro`. CI signal is the only way to prevent a future PR from
  reintroducing this class of bug.
- **Adb-fallback removed in the same PR (vs. left in place):** Resolver
  becomes 2-tier (gRPC → maestro CLI). The 3-tier version's bottom rung only
  ever fires under conditions that don't exist in real deployments and
  SIGKILLs the moment they do exist. Carries rot risk: a future reviewer
  could revive it as primary and reintroduce the SIGKILL bug. Removing it now
  is cheaper than maintaining it.

## Dependencies / Assumptions

- **Mobile-repo cli_manager.rb patch is NOT a blocker.** The
  `feat/maestro-percy-integration` branch on `browserstack/mobile` adds
  `MAESTRO_GRPC_PORT` injection alongside `ANDROID_SERIAL` + `MAESTRO_BIN`,
  but Phase 2.2 ships independently per R4: the `adb forward --list` probe
  carries the production load. Env-var injection lands when convenient and
  shaves ~50–100ms per first-dump-of-request. Honors the operational reality
  that host overlays revert on canary nightly — only durable CLI releases
  pinned in `percy-setup.nix` survive (see
  `project_realmobile_canary_overlay_revert.md`).
- **`dev.mobile.maestro` listens on device port 6790 for the entire flow
  duration.** Verified empirically during the Phase 2 SIGKILL investigation
  (`maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`). Two concurrent
  `maestro hierarchy` calls during a live flow both succeeded; gRPC requests
  to the same port via the existing channel will work the same way.
- **`adb forward tcp:<host-port> tcp:6790` is pre-configured by BS.** Standard
  setup; not something we need to install or invoke ourselves.
- **Protobuf schema is stable across the Maestro version range we deploy on
  BS.** The `MaestroAndroid.ViewHierarchy` RPC has been the same shape across
  the Maestro versions in use during 2026 testing (deployed jar:
  `maestro-client-X.Y.Z.jar`). Pin Maestro version range; regen stubs when BS
  bumps. Schema-class errors fall under R3.
- **No new BS-infra ticket required for port forwarding.** Only the env var
  injection.

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R1][Needs research] Exact location of the `MaestroAndroid.proto`
  file inside `maestro-client-X.Y.Z.jar`, and the Maestro version range over
  which the `ViewHierarchy` RPC schema is stable. Determines whether we vendor
  a single .proto and pin compatible versions, or carry multiple versioned
  schemas.
- [Affects R1][Technical] Stub generation strategy: vendor pre-generated
  `@grpc/grpc-js` stubs (faster startup, build step) vs. `@grpc/proto-loader`
  at runtime (simpler, slightly slower channel init). Either should comfortably
  fit the p50 budget; weigh against existing `cli/packages/core` build
  conventions.
- [Affects R6][Needs research] The mechanism for pausing a real `maestro test`
  flow at a known point so the test can probe `dump()` under contention.
  `waitForAnimationToEnd:30000` was used during the original SIGKILL
  investigation; verify it's the right primitive for CI, or whether a custom
  pause flow is needed.
- [Affects R3][Technical] Exact mapping between `@grpc/grpc-js` error codes
  and our `connection-class` vs. `schema-class` classification. Status codes
  like `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `UNIMPLEMENTED`, `INTERNAL` need to
  be sorted into the two buckets explicitly.
- [Affects R7][Technical] Whether the `dump took Nms via grpc` line should
  also surface the negotiated channel options or just the wall-clock. Lean
  toward minimal — only add fields that have proven debugging value.
- [Affects R4][Technical] Whether `MAESTRO_GRPC_PORT` is a single port
  (one-CLI-process-per-device, current BS model) or a `<serial>:<port>` map
  (future-proofing for multi-device-per-CLI hosts). Single port matches the
  existing `ANDROID_SERIAL` shape; revisit if BS infra ever changes.

## Follow-Up Work (out of scope here)

- **iOS parity (Phase 2.3).** The `PERCY_IOS_RESOLVER=maestro-hierarchy` branch
  on iOS pays the same ~9s JVM cost per element-region screenshot. iOS gRPC
  is structurally different: the service runs host-side at
  `driver_host_port = wda_port + 2700`, talks XCUITest under the hood, and
  uses a different protobuf. Worth a Phase 2.3 brainstorm once Android is
  stable on Phase 2.2. The default iOS path (`wda-hierarchy.js`, WDA-direct)
  is already sub-second and unaffected.
- **Structured metrics.** If post-rollout adoption warrants it, wire the
  resolver path/duration into Honeycomb instead of relying solely on the
  Percy CLI debug log.

## Next Steps

→ `/ce:plan` for structured implementation planning
