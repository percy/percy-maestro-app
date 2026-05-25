# Changelog

All notable changes to `@percy/maestro-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.4] — 2026-05-25

Mask system chrome (status bar + Android nav bar) by default. Brings parity with every other Percy mobile SDK — `percy-espresso-java` reads the Android `status_bar_height` / `navigation_bar_height` system resources at runtime, `percy-xcui-swift` uses a device-keyed lookup table with a non-zero fallback, `percy-appium-python` uses Appium driver introspection plus a static device table. Maestro/GraalJS has no equivalent introspection path, so we ship platform-typical constants and let customers override via existing env vars.

### Changed

- **`percy/scripts/percy-screenshot.js`** — `payload.statusBarHeight` and `payload.navBarHeight` now ship with non-zero platform defaults, expressed in **image pixels** (the unit Percy's comparison tile expects). Defaults are intentionally conservative — they prefer leaving a sliver of the status bar visible over masking actual app content:
  - **iOS**: `statusBarHeight = 80` (safely under iPhone 11's 88-px status bar; covers the dynamic clock / signal-icon zone on iPhone 12 / 13 / 14 at 3x scale, where empirically the changing pixels live at y ≤ ~85). `navBarHeight = 0` (iOS has no persistent nav bar).
  - **Android**: `statusBarHeight = 80` (covers modern Pixel-class hardware at 3x density — 24dp × 3 ≈ 72 px), `navBarHeight = 100` (covers gesture-nav home indicator).
  - `PERCY_STATUS_BAR_HEIGHT` and `PERCY_NAV_BAR_HEIGHT` env vars always override the defaults. Customers should override on:
    - Dynamic Island devices (iPhone 14 Pro / 15 / 16 family): `PERCY_STATUS_BAR_HEIGHT="180"`
    - iPhone 14 / 15 / 16 standard (residual sliver near y=80-85): `PERCY_STATUS_BAR_HEIGHT="100"`
    - Android 3-button-nav devices (48dp nav): `PERCY_NAV_BAR_HEIGHT="144"`

### Why this matters

Before this release, every Maestro snapshot from this SDK contributed false-positive pixel diffs from the system clock, battery icon, signal strength, and (on Android) the gesture indicator / 3-button nav region. Customers had to know to set `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` to opt into the masking behaviour that every other Percy mobile SDK applied automatically. Defaults move us to behaviour parity.

### Customer migration

None required — this is a behaviour improvement, not a breaking change. Two notes:

- Customers who were explicitly setting `PERCY_STATUS_BAR_HEIGHT="0"` or `PERCY_NAV_BAR_HEIGHT="0"` to **disable** masking will continue to get those exact values (override path unchanged). However, an unset env var now defaults to the platform constants above.
- Customers running Dynamic Island devices (iPhone 14 Pro / 15 / 16) or non-default Android hardware should continue to override `PERCY_STATUS_BAR_HEIGHT` for an exact safe-area fit.

### `clientInfo`

Telemetry string bumps from `percy-maestro-app/1.0.0-beta.3` to `percy-maestro-app/1.0.0-beta.4`.

## [1.0.0-beta.3] — 2026-05-25

Revert the "SDK owns the path" mode introduced in `1.0.0-beta.2`. The SDK now always passes a bare relative `SCREENSHOT_NAME` to `takeScreenshot:` and never sends a `filePath` field to the Percy CLI relay. The CLI relay's legacy glob finds the file at the runner-injected `SCREENSHOTS_DIR` layout — the same battle-tested path that was the only path in production before `1.0.0-beta.2`.

### Why this regression existed

`1.0.0-beta.2`'s prepare script constructed an **absolute** screenshot path (`/tmp/<sid>_test_suite/percy/<NAME>` on Android, `/tmp/<sid>/percy/<NAME>` on iOS) and passed it to `takeScreenshot:`. The design rested on the assumption that `takeScreenshot:` honors absolute paths as-is. Per-version Maestro source-code audit on 2026-05-25 showed this is not how Maestro behaves on the versions BrowserStack runs:

- **Android pool — Maestro 1.39.13 / "1.39.15"** uses `new File(screenshotsDir, suppliedPath)` at [`Orchestra.kt:812-820`](https://github.com/mobile-dev-inc/maestro/blob/cli-1.39.13/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L812-L820). Per the JDK [`File(File, String)` Javadoc](https://docs.oracle.com/javase/8/docs/api/java/io/File.html#File-java.io.File-java.lang.String-): "If the child pathname string is absolute then it is converted into a relative pathname in a system-dependent way." On POSIX, this produces a **doubled path**: `<SCREENSHOTS_DIR>/tmp/<sid>_test_suite/percy/<NAME>.png`. The SDK then sends the un-doubled SDK-chosen path as `payload.filePath` to the relay; the relay's realpath check resolves the SDK's path (which doesn't exist on disk), returns `404 Screenshot not found`, and the build fails with `"Snapshot command was not called"`. ("1.39.15" in BS internal session logs is a BS-patched derivative of upstream 1.39.13; latest upstream 1.39.x tag is 1.39.13.)
- **iOS pool — Maestro 2.0.7** uses `screenshotsDir.resolve(pathStr).toFile()` at [`Orchestra.kt:943-952`](https://github.com/mobile-dev-inc/maestro/blob/cli-2.0.7/maestro-orchestra/src/main/java/maestro/orchestra/Orchestra.kt#L943-L952). Per the JDK [`Path.resolve(String)` Javadoc](https://docs.oracle.com/javase/8/docs/api/java/nio/file/Path.html#resolve-java.lang.String-): "If the other parameter is an absolute path then this method trivially returns other." iOS therefore should not produce a doubled path on POSIX — yet the surface symptom is identical (`"Snapshot command was not called"`) on the iOS host. The exact iOS failure mechanism is not yet captured live (candidates: realmobile wrapper layer concatenation, missing `mkdir -p` for the SDK-chosen `/tmp/<sid>/percy/` directory, or `${output.percyScreenshotPath}` interpolation in the YAML dropping a leading `/`). The fix sidesteps all three.

The regression was masked in production only because every BS host today pins `@percy/core@1.30.0` — which fails the SDK's `coreSupportsFilePath` version gate at `≥ 1.31.11-beta.1` and silently falls back to the relative `SCREENSHOT_NAME` path. The moment `bs-nixpkgs` bumps the percy-cli derivation to a release containing the `filePath`-accepting code (PR [cli#2217](https://github.com/percy/cli/pull/2217)), every Maestro + Percy build on BrowserStack would regress on day one across both platforms with a silent zero-snapshot symptom.

### Changed

- **`percy/scripts/percy-prepare-screenshot.js`** — removed the `coreSupportsFilePath` version-gate helper, the `canUseFilePath` evaluation, and the absolute-path branch. The script now always sets `output.percyScreenshotPath` to the bare relative `SCREENSHOT_NAME` (or `"percy-screenshot"` fallback if unset). The inline healthcheck self-init is unchanged.
- **`percy/scripts/percy-screenshot.js`** — removed the `payload.filePath` assignment. The script no longer reads `output.percyUsesFilePath`. The on-the-wire POST body to `/percy/maestro-screenshot` becomes a strict subset of the `1.0.0-beta.2` payload (only the `filePath` field is dropped); all other fields including `regions` / `ignoreRegions` / `considerRegions` / `tag` / `clientInfo` are unchanged.

### Compatibility

- **All Percy CLI versions** — identical SDK behavior. The version gate is gone. The CLI relay's `/percy/maestro-screenshot` `filePath` accept code at `cli/packages/core/src/api.js:375-385` stays in place (no breaking change for hypothetical external clients) but is no longer exercised by this SDK.
- **All Maestro versions** — `takeScreenshot:` path-joining behavior for **relative** paths has been consistent since v0; the file lands under `SCREENSHOTS_DIR`, where the CLI relay's legacy glob finds it.
- **Regions, sync mode, tag metadata, fullscreen, status/nav bar heights** — all unchanged from `1.0.0-beta.2`.

### Rollout sequencing (required)

This SDK release **must** land in `bs-nixpkgs` and deploy to the BS host fleet **before** any `@percy/cli` derivation bump to a version containing PR cli#2217. If the cli bump lands first, prod regresses. The recommended `bs-nixpkgs` PR shape is a standalone SDK-derivation bump that explicitly blocks the future cli pin change.

### `clientInfo`

Telemetry string bumps from `percy-maestro-app/1.0.0-beta.2` to `percy-maestro-app/1.0.0-beta.3` per the bump checklist in [`RELEASING.md`](./RELEASING.md).

### Plan

Full planning context, system-wide impact audit, and Go/No-Go rollout checklist: [`docs/plans/2026-05-25-001-fix-sdk-percy-screenshot-path-relative-plan.md`](./docs/plans/2026-05-25-001-fix-sdk-percy-screenshot-path-relative-plan.md).

## [1.0.0-beta.2] — 2026-05-12

Decouple the screenshot save path from the BrowserStack-infra `SCREENSHOTS_DIR` convention. The SDK now owns the path end-to-end when the running Percy CLI supports the new `filePath` field on `/percy/maestro-screenshot`; older CLIs fall back to the existing behavior with no customer-visible change. Surfaced by build `0444158…` where a BS-infra patch put PNGs one directory level too shallow relative to the CLI's hardcoded glob and snapshots silently failed with `"Snapshot command was not called"`.

### Added

- **`percy/scripts/percy-prepare-screenshot.js`** — new prepare runScript that runs immediately before `takeScreenshot:` inside the `percy-screenshot` subflow. Computes the screenshot save path: `/tmp/<sid>_test_suite/percy/<name>.png` on Android, `/tmp/<sid>/percy/<name>.png` on iOS, when the running Percy CLI is `≥ 1.31.11-beta.1`. Falls back to the relative `SCREENSHOT_NAME` for older CLIs. Sets `output.percyScreenshotPath` and `output.percyUsesFilePath` for downstream steps.

### Changed

- **`percy/flows/percy-screenshot.yaml`** — now a three-step subflow: prepare → takeScreenshot → upload. The customer-facing usage (`- runFlow: percy/flows/percy-screenshot.yaml`) is unchanged; the change is entirely internal to the subflow.
- **`percy/scripts/percy-screenshot.js`** — reads `output.percyUsesFilePath` and `output.percyScreenshotPath` from the prepare step and forwards the absolute path as the `filePath` payload field when the version gate passes. Omits `filePath` entirely on the legacy path so older CLIs see a byte-identical payload to v1.0.0-beta.1.

### Compatibility

- **Percy CLI `≥ 1.31.11-beta.1`** — the SDK posts `filePath` and the CLI reads the file directly, skipping the legacy glob.
- **Percy CLI `< 1.31.11-beta.1`** — the SDK falls back to the relative `SCREENSHOT_NAME`, Maestro saves wherever `SCREENSHOTS_DIR` points (BS-infra contract). The CLI's legacy glob finds the file as before. No customer-visible behaviour change.

The version gate compares `x-percy-core-version` from the healthcheck response; unknown / malformed version strings degrade safely to the legacy path.

### BrowserStack-infra notes

The v4 `SCREENSHOTS_DIR=…/screenshots` patch in `mobile-pr/android/maestro/scripts/maestro_runner.rb` is no longer the primary save-location signal but remains as a back-compat safety net for customers running older SDK + new CLI. Removal can be tracked separately once older SDK versions are retired from customer test suites.

### `clientInfo`

Telemetry string bumps from `percy-maestro-app/1.0.0-beta.1` to `percy-maestro-app/1.0.0-beta.2` per the bump checklist in [`RELEASING.md`](./RELEASING.md).

## [1.0.0-beta.1] — 2026-05-06

Pre-publish iteration. Issues found during the first end-to-end smoke on a real BrowserStack Maestro v2 build (host `31.6.63.33`, Samsung Galaxy S22, build `https://percy.io/9560f98d/app/androidmaestroapp-e4f6fe82/builds/49435096`).

