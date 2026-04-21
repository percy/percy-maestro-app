# percy-maestro-android

[Percy](https://percy.io) visual testing for [Maestro](https://maestro.mobile.dev/) Android flows.

> **Runtime:** supported on BrowserStack Maestro Android sessions only. See
> [Runtime support](#runtime-support) for details. For iOS Maestro flows, see
> the cross-platform [percy-maestro](https://github.com/percy/percy-maestro)
> package.

## Prerequisites

- [Percy CLI](https://github.com/percy/cli) with `/percy/maestro-screenshot` relay support
- [Maestro](https://maestro.mobile.dev/) 2.0+
- An Android app under test
- A BrowserStack Maestro Android session (required for screenshot uploads)

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

Add a `runFlow` step at the beginning of your Maestro flow to initialize Percy. This performs a healthcheck against the Percy CLI server and sets `output.percyEnabled` for downstream steps.

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

Run the flow on BrowserStack with Percy:

```bash
npx percy app:exec -- maestro test your-flow.yaml
```

## Configuration

Device metadata and other options are passed as environment variables to your Maestro flow.

### Core options

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCREENSHOT_NAME` | Yes (per screenshot) | - | Name for the screenshot; must be unique per snapshot |
| `PERCY_SERVER` | No | `http://percy.cli:5338` | Percy CLI server address |
| `PERCY_DEVICE_NAME` | Yes | - | Device name for the Percy tag (e.g. `Pixel 7`) |
| `PERCY_OS_VERSION` | Yes | - | Android OS version (e.g. `13`) |
| `PERCY_SCREEN_WIDTH` | Yes | - | Screen width in pixels |
| `PERCY_SCREEN_HEIGHT` | Yes | - | Screen height in pixels |
| `PERCY_ORIENTATION` | No | `portrait` | Screen orientation (`portrait` or `landscape`) |
| `PERCY_TEST_CASE` | No | - | Test case name for grouping snapshots |
| `PERCY_LABELS` | No | - | Comma-separated labels for the snapshot |

### Comparison options

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

Identify regions by Android view-hierarchy attributes. Supported selector keys: `resource-id`, `text`, `content-desc`, `class`.

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: HomeScreen
      PERCY_REGIONS: '[{"element":{"resource-id":"com.app:id/clock"},"algorithm":"ignore"}]'
```

> **Status:** element-based regions require a Percy CLI that ships the ADB
> view-hierarchy resolver. Until that CLI is deployed to your BrowserStack
> Maestro runner, element regions log a warning and are skipped. Coordinate
> regions continue to work during the transition.

### Multi-match behavior

When a selector matches multiple views, the **first match in pre-order traversal** wins (same as `percy-appium-python`). Write more specific selectors to disambiguate when needed.

### Release-build caveat

Android release builds with `shrinkResources` + R8 resource optimization (AGP 8.12+) may rename the values surfaced as `resource-id`. For selectors that must survive release builds, prefer `content-desc` (accessibility-stable — R8 does not rename) or keep IDs via `keep.xml` / `tools:keep`.

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
- Element resolver unavailable (ADB unreachable on the runner) → one warning, all element regions skipped, coordinate regions still upload

## Runtime support

This SDK is supported on **BrowserStack Maestro Android sessions**. The Percy CLI's `/percy/maestro-screenshot` relay expects BrowserStack's session-directory file layout (`/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`). Running `maestro test` locally on your laptop is not a supported runtime — the healthcheck will pass but screenshot uploads will 404.

For iOS Maestro flows, use the cross-platform [percy-maestro](https://github.com/percy/percy-maestro) package.

## BrowserStack integration

Run Percy Maestro flows on BrowserStack by uploading your Maestro workspace (including the `percy/` directory) as a zip to the BrowserStack Maestro API. See the [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started) for details.

## How it works

The Percy Maestro Android SDK works in two stages:

1. **Initialization** — The `percy-init` sub-flow runs a healthcheck against the Percy CLI server to verify it is available and Android is the active platform. If either check fails, Percy is silently disabled for the rest of the flow. The CLI server address and Percy core version are stored for downstream use.

2. **Screenshot capture** — Each `percy-screenshot` sub-flow call uses Maestro's built-in `takeScreenshot` to save a PNG to disk, then runs a JS script that sends a JSON payload (name, session ID, device tag, regions, tile options) to the Percy CLI's `/percy/maestro-screenshot` relay. The Percy CLI finds the screenshot file on disk, base64-encodes it, resolves any element-based regions via ADB when supported, and uploads the comparison.

## Features not supported

These features from other Percy SDKs are intentionally not applicable here:

| Feature | Reason |
|---------|--------|
| `fullPage` / `scrollableXpath` / `scrollableId` / `screenLengths` | Maestro controls scrolling via YAML `scroll` commands. Capture multiple screenshots with `scroll` steps between them. |
| `freezeAnimations` / `percyCSS` / `enableJavascript` | DOM/web-specific. Native mobile screenshots are bitmap captures — no DOM to manipulate. |
| XPath region selectors | Android view hierarchy does not expose XPath. Use `resource-id` / `text` / `content-desc` / `class` instead. |
| Percy on Automate (POA) | POA requires Appium-style driver capabilities and a live session; Maestro has no equivalent execution model. |
| iOS | This package is Android-only. Use [percy-maestro](https://github.com/percy/percy-maestro) for iOS. |
| Local `maestro test` runtime | The CLI relay expects BrowserStack's session-directory file layout. See [Runtime support](#runtime-support). |

## Links

- [Percy documentation](https://www.browserstack.com/docs/percy)
- [Percy CLI GitHub](https://github.com/percy/cli)
- [Maestro documentation](https://maestro.mobile.dev/)
- [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started)
- [percy-maestro (cross-platform, Android + iOS)](https://github.com/percy/percy-maestro)

## License

MIT
