import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('PHP data endpoint contract', () => {
  test('defines provider-neutral tenant-scoped resources', () => {
    const source = read('www/data_api.php');
    for (const resource of ['products', 'users', 'plans', 'tickets', 'orders']) expect(source).toContain(`'${resource}'`);
    expect(source).toContain('agentos_context(true)');
    expect(source).toContain('agentos_require_mutation_approval');
    expect(source).toContain('agentos_idempotency_key');
    expect(source).toContain('tenant_id = ?');
  });

  test('validates order quantities and stock server-side', () => {
    const source = read('www/data_api.php');
    expect(source).toContain('FILTER_VALIDATE_INT');
    expect(source).toContain('stock >= ?');
    expect(source).toContain('INSERT INTO orders');
    expect(source).toContain('pdo->beginTransaction');
  });

  test('frontend routes product reads through DataStore', () => {
    expect(read('www/js/shop.js')).toContain('this.products = await DataStore.getProducts();');
    expect(read('www/js/06.firebase.js')).toContain("apiData('products')");
  });
});
