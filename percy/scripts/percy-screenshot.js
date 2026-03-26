// percy-screenshot.js
// Upload a screenshot to Percy CLI via multipart POST.
// Expects output.percyEnabled to be set by percy-healthcheck.js.
// Requires SCREENSHOT_NAME and SCREENSHOT_PATH env vars.

try {
  // Skip silently if Percy is not enabled
  if (!output.percyEnabled) {
    // Percy is disabled or healthcheck failed; skip silently
  } else {
    // Determine Percy server address
    var percyServer = "http://percy.cli:5338";
    if (typeof PERCY_SERVER !== "undefined" && PERCY_SERVER) {
      percyServer = PERCY_SERVER;
    }

    // Validate required inputs
    if (typeof SCREENSHOT_NAME === "undefined" || !SCREENSHOT_NAME) {
      throw new Error("SCREENSHOT_NAME is required but not defined");
    }
    if (typeof SCREENSHOT_PATH === "undefined" || !SCREENSHOT_PATH) {
      throw new Error("SCREENSHOT_PATH is required but not defined");
    }
    if (!SCREENSHOT_PATH.endsWith(".png")) {
      throw new Error("SCREENSHOT_PATH must end with .png");
    }
    // Validate SCREENSHOT_NAME doesn't contain path traversal (user-controlled input)
    if (SCREENSHOT_NAME.indexOf("..") !== -1 || SCREENSHOT_NAME.indexOf("/") !== -1) {
      throw new Error("SCREENSHOT_NAME must not contain '..' or '/'");
    }

    // Read optional device metadata
    var deviceName = "Unknown Device";
    if (typeof PERCY_DEVICE_NAME !== "undefined" && PERCY_DEVICE_NAME) {
      deviceName = PERCY_DEVICE_NAME;
    }

    var osVersion = "";
    if (typeof PERCY_OS_VERSION !== "undefined" && PERCY_OS_VERSION) {
      osVersion = PERCY_OS_VERSION;
    }

    var width = 0;
    if (typeof PERCY_SCREEN_WIDTH !== "undefined" && PERCY_SCREEN_WIDTH) {
      var parsedWidth = parseInt(PERCY_SCREEN_WIDTH);
      if (isNaN(parsedWidth)) {
        console.log("[percy] Warning: PERCY_SCREEN_WIDTH is not a valid number, defaulting to 0");
      } else {
        width = parsedWidth;
      }
    }

    var height = 0;
    if (typeof PERCY_SCREEN_HEIGHT !== "undefined" && PERCY_SCREEN_HEIGHT) {
      var parsedHeight = parseInt(PERCY_SCREEN_HEIGHT);
      if (isNaN(parsedHeight)) {
        console.log("[percy] Warning: PERCY_SCREEN_HEIGHT is not a valid number, defaulting to 0");
      } else {
        height = parsedHeight;
      }
    }

    var orientation = "portrait";
    if (typeof PERCY_ORIENTATION !== "undefined" && PERCY_ORIENTATION) {
      orientation = PERCY_ORIENTATION;
    }

    // Build multipart form data
    var formData = {
      "screenshot": { "filePath": SCREENSHOT_PATH, "mediaType": "image/png" },
      "name": SCREENSHOT_NAME,
      "tag": JSON.stringify({
        name: deviceName,
        osName: "Android",
        osVersion: osVersion,
        width: width,
        height: height,
        orientation: orientation
      }),
      "clientInfo": "percy-maestro/0.1.0",
      "environmentInfo": "percy-maestro"
    };

    // Add optional fields only if defined
    if (typeof PERCY_TEST_CASE !== "undefined" && PERCY_TEST_CASE) {
      formData["testCase"] = PERCY_TEST_CASE;
    }
    if (typeof PERCY_LABELS !== "undefined" && PERCY_LABELS) {
      formData["labels"] = PERCY_LABELS;
    }

    // Upload to Percy CLI
    var response = http.post(percyServer + "/percy/comparison/upload", { multipartForm: formData });

    if (response.ok) {
      var body = json(response.body);
      if (body && body.link) {
        console.log("[percy] Screenshot uploaded: " + body.link);
      } else {
        console.log("[percy] Screenshot '" + SCREENSHOT_NAME + "' uploaded successfully.");
      }
    } else {
      console.log("[percy] Screenshot upload failed with status: " + response.status);
    }
  }
} catch (error) {
  console.log("[percy] Error: " + error);
}
