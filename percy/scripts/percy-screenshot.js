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

    var hcServer = "http://percy.cli:5338";
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
    if (typeof PERCY_SESSION_ID === "undefined" || !PERCY_SESSION_ID) {
      console.log("[percy] PERCY_SESSION_ID not set — cannot upload screenshot. Is appPercy enabled?");
    } else {
      // Build the request payload — just name + session ID
      // Percy CLI handles finding the file, reading, base64-encoding
      var payload = {
        name: SCREENSHOT_NAME,
        sessionId: PERCY_SESSION_ID
      };

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

      // Sync mode
      if (typeof PERCY_SYNC !== "undefined" && PERCY_SYNC && String(PERCY_SYNC).toLowerCase() === "true") {
        payload.sync = true;
        console.log("[percy] Sync mode enabled");
      }

      // Tile metadata
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
      payload.clientInfo = "percy-maestro-app/1.0.0-beta.2";
      payload.environmentInfo = "percy-maestro";

      // filePath: forward the absolute path set by percy-prepare-screenshot.js
      // when the running CLI supports it. The flag is set in prepare; this
      // script only reads it. Older CLIs that don't recognise filePath fall
      // through to the legacy glob — but in that case prepare leaves
      // percyUsesFilePath false, so we omit the field entirely.
      // Append `.png` here because percyScreenshotPath omits the extension
      // (Maestro's takeScreenshot: auto-appends it, so prepare leaves it
      // off to avoid `<name>.png.png` on disk).
      if (output.percyUsesFilePath && output.percyScreenshotPath) {
        payload.filePath = output.percyScreenshotPath + ".png";
      }

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
