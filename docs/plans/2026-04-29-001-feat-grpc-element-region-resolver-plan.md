---
title: "feat: Direct gRPC view-hierarchy resolver for Android element regions"
type: feat
status: active
date: 2026-04-29
deepened: 2026-04-29
origin: docs/brainstorms/2026-04-29-phase-2-2-grpc-element-region-resolver-requirements.md
---

# feat: Direct gRPC View-Hierarchy Resolver for Android Element Regions

## Overview

Replace the JVM-cold-start `maestro --udid <serial> hierarchy` shell-out used by
the Percy CLI's element-region resolver with a direct Node gRPC client to
`dev.mobile.maestro` on device port 6790 (host-side via `adb forward`). Drops
per-screenshot resolver latency from ~9s p50 to <100ms p50. Maestro CLI
shell-out is preserved as a graceful fallback for local dev and Maestro
schema drift; the dead `adb exec-out uiautomator dump` path is removed in the
same PR.

The work is contained in one resolver module
(`cli/packages/core/src/maestro-hierarchy.js`) plus a vendored protobuf and a
pair of new gRPC dependencies. No SDK changes
(`percy-maestro-android/percy/scripts/*.js` untouched). No `api.js` handler
changes — the existing request-local memoization at `api.js:496–589` already
calls `dump()` exactly once per request, and that boundary is unchanged.

## Problem Frame

Element-region resolution on `percy-maestro-android` currently shells out to
`maestro --udid <serial> hierarchy`, which boots a fresh JVM, opens a one-shot
gRPC channel to `dev.mobile.maestro` on device port 6790, makes a single
`viewHierarchy` RPC, and exits. Measured p50 / p99 ≈ 9.0s / 9.4s. A
10-screenshot flow with element regions adds ~90s of pure JVM startup; the
actual hierarchy fetch is sub-100ms. The infrastructure for a direct gRPC
client is already in place: `dev.mobile.maestro` runs on the device for the
entire flow duration; BrowserStack pre-configures `adb forward
tcp:<host-port> tcp:6790`; the protobuf is published in the
`mobile-dev-inc/Maestro` repository. (See origin:
`docs/brainstorms/2026-04-29-phase-2-2-grpc-element-region-resolver-requirements.md`.)

## Requirements Trace

Direct mapping to requirements in the origin document:

- **R1** — gRPC client primary on Android; returns the same
  `{ kind: 'hierarchy', nodes }` shape as today.
- **R2** — Maestro CLI shell-out preserved as graceful fallback (local dev,
  schema drift, connection-class errors).
- **R3** — Schema-class failures are loud (WARN + skip element regions); never
  silently masked by falling back to the slow path.
- **R4** — Port discovery: `MAESTRO_GRPC_PORT` env var preferred; `adb -s
  <serial> forward --list` probe is the production-quality primary path.
- **R5** — Adb-fallback `uiautomator dump` + SIGKILL retry path removed in the
  same PR.
- **R6** — Concurrent-access regression test that runs `dump()` while a real
  Maestro flow is actively holding the uiautomator lock — hard merge gate.
- **R7** — `dump took Nms via <grpc|maestro>` log line surfaces the path
  served per request.
- **R8** — Coordinate-region behavior is unchanged (no api.js changes).
- **R9** — `PERCY_MAESTRO_GRPC=0` env-var kill switch forces the maestro CLI
  fallback path; logged loudly on every dump call when active.

## Scope Boundaries

Carried forward from the origin document:

- **iOS is out of scope.** `wda-hierarchy.js` (default iOS path) and
  `runMaestroIosDump` (the `PERCY_IOS_RESOLVER=maestro-hierarchy` switch)
  remain unchanged. Phase 2.3 brainstorm if/when iOS-maestro-hierarchy users
  need similar treatment.
- **No SDK changes.** `percy-maestro-android/percy/scripts/*.js` and `percy/flows/*.yaml` untouched.
- **No api.js handler changes.** Memoization stays where it is.
- **No channel pooling across requests.** Module-scope single Client per
  `(host, port)` is enough; per-CLI-process lifecycle naturally bounds channel
  lifetime (BS spawns a new Percy CLI process per Maestro session).
- **No retries on gRPC failures.** Single-shot per request; classification
  decides fallback vs. skip.
- **No new structured metrics / Honeycomb fields.** Debug log only.
- **No `MAESTRO_BIN` removal.** Still required for the maestro CLI fallback.
- **No CI integration test that spawns a real Android device.** CI has no
  device pool; the concurrent-access test is a documented harness gated by an
  env var (CI skips by default).

## Context & Research

### Relevant Code and Patterns

**Resolver and call site** (`~/percy-repos/cli/`):

- `cli/packages/core/src/maestro-hierarchy.js` — the only file the production
  change lives in. Today's `dump()` entry point at lines 396–465 dispatches to
  `runMaestroDump` (lines 375–394) on Android. `runAdbFallback` (inlined at
  lines 441–461) is what gets removed. `flattenMaestroNodes` (lines 318–347)
  is JSON-tree flattening for the maestro CLI's stdout — survives, used only
  by the fallback path.
- `cli/packages/core/src/api.js:9` — sole import of `dump`/`firstMatch`.
  Line 304 registers the `/percy/maestro-screenshot` route. Line 496 declares
  `cachedDump = null`; line 559 lazy-initializes via `await adbDump({
  platform })`. Memoization shape is unchanged by this work.
- `cli/packages/core/src/adb-hierarchy.js` — 12-line re-export shim. No work.
- `cli/packages/core/src/wda-hierarchy.js` — separate iOS module, untouched.

**XML parsing pipeline** (already proven, reusable for the gRPC path):

- The existing adb-fallback path parses the uiautomator XML envelope using
  `extractXmlEnvelope` (slice between first `<?xml` and first `</hierarchy>`)
  and `fast-xml-parser` (already a dependency). Maestro's
  `ViewHierarchyResponse.hierarchy` is the same XML format — reuse the same
  parser without modification. This is the cleanest part of the design: the
  gRPC path is "remove the JVM, keep the XML parser."

**Subprocess pattern**:

- `cli/packages/core/src/browser.js:256–297` — canonical `cross-spawn` +
  timeout + cleanup pattern. Already mirrored in `spawnWithTimeout` at
  `maestro-hierarchy.js:69–117`. New code does not add subprocess machinery;
  the gRPC client is a standalone async path.

**Test conventions**:

- Jasmine 4.x; `cli/packages/core/test/unit/*.test.js` for unit tests.
- Existing pattern: injected-seam mocking. `dump()` accepts `{ execMaestro,
  execAdb, getEnv }` overrides; tests pass closures with `.calls` log. New
  fourth seam: `grpcClient` (or equivalent factory).
- Fixture dir: `cli/packages/core/test/fixtures/maestro-hierarchy/` already
  contains `simple.xml`, `bad-bounds.xml`, `landscape.xml`, etc. New fixtures
  for gRPC: `grpc-success.xml` (response payload) is the same shape — can
  reuse existing XML fixtures.
- No precedent for spawning a real subprocess in CI; concurrent-access test
  must be either an env-gated harness (skipped in CI) or a manual procedure.

**Build / packaging**:

- `cli/packages/core/package.json` — caret-major pinning convention. `engines:
  ">=14"`. Babel transforms `src/` → `dist/`. Files field publishes only
  `dist/`. Runtime asset precedent: `src/secretPatterns.yml` ships and is read
  at runtime — confirms `.proto` files in `src/proto/` will land in
  `dist/proto/` after build.
- `cli/yarn.lock` is the lockfile (Yarn classic + Lerna workspaces).
- CI: Node 14 across the board (`.github/workflows/test.yml:15, 42, 104`).

**Logger conventions**:

- `import logger from '@percy/logger'`; `const log = logger('namespace')`.
- Reuse `core:maestro-hierarchy` namespace; no new namespace needed.
- Existing source string at `maestro-hierarchy.js:429`: `dump took ${ms}ms via
  maestro (${nodes.length} nodes)`. Extend with `via grpc` for the new path.
  Mirror the existing fallback debug log shape from line 439.

### Institutional Learnings

- **`maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`** — canonical
  prior art. The gRPC client must coexist with `dev.mobile.maestro` (sharing
  its existing uiautomator session) rather than open a second session. The
  doc's Prevention §3 concurrent-access test pattern is the source of R6.
