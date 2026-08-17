import WebSocket from 'ws';
import crypto from 'crypto';
import { logger } from '../logger.js';
import { BaseChannel } from './BaseChannel.js';
import WebSocketCLI from './WebSocketCLI.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);


class WebSocketChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'WebSocket',
            description: 'Messaging channel',
            configFields: []
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.server = config.server; // Existing Express server
    this.path = config.path || '/ws';
    this.wss = null;
    this.clients = new Map();
    this.cliSessions = new Map(); // clientId -> WebSocketCLI instance
  }

  async initialize() {
    if (!this.server) {
      logger.error('WebSocketChannel requires an HTTP server instance');
      return;
    }

    this.wss = new WebSocket.Server({
      server: this.server,
      path: this.path,
      verifyClient: this.verifyClient.bind(this),
      perMessageDeflate: false,    // CVE-2026-1526: disables memory-exhaustion vector
      maxPayload: 1024 * 1024,
      clientTracking: true
    });

    this.wss.on('connection', (ws, req) => {
      // Use the stable clientId sent by the frontend (persisted in localStorage)
      // so the same browser always maps to the same channels.websocket entry
      // in Firestore — no more duplicate orphaned UUIDs per reconnect.
      const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
      const requestedId = urlParams.get('clientId') || '';
      const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const clientId = UUID4_RE.test(requestedId) ? requestedId : crypto.randomUUID();

      // Grab uid early so _rl() has it before auth.identify arrives
      const earlyUid = urlParams.get('uid') || null;

      this.clients.set(clientId, { ws, authenticated: true, earlyUid, isAlive: true });

      ws.on('pong', () => {
        const client = this.clients.get(clientId);
        if (client) client.isAlive = true;
      });

      logger.info(`WebSocket client connected: ${clientId}${earlyUid ? ' uid:' + earlyUid : ''}`);

      // Hello message
      this.sendToWs(ws, {
        type: 'hello',
        payload: {
          service: 'AgentOS',
          version: '2026.4.11',
          timestamp: new Date().toISOString(),
          // Echo back the clientId so the frontend can confirm its ID was accepted
          clientId
        }
      });

      ws.on('message', (data) => this.handleIncomingMessage(clientId, data));
      ws.on('close', () => this.handleDisconnect(clientId));
      ws.on('error', (err) => logger.error(`WebSocket error ${clientId}:`, err));
      
      this.connected = true;
    });

    const interval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = Array.from(this.clients.values()).find(c => c.ws === ws);
        if (client) {
          if (client.isAlive === false) return ws.terminate();
          client.isAlive = false;
          ws.ping();
        }
      });
    }, 30000);

    this.wss.on('close', () => clearInterval(interval));

    logger.info(`WebSocket channel initialized on ${this.path}`);

    // Attach PrintBroker so mobile print ACKs are routed correctly
    try {
      const { PrintBroker } = require('../print-broker');
      PrintBroker.getInstance().attachWebSocketChannel(this);
    } catch (e) {
      logger.warn(`[WebSocketChannel] PrintBroker attach failed: ${e.message}`);
    }
  }

  /**
   * Rate Limit & Auth Wrapper
   * Harmonizes identity resolution across all AgentOS channels.
   */
  _rl(fn) {
    return async (clientId, msg, ...extra) => {
      try {
        const db = await this.agent.database;
        if (!db) return await fn.call(this, clientId, msg, ...extra);

        const channelId = clientId;

        // 1. Sync identity (Register client in local DB if new)
        await db.upsertUser(channelId, {
          channel: 'websocket',
          channelId: channelId,
          lastActive: new Date().toISOString()
        });

        // 2. Bridge to Firebase (Resolve canonical UID if linked)
        const authUser = await db.resolveFirebaseUser(channelId, {
          channel: 'websocket',
          channelId: channelId
        }).catch(() => null);

        // 3. Fallback & Attach (Canonical ID is the UID if available, else the clientId)
        const _uid = authUser?.uid || channelId;
        const userDoc = db.getUserDoc(_uid);

        // Inject identity into the message object for downstream consumption
        if (typeof msg === 'object' && msg !== null) {
          msg.userDoc = userDoc;
          msg._uid = _uid;
        }

        await fn.call(this, clientId, msg, ...extra);
      } catch (err) {
        logger.error(`WebSocket identity resolution failed: ${err.message}`, { clientId });
        await fn.call(this, clientId, msg, ...extra);
      }
    };
  }

  verifyClient(info) {
    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const token = url.searchParams.get('token') || info.req.headers['x-agentos-token'];
    const expected = this.config.token || process.env.GATEWAY_TOKEN || process.env.AGENTOS_GATEWAY_TOKEN;

    // No token configured on the server → open/dev mode, allow all connections
    if (!expected) {
      logger.warn('[WebSocketChannel] No gateway token configured — accepting unauthenticated connections (dev mode)');
      return true;
    }

    // Token required but not provided → reject
    if (!token) return false;

    try {
      return (
        token.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
      );
    } catch {
      return false;
    }
  }

  async handleIncomingMessage(clientId, data) {
    this.messageCount++; // test
    try {
      const message = JSON.parse(data);
      
      // Standardize message for AgentOS
      if (message.type === 'interaction' || message.type === 'message') {
        this.emit('message', { // test
          text: message.text || message.payload?.text,
          userId: clientId, // test2
          channel: 'websocket',
          raw: message
        });
      } else {
        // Handle other legacy message types (ping, status, etc.)
        this.handleLegacyMessage(clientId, message);
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
    }
  }

  _normalizeAuthorityContext(rawContext, userId) {
    if (!rawContext || typeof rawContext !== 'object' || !rawContext.tenantId || !userId) return null;
    if (rawContext.userId && rawContext.userId !== userId) return null;
    const unique = (value) => [...new Set((Array.isArray(value) ? value : []).filter(Boolean).map(String))];
    const authorizedSiteIds = unique(rawContext.authorizedSiteIds || rawContext.siteIds);
    const authorizedRouterIds = unique(rawContext.authorizedRouterIds || rawContext.routerIds);
    const siteId = rawContext.siteId ? String(rawContext.siteId) : null;
    const routerId = rawContext.routerId ? String(rawContext.routerId) : null;
    if (siteId && authorizedSiteIds.length && !authorizedSiteIds.includes(siteId)) return null;
    if (routerId && authorizedRouterIds.length && !authorizedRouterIds.includes(routerId)) return null;
    return Object.freeze({
      source: 'server-membership',
      userId: String(userId),
      tenantId: String(rawContext.tenantId),
      siteId,
      routerId,
      authorizedSiteIds,
      authorizedRouterIds,
      capabilities: unique(rawContext.capabilities),
      roles: unique(rawContext.roles)
    });
  }

  async _deriveAuthorityContext(db, authUser) {
    if (!db || !authUser?.uid) return null;
    let rawContext = null;
    if (typeof db.resolveAuthorityContext === 'function') {
      rawContext = await db.resolveAuthorityContext(authUser.uid);
    } else {
      rawContext = authUser.authorityContext || null;
    }
    return this._normalizeAuthorityContext(rawContext, authUser.uid);
  }

  async handleLegacyMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'ping':
        this.sendToWs(client.ws, { type: 'pong', timestamp: Date.now() });
        break;

      // ── Firebase identity bridge ───────────────────────────────────────────
      // The frontend sends this after firebase.auth().onAuthStateChanged fires.
      // We call resolveFirebaseUser() and link channels.websocket to the STABLE
      // clientId (persisted in the browser's localStorage) so that:
      //   db.getUserByChannel('websocket', stableId) works across reconnects
      // — identical to how TelegramChannel uses a stable chatId.
      case 'auth.identify': {
        const uid   = message.uid;
        const email = message.email;
        // Prefer the stable clientId from the message (localStorage-persisted UUID)
        // over the server-assigned one so channels.websocket is always consistent.
        const UUID4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const stableChannelId = (message.clientId && UUID4_RE.test(message.clientId))
          ? message.clientId
          : clientId;

        if (uid || email) {
          try {
            const db = this.agent?.database;
            if (db) {
              const identifier = uid || email;
              const authUser = await db.resolveFirebaseUser(identifier, {
                channel: 'websocket',
                channelId: stableChannelId   // always the same UUID across reconnects
              }).catch(() => null);

              if (authUser?.uid) {
                const authorityContext = await this._deriveAuthorityContext(db, authUser);
                if (!authorityContext) {
                  logger.warn(`[WebSocketChannel] Identity bridged without trusted tenant authority: uid:${authUser.uid}`);
                  this.sendToWs(client.ws, { type: 'auth.rejected', code: 'TENANT_AUTHORITY_REQUIRED' });
                  break;
                }
                const existing = this.clients.get(clientId) || {};
                this.clients.set(clientId, {
                  ...existing,
                  firebaseUid: authUser.uid,
                  email: authUser.email,
                  stableChannelId,
                  authorityContext
                });
                logger.info(`[WebSocketChannel] Identity bridged: ws:${stableChannelId} -> uid:${authUser.uid} tenant:${authorityContext.tenantId}`);
                this.sendToWs(client.ws, { type: 'auth.identified', uid: authUser.uid, clientId: stableChannelId, authorityContext });
              } else {
                logger.debug(`[WebSocketChannel] auth.identify: no Firebase record for ${identifier}`);
              }
            }
          } catch (e) {
            logger.warn(`[WebSocketChannel] auth.identify failed: ${e.message}`);
          }
        }
        break;
      }

      case 'node.register':
        this._handleNodeRegister(clientId, client.ws, message.payload);
        break;

      case 'node.unregister':
        this._handleNodeUnregister(clientId);
        break;

      // ── Cordova/Android printer registration ─────────────────────────────
      // The mobile app sends this after connecting to declare it has a printer.
      // payload: { capability: 'ble'|'usb'|'any', platform: 'android', model: '...' }
      case 'printer.register': {
        const existing = this.clients.get(clientId) || {};
        const cap = message.payload?.capability || message.payload?.printer || 'any';
        this.clients.set(clientId, {
          ...existing,
          capabilities: { ...(existing.capabilities || {}), printer: cap },
          platform: message.payload?.platform || existing.platform || 'android',
          printerModel: message.payload?.model || null,
        });
        logger.info(`[WebSocketChannel] Client ${clientId} registered printer capability: ${cap}`);
        this.sendToWs(client.ws, { type: 'printer.registered', capability: cap });
        break;
      }

      // ── Print result ACK from Cordova app ─────────────────────────────────
      // The mobile app sends this after completing (or failing) a print job.
      // payload: { jobId: '...', success: bool, error?: '...' }
      case 'print.result': {
        try {
          const { PrintBroker } = require('../print-broker');
          PrintBroker.getInstance()._handleMobileAck({
            clientId,
            jobId:   message.jobId   || message.payload?.jobId,
            success: message.success ?? message.payload?.success ?? false,
            error:   message.error   || message.payload?.error,
          });
        } catch (e) {
          logger.warn(`[WebSocketChannel] print.result routing failed: ${e.message}`);
        }
        break;
      }

      case 'command.invoke':
        this._handleCommandInvoke(clientId, client.ws, message);
        break;

      case 'tool.invoke':
        this._handleToolInvoke(clientId, client.ws, message);
        break;

      case 'tool.list':
        if (global.mikrotik) {
          this.sendToWs(client.ws, {
            type: 'tool.list',
            tools: global.mikrotik.getAvailableTools()
          });
        }
        break;

      case 'status':
        this.sendToWs(client.ws, { 
          type: 'status', 
          payload: this.getStatus() 
        });
        break;

      case 'initiate-whatsapp':
        logger.info(`Received initiate-whatsapp from client ${clientId}`);
        this.emit('command', { 
          clientId, 
          command: 'initiate-whatsapp', 
          payload: message.payload 
        });
        break;

      case 'cli.start':
        this._handleCliStart(clientId);
        break;

      case 'cli.input':
        this._handleCliInput(clientId, message);
        break;

      case 'cli.stop':
        this.closeCliSession(clientId);
        break;

      case 'cli.resize':
        this._handleCliResize(clientId, message);
        break;

      case 'cli.exec':
        this._handleCliExec(clientId, message);
        break;

      case 'intent':
        this._handleIntent(clientId, client.ws, message);
        break;
    }
  }

  async _handleIntent(clientId, ws, msg) {
    const { intent, payload } = msg;
    logger.info(`Intent received: ${intent} from ${clientId}`);

    try {
      // Opportunistically update user router context if provided by WifiWizard
      if (payload.bssid || payload.ssid) {
        await this.db.upsertUser(clientId, {
          channel: 'websocket',
          channelId: clientId,
          lastActive: new Date().toISOString(),
          currentRouter: payload.bssid || null,
          currentSSID: payload.ssid || null
        });
      }

      // Map frontend intents to backend actions
      switch (intent) {
        case 'purchase_plan':
          // Handle plan purchase via AI or direct logic
          const result = await this.agent.processInteraction(`purchase plan ${payload.planId}`, {
            channel: 'websocket',
            userId: clientId,
            metadata: payload
          });
          this.sendToWs(ws, {
            type: 'intent.result',
            intent,
            success: result.success,
            message: result.result?.text || (result.success ? 'Plan purchased successfully' : 'Purchase failed')
          });
          break;

        case 'redeem_voucher':
          const redeemResult = await this.agent.processInteraction(`redeem voucher ${payload.code}`, {
            channel: 'websocket',
            userId: clientId,
            metadata: payload
          });
          this.sendToWs(ws, {
            type: 'intent.result',
            intent,
            success: redeemResult.success,
            message: redeemResult.result?.text || (redeemResult.success ? 'Voucher redeemed' : 'Redemption failed')
          });
          break;

        default:
          // Generic intent handling via agent
          const genericResult = await this.agent.processInteraction(`${intent} ${JSON.stringify(payload)}`, {
            channel: 'websocket',
            userId: clientId,
            metadata: payload
          });
          this.sendToWs(ws, {
            type: 'intent.result',
            intent,
            success: genericResult.success,
            result: genericResult.result
          });
      }
    } catch (error) {
      logger.error(`Intent handling failed: ${error.message}`);
      this.sendToWs(ws, {
        type: 'intent.result',
        intent,
        success: false,
        error: error.message
      });
    }
  }

  _handleCliStart(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (this.cliSessions.has(clientId)) {
      this.cliSessions.get(clientId).destroy();
    }

    const session = new WebSocketCLI(clientId, client.ws, this);
    this.cliSessions.set(clientId, session);
    
    session.sendPrompt();
    this.sendToWs(client.ws, { 
      type: 'cli.started', 
      message: 'Interactive CLI session started. Type "exit" to quit.' 
    });
  }

  _handleCliInput(clientId, msg) {
    const session = this.cliSessions.get(clientId);
    if (session) {
      session.handleInput(msg.input || msg.payload?.input || '');
    }
  }

  _handleCliResize(clientId, msg) {
    const session = this.cliSessions.get(clientId);
    if (session) {
      session.resize(msg.cols || 80, msg.rows || 24);
    }
  }

  async _handleCliExec(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const command = msg.command || msg.payload?.command;
    if (!command) return;

    // Use AI coordinator to handle the command
    try {
      const result = await this.agent.processInteraction(command, {
        channel: 'websocket',
        userId: clientId,
        isCli: true
      });
      
      this.sendToWs(client.ws, {
        type: 'cli.result',
        id: msg.id,
        success: true,
        result: result.result?.text || JSON.stringify(result.result)
      });
    } catch (error) {
      this.sendToWs(client.ws, {
        type: 'cli.result',
        id: msg.id,
        success: false,
        error: error.message
      });
    }
  }

  closeCliSession(clientId) {
    const session = this.cliSessions.get(clientId);
    if (session) {
      session.destroy();
      this.cliSessions.delete(clientId);
      
      const client = this.clients.get(clientId);
      if (client) {
        this.sendToWs(client.ws, { type: 'cli.stopped' });
      }
    }
  }

  _handleNodeRegister(clientId, ws, payload) {
    const nodeInfo = {
      ...payload,
      clientId,
      ws,
      registeredAt: Date.now(),
      lastActivity: Date.now()
    };

    this.clients.set(clientId, nodeInfo);
    this.sendToWs(ws, {
      type: 'node.registered',
      payload: { nodeId: payload.nodeId, registeredAt: Date.now() }
    });

    logger.info(`Node registered: ${payload.nodeId} from ${clientId}`);
    this._broadcastNodeList();
  }

  _handleNodeUnregister(clientId) {
    this.clients.delete(clientId);
    this._broadcastNodeList();
  }

  _broadcastNodeList() {
    const nodes = [];
    this.clients.forEach((client) => {
      if (client.nodeId) {
        nodes.push({
          nodeId: client.nodeId,
          platform: client.platform,
          capabilities: client.capabilities,
          connectedAt: client.connectedAt || client.registeredAt
        });
      }
    });

    this.broadcast({ type: 'node.list', nodes, timestamp: Date.now() });
  }

  async _handleCommandInvoke(clientId, ws, msg) {
    const { command, params } = msg.payload;
    logger.info(`Command invoke: ${command} from ${clientId}`);
    
    // Relay to system
    this.emit('message', {
      text: command,
      params,
      userId: clientId,
      channel: 'websocket',
      raw: msg
    });
  }

  async _handleToolInvoke(clientId, ws, msg) {
    try {
      if (!this.agent) throw new Error('AI Agent service unavailable');
      const result = await this.agent.executeTool(msg.tool, msg.params || {}, {
        channel: 'websocket',
        userId: clientId
      });

      // Tools return { success: false, error } as a resolved value — not a thrown error.
      // Propagate the tool-level failure correctly so the frontend doesn't see a false positive.
      const toolSucceeded = !(result && result.success === false);
      this.sendToWs(ws, {
        type: 'tool.result',
        id: msg.id,
        tool: msg.tool,
        result,
        success: toolSucceeded,
        ...(toolSucceeded ? {} : { error: result.error || 'Tool reported failure' })
      });
    } catch (error) {
      this.sendToWs(ws, {
        type: 'tool.result',
        id: msg.id,
        tool: msg.tool,
        error: error.message,
        success: false
      });
    }
  }

  handleDisconnect(clientId) {
    this.closeCliSession(clientId);
    this.clients.delete(clientId);
    logger.info(`WebSocket client disconnected: ${clientId}`);
    if (this.clients.size === 0) {
      this.connected = false;
    }
  }

  async send(userId, message) {
    const client = this.clients.get(userId);
    if (client) {
      this.sendToWs(client.ws, message);
    } else {
      // If userId is unknown, maybe it's a broadcast or we need to find the right client
      logger.warn(`WebSocket client ${userId} not found for sending`);
    }
  }

  async broadcast(message) {
    const payload = typeof message === 'string' ? { text: message } : message;
    this.clients.forEach(({ ws }) => {
      this.sendToWs(ws, { type: 'broadcast', payload });
    });
  }

  sendToWs(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  getStatus() {
    return {
      ...super.getStatus(),
      type: 'websocket',
      clients: this.clients.size
    };
  }

  async destroy() {
    if (this.wss) {
      this.wss.close();
    }
    await super.destroy();
  }
}

BaseChannel.register('websocket', WebSocketChannel);

export default WebSocketChannel;
