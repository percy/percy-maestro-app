# PR #2210 Self-Notes — `setMaestroHierarchyDrift` Rename + Two-Slot Shape

**Reframed 2026-05-07:** originally drafted as an external-coordination comment for #2210's author. Single ownership confirmed across PR #2202, PR #2210, and this plan (all by Sriram567), so this is now self-notes — a pre-baked diff and rationale for the rename, ready to paste into a #2210 commit message or split into a separate commit before #2210 merges.

Companion to `2026-05-06-004-feat-cross-platform-maestro-resolver-unification-plan.md`. Originally tied to Plan Viability Gate 4 (collapsed in this plan revision).

**Two execution paths** (both fine — pick whichever is convenient):

1. **Land the rename in PR #2210 directly** (recommended, lowest rebase friction). Use the diff below as a separate commit on top of #2210 with no behavior change for Android.
2. **Refactor post-merge in this plan's PR.** Same diff applied after #2210 lands on cli/master.

The rationale section below is preserved because the *reasoning* is still useful when explaining the change in a commit message or PR description, even though there's no longer an audience that needs to be persuaded.

---

## Rationale + diff (formerly the comment text)

Hey 👋 — heads-up about an inbound iOS-resolver-unification plan that will sit alongside this PR and consume your `recordSchemaDrift` / `getSchemaDriftSeen` surface. I want to flag a small shape change now so we can land it cleanly in **this** PR rather than refactoring once you've merged.

**Plan context.** I'm adding HTTP-XCTest as the iOS primary path (replaces today's WDA-direct `wda-hierarchy.js`). Same `maestroDump({platform})` dispatch; mirrors your gRPC structure for Android. Schema-class failures on iOS need to flip the same kind of healthcheck dirty bit yours does. Currently the bit is per-process-singleton:

```js
// maestro-hierarchy.js (current — feat/grpc-element-region-resolver)
let schemaDriftSeen = null;

function recordSchemaDrift(code, reason) {
  if (schemaDriftSeen) return; // first-seen wins
  schemaDriftSeen = { code, reason, firstSeenAt: new Date().toISOString() };
}

export function getSchemaDriftSeen() { return schemaDriftSeen; }
```

```js
// api.js (current)
import { ..., getSchemaDriftSeen as getMaestroHierarchyDrift } from './maestro-hierarchy.js';
// ...
if (drift) body.maestroHierarchyDrift = drift;
```

When iOS adds its own schema-class signal, single-field-first-seen-wins **drops cross-platform-simultaneous-drift signal** — exactly the case ops most needs to see (e.g., a Maestro CLI version bump on BS hosts that breaks both transports). A doc-review on my side flagged this as P1 and recommended a two-slot shape. I want to land it here — in this PR — rather than refactor your code post-merge.

**Proposed change (one commit on this PR; zero behavior change for Android):**

