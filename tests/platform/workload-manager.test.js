import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionPolicy } from '../../src/platform/permission-policy.js';
import { WorkloadManager } from '../../src/platform/workload-manager.js';

test('managed workload validates runner, requires granted capabilities, and controls lifecycle', async () => {
  const permissions = new PermissionPolicy();
  const manager = new WorkloadManager({ permissions });
  const calls = [];
  manager.registerRunner('portable', {
    async start(manifest, context) { calls.push(['start', manifest.id, context.capabilities]); return { token: 'opaque-handle' }; },
    async stop(handle, context) { calls.push(['stop', handle.token, context.workloadId]); },
  });
  const manifest = { id: 'sample.app', version: '1.0.0', runtime: 'portable', entrypoint: 'app/main.js', permissions: ['storage.read'] };
  manager.install(manifest);
  await assert.rejects(manager.start('sample.app'), { code: 'PERMISSION_DENIED' });
  permissions.grant('sample.app', ['storage.read']);
  assert.equal((await manager.start('sample.app')).state, 'running');
  assert.equal((await manager.stop('sample.app')).state, 'stopped');
  assert.deepEqual(calls, [
    ['start', 'sample.app', ['storage.read']],
    ['stop', 'opaque-handle', 'sample.app'],
  ]);
});

test('managed workload refuses missing runtimes and records startup failure', async () => {
  const manager = new WorkloadManager({ permissions: new PermissionPolicy() });
  assert.throws(() => manager.install({ id: 'no.runner', version: '1.0.0', entrypoint: 'main.js' }), { code: 'WORKLOAD_RUNTIME_NOT_FOUND' });
  manager.registerRunner('portable', { async start() { throw new Error('runner failed'); }, async stop() {} });
  manager.install({ id: 'fails.app', version: '1.0.0', entrypoint: 'main.js' });
  await assert.rejects(manager.start('fails.app'), /runner failed/);
  assert.equal(manager.status('fails.app').state, 'failed');
});
