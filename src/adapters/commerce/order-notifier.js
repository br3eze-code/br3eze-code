import { logger } from '../../core/logger.js';
import { dispatchNotification, createNoopEmailAdapter, createPwaAdapter, registerNotificationAdapter } from '../../core/notification-port.js';

registerNotificationAdapter(createNoopEmailAdapter());
registerNotificationAdapter(createPwaAdapter());

function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

function buildMessage(order) {
  const lines = (order.items || []).map((i) => `${i.qty} × ${i.name}${i.size ? ` (${i.size})` : ''}`);
  const settled = order.status === 'paid';
  return [`🛍️ *New Order* — ${order.invoiceNumber}`, `📦 via ${order.channel || order.platform}`, `💳 ${(order.payMethod || 'cod').toUpperCase()} — ${settled ? 'PAID' : 'DUE ON DELIVERY'}`, '', ...lines, '', `Total: ${money(order.total)}`].join('\n');
}

async function notifyNewOrder(order) {
  const trackingUrl = `${process.env.PUBLIC_URL || 'https://br3eze.africa'}/order/${encodeURIComponent(order.orderId)}`;
  await dispatchNotification({
    eventId: `order.created:${order.orderId}`,
    idempotencyKey: `order.created:${order.orderId}`,
    type: 'order.created',
    to: order.email ? [order.email] : [],
    subject: `Order ${order.invoiceNumber || order.orderId} received`,
    data: { orderId: order.orderId, invoiceNumber: order.invoiceNumber, status: order.status, total: order.total, trackingUrl },
  });
  const channelManager = global.gateway?.channelManager;
  if (!channelManager) { logger.debug('[order-notifier] no channelManager available — skipping admin notify'); return; }
  const text = buildMessage(order);
  for (const [type, channel] of channelManager.channels) {
    if (type !== 'telegram' && type !== 'whatsapp') continue;
    const ids = channel.config?.allowed_ids || [];
    if (!ids.length) continue;
    for (const id of ids) {
      try {
        if (type === 'telegram' && channel.bot) await channel.bot.sendMessage(id, text, { parse_mode: 'Markdown' });
        else if (type === 'whatsapp' && channel.sock) await channel.sock.sendMessage(id, { text });
      } catch (e) { logger.warn(`[order-notifier] send failed on ${type}: ${e.message}`); }
    }
  }
}

export { notifyNewOrder };
