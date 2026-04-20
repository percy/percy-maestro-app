// percy-healthcheck.js
// Run once at the start of a Maestro flow to verify Percy CLI availability.
// Sets output.percyEnabled = true/false for downstream scripts.

try {
  // Platform allowlist: android and ios. Anything else (e.g., web) disables Percy.
  if (maestro.platform !== "android" && maestro.platform !== "ios") {
    console.log("[percy] Percy Maestro SDK supports Android and iOS only. Disabling Percy.");
    output.percyEnabled = false;
  } else {
    // Determine Percy server address
    var percyServer = "http://percy.cli:5338";
    if (typeof PERCY_SERVER !== "undefined" && PERCY_SERVER) {
      percyServer = PERCY_SERVER;
    }

    // Perform healthcheck
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
      console.log("[percy] Percy CLI healthcheck failed with status: " + response.status);
      output.percyEnabled = false;
    }
  }
} catch (error) {
  console.log("[percy] Percy CLI healthcheck error: " + error);
  output.percyEnabled = false;
}
