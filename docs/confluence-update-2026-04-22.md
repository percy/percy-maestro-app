# Percy Maestro SDK — Implementation Update (April 2026)

> Addendum to the existing architecture/design-decisions doc. Covers what
> shipped, what was rejected and why, and what remains as follow-up work.
> Source branches: `percy-maestro-android` (SDK), `cli` → `feat/maestro-multipart-upload` (CLI relay), `mobile` → `feat/maestro-percy-integration` (BS runner glue).

---

## Scope Shipped

### Phase 1 — SDK feature parity (v0.1.0 → v0.3.0)

Brought `percy-maestro-android` in line with every applicable feature of `percy-espresso-java` / `percy-appium-python`. Implementation is pure YAML sub-flows + GraalJS scripts (no build system).

| Feature | Env var | Notes |
|---|---|---|
| Coordinate-based regions | `PERCY_REGIONS` | JSON array of `{top, bottom, left, right, algorithm}` |
| Algorithms | within `PERCY_REGIONS[].algorithm` | `ignore` / `standard` / `intelliignore` / `layout` |
| Per-region configuration | within region object | `configuration` / `padding` / `assertion` pass-through |
| Sync mode | `PERCY_SYNC=true` | Waits for comparison result, logs `data` field |
| Tile metadata | `PERCY_STATUS_BAR_HEIGHT`, `PERCY_NAV_BAR_HEIGHT`, `PERCY_FULLSCREEN` | Excludes system chrome from comparison tile |
| Test-harness execution ID | `PERCY_TH_TEST_CASE_EXECUTION_ID` | CI/CD correlation |
| Test case / labels | `PERCY_TEST_CASE`, `PERCY_LABELS` | Already present in v0.1.0 |
| Android-only platform gate | automatic in healthcheck | Disables Percy on non-Android platforms with clear log |
| `appId: _percy_subflow` YAML headers | `percy/flows/*.yaml` | Sub-flows don't inherit parent `appId` |
| Distinct analytics identity | hardcoded | `clientInfo: "percy-maestro-android/0.3.0"` |

### Phase 2 — Element-based regions (new capability)

Users can target UI elements by Android view-hierarchy attributes instead of pixel coordinates:

```yaml
PERCY_REGIONS: |
  [
    {"element": {"resource-id": "com.app:id/clock"}, "algorithm": "ignore"},
    {"element": {"text": "Submit"}, "algorithm": "intelliignore"},
    {"element": {"content-desc": "Profile"}, "algorithm": "ignore"},
    {"element": {"class": "androidx.appcompat.widget.Toolbar"}, "algorithm": "layout"}
  ]
```

Resolution happens CLI-side. The SDK forwards the selector verbatim; the Percy CLI's `/percy/maestro-screenshot` handler invokes **`maestro --udid <serial> hierarchy`** (an undocumented Maestro subcommand that emits the view tree as JSON), flattens the tree, and uses first-match-by-attribute to compute a bounding box. Multi-match behavior matches `percy-appium-python` — first node in pre-order wins.

---

## Architecture — current working flow

### Screenshot capture (end-to-end)

```
Maestro flow (GraalJS)
 ├─ takeScreenshot → writes PNG to /tmp/{sessionId}_test_suite/logs/.../*.png
 └─ runScript percy-screenshot.js
       │ POST JSON signal {name, sessionId, platform, tag, regions, ...}
       ▼
 Percy CLI /percy/maestro-screenshot  (on BS runner host)
   ├─ validate input (whitelist selector keys, length≤512, ≤50 regions)
   ├─ iOS + element → warn-and-skip (no breaking change)
   ├─ for each region:
   │    coord → transform to coOrdinates
   │    element → resolve via adb-hierarchy.js (lazy; memoized per request)
   ├─ read PNG from sessionId-scoped path, base64 encode
   └─ POST to Percy backend via @percy/client
```

### `adb-hierarchy.js` resolver (Phase 2 core)

Pure functions on top of an injectable `execMaestro` / `execAdb` seam:

```
dump({ execMaestro, execAdb, getEnv }) →
  | { kind: 'unavailable', reason }      (environment problem)
  | { kind: 'dump-error', reason }       (transient / data problem)
  | { kind: 'hierarchy', nodes }         (success; ~100–2000 flat nodes)

firstMatch(nodes, { "resource-id"|"text"|"content-desc"|"class": string })
  → { x, y, width, height } or null
```

Resolution order:

1. **Primary: `maestro --udid $ANDROID_SERIAL hierarchy`** — reuses Maestro's existing gRPC channel to `dev.mobile.maestro` on the device. Works during an active `maestro test` flow (critical constraint). Returns JSON; `accessibilityText` maps to `content-desc`.
2. **Fallback: `adb exec-out uiautomator dump /dev/tty`** + file-dump + SIGKILL retry. Only used when the maestro binary isn't on PATH (`MAESTRO_BIN` unset). Not actually useful during live Maestro sessions — see rejected approaches below.

Key properties:
- 15s timeout on maestro CLI (JVM cold start ~9s + 6s headroom)
- 2s timeout + 3-retry exponential backoff (500ms/1s/2s) on the adb fallback
- 5MB stdout cap before parse (defense against oversized adversarial payloads)
- `fast-xml-parser` config hardened: `processEntities: false`, `allowBooleanAttributes: false`
- `bounds` regex strictly anchored: `^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$`
- Device serial never accepted from user input — read from `process.env.ANDROID_SERIAL` or `adb devices` probe

### BrowserStack runner glue (mobile repo)

Required changes on `feat/maestro-percy-integration` of `browserstack/mobile`:

1. **`maestro_runner.rb`** — inject `PERCY_SESSION_ID=$session_id` into the Maestro flow's environment variables so the JS script can tag POST bodies.
2. **`cli_manager.rb#start_percy_cli`** — prepend to the Percy CLI spawn env:
   - `ANDROID_SERIAL=#{@device['device_serial']}` — so maestro's `--udid` targets this session's device (BS hosts carry multiple devices)
   - `MAESTRO_BIN=/nix/store/.../maestro-cli-X.Y.Z/bin/maestro` — Percy CLI's PATH doesn't include the maestro binary; needs explicit pointer
