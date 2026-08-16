import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import EventEmitter from 'events';
import security from '../core/security.js';
import { logger } from '../core/logger.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// src/channels/telegram.js

class TelegramChannel extends EventEmitter {
  constructor(token, askEngine, options = {}) {
    super();

    if (!token || !/^[\d]+:[A-Za-z0-9_-]{35,}$/.test(token)) {
      throw new Error('Invalid Telegram bot token format');
    }

    this.askEngine = askEngine;
    this.mesh = options.meshRegistry || options.mikrotikMeshRegistry || null;
    this.meshContext = options.meshContext || ((chatId) => ({ tenantId: undefined, authorizedSiteIds: [], userId: chatId, channel: 'telegram' }));
    this.meshCallbackTokens = new Map();
    this.messageCache = new Map();
    this.userSessions = new Map(); // Track user state for multi-step commands

    // Secure bot configuration
    this.bot = new TelegramBot(token, {
      polling: {
        interval: 300,
        autoStart: false, // Start manually after setup
        params: {
          timeout: 10,
          allowed_updates: ['message', 'callback_query'] // Reduce bandwidth
        }
      },
      request: {
        timeout: 30000,
        agent: new https.Agent({
          keepAlive: true,
          maxSockets: 5,
          maxFreeSockets: 2,
          timeout: 30000,
          freeSocketTimeout: 30000
        })
      }
    });

    this._setupHandlers();
    this._startCacheCleanup();

    // Rate limiting per chat
    this.rateLimiter = new Map();
  }

