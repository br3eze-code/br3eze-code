import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

function matchesFilter(event, filter) {
  if (event.tenantId !== filter.tenantId) return false;
  if (filter.meshGroupId && event.meshGroupId !== filter.meshGroupId) return false;
  if (filter.siteId && event.siteId !== filter.siteId) return false;
  if (filter.nodeId && event.nodeId !== filter.nodeId) return false;
  if (filter.types?.length && !filter.types.includes(event.type)) return false;
  return true;
}

export class MeshNotificationHub extends EventEmitter {
  constructor({ maxSubscribersPerTenant = 1000 } = {}) {
    super();
    this.maxSubscribersPerTenant = maxSubscribersPerTenant;
    this.subscribers = new Map();
    this.tenantCounts = new Map();
  }

  subscribe(filter, send) {
    if (!filter?.tenantId || typeof send !== 'function') throw new Error('tenantId and send callback are required');
    const count = this.tenantCounts.get(filter.tenantId) || 0;
    if (count >= this.maxSubscribersPerTenant) {
      const error = new Error('Tenant notification subscriber limit reached');
      error.code = 'MESH_NOTIFICATION_LIMIT_REACHED';
      error.status = 429;
      throw error;
    }
    const subscriptionId = `mesh_sub_${crypto.randomUUID()}`;
    const subscription = { subscriptionId, filter: { ...filter }, send };
    this.subscribers.set(subscriptionId, subscription);
    this.tenantCounts.set(filter.tenantId, count + 1);
    return () => this.unsubscribe(subscriptionId);
  }

  unsubscribe(subscriptionId) {
    const subscription = this.subscribers.get(subscriptionId);
    if (!subscription) return false;
    this.subscribers.delete(subscriptionId);
    const count = this.tenantCounts.get(subscription.filter.tenantId) || 1;
    if (count <= 1) this.tenantCounts.delete(subscription.filter.tenantId);
    else this.tenantCounts.set(subscription.filter.tenantId, count - 1);
    return true;
  }

  publish(event) {
    if (!event?.tenantId || !event.type) return 0;
    const normalized = {
      eventId: event.eventId || `mesh_evt_${crypto.randomUUID()}`,
      occurredAt: event.occurredAt || new Date().toISOString(),
      severity: event.severity || 'info',
      ...event
    };
    let delivered = 0;
    for (const subscription of this.subscribers.values()) {
      if (!matchesFilter(normalized, subscription.filter)) continue;
      try {
        subscription.send(normalized);
        delivered += 1;
      } catch {
        this.unsubscribe(subscription.subscriptionId);
      }
    }
    this.emit('event', normalized);
    return delivered;
  }

  close() {
    for (const subscriptionId of this.subscribers.keys()) this.unsubscribe(subscriptionId);
    this.removeAllListeners();
  }
}

export default MeshNotificationHub;
