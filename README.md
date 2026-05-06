# @percy/maestro-app

[Percy](https://percy.io) visual testing for [Maestro](https://maestro.mobile.dev/) mobile testing flows. Supports Android and iOS.

> **Runtime:** supported on BrowserStack Maestro sessions (Android + iOS).
> See [Runtime support](#runtime-support) for details.

## Prerequisites

- Node.js 14+ and npm (or yarn)
- [`@percy/cli`](https://github.com/percy/cli) with maestro-screenshot relay support
- [Maestro](https://maestro.mobile.dev/) 2.0+
- An Android or iOS app under test (iOS supported on BrowserStack real devices)

## Installation

```sh
npm install --save-dev @percy/maestro-app @percy/cli
```

The SDK is a set of Maestro sub-flows and GraalJS scripts. Two consumption modes are supported — both target BrowserStack Maestro sessions (the only [supported runtime](#runtime-support)). They differ only in zip composition.

### Mode A — Reference under `node_modules`

Reference the SDK files directly from your YAML flow:

```yaml
- runFlow:
    file: ../node_modules/@percy/maestro-app/percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Home
```

When zipping for BrowserStack upload, include `node_modules/@percy/maestro-app/` next to your `flows/` directory in the zip.

### Mode B — Vendor copy (recommended for BrowserStack uploads)

Copy the SDK into your workspace as part of your zip-prep step:

```sh
cp -r node_modules/@percy/maestro-app/percy ./percy
```

Your zipped workspace then has the layout used by every example in this README:

```
your-maestro-workspace/
  percy/
    flows/
      percy-init.yaml
      percy-screenshot.yaml
    scripts/
      percy-healthcheck.js
      percy-screenshot.js
  your-flow.yaml
```

And your YAML uses the shorter path:

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Home
```

Mode B produces a smaller zip with no path-resolution surprises and is migration-compatible with the pre-1.0 "copy this directory" workflow — your existing YAML keeps working unchanged.

### Migrating from the pre-npm distribution

If you previously copied the `percy/` directory into your workspace by hand, npm now gives you a versioned source. Mode B's `cp` step replaces the manual copy; your flow YAML does not change.

## Usage

### Take a screenshot

Add a `runFlow` step wherever you want to capture a screenshot. Pass the `SCREENSHOT_NAME` environment variable to name the snapshot.

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Homepage
```

The first screenshot in a flow runs a Percy CLI healthcheck automatically; subsequent screenshots reuse the cached result. No explicit init step is required.

### Full example

```yaml
appId: com.example.myapp
---
- launchApp

- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Home Screen

- tapOn: "Settings"

- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Settings Screen
```

Run the flow with Percy:

```bash
npx percy app:exec -- maestro test your-flow.yaml
```

### Optional: eager initialization

If you want the healthcheck to run at flow start (so a Percy outage surfaces in the logs before any test steps), add this once at the top of your flow:

```yaml
- runFlow: percy/flows/percy-init.yaml
```

This is purely opt-in — `percy-screenshot.yaml` self-initializes on first call regardless.

## Configuration

Device metadata and other options are passed as environment variables to your Maestro flow.

### Core Options

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCREENSHOT_NAME` | Yes (per screenshot) | - | Name for the screenshot; must be unique per snapshot |
| `PERCY_SERVER` | No | `http://percy.cli:5338` | Percy CLI server address |
| `PERCY_DEVICE_NAME` | Yes | - | Device name for the Percy tag (e.g. `Pixel 7`) |
| `PERCY_OS_VERSION` | Yes | - | OS version (e.g. `13` for Android, `17` for iOS) |
| `PERCY_SCREEN_WIDTH` | Yes | - | Screen width in pixels |
| `PERCY_SCREEN_HEIGHT` | Yes | - | Screen height in pixels |
| `PERCY_ORIENTATION` | No | `portrait` | Screen orientation (`portrait` or `landscape`) |
| `PERCY_TEST_CASE` | No | - | Test case name for grouping snapshots |
| `PERCY_LABELS` | No | - | Comma-separated labels for the snapshot |

### Comparison Options

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PERCY_REGIONS` | No | - | JSON array of regions for ignore/consider (see [Regions](#regions)) |
| `PERCY_SYNC` | No | `false` | Set to `"true"` to wait for comparison result and log details |
| `PERCY_STATUS_BAR_HEIGHT` | No | `0` | Status bar height in pixels (excluded from comparison tile) |
| `PERCY_NAV_BAR_HEIGHT` | No | `0` | Navigation bar height in pixels (excluded from comparison tile) |
| `PERCY_FULLSCREEN` | No | `false` | Set to `"true"` if the screenshot is fullscreen (no system chrome) |
| `PERCY_TH_TEST_CASE_EXECUTION_ID` | No | - | Test harness execution ID for CI/CD correlation |

Pass environment variables when running Maestro:

```bash
npx percy app:exec -- maestro test \
  -e PERCY_DEVICE_NAME="Pixel 7" \
  -e PERCY_OS_VERSION="13" \
  -e PERCY_SCREEN_WIDTH="1080" \
  -e PERCY_SCREEN_HEIGHT="2400" \
  -e PERCY_STATUS_BAR_HEIGHT="50" \
  -e PERCY_NAV_BAR_HEIGHT="48" \
  your-flow.yaml
```

### iOS-specific guidance

The SDK auto-detects the platform via `maestro.platform` — no flag change needed
between Android and iOS flows.

- **`PERCY_NAV_BAR_HEIGHT`**: iOS has no persistent navigation bar. Omit this env
  var on iOS flows (the SDK will not add the field; the CLI defaults to 0).
- **`PERCY_STATUS_BAR_HEIGHT`**: include the notch / Dynamic Island in the value
  if you want the full safe-area excluded from the comparison tile. Typical values:
  - iPhone 14 Pro (Dynamic Island): `59`
  - iPhone 13/14 (notch): `47`
  - iPhone SE (no notch): `20`
- **`PERCY_DEVICE_NAME`**: set to the user-visible device name (e.g. `iPhone 15 Pro`).
- **`PERCY_OS_VERSION`**: iOS major version (e.g. `17`).
- **`PERCY_SCREEN_WIDTH` / `PERCY_SCREEN_HEIGHT`**: device physical pixel
  dimensions. These are pixel values, not points — e.g. iPhone 15 Pro is
  `1179 × 2556` pixels.

Example iOS invocation:

```bash
npx percy app:exec -- maestro test \
  -e PERCY_DEVICE_NAME="iPhone 15 Pro" \
  -e PERCY_OS_VERSION="17" \
  -e PERCY_SCREEN_WIDTH="1179" \
  -e PERCY_SCREEN_HEIGHT="2556" \
  -e PERCY_STATUS_BAR_HEIGHT="59" \
  your-flow.yaml
```

## Regions

Regions let you control which parts of a screenshot Percy compares. Each region specifies an area and an algorithm.

### Algorithms

| Algorithm | Behavior |
|-----------|----------|
| `ignore` | Percy skips this area entirely — any change inside is invisible |
| `standard` | Percy compares normally with standard diff sensitivity |
| `intelliignore` | Percy uses AI-powered comparison that ignores dynamic content like ads and carousels |
| `layout` | Percy checks structural layout but tolerates pixel-level differences |

"Consider region" behavior (focusing comparison on a specific area) is achieved by using `standard` or `intelliignore` on a bounded region.

### Coordinate-based regions

Specify pixel coordinates directly. Coordinates are relative to the screenshot (0,0 is top-left).

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: HomeScreen
      PERCY_REGIONS: '[{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"}]'
```

### Element-based regions

Identify regions by view-hierarchy attributes. Selectors are forwarded to the Percy CLI relay, which resolves them to pixel boxes per platform — Android via ADB view-hierarchy dump, iOS via WebDriverAgent source dump.

| Platform | Supported selector keys (V1) |
|----------|------------------------------|
| Android  | `resource-id`, `text`, `content-desc`, `class` |
| iOS      | `id` (accessibility identifier), `class` |

iOS `text` and `xpath` selectors are deferred to V1.1 — `text` needs predicate-string escaping and `xpath` needs a DoS-complexity heuristic against deep UI trees.

```yaml
# Android
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: HomeScreen
      PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/clock"},"algorithm":"ignore"}]'
```

```yaml
# iOS
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: HomeScreen
      PERCY_REGIONS: '[{"element":{"id":"clock-label"},"algorithm":"ignore"}]'
```

> **Status:** element-based regions require a Percy CLI that ships the
> per-platform resolver (ADB resolver for Android, WDA source-dump resolver
> for iOS). Until a resolver-supporting CLI is deployed to your BrowserStack
> Maestro runner, element regions log a warning and are skipped. Coordinate
> regions continue to work during the transition.

### Multi-match behavior

When a selector matches multiple views, the **first match in pre-order traversal** wins (same as `percy-appium-python`). Write more specific selectors to disambiguate when needed.

### Release-build caveat (Android)

Android release builds with `shrinkResources` + R8 resource optimization (AGP 8.12+) may rename the values surfaced as `resource-id`. For selectors that must survive release builds, prefer `content-desc` (accessibility-stable — R8 does not rename) or keep IDs via `keep.xml` / `tools:keep`. iOS selectors are unaffected.

### Advanced: per-region configuration

Each region can include fine-grained diff settings:

```yaml
PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/header"},"algorithm":"standard","configuration":{"diffSensitivity":3,"imageIgnoreThreshold":0.1}}]'
```

Configuration options: `diffSensitivity` (0-4), `imageIgnoreThreshold` (0-1), `carouselsEnabled`, `bannersEnabled`, `adsEnabled`.

Each region may also include `padding` and `assertion` objects, which are forwarded to the Percy comparison pipeline verbatim.

### Multiple regions

```yaml
PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/clock"},"algorithm":"ignore"},{"element":{"text":"Submit"},"algorithm":"intelliignore"},{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"}]'
```

### Full example with all options

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: HomeScreen
      PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/clock"},"algorithm":"ignore"},{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"}]'
      PERCY_SYNC: "true"
      PERCY_STATUS_BAR_HEIGHT: "50"
      PERCY_NAV_BAR_HEIGHT: "48"
      PERCY_FULLSCREEN: "false"
      PERCY_TH_TEST_CASE_EXECUTION_ID: "TH-12345"
```

### Graceful degradation

- Invalid JSON in `PERCY_REGIONS` → warning logged, screenshot uploads without regions
- Individual malformed regions → skipped with a per-region warning, valid regions still sent
- Invalid bar heights (non-numeric) → silently omitted; CLI defaults (0) apply
- Element region with no matching view → per-element warning at the CLI; valid regions still upload
- Element resolver unavailable (ADB unreachable on Android, WDA unreachable on iOS) → one warning, all element regions skipped, coordinate regions still upload

## Runtime support

This SDK is supported on **BrowserStack Maestro sessions** (Android and iOS). The Percy CLI's `/percy/maestro-screenshot` relay expects BrowserStack's session-directory file layout (`/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`). Running `maestro test` locally on your laptop is not a supported runtime — the healthcheck will pass but screenshot uploads will 404.

## BrowserStack Integration

You can run Percy Maestro flows on BrowserStack by uploading your Maestro workspace as a zip to the BrowserStack Maestro API. The recommended pattern is **Mode B (vendor copy)** from the [Installation](#installation) section: copy `node_modules/@percy/maestro-app/percy` into your workspace, then zip and upload.

```sh
npm install --save-dev @percy/maestro-app @percy/cli
cp -r node_modules/@percy/maestro-app/percy ./percy
cd flows && zip -r ../Flows.zip . && cd ..
```

The resulting `Flows.zip` contains your YAML flows plus a vendored `percy/` directory at the same path your `runFlow:` calls reference.

### Enabling Percy in a BrowserStack build

The way you enable Percy in the BrowserStack Maestro build API **differs between iOS and Android**. Android uses `percyOptions`; iOS uses `appPercy`. This asymmetry is intentional — `appPercy` matches BrowserStack's iOS convention (as used by the `percy-xcui-swift` SDK), and Android's `percyOptions` is already in production use.

**Android:**

```bash
curl -u "$BS_USER:$BS_KEY" \
  -X POST "https://api-cloud.browserstack.com/app-automate/maestro/v2/android/build" \
  -H "Content-Type: application/json" \
  -d '{
    "app": "<APP_URL>",
    "testSuite": "<TEST_SUITE_URL>",
    "devices": ["Samsung Galaxy S22-13.0"],
    "project": "my-percy-maestro-project",
    "percyOptions": {
      "enabled": true,
      "percyToken": "<PERCY_TOKEN>"
    }
  }'
```

**iOS:**

```bash
curl -u "$BS_USER:$BS_KEY" \
  -X POST "https://api-cloud.browserstack.com/app-automate/maestro/v2/ios/build" \
  -H "Content-Type: application/json" \
  -d '{
    "app": "<APP_URL>",
    "testSuite": "<TEST_SUITE_URL>",
    "devices": ["iPhone 14-16"],
    "project": "my-percy-maestro-project",
    "appPercy": {
      "PERCY_TOKEN": "<PERCY_TOKEN>",
      "env": {
        "PERCY_BRANCH": "main"
      }
    }
  }'
```

On iOS, the `appPercy.env` sub-object can carry any `PERCY_*` environment variable your Percy build should see — commonly `PERCY_BRANCH`, `PERCY_PROJECT`, `PERCY_COMMIT`. These values are forwarded into the Percy CLI's environment on the BrowserStack host.

**Note on naming:** BrowserStack's public-API parameter is camelCase (`appPercy`). On the BrowserStack host, it is translated to snake_case (`app_percy`) in internal session params. Customers pass `appPercy`; the translation is automatic.

### Percy token hygiene

- **Use a per-project Percy token** when running on BrowserStack App Automate. The token transits BrowserStack infrastructure to reach the Percy CLI on the host. Don't reuse an org-scoped master token for CI builds — use a project-scoped token you can rotate independently.
- **`appPercy.env` safe-character guidance:** values should contain only alphanumeric characters plus `.`, `_`, `-`. Branch names like `main`, `feature/abc_1`, project slugs, and commit SHAs all fit. Avoid spaces, quotes, semicolons, backticks, and other shell metacharacters — they can cause unexpected behavior in the env-forwarding mechanism.

See the [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started) for the general upload/build flow.

## How it works

The Percy Maestro SDK works in two stages:

1. **Initialization (lazy)** -- The first `percy-screenshot` call in a flow runs a healthcheck against the Percy CLI server to verify it is available, caching the result in `output.percyEnabled` so subsequent screenshots short-circuit. If the CLI is not running or not reachable, Percy is silently disabled for the rest of the flow. The optional `percy-init` sub-flow runs the same healthcheck eagerly at flow start — useful when you want CI logs to surface a Percy outage before any test steps.

2. **Screenshot capture** -- Each `percy-screenshot` sub-flow call uses Maestro's built-in `takeScreenshot` command to save a PNG to disk, then runs a JS script that sends screenshot metadata (name, session ID, device tag, regions, tile options) as a JSON POST to the Percy CLI's `/percy/maestro-screenshot` relay endpoint. The Percy CLI finds the screenshot file on disk, base64-encodes it, resolves any element-based regions, and uploads the comparison.

## Features not supported

This section is split into two parts so you can tell *can't build on this runtime* apart from *haven't built yet*.

### Architectural limits (not feasible on this runtime)

These features are blocked by the Maestro / BrowserStack / GraalJS runtime itself. They are not on our roadmap because the underlying environment does not support the mechanism.

| Feature | Reason | Workaround |
|---------|--------|-----------|
| BrowserStack session ↔ Percy build correlation via `browserstack_executor: percyScreenshot begin/end` | Maestro's GraalJS script environment has no Appium driver or `executeScript` surface through which the `browserstack_executor:` string is interpreted. Equivalent correlation would require a BrowserStack Maestro-runner infra change, not an SDK change. | Match `--build-name` between `percy app:exec` and the BrowserStack Maestro build request, or read `BROWSERSTACK_BUILD_ID` from the Maestro flow env and include it in your snapshot names. |
| `fullPage` / `scrollableXpath` / `scrollableId` / `screenLengths` | Maestro controls scrolling via YAML `scroll` commands. | Capture multiple screenshots with `scroll` steps between them. |
| `freezeAnimations` / `percyCSS` / `enableJavascript` | DOM/web-specific. Native mobile screenshots are bitmap captures — no DOM to manipulate. | Use Maestro's own animation controls (e.g., `waitForAnimationToEnd`) before `takeScreenshot`. |
| XPath region selectors on Android | Android view hierarchy does not expose XPath. | Use `resource-id` / `text` / `content-desc` / `class` instead. |
| Auto-detect device metadata on iOS | Maestro's GraalJS sandbox blocks native iOS bindings (`uname`, `UIDevice.current`, `XCUIDevice.shared.orientation`) that SDKs like `percy-xcui-swift` use. | Pass `PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH`, `PERCY_SCREEN_HEIGHT`, `PERCY_ORIENTATION` via flow env vars. |
| Percy on Automate (POA) | POA requires Appium-style driver capabilities and a live session; Maestro has no equivalent execution model. | Use standard Percy snapshot uploads (this SDK) for Maestro-on-BrowserStack. |
| iOS simulator | BrowserStack runs real iOS devices; the SDK is not tested against simulators. | Use BrowserStack real-device iOS sessions. |
| Local `maestro test` runtime | The CLI relay expects BrowserStack's session-directory file layout. | Run on BrowserStack Maestro. See [Runtime support](#runtime-support). |

### Deferred / on roadmap

These are implemented partially or not yet and are expected to land in a future round. Use the interim workaround if you are blocked today.

**Planned for the next round:**

| Feature | Status | Interim workaround |
|---------|--------|-------------------|
| `PERCY_IGNORE_ERRORS` / `PERCY_ENABLED` kill-switches | Appium-style config; planned for the next sprint. | Unset `PERCY_TOKEN` in your Maestro flow env to disable Percy without a code change, or remove the `percy-init` / `percy-screenshot` `runFlow` steps from your flow. |
| iOS element-region V1.1 selectors (`text`, `xpath`) | V1 ships `id` + `class` only. `text` requires WDA predicate-string escaping; `xpath` requires a DoS-complexity heuristic. Both deferred to V1.1. | Use `id` or `class` selectors on iOS in the meantime, or fall back to coordinate-based regions. |

**Under evaluation (no committed timeline):**

| Feature | Status |
|---------|--------|
| `PERCY_LABELS` rendering in Percy dashboard | The SDK forwards `labels` to the Percy CLI relay correctly, but `percy/core` 1.31.11-beta.0 (and current stable) rejects `labels` on the snapshot-options schema as `"unknown property"` and strips it client-side. Snapshot still uploads; labels are not stored. Fix is a `percy/core` schema update — not an SDK change. |
| `/percy/events` failure telemetry | Not yet forwarded by the SDK. |
| Sync mode (`PERCY_SYNC`) | Implemented in the SDK (accepts the env var and logs the sync result when the relay returns one) but unproven end-to-end on BrowserStack; a prior round saw a 403 on the sync-result query that is believed unrelated backend behavior. |
| `PERCY_TH_TEST_CASE_EXECUTION_ID` dashboard rendering | The SDK forwards this field to the Percy backend (verified end-to-end). However, no Percy dashboard surface currently renders it — this is a `percy-api` serializer gap, tracked separately from this SDK. TestHub integrators can read the value from the Percy CLI debug log. |

## Links

- [Percy documentation](https://www.browserstack.com/docs/percy)
- [Percy CLI GitHub](https://github.com/percy/cli)
- [Maestro documentation](https://maestro.mobile.dev/)
- [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started)

## License

MIT
