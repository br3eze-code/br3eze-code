import { InMemorySessionEventStore, SessionEventStore } from '../../src/core/session/SessionEventStore.js';

describe('SessionEventStore', () => {
  test('appends ordered immutable events', async () => {
    const sessions = new SessionEventStore({ clock: () => '2026-01-01T00:00:00.000Z' });

    const first = await sessions.append('s1', 'turn/start', { input: 'hello' });
    const second = await sessions.append('s1', 'tool/result', { ok: true });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.sessionId).toBe('s1');
    expect(second.version).toBe(1);

    const history = await sessions.read('s1');
    expect(history.map((event) => event.type)).toEqual(['turn/start', 'tool/result']);

    history[0].data.input = 'mutated';
    const reread = await sessions.read('s1');
    expect(reread[0].data.input).toBe('hello');
  });

  test('supports bounded reads and last-event lookup', async () => {
    const sessions = new SessionEventStore({ store: new InMemorySessionEventStore() });

    await sessions.append('s1', 'a');
    await sessions.append('s1', 'b');
    await sessions.append('s1', 'c');

    expect((await sessions.read('s1', { after: 1, limit: 1 }))[0].type).toBe('b');
    expect((await sessions.getLast('s1')).type).toBe('c');
  });

  test('rejects invalid event identity', async () => {
    const sessions = new SessionEventStore();
    await expect(sessions.append('', 'turn/start')).rejects.toThrow('sessionId');
    await expect(sessions.append('s1', '')).rejects.toThrow('event type');
  });
});
