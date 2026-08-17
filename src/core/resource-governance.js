import { randomUUID } from 'node:crypto';

export const RESOURCE_STATES = Object.freeze({ AVAILABLE: 'AVAILABLE', RESERVED: 'RESERVED', COMMITTED: 'COMMITTED', CONSUMED: 'CONSUMED', RELEASED: 'RELEASED' });
const TRANSITIONS = Object.freeze({ AVAILABLE: ['RESERVED'], RESERVED: ['COMMITTED', 'RELEASED'], COMMITTED: ['CONSUMED', 'RELEASED'], CONSUMED: [], RELEASED: [] });

function scopedKey(tenantId, resourceId) {
  return `${tenantId}:${resourceId}`;
}

export class ResourceGovernance {
  constructor({ idFactory = () => `res_${randomUUID()}`, reservationFactory = () => `rsv_${randomUUID()}`, clock = () => Date.now(), store = null } = {}) {
    this.idFactory = idFactory;
    this.reservationFactory = reservationFactory;
    this.clock = clock;
    this.store = store;
    this.resources = new Map();
    this.reservations = new Map();
    this.idempotency = new Map();
  }

  register({ tenantId, siteId = null, resourceId = this.idFactory(), type, quantity = 1, metadata = {} }) {
    if (!tenantId || !type || quantity < 0) throw new TypeError('tenantId, type, and non-negative quantity are required');
    const resource = Object.freeze({ resourceId, tenantId, siteId, type, capacity: quantity, available: quantity, state: RESOURCE_STATES.AVAILABLE, metadata, createdAt: new Date(this.clock()).toISOString() });
    this.resources.set(scopedKey(tenantId, resourceId), resource);
    return resource;
  }

  get({ tenantId, resourceId }) {
    const resource = this.resources.get(scopedKey(tenantId, resourceId));
    if (!resource) throw new Error('Resource not found');
    return resource;
  }

  reserve({ tenantId, siteId = null, resourceId, quantity = 1, requestedBy = null, projectId = null, idempotencyKey }) {
    if (!tenantId || !resourceId || !idempotencyKey || quantity <= 0) throw new TypeError('tenantId, resourceId, positive quantity, and idempotencyKey are required');
    const idem = `${tenantId}:${idempotencyKey}`;
    const prior = this.idempotency.get(idem);
    if (prior) return prior;
    const resource = this.get({ tenantId, resourceId });
    if (resource.siteId && siteId && resource.siteId !== siteId) throw new Error('Resource site mismatch');
    if (resource.available < quantity) throw Object.assign(new Error('Insufficient resource capacity'), { code: 'RESOURCE_UNAVAILABLE' });
    const reservation = Object.freeze({ reservationId: this.reservationFactory(), tenantId, siteId: siteId || resource.siteId, resourceId, quantity, requestedBy, projectId, idempotencyKey, state: RESOURCE_STATES.RESERVED, reservedAt: new Date(this.clock()).toISOString() });
    const updated = Object.freeze({ ...resource, available: resource.available - quantity, state: RESOURCE_STATES.RESERVED });
    this.resources.set(scopedKey(tenantId, resourceId), updated);
    this.reservations.set(reservation.reservationId, reservation);
    this.idempotency.set(idem, reservation);
    this.store?.putReservation?.(reservation);
    return reservation;
  }

  transition({ tenantId, reservationId, nextState, actor = null }) {
    const reservation = this.reservations.get(reservationId) || this.store?.getReservation?.(reservationId);
    if (!reservation || reservation.tenantId !== tenantId) throw new Error('Reservation tenant mismatch');
    if (!TRANSITIONS[reservation.state]?.includes(nextState)) throw Object.assign(new Error(`Invalid reservation transition ${reservation.state} -> ${nextState}`), { code: 'INVALID_RESOURCE_TRANSITION' });
    const updated = Object.freeze({ ...reservation, state: nextState, actor, transitionedAt: new Date(this.clock()).toISOString() });
    this.reservations.set(reservationId, updated);
    if (nextState === RESOURCE_STATES.RELEASED) {
      const resource = this.get({ tenantId, resourceId: reservation.resourceId });
      this.resources.set(scopedKey(tenantId, resource.resourceId), Object.freeze({ ...resource, available: resource.available + reservation.quantity, state: resource.available + reservation.quantity === resource.capacity ? RESOURCE_STATES.AVAILABLE : resource.state }));
    }
    this.store?.putReservation?.(updated);
    return updated;
  }

  commit(input) { return this.transition({ ...input, nextState: RESOURCE_STATES.COMMITTED }); }
  consume(input) { return this.transition({ ...input, nextState: RESOURCE_STATES.CONSUMED }); }
  release(input) { return this.transition({ ...input, nextState: RESOURCE_STATES.RELEASED }); }
}

export default ResourceGovernance;
