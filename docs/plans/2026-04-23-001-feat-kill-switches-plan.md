---
title: "feat: PERCY_IGNORE_ERRORS + PERCY_ENABLED kill-switches"
type: feat
status: scoped
date: 2026-04-23
---

# feat: PERCY_IGNORE_ERRORS + PERCY_ENABLED kill-switches

> **Status: scoped, not yet planned in detail.** This is a placeholder plan stub
> referenced from `README.md`'s "Features not supported → Deferred / on roadmap"
> subsection, committed alongside
> [`2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md`](./2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md)
> so the README link lands on a real file. Run `/ce:plan` with this file as the
> starting brief before implementation to produce the full plan.

## Overview

Add the two environment-variable kill-switches that `percy-appium-python` and
`percy-espresso-java` expose via `percy:options` / `percy.enabled` /
`percy.ignoreErrors`, so customers running Maestro Android flows in CI can
disable Percy or swallow SDK errors without a code change.

Reference SDKs:

- `percy-appium-python/percy/lib/percy_options.py` — `ignoreErrors`, `enabled`.
- `percy-espresso-java/espresso/src/main/java/io/percy/espresso/.../ScreenshotOptions.java` — equivalent fields.

## Requirements (carryover from tile/test-metadata brainstorm scope boundary)

- **R1. `PERCY_ENABLED=false`.** The healthcheck sub-flow sets `output.percyEnabled=false` and logs a clear skip line. Every downstream `percy-screenshot.yaml` `runFlow` becomes a no-op. Setting `PERCY_ENABLED=true` (or leaving it unset) keeps current behavior.
- **R2. `PERCY_IGNORE_ERRORS=false`.** When set, SDK errors (healthcheck failure, upload failure, JSON parse failure) propagate up from the `runScript` step instead of being swallowed by the existing `try { ... } catch (error) { console.log... }` envelope in `percy-screenshot.js`. Default (`true` or unset) preserves today's behavior — errors log but do not fail the Maestro flow.
- **R3. Documentation.** README's "Configuration → Core options" table gets new rows for both env vars. The "Deferred / on roadmap" entry in "Features not supported" is removed once this ships.
- **R4. No CLI relay changes.** Both options are SDK-side only.

## Scope Boundaries

- **Not in scope: Percy CLI or Percy API changes.** Pure SDK.
- **Not in scope: `percy:options` JSON form.** Maestro's GraalJS env is string-keyed env vars only; no driver capabilities to parse a JSON options bag. Env vars are the idiomatic surface here.
- **Not in scope: dashboard UI for enable/disable.** Env-var driven only.

## Implementation sketch (to be detailed by `/ce:plan`)

Roughly three tiny units:

1. **Update `percy-healthcheck.js`** to early-return with `output.percyEnabled=false` when `PERCY_ENABLED` is explicitly `"false"`.
2. **Update `percy-screenshot.js`** to early-return when `output.percyEnabled` is false (already the case), AND to re-throw when `PERCY_IGNORE_ERRORS === "false"` (new).
3. **Update README** with new env-var rows and remove the deferred-roadmap entry.

No CLI changes, no new flows, ~20 lines of script edits plus README.

## Next Step

Run `/ce:plan docs/plans/2026-04-23-001-feat-kill-switches-plan.md` to turn this stub into a full deepened plan (depth: Lightweight).
