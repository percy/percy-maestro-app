# Testing `@percy/maestro-app`

This document captures how to validate the SDK end-to-end **without publishing to npm**, and what the publish-time soak adds on top.

## Why local testing is sufficient for SDK behavior

The example repo at [`percy/example-percy-maestro-app`](https://github.com/percy/example-percy-maestro-app) declares the SDK as a `file:` dependency during dev:

```json
"devDependencies": {
  "@percy/maestro-app": "file:../percy-maestro"
}
```

This means `npm install` resolves `@percy/maestro-app` from your local SDK checkout — not from the npm registry. The `npm run prepare-zip` script then vendor-copies bytes from your local working tree into `flows/percy/` and zips them. The `Flows.zip` you upload to BrowserStack contains your local SDK bytes. The npm registry never enters the picture.

This proves every aspect of SDK runtime behavior (capture, regions, relay payload, `clientInfo`, error handling, file-path resolution inside the zip) without any publish. The only bug class it does **not** catch is npm-publish-mechanics — those are validated by the beta-soak protocol described in [`RELEASING.md`](./RELEASING.md).

| Bug class | Caught locally | Caught by beta soak |
|---|---|---|
| SDK runtime behavior | ✅ | — |
| Path resolution inside the BS zip | ✅ | — |
| `prepare-zip` correctness | ✅ | — |
| `clientInfo` telemetry value | ✅ | — |
| Region resolution (coordinate + element) | ✅ | — |
| `files` whitelist mistakes (in working tree but not in tarball) | ❌ | ✅ |
| Scoped-package permissions / 2FA / OIDC | ❌ | ✅ |
| `latest` vs `beta` dist-tag handling | ❌ | ✅ |

## Local end-to-end test

### One-time setup

You need both repos checked out as siblings:

```
percy-repos/
├── percy-maestro/             ← this repo
└── example-percy-maestro/     ← clone from percy/example-percy-maestro-app
```

```sh
cd ../example-percy-maestro
npm install
```

`npm install` follows the `file:../percy-maestro` link to your local SDK checkout.

### Run the test

```sh
cd ../example-percy-maestro
npm run prepare-zip
```

`prepare-zip` vendor-copies `node_modules/@percy/maestro-app/percy` into `flows/percy/` and zips `flows/` into `Flows.zip`. Confirm the contents:

```sh
unzip -l Flows.zip
```

Expected: `screenshot.yaml`, `regions.yaml`, and the four files under `percy/` (init/screenshot YAMLs + healthcheck/screenshot JS).

Upload to BrowserStack and trigger a build with Percy enabled (full `curl` invocations live in the [example repo's README](https://github.com/percy/example-percy-maestro-app#tutorial)).

### What to verify on the resulting Percy build

- **4 snapshots total**: 2 from `screenshot.yaml` ("Calculator launch", "Calculator result"), 2 from `regions.yaml` ("Regions — coordinate", "Regions — element").
- **Percy CLI debug log** shows `clientInfo: "percy-maestro-app/X.Y.Z"` matching the version in your local `package.json`.
- For "Regions — element": Percy review UI shows the calculator's result-display area masked. If you see a `[percy] Warning: element resolver unavailable` line in the CLI log, the element region was silently skipped — coordinate region still uploads (graceful degradation).

### Iteration loop

Edit any file under `percy/scripts/` or `percy/flows/`. Re-run `npm run prepare-zip` in the example repo. Re-upload the test-suite zip. Re-trigger the BS build. No commit, no push, no publish required between iterations — `prepare-zip` always vendors fresh bytes from your working tree.

## When to move to the beta soak

Drive the local-link test until you're confident SDK behavior is right. Only then run the beta-publish protocol from [`RELEASING.md`](./RELEASING.md). The soak's job is to catch publish-mechanics bugs, not SDK bugs — by the time you publish, SDK bugs should already be ruled out.

If a beta surfaces a `files`-whitelist mistake or any registry-shape issue, iterate `1.0.0-beta.1` etc. Worst case is a few wasted beta versions on the registry. Past the 72-hour unpublish window, rollback is `npm deprecate` after shipping the patch on `latest` first — never deprecate without a working successor.
