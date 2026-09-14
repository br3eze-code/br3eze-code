import { afterEach, describe, expect, test } from '@jest/globals';
import {
  registerNetworkProvider,
  clearNetworkProvider,
  getNetworkProvider,
  registerBillingProvider,
  clearBillingProvider,
  createBilling,
  registerDatabaseProvider,
  clearDatabaseProvider,
  getDatabase,
} from '../../src/core/ports/index.js';

afterEach(() => {
  clearNetworkProvider();
  clearBillingProvider();
  clearDatabaseProvider();
});

describe('Core capability ports', () => {
  test('registers and retrieves a network provider without knowing its implementation', () => {
    const provider = { getManager: () => ({}) };
    expect(registerNetworkProvider(provider)).toBe(provider);
    expect(getNetworkProvider()).toBe(provider);
  });

  test('creates a billing implementation supplied by the host', () => {
    class Billing { constructor(config) { this.config = config; } }
    registerBillingProvider(Billing);
    expect(createBilling({ tenantId: 't1' })).toEqual({ config: { tenantId: 't1' } });
  });

  test('keeps persistence behind a provider contract', async () => {
    const database = { name: 'test-db' };
    registerDatabaseProvider({ getDatabase: async () => database });
    await expect(getDatabase()).resolves.toBe(database);
  });
});
