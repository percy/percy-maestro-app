---
title: "feat: Publish percy-maestro as @percy/maestro-app on npm and slim example to 2 flows"
type: feat
status: active
date: 2026-05-06
deepened: 2026-05-06
---

# Publish percy-maestro as `@percy/maestro-app` on npm and slim example to 2 flows

## Overview

Move the percy-maestro mobile SDK from a "copy this directory into your workspace" distribution model to a versioned npm package, `@percy/maestro-app`, mirroring the precedent set by `@percy/maestro-web`. In parallel, restructure the corresponding `example-percy-maestro-app` repo down to **two focused flows** (one normal screenshot upload, one regions demo) and re-point its SDK consumption at the npm package via a local `file:` link for development.

The SDK file layout (`percy/flows/`, `percy/scripts/`) stays identical inside the published package — there is no change to the runtime contract with the Percy CLI relay or BrowserStack hosts. The only material shift is *how customers obtain and version the SDK*. Customers gain semver-pinned upgrades and a standard install line; we gain a real release surface and a clean example to point new users at.

## Problem Frame

Today percy-maestro is distributed by telling customers to copy a directory:

> Installation: Copy the `percy/` directory into your Maestro workspace.

This:

- Has no version visible to customers — they cannot know which SDK they are running.
- Has no upgrade story — they diff folders or re-clone.
- Cannot be pinned in CI — there is no `package.json` to record.
- Diverges from the rest of the Percy SDK family. `@percy/maestro-web`, `@percy/cli`, `@percy/playwright`, `@percy/selenium-webdriver`, `@percy/cypress`, and the Python/Java/Swift mobile SDKs are all installed via their language's package manager.

The example repo `example-percy-maestro-app` has compounding problems: 17 `flows-*/` scratch directories, 16 `Flows*.zip` artifacts checked in, and one canonical-looking flow (`flows/screenshot-test.yaml`) buried among them. A new customer cloning this for a tutorial would not know which flow to run.

We want one cohesive change: ship the SDK as `@percy/maestro-app@1.0.0` on npm, and rewrite the example to two clean, single-purpose flows that consume that package.

## Requirements Trace

- R1. The SDK is publishable as `@percy/maestro-app` on npm with version `1.0.0`, public access, MIT-licensed.
- R2. The published tarball ships exactly the runtime files (`percy/flows/*.yaml`, `percy/scripts/*.js`, `README.md`, `LICENSE`, `CHANGELOG.md`) and excludes test fixtures, internal docs, and lockfiles.
- R3. Customers can install with `npm install --save-dev @percy/maestro-app @percy/cli` and reference sub-flows via `node_modules` paths in their Maestro YAML.
- R4. The same package, when vendored (copied) into a Maestro workspace, continues to work via the existing `percy/flows/percy-screenshot.yaml` path — no breaking change for customers who keep doing it the old way.
- R5. The SDK's `clientInfo` telemetry string moves from `percy-maestro/0.4.0` to `percy-maestro-app/1.0.0` and is documented as a release-time sync point.
- R6. The README leads with the npm install workflow and documents the BrowserStack-zip vendor workflow (`cp -r node_modules/@percy/maestro-app/percy flows/percy && zip -r Flows.zip flows/`).
- R7. The `example-percy-maestro-app` repo contains exactly two flow files in `flows/`: one demonstrating a baseline screenshot upload, one demonstrating coordinate **and** element-based regions. All other `flows-*` directories and `Flows*.zip` artifacts are removed.
- R8. The example consumes `@percy/maestro-app` via `file:../percy-maestro` for local development and pins `^1.0.0` for publishable releases.
- R9. The example README provides a runnable tutorial: upload APK, prepare zip (copies vendored SDK from `node_modules`), upload test suite, create Percy project, trigger BS Maestro v2 build with `percyOptions.percyToken` (Android) — verified end-to-end on a real BS build before the SDK package is published.

## Scope Boundaries

**In scope:**

- `package.json` for the SDK and example repos.
- README + CHANGELOG updates for both repos.
- Restructuring the example to two flows; deleting the scratch flow directories and stale zip artifacts.
- Bumping `clientInfo` and version to `1.0.0`.
- A `RELEASING.md` capturing the bump-clientInfo + npm-publish sequence.
- One smoke-test BS Maestro v2 build per platform (Android required, iOS if a host is available given the 2026-04-27 BS iOS Maestro spawn-step blocker — see memory).

**Out of scope (explicit non-goals):**

- Renaming the GitHub repo. Both `percy/percy-maestro-app` and `percy/example-percy-maestro-app` already use the `-app` suffix on GitHub; only the npm package name and `clientInfo` are changing.
- Restructuring the SDK's directory layout (no hoisting of `percy/flows/` to `flows/`). Keeping the `percy/` namespace inside the package preserves the vendor-copy fallback and avoids breaking any user mid-migration.
- Adding a JS API surface (`createRegion()` style) to mirror `@percy/maestro-web`'s programmatic helper. Mobile users drive regions via `PERCY_REGIONS` env JSON, which is sufficient and matches the existing per-platform parity (Android resource-id, iOS accessibility id).
- Adding a `bin` entry / CLI wrapper. Unlike `@percy/maestro-web`'s capture server, mobile percy-maestro has no separate process to launch — `@percy/cli` already owns the relay.
- Building TypeScript types or a `types/` directory. Nothing in the package is consumed from JS code (only YAML `runFlow:` references and GraalJS `runScript:` execution).
- Migrating customers off the vendor-copy mode. Both modes (`node_modules` reference and `percy/` vendor) remain documented and supported.
- Restructuring or republishing `@percy/cli` itself.

