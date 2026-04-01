// percy-screenshot.js
// Upload a screenshot to Percy CLI via the /percy/maestro-screenshot relay endpoint.
// Percy CLI finds the screenshot file on disk and handles all file I/O.
// Requires: SCREENSHOT_NAME env var (from YAML sub-flow)
//           PERCY_SESSION_ID env var (injected by BrowserStack maestro_runner.rb)

try {
  if (!output.percyEnabled) {
    // Percy disabled or healthcheck failed; skip silently
  } else {
    var percyServer = output.percyServer || "http://percy.cli:5338";
    if (typeof PERCY_SERVER !== "undefined" && PERCY_SERVER) {
      percyServer = PERCY_SERVER;
    }

    // Validate required inputs
    if (typeof SCREENSHOT_NAME === "undefined" || !SCREENSHOT_NAME) {
      throw new Error("SCREENSHOT_NAME is required");
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
      var tag = {};
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

      // Add optional fields
      if (typeof PERCY_TEST_CASE !== "undefined" && PERCY_TEST_CASE) {
        payload.testCase = PERCY_TEST_CASE;
      }
      if (typeof PERCY_LABELS !== "undefined" && PERCY_LABELS) {
        payload.labels = PERCY_LABELS;
      }

      payload.clientInfo = "percy-maestro/0.1.0";
      payload.environmentInfo = "percy-maestro";

      // POST to the relay endpoint — Percy CLI reads the file from disk
      console.log("[percy] Uploading: " + SCREENSHOT_NAME);
      var response = http.post(percyServer + "/percy/maestro-screenshot", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        var body = json(response.body);
        if (body && body.link) {
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
