import { describe, expect, test } from '@jest/globals';
import AgentKernel from '../../src/core/agentKernel.js';
import { SessionEventStore } from '../../src/core/session/SessionEventStore.js';

describe('AgentKernel ownership boundary', () => {
  test('uses the injected SessionEventStore as the sole session owner', async () => {
    const store = new SessionEventStore();
    const kernel = new AgentKernel({ sessionEventStore: store });
    const adapter = {
      name: 'test-domain',
      capabilities: ['ping'],
      execute: async () => ({ ok: true }),
    };

    kernel.registerDomain('test', adapter);
    kernel.init('/ignored/legacy/path.sqlite');

    const result = await kernel.dispatch({ id: 'agent-1' }, {
      intent: { domain: 'test', text: 'ping' },
    });

    expect(result).toEqual({ ok: true });
    const events = await store.read(
      (await store.getLast(
        [...store.sessions.keys()][0]
      ))?.sessionId
    ).catch(() => []);
    expect(events).toHaveLength(3);
    expect(events.map(event => event.type)).toEqual([
      'session/created',
      'session/running',
      'session/completed',
    ]);
  });

  test('does not create a private _sessions store', () => {
    const kernel = new AgentKernel();
    expect(kernel._sessions).toBeUndefined();
    expect(kernel.sessionEventStore).toBeInstanceOf(SessionEventStore);
  });
});