## Context & Research

### Relevant code and patterns

- **Reference SDK package:** `~/percy-repos/percy-maestro-web/package.json`. Sets the precedent for naming (`@percy/maestro-web`), `files` whitelist, `publishConfig.access: public`, repo/homepage URLs, and `engines: node >=16`. We deliberately diverge in three ways: no `main`, no `bin`, no runtime dependencies — our package ships static YAML+JS only.
- **Reference example package:** `~/percy-repos/example-percy-maestro-web/package.json`. Demonstrates the `file:../percy-maestro-web` link pattern, the per-flow npm-script convention, and `private: true` to prevent accidental publishing.
- **Existing canonical example flow:** `~/percy-repos/example-percy-maestro/flows/screenshot-test.yaml`. Shows the env-var pattern (`PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH/HEIGHT`, `PERCY_ORIENTATION`), the `runFlow: percy/flows/percy-init.yaml` eager-init pattern, and the `appId: com.sample.browserstack.samplecalculator` test app. The two new flows derive from this template.
- **Vendored SDK reference:** `~/percy-repos/example-percy-maestro/flows/percy/`. Confirms the existing zip-and-upload model already places `percy/` inside `flows/` before zipping. Our `prepare-zip` script preserves this exact final shape — only the *source* of `percy/` changes (now from `node_modules/@percy/maestro-app/percy`).
- **SDK identifying string:** `~/percy-repos/percy-maestro/percy/scripts/percy-screenshot.js:187` — `payload.clientInfo = "percy-maestro/0.4.0";`. This becomes the bump point on every release.

### Institutional learnings (from auto-memory)

- **BrowserStack zip workflow is the supported runtime.** Local `maestro test` is unsupported; the relay needs the BS session-directory layout. The example must be exercised on BS, not locally.
- **`appPercy` (camelCase) for iOS, `percyOptions` for Android.** This asymmetry is intentional — the example must show both forms in the README, with Android default in the runnable example since the bundled APK is an Android sample.
- **Realmobile canary auto-deploy reverts host overlays.** Any patch we make to a BS host during smoke-testing is ephemeral. Bake any required host fixes into the upstream BS path, not the smoke test, before declaring publish-ready.
- **Percy CLI on BS hosts runs Node 14.17.3.** Not relevant to this plan directly (the SDK does no Node code; only static files and GraalJS scripts), but worth flagging if anyone is tempted to add a JS API surface.
- **2026-04-27 BS iOS Maestro spawn-step breakage** may still be active. iOS smoke test is best-effort; do not block 1.0.0 publish on it if the BS-side blocker persists.

### External references

- npm `@percy` org publishing: existing publishers include `@percy/cli`, `@percy/maestro-web`, `@percy/dom`, `@percy/sdk-utils`. The user is in this org and has 2FA-enabled publish rights via the Percy team.
- Maestro `runScript:` and `runFlow:` path semantics resolve relative to the YAML file containing the directive. Sub-flow internal references like `runScript: ../scripts/percy-screenshot.js` continue to resolve correctly when the sub-flow is located under `node_modules/@percy/maestro-app/percy/flows/` because the structural relationship between `flows/` and `scripts/` is preserved inside the package. This is a planning-time assumption verified by inspection of the existing layout; a smoke test in Unit 5 confirms it under the live BS runtime.

## Key Technical Decisions

- **Package name `@percy/maestro-app`, version `1.0.0`, public access.** Aligns with the GitHub repo `percy/percy-maestro-app` and the post-1.0 status implied by recent commit `4b40b6a fix(sdk): post-1.0 cleanup`. Mirrors the `@percy/maestro-web` naming pattern.
- **Static-asset package, no `main` / `bin` / runtime deps.** The package ships YAML and GraalJS-targeted JS. Nothing is `require`-ed from Node code, so `main` is omitted; nothing executable runs at install time, so no `bin`. Keeping zero deps avoids `npm audit` noise on what is effectively a documentation+config bundle.
- **Keep `percy/flows/` and `percy/scripts/` inside the package (no hoisting to root).** Preserves the vendor-copy fallback contract and avoids invalidating any in-flight customer migrations. Cost is one extra path segment in `node_modules` references — accepted.
- **Document and recommend the vendor pattern for BrowserStack uploads.** Both consumption modes target the same runtime — BrowserStack Maestro sessions. (Per the SDK README's *Runtime support* section, local `maestro test` does not produce snapshots because the relay expects BS's session-directory file layout.) The two modes differ only in **zip composition**, not in where they run:
  - **Mode A (npm-path reference):** zip contains `flows/customer.yaml` plus a copy of `node_modules/@percy/maestro-app/`. YAML uses `../node_modules/...`. Bulky zip.
  - **Mode B (vendor copy):** zip contains `flows/customer.yaml` plus a vendored `flows/percy/` populated from `node_modules/@percy/maestro-app/percy`. YAML uses `percy/flows/...`. Compact zip; identical path layout to the pre-npm distribution, so existing customer YAML keeps working unchanged.

  Bridge: a `prepare-zip` script that copies `node_modules/@percy/maestro-app/percy` into the user's `flows/percy` and zips. Recommend Mode B as the BS-upload default — smaller zip, no path-resolution surprises, and migration-compatible with the pre-npm "copy this directory" instructions.
