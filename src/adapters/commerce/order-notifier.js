import { logger } from '../../core/logger.js';

function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

function buildMessage(order) {
  const lines = (order.items || []).map((i) => `${i.qty} × ${i.name}${i.size ? ` (${i.size})` : ''}`);
  const settled = order.status === 'paid';
  return [`🛍️ *New Order* — ${order.invoiceNumber}`, `📦 via ${order.channel || order.platform}`, `💳 ${(order.payMethod || 'cod').toUpperCase()} — ${settled ? 'PAID' : 'DUE ON DELIVERY'}`, '', ...lines, '', `Total: ${money(order.total)}`].join('\n');
}

async function notifyNewOrder(order) {
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
