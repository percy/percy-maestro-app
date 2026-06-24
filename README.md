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
      SCREENSHOT_NAME: HomeScreen

- tapOn: "Settings"

- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: SettingsScreen
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
| `SCREENSHOT_NAME` | Yes (per screenshot) | - | Name for the screenshot; must be unique per snapshot. **Must match `[a-zA-Z0-9_-]+`** — see [Snapshot naming](#snapshot-naming). |
| `PERCY_SERVER` | No¹ | `http://percy.cli:5338` | Percy CLI server address |
| `PERCY_DEVICE_NAME` | Yes¹ | - | Device name for the Percy tag (e.g. `Pixel 7`) |
| `PERCY_OS_VERSION` | Yes¹ | - | OS version (e.g. `13` for Android, `17` for iOS) |
| `PERCY_SCREEN_WIDTH` | No² | (auto-derived) | Screen width in pixels |
| `PERCY_SCREEN_HEIGHT` | No² | (auto-derived) | Screen height in pixels |
| `PERCY_ORIENTATION` | No | `portrait` | Screen orientation (`portrait` or `landscape`) |
| `PERCY_TEST_CASE` | No | - | Test case name for grouping snapshots |
| `PERCY_LABELS` | No | - | Comma-separated labels for the snapshot |

¹ On BrowserStack App Automate, `PERCY_SERVER`, `PERCY_DEVICE_NAME`, and
`PERCY_OS_VERSION` are auto-injected by the BS host. Self-hosted Maestro
users (local dev, CI, customer device labs) pass `PERCY_DEVICE_NAME` and
`PERCY_OS_VERSION` as Maestro `-e` flags; `PERCY_SERVER` may be picked
up from `PERCY_SERVER_ADDRESS` (exported by `percy app:exec`) if Maestro
propagates the parent env into GraalJS — otherwise set it explicitly to
your CLI's address (typically `http://localhost:5338`). See
[Self-Hosted Maestro](#self-hosted-maestro) for the full walkthrough.

² `PERCY_SCREEN_WIDTH` / `PERCY_SCREEN_HEIGHT` are auto-derived from the
screenshot PNG bytes by the Percy CLI relay — works on any iOS version,
any Android version, any host (BS App Automate, Maestro Cloud,
self-hosted). Setting them manually is supported (the relay's fill is
non-destructive — customer values win) but no longer required.
See [Device metadata auto-detection](#device-metadata-auto-detection) below.

### Comparison Options

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PERCY_REGIONS` | No | - | JSON array of regions for ignore/consider (see [Regions](#regions)) |
| `PERCY_SYNC` | No | `false` | Set to `"true"` to wait for comparison result and log details |
| `PERCY_STATUS_BAR_HEIGHT` | No | Android: `120` &nbsp;·&nbsp; iOS: `100` | Status bar height in **image pixels** (excluded from comparison tile). Android default covers modern high-DPI Pixel-class hardware (e.g. Pixel 10 Pro at 1280×2856), where the clock / status icons / camera punch-hole extend past the older 80 px default; leaves a thin sliver margin on the 1080p Samsung / Pixel 6–8 tier. iOS default covers the dynamic clock / signal-icon zone on iPhone 12 / 13 / 14 at 3x scale (changing pixels at y ≤ ~85). Override to `180` on Dynamic Island devices (iPhone 14 Pro+), `88` on iPhone 11 / XR, or `40` on iPhone SE for an exact safe-area fit. Very tall status bars on 1280p+ Android may still need a higher override. |
| `PERCY_NAV_BAR_HEIGHT` | No | Android: `100` &nbsp;·&nbsp; iOS: `80` | Bottom-bar / home-indicator height in **image pixels** (excluded from comparison tile). Android default covers gesture-nav home indicator (~72 px actual). iOS default covers the iPhone 11 (2x) home indicator at ~68 px; iPhone 12+ (3x) home indicator is ~102 px — override to `102` for a tighter fit. iPad / iPhone SE (no home indicator) should set `0`. Android 3-button-nav devices should override to `144`. |
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

### Device metadata auto-detection

Device metadata is auto-derived so your flow YAML stays minimal:

```yaml
- runFlow:
    file: percy/flows/percy-screenshot.yaml
    env:
      SCREENSHOT_NAME: "My_Screenshot"
      PERCY_ORIENTATION: "portrait"
      # That's it — everything else is auto-derived.
```

#### What's auto-derived

| Variable | Source | Works on |
|---|---|---|
| `PERCY_SESSION_ID` | BrowserStack host injects it as a Maestro `-e` flag | BS App Automate only |
| `PERCY_SERVER` | BS host injects per-session CLI port | BS App Automate only |
| `PERCY_DEVICE_NAME` | BS host injects from session params | BS App Automate only |
| `PERCY_OS_VERSION` | BS host injects from session params | BS App Automate only |
| `tag.width` / `tag.height` | **Percy CLI relay reads PNG header bytes** on every snapshot | **Everywhere** — BS, Maestro Cloud, self-hosted, customer device labs. Works on any iOS version, any Android version. |

The screen dimensions come from the PNG bytes the SDK ships to the
relay — that's the same image Percy stores and compares against, so the
tag dims are pixel-exact by construction.

#### What you still set per-snapshot

- `SCREENSHOT_NAME` — must match `^[a-zA-Z0-9_-]+$`. See
  [Snapshot naming](#snapshot-naming).
- `PERCY_ORIENTATION` (optional, defaults to `portrait`) — orientation is
  per-snapshot, not per-device.
- Region masks (`PERCY_REGIONS`, etc.) — these are per-snapshot intent.

#### Self-hosted Maestro (non-BrowserStack)

If you run Maestro outside BS App Automate (local dev, CI, your own
device labs), do **not** set `PERCY_SESSION_ID` — its absence is the
self-hosted detection signal at the Percy CLI relay. Pass
`PERCY_DEVICE_NAME` and `PERCY_OS_VERSION` as Maestro `-e` flags; point
the CLI relay at the directory Maestro writes screenshots to via
`PERCY_MAESTRO_SCREENSHOT_DIR`. Screen dimensions continue to come from
the PNG header regardless of host. See [Self-Hosted Maestro
(non-BrowserStack)](#self-hosted-maestro-non-browserstack) below for the
full walkthrough.

#### Customer override

If you previously hardcoded `tag.width` / `tag.height` (via
`PERCY_SCREEN_WIDTH` / `PERCY_SCREEN_HEIGHT` env vars) and want to keep
those exact values, you can — the CLI relay's PNG-fill is non-destructive
and only populates when those fields are missing. Removing the env vars
lets the relay populate from PNG bytes (the authoritative source).

### Snapshot naming

The Percy CLI relay endpoint validates `SCREENSHOT_NAME` against `^[a-zA-Z0-9_-]+$`. Allowed characters: lowercase/uppercase letters, digits, underscore (`_`), and hyphen (`-`). Anything else (spaces, em-dashes, dots, slashes) is rejected with HTTP 400 `"Invalid screenshot name"`.

The SDK validates the name **before** sending the request and throws a clear error if it doesn't match — your Maestro flow fails the `runScript:` step with a message you can act on.

**Good:**

```yaml
SCREENSHOT_NAME: HomeScreen
SCREENSHOT_NAME: settings_screen
SCREENSHOT_NAME: cart-checkout-step-2
SCREENSHOT_NAME: Build_42_LandingPage
```

**Bad (rejected):**

```yaml
SCREENSHOT_NAME: "Home Screen"        # spaces
SCREENSHOT_NAME: "Home — Step 1"      # em-dash + spaces
SCREENSHOT_NAME: "settings.screen"    # dot
SCREENSHOT_NAME: "auth/login"         # slash
```

Why the strict pattern: the CLI uses the name to build a filesystem glob (`/tmp/{sessionId}_test_suite/logs/*/screenshots/{name}.png`). Anything outside this character class could break the glob or expose path-traversal surface. Use underscore as your default separator.

### iOS-specific guidance

The SDK auto-detects the platform via `maestro.platform` — no flag change needed
between Android and iOS flows.

- **`PERCY_NAV_BAR_HEIGHT`**: iOS has no persistent navigation bar, but Face-ID
  iPhones have a home indicator at the bottom. The SDK defaults to `80` image-px
  on iOS — covers iPhone 11 (2x) home indicator (~68 px) with a small margin.
  Override in image pixels for a tighter fit:
  - iPhone 12 / 13 / 14 / 15 / 16 (3x, home indicator ~102 px): `102` (34pt × 3)
  - iPhone 11 / XR (2x, home indicator ~68 px): `68` (default covers fully)
  - iPad / iPhone SE (no home indicator): `0`
- **`PERCY_STATUS_BAR_HEIGHT`**: defaults to `100` image-pixels on iOS — covers
  the dynamic clock / signal-icon zone on iPhone 12 / 13 / 14 at 3x scale
  (changing chrome empirically sits at y ≤ ~85). iPhone 11 (2x, status bar 88 px)
  is over-masked by 12 px — most apps absorb this in their safe-area background
  without visible content loss. Override in image pixels for a tighter fit:
  - iPhone 14 Pro / 15 / 16 (Dynamic Island, 3x): `180` (54pt × 3)
  - iPhone 12 / 13 / 14 standard (notch, 3x): `100` (default — full clock zone)
  - iPhone 11 / XR (notch, 2x): `88` (44pt × 2 — exact fit)
  - iPhone SE (no notch, 2x): `40` (20pt × 2 — exact fit)
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

This SDK supports two runtimes (Android and iOS for both):

- **BrowserStack Maestro sessions** — zero-config, the host injects everything. See [BrowserStack Integration](#browserstack-integration).
- **Self-hosted Maestro** (local dev, CI, customer device labs / device farms) — `percy app:exec -- maestro test ...` on a machine where the Percy CLI co-runs with `maestro`. See [Self-Hosted Maestro (non-BrowserStack)](#self-hosted-maestro-non-browserstack).

A black-box SaaS device cloud where you cannot run the Percy CLI on the same host as `maestro test` is not a supported runtime (the relay reads the PNG from disk and the SDK POSTs to it over loopback).

## BrowserStack Integration

You can run Percy Maestro flows on BrowserStack by uploading your Maestro workspace as a zip to the BrowserStack Maestro API. The recommended pattern is **Mode B (vendor copy)** from the [Installation](#installation) section: copy `node_modules/@percy/maestro-app/percy` into your workspace, then zip and upload.

```sh
npm install --save-dev @percy/maestro-app @percy/cli
cp -r node_modules/@percy/maestro-app/percy ./percy
cd flows && zip -r ../Flows.zip . && cd ..
```

The resulting `Flows.zip` contains your YAML flows plus a vendored `percy/` directory at the same path your `runFlow:` calls reference.

### Enabling Percy in a BrowserStack build

Both Android and iOS Maestro builds use the same `appPercy` field:

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
    "appPercy": {
      "PERCY_TOKEN": "<PERCY_TOKEN>"
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

The `appPercy.env` sub-object can carry any `PERCY_*` environment variable your Percy build should see — commonly `PERCY_BRANCH`, `PERCY_PROJECT`, `PERCY_COMMIT`. These values are forwarded into the Percy CLI's environment on the BrowserStack host.

**Note on naming:** BrowserStack's public-API parameter is camelCase (`appPercy`). On the BrowserStack host, it is translated to snake_case (`app_percy`) in internal session params. Customers pass `appPercy`; the translation is automatic.

### Percy token hygiene

- **Use a per-project Percy token** when running on BrowserStack App Automate. The token transits BrowserStack infrastructure to reach the Percy CLI on the host. Don't reuse an org-scoped master token for CI builds — use a project-scoped token you can rotate independently.
- **`appPercy.env` safe-character guidance:** values should contain only alphanumeric characters plus `.`, `_`, `-`. Branch names like `main`, `feature/abc_1`, project slugs, and commit SHAs all fit. Avoid spaces, quotes, semicolons, backticks, and other shell metacharacters — they can cause unexpected behavior in the env-forwarding mechanism.

See the [BrowserStack Maestro documentation](https://www.browserstack.com/docs/app-automate/maestro/getting-started) for the general upload/build flow.

## Self-Hosted Maestro (non-BrowserStack)

If you run `maestro test` yourself — local dev, CI, your own device farm — Percy works the same way as the Percy Appium SDK: you wrap your test runner with `percy app:exec`. The Percy CLI must co-run with `maestro test` on the same host (shared filesystem + localhost reachable from Maestro's GraalJS context).

### Quickstart

**1. Install the SDK** (Mode B from the [Installation](#installation) section so `runFlow:` paths resolve):

```bash
npm install --save-dev @percy/maestro-app @percy/cli
cp -r node_modules/@percy/maestro-app/percy ./percy
```

**2. Run it** — point Maestro at a known output directory and tell Percy that directory:

```bash
export PERCY_TOKEN=<your-percy-token>
export PERCY_MAESTRO_SCREENSHOT_DIR="$PWD/.percy-output"

npx percy app:exec -- maestro test \
  --test-output-dir "$PERCY_MAESTRO_SCREENSHOT_DIR" \
  -e PERCY_DEVICE_NAME="Pixel 7" \
  -e PERCY_OS_VERSION="13" \
  your-flow.yaml
```

That's the full setup. `percy app:exec` starts the Percy CLI on localhost, creates the build, runs `maestro test` as a child, finalizes the build on exit. Inside the flow, every `runFlow: percy/flows/percy-screenshot.yaml` step takes a screenshot and uploads it.

### What's auto-managed vs. what you set

| | Self-hosted | BrowserStack |
|---|---|---|
| Start command | `percy app:exec -- maestro test ...` (you own it) | Upload zip to BS Maestro API with `appPercy` |
| `PERCY_SERVER` | auto-managed by `app:exec` (`PERCY_SERVER_ADDRESS` if Maestro propagates parent env, else fall through to the default and set explicitly if needed) | host-injected |
| `PERCY_MAESTRO_SCREENSHOT_DIR` | **required** — point at your `--test-output-dir` | n/a (host injects `SCREENSHOTS_DIR` internally) |
| `PERCY_DEVICE_NAME`, `PERCY_OS_VERSION` | **you set** via Maestro `-e` flags | host-injected |
| `tag.width` / `tag.height` | auto (from PNG header) | auto (from PNG header) |
| Element regions on iOS | auto-discovered (probe `7001`, then `lsof`) — see below | host-injects driver port |
| Element regions on Android | auto-discovered via `maestro hierarchy` (requires `adb`) | same |

### Two env channels — don't conflate them

This is the one thing customers commonly get wrong. Maestro and the Percy CLI relay read environment variables from **different places**:

- **Device *tags*** are consumed by the SDK *inside* the Maestro flow (GraalJS). Pass them as Maestro `-e` flags: `-e PERCY_DEVICE_NAME=... -e PERCY_OS_VERSION=...`. These propagate into `runScript:` and `runFlow:`.
- **Device *addressing*** for element-region resolution (`PERCY_IOS_DRIVER_HOST_PORT`, `PERCY_IOS_DEVICE_UDID`, `ANDROID_SERIAL`) is consumed by the **Percy CLI** (the relay process). **Export them in the shell before `percy app:exec`** — Maestro `-e` flags only reach the maestro child and its GraalJS context, never the CLI process.

### Element regions

- **Android** works out of the box if `adb` is on `PATH` and exactly one device is connected (or `ANDROID_SERIAL` is set). The relay shells `maestro hierarchy` to resolve element selectors.
- **iOS** uses the BrowserStack-proven HTTP `/viewHierarchy` transport against the running Maestro driver. The relay auto-discovers the driver port — first probing the deterministic `127.0.0.1:7001` (and the `7001–7128` range for sharded runs), then falling back to `lsof` lookup of the `maestro-driver-ios…xctrunner` listener. Zero customer config on current Maestro (≤ 2.4.0). For real iOS devices, sharded runs, or future Maestro versions that switch to an ephemeral port, set `PERCY_IOS_DRIVER_HOST_PORT` explicitly (export in the shell before `percy app:exec`).
- iOS selectors are restricted to `id` only on this SDK (Maestro's iOS TreeNode doesn't carry `class`/`text`); use `id` selectors or coordinate regions on iOS.

When no driver is reachable, element regions are dropped with a clear warning — the snapshot itself still uploads with coordinate regions intact.

### Multiple devices in one build

Each device = one `percy app:exec` invocation on its own port. To merge concurrent sessions into a **single** Percy build, set a shared parallel nonce on all of them (Percy's existing cross-process build sharding):

```bash
# device 1
PERCY_PARALLEL_NONCE=run-42 PERCY_PARALLEL_TOTAL=2 \
  percy app:exec --port 5338 -- maestro test \
  --test-output-dir "$PWD/.percy-out-1" \
  -e PERCY_DEVICE_NAME="Pixel 7" -e PERCY_OS_VERSION="13" \
  flow.yaml &

# device 2
PERCY_PARALLEL_NONCE=run-42 PERCY_PARALLEL_TOTAL=2 \
  percy app:exec --port 5339 -- maestro test \
  --test-output-dir "$PWD/.percy-out-2" \
  -e PERCY_DEVICE_NAME="iPhone 14" -e PERCY_OS_VERSION="17" \
  flow.yaml &
```

Each invocation needs its own `--port`, its own `--test-output-dir` (and matching `PERCY_MAESTRO_SCREENSHOT_DIR`), and its own device. Omit the parallel nonce to ship each session as a separate build.

### Token hygiene

`PERCY_TOKEN` is a write secret. Source it from your CI secret store; never commit it to flow YAML or echo it in logs. Set it once in the shell before `percy app:exec` so it inherits into the CLI process.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `400 Missing required env: PERCY_MAESTRO_SCREENSHOT_DIR` | env var not set in the shell `percy app:exec` runs in | export it before the command |
| `404 Screenshot not found … (resolved outside PERCY_MAESTRO_SCREENSHOT_DIR)` | Maestro wrote the PNG outside the configured dir | confirm `--test-output-dir` matches `PERCY_MAESTRO_SCREENSHOT_DIR` exactly |
| `[percy] Percy CLI not reachable at http://percy.cli:5338` | self-hosted, Maestro didn't propagate `PERCY_SERVER_ADDRESS` to GraalJS | pass `-e PERCY_SERVER=http://localhost:5338` to `maestro test` |
| Element regions skipped with `no Maestro driver found` on iOS | running a real device or a sharded setup | export `PERCY_IOS_DRIVER_HOST_PORT=<P>` matching your `--driver-host-port` |
| Element regions skipped on Android with `adb` warning | `adb` not on `PATH` or zero/multiple devices | install Android Platform Tools and either connect one device or set `ANDROID_SERIAL` |

## How it works

The Percy Maestro SDK works in two stages:

1. **Initialization (lazy)** -- The first `percy-screenshot` call in a flow runs a healthcheck against the Percy CLI server to verify it is available, caching the result in `output.percyEnabled` so subsequent screenshots short-circuit. If the CLI is not running or not reachable, Percy is silently disabled for the rest of the flow. The optional `percy-init` sub-flow runs the same healthcheck eagerly at flow start — useful when you want CI logs to surface a Percy outage before any test steps.

2. **Screenshot capture** -- Each `percy-screenshot` sub-flow call runs in three internal steps: (1) a prepare script computes the screenshot save path -- an absolute path the SDK owns for Percy CLI ≥ 1.31.11-beta.1 (`/tmp/<sid>{_test_suite}/percy/<name>.png`), or the legacy `SCREENSHOTS_DIR`-relative fallback for older CLIs; (2) Maestro's built-in `takeScreenshot` command saves the PNG to that path; (3) an upload script POSTs screenshot metadata (name, session ID, device tag, regions, tile options, optional `filePath`) as JSON to the Percy CLI's `/percy/maestro-screenshot` relay endpoint. The Percy CLI then reads the file (directly via `filePath` on new CLIs, or via its glob on older CLIs), base64-encodes it, resolves any element-based regions, and uploads the comparison. The customer-facing `runFlow:` shape does not change between CLI versions.

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
| iOS simulator on BrowserStack | BrowserStack runs real iOS devices; the SDK is not tested against BS simulators. iOS simulators **are** supported on the self-hosted path. | Use BrowserStack real-device iOS sessions, or run self-hosted against a local iOS simulator. |

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
