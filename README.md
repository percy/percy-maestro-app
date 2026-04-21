# percy-maestro

[Percy](https://percy.io) visual testing for [Maestro](https://maestro.mobile.dev/) mobile testing flows.

## Prerequisites

- [Percy CLI](https://github.com/percy/cli) with maestro-screenshot relay support
- [Maestro](https://maestro.mobile.dev/) 2.0+
- An Android or iOS app under test (iOS supported on BrowserStack real devices)

## Installation

Copy the `percy/` directory into your Maestro workspace:

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

No package manager or build step is required. The SDK is a set of Maestro sub-flows and JS scripts that you include directly in your workspace.

## Usage

### Initialize Percy

Add a `runFlow` step at the beginning of your Maestro flow to initialize Percy. This performs a healthcheck against the Percy CLI server and sets `percyEnabled` for downstream steps.

```yaml
- runFlow: percy/flows/percy-init.yaml
```

### Take a screenshot

Add a `runFlow` step wherever you want to capture a screenshot. Pass the `SCREENSHOT_NAME` environment variable to name the snapshot.

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: Homepage
```

### Full example

```yaml
appId: com.example.myapp
---
- runFlow: percy/flows/percy-init.yaml

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

### Element-based regions (deferred)

Element-based region resolution is **deferred for both Android and iOS** — the SDK accepts the shape in `PERCY_REGIONS` but currently logs a warning and skips them. Future work is tracked for Android (ADB-based resolver) and iOS (WebDriverAgent-based resolver); both need per-platform selector dialects and scale-factor handling, so they are planned as a later release.

For now, use coordinate-based regions (below) on both platforms.

### Coordinate-based regions

Specify pixel coordinates directly. Coordinates are relative to the screenshot (0,0 is top-left).

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: HomeScreen
      PERCY_REGIONS: '[{"top":0,"bottom":50,"left":0,"right":1080,"algorithm":"ignore"}]'
```

### Advanced: per-region configuration

Each region can include fine-grained diff settings:

```yaml
PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/header"},"algorithm":"standard","configuration":{"diffSensitivity":3,"imageIgnoreThreshold":0.1}}]'
```

Configuration options: `diffSensitivity` (0-4), `imageIgnoreThreshold` (0-1), `carouselsEnabled`, `bannersEnabled`, `adsEnabled`.

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
- Individual malformed regions → skipped with per-region warning, valid regions still sent
- Invalid bar heights (non-numeric) → silently omitted, defaults apply

## BrowserStack Integration

You can run Percy Maestro flows on BrowserStack by uploading your Maestro workspace (including the `percy/` directory) as a zip to the BrowserStack Maestro API.

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

1. **Initialization** -- The `percy-init` sub-flow runs a healthcheck against the Percy CLI server to verify it is available. If the CLI is not running or not reachable, Percy is silently disabled for the rest of the flow. The CLI version and server address are stored for downstream use.

2. **Screenshot capture** -- Each `percy-screenshot` sub-flow call uses Maestro's built-in `takeScreenshot` command to save a PNG to disk, then runs a JS script that sends screenshot metadata (name, session ID, device tag, regions, tile options) as a JSON POST to the Percy CLI's `/percy/maestro-screenshot` relay endpoint. The Percy CLI finds the screenshot file on disk, base64-encodes it, resolves any element-based regions, and uploads the comparison.

## Features not supported

These features from other Percy SDKs are not applicable to the Maestro environment:

| Feature | Reason |
|---------|--------|
| `scrollableXpath` / `scrollableId` / `screenLengths` / `fullPage` | Maestro controls scrolling via YAML `scroll` command. Capture multiple screenshots with scroll steps between them. |
| `freezeAnimations` / `percyCSS` / `enableJavascript` | DOM/web-specific features. Native mobile screenshots are bitmap captures — no DOM to manipulate. |
| XPath region selectors | Element resolution on Android uses view hierarchy attributes (`resource-id`, `text`, `content-desc`, `class`) via ADB. On iOS, element resolution would use WebDriverAgent selectors (`accessibility_id`, `predicate`, etc.). Both are deferred — see the Element-based regions note above. |
| App Automate features | Maestro uses the generic Percy path, not BrowserStack App Automate. |
| iOS simulator | BrowserStack runs real iOS devices; the SDK is not tested against simulators. |
| Element-based regions | Coordinate-based regions only; element resolution deferred for both platforms. See [Regions](#regions) for details. |
| Auto-detect device metadata on iOS | Maestro's GraalJS sandbox blocks native iOS bindings (`uname`, `UIDevice.current`, `XCUIDevice.shared.orientation`) that SDKs like `percy-xcui-swift` use. Pass `PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH`, `PERCY_SCREEN_HEIGHT`, `PERCY_ORIENTATION` via flow env vars instead. |

## Links

- [Percy documentation](https://www.browserstack.com/docs/percy)
- [Percy CLI GitHub](https://github.com/percy/cli)
- [Maestro documentation](https://maestro.mobile.dev/)
- [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started)

## License

MIT
