/**
 * Server-side client for the authenticated Br3eze supplier provisioning API.
 * Supply a request-scoped access-token callback; never place API credentials
 * in product documents or client-side application bundles.
 */
function resolveApiBase(env = process.env) {
  const raw = String(env.AGENTOS_API_BASE_URL || env.BR3EZE_API_BASE_URL || '').trim();
  if (!raw) throw new Error('AGENTOS_API_BASE_URL is required for supplier provisioning client');
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(env.NODE_ENV === 'test' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('AgentOS API base URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('AgentOS API base URL cannot contain credentials, query, or fragment');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

export function createSupplierProvisioningClient({ env = process.env, fetchImpl = globalThis.fetch, getAccessToken } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  if (typeof getAccessToken !== 'function') throw new TypeError('A request-scoped getAccessToken function is required');

  async function request(path, { method = 'GET', body = null, idempotencyKey = null } = {}) {
    const base = resolveApiBase(env);
    const token = String(await getAccessToken() || '').trim();
    if (!token) throw new Error('Authenticated API access token is required');
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await fetchImpl(new URL(path.replace(/^\/+/, ''), base), {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* handle below without exposing response text */ }
    if (!response.ok && response.status !== 202) {
      const error = new Error(typeof payload.error === 'string' ? payload.error : `Supplier provisioning API failed (HTTP ${response.status})`);
      error.status = response.status;
      error.code = payload.code || 'SUPPLIER_PROVISIONING_API_ERROR';
      throw error;
    }
    return payload;
  }

  return {
    async getSupplierReference({ productId }) {
      if (typeof productId !== 'string' || !productId.trim()) throw new TypeError('productId is required');
      return request(`api/v1/shop/products/${encodeURIComponent(productId)}/supplier-reference`);
    },
    async provisionProduct({ productId, quantity, idempotencyKey, approval }) {
      if (typeof productId !== 'string' || !productId.trim()) throw new TypeError('productId is required');
      if (!Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) throw new TypeError('quantity must be a positive integer');
      if (!idempotencyKey || typeof idempotencyKey !== 'string') throw new TypeError('idempotencyKey is required');
      return request('api/v1/shop/supplier-orders', {
        method: 'POST',
        idempotencyKey,
        body: { productId, quantity: Number(quantity), idempotencyKey, approvalId: approval?.approvalId },
      });
    },
  };
}

export { resolveApiBase };
