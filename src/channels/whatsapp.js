import { BaseChannel } from './base.js';
import { Logger } from '../utils/logger.js';
import QRCode from 'qrcode-terminal';
import path from 'path';
import {
  extractWhatsAppAction,
  buildReplyButtons,
  buildListMessage,
} from './whatsapp-interactive.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);


/**
 * WhatsApp Channel
 */

const { 
  default: makeWASocket, 
  DisconnectReason, 
  useMultiFileAuthState,
  Browsers
} = require('@whiskeysockets/baileys');

class WhatsAppChannel extends BaseChannel {
  constructor(options = {}) {
    super(options);
    this.name = 'whatsapp';
    this.sessionName = options.sessionName || process.env.WHATSAPP_SESSION_NAME || 'agentos-session';
    this.enabled = options.enabled !== undefined ? options.enabled : process.env.WHATSAPP_ENABLED === 'true';
    this.logger = new Logger('WhatsAppChannel');
    this.sock = null;
    this.authState = null;
    this.qrCode = null;
  }
  
  async connect() {
    if (!this.enabled) {
      this.logger.info('WhatsApp disabled');
      return;
    }
    
    this.logger.info('Connecting to WhatsApp...');
    
    // Setup auth state
    const authPath = path.join(process.cwd(), 'data', 'whatsapp-auth', this.sessionName);
    this.authState = await useMultiFileAuthState(authPath);
    
    // Create socket
    this.sock = makeWASocket({
      auth: this.authState.state,
      printQRInTerminal: true,
      browser: Browsers.macOS('Desktop'),
      logger: { level: 'silent' }
    });
    
    // Setup event handlers
    this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
    this.sock.ev.on('messages.upsert', (m) => this.handleMessages(m));
    this.sock.ev.on('creds.update', this.authState.saveCreds);
  }
  
  handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      this.qrCode = qr;
      this.logger.info('QR Code received, scan with WhatsApp');
      QRCode.generate(qr, { small: true });
    }
    
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      this.logger.info('WhatsApp disconnected, reconnecting:', shouldReconnect);
      
      if (shouldReconnect) {
        this.connect();
      }
    } else if (connection === 'open') {
      this.connected = true;
      this.qrCode = null;
      this.logger.info('WhatsApp connected');
    }
  }
  
  handleMessages({ messages, type }) {
    if (type !== 'notify') return;
    
    for (const msg of messages) {
      if (!msg.message) continue;
      
      const chatId = msg.key.remoteJid;
      const isDM = chatId.endsWith('@s.whatsapp.net');
      const sender = msg.key.participant || chatId;
      
      const action = extractWhatsAppAction(msg.message);

      // Extract text and preserve a text fallback for clients that do not render buttons.
      let content = '';
      if (msg.message.conversation) {
        content = msg.message.conversation;
      } else if (msg.message.extendedTextMessage) {
        content = msg.message.extendedTextMessage.text;
      } else if (msg.message.buttonsResponseMessage) {
        content = msg.message.buttonsResponseMessage.selectedDisplayText || '';
      } else if (msg.message.listResponseMessage) {
        content = msg.message.listResponseMessage.singleSelectReply?.title || '';
      }

      if (!content && !action) continue;
      
      const frame = this.createFrame({
        sender: chatId,
        senderName: msg.pushName || sender,
        content,
        isDM,
        metadata: {
          userId: sender,
          conversationId: chatId,
          messageId: msg.key.id,
          timestamp: msg.messageTimestamp
        }
      });
      
      const navigation = action || this.normalizeNavigation(content);
      if (navigation) {
        this.emit('navigation', { action: navigation, frame });
        continue;
      }
      this.emit('message', frame);
    }
  }
  
  async disconnect() {
    if (this.sock) {
      await this.sock.logout();
    }
    this.connected = false;
  }
  
  async sendNavigationButtons(recipient, options) {
    if (!this.connected || !this.sock) throw new Error('WhatsApp not connected');
    return this.sock.sendMessage(recipient, buildReplyButtons(options));
  }

  async sendNavigationList(recipient, options) {
    if (!this.connected || !this.sock) throw new Error('WhatsApp not connected');
    return this.sock.sendMessage(recipient, buildListMessage(options));
  }

  async send(recipient, message) {
    if (!this.connected || !this.sock) {
      throw new Error('WhatsApp not connected');
    }
    
    const formatted = this.formatMessage(message);

    try {
      if (message?.type === 'reply-buttons') {
        return await this.sendNavigationButtons(recipient, message);
      }
      if (message?.type === 'list') {
        return await this.sendNavigationList(recipient, message);
      }
      await this.sock.sendMessage(recipient, {
        text: formatted.text || formatted
      });
    } catch (error) {
      this.logger.error('Send error:', error);
      throw error;
    }
  }
}

export { WhatsAppChannel };