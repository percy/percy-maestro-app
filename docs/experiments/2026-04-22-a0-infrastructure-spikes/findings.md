---
date: 2026-04-22
experiment: A0 infrastructure verification spikes
plan: docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md
---

# A0 — Infrastructure Verification Spikes

Three ~30min spikes called out in the plan's Phase 0 gate. A0.1 and A0.2 are pure-code and run locally. A0.3 (host-level kill-switch on a real BS iOS host) is external coordination; status captured below.

## A0.1 — AbortController pass-through on `@percy/client/utils#request`

**Question:** Does `@percy/client/utils#request` honor an `AbortController` signal passed through `options`, with `retries: 0` preventing retry-storm on abort?

### Static analysis

Read `cli/packages/client/src/utils.js` (lines 97-232):

- `request()` destructures `{body, headers, retries, retryNotFound, interval, noProxy, buffer, meta, ...requestOptions}` (line 134). `signal` is NOT named in the destructure, so it falls into `...requestOptions`.
- `requestOptions` is spread into `http.request(requestOptions)` at line 228. Node's `http.request` accepts `{signal}` on 16+.
- The `retry()` wrapper (line 97-114) gates retries on `retries-- > 0`. When `retries: 0` is passed, `0-- > 0` is false on first failure, so `reject(err)` fires immediately.
- `RETRY_ERROR_CODES` (line 117-120) is `['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'EAI_AGAIN']`. **`ABORT_ERR` / `AbortError` is NOT on this list.** `shouldRetry` in `handleError` (line 176-180) evaluates `(!!error.code && RETRY_ERROR_CODES.includes(error.code))` which is false for abort, so `handleError` calls `reject(error)` directly, bypassing the retry wrapper entirely.

### Empirical verification

Ran `a0-1-abort-spike.mjs`: spun up a 5-second-delayed local HTTP server, dispatched `request(url, {signal, retries: 0, interval: 10})`, aborted at `t+50ms`.

**Result:**

```json
{
  "elapsed_ms": 52,
  "within_deadline": true,
  "error_name": "AbortError",
  "error_code": "ABORT_ERR",
  "error_message": "The operation was aborted",
  "is_abort": true
}
```

Rejection fired 2ms after abort. No retries observed.

### Conclusion — **PASS**

B3 can use `@percy/client/utils#request` with `{signal: abortController.signal, retries: 0, interval: 10}` as the WDA HTTP client wrapper. No need to fall back to raw Node `http.request` or introduce a new HTTP dependency.

**Plan implications:** None. Plan assumption is verified.

---

## A0.2 — memfs + `chmodSync` mode-bit support

**Question:** Does memfs 3.x (the version installed in `cli/node_modules/memfs`) support `chmodSync` + `fstat` with correct mode bits such that B2's `fstat.mode === 0o100600` check can be exercised in unit tests?

### Empirical verification

Ran `a0-2-memfs-spike.mjs` against memfs 3.4.12:

**Result:**

```json
{
  "fromJSON_creates_file": true,
  "mode_after_fromJSON": "100666",
  "chmod_succeeded": true,
  "mode_after_chmod_octal": "100600",
  "mode_after_chmod_num": 33152,
  "mode_equals_0100600": true,
  "fstat_mode_octal": "100600",
  "fstat_mode_equals_0100600": true,
  "fstat_uid": 502,
  "fstat_nlink": 1,
  "parent_dir_mode_octal": "40700"
}
```