### Fixed

- **`SCREENSHOT_NAME` strict-naming gate.** The Percy CLI relay endpoint validates names against `^[a-zA-Z0-9_-]+$` and returns HTTP 400 `"Invalid screenshot name"` for anything else (spaces, em-dashes, dots, slashes). Previously the SDK forwarded the name as-is and the relay rejection only surfaced as a generic `[percy] Upload failed: 400` line — easy to miss in BS dashboard logs. The SDK now validates the name in `percy/scripts/percy-screenshot.js` before the POST and throws a clear error: `[percy] SCREENSHOT_NAME must match [a-zA-Z0-9_-]+`. The `takeScreenshot:` step writes the file using the raw name, so silent sanitization would create a file/payload mismatch — failing fast is the right move.

### Changed

- **README: BrowserStack build payload uses `appPercy` for both Android and iOS.** Previous docs split Android (`percyOptions`) from iOS (`appPercy`). End-to-end testing on BS Maestro v2 confirms the Android `/maestro/v2/android/build` endpoint silently drops `percyOptions` — the working field name is `appPercy` on both platforms. The "Note on naming" paragraph (camelCase → snake_case translation) still applies to both.
- **README: `Snapshot naming` section added.** Explicit good / bad examples and the rationale for the character-class restriction (the CLI uses the name in a filesystem glob).
- **README: example snapshot names use safe characters.** `Home Screen` / `Settings Screen` are now `HomeScreen` / `SettingsScreen` (would have been rejected by the relay if a customer had copy-pasted them verbatim).

