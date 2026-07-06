// services/messagingAdapter.js
const TelegramBot = require('node-telegram-bot-api');
const WhatsAppService = require('./whatsapp');
const logger = require('../utils/logger');

/**
 * Unified messaging adapter that handles both Telegram and WhatsApp
 * with the same interface
 */
class MessagingAdapter {
    constructor(config) {
        this.config = config;
        this.telegram = null;
        this.whatsapp = null;
        this.handlers = {
            message: [],
            command: [],
            callback: []
        };

        // Parse mixed ALLOWED_CHAT_IDS
        this.allowedIds = this._parseAllowedIds(config.ALLOWED_CHAT_IDS);
    }

    /**
     * Parse mixed Telegram IDs and WhatsApp JIDs
     */
    _parseAllowedIds(idsString) {
        if (!idsString) return { telegram: [], whatsapp: [] };

        const ids = idsString.split(',').map(s => s.trim()).filter(Boolean);
        const result = { telegram: [], whatsapp: [] };

        for (const id of ids) {
            if (id.includes('@s.whatsapp.net') || id.includes('@g.us')) {
                result.whatsapp.push(id);
            } else if (!isNaN(id)) {
                result.telegram.push(id);
            } else {
                // Assume Telegram username or ID
                result.telegram.push(id);
            }
        }

        return result;
    }

    /**
     * Initialize both platforms
     */
    async initialize() {
        // Initialize Telegram if token provided
        if (this.config.TELEGRAM_TOKEN) {
            await this._initTelegram();
        }

        // Initialize WhatsApp
        await this._initWhatsApp();
    }

    async _initTelegram() {
        this.telegram = new TelegramBot(this.config.TELEGRAM_TOKEN, {
            polling: false // We'll handle polling manually
        });

        // Set allowed chats
        if (this.allowedIds.telegram.length > 0) {
            this.telegram.allowedChats = new Set(this.allowedIds.telegram);
        }

        // Register handlers
        this.telegram.on('message', (msg) => this._handleTelegramMessage(msg));
        this.telegram.on('callback_query', (query) => this._handleTelegramCallback(query));

        // Start polling
        this.telegram.startPolling({ restart: false, drop_pending_updates: true });

        logger.info(`Telegram initialized with ${this.allowedIds.telegram.length} allowed chats`);
    }

    async _initWhatsApp() {
        this.whatsapp = new WhatsAppService({
            authDir: './data/whatsapp_auth',
            allowedJids: this.allowedIds.whatsapp
        });

        this.whatsapp.onMessage((msg) => this._handleWhatsAppMessage(msg));
        this.whatsapp.onConnection((status) => {
            if (status.type === 'qr') {
                logger.info('WhatsApp QR ready - scan to connect');
            }
        });

        await this.whatsapp.initialize();
    }

    /**
     * Handle Telegram message
     */
    _handleTelegramMessage(msg) {
        const chatId = String(msg.chat.id);

        // Auth check
        if (this.allowedIds.telegram.length > 0 &&
            !this.allowedIds.telegram.includes(chatId)) {
            this.telegram.sendMessage(chatId, '⛔ *Unauthorized*', { parse_mode: 'Markdown' });
            return;
        }

        const messageData = {
            platform: 'telegram',
            chatId: chatId,
            sender: msg.from?.username || msg.from?.first_name || 'Unknown',
            text: msg.text || '',
            raw: msg
        };

        // Check if it's a command
        if (msg.text?.startsWith('/')) {
            const [command, ...args] = msg.text.slice(1).split(/\s+/);
            this._emit('command', {
                ...messageData,
                command: command.toLowerCase(),
                args: args.join(' ')
            });
        } else {
            this._emit('message', messageData);
        }
    }

    /**
     * Handle WhatsApp message
     */
    _handleWhatsAppMessage(msg) {
        // Check if it's a command (starts with /)
        if (msg.text.startsWith('/')) {
            const [command, ...args] = msg.text.slice(1).split(/\s+/);
            this._emit('command', {
                ...msg,
                command: command.toLowerCase(),
                args: args.join(' ')
            });
        } else {
            this._emit('message', msg);
        }
    }

    /**
     * Handle Telegram callback queries
     */
    _handleTelegramCallback(query) {
        this._emit('callback', {
            platform: 'telegram',
            chatId: String(query.message.chat.id),
            data: query.data,
            messageId: query.message.message_id,
            raw: query
        });
    }

    _emit(event, data) {
        this.handlers[event].forEach(h => {
            try { h(data); }
            catch (e) { logger.error(`Handler error: ${e.message}`); }
        });
    }

    // Public API methods

    onMessage(handler) {
        this.handlers.message.push(handler);
    }

    onCommand(handler) {
        this.handlers.command.push(handler);
    }

    onCallback(handler) {
        this.handlers.callback.push(handler);
    }

    /**
     * Send message to any platform
     */
    async send(chatId, text, options = {}) {
        // Detect platform from chatId format
        if (chatId.includes('@s.whatsapp.net') || chatId.includes('@g.us')) {
            return this.whatsapp?.sendMessage(chatId, text, options);
        } else {
            return this.telegram?.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...options
            });
        }
    }

    /**
     * Send media to any platform
     */
    async sendMedia(chatId, buffer, mimeType, caption = '') {
        if (chatId.includes('@s.whatsapp.net') || chatId.includes('@g.us')) {
            return this.whatsapp?.sendMedia(chatId, buffer, mimeType, caption);
        } else {
            // Telegram media handling
            if (mimeType.startsWith('image/')) {
                return this.telegram?.sendPhoto(chatId, buffer, { caption, parse_mode: 'Markdown' });
            } else if (mimeType.startsWith('video/')) {
                return this.telegram?.sendVideo(chatId, buffer, { caption, parse_mode: 'Markdown' });
            } else {
                return this.telegram?.sendDocument(chatId, buffer, { caption, parse_mode: 'Markdown' });
            }
        }
    }

    /**
     * Send to all authorized chats on both platforms
     */
    async broadcast(text, options = {}) {
        const results = [];

        // Telegram
        for (const chatId of this.allowedIds.telegram) {
            try {
                const result = await this.send(chatId, text, options);
                results.push({ platform: 'telegram', chatId, success: true, result });
            } catch (e) {
                results.push({ platform: 'telegram', chatId, success: false, error: e.message });
            }
        }

        // WhatsApp
        for (const jid of this.allowedIds.whatsapp) {
            try {
                const result = await this.send(jid, text, options);
                results.push({ platform: 'whatsapp', chatId: jid, success: true, result });
            } catch (e) {
                results.push({ platform: 'whatsapp', chatId: jid, success: false, error: e.message });
            }
        }

        return results;
    }

    /**
     * Get status of both platforms
     */
    getStatus() {
        return {
            telegram: this.telegram ? 'connected' : 'disabled',
            whatsapp: this.whatsapp?.getStatus() || { connected: false }
        };
    }
}

module.exports = MessagingAdapter;