/**
 * Configured supplier API adapter.
 *
 * Product supplierReferenceUrl values are catalog/reference links only. They
 * are never treated as API endpoints; outbound writes always target the
 * operator-configured BR3EZE_SUPPLIER_API_URL.
 */
function configuredEndpoint(env = process.env) {
  const raw = String(env.BR3EZE_SUPPLIER_API_URL || '').trim();
  if (!raw) {
    const error = new Error('Supplier API is not configured');
    error.code = 'SUPPLIER_API_NOT_CONFIGURED';
    throw error;
  }
  let base;
  try { base = new URL(raw); } catch {
    throw new TypeError('BR3EZE_SUPPLIER_API_URL must be a valid URL');
  }
  if (base.protocol !== 'https:' && !(env.NODE_ENV === 'test' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('Supplier API must use HTTPS');
  }
  if (base.username || base.password || base.search || base.hash) {
    throw new Error('Supplier API base URL must not contain credentials, query, or fragment');
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  return base;
}

function supplierApiError(message, code = 'SUPPLIER_API_ERROR', status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function createSupplierApiAdapter({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required');
  function assertReady() {
    const base = configuredEndpoint(env);
    const token = String(env.BR3EZE_SUPPLIER_API_TOKEN || '').trim();
    if (!token) throw supplierApiError('Supplier API credentials are not configured', 'SUPPLIER_API_NOT_CONFIGURED', 503);
    return { base, token };
  }

  return {
    assertReady,
    async createPurchaseOrder(order) {
      const { base, token } = assertReady();
      const response = await fetchImpl(new URL('purchase-orders', base), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'idempotency-key': order.idempotencyKey,
        },
        body: JSON.stringify({
          supplierId: order.supplierId,
          orderId: order.orderId,
          tenantId: order.tenantId,
          currency: order.lines[0]?.currency,
          items: order.lines.map(({ productId, quantity, unitPrice, currency, supplierSku, supplierReferenceUrl }) => ({
            productId, supplierSku, supplierReferenceUrl, quantity, unitPrice, currency,
          })),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        // Do not include response bodies: suppliers sometimes echo credentials
        // or customer information in their error payloads.
        throw supplierApiError(`Supplier API rejected purchase order (HTTP ${response.status})`, 'SUPPLIER_API_REJECTED', 502);
      }
      let result;
      try { result = await response.json(); } catch {
        throw supplierApiError('Supplier API returned invalid JSON');
      }
      const supplierOrderId = typeof result?.supplierOrderId === 'string' ? result.supplierOrderId.trim() : '';
      if (!supplierOrderId) throw supplierApiError('Supplier API response did not include supplierOrderId');
      return { supplierOrderId, status: typeof result.status === 'string' ? result.status : 'submitted' };
    },
  };
}

export { configuredEndpoint };
