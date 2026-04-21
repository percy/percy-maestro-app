// percy-healthcheck.js
// Run once at the start of a Maestro flow to verify Percy CLI availability.
// Sets output.percyEnabled / output.percyServer / output.percyCoreVersion
// for downstream scripts.

try {
  // Android-only enforcement
  if (maestro.platform !== "android") {
    console.log("[percy] Percy Maestro SDK (this package) only supports Android. Disabling Percy.");
    output.percyEnabled = false;
  } else {
    // Determine Percy server address
    var percyServer = "http://percy.cli:5338";
    if (typeof PERCY_SERVER !== "undefined" && PERCY_SERVER) {
      percyServer = PERCY_SERVER;
    }

    var response = http.get(percyServer + "/percy/healthcheck");

    if (response.ok) {
      var coreVersion = response.headers["x-percy-core-version"];
      if (coreVersion) {
        console.log("[percy] Percy CLI healthcheck passed. Core version: " + coreVersion + " (percy-maestro-android/0.3.0)");
      } else {
        console.log("[percy] Percy CLI healthcheck passed. (percy-maestro-android/0.3.0)");
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