```diff
--- a/packages/core/src/maestro-hierarchy.js
+++ b/packages/core/src/maestro-hierarchy.js
@@
-let schemaDriftSeen = null;
+// Two-slot dirty bit so simultaneous Android+iOS drift is visible to ops.
+// Each slot is monotonic per-platform: first occurrence sets firstSeenAt,
+// subsequent same-platform writes are no-ops.
+let maestroHierarchyDrift = { android: null, ios: null };
@@
-function recordSchemaDrift(code, reason) {
-  if (schemaDriftSeen) return; // first-seen wins
-  schemaDriftSeen = {
-    code,
-    reason,
-    firstSeenAt: new Date().toISOString()
-  };
-}
+function setMaestroHierarchyDrift({ platform, code, reason }) {
+  if (maestroHierarchyDrift[platform]) return; // first-seen-per-platform wins
+  maestroHierarchyDrift[platform] = {
+    code,
+    reason,
+    firstSeenAt: new Date().toISOString()
+  };
+}
@@
-export function getSchemaDriftSeen() {
-  return schemaDriftSeen;
-}
+export function getMaestroHierarchyDrift() {
+  return maestroHierarchyDrift;
+}
@@
-      recordSchemaDrift(err.code, classification.reason);
+      setMaestroHierarchyDrift({ platform: 'android', code: err.code, reason: classification.reason });
@@
-    recordSchemaDrift(undefined, 'grpc-no-xml-envelope');
+    setMaestroHierarchyDrift({ platform: 'android', code: undefined, reason: 'grpc-no-xml-envelope' });
@@
-    recordSchemaDrift(undefined, 'grpc-parse-error');
+    setMaestroHierarchyDrift({ platform: 'android', code: undefined, reason: 'grpc-parse-error' });
@@
-    recordSchemaDrift(undefined, 'grpc-unexpected-root');
+    setMaestroHierarchyDrift({ platform: 'android', code: undefined, reason: 'grpc-unexpected-root' });
@@
-  getSchemaDriftSeen,
+  getMaestroHierarchyDrift,
@@
-  resetSchemaDriftForTests() {
-    schemaDriftSeen = null;
-  }
+  resetMaestroHierarchyDriftForTests() {
+    maestroHierarchyDrift = { android: null, ios: null };
+  }
```

```diff
--- a/packages/core/src/api.js
+++ b/packages/core/src/api.js
@@
-import { dump as adbDump, firstMatch as adbFirstMatch, SELECTOR_KEYS_WHITELIST, getSchemaDriftSeen as getMaestroHierarchyDrift } from './maestro-hierarchy.js';
+import { dump as adbDump, firstMatch as adbFirstMatch, SELECTOR_KEYS_WHITELIST, getMaestroHierarchyDrift } from './maestro-hierarchy.js';
@@
-      if (drift) body.maestroHierarchyDrift = drift;
+      // Always emit the envelope; both slots null in steady state.
+      body.maestroHierarchyDrift = getMaestroHierarchyDrift();
```

**Tests.** Your existing schema-drift cases retarget from `maestroHierarchyDrift` to `maestroHierarchyDrift.android` — mechanical rename, no logic change. The `iOS slot is null in steady state` invariant is enforced by the new shape itself.

**Healthcheck consumer impact.** `maestroHierarchyDrift` was a single nullable field; becomes `{ android: ... | null, ios: ... | null }` — always emitted. Existing consumers checking `=== null` need to update to check both slots. The field is undocumented as public so external blast radius is low; I'll grep percy-api / percy-web / percy-ops for any internal consumers and coordinate a separate update if any exist before either PR ships.

**Why now (not later).** If iOS lands first with its own parallel field, we end up with `maestroHierarchyDriftAndroid` + `maestroHierarchyDriftIos`, which is two healthcheck-handler reads + duplicated module state for no semantic gain. Landing the shape in this PR is the simplest path; iOS just consumes the existing `setMaestroHierarchyDrift({platform: 'ios', ...})` slot.

**Asks:**
1. **Land the rename in this PR** as a separate commit (changes are mechanical; happy to author the PR if you'd rather just review).
2. If you'd rather not, **let me know within ~5 working days** so I can fall back to refactoring post-merge in the iOS plan's PR. I want to avoid silently editing your merged code.
3. If you'd prefer a different shape (e.g., array-of-drifts with bounded history), say so — I'll adapt.

Happy to jump on a quick call if any of this is easier discussed live. Plan link for context: [percy-maestro/docs/plans/2026-05-06-004-feat-cross-platform-maestro-resolver-unification-plan.md](https://github.com/percy/percy-maestro/blob/main/docs/plans/2026-05-06-004-feat-cross-platform-maestro-resolver-unification-plan.md) (private repo — let me know if you can't reach it and I'll paste the relevant sections).

---

## Decision tracking (single-author)

- **Where to land:**
  - [ ] Pre-emptive commit on PR #2210 before it merges (recommended)
  - [ ] Refactor in this plan's PR after #2210 lands
- **Date decided:** YYYY-MM-DD
- **Commit / PR link:**
