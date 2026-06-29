// test/unit/percy-prepare-screenshot.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, OK_RESPONSE, NOT_OK_RESPONSE, THROW } from './harness.mjs';

test('sets percyScreenshotPath to SCREENSHOT_NAME when provided', () => {
  const { output } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'login_screen' },
    http: { get: [OK_RESPONSE({ 'x-percy-core-version': '1.0.0' })] },
  });
  assert.equal(output.percyScreenshotPath, 'login_screen');
});

test('falls back to "percy-screenshot" when SCREENSHOT_NAME is absent', () => {
  const { output } = runScript('prepare', {
    platform: 'ios',
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(output.percyScreenshotPath, 'percy-screenshot');
});

test('inline healthcheck self-init: success enables Percy', () => {
  const { output, httpCalls } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'a' },
    http: { get: [OK_RESPONSE({ 'x-percy-core-version': '3.1.0' })] },
  });
  assert.equal(output.percyEnabled, true);
  assert.equal(output.percyCoreVersion, '3.1.0');
  assert.equal(httpCalls.get.length, 1);
});

test('inline healthcheck self-init: failure disables Percy', () => {
  const { output } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'a' },
    http: { get: [NOT_OK_RESPONSE(500, 'boom')] },
  });
  assert.equal(output.percyEnabled, false);
});

test('skips inline healthcheck when percyEnabled already known', () => {
  const { output, httpCalls } = runScript('prepare', {
    platform: 'android',
    output: { percyEnabled: true },
    env: { SCREENSHOT_NAME: 'cached' },
  });
  assert.equal(output.percyScreenshotPath, 'cached');
  assert.equal(httpCalls.get.length, 0, 'cached → no healthcheck call');
});

// --- inline healthcheck branch coverage (mirrors percy-healthcheck.js) ---

test('inline healthcheck: unsupported platform disables without a banner', () => {
  const { output, httpCalls, logs } = runScript('prepare', {
    platform: 'web',
    env: { SCREENSHOT_NAME: 'x' },
  });
  assert.equal(output.percyEnabled, false);
  assert.equal(httpCalls.get.length, 0);
  assert.ok(logs.some((l) => l.includes('Android and iOS only')));
});

test('inline healthcheck: PERCY_SERVER override and no-version success', () => {
  const { output, httpCalls, logs } = runScript('prepare', {
    platform: 'ios',
    env: { SCREENSHOT_NAME: 'x', PERCY_SERVER: 'http://srv:7' },
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(output.percyEnabled, true);
  assert.equal(output.percyServer, 'http://srv:7');
  assert.equal(output.percyCoreVersion, '');
  assert.equal(httpCalls.get[0][0], 'http://srv:7/percy/healthcheck');
  assert.ok(logs.some((l) => l === '[percy] Percy CLI healthcheck passed.'));
});

test('inline healthcheck: PERCY_SERVER_ADDRESS used; PERCY_SERVER wins when both set', () => {
  const addrOnly = runScript('prepare', {
    platform: 'ios',
    env: { SCREENSHOT_NAME: 'x', PERCY_SERVER_ADDRESS: 'http://addr:3' },
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(addrOnly.httpCalls.get[0][0], 'http://addr:3/percy/healthcheck');

  const both = runScript('prepare', {
    platform: 'ios',
    env: { SCREENSHOT_NAME: 'x', PERCY_SERVER_ADDRESS: 'http://addr:3', PERCY_SERVER: 'http://explicit:4' },
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(both.httpCalls.get[0][0], 'http://explicit:4/percy/healthcheck');
});

test('inline healthcheck: 4xx disables with rejected banner', () => {
  const { output, logs } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'x' },
    http: { get: [NOT_OK_RESPONSE(404, 'nope')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('rejected the request (status 404')));
});

test('inline healthcheck: unexpected status disables with unexpected banner', () => {
  const { output, logs } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'x' },
    http: { get: [NOT_OK_RESPONSE('nan', '')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('unexpected status 0')));
});

test('inline healthcheck: http.get throws → not-reachable banner', () => {
  const { output, logs } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'x', PERCY_SERVER: 'http://z:9' },
    http: { get: [THROW(new Error('boom'))] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('not reachable at http://z:9')));
  assert.ok(logs.some((l) => l.includes('boom')));
});

test('inline healthcheck: throw before server var → default-server banner', () => {
  // maestro.platform throws inside runPercyHealthcheckInline before `var
  // hcServer` runs, so the catch ternary takes its fallback branch.
  const { output, logs } = runScript('prepare', {
    throwOnPlatform: true,
    env: { SCREENSHOT_NAME: 'x' },
  });
  assert.equal(output.percyEnabled, false);
  assert.equal(output.percyScreenshotPath, 'x', 'fallback path still set');
  assert.ok(logs.some((l) => l.includes('not reachable at http://percy.cli:5338')));
});

test('outer catch: percyEnabled probe throwing still leaves the fallback path set', () => {
  const { output, logs } = runScript('prepare', {
    platform: 'android',
    env: { SCREENSHOT_NAME: 'with_error' },
    throwOnPercyEnabledRead: true,
  });
  // Fallback was set on L75 before the throwing read on L77.
  assert.equal(output.percyScreenshotPath, 'with_error');
  assert.ok(logs.some((l) => l.includes('prepare-screenshot error:')));
});
