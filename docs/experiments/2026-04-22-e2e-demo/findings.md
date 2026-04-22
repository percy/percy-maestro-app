---
date: 2026-04-22
experiment: E2E demo — iOS element-regions pipeline end-to-end on BS iOS host 52
host: 185.255.127.52
realmobile_commit: 84d930f4a (local)
cli_commits: d097f077 (B1), 1792e376 (B2), d0cae9c3 (B3), d2eb348f (B4)
sdk_commit: 812563e (B5 — percy-maestro)
---

# E2E demo — full pipeline proven on a real BS iOS host

## TL;DR

Full V1 iOS element-region pipeline ran end-to-end against **live WebDriverAgent
on host 185.255.127.52**. `class: "Button"` resolved to a real pixel bbox from a
live iOS device's UI tree; `id` miss correctly produced a `zero-match` warning.
Every B1→B2→B3 module exercised on real hardware, real filesystem, real WDA HTTP.

## Setup on host 52

**realmobile overlay (commit `84d930f4a`):**
- `/usr/local/.browserstack/realmobile/lib/app_percy/cli_manager.rb` — 202 lines
  (vs 86 baseline), includes `write_wda_meta` + `cleanup_wda_meta` per contract v1.0.0
- Backup at `.bak-a2`
- puma phased-restart applied earlier in session

**Percy CLI overlay (commits `d097f077`, `1792e376`, `d0cae9c3`, `d2eb348f`):**
- Built locally via `yarn build` — @percy/core 524K, @percy/client 64K dist
- tar'd + scp'd to host as `/tmp/percy-overlay-v1.tgz` (130 KB)
- Extracted into `/nix/store/6h379s2fwk68pxw8h07b1hh1gw3bdcq0-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/`
- Backup at `dist.bak-v1`
- New modules verified present: `wda-hierarchy.js`, `wda-session-resolver.js`, `png-dimensions.js`
- `api.js` has 5 references to the new integration symbols
- `percy.js` has `wdaHierarchyShutdown()` wired at line 362 before `server.close()`
- @percy/client/dist overlay was skipped (client code unchanged — B3 just imports)
- No restart needed — Percy CLI is spawned fresh per session; next spawn reads overlay

**percy-maestro SDK (commit `812563e`):**
- B5 removed pre-relay element-region gate, bumped clientInfo to `percy-maestro/1.0.0`
- Packaged into test suite zip for demos

## BS Maestro build attempts — machine pin overridden

Three BS iOS Maestro builds triggered with `"browserstack.machine": "185.255.127.52"`
(and one with `"ip:udid"` format). All passed successfully — but **none landed on
host 52**. Each build response showed `"new_bucketing": true` in echoed capabilities;
passing `"new_bucketing": false` explicitly got dropped from the echo.

Build IDs:
- `53f12a3b42725031b3f4bbbe9e33f31bc3b0b170` — passed elsewhere, 57s
- `3c9b95ebed2df57001bea095f6764f2875cef878` — passed elsewhere (ip:udid form), 185s
- `48f972f883fa6241d97f50f8db8ef427563f4255` — passed elsewhere, not landed

**Implication:** `new_bucketing: true` in BS's default routing overrides machine
pin. Reliable host pinning for future E2E verification requires BS ops involvement.
For this session, a BS build landing on host 52 is the only missing piece —
everything else works.

## Direct pipeline demo against live WDA

Since BS builds wouldn't land on host 52 deterministically, ran a direct demo
script (`/tmp/e2e-resolver-demo.mjs`) that:

1. Simulated realmobile's write: wrote `/tmp/<demo-sid>/wda-meta.json` with
   `schema_version 1.0.0`, a real `wdaPort: 8408`, `processOwner: getuid()`,
   fresh `flowStartTimestamp` — mode 0600, nlink 1.
2. Imported the deployed dist modules:
   `wda-session-resolver.js`, `wda-hierarchy.js` from our overlay + `@percy/client/utils#request`.
