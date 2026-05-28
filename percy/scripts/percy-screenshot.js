// percy-screenshot.js
// Upload a screenshot to Percy CLI via the /percy/maestro-screenshot relay endpoint.
// Percy CLI finds the screenshot file on disk and handles all file I/O.
// Requires: SCREENSHOT_NAME env var (from YAML sub-flow)
//           PERCY_SESSION_ID env var (injected by BrowserStack maestro_runner.rb)
//
// Self-initializes Percy on first call: if `output.percyEnabled` is undefined,
// runs the healthcheck inline and caches the result. This makes the explicit
// `- runFlow: percy/flows/percy-init.yaml` step optional. Subsequent screenshots
// in the same flow short-circuit on the cached `output.percyEnabled` value.

function runPercyHealthcheckInline() {
  function logDisabledBanner(detailLine) {
    console.log("[percy] ===============================================================");
    console.log("[percy]  DISABLED — this build will have zero Percy screenshot coverage");
    console.log("[percy]  " + detailLine);
    console.log("[percy]  See: https://www.browserstack.com/docs/percy/integrate/overview");
    console.log("[percy] ===============================================================");
  }

  try {
    if (maestro.platform !== "android" && maestro.platform !== "ios") {
      console.log("[percy] Percy Maestro SDK supports Android and iOS only. Disabling Percy.");
      output.percyEnabled = false;
      return;
    }

    // Default kept as `percy.cli:5338` for strict BS R7 (BS host configures
    // `percy.cli` as a DNS alias routed via privoxy). PERCY_SERVER_ADDRESS is
    // exported by `percy app:exec` for self-hosted; PERCY_SERVER (explicit)
    // wins over both.
    var hcServer = "http://percy.cli:5338";
    if (typeof PERCY_SERVER_ADDRESS !== "undefined" && PERCY_SERVER_ADDRESS) {
      hcServer = PERCY_SERVER_ADDRESS;
    }
    if (typeof PERCY_SERVER !== "undefined" && PERCY_SERVER) {
      hcServer = PERCY_SERVER;
    }

    var hcResponse = http.get(hcServer + "/percy/healthcheck");

    if (hcResponse.ok) {
      var coreVersion = hcResponse.headers["x-percy-core-version"];
      if (coreVersion) {
        console.log("[percy] Percy CLI healthcheck passed. Core version: " + coreVersion);
      } else {
        console.log("[percy] Percy CLI healthcheck passed.");
      }
      output.percyEnabled = true;
      output.percyServer = hcServer;
      output.percyCoreVersion = coreVersion || "";
    } else {
      var status = parseInt(hcResponse.status) || 0;
      if (status >= 400 && status < 500) {
        logDisabledBanner("Percy CLI reachable at " + hcServer + " but rejected the request (status " + status + ")");
      } else if (status >= 500) {
        logDisabledBanner("Percy CLI error (server-side, status " + status + " at " + hcServer + ")");
      } else {
        logDisabledBanner("Percy CLI healthcheck returned unexpected status " + status + " at " + hcServer);
      }
      output.percyEnabled = false;
    }
  } catch (hcError) {
    var failedServer = (typeof hcServer !== "undefined" && hcServer) ? hcServer : "http://percy.cli:5338";
    logDisabledBanner("Percy CLI is not reachable at " + failedServer + " (" + hcError + ")");
    output.percyEnabled = false;
  }
}

