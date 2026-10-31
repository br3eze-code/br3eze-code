import { describe, expect, test } from '@jest/globals';
import { assertTaskAccess, normalizeScope } from '../../src/core/user-task-service.js';

const task = {
  taskId: 'task-1',
  scope: { tenantId: 'tenant-a', userId: 'user-a', domainId: null, siteId: null },
  owner: { userId: 'user-a' },
};

describe('task authorization scope', () => {
  test('normalizes provider-specific verified identity claims', () => {
    expect(normalizeScope({ sub: 'user-a', tenant_id: 'tenant-a' })).toMatchObject({
      userId: 'user-a',
      tenantId: 'tenant-a',
    });
  });

  test('allows the owning user in the matching tenant', () => {
    expect(assertTaskAccess(task, { uid: 'user-a', tenantId: 'tenant-a' })).toBe(task);
  });

  test('rejects another user even when they share a tenant', () => {
    expect(() => assertTaskAccess(task, { uid: 'user-b', tenantId: 'tenant-a' }))
      .toThrow(/outside your authorized scope/);
  });

  test('rejects the owner when an explicit tenant claim conflicts', () => {
    expect(() => assertTaskAccess(task, { uid: 'user-a', tenantId: 'tenant-b' }))
      .toThrow(/outside your authorized scope/);
  });
});
