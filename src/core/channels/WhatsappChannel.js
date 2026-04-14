const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const { BaseChannel } = require('./BaseChannel');

class WhatsAppChannel extends BaseChannel {
  constructor(config, agent) {
    super(config, agent);
    this.sock = null;
    this.qrCode = null;
    this.authStateFolder = config.authStateFolder || path.join(process.cwd(), '.whatsapp-auth');
    this.allowedJids = new Set();
    
    if (config.allowedJids) {
      config.allowedJids.forEach(jid => this.allowedJids.add(this.normalizeJid(jid)));
    }
  }

  /**
   * Normalize JID format
   */
  normalizeJid(jid) {
    if (!jid) return null;
    const number = jid.split('@')[0].replace(/[^0-9]/g, '');
    if (jid.includes('@g.us')) return `${number}@g.us`;
    return `${number}@s.whatsapp.net`;
  }

  /**
   * Check if JID is authorized
   */
  isAuthorized(jid) {
    if (this.allowedJids.size === 0) return true;
    const normalized = this.normalizeJid(jid);
    return this.allowedJids.has(normalized);
  }

  async initialize() {
    if (!this.config.enabled && this.config.enabled !== undefined) {
      logger.info('WhatsApp channel disabled');
      return;
    }

    if (!fs.existsSync(this.authStateFolder)) {
      fs.mkdirSync(this.authStateFolder, { recursive: true });
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authStateFolder);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      
      logger.info(`Initializing WhatsApp with Baileys v${version} (latest: ${isLatest})`);

      this.sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        browser: ['AgentOS', 'Desktop', '1.0'],
        logger: logger.child({ service: 'whatsapp-channel' })
      });

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.emit('qr', qr);
          logger.info('WhatsApp QR code generated');
        }

        if (connection === 'close') {
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          logger.info('WhatsApp connection closed. Reconnecting:', shouldReconnect);
          this.connected = false;
          this.emit('status', 'disconnected');
          
          if (shouldReconnect) {
            setTimeout(() => this.initialize(), 5000);
          }
        } else if (connection === 'open') {
          this.connected = true;
          this.qrCode = null;
          this.emit('connected');
          this.emit('status', 'connected');
          logger.info('WhatsApp connected successfully');
        }
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        
        for (const msg of m.messages) {
          if (!msg.key.fromMe) {
            await this.handleIncomingMessage(msg);
          }
        }
      });

    } catch (error) {
      this.errorCount++;
      logger.error('WhatsApp initialization error:', error);
      throw error;
    }
  }

  async handleIncomingMessage(message) {
    this.messageCount++;
    const from = message.key.remoteJid;
    
    // Authorization check
    if (!this.isAuthorized(from)) {
      logger.warn(`Unauthorized WhatsApp message from ${from}`);
      return;
    }

    // Extract text from various message types
    const text = message.message?.conversation || 
                 message.message?.extendedTextMessage?.text ||
                 message.message?.imageMessage?.caption ||
                 message.message?.videoMessage?.caption || '';
                 
    if (!text && !message.message?.imageMessage && !message.message?.videoMessage) {
        return;
    }

    const userId = from.split('@')[0];
    const sender = message.pushName || userId;

    logger.debug(`WhatsApp message from ${sender} (${from}): ${text}`);

    this.emit('message', {
      text: text.trim(),
      userId: from, // Use full JID as internal userId for clarity
      sender,
      channel: 'whatsapp',
      raw: message
    });
  }

  async send(userId, message) {
    if (!this.sock || !this.connected) {
      throw new Error('WhatsApp not connected');
    }

    const jid = this.normalizeJid(userId);
    const content = typeof message === 'string' ? { text: message } : message;

    try {
      return await this.sock.sendMessage(jid, content);
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to send WhatsApp message to ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send media message
   */
  async sendMedia(userId, buffer, mimeType, caption = '') {
    if (!this.sock || !this.connected) {
      throw new Error('WhatsApp not connected');
    }

    const jid = this.normalizeJid(userId);
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

    try {
      return await this.sock.sendMessage(jid, messageContent);
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to send WhatsApp media to ${userId}:`, error);
      throw error;
    }
  }

  async broadcast(message) {
    logger.warn('WhatsApp broadcast - iterating active sessions');
    // Implementation would ideally use labels or broadcast lists
  }

  getStatus() {
    return {
      ...super.getStatus(),
      type: 'whatsapp',
      hasQR: !!this.qrCode,
      authorizedJids: Array.from(this.allowedJids)
    };
  }

  async destroy() {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {
        logger.error('Error during WhatsApp logout:', e);
      }
      this.sock = null;
    }
    await super.destroy();
  }
}

module.exports = WhatsAppChannel;