try {
  if (typeof output.percyEnabled === "undefined") {
    runPercyHealthcheckInline();
  }

  if (!output.percyEnabled) {
    var skipName = (typeof SCREENSHOT_NAME !== "undefined" && SCREENSHOT_NAME) ? SCREENSHOT_NAME : "(unnamed)";
    console.log("[percy] SKIPPED snapshot \"" + skipName + "\" — Percy disabled (see [percy] DISABLED banner above)");
  } else {
    var percyServer = output.percyServer || "http://percy.cli:5338";

    // Validate required inputs
    if (typeof SCREENSHOT_NAME === "undefined" || !SCREENSHOT_NAME) {
      throw new Error("SCREENSHOT_NAME is required");
    }
    // Validate the screenshot name. The Percy CLI relay enforces
    // /^[a-zA-Z0-9_-]+$/ on the `name` field. Maestro's `takeScreenshot:` step
    // (which ran before this script) writes the file as `<name>.png` using the
    // raw name — so silently sanitizing here would create a file/payload
    // mismatch and the relay would not find the file. Failing fast with a
    // clear error gives the customer something they can act on.
    if (!/^[a-zA-Z0-9_-]+$/.test(SCREENSHOT_NAME)) {
      throw new Error("[percy] SCREENSHOT_NAME must match [a-zA-Z0-9_-]+ (alphanumeric, underscore, hyphen). Got: \"" + SCREENSHOT_NAME + "\"");
    }
    // Build the request payload. `sessionId` is BrowserStack-host-injected
    // (PERCY_SESSION_ID) and identifies the BS session for the relay's
    // /tmp/{sessionId}{_test_suite} file-find. Its absence is the
    // self-hosted detection signal on the relay — earlier SDK versions
    // hard-required it and skipped the upload; that gate is removed so
    // self-hosted runs upload against a self-hosted-aware relay
    // (PERCY_MAESTRO_SCREENSHOT_DIR-scoped). Bare `{ ... }` block preserves
    // the original indentation through the rest of the payload build.
    {
      var payload = {
        name: SCREENSHOT_NAME
      };
      if (typeof PERCY_SESSION_ID !== "undefined" && PERCY_SESSION_ID) {
        payload.sessionId = PERCY_SESSION_ID;
      }

      // Add optional tag metadata if available
      var tag = { name: "Unknown Device" };
      if (typeof PERCY_DEVICE_NAME !== "undefined" && PERCY_DEVICE_NAME) {
        tag.name = PERCY_DEVICE_NAME;
      }
      tag.osName = maestro.platform === "ios" ? "iOS" : "Android";
      if (typeof PERCY_OS_VERSION !== "undefined" && PERCY_OS_VERSION) {
        tag.osVersion = PERCY_OS_VERSION;
      }
      if (typeof PERCY_SCREEN_WIDTH !== "undefined" && PERCY_SCREEN_WIDTH) {
        var w = parseInt(PERCY_SCREEN_WIDTH);
        if (!isNaN(w)) tag.width = w;
      }
      if (typeof PERCY_SCREEN_HEIGHT !== "undefined" && PERCY_SCREEN_HEIGHT) {
        var h = parseInt(PERCY_SCREEN_HEIGHT);
        if (!isNaN(h)) tag.height = h;
      }
      // Note: tag.width / tag.height left undefined here are filled in by the
      // Percy CLI relay from the screenshot PNG header bytes (see the
      // /percy/maestro-screenshot handler). The PNG is the authoritative
      // source for screen dimensions. Customers don't need to set
      // PERCY_SCREEN_WIDTH / PERCY_SCREEN_HEIGHT for this to work.
      if (typeof PERCY_ORIENTATION !== "undefined" && PERCY_ORIENTATION) {
        tag.orientation = PERCY_ORIENTATION;
      }
      payload.tag = tag;

      // Add optional fields
      if (typeof PERCY_TEST_CASE !== "undefined" && PERCY_TEST_CASE) {
        payload.testCase = PERCY_TEST_CASE;
      }
      if (typeof PERCY_LABELS !== "undefined" && PERCY_LABELS) {
        payload.labels = PERCY_LABELS;
      }

      // Regions — element-based or coordinate-based (parsed from JSON env var)
      if (typeof PERCY_REGIONS !== "undefined" && PERCY_REGIONS) {
        try {
          var parsedRegions = json(PERCY_REGIONS);
          if (parsedRegions && parsedRegions.length) {
            var validRegions = [];
            for (var ri = 0; ri < parsedRegions.length; ri++) {
              var region = parsedRegions[ri];
              // Element-based region: forward to the CLI relay, which resolves
              // the selector to a pixel bbox per-platform (Maestro hierarchy
              // on both Android and iOS). Shape validation + zero-match
              // warn-skip are the relay's responsibility — one source of truth.
              if (region.element) {
                validRegions.push(region);
              // Coordinate-based region: must have numeric top/bottom/left/right
              } else if (region.top != null && region.bottom != null && region.left != null && region.right != null) {
                var t = parseInt(region.top);
                var b = parseInt(region.bottom);
                var l = parseInt(region.left);
                var r = parseInt(region.right);
                if (isNaN(t) || isNaN(b) || isNaN(l) || isNaN(r)) {
                  console.log("[percy] Warning: skipping region with non-numeric coordinates");
                } else if (b <= t || r <= l) {
                  console.log("[percy] Warning: skipping region (bottom must be > top, right must be > left)");
                } else {
                  var coordRegion = { top: t, bottom: b, left: l, right: r, algorithm: region.algorithm || "ignore" };
                  if (region.configuration) coordRegion.configuration = region.configuration;
                  if (region.padding) coordRegion.padding = region.padding;
                  if (region.assertion) coordRegion.assertion = region.assertion;
                  validRegions.push(coordRegion);
                }
              } else {
                console.log("[percy] Warning: skipping invalid region (needs element selector or coordinates)");
              }
            }
            if (validRegions.length > 0) {
              payload.regions = validRegions;
            }
          }
        } catch (regionsError) {
          console.log("[percy] Warning: invalid PERCY_REGIONS JSON, skipping regions");
        }
      }

      // Ignore regions — parity with appium-python kwarg ignore_regions_*.
      // Each item is the SAME shape as PERCY_REGIONS (coordinate or element);
      // algorithm is implicit ('ignore'). Emits to the cli relay's
      // ignoreRegions[] input, which forwards to
      // payload.ignoredElementsData.ignoreElementsData[] on the comparison.
      if (typeof PERCY_IGNORE_REGIONS !== "undefined" && PERCY_IGNORE_REGIONS) {
        try {
          var parsedIgnore = json(PERCY_IGNORE_REGIONS);
          if (parsedIgnore && parsedIgnore.length) {
            payload.ignoreRegions = parsedIgnore;
          }
        } catch (igErr) {
          console.log("[percy] Warning: invalid PERCY_IGNORE_REGIONS JSON, skipping");
        }
      }

      // Consider regions — parity with appium-python consider_regions_*.
      if (typeof PERCY_CONSIDER_REGIONS !== "undefined" && PERCY_CONSIDER_REGIONS) {
        try {
          var parsedConsider = json(PERCY_CONSIDER_REGIONS);
          if (parsedConsider && parsedConsider.length) {
            payload.considerRegions = parsedConsider;
          }
        } catch (coErr) {
          console.log("[percy] Warning: invalid PERCY_CONSIDER_REGIONS JSON, skipping");
        }
      }

      // Sync mode
      if (typeof PERCY_SYNC !== "undefined" && PERCY_SYNC && String(PERCY_SYNC).toLowerCase() === "true") {
        payload.sync = true;
        console.log("[percy] Sync mode enabled");
      }

      // Tile metadata — system-chrome masking.
      //
      // Values are in IMAGE PIXELS (the unit Percy's comparison tile expects),
      // not in points / dp. Other Percy mobile SDKs that have access to the
      // device scale factor multiply their point-unit lookup tables at runtime:
      //   percy-xcui-swift  → `mapToDeviceStatusBar(...) * UIScreen.main.scale`
      //   percy-espresso-java → `Resources.getDimensionPixelSize(...)`
      //   percy-appium-python → reads pixel-unit `viewportRect` from the driver
      //
      // GraalJS-inside-Maestro can't reach `UIScreen.main.scale` or
      // `DisplayMetrics.density`, so we ship platform-typical pixel constants
      // sized for the most common BS App Automate device tiers. The constants
      // are intentionally CONSERVATIVE — better to leave a thin sliver of the
      // status bar visible in the diff than to mask actual app content.
      //
      //   iOS:     iPhone 12 / 13 / 14 (3x scale) is the dominant test target;
      //            the dynamic clock/signal-icon glyphs sit at y = [50, 83]
      //            empirically. 100 covers the changing chrome with room to
      //            spare. iPhone 11 (2x, status bar 88 px) overflows by 12 px
      //            into the safe-area; most apps absorb that without visible
      //            content loss. Dynamic Island devices (iPhone 14 Pro+, status
      //            bar 162 px) and iPhone SE (status 40 px) should override
      //            PERCY_STATUS_BAR_HEIGHT for an exact safe-area fit.
      //            Nav bar 80 covers the iPhone 11 home indicator (34pt × 2 =
      //            68 px) with the same 12-px overflow margin used on
      //            statusBar. iPhone 12+ home indicator is 34pt × 3 = 102 px;
      //            a thin ~22 px sliver may remain — acceptable since the
      //            indicator itself isn't dynamic content. iPad and iPhone SE
      //            (no home indicator) should override PERCY_NAV_BAR_HEIGHT="0".
      //   Android: Pixel-class at 3x density (24dp status bar ≈ 72 px → 80 px
      //            covers comfortably). Bumped to 120 (2026-05-28) for newer
      //            Pixel-class devices at higher resolutions (e.g. Pixel 10 Pro
      //            at 1280×2856) where the status-bar chrome — clock, status
      //            icons, camera punch-hole — extends past 80 px and otherwise
      //            shows up as a strip diff between baseline and head. 120
      //            balances coverage on modern high-DPI Pixels with a thin
      //            sliver margin on 1080p Samsung / Pixel 6-8 tiers; very
      //            tall status bars on 1280p+ devices may still need an
      //            override. Nav bar 100 covers gesture-nav. 3-button-nav
      //            devices (48dp ≈ 144 px) need override to ~144.
      //
      // Customer env vars PERCY_STATUS_BAR_HEIGHT / PERCY_NAV_BAR_HEIGHT always
      // override the defaults below.
      payload.statusBarHeight = maestro.platform === "ios" ? 100 : 120;
      payload.navBarHeight    = maestro.platform === "ios" ? 80  : 100;

      if (typeof PERCY_STATUS_BAR_HEIGHT !== "undefined" && PERCY_STATUS_BAR_HEIGHT) {
        var sbh = parseInt(PERCY_STATUS_BAR_HEIGHT);
        if (!isNaN(sbh)) payload.statusBarHeight = sbh;
      }
      if (typeof PERCY_NAV_BAR_HEIGHT !== "undefined" && PERCY_NAV_BAR_HEIGHT) {
        var nbh = parseInt(PERCY_NAV_BAR_HEIGHT);
        if (!isNaN(nbh)) payload.navBarHeight = nbh;
      }
      if (typeof PERCY_FULLSCREEN !== "undefined" && PERCY_FULLSCREEN && String(PERCY_FULLSCREEN).toLowerCase() === "true") {
        payload.fullscreen = true;
      }

      // Test harness execution ID
      if (typeof PERCY_TH_TEST_CASE_EXECUTION_ID !== "undefined" && PERCY_TH_TEST_CASE_EXECUTION_ID) {
        payload.thTestCaseExecutionId = PERCY_TH_TEST_CASE_EXECUTION_ID;
      }

      payload.platform = maestro.platform;
      payload.clientInfo = "percy-maestro-app/1.0.0-beta.4";
      payload.environmentInfo = "percy-maestro";

      // POST to the relay endpoint — Percy CLI reads the file from disk
      console.log("[percy] Uploading: " + SCREENSHOT_NAME);
      var response = http.post(percyServer + "/percy/maestro-screenshot", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        var body = json(response.body);
        if (body && body.data) {
          // Sync mode response — log comparison details
          console.log("[percy] Sync result: " + JSON.stringify(body.data));
        } else if (body && body.link) {
          console.log("[percy] Done: " + body.link);
        } else {
          console.log("[percy] Screenshot '" + SCREENSHOT_NAME + "' uploaded.");
        }
      } else {
        console.log("[percy] Upload failed: " + response.status + " " + response.body);
      }
    }
  }
} catch (error) {
  console.log("[percy] Error: " + error);
}
