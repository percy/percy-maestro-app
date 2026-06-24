// test/unit/harness.mjs
//
// Emulates the Maestro embedded GraalJS host so the SHIPPED scripts in
// percy/scripts/*.js can be executed unmodified and have their real lines
// attributed to coverage.
//
// The production scripts are TOP-LEVEL side-effecting programs with no
// exports/requires. They read host-injected globals (`maestro`, `output`,
// `http`, `json`, `console`) and a handful of env-var globals (SCREENSHOT_NAME,
// PERCY_SESSION_ID, PERCY_REGIONS, ...). Crucially they probe optional globals
// with `typeof X !== "undefined"`, which works naturally inside a fresh
// `vm` context: any global we don't define simply reads back as `undefined`.
//
// We compile each script with `new vm.Script(code, { filename: <absPath> })`
// and run it in a context via `script.runInContext(ctx)`. Passing the REAL
// absolute filename is what lets V8 (and therefore c8) attribute the executed
// lines back to the actual source files on disk.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute paths to the three shipped scripts (the unit-under-test).
export const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'percy', 'scripts');
export const SCRIPT_PATHS = {
  healthcheck: path.join(SCRIPTS_DIR, 'percy-healthcheck.js'),
  prepare: path.join(SCRIPTS_DIR, 'percy-prepare-screenshot.js'),
  screenshot: path.join(SCRIPTS_DIR, 'percy-screenshot.js'),
};

// Compile-once cache keyed by absolute path so repeated runs reuse the same
// vm.Script (and the same `filename`, so coverage merges cleanly).
const scriptCache = new Map();

function compile(absPath) {
  if (!scriptCache.has(absPath)) {
    const code = fs.readFileSync(absPath, 'utf8');
    scriptCache.set(absPath, new vm.Script(code, { filename: absPath }));
  }
  return scriptCache.get(absPath);
}

// A spy-able fake `http` whose .get/.post return a queue of canned responses.
// Each canned entry may be either a response object (returned) or, if it has a
// `__throw` marker, an Error that is thrown (to drive the scripts' catch paths).
function makeHttp(responses = {}) {
  const calls = { get: [], post: [] };

  function handler(kind) {
    const queue = Array.isArray(responses[kind]) ? responses[kind].slice() : [];
    return function (...args) {
      calls[kind].push(args);
      const next = queue.length ? queue.shift() : undefined;
      if (next && next.__throw) {
        throw next.error || new Error('http error');
      }
      return next;
    };
  }

  return {
    get: handler('get'),
    post: handler('post'),
    calls,
  };
}

// `json()` is the Maestro host helper — parse a JSON string. Mirror the real
// behaviour (throws on malformed input) so the scripts' try/catch fires.
function makeJson() {
  return (str) => JSON.parse(str);
}

// A console that records every log line, so tests can assert on banners /
// messages while keeping the test output quiet.
function makeConsole() {
  const logs = [];
  return {
    logs,
    console: {
      log: (...a) => logs.push(a.join(' ')),
      error: (...a) => logs.push(a.join(' ')),
      warn: (...a) => logs.push(a.join(' ')),
    },
  };
}

// Build a `maestro` host object. By default a plain object with `.platform`.
// When `opts.throwOnPlatform` is set, `.platform` is a throwing getter so the
// scripts' outer try/catch (which references `maestro.platform`) is exercised
// with no prior server var assigned.
function makeMaestro(platform, opts = {}) {
  if (opts.throwOnPlatform) {
    return Object.defineProperty({}, 'platform', {
      get() { throw new Error('maestro.platform unavailable'); },
      enumerable: true,
    });
  }
  return { platform };
}

/**
 * Run one of the shipped scripts inside an emulated Maestro GraalJS host.
 *
 * @param {keyof typeof SCRIPT_PATHS} which  Which script to run.
 * @param {object} opts
 *   - platform: value for maestro.platform ('android' | 'ios' | other)
 *   - throwOnPlatform: make maestro.platform throw (drives outer catch)
 *   - output: initial output object (defaults to {})
 *   - env: map of env-var globals to inject (e.g. { SCREENSHOT_NAME: 'home' })
 *   - http: { get: [...responses], post: [...responses] } canned responses
 * @returns {{ output, httpCalls, logs }}
 */
export function runScript(which, opts = {}) {
  const absPath = SCRIPT_PATHS[which];
  if (!absPath) throw new Error('unknown script: ' + which);

  const script = compile(absPath);

  // `output` defaults to a fresh object. A test may pass its own, or set
  // `throwOnPercyEnabledRead` to make reading `output.percyEnabled` throw
  // (drives the prepare-screenshot outer catch, where the fallback path is
  // already set and only the percyEnabled probe fails).
  let output;
  if (opts.output) {
    output = opts.output;
  } else if (opts.throwOnPercyEnabledRead) {
    output = Object.defineProperty({}, 'percyEnabled', {
      get() { throw new Error('output.percyEnabled probe failed'); },
      set() { /* writes allowed */ },
      configurable: true,
    });
  } else {
    output = {};
  }
  const http = makeHttp(opts.http || {});
  const { console: cons, logs } = makeConsole();

  // Base sandbox: the always-present host globals.
  const sandbox = {
    maestro: makeMaestro(opts.platform, { throwOnPlatform: opts.throwOnPlatform }),
    output,
    http,
    json: makeJson(),
    console: cons,
    // GraalJS exposes JSON natively; ensure it's present in the context too.
    JSON,
    parseInt,
    isNaN,
    String,
    Error,
    Object,
  };

  // Inject the env-var globals each test needs as bare context properties.
  // Anything not provided stays absent → reads back as `undefined`, exactly as
  // the scripts' `typeof X !== "undefined"` guards expect.
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      sandbox[k] = v;
    }
  }

  const ctx = vm.createContext(sandbox);
  script.runInContext(ctx);

  return { output, httpCalls: http.calls, logs };
}

// Convenience canned responses.
export const OK_RESPONSE = (headers = {}) => ({ ok: true, headers, status: 200 });
export const NOT_OK_RESPONSE = (status, body) => ({ ok: false, status, body, headers: {} });
export const THROW = (error) => ({ __throw: true, error });
