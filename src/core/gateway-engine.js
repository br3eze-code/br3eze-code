import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import EventEmitter from 'events';
import path from 'path';
import security from './security.js';
import { logger } from './logger.js';
import ChannelManager from './channels/ChannelManager.js';
import MobileBridge from '../api/mobile-bridge.js';
import AICoordinator from '../ai/coordinator.js';
import { metrics } from './metrics.js';
import { DahuaNotifier } from './dahua-notifier.js';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { verifyFirebaseIdToken } from './firebase-auth.js';
import { DEFAULT_PLANS, getDatabase } from './database.js';
import { EcoCashProvider } from '../payments/payment-gateway.js';
import EcoCashEscrow from '../services/partner/ecocash-escrow.mjs';
import createEcoCashWebhookRouter from '../gateway/ecocash-webhook.mjs';
import * as dateUtils from '../utils/date.js';
import { PrintBroker } from './print-broker.js';
import shopRouter from '../api/routes/shop.js';
import v1Router from '../api/routes/v1.js';
import v2Router from '../api/routes/v2.js';
import v3Router from '../api/routes/v3.js';
import { buildCapabilityManifest } from './capability-manifest.js';

// A2A is an optional capability. Deployments that provide the plugin can
// load it without changing the core gateway; its absence is not a startup error.
let a2aPlugin = null;
try {
  const module = await import('../../core/plugins/a2a-protocol/index.js');
  a2aPlugin = module.default ?? module;
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
    logger.warn(`A2A Protocol Plugin could not be loaded: ${error.message}`);
  }
}

