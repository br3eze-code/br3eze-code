import { randomUUID } from 'node:crypto';

export type ProductTier = 'guest' | 'standard' | 'partner' | 'pro' | 'enterprise' | 'admin' | 'owner';
export type ProductSource = 'sql' | 'firebase' | 'fallback';
export type ProductFreshness = 'current' | 'projection' | 'stale' | 'unknown';

export interface ProductQueryScope {
  tenantId: string;
  userId: string;
  domain?: string | null;
  siteId?: string | null;
}

export interface ProductQueryFilters {
  name?: string;
  brand?: string;
  tier?: string;
  category?: string;
  availability?: 'in_stock' | 'out_of_stock' | 'unknown';
  sku?: string;
  limit?: number;
}

export interface ProductQueryOptions {
  scope: ProductQueryScope;
  filters?: ProductQueryFilters;
  include?: Array<'description' | 'price' | 'stock' | 'availability' | 'supplierCost'>;
  viewerRole?: string;
  viewerTier?: ProductTier;
  purpose?: 'product_inquiry' | 'sale' | 'restock' | 'analysis';
  source?: 'auto' | 'sql' | 'firebase';
}

export interface ProductRecord {
  id: string;
  tenantId: string;
  siteId: string | null;
  name: string;
  brand: string | null;
  tier: string | null;
  category: string | null;
  sku: string | null;
  description?: string;
  price?: number;
  currency?: string;
  stock?: number;
  reserved?: number;
  available?: number;
  availability?: 'in_stock' | 'out_of_stock' | 'unknown';
  active: boolean;
  source: ProductSource;
  updatedAt?: string | null;
}

export interface ProductQueryResult {
  queryId: string;
  items: ProductRecord[];
  source: ProductSource;
  freshness: ProductFreshness;
  scope: ProductQueryScope;
  degraded: boolean;
  warnings: string[];
}

export interface ProductSqlAdapter {
  queryProducts(input: { scope: ProductQueryScope; filters: ProductQueryFilters }): Promise<unknown[]>;
}

export interface ProductFirebaseAdapter {
  queryProducts(input: { scope: ProductQueryScope; filters: ProductQueryFilters }): Promise<unknown[]>;
}

const TIER_RANK: Record<ProductTier, number> = {
  guest: 0,
  standard: 1,
  partner: 2,
  pro: 3,
  enterprise: 4,
  admin: 5,
  owner: 6,
};

const asText = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
};

const asNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeTier = (value: unknown): ProductTier => {
  const tier = String(value || 'standard').toLowerCase() as ProductTier;
  return tier in TIER_RANK ? tier : 'standard';
};

const normalizeAvailability = (value: unknown, available?: number): ProductRecord['availability'] => {
  if (value === 'in_stock' || value === 'out_of_stock' || value === 'unknown') return value;
  if (available === undefined) return 'unknown';
  return available > 0 ? 'in_stock' : 'out_of_stock';
};

function assertScope(scope: ProductQueryScope): void {
  if (!scope || !scope.tenantId || !scope.userId) {
    throw new Error('tenantId and userId are required for product queries');
  }
}

function normalizeRecord(raw: unknown, source: ProductSource): ProductRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = asText(value.id || value.productId || value.product_id);
  const tenantId = asText(value.tenantId || value.tenant_id);
  const name = asText(value.name || value.title);
  if (!id || !tenantId || !name) return null;

  const stock = asNumber(value.stock ?? value.quantity);
  const reserved = asNumber(value.reserved ?? value.reservedStock) ?? 0;
  const available = asNumber(value.available) ?? (stock === undefined ? undefined : Math.max(0, stock - reserved));
  return {
    id,
    tenantId,
    siteId: asText(value.siteId || value.site_id),
    name,
    brand: asText(value.brand),
    tier: asText(value.tier || value.planTier),
    category: asText(value.category),
    sku: asText(value.sku),
    description: asText(value.description) || undefined,
    price: asNumber(value.price) ?? (asNumber(value.price_cents) === undefined ? undefined : (asNumber(value.price_cents) as number) / 100),
    currency: asText(value.currency) || undefined,
    stock,
    reserved,
    available,
    availability: normalizeAvailability(value.availability, available),
    active: value.active === undefined ? true : Boolean(value.active),
    source,
    updatedAt: asText(value.updatedAt || value.updated_at || value.syncedAt),
  };
}

function matchesFilters(product: ProductRecord, filters: ProductQueryFilters): boolean {
  const contains = (field: string | null | undefined, query: string | undefined): boolean => !query || String(field || '').toLowerCase().includes(query.trim().toLowerCase());
  if (!contains(product.name, filters.name) || !contains(product.brand, filters.brand) || !contains(product.category, filters.category) || !contains(product.sku, filters.sku)) return false;
  if (filters.tier && String(product.tier || '').toLowerCase() !== filters.tier.trim().toLowerCase()) return false;
  if (filters.availability && product.availability !== filters.availability) return false;
  return product.active;
}

