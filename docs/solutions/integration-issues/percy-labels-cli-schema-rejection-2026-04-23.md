---
title: "PERCY_LABELS forwarded by SDK but rejected by percy/core snapshot schema as 'unknown property'"
date: 2026-04-23
problem_type: integration_issue
component: testing_framework
root_cause: config_error
resolution_type: documentation_update
severity: medium
category: integration-issues
tags:
  - percy-maestro-android
  - percy-cli
  - percy-core
  - schema-validation
  - labels
  - test-metadata
  - maestro-screenshot-relay
  - silent-data-loss
---

# PERCY_LABELS forwarded by SDK but rejected by percy/core snapshot schema

## Problem

Setting `PERCY_LABELS` in a `percy-maestro-android` flow appears to work — snapshots upload successfully — but labels never reach the Percy dashboard. `percy/core` 1.31.11-beta.0 (and earlier released versions) rejects `labels` on the per-snapshot upload options schema as `"unknown property"` and strips the field client-side. The SDK and the CLI relay handler (`/percy/maestro-screenshot`) both handle `labels` correctly; the gap is a schema config in `percy/core` that predates the relay's field support. This affects any customer using `PERCY_LABELS` on Maestro Android flows.

## Symptoms

- Setting `PERCY_LABELS: "smoke,home,critical"` in a Maestro flow env produces no error at flow-run time.
- The snapshot uploads to Percy. Build finalizes normally.
- The Percy dashboard does **not** render any labels on the snapshot.
- With `PERCY_LOGLEVEL=debug`, the Percy CLI log on the BrowserStack host shows:

  ```
  [percy:core] Invalid upload options: (19655ms)
  [percy:core] - labels: unknown property (0ms)
  [percy:core] Snapshot taken: HomeFlow_Landing (1ms)
  [percy:client] Creating snapshot: HomeFlow_Landing... (0ms)
  ```

  The `Invalid upload options: - labels: unknown property` warning is printed *per snapshot* that carries a `labels` field. The snapshot still goes through; only the `labels` field is dropped.

- Sibling fields on the same payload (`testCase`, `thTestCaseExecutionId`) do **not** produce rejection warnings — those pass through without issue.

## What Didn't Work

1. **Assuming the SDK was the problem** — `percy-maestro-android`'s `percy/scripts/percy-screenshot.js` sends `payload.labels = PERCY_LABELS` when the env var is present. The payload reaches the `/percy/maestro-screenshot` relay handler at `cli/packages/core/src/api.js:466-478`, which has the matching `if (req.body.labels) payload.labels = req.body.labels;` and forwards the field into `percy.upload(payload, null, 'app')`. The SDK and relay are aligned; nothing to fix on either.
2. **Looking for a backend (percy-api) rejection** — the rejection happens *client-side* in percy-core before any HTTP call. Even with an admin-scoped Percy token, you cannot probe for this via `GET /builds/:id/snapshots` because the field never leaves the local CLI process. The CLI log on the host is the only place to observe it.
3. **Assuming `labels` is a top-level build field, not a per-snapshot field** — `cli/packages/client/src/client.js:466` does have `tagsList(labels)` logic that splits on comma, but the validation gate before that is what rejects the field. The per-snapshot options schema used by `percy/core` — not the client code — is where `labels` is missing from the allowed-keys list.

## Solution

No SDK-side fix exists. The solution has two parts:

### 1. Document the gap for customers (already shipped in `percy-maestro-android`)

- `test/demos/demo-4-test-metadata/notes.md` calls out the gap explicitly, shows the CLI log evidence, and tells customers not to rely on labels until a percy-core release fixes the schema.
- `README.md`'s "Features not supported → Deferred / on roadmap → Under evaluation" table has a row:

  > `PERCY_LABELS` rendering in Percy dashboard — the SDK forwards `labels` to the Percy CLI relay correctly, but `percy/core` 1.31.11-beta.0 (and current stable) rejects `labels` on the snapshot-options schema as `"unknown property"` and strips it client-side. Snapshot still uploads; labels are not stored. Fix is a `percy/core` schema update — not an SDK change.

### 2. File a `cli/packages/core` issue (follow-up)

The real fix is an upstream schema update. File an issue against `percy/cli` requesting:

- Whitelist `labels` on the per-snapshot upload options schema (the same schema that currently rejects it with `"unknown property"`).
- Reference Percy build [#5](https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49004182) (Demo 4 on 2026-04-23) as evidence: two snapshots uploaded with `labels` set, CLI log shows the rejection, dashboard has no labels on either.

Once a `percy/cli` release lands with the schema fix:

- Bump `percy-maestro-android`'s minimum CLI version callout in the README.
- Remove the "Under evaluation" row for `PERCY_LABELS`.
- Add or update a demo that shows labels rendered as separate tags in the Percy dashboard (the expected behavior per `tagsList(labels)` at `cli/packages/client/src/client.js:466`).

## Why This Works

The root cause is **schema drift between the relay handler and the core snapshot-options validator**. The `/percy/maestro-screenshot` handler (added to `api.js` for Maestro support) was updated to accept and forward `labels`, but the per-snapshot options schema that `percy.upload()` passes against was not updated at the same time. Strict-mode schema validation rejects unknown properties, which is the right default — but here the validator's definition of "known" hasn't kept up with new fields the relay handler added.

From the SDK's perspective, the only responsibility is forwarding the env var to the relay with the right shape. That contract is honored; no SDK-side change would fix the rejection. Attempting to work around it in the SDK (e.g., renaming `labels` to a field the schema *does* accept) would break the contract once the schema is fixed upstream.

## Prevention

### For this codebase (`percy-maestro-android`)

When adding any new env var whose value ends up on a per-snapshot Percy payload, add a **post-dispatch verification step** to the demo round:

```bash
# Against the pinned BrowserStack host, after a demo build finalizes:
SESSION_ID=<session_id>
ssh -J arumulla@hop.browserstack.com -p 4022 ritesharora@31.6.63.33 \
  "grep -E 'Invalid upload options|unknown property' /var/log/browserstack/percy_cli.${SESSION_ID}_*.log"
```

An empty grep result means every forwarded field was accepted by percy-core's schema. A non-empty result is the early-warning signal for a schema gap exactly like this one — the snapshot will still upload, but the feature will silently not work.

Include this grep in `test/e2e-checklist.md` and in each demo's `notes.md` "How to reproduce" block. It's the cheapest possible check that catches the entire class of "SDK forwards, CLI strips" bugs.

### For cross-repo field additions (general)

When adding a new field to `/percy/maestro-screenshot`'s payload in `cli/packages/core/src/api.js`, verify the matching per-snapshot options schema that `percy.upload()` validates against also accepts the field. The relay handler and the validator must be updated together. A regression test that posts the new field to the relay and asserts no `unknown property` warning in `percy:core` debug logs would catch this class of drift in CI.

### Test case

For the Maestro relay handler specifically, a CLI-side test would look like:

```js
// cli/packages/core/test/api.test.js
it('accepts labels on /percy/maestro-screenshot payload', async () => {
  const warnings = captureLogsAtLevel('percy:core', 'warn');
  await postToRelay('/percy/maestro-screenshot', {
    name: 'with-labels',
    sessionId: 'ses-xyz',
    tag: { name: 'test', osName: 'Android', osVersion: '13', width: 1080, height: 2340 },
    labels: 'smoke,home,critical',
    platform: 'android',
    clientInfo: 'percy-maestro-android/0.3.0',
  });
  expect(warnings).not.toContain(/labels.*unknown property/);
});
```

Failing this test is the early signal: any new relay field needs matching schema support before the release ships.

## Reference evidence

- **Percy build** showing the problem: [build #5 on project `extraFeatures-fdd21397`](https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49004182) — two snapshots (`HomeFlow_Landing`, `SecondScreen_Scrolled`), each uploaded with `PERCY_LABELS` set, neither renders labels in the dashboard.
- **BrowserStack session** with the CLI log: `abdd66e6a35097e175f6ad584a0969becbd56d77` on build `b3fd5e8f384ba900ed98949795fbd61888d5b534`.
- **SDK send path**: `percy-maestro-android/percy/scripts/percy-screenshot.js` — search for `PERCY_LABELS`.
- **Relay handler**: `cli/packages/core/src/api.js:466-478` — the `/percy/maestro-screenshot` handler accepting `labels`.
- **Client split logic**: `cli/packages/client/src/client.js:466` — `tagsList(labels)` split on comma (never reached in this path because the validator rejects the field upstream).
- **Deployed CLI version** on the pinned BrowserStack host: `@percy/cli` 1.30.0 with `@percy/core` 1.31.11-beta.0 overlay.

## Related

- [percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md](../developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md) — overlay deploy runbook; Layer 2 dispatch flow is how Demo 4 was run.
- [maestro-view-hierarchy-uiautomator-lock-2026-04-22.md](./maestro-view-hierarchy-uiautomator-lock-2026-04-22.md) — same category (integration-issue between SDK + CLI); different root cause (concurrency, not schema).
- Plan: [`docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md`](../../plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md) — Post-Execution Notes section captures this gap alongside Demo 4's shipped artifacts.
