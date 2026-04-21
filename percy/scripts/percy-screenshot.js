// percy-screenshot.js
// Upload a screenshot to Percy CLI via the /percy/maestro-screenshot relay endpoint.
// Percy CLI finds the screenshot file on disk and handles all file I/O.
// Requires: SCREENSHOT_NAME env var (from YAML sub-flow)
//           PERCY_SESSION_ID env var (injected by BrowserStack maestro_runner.rb)

try {
  if (!output.percyEnabled) {
    console.log("[percy] Skipping screenshot — Percy is not enabled (run percy-init first)");
  } else {
    var percyServer = output.percyServer || "http://percy.cli:5338";

    // Validate required inputs
    if (typeof SCREENSHOT_NAME === "undefined" || !SCREENSHOT_NAME) {
      throw new Error("SCREENSHOT_NAME is required");
    }
    if (typeof PERCY_SESSION_ID === "undefined" || !PERCY_SESSION_ID) {
      console.log("[percy] PERCY_SESSION_ID not set — cannot upload screenshot. Is appPercy enabled?");
    } else {
      // Build the request payload — name + session ID.
      // Percy CLI handles finding the file, reading, base64-encoding.
      var payload = {
        name: SCREENSHOT_NAME,
        sessionId: PERCY_SESSION_ID
      };

      // Tag metadata (Android-only — see percy-healthcheck.js for platform gate)
      var tag = { name: "Unknown Device" };
      if (typeof PERCY_DEVICE_NAME !== "undefined" && PERCY_DEVICE_NAME) {
        tag.name = PERCY_DEVICE_NAME;
      }
      tag.osName = "Android";
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

      if (typeof PERCY_TEST_CASE !== "undefined" && PERCY_TEST_CASE) {
        payload.testCase = PERCY_TEST_CASE;
      }
      if (typeof PERCY_LABELS !== "undefined" && PERCY_LABELS) {
        payload.labels = PERCY_LABELS;
      }

      // Regions — coordinate-based (parsed from JSON env var).
      // Element-based regions need CLI-side ADB resolution (Phase 2); until then the SDK
      // warns and skips them so users get a visible signal at flow-log level.
      if (typeof PERCY_REGIONS !== "undefined" && PERCY_REGIONS) {
        try {
          var parsedRegions = json(PERCY_REGIONS);
          if (parsedRegions && parsedRegions.length) {
            var validRegions = [];
            for (var ri = 0; ri < parsedRegions.length; ri++) {
              var region = parsedRegions[ri];
              if (region.element) {
                console.log("[percy] Warning: element-based regions are not yet supported, skipping. Use coordinate-based regions instead.");
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

      if (typeof PERCY_SYNC !== "undefined" && PERCY_SYNC === "true") {
        payload.sync = true;
        console.log("[percy] Sync mode enabled");
      }

      if (typeof PERCY_STATUS_BAR_HEIGHT !== "undefined" && PERCY_STATUS_BAR_HEIGHT) {
        var sbh = parseInt(PERCY_STATUS_BAR_HEIGHT);
        if (!isNaN(sbh)) payload.statusBarHeight = sbh;
      }
      if (typeof PERCY_NAV_BAR_HEIGHT !== "undefined" && PERCY_NAV_BAR_HEIGHT) {
        var nbh = parseInt(PERCY_NAV_BAR_HEIGHT);
        if (!isNaN(nbh)) payload.navBarHeight = nbh;
      }
      if (typeof PERCY_FULLSCREEN !== "undefined" && PERCY_FULLSCREEN === "true") {
        payload.fullscreen = true;
      }

      if (typeof PERCY_TH_TEST_CASE_EXECUTION_ID !== "undefined" && PERCY_TH_TEST_CASE_EXECUTION_ID) {
        payload.thTestCaseExecutionId = PERCY_TH_TEST_CASE_EXECUTION_ID;
      }

      payload.platform = "android";
      payload.clientInfo = "percy-maestro-android/0.3.0";
      payload.environmentInfo = "percy-maestro";

      console.log("[percy] Uploading: " + SCREENSHOT_NAME);
      var response = http.post(percyServer + "/percy/maestro-screenshot", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        var body = json(response.body);
        if (body && body.data) {
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
