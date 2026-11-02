import test from 'node:test';
import assert from 'node:assert/strict';
import { planReconciliation } from '../../src/core/infrastructure/reconciliation.js';

const desired = [
  { provider: 'aws', kind: 'cluster', id: 'prod', attributes: { region: 'us-east-1', version: '1.37' } },
  { provider: 'firebase', kind: 'project', id: 'demo', attributes: { hosting: true } }
];

test('plans create and update without executing writes', () => {
  const result = planReconciliation({ desired, observed: [{ provider: 'aws', kind: 'cluster', id: 'prod', attributes: { region: 'us-east-1', version: '1.36' } }] });
  assert.equal(result.mode, 'plan-only');
  assert.equal(result.destructiveChangesApplied, 0);
  assert.deepEqual(result.actions.map((item) => item.action), ['update', 'create']);
  assert.equal(result.actions[0].requiresApproval, true);
});

test('preserves remote-only resources rather than deleting them', () => {
  const result = planReconciliation({ desired: [], observed: [{ provider: 'aws', kind: 'database', id: 'live-db', attributes: {} }] });
  assert.equal(result.actions[0].action, 'orphan_preserved');
  assert.equal(result.actions[0].destructive, false);
});

test('canonicalizes object key order before comparing state', () => {
  const result = planReconciliation({ desired: [{ provider: 'aws', kind: 'cluster', id: 'prod', attributes: { a: 1, b: 2 } }], observed: [{ provider: 'aws', kind: 'cluster', id: 'prod', attributes: { b: 2, a: 1 } }] });
  assert.equal(result.actions[0].action, 'in_sync');
});

test('rejects duplicate and secret-bearing inventory records', () => {
  assert.throws(() => planReconciliation({ desired: [desired[0], desired[0]], observed: [] }), /Duplicate/);
  assert.throws(() => planReconciliation({ desired: [{ provider: 'aws', kind: 'secret', id: 'x', attributes: { apiKey: 'no' } }], observed: [] }), /Secret-like/);
});

import { compareMigrationHistory } from '../../src/core/infrastructure/reconciliation.js';

test('migration comparison identifies version drift and unmatched history without suggesting apply', () => {
  const result = compareMigrationHistory({
    local: [{ version: '20260101000000', name: 'same' }, { version: '20260102000000', name: 'local_only' }],
    remote: [{ version: '20260103000000', name: 'same' }, { version: '20260104000000', name: 'remote_only' }]
  });
  assert.equal(result.exactMatches.length, 0);
  assert.equal(result.versionMismatches.length, 1);
  assert.equal(result.localOnly.length, 1);
  assert.equal(result.remoteOnly.length, 1);
  assert.equal(result.safeToAutoApply, false);
});