### `clientInfo`

Telemetry string bumps from `percy-maestro-app/1.0.0-beta.0` to `percy-maestro-app/1.0.0-beta.1` per the bump checklist in [`RELEASING.md`](./RELEASING.md).

## [1.0.0-beta.0] — 2026-05-06

### Changed

- **Distribution: now an npm package.** The SDK is now published as `@percy/maestro-app` on npm. Previously customers were instructed to copy the `percy/` directory into their workspace. The old "copy this directory" workflow continues to work — `npm install --save-dev @percy/maestro-app` produces the same `percy/flows/` and `percy/scripts/` layout under `node_modules/@percy/maestro-app/percy/`, which can either be referenced by path or vendored into a flows zip.
- **`clientInfo` telemetry string changed** from `percy-maestro/X.Y.Z` to `percy-maestro-app/X.Y.Z`. Internal queries against Percy CLI debug logs that filtered on `percy-maestro/` should be widened to also match `percy-maestro-app/`.
- **README rewritten** around the npm install workflow, with a recommended vendor-copy pattern (`prepare-zip` style script) for BrowserStack zip uploads.

### Added

- `package.json` with explicit `files` whitelist — only `percy/`, `README.md`, `LICENSE`, and `CHANGELOG.md` ship in the published tarball.
- `RELEASING.md` documenting the bump checklist, beta-soak protocol, content-audit step, 2FA + provenance requirements, and deprecate-and-patch rollback template.

