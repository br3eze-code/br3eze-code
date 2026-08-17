import { randomUUID } from 'node:crypto';

export class InventoryBusinessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InventoryBusinessError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Adapter boundary for inventory persistence. The specialist never depends on
 * Firestore, SQL, or a POS API; production adapters can implement this shape.
 */
export class InventoryAdapter {
  async get(_sku) {
    throw new Error('InventoryAdapter.get must be implemented');
  }

  async reserve(_input) {
    throw new Error('InventoryAdapter.reserve must be implemented');
  }
}

/**
 * Deterministic in-memory adapter used by the Phase 1 vertical and tests.
 * Reservation and stock updates occur together so an accepted reservation
 * cannot observe stale availability within the same adapter instance.
 */
export class InMemoryInventoryAdapter extends InventoryAdapter {
  constructor(items = []) {
    super();
    this.items = new Map();
    this.reservations = new Map();
    for (const item of items) this.seed(item);
  }

  seed({ sku, quantity, reserved = 0, name = sku }) {
    if (!sku || !Number.isInteger(quantity) || quantity < 0) {
      throw new TypeError(
        'Inventory seed requires a non-empty sku and non-negative integer quantity'
      );
    }
    if (!Number.isInteger(reserved) || reserved < 0 || reserved > quantity) {
      throw new TypeError('Inventory seed reserved quantity must be between zero and quantity');
    }
    this.items.set(sku, { sku, name, quantity, reserved });
    return this.get(sku);
  }

  async get(sku) {
    const item = this.items.get(sku);
    return item ? { ...item, available: item.quantity - item.reserved } : null;
  }

  async reserve({ sku, quantity, orderId, idempotencyKey }) {
    const existing = this.reservations.get(idempotencyKey);
    if (existing) return { ...existing, idempotent: true };

    const item = this.items.get(sku);
    if (!item) {
      throw new InventoryBusinessError('UNKNOWN_SKU', `Unknown SKU: ${sku}`, { sku });
    }

    const available = item.quantity - item.reserved;
    if (available < quantity) {
      throw new InventoryBusinessError('INSUFFICIENT_STOCK', `Insufficient stock for SKU: ${sku}`, {
        sku,
        requested: quantity,
        available,
      });
    }

    item.reserved += quantity;
    const reservation = {
      reservationId: `res_${randomUUID()}`,
      sku,
      quantity,
      orderId,
      status: 'reserved',
      idempotencyKey,
      reservedAt: new Date().toISOString(),
    };
    this.reservations.set(idempotencyKey, reservation);
    return { ...reservation, idempotent: false };
  }
}
