// src/channels/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const EventEmitter = require('events');
const security = require('../core/security');
const { logger } = require('../core/logger');

class TelegramChannel extends EventEmitter {
  constructor(token, askEngine, options = {}) {
    super();
    
    if (!token || !/^[\d]+:[A-Za-z0-9_-]{35,}$/.test(token)) {
      throw new Error('Invalid Telegram bot token format');
    }

    this.askEngine = askEngine;
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
    }
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

module.exports = TelegramChannel;
