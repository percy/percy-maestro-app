# Changelog

All notable changes to `@percy/maestro-app` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