- **Manual `clientInfo` sync, documented in `RELEASING.md`.** A build step that templates the version into `percy-screenshot.js` is appealing but adds a build pipeline to a static-asset package. Manual bump on every release, locked in by a release-checklist line item, is simpler and lower-risk for the cadence we expect (≤monthly). Add an automated check later if we ship more frequently.
- **Example repo uses `file:../percy-maestro` for local dev, pinned `^1.0.0` for publishable form.** Same pattern `example-percy-maestro-web` uses against `percy-maestro-web`. The `file:` form must be replaced with a real semver before any release commit on the example.
- **Two example flows: `flows/screenshot.yaml` (basic) and `flows/regions.yaml` (regions).** Per the user request. Both target the existing Android sample APK (`resources/app-debug.apk`, `appId: com.sample.browserstack.samplecalculator`) so the tutorial works without code changes.

## Open Questions

### Resolved during planning

- **Package name?** `@percy/maestro-app` — confirmed by user. Aligns with GitHub repo name.
- **Version to publish?** `1.0.0`. Recent commit explicitly references "post-1.0 cleanup", and the cross-platform feature-parity SDK landed in PR #1 as a 1.0 milestone.
- **Hoist `percy/flows/` to `flows/` at the package root?** No. Preserves vendor-copy compatibility; the path verbosity inside `node_modules` is acceptable.
- **Add a JS API like `createRegion()`?** No. Mobile regions are driven by `PERCY_REGIONS` JSON env var; no JS-callable surface exists in mobile Maestro flows for a helper to be useful.
- **Distribute via npm + vendor copy fallback, or npm only?** Both supported, both documented. Recommended pattern for BS zip uploads is vendor (via `prepare-zip` script). Both modes share the same runtime constraint (BS Maestro sessions only); they differ only in zip composition.
- **Repo rename?** No. Both repos already use `-app` on GitHub; only npm naming changes.
- **Does updating `clientInfo` from `percy-maestro/X.Y.Z` to `percy-maestro-app/X.Y.Z` break Percy backend correlation?** No. `clientInfo` is forwarded as a free-form telemetry string; backend logging treats it as opaque. Confirm in Percy CLI debug logs after first build.

### Deferred to implementation

- **Exact CLI flag and zip layout for the example's `prepare-zip` script.** Will be settled while writing the script; the contract is "produces a zip whose root contains `flows/` with a vendored `percy/` inside". `bash`/`zip`/`cp` choreography is implementation detail.
- **iOS smoke-test feasibility.** Depends on whether the 2026-04-27 BS iOS Maestro spawn-step blocker is still active when Unit 5 runs. Resolve at execution: if iOS BS builds still fail at maestro-spawn, ship 1.0.0 with Android verification only and follow up with an iOS validation post-publish.
- **Whether to add a CI check that compares `package.json:version` to the `clientInfo` literal.** Defer until the second release; manual is fine for 1.0.0.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Distribution shape

```
@percy/maestro-app on npm (1.0.0)
├── package.json              ← name, version, files whitelist, no main/bin/deps
├── README.md                 ← npm-install-led, with vendor-zip section for BS
├── CHANGELOG.md              ← 1.0.0 entry: "First npm release; renamed from percy-maestro"
├── LICENSE
└── percy/
    ├── flows/
    │   ├── percy-init.yaml
    │   └── percy-screenshot.yaml
    └── scripts/
        ├── percy-healthcheck.js
        └── percy-screenshot.js (clientInfo: "percy-maestro-app/1.0.0")
```

### Two customer-facing usage modes

```
Mode A — npm path reference (local maestro test, percy app:exec)
  customer-flow.yaml:
    - runFlow:
        file: ../node_modules/@percy/maestro-app/percy/flows/percy-screenshot.yaml
        env: { SCREENSHOT_NAME: Home, ... }

Mode B — vendor copy for BrowserStack zip upload
  build-time:
    npm install
    cp -r node_modules/@percy/maestro-app/percy flows/percy
    cd flows && zip -r ../Flows.zip . && cd ..
  in zipped flows:
    - runFlow:
        file: percy/flows/percy-screenshot.yaml
        env: { SCREENSHOT_NAME: Home, ... }
```

### Example repo shape after restructure

```
example-percy-maestro-app/
├── package.json              ← @percy/maestro-app via file:../percy-maestro for dev
├── README.md                 ← tutorial: upload APK, prepare zip, upload, run
├── flows/
│   ├── screenshot.yaml       ← basic 2-snapshot flow on the calculator app
│   └── regions.yaml          ← coordinate region + element region (resource-id)
├── app/                      ← existing Android sample app source (kept)
│   └── ...
├── resources/
│   └── app-debug.apk         ← prebuilt sample APK (kept)
├── build.gradle, gradlew*    ← gradle infra (kept; supports "build from source")
└── scripts/
    └── prepare-zip.sh        ← npm install + vendor-copy + zip flows
```

Removed in this restructure: `flows-*/` (17 dirs), `Flows*.zip` (16 archives) — all scratch artifacts.

## Implementation Units

- [ ] **Unit 1: Add `package.json` + release metadata to percy-maestro**

**Goal:** Make the repo publishable as `@percy/maestro-app@1.0.0` with a tight `files` whitelist and zero runtime dependencies.

**Requirements:** R1, R2

**Dependencies:** None.