### Migration

If you previously copied the `percy/` directory into your Maestro workspace by hand, you can keep doing exactly that — npm now gives you a versioned source. Two consumption modes are supported:

- **Reference under `node_modules`:** `runFlow: ../node_modules/@percy/maestro-app/percy/flows/percy-screenshot.yaml`
- **Vendor copy (recommended for BrowserStack zip uploads):** `cp -r node_modules/@percy/maestro-app/percy ./percy` then keep your existing `runFlow: percy/flows/percy-screenshot.yaml` calls

See the [README](./README.md) for full details.

## [0.4.0] — 2026-04-21

### Breaking (iOS customers on v0.3.0)

- **BrowserStack iOS Maestro build-API payload shape corrected.** iOS customers now use `appPercy: {PERCY_TOKEN, env: {...}}` (matches the `percy-xcui-swift` iOS Percy SDK convention). On v0.3.0, the documented `percyOptions: {enabled, percyToken}` shape was silently dropped by BrowserStack's iOS Maestro bridge, resulting in "successful" builds with zero Percy snapshots uploaded. Android customers are **unaffected** — Android continues to use `percyOptions`.

**Migration for iOS customers:**

```diff
  curl -u "$BS_USER:$BS_KEY" \
    -X POST "https://api-cloud.browserstack.com/app-automate/maestro/v2/ios/build" \
    -H "Content-Type: application/json" \
    -d '{
      "app": "<APP_URL>",
      "testSuite": "<TEST_SUITE_URL>",
      "devices": ["iPhone 14-16"],
      "project": "my-project",
-     "percyOptions": {
-       "enabled": true,
-       "percyToken": "<PERCY_TOKEN>"
-     }
+     "appPercy": {
+       "PERCY_TOKEN": "<PERCY_TOKEN>",
+       "env": {
+         "PERCY_BRANCH": "main"
+       }
+     }
    }'
```

