import { describe, expect, test } from '@jest/globals';
import { authenticateBearer, issueUserToken, hasPermission, ownsResource, normalizeIdentity } from './identity.js';

describe('canonical identity authorization', () => {
  test('issues and verifies short-lived signed user tokens without exposing the signing secret', async () => {
    const secret = 'test-signing-secret-that-is-long-enough';
    const token = issueUserToken({ uid: 'user-123', username: 'test-user', role: 'PARTNER' }, secret);
    expect(token).not.toBe(secret);
    const identity = await authenticateBearer(token, { userTokenSecret: secret });
    expect(identity.id).toBe('user-123');
    expect(identity.provider).toBe('local');
    expect(identity.roles).toContain('PARTNER');
    expect(identity.permissions).toContain('orders.create');
    expect(await authenticateBearer(token, { userTokenSecret: 'different-long-secret-value' })).toBeNull();
  });

  test('rejects short signing secrets and malformed user tokens', async () => {
    expect(() => issueUserToken({ uid: 'u1', role: 'USER' }, 'short')).toThrow(/16 characters/);
    expect(await authenticateBearer('not-a-token', { userTokenSecret: 'test-signing-secret-that-is-long-enough' })).toBeNull();
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
