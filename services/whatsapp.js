// services/whatsapp.js
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger'); // Your existing logger

class WhatsAppService {
    constructor(config = {}) {
        this.authDir = config.authDir || './data/whatsapp_auth';
        this.sock = null;
        this.isConnected = false;
        this.qrCode = null;
        this.messageHandlers = [];
        this.connectionHandlers = [];
        this.allowedJids = new Set();

        // Parse allowed JIDs from config
        if (config.allowedJids) {
            config.allowedJids.forEach(jid => this.allowedJids.add(this.normalizeJid(jid)));
        }
    }

    /**
     * Normalize JID format (handle both @s.whatsapp.net and @g.us)
     */
    normalizeJid(jid) {
        if (!jid) return null;
        // Remove any existing domain and re-add correct one
        const number = jid.split('@')[0].replace(/[^0-9]/g, '');
        if (jid.includes('@g.us')) return `${number}@g.us`;
        return `${number}@s.whatsapp.net`;
    }

    /**
     * Check if JID is authorized
     */
    isAuthorized(jid) {
        if (this.allowedJids.size === 0) return true; // Allow all if none specified
        const normalized = this.normalizeJid(jid);
        return this.allowedJids.has(normalized);
    }

    /**
     * Initialize WhatsApp connection
     */
    async initialize() {
        try {
            // Ensure auth directory exists
            if (!fs.existsSync(this.authDir)) {
                fs.mkdirSync(this.authDir, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            const { version, isLatest } = await fetchLatestBaileysVersion();

            logger.info(`Using Baileys v${version}, isLatest: ${isLatest}`);

            this.sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false, // We'll handle QR ourselves
                browser: ['AgentOS', 'Desktop', '1.0'],
                syncFullHistory: false,
                markOnlineOnConnect: true,
                logger: {
                    level: 'silent' // Use our own logger
                }
            });

            // Handle credentials update
            this.sock.ev.on('creds.update', saveCreds);

            // Handle connection updates
            this.sock.ev.on('connection.update', (update) => {
                this._handleConnectionUpdate(update);
            });

            // Handle incoming messages
            this.sock.ev.on('messages.upsert', (m) => {
                this._handleMessages(m);
            });

            return true;
        } catch (error) {
            logger.error(`WhatsApp initialization failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Handle connection state changes
     */
    _handleConnectionUpdate(update) {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            this.qrCode = qr;
            this.isConnected = false;
            // Generate QR for display/logging
            QRCode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
                if (!err) console.log(url);
            });
            this.connectionHandlers.forEach(h => h({ type: 'qr', qr }));
            logger.info('WhatsApp QR code generated - scan with your phone');
        }

        if (connection === 'close') {
            this.isConnected = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

            logger.warn(`WhatsApp connection closed. Reconnecting: ${shouldReconnect}`);
            this.connectionHandlers.forEach(h => h({ type: 'disconnected', shouldReconnect }));

            if (shouldReconnect) {
                setTimeout(() => this.initialize(), 5000);
            }
        } else if (connection === 'open') {
            this.isConnected = true;
            this.qrCode = null;
            logger.info('WhatsApp connected successfully');
            this.connectionHandlers.forEach(h => h({ type: 'connected' }));
        }
    }

    /**
     * Handle incoming messages
     */
    _handleMessages({ messages, type }) {
        if (type !== 'notify') return;

        for (const msg of messages) {
            // Skip messages from self
            if (msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const sender = msg.pushName || jid.split('@')[0];

            // Extract message text
            let text = '';
            if (msg.message?.conversation) {
                text = msg.message.conversation;
            } else if (msg.message?.extendedTextMessage?.text) {
                text = msg.message.extendedTextMessage.text;
            } else if (msg.message?.imageMessage?.caption) {
                text = msg.message.imageMessage.caption;
            }

            if (!text) continue;

            const messageData = {
                platform: 'whatsapp',
                chatId: jid,
                sender,
                text: text.trim(),
                timestamp: msg.messageTimestamp,
                raw: msg
            };

            // Check authorization
            if (!this.isAuthorized(jid)) {
                logger.warn(`Unauthorized WhatsApp message from ${jid}`);
                this.sendMessage(jid, '⛔ *Unauthorized:* You are not authorized to use this service.');
                continue;
            }

            // Route to handlers
            this.messageHandlers.forEach(handler => {
                try { handler(messageData); }
                catch (e) { logger.error(`Message handler error: ${e.message}`); }
            });
        }
    }

    /**
     * Send text message
     */
    async sendMessage(jid, text, options = {}) {
        if (!this.isConnected || !this.sock) {
            throw new Error('WhatsApp not connected');
        }

        try {
            const result = await this.sock.sendMessage(jid, {
                text,
                ...options
            });
            return result;
        } catch (error) {
            logger.error(`Failed to send WhatsApp message: ${error.message}`);
            throw error;
        }
    }

    /**
     * Send media message
     */
    async sendMedia(jid, buffer, mimeType, caption = '') {
        if (!this.isConnected || !this.sock) {
            throw new Error('WhatsApp not connected');
        }

        try {
            let messageContent = {};

            if (mimeType.startsWith('image/')) {
                messageContent = { image: buffer, caption };
            } else if (mimeType.startsWith('video/')) {
                messageContent = { video: buffer, caption };
            } else if (mimeType.startsWith('audio/')) {
                messageContent = { audio: buffer, mimetype: mimeType };
            } else {
                messageContent = { document: buffer, caption, mimetype: mimeType };
            }

            return await this.sock.sendMessage(jid, messageContent);
        } catch (error) {
            logger.error(`Failed to send WhatsApp media: ${error.message}`);
            throw error;
        }
    }

    /**
     * Register message handler
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
        return () => {
            this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Register connection handler
     */
    onConnection(handler) {
        this.connectionHandlers.push(handler);
        return () => {
            this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Disconnect gracefully
     */
    async disconnect() {
        if (this.sock) {
            await this.sock.logout();
            this.isConnected = false;
        }
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            connected: this.isConnected,
            qrAvailable: !!this.qrCode,
            authorizedJids: Array.from(this.allowedJids)
        };
    }
}

module.exports = WhatsAppService;