// src/core/gateway-engine.js 
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const compression = require('compression');
const EventEmitter = require('events');

const security = require('./security');
const { logger } = require('./logger');
const MobileBridge = require('../api/mobile-bridge');
const TelegramChannel = require('../channels/telegram');
const WhatsAppChannel = require('../channels/whatsapp');
const AICoordinator = require('../ai/coordinator');

class Gateway extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      port: config.port || 19876,
      host: config.host || '127.0.0.1',
      ...config
    };
    
    this.app = express();
    this.server = null;
    this.wss = null;
    this.channels = {};
    this.ai = null;
    this.clients = new Map(); // WebSocket clients
    
    this._setupExpress();
  }

  _setupExpress() {
    // Security middleware
    this.app.use(security.getSecurityMiddleware());
    this.app.use(compression());
    this.app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
    this.app.use(express.json({ limit: '10kb' })); // Limit payload size
    
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        version: process.env.npm_package_version,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });

    // Mount mobile API bridge
    const mobileBridge = new MobileBridge();
    this.app.use('/api/v1/mobile', mobileBridge.getRouter());

    // Error handling
    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start() {
    // Initialize AI
    this.ai = new AICoordinator();
    
    // Initialize messaging channels
    if (this.config.telegram?.token) {
      this.channels.telegram = new TelegramChannel(
        this.config.telegram.token,
        this.ai
      );
      await this.channels.telegram.start();
    }

    if (this.config.whatsapp?.enabled) {
      this.channels.whatsapp = new WhatsAppChannel();
      await this.channels.whatsapp.connect();
    }

    // Create HTTP server
    this.server = http.createServer(this.app);
    
    // Setup WebSocket
    this.wss = new WebSocket.Server({ 
      server: this.server,
      path: '/ws',
      verifyClient: (info, cb) => {
        // Token validation
        const token = info.req.headers['x-gateway-token'];
        if (token === this.config.gateway.token) {
          cb(true);
        } else {
          logger.warn('WebSocket auth failed');
          cb(false, 401, 'Unauthorized');
        }
      }
    });

    this.wss.on('connection', this._handleWSConnection.bind(this));

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

  _handleWSConnection(ws, req) {
    const clientId = req.headers['x-client-id'] || `anon_${Date.now()}`;
    this.clients.set(clientId, { ws, subscribed: [] });
    
    logger.info(`WS client connected: ${clientId}`);
    
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
        await this._handleWSMessage(clientId, msg);
      } catch (error) {
        ws.send(JSON.stringify({ error: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.info(`WS client disconnected: ${clientId}`);
    });

    // Send welcome
    ws.send(JSON.stringify({ 
      type: 'connected', 
      clientId,
      channels: Object.keys(this.channels)
    }));
  }

  async _handleWSMessage(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (msg.type) {
      case 'command':
        const result = await this.ai.processCommand(msg.command, msg.params);
        client.ws.send(JSON.stringify({ type: 'result', id: msg.id, result }));
        break;
        
      case 'subscribe':
        client.subscribed.push(msg.channel);
        client.ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
        break;
        
      case 'query':
        const response = await this.ai.processQuery(msg.text, { userId: clientId });
        client.ws.send(JSON.stringify({ type: 'response', id: msg.id, response }));
        break;
    }
  }

  async stop() {
    // Close channels
    Object.values(this.channels).forEach(ch => ch.destroy?.());
    
    // Close WebSocket clients
    this.wss?.clients.forEach(ws => ws.close());
    
    // Close server
    await new Promise(resolve => this.server?.close(resolve));
    
    logger.info('Gateway stopped');
    this.emit('stopped');
  }

  broadcast(message, channel = null) {
    const msg = JSON.stringify(message);
    this.clients.forEach((client, id) => {
      if (!channel || client.subscribed.includes(channel)) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(msg);
        }
      }
    });
  }
}

// Factory function for CLI
async function startGateway(config) {
  const gateway = new Gateway(config);
  return await gateway.start();
}

module.exports = { Gateway, startGateway };
