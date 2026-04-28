---
date: 2026-04-10
topic: ios-support
---

# Percy Maestro SDK — iOS Support

## Problem Frame

Percy Maestro SDK is currently Android-only (the healthcheck enforces `maestro.platform !== "android"`). BrowserStack App Automate supports Maestro tests on real iOS devices via `/maestro/v2/ios/build`, but there is no Percy integration for iOS Maestro flows. Users running iOS Maestro tests on BrowserStack cannot capture visual regression snapshots with Percy.

This is a cross-repo effort:

1. **percy-maestro** — remove the Android-only gate; set `tag.osName` based on `maestro.platform`; no other behavior changes (GraalJS sandbox is identical on iOS)
2. **percy CLI** (`cli/packages/core/src/api.js`) — make `/percy/maestro-screenshot` relay platform-aware: accept a `platform` field and use the correct screenshot glob pattern
3. **realmobile** (iOS host code) — wire `AppPercy::CLIManager` into `MaestroSession` and inject `PERCY_SESSION_ID` into Maestro env vars (mirrors Android's `maestro_runner.rb` pattern)

## Requirements

### SDK (percy-maestro)

- R1. **Remove Android-only gate.** The healthcheck accepts `maestro.platform === "ios"` as well as `"android"`. No other platform.
- R2. **Dynamic osName in tag.** `tag.osName` is derived from `maestro.platform`: `"Android"` for android, `"iOS"` for ios. Previously hardcoded to `"Android"`.
- R3. **Same feature set as Android v0.2.0.** All existing env vars (`PERCY_REGIONS`, `PERCY_SYNC`, `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, `PERCY_FULLSCREEN`, `PERCY_TH_TEST_CASE_EXECUTION_ID`, `PERCY_TEST_CASE`, `PERCY_LABELS`, device metadata vars) work on iOS.
- R4. **Pass platform to relay.** SDK includes `platform: "ios"` or `platform: "android"` in the relay payload so the CLI can pick the right screenshot path.
- R5. **Version bump.** Bump `clientInfo` to `percy-maestro/0.3.0` to signal iOS support.

### CLI Relay (`/percy/maestro-screenshot`)

- R6. **Accept `platform` field.** Relay handler reads `req.body.platform` (defaults to `"android"` for backward compatibility with SDK v0.2.0).
- R7. **Platform-aware screenshot discovery.** For `platform: "ios"`, search `/tmp/{sessionId}/*_maestro_debug_*/*.png` (matching filename). For android, keep existing `/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`. Fall back gracefully if platform is missing or unrecognized.
- R8. **Handle iOS filename variations.** iOS screenshots may include special characters (e.g., emoji-prefixed filenames from Maestro debug output). Match on the base screenshot name after any Maestro-injected prefix.
- R9. **Backward compatibility.** Existing SDK v0.2.0 payloads (no `platform` field) continue to work unchanged — default to Android path.

### Mobile Platform (realmobile)

- R10. **Launch Percy CLI for iOS Maestro sessions.** In `MaestroSession`, instantiate and start `AppPercy::CLIManager` when `@params['app_percy']` is enabled (mirrors `XCTestSession`'s existing integration).
- R11. **Inject PERCY_SESSION_ID.** Pass `PERCY_SESSION_ID=@session_id` into Maestro's environment variables via `build_maestro_command()`, same as Android's `maestro_runner.rb`.
- R12. **Stop Percy CLI on session teardown.** On Maestro session stop/cleanup, stop the Percy CLI cleanly.
- R13. **No batch upload fallback.** Real-time relay handles uploads during flow execution. Do not implement post-session batch upload (matches Android's current pattern after batch-upload removal).

### Documentation

- R14. **Update SDK README.** Remove "Android-only" language. Document iOS-specific env var guidance (e.g., `PERCY_NAV_BAR_HEIGHT: "0"` on iOS, `PERCY_STATUS_BAR_HEIGHT` should account for notch/Dynamic Island when relevant).
- R15. **Document iOS device metadata.** Show how to set `PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH`, `PERCY_SCREEN_HEIGHT`, `PERCY_ORIENTATION` for common iOS devices.
- R16. **Update CLAUDE.md / architecture docs.** Reflect dual-platform support and the `platform` field in the relay contract. Update the Confluence architecture page.

## Success Criteria

- iOS Maestro flow with `percy-init.yaml` and `percy-screenshot.yaml` successfully uploads a screenshot to Percy from BrowserStack
- Percy dashboard shows the iOS screenshot with correct `osName: "iOS"`, device name, and OS version
- All Android v0.2.0 features (regions, sync, tile metadata, thTestCaseExecutionId) work identically on iOS
- Existing Android flows continue to work unchanged (no regressions)
- Percy CLI starts on iOS host before Maestro runner, stops cleanly on session end

## Scope Boundaries

- **NOT implementing:** element-based region selectors (resource-id, accessibility-id). Deferred for BOTH platforms — will be added in a follow-up when element resolution mechanisms are unified.
- **NOT implementing:** iOS simulator support. BrowserStack runs real iOS devices only.
- **NOT implementing:** iOS-specific safe-area auto-detection or scale-factor auto-computation. Users pass pixel values directly via env vars (same as Android status/nav bar heights).
- **NOT implementing:** scrollableXpath, fullPage multi-tile, freezeAnimations, percyCSS — still not applicable to Maestro architecture on either platform.
- **NOT implementing:** batch upload fallback on iOS — matches current Android posture.

## Key Decisions

- **Reuse `AppPercy::CLIManager` on iOS**: realmobile already has this class (used by `XCTestSession`). Wiring it into `MaestroSession` is a proven pattern — no new classes needed.
- **Defer element-based regions**: Android v0.2.0 shipped with element regions as "planned follow-up" (currently logs warning and skips). iOS adds the same capability on the same timeline. Keeps initial iOS scope simple.
- **Platform-aware glob pattern in CLI relay**: iOS screenshot paths differ structurally (`/tmp/{session}/{device}_maestro_debug_*/`) from Android (`/tmp/{session}_test_suite/logs/*/screenshots/`). Cleanest solution is SDK-sends-platform, CLI-picks-glob.
- **`nav_bar_height` defaults to 0 on iOS**: iOS has no persistent navigation bar (uses home indicator as part of safe area). Users don't need to set `PERCY_NAV_BAR_HEIGHT` on iOS — default of 0 is correct. Document this.
- **No dedicated MaestroPercySession class on iOS**: Add Percy lifecycle directly to `MaestroSession` following `XCTestSession`'s pattern. Less fragmentation.

## Dependencies / Assumptions

- **Maestro v1.39.x or later** supports iOS on BrowserStack. Confirmed Maestro CLI on BrowserStack hosts already has iOS driver (WebDriverAgent + iproxy).
- **Percy CLI with platform-aware relay (from Android work)** — the CLI branch `feat/maestro-multipart-upload` needs one extra PR for platform-aware glob, or this iOS work adds it there.
- **realmobile branch discipline**: A new feature branch is needed (e.g., `feat/maestro-percy-ios-integration`) and deployed to iOS hosts for testing. Follows the same deploy pattern as Android's `feat/maestro-percy-integration`.
- **GraalJS sandbox behaves identically on iOS** — runs in Maestro's Kotlin/JVM process on the host, platform-independent. Confirmed via Maestro docs.

## Features: iOS Support Assessment

Double-checked each v0.2.0 feature against iOS constraints:

| Feature | iOS support? | Notes |
|---|---|---|
| Basic screenshot capture | ✅ Yes | `takeScreenshot` works on iOS; saves to workspace `.maestro/` |
| Coordinate-based regions (`PERCY_REGIONS`) | ✅ Yes | Pure coordinates, no platform-specific resolution needed |
| Per-region algorithm config | ✅ Yes | Pass-through to Percy comparison pipeline |
| Sync mode (`PERCY_SYNC`) | ✅ Yes | No platform difference — handled by CLI relay |
| `PERCY_STATUS_BAR_HEIGHT` | ✅ Yes | User passes pixel value (accounts for notch/Dynamic Island on modern iPhones) |
| `PERCY_NAV_BAR_HEIGHT` | ✅ Yes (defaults to 0) | iOS has no persistent nav bar; document that users can omit this |
| `PERCY_FULLSCREEN` | ✅ Yes | Boolean flag, platform-independent |
| `PERCY_TH_TEST_CASE_EXECUTION_ID` | ✅ Yes | Pass-through string |
| `PERCY_TEST_CASE` / `PERCY_LABELS` | ✅ Yes | Pass-through |
| Device metadata (name, OS version, dimensions, orientation) | ✅ Yes | User provides via env vars |
| Graceful degradation (invalid regions, bad JSON) | ✅ Yes | Same SDK validation logic |
| Element-based regions | ❌ Deferred | No cross-platform mechanism yet; Android also logs warning and skips |

**All v0.2.0 features except element regions work on iOS with no platform-specific SDK code.** The iOS-specific work lives in realmobile (CLI lifecycle + env var injection) and the CLI relay (platform-aware glob).

## Deploy & Testing Strategy

iOS host infrastructure differs from Android in ways that affect how we test:

| Aspect | Android (mobile) | iOS (realmobile) |
|---|---|---|
| Host OS | Linux | macOS |
| Percy CLI patch target | `/nix/store/jb4rq.../dist/api.js` (read-only, needs sudo) | `/usr/local/.browserstack/realmobile/deps/lib/node_modules/@percy/core/dist/api.js` (writable, likely no sudo needed) |
| realmobile workflow | Git branches | Git tags (but manual branch checkout works for testing) |
| Service restart | `restart_servers` via bshelper | Same `restart_servers` + macOS `launchctl kickstart` services |

### Testing approach

1. **Patching Percy CLI on iOS host:**
   ```bash
   scp patched-api.js <user>@<ios-host>:/usr/local/.browserstack/realmobile/deps/lib/node_modules/@percy/core/dist/api.js
   ssh <user>@<ios-host> "bash /usr/local/.browserstack/bshelper.sh restart_servers"
   ```

2. **Deploying realmobile changes:**
   - Create feature branch `feat/maestro-percy-ios-integration` (mirrors Android's `feat/maestro-percy-integration`)
   - On iOS host: `cd /usr/local/.browserstack/realmobile && git fetch origin feat/maestro-percy-ios-integration && git checkout feat/maestro-percy-ios-integration && restart_servers`
   - Note: iOS normally uses tag-based deploy; manual branch checkout is a test-only override that may be reset on next production deploy

3. **Triggering test builds:**
   - Use `/maestro/v2/ios/build` API endpoint (not `/android/build`)
   - `machine` parameter still targets specific host+device: `<ip>:<device_udid>`
   - Everything else mirrors the Android test pattern

### Verification unknowns (resolve during planning/testing)

- Exact SSH user and port for iOS hosts (Android uses `ritesharora@<ip>` port 4022 — iOS may differ)
- Whether the writable Percy CLI path actually avoids needing `sudo`
- Node version on iOS hosts — may or may not need the same Node 14 compatibility patches (`||=` → `||` replacement) that Android needed

## Outstanding Questions

### Resolve Before Planning

_(None — all product questions resolved)_

### Deferred to Planning

- **[Affects R7][Technical]** Exact iOS screenshot filename format on BrowserStack. The `SCREENSHOTS_DIR` pattern from realmobile research is `/tmp/{session}/{device}_maestro_debug_{classname}_{testname}_{test_num}/`. Need to verify what filename Maestro actually generates inside that dir — does it use `{SCREENSHOT_NAME}.png` or some prefixed variant? Planner to inspect realmobile's screenshot collection code.
- **[Affects R8][Needs research]** Whether iOS Maestro ever emits multiple PNGs per `takeScreenshot` call (e.g., emoji-prefixed debug frames alongside the named capture). If yes, the relay glob needs to match precisely on the user-specified name.
- **[Affects R10-R12][Technical]** Does realmobile's `MaestroSession` have a natural teardown hook (equivalent to Android's session-stop) where Percy CLI stop fits? Planner to identify the right insertion points in `maestro_session.rb`.
- **[Affects R11][Needs research]** Does `build_maestro_command()` in realmobile already support custom env vars, or does it need restructuring to accept `PERCY_SESSION_ID`? The existing `fetch_maestro_env_variables()` reads from user params — Percy injection is a separate, system-level concern.
- **[Affects R12][Needs research]** Testing on BrowserStack iOS requires a new deploy pattern. The Android test flow used `scp` + `sudo cp` to patch the Percy CLI `dist/api.js` on the nix store. Does iOS have the same structure, or is the Percy CLI installed differently on iOS hosts?

## Next Steps

→ `/ce:plan` for structured implementation planning
