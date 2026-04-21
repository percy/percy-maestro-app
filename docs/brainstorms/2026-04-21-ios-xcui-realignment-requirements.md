---
date: 2026-04-21
topic: ios-xcui-realignment
---

# iOS Percy Maestro — realignment with XCUI Swift conventions

## Problem Frame

Our first iOS pass (v0.3.0) took too many cues from Android Maestro. That left us with a broken integration on BrowserStack iOS hosts:

- **Primary breakage:** we send `percyOptions: {enabled, percyToken}` in the BrowserStack iOS Maestro build API. BrowserStack's iOS bridge does **not** translate that key into realmobile's `@params['app_percy']` — it was verified empty in the live `/start_maestro_session` POST body. As a result, realmobile never instantiates `AppPercy::Session`, Percy CLI never starts on the host, the SDK's healthcheck fails, and every iOS Maestro build "passes" with Percy silently disabled. Customers have no way to know screenshots weren't uploaded.
- The canonical iOS Percy parameter (used by `percy-xcui-swift`) is `appPercy: {PERCY_TOKEN, env}`. That is the shape the BrowserStack iOS appautomate bridge knows how to translate.

Everything else we shipped in v0.3.0 (the `/percy/maestro-screenshot` relay, sessionId-based disk globbing, env-var device metadata) is still correct and stays — the XCUI SDK's base64-on-device approach is not reachable from Maestro's GraalJS sandbox (confirmed in `project_multipart_test_results.md`).

Affected users: anyone attempting iOS visual testing with percy-maestro today. Impact: silent data loss (no Percy snapshots, but successful-looking builds).

## Requirements

- **R1.** The BrowserStack iOS Maestro build API accepts `appPercy: {PERCY_TOKEN, env}` and this causes Percy CLI to start on the iOS host during the Maestro session, such that SDK screenshots are uploaded to the configured Percy project. The Percy dashboard shows snapshots tagged `osName: "iOS"` with correct device metadata.
- **R2.** `appPercy.env` sub-object values (e.g., `PERCY_BRANCH`, `PERCY_PROJECT`, `PERCY_COMMIT`) are present in the Percy CLI's process environment when it starts, so the resulting Percy build is tagged with the correct branch/project/commit.
- **R3.** `PERCY_REGIONS` with **coordinate-based** regions (current v0.3.0 SDK support) is verified end-to-end on a real BrowserStack iOS device — the relay finds the iOS screenshot, the coordinate region is applied, and Percy produces an ignored/considered/layout/intelliignore comparison. No SDK or CLI changes needed for this requirement; it is a verification gate.
- **R4.** README, CLAUDE.md, and the public iOS-support plan document use `appPercy` (not `percyOptions`) in every example, clearly label element-based regions as "iOS and Android — deferred to a future release", and keep Android examples working unchanged.

## Success Criteria

- An iOS Maestro build on BrowserStack's public Maestro API, using `appPercy: {PERCY_TOKEN, env: {...}}`, produces at least one Percy snapshot visible on the Percy dashboard with `osName: "iOS"`, correct device name/os-version/dimensions, and the `PERCY_BRANCH` from `appPercy.env` applied to the Percy build.
- A second iOS build using the same payload plus a coordinate `PERCY_REGIONS` array produces a snapshot whose comparison on the Percy dashboard reflects the region algorithm (e.g., a status-bar coord region with `algorithm: "ignore"` visibly excluded from the diff).
- Existing Android Maestro builds using the unchanged `percyOptions` shape (or the SDK without `percyOptions`) continue to upload snapshots as before — no Android regression.

## Scope Boundaries

- **Out:** Element-based regions on iOS (requires WebDriverAgent discovery + selector translation, ~200–300 LoC CLI work + session disambiguation). Filed as a separate future brainstorm. Element-based on Android remains deferred too, so both platforms stay at the same maturity.
- **Out:** XCUI-parity "cheap additions" (`PERCY_ALLOWED_DEVICES`, CLI version enforcement, `PERCY_LOG_LEVEL`). Deferred to a later release; not part of this cycle.
- **Out:** Android build-API parameter name changes. Android continues to use `percyOptions` (that shape works today for Android). This cycle only realigns the iOS shape.
- **Out:** On-device auto-detection of device metadata, OS version, orientation, or screen dimensions. GraalJS sandbox blocks the native bindings that XCUI Swift uses (`uname`, `UIDevice.current`, `XCUIDevice.shared.orientation`); users continue to pass `PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH`, `PERCY_SCREEN_HEIGHT`, `PERCY_ORIENTATION` via Maestro flow env vars.
- **Out:** Multi-tile composite screenshots (scrolling content). XCUI's payload accepts `tiles[]` with per-tile crop metadata; our Maestro relay sends one tile. Deferred.

