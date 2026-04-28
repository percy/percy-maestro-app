---
title: "iOS element-region resolution fails on BrowserStack — WDA sessionId mismatch, stale sessions, and Node 14 AbortController"
category: integration-issues
module: percy-maestro/ios-element-regions
tags:
  - percy-maestro
  - ios
  - wda
  - webdriveragent
  - browserstack
  - realmobile
  - element-regions
  - session-id
  - node14-compat
  - abort-controller
  - wda-meta-contract
problem_type: integration_issue
component: service_object
root_cause: wrong_api
resolution_type: code_fix
severity: high
date: 2026-04-23
last_validated: 2026-04-23
---

# iOS element-region resolution on BrowserStack Maestro

The iOS element-regions pipeline (SDK → `@percy/cli` relay → WDA `/source`) kept
falling to `wda-error` warn-skip on BrowserStack Maestro hosts even though every
Percy-side unit passed locally. Three independent failures layered on top of
each other. This doc captures all three plus the residual upstream blocker.

## Problem

Percy CLI queries WDA's `GET /session/<sid>/source` to resolve element selectors
(e.g. `{element: {class: "Button"}}`) into pixel bboxes. On BrowserStack iOS
Maestro hosts the call kept failing, surfacing a generic `wda-error` reason tag
that masked three distinct underlying issues:

1. WDA's session-scoped routes reject BrowserStack's `automate_session_id` —
   they require WDA's own internal session UUID.
2. Even after realmobile probes `/status` at write-time, the captured WDA
   sessionId goes stale during the test run.
3. On BS hosts Percy CLI runs on Nix-pinned **Node 14.17.3**, where
   `AbortController` is not a global — our code threw `ReferenceError` before
   any HTTP call fired, and the outer error handler converted that into the
   same generic `wda-error`, hiding the real failure modes.

## Symptoms

- CLI log shows: `[percy:core] iOS element region warn-skip: wda-error`.
- Build passes; snapshots upload; but element regions never resolve. Coord
  regions work.
- Under `PERCY_LOGLEVEL=debug`, the deepest reason is still just
  `wda-hierarchy: wda-error` — no further detail, no status code, no body.

The three underlying shapes, once diagnostics were added:

**1. Wrong-session-type rejection** — WDA returns 404:
```json
{
  "value": { "error": "invalid session id", "message": "Session does not exist" },
  "sessionId": "<currently-active-WDA-UUID>"
}
```

**2. Stale sid after realmobile probe** — `/status` returned
`86D44C9D-EB89-4962-8167-6A91AECA3485` at write time, but by the time Percy
CLI queried `/source` moments later the session had been replaced and WDA
rejected the call.

**3. Silently-swallowed `ReferenceError`** — diagnostic logging revealed:
```
/wda/screen threw name=ReferenceError message=AbortController is not defined
  code=undefined status=undefined aborted=undefined body=(no body) (4354ms)
```
`AbortController` became a Node global only in Node 15. BS hosts are Nix-pinned
to Node 14.17.3.

## What didn't work

- **Writing the `/status` sid and trusting it** — assumed one-shot probe at
  write time captured a durable identifier. WDA's `sessionId` is transient and
  re-issued whenever a new session is created.
- **Assuming `AbortController` is globally available on Node** — it isn't on
  Node 14. The `ReferenceError` was caught by generic error handling and
  surfaced as `wda-error`, which misdirected diagnosis toward WDA itself.
- **Re-probing `/status` on stale-sid detection (alone)** — `/status` often
  returns the same stale sid because it reflects the last-*created* session,
  not the currently-*active* one. Only the top-level `sessionId` in every WDA
  response envelope reliably names the active session.

## Solution

Three fixes, across two repos. **Sequencing matters**: Fix C (Node 14 compat)
must land first or the other two fixes are invisible — any `ReferenceError` is
indistinguishable from a real WDA failure once it hits the generic catch.

### Fix C (ship first): feature-detect AbortController

`@percy/core` — `packages/core/src/wda-hierarchy.js`.

```js
async function callWda(httpClient, url, { timeout } = {}) {
  const HasAbortController = typeof globalThis.AbortController === 'function';
  const controller = HasAbortController ? new globalThis.AbortController() : null;
  if (controller) inflight.add(controller);

  let timedOut = false;
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      if (controller) { try { controller.abort(); } catch {} }
      reject(Object.assign(new Error('wda-timeout'), { __abort: true }));
    }, timeout);
  });

  try {
    const requestOpts = { retries: 0, interval: 10 };
    if (controller) requestOpts.signal = controller.signal;
    return await Promise.race([httpClient(url, requestOpts), timeoutPromise]);
  } catch (err) {
    if (timedOut || (controller && controller.signal.aborted)) {
      throw Object.assign(new Error('wda-timeout'), { __abort: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (controller) inflight.delete(controller);
  }
}
```

### Fix A: realmobile probes `/status` and writes `wdaSessionId`

realmobile — `lib/app_percy/cli_manager.rb`. Contract bumped v1.0.0 → v1.1.0
(see `percy-maestro/docs/contracts/realmobile-wda-meta.md`). New `wdaSessionId`
field is **optional**: readers that support v1.1.0 take the fast path, older
readers silently ignore it.

```ruby
require 'net/http'

WDA_META_SCHEMA_VERSION = '1.1.0'
WDA_SESSION_ID_REGEX = /\A[A-Fa-f0-9\-]{16,64}\z/.freeze
WDA_PROBE_OPEN_TIMEOUT = 1
WDA_PROBE_READ_TIMEOUT = 2

def write_wda_meta(params)
  # ... existing session_id / wda_port validation ...
  wda_session_id = fetch_wda_session_id(wda_port)

  content = {
    'schema_version' => WDA_META_SCHEMA_VERSION,
    'sessionId' => session_id,
    'wdaPort' => wda_port.to_i,
    'processOwner' => Process.uid,
    'flowStartTimestamp' => (Time.now.to_f * 1000).to_i
  }
  content['wdaSessionId'] = wda_session_id if wda_session_id
  write_atomic_0600(session_dir, WDA_META_FILENAME, JSON.generate(content))
end

def fetch_wda_session_id(wda_port)
  uri = URI("http://127.0.0.1:#{wda_port.to_i}/status")
  http = Net::HTTP.new(uri.host, uri.port)
  http.open_timeout = WDA_PROBE_OPEN_TIMEOUT
  http.read_timeout = WDA_PROBE_READ_TIMEOUT
  response = http.request(Net::HTTP::Get.new(uri))
  return nil unless response.is_a?(Net::HTTPSuccess)
  body = JSON.parse(response.body)
  sid = body.is_a?(Hash) ? body['sessionId'] : nil
  return nil unless sid.is_a?(String) && WDA_SESSION_ID_REGEX.match?(sid)
  sid
rescue StandardError
  nil
end
```

### Fix B: Percy CLI extracts the active sid from the error envelope and retries once

`@percy/core` — `packages/core/src/wda-hierarchy.js`. Key insight: **every WDA
response, including error envelopes, embeds the currently-active sid at the
top level**. That value is more authoritative than a `/status` re-probe.

```js
async function fetchAndParseSource(port, sessionId, httpClient) {
  if (!httpClient) return { ok: false, reason: 'no-http-client' };
  const first = await tryFetchSource(port, sessionId, httpClient);
  if (first.ok || !first.staleSession) return first;

  // Prefer the sid the error envelope reports; fall back to /status probe.
  let freshSid = first.wdaReportedSid || null;
  if (!freshSid) freshSid = await fetchCurrentWdaSessionId(port, httpClient);
  if (!freshSid || freshSid === sessionId) {
    return { ok: false, reason: 'wda-error' };
  }
  const retry = await tryFetchSource(port, freshSid, httpClient);
  return retry.ok ? retry : { ok: false, reason: retry.reason || 'wda-error' };
}

async function tryFetchSource(port, sessionId, httpClient) {
  const url = `http://127.0.0.1:${port}/session/${encodeURIComponent(sessionId)}/source`;
  if (!isLoopback(url)) return { ok: false, reason: 'loopback-required' };
  let raw;
  try {
    raw = await callWda(httpClient, url, { timeout: WDA_TIMEOUT_MS });
  } catch (err) {
    if (err && err.__abort) return { ok: false, reason: 'wda-timeout' };
    // @percy/client/utils#request rejects on non-2xx; the parsed body is on err.response.body.
    const body = err && err.response && err.response.body;
    if (isStaleSessionError(body)) {
      return {
        ok: false,
        reason: 'wda-error',
        staleSession: true,
        wdaReportedSid: extractTopLevelSessionId(body)
      };
    }
    return { ok: false, reason: 'wda-error' };
  }
  if (isStaleSessionError(raw)) {
    return {
      ok: false,
      reason: 'wda-error',
      staleSession: true,
      wdaReportedSid: extractTopLevelSessionId(raw)
    };
  }
  // ... XML extraction, size/DOCTYPE guards, parse, flatten ...
}

function isStaleSessionError(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const v = raw.value;
  return !!v && typeof v === 'object' && v.error === 'invalid session id';
}

function extractTopLevelSessionId(raw) {
  const body = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!body || typeof body !== 'object') return null;
  const sid = body.sessionId;
  if (typeof sid !== 'string' || !/^[A-Fa-f0-9-]{16,64}$/.test(sid)) return null;
  return sid;
}
```

Tests added alongside each fix:

- `@percy/core/test/unit/wda-session-resolver.test.js` — 3 new tests for v1.1.0 `wdaSessionId` surfacing.
- `@percy/core/test/unit/wda-hierarchy.test.js` — 5 new tests in a `wda-session-id routing (contract v1.1.0)` describe block, including the error-body-via-thrown-error path.
- `realmobile/spec/lib/app_percy/cli_manager_spec.rb` — 7 new tests for `fetch_wda_session_id` plus an updated `write_wda_meta` schema assertion.

## Why this works

WDA's session lifecycle is not stable across a test run. Sessions are created,
used, and destroyed as the runtime (xcuitest / Maestro) transitions between
apps. Any sid captured at time T can be invalid at time T+δ. What *is*
invariant is that every WDA HTTP response — success or failure, on any route —
embeds the currently-active session id at the top level of the JSON envelope.
That makes the response itself the authoritative source of truth for which
session is addressable right now.

The combined fix treats the written `wdaSessionId` in `wda-meta.json` as a
**hint** rather than a guarantee. First attempt uses the hint (fast path); on
a stale-session error, the active sid is read from the error envelope itself,
and a single retry is issued against that sid. `/status` re-probing remains as
a fallback for the edge case where the error body doesn't carry a usable sid.

Contract v1.1.0 is strictly backward compatible. `wdaSessionId` is optional —
v1.0.0 writers that don't include it simply cause readers to skip the fast
path and rely on the retry logic from the first response. Readers that
understand v1.1.0 get a latency win without lockstep upgrades.

Fix C is the "blocker before the blocker" because the `ReferenceError` from
Node 14's missing `AbortController` was caught by generic error handling and
converted to `{ reason: 'wda-error' }` — identical to a real WDA failure.
Without Fix C, Fix A and Fix B are observationally invisible.

## Prevention

### Rule 1: feature-detect modern globals in any JS that runs on BS hosts

BS hosts are Nix-pinned at Node 14.17.3. `AbortController`, `structuredClone`,
`fetch`, `Blob`, and several other Node 15+ conveniences are absent. Never
let a `ReferenceError` from a missing global be caught and converted to a
domain-specific reason tag.

```js
const HasAbortController = typeof globalThis.AbortController === 'function';
const controller = HasAbortController ? new globalThis.AbortController() : null;
// Use conditionally; provide a Promise.race fallback for timeouts.
```

Consider a startup-time assertion that logs which optional globals are
missing so a silently-degraded path is at least observable.

### Rule 2: in host-integration contracts, prefer runtime discovery over write-time capture for transient values

The contract should carry **stable** coordinates (port, process owner,
session dir) and let the reader **discover** **transient** values (WDA
sessionId) at query time. Writing a transient value is acceptable as a
latency hint but never as the sole source of truth.

Rule of thumb: if a value can change between write and read, the contract
must either (a) include a mechanism for the reader to refresh it, or (b)
include a freshness/TTL marker so the reader knows when to refresh.

### Rule 3: test against real WDA response shapes — especially error envelopes

Happy-path unit tests are insufficient. WDA's error envelope carries
load-bearing information (top-level `sessionId`). Any WDA-facing function
needs tests that assert behavior against:

- 404 with `{ "value": { "error": "invalid session id", ... }, "sessionId": "<active>" }`
- 500 with the same envelope shape
- Network timeout before any response

The new `wda-session-id routing (contract v1.1.0)` describe block in
`test/unit/wda-hierarchy.test.js` is the template for this.

### Rule 4: when using `@percy/client/utils#request`, always test the `err.response.body` path