function filterFields(product: ProductRecord, options: ProductQueryOptions): ProductRecord {
  const include = new Set(options.include || ['description', 'price', 'availability']);
  const viewerTier = normalizeTier(options.viewerTier);
  const privileged = ['accountant', 'analyst', 'procurement', 'admin', 'owner'].includes(String(options.viewerRole || '').toLowerCase());
  const result = { ...product };
  if (!include.has('description')) delete result.description;
  if (!include.has('price')) { delete result.price; delete result.currency; }
  if (!include.has('stock')) { delete result.stock; delete result.reserved; delete result.available; }
  if (!include.has('availability')) delete result.availability;
  if (!privileged || TIER_RANK[viewerTier] < TIER_RANK.pro) delete (result as ProductRecord & { supplierCost?: number }).supplierCost;
  return result;
}

export class SqlProductAdapter implements ProductSqlAdapter {
  constructor(private readonly db: { prepare(sql: string): { all(...params: unknown[]): unknown[] } }) {}

  async queryProducts({ scope, filters }: { scope: ProductQueryScope; filters: ProductQueryFilters }): Promise<unknown[]> {
    const clauses = ['tenant_id = ?', '(site_id IS NULL OR site_id = ?)', 'active = 1'];
    const params: unknown[] = [scope.tenantId, scope.siteId || null];
    // Optional catalogue columns vary between native SQLite and the PHP fallback.
    // Query only stable scope columns here; ProductQueryService applies optional
    // name/brand/tier/category/SKU predicates after normalization.
    const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 100);
    const rows = this.db.prepare(`SELECT * FROM products WHERE ${clauses.join(' AND ')} LIMIT ${limit}`).all(...params);
    return rows;
  }
}

export class FirebaseProductAdapter implements ProductFirebaseAdapter {
  constructor(private readonly firestore: { collection(name: string): { where(field: string, op: string, value: unknown): any } }, private readonly collectionName = 'products') {}

  async queryProducts({ scope, filters }: { scope: ProductQueryScope; filters: ProductQueryFilters }): Promise<unknown[]> {
    let query: any = this.firestore.collection(this.collectionName).where('tenantId', '==', scope.tenantId);
    const snapshot = await query.get();
    const rows = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    return rows.filter((row: unknown) => {
      const product = normalizeRecord(row, 'firebase');
      return product && (!scope.siteId || !product.siteId || product.siteId === scope.siteId) && matchesFilters(product, filters);
    }).slice(0, Math.min(Math.max(Number(filters.limit || 50), 1), 100));
  }
}

export class ProductQueryService {
  constructor(private readonly adapters: { sql?: ProductSqlAdapter; firebase?: ProductFirebaseAdapter }) {}

  async search(options: ProductQueryOptions): Promise<ProductQueryResult> {
    assertScope(options.scope);
    const filters = options.filters || {};
    const source = options.source || 'auto';
    const queryId = `product_query_${randomUUID()}`;
    const warnings: string[] = [];
    const providers: Array<{ name: 'sql' | 'firebase'; adapter?: ProductSqlAdapter | ProductFirebaseAdapter }> = source === 'sql'
      ? [{ name: 'sql', adapter: this.adapters.sql }]
      : source === 'firebase'
        ? [{ name: 'firebase', adapter: this.adapters.firebase }]
        : [{ name: 'sql', adapter: this.adapters.sql }, { name: 'firebase', adapter: this.adapters.firebase }];

    for (const provider of providers) {
      if (!provider.adapter) { warnings.push(`${provider.name} provider unavailable`); continue; }
      try {
        const rows = await provider.adapter.queryProducts({ scope: options.scope, filters });
        const items = rows.map((row) => normalizeRecord(row, provider.name)).filter((item): item is ProductRecord => Boolean(item)).filter((item) => item.tenantId === options.scope.tenantId && matchesFilters(item, filters)).map((item) => filterFields(item, options));
        if (items.length || source !== 'auto' || provider.name === 'firebase') {
          return { queryId, items, source: provider.name, freshness: provider.name === 'sql' ? 'current' : 'projection', scope: options.scope, degraded: false, warnings };
        }
      } catch (error) {
        warnings.push(`${provider.name} query failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        if (source !== 'auto') break;
      }
    }

    return { queryId, items: [], source: 'fallback', freshness: 'stale', scope: options.scope, degraded: true, warnings: [...warnings, 'No product provider returned a usable result'] };
  }
}
