import { describe, expect, test } from '@jest/globals';
import { normalizePublicProduct } from '../../src/domains/commerce/shop.js';

describe('public shop product supplier metadata', () => {
  test('keeps HTTPS supplier reference links while hiding supplier costs and credentials', () => {
    const product = normalizePublicProduct('p-1', {
      name: 'Access point', price: 35, supplierId: 'supplier-a', supplierSku: 'AP-1',
      supplierReferenceUrl: 'https://supplier.example/catalog/AP-1',
      supplierUnitCost: 22, supplierCost: 21, supplierApiToken: 'secret',
      supplierCredentials: { token: 'secret' },
    });
    expect(product).toMatchObject({
      id: 'p-1', name: 'Access point', price: 35, supplierId: 'supplier-a',
      supplierSku: 'AP-1', supplierReferenceUrl: 'https://supplier.example/catalog/AP-1',
    });
    expect(product).not.toHaveProperty('supplierUnitCost');
    expect(product).not.toHaveProperty('supplierCost');
    expect(product).not.toHaveProperty('supplierApiToken');
    expect(product).not.toHaveProperty('supplierCredentials');
  });

  test('removes unsafe supplier URLs instead of passing them to the shopping agent', () => {
    expect(normalizePublicProduct('p-2', { supplierReferenceUrl: 'javascript:alert(1)' }))
      .not.toHaveProperty('supplierReferenceUrl');
    expect(normalizePublicProduct('p-3', { supplierUrl: 'https://user:pass@supplier.example/item' }))
      .not.toHaveProperty('supplierReferenceUrl');
  });
});
