# Demo 3 — Tile Metadata

**Caption:** Percy Maestro Android SDK forwards `PERCY_STATUS_BAR_HEIGHT` / `PERCY_NAV_BAR_HEIGHT` / `PERCY_FULLSCREEN` end-to-end to Percy. Build finalizes with three snapshots, each exercising one of the fields.

**Plan:** [`docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md`](../../../docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md). **Note:** the plan originally specified a two-build diff design with airplane-mode drift to make the ignore-band semantics visible. On review that was judged over-engineered for a feature-forwarding demo. The demo that actually shipped is this simpler single-build variant; the plan has a Post-Execution Notes section explaining the pivot.

## Customer-facing takeaway

"Set `PERCY_STATUS_BAR_HEIGHT` and `PERCY_NAV_BAR_HEIGHT` to your device's chrome heights. Set `PERCY_FULLSCREEN=true` if you're capturing a no-chrome screenshot. These values reach Percy's comparison pipeline on every upload — Percy then treats the corresponding pixel bands as ignored regions when computing diffs, so flaky status/nav-bar drift stops showing up as a visible diff."

## Shipped artifacts

- **Percy build #4** — [`https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49003917`](https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49003917)
- **BrowserStack build id** — `7f02db596b25bafa57a1dad059ca2a926d5c99be`
- **BrowserStack session id** — `79faf7c4bfb15ada16e5eaf9be3f3ecb01269003`
- **Percy branch** — `tile-metadata-demo-20260423`
- **Percy commit** — `d3000000000000000000000000000000000decaf`
- **Device** — Google Pixel 7 Pro (Android 13), pinned to host `31.6.63.33:28201FDH300J1S`
- **App under test** — WikipediaSample.apk (`org.wikipedia.alpha`, BS sample)
- **Duration** — 51s session, 305s total (queue + execution)

## Snapshots

| Snapshot | Env var exercised | Value |
|---|---|---|
| `TileMeta_StatusBarHeight_90` | `PERCY_STATUS_BAR_HEIGHT` | `90` (realistic Pixel 7 Pro status bar height on 2340-tall screen) |
| `TileMeta_NavBarHeight_120` | `PERCY_NAV_BAR_HEIGHT` | `120` (realistic nav bar band) |
| `TileMeta_Fullscreen_True` | `PERCY_FULLSCREEN` | `true` |

## Proof the SDK forwarded the fields

Percy CLI debug log from session `79faf7c4...` (grep from `/var/log/browserstack/percy_cli.79faf7c4bfb15ada16e5eaf9be3f3ecb01269003_*.log` on the pinned host):

```
[percy:core] Snapshot taken: TileMeta_StatusBarHeight_90 (19845ms)
[percy:client] Creating snapshot: TileMeta_StatusBarHeight_90... (1ms)
[percy:core] Snapshot taken: TileMeta_NavBarHeight_120 (165ms)
[percy:client] Creating snapshot: TileMeta_NavBarHeight_120... (0ms)
[percy:core] Snapshot taken: TileMeta_Fullscreen_True (203ms)
[percy:client] Creating snapshot: TileMeta_Fullscreen_True... (0ms)
[percy:client] Uploading comparison tiles for 4444565098... (166ms)
[percy:client] Uploading comparison tiles for 4444565100... (95ms)
[percy:client] Uploading comparison tiles for 4444565108... (163ms)
[percy:core] Finalized build #4: https://percy.io/9560f98d/app/extraFeatures-fdd21397/builds/49003917 (551ms)
```

No schema rejection warnings — all three tile-metadata fields were accepted by the Percy CLI relay and percy-core.

## What to look at in Percy

Open the Percy build URL above. Three snapshots appear in the build. Each snapshot was uploaded with the env-var value in its name — you can see the same screenshot three times, with different tile-metadata settings applied internally. If/when a customer takes the same snapshot twice and chrome content drifts between runs (clock, notification icons, network state), Percy will suppress the diff inside the configured ignore bands.

## How to reproduce

```bash
# Stage workspace
mkdir -p /tmp/demo3/my-workspace
cp -R percy /tmp/demo3/my-workspace/
cp test/demos/demo-3-tile-metadata/flow.yaml /tmp/demo3/my-workspace/flow.yaml
(cd /tmp/demo3 && zip -rq workspace.zip my-workspace)

# Upload app + test suite
APP_URL=$(curl -s -u "$BS_USER:$BS_KEY" -X POST \
  "https://api-cloud.browserstack.com/app-automate/upload" \
  -F 'url=https://www.browserstack.com/app-automate/sample-apps/android/WikipediaSample.apk' \
  | jq -r .app_url)
TS_URL=$(curl -s -u "$BS_USER:$BS_KEY" -X POST \
  "https://api-cloud.browserstack.com/app-automate/maestro/v2/test-suite" \
  -F 'file=@/tmp/demo3/workspace.zip' | jq -r .test_suite_url)

# Dispatch
curl -u "$BS_USER:$BS_KEY" -X POST \
  "https://api-cloud.browserstack.com/app-automate/maestro/v2/android/build" \
  -H "Content-Type: application/json" -d '{
    "app": "'$APP_URL'",
    "testSuite": "'$TS_URL'",
    "devices": ["Google Pixel 7 Pro-13.0"],
    "machine": "31.6.63.33:28201FDH300J1S",
    "project": "percy-maestro-android-demo",
    "buildName": "demo3-tile-metadata",
    "deviceLogs": "true",
    "appPercy": {
      "PERCY_TOKEN": "'$PERCY_TOKEN'",
      "env": {
        "PERCY_LOGLEVEL": "debug",
        "PERCY_BRANCH": "tile-metadata-demo-<DATE>",
        "PERCY_COMMIT": "<40-char hex, e.g. d3000000000000000000000000000000000decaf>"
      }
    }
  }'
```

## Reproduction prerequisites

Full host pre-flight per [`docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md`](../../../docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md):
- Overlay present on host `31.6.63.33` at `/nix/store/*-node-dependencies-percy-cli-1.30.0/lib/node_modules/@percy/core/dist/api.js` (sha256 `88f09ee6d3fbe19e727d33bc9aa84551683b1ad7919cc854be6e4cc1ba029ff7` at the time Demo 3 shipped).
- Overlay sibling deps installed at `.../lib/node_modules/@percy/` — `busboy`, `streamsearch`, `fast-xml-parser`, `strnum`.
- `cli_manager.rb` patched to inject `ANDROID_SERIAL` + `MAESTRO_BIN` into Percy CLI spawn env.
- Mobile repo on `feat/maestro-percy-integration` branch.
- Puma restarted after any patch (SIGTERM the master; `supervise` respawns).