class Gateway extends EventEmitter {
  constructor(config = {}) {
    super();
    // Resolve token from nested gateway config → top-level → env
    const resolvedToken =
      config.gateway?.token ||
      config.token ||
      process.env.AGENTOS_GATEWAY_TOKEN ||
      process.env.GATEWAY_TOKEN;

    this.config = {
      port: config.port || config.gateway?.port || 19876,
      host: config.host || config.gateway?.host || '127.0.0.1',
      token: resolvedToken,
      ...config
    };

    // Log token prefix so operators can verify it loaded
    if (resolvedToken) {
      logger.info(`Gateway token loaded: ${resolvedToken.substring(0, 8)}…`);
    } else {
      logger.warn('⚠️  No gateway token set — API routes are unauthenticated. Set AGENTOS_GATEWAY_TOKEN.');
    }

    this.app = express();
    this.server = null;
    this.services = config.services || {};
    this.ai = new AICoordinator(this.config);
    // Channel adapters receive the coordinator as their agent context. Attach the
    // explicitly injected service container here so Telegram, partner bots, RBAC,
    // and database-backed flows use the same dependencies as the gateway routes.
    this.ai.services = this.services;
    this.ai.database = this.services.database || null;
    this.ai.db = this.ai.database;
    this.ecocashRouterPromise = this._createEcoCashWebhookRouter();
    this.channelManager = new ChannelManager(this.ai);

    // Relay special events from ChannelManager to system
    this.channelManager.on('qr', (data) => {
      logger.info(`Relaying QR code for ${data.channel}`);
      this.broadcast({ type: 'qr', payload: data }, 'websocket');
    });

    this.channelManager.on('command', (data) => {
      logger.info(`Received command ${data.command} from ${data.channel}`);
      if (data.command === 'initiate-whatsapp') {
        this._handleWhatsAppInitiation();
      }
    });

    this.channelManager.on('status', (data) => {
      logger.info(`Channel status update: ${data.channel} is now ${data.status}`);
      this.broadcast({ type: 'channel-status', payload: data }, 'websocket');
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

  async _createEcoCashWebhookRouter() {
    const db = this.services.database || await getDatabase();
    // Publish the resolved database to the shared injected service context before
    // channel registration. This avoids partner bots observing a false "database
    // unavailable" state during startup.
    this.services.database = db;
    this.ai.database = db;
    this.ai.db = db;
    const paymentConfig = {
      ...(this.config.payments || {}),
      ...(this.config.ecocash || {}),
      ...this.config,
    };
    const ecocash = this.services.ecocash || new EcoCashProvider(paymentConfig);
    const escrow = this.services.ecocashEscrow || new EcoCashEscrow({
      db,
      ecocash,
      walletCredit: this.services.walletCredit || null,
      now: this.services.now || (() => new Date()),
    });
    this.ecocash = ecocash;
    this.ecocashEscrow = escrow;
    return createEcoCashWebhookRouter({
      db,
      ecocash,
      releaseEscrow: this.services.releaseEscrow || ((escrowId) => escrow.verifyAndRelease(escrowId)),
      notifyPartner: this.services.notifyPartner || null,
      verifySignature: this.services.verifyEcoCashSignature || null,
      queue: this.services.webhookQueue || null,
      logger,
    });
  }

  _setupExpress() {
    this.app.use(security.getSecurityMiddleware());
    this.app.use(compression());
    this.app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
    this.app.use(express.json({ limit: '10kb' }));

    // EcoCash settlement is mounted through an injected, idempotent router.
    // Lazy delegation keeps gateway construction synchronous while database and
    // provider dependencies finish initializing in the background.
    this.app.use(async (req, res, next) => {
      if (req.path !== '/webhooks/ecocash') return next();
      try {
        const router = await this.ecocashRouterPromise;
        return router(req, res, next);
      } catch (error) {
        logger.error('[Gateway] EcoCash webhook initialization failed:', error);
        return res.status(503).json({ error: 'EcoCash webhook unavailable' });
      }
    });

    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use(limiter);

    // Dynamic config injection for frontend
    this.app.get('/js/env.js', (req, res) => {
      res.type('application/javascript');
      // Build gateway URL from actual request host (works from any network)
      const reqHost = req.headers['x-forwarded-host'] || req.headers.host || `${req.hostname}:${this.config.port}`;
      const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const gatewayUrl = `${proto}://${reqHost}`;
      res.send(`
        window.ENV = {
          FIREBASE_PROJECT_ID: "${process.env.FIREBASE_PROJECT_ID || ''}",
          FIREBASE_API_KEY: "${process.env.FIREBASE_API_KEY || ''}",
          GATEWAY_PORT: "${this.config.port}",
          GATEWAY_URL: "${gatewayUrl}",
          GATEWAY_TOKEN: "${this.config.token || ''}",
          ALLOWED_ORIGINS: "${process.env.ALLOWED_ORIGINS || '*'}"
        };
      `);
    });

    // Serve static frontend files from www/
    this.app.use(express.static(path.join(process.cwd(), 'www')));

    // Shop pages — express.static alone won't route a path param to a fixed shell
    this.app.get('/shop', (req, res) => res.sendFile(path.join(process.cwd(), 'www', 'shop.html')));
    this.app.get('/product/:id', (req, res) => res.sendFile(path.join(process.cwd(), 'www', 'product.html')));
    this.app.get('/order/:id', (req, res) => res.sendFile(path.join(process.cwd(), 'www', 'order.html')));

    // ── Health ────────────────────────────────────────────────────────────────
    this.app.get('/health', (req, res) => {
      res.json({
        status:    'healthy',
        timestamp: new Date().toISOString(),
        uptime:    Math.floor(process.uptime()),
        channels:  Object.keys(this.channelManager.getStatus())
      });
    });

    // ── Auto-discovery for ci.html ────────────────────────────────────────────
    // Returns the gateway token only when the request originates from localhost.
    this.app.get('/api/token', (req, res) => {
      const ip = req.ip || req.socket?.remoteAddress || '';
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (!isLocal) return res.status(403).json({ error: 'Local access only' });
      res.json({
        token:   this.config.token || '',
        version: process.env.npm_package_version || '1.0.0',
        port:    this.config.port
      });
    });

    // ── Aggregate stats ───────────────────────────────────────────────────────
    this.app.get('/api/stats', async (req, res) => {
      try {
        const token = this.config.token;
        if (token) {
          const provided = (req.headers['x-gateway-token'] || req.headers['authorization']?.slice(7) || '');
          if (provided !== token) return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = { mikrotik: false, router: null, vouchers: null, metrics: null };

        if (global.mikrotik?.state?.isConnected) {
          result.mikrotik = true;
          try { result.router = await global.mikrotik.getSystemResource(); } catch (_) { /* router unreachable */ }
        }

        if (global.database) {
          try {
            const stats = await global.database.getStats();
            result.vouchers = {
              total:   stats.total   ?? 0,
              active:  stats.active  ?? 0,
              used:    stats.used    ?? 0,
              revenue: stats.revenue ?? 0
            };
          } catch (_) { /* voucher stats unavailable */ }
        }

        result.metrics = {
          wsMsgs:  metrics.get('ws.messages') ?? 0,
          clients: metrics.get('ws.clients')  ?? 0,
          uptime:  Math.floor(process.uptime())
        };

        res.json(result);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Bearer token middleware for /api routes ────────────────────────────────
    // Accepts: Authorization: Bearer <token>  OR  x-gateway-token: <token>
    // OR a real Firebase ID token, which resolves to req.firebaseUser = {uid, email, role}.
    this.app.use('/api', async (req, res, next) => {
      const token = this.config.token;
      const auth = req.headers['authorization'] || '';
      const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      const headerToken = req.headers['x-gateway-token'] || null;
      const provided = bearerToken || headerToken;

      if (token && provided === token) return next(); // shared-secret path unchanged

      if (bearerToken) {
        const firebaseUser = await verifyFirebaseIdToken(bearerToken);
        if (firebaseUser) {
          req.firebaseUser = firebaseUser;
          return next();
        }
      }

      if (!token) return next(); // No shared token configured AND no valid Firebase user — keep existing open-access fallback
      return res.status(401).json({ error: 'Unauthorized — invalid or missing Bearer token' });
    });

    // ── Client capability discovery ───────────────────────────────────────────
    // This route is intentionally mounted after /api authentication. Client
    // headers may describe platform and bridge availability, but never identity,
    // role, tenant, or capabilities.
    this.app.get('/api/v1/capabilities', (req, res) => {
      const availableTools = typeof global.mikrotik?.getAvailableTools === 'function'
        ? global.mikrotik.getAvailableTools()
        : [];
      res.json(buildCapabilityManifest({
        user: req.firebaseUser || null,
        availableTools,
        platform: req.headers['x-agent-platform'] || 'cordova',
        channel: req.headers['x-agent-channel'] || 'rest',
        bridges: {
          aiCore: req.headers['x-agent-bridge-ai'] === 'true',
          networkTools: req.headers['x-agent-bridge-network'] === 'true',
          connectivity: req.headers['x-agent-bridge-connectivity'] === 'true',
          websocket: req.headers.upgrade === 'websocket',
        },
      }));
    });

    // ── SSE streaming /ask ────────────────────────────────────────────────────
    this.app.post('/api/v1/ask', async (req, res) => {
      const { prompt, stream: wantStream } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'prompt required' });
      if (!this.askEngine) return res.status(503).json({ error: 'AskEngine not initialized' });

      const askContext = { userId: req.firebaseUser?.uid, role: req.firebaseUser?.role, channel: 'rest' };

      if (wantStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        try {
          for await (const ev of this.askEngine.stream(prompt, askContext)) {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          }
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
        }
        res.end();
      } else {
        try {
          const result = await this.askEngine.run(prompt, askContext);
          res.json({ ok: true, ...result });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      }
    });

    // ── A2A Protocol Routes ───────────────────────────────────────────────────
    if (a2aPlugin && typeof a2aPlugin.onRegisterRoutes === 'function') {
      const a2aRouter = express.Router();
      a2aPlugin.onRegisterRoutes({ logger }, a2aRouter);
      this.app.use(a2aRouter);
    }

    // ── Email Webhook Capture ────────────────────────────────────────────────
    this.app.post('/api/v1/webhooks/email', express.urlencoded({ extended: true }), async (req, res) => {
      try {
        const emailChannel = this.channelManager.channels.get('email');
        if (!emailChannel) return res.status(503).json({ error: 'Email channel not active' });
        
        // Parse common webhook payloads (SendGrid Inbound Parse, Mailgun, etc.)
        const payload = req.body;
        const sender = payload.sender || payload.from || payload.envelope?.from;
        const subject = payload.subject || '';
        const text = payload.text || payload['body-plain'] || '';

        if (!sender) return res.status(400).json({ error: 'Sender address missing' });

        // Strip out Name <email@domain.com> to just email@domain.com if needed
        const emailMatch = sender.match(/<(.+)>/);
        const emailAddress = emailMatch ? emailMatch[1] : sender;

        await emailChannel.adapter.handleIncomingEmail(emailAddress, subject, text, payload);
        res.status(200).send('OK');
      } catch (err) {
        logger.error(`Email webhook error: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // ── Voucher routes ────────────────────────────────────────────────────────
    this.app.get('/api/v1/vouchers/stats', async (req, res) => {
      try {
        if (!global.database) return res.status(503).json({ error: 'Database not ready' });
        res.json(await global.database.getStats());
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/vouchers', async (req, res) => {
      try {
        if (!global.database) return res.status(503).json({ error: 'Database not ready' });
        const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
        const code = `STAR-${part()}-${part()}`;
        const plan = req.body.plan || 'default';
        const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };

        const mt = global.mikrotik;
        const expiresAt = planObj.durationValue && planObj.durationUnit ?
          dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
        const loginUrl = `http://${mt?.config?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;

        const vData = {
          ...req.body,
          plan,
          planName: req.body.planName || planObj.name || plan,
          durationUnit: req.body.durationUnit || planObj.durationUnit || null,
          durationValue: req.body.durationValue || planObj.durationValue || null,
          deviceLimit: req.body.deviceLimit || planObj.deviceLimit || 1,
          expiresAt: req.body.expiresAt || expiresAt,
          loginUrl: req.body.loginUrl || loginUrl,
          createdBy: req.body.createdBy || 'api'
        };

        const voucher = await global.database.createVoucher(code, vData);

        if (mt && mt.state.isConnected) {
          try {
            const _durationToMikrotik = (p) => {
              if (!p || !p.durationValue || !p.durationUnit) return null;
              const v = p.durationValue;
              switch (p.durationUnit) {
                case 'weeks': return `${v}w`;
                case 'days': return `${v}d`;
                case 'hours': return `${String(v).padStart(2, '0')}:00:00`;
                case 'minutes': return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
                default: return null;
              }
            };
            await mt.addHotspotUser({
              username: code, password: code, profile: plan,
              sharedUsers: vData.deviceLimit,
              ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) })
            });
          } catch (err) {
            logger.error('Failed to add voucher to Mikrotik:', err.message);
          }
        }
        res.json({ ok: true, voucher });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/vouchers/redeem', async (req, res) => {
      try {
        const { code, user } = req.body;
        if (!code || !user) return res.status(400).json({ error: 'code and user required' });
        if (!global.mikrotik || !global.mikrotik.state?.isConnected) return res.status(503).json({ error: 'Router unavailable' });

        const voucher = await global.database.getVoucher(code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        if (voucher.used) return res.status(400).json({ error: 'Voucher already used' });

        await global.mikrotik.addHotspotUser(user, user, voucher.planId || voucher.plan);
        await global.database.redeemVoucher(code, { username: user, ip: req.ip });
        res.json({ ok: true, status: 'activated', plan: voucher.planId || voucher.plan });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/users/sync', async (req, res) => {
      try {
        const { user, password, planId, expiry } = req.body;
        if (!user || !planId) return res.status(400).json({ error: 'user and planId required' });
        if (global.mikrotik && global.mikrotik.state?.isConnected) {
          const pass = password || user;
          await global.mikrotik.addHotspotUser(user, pass, planId);
        }
        res.json({ ok: true, user, planId, expiry: expiry || null });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Session kick (replaces account-disable) ────────────────────────────────
    this.app.post('/api/v1/users/kick', async (req, res) => {
      try {
        const { user } = req.body;
        if (!user) return res.status(400).json({ error: 'user required' });
        if (!global.mikrotik || !global.mikrotik.state?.isConnected) {
          return res.status(503).json({ error: 'Router unavailable' });
        }
        // Kick active hotspot session; do NOT disable the account
        await global.mikrotik.kickHotspotUser(user);
        logger.info(`[Gateway] Kicked hotspot session for: ${user}`);
        res.json({ ok: true, user, action: 'session_kicked' });
      } catch (e) {
        // Non-fatal: user may have no active session
        logger.warn(`[Gateway] Kick failed for ${req.body?.user}: ${e.message}`);
        res.json({ ok: false, error: e.message });
      }
    });

    this.app.get('/api/v1/vouchers/:code', async (req, res) => {
      try {
        if (!global.database) return res.status(503).json({ error: 'Database not ready' });
        const voucher = await global.database.getVoucher(req.params.code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        res.json({ ok: true, voucher });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/vouchers/:code/qr', async (req, res) => {
      try {

        const voucher = await global.database.getVoucher(req.params.code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        const url = `${req.protocol}://${req.get('host')}/login.html?code=${req.params.code}`;
        const qr = await QRCode.toDataURL(JSON.stringify({ code: req.params.code, plan: voucher.plan, url }));
        res.json({ ok: true, qr, code: req.params.code, plan: voucher.plan });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── MikroTik tool execution ───────────────────────────────────────────────
    this.app.post('/api/v1/tools/:tool', async (req, res) => {
      try {
        if (!global.mikrotik) return res.status(503).json({ error: 'MikroTik not connected' });
        const result = await global.mikrotik.executeTool(req.params.tool, req.body);
        res.json({ ok: true, result });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/tools', (req, res) => {
      if (!global.mikrotik) return res.json({ tools: [] });
      res.json({ tools: global.mikrotik.getAvailableTools() });
    });

    // ── Financial trends ──────────────────────────────────────────────────────
    this.app.get('/api/v1/trends', async (req, res) => {
      try {
        if (!global.financial) return res.status(503).json({ error: 'Financial service not ready' });
        res.json(await global.financial.getTrends());
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Mesh nodes ───────────────────────────────────────────────────────────
    this.app.get('/api/v1/nodes', (req, res) => {
      if (!global.nodeRegistry) return res.json({ nodes: [] });
      res.json(global.nodeRegistry.getAll());
    });

    this.app.post('/api/v1/nodes', async (req, res) => {
      try {
        if (!global.nodeRegistry) return res.status(503).json({ error: 'NodeRegistry not ready' });
        const { name, ip, user, pass, port } = req.body;
        const node = global.nodeRegistry.add(name, ip, user, pass, port);
        await node.connect();
        res.json({ ok: true, name, status: 'connected' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Memory & Sessions ────────────────────────────────────────────────────
    this.app.get('/api/v1/sessions/:id', async (req, res) => {
      try {
        if (!global.memoryManager) return res.status(503).json({ error: 'Memory service not ready' });
        const session = await global.memoryManager.getSession(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/users/:id/memory', async (req, res) => {
      try {
        if (req.firebaseUser && req.firebaseUser.role !== 'admin' && req.firebaseUser.uid !== req.params.id) {
          return res.status(403).json({ error: 'Forbidden — you may only read your own memory' });
        }
        if (!global.memoryManager) return res.status(503).json({ error: 'Memory service not ready' });
        const history = await global.memoryManager.adapter.get(`user:${req.params.id}:history`) || [];
        const context = await global.memoryManager.getUserContext(req.params.id);
        res.json({ history, context });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/users/:id/permissions', async (req, res) => {
      try {
        if (req.firebaseUser && req.firebaseUser.role !== 'admin') {
          return res.status(403).json({ error: 'Forbidden — admin role required' });
        }
        if (!global.memoryManager) return res.status(503).json({ error: 'Memory service not ready' });
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions must be an array' });
        await global.memoryManager.setPermissions(req.params.id, permissions);
        res.json({ ok: true, permissions });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Additional Voucher / Payment ──────────────────────────────────────────
    this.app.post('/api/v1/vouchers/pay', async (req, res) => {
      try {
        const { plan, amount, method } = req.body;
        if (!plan || !amount) return res.status(400).json({ error: 'plan and amount required' });



        const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
        const expiresAt = planObj.durationValue && planObj.durationUnit ?
          dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;

        // This would integrate with UniversalBilling/Payment providers

        const code = `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const loginUrl = `http://${global.mikrotik?.config?.host || global.AGENTOS?.dnsName || 'hotspot.local'}/login?username=${code}&password=${code}`;

        if (global.database) {
          await global.database.createVoucher(code, {
            planId: plan,
            planName: planObj.name || plan,
            durationUnit: planObj.durationUnit || null,
            durationValue: planObj.durationValue || null,
            deviceLimit: planObj.deviceLimit || 1,
            expiresAt,
            loginUrl,
            amount,
            method,
            status: 'paid',
            createdBy: 'api-pay'
          });

          // Auto provision on payment
          if (global.mikrotik && global.mikrotik.state?.isConnected) {
            const _durationToMikrotik = (p) => {
              if (!p || !p.durationValue || !p.durationUnit) return null;
              const v = p.durationValue;
              switch (p.durationUnit) {
                case 'weeks': return `${v}w`;
                case 'days': return `${v}d`;
                case 'hours': return `${String(v).padStart(2, '0')}:00:00`;
                case 'minutes': return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
                default: return null;
              }
            };
            await global.mikrotik.addHotspotUser({
              username: code, password: code, profile: plan,
              sharedUsers: planObj.deviceLimit || 1,
              ...(expiresAt && { limitUptime: _durationToMikrotik(planObj) })
            }).catch(() => { });
          }
        }

        res.json({ ok: true, code, status: 'paid' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Universal Print API ───────────────────────────────────────────────────
    // Allows any channel, mobile client, or REST consumer to trigger a
    // voucher print job. Automatically routes to BLE/USB Cordova client
    // when one is connected, falls back to server thermal printer.
    this.app.post('/api/v1/print', async (req, res) => {
      try {

        const { code, voucher } = req.body;

        let voucherData = voucher;
        if (!voucherData && code) {
          if (!global.database) return res.status(503).json({ error: 'Database not ready' });
          const v = await global.database.getVoucher(code);
          if (!v) return res.status(404).json({ error: `Voucher ${code} not found` });
          voucherData = {
            username: code, password: code,
            profile: v.planName || v.plan,
            loginUrl: v.loginUrl,
            expires: v.expiresAt,
            price: v.value, currency: v.currency,
          };
        }

        if (!voucherData) return res.status(400).json({ error: 'Provide "code" or "voucher" payload' });

        const result = await PrintBroker.getInstance().print(voucherData);
        res.json({ ok: result.success, via: result.via, error: result.error });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/print/status', (req, res) => {
      try {

        const mobile = PrintBroker.getInstance().getMobileClientStatus();
        res.json({ ok: true, mobileClients: mobile.count, clients: mobile.clients });
      } catch (e) { res.json({ ok: false, mobileClients: 0, clients: [] }); }
    });

    // ── Mobile bridge ────────────────────────────────────────────────────────
    try {
      const mobileBridge = new MobileBridge();
      this.app.use('/api/v1/mobile', mobileBridge.getRouter());
    } catch (e) {
      logger.warn('MobileBridge not available:', e.message);
    }

    // ── Shop ─────────────────────────────────────────────────────────────────
    this.app.use('/api/v1/shop', shopRouter);

    // ── Extended route sets (v1/v2/v3) ──────────────────────────────────────
    // Mounted AFTER every inline route above so already-working endpoints
    // (vouchers/stats, tools, nodes, etc., hand-duplicated here) keep serving
    // from this file — Express matches in registration order, so these
    // routers only ever handle the paths not already registered above.
    try {
      this.app.use('/api/v1', v1Router);
      this.app.use('/api/v2', v2Router);
      this.app.use('/api/v3', v3Router);
    } catch (e) {
      logger.warn('Extended API routes (v1/v2/v3) not available:', e.message);
    }

    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start() {
    logger.info('Starting AgentOS Gateway services...');

    // Resolve payment/database dependencies before registering channels. Partner
    // Telegram bots and escrow-backed handlers must never start against a partial
    // dependency container.
    await this.ecocashRouterPromise;

    // Resource monitoring log
    const { rss, heapUsed } = process.memoryUsage();
    logger.debug(`Initial memory usage: RSS=${Math.round(rss / 1024 / 1024)}MB, Heap=${Math.round(heapUsed / 1024 / 1024)}MB`);

    // Initialize A2A Protocol if available
    if (a2aPlugin) {
      try {
        a2aPlugin.onBootstrap({
          logger,
          metrics,
          eventBus: this
        });

        // Register the gateway itself as an A2A participant
        // This allows other agents to "talk" to the gateway
        const gatewayContext = {
          id: 'gateway',
          capabilities: ['system', 'mikrotik', 'billing'],
          send: async (msg) => {
            logger.info(`Gateway received A2A message: ${JSON.stringify(msg)}`);
            this.emit('a2a.message', msg);
            return { delivered: true };
          }
        };

        // A2APlugin stores adapters in a Map. We can manually add it 
        // or trigger onAgentInit if we had a proper agent object.
        // For the gateway, we'll expose it as a virtual agent.
        if (a2aPlugin.adapters) {
          a2aPlugin.adapters.set('gateway', gatewayContext);
          logger.info('A2A Protocol: Gateway registered as "gateway" node');
        }
      } catch (e) {
        logger.error(`Failed to initialize A2A Protocol: ${e.message}`);
      }
    }

    this.server = http.createServer(this.app);

    // Initialize channels via ChannelManager
    logger.debug('Initializing Channel Manager...');

    // 1. WebSocket Channel (Always enabled for frontend)
    logger.debug('Registering WebSocket channel...');
    await this.channelManager.register({
      type: 'websocket',
      config: {
        server: this.server,
        path: '/ws',
        token: this.config.token
      }
    });

    // Attach PrintBroker to WebSocket channel so mobile clients (BLE/USB) are reachable
    // from every channel in the system via the universal printVoucher() call.
    try {
      const wsChannel = this.channelManager.channels.get('websocket');
      if (wsChannel?.adapter) {

        PrintBroker.getInstance().attachWebSocketChannel(wsChannel.adapter);
        logger.info('[Gateway] PrintBroker attached to WebSocket channel — mobile printing enabled');
      }
    } catch (e) {
      logger.warn(`[Gateway] PrintBroker attach skipped: ${e.message}`);
    }

    // 2. WhatsApp Channel
    if (this.config.whatsapp?.enabled) {
      logger.debug('Registering WhatsApp channel...');
      await this.channelManager.register({
        type: 'whatsapp',
        config: this.config.whatsapp
      });
    }

    // 3. Telegram Channel
    if (this.config.telegram?.token) {
      logger.debug('Registering Telegram channel...');
      await this.channelManager.register({
        type: 'telegram',
        config: {
          ...this.config.telegram,
          // TelegramChannel reads allowed_ids; config stores allowedChats — bridge both
          allowed_ids: this.config.telegram.allowed_ids || this.config.telegram.allowedChats || []
        }
      });
    }

    // 4. Slack Channel
    if (this.config.slack?.token) {
      logger.debug('Registering Slack channel...');
      await this.channelManager.register({
        type: 'slack',
        config: this.config.slack
      });
    }

    // 5. Discord Channel
    if (this.config.discord?.token) {
      logger.debug('Registering Discord channel...');
      await this.channelManager.register({
        type: 'discord',
        config: this.config.discord
      });
    }

    // 6. Dahua camera notifier — polls configured NVR/camera alarm logs and
    // broadcasts new motion/IVS events to Telegram + WhatsApp.
    try {
      this.dahuaNotifier = new DahuaNotifier(this.config, this.channelManager);
      this.dahuaNotifier.start();
      this.ai.dahuaNotifier = this.dahuaNotifier; // expose to channels for mute/dismiss
    } catch (e) {
      logger.warn(`[Gateway] Dahua notifier not started: ${e.message}`);
    }

    // Start listening
    logger.debug(`Binding server to ${this.config.host}:${this.config.port}...`);
    await new Promise((resolve, reject) => {
      // The http.Server emits 'error' (not a callback argument) on EADDRINUSE.
      // We must listen for it BEFORE calling .listen(), otherwise the rejection
      // is unhandled and crashes the process before our catch block can act.
      const onError = (err) => {
        this.server.removeListener('error', onError);
        logger.error(`Gateway bind failed on port ${this.config.port}: ${err.message}`);
        reject(err);
      };
      this.server.once('error', onError);

      this.server.listen(this.config.port, this.config.host, () => {
        this.server.removeListener('error', onError);
        resolve();
      });
    });

    logger.info(`✅ Gateway listening on ${this.config.host}:${this.config.port}`);

    // Start Billing Reaper if billing is available
    if (global.billing && typeof global.billing.startReaper === 'function') {
      global.billing.startReaper();
    }

    this.emit('started');
    return this;
  }

  async stop() {
    logger.info('Shutting down Gateway...');

    if (this.dahuaNotifier) {
      this.dahuaNotifier.stop();
    }

    if (this.channelManager) {
      logger.debug('Closing all channels...');
      await this.channelManager.closeAll();
    }

    if (this.server) {
      logger.debug('Closing HTTP/WebSocket server...');
      await new Promise((resolve) => {
        // Force-close all keep-alive connections so the port is freed
        // immediately and the next PM2 restart doesn't hit EADDRINUSE.
        if (typeof this.server.closeAllConnections === 'function') {
          // Node 18.2+ fast path
          this.server.closeAllConnections();
        }

        const forceKill = setTimeout(() => {
          logger.warn('Gateway stop: forcibly destroying remaining sockets.');
          if (typeof this.server.closeAllConnections === 'function') {
            this.server.closeAllConnections();
          }
          resolve();
        }, 5000);
        forceKill.unref(); // don't block process exit

        this.server.close((err) => {
          clearTimeout(forceKill);
          if (err) logger.warn(`Gateway stop: ${err.message}`);
          resolve();
        });
      });
    }

    logger.info('✓ Gateway stopped gracefully');
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

export { Gateway, startGateway };
export const getGateway = startGateway;