**Files:**
- Create: `package.json`
- Create: `RELEASING.md`
- Modify: `CHANGELOG.md` — append a `## [1.0.0] — 2026-MM-DD` section describing the rename and the npm-first distribution shift.

**Approach:**
- Define `name: "@percy/maestro-app"`, `version: "1.0.0"`, `description`, `license: "MIT"`, `author: "Perceptual Inc."`, `repository.url: "git+https://github.com/percy/percy-maestro-app.git"`, `homepage`, `bugs.url`, `keywords: ["maestro", "percy", "visual testing", "mobile testing", "android", "ios"]`.
- Set `files: ["percy", "README.md", "LICENSE", "CHANGELOG.md"]` to whitelist exactly the runtime surface.
- Set `publishConfig.access: "public"` and `publishConfig.tag: "latest"`.
- Set `engines.node: ">=14"` to match the BS host runtime documented in memory (Percy CLI on BS hosts runs Node 14.17.3 — even though we ship no Node code, signaling minimum compat is honest).
- Omit `main`, `bin`, `dependencies`, `devDependencies`. No scripts other than a no-op or `"test": "echo 'No tests; static-asset package' && exit 0"`.
- `RELEASING.md` documents the canonical release sequence: bump `package.json:version`, bump `clientInfo` literal in `percy/scripts/percy-screenshot.js`, append CHANGELOG entry, `npm pack --dry-run` sanity check, `npm publish`, GitHub release tag.

**Patterns to follow:**
- `~/percy-repos/percy-maestro-web/package.json` — mirror its overall structure but strip `main`/`bin`/`dependencies`/`devDependencies`/test scripts since we have nothing to compile or run.

