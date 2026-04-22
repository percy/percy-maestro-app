// A0.2 spike — verify memfs 3.x supports chmod + fstat with correct mode bits for a 0600 file.
//
// Test the exact B2 validation path:
//   1. mockfs creates volume
//   2. write wda-meta.json
//   3. chmod to 0600
//   4. open with O_RDONLY
//   5. fstat on fd — expect mode === 0o100600 (regular file + 0600 perms)
//
// Run: node docs/experiments/2026-04-22-a0-infrastructure-spikes/a0-2-memfs-spike.mjs

import { createRequire } from 'module';
import { constants } from 'fs';

const require = createRequire(import.meta.url);

// Resolve memfs from the cli workspace.
let memfs;
try {
  memfs = require('/Users/arumullasriram/percy-repos/cli/node_modules/memfs');
} catch (err) {
  console.error('Could not resolve memfs:', err.message);
  process.exit(2);
}

const vol = new memfs.Volume();
const fs = memfs.createFsFromVolume(vol);

const sidDir = '/tmp/test-sid';
const metaPath = `${sidDir}/wda-meta.json`;

// Create the directory and file via fromJSON.
vol.fromJSON({
  [metaPath]: JSON.stringify({ sessionId: 'test', wdaPort: 8408 })
});

const results = {
  fromJSON_creates_file: vol.existsSync(metaPath),
  mode_after_fromJSON: vol.statSync(metaPath).mode.toString(8),
};

// Try to chmod to 0600.
let chmodOk = false;
try {
  fs.chmodSync(metaPath, 0o600);
  chmodOk = true;
} catch (err) {
  results.chmod_error = err.message;
}
results.chmod_succeeded = chmodOk;

if (chmodOk) {
  const statAfterChmod = fs.statSync(metaPath);
  results.mode_after_chmod_octal = statAfterChmod.mode.toString(8);
  results.mode_after_chmod_num = statAfterChmod.mode;
  results.mode_equals_0100600 = statAfterChmod.mode === 0o100600;

  // Try open + fstat (the B2 production path).
  try {
    const fd = fs.openSync(metaPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const fst = fs.fstatSync(fd);
    results.fstat_mode_octal = fst.mode.toString(8);
    results.fstat_mode_equals_0100600 = fst.mode === 0o100600;
    results.fstat_uid = fst.uid;
    results.fstat_nlink = fst.nlink;
    fs.closeSync(fd);
  } catch (err) {
    results.fstat_error = err.message;
  }
}

// Also probe directory mode behavior.
try {
  fs.chmodSync(sidDir, 0o700);
  results.parent_dir_mode_octal = fs.statSync(sidDir).mode.toString(8);
} catch (err) {
  results.parent_chmod_error = err.message;
}

console.log('=== A0.2 result ===');
console.log(JSON.stringify(results, null, 2));

const pass =
  results.chmod_succeeded &&
  results.mode_equals_0100600 &&
  results.fstat_mode_equals_0100600;

console.log(pass ? '\nPASS — memfs supports mode bits; B2 can use memfs via mockfs.'
                 : '\nFAIL — B2 test harness must fall back to a real tmpdir with afterEach cleanup.');
process.exit(pass ? 0 : 1);
