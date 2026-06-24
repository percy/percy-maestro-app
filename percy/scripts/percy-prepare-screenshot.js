// percy-prepare-screenshot.js
// Runs immediately BEFORE the `takeScreenshot:` step inside the
// percy-screenshot subflow. Sets `output.percyScreenshotPath` to the
// bare relative SCREENSHOT_NAME so Maestro writes the file under the
// runner-injected SCREENSHOTS_DIR, where the CLI relay's legacy glob
// finds it.
//
// Sets one output variable consumed by the rest of the subflow:
//   output.percyScreenshotPath - the value passed to `takeScreenshot:`.
//                                Always set, even on disabled / error
//                                paths, so `${percyScreenshotPath}`
//                                interpolation in the YAML never fails.
//
// Self-initialises Percy on first call (same shape as the inline
// healthcheck in percy-screenshot.js) so the customer-facing flow is
// callable without an explicit percy-init step.

function logDisabledBanner(detailLine) {
  console.log("[percy] ===============================================================");
  console.log("[percy]  DISABLED — this build will have zero Percy screenshot coverage");
  console.log("[percy]  " + detailLine);
  console.log("[percy]  See: https://www.browserstack.com/docs/percy/integrate/overview");
  console.log("[percy] ===============================================================");
}

function runPercyHealthcheckInline() {
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
  // Always-set default so YAML `${percyScreenshotPath}` interpolation has a
  // valid value even on disabled / error paths. The relative SCREENSHOT_NAME
  // makes Maestro write to <SCREENSHOTS_DIR>/<NAME>.png — the layout the CLI
  // relay's legacy glob expects on both Android and iOS.
  var fallbackName = (typeof SCREENSHOT_NAME !== "undefined" && SCREENSHOT_NAME) ? SCREENSHOT_NAME : "percy-screenshot";
  output.percyScreenshotPath = fallbackName;

  if (typeof output.percyEnabled === "undefined") {
    runPercyHealthcheckInline();
  }
} catch (error) {
  // Never fail the customer's Maestro flow because of Percy bookkeeping.
  // The fallback path is already set above, so takeScreenshot still runs.
  console.log("[percy] prepare-screenshot error: " + error);
}