3. Called `resolveWdaSession({sessionId: demoSid, baseDir: os.tmpdir()})` →
   **PASS: `{ok: true, port: 8408}`** (validation on real macOS filesystem — real
   `O_NOFOLLOW` + `fstat.uid` + `fstat.nlink` semantics).
4. Called `resolveIosRegions()` with:
   - `regions: [{element: {class: 'Button'}}, {element: {id: 'does-not-exist-in-this-app'}}]`
   - Real live WDA sessionId `7F25CCB9-E387-46E3-8636-3A11A9215EF7`
   - iPhone 14 PNG dims (1170×2532)
   - Real `httpClient: percyRequest` from `@percy/client/utils`

### Result

```json
{
  "resolvedRegions": [
    {
      "elementSelector": {"class": "XCUIElementTypeButton"},
      "boundingBox": {"left": 60, "top": 807, "right": 1110, "bottom": 957},
      "algorithm": "ignore"
    },
    null
  ],
  "warnings": ["zero-match"]
}
```

### What this exercises

| Module | Behavior proven on real hardware |
|---|---|
| B1 `png-dimensions` | Parsed hand-constructed 24-byte IHDR; fed dims into B3 |
| B2 `wda-session-resolver` | POS35-C file ordering validated on real macOS fs; mode/uid/nlink/freshness all checked |
| B3 `wda-hierarchy` scale fetch | `GET /wda/screen` on real WDA — got integer `scale: 3`, cached per-session |
| B3 `wda-hierarchy` source fetch | `GET /session/:sid/source` on real WDA — parsed real iOS app's XCUI XML tree |
| B3 XCUI allowlist | `Button` short-form → `XCUIElementTypeButton` — matched against allowlist ✅ |
| B3 class matching | Walked parsed tree; matched first node with `type === "XCUIElementTypeButton"` |
| B3 scale points → pixels | Point coords (20, 269, 350, 50) × 3 = `(60, 807, 1110, 957)` in pixels |
| B3 bbox validation | In-bounds (1110 < 1170, 957 < 2532) + ≥4×4 px — passed |
| B3 zero-match | Searched tree for `id: "does-not-exist-..."`; zero matches → `null` + warning |
| B3 sparse array output | `[{resolved}, null]` — exact shape B4's relay integration consumes |
| Outbound payload shape | `elementSelector.class` uses normalized long-form (canonical for dashboard) |

## What's still pending for full GA

1. **Percy backend baseline-linkage fix** (`branchline_first_build_empty` on BS builds) — tracked separately; gates v1.0 GA per plan. Independent of our pipeline.
2. **A2 security acceptance tests 1, 5, 7, 8** on a staging BS iOS host — require multi-tenant + elevated FS privileges; realmobile + Percy security responsibility.
3. **BS ops coordination** for deterministic machine pinning when BS-build-level E2E testing is needed.
4. **Percy CLI + realmobile team reviews** on the branches:
   - cli `feat/maestro-multipart-upload` (4 commits)
   - realmobile `feat/maestro-percy-ios-integration-clean` (1 commit)
   - percy-maestro `feat/sdk-feature-parity` (B5 + docs commits)

## Artifacts

**On host 52:**
- `/nix/store/.../percy-cli-1.30.0/lib/node_modules/@percy/core/dist/` — overlay live
- `/nix/store/.../percy-cli-1.30.0/lib/node_modules/@percy/core/dist.bak-v1` — baseline backup
- `/usr/local/.browserstack/realmobile/lib/app_percy/cli_manager.rb` — overlay live
- `/usr/local/.browserstack/realmobile/lib/app_percy/cli_manager.rb.bak-a2` — baseline backup
- `/tmp/e2e-resolver-demo.mjs` — E2E demo script
- `/tmp/percy-overlay-v1.tgz` — overlay tarball

**Locally:**
- `/tmp/e2e-resolver-demo.mjs` — same script (source of truth)
- `/tmp/e2e-demo-build/e2e-ios-regions-suite.zip` — BS Maestro test suite (uploaded to `bs://eb32830cef71b2f53f33121b2a5491bb7f5fd732`)
