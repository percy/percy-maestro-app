---
date: 2026-04-03
topic: sdk-feature-parity
---

# Percy Maestro SDK — Feature Parity with Other Percy SDKs

## Problem Frame

The Percy Maestro SDK currently supports only basic screenshot capture with name, tag metadata, testCase, and labels. Other Percy mobile SDKs (percy-appium-python, percy-espresso-java) support a richer set of comparison options — particularly **regions** (ignore, consider, custom with per-region algorithm selection), **sync mode**, and **tile metadata** (statusBarHeight, navBarHeight, fullscreen). Users adopting the Maestro SDK lose access to these capabilities.

This work spans three repos:
1. **percy-maestro** (SDK) — parse new options from env vars, include in payload
2. **percy CLI** (`cli/packages/core/src/api.js`) — extend `/percy/maestro-screenshot` relay to accept and forward new fields
3. **mobile** (platform) — update batch upload fallback in `maestro_percy_session.rb`

## Architecture Decision: Why `/percy/maestro-screenshot` Relay

**Verified via BrowserStack testing on 2026-04-03** (builds `e057728543394c2b5707e575ad7fd50cd5bfb0b6`, `5cdb2b5b8f8576053131ec55e24032924be6ab4d`).

Alternatives tested and ruled out:

| Approach | Result | Root Cause |
|---|---|---|
| `multipartForm filePath` to `/percy/comparison/upload` | `java.io.FileNotFoundException` for ALL paths | OkHttp3 resolves from JVM CWD which doesn't match Maestro workspace. GraalJS blocks `Java.type()` (returns null) so script cannot discover CWD or list directories. |
| `tiles[].filepath` (JSON) to `/percy/comparison` | `503` from Percy CLI | Percy CLI also can't find the file at the relative path from its own process CWD. |

Three compounding GraalJS sandbox constraints prevent direct file upload:
1. **No Java interop** — `Java.type()` returns null
2. **Unknown CWD** — relative paths don't resolve to Maestro workspace
3. **No path construction** — `PERCY_SESSION_ID` not reliably available in JS context

The relay pattern (SDK sends metadata JSON, Percy CLI finds + reads file from disk via sessionId glob) is the **only viable approach** on BrowserStack.

## Requirements

### SDK Features (percy-screenshot.js)

- R1. **Ignore/consider regions via coordinates.** Accept `PERCY_REGIONS` env var as a JSON string. Each region specifies `top`, `bottom`, `left`, `right` (pixel coordinates relative to screenshot), and `algorithm` (`"ignore"`, `"layout"`, `"standard"`, `"intelliignore"`). Transform to CLI's `regions[].elementSelector.boundingBox` format (`{x, y, width, height}`). Note: "consider region" behavior is achieved by using `"standard"` or `"intelliignore"` algorithm on a bounded region — there is no literal `"consider"` algorithm value in the CLI schema.
- R2. **Per-region algorithm configuration.** Each region in `PERCY_REGIONS` may optionally include `diffSensitivity` (0-4), `imageIgnoreThreshold` (0-1), `carouselsEnabled`, `bannersEnabled`, `adsEnabled` under a `configuration` key.
- R3. **Sync mode.** Accept `PERCY_SYNC` env var (`"true"`/`"false"`). When true, the relay waits for comparison processing and returns details in the response. The SDK logs a best-effort summary: the comparison link and status if present, or the full response body as a string. Exact fields depend on the response shape (see Outstanding Questions).
- R4. **Status bar height.** Accept `PERCY_STATUS_BAR_HEIGHT` env var (integer pixels). Passed to the relay so the CLI applies it to the tile's `statusBarHeight` field instead of hardcoded `0`.
- R5. **Navigation bar height.** Accept `PERCY_NAV_BAR_HEIGHT` env var (integer pixels). Passed to the relay for tile's `navBarHeight`.
- R6. **Fullscreen flag.** Accept `PERCY_FULLSCREEN` env var (`"true"`/`"false"`). Passed to the relay for tile's `fullscreen` field.
- R7. **Test harness execution ID.** Accept `PERCY_TH_TEST_CASE_EXECUTION_ID` env var (string). Passed through for CI/CD test execution correlation.
- R8. **Graceful degradation.** Invalid JSON in `PERCY_REGIONS` logs a `[percy]` warning and proceeds without regions (omits `regions` field from payload; screenshot still uploads). Within a valid JSON array, individual malformed regions (missing required coordinates, `right <= left`, `bottom <= top`, non-numeric values) are skipped with a per-region `[percy]` warning — valid regions in the same array are still sent. Invalid integers for bar heights are silently skipped (field omitted from payload).
- R9. **SDK version bump.** Update `clientInfo` from `percy-maestro/0.1.0` to `percy-maestro/0.2.0` in `percy-screenshot.js` (the only file that sends clientInfo).

### CLI Relay Endpoint (`/percy/maestro-screenshot`)