- **`ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md`** —
  cautionary tale for Node 14.17.3. Feature-detect any modern globals;
  log every error name + message + code before normalizing to a reason tag,
  so a `ReferenceError` is distinguishable from a real RPC failure. Use
  `CallOptions.deadline` rather than `AbortSignal` for timeout.
- **`percy-labels-cli-schema-rejection-2026-04-23.md`** — parallel example of
  silent field-stripping. proto3 silently drops unknown fields; if Maestro
  ever adds a field we don't decode, we'll never notice. R3's "loud on
  schema-class errors" is the mitigation; renumbering or retyping
  `hierarchy` would surface as a decode error.
- **`percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md`** — durable
  rollout requires `percy-setup.nix` pin, not host overlays (which canary
  reverts). Memory entry `project_realmobile_canary_overlay_revert.md`
  reinforces this — host patches are ephemeral.
- **`feedback_percy_cli_bs_hosts_node14.md`** — modern Node globals
  (AbortController, structuredClone, fetch, Blob) are absent on BS hosts and
  must be feature-detected. Affects any code we write that touches them.

### External References

- [@grpc/grpc-js on npm](https://www.npmjs.com/package/@grpc/grpc-js) — current
  major `^1.14.3`, `engines.node >= 12.10.0`, supports Node 14.17.3.
- [@grpc/proto-loader README](https://github.com/grpc/grpc-node/blob/master/packages/proto-loader/README.md)
  — runtime proto parsing API.
- [gRPC Deadlines guide](https://grpc.io/docs/guides/deadlines/) —
  `CallOptions.deadline` is the Node-14-safe timeout mechanism.
- [Maestro `maestro_android.proto` upstream](https://raw.githubusercontent.com/mobile-dev-inc/Maestro/main/maestro-proto/src/main/proto/maestro_android.proto)
  — the file to vendor. Service is `maestro_android.MaestroDriver`; RPC is
  `viewHierarchy(ViewHierarchyRequest) returns (ViewHierarchyResponse)`;
  response field is `string hierarchy = 1` (serialized XML).

## Key Technical Decisions

- **Library choice: `@grpc/grpc-js@^1.14.3` + `@grpc/proto-loader@^0.8.0`.**
  Both declare `engines.node >= 12.10.0`; both work on Node 14.17.3. No
  alternative gRPC implementation considered — `@grpc/grpc-js` is the
  reference Node client.
- **Stub strategy: proto-loader at runtime, parse-once at module load.** No
  build-time codegen step. Smaller install footprint (no `grpc-tools` 9MB
  binary as a dev dep), simpler PR review, no codegen step to maintain in a
  package that has none today. Cold parse cost (~15–40ms on first
  `loadSync`) is amortized to module load — never on the request path.
- **Vendor the `.proto`, do not fetch at runtime.** File lives at
  `cli/packages/core/src/proto/maestro_android.proto`. Header comment records
  upstream commit SHA + jar version we copied from. Updates are an explicit
  PR. Drift surfaces as decode errors per R3.
- **Service contract.** `maestro_android.MaestroDriver/viewHierarchy`. Empty
  request; response is `ViewHierarchyResponse { string hierarchy = 1 }` where
  `hierarchy` is serialized UIAutomator XML. **Reuse the existing
  `extractXmlEnvelope` + `parseHierarchy` pipeline** — same XML format as
  the dead adb fallback. **Verified against Maestro source**:
  `mobile-dev-inc/maestro/maestro-android/.../ViewHierarchy.kt` calls a dumper
  whose header comment reads "Logic largely copied from
  `AccessibilityNodeInfoDumper`" (the AOSP class behind `uiautomator dump`),
  emits the same `<hierarchy>` root + `<node>` children with `bounds` in
  `[x,y][x,y]` format that matches our existing `BOUNDS_RE` regex at
  `maestro-hierarchy.js:53`. Maestro adds a few extra attributes
  (`hintText`, `NAF`, `visible-to-user`) that the parser already ignores.
  Unit 0 captures a real fixture so this assumption is exercised in tests,
  not just in source code.
- **Channel lifecycle: module-scope single `Client`, lazy-created on first
  use, keyed by `(host, port)`. Eagerly close + evict on connection-class
  failure.** `grpc.credentials.createInsecure()` (correct for
  `127.0.0.1:<adb-forwarded-port>`). No keepalive tuning. **On any
  connection-class classification (`UNAVAILABLE`, `DEADLINE_EXCEEDED`,
  `INTERNAL`, `CANCELLED`) the resolver calls `client.close()` and deletes
  the cache entry.** The next request lazy-creates a fresh Client. This
  closes the same-port-dead-channel hole — `(host, port)` keying alone does
  not invalidate when adb daemon restarts or `dev.mobile.maestro` restarts
  with the port forward intact (see Risks). It also bounds the blast radius
  of the documented `@grpc/grpc-js` "stuck CONNECTING for ~20s" regression
  on 1.9+ ([grpc-node#2620](https://github.com/grpc/grpc-node/issues/2620))
  and the "lying `READY` state after silent drop"
  bug ([grpc-node#2285](https://github.com/grpc/grpc-node/issues/2285)).
- **Two-tier deadline.** Healthy-call deadline = `Date.now() + 250ms`
  (p50 budget). **Per-call circuit-breaker deadline = 2s** to bound the
  blast radius of stuck-CONNECTING and the silent-drop reconnect path. The
  250ms commit is **provisional**: Unit 6 harness records p99 across N=100
  runs on a real BS device; if measured p99 ≥ 250ms × 0.9, the deadline
  bumps to `p99 × 2` before merge. Tighten only if measurement supports it.
- **Eager-load placement is load-bearing.** `loadSync` runs at module scope
  in the gRPC module, statically imported via the chain
  `percy.js → api.js → maestro-hierarchy.js`. This keeps the 15–40ms
  proto-parse cost off the request path. **If a future refactor converts
  any link to a dynamic `import()`, the cost lands on the first
  element-region screenshot of every CLI process, violating the <100ms p50
  budget.** Add an explicit eager-init hook in `createPercyServer` if that
  refactor ever happens. Until then, static imports are the contract.
- **Schema-drift visibility: healthcheck dirty bit.** First time
  `classifyGrpcFailure` returns a schema-class result, set a module-level
  `schemaDriftSeen = true` and capture the gRPC code + reason. The existing
  `/percy/healthcheck` handler in `api.js` includes one new optional field
  (`maestroHierarchyDrift: { code, reason, firstSeenAt }`) when the bit is
  set. No new metrics infrastructure; uses an existing surface that BS
  infra and the SDK's `percy-healthcheck.js` already consume. Closes the
  silent-drift gap that bit `PERCY_LABELS` per
  `docs/solutions/integration-issues/percy-labels-cli-schema-rejection-2026-04-23.md`.
- **Address: `'127.0.0.1:<port>'` literal, never `'localhost:<port>'`.** Skips
  DNS lookup on every channel creation (saves 1–3ms cold).
- **Timeout mechanism: `CallOptions.deadline`, not `AbortSignal`.** Pass an
  absolute ms-since-epoch number; grpc-js implements the timer with
  `setTimeout` and converts to a `grpc-timeout` HTTP/2 header internally.
  AbortSignal is a Node 14.17.3 risk surface per institutional memory and
  brings no benefit on a request that already has a deadline.
- **Path resolution: `import.meta.url` + `fileURLToPath` + `path.resolve`,
  not `__dirname`.** `@percy/core` is `"type": "module"`. Mirror the pattern
  at `cli/packages/core/src/utils.js:553` (which loads `secretPatterns.yml`
  the same way) and `install.js:145`. The proto path resolves identically
  under `src/` (dev) and `dist/` (publish) because Babel CLI's
  `copyFiles: true` (in `cli/scripts/build.js:25–30`) preserves the relative
  layout.
- **Error classification (R3).**

  | gRPC status | Class | Action |
  |---|---|---|
  | `OK` (0) | Success | Decode + return |
  | `CANCELLED` (1) | Connection-class | Fall back to maestro CLI |
  | `INVALID_ARGUMENT` (3) | **Schema-class** | WARN + skip; no fallback |
  | `DEADLINE_EXCEEDED` (4) | Connection-class | Fall back |
  | `NOT_FOUND` (5) | Connection-class | Fall back (service didn't init) |
  | `PERMISSION_DENIED` (7) | Connection-class | Fall back |
  | `RESOURCE_EXHAUSTED` (8) | Connection-class | Fall back |
  | `FAILED_PRECONDITION` (9) | **Schema-class** | WARN + skip |
  | `OUT_OF_RANGE` (11) | **Schema-class** | WARN + skip |
  | `UNIMPLEMENTED` (12) | **Schema-class** | WARN + skip (Maestro doesn't have the RPC) |
  | `INTERNAL` (13) | Connection-class | Fall back |
  | `UNAVAILABLE` (14) | Connection-class | Fall back (textbook signal) |
  | `DATA_LOSS` (15) | **Schema-class** | WARN + skip |
  | `UNAUTHENTICATED` (16) | Connection-class | Fall back |
  | (decode error, no `code`) | **Schema-class** | WARN + skip |

  Heuristic: `code === undefined || code ∈ {3, 9, 11, 12, 15}` → schema-class.
  Else connection-class. Bake the table into a small classifier function.
- **Port discovery (R4).** `MAESTRO_GRPC_PORT` env var preferred (mobile-repo
  `cli_manager.rb` injects it per CLI process). Fallback: `adb -s <serial>
  forward --list` shell-out, parse for a line matching `tcp:<host-port>
  tcp:6790`. Cache the discovered port for the lifetime of the request (re-use
  the existing memoization pattern: cache as a sibling of `cachedDump` at the
  call site or inline in the resolver). Probe is the operationally primary
  path until the mobile PR merges; env var is a perf optimization
  (skips one adb shell-out, saves ~50–100ms on first dump per request).
- **Kill switch (R9).** `PERCY_MAESTRO_GRPC=0` short-circuits at the top of
  `dump()` (after serial resolution, before port discovery). Routes directly
  to the maestro CLI fallback path. Logged at WARN on every dump call when
  active so the rollback state is observable in the Percy CLI debug log.
- **Removed surface (R5).** `runAdbFallback`, `runDump`, `classifyAdbFailure`,
  `SIGKILL_RETRY_DELAYS_MS`, `MAX_DUMP_BYTES`, `DUMP_TIMEOUT_MS` (rename to
  `ADB_TIMEOUT_MS` and keep the 2s value, since `adb devices` and
  `adb forward --list` still need a timeout). `defaultExecAdb` survives but
  loses its uiautomator-dump caller. The serial-resolution and port-discovery
  paths still need adb shell-outs.
- **Concurrent-access test (R6) is a harness, not a CI spec.** Lives at
  `cli/packages/core/test/integration/maestro-hierarchy-concurrent.harness.js`,
  gated by `MAESTRO_ANDROID_TEST_DEVICE` env var. Self-runs against a
  connected device + active Maestro flow; reports pass/fail; CI without the
  env skips silently. Hard merge gate is "PR description shows green run on
  BS host." Documented in `cli/packages/core/test/integration/README.md`.
- **No api.js changes.** The handler at `api.js:496–589` already memoizes
  `dump()` exactly once per request and reuses the result across element
  regions. Phase 2.2 changes only what `dump()` does internally.

## Open Questions

### Resolved During Planning

- **Library version** → `@grpc/grpc-js@^1.14.3`, `@grpc/proto-loader@^0.8.0`.
  Both Node-14-compatible.
- **Stub generation strategy** → proto-loader at runtime, parse-once at module
  load. Verified eager via the static-import chain
  `percy.js → api.js → maestro-hierarchy.js`.
- **Proto source** → vendor `maestro_android.proto` from
  `mobile-dev-inc/Maestro:maestro-proto/src/main/proto/maestro_android.proto`.
  Header comment with upstream commit SHA + jar version.
- **Service name** → `maestro_android.MaestroDriver` (origin doc said
  `MaestroAndroid` — corrected by external research).
- **Response shape** → `string hierarchy = 1` containing serialized
  UIAutomator XML; **verified against `mobile-dev-inc/maestro/maestro-android/.../ViewHierarchy.kt`**.
  Reuse existing `parseHierarchy` + `extractXmlEnvelope`.
- **Error code mapping** → see decision table above.
- **Timeout mechanism** → `CallOptions.deadline`, not `AbortSignal`. Two-tier:
  250ms for healthy calls, 2s circuit breaker for stuck-CONNECTING blast
  radius.
- **Address format** → `'127.0.0.1:<port>'` literal, IP not DNS.
- **Channel lifecycle** → module-scope single Client per `(host, port)`;
  eagerly close + evict on connection-class failure.
- **Path resolution** → `import.meta.url` + `fileURLToPath` (mirrors
  `utils.js:553`'s `secretPatterns.yml` loader). Not `__dirname` — package is
  ESM.
- **Build-pipeline copy of `.proto`** → automatic via Babel CLI's
  `copyFiles: true` (`cli/scripts/build.js:25–30`). No build-script change
  needed in Unit 1.
- **Log line shape** → extend existing `dump took ${ms}ms via maestro
  (${nodes.length} nodes)` with `via grpc` variant; same suffix.
- **`MAESTRO_GRPC_PORT` env shape** → single port. Matches the
  `ANDROID_SERIAL`-per-CLI-process model.
- **Concurrent-access pause primitive** → `extendedWaitUntil` with an
  impossible selector + a `runScript` sentinel that prints
  `PERCY_PAUSE_BEGIN` to stdout. Selected over `waitForAnimationToEnd:30000`
  (which exits early on screen-settle and silently on timeout — wrong outcome
  for a regression test). `extendedWaitUntil` polls UiAutomator's
  `dumpWindowHierarchy` continuously until the predicate matches or the
  timeout fires; with an impossible selector, the timeout always fires after
  the full 30s and the harness reads the non-zero exit as the "pause window
  ended" signal.
- **Concurrent-access test placement** → env-gated harness, not CI spec.
- **Adb shell-out infra** → `defaultExecAdb` survives for serial resolution +
  port discovery; only the uiautomator-dump caller is removed.
- **Schema-drift surfacing** → healthcheck-response dirty bit, not just a
  debug-log WARN. Avoids the silent-drift gap that bit `PERCY_LABELS`.

### Deferred to Implementation

- [Affects R1] Exact upstream commit SHA for the vendored proto. Set when the
  implementer fetches the file; record in the proto header comment.
- [Affects R3] Whether the schema-class WARN message should include a
  remediation hint (`"upgrade Percy CLI"` / `"file an issue"`) or stay
  minimal. Lean minimal; add hint only if the team flags it during review.
- [Affects R4] Exact regex for parsing `adb forward --list` lines. Format is
  documented as `<serial> tcp:<host> tcp:6790`; confirm whitespace handling
  on macOS / Linux adb versions BS uses.
- [Affects KTD] Final 250ms healthy-call deadline value. Provisional;
  Unit 6's harness records p50/p95/p99 across N=100 runs. If measured p99
  approaches 250ms, bump to `p99 × 2` before merge. The 2s circuit-breaker
  deadline is independent and not provisional.
- [Affects R6] Whether `extendedWaitUntil` with an impossible selector
  reliably holds the uiautomator session continuously across the full 30s on
  the specific BS device profile (Pixel 7 Pro, etc.). Maestro polls in a
  tight loop but releases the session for a sub-millisecond window between
  iterations; verify on real device that the gap isn't exploitable in our
  contention test.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for
> review, not implementation specification. The implementing agent should
> treat it as context, not code to reproduce.*

```
                       dump({ platform, ...seams })
                                  │
                  resolveSerial({ execAdb, getEnv })
                                  │
                  PERCY_MAESTRO_GRPC === '0' ?
                       │ yes                  │ no
                       ▼                      ▼
                runMaestroDump           discoverGrpcPort({ serial,
                (CLI fallback)              execAdb, getEnv })
                                              │
                                        port available ?
                                          │ no (unavailable)
                                          ▼
                                     runMaestroDump (fallback)
                                          │ yes
                                          ▼
                                     runGrpcDump(host, port)
                                          │
                                   ┌──────┴──────────────┐
                                   ▼                     ▼
                              hierarchy             classifyGrpcFailure
                              (success)                  │
                                   │              ┌──────┴──────┐
                                   ▼              ▼             ▼
                              return         schema-class   connection-class
                                            (WARN, skip)    (debug, fall back
                                                             to runMaestroDump)
```

```
runGrpcDump(host, port):
  client ← getOrCreateClient(host, port)        // module-scope cache
  request ← {}                                  // ViewHierarchyRequest is empty
  start ← Date.now()
  response ← client.viewHierarchy(request,
                { deadline: start + 250 })      // Node-14-safe timeout
  xml ← response.hierarchy                      // string field
  envelope ← extractXmlEnvelope(xml)            // existing helper
  nodes ← parseHierarchy(envelope)              // existing helper, reused
  log.debug(`dump took ${Date.now() - start}ms via grpc (${nodes.length} nodes)`)
  return { kind: 'hierarchy', nodes }
```

```
classifyGrpcFailure(err):
  if err.code === undefined         → { kind: 'dump-error', reason: 'grpc-decode' }
  if err.code ∈ {3, 9, 11, 12, 15}  → { kind: 'dump-error', reason: 'grpc-schema-<code-name>' }
  if err.code ∈ {4, 14}             → { kind: 'connection-fail', reason: 'grpc-<code-name>' }
                                       (sentinel that triggers fallback)
  else                              → { kind: 'connection-fail', reason: 'grpc-<code-name>' }
```

Note: `connection-fail` is an internal sentinel used only inside `dump()` to
signal "fall back." It never escapes the function — the caller still sees
`hierarchy` / `unavailable` / `dump-error` per the existing public contract.

## Implementation Units

- [ ] **Unit 0: Capture real Maestro gRPC fixture + verify XML compatibility**

**Goal:** Before any code changes, capture an actual `viewHierarchy`
response from `dev.mobile.maestro` on a BrowserStack Maestro Android session
and commit it as a test fixture. Confirms the Maestro source-code-level
finding (gRPC response is the same UIAutomator XML format as
`adb shell uiautomator dump`) holds on the production runtime — closes the
load-bearing assumption with empirical evidence.

**Requirements:** R1 (prerequisite for the parser-reuse decision).

**Dependencies:** Access to a BrowserStack Maestro Android session per
`project_e2e_validation_state.md`.

**Files:**
- Create: `cli/packages/core/test/fixtures/maestro-hierarchy/grpc-response.xml`
  (the captured XML payload as it comes off the wire)
- Create: `cli/packages/core/test/fixtures/maestro-hierarchy/grpc-capture-notes.md`
  (BS session URL, device profile, Maestro version, capture date, command used)

**Approach:**
- Run `maestro --udid <serial> hierarchy` against a live Maestro session on
  a BS host (the existing CLI already speaks the same gRPC service we're
  about to call directly). Capture the JSON output's nested
  `View Hierarchy` content. The CLI re-serializes; we want the raw XML
  string from the gRPC response itself.
- Cleaner alternative: temporarily add a `console.log` to the new gRPC
  client during Unit 2 development that dumps `response.hierarchy` verbatim,
  run against a BS session, save the captured string, revert the console.log.
- Byte-diff the captured XML against `cli/packages/core/test/fixtures/maestro-hierarchy/simple.xml`
  to confirm structural equivalence. Same `<?xml` prelude, same `<hierarchy
  rotation="...">` root, same `<node bounds="[x,y][x,y]" ...>` children.
  Document any Maestro-added attributes (`hintText`, `NAF`,
  `visible-to-user`) — these are non-breaking; the parser already ignores
  unknown attributes.
- If the XML envelope differs in any structural way (different root tag,
  missing `<?xml` prelude, namespaced elements), **stop and revisit Unit 2's
  parser-reuse decision**. The fix is a new helper, not a fudge of
  `extractXmlEnvelope`.

**Patterns to follow:**
- Existing fixture conventions in `cli/packages/core/test/fixtures/maestro-hierarchy/`.

**Test scenarios:** N/A (this unit produces a fixture; Unit 2's parity test
consumes it).

**Verification:**
- `grpc-response.xml` is committed to the fixture directory.
- The captured XML's `<?xml` prelude and `<hierarchy>` root tag match
  `simple.xml` byte-for-byte (modulo Maestro-added attributes documented in
  notes).
- `cli/packages/core/test/fixtures/maestro-hierarchy/grpc-capture-notes.md`
  records the BS session URL, device profile, Maestro CLI version, and
  capture date, so the fixture is reproducible/refreshable.

- [ ] **Unit 1: Vendor protobuf + add gRPC dependencies**

**Goal:** Bring the `maestro_android.proto` schema into the repo and wire the
two new dependencies into `@percy/core` so subsequent units can import and
load them.

**Requirements:** R1 (prerequisite).

**Dependencies:** Unit 0 (the fixture confirms the parser-reuse decision is
sound before we add dependencies in service of it).

**Files:**
- Create: `cli/packages/core/src/proto/maestro_android.proto` (vendored from
  upstream)
- Create: `cli/packages/core/src/proto/README.md` (records upstream source +
  drift policy)
- Modify: `cli/packages/core/package.json` (add `@grpc/grpc-js@^1.14.3` and
  `@grpc/proto-loader@^0.8.0` to `dependencies`)
- Modify: `cli/yarn.lock` (auto-generated from yarn install)

**Approach:**
- Fetch `maestro_android.proto` from
  `mobile-dev-inc/Maestro:maestro-proto/src/main/proto/maestro_android.proto`
  at the latest stable Maestro release that matches the Maestro CLI version
  deployed on BS hosts (cross-reference `realmobile constants.yml` if
  ambiguous).
- Prepend a header comment to the .proto recording: upstream commit SHA, jar
  version, copy date, drift policy ("regenerate on Maestro version bumps; PR
  must show diff").
- The `src/proto/README.md` documents: source URL, version pin, how to bump.
- **No build-script change required.** Babel CLI's `copyFiles: true` (in
  `cli/scripts/build.js:25–30`) recursively copies non-JS files from `src/`
  to `dist/` preserving relative paths — verified by inspection of
  `secretPatterns.yml`'s presence in both trees today.

**Patterns to follow:**
- `cli/packages/core/src/secretPatterns.yml` — runtime-loaded schema asset
  precedent.
- `cli/packages/core/package.json` — caret-major dependency pinning.

**Test scenarios:** N/A (no behavior change; verified by Unit 2 successfully
loading the proto).

**Verification:**
- `yarn install` succeeds in `cli/`.
- `yarn build` produces `cli/packages/core/dist/proto/maestro_android.proto`.
- `yarn workspace @percy/core test` still passes (no regression from the new
  deps).
- A standalone proto-loader smoke test parses the vendored proto without
  error (Node REPL or short script — no need to commit a verification spec).

- [ ] **Unit 2: gRPC client function (`runGrpcDump`)**

**Goal:** Implement the gRPC dump path as a standalone function that, given a
host and port, calls `MaestroDriver.viewHierarchy` and returns the same
`{ kind, nodes }` shape as `runMaestroDump`. Pure function; no
environmental reads (no `process.env`, no adb).

**Requirements:** R1, R3, R7.

**Dependencies:** Unit 0 (fixture for parity test), Unit 1 (proto + deps).

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js`
- Test: `cli/packages/core/test/unit/maestro-hierarchy-grpc.test.js`

**Approach:**
- At module top-level, load the proto with `@grpc/proto-loader` once. Build
  the `maestro_android.MaestroDriver` constructor as a module-level constant.
  Resolve the .proto path with `import.meta.url` + `fileURLToPath` +
  `path.resolve(..., '../proto/maestro_android.proto')` — mirror
  `cli/packages/core/src/utils.js:553`'s `secretPatterns.yml` loader. Works
  identically under `src/` and `dist/` because the relative layout is
  preserved by Babel's `copyFiles: true`.
- Module-scope a single `Client` cache keyed by `${host}:${port}`. Lazy-create
  on first use. `grpc.credentials.createInsecure()`.
- **On any connection-class failure** (`UNAVAILABLE`, `DEADLINE_EXCEEDED`,
  `INTERNAL`, `CANCELLED`, etc. — see KTD decision table), **call
  `client.close()` and delete the cache entry before returning the
  `connection-fail` sentinel.** This is the load-bearing invalidation
  policy: it closes the same-port-dead-channel hole, bounds the blast
  radius of [grpc-node#2620](https://github.com/grpc/grpc-node/issues/2620)
  (~20s stuck-CONNECTING regression on 1.9+), and prevents the
  fd/timer leak documented at
  [grpc-node#2893](https://github.com/grpc/grpc-node/issues/2893).
- **Two-tier deadline.** `viewHierarchy({})` runs with
  `deadline: Date.now() + 250` (the healthy-call budget). Wrap the call in
  a `Promise.race`-style 2s circuit-breaker that aborts the entire path —
  including any retry the gRPC channel might be doing internally — if the
  RPC hasn't settled by then. Empirically, the 2s breaker fires only when
  the channel is stuck in CONNECTING (the regression #2620). The 250ms
  budget never extends past the breaker.
- New function `runGrpcDump({ host, port, grpcClient = defaultGrpcClient })`
  takes the host and port, calls `viewHierarchy({})` with the two-tier
  deadline, awaits the response, runs `extractXmlEnvelope` +
  `parseHierarchy` on `response.hierarchy`, returns `{ kind: 'hierarchy',
  nodes }`.
- New function `classifyGrpcFailure(err)` per the decision table. Returns
  one of three internal shapes: `{ kind: 'hierarchy' }` (caller's
  responsibility — should never appear here), `{ kind: 'dump-error', reason
  }` (schema-class), or `{ kind: 'connection-fail', reason }` (sentinel for
  fallback). On schema-class, set the module-level `schemaDriftSeen` dirty
  bit (read by the healthcheck handler).
- Inject the `grpcClient` factory as a fourth seam (alongside `execMaestro`,
  `execAdb`, `getEnv`) so unit tests can mock the gRPC call without spawning
  anything.
- Log on success: `log.debug("dump took ${ms}ms via grpc (${nodes.length}
  nodes)")` — mirror line 429's existing source string.
- Log on schema-class failure: `log.warn("gRPC viewHierarchy schema-class
  failure (${reason}); skipping element regions for this request")`.
- Log on connection-class failure: `log.debug("gRPC viewHierarchy
  connection-class failure (${reason}); evicting client + falling back to
  maestro CLI")`.
- Add a one-line root-tag assertion in the parse path: if the parsed
  envelope's root tag is not `hierarchy`, treat as schema-class failure
  (`reason: 'grpc-unexpected-root'`). Defends against a future Maestro
  version that wraps the response.

**Execution note:** Test-first. The error-classification matrix is the
decision boundary that's most likely to drift; a failing test for each row
of the table forces the implementation honest.

**Patterns to follow:**
- `cli/packages/core/src/maestro-hierarchy.js:375–394` (`runMaestroDump`) for
  function shape and return type.
- `cli/packages/core/test/unit/maestro-hierarchy.test.js:10–22` for the
  injected-seam mocking pattern (apply it to a `grpcClient` factory).

**Test scenarios:**
- Happy path: mocked client returns `{ hierarchy: <fixture xml> }` → returns
  `{ kind: 'hierarchy', nodes: [...] }` with the parsed nodes.
- Each schema-class status code (`INVALID_ARGUMENT`, `FAILED_PRECONDITION`,
  `OUT_OF_RANGE`, `UNIMPLEMENTED`, `DATA_LOSS`) → `{ kind: 'dump-error',
  reason: 'grpc-schema-<code-name>' }` and a WARN log line.
- Each connection-class status code (`UNAVAILABLE`, `DEADLINE_EXCEEDED`,
  `INTERNAL`, `RESOURCE_EXHAUSTED`, `CANCELLED`, `UNAUTHENTICATED`,
  `PERMISSION_DENIED`, `NOT_FOUND`) → `{ kind: 'connection-fail', reason:
  'grpc-<code-name>' }` and a debug log line.
- Decode error (rejected promise with no `code`) → `{ kind: 'dump-error',
  reason: 'grpc-decode' }`.
- XML envelope malformed (response field is empty / truncated XML) →
  delegated to `parseHierarchy`'s existing behavior; verify the test fixture
  triggers the existing `dump-error` path.
- Module-scope cache: two consecutive successful `runGrpcDump` calls with
  the same `(host, port)` invoke the gRPC client factory exactly once.
- Port change cache invalidation: changing port on the second call creates
  a new client; previous client's `close()` is invoked.
- **Connection-class eviction**: `runGrpcDump` returns `connection-fail`
  → assert `client.close()` was called and the cache entry was removed.
  Subsequent `runGrpcDump({ host, port })` with the same key creates a
  fresh client.
- **Two-tier deadline**: a deliberately-stuck mock client that never
  resolves → `runGrpcDump` rejects within ~2.05s (circuit breaker), not at
  ~250ms (deadline) and not indefinitely.
- Healthy-call deadline arithmetic: `CallOptions.deadline` is
  approximately `Date.now() + 250` on success-path calls.
- Schema-drift dirty bit: after a schema-class failure, the module-level
  `schemaDriftSeen` flag is `true` and captures the `code` + `reason`.
- Root-tag mismatch fixture: an XML payload with `<root>` instead of
  `<hierarchy>` → schema-class failure with reason `grpc-unexpected-root`.

**Verification:**
- All test scenarios pass.
- `runGrpcDump` returns the same node shape as `runMaestroDump` when both
  receive equivalent fixture data — a parity test asserts identical output
  (this is the strongest test that the XML-vs-JSON-flattener distinction
  doesn't leak).

- [ ] **Unit 3: Port discovery + kill switch**

**Goal:** Add `discoverGrpcPort` (env var → adb-forward probe → unavailable)
and a top-of-`dump()` kill switch that short-circuits to the maestro CLI
fallback when `PERCY_MAESTRO_GRPC=0`.

**Requirements:** R4, R9.

**Dependencies:** Unit 2 (so that there's a target to discover a port for —
not a strict code dependency, but a logical one).

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js`
- Test: extend `cli/packages/core/test/unit/maestro-hierarchy-grpc.test.js`

**Approach:**
- New function `discoverGrpcPort({ serial, execAdb, getEnv })`:
  1. `port ← getEnv('MAESTRO_GRPC_PORT')`. If set and parses as a positive
     integer → return it.
  2. Else: shell out `adb -s <serial> forward --list` via `execAdb` (timeout
     2s). Parse output line-by-line for `<serial>\s+tcp:(\d+)\s+tcp:6790$`.
     First match wins.
  3. Neither yields → return `{ kind: 'unavailable', reason:
     'grpc-port-not-found' }`.
- Inside `dump()`, after `resolveSerial` succeeds:
  1. Check `getEnv('PERCY_MAESTRO_GRPC') === '0'`. If so, log
     `log.warn("PERCY_MAESTRO_GRPC kill switch active; using maestro CLI
     fallback")` and jump straight to `runMaestroDump`.
  2. Else, `discoverGrpcPort` → if `unavailable`, log
     `log.debug("gRPC port not found; using maestro CLI fallback")` and jump
     to `runMaestroDump`.
- Address constructed as `'127.0.0.1:<port>'` (IP literal).

**Patterns to follow:**
- `resolveSerial` at `maestro-hierarchy.js:204–231` — same shape (env first,
  shell-out probe second, return classification on failure).
- The existing `defaultExecAdb` for the shell-out call.

**Test scenarios:**
- `MAESTRO_GRPC_PORT=8206` set → returns `8206` (integer); `execAdb` not
  called.
- `MAESTRO_GRPC_PORT` unset, `adb forward --list` returns multi-line output
  containing `<serial> tcp:8206 tcp:6790` → returns `8206`.
- `MAESTRO_GRPC_PORT` unset, probe returns no matching line → returns
  `{ kind: 'unavailable', reason: 'grpc-port-not-found' }`.
- `MAESTRO_GRPC_PORT` unset, probe times out → `unavailable`.
- `MAESTRO_GRPC_PORT="not-a-number"` → fall through to probe (don't crash).
- `MAESTRO_GRPC_PORT="-1"` → fall through (positive integer required).
- Kill switch: `PERCY_MAESTRO_GRPC=0` → `dump()` calls `runMaestroDump`
  without invoking `discoverGrpcPort` or `runGrpcDump`. WARN logged.
- Kill switch off (`PERCY_MAESTRO_GRPC` unset or non-zero) → normal dispatch.

**Verification:**
- All test scenarios pass.
- Manual smoke on a dev machine: with no env var and a real `adb forward
  tcp:8206 tcp:6790` set up, `discoverGrpcPort` finds `8206`.

- [ ] **Unit 4: Wire gRPC primary into `dump()` with error-class fallback**

**Goal:** Connect Units 2 + 3 into `dump()` so that on Android the resolver
attempts gRPC first; falls through to `runMaestroDump` on connection-class
failure or unavailable port; returns `dump-error` directly on schema-class
failure (no fallback).

**Requirements:** R1, R2, R3, R7.

**Dependencies:** Units 2, 3.

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js`
- Test: extend `cli/packages/core/test/unit/maestro-hierarchy-grpc.test.js`

**Approach:**
- Modify the Android dispatch branch in `dump()` (around lines 425+):
  1. Resolve serial.
  2. Kill switch check (Unit 3) — if active, call `runMaestroDump` and return.
  3. `discoverGrpcPort`. If `unavailable`, call `runMaestroDump` and return.
  4. `runGrpcDump({ host: '127.0.0.1', port })`.
  5. If returns `{ kind: 'hierarchy', ... }` → return.
  6. If returns `{ kind: 'connection-fail', ... }` → log debug, call
     `runMaestroDump`, return.
  7. If returns `{ kind: 'dump-error', ... }` (schema-class) → return as-is.
- The existing `runMaestroDump` call is unchanged; it just becomes the
  fallback rather than the primary.
- `flattenMaestroNodes` (JSON walker) stays — it's used only by
  `runMaestroDump`. The gRPC path uses the XML parser instead.

**Patterns to follow:**
- The existing dispatch shape in `dump()` for ordering and shape.

**Test scenarios:**
- Android, no kill switch, port discovered, gRPC succeeds → `runMaestroDump`
  not called; result from gRPC.
- Android, gRPC `connection-fail` (e.g., `UNAVAILABLE`) → `runMaestroDump`
  invoked; result from CLI fallback.
- Android, gRPC `dump-error` (e.g., `UNIMPLEMENTED`) → `runMaestroDump` NOT
  invoked; `dump-error` returned directly. WARN logged.
- Android, kill switch on → `runMaestroDump` invoked; gRPC path not touched.
- Android, port discovery fails → `runMaestroDump` invoked.
- iOS path unaffected (existing iOS tests still pass).
- The legacy "no element regions" path: `dump()` not called at all by api.js
  (handler memoization gates it on element-region presence). Already
  covered by existing api tests; verify those still pass.

**Verification:**
- All test scenarios pass.
- The existing `maestro-hierarchy.test.js` and `.parity.test.js` continue to
  pass (regression baseline for the maestro CLI fallback path and the JSON
  flattener).
- Manual smoke (deferred to Unit 6 e2e): on a real BS session, the debug log
  shows `dump took Nms via grpc (N nodes)` instead of `via maestro`.

- [ ] **Unit 5: Remove adb-fallback path + log-line audit** *(separate
  follow-up PR — not part of the Phase 2.2 ship PR)*

**Goal:** Delete the dead adb-uiautomator-dump fallback. Audit the log lines
to confirm `via grpc` / `via maestro` are the only two surfaces post-cleanup.
Tighten timeout constants and rename for clarity.

**Requirements:** R5, R7.

**Dependencies:** Phase 2.2 main PR has shipped AND been deployed to BS for
≥1 week with the `via grpc` log line dominating production traffic. Until
then, `runAdbFallback` stays in place as unreachable-but-present code — git
history is not a runtime safety net (per the original origin doc's risk
treatment of "removing the path means a future reviewer can't put it back").
Risk-trade reasoning: the cleanup is small (~80 LOC delete) and trivial to
review, while leaving it in for one extra release cycle costs nothing and
preserves a hot-rollback option if the gRPC primary surfaces an unforeseen
failure mode in production.

**Files:**
- Modify: `cli/packages/core/src/maestro-hierarchy.js`
- Modify: `cli/packages/core/test/unit/maestro-hierarchy.test.js` (delete tests that exclusively cover the dead path)

**Approach:**
- Remove: `runAdbFallback`, `runDump` (the adb-side helper), `classifyAdbFailure`, `SIGKILL_RETRY_DELAYS_MS`, `MAX_DUMP_BYTES`. Their callers in `dump()` go away with the path.
- Rename: `DUMP_TIMEOUT_MS` → `ADB_TIMEOUT_MS` (since it now applies only to `adb devices` and `adb forward --list`, not the dead dump call). Keep the 2s value.
- `defaultExecAdb` survives. Verify its only callers are `resolveSerial` (`adb devices`) and `discoverGrpcPort` (`adb forward --list`). If not, fix.
- Audit `log.debug` / `log.warn` strings in the file; confirm no `via adb` references remain. Update any.
- Top-of-file comment: rewrite the resolver intro to reflect the new ordering: "gRPC primary → maestro CLI fallback. Adb uiautomator dump path removed in 2026-04 due to uiautomator session-lock SIGKILL under live Maestro flows; see `docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`."
- Delete corresponding tests in `maestro-hierarchy.test.js` that exclusively test the removed adb-dump path. Tests for `defaultExecAdb` shape (used by other call sites) stay.

**Patterns to follow:**
- Cross-reference the comment in the file header to the institutional learning doc; mirrors the kind of cross-reference comments already in `maestro-hierarchy.js`.

**Test scenarios:**
- All remaining tests in `maestro-hierarchy.test.js` and the new
  `-grpc.test.js` pass.
- The file no longer contains references to `runAdbFallback`,
  `SIGKILL_RETRY_DELAYS_MS`, etc. (grep verifies).
- The file no longer contains `via adb` log references.

**Verification:**
- `yarn workspace @percy/core test` passes.
- Line count of `maestro-hierarchy.js` decreases meaningfully (current ~503;
  target post-cleanup somewhere in the 400–450 range, depending on how much
  the gRPC code adds).

- [ ] **Unit 6: Concurrent-access regression harness**

**Goal:** Add a documented integration harness that calls `dump()` while a
real Maestro flow is actively holding the uiautomator lock on a connected
Android device, asserts `{ kind: 'hierarchy' }`, and confirms the parallel
Maestro flow remains alive. Skipped in CI; runnable on demand on a dev
machine or a BS host.

**Requirements:** R6.

**Dependencies:** Units 4–5 (full resolver behavior must be in place to
exercise it under contention).

**Files:**
- Create: `cli/packages/core/test/integration/maestro-hierarchy-concurrent.harness.js`
- Create: `cli/packages/core/test/integration/fixtures/pause-30s-flow.yaml`
  (a Maestro flow that holds the uiautomator session for 30s)
- Create: `cli/packages/core/test/integration/fixtures/scripts/percy-pause-sentinel.js`
  (one-line `runScript` that prints `PERCY_PAUSE_BEGIN` for the harness)
- Create: `cli/packages/core/test/integration/README.md`
- Modify: `cli/packages/core/package.json` (optional `scripts:test:integration` entry)

**Approach:**
- Harness is a standalone Node script (not a Jasmine spec — the existing
  Jasmine config doesn't have an integration tier and this work doesn't add
  one). Reads `MAESTRO_ANDROID_TEST_DEVICE` env var; if unset, prints "skip:
  no MAESTRO_ANDROID_TEST_DEVICE set" and exits 0. CI will skip on this
  signal.
- When set, harness:
  1. Spawns `maestro test path/to/pause-30s-flow.yaml` as a child process,
     piping stdout. Watches for the literal sentinel line
     `PERCY_PAUSE_BEGIN` emitted by the flow's `runScript` step.
  2. After seeing the sentinel, calls `dump({ platform: 'android' })` (the
     full public API; no seam injection — this is end-to-end).
  3. Asserts `result.kind === 'hierarchy'` and `result.nodes.length > 0`.
  4. Confirms the `maestro test` child process is still running (`kill -0`).
  5. Records p50/p95/p99 timing across N=100 iterations of step 2 to feed
     the deadline-tuning decision (see KTD provisional 250ms commit).
  6. Sends `SIGTERM` to the maestro child.
  7. Reports pass/fail with timing percentiles.
- **Pause flow primitive: `extendedWaitUntil` with an impossible selector.**
  Maestro's Android driver implements `extendedWaitUntil` as a tight polling
  loop that calls `dumpWindowHierarchy` (UiAutomator's hierarchy API) on
  each iteration. With an impossible selector (e.g.,
  `id: "__percy_harness_never_matches__"`), the predicate never matches and
  the loop runs the full 30s before failing. Every iteration acquires the
  uiautomator session — exactly the contention scenario we want to exercise.
  Treat `maestro test`'s non-zero exit code (the assertion's expected
  failure on timeout) as the "pause window ended" signal; the harness
  swallows it. **Rejected alternatives:** `waitForAnimationToEnd:30000`
  exits early on screen-settle and silently on timeout (wrong outcome);
  `assertVisible` with `timeout:` is inconsistently honored across Maestro
  versions; `runScript` busy-loops do not hold the uiautomator session
  (GraalJS runs out-of-band).
- **Sentinel mechanism:** prepend a `runScript` step to the flow that
  executes the one-line `console.log('PERCY_PAUSE_BEGIN')` script. Maestro
  flushes `runScript` stdout before advancing to the next command, so the
  harness can rely on this sentinel to know the upcoming
  `extendedWaitUntil` is the next thing executing.
- **Known imperfection:** `extendedWaitUntil` is not a hard mutex. There's
  a sub-millisecond gap between iterations of the polling loop where the
  uiautomator session is briefly released. Real-Android session
  acquisition takes 50–200ms, making the gap unexploitable in practice; if
  the harness ever sees flaky passes, this is the suspect.
- `README.md` documents: prerequisites (connected device, `MAESTRO_BIN`
  reachable, `adb forward tcp:<host> tcp:6790` set up or `MAESTRO_GRPC_PORT`
  set), invocation (`MAESTRO_ANDROID_TEST_DEVICE=<serial> node
  test/integration/maestro-hierarchy-concurrent.harness.js`), expected
  output, and "before merging Phase 2.2, paste a green run output + the
  recorded p50/p95/p99 in the PR description."

**Execution note:** This is the merge gate per R6. PR template should require
a paste of the harness output (run on BS host or dev box).

**Patterns to follow:**
- Style: lightweight Node script, `console.log` for progress, exit code for
  pass/fail. No new framework needed.

**Test scenarios:**
- Harness with `MAESTRO_ANDROID_TEST_DEVICE` unset → exits 0 with skip
  message.
- Harness with env var set + connected device + Maestro CLI on PATH →
  `dump()` returns `hierarchy` while the flow is paused; child process still
  alive.
- (Negative control, manual) On a build with the gRPC primary swapped back
  to adb-uiautomator-dump, the harness deterministically fails — proves the
  test detects the SIGKILL class of bug.

**Verification:**
- Harness runs green against a real device + active Maestro flow.
- PR includes the harness output as evidence.
- README documents the workflow clearly enough that another engineer can run
  it without context.

## System-Wide Impact

- **Interaction graph:** Phase 2.2 changes only `dump()`'s internals.
  Callers (`api.js:559`, the `/percy/maestro-screenshot` handler) are
  unchanged. Other callers of `defaultExecAdb` (serial resolution, port
  discovery) are internal to the same file and stay correct.
- **Error propagation:** All gRPC failures classify into the existing public
  contract (`hierarchy` / `unavailable` / `dump-error`) before leaving
  `dump()`. The internal `connection-fail` sentinel never escapes. Behavior
  for the api.js handler is unchanged.
- **State lifecycle risks:** Module-scope gRPC `Client` instances persist
  across requests within one Percy CLI process. Per-session BS process model
  bounds the lifetime — no cross-session leakage. If a port forward is
  dropped mid-process, the next call sees `UNAVAILABLE`, the resolver
  eagerly closes + evicts the cached Client, and the call after that
  recreates fresh against the (possibly new) port. The 2s circuit-breaker
  deadline bounds the worst case.
- **Per-host concurrency:** Each BS host runs N concurrent Percy CLI
  processes (typically 5–50, one per Maestro session). At N=50, the
  resolver opens one HTTP/2 socket per process to a distinct
  adb-forwarded localhost port — ~100 file descriptors and ~25 MB
  aggregate heap across all processes. Negligible against the existing
  per-process Chromium baseline (~150–300 MB RSS). No connection pooling
  needed.
- **API surface parity:** None. The `/percy/maestro-screenshot` JSON contract
  is unchanged. SDK does not change. Both `percy-maestro` (cross-platform)
  and `percy-maestro-android` benefit from the same CLI change because they
  share the relay contract — but `percy-maestro` iOS callers are unaffected
  (Android-only path).
- **Integration coverage:** Unit tests over fixture XML + mocked gRPC client
  cover the parser, error classification, and dispatch logic. Unit 6
  (concurrent-access harness) covers the only failure mode where unit tests
  cannot give signal — the live-Maestro lock contention. Unit 7 e2e
  validation against a real BS session covers everything end to end (already
  documented at `test/e2e-checklist.md`; the post-Phase-2.2 pass needs a
  fresh run with the new debug log shape).

## Risks & Dependencies

**Risk 1 — Maestro proto schema drift.**
- Probability: low-moderate. The proto has been stable across Maestro
  versions in 2026 testing, but `mobile-dev-inc/Maestro` doesn't formally
  version it.
- Impact: If `viewHierarchy` is renumbered or its response field changes
  type, the gRPC path returns `dump-error (grpc-schema-...)` and skips
  element regions for that screenshot. Coordinate regions still upload.
- Mitigation:
  - **Healthcheck-response dirty bit.** First schema-class failure sets a
    module-level flag captured in the `/percy/healthcheck` response payload
    (`maestroHierarchyDrift: { code, reason, firstSeenAt }`). BS infra and
    the SDK already poll healthcheck; drift becomes visible without new
    metrics infrastructure. Closes the silent-drift gap that bit
    `PERCY_LABELS` (see
    `docs/solutions/integration-issues/percy-labels-cli-schema-rejection-2026-04-23.md`)
    where WARN-in-debug-log was the same mitigation that already failed.
  - Vendored proto header records the upstream commit SHA so bumps are an
    explicit PR.
  - Maestro CLI fallback (which talks the same gRPC service through its own
    JVM-shipped proto) provides a graceful degradation — user pays the 9s
    tax until the next CLI release ships a refreshed proto, but element
    regions keep working in the interim.

**Risk 2 — `@grpc/grpc-js` Node 14 incompatibility surface.**
- Probability: low. `engines.node >= 12.10.0` is declared and the library's
  HTTP/2 transport runs on Node's stable `http2` module which is fine on
  14.17.3.
- Impact: A `ReferenceError` from a missing modern global gets caught by the
  resolver's outer try/catch, classifies as something opaque, hides the real
  failure mode.
- Mitigation: Per institutional learning
  `ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md`, log every
  error's `name`/`message`/`code` before normalizing to a reason tag. Test
  on an actual Node 14.17.3 environment (BS host) before declaring done —
  CI catches version-incompatible code only at deploy time per memory
  `feedback_percy_cli_bs_hosts_node14.md`.

**Risk 3 — Concurrent-access harness flakiness.**
- Probability: low-moderate. `extendedWaitUntil`'s polling loop holds the
  uiautomator session continuously across iterations except for a
  sub-millisecond release window between polls. Real-Android session
  acquisition takes 50–200ms, so the gap is practically unexploitable, but
  the harness is not a hard mutex.
- Impact: PR can't merge if the harness is unreliable; or worse, harness
  passes locally but the bug ships.
- Mitigation:
  - Pause flow uses `extendedWaitUntil` with an impossible selector (the
    only Maestro primitive that guarantees hierarchy-polling for the full
    configured duration).
  - `runScript` sentinel (`console.log('PERCY_PAUSE_BEGIN')`) gives the
    harness a deterministic start signal — no race on detecting that the
    pause has begun.
  - Harness reports p50/p95/p99 timing across N=100 iterations so a slow
    run is distinguishable from a wrong-result run.
  - Manual negative-control test (point harness at a build with
    adb-uiautomator-dump as primary, confirm it fails) proves the harness
    has signal.

**Risk 4 — `adb forward --list` parsing fragility across adb versions.**
- Probability: low. Format has been stable for years.
- Impact: probe returns `unavailable` and the resolver falls back to
  maestro CLI — slow but correct. No outage.
- Mitigation: regex testing against fixture stdouts from the adb versions
  BS uses. If a future adb version changes the format, the regex update is
  a one-line PR.

**Risk 5 — `proto-loader` cold-start cost on first call.**
- Probability: certain. ~15–40ms parse cost on `loadSync`.
- Impact: First element-region screenshot of a session pays the cost — IF
  the resolver module isn't loaded eagerly.
- Mitigation: **Verified eager.** The static-import chain
  `percy.js → api.js → maestro-hierarchy.js` is unbroken (verified from
  `cli/packages/core/src/api.js:9` and `percy.js:20–23`). `loadSync` runs
  during CLI cold start (~1.5–3s overall boot), not at first request. p50
  budget is genuinely uncontended. **The placement is load-bearing**: any
  future refactor that converts a link to dynamic `import()` puts the
  parse cost back on the request path. KTD already records this
  constraint.

**Risk 6 — Module-scope `Client` retains a dead channel after a transport
drop.**
- Probability: moderate during multi-hour CLI processes; low under typical
  BS lifecycle (per-session CLI process). Real failure modes:
  (a) `adb` daemon restart → port forward dies but the cache key is
  unchanged; (b) `dev.mobile.maestro` restart with port forward intact;
  (c) the documented
  [grpc-node#2620](https://github.com/grpc/grpc-node/issues/2620) "stuck
  CONNECTING for ~20s" regression on grpc-js 1.9+;
  (d) [grpc-node#2285](https://github.com/grpc/grpc-node/issues/2285)
  "channel reports `READY` after silent TCP drop."
- Impact: Without active mitigation, `(host, port)` keying alone leaves the
  stale Client in place. Subsequent calls fail or hang until the underlying
  HTTP/2 reconnect loop succeeds — a silent perf regression that R7's log
  line would only surface to a debugger reading logs after the fact.
- Mitigation: **Eager close + evict on any connection-class failure.**
  `runGrpcDump` calls `client.close()` and deletes the cache entry before
  returning the `connection-fail` sentinel. The next request lazy-creates
  a fresh Client. Bounds the blast radius to one bad request, not a
  permanent regression. Combined with the **2s circuit-breaker deadline**
  (separate from the 250ms p50 deadline), worst-case wall-clock per
  affected screenshot is ~2.25s before falling back to maestro CLI — still
  far better than the 9s baseline. Also closes the documented fd-leak
  pattern at [grpc-node#2893](https://github.com/grpc/grpc-node/issues/2893).

**Risk 7 — Removing the adb-fallback path before trust is established.**
- Probability: moderate if Unit 5 ships in the same PR as Units 1–4. Low
  with the deepening's split.
- Impact: If gRPC misbehaves in production after Phase 2.2 ships and the
  adb path is already gone, the only hot rollback is reverting the entire
  perf work, not just the cleanup.
- Mitigation: **Unit 5 is split to a separate follow-up PR** gated on
  ≥1 week of `via grpc` log dominance on BS. `runAdbFallback` stays in
  place as unreachable-but-present code in the main PR — git history is
  not a runtime safety net. The cleanup PR is small (~80 LOC delete) and
  trivial to review. The institutional learning doc captures why
  adb-uiautomator is dead under live Maestro flows; the header comment
  added in the cleanup PR cross-references the doc to prevent revival.

**Dependency 1 — `feat/maestro-percy-integration` mobile-repo PR (NOT a
blocker).** Adds `MAESTRO_GRPC_PORT` injection alongside `ANDROID_SERIAL` and
`MAESTRO_BIN`. Phase 2.2 ships independently per R4 — the `adb forward
--list` probe carries production load until the env-var optimization lands.

**Dependency 2 — Durable rollout via `percy-setup.nix` pin, not host
overlay.** Per `project_realmobile_canary_overlay_revert.md`, host overlays
revert nightly. Phase 2.2 must ship as a real `@percy/cli` release, pinned
in `percy-setup.nix`, and rolled out via BS infra's Maestro Android runner
image rebuild. README's "element regions require Percy CLI ≥ X.Y.Z" callout
needs updating to the actually-deployed version.

## Documentation / Operational Notes

- **README CLI version pin update.** After `@percy/cli` ships with Phase
  2.2, update `percy-maestro-android/README.md`'s
  "Element-based regions" callout to `Percy CLI ≥ X.Y.Z` where X.Y.Z is the
  version BS infra actually rolled out (track the runner image version, not
  the npm version).
- **Customer-facing communication.** Phase 2.2 is a perf change, not a
  feature change. No SDK update required for customers. Worth a one-line
  changelog note: "Element-region resolution latency reduced from ~9s to
  <100ms per screenshot." No migration required.
- **Mobile-repo coordination.** File a follow-up to add
  `MAESTRO_GRPC_PORT=<host-port>` to `cli_manager.rb#start_percy_cli`'s env
  injection. Specify how to compute the host port (the `adb forward --list`
  parse result, or the deterministic `8206` if BS standardizes). One-line
  patch on the existing `feat/maestro-percy-integration` branch.
- **Phase 2.3 follow-up (iOS).** Out of scope here. Track separately when
  iOS-maestro-hierarchy users report pain.
- **No monitoring/alerting wiring.** The `dump took Nms via <path>` debug
  log is the only observability addition. If post-rollout adoption warrants,
  wire to Honeycomb in a follow-up — out of scope here.
- **Percy CLI release sequencing.**
  1. Land Phase 2.2 main PR (Units 0–4 + Unit 6 harness) on `cli/` repo's
     main; tag a `@percy/core` release.
  2. Update `@percy/cli` meta-package, tag its release.
  3. BS infra updates `percy-setup.nix` pin + rebuilds the Maestro runner
     image.
  4. Update README CLI version callout.
  5. Run Unit 7 e2e checklist against the post-rollout image; record
     timing telemetry per R7.
  6. Observe production for ≥1 week. Confirm `via grpc` dominates the
     `dump took Nms` log line. No schema-drift dirty bit ever set.
  7. Land Unit 5 cleanup PR (delete `runAdbFallback` + tighten constants).
     Tag a follow-up `@percy/core` release. BS picks it up on next
     `percy-setup.nix` bump.

## Sources & References

- **Origin document:** [`docs/brainstorms/2026-04-29-phase-2-2-grpc-element-region-resolver-requirements.md`](../brainstorms/2026-04-29-phase-2-2-grpc-element-region-resolver-requirements.md)
- **Resolver code:** `~/percy-repos/cli/packages/core/src/maestro-hierarchy.js`
- **Caller (no change):** `~/percy-repos/cli/packages/core/src/api.js:9, 304, 496–589`
- **Subprocess pattern:** `~/percy-repos/cli/packages/core/src/browser.js:256–297`
- **Test patterns:** `~/percy-repos/cli/packages/core/test/unit/maestro-hierarchy.test.js`
- **Runtime asset precedent:** `~/percy-repos/cli/packages/core/src/secretPatterns.yml`
- **Institutional learnings:**
  - [`docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`](../solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md) — uiautomator-lock root cause + concurrent-access test pattern
  - `~/percy-repos/percy-maestro/docs/solutions/integration-issues/ios-wda-session-id-and-node14-abortcontroller-2026-04-23.md` — Node 14 feature-detection rule
  - [`docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md`](../solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md) — durable rollout via percy-setup.nix
  - [`docs/solutions/integration-issues/percy-labels-cli-schema-rejection-2026-04-23.md`](../solutions/integration-issues/percy-labels-cli-schema-rejection-2026-04-23.md) — proto3 silent-drop cautionary tale
- **Auto memory:** `feedback_percy_cli_bs_hosts_node14.md`,
  `project_realmobile_canary_overlay_revert.md`,
  `project_e2e_validation_state.md`
- **External:**
  - [Maestro proto upstream](https://raw.githubusercontent.com/mobile-dev-inc/Maestro/main/maestro-proto/src/main/proto/maestro_android.proto)
  - [Maestro `ViewHierarchy.kt` (Android dumper source — confirms XML format)](https://github.com/mobile-dev-inc/maestro/blob/main/maestro-android/src/androidTest/java/dev/mobile/maestro/ViewHierarchy.kt)
  - [Maestro `MaestroDriverService.kt` (gRPC handler)](https://github.com/mobile-dev-inc/maestro/blob/main/maestro-android/src/androidTest/java/dev/mobile/maestro/MaestroDriverService.kt)
  - [@grpc/grpc-js npm](https://www.npmjs.com/package/@grpc/grpc-js)
  - [@grpc/proto-loader README](https://github.com/grpc/grpc-node/blob/master/packages/proto-loader/README.md)
  - [gRPC Deadlines guide](https://grpc.io/docs/guides/deadlines/)
  - [grpc-node#2620 — channel stuck CONNECTING after reconnect (1.9+)](https://github.com/grpc/grpc-node/issues/2620)
  - [grpc-node#2285 — idle-dropped connections appear READY](https://github.com/grpc/grpc-node/issues/2285)
  - [grpc-node#1340 — `client.close()` semantics](https://github.com/grpc/grpc-node/issues/1340)
  - [grpc-node#2893 — leak when re-init without close](https://github.com/grpc/grpc-node/issues/2893)
  - [Maestro `extendedWaitUntil` docs](https://docs.maestro.dev/api-reference/commands/extendedwaituntil)
