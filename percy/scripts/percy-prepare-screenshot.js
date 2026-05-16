// percy-prepare-screenshot.js
// Runs immediately BEFORE the `takeScreenshot:` step inside the
// percy-screenshot subflow. Decides where Maestro should save the
// screenshot — either an absolute path the SDK owns (new path, used when
// the running Percy CLI supports the /percy/maestro-screenshot `filePath`
// field) or the legacy relative SCREENSHOT_NAME (back-compat for older
// CLIs that still rely on the BS-infra SCREENSHOTS_DIR contract).
//
// Sets two output variables consumed by the rest of the subflow:
//   output.percyScreenshotPath  - the value passed to `takeScreenshot:`.
//                                 Always set, even on disabled / legacy
//                                 paths, so `${percyScreenshotPath}` is
//                                 never unset at interpolation time.
//   output.percyUsesFilePath    - true when the upload script should
//                                 forward the path as the `filePath`
//                                 payload field; false on legacy /
//                                 disabled paths.
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

// Returns true if the running @percy/core recognises the
// /percy/maestro-screenshot `filePath` field. Minimum: 1.31.11-beta.1
// (commit 36f9c56c — feat(core): accept optional filePath in
// /percy/maestro-screenshot relay). Unknown or malformed version strings
// degrade safely to false, keeping older customers on the legacy glob.
function coreSupportsFilePath(coreVersion) {
  if (!coreVersion || typeof coreVersion !== "string") return false;
  var v = coreVersion.replace(/^v/, "");
  var m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z][a-zA-Z0-9]*)(?:\.(\d+))?)?/);
  if (!m) return false;
  var major = parseInt(m[1]);
  var minor = parseInt(m[2]);
  var patch = parseInt(m[3]);
  var preTag = m[4];
  var preNum = m[5] ? parseInt(m[5]) : 0;

  if (major > 1) return true;
  if (major < 1) return false;
  if (minor > 31) return true;
  if (minor < 31) return false;
  if (patch > 11) return true;
  if (patch < 11) return false;
  if (!preTag) return true;                  // 1.31.11 production release
  if (preTag !== "beta") return false;       // unknown prerelease tag
  return preNum >= 1;                        // beta.1+ supports filePath
}

try {
  // Always-set defaults so YAML `${percyScreenshotPath}` interpolation has a
  // valid value even on disabled / error paths. Falling back to the raw
  // SCREENSHOT_NAME preserves the pre-existing (relative-path) behaviour.
  var fallbackName = (typeof SCREENSHOT_NAME !== "undefined" && SCREENSHOT_NAME) ? SCREENSHOT_NAME : "percy-screenshot";
  output.percyScreenshotPath = fallbackName;
  output.percyUsesFilePath = false;

  if (typeof output.percyEnabled === "undefined") {
    runPercyHealthcheckInline();
  }

  if (output.percyEnabled) {
    var canUseFilePath =
      typeof SCREENSHOT_NAME !== "undefined" && SCREENSHOT_NAME &&
      /^[a-zA-Z0-9_-]+$/.test(SCREENSHOT_NAME) &&
      typeof PERCY_SESSION_ID !== "undefined" && PERCY_SESSION_ID &&
      coreSupportsFilePath(output.percyCoreVersion);

    if (canUseFilePath) {
      // New path: SDK owns the screenshot location, under the existing BS
      // session root so cleanup is inherited.
      //   Android  → /tmp/<sid>_test_suite/percy/<name>(.png appended by Maestro)
      //   iOS      → /tmp/<sid>/percy/<name>(.png appended by Maestro)
      // Maestro's `takeScreenshot:` auto-appends `.png` — do NOT include it
      // in the path here, otherwise the file lands at `<name>.png.png`.
      // percy-screenshot.js appends `.png` when constructing the filePath
      // it sends to the CLI relay so both ends agree on the final filename.
      if (maestro.platform === "ios") {
        output.percyScreenshotPath = "/tmp/" + PERCY_SESSION_ID + "/percy/" + SCREENSHOT_NAME;
      } else {
        output.percyScreenshotPath = "/tmp/" + PERCY_SESSION_ID + "_test_suite/percy/" + SCREENSHOT_NAME;
      }
      output.percyUsesFilePath = true;
    }
    // Otherwise: stay on the SCREENSHOT_NAME fallback. The upload script
    // surfaces the specific reason (invalid name, missing session id,
    // legacy CLI) via its existing log lines — keep one source of truth.
  }
} catch (error) {
  // Never fail the customer's Maestro flow because of Percy bookkeeping.
  // The fallback path is already set above, so takeScreenshot still runs.
  console.log("[percy] prepare-screenshot error: " + error);
}