- R10. **Accept new fields.** The relay handler accepts optional fields from the SDK request body: `regions` (array of pre-transformed CLI-format objects: `{elementSelector: {boundingBox: {x, y, width, height}}, algorithm, configuration?, padding?, assertion?}`), `sync` (boolean), `statusBarHeight` (integer), `navBarHeight` (integer), `fullscreen` (boolean), `thTestCaseExecutionId` (string). Unknown fields are silently ignored for forward compatibility.
- R11. **Apply tile metadata.** When building the tile object, use `statusBarHeight`, `navBarHeight`, and `fullscreen` from the request instead of hardcoding `0`/`false`. Default to current behavior (`0`/`false`) when not provided.
- R12. **Forward comparison options.** Pass `regions`, `sync`, and `thTestCaseExecutionId` directly to the `percy.upload()` comparison payload.
- R13. **Sync response.** When `sync` is true, wait for comparison processing and return comparison details in the response body (matching `/percy/comparison` sync behavior).
- R14. **Backward compatibility.** Existing SDK versions (0.1.0) that don't send new fields continue to work unchanged.

### Mobile Platform Fallback (`maestro_percy_session.rb`)

- R15. **[DEFERRED] Support new fields in batch upload.** The batch upload path in `maestro_percy_session.rb` is likely deprecated (see Dependencies). If confirmed active by the platform team, options would need to come from a session-level config file set up by `maestro_runner.rb` before the flow runs — the GraalJS sandbox cannot write sidecar files. Drop this requirement if the batch path is confirmed deprecated.

### Documentation

- R16. **Document all new env vars.** README updated with a complete env var reference table including types, defaults, and examples. Note: the existing README incorrectly describes the upload mechanism as "multipart POST to `/percy/comparison/upload`" — correct this to reflect the actual JSON POST to `/percy/maestro-screenshot` relay.
- R17. **Document region format.** Provide concrete, copy-pasteable YAML examples for common region use cases (ignoring a clock/status area, focusing comparison on a specific widget).
- R18. **Document excluded features.** Explain why certain Percy SDK features don't apply to Maestro, with rationale for each.

## Success Criteria

- All new env vars are accepted by the SDK and forwarded through the relay to the comparison pipeline
- Regions with different algorithms produce correct visual diffs in the Percy dashboard
- Sync mode returns comparison details in the Maestro flow log output
- Status bar/nav bar heights correctly exclude those areas from comparison
- Existing flows without new env vars work identically (zero breaking changes)
- Documentation covers all new options with working examples

## Scope Boundaries

- **NOT implementing:** `scrollableXpath`, `scrollableId`, `screenLengths`, `fullPage` multi-tile — Maestro controls scrolling via YAML `scroll` command; users capture multiple screenshots with scroll steps between them.
- **NOT implementing:** `freezeAnimations`, `percyCSS`, `enableJavascript` — DOM/web-specific features not applicable to native mobile bitmap captures.
- **NOT implementing:** XPath/accessibility ID-based region selectors — GraalJS cannot resolve element bounding boxes. Only coordinate-based (boundingBox) regions supported.
- **NOT implementing:** App Automate-specific features — Maestro uses the generic Percy path.
- **NOT implementing:** iOS support — separate initiative; healthcheck currently enforces Android-only.

## Key Decisions

- **`/percy/maestro-screenshot` relay over direct upload:** Verified via BrowserStack testing. The JS sandbox cannot access screenshot files (see Architecture Decision above).
- **Modern `regions` API over legacy `ignoredElementsData`:** The CLI's regions schema supports per-region algorithm selection (standard, layout, ignore, intelliignore) which is more powerful and forward-compatible.
- **Coordinate-only regions (no element selectors):** GraalJS sandbox has no access to the view hierarchy or element bounding boxes. Users must specify pixel coordinates manually. This is a fundamental constraint of the Maestro JS environment.
- **JSON env vars for complex options:** `PERCY_REGIONS` is passed as a JSON string because Maestro's env var mechanism only supports strings. The SDK parses it with `json()`.
- **Simplified region input format:** SDK accepts `{top, bottom, left, right, algorithm}` and transforms to CLI's `{elementSelector: {boundingBox: {x, y, width, height}}, algorithm}` internally.

## Dependencies / Assumptions

- Percy CLI relay changes (R10-R14) must be deployed before SDK features are usable
- Percy CLI version must support the `regions` field in the comparison schema (current `main` does)
- BrowserStack must deploy the updated Percy CLI to their infrastructure for changes to take effect
- The batch upload path (R15) may be deprecated — the `maestro_runner.rb` comment says "batch upload_screenshots_to_percy is no longer needed." Verify with platform team before implementing.
- **Forward compatibility:** SDK 0.2.0 may run against an old Percy CLI that doesn't recognize new fields. The CLI relay should silently ignore unknown fields (R10 specifies this). If the old CLI rejects them, the SDK's graceful degradation (R8) should handle the error — screenshot uploads without the new options rather than failing entirely.

## Outstanding Questions

### Resolve Before Planning

_(None — all product questions resolved)_

### Deferred to Planning

- [Affects R3][Technical] Exact sync mode response shape from Percy CLI — verify the `json()` parser in GraalJS can handle the response structure.
- [Affects R15][Needs confirmation] Is the batch upload path (`maestro_percy_session.rb`) still active, or has it been fully replaced by the real-time relay? If deprecated, R15 can be dropped.
- [Affects R4-R6][Technical] When the relay constructs tiles, does it need to validate statusBarHeight/navBarHeight against the image dimensions? Or does the comparison pipeline handle invalid values gracefully?

## Next Steps

→ `/ce:plan` for structured implementation planning (update existing plan at `docs/plans/2026-04-02-001-feat-sdk-feature-parity-plan.md`)
