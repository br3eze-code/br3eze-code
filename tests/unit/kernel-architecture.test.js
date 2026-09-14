import assert from 'node:assert/strict';
import test from 'node:test';
import AgentKernel from '../../src/core/agentKernel.js';
import { MemorySessionStore } from '../../src/adapters/persistence/memory-session-store.js';

test('kernel requires a host-provided session store', () => {
  const kernel = new AgentKernel();
  assert.throws(() => kernel.init(), /session-store/i);
});

test('kernel dispatches through an injected session store', async () => {
  const kernel = new AgentKernel({ sessionStore: new MemorySessionStore() });
  kernel.registerDomain('alpha', {
    name: 'alpha',
    getCapabilities: () => ['alpha'],
    execute: async () => ({ ok: true }),
  });
  kernel.init();
  assert.deepEqual(await kernel.dispatch({}, { intent: { domain: 'alpha' } }), { ok: true });
});

test('kernel does not guess between multiple domains', () => {
  const kernel = new AgentKernel({ sessionStore: new MemorySessionStore() });
  const domain = (name, capabilities) => ({ name, getCapabilities: () => capabilities, execute: async () => ({ name }) });
  kernel.registerDomain('network', domain('network', ['connect']));
  kernel.registerDomain('commerce', domain('commerce', ['buy']));

  assert.equal(kernel.resolveDomain({ text: 'do something' }), null);
  assert.equal(kernel.resolveDomain({ text: 'connect device' }).adapter.name, 'network');
  assert.equal(kernel.resolveDomain({ text: 'buy item' }).adapter.name, 'commerce');
  assert.equal(kernel.resolveDomain({ domain: 'missing' }), null);
});

test('ambiguous dispatch fails with a stable error code', async () => {
  const kernel = new AgentKernel({ sessionStore: new MemorySessionStore() });
  const domain = (name) => ({ name, getCapabilities: () => [name], execute: async () => null });
  kernel.registerDomain('one', domain('one'));
  kernel.registerDomain('two', domain('two'));
  kernel.init();
  await assert.rejects(
    kernel.dispatch({}, { intent: { text: 'unknown intent' } }),
    (error) => error.code === 'DOMAIN_RESOLUTION_AMBIGUOUS'
  );
});