**Test scenarios:**
- `npm pack --dry-run` from the SDK root lists exactly: `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, and the 4 files under `percy/`. No `test/`, no `docs/`, no `.git*`, no `multipart-file-test.*`.
- `npm pack` produces a tarball whose extracted contents match the dry-run output and total size is under 50 KB.
- `package.json` validates against `npm install --dry-run` (no missing required fields).

**Verification:**
- A scratch directory running `npm install --save-dev <path-to-tarball>` resolves the package and creates `node_modules/@percy/maestro-app/percy/flows/percy-screenshot.yaml`.

- [ ] **Unit 2: Sync `clientInfo` to `percy-maestro-app/1.0.0` and document the bump as a release-time step**

**Goal:** Update the telemetry string and lock in a documented release-time process so the version stays aligned with `package.json` on every future bump.

**Requirements:** R5

**Dependencies:** Unit 1 (so `package.json` exists for `RELEASING.md` to point at).

**Files:**
- Modify: `percy/scripts/percy-screenshot.js` — change `payload.clientInfo = "percy-maestro/0.4.0";` to `payload.clientInfo = "percy-maestro-app/1.0.0";`. (Reference: line ~187 — exact line may shift with surrounding edits.)
- Modify: `RELEASING.md` (created in Unit 1) — explicit checklist item: "Bump the `clientInfo` literal in `percy/scripts/percy-screenshot.js` to match the new `package.json` version."

**Approach:**
- Single-line change to the JS literal. Keep `environmentInfo: "percy-maestro"` unchanged — that field captures the SDK family identifier independent of distribution channel, and changing it would fragment historical telemetry queries.
- Manual sync. No build-time templating in 1.0.0; revisit if release cadence increases.

**Patterns to follow:**
- The existing `clientInfo` line; no new pattern introduced.

**Test scenarios:**
- Grep for `percy-maestro/` (with trailing slash) across the repo returns zero results after the edit — i.e. no stragglers in CHANGELOG examples or comments.
- Grep for `percy-maestro-app/1.0.0` returns exactly the one expected occurrence in `percy/scripts/percy-screenshot.js`.

**Verification:**
- A test BS Maestro build's Percy CLI debug log shows `clientInfo: "percy-maestro-app/1.0.0"` on the relay POST. (Verified in Unit 5 alongside the package smoke test.)

- [ ] **Unit 3: Rewrite SDK README to lead with npm install + document both consumption modes**

**Goal:** First-page customer onboarding starts with `npm install`, with the BS zip workflow documented as the recommended deployment pattern.

**Requirements:** R3, R4, R6

**Dependencies:** Unit 1.

**Files:**
- Modify: `README.md`

**Approach:**
- Rewrite the **Installation** section to:
  1. Lead: `npm install --save-dev @percy/maestro-app @percy/cli` (matches `@percy/maestro-web` shape exactly).
  2. Show **Mode A** YAML (npm path reference) as the simplest "is this working?" check.
  3. Show **Mode B** vendor-copy for BS uploads, with the exact `cp -r node_modules/@percy/maestro-app/percy flows/percy` line and a one-line zip example.
  4. Note that vendor mode preserves the existing `runFlow: percy/flows/percy-screenshot.yaml` path, so anyone migrating from the pre-npm distribution can keep their YAML unchanged.
- Add a brief migration callout: "If you previously copied `percy/` into your workspace by hand, you can keep doing that — npm just gives you a versioned source." Include the migration-from-0.4.0 line in the BrowserStack section as well.
- Update the BrowserStack section example commands to reflect that the zip now contains a vendored `percy/` produced from `node_modules`.
- Bump the `clientInfo` example in any documentation block from `percy-maestro/0.4.0` to `percy-maestro-app/1.0.0`.
- Leave the **How it works**, **Configuration**, **Regions**, **Runtime support**, and **Features not supported** sections substantively unchanged — they describe runtime behavior, which has not changed.

**Patterns to follow:**
- `~/percy-repos/percy-maestro-web/README.md` "Install" section opening lines for the npm-install voice and shape.

**Test scenarios:**
- Markdown lints cleanly (no broken anchors or stale headings).
- A clean-room read by someone who has never seen the project produces a working install + first snapshot in under 10 minutes.

**Verification:**
- Both Mode A and Mode B sections are independently runnable: a reviewer can follow either path and reach a working flow without consulting the other.

- [ ] **Unit 4: Restructure `example-percy-maestro-app` to two flows + npm consumption**

**Goal:** Replace the 17 scratch flow directories and 16 zip archives with one clean tutorial repo that demonstrates exactly two flows.

**Requirements:** R7, R8, R9

**Dependencies:** Unit 1 (the example pins `@percy/maestro-app` via `file:../percy-maestro`, which only resolves once the SDK has a `package.json`).

**Files (all paths relative to `~/percy-repos/example-percy-maestro/`):**
- **Delete:** `flows-final/`, `flows-local/`, `flows-local2/`, `flows-pathtest/`, `flows-pathtest2/`, `flows-pathtest3/`, `flows-realtime/`, `flows-serverside/`, `flows-simple/`, `flows-test2/` through `flows-test7/`, `flows-tunnel-test/`, all `Flows*.zip` files at the repo root, the existing `flows/` (replaced wholesale).
- **Create:** `package.json`, `flows/screenshot.yaml`, `flows/regions.yaml`, `scripts/prepare-zip.sh`.
- **Modify:** `README.md` (rewrite tutorial around the two flows + prepare-zip script).
- **Keep:** `app/` (Android sample app source), `build.gradle`, `gradle/`, `gradlew`, `gradlew.bat`, `settings.gradle`, `resources/app-debug.apk`, `LICENSE`, `CODEOWNERS`.

**Approach:**

- `package.json`:
  - `name: "example-percy-maestro-app"`, `private: true`, `version: "0.0.1"`.
  - `devDependencies`: `@percy/cli` (latest stable) and `@percy/maestro-app` (`file:../percy-maestro` for local dev; replaced with `^1.0.0` once the SDK is published).
  - `scripts`:
    - `prepare-zip`: shell script that copies `node_modules/@percy/maestro-app/percy` into `flows/percy` and zips `flows/` into `Flows.zip`.
    - `clean`: removes `Flows.zip` and `flows/percy/`.
  - No local-run scripts (Maestro on a developer laptop is not a supported runtime — see SDK runtime-support note).

- `flows/screenshot.yaml` — baseline screenshot demo:
  - `appId: com.sample.browserstack.samplecalculator` matching the bundled APK.
  - Top-level `env:` defaults: `PERCY_DEVICE_NAME`, `PERCY_OS_VERSION`, `PERCY_SCREEN_WIDTH/HEIGHT`, `PERCY_ORIENTATION` (Android Galaxy S22 values).
  - Two snapshots: launch screen, then one calculator interaction screen — enough to demonstrate that a Percy build with multiple snapshots works without mixing in regions complexity.
  - Lazy-init pattern (no explicit `percy-init.yaml` call) since `percy-screenshot.yaml` self-initializes — modeling the recommended minimum integration.

- `flows/regions.yaml` — regions demo:
  - Same `appId`, same env defaults.
  - Two snapshots, each demonstrating a distinct region pattern:
    - Snapshot 1: coordinate-based region (e.g., ignore the status bar via `top: 0, bottom: 50, left: 0, right: 1080` with `algorithm: "ignore"`).
    - Snapshot 2: element-based region using `element: { "resource-id": "com.sample.browserstack.samplecalculator:id/editText" }` with `algorithm: "ignore"`. The `editText` view is the calculator's result display — its value differs across runs ("8", "12", "0"), making it the canonical "ignore this dynamic region" use case for a demo. Defined in `app/src/main/res/layout/activity_main.xml`.
  - Demonstrates `PERCY_REGIONS` JSON env-var usage in both coordinate and element shapes.
  - **Selector caveat to call out in the README:** this app has zero `android:contentDescription` attributes, so `resource-id` is the only stable selector available. The bundled APK has `minifyEnabled false` so resource IDs survive into the build, but consumers shipping R8/minified release builds should prefer `content-desc` selectors on their own apps (already covered in the SDK README's *Release-build caveat (Android)* section — link from the example).

- `scripts/prepare-zip.sh`:
  - Verifies `node_modules/@percy/maestro-app/percy` exists; if not, suggests `npm install`.
  - `cp -r node_modules/@percy/maestro-app/percy flows/percy` (overwrites if already present).
  - `cd flows && zip -r ../Flows.zip . && cd ..`.
  - Prints next-step `curl` invocations for uploading the test suite and triggering the BS Maestro v2 build.

- `README.md` rewrite:
  - Single linear tutorial: install Node + Maestro (link), `npm install`, upload APK, `npm run prepare-zip`, upload test suite, create Percy project, trigger build (full `curl` with `percyOptions.percyToken` for Android).
  - "Choose your flow" section showing the two available flows and what each demonstrates.
  - "Build from source" subsection retained (the gradle setup still produces `app-debug.apk`).
  - Cross-link to the SDK README's Mode B section so readers see the underlying mechanism.

**Patterns to follow:**
- `~/percy-repos/example-percy-maestro-web/package.json` for the `file:` link convention and per-script structure.
- The existing `flows/screenshot-test.yaml` (about to be deleted) for `appId`, env defaults, and the `runFlow:` invocation shape.

**Test scenarios:**
- After `npm install`, `node_modules/@percy/maestro-app/percy/flows/percy-screenshot.yaml` exists.
- After `npm run prepare-zip`, `Flows.zip` exists and unzipping it shows `screenshot.yaml`, `regions.yaml`, and `percy/flows/percy-screenshot.yaml` at the expected paths.
- Both `Flows.zip` produce successful BS Maestro v2 builds when uploaded against `app-debug.apk` with `percyOptions.percyToken` set.
- The resulting Percy build has 2 snapshots from `screenshot.yaml` and 2 snapshots (with regions metadata visible in the dashboard) from `regions.yaml`.
- The repo root contains zero `flows-*/` directories and zero `Flows*.zip` files other than the one produced by `prepare-zip` (which itself should be `.gitignore`d).

**Verification:**
- Cloning the example repo fresh, running `npm install && npm run prepare-zip`, uploading APK + zip + triggering a BS build with valid creds, produces a green Percy build with the expected 4 snapshots.
- A new contributor reading the README in isolation (no prior Percy familiarity) reaches a green Percy build in under 15 minutes.

- [ ] **Unit 5: Validate, smoke-test on BrowserStack, and publish to npm**

**Goal:** Confirm the package and example are correct end-to-end, then publish 1.0.0 to npm and tag the release.

**Requirements:** R1, R5, R9

**Dependencies:** Units 1–4 complete.

**Files:**
- No code files.
- Modify (post-publish): `example-percy-maestro-app/package.json` — replace `"@percy/maestro-app": "file:../percy-maestro"` with `"@percy/maestro-app": "^1.0.0"`.
- Modify (post-publish): `percy-maestro-app/CHANGELOG.md` — flip the 1.0.0 entry's date to the publish date.

**Approach:**

The publish flow is structured as a **beta-soak protocol**, not a single-shot publish. Once `1.0.0` lands on the public registry, it is effectively permanent — npm's unpublish window closes at 72h and is blocked outright if any consumer has already installed the version. The beta's job is to catch *registry-shape* bugs that a local tarball install cannot surface: missing files in the `files` whitelist, scoped-package access edge cases, surprising `npm install` resolution. Promotion to `1.0.0` happens only after the beta has soaked and exercised both flows on a real BS build.

Phases:

1. **Local content audit (file-list authority).** `npm pack` (not `--dry-run`) + `tar -tzf` is the strongest pre-publish content check, per npm's developer guide. Confirms exactly the Unit-1 whitelist: `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, four files under `percy/`. Catches `files`-whitelist mistakes before they hit the registry. `npm pack --dry-run` and `npm publish --dry-run` are useful complements but not the authority.
2. **Local install smoke.** `npm install --save-dev <tarball>` from a scratch directory. Confirms the install shape works offline.
3. **Example dev-link smoke.** Run `prepare-zip` against the `file:../percy-maestro` link and inspect `Flows.zip`.
4. **Beta publish (gated dist-tag).** Set `package.json:version` and the `clientInfo` literal to `1.0.0-beta.0`. Publish from CI with `npm publish --tag beta --access public --provenance`. The `--tag beta` keeps the artifact off the `latest` dist-tag; consumers must opt in via `@beta` to install it. The `--provenance` flag attaches a sigstore attestation linking the tarball to the source commit and CI run (npm baseline since 2024 for supply-chain trust).
5. **Beta consumer install (registry-shape proof).** From a fresh scratch directory with no local link, `npm install @percy/maestro-app@beta` from the registry. Confirm the installed tree matches the offline-tarball install byte-for-byte. This is the step that catches `files`-whitelist or scope-permission bugs that the offline install misses.
6. **BS Maestro Android beta smoke (both flows).** Point the example at `@percy/maestro-app@beta`, run `prepare-zip`, trigger BS Maestro v2 builds for `screenshot.yaml` and `regions.yaml`. Verify each build green, snapshots appear in the Percy build, and CLI debug log reports `clientInfo: "percy-maestro-app/1.0.0-beta.0"`.
7. **BS Maestro iOS beta smoke (best-effort).** Same shape on iOS using `appPercy.PERCY_TOKEN` if the 2026-04-27 BS iOS Maestro spawn-step blocker has cleared. If still blocked at maestro-spawn, document the deferral in the 1.0.0 CHANGELOG and ship Android-verified-only.
8. **Soak window.** Hold the beta on the registry **48–72 hours minimum** before promoting. Iterate `1.0.0-beta.1`, `1.0.0-beta.2` if anything breaks — non-binding, cheap.
9. **Promote to 1.0.0 (clean publish, not dist-tag promotion).** Bump `version` to `1.0.0`, bump `clientInfo` to `percy-maestro-app/1.0.0`, append the final 1.0.0 CHANGELOG entry — all in one commit. Publish from CI with `npm publish --access public --provenance`. No `--tag` flag → `latest` is set automatically. (Deliberately a fresh `1.0.0` publish rather than `npm dist-tag add ...beta.0 latest` so the canonical install resolves to a clean semver string without a `-beta` suffix.)
10. **Verify clean install.** From a fresh scratch directory: `npm install @percy/maestro-app` (no version specifier). Confirm it resolves to `1.0.0` with the expected file tree.
11. **Pin example to `^1.0.0`.** Replace `file:../percy-maestro` in `example-percy-maestro-app/package.json` with `^1.0.0`. Run one final BS smoke build to confirm the published artifact matches local-link behavior.
12. **GitHub releases.** Tag `v1.0.0` on `percy/percy-maestro-app` and `percy/example-percy-maestro-app`, with release notes linking the CHANGELOG and tutorial.