3. The existing `app_percy` plumbing (forwarding `PERCY_TOKEN` etc. from App Automate's `appPercy` capability) is unchanged.

### Percy CLI schema

Payload sent to Percy backend via `@percy/client.createComparison`:

```json
{
  "data": {
    "type": "comparisons",
    "attributes": {
      "ignore-elements-data": {
        "ignoreElementsData": [
          {"selector": "class: android.widget.FrameLayout",
           "coOrdinates": {"top": 0, "left": 0, "right": 1080, "bottom": 2340}}
        ]
      },
      "consider-elements-data": { "considerElementsData": [/* ... */] }
    }
  }
}
```

This matches the Percy classic schema used by `@percy/appium-python` / `@percy/espresso-java`. Resolver output (`{x,y,width,height}`) is converted to `{top,left,right,bottom}` `coOrdinates` in the handler.

---

## Rejected Approaches (with reasons)

### ❌ Direct file upload from Maestro's GraalJS sandbox (`multipartForm filePath`)

**What we tried:** Have the SDK script include the screenshot file directly in a multipart HTTP POST.

**Why it failed:**
- GraalJS sandbox blocks Java interop (`Java.type()` returns `null`)
- OkHttp3 resolves file paths from JVM CWD, which doesn't match the Maestro workspace
- No reliable way to discover CWD or the absolute session path from inside the sandbox
- Proven across two BrowserStack test builds in March 2026

**What we shipped instead:** The "signal from data separation" pattern. SDK sends only `{name, sessionId, ...}`; Percy CLI (running on the host with full FS access) globs for the file using session conventions.

### ❌ XPath / CSS selectors for element regions

**Why rejected:** Android's view hierarchy doesn't expose XPath natively. Any XPath evaluator would have to run inside the GraalJS sandbox (same constraints as above). Stuck with attribute-based selectors (`resource-id`, `text`, `content-desc`, `class`), which matches Espresso / UIAutomator idioms anyway.

### ❌ `adb exec-out uiautomator dump /dev/tty` as primary hierarchy source

**What we tried (and initially deployed):** Shell out to `adb` from the Percy CLI relay to dump the Android view hierarchy as XML. Parse with `fast-xml-parser` and flatten.

**Why it failed:** Maestro itself holds the uiautomator connection throughout a flow. Any concurrent `uiautomator dump` gets `SIGKILL`ed by the Android runtime. Observed reliably across 5+ E2E runs:
- Primary `exec-out` returned empty stdout (classified as `no-xml-envelope`)
- File-dump fallback (`shell uiautomator dump /sdcard/...`) exited `137` (SIGKILL)
- Manual `adb` from ritesharora shell (no active session) returned 44KB XML fine — confirming the binary/permissions/path are all healthy; the failure was pure lock contention

### ❌ SIGKILL retry with exponential backoff (500ms / 1s / 2s = 3.5s budget)

**What we tried:** Retry the file-dump fallback up to 3 times with exponential backoff on exit 137.

**Why it failed:** Maestro's lock is held for the entire duration of the flow step, not just the takeScreenshot moment. 3.5s isn't enough; neither is 10s. The lock semantics are "one uiautomator session per device" — no timing-based retry can recover.

The retry code is still in the codebase as defense-in-depth for future contention scenarios (e.g., non-Maestro runtimes where transient kills exist), but it's not the path that actually gets used on BrowserStack.

### ❌ Direct gRPC from the Percy CLI to device port 6790 (considered, deferred)

**What we investigated:** BrowserStack hosts pre-configure `adb forward tcp:<host-port> tcp:6790` for each device. During an active session, `dev.mobile.maestro` listens on device port 6790 for Maestro's own gRPC requests. The protobuf schema (`maestro_android.MaestroAndroid.ViewHierarchy`) is in `maestro-client-X.Y.Z.jar`.

**Why deferred:** Implementing a Node gRPC client requires protobuf codegen + `@grpc/grpc-js` dep + handling of session-lifecycle (port only serves during an active session). ~2-3 hours of focused engineering. **Captured as Phase 2.2 follow-up** — target <100ms per hierarchy fetch vs the current ~9s JVM cold start.

### ❌ Percy on Automate (POA) mode for Maestro

**Why rejected:** POA requires an Appium-style driver session with `capabilities` and `commandExecutorUrl`. Maestro has no equivalent execution model. The Percy team already supports POA via `percy-appium-python`, so Maestro users benefit from the classic path.

### ❌ `freezeAnimations` / `percyCSS` / `enableJavascript`

**Why rejected:** DOM/web-specific features. Maestro screenshots are native bitmap captures — there is no DOM to manipulate.

### ❌ Full-page / scrollable screenshots

**Why rejected:** Maestro's idiom for scrolling is explicit `scroll:` steps in YAML between screenshots. Users compose full-page coverage from multiple `percy-screenshot` calls with scroll steps between them, which matches the framework's mental model.

### ❌ Single-file `api.js` overlay targeting `@percy/core@1.30.0` Nix store on BS Android host

**What we tried:** Replace only `api.js` on the host's Nix-store-installed `@percy/core@1.30.0` with our newer Phase 2 code.

**Why it failed partially:** Our `api.js` imports `Busboy`, `computeResponsiveWidths`, etc. that don't exist in 1.30.0's sibling files. Shipped a **compat shim** inline (one-liner that stubs `computeResponsiveWidths` → `[]`) and installed `busboy` + `streamsearch` + `fast-xml-parser` + `strnum` as new deps alongside the Nix-store core. Works for testing; the production path is a proper `@percy/cli` version bump in `percy-setup.nix`.

---

## Validated End-to-End (2026-04-22)

Ran against `Google Pixel 7 Pro-13.0` on BS machine `31.6.63.33:28201FDH300J1S`.

Demo-ready Percy builds (both with baselines + comparisons so regions are overlaid visually in the dashboard):

| Demo | Baseline | Comparison | Snapshot name |
|---|---|---|---|
| Coordinate regions (3 algorithms) | [#19](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48975403) | [#21](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48975566) | `Demo1_CoordinateRegions_ThreeAlgorithms` |
| Element regions (maestro hierarchy) | [#20](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48975492) | [#22](https://percy.io/9560f98d/app/AndroidRegions-60583365/builds/48975609) | `Demo2_ElementRegions_MaestroHierarchyResolver` |

**Payload verification** (ad-hoc debug patch, since reverted):

```
[percy:core:adb-hierarchy] dump took 9999ms via maestro (107 nodes)
[percy:core] payload.ignored_elements_data: {
  "ignoreElementsData": [{
    "selector": "class: android.widget.FrameLayout",
    "coOrdinates": {"top": 0, "left": 0, "right": 1080, "bottom": 2340}
  }]
}
[percy:core] Snapshot taken: Demo2_ElementRegions_MaestroHierarchyResolver
[percy:client] Uploading comparison tiles for 4441943234...
[percy:core] Finalized build #22
```

Confirms the full chain: SDK → relay → maestro-hierarchy resolver (107 nodes) → `firstMatch` bbox → classic payload schema → comparison finalized on Percy.

---

## Known Limitations / Follow-up Work

### Performance: 9s JVM cold start per element-region screenshot

Every `maestro hierarchy` invocation spawns a fresh JVM. Measured p50 / p99 ≈ 9.0s / 9.4s on BrowserStack host. For a 10-screenshot flow with element regions, that's ~90s added wall-clock.

**Phase 2.2 follow-up: direct gRPC client to `dev.mobile.maestro` on device port 6790.** Protobuf skeleton lives in `maestro-client-X.Y.Z.jar`. Target <100ms per fetch. Infrastructure (adb forward) is already configured on BS hosts.

### iOS support

The SDK's healthcheck explicitly disables itself on non-Android platforms. Element regions on iOS would need `xctest`/`XCUITest` hierarchy access, not `adb`. The existing `percy-maestro` package covers iOS; this split is intentional (per `project_maestro_repo_split.md`).

### Secondary SDK schema (regions vs ignored_elements_data)

Our Unit 6 commit originally used `payload.regions[].elementSelector.boundingBox` (modern JSON:API resource shape). The deployed version uses the classic `ignored_elements_data` / `considered_elements_data` with `coOrdinates` + `selector` strings. Both shapes are accepted by the Percy backend; the classic one is what `appium-python` / `espresso-java` send, so consistency is good. Decision captured in the handler code.

### Android release-build `resource-id` stripping

AGP 8.12+ R8 resource optimization can rename `resource-id` values in shrunk release APKs (`com.app:id/submit_btn` → `com.app:id/a`). The SDK docs warn users to prefer `content-desc` or keep IDs via `keep.xml` / `tools:keep`. Not fixable on the SDK side.

---

## Deployment Checklist (for the Phase 2 production rollout)

1. Publish `@percy/core` and `@percy/cli` with the Phase 2 resolver. Bump the pin in `percy-setup.nix` with new version + sha256.
2. BrowserStack infra rebuilds the Maestro Android runner image with the new Percy CLI. Track the image version explicitly — README callout ("element regions require Percy CLI ≥ X.Y.Z") must match the deployed version, not the npm version.
3. Merge `feat/maestro-percy-integration` on `browserstack/mobile` to deploy the `maestro_runner.rb` + `cli_manager.rb` changes (PERCY_SESSION_ID + ANDROID_SERIAL + MAESTRO_BIN injection).
4. Run the Unit 7 checklist (`percy-maestro-android/test/e2e-checklist.md`) against a fresh BS session. Confirms end-to-end parity + device-matrix spot-check (Pixel + Samsung).
5. Communications: docs site update + customer-facing changelog noting the new `element` selector capability and the release-build caveat.

## Related Resources

- **`percy-maestro-android` repo:** `feat: port percy-screenshot.js from percy-maestro v0.3.0` through `docs(test): add Unit 7 end-to-end validation checklist` (commits `f04d216` through `5024f59` on branch `percy-maestro-android`)
- **`cli` repo:** branch `feat/maestro-multipart-upload` — 6 commits culminating in `a6942df6 feat(core): use maestro hierarchy as primary view-tree source`
- **`mobile` repo:** branch `feat/maestro-percy-integration` — plus the two-line `cli_manager.rb` patch for ANDROID_SERIAL + MAESTRO_BIN env injection (staged as `/tmp/mobile-android-serial-injection.patch` on the dev host; needs to be committed + PR'd)
- **Planning artifacts** (committed in `percy-maestro-android/docs/`): brainstorm, plan (original + deepened + review), Unit 0 ADB spike checklist, Unit 7 E2E checklist
