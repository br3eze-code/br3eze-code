import eventBus from './eventBus.js';

const sent = new Set();
let adapters = [];

export function registerNotificationAdapter(adapter) {
  if (!adapter || typeof adapter.send !== 'function') throw new TypeError('Notification adapter must implement send');
  adapters = [...adapters.filter((item) => item.name !== adapter.name), adapter];
  return adapter;
}

export function clearNotificationAdapters() {
  adapters = [];
  sent.clear();
}

export function getNotificationAdapters() {
  return [...adapters];
}

export async function dispatchNotification(notification = {}) {
  const eventId = String(notification.idempotencyKey || notification.eventId || '');
  if (!eventId) throw new TypeError('Notification idempotencyKey is required');
  if (sent.has(eventId)) return { eventId, skipped: true, results: [] };

  const results = await Promise.allSettled(adapters.map((adapter) => adapter.send({ ...notification, eventId })));
  sent.add(eventId);
  const normalized = results.map((result, index) => ({
    adapter: adapters[index].name,
    ok: result.status === 'fulfilled',
    result: result.status === 'fulfilled' ? result.value : undefined,
    error: result.status === 'rejected' ? result.reason?.message : undefined,
  }));
  eventBus.emit('notification.dispatched', { eventId, notification, results: normalized });
  return { eventId, skipped: false, results: normalized };
}

export function createNoopEmailAdapter({ from = 'no-reply@br3eze.africa' } = {}) {
  return {
    name: 'email.noop',
    from,
    async send(message) {
      return { queued: false, disabled: true, from, to: message.to || [] };
    },
  };
}

export function createPwaAdapter() {
  return {
    name: 'pwa',
    async send(message) {
      eventBus.emit('pwa.notification', message);
      return { queued: true, channel: 'pwa' };
    },
  };
}