**Rollback.** Post-promotion (after the 72h window), the rollback is **deprecate, not unpublish**. Ship the fix as `1.0.1` first and let `latest` move to it, then `npm deprecate @percy/maestro-app@1.0.0 "<one-line bug summary, link to issue>"`. Never deprecate without a working successor on `latest`. Deprecation surfaces a yellow `npm install` warning without breaking existing lockfiles — exactly the right blast radius.

**Execution note:** External dependencies (BS hosts, npm registry) and credentials (PERCY_TOKEN, BS_USER, BS_KEY, npm 2FA-on-writes, OIDC for `--provenance`) make this unit inherently execution-time work. Do not pre-write the choreography — the implementer runs each phase and verifies the outcome before proceeding. Publish from CI, not a laptop.

**Patterns to follow:**
- `@percy/maestro-web` initial publish workflow if a runbook exists for it.

**Test scenarios:** (all verified at execution; not written as repository tests)
- `npm pack --dry-run` exact file list matches whitelist.
- `npm view @percy/maestro-app version` returns `1.0.0` post-publish.
- BS Android build with `screenshot.yaml`: 2 snapshots, `clientInfo` in CLI log matches `percy-maestro-app/1.0.0`.
- BS Android build with `regions.yaml`: 2 snapshots; Percy dashboard shows region metadata on both.
- Fresh-install path resolves identically to dev-link path.

