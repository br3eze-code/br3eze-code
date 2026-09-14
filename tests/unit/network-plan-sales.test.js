import { createPlanSales, planExpiry } from '../../src/domains/network/plan-sales.js';

describe('network plan sales domain', () => {
  function fakeDatabase(user = { username: 'alice', credits: 10, subscriptions: [] }) {
    const plan = { id: 'daily', name: 'Daily', price: 2, durationValue: 1, durationUnit: 'day', deviceLimit: 2, dataLimit: 0, active: true };
    const tx = {
      get: async () => ({ exists: true, data: () => ({ ...user }) }),
      update: (_ref, update) => { tx.lastUpdate = update; }
    };
    const fs = {
      collection: (name) => ({
        doc: (id) => ({
          async get() {
            if (name === 'plans' && id === plan.id) return { exists: true, id, data: () => ({ ...plan }) };
            return { exists: false };
          }
        }),
        async get() {
          if (name === 'plans') return { docs: [{ id: plan.id, data: () => ({ ...plan }) }] };
          return { docs: [] };
        }
      }),
      runTransaction: async (fn) => { const result = await fn(tx); return result; }
    };
    return { db: fs, tx, plan };
  }

  test('expires plans using the configured duration', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(planExpiry({ durationValue: 7, durationUnit: 'days' }, start).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });

  test('buys a plan without importing a concrete network provider', async () => {
    const fake = fakeDatabase();
    const log = { info: jest.fn(), warn: jest.fn() };
    const sales = createPlanSales({ database: async () => fake, log });
    const result = await sales.buyPlan('uid-1', 'daily');
    expect(result.paid).toBe(true);
    expect(result.provisioned).toBe(false);
    expect(fake.tx.lastUpdate.credits).toBe(8);
    expect(fake.tx.lastUpdate.subscriptions).toHaveLength(1);
  });

  test('delegates access provisioning through an injected adapter', async () => {
    const fake = fakeDatabase();
    const provisionPlanAccess = jest.fn().mockResolvedValue({ ok: true });
    const sales = createPlanSales({ database: async () => fake, provisioner: { provisionPlanAccess }, log: { info: jest.fn(), warn: jest.fn() } });
    const result = await sales.buyPlan('uid-1', 'daily');
    expect(result.provisioned).toBe(true);
    expect(provisionPlanAccess).toHaveBeenCalledWith(expect.objectContaining({ username: 'alice', profile: 'daily', sharedUsers: 2 }));
  });
});
