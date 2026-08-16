import { jest } from '@jest/globals';
import { assertBotContext, CONTEXT_TYPES, normalizeBotContext } from '../../src/core/bot.ai.js';
import { CctvDataAnalyst, DataAnalystRegistry, ShoppingDataAnalyst } from '../../src/core/data-analyst.js';

describe('canonical bot context', () => {
  test('normalizes context type and gates location without consent', () => {
    const context = normalizeBotContext({
      userId: 'user-1',
      tenantId: 'tenant-1',
      domain: 'cctv',
      location: { latitude: 1, longitude: 2 },
      neuralLinks: [{ from: 'user-1', to: 'site-1', type: 'assigned' }],
    }, { contextType: CONTEXT_TYPES.ANALYSIS });
    expect(context.contextType).toBe('analysis');
    expect(context.location).toBeNull();
    expect(context.neuralLinks[0].scope.tenantId).toBe('tenant-1');
    expect(() => assertBotContext(context)).not.toThrow();
  });

  test('rejects mutation contexts without explicit approval', () => {
    const context = normalizeBotContext({ userId: 'user-1', tenantId: 'tenant-1' }, { contextType: CONTEXT_TYPES.TASK });
    expect(() => assertBotContext(context, { mutation: true })).toThrow('Explicit approval');
  });
});

describe('domain analysts', () => {
  const context = { userId: 'user-1', tenantId: 'tenant-1', siteId: 'site-1', authorizedSiteIds: ['site-1'] };

  test('CCTV analyst excludes foreign tenant and site records', () => {
    const result = new CctvDataAnalyst().analyze({
      devices: [
        { id: 'd1', tenantId: 'tenant-1', siteId: 'site-1', online: true },
        { id: 'd2', tenantId: 'tenant-2', siteId: 'site-1', online: false },
      ],
      channels: [{ id: 'c1', tenantId: 'tenant-1', siteId: 'site-1' }],
      events: [{ id: 'e1', tenantId: 'tenant-1', siteId: 'site-1', severity: 'high' }],
    }, context);
    expect(result.metrics.deviceCount).toBe(1);
    expect(result.metrics.highSeverityEventCount).toBe(1);
    expect(result.scope.tenantId).toBe('tenant-1');
  });

  test('shopping analyst calculates scoped conversion and revenue', () => {
    const result = new ShoppingDataAnalyst().analyze({
      products: [{ id: 'p1', tenantId: 'tenant-1', siteId: 'site-1', stock: 0 }],
      carts: [{ id: 'c1', tenantId: 'tenant-1', siteId: 'site-1' }],
      orders: [{ id: 'o1', tenantId: 'tenant-1', siteId: 'site-1', status: 'paid', total: 25 }],
    }, context);
    expect(result.metrics.grossRevenue).toBe(25);
    expect(result.metrics.conversionRate).toBe(1);
    expect(result.risks[0].code).toBe('STOCKOUTS');
  });

  test('registry resolves domain-neutral aliases', () => {
    const registry = new DataAnalystRegistry();
    expect(registry.analyze('shop', { products: [], carts: [], orders: [] }, context).domain).toBe('shopping');
    expect(() => registry.analyze('unknown', {}, context)).toThrow('No analyst registered');
  });
});

jest.useRealTimers();
