/**
 * Domain-neutral logistics boundary. Courier/carrier integrations implement
 * this contract; commerce, inventory and order domains never depend on a
 * specific courier SDK.
 */
export class CourierRegistry {
  constructor({ adapters = [] } = {}) {
    this.adapters = new Map();
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) {
    if (!adapter?.id || typeof adapter.createShipment !== 'function') {
      throw new TypeError('Courier adapter requires id and createShipment()');
    }
    this.adapters.set(String(adapter.id), adapter);
    return adapter;
  }

  get(id) { return this.adapters.get(String(id)); }
  list() { return [...this.adapters.values()].map(({ id, capabilities = [], countries = [] }) => ({ id, capabilities: [...capabilities], countries: [...countries] })); }

  resolve({ courier, capability } = {}) {
    if (courier) return this.get(courier);
    return [...this.adapters.values()].find(a => !capability || a.capabilities?.includes(capability));
  }
}

export function normalizeShipment({ provider, externalId, orderId, status, trackingNumber, origin, destination, parcels = [], events = [] }) {
  if (!provider || !externalId) throw new TypeError('Shipment requires provider and externalId');
  return Object.freeze({
    provider: String(provider),
    externalId: String(externalId),
    orderId: orderId ? String(orderId) : undefined,
    status: String(status || 'created'),
    trackingNumber: trackingNumber ? String(trackingNumber) : undefined,
    origin: origin ? { ...origin } : undefined,
    destination: destination ? { ...destination } : undefined,
    parcels: parcels.map(p => ({ ...p })),
    events: events.map(e => ({ ...e }))
  });
}

export default CourierRegistry;
