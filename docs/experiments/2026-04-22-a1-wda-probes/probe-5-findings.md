---
date: 2026-04-22
experiment: A1 Probe 5 — WDA endpoint shape on BS iOS host
host: 185.255.127.52 (same host used for v0.4.0)
plan: docs/plans/2026-04-22-001-feat-ios-maestro-element-regions-plan.md
---

# A1 Probe 5 — WDA endpoint shape verification (partial)

## Scope

Plan's Probe 5 covers: `GET /session/:sid/wda/screen`, `GET /session/:sid/window/size`, `GET /session/:sid/orientation` — across ≥3 iPhone models, confirming logical-point output (not pixels).

This probe run covers 5 live WDA sessions on host `185.255.127.52`. All 5 devices are iPhone 14-class (same form factor), so **cross-model validation across scale={2,3} is NOT complete** — partial confirmation only.

## WDA identity

All active WDA processes on the host report:

```json
"build": {
  "version": "11.1.5",
  "time": "Apr  9 2026 12:51:10",
  "productBundleIdentifier": "com.facebook.WebDriverAgentRunner"
}
```

This is **raw Facebook-WDA** (not Appium's fork). The host's Appium supervisors launch WDA via `xcodebuild test-without-building` — Appium spawns the xctestrun, but the WDA binary itself is the standard Facebook `WebDriverAgentRunner`. Maestro would launch the same binary under the same mechanism. **Probe 5 results from this run are expected to generalize to Maestro-bundled WDA** of the same version (modulo possible drift if realmobile or Maestro pins a different WDA version).

## Results — 5 devices sampled

All 5 sessions returned identical response shapes. Representative output (port 8408, sessionId `3EE51D1B-C14B-49F3-BDD7-4C1C0F19E2D5`):

### `GET /session/:sid/status`

```json
{
  "value": {
    "build": {"version": "11.1.5", ...},
    "os": {"name": "iOS", "sdkVersion": "16.4", "version": "16.4.1"},
    "device": "iphone",
    "ready": true
  },
  "sessionId": "3EE51D1B-C14B-49F3-BDD7-4C1C0F19E2D5"
}
```

### `GET /wda/screen` (works both with and without `/session/:sid/` prefix)

```json
{
  "value": {
    "statusBarSize": {"width": 390, "height": 47},
    "scale": 3,
    "screenSize": {"width": 390, "height": 844}
  },
  "sessionId": "..."
}
```

**This is exactly the shape R4's primary scale-factor path needs.** Integer `scale`, logical-point `screenSize`, logical-point `statusBarSize` (iPhone 14 status bar is ~47pt). Plan's "one HTTP call per session" rationale is fully validated.

### `GET /session/:sid/window/size`

```json
{"value": {"width": 390, "height": 844}, "sessionId": "..."}
```

Logical points (390×844 = iPhone 14 standard; pixel value would be 1170×2532 at scale 3). **Plan's "logical CSS pixels" = logical points assumption confirmed.** (Note: on iOS, WDA's "CSS pixels" and Apple's "logical points" are the same unit by convention.)

### `GET /session/:sid/orientation`

```json
{"value": "PORTRAIT", "sessionId": "..."}
```

Plain string. Simplest primary signal for landscape tiering.

### Negative results (paths that 404)

- `GET /session/:sid/screen` → HTTP 404 "unknown command" (only `/wda/screen` is valid)
- `GET /sessions` → HTTP 404 "Unhandled endpoint" — **CONFIRMS FEASIBILITY REVIEWER WARNING:** `GET /sessions` is NOT a stock WDA endpoint. The plan's rejection of "WDA GET /sessions listing" as an R8 session-discovery mechanism is correct. realmobile-written `wda-meta.json` is the only secure path.

## Sample (port 8408 — representative of all 5 sessions)

| Endpoint | Status | `scale` | `screenSize` (pts) | `window/size` (pts) | `orientation` |
|---|---|---|---|---|---|
| `/wda/screen` | 200 | 3 | 390×844 | — | — |
| `/session/:sid/window/size` | 200 | — | — | 390×844 | — |
| `/session/:sid/orientation` | 200 | — | — | — | PORTRAIT |

All 5 sampled sessions on this host returned identical values. This host's device pool is all iPhone 14-class — **no scale=2 devices available for cross-validation on this host.**

## POST /session/:sid/elements — preliminary Probe 3 data

Opportunistic bonus probe (read-only; does not disturb co-tenant sessions):

### `POST /elements` with `using: "class name"`

```bash
POST /session/:sid/elements  {"using": "class name", "value": "XCUIElementTypeButton"}
```

Response:

```json
{
  "value": [
    {"ELEMENT": "42010000-0000-0000-2000-000000000000",
     "element-6066-11e4-a52e-4f735466cecf": "42010000-0000-0000-2000-000000000000"},
    {"ELEMENT": "43010000-0000-0000-2000-000000000000",
     "element-6066-11e4-a52e-4f735466cecf": "43010000-0000-0000-2000-000000000000"}
  ],
  "sessionId": "3EE51D1B-C14B-49F3-BDD7-4C1C0F19E2D5"
}
```

**Confirms:**
- W3C-standard element ID key is `element-6066-11e4-a52e-4f735466cecf` (B3 parses this).
- Multi-match returns array in tree order — B3's first-match rule uses `value[0]`.
- `ELEMENT` is a legacy alias (safe to ignore).

### `POST /elements` with `using: "name"` (no match)

```bash
POST /session/:sid/elements  {"using": "name", "value": "NonExistentElementForProbe"}
```

Response:

```json
{"value": [], "sessionId": "..."}  // HTTP 200
```

**Confirms:** zero-match returns `value: []` + HTTP 200 (NOT 404). B3's R3 zero-match logic checks `value.length === 0`, not HTTP status.

### `POST /elements` with `using: "predicate string"` (no match)

```bash
POST /session/:sid/elements  {"using": "predicate string", "value": "label CONTAINS[c] \"none-exist\""}
```

Response: `{"value": [], "sessionId": "..."}` + HTTP 200.

**Confirms:** predicate-string is valid on WDA 11.1.5. Good signal for V1.1 `text` selector work.

## Critical security finding — WDA binds non-loopback

The host's WDA processes are reachable on the public/en0 interface IP, not just `127.0.0.1`:

```bash
$ curl http://185.255.127.52:8408/status   # en0 IP, not 127.0.0.1
HTTP 200
{"value": {..., "state": "success", "ready": true}, "sessionId": "..."}
```

en0 ifconfig: `inet 185.255.127.52 netmask 0xffffff00 broadcast 185.255.127.255`

**Implication:**
- BS's edge firewall likely blocks external traffic to port 8408 (I cannot verify from off-host), but the WDA listener itself is NOT bound to loopback-only.
- **R6's runtime "refuse non-loopback" check is not paranoid — it is load-bearing.** A URL-override bug, a typo, or a future realmobile rewrite of the port-discovery contract could expose us to cross-tenant attack on the same host (where co-tenant processes share en0).
- B3's `url.construct('http://127.0.0.1:<port>/…')` pattern + explicit `'loopback-required'` refusal for non-loopback addresses is the correct defense.
- This finding STRENGTHENS the case for realmobile cooperation on `wda-meta.json`: we cannot trust `ps aux` or any network scan to give us an attested-authentic session port.

## Plan implications

### Validated

- R4 primary scale-factor path (`GET /wda/screen` → `{scale, screenSize, statusBarSize}`) — **ships as specified.**
- Plan's two-tier landscape decision: primary signal is `GET /session/:sid/orientation` (plain string), simpler than `/wda/screen` if we only need orientation. Recommend B4 use `/session/:sid/orientation` as primary and reserve `/wda/screen` for scale-factor warm-up.
- B3 selector-resolution path (`POST /elements` → `value: [...]`, take `value[0]`) works against real WDA 11.1.5.
- Predicate-string selector (V1.1 `text`) is supported by this WDA build.
- Zero-match returns empty array + 200, not 404 — B3 checks array length.

### Needed before Phase 1 can commit the resolution path (A1 not fully done)

- **Cross-model scale validation.** All 5 sampled devices are iPhone 14-class (scale=3). Need ≥1 scale=2 device (iPhone SE 3rd gen, older Pad, etc.) to confirm `scale` comes back as integer `2` and not `2.0` or some other representation. Either: (a) access a different BS iOS host with scale=2 hardware, (b) relax the plan to trust Apple's `{2, 3}` invariant without on-device validation.
- **Selector semantics (Probe 3).** Needs a controlled test app where `accessibilityIdentifier ≠ visible label` to assert `using: 'name'` matches the identifier, not the label. Cannot be done with co-tenant apps on this host (we don't know their accessibility setup).
- **Concurrent-safety probes (Probes 1, 2).** Need an ACTIVE Maestro `maestro test` flow running against one of these devices so we can inject concurrent `POST /elements` / `GET /source` calls mid-flow. Cannot be done without launching a BS Maestro build targeting this host.
- **Rect-to-screenshot temporal alignment (Probe 4).** Needs a scrolling flow in a controlled app.
- **Portrait aspect-ratio distribution (Probe 6).** Needs screenshot-capture access across modal/keyboard/Split-View states. Deferred — if Probe 5's `/session/:sid/orientation` is reliable in concurrent-safety probes, the aspect-ratio fallback may be droppable entirely (per Key Decisions).

### Clean wins

| R-plan item | Status |
|---|---|
| R6 loopback-only enforcement is load-bearing (non-loopback is reachable) | **Validated** |
| Plan's R8 rejection of `GET /sessions` as session-discovery mechanism | **Validated** (endpoint 404s) |
| R4 `/wda/screen` integer-scale response shape | **Validated** on iPhone 14 class |
| realmobile-cooperation is the only secure R8 path | **Reinforced** by Probe 5's R8 finding |
| B3 W3C element-ID key `element-6066-11e4-a52e-4f735466cecf` | **Validated** |
| B3 zero-match check is `value.length === 0`, not HTTP 404 | **Validated** |

## Next work to complete A1

1. Launch a BS Maestro build against this host to enable Probes 1, 2, 4 (concurrent-safety + rect alignment).
2. Build or obtain a test iOS IPA where `accessibilityIdentifier ≠ label` for ≥2 elements (Probe 3).
3. Access a scale=2 BS iOS host, or explicitly accept the `{2,3}` invariant as an untested assumption with a fail-closed runtime guard (R4 already specifies this via the `[1.9, 3.1]` range check).
