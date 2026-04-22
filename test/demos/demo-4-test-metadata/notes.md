# Demo 4 — Test Metadata

**Caption:** `PERCY_TEST_CASE` groups snapshots in the dashboard; `PERCY_LABELS` split on comma; `PERCY_TH_TEST_CASE_EXECUTION_ID` reaches the Percy payload (no customer-visible rendering surface as of 2026-04-22 — verified via CLI debug log).

**Plan:** `docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md`

## Customer-facing takeaway

"Use `PERCY_TEST_CASE` to group Maestro snapshots under named test cases in the Percy dashboard. Use `PERCY_LABELS` (comma-separated) to tag them. Both behave the same as the other Percy SDKs (appium-python, espresso-java). Use `PERCY_TH_TEST_CASE_EXECUTION_ID` if you are integrating with BrowserStack Test Observability — the field reaches Percy but has no dedicated dashboard surface today; the value is carried for downstream TestHub correlation, visible in the Percy CLI debug log."

## Percy branch and commit

Single build on one branch (no pairing needed):

| Run | `PERCY_BRANCH` | `PERCY_TARGET_BRANCH` | `PERCY_COMMIT` |
|---|---|---|---|
| Demo 4 (single) | `percy-demo-d4-meta-20260422-d4000000` | `percy-demo-d4-meta-20260422-d4000000` | `d4000000000000000000000000000000aaaaaa00` |

The `-d4000000` run-token suffix mirrors Demo 3's convention; it future-proofs the branch against concurrent-operator collision even though this is a single run.

**Pre-dispatch validation:**

```bash
echo "d4000000000000000000000000000000aaaaaa00" \
  | grep -qE '^[0-9a-f]{40}$' && echo "OK" || echo "FAIL"
```

## Dispatch

Single dispatch through the runbook's `percy_maestro_build` function. Key env on `appPercy.env`:

- `PERCY_TOKEN` — the demo project's Percy token.
- `PERCY_LOGLEVEL=debug` — needed for the `thTestCaseExecutionId` grep proof.
- `PERCY_BRANCH`, `PERCY_TARGET_BRANCH`, `PERCY_COMMIT` — per the table above.

Build-dispatch JSON `machine:` pin: `"31.6.63.33:28201FDH300J1S"`.

## What to look at in Percy (dashboard-visible proofs)

Open the Demo 4 Percy build URL. Expected:

- **Test-case grouping:** filter/group by test case → two groupings visible: `HomeFlow` and `SettingsFlow`. Each contains one snapshot.
- **Labels split:** open either snapshot's detail view → labels appear as separate tags. `HomeFlow_Landing` shows **three** tags (`smoke`, `home`, `critical`) — not one concatenated `"smoke,home,critical"`. `SettingsFlow_Main` shows **two** (`smoke`, `settings`). This confirms `tagsList(labels)` at `cli/packages/client/src/client.js:466` is splitting on comma.

## CLI log grep (post-run, for thTestCaseExecutionId proof)

On host `31.6.63.33`, in the most recent Maestro session's CLI log:

```bash
grep 'thTestCaseExecutionId' <percy.log>
# Expected: two matches, both containing "thTestCaseExecutionId":"TH-DEMO-4-20260422"
# — one per snapshot upload payload.
```

## JSON-API confirmation probe (5 min, not an investigation)

Document review (2026-04-22) pre-resolved that no `percy-api` serializer exposes `testhub_testcase_execution_id`:

- Field is written to `test_case_executions.testhub_testcase_execution_id` (schema.rb:1192) via `percy-api/app/controllers/api/v1/snapshots_controller.rb:168`.
- But no serializer surfaces it — not `Percy::SnapshotSerializer`, not `Percy::TestCaseExecutionSerializer`, and `percy-web` has zero references.

Run the following to confirm the gap still applies on the day of execution (in case a `percy-api` serializer change landed in the interim):

```bash
curl -s -u "$PERCY_TOKEN:" \
  "https://percy.io/api/v1/builds/<demo-4-build-id>/snapshots" \
  | grep -i 'testhub\|th-test-case\|th_test_case'
```

- **Expected: empty** (no match). Demo 4 row in the README's Deferred/roadmap subsection stays as-authored.
- **If unexpectedly non-empty:** a serializer change landed; update the README row to "Supported (payload + JSON API; no dashboard surface)" and record the exact JSON path in this notes file + in the project memory doc.

## Reproduction prerequisites

- Full `preflight-host.sh` passes (see runbook Pre-flight section).
- `OVERLAY_BASELINE_SHA` captured; SHA matches post-flight.
- `machine:31.6.63.33:28201FDH300J1S` pinning on the dispatch.
- Test-suite zip has a single parent folder at its root.

## Post-flight entries (to fill in after Unit 5 runs)

| | Value |
|---|---|
| Demo 4 — Percy build (hero URL) | TBD |
| Demo 4 — BS build id | TBD |
| Demo 4 — BS session id | TBD |
| Test-case groupings visible? (expected: yes) | TBD |
| Labels split visible? (expected: yes) | TBD |
| CLI log `thTestCaseExecutionId` grep hit count (expected: 2) | TBD |
| JSON-API probe result (expected: empty) | TBD |
| Overlay SHA before / after dispatch (must match) | TBD |
