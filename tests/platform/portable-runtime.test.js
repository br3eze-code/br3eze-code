import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry } from '../../src/platform/provider-registry.js';
import { HardwarePort, validateHardwareProvider } from '../../src/platform/hardware-port.js';
import { RuntimeEnvironment } from '../../src/platform/runtime-environment.js';
import { nodeHardwareProvider } from '../../src/platform/host-provider.js';

const provider = (overrides = {}) => ({
  id: 'model.local', kind: 'model', version: '1.0.0',
  capabilities: ['text.generate'], priority: 10,
  generate: async ({ prompt }) => ({ text: String(prompt) }),
  ...overrides,
});

test('provider registry validates and resolves providers by kind/capability', () => {
  const registry = new ProviderRegistry();
  registry.register(provider());
  registry.register(provider({ id: 'model.remote', priority: 2 }));
  assert.equal(registry.resolve({ kind: 'model', capability: 'text.generate' }).id, 'model.local');
  assert.equal(registry.resolve({ preferredId: 'model.remote', kind: 'model' }).id, 'model.remote');
  assert.equal(registry.resolve({ kind: 'storage' }), null);
  assert.throws(() => registry.register(provider({ id: 'model.local' })), /already registered/);
  assert.throws(() => registry.register(provider({ kind: 'unknown' })), /provider.kind/);
});

test('hardware port normalizes portable facts and tolerates unknown metrics', async () => {
  const port = new HardwarePort({ id: 'mock', probe: async () => ({ platform: 'test', cpuCount: 2, totalMemoryBytes: 1024, accelerators: ['gpu-x'] }) });
  const profile = await port.profile();
  assert.equal(profile.platform, 'test');
  assert.equal(profile.cpuCount, 2);
  assert.deepEqual(profile.accelerators, ['gpu-x']);
  assert.equal(profile.architecture, 'unknown');
  assert.throws(() => validateHardwareProvider({}), /probe/);
  await assert.rejects(port.profile({ signal: AbortSignal.abort(new Error('cancelled')) }), /cancelled/);
});

test('Node hardware provider implements the same host-neutral profile contract', async () => {
  const profile = await new HardwarePort(nodeHardwareProvider).profile();
  assert.ok(profile.platform.length > 0);
  assert.ok(profile.cpuCount > 0);
});

test('runtime environment wires provider SPI, permissions, IPC and supervisor without owning agent execution', async () => {
  const env = new RuntimeEnvironment({ ipcTopics: ['app.ready'] });
  env.registerProvider(provider());
  assert.equal(env.resolveProvider({ kind: 'model', capability: 'text.generate' }).id, 'model.local');
  assert.equal((await env.start()).state, 'running');
  assert.equal((await env.stop()).state, 'stopped');
  assert.throws(() => env.registerProvider(provider({ id: 'model.after-stop' })), /shutting down/);
});
