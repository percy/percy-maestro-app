// percy-healthcheck.js
// Run once at the start of a Maestro flow to verify Percy CLI availability.
// Sets output.percyEnabled = true/false for downstream scripts.
//
// On failure, emits a loud multi-line banner so the silent-failure mode
// (Percy disabled without the user noticing) is visible in Maestro stdout.

function logDisabledBanner(detailLine) {
  console.log("[percy] ===============================================================");
  console.log("[percy]  DISABLED — this build will have zero Percy screenshot coverage");
  console.log("[percy]  " + detailLine);
  console.log("[percy]  See: https://www.browserstack.com/docs/percy/integrate/overview");
  console.log("[percy] ===============================================================");
}

try {
  if (maestro.platform !== "android" && maestro.platform !== "ios") {
    // Unsupported-platform path: keep the existing concise message.
    // Do NOT emit the DISABLED banner — this is a configuration issue
    // (web Maestro is not supported), not a runtime failure.
    console.log("[percy] Percy Maestro SDK supports Android and iOS only. Disabling Percy.");
    output.percyEnabled = false;
  } else {
    var percyServer = "http://percy.cli:5338";
    if (typeof PERCY_SERVER !== "undefined" && PERCY_SERVER) {
      percyServer = PERCY_SERVER;
    }

    var response = http.get(percyServer + "/percy/healthcheck");

    if (response.ok) {
      var coreVersion = response.headers["x-percy-core-version"];
      if (coreVersion) {
        console.log("[percy] Percy CLI healthcheck passed. Core version: " + coreVersion);
      } else {
        console.log("[percy] Percy CLI healthcheck passed.");
      }
      output.percyEnabled = true;
      output.percyServer = percyServer;
      output.percyCoreVersion = coreVersion || "";
    } else {
      var status = parseInt(response.status) || 0;
      if (status >= 400 && status < 500) {
        logDisabledBanner("Percy CLI reachable at " + percyServer + " but rejected the request (status " + status + ")");
      } else if (status >= 500) {
        logDisabledBanner("Percy CLI error (server-side, status " + status + " at " + percyServer + ")");
      } else {
        logDisabledBanner("Percy CLI healthcheck returned unexpected status " + status + " at " + percyServer);
      }
      output.percyEnabled = false;
    }
  }
} catch (error) {
  // Connection refused, DNS failure, timeout, or any JS runtime error land here.
  var failedServer = (typeof percyServer !== "undefined" && percyServer) ? percyServer : "http://percy.cli:5338";
  logDisabledBanner("Percy CLI is not reachable at " + failedServer + " (" + error + ")");
  output.percyEnabled = false;
}
