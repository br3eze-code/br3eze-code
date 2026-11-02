import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStateStore } from '../../src/platform/local-state-store.js';

const roots = [];
async function makeStore() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'br3eze-os-state-'));
  roots.push(rootDir);
  return new LocalStateStore({ rootDir });
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test('persists JSON values across store instances', async () => {
  const store = await makeStore();
  await store.set({ tenantId: 'tenant-a', appId: 'notes.app', key: 'settings', value: { theme: 'dark', count: 2 } });
  const restarted = new LocalStateStore({ rootDir: store.rootDir });
  assert.deepEqual(await restarted.get({ tenantId: 'tenant-a', appId: 'notes.app', key: 'settings' }), { theme: 'dark', count: 2 });
  assert.deepEqual(await restarted.list({ tenantId: 'tenant-a', appId: 'notes.app' }), ['settings']);
});

test('isolates tenant and app namespaces', async () => {
  const store = await makeStore();
  await store.set({ tenantId: 'tenant-a', appId: 'notes.app', key: 'item', value: 'private' });
  assert.equal(await store.get({ tenantId: 'tenant-b', appId: 'notes.app', key: 'item' }), undefined);
  assert.equal(await store.get({ tenantId: 'tenant-a', appId: 'other.app', key: 'item' }), undefined);
});

test('rejects path traversal, non-JSON values, and oversized data', async () => {
  const store = new LocalStateStore({ rootDir: (await makeStore()).rootDir, maxValueBytes: 20 });
  await assert.rejects(store.set({ tenantId: '../outside', appId: 'app', key: 'x', value: 1 }));
  await assert.rejects(store.set({ tenantId: 'tenant', appId: 'app', key: 'x', value: () => {} }), /JSON-compatible/);
  await assert.rejects(store.set({ tenantId: 'tenant', appId: 'app', key: 'x', value: 'this value is too long' }), /size limit/);
});

test('deletes keys idempotently', async () => {
  const store = await makeStore();
  await store.set({ tenantId: 'tenant', appId: 'app', key: 'key', value: true });
  assert.equal(await store.delete({ tenantId: 'tenant', appId: 'app', key: 'key' }), true);
  assert.equal(await store.delete({ tenantId: 'tenant', appId: 'app', key: 'key' }), false);
});
