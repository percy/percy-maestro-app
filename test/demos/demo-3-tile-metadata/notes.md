# Demo 3 — Tile Metadata

**Caption:** `ChromeMasked` suppresses status-bar drift that `ChromeUnmasked` flags; `ChromeFullscreen` is a forwarding-only check.

**Plan:** `docs/plans/2026-04-22-001-feat-tile-and-test-metadata-demos-plan.md`

## Customer-facing takeaway

"Your Android tests trip on status-bar drift every time a notification icon changes or the clock ticks. Set `PERCY_STATUS_BAR_HEIGHT` to your device's status-bar height (and `PERCY_NAV_BAR_HEIGHT` for the nav bar); that noise stops counting as a diff. The `ChromeUnmasked` snapshot shows the drift Percy would flag by default. The `ChromeMasked` snapshot shows the same pixel drift suppressed by the ignore band. Same mechanism works for nav bar cropping."

## Percy branch and commits

Both runs share one Percy branch so Run 2 pairs against Run 1:

| Run | `PERCY_BRANCH` | `PERCY_TARGET_BRANCH` | `PERCY_COMMIT` |
|---|---|---|---|
| Run 1 (baseline) | `percy-demo-d3-tile-20260422-d3b00000` | `percy-demo-d3-tile-20260422-d3b00000` | `d3b0000000000000000000000000000000aaaaaa` |
| Run 2 (compare) | `percy-demo-d3-tile-20260422-d3b00000` | `percy-demo-d3-tile-20260422-d3b00000` | `d3c0000000000000000000000000000000bbbbbb` |

The `-d3b00000` suffix on the branch name is the first 8 hex of Run 1's commit and isolates this demo pair from any concurrent operator running their own Demo 3 (Percy's pairing has no commit affinity — see Risk 7 in the plan).

**Pre-dispatch validation** (run before each BS POST):

```bash
for c in d3b0000000000000000000000000000000aaaaaa \
         d3c0000000000000000000000000000000bbbbbb; do
  echo "$c" | grep -qE '^[0-9a-f]{40}$' && echo "OK $c" || echo "FAIL $c"
done
```

Any `FAIL` would abort the compare leg mid-build (Percy validates against `/\A[0-9a-f]{40}\z/`, per `percy-api/app/models/percy/commit.rb:10`).

## Chrome-drift mechanism (between Run 1 and Run 2)

Primary technique (per Unit 1's on-host spike; update after spike results land):

```bash
SERIAL=28201FDH300J1S

# Restore-on-exit trap — guarantees airplane mode is disabled even if the
# script or SSH session dies between dispatch and cleanup.
trap 'adb -s $SERIAL shell cmd connectivity airplane-mode disable || true' EXIT INT TERM

# Backstop: 30-min at-scheduled restore so a dropped SSH still recovers.
echo "adb -s $SERIAL shell cmd connectivity airplane-mode disable" | at now + 30 minutes

# Enable between Run 1 finalize and Run 2 dispatch
adb -s $SERIAL shell cmd connectivity airplane-mode enable
```

**Do not use `swipeDown`** — it produces drift outside the 200-px ignore band (in the app body), which `ChromeMasked` does NOT suppress. That would invert the demo's thesis.

**Fallbacks if airplane-mode fails** (picked during Unit 1 spike):
- `adb -s $SERIAL shell svc wifi disable` / `svc wifi enable`
- `adb -s $SERIAL shell cmd statusbar disable NOTIFICATION_ICONS` / `disable NONE`

## Drift-detection dry run (before Run 2 dispatch)

Confirm the drift is non-empty and localized to the status bar *before* burning a BS compare-leg dispatch. Capture before/after and pixel-diff the top 200-px band; use the first available tool:

```bash
adb -s 28201FDH300J1S exec-out screencap -p > /tmp/before.png
# ... enable airplane mode ...
adb -s 28201FDH300J1S exec-out screencap -p > /tmp/after.png

# 1. ImageMagick compare (usually NOT on Nix-managed BS hosts):
compare -metric AE -extract 1080x200+0+0 /tmp/before.png /tmp/after.png null: 2>&1
# Expected: non-zero pixel count

# 2. Python + Pillow (usually present):
python3 -c "
from PIL import Image, ImageChops
a = Image.open('/tmp/before.png').crop((0,0,1080,200))
b = Image.open('/tmp/after.png').crop((0,0,1080,200))
print(ImageChops.difference(a,b).getbbox())
"
# Expected: a non-None bbox tuple

# 3. scp-and-eyeball fallback:
scp -J arumulla@hop.browserstack.com:4022 \
  ritesharora@31.6.63.33:/tmp/before.png /tmp/after.png ./
open *.png
```

If the diff is empty or sub-threshold, switch to the spike's secondary technique and re-verify before Run 2.

## Dispatch

Both dispatches go through the reusable function from the overlay runbook's Layer 2 (see `percy_maestro_build` in `docs/solutions/developer-experience/percy-maestro-e2e-browserstack-host-overlay-2026-04-22.md:259-`).

Key env on `appPercy.env`:

- `PERCY_TOKEN` — the demo project's Percy token.
- `PERCY_LOGLEVEL=debug` — needed so `PERCY_FULLSCREEN` forwarding is grep-able post-run.
- `PERCY_BRANCH`, `PERCY_TARGET_BRANCH`, `PERCY_COMMIT` — per the table above.

Build-dispatch JSON `machine:` pin: `"31.6.63.33:28201FDH300J1S"`. Same app URL reused across Run 1 and Run 2 (do not re-upload between runs; prevents app-store-update-induced drift contaminating the chrome band).

## What to look at in Percy

Open the Run 2 (compare) Percy build URL. Expected:

- **`ChromeUnmasked`** — the airplane-mode icon appearing in the status bar is flagged as a diff. This is what uncropped behavior looks like: any chrome change shows up in the comparison.
- **`ChromeMasked`** — the same pixel difference is present in the tile, but the top and bottom 200-px bands are overlaid with an "ignored region" mask. The diff does not count toward the comparison. *This is the feature.*
- **`ChromeFullscreen`** — uploaded normally, no diff signal expected. Proof lives in the host CLI log (next section).

## CLI log grep (post-run)

On host `31.6.63.33`, locate the CLI log for the most recent Maestro session and confirm:

```bash
# PERCY_FULLSCREEN forwarding
grep 'fullscreen.*true' <percy.log>
# Expected: at least one line showing the outgoing payload for ChromeFullscreen
# with `fullscreen: true`
```

## Reproduction prerequisites

- Full `preflight-host.sh` passes (see runbook Pre-flight section).
- `OVERLAY_BASELINE_SHA` captured; SHA matches post-flight.
- `machine:31.6.63.33:28201FDH300J1S` pinning on both dispatches.
- Test-suite zip has a single parent folder at its root.
- Same `app_url` reused across Run 1 and Run 2.
- Chrome-drift mechanism verified via pre-dispatch `adb screencap` dry run.

## Post-flight entries (to fill in after Unit 5 runs)

| | Value |
|---|---|
| Demo 3 Run 1 — Percy build | TBD |
| Demo 3 Run 1 — BS build id | TBD |
| Demo 3 Run 1 — BS session id | TBD |
| Demo 3 Run 2 — Percy build (hero URL) | TBD |
| Demo 3 Run 2 — BS build id | TBD |
| Demo 3 Run 2 — BS session id | TBD |
| Overlay SHA before dispatch | TBD |
| Overlay SHA after dispatch (must match) | TBD |