## Key Decisions

- **Use `appPercy: {PERCY_TOKEN, env}` as the iOS Maestro build-API param** (mirroring `percy-xcui-swift`). Rationale: it is the BrowserStack-native iOS Percy key, verified working via the XCUI example README. `percyOptions` is an Android-Maestro-specific path that BrowserStack's iOS bridge does not translate.
- **Keep the `/percy/maestro-screenshot` relay as-is for iOS.** Rationale: XCUI's base64-in-SDK pattern is impossible from GraalJS; the relay with CLI-side file globbing is already correct for Maestro on both platforms.
- **Local-usage contract stays identical to Android.** Users run `npx percy app:exec -- maestro test ...` for both platforms; no `/etc/hosts` hack required (Maestro JS scripts run on the host and can reach `localhost:5338` directly, unlike XCUI test binaries which run on-device).
- **Coordinate-based regions are already feature-complete on iOS in v0.3.0.** Rationale: the JS region parser is platform-agnostic; the relay accepts the same coord payload for both iOS and Android globs. The gap is verification, not implementation.
- **Element-based regions remain deferred for both platforms.** Rationale: Android requires an ADB resolver module; iOS requires a WDA resolver module. Both are non-trivial and deserve their own design pass (WDA port discovery, selector dialect — `accessibility_id`, `predicate_string`, `xpath`, etc. — and session disambiguation). Not worth conflating with the iOS API-param fix.

## Dependencies / Assumptions

- **Assumption:** BrowserStack's iOS Maestro appautomate bridge already translates `appPercy` into realmobile's `@params['app_percy']` hash, the same way it does for iOS XCUI builds. This is unverified for the iOS Maestro route specifically; if the bridge has not been wired for iOS Maestro, R1/R2 require a BrowserStack backend change (escalation to BS's appautomate team). Verification happens during planning / first E2E build.
- **Assumption:** realmobile's `AppPercy::CLIManager` passes `@params['app_percy']['env']` entries through to the `percy app exec:start` subprocess environment. Needs spot-check in `/Users/arumullasriram/realmobile/lib/app_percy/cli_manager.rb` during planning.
- **Dependency:** the clean realmobile feature branch `feat/maestro-percy-ios-integration` (commit `54e2f4839`, one commit above current master) must stay deployed on the test iOS host for the duration of verification. Force-reset risk: if automated deploys reset the host to master mid-test, re-checkout is needed (happened once on host 185.255.127.11 earlier this session).

## Outstanding Questions

### Resolve Before Planning

(none — all blocking decisions resolved in this brainstorm)

### Deferred to Planning

- **[Affects R1][Needs research]** Confirm BrowserStack's iOS Maestro bridge actually translates `appPercy` → `app_percy`. If it does not, planning needs to sequence a BrowserStack backend change before our release. Test approach: send a minimal `appPercy` build and grep the `/start_maestro_session` POST body on the host for `"app_percy"` — same technique used earlier this session to confirm `percyOptions` was dropped.
- **[Affects R2][Technical]** Verify `AppPercy::CLIManager` forwards `@params['app_percy']['env']` into the `percy app exec:start` subprocess environment. Add spec coverage if missing. If it does not forward today, planning scopes that as a realmobile change in the same feature branch.
- **[Affects R3][Technical]** Decide the test-flow shape for the coord-region E2E verification — which region algorithm to exercise first (`ignore` is safest; `intelliignore` exercises more CLI code), and what coordinates to use against `com.browserstack.Sample-iOS` (the same iOS test app we've been using). Keep it small: one region, one flow.
- **[Affects R4][Technical]** What v-number to ship under. Our v0.3.0 is on customers' desks with the broken `percyOptions` path — a patch release (`v0.3.1`) vs a minor (`v0.4.0`) affects how we communicate the fix. Leaning `v0.4.0` since `appPercy` is an API-shape change for iOS users (breaking only for the iOS-early-adopter cohort; Android users unaffected).

## Alternatives Considered

- **Keep `percyOptions` and ask BrowserStack to add iOS bridge translation for it.** Rejected: creates a second iOS-specific param name in the Percy ecosystem (XCUI uses `appPercy`, Maestro would use `percyOptions`), adds ongoing coordination cost, and `appPercy` already works for iOS today.
- **Switch Android to `appPercy` too for consistency.** Rejected as out-of-scope: Android's `percyOptions` shape works, there is no breakage to fix, and changing it is a breaking customer migration with zero user benefit.
- **Bundle the XCUI "cheap parity" additions (`allowedDevices`, CLI version enforcement, log level) into this release.** User explicitly chose to defer them — the fix-the-blocker-first path keeps this cycle tight.

## Next Steps

→ `/ce:plan` for structured implementation planning