**Verification:**
- Published package is installable, runnable on a real BS Maestro build, and reports the correct version in CLI telemetry.
- Example repo's published form (with `^1.0.0`) produces the same Percy build outcome as the dev-link form.
- GitHub release exists with notes pointing at the changelog.

## System-Wide Impact

- **Interaction graph:** No runtime interaction-graph change. The SDK→CLI relay→Percy API path is unchanged. The change is upstream of runtime: how customers obtain the SDK files.
- **Error propagation:** Unchanged. The CLI relay still returns the same status codes; the JS scripts still log the same banners and warnings.
- **State lifecycle risks:** None. No new persistence, no new cache, no new lifecycle. The package is static files at install time.
- **API surface parity:** The SDK's runtime API surface (env vars, sub-flow names, JS payload shape) is unchanged. The customer-facing **install** API changes from "copy a directory" to "npm install" — explicit migration call-outs in both READMEs cover this.
- **Integration coverage:** Unit-test-equivalent here is the BS Maestro smoke build in Unit 5. There are no Node unit tests to add, since the package ships no Node-callable code.
- **Telemetry continuity:** `clientInfo` string changes from `percy-maestro/0.4.0` to `percy-maestro-app/1.0.0`. Anyone querying Percy CLI debug logs by the `percy-maestro/` prefix will need to update their query. Document in the CHANGELOG.

## Risks & Dependencies

- **Maestro path resolution under `node_modules`.** Mode A relies on `runFlow:` accepting `../node_modules/@percy/maestro-app/percy/flows/percy-screenshot.yaml`. Maestro's docs confirm relative path resolution for `runFlow:` and `runScript:`, but a smoke build (Unit 5 step 4 with Mode A YAML, separately from the canonical Mode B build) is the definitive check. **Mitigation:** if Mode A breaks, the README leads with Mode B (vendor) — and it's already the recommended pattern for BS uploads, so a regression in Mode A delays nothing critical.
- **BS iOS Maestro spawn-step blocker (2026-04-27, per memory).** May still be active at execution time. **Mitigation:** ship 1.0.0 with Android verification only if needed; iOS revalidation can land in a 1.0.1 patch once BS infra clears.
- **`@percy/maestro-app` name collision on npm.** Possible but unlikely (the `@percy` org owns the scope). **Mitigation:** Unit 5 step 1 verifies via `npm view @percy/maestro-app` before publish; falling back to `@percy/maestro` is an alternative if the scope shows an unexpected reservation.
- **Customers with existing copy-the-directory installs upgrading to npm.** Need a migration story. **Mitigation:** Mode B is the no-op migration — they keep their YAML, change only how `percy/` gets populated. Documented in the README migration callout.
- **`clientInfo` query continuity for telemetry.** Internal teams or dashboards querying Percy CLI logs by `percy-maestro/...` need to widen their filter to also match `percy-maestro-app/...`. **Mitigation:** call out in the CHANGELOG entry; consider a one-line grep in the team's telemetry README.
- **Example repo cleanup is destructive.** Deleting 17 directories and 16 zip files in one PR is a large surface. **Mitigation:** stage the deletion as the *first* commit in the Unit 4 PR, with a clear commit message ("remove scratch flow directories from iteration phase"); reviewers can confirm the new flows in the second commit. No information is lost (git history retains the scratch directories).
- **`prepare-zip` script portability.** The script uses `cp` and `zip` — fine on macOS/Linux/CI. Windows users in npm-script land typically run via WSL or Git Bash. **Mitigation:** document the dependency in the README (`zip` and `bash`); WSL/Git Bash both ship `zip`. If a Windows-native script is needed later, follow up with a PowerShell variant.
- **First npm publish 2FA / publish-rights friction.** **Mitigation:** confirm the publisher's `@percy` org membership and 2FA-on-writes (`auth-and-writes`) before starting Unit 5; the publish itself is a 30-second step once auth is settled. Publishing from CI via OIDC + `--provenance` is preferred over a laptop publish — it eliminates long-lived `NPM_TOKEN` secrets and produces a sigstore attestation for supply-chain verification.
- **`1.0.0` is irrevocable past the 72-hour unpublish window.** Once a consumer installs `@percy/maestro-app@1.0.0`, even a within-72h unpublish is blocked outright. This is npm policy, not a workaround surface. **Mitigation:** the beta-soak protocol in Unit 5 (publish `1.0.0-beta.0` under `--tag beta`, soak 48–72 hours with at least one fresh-scratch consumer install + BS smoke build on both flows, then publish a clean `1.0.0`). Rollback after `1.0.0` ships is **deprecate-and-patch**, not unpublish: ship `1.0.1` with the fix on `latest` first, then `npm deprecate @percy/maestro-app@1.0.0 "<one-line bug summary, link to issue>"`. Never deprecate without a working successor.
- **A single offline-tarball smoke test does not prove the registry artifact is correct.** `npm install --save-dev <local-tarball>` can succeed even when the published artifact is broken — e.g., a file exists in the working tree but not in the `files` whitelist; scoped-package access settings prevent non-org installs; the `engines.node` field rejects a real-world Node version. **Mitigation:** Unit 5 step 5 mandates a fresh-scratch consumer install of `@percy/maestro-app@beta` from the actual registry (not a local tarball) before any BS smoke build runs. Diff the file tree against the offline-tarball install byte-for-byte.

