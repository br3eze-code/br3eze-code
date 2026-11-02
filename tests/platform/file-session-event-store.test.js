import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileSessionEventStore } from '../../src/adapters/persistence/file-session-event-store.js';
import { SessionEventStore } from '../../src/core/session/SessionEventStore.js';

const roots = [];
async function makeStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'br3eze-session-events-'));
  roots.push(rootDir);
  return { rootDir, store: new SessionEventStore({ store: new FileSessionEventStore({ rootDir }) }) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test('persists ordered events across adapter instances and safely encodes scoped IDs', async () => {
  const { rootDir, store } = await makeStore();
  const sessionId = 'agent-a/tenant-a/channel-a';
  await Promise.all([
    store.append(sessionId, 'session/created', { userId: 'user-a' }),
    store.append(sessionId, 'runtime/session.snapshot', { messages: ['hello'] }),
  ]);
  const restarted = new SessionEventStore({ store: new FileSessionEventStore({ rootDir }) });
  const events = await restarted.read(sessionId);
  assert.deepEqual(events.map((event) => event.seq), [1, 2]);
  assert.equal((await restarted.getLast(sessionId)).type, 'runtime/session.snapshot');
  assert.deepEqual(await restarted.list(), [sessionId]);
});

test('supports bounded reads and rejects unsafe session identifiers', async () => {
  const { store } = await makeStore();
  await store.append('session-1', 'a');
  await store.append('session-1', 'b');
  await store.append('session-1', 'c');
  assert.equal((await store.read('session-1', { after: 1, limit: 1 }))[0].type, 'b');
  await assert.rejects(store.append('../escape', 'unsafe'), /safe string/);
});
