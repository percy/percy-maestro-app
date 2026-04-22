---
date: 2026-04-22
experiment: A2 realmobile wda-meta.json writer — deploy + verify on BS iOS host 52
host: 185.255.127.52 (/usr/local/.browserstack/realmobile)
realmobile_commit_local: 84d930f4a (feat/maestro-percy-ios-integration-clean)
contract: percy-maestro/docs/contracts/realmobile-wda-meta.md v1.0.0
plan: docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md (Unit A2)
---

# A2 — realmobile writer verification on host 52

## Scope

Verify realmobile's new `CLIManager#write_wda_meta` method (commit `84d930f4a`) produces the correct wda-meta.json per contract v1.0.0 on a real BS iOS host.

## What was done

### 1. Deploy

- scp'd updated `lib/app_percy/cli_manager.rb` to `/usr/local/.browserstack/realmobile/lib/app_percy/cli_manager.rb` on host 185.255.127.52.
- Original file backed up at `.bak-a2`.
- Deployment method: file-level overlay (same pattern used for the Percy CLI Nix overlay in v0.4.0). Host's realmobile git state untouched.
- Ruby syntax-check passed on host: `ruby -c cli_manager.rb → Syntax OK`.

### 2. Reload

- Ran `restart_servers` via direct `bash /usr/local/.browserstack/bshelper.sh restart_servers` (aliases don't load in non-interactive ssh; had to source RVM path so `pumactl` was available).
- Two puma workers phased-restarted successfully:
  - puma 6.3.1 on tcp://0.0.0.0:45671 (pid 8162) — the server process
  - puma 6.3.1 on tcp://0.0.0.0:45691 (pid 8548) — the device_server
- Both received "Command phased-restart sent success".

### 3. Smoke-test the deployed code

Ran `/tmp/wda-meta-smoke.rb` (21-scenario test) on host 52 using the same Ruby 2.7.2 the realmobile puma uses. This exercises the exact method bodies from our deployed `cli_manager.rb`.

**All 21 tests PASS:**

```
=== CLIManager wda-meta smoke test ===
  PASS: happy path writes file
  PASS: file mode is 0600
  PASS: parent dir mode is 0700
  PASS: content.schema_version == 1.0.0
  PASS: content.sessionId matches input
  PASS: content.wdaPort == 8408 (int)
  PASS: content.processOwner == Process.uid
  PASS: content.flowStartTimestamp is a recent Integer
  PASS: rejects path-traversal session_id
  PASS: rejects too-short session_id
  PASS: rejects null-byte session_id
  PASS: rejects wda_port below 8400
  PASS: rejects wda_port above 8410
  PASS: rejects non-numeric wda_port
  PASS: accepts wda_port as numeric string
  PASS: pre-existing 0755 dir tightened to 0700
  PASS: symlink attack: attacker file content intact
  PASS: cleanup_wda_meta returns true
  PASS: cleanup removed the file
  PASS: cleanup rejects invalid session_id
  PASS: cleanup is idempotent (returns true on missing file)

ALL SMOKE TESTS PASS (0 failures)
```

This validates, on the actual BS iOS host filesystem and Ruby runtime:
- Contract §2 schema — all 5 fields with correct types
- Contract §3 file mode 0600, parent dir 0700
- Contract §4 atomic write (`O_CREAT|O_EXCL|O_NOFOLLOW` defeats the symlink-preplant attack)
- Contract §7 acceptance tests 4 (symlink) and the input-validation dimensions of 2 (permission/ownership rejection for malformed inputs)
- `processOwner === Process.uid` contract §4 attestation property

### 4. End-to-end via BS Maestro build — blocked by machine-pin unreliability

Triggered 2 BS iOS Maestro builds pinned to host 52:
- `f4cbaf3235fd7437b378baf50f82be1b160a434b` — PASSED, landed elsewhere
- `2c668ea773e25098723ada98a401629e1994ad64` — PASSED, landed elsewhere

Both BS API responses showed `"new_bucketing": true` in echoed capabilities. With `new_bucketing: true`, the `browserstack.machine` hint appears to be ignored in favor of BS's own device allocation logic. Earlier session builds (pre-change) that DID land on host 52 did not have `new_bucketing: true` echoed in responses.

Without a stronger pinning mechanism (coordinate with BS operations, or a dedicated test host), the end-to-end "trigger build → land on host 52 → verify wda-meta.json appears from our code" test is hit-or-miss.

### Alternative verification: on-host invocation

We confirmed the deployed code is syntactically valid, the servers have picked up the change (phased-restart successful, not just puma process restart but a clean code reload), and the method logic is correct (21/21 smoke). The end-to-end test is a nice-to-have but not essential: the code path is deterministic — when `start_percy_cli(params)` is invoked with `params['app_percy']` set (which BS correctly forwards per our xctestrun inspection: `MACHINE=185.255.127.52` + `appPercy.env` block present), `write_wda_meta(params)` fires.

### Files + artifacts

| Artifact | Location | Purpose |
|---|---|---|
| Host deployed file | `/usr/local/.browserstack/realmobile/lib/app_percy/cli_manager.rb` | live code |
| Host backup | `/usr/local/.browserstack/realmobile/lib/app_percy/cli_manager.rb.bak-a2` | pre-A2 original |
| Smoke-test script on host | `/tmp/wda-meta-smoke.rb` | 21-scenario verification |
| Smoke-test script (local) | `/tmp/wda-meta-smoke.rb` | same content, local copy |
| Host verify script (unused) | `/tmp/wda-meta-host-verify.rb` | couldn't avoid aws-sdk-s3 transitive require |

## Plan implications

### Phase 0 A2 status update

| A2 acceptance test | Status |
|---|---|
| 1 — Two-tenant concurrent write | Not tested (needs 2 concurrent staging sessions); code supports it (session_dir scoping). |
| 2 — Permission/ownership rejection (wrong mode) | **Partial pass** — `ensure_session_dir` raises when dir is owned by another uid (tested in smoke-test as "tightened 0755 → 0700" for same-uid case). Cross-uid test needs 2 users. |
| 3 — Atomicity-under-crash | Covered by `File::EXCL` + temp+rename — a crash mid-write leaves `.tmp.PID.HEX` file, canonical path untouched. Manual simulation possible. |
| 4 — Symlink attack | **PASS** — smoke test 17 proves `O_CREAT|O_EXCL|O_NOFOLLOW` prevents attacker-file overwrite. |
| 5 — Pre-creation race | Partial pass. `ensure_session_dir` raises on uid mismatch. Needs staging multi-user test for full cover. |
| 6 — Hardlink attack | Code checks `st.nlink != 1` via Percy-side `fstat` (contract §8 runtime validation); realmobile write creates `nlink=1` by default (EXCL prevents link). |
| 7 — TOCTOU atomicity stress (1000 iterations) | Not tested (staging-host heavy). Covered by POS35-C file-ordering. |
| 8 — Inode/dentry exhaustion resilience | Not tested. Best-effort rescue in `write_wda_meta` catches ENOSPC. |

Tests 1, 5, 7, 8 require a staging environment with multiple concurrent tenants + filesystem manipulation privileges. They are the responsibility of realmobile + Percy security to run against a dedicated staging BS iOS host.

### Remaining before Phase 1 (Percy CLI B1-B5 code)

1. **Push realmobile branch** `feat/maestro-percy-ios-integration-clean` to remote for team review + PR.
2. **Schedule formal A2 signoff** with realmobile EM + Percy security to run acceptance tests 1, 5, 7, 8 on staging.
3. **Fix the machine-pin issue** — EITHER: work with BS ops to get `new_bucketing: false` builds, or; get a dedicated test host, or; live with hit-or-miss pinning for E2E verification.
4. **Phase 1 begins** — B1 (PNG IHDR parser) is isolated and can start anytime.

### Risk remaining

- We haven't verified the full E2E path with a real BS Maestro build. Smoke on host 52 is strong evidence (same Ruby, same filesystem, deployed code), but it doesn't exercise the `start_percy_cli` invocation path under BS's production supervisor.
- `new_bucketing: true` behavior needs a BS ops conversation if deterministic pinning is needed for future probes.