## Documentation / Operational Notes

- **CHANGELOG entry for 1.0.0** in the SDK repo: highlight (a) renamed-on-npm-only (`@percy/maestro-app`), (b) `clientInfo` changed to `percy-maestro-app/1.0.0`, (c) two consumption modes documented, (d) no runtime contract changes — sub-flow names, env vars, and CLI relay payload are all identical to 0.4.0.
- **CHANGELOG entry for example repo:** "0.1.0 — Restructured to two focused flows (`screenshot.yaml`, `regions.yaml`); SDK now consumed via `@percy/maestro-app` from npm."
- **Internal telemetry note** (in `percy-ops/runbook.md` if such a doc exists, otherwise team Slack): "`clientInfo` for percy-maestro builds is now `percy-maestro-app/X.Y.Z`. Update Percy CLI log greps."
- **`RELEASING.md`** lives in the SDK repo and captures the durable release protocol:
  - **Pre-publish content audit:** `npm pack` + `tar -tzf` is the file-list authority (npm developer-guide-recommended). `--dry-run` variants are complementary, not authoritative.
  - **Beta-soak protocol:** publish `X.Y.Z-beta.N` with `--tag beta --provenance --access public`, soak 48–72 hours with a fresh-scratch consumer install + BS smoke builds for both flows, then publish a clean `X.Y.Z` (no `-beta` suffix on `latest`).
  - **Bump checklist (single commit):** `package.json:version`, the `clientInfo` literal in `percy/scripts/percy-screenshot.js`, the new CHANGELOG entry — all three updated together to prevent drift.
  - **2FA + provenance:** 2FA-on-writes (`auth-and-writes`) is required for any `@percy`-scoped publish; publish from CI via OIDC with `--provenance` (sigstore attestation), never from a laptop with a long-lived `NPM_TOKEN`.
  - **Rollback template:** `npm deprecate @percy/maestro-app@X.Y.Z "X.Y.Z contains <one-line bug>. Upgrade to X.Y.Z+1 — see <issue link>."` (under 120 chars). Never deprecate without a working successor on `latest`.
- **Migration FAQ** entry (one paragraph in the README): "I have `percy/` already copied into my Maestro workspace from a previous version — do I need to change anything? No. The package ships the same files in the same layout. You can keep your copy or run `npm install` and let `npm run prepare-zip` (or `cp -r node_modules/@percy/maestro-app/percy ./percy`) maintain it for you on each release."
- **GitHub release note** for `v1.0.0`: link CHANGELOG, link the example repo, link the published npm tarball.

## Sources & References

- Reference SDK package: `~/percy-repos/percy-maestro-web/package.json`
- Reference example: `~/percy-repos/example-percy-maestro-web/package.json`, `~/percy-repos/example-percy-maestro-web/README.md`
- Current SDK files: `~/percy-repos/percy-maestro/percy/flows/`, `~/percy-repos/percy-maestro/percy/scripts/percy-screenshot.js`, `~/percy-repos/percy-maestro/README.md`, `~/percy-repos/percy-maestro/CHANGELOG.md`
- Current example flow (template for the two new flows): `~/percy-repos/example-percy-maestro/flows/screenshot-test.yaml`
- Existing example app + APK to keep: `~/percy-repos/example-percy-maestro/app/`, `~/percy-repos/example-percy-maestro/resources/app-debug.apk`
- Memory entries cited above:
  - `project_maestro_repo_split.md` — repo consolidation 2026-05-05
  - `project_bs_ios_maestro_spawn_breakage.md` — 2026-04-27 BS iOS Maestro blocker
  - `feedback_percy_cli_bs_hosts_node14.md` — BS host Node version
- Recent commits on `percy-maestro` referenced: `4b40b6a fix(sdk): post-1.0 cleanup`, `999d0c8 feat(sdk): cross-platform Android + iOS SDK with feature parity (#1)`
