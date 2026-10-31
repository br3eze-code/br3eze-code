import test from 'node:test';
import assert from 'node:assert/strict';
import { validateApplicationManifest } from '../../src/platform/application-manifest.js';
import { PermissionPolicy } from '../../src/platform/permission-policy.js';
import { IpcBus } from '../../src/platform/ipc-bus.js';
import { ServiceSupervisor } from '../../src/platform/service-supervisor.js';

test('manifest validates identifiers, relative entrypoint and declared capabilities', () => {
  const manifest = validateApplicationManifest({ id: 'demo.app', version: '1.2.3', entrypoint: 'src/index.js', permissions: ['storage.read'] });
  assert.equal(manifest.id, 'demo.app');
  assert.throws(() => validateApplicationManifest({ id: '../bad', version: '1.0.0', entrypoint: 'index.js' }));
  assert.throws(() => validateApplicationManifest({ id: 'demo', version: '1.0.0', entrypoint: '../secret.js' }));
  assert.throws(() => validateApplicationManifest({ id: 'demo', version: '1.0.0', entrypoint: 'index.js', permissions: ['*'] }));
});

test('permission policy defaults to deny and supports grant/revoke', () => {
  const policy = new PermissionPolicy();
  assert.equal(policy.check('app.a', 'storage.read').allowed, false);
  policy.grant('app.a', ['storage.read']);
  assert.equal(policy.check('app.a', 'storage.read').allowed, true);
  assert.throws(() => policy.assert('app.a', 'storage.write'), { code: 'PERMISSION_DENIED' });
  policy.revoke('app.a', 'storage.read');
  assert.equal(policy.check('app.a', 'storage.read').allowed, false);
});

test('IPC requires registered topics, bounds payloads and enforces optional publish permission', () => {
  const policy = new PermissionPolicy();
  policy.grant('app.a', ['ipc.publish.jobs.created']);
  const bus = new IpcBus({ topics: ['jobs.created'], maxPayloadBytes: 100 });
  let received;
  bus.subscribe('jobs.created', (message) => { received = message; });
  bus.publish('jobs.created', { id: 3 }, { principal: 'app.a', policy });
  assert.equal(received.payload.id, 3);
  assert.throws(() => bus.publish('jobs.created', { id: 4 }, { principal: 'app.b', policy }), { code: 'PERMISSION_DENIED' });
  assert.throws(() => bus.publish('missing', {}), { code: 'IPC_TOPIC_NOT_REGISTERED' });
  assert.throws(() => bus.publish('jobs.created', { data: 'x'.repeat(200) }), { code: 'IPC_PAYLOAD_TOO_LARGE' });
});

test('supervisor enforces dependencies and records lifecycle failure', async () => {
  const supervisor = new ServiceSupervisor();
  supervisor.register('storage', { start: async () => {}, stop: async () => {} });
  supervisor.register('worker', { start: async () => {}, stop: async () => {} }, { dependencies: ['storage'] });
  await assert.rejects(supervisor.start('worker'), /Dependency not running/);
  await supervisor.start('storage');
  assert.equal((await supervisor.start('worker')).state, 'running');
  await supervisor.stop('worker');
  assert.equal(supervisor.status('worker').state, 'stopped');

  supervisor.register('broken', { start: async () => { throw new Error('startup failed'); }, stop: async () => {} });
  await assert.rejects(supervisor.start('broken'), /startup failed/);
  assert.equal(supervisor.status('broken').state, 'failed');
});
