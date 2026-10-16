import { describe, expect, test } from '@jest/globals';
import { authenticateBearer, hasPermission, ownsResource, normalizeIdentity } from './identity.js';

describe('canonical identity authorization', () => {
  test('accepts only an explicitly configured service token at the service boundary', async () => {
    const previous = process.env.AGENTOS_SERVICE_TOKEN;
    process.env.AGENTOS_SERVICE_TOKEN = 'test-service-token';
    try {
      const identity = await authenticateBearer('test-service-token');
      expect(identity.provider).toBe('service');
      expect(identity.permissions).toContain('*');
      expect(await authenticateBearer('wrong-token')).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.AGENTOS_SERVICE_TOKEN;
      else process.env.AGENTOS_SERVICE_TOKEN = previous;
    }
  });

  test('normalizes a Firebase identity', () => {
    const identity = normalizeIdentity({ uid: 'u1', email: 'u@example.com', role: 'PARTNER' });
    expect(identity.id).toBe('u1');
    expect(identity.provider).toBe('firebase');
    expect(identity.roles).toContain('PARTNER');
    expect(hasPermission(identity, 'orders.create')).toBe(true);
    expect(hasPermission(identity, 'system.reboot')).toBe(false);
  });

  test('admin has wildcard permissions and ownership', () => {
    const identity = normalizeIdentity({ uid: 'a1', role: 'ADMIN' });
    expect(hasPermission(identity, 'anything')).toBe(true);
    expect(ownsResource(identity, 'another-user')).toBe(true);
  });

  test('normal users cannot access another user resource', () => {
    const identity = normalizeIdentity({ uid: 'u1', role: 'USER' });
    expect(ownsResource(identity, 'u1')).toBe(true);
    expect(ownsResource(identity, 'u2')).toBe(false);
  });
});
