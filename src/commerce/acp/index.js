/**
 * Agentic Commerce Protocol (ACP) alignment boundary.
 *
 * IMPORTANT: this module is deliberately an internal adapter boundary, not a
 * claim of ACP certification or production ChatGPT checkout compatibility.
 * It keeps ACP-shaped concerns out of the core shop implementation so the
 * protocol can evolve independently of the merchant's commerce engine.
 *
 * The current stable ACP snapshot (2026-04-17) includes feed, cart, orders,
 * authentication and checkout concerns. Keep protocol-version-specific HTTP
 * handlers outside this mapping layer.
 */

const ACP_VERSION = '2026-04-17';

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAvailability(product) {
  if (product?.availability) return String(product.availability);
  const stock = finiteNumber(product?.stock, 0);
  return stock > 0 ? 'in_stock' : 'out_of_stock';
}

/**
 * Convert an internal product into a stable, machine-facing commerce record.
 * This intentionally does not expose the raw Firestore document.
 */
export function toCommerceProduct(product, { publicUrl = process.env.PUBLIC_URL || 'https://br3eze.africa' } = {}) {
  if (!product?.id) throw new Error('Product id is required');

  const price = finiteNumber(product.price, 0);
  const currency = String(product.currency || 'USD').toUpperCase();

  return {
    id: String(product.id),
    title: String(product.name || product.title || product.id),
    description: product.description ? String(product.description) : '',
    brand: product.brand ? String(product.brand) : undefined,
    category: product.category ? String(product.category) : undefined,
    sku: product.sku ? String(product.sku) : undefined,
    price,
    currency,
    availability: normalizeAvailability(product),
    quantity: Math.max(0, finiteNumber(product.stock, 0)),
    url: `${publicUrl.replace(/\/$/, '')}/product/${encodeURIComponent(product.id)}`,
    image: product.image || product.imageUrl || product.images?.[0] || undefined,
    images: Array.isArray(product.images) ? product.images : undefined,
    variants: Array.isArray(product.variants) ? product.variants : undefined,
    sizes: Array.isArray(product.sizes) ? product.sizes : undefined,
    rating: Number.isFinite(Number(product.rating)) ? Number(product.rating) : undefined,
    reviewCount: Number.isFinite(Number(product.reviewCount)) ? Number(product.reviewCount) : undefined,
  };
}

export function toCommerceProductFeed(products = [], options = {}) {
  return products.map((product) => toCommerceProduct(product, options));
}

/**
 * Produce a merchant-neutral checkout snapshot from the existing order/cart
 * model. No payment token is accepted or interpreted here.
 */
export function toCheckoutSnapshot({
  id,
  items = [],
  subtotal = 0,
  shipping = 0,
  total = 0,
  currency = 'USD',
  status = 'pending_payment',
  fulfillmentStatus = 'unfulfilled',
  shippingAddress,
} = {}) {
  return {
    id: id ? String(id) : undefined,
    items: items.map((item) => ({
      productId: String(item.productId || item.id || ''),
      title: String(item.name || item.title || item.productId || ''),
      quantity: Math.max(0, finiteNumber(item.qty ?? item.quantity, 0)),
      unitPrice: finiteNumber(item.price ?? item.unitPrice, 0),
      currency: String(item.currency || currency).toUpperCase(),
      variant: item.size || item.variant || undefined,
    })),
    subtotal: finiteNumber(subtotal),
    shipping: finiteNumber(shipping),
    total: finiteNumber(total),
    currency: String(currency).toUpperCase(),
    status: String(status),
    fulfillmentStatus: String(fulfillmentStatus),
    shippingAddress: shippingAddress || undefined,
  };
}

/**
 * Validate an idempotency key at the adapter boundary. The actual persistence
 * and replay semantics belong to the order/payment transaction layer and are
 * intentionally not faked here.
 */
export function requireIdempotencyKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 255) {
    const error = new Error('A valid idempotency key is required for agentic commerce mutations.');
    error.status = 400;
    throw error;
  }
  return key;
}

export function getAcpAlignmentInfo() {
  return {
    protocol: 'Agentic Commerce Protocol',
    version: ACP_VERSION,
    status: 'adapter-boundary-only',
    checkoutEngine: 'src/core/shop.js',
    catalogEngine: 'src/core/shop.js',
    note: 'This module does not by itself make the merchant eligible for or connected to ChatGPT commerce.',
  };
}

export default {
  ACP_VERSION,
  toCommerceProduct,
  toCommerceProductFeed,
  toCheckoutSnapshot,
  requireIdempotencyKey,
  getAcpAlignmentInfo,
};
