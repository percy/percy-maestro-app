// test/unit/percy-healthcheck.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScript, OK_RESPONSE, NOT_OK_RESPONSE, THROW } from './harness.mjs';

const HC = '/percy/healthcheck';

test('unsupported platform disables Percy without a banner', () => {
  const { output, httpCalls, logs } = runScript('healthcheck', { platform: 'web' });
  assert.equal(output.percyEnabled, false);
  assert.equal(httpCalls.get.length, 0, 'must not contact the server');
  assert.ok(logs.some((l) => l.includes('Android and iOS only')));
  assert.ok(!logs.some((l) => l.includes('DISABLED —')), 'no DISABLED banner on config issue');
});

test('android + ok response with core-version header enables Percy', () => {
  const { output, httpCalls, logs } = runScript('healthcheck', {
    platform: 'android',
    http: { get: [OK_RESPONSE({ 'x-percy-core-version': '1.30.7' })] },
  });
  assert.equal(output.percyEnabled, true);
  assert.equal(output.percyServer, 'http://percy.cli:5338');
  assert.equal(output.percyCoreVersion, '1.30.7');
  assert.equal(httpCalls.get[0][0], 'http://percy.cli:5338' + HC);
  assert.ok(logs.some((l) => l.includes('Core version: 1.30.7')));
});

test('ios + ok response WITHOUT core-version header still enables Percy', () => {
  const { output, logs } = runScript('healthcheck', {
    platform: 'ios',
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(output.percyEnabled, true);
  assert.equal(output.percyCoreVersion, '', 'coreVersion || "" fallback');
  assert.ok(logs.some((l) => l === '[percy] Percy CLI healthcheck passed.'));
});

test('PERCY_SERVER env override is honoured', () => {
  const { output, httpCalls } = runScript('healthcheck', {
    platform: 'android',
    env: { PERCY_SERVER: 'http://localhost:9999' },
    http: { get: [OK_RESPONSE({ 'x-percy-core-version': '2.0.0' })] },
  });
  assert.equal(output.percyServer, 'http://localhost:9999');
  assert.equal(httpCalls.get[0][0], 'http://localhost:9999' + HC);
});

test('PERCY_SERVER_ADDRESS used when set; PERCY_SERVER takes precedence when both set', () => {
  // PERCY_SERVER_ADDRESS is the self-hosted `percy app:exec` export; it wins
  // over the default but loses to an explicit PERCY_SERVER.
  const addrOnly = runScript('healthcheck', {
    platform: 'android',
    env: { PERCY_SERVER_ADDRESS: 'http://addr:1' },
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(addrOnly.httpCalls.get[0][0], 'http://addr:1' + HC);

  const both = runScript('healthcheck', {
    platform: 'android',
    env: { PERCY_SERVER_ADDRESS: 'http://addr:1', PERCY_SERVER: 'http://explicit:2' },
    http: { get: [OK_RESPONSE({})] },
  });
  assert.equal(both.httpCalls.get[0][0], 'http://explicit:2' + HC);
});

test('4xx response → reachable-but-rejected banner, disabled', () => {
  const { output, logs } = runScript('healthcheck', {
    platform: 'android',
    http: { get: [NOT_OK_RESPONSE(403, 'forbidden')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('rejected the request (status 403')));
});

test('5xx response → server-side error banner, disabled', () => {
  const { output, logs } = runScript('healthcheck', {
    platform: 'android',
    http: { get: [NOT_OK_RESPONSE(502, 'bad gateway')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('server-side, status 502')));
});

test('unexpected/zero status → unexpected-status banner, disabled', () => {
  const { output, logs } = runScript('healthcheck', {
    platform: 'ios',
    // status not parseable → parseInt(...)||0 === 0, neither >=400 nor >=500
    http: { get: [NOT_OK_RESPONSE('not-a-number', '')] },
  });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('unexpected status 0')));
});

test('http.get throws → not-reachable banner uses the resolved server', () => {
  const { output, logs } = runScript('healthcheck', {
    platform: 'android',
    env: { PERCY_SERVER: 'http://custom:1234' },
    http: { get: [THROW(new Error('ECONNREFUSED'))] },
  });
  assert.equal(output.percyEnabled, false);
  // percyServer was assigned before the throw → truthy branch of the ternary.
  assert.ok(logs.some((l) => l.includes('not reachable at http://custom:1234')));
  assert.ok(logs.some((l) => l.includes('ECONNREFUSED')));
});

test('throw BEFORE server var assigned → ternary falls back to default server', () => {
  // maestro.platform throws, so `var percyServer` never executes; in the catch
  // `typeof percyServer !== "undefined" && percyServer` is false → fallback.
  const { output, logs } = runScript('healthcheck', { throwOnPlatform: true });
  assert.equal(output.percyEnabled, false);
  assert.ok(logs.some((l) => l.includes('not reachable at http://percy.cli:5338')));
});
