import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTrackedPaths } from './repository-hygiene-gate.mjs';

test('flags tracked local secrets, signing material, and logs', () => {
  const findings = inspectTrackedPaths([
    'src/index.js',
    '.claude/settings.local.json',
    'agentos.podman.env',
    'br3eze-release-key.keystore',
    'error.log',
    'serviceAccountKey.json',
    '.env.example',
    'package-lock.json',
  ]);
  assert.equal(findings.length, 5);
  assert.ok(findings.some(x => x.includes('settings.local.json')));
  assert.ok(findings.some(x => x.includes('podman.env')));
  assert.ok(findings.some(x => x.includes('keystore')));
  assert.ok(findings.some(x => x.includes('error.log')));
  assert.ok(findings.some(x => x.includes('serviceAccountKey.json')));
});

test('requires a tracked npm lockfile and does not allow ignoring it', () => {
  assert.ok(inspectTrackedPaths(['package.json'], 'package-lock.json\n').some(x => x.includes('must not be ignored')));
  assert.ok(inspectTrackedPaths(['package.json'], '').some(x => x.includes('missing from the tracked index')));
});

test('allows safe example environment templates and a tracked lockfile', () => {
  assert.deepEqual(inspectTrackedPaths(['.env.example', 'examples/non-network.env.example', 'package-lock.json'], 'yarn.lock'), []);
});
