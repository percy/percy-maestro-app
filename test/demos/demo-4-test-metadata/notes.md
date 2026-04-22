# Demo 4 — Test Metadata

**Caption:** Percy Maestro Android SDK forwards `PERCY_TEST_CASE` and `PERCY_TH_TEST_CASE_EXECUTION_ID` end-to-end. Two snapshots spread across two test cases land in a single Percy build. `PERCY_LABELS` is *attempted* but the current CLI relay version (percy/core 1.31.11-beta.0 on the overlay) rejects it as `"labels: unknown property"` — see **Known gap** below.

**Plan:** [`docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md`](../../../docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md).

## Customer-facing takeaway

"Use `PERCY_TEST_CASE` to group Maestro snapshots under named test cases in the Percy dashboard. `PERCY_TH_TEST_CASE_EXECUTION_ID` is forwarded into the Percy upload payload for TestHub integrators (no customer-visible dashboard surface today — the field reaches Percy's backend but no `percy-api` serializer currently exposes it; tracked as a separate backend-serializer gap). `PERCY_LABELS` is **not** currently accepted by Percy CLI 1.30.0 — the SDK forwards it but the client-side schema validator strips it with a warning. Fixing this is a follow-up (likely a percy-cli version bump, not an SDK change)."

## Shipped artifacts

- **Percy build #5** — [`https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49004182`](https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49004182)
- **BrowserStack build id** — `b3fd5e8f384ba900ed98949795fbd61888d5b534`
- **BrowserStack session id** — `abdd66e6a35097e175f6ad584a0969becbd56d77`
- **Percy branch** — `test-metadata-demo-20260423`
- **Percy commit** — `d4000000000000000000000000000000000decaf`
- **Device** — Google Pixel 7 Pro (Android 13), pinned to host `31.6.63.33:28201FDH300J1S`
- **Duration** — 50s session, 144s total

## Snapshots

| Snapshot | `PERCY_TEST_CASE` | `PERCY_LABELS` (attempted) | `PERCY_TH_TEST_CASE_EXECUTION_ID` |
|---|---|---|---|
| `HomeFlow_Landing` | `HomeFlow` | `smoke,home,critical` (rejected by CLI schema) | `TH-DEMO-4-20260423` |
| `SecondScreen_Scrolled` | `SettingsFlow` | `smoke,settings` (rejected) | `TH-DEMO-4-20260423` |

## Proof

Percy CLI debug log from session `abdd66e6...`:

```
[percy:env] Detected branch as "test-metadata-demo-20260423" (0ms)
[percy:env] Detected commit as "d4000000000000000000000000000000000decaf" (0ms)
[percy:core] Invalid upload options: (19655ms)
[percy:core] - labels: unknown property (0ms)
[percy:core] Snapshot taken: HomeFlow_Landing (1ms)
[percy:client] Creating snapshot: HomeFlow_Landing... (0ms)
[percy:core] Invalid upload options: (169ms)
[percy:core] - labels: unknown property (0ms)
[percy:core] Snapshot taken: SecondScreen_Scrolled (0ms)
[percy:client] Creating snapshot: SecondScreen_Scrolled... (1ms)
[percy:client] Uploading comparison tiles for 4444592623... (242ms)
[percy:client] Uploading comparison tiles for 4444592644... (172ms)
[percy:core] Finalized build #5: https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49004182 (530ms)
```

Observations:
- `testCase` (`HomeFlow`, `SettingsFlow`) — **no rejection warning**; field accepted.
- `thTestCaseExecutionId` (`TH-DEMO-4-20260423`) — **no rejection warning**; field accepted.
- `labels` — **rejected** with `"labels: unknown property"` on every snapshot. Snapshot still uploads, labels are silently dropped.

## What to look at in Percy

Open the Percy build URL above. The dashboard should show two snapshots grouped under two test cases (`HomeFlow` and `SettingsFlow`). Tags/labels on each snapshot are **not** expected to render (see Known gap).

## Known gap — `PERCY_LABELS` client-side schema rejection

The CLI at `percy/core` 1.31.11-beta.0 (overlay deployed on host) contains a snapshot-options schema that does not include `labels` as a valid top-level property. When the SDK forwards `labels: "smoke,home,critical"`, the client logs `Invalid upload options: - labels: unknown property` and strips the field before uploading. The snapshot itself still uploads successfully.

Because the SDK (`percy-maestro-android`) is correctly forwarding the field per the CLI relay API, the fix is almost certainly a percy-core snapshot-schema update (allow `labels` on per-snapshot options) or a CLI version bump to a release that includes it. This is **not** an SDK bug.

**Follow-up action:** open an issue against `cli/packages/core` asking for `labels` to be whitelisted on the snapshot options schema used by the Maestro relay handler. Reference this demo's build #5 for evidence.

## `PERCY_TH_TEST_CASE_EXECUTION_ID` confirmation probe

Plan's Unit 5 calls for a ≤5 min probe to confirm no `percy-api` serializer surfaces the field. Because `app_*` tokens are write-scoped (Percy API returned `"unauthorized"` on `GET /builds/:id/snapshots` with the dispatch token), this probe requires an admin or read-scoped token and is deferred. The plan's document-review phase confirmed no serializer currently exposes `testhub_testcase_execution_id` — result unchanged unless a serializer change has landed server-side since 2026-04-22.

## How to reproduce

Same dispatch shape as Demo 3 (see [`test/demos/demo-3-tile-metadata/notes.md`](../demo-3-tile-metadata/notes.md)), substituting:
- `PERCY_BRANCH=test-metadata-demo-20260423`
- `PERCY_COMMIT=d4000000000000000000000000000000000decaf`
- Test suite zip contains `test/demos/demo-4-test-metadata/flow.yaml` staged as `my-workspace/flow.yaml`
