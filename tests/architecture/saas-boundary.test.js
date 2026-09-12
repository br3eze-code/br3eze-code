import { assert } from 'node:assert';
import {
  createTenantContext,
  assertTenantScope,
  assertEntitlement,
  recordUsage,
  normalizeSubscription,
} from '../../src/core/saas-boundary.js';

describe('domain-neutral SaaS boundary', () => {
  test('requires authenticated tenant context and active membership', () => {
    const context = createTenantContext({
      tenantId: 'tenant-a',
      userId: 'user-a',
      memberships: [{ tenantId: 'tenant-a', userId: 'user-a', role: 'owner', status: 'active' }],
      entitlements: ['agent.execute'],
    });
    assert.equal(context.role, 'owner');
    assert.doesNotThrow(() => assertTenantScope(context, { tenantId: 'tenant-a' }));
    assert.throws(() => assertTenantScope(context, { tenantId: 'tenant-b' }), /tenant scope violation/);
  });

  test('does not permit entitlement bypass', () => {
    const context = createTenantContext({ tenantId: 'tenant-a', userId: 'user-a' });
    assert.throws(() => assertEntitlement(context, 'agent.execute'), /entitlement required/);
  });

  test('usage is tenant-scoped and rejects invalid quantities', () => {
    const usage = recordUsage({ tenantId: 'tenant-a', metric: 'ai.operations', quantity: 3, unit: 'operation', idempotencyKey: 'evt-1' });
    assert.equal(usage.tenantId, 'tenant-a');
    assert.throws(() => recordUsage({ tenantId: 'tenant-a', metric: 'ai.operations', quantity: -1 }), /non-negative/);
  });

  test('subscription normalization is provider-neutral', () => {
    const subscription = normalizeSubscription({ tenantId: 'tenant-a', planId: 'business', status: 'active' });
    assert.equal(subscription.planId, 'business');
    assert.equal(subscription.providerCustomerId, null);
  });
});