### Added

- **`appPercy.env` pass-through (iOS).** Any `PERCY_*` environment variable in `appPercy.env` is forwarded into the Percy CLI's process environment at startup on the BrowserStack host. Common uses: `PERCY_BRANCH`, `PERCY_PROJECT`, `PERCY_COMMIT` — these now correctly tag the Percy build with the caller's intended branch/project/commit.
- **Louder SDK healthcheck failure banner.** When `percy-init` can't reach the Percy CLI (connection refused, auth rejected, server error), the SDK now emits a prominent `[percy] DISABLED — this build will have zero Percy screenshot coverage` multi-line banner to Maestro stdout. Previously the failure was a single log line easy to miss.
- **Per-skipped-screenshot warning.** When Percy is disabled (healthcheck failed earlier in the flow), each `percy-screenshot` sub-flow call now logs `[percy] SKIPPED snapshot "<name>" — Percy disabled` instead of a generic "not enabled" message. Helps users whose Maestro stdout scrolls past the init log.
- **Sub-flow YAML now parses on Maestro 1.39+.** `percy/flows/percy-init.yaml` and `percy/flows/percy-screenshot.yaml` now include a stub `appId` config section. Maestro 1.39 (used by BrowserStack iOS Maestro) rejects YAML files without a non-null `appId`; earlier Maestro versions tolerated bare sub-flows. The stub is ignored at runtime because `runFlow` inherits the caller's app context.

### Documentation

- README now has a dedicated "BrowserStack Integration" section with side-by-side Android (`percyOptions`) and iOS (`appPercy`) curl examples, a note explaining the asymmetry, per-project-token hygiene guidance, and `appPercy.env` safe-character guidance.
- CLAUDE.md has a new "Platform Differences > BrowserStack build-API payload asymmetry" subsection documenting the camelCase (API) ↔ snake_case (realmobile internal) mapping.
- "Features not supported" table expanded: element-based regions re-labeled as deferred for both iOS and Android; added an explicit note on why iOS device metadata cannot be auto-detected (GraalJS sandbox blocks native iOS bindings like `uname`, `UIDevice.current`).

### Security

- `appPercy.env` values are interpolated into the `percy app exec:start` shell command on BrowserStack hosts (single-quote-wrapped). Customer-controlled values containing shell metacharacters could in theory escape the quoting; realmobile-side hardening (argv-array spawning or `Shellwords.escape`) is tracked separately. Until that lands, README documents safe-character guidance (alphanumeric + `.`, `_`, `-`) for `appPercy.env` values.

## [0.3.0] — Initial iOS support (superseded)

- Initial iOS platform gate (`maestro.platform` check allows `android` and `ios`).
- iOS screenshot glob pattern on the Percy CLI relay (`/tmp/{sessionId}/*_maestro_debug_*/{name}.png`).
- `tag.osName` derived from `maestro.platform` ("Android" or "iOS").
- `platform` field added to the `/percy/maestro-screenshot` relay payload.
- **Known defect (fixed in 0.4.0):** iOS documentation and examples used the Android `percyOptions` payload shape for the BrowserStack build API. BrowserStack's iOS Maestro bridge silently drops `percyOptions`, so v0.3.0 iOS builds pass with zero Percy snapshots uploaded. iOS customers on v0.3.0 should upgrade to 0.4.0 and switch to `appPercy`.