`@percy/client/utils#request` rejects on non-2xx and attaches the parsed body
at `err.response.body`. Code that only looks at the success path discards
this data.

```js
try {
  raw = await request(url, opts);
} catch (err) {
  const body = err && err.response && err.response.body;
  // Inspect body for protocol-level error signals before deciding failure mode.
}
```

Write at least one unit test per call site that simulates a non-2xx with a
structured body and asserts the handler inspects `err.response.body`.

## Residual upstream blocker (not fixed by this work)

After all three fixes land, `/source` returns a *different* error:

```json
{
  "value": {
    "error": "invalid element state",
    "message": "The application under test with bundle id 'Application 'com.apple.Preferences'' is not running, possibly crashed"
  },
  "sessionId": "<valid active WDA sid>"
}
```

**Root cause:** WDA's `/source` returns the accessibility tree of the app the
WDA session is *attached to*, not the currently-foregrounded app. On BS hosts
the pre-spawned WDA session is attached to whatever app last used it
(Preferences, SpringBoard). Maestro launches the test app via xcuitest — not
through WDA's `POST /session` — so WDA stays pointed at the stale/terminated
app.

**Fix needs realmobile** to re-attach WDA to the foreground app before
spawning Percy CLI, e.g. a `POST /session` on the device's WDA port with the
Maestro-launched bundle id just before `Thread.bs_run { system(cli_start_command) }`
in `AppPercy::CLIManager#start_percy_cli`. Tracked on
[PER-7281 comment 1992677](https://browserstack.atlassian.net/browse/PER-7281?focusedCommentId=1992677).

## Live validation

Proven end-to-end on host `185.255.127.52` during 2026-04-23 session:

- realmobile branch `feat/maestro-percy-ios-integration-clean` deployed, puma
  restarted via `zsh -ilc restart_servers` (auto memory [claude]).
- `@percy/core` Nix overlay applied at
  `/nix/store/6h379s2fwk68pxw8h07b1hh1gw3bdcq0-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/`.
- BS Maestro build on `percy-maestro-ios-regions-demo` branch, device
  `00008110-0011346C0185401E` (port 8408). Machine pinned via bare
  `machine: "<ip>:<device_udid>"` (auto memory [claude]).
- realmobile log confirms: `[AppPercy] wda-meta: wrote /tmp/<sid>/wda-meta.json (port=8408 wda_sid=<UUID>)`.
- Percy CLI log shows the retry infrastructure hit the "app not attached"
  layer — confirming Fixes A/B/C are active and surfacing the remaining
  upstream blocker.

Reference Percy builds:
- Baseline: https://percy.io/9560f98d/app/iosMaestroFinal-bdc9202b/builds/49017965
- Comparison: https://percy.io/9560f98d/app/iosMaestroFinal-bdc9202b/builds/49019734

## Cross-platform reference

The Android equivalent (`percy-maestro-android/docs/solutions/integration-issues/maestro-view-hierarchy-uiautomator-lock-2026-04-22.md`)
hit a different-but-parallel class of failure: adb-uiautomator lock contention
when querying hierarchy alongside an active Maestro flow. Android ultimately
shipped the view-hierarchy query through `maestro --udid <serial> hierarchy`
so it rides Maestro's own gRPC connection instead of fighting it.

iOS is heading toward the same lesson: the hierarchy query needs to
**coordinate with the test-runtime's session**, not fight it. On iOS that
coordination lives in realmobile (the PER-7281 fix) rather than in Percy CLI.

## File references

- `@percy/core` (`feat/maestro-multipart-upload` branch):
  - `packages/core/src/wda-hierarchy.js`
  - `packages/core/src/wda-session-resolver.js`
  - `packages/core/test/unit/wda-hierarchy.test.js`
  - `packages/core/test/unit/wda-session-resolver.test.js`
- realmobile (`feat/maestro-percy-ios-integration-clean` branch):
  - `lib/app_percy/cli_manager.rb`
  - `spec/lib/app_percy/cli_manager_spec.rb`
- percy-maestro:
  - `docs/contracts/realmobile-wda-meta.md` (contract v1.1.0)
  - `docs/experiments/2026-04-22-e2e-demo/findings.md` (live E2E log)
