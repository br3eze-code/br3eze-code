import { jest } from '@jest/globals';
import { ApprovalWorkflow } from '../../src/core/approval-gates.js';

describe('ApprovalGate', () => {
  let records;
  let gate;
  let notified;
  const db = {
    async set(key, value) { records.set(key, structuredClone(value)); },
    async get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async compareAndSet(key, expected, next) {
      const current = records.get(key);
      if (!current || current.status !== expected) return false;
      records.set(key, structuredClone(next));
      return true;
    },
  };

  beforeEach(() => {
    records = new Map();
    notified = [];
    gate = new ApprovalWorkflow({
      persistence: () => db,
      notify: async (payload) => { notified.push(payload); return { ok: true }; },
      ttlMs: 60_000,
    });
  });

  test('persists a pending action and emits an idempotent notification', async () => {
    const pending = await gate.request({
      toolName: 'billing.refund',
      params: { orderId: 'O-1', amount: 10 },
      context: { tenantId: 'tenant-a', userId: 'user-a' },
    });
    expect(pending.status).toBe('AWAITING_APPROVAL');
    expect(records.get('agentos:approval:' + pending.actionId).status).toBe('PENDING');
    expect(notified[0].idempotencyKey).toBe('approval-request:' + pending.actionId);
  });

  test('rejects cross-tenant approval and unauthorized approvers', async () => {
    const pending = await gate.request({ toolName: 'inventory.delete', params: {}, context: { tenantId: 'a', userId: 'u' } });
    await expect(gate.decide({ actionId: pending.actionId, decision: 'APPROVED', actor: 'admin', tenantId: 'b', authorize: async () => true })).rejects.toThrow(/Cross-tenant/);
    await expect(gate.decide({ actionId: pending.actionId, decision: 'APPROVED', actor: 'user', tenantId: 'a', authorize: async () => false })).rejects.toThrow(/not authorized/);
  });

  test('does not consume a pending request when the executor is missing', async () => {
    const pending = await gate.request({ toolName: 'inventory.delete', params: {}, context: { tenantId: 'a', userId: 'u' } });
    await expect(gate.resume({ actionId: pending.actionId, actor: 'admin', tenantId: 'a', authorize: async () => true }))
      .rejects.toThrow(/execute callback is required/);
    expect(records.get('agentos:approval:' + pending.actionId).status).toBe('PENDING');
  });

  test('executes an approved action once and rejects replay', async () => {
    const pending = await gate.request({ toolName: 'billing.refund', params: { amount: 3 }, context: { tenantId: 'a', userId: 'u' } });
    const execute = jest.fn(async () => ({ refunded: true }));
    const result = await gate.resume({ actionId: pending.actionId, actor: 'admin', tenantId: 'a', authorize: async () => true, execute });
    expect(result.status).toBe('EXECUTED');
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(gate.resume({ actionId: pending.actionId, actor: 'admin', tenantId: 'a', authorize: async () => true, execute })).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
