import { afterEach, describe, expect, test } from '@jest/globals';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStateStore } from '../../src/adapters/persistence/local-state-store.js';

describe('LocalStateStore', () => {
  let rootDir;
  let store;

  afterEach(async () => {
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
    rootDir = undefined;
  });

  test('isolates state by tenant and application and round-trips JSON', async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'br3eze-state-'));
    store = new LocalStateStore({ rootDir });
    await store.set({ tenantId: 'tenant-a', appId: 'billing', key: 'settings', value: { enabled: true, retries: 3 } });
    await store.set({ tenantId: 'tenant-b', appId: 'billing', key: 'settings', value: { enabled: false } });
    expect(await store.get({ tenantId: 'tenant-a', appId: 'billing', key: 'settings' })).toEqual({ enabled: true, retries: 3 });
    expect(await store.get({ tenantId: 'tenant-b', appId: 'billing', key: 'settings' })).toEqual({ enabled: false });
    expect(await store.list({ tenantId: 'tenant-a', appId: 'billing' })).toEqual(['settings']);
  });

  test('returns undefined for missing values and deletes idempotently', async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'br3eze-state-'));
    store = new LocalStateStore({ rootDir });
    const scope = { tenantId: 'tenant-a', appId: 'billing', key: 'missing' };
    expect(await store.get(scope)).toBeUndefined();
    expect(await store.delete(scope)).toBe(false);
    await store.set({ ...scope, value: null });
    expect(await store.delete(scope)).toBe(true);
    expect(await store.delete(scope)).toBe(false);
  });

  test('rejects unsafe identifiers, prototypes, non-finite numbers and oversized values', async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'br3eze-state-'));
    store = new LocalStateStore({ rootDir, maxValueBytes: 32 });
    await expect(store.set({ tenantId: '../escape', appId: 'billing', key: 'x', value: 1 })).rejects.toThrow('safe identifier');
    await expect(store.set({ tenantId: 'tenant-a', appId: 'billing', key: 'x', value: Number.NaN })).rejects.toThrow('JSON-compatible');
    await expect(store.set({ tenantId: 'tenant-a', appId: 'billing', key: 'x', value: { data: 'x'.repeat(100) } })).rejects.toThrow('size limit');
  });
});