  _setupHandlers() {
    // Command handlers with validation
    this.bot.onText(/\/start/, this._handleRateLimit(this._handleStart.bind(this)));
    this.bot.onText(/\/users/, this._handleRateLimit(this._handleUsers.bind(this)));
    this.bot.onText(/\/sites/, this._handleRateLimit(this._handleMeshSites.bind(this)));
    this.bot.onText(/\/voucher (\w+)/, this._handleRateLimit(this._handleVoucher.bind(this)));
    this.bot.onText(/\/reboot/, this._handleRateLimit(this._handleReboot.bind(this)));

    // Callback queries for inline keyboards
    this.bot.on('callback_query', this._handleRateLimit(this._handleCallback.bind(this)));

    // Natural language processing
    this.bot.on('message', this._handleRateLimit(this._handleNaturalLanguage.bind(this)));

    // Error handling
    this.bot.on('error', (error) => {
      logger.error('Telegram bot error:', error);
      this.emit('error', error);
    });

    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error:', error.code || error.message);
      // Auto-restart polling on recoverable errors
      if (error.code === 'EFATAL' || error.code === 'ECONNRESET') {
        setTimeout(() => this.bot.startPolling(), 5000);
      }
    });
  }

  _handleRateLimit(fn) {
    return async (msg, match) => {
      const chatId = msg.chat.id;
      const now = Date.now();

      if (!this.rateLimiter.has(chatId)) {
        this.rateLimiter.set(chatId, { count: 1, resetTime: now + 60000 });
      } else {
        const limit = this.rateLimiter.get(chatId);
        if (now > limit.resetTime) {
          limit.count = 1;
          limit.resetTime = now + 60000;
        } else {
          limit.count++;
          if (limit.count > 30) { // 30 messages per minute
            return this.bot.sendMessage(chatId, '⚠️ Rate limit exceeded. Please slow down.');
          }
        }
      }

      try {
        await fn(msg, match);
      } catch (error) {
        logger.error(`Telegram handler error: ${error.message}`, { chatId });
        this.bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
      }
    };
  }

  async _handleStart(msg) {
    const chatId = msg.chat.id;
    const username = msg.from.username || msg.from.first_name;

    logger.audit('telegram_start', { chatId, username });

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 Dashboard', callback_data: 'dashboard' },
            { text: '👥 Users', callback_data: 'users' }
          ],
          [
            { text: '🎫 Create Voucher', callback_data: 'voucher_menu' },
            { text: '📡 Network', callback_data: 'network_menu' }
          ],
          [
            { text: '🔧 Tools', callback_data: 'tools_menu' },
            { text: '❓ Help', callback_data: 'help' }
          ]
        ]
      }
    };

    await this.bot.sendMessage(
      chatId,
      `🤖 *AgentOS Control Panel*\n\n` +
      `Welcome, ${username}! I'm your network intelligence assistant.\n\n` +
      `Select an action below or type naturally (e.g., "kick john" or "create 1 hour voucher"):`,
      { ...keyboard, parse_mode: 'Markdown' }
    );
  }

  async _handleUsers(msg) {
    const chatId = msg.chat.id;

    try {
      const { getManager } = require('../core/mikrotik');
      const mt = getManager();

      const activeUsers = await mt.getActiveUsers();

      if (activeUsers.length === 0) {
        return this.bot.sendMessage(chatId, '👥 No active users');
      }

      let message = `👥 *Active Sessions: ${activeUsers.length}*\n\n`;
      const keyboard = { reply_markup: { inline_keyboard: [] } };

      activeUsers.forEach((user, index) => {
        const name = user.user || user.name || 'Unknown';
        const ip = user.address;
        const uptime = user.uptime || 'N/A';

        message += `${index + 1}. *${name}* - ${ip} (${uptime})\n`;

        keyboard.reply_markup.inline_keyboard.push([
          { text: `❌ Kick ${name}`, callback_data: `kick_${name}` }
        ]);
      });

      await this.bot.sendMessage(chatId, message, {
        ...keyboard,
        parse_mode: 'Markdown'
      });

    } catch (error) {
      logger.error('Failed to get users:', error);
      this.bot.sendMessage(chatId, '❌ Failed to fetch users');
    }
  }

  async _handleVoucher(msg, match) {
    const chatId = msg.chat.id;
    const plan = match[1];

    // Delegate to AI engine for validation and creation
    const result = await this.askEngine.processCommand('voucher.create', { plan, chatId });

    if (result.success) {
      const qrCode = result.qrCode; // Base64 QR
      await this.bot.sendPhoto(chatId, Buffer.from(qrCode, 'base64'), {
        caption: `🎫 *Voucher Created*\n\n` +
                `Code: \`${result.code}\`\n` +
                `Plan: ${result.plan}\n` +
                `Expires: ${result.expiresAt}\n\n` +
                `Scan QR to connect!`,
        parse_mode: 'Markdown'
      });
    } else {
      this.bot.sendMessage(chatId, `❌ ${result.error}`);
    }
  }

  async _handleReboot(msg) {
    const chatId = msg.chat.id;

    // Confirmation flow
    this.userSessions.set(chatId, { action: 'awaiting_reboot_confirm' });

    await this.bot.sendMessage(
      chatId,
      '⚠️ *Confirm System Reboot?*\n\nReply with YES to proceed.',
      { parse_mode: 'Markdown' }
    );
  }

  async _handleCallback(query) {
    const chatId = query.message.chat.id;
    const data = query.data;

    // Answer callback immediately to remove loading state
    await this.bot.answerCallbackQuery(query.id);

    if (data.startsWith('kick_')) {
      const username = data.replace('kick_', '');
      const result = await this.askEngine.processCommand('user.kick', { username });

      await this.bot.sendMessage(
        chatId,
        result.success
          ? `✅ User *${username}* disconnected`
          : `❌ Failed to kick ${username}`,
        { parse_mode: 'Markdown' }
      );
    } else if (data === 'dashboard') {
      await this._sendDashboard(chatId);
    } else if (data === 'network_menu' || data === 'mesh:sites') {
      await this._handleMeshSites({ chat: { id: chatId } });
    } else if (data.startsWith('mesh:site:')) {
      await this._handleMeshSiteSelection(chatId, data.slice('mesh:site:'.length));
    } else if (data.startsWith('mesh:health:')) {
      await this._handleMeshHealth(chatId, data.slice('mesh:health:'.length));
    } else if (data === 'mesh:fleet-health') {
      await this._handleMeshFleetHealth(chatId);
    }
  }

  _meshToken(siteId) {
    const token = `m${Buffer.from(String(siteId)).toString('base64url').slice(0, 24)}`;
    this.meshCallbackTokens.set(token, { siteId: String(siteId), expiresAt: Date.now() + 300000 });
    return token;
  }

  _resolveMeshSite(token) {
    const entry = this.meshCallbackTokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.meshCallbackTokens.delete(token);
      return null;
    }
    return entry.siteId;
  }

  _meshContext(chatId) {
    const context = typeof this.meshContext === 'function' ? this.meshContext(chatId) : {};
    return { ...context, userId: context.userId || chatId, channel: 'telegram' };
  }

  async _handleMeshSites(msg) {
    const chatId = msg.chat.id;
    if (!this.mesh) return this.bot.sendMessage(chatId, '📡 Mesh access is not configured for this bot.');
    const context = this._meshContext(chatId);
    const sites = this.mesh.list({ tenantId: context.tenantId }).filter((site) =>
      !context.authorizedSiteIds?.length || context.authorizedSiteIds.includes(site.id));
    if (!sites.length) return this.bot.sendMessage(chatId, '📡 No authorized MikroTik sites are available.');
    const keyboard = sites.map((site) => [{
      text: `${site.status === 'online' ? '🟢' : '⚪'} ${site.name}`,
      callback_data: `mesh:site:${this._meshToken(site.id)}`,
    }]);
    keyboard.push([{ text: '📊 Fleet health', callback_data: 'mesh:fleet-health' }]);
    return this.bot.sendMessage(chatId, '📡 *Select a MikroTik site:*', {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard },
    });
  }

  async _handleMeshSiteSelection(chatId, token) {
    if (!this.mesh) return this.bot.sendMessage(chatId, '📡 Mesh access is not configured.');
    const siteId = this._resolveMeshSite(token);
    if (!siteId) return this.bot.sendMessage(chatId, '⚠️ This site button expired. Use /sites again.');
    const context = this._meshContext(chatId);
    if (context.authorizedSiteIds?.length && !context.authorizedSiteIds.includes(siteId)) {
      return this.bot.sendMessage(chatId, '⛔ You are not authorized for this site.');
    }
    this.userSessions.set(chatId, { action: 'mesh_site_selected', siteId, expiresAt: Date.now() + 300000 });
    const site = this.mesh.describe(siteId);
    return this.bot.sendMessage(chatId, `📡 *${site?.name || siteId}*\nChoose an operation:`, {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
        [{ text: '✅ Health', callback_data: `mesh:health:${this._meshToken(siteId)}` }],
        [{ text: '↩ Sites', callback_data: 'mesh:sites' }],
      ] },
    });
  }

  async _handleMeshHealth(chatId, token) {
    const siteId = this._resolveMeshSite(token);
    if (!siteId) return this.bot.sendMessage(chatId, '⚠️ This health button expired. Use /sites again.');
    const context = this._meshContext(chatId);
    try {
      const result = await this.mesh.health([siteId], context);
      return this.bot.sendMessage(chatId, `📊 *${siteId}*\n\n\`${this._safeTelegramJson(result[0])}\``, { parse_mode: 'Markdown' });
    } catch (error) {
      return this.bot.sendMessage(chatId, `❌ Mesh health check failed: ${error.message}`);
    }
  }

  async _handleMeshFleetHealth(chatId) {
    if (!this.mesh) return this.bot.sendMessage(chatId, '📡 Mesh access is not configured.');
    const context = this._meshContext(chatId);
    try {
      const results = await this.mesh.health(context.authorizedSiteIds, context);
      return this.bot.sendMessage(chatId, `📊 *Fleet health*\n\n\`${this._safeTelegramJson(results)}\``, { parse_mode: 'Markdown' });
    } catch (error) {
      return this.bot.sendMessage(chatId, `❌ Fleet health check failed: ${error.message}`);
    }
  }

  _safeTelegramJson(value) {
    return JSON.stringify(value).replace(/[`\\\\]/g, '\\$&').slice(0, 3500);
  }

  async _handleNaturalLanguage(msg) {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;

    // Check for confirmation responses
    const session = this.userSessions.get(chatId);
    if (session?.action === 'awaiting_reboot_confirm') {
      if (msg.text.toUpperCase() === 'YES') {
        this.userSessions.delete(chatId);
        await this.bot.sendMessage(chatId, '🔄 *Rebooting MikroTik...*', { parse_mode: 'Markdown' });
        const result = await this.askEngine.processCommand('system.reboot');
        return;
      } else {
        this.userSessions.delete(chatId);
        return this.bot.sendMessage(chatId, '❌ Reboot cancelled');
      }
    }

    // Process through AI
    const typing = setInterval(() => this.bot.sendChatAction(chatId, 'typing'), 3000);

    try {
      const result = await this.askEngine.processQuery(msg.text, {
        context: 'telegram',
        userId: chatId,
        username: msg.from.username
      });

      clearInterval(typing);

      if (result.response) {
        await this.bot.sendMessage(chatId, result.response, {
          parse_mode: 'Markdown',
          reply_markup: result.suggestions ? {
            inline_keyboard: result.suggestions.map(s => [{ text: s, callback_data: s }])
          } : undefined
        });
      }
    } catch (error) {
      clearInterval(typing);
      logger.error('AI processing error:', error);
      this.bot.sendMessage(chatId, '⚠️ AI error. Please use manual commands.');
    }
  }

  async _sendDashboard(chatId) {
    try {
      const { getManager } = require('../core/mikrotik');
      const mt = getManager();
      const stats = await mt.getSystemStats();

      const message = `📊 *System Stats*\n\n` +
        `CPU: ${stats['cpu-load']}%\n` +
        `Uptime: ${stats.uptime}\n` +
        `Version: ${stats.version}\n` +
        `Memory: ${stats['memory-usage-percent']}%\n` +
        `Board: ${stats['board-name']}`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      this.bot.sendMessage(chatId, '❌ Failed to fetch stats');
    }
  }

  _startCacheCleanup() {
    this.cacheCleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.messageCache.entries()) {
        if (now - value.timestamp > 300000) { // 5 min expiry
          this.messageCache.delete(key);
        }
      }
      for (const [token, value] of this.meshCallbackTokens.entries()) {
        if (value.expiresAt < now) this.meshCallbackTokens.delete(token);
      }
    }, 60000);
  }

  async start() {
    await this.bot.startPolling();
    logger.info('Telegram bot started');
    this.emit('started');
  }

  destroy() {
    clearInterval(this.cacheCleanup);
    this.bot.stopPolling();
    this.bot.removeAllListeners();
    this.removeAllListeners();
  }
}

export default TelegramChannel;