memfs:
- Creates files with mode `100666` (regular file + 0o666) by default via `fromJSON`.
- `chmodSync` to `0o600` succeeds; subsequent `statSync` reports `0o100600` (33152).
- `fstatSync` on an fd opened with `O_RDONLY | O_NOFOLLOW` reports the same mode — critical for B2 because B2 validates via fstat on the opened fd (SEI CERT POS35-C ordering).
- `fstat.nlink === 1` by default, so B2's hardlink-detection check (`st_nlink === 1`) has the correct baseline in tests.
- `fstat.uid` returns the real process uid (502 on this macOS host). The `getuid` dependency injection in B2 works correctly — tests can inject a fake `getuid: () => 502` to match the mocked uid, OR inject a fake `getuid: () => 999` to trigger the wrong-owner branch.
- Parent-directory `chmodSync(sidDir, 0o700)` works; `statSync` reports `0o40700` (`S_IFDIR | 0o700`).

### Conclusion — **PASS**

B2 test harness uses memfs via the existing `mockfs` helper (`cli/packages/config/test/helpers.js:35-95`). No real-tmpdir fallback is needed.

**Plan implications:** None. Plan's backup plan (real tmpdir + `afterEach` cleanup) is not required.

---

## A0.3 — Host-level kill-switch vs tenant-forwarded `appPercy.env`

**Question:** Is `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` read from the Percy CLI process's startup env (host-level, safe from tenant tampering), OR does it reach the relay via `appPercy.env` forwarding (tenant-controlled, a cross-tenant disable vector)?

### Status — **NOT RUN THIS SESSION**

Requires a staging BS iOS host with realmobile running Percy CLI. Not executable in this local session. Captured as an external-coordination Phase 0 gate.

### Current understanding (from plan + repo CLAUDE.md)

- Per `percy-maestro/CLAUDE.md`, realmobile's `CLIManager#start_percy_cli` iterates `@params['app_percy']['env']` and prefixes each `KEY='VALUE'` onto the `percy app exec:start` subprocess command line.
- This means ANY env var a customer adds to `appPercy.env` in their BS build payload reaches the Percy CLI subprocess's startup env.
- **If Percy CLI reads `process.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS` at relay-request time**, a malicious tenant on a shared host could set this in their build payload and disable element-regions for all co-tenant builds sharing the CLI process.
- **Mitigation per plan:** the relay should read the kill-switch value **only once at process startup** (snapshot to a module-local `const DISABLED_AT_STARTUP = process.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS === '1'`), not per-request. Host admins (Percy CLI maintainers / realmobile) invoke Percy CLI with the env var set on the initial process launch; subsequent tenant `appPercy.env` forwards arrive AFTER Percy CLI has already snapshotted.

### Verification plan for A0.3 (post-spike, when a BS iOS host is available)

1. Start Percy CLI on the staging host without the kill-switch set; dispatch an iOS element-region request → should succeed (baseline).
2. Restart Percy CLI with `PERCY_DISABLE_IOS_ELEMENT_REGIONS=1` in the startup env; dispatch the same request → should warn-skip with `'kill-switch-engaged'`.
3. Restart Percy CLI without the kill-switch; submit a BS build where `appPercy.env.PERCY_DISABLE_IOS_ELEMENT_REGIONS = '1'` is set; dispatch an iOS element-region request → **MUST still succeed** (host-level snapshot defeats tenant-forwarded value).
4. If step 3 fails (i.e., tenant-forwarded value reaches the relay), flag as a cross-tenant security blocker; fix the read-scope in B4 (snapshot-at-startup pattern) before Phase 1 proceeds.

**Plan implications:** None immediate. The spike is a staging-host verification; deferring does not block A0.1/A0.2 progress. Surface back to user for scheduling alongside A1 (live WDA experiment on the same host).

---

## Summary

| Spike | Status | Plan implication |
|---|---|---|
| A0.1 AbortController pass-through | **PASS** | None. Plan assumption verified. |
| A0.2 memfs mode bits | **PASS** | None. Real-tmpdir fallback not required. |
| A0.3 host-level kill-switch | **PENDING** (needs BS iOS host) | Plan already prescribes snapshot-at-startup read. External coordination. |

A0.1 and A0.2 unblock Phase 1 from a feasibility-risk standpoint. A0.3 runs alongside A1 on the same BS iOS host.
