import { describe, expect, jest, test } from '@jest/globals';

const seed = { id: 'printer-1', name: 'Office Printer', category: 'printers', brand: 'Neutral', price: 100, stock: 4 };
const candidates = [
  { id: 'printer-2', name: 'Office Printer Pro', category: 'printers', brand: 'Neutral', price: 110, stock: 2 },
  { id: 'cable-1', name: 'Network Cable', category: 'network', brand: 'Other', price: 10, stock: 8 },
];

jest.unstable_mockModule('../../../src/core/shop.js', () => ({
  listProducts: jest.fn(),
  getProduct: jest.fn(async () => seed),
  productUrl: jest.fn((id) => `https://example.test/product/${id}`),
  orderUrl: jest.fn((id) => `https://example.test/order/${id}`),
  relatedProducts: jest.fn(async () => candidates),
  getCart: jest.fn(),
  addToCart: jest.fn(),
  removeFromCart: jest.fn(),
  clearCart: jest.fn(),
  checkout: jest.fn(),
  createShipment: jest.fn(),
  trackShipment: jest.fn(),
  getPaymentMethods: jest.fn(() => []),
  submitReview: jest.fn(),
  getReviews: jest.fn(),
}));

const { default: ShopSkill } = await import('../../../src/skills/shop/index.js');
const { buildExecutionContext } = await import('../../../src/core/execution-context.js');

describe('Linux shopping recommendations', () => {
  test('uses the vision ranker and returns a scoped WBS user loop', async () => {
    const skill = new ShopSkill({}, { warn: jest.fn() });
    const context = buildExecutionContext({
      channel: 'linux',
      userId: 'user-1',
      tenantId: 'tenant-1',
      domain: 'shopping',
      siteId: 'site-1',
      wbs: [],
    });

    const result = await skill.execute('shop.recommend_products', { productRef: 'printer-1', limit: 2 }, context);

    expect(result.success).toBe(true);
    expect(result.products[0].id).toBe('printer-2');
    expect(result.scope).toEqual({ tenantId: 'tenant-1', domain: 'shopping', siteId: 'site-1' });
    expect(result.wbsSummary.total).toBe(5);
    expect(result.nextAction.key).toBe('observe');
    expect(result.products[0].url).toContain('/product/printer-2');
  });

  test('exposes the canonical scope alias for agent skills', () => {
    const context = buildExecutionContext({ userId: 'user-1', tenantId: 'tenant-1', domain: 'shopping', siteId: 'site-1' });
    expect(context.scope).toEqual({ tenantId: 'tenant-1', domain: 'shopping', siteId: 'site-1' });
  });
});
