import { afterEach, describe, expect, test } from '@jest/globals';
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
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe('LocalStateStore', () => {
  test('persists JSON values and reads them after creating a new store instance', async () => {
    const store = await makeStore();
    await store.set({ tenantId: 'tenant-a', appId: 'notes.app', key: 'settings', value: { theme: 'dark', count: 2 } });
    const restarted = new LocalStateStore({ rootDir: store.rootDir });
    await expect(restarted.get({ tenantId: 'tenant-a', appId: 'notes.app', key: 'settings' })).resolves.toEqual({ theme: 'dark', count: 2 });
    await expect(restarted.list({ tenantId: 'tenant-a', appId: 'notes.app' })).resolves.toEqual(['settings']);
  });

  test('isolates tenant and app namespaces', async () => {
    const store = await makeStore();
    await store.set({ tenantId: 'tenant-a', appId: 'notes.app', key: 'item', value: 'private' });
    await expect(store.get({ tenantId: 'tenant-b', appId: 'notes.app', key: 'item' })).resolves.toBeUndefined();
    await expect(store.get({ tenantId: 'tenant-a', appId: 'other.app', key: 'item' })).resolves.toBeUndefined();
  });

  test('rejects path traversal, non-JSON values, and oversized data', async () => {
    const store = new LocalStateStore({ rootDir: (await makeStore()).rootDir, maxValueBytes: 20 });
    await expect(store.set({ tenantId: '../outside', appId: 'app', key: 'x', value: 1 })).rejects.toThrow();
    await expect(store.set({ tenantId: 'tenant', appId: 'app', key: 'x', value: () => {} })).rejects.toThrow('JSON-compatible');
    await expect(store.set({ tenantId: 'tenant', appId: 'app', key: 'x', value: 'this value is too long' })).rejects.toThrow('size limit');
  });

  test('deletes keys idempotently', async () => {
    const store = await makeStore();
    await store.set({ tenantId: 'tenant', appId: 'app', key: 'key', value: true });
    await expect(store.delete({ tenantId: 'tenant', appId: 'app', key: 'key' })).resolves.toBe(true);
    await expect(store.delete({ tenantId: 'tenant', appId: 'app', key: 'key' })).resolves.toBe(false);
  });
});
