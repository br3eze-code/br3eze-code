import MemoryManager from '../../src/core/memory/MemoryManager.js';
import { SessionStore } from '../../src/runtime/session/SessionStore.js';

describe('MemoryManager session integration', () => {
  test('creates sessions in the canonical event store', async () => {
    const sessionStore = new SessionStore();
    const memory = new MemoryManager('memory', { sessionStore });

    const sessionId = await memory.createSession('user-1', { channel: 'test' });
    const session = await memory.getSession(sessionId);
    const events = await memory.getSessionEvents(sessionId);

    expect(session.id).toBe(sessionId);
    expect(session.userId).toBe('user-1');
    expect(session.data.channel).toBe('test');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session/created');

    await memory.close();
  });

  test('records completed interactions in the same session stream', async () => {
    const sessionStore = new SessionStore();
    const memory = new MemoryManager('memory', { sessionStore });
    const sessionId = await memory.createSession('user-1');

    await memory.storeInteraction('interaction-1', {
      input: { text: 'hello' },
      context: { userId: 'user-1', sessionId },
      result: { skill: 'echo', output: 'hello' },
      duration: 12,
    });

    const events = await memory.getSessionEvents(sessionId);
    expect(events.map((event) => event.type)).toEqual([
      'session/created',
      'interaction/completed',
    ]);
    expect(events[1].data.interactionId).toBe('interaction-1');

    await memory.close();
  });
});
