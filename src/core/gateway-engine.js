// src/core/gateway-engine.js 
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const compression = require('compression');
const EventEmitter = require('events');

const security = require('./security');
const { logger } = require('./logger');
const ChannelManager = require('./channels/ChannelManager');
const MobileBridge = require('../api/mobile-bridge');
const AICoordinator = require('../ai/coordinator');

class Gateway extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      port: config.port || 19876,
      host: config.host || '127.0.0.1',
      token: config.gateway?.token || process.env.GATEWAY_TOKEN,
      ...config
    };
    
    this.app = express();
    this.server = null;
    this.ai = new AICoordinator(this.config);
    this.channelManager = new ChannelManager(this.ai);
    
    // Relay special events from ChannelManager to system
    this.channelManager.on('qr', (data) => {
      logger.info(`Relaying QR code for ${data.channel}`);
      this.broadcast({ type: 'qr', payload: data });
    });

    this.channelManager.on('command', (data) => {
      logger.info(`Received command ${data.command} from ${data.channel}`);
      if (data.command === 'initiate-whatsapp') {
        this._handleWhatsAppInitiation();
      }
    });

    this.channelManager.on('status', (data) => {
      logger.info(`Channel status update: ${data.channel} is now ${data.status}`);
      this.broadcast({ type: 'channel-status', payload: data });
    });

    this._setupExpress();
  }

  async _handleWhatsAppInitiation() {
    try {
      logger.info('Starting WhatsApp initiation flow...');
      // If channel exists, we might need to reset it or just let it re-initialize
      // For now, let's ensure it's registered
      if (!this.channelManager.channels.has('whatsapp')) {
        await this.channelManager.register({
          type: 'whatsapp',
          config: this.config.whatsapp || { enabled: true }
        });
      } else {
        // Force a re-init if possible or just log
        logger.info('WhatsApp channel already registered, ensuring connection...');
      }
    } catch (error) {
      logger.error('Failed to initiate WhatsApp:', error);
    }
  }

  _setupExpress() {
    this.app.use(security.getSecurityMiddleware());
    this.app.use(compression());
    this.app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
    this.app.use(express.json({ limit: '10kb' }));
    
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        channels: Object.keys(this.channelManager.getStatus())
      });
    });

    const mobileBridge = new MobileBridge();
    this.app.use('/api/v1/mobile', mobileBridge.getRouter());

    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start() {
    this.server = http.createServer(this.app);
    
    // Initialize channels via ChannelManager
    // 1. WebSocket Channel (Always enabled for frontend)
    await this.channelManager.register({
      type: 'websocket',
      config: {
        server: this.server,
        path: '/ws',
        token: this.config.token
      }
    });

    // 2. WhatsApp Channel
    if (this.config.whatsapp?.enabled) {
      await this.channelManager.register({
        type: 'whatsapp',
        config: this.config.whatsapp
      });
    }

    // 3. Telegram Channel
    if (this.config.telegram?.token) {
      await this.channelManager.register({
        type: 'telegram',
        config: this.config.telegram
      });
    }

    // Start listening
    await new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    logger.info(`Gateway listening on ${this.config.host}:${this.config.port}`);
    this.emit('started');
    return this;
  }

  async stop() {
    await this.channelManager.closeAll();
    await new Promise(resolve => this.server?.close(resolve));
    logger.info('Gateway stopped');
    this.emit('stopped');
  }

  broadcast(message, channel = null) {
    this.channelManager.broadcast(message, (type) => !channel || type === channel);
  }
}

async function startGateway(config) {
  const gateway = new Gateway(config);
  return await gateway.start();
}

module.exports = { Gateway, startGateway };
