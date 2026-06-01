# Releasing `@percy/maestro-app`

This document captures the durable release protocol for `@percy/maestro-app`. It is the source of truth for every publish — first-time, point release, or major version.

## Versioning

`@percy/maestro-app` follows [semver](https://semver.org/). Pre-releases use `X.Y.Z-beta.N` and ship under the `beta` dist-tag (never `latest`).

## Bump checklist (one commit)

Every release bump touches three places. Update them in a single commit so they cannot drift:

1. `package.json` → `version`
2. `percy/scripts/percy-screenshot.js` → the `payload.clientInfo` literal (format: `percy-maestro-app/X.Y.Z`)
3. `CHANGELOG.md` → new entry at the top of the file

## Pre-publish content audit

The file-list authority is `npm pack` followed by `tar -tzf`. `--dry-run` variants are useful complements but not authoritative.

```sh
npm pack
tar -tzf percy-maestro-app-X.Y.Z.tgz
```

This audit is enforced automatically in CI — `.github/scripts/verify-pack.sh` asserts the exact list below, and runs both on every PR (the **Pack Audit** workflow) and as a pre-publish gate inside the **Release** workflow. A drift in the `files` whitelist fails the build before anything reaches npm. The manual command above is for local confirmation.

Confirm the tarball contains exactly:

- `package.json`
- `README.md`
- `LICENSE`
- `CHANGELOG.md`
- `percy/flows/percy-init.yaml`
- `percy/flows/percy-screenshot.yaml`
- `percy/scripts/percy-healthcheck.js`
- `percy/scripts/percy-prepare-screenshot.js`
- `percy/scripts/percy-screenshot.js`

Anything else is a `files` whitelist mistake — fix it before continuing.

## Beta-soak protocol

`1.0.0` is effectively permanent — npm's unpublish window closes at 72 hours and is blocked outright if any consumer has installed the version. Every release goes through a beta soak first.

Publishing is **driven by GitHub Releases**, not by running `npm publish` by hand. The `.github/workflows/release.yml` workflow fires on `release: published`, runs the content audit, then publishes. It routes by tag name: a tag containing `-beta` (or `-rc`) publishes to the `beta` dist-tag; a clean `vX.Y.Z` tag publishes to `latest`. You never type `npm publish` — you cut a Release and the workflow does it.

1. Publish `X.Y.Z-beta.N`: push the bump commit, then create a GitHub Release tagged `vX.Y.Z-beta.N`. The Release workflow detects the `-beta` suffix and runs `npm publish --tag beta --access public`, keeping the artifact off `latest` — consumers must opt in via `@beta`.

2. From a fresh scratch directory with no local link, install `@percy/maestro-app@beta` and confirm the installed file tree matches the offline-tarball install byte-for-byte. This catches `files`-whitelist or scope-permission bugs that local installs miss.

3. Run BrowserStack Maestro v2 builds for both example flows (`flows/screenshot.yaml` and `flows/regions.yaml`) against the `@beta` install. Verify each build green, snapshots appear in the Percy build, and the Percy CLI debug log reports `clientInfo: "percy-maestro-app/X.Y.Z-beta.N"`.

4. Soak the beta on the registry for **48–72 hours minimum** before promoting. Iterate `beta.1`, `beta.2` if anything breaks — non-binding.

5. Promote to the clean `X.Y.Z` (no `-beta` suffix) by bumping the three places in the checklist above, pushing, and cutting a GitHub Release tagged `vX.Y.Z`. With no `-beta` suffix the workflow runs `npm publish --access public` (no `--tag`), so `latest` is set automatically. We deliberately publish a fresh `X.Y.Z` rather than `npm dist-tag add @beta.N latest` so the canonical install resolves to a clean semver string.

## Auth

- **Publish from CI, not a laptop.** The Release workflow authenticates to npm with `NODE_AUTH_TOKEN`, sourced from the `NPM_TOKEN` repository secret. This matches the publish setup across Percy SDK repos (e.g. `cli`).
- **`NPM_TOKEN` must be an automation/granular token** with publish rights to the `@percy` scope. Automation tokens bypass the interactive 2FA-on-publish prompt, which is what lets CI publish unattended.
- **Keep 2FA enabled on the human npm account** (`npm profile enable-2fa auth-only`) so the account that mints the token stays protected. CI publishes with the automation token, not your personal login.
- **Never publish from a laptop** with the token. Rotate `NPM_TOKEN` if it is ever exposed.

## Rollback

Past the 72-hour unpublish window, `npm unpublish` is blocked. Rollback is **deprecate-and-patch**, not unpublish:

1. Ship the fix as `X.Y.Z+1` first and let `latest` move to it.
2. Then deprecate the broken version with a one-line message under 120 characters:

   ```sh
   npm deprecate @percy/maestro-app@X.Y.Z "X.Y.Z contains <one-line bug>. Upgrade to X.Y.Z+1 — see <issue link>."
   ```

Never deprecate without a working successor on `latest`. Deprecation surfaces a yellow `npm install` warning without breaking existing lockfiles — the right blast radius.

## GitHub release

Tag `vX.Y.Z` after a successful promote. Release notes link to the CHANGELOG entry and (for major releases) the matching commit on `percy/example-percy-maestro-app`.
