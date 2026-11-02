import { afterEach, describe, expect, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStateStore } from '../../src/adapters/persistence/local-state-store.js';

const roots = [];

async function createStore(options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'br3eze-state-'));
  roots.push(rootDir);
  return new LocalStateStore({ rootDir, ...options });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('LocalStateStore', () => {
  test('persists JSON state across adapter instances', async () => {
    const store = await createStore();
    await store.set({ tenantId: 'tenant-a', appId: 'billing.app', key: 'settings', value: { enabled: true, retries: 3 } });
    const restarted = new LocalStateStore({ rootDir: store.rootDir });
    await expect(restarted.get({ tenantId: 'tenant-a', appId: 'billing.app', key: 'settings' }))
      .resolves.toEqual({ enabled: true, retries: 3 });
    await expect(restarted.list({ tenantId: 'tenant-a', appId: 'billing.app' })).resolves.toEqual(['settings']);
  });

  test('isolates tenant and application namespaces', async () => {
    const store = await createStore();
    await store.set({ tenantId: 'tenant-a', appId: 'billing.app', key: 'config', value: 'private' });
    await expect(store.get({ tenantId: 'tenant-b', appId: 'billing.app', key: 'config' })).resolves.toBeUndefined();
    await expect(store.get({ tenantId: 'tenant-a', appId: 'other.app', key: 'config' })).resolves.toBeUndefined();
  });

  test('rejects unsafe identifiers, non-JSON values and oversized values', async () => {
    const store = await createStore({ maxValueBytes: 24 });
    await expect(store.set({ tenantId: '../outside', appId: 'app', key: 'x', value: 1 })).rejects.toThrow();
    await expect(store.set({ tenantId: 'tenant', appId: 'app', key: 'x', value: () => {} })).rejects.toThrow('JSON-compatible');
    await expect(store.set({ tenantId: 'tenant', appId: 'app', key: 'x', value: 'a value that is too long' })).rejects.toThrow('size limit');
  });

  test('rejects circular state and deletes keys idempotently', async () => {
    const store = await createStore();
    const circular = {};
    circular.self = circular;
    await expect(store.set({ tenantId: 'tenant', appId: 'app', key: 'bad', value: circular })).rejects.toThrow('circular');
    await store.set({ tenantId: 'tenant', appId: 'app', key: 'key', value: true });
    await expect(store.delete({ tenantId: 'tenant', appId: 'app', key: 'key' })).resolves.toBe(true);
    await expect(store.delete({ tenantId: 'tenant', appId: 'app', key: 'key' })).resolves.toBe(false);
  });
});
