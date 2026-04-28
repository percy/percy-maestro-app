---
title: realmobile ↔ Percy CLI contract — `/tmp/<sid>/wda-meta.json`
version: 1.1.0 (draft for realmobile team review)
date: 2026-04-22
owner: percy-maestro maintainer + realmobile EM (named at sign-off)
status: draft
related_plan: docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md (Unit A2, R6)
---

# realmobile ↔ Percy CLI contract — `wda-meta.json`

## Purpose

On shared BrowserStack iOS hosts, Percy CLI's relay (v1.0+) needs to resolve each iOS Maestro session to its specific WebDriverAgent port so it can query element bounding boxes for `PERCY_REGIONS` resolution. The resolution must be **session-scoped and tamper-resistant** — a co-tenant or malicious process must not be able to redirect Percy CLI to a different tenant's WDA session.

This contract defines how realmobile publishes the (sessionId, wdaPort) mapping to Percy CLI via a session-scoped file in `/tmp`, and how Percy CLI validates it before trusting the value.

**This is a bilateral contract.** Breaking changes require coordination per the post-commit-change protocol below. Non-breaking additive changes require a `schema_version` minor bump.

Prior work this depends on:
- BrowserStack iOS Maestro bridge forwards `appPercy` block into realmobile's session params (confirmed 2026-04-21; v0.4.0 integration).
- realmobile already spawns Percy CLI via `AppPercy::CLIManager#start_percy_cli` on iOS Maestro sessions.

## Threat model this addresses

Percy CLI runs on a shared BrowserStack iOS host where multiple tenants' sessions may be active concurrently. Percy must NEVER query a co-tenant's WDA by mistake, because:

1. Query results could leak across tenants (element labels, UI state) via Percy logs / telemetry aggregation.
2. Wrong-session bounding boxes would mask unintended content in a customer's screenshots.
3. An attacker who can influence which session Percy queries could construct a privilege-escalation path.

Cited precedent: **Apple Secure Coding Guide — Race Conditions and Secure File Operations** (covers CVE-2005-2519, Directory Server private-key temp-file substitution). Apple explicitly warns against `/tmp` for ownership-sensitive data. This contract operates under that anti-pattern knowingly, with layered defenses (per-session dir, ownership attestation, atomic writes, pre-parse validation) to mitigate.

## The contract

### 1. File location

```
/tmp/<sid>/wda-meta.json
```

- `<sid>` is the Maestro session identifier (BrowserStack-assigned UUID, e.g. `ee3e38959d25183296db12fd1f35a3f6678bfe55`).
- `/tmp/<sid>/` is the **session-scoped directory** realmobile already uses for session working files (see v0.4.0 per-session `/tmp/<sid>/` pattern).

### 2. File content — JSON schema

```json
{
  "schema_version": "1.1.0",
  "sessionId": "ee3e38959d25183296db12fd1f35a3f6678bfe55",
  "wdaPort": 8400,
  "wdaSessionId": "079FB256-3ADD-43A3-A5FB-F9B85269F84C",
  "processOwner": 502,
  "flowStartTimestamp": 1745294494000
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `schema_version` | string (semver) | yes | Percy CLI accepts any `"1.*.*"`. Reject any major != 1 with `'schema-version-unsupported'`. |
| `sessionId` | string | yes | Must match the sessionId Percy CLI received in the request payload. Alphanumeric + hyphens, 16–64 chars. |
| `wdaPort` | integer | yes | 8400–8410 (BS's allocated WDA port range on iOS hosts). Any value outside this range → `'out-of-range-port'`. |
| `wdaSessionId` | string | **v1.1.0+**, optional | WDA's internal session UUID (distinct from `sessionId`, which is BS's `automate_session_id`). Percy CLI uses this for `/session/:wdaSid/source` calls — WDA rejects the BS session id on that route. Hex + hyphens, 16–64 chars. When omitted or malformed, Percy CLI falls back to `sessionId` and silently warn-skips if `/source` 404s. |
| `processOwner` | integer (uid) | yes | The uid of the Maestro-spawning process. Percy CLI validates this equals its own `getuid()` via `fstat`. |
| `flowStartTimestamp` | integer (ms epoch) | yes | When realmobile initialized the Maestro session. Percy CLI uses this for freshness validation (see §5). |

### How realmobile obtains `wdaSessionId`

Every WDA response (including `GET /status`) embeds the active session UUID at the top level:
```json
{ "value": { "ready": true, ... }, "sessionId": "079FB256-3ADD-43A3-A5FB-F9B85269F84C" }
```
realmobile probes `GET http://127.0.0.1:<wda_port>/status` at `write_wda_meta` time (short open/read timeouts: 1s/2s), parses the response, and validates the `sessionId` against `/^[A-Fa-f0-9-]{16,64}$/` before writing. The probe is best-effort — any failure (WDA not yet ready, timeout, parse error) causes the field to be omitted; Percy CLI treats omission as a v1.0.0-compatible write.

