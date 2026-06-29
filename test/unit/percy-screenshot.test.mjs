// test/unit/percy-screenshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript, OK_RESPONSE, NOT_OK_RESPONSE, THROW } from './harness.mjs';

const SS = '/percy/maestro-screenshot';
// Derive the expected clientInfo version from package.json so this assertion
// can't go stale on a version bump (was hardcoded to 1.0.0).
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// Read the version from package.json so the clientInfo assertion tracks the
// release bump automatically and never goes stale. The shipped
// percy-screenshot.js embeds the clientInfo string as a literal (GraalJS in
// Maestro can't require package.json at runtime); the RELEASING.md "Bump
// checklist" keeps the literal and package.json in lockstep, and this test is
// the guard that they actually match.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')
);
const EXPECTED_CLIENT_INFO = 'percy-maestro-app/' + PKG.version;

// Helper: an "enabled" output so we skip self-init and go straight to the
// upload path. percyServer set so the `output.percyServer || default` reads
// the truthy side.
function enabled(server = 'http://percy.cli:5338') {
  return { percyEnabled: true, percyServer: server };
}

// Helper: run an enabled upload with a successful POST and return the parsed
// JSON payload sent to http.post, plus the raw call + logs.
function uploadWith(env, opts = {}) {
  const res = runScript('screenshot', {
    platform: opts.platform || 'android',
    output: opts.output || enabled(),
    env: Object.assign({ SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 'sess-1' }, env),
    http: { post: [opts.postResponse || OK_RESPONSE()] },
  });
  const post = res.httpCalls.post[0];
  const payload = post ? JSON.parse(post[1].body) : null;
  return { ...res, post, payload };
}

// ---------------------------------------------------------------------------
// Self-init (delegates to the inline healthcheck) — drive its branches.
// ---------------------------------------------------------------------------

test('self-init: undefined percyEnabled runs inline healthcheck (success, with version)', () => {
  const { output, httpCalls } = runScript('screenshot', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: {
      get: [OK_RESPONSE({ 'x-percy-core-version': '1.2.3' })],
      post: [OK_RESPONSE()],
    },
  });
  assert.equal(output.percyEnabled, true);
  assert.equal(output.percyCoreVersion, '1.2.3');
  assert.equal(httpCalls.get.length, 1);
  assert.equal(httpCalls.post.length, 1, 'proceeds to upload after self-init');
});

test('self-init: ok response without version header (coreVersion empty)', () => {
  const { output, logs } = runScript('screenshot', {
    platform: 'ios',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: { get: [OK_RESPONSE({})], post: [OK_RESPONSE()] },
  });
  assert.equal(output.percyCoreVersion, '');
  assert.ok(logs.some((l) => l === '[percy] Percy CLI healthcheck passed.'));
});

test('self-init: PERCY_SERVER override used for healthcheck and upload', () => {
  const { httpCalls } = runScript('screenshot', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's', PERCY_SERVER: 'http://srv:1' },
    http: { get: [OK_RESPONSE({})], post: [OK_RESPONSE()] },
  });
  assert.equal(httpCalls.get[0][0], 'http://srv:1/percy/healthcheck');
  assert.equal(httpCalls.post[0][0], 'http://srv:1' + SS);
});

test('self-init: PERCY_SERVER_ADDRESS used; PERCY_SERVER wins when both set', () => {
  const addrOnly = runScript('screenshot', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's', PERCY_SERVER_ADDRESS: 'http://addr:5' },
    http: { get: [OK_RESPONSE({})], post: [OK_RESPONSE()] },
  });
  assert.equal(addrOnly.httpCalls.get[0][0], 'http://addr:5/percy/healthcheck');
  assert.equal(addrOnly.httpCalls.post[0][0], 'http://addr:5' + SS);

  const both = runScript('screenshot', {
    platform: 'android',
    env: {
      SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's',
      PERCY_SERVER_ADDRESS: 'http://addr:5', PERCY_SERVER: 'http://explicit:6',
    },
    http: { get: [OK_RESPONSE({})], post: [OK_RESPONSE()] },
  });
  assert.equal(both.httpCalls.get[0][0], 'http://explicit:6/percy/healthcheck');
  assert.equal(both.httpCalls.post[0][0], 'http://explicit:6' + SS);
});

