'use strict';
/**
 * Broadcasts a "new order" alert to admin Telegram/WhatsApp chats whenever a
 * sale closes on ANY channel (web, Telegram, WhatsApp, CLI) — mirrors
 * dahua-notifier.js's channelManager iteration + allowed_ids targeting, so
 * the shop owner sees every sale regardless of where the customer placed it.
 * Unlike dahua-notifier's WhatsApp path (which broadcasts to every chat that
 * has ever messaged the bot), this always targets allowed_ids on both
 * channels — that's the existing "who controls/monitors this bot" allowlist,
 * not a customer-facing broadcast list.
 */
const { logger } = require('./logger');

function money(n) { return `$${Number(n || 0).toFixed(2)}`; }

function buildMessage(order) {
    const lines = order.items.map((i) => `${i.qty} × ${i.name}${i.size ? ` (${i.size})` : ''}`);
    const settled = order.status === 'paid';
    return [
        `🛍️ *New Order* — ${order.invoiceNumber}`,
        `📦 via ${order.channel || order.platform}`,
        `💳 ${(order.payMethod || 'cod').toUpperCase()} — ${settled ? 'PAID' : 'DUE ON DELIVERY'}`,
        '',
        ...lines,
        '',
        `Total: ${money(order.total)}`,
    ].join('\n');
}

async function notifyNewOrder(order) {
    const channelManager = global.gateway?.channelManager;
    if (!channelManager) {
        logger.debug('[order-notifier] no channelManager available — skipping admin notify');
        return;
    }

    const text = buildMessage(order);

    for (const [type, channel] of channelManager.channels) {
        if (type !== 'telegram' && type !== 'whatsapp') continue;
        const ids = channel.config?.allowed_ids || [];
        if (!ids.length) continue;

        for (const id of ids) {
            try {
                if (type === 'telegram' && channel.bot) {
                    await channel.bot.sendMessage(id, text, { parse_mode: 'Markdown' });
                } else if (type === 'whatsapp' && channel.sock) {
                    await channel.sock.sendMessage(id, { text });
                }
            } catch (e) {
                logger.warn(`[order-notifier] send failed on ${type} to ${id}: ${e.message}`);
            }
        }
    }
}

module.exports = { notifyNewOrder };