This relies on the BS host invariant that at most one WDA session is active per device at the moment Percy CLI is spawned.

Future additive fields require minor `schema_version` bump; Percy CLI ignores unknown fields but continues to validate the required ones.

### 3. File mode — strict

- File: **`0600`** (rw- --- ---) owned by the Maestro-spawning process's uid.
- Parent directory `/tmp/<sid>/`: **`0700`** (rwx --- ---) owned by the same uid.
- Both created with `O_NOFOLLOW`-equivalent semantics to defeat symlink pre-creation attacks (see §7).

Percy CLI validates:
- `fstat.st_mode == 0100600` (regular file + 0o600 perms)
- `fstat.st_uid == getuid()` (ownership matches Percy CLI's own uid — which realmobile sets when spawning Percy CLI)
- `fstat.st_nlink == 1` (no hardlink amplification — Apple Secure Coding Guide explicitly calls out unchecked nlink as a vector)
- `S_ISREG(fstat.st_mode)` (regular file, not device node or pipe)

### 4. Write semantics — atomic temp+rename

```
1. Create /tmp/<sid>/ with mode 0700 via `mkdir` equivalent that rejects-if-exists.
2. Write content to /tmp/<sid>/.wda-meta.json.tmp.<pid>.<random> (mode 0600 via open flags).
3. Rename to /tmp/<sid>/wda-meta.json (atomic within the same filesystem).
```

**No partial writes must ever be visible at `/tmp/<sid>/wda-meta.json`.** If realmobile crashes between steps 2 and 3, Percy CLI's JSON.parse will fail on the missing file or (transiently) on a previous session's stale file — both trigger `fail-closed`.

Rationale for no direct-write-to-target: avoids a window where Percy CLI reads a partial JSON.

### 5. Freshness semantics

The `flowStartTimestamp` must be **recent relative to Percy CLI's own startup** at the time of the first read.

- Percy CLI captures its own startup time at process init.
- On first request for this `sessionId`, Percy CLI checks `flowStartTimestamp >= (Percy CLI startup time − 5 minutes)`.
- If stale → `fail-closed` with `'stale-timestamp'`.

Rationale: defends against stale wda-meta.json files from previous (now-dead) sessions being left behind after realmobile cleanup failed.

**Tolerance window:** 5 minutes covers common Percy CLI restart-after-crash scenarios. If realmobile exposes a hook to rewrite `wda-meta.json` on Percy CLI restart (optional, v1.1+), the tolerance can tighten.

Filesystem mtime / ctime are **untrusted** — only the JSON-internal `flowStartTimestamp` participates in freshness validation. `flowStartTimestamp` must be a trusted value realmobile writes, not derived from filesystem state.

### 6. Cleanup

- realmobile deletes `/tmp/<sid>/` (recursively) at session end — before the next BS session is assigned to this host.
- Cleanup is a best-effort responsibility; Percy CLI's freshness check (§5) provides a second line of defense against stale files.

### 7. Security acceptance tests (all 8 must pass on staging BS iOS host before implementation begins)

These are runnable test scenarios — realmobile and Percy-side together — that verify the contract's security properties hold in practice. Implementation on the Percy CLI side (Unit B2 of the plan) must validate against every scenario.

**Test 1 — Two-tenant concurrent write.**
Two tenants' realmobile instances write to `/tmp/<sidA>/` and `/tmp/<sidB>/` concurrently. Percy CLI for tenant A must read only tenant A's file. Assertion: no cross-tenant leak under concurrent load.

**Test 2 — Permission/ownership rejection.**
Realmobile deliberately writes with wrong mode (`0666`), wrong owner, or wrong parent-dir mode. Percy CLI must reject each case with a distinct scrubbed reason tag (`'wrong-mode'`, `'wrong-owner'`, `'wrong-parent-mode'`).

**Test 3 — Atomicity-under-crash.**
Simulate realmobile crash mid-write (truncated JSON). Percy CLI must reject with `'malformed-json'`; must never partial-parse and act on invalid data.

**Test 4 — Symlink attack.**
Pre-create `/tmp/<sid>/wda-meta.json` as a symlink to `/etc/passwd` **before** realmobile starts the session. Percy CLI's `open(O_NOFOLLOW)` must return `ELOOP` → reject with `'symlink'`. realmobile's own directory-creation must also reject-if-exists (§4 step 1) so the attacker can't pre-own the directory.

**Test 5 — Pre-creation race.**
Co-tenant pre-creates `/tmp/<sid>/` with attacker-controlled mode (`0777`). realmobile's session start must detect the pre-existing dir and fail-closed (session cannot start); this is realmobile's responsibility, not Percy CLI's.

**Test 6 — Hardlink attack (Apple Secure Coding Guide).**
Attacker pre-creates `/tmp/<sid>/wda-meta.json` as a hardlink to their own regular file (not a symlink). realmobile writes via temp+rename. Percy CLI's `fstat.st_nlink` on the opened fd must be `1`; must reject `'multi-link'` if `>= 2`. (iOS `/tmp` does NOT consistently enforce `fs.protected_hardlinks` like Linux.)

**Test 7 — TOCTOU atomicity stress.**
Co-tenant process in tight loop swaps `/tmp/<sidA>/wda-meta.json` between a valid file and a symlink to `/etc/passwd`. Run Percy CLI's validator in 1000 iterations against this live race. Assertion: zero successful symlink-substitutions; every invalid iteration returns `symlink`-class or `multi-link`; `/etc/passwd` is never successfully opened. This exercises the SEI CERT POS35-C file-ordering property (`open(O_NOFOLLOW)` + `fstat`, **no `lstat` prefix**).

**Test 8 — Inode/dentry exhaustion resilience.**
Fill `/tmp` to the tenant's file-count quota before realmobile attempts to create `/tmp/<sidA>/`. Assertion: realmobile fails cleanly (no crash, no partial state); Percy CLI returns `'missing'`; element regions warn-skip; coord regions + screenshots unaffected. Verifies fail-closed posture under ops-layer DoS.

### 8. Runtime validation contract (Percy CLI side)

Percy CLI must implement these checks on every `/percy/maestro-screenshot` iOS request — not once per session:

```
1. path = "/tmp/" + sanitize(sessionId) + "/wda-meta.json"
2. fd = open(path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
   → ELOOP → reject 'symlink'
   → ENOENT → reject 'missing'
3. stat = fstat(fd)
   → stat.mode !== 0o100600 → reject 'wrong-mode'
   → stat.uid !== getuid() → reject 'wrong-owner'
   → stat.nlink !== 1 → reject 'multi-link'
   → !S_ISREG(stat.mode) → reject 'not-regular-file'
4. content = read(fd); close(fd)
5. meta = JSON.parse(content)
   → throws → reject 'malformed-json'
6. schema version check
   → meta.schema_version semver-major !== 1 → reject 'schema-version-unsupported'
7. field validation
   → !isInteger(meta.wdaPort) or wdaPort < 8400 or wdaPort > 8410 → reject 'out-of-range-port'
   → meta.sessionId !== request.sessionId → reject 'session-mismatch'
8. freshness check
   → meta.flowStartTimestamp < (percy_cli_startup - 5min tolerance) → reject 'stale-timestamp'
9. construct URL as `http://127.0.0.1:${meta.wdaPort}/...`
   → no DNS resolution; IP-literal only (defeats DNS-rebind)
```

**Critical ordering:** `open` with `O_NOFOLLOW` comes BEFORE any `stat` call on the path. Do NOT prefix with `lstat` (textbook TOCTOU window per SEI CERT POS35-C). The `O_NOFOLLOW` is the atomic race-free symlink check; `fstat` on the resulting fd is the authoritative mode+ownership check.

## Post-commit-change protocol

Once this contract is signed off and both sides ship v1 implementations, any subsequent change requires coordination:

**Breaking changes** (changes that would cause existing Percy CLI validators to reject valid-in-new-scheme files):
- Renaming or removing fields
- Changing `schema_version` major
- Changing file location (e.g., `/tmp/<sid>/wda-meta.json` → a different path)
- Changing mode requirements (e.g., 0600 → 0640)
- Changing write semantics in a way that breaks atomicity

**Procedure for breaking changes:**
1. realmobile team announces the change 2 weeks in advance in the named coordination channel (see §Coordination Channels below).
2. Joint regression test run on a staging BS iOS host — realmobile ships the change; Percy CLI runs the 8 acceptance tests against the new shape.
3. Only after regression is green does realmobile ship the change to production.
4. Percy CLI releases a new version that accepts the new `schema_version` major (if needed) in parallel.

**Non-breaking additive changes** (new optional fields, stricter validation):
- Minor `schema_version` bump (e.g., 1.0.0 → 1.1.0)
- realmobile can ship immediately; Percy CLI v1 ignores unknown fields gracefully.
- Percy CLI v1.1+ that uses the new fields must be deployed before realmobile enforces them.

## Coordination channels

Proposed (realmobile team confirms at sign-off):

- **Primary:** Slack `#percy-maestro-realmobile-sync` — breaking-change announcements, incident coordination, weekly canary results.
- **Async:** Confluence page `Percy ↔ realmobile iOS contract` — contract doc, change log, open items.
- **Incident:** shared on-call alias (named at sign-off).

A weekly contract-conformance canary run of the 8 acceptance tests against a staging BS iOS host is a post-GA operational commitment; owner named at sign-off (likely Percy CLI on-call).

## Open items for realmobile review

- [ ] Confirm realmobile can create `/tmp/<sid>/` with mode 0700 reject-if-exists semantics. (What does realmobile's current `mkdir` pattern look like?)
- [ ] Confirm realmobile can do temp+rename atomic write with mode 0600. (What does the Ruby/Go equivalent look like on iOS hosts?)
- [ ] Confirm realmobile owns `<percy-cli-spawning-process>.uid` in a way Percy CLI's `getuid()` will match. (Current v0.4.0 spawning pattern from `AppPercy::CLIManager#start_percy_cli` — does the uid match when Percy CLI is spawned?)
- [ ] Agree on the coordination channel (Slack channel name + Confluence page URL).
- [ ] Agree on post-commit-change protocol timing (2 weeks is a starting point).
- [ ] Assign owner for weekly contract canary post-GA.

## Approval

| Party | Name | Signed | Date |
|---|---|---|---|
| Percy CLI maintainer | | | |
| realmobile EM | | | |
| Percy security | | | |

## Revision history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0.0-draft | 2026-04-22 | Initial draft for realmobile team review | percy-maestro maintainer |
| 1.1.0-draft | 2026-04-23 | Add `wdaSessionId` (optional) — carries WDA's internal session UUID so Percy CLI can call `/session/:sid/source`. Discovered during live E2E on host 52 that WDA rejects BS's `automate_session_id` on session-scoped routes. Writer probes `GET /status` to obtain it; field omitted on probe failure (v1.0.0-compatible). | percy-maestro maintainer |
