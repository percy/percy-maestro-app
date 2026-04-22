// A0.1 spike — verify @percy/client/utils#request honors AbortController signal with retries: 0.
//
// Expected: dispatch against a deliberately-slow local server; abort at 50ms; rejection within 100ms;
// no retry-storm (retry wrapper bypassed because ABORT_ERR is not in RETRY_ERROR_CODES).
//
// Run with: node docs/experiments/2026-04-22-a0-infrastructure-spikes/a0-1-abort-spike.mjs
//           (from percy-maestro root; resolves the @percy/client install from ../cli)

import { createServer } from 'http';

const SLOW_SERVER_DELAY_MS = 5000;
const ABORT_AT_MS = 50;
const REJECTION_DEADLINE_MS = 100;

// Start a server that accepts connections but never responds within the test window.
const server = createServer((req, res) => {
  // Deliberately delay the response far past the abort window.
  setTimeout(() => {
    res.writeHead(200);
    res.end('too-late');
  }, SLOW_SERVER_DELAY_MS);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
console.log(`Slow server listening on 127.0.0.1:${port}`);

// Dynamic import so we can report a clean error if the resolution fails.
let request;
try {
  ({ request } = await import('/Users/arumullasriram/percy-repos/cli/packages/client/src/utils.js'));
} catch (err) {
  console.error('Could not import @percy/client/utils#request:', err.message);
  server.close();
  process.exit(2);
}

const controller = new AbortController();

setTimeout(() => {
  console.log(`[t+${ABORT_AT_MS}ms] Aborting…`);
  controller.abort();
}, ABORT_AT_MS);

const start = Date.now();
let outcome;

try {
  await request(`http://127.0.0.1:${port}/`, {
    signal: controller.signal,
    retries: 0,
    interval: 10
  });
  outcome = { ok: false, reason: 'request resolved unexpectedly' };
} catch (err) {
  const elapsed = Date.now() - start;
  outcome = {
    elapsed_ms: elapsed,
    within_deadline: elapsed < REJECTION_DEADLINE_MS,
    error_name: err?.name,
    error_code: err?.code,
    error_message: err?.message,
    // We care that abort-class errors propagate (not RETRY_ERROR_CODES).
    is_abort: err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || /abort/i.test(err?.message ?? '')
  };
}

server.close();

console.log('\n=== A0.1 result ===');
console.log(JSON.stringify(outcome, null, 2));

const passed = outcome.within_deadline && outcome.is_abort;
console.log(passed ? '\nPASS' : '\nFAIL');
process.exit(passed ? 0 : 1);
