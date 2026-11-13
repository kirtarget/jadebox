// node tools/update-test.mjs — version comparison used by the release check.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const { outputFiles: [f] } = await build({ entryPoints: ['src/renderer/lib/update.ts'], bundle: true, format: 'esm', platform: 'neutral', write: false });
const { newerVersion } = await import('data:text/javascript,' + encodeURIComponent(f.text));
assert.equal(newerVersion('0.2.0', 'v0.3.0'), '0.3.0');
assert.equal(newerVersion('0.2.0', 'v0.2.1'), '0.2.1');
assert.equal(newerVersion('0.9.0', 'v0.10.0'), '0.10.0');
assert.equal(newerVersion('0.2.0', 'v0.2.0'), null);
assert.equal(newerVersion('0.3.0', 'v0.2.9'), null);
assert.equal(newerVersion('0.2.0', 'v0.3.0-beta.1'), null);
assert.equal(newerVersion('dev', 'v0.3.0'), null);
console.log('update-test: ALL PASS');
