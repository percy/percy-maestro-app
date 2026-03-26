# percy-maestro

[Percy](https://percy.io) visual testing for [Maestro](https://maestro.mobile.dev/) mobile testing flows.

## Prerequisites

- [Percy CLI](https://github.com/percy/cli) with multipart upload support
- [Maestro](https://maestro.mobile.dev/) 2.0+
- An Android app under test

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

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PERCY_SERVER` | No | `http://percy.cli:5338` | Percy CLI server address |
| `PERCY_DEVICE_NAME` | Yes | - | Device name for the Percy tag (e.g. `Pixel 7`) |
| `PERCY_OS_VERSION` | Yes | - | Android OS version (e.g. `13`) |
| `PERCY_SCREEN_WIDTH` | Yes | - | Screen width in pixels |
| `PERCY_SCREEN_HEIGHT` | Yes | - | Screen height in pixels |
| `PERCY_ORIENTATION` | No | `portrait` | Screen orientation (`portrait` or `landscape`) |
| `PERCY_TEST_CASE` | No | - | Test case name for grouping snapshots |
| `PERCY_LABELS` | No | - | Comma-separated labels for the snapshot |
| `SCREENSHOT_NAME` | Yes (per screenshot) | - | Name for the screenshot; must be unique per snapshot |

Pass environment variables when running Maestro:

```bash
npx percy app:exec -- maestro test \
  -e PERCY_DEVICE_NAME="Pixel 7" \
  -e PERCY_OS_VERSION="13" \
  -e PERCY_SCREEN_WIDTH="1080" \
  -e PERCY_SCREEN_HEIGHT="2400" \
  your-flow.yaml
```

## BrowserStack Integration

You can run Percy Maestro flows on BrowserStack by uploading your Maestro workspace (including the `percy/` directory) as a zip to the BrowserStack Maestro API. See the [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started) for details.

## How it works

The Percy Maestro SDK works in two stages:

1. **Initialization** -- The `percy-init` sub-flow runs a healthcheck against the Percy CLI server to verify it is available. If the CLI is not running or not reachable, Percy is silently disabled for the rest of the flow.

2. **Screenshot capture** -- Each `percy-screenshot` sub-flow call uses Maestro's built-in `takeScreenshot` command to save a PNG to disk, then runs a JS script that uploads the image to the Percy CLI via a multipart POST to `/percy/comparison/upload`. Device metadata (name, OS version, dimensions, orientation) is sent alongside the image as a JSON tag.

The Percy CLI then handles diffing, rendering, and uploading to the Percy service.

## Links

- [Percy documentation](https://www.browserstack.com/docs/percy)
- [Percy CLI GitHub](https://github.com/percy/cli)
- [Maestro documentation](https://maestro.mobile.dev/)
- [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started)

## License

MIT