test('self-init: unsupported platform disables and skips upload', () => {
  const { output, httpCalls, logs } = runScript('screenshot', {
    platform: 'tvos',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
  });
  assert.equal(output.percyEnabled, false);
  assert.equal(httpCalls.post.length, 0);
  assert.ok(logs.some((l) => l.includes('SKIPPED snapshot "home"')));
});

test('self-init: 4xx disables (banner) and skips', () => {
  const { output, logs } = runScript('screenshot', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: { get: [NOT_OK_RESPONSE(401, 'no')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('rejected the request (status 401')));
});

test('self-init: 5xx disables (server-side banner) and skips', () => {
  const { output, logs } = runScript('screenshot', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: { get: [NOT_OK_RESPONSE(503, 'down')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('server-side, status 503')));
});

test('self-init: unexpected status disables (unexpected banner)', () => {
  const { output, logs } = runScript('screenshot', {
    platform: 'ios',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: { get: [NOT_OK_RESPONSE('x', '')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('unexpected status 0')));
});

test('self-init: http.get throws (server resolved) → not-reachable banner', () => {
  const { output, logs } = runScript('screenshot', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's', PERCY_SERVER: 'http://z:2' },
    http: { get: [THROW(new Error('refused'))] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('not reachable at http://z:2')));
});

test('self-init: throw before server var assigned → default-server banner', () => {
  const { output, logs } = runScript('screenshot', {
    throwOnPlatform: true,
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('not reachable at http://percy.cli:5338')));
});

// ---------------------------------------------------------------------------
// Disabled path
// ---------------------------------------------------------------------------

test('disabled (cached) with name → SKIPPED log names the snapshot', () => {
  const { httpCalls, logs } = runScript('screenshot', {
    platform: 'android',
    output: { percyEnabled: false },
    env: { SCREENSHOT_NAME: 'cart' },
  });
  assert.equal(httpCalls.post.length, 0);
  assert.equal(httpCalls.get.length, 0, 'cached → no self-init');
  assert.ok(logs.some((l) => l.includes('SKIPPED snapshot "cart"')));
});

test('disabled (cached) without name → SKIPPED log uses (unnamed)', () => {
  const { logs } = runScript('screenshot', {
    platform: 'android',
    output: { percyEnabled: false },
  });
  assert.ok(logs.some((l) => l.includes('SKIPPED snapshot "(unnamed)"')));
});

// ---------------------------------------------------------------------------
// Enabled main path: server fallback, validation, session-id guard
// ---------------------------------------------------------------------------

test('enabled with no percyServer falls back to default for upload', () => {
  const { httpCalls } = runScript('screenshot', {
    platform: 'android',
    output: { percyEnabled: true }, // no percyServer → `|| default`
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: { post: [OK_RESPONSE()] },
  });
  assert.equal(httpCalls.post[0][0], 'http://percy.cli:5338' + SS);
});

test('enabled but SCREENSHOT_NAME missing → throws, caught, logged', () => {
  const { httpCalls, logs } = runScript('screenshot', {
    platform: 'android',
    output: enabled(),
    env: { PERCY_SESSION_ID: 's' },
  });
  assert.equal(httpCalls.post.length, 0);
  assert.ok(logs.some((l) => l.includes('Error: Error: SCREENSHOT_NAME is required')));
});

test('enabled with invalid SCREENSHOT_NAME → regex throw, caught, logged', () => {
  const { httpCalls, logs } = runScript('screenshot', {
    platform: 'android',
    output: enabled(),
    env: { SCREENSHOT_NAME: 'bad name!', PERCY_SESSION_ID: 's' },
  });
  assert.equal(httpCalls.post.length, 0);
  assert.ok(logs.some((l) => l.includes('SCREENSHOT_NAME must match')));
});

test('enabled, valid name, MISSING session id → uploads as selfhosted (no session-id gate)', () => {
  // The PERCY_SESSION_ID upload gate was relaxed in 1.1.0-beta.0 (see
  // CHANGELOG "Changed" + the runtime-field plan): a missing session id no
  // longer skips the upload. The POST now fires with runtime "selfhosted" and
  // no sessionId field; the CLI relay's runtime-aware handler picks the
  // self-hosted file-find path.
  const { httpCalls } = runScript('screenshot', {
    platform: 'android',
    output: enabled(),
    env: { SCREENSHOT_NAME: 'home' },
    http: { post: [OK_RESPONSE()] },
  });
  assert.equal(httpCalls.post.length, 1, 'self-hosted upload fires without a session id');
  const payload = JSON.parse(httpCalls.post[0][1].body);
  assert.equal(payload.runtime, 'selfhosted');
  assert.equal(payload.sessionId, undefined, 'no sessionId field when PERCY_SESSION_ID absent');
});

// ---------------------------------------------------------------------------
// Payload assembly — optional fields present
// ---------------------------------------------------------------------------

test('android default tag/name/dimensions when env vars absent', () => {
  const { payload } = uploadWith({}, { platform: 'android' });
  assert.equal(payload.name, 'home');
  assert.equal(payload.sessionId, 'sess-1');
  assert.equal(payload.tag.name, 'Unknown Device');
  assert.equal(payload.tag.osName, 'Android');
  assert.equal(payload.tag.osVersion, undefined);
  assert.equal(payload.tag.width, undefined);
  assert.equal(payload.tag.height, undefined);
  assert.equal(payload.tag.orientation, undefined);
  assert.equal(payload.statusBarHeight, 120);
  assert.equal(payload.navBarHeight, 100);
  assert.equal(payload.platform, 'android');
  assert.equal(payload.clientInfo, EXPECTED_CLIENT_INFO);
  assert.equal(payload.environmentInfo, 'percy-maestro');
});

test('ios default tile heights and osName', () => {
  const { payload } = uploadWith({}, { platform: 'ios' });
  assert.equal(payload.tag.osName, 'iOS');
  assert.equal(payload.statusBarHeight, 100);
  assert.equal(payload.navBarHeight, 80);
  assert.equal(payload.platform, 'ios');
});

test('all optional scalar fields populate the payload', () => {
  const { payload } = uploadWith({
    PERCY_DEVICE_NAME: 'Pixel 8',
    PERCY_OS_VERSION: '14',
    PERCY_SCREEN_WIDTH: '1080',
    PERCY_SCREEN_HEIGHT: '2400',
    PERCY_ORIENTATION: 'portrait',
    PERCY_TEST_CASE: 'checkout',
    PERCY_LABELS: 'smoke,regression',
    PERCY_TH_TEST_CASE_EXECUTION_ID: 'exec-42',
  });
  assert.equal(payload.tag.name, 'Pixel 8');
  assert.equal(payload.tag.osVersion, '14');
  assert.equal(payload.tag.width, 1080);
  assert.equal(payload.tag.height, 2400);
  assert.equal(payload.tag.orientation, 'portrait');
  assert.equal(payload.testCase, 'checkout');
  assert.equal(payload.labels, 'smoke,regression');
  assert.equal(payload.thTestCaseExecutionId, 'exec-42');
});

test('non-numeric width/height are dropped (parseInt NaN guard)', () => {
  const { payload } = uploadWith({
    PERCY_SCREEN_WIDTH: 'wide',
    PERCY_SCREEN_HEIGHT: 'tall',
  });
  assert.equal(payload.tag.width, undefined);
  assert.equal(payload.tag.height, undefined);
});

// ---------------------------------------------------------------------------
// Regions
// ---------------------------------------------------------------------------

test('element-based region forwarded as-is', () => {
  const { payload } = uploadWith({
    PERCY_REGIONS: JSON.stringify([{ element: { id: 'header' } }]),
  });
  assert.equal(payload.regions.length, 1);
  assert.deepEqual(payload.regions[0], { element: { id: 'header' } });
});

test('coordinate region with defaults and optional sub-fields', () => {
  const { payload } = uploadWith({
    PERCY_REGIONS: JSON.stringify([
      { top: 0, bottom: 100, left: 0, right: 50 }, // algorithm defaults to "ignore"
      {
        top: '10', bottom: '90', left: '5', right: '45',
        algorithm: 'standard', configuration: { diffSensitivity: 2 },
        padding: { top: 1 }, assertion: { diffIgnoreThreshold: 0.1 },
      },
    ]),
  });
  assert.equal(payload.regions.length, 2);
  assert.deepEqual(payload.regions[0], { top: 0, bottom: 100, left: 0, right: 50, algorithm: 'ignore' });
  assert.equal(payload.regions[1].algorithm, 'standard');
  assert.deepEqual(payload.regions[1].configuration, { diffSensitivity: 2 });
  assert.deepEqual(payload.regions[1].padding, { top: 1 });
  assert.deepEqual(payload.regions[1].assertion, { diffIgnoreThreshold: 0.1 });
});

test('coordinate region with non-numeric coords is warn-skipped', () => {
  const { payload, logs } = uploadWith({
    PERCY_REGIONS: JSON.stringify([{ top: 'a', bottom: 'b', left: 'c', right: 'd' }]),
  });
  assert.equal(payload.regions, undefined, 'no valid regions → field omitted');
  assert.ok(logs.some((l) => l.includes('non-numeric coordinates')));
});

test('coordinate region with inverted bounds is warn-skipped', () => {
  const { payload, logs } = uploadWith({
    PERCY_REGIONS: JSON.stringify([{ top: 100, bottom: 50, left: 0, right: 10 }]),
  });
  assert.equal(payload.regions, undefined);
  assert.ok(logs.some((l) => l.includes('bottom must be > top')));
});

test('region with neither element nor coords is warn-skipped', () => {
  const { payload, logs } = uploadWith({
    PERCY_REGIONS: JSON.stringify([{ foo: 'bar' }]),
  });
  assert.equal(payload.regions, undefined);
  assert.ok(logs.some((l) => l.includes('needs element selector or coordinates')));
});

test('empty regions array → regions field omitted, no error', () => {
  const { payload } = uploadWith({ PERCY_REGIONS: JSON.stringify([]) });
  assert.equal(payload.regions, undefined);
});

test('malformed PERCY_REGIONS JSON is caught and warned', () => {
  const { payload, logs } = uploadWith({ PERCY_REGIONS: '{not json' });
  assert.equal(payload.regions, undefined);
  assert.ok(logs.some((l) => l.includes('invalid PERCY_REGIONS JSON')));
});

test('ignore regions populated when present', () => {
  const ir = [{ element: { id: 'ad' } }];
  const { payload } = uploadWith({ PERCY_IGNORE_REGIONS: JSON.stringify(ir) });
  assert.deepEqual(payload.ignoreRegions, ir);
});

test('empty ignore regions array → field omitted', () => {
  const { payload } = uploadWith({ PERCY_IGNORE_REGIONS: JSON.stringify([]) });
  assert.equal(payload.ignoreRegions, undefined);
});

test('malformed PERCY_IGNORE_REGIONS JSON is caught and warned', () => {
  const { payload, logs } = uploadWith({ PERCY_IGNORE_REGIONS: 'nope[' });
  assert.equal(payload.ignoreRegions, undefined);
  assert.ok(logs.some((l) => l.includes('invalid PERCY_IGNORE_REGIONS JSON')));
});

test('consider regions populated when present', () => {
  const cr = [{ top: 0, bottom: 1, left: 0, right: 1 }];
  const { payload } = uploadWith({ PERCY_CONSIDER_REGIONS: JSON.stringify(cr) });
  assert.deepEqual(payload.considerRegions, cr);
});

test('empty consider regions array → field omitted', () => {
  const { payload } = uploadWith({ PERCY_CONSIDER_REGIONS: JSON.stringify([]) });
  assert.equal(payload.considerRegions, undefined);
});

test('malformed PERCY_CONSIDER_REGIONS JSON is caught and warned', () => {
  const { payload, logs } = uploadWith({ PERCY_CONSIDER_REGIONS: ']bad' });
  assert.equal(payload.considerRegions, undefined);
  assert.ok(logs.some((l) => l.includes('invalid PERCY_CONSIDER_REGIONS JSON')));
});

// ---------------------------------------------------------------------------
// Sync, tile overrides, fullscreen
// ---------------------------------------------------------------------------

test('PERCY_SYNC=true enables sync and logs', () => {
  const { payload, logs } = uploadWith({ PERCY_SYNC: 'TRUE' });
  assert.equal(payload.sync, true);
  assert.ok(logs.some((l) => l.includes('Sync mode enabled')));
});

test('PERCY_SYNC non-true value does not enable sync', () => {
  const { payload } = uploadWith({ PERCY_SYNC: 'yes' });
  assert.equal(payload.sync, undefined);
});

test('status/nav bar height overrides applied when numeric', () => {
  const { payload } = uploadWith({
    PERCY_STATUS_BAR_HEIGHT: '162',
    PERCY_NAV_BAR_HEIGHT: '0',
  }, { platform: 'ios' });
  assert.equal(payload.statusBarHeight, 162);
  assert.equal(payload.navBarHeight, 0);
});

test('non-numeric tile overrides keep platform defaults', () => {
  const { payload } = uploadWith({
    PERCY_STATUS_BAR_HEIGHT: 'big',
    PERCY_NAV_BAR_HEIGHT: 'small',
  }, { platform: 'android' });
  assert.equal(payload.statusBarHeight, 120);
  assert.equal(payload.navBarHeight, 100);
});

test('PERCY_FULLSCREEN=true sets fullscreen', () => {
  const { payload } = uploadWith({ PERCY_FULLSCREEN: 'true' });
  assert.equal(payload.fullscreen, true);
});

test('PERCY_FULLSCREEN non-true does not set fullscreen', () => {
  const { payload } = uploadWith({ PERCY_FULLSCREEN: '1' });
  assert.equal(payload.fullscreen, undefined);
});

// ---------------------------------------------------------------------------
// POST response handling
// ---------------------------------------------------------------------------

test('successful upload with sync data logs sync result', () => {
  const { logs } = uploadWith({}, {
    postResponse: { ok: true, body: JSON.stringify({ data: { diffRatio: 0.0 } }) },
  });
  assert.ok(logs.some((l) => l.includes('Sync result:')));
});

test('successful upload with link logs the link', () => {
  const { logs } = uploadWith({}, {
    postResponse: { ok: true, body: JSON.stringify({ link: 'https://percy.io/build/1' }) },
  });
  assert.ok(logs.some((l) => l.includes('Done: https://percy.io/build/1')));
});

test('successful upload with neither data nor link logs uploaded message', () => {
  const { logs } = uploadWith({}, {
    postResponse: { ok: true, body: JSON.stringify({}) },
  });
  assert.ok(logs.some((l) => l.includes("Screenshot 'home' uploaded.")));
});

test('failed upload logs status + body', () => {
  const { logs } = uploadWith({}, {
    postResponse: { ok: false, status: 422, body: 'unprocessable' },
  });
  assert.ok(logs.some((l) => l.includes('Upload failed: 422 unprocessable')));
});

test('outer catch: http.post throwing is caught and logged', () => {
  const { logs } = runScript('screenshot', {
    platform: 'android',
    output: enabled(),
    env: { SCREENSHOT_NAME: 'home', PERCY_SESSION_ID: 's' },
    http: { post: [THROW(new Error('socket hangup'))] },
  });
  assert.ok(logs.some((l) => l.includes('Error:') && l.includes('socket hangup')));
});
