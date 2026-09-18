import eventBus from '../src/core/eventBus.js';
import {
  clearNotificationAdapters,
  createNoopEmailAdapter,
  createPwaAdapter,
  dispatchNotification,
  getNotificationAdapters,
  registerNotificationAdapter,
} from '../src/core/notification-port.js';

afterEach(() => clearNotificationAdapters());

test('keeps email disabled without an integration while preserving sender identity', async () => {
  registerNotificationAdapter(createNoopEmailAdapter());
  const result = await dispatchNotification({ idempotencyKey: 'test-email-1', to: ['user@example.test'] });
  expect(result.results[0]).toMatchObject({ adapter: 'email.noop', ok: true });
  expect(result.results[0].result).toMatchObject({ disabled: true, from: 'no-reply@br3eze.africa' });
});

test('queues PWA notifications and deduplicates retries', async () => {
  registerNotificationAdapter(createPwaAdapter());
  const received = [];
  const listener = (message) => received.push(message);
  eventBus.on('pwa.notification', listener);
  await dispatchNotification({ idempotencyKey: 'order.created:42', type: 'order.created' });
  const retry = await dispatchNotification({ idempotencyKey: 'order.created:42', type: 'order.created' });
  eventBus.off('pwa.notification', listener);
  expect(received).toHaveLength(1);
  expect(retry.skipped).toBe(true);
});

test('replaces adapters by name instead of duplicating them', () => {
  registerNotificationAdapter({ name: 'pwa', send: async () => ({}) });
  registerNotificationAdapter(createPwaAdapter());
  expect(getNotificationAdapters().filter((adapter) => adapter.name === 'pwa')).toHaveLength(1);
});
