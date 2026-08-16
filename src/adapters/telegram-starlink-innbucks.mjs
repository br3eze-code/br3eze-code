import crypto from 'node:crypto';
import { PERMISSIONS } from '../services/admin/tiered-access.mjs';

function defaultUserId(msg) {
  return String(msg.from?.id || msg.chat?.id || 'unknown');
}

function jsonForTelegram(value) {
  return JSON.stringify(value).replace(/[`\\]/g, '\\$&').slice(0, 3500);
}

export function registerStarlinkInnbucksCommands(bot, starlink, rbac, innbucks, { resolveUserId = defaultUserId, resolveTerminal = () => null, maxTerminals = 20 } = {}) {
  if (!bot || !starlink || !rbac || !innbucks) throw new Error('bot, starlink, rbac, and innbucks are required');
  const paymentStates = new Map();

  bot.onText(/\/starlink(?:\s+([A-Za-z0-9._:-]+))?/, async (msg, match) => {
    const userId = resolveUserId(msg);
    const terminalId = match?.[1] || resolveTerminal(msg);
    try {
      rbac.assert(userId, terminalId ? PERMISSIONS.TERMINAL_READ : PERMISSIONS.FLEET_READ, terminalId ? { terminalId } : {});
      if (terminalId) return sendTerminal(bot, msg.chat.id, terminalId, userId, starlink, rbac);
      const stats = await starlink.getFleetStats();
      return bot.sendMessage(msg.chat.id,
        `🛰 *Starlink Fleet*\nTerminals: ${stats.total} total\n🟢 Online: ${stats.online}\n🟡 Degraded: ${stats.degraded}\n🔴 Offline: ${stats.offline}\nAvg Latency: ${stats.avgLatency}ms\nAvg Signal: ${stats.avgSignal}%\nTotal Downlink: ${(Number(stats.totalDownlink || 0) / 1e6).toFixed(1)} Mbps`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
          [{ text: '📡 Terminals', callback_data: 'sl:terminals' }],
          [{ text: '📊 Telemetry', callback_data: 'sl:telemetry' }],
          [{ text: '📈 Usage', callback_data: 'sl:usage' }],
          [{ text: '🔙 Main Menu', callback_data: 'nav:main' }],
        ] } });
    } catch (error) {
      return bot.sendMessage(msg.chat.id, error.code === 'ACCESS_DENIED' ? '⛔ Access denied.' : `Starlink request failed: ${error.message}`);
    }
  });

  bot.onText(/\/paynow(?:\s+(\d+(?:\.\d{1,2})?)\s*([A-Za-z]{3})?)?/, async (msg, match) => {
    const userId = resolveUserId(msg);
    try {
      rbac.assert(userId, PERMISSIONS.PAYMENT_CREATE);
      if (match?.[1]) return createPayment(bot, innbucks, msg, userId, Number(match[1]), (match[2] || 'USD').toUpperCase());
      return bot.sendMessage(msg.chat.id, '💳 *Collect Payment*\nSelect method:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '📲 InnBucks / Paynow', callback_data: 'pay:innbucks' }],
        [{ text: '🔙 Cancel', callback_data: 'pay:cancel' }],
      ] } });
    } catch (error) {
      return bot.sendMessage(msg.chat.id, error.code === 'ACCESS_DENIED' ? '⛔ Payment access denied.' : `Payment request failed: ${error.message}`);
    }
  });

  bot.on('callback_query', async (query) => {
    const data = String(query.data || '');
    const chatId = query.message?.chat?.id;
    const userId = String(query.from?.id || chatId || 'unknown');
    try {
      if (data === 'sl:terminals') {
        await bot.answerCallbackQuery(query.id);
        rbac.assert(userId, PERMISSIONS.FLEET_READ);
        const terminals = await starlink.getTerminals({ limit: maxTerminals });
        const accessible = await rbac.getAccessibleTerminals(userId, terminals);
        const rows = accessible.slice(0, maxTerminals).map((terminal) => {
          const icon = terminal.status === 'online' ? '🟢' : terminal.status === 'degraded' ? '🟡' : '🔴';
          return [{ text: `${icon} ${terminal.deviceName || terminal.id}`, callback_data: `sl:term:${encodeURIComponent(terminal.id)}` }];
        });
        rows.push([{ text: '🔙 Back', callback_data: '/starlink' }]);
        return bot.editMessageText(`📡 *Your Terminals* (${accessible.length} accessible)`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: rows } });
      }
      if (data.startsWith('sl:term:')) {
        await bot.answerCallbackQuery(query.id);
        const terminalId = decodeURIComponent(data.slice('sl:term:'.length));
        return sendTerminal(bot, chatId, terminalId, userId, starlink, rbac, query.message.message_id);
      }
      if (data.startsWith('sl:reboot:') || data.startsWith('sl:stow:')) {
        const action = data.startsWith('sl:reboot:') ? 'reboot' : 'stow';
        const terminalId = decodeURIComponent(data.slice(`sl:${action}:`.length));
        const permission = action === 'reboot' ? PERMISSIONS.TERMINAL_REBOOT : PERMISSIONS.TERMINAL_STOW;
        rbac.assert(userId, permission, { terminalId });
        await bot.answerCallbackQuery(query.id, { text: `${action} requested` });
        try {
          const result = action === 'reboot' ? await starlink.rebootTerminal(terminalId) : await starlink.stowTerminal(terminalId);
          rbac.auditLog(userId, `terminal:${action}`, { terminalId }, 'success');
          return bot.sendMessage(chatId, `✅ *${action} initiated*\nTerminal: ${terminalId}\n${jsonForTelegram(result)}`, { parse_mode: 'Markdown' });
        } catch (error) {
          rbac.auditLog(userId, `terminal:${action}`, { terminalId }, 'failed');
          return bot.sendMessage(chatId, `❌ ${action} failed: ${error.message}`);
        }
      }
      if (data === 'pay:innbucks') {
        await bot.answerCallbackQuery(query.id);
        rbac.assert(userId, PERMISSIONS.PAYMENT_CREATE);
        paymentStates.set(String(chatId), { userId, expiresAt: Date.now() + 300000 });
        return bot.sendMessage(chatId, 'Enter amount in USD, for example `10.00`:', { parse_mode: 'Markdown' });
      }
      if (data.startsWith('pay:check:')) {
        await bot.answerCallbackQuery(query.id);
        const reference = data.slice('pay:check:'.length);
        const status = await innbucks.checkStatus(reference);
        return bot.sendMessage(chatId, `Payment *${reference}*: ${status.status || 'pending'}`, { parse_mode: 'Markdown' });
      }
      if (data === 'pay:cancel') {
        paymentStates.delete(String(chatId));
        return bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
      }
    } catch (error) {
      await bot.answerCallbackQuery(query.id, { text: error.code === 'ACCESS_DENIED' ? 'Access denied' : 'Request failed' }).catch(() => {});
      if (chatId) await bot.sendMessage(chatId, error.code === 'ACCESS_DENIED' ? '⛔ Access denied.' : `❌ ${error.message}`).catch(() => {});
    }
  });

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const state = paymentStates.get(String(msg.chat?.id));
    if (!state || state.expiresAt < Date.now()) return paymentStates.delete(String(msg.chat?.id));
    const amount = Number(msg.text.trim());
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return bot.sendMessage(msg.chat.id, '❌ Enter a valid positive amount.');
    paymentStates.delete(String(msg.chat.id));
    try {
      await createPayment(bot, innbucks, msg, state.userId, amount, 'USD');
    } catch (error) {
      await bot.sendMessage(msg.chat.id, `❌ Payment init failed: ${error.message}`);
    }
  });

  return { starlinkCommand: '/starlink [terminalId]', paymentCommand: '/paynow [amount] [currency]' };
}

async function sendTerminal(bot, chatId, terminalId, userId, starlink, rbac, messageId = null) {
  rbac.assert(userId, PERMISSIONS.TERMINAL_READ, { terminalId });
  const terminal = await starlink.getTerminal(terminalId);
  const telemetry = await starlink.getTelemetry(terminalId);
  const text = [`🛰 *${terminal.deviceName || terminalId}*`, `Status: ${String(terminal.status || 'unknown').toUpperCase()}`, `SN: ${terminal.serialNumber || 'hidden'}`, `Location: ${terminal.latitude ?? 'n/a'}, ${terminal.longitude ?? 'n/a'}`, '', '📊 *Live Telemetry:*', `Latency: ${telemetry.latency ?? 'n/a'}ms`, `Signal: ${telemetry.signalQuality ?? 'n/a'}%`, `Down: ${(Number(telemetry.downlinkThroughput || 0) / 1e6).toFixed(1)} Mbps`, `Up: ${(Number(telemetry.uplinkThroughput || 0) / 1e6).toFixed(1)} Mbps`, `Obstructions: ${(Number(telemetry.obstructionFraction || 0) * 100).toFixed(1)}%`].join('\n');
  const buttons = [[{ text: '🔄 Refresh', callback_data: `sl:term:${encodeURIComponent(terminalId)}` }]];
  if (rbac.can(userId, PERMISSIONS.TERMINAL_REBOOT, { terminalId })) buttons.push([{ text: '⚡ Reboot', callback_data: `sl:reboot:${encodeURIComponent(terminalId)}` }]);
  if (rbac.can(userId, PERMISSIONS.TERMINAL_STOW, { terminalId })) buttons.push([{ text: '📥 Stow', callback_data: `sl:stow:${encodeURIComponent(terminalId)}` }]);
  buttons.push([{ text: '🔙 Fleet', callback_data: 'sl:terminals' }]);
  const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
  return messageId ? bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options }) : bot.sendMessage(chatId, text, options);
}

async function createPayment(bot, innbucks, msg, userId, amount, currency) {
  const reference = `AGT-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const payment = await innbucks.initiatePaynow({ amount, reference, customerEmail: undefined, customerPhone: undefined, returnUrl: process.env.PAYNOW_RETURN_URL, resultUrl: process.env.PAYNOW_RESULT_URL, metadata: { channel: 'telegram', userId } });
  const qr = innbucks.generateQRData(payment.authorizationCode || payment.redirectUrl);
  return bot.sendMessage(msg.chat.id, `💳 *Innbucks / Paynow Payment*\nAmount: $${amount.toFixed(2)} ${currency}\nRef: ${reference}\n\n${qr.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
    ...(qr.qrUrl ? [[{ text: '📷 Open Payment', url: qr.qrUrl }]] : []),
    [{ text: '🔔 Check Status', callback_data: `pay:check:${reference}` }],
  ] } });
}

export default registerStarlinkInnbucksCommands;
