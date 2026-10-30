import test from 'node:test';
import assert from 'node:assert/strict';
import { ServiceSupervisor } from '../../src/platform/service-supervisor.js';

const service = (name, events, { failStart = false, failStop = false } = {}) => ({
  async start(context) {
    assert.equal(context.serviceId, name);
    events.push(`start:${name}`);
    if (failStart) throw new Error(`start failed: ${name}`);
  },
  async stop(context) {
    assert.equal(context.serviceId, name);
    events.push(`stop:${name}`);
    if (failStop) throw new Error(`stop failed: ${name}`);
  },
});

test('services start only after dependencies are running', async () => {
  const supervisor = new ServiceSupervisor();
  const events = [];
  supervisor.register('storage', service('storage', events));
  supervisor.register('worker', service('worker', events), { dependencies: ['storage'] });

  await assert.rejects(supervisor.start('worker'), /Dependency not running: storage/);
  await supervisor.start('storage');
  await supervisor.start('worker');
  assert.deepEqual(events, ['start:storage', 'start:worker']);
});

test('rejects dependency cycles, including cycles formed by later registration', () => {
  const supervisor = new ServiceSupervisor();
  supervisor.register('alpha', service('alpha', []), { dependencies: ['beta'] });
  assert.throws(
    () => supervisor.register('beta', service('beta', []), { dependencies: ['alpha'] }),
    /Service dependency cycle/,
  );
  assert.equal(supervisor.status('beta'), null);
});

test('prevents stopping a dependency while a dependent is active', async () => {
  const supervisor = new ServiceSupervisor();
  const events = [];
  supervisor.register('storage', service('storage', events));
  supervisor.register('worker', service('worker', events), { dependencies: ['storage'] });
  await supervisor.start('storage');
  await supervisor.start('worker');

  await assert.rejects(supervisor.stop('storage'), /active dependents: worker/);
  assert.equal(supervisor.status('storage').state, 'running');
});

test('stopAll shuts down dependents before their dependencies', async () => {
  const supervisor = new ServiceSupervisor();
  const events = [];
  supervisor.register('storage', service('storage', events));
  supervisor.register('worker', service('worker', events), { dependencies: ['storage'] });
  supervisor.register('api', service('api', events), { dependencies: ['worker'] });
  await supervisor.start('storage');
  await supervisor.start('worker');
  await supervisor.start('api');

  const results = await supervisor.stopAll();
  assert.deepEqual(events.slice(-3), ['stop:api', 'stop:worker', 'stop:storage']);
  assert.deepEqual(results.map((result) => result.state), ['stopped', 'stopped', 'stopped']);
});

test('records startup and shutdown errors without losing service state', async () => {
  const supervisor = new ServiceSupervisor();
  supervisor.register('broken-start', service('broken-start', [], { failStart: true }));
  await assert.rejects(supervisor.start('broken-start'), /start failed/);
  assert.equal(supervisor.status('broken-start').state, 'failed');
  assert.equal(supervisor.status('broken-start').lastError, 'start failed: broken-start');

  supervisor.register('broken-stop', service('broken-stop', [], { failStop: true }));
  await supervisor.start('broken-stop');
  await assert.rejects(supervisor.stop('broken-stop'), /stop failed/);
  assert.equal(supervisor.status('broken-stop').state, 'failed');
});
