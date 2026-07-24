'use strict';
/**
 * auth.js is the shim src/core/agent.js and channel handlers call to gate
 * every tool invocation. It was at 0% coverage. These tests exercise it
 * against the real UserSandbox + the real src/policies/roles.json role
 * definitions (only the db lookup is faked), so a regression in either the
 * shim or the underlying RBAC/approval/rate-limit logic shows up here.
 */

const { authorize, getUserSandbox, AuthError } = require('../../src/core/auth');
const { audit } = require('../../src/core/audit');

function makeDb(usersByRole) {
  return {
    getUser: jest.fn(async userId => {
      const role = usersByRole[userId];
      return role ? { role } : null;
    }),
  };
}

describe('authorize()', () => {
  let auditSpy;

  beforeEach(() => {
    auditSpy = jest.spyOn(audit, 'log').mockResolvedValue({});
  });

  afterEach(() => {
    auditSpy.mockRestore();
  });

  test('throws AuthError with TOOL_NOT_ALLOWED for a tool outside the role allow-list', async () => {
    getUserSandbox({ db: makeDb({ u1: 'viewer' }), approvalStore: new Map() });

    await expect(authorize({ userId: 'u1', tool: 'user.kick' })).rejects.toMatchObject({
      name: 'AuthError',
      code: 'TOOL_NOT_ALLOWED',
    });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tool: 'user.kick', status: 'DENIED' })
    );
  });

  test('returns needs_approval and records the approval request when the role requires approval', async () => {
    // viewer's tools include system.stats, but requireApproval is ["*"]
    getUserSandbox({ db: makeDb({ u1: 'viewer' }), approvalStore: new Map() });

    const result = await authorize({ userId: 'u1', tool: 'system.stats' });

    expect(result.status).toBe('needs_approval');
    expect(result.approvalId).toMatch(/^appr-/);
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tool: 'system.stats', status: 'PENDING_APPROVAL', approvalId: result.approvalId })
    );

    const sandbox = getUserSandbox();
    expect(sandbox.listPendingApprovals()).toContainEqual(
      expect.objectContaining({ id: result.approvalId, userId: 'u1', toolName: 'system.stats' })
    );
  });

  test('operator role requires approval for a firewall wildcard match', async () => {
    getUserSandbox({ db: makeDb({ u1: 'operator' }), approvalStore: new Map() });

    const result = await authorize({ userId: 'u1', tool: 'mikrotik.firewall.block' });
    expect(result.status).toBe('needs_approval');
  });

  test('admin role is allowed and needs no approval', async () => {
    getUserSandbox({ db: makeDb({ u1: 'admin' }), approvalStore: new Map() });

    const result = await authorize({ userId: 'u1', tool: 'system.reboot' });

    expect(result).toEqual({ status: 'ok' });
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tool: 'system.reboot', status: 'ALLOWED' })
    );
  });

  test('accepts a tool object with a .name property, not just a bare string', async () => {
    getUserSandbox({ db: makeDb({ u1: 'admin' }), approvalStore: new Map() });

    const result = await authorize({ userId: 'u1', tool: { name: 'system.stats' } });
    expect(result).toEqual({ status: 'ok' });
  });

  test('an unknown user falls back to the "user" role rather than being granted access', async () => {
    getUserSandbox({ db: makeDb({}), approvalStore: new Map() });

    await expect(authorize({ userId: 'ghost', tool: 'user.kick' })).rejects.toMatchObject({
      code: 'TOOL_NOT_ALLOWED',
    });
  });

  test('propagates a RATE_LIMITED AuthError once a role exceeds 30 calls/min for the same tool', async () => {
    getUserSandbox({ db: makeDb({ u1: 'admin' }), approvalStore: new Map() });

    for (let i = 0; i < 30; i++) {
      await expect(authorize({ userId: 'u1', tool: 'ping' })).resolves.toEqual({ status: 'ok' });
    }

    await expect(authorize({ userId: 'u1', tool: 'ping' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  test('rate limits are tracked per user+tool, not globally', async () => {
    getUserSandbox({ db: makeDb({ u1: 'admin', u2: 'admin' }), approvalStore: new Map() });

    for (let i = 0; i < 30; i++) {
      await authorize({ userId: 'u1', tool: 'traceroute' });
    }
    // u2 has made zero calls to this tool, so it should still succeed
    await expect(authorize({ userId: 'u2', tool: 'traceroute' })).resolves.toEqual({ status: 'ok' });
  });
});

describe('AuthError', () => {
  test('defaults to code FORBIDDEN when none is given', () => {
    const err = new AuthError('nope');
    expect(err.code).toBe('FORBIDDEN');
    expect(err.name).toBe('AuthError');
  });
});
