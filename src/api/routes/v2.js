/**
 * API Routes v2 — AgentOS Enhanced
 * AI · Financial · Billing · Analytics · Channels · Mesh
 * @module api/routes/v2
 * @version 2026.6.17
 */

'use strict';

const express = require('express');
const router = express.Router();
const { logger } = require('../../core/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok = (res, data, meta = {}) => res.json({ ok: true, ...meta, data });
const err = (res, e, status = 500) => {
  logger.error(`v2 error: ${e.message}`);
  res.status(status).json({ ok: false, error: e.message });
};
const notReady = (res, svc) => res.status(503).json({ ok: false, error: `${svc} not ready` });

// ── Request logging ───────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () =>
    logger.debug(`API v2 ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - t}ms)`)
  );
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: 'v2',
    ts: new Date().toISOString(),
    features: ['ai', 'streaming', 'financial', 'billing', 'analytics', 'channels'],
    services: {
      ai: !!(global.ai || global.coordinator),
      askEngine: !!global.askEngine,
      financial: !!global.financial,
      billing: !!global.billing,
      channels: !!global.channelManager,
    },
  });
});

// ── AI / Ask Engine ───────────────────────────────────────────────────────────

/**
 * POST /api/v2/ask
 * Body: { prompt, stream?, sessionId?, model? }
 * SSE stream when stream=true
 */
router.post('/ask', async (req, res) => {
  const { prompt, stream: wantStream, sessionId, model } = req.body || {};
  if (!prompt) return res.status(400).json({ ok: false, error: 'prompt required' });

  const engine = global.askEngine;
  if (!engine) return notReady(res, 'AskEngine');

  if (wantStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    try {
      for await (const ev of engine.stream(prompt, { sessionId, model })) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    } catch (e) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
    }
    return res.end();
  }

  try {
    const result = await engine.run(prompt, { sessionId, model });
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v2/chat
 * Stateful multi-turn chat
 * Body: { messages[], sessionId?, systemPrompt? }
 */
router.post('/chat', async (req, res) => {
  try {
    const { messages, sessionId, systemPrompt } = req.body || {};
    if (!Array.isArray(messages) || !messages.length)
      return res.status(400).json({ ok: false, error: 'messages[] required' });

    const coordinator = global.ai || global.coordinator;
    if (!coordinator) return notReady(res, 'AI Coordinator');

    const result = await coordinator.chat(messages, { sessionId, systemPrompt });
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/providers
 * List available LLM providers and their status
 */
router.get('/providers', (req, res) => {
  try {
    const coordinator = global.ai || global.coordinator;
    const providers = coordinator?.getProviders?.() || coordinator?.providers || {};
    ok(res, providers);
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v2/providers/:name/test
 * Test a specific provider with a ping prompt
 */
router.post('/providers/:name/test', async (req, res) => {
  try {
    const coordinator = global.ai || global.coordinator;
    if (!coordinator) return notReady(res, 'AI Coordinator');
    const result = await coordinator.testProvider(req.params.name);
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Financial ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/financial/report
 * Revenue report with today/total/pending breakdown
 */
router.get('/financial/report', async (req, res) => {
  try {
    if (!global.financial) return notReady(res, 'Financial');
    const report = await global.financial.getRevenueReport();
    ok(res, report);
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/financial/trends
 * Revenue trend data for charting
 */
router.get('/financial/trends', async (req, res) => {
  try {
    if (!global.financial) return notReady(res, 'Financial');
    const trends = await global.financial.getTrends?.();
    ok(res, trends);
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/financial/transactions
 * Paginated transaction list
 * Query: ?limit=50&offset=0&from=ISO&to=ISO
 */
router.get('/financial/transactions', async (req, res) => {
  try {
    if (!global.financial) return notReady(res, 'Financial');
    const { limit = 50, offset = 0, from, to } = req.query;
    const txns =
      (await global.financial.getTransactions?.({ limit: +limit, offset: +offset, from, to })) ||
      [];
    ok(res, txns, { count: txns.length });
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/financial/summary
 * Quick KPI summary: MRR, ARR, ARPU, churn
 */
router.get('/financial/summary', async (req, res) => {
  try {
    if (!global.financial) return notReady(res, 'Financial');
    const report = await global.financial.getRevenueReport();
    const stats = global.database ? await global.database.getStats() : {};

    ok(res, {
      ...report,
      totalVouchers: stats.total || 0,
      usedVouchers: stats.used || 0,
      activeVouchers: stats.active || 0,
      utilizationRate: stats.total ? `${((stats.used / stats.total) * 100).toFixed(1)}%` : 'N/A',
    });
  } catch (e) {
    err(res, e);
  }
});

// ── Billing ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v2/billing/payment-link
 * Body: { plan, amount?, currency?, label? }
 */
router.post('/billing/payment-link', async (req, res) => {
  try {
    if (!global.billing) return notReady(res, 'Billing');
    const link = await global.billing.createPaymentLink(req.body);
    ok(res, { link });
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v2/billing/verify
 * Body: { reference }
 */
router.post('/billing/verify', async (req, res) => {
  try {
    const { reference } = req.body;
    if (!reference) return res.status(400).json({ ok: false, error: 'reference required' });
    if (!global.billing) return notReady(res, 'Billing');
    const result = await global.billing.verifyPayment(reference);
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v2/billing/webhook
 * Incoming payment provider webhook
 */
router.post('/billing/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    if (!global.billing) return notReady(res, 'Billing');
    const signature =
      req.headers['x-webhook-signature'] || req.headers['x-pesapal-signature'] || '';
    const payload = req.body?.toString?.() || JSON.stringify(req.body);
    const result = await global.billing.handleWebhook?.(payload, signature);
    ok(res, result || { received: true });
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/billing/provider
 * Current payment provider config (sanitised — no secrets)
 */
router.get('/billing/provider', (req, res) => {
  const provider = process.env.PAYMENT_PROVIDER || global.billing?.provider || 'none';
  const currency = process.env.PAYMENT_CURRENCY || 'USD';
  ok(res, { provider, currency, configured: provider !== 'none' });
});

// ── Channels ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/channels
 * List registered channels and their status
 */
router.get('/channels', (req, res) => {
  if (!global.channelManager) return ok(res, {});
  ok(res, global.channelManager.getStatus());
});

/**
 * POST /api/v2/channels/:type/send
 * Body: { to, message, media? }
 */
router.post('/channels/:type/send', async (req, res) => {
  try {
    if (!global.channelManager) return notReady(res, 'ChannelManager');
    const ch = global.channelManager.channels?.get?.(req.params.type);
    if (!ch)
      return res
        .status(404)
        .json({ ok: false, error: `Channel '${req.params.type}' not registered` });
    const { to, message, media } = req.body;
    if (!to || !message)
      return res.status(400).json({ ok: false, error: 'to and message required' });
    await ch.send?.(to, { text: message, media });
    ok(res, { sent: true, channel: req.params.type, to });
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v2/channels/broadcast
 * Body: { message, channels? (array, omit for all) }
 */
router.post('/channels/broadcast', async (req, res) => {
  try {
    if (!global.channelManager) return notReady(res, 'ChannelManager');
    const { message, channels: targets } = req.body;
    if (!message) return res.status(400).json({ ok: false, error: 'message required' });
    await global.channelManager.broadcast(
      { type: 'broadcast', text: message },
      targets ? type => targets.includes(type) : undefined
    );
    ok(res, { broadcast: true });
  } catch (e) {
    err(res, e);
  }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/analytics/vouchers
 * Voucher usage analytics
 */
router.get('/analytics/vouchers', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const stats = await global.database.getStats();
    const byPlan = await _vouchersByPlan();
    const byDay = await _vouchersByDay(7);
    ok(res, { stats, byPlan, byDay });
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/analytics/network
 * Network traffic and hotspot analytics
 */
router.get('/analytics/network', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const [active, interfaces] = await Promise.allSettled([
      global.mikrotik.executeCommand('/ip/hotspot/active/print'),
      global.mikrotik.executeCommand('/interface/print'),
    ]);
    ok(res, {
      activeUsers: active.status === 'fulfilled' ? active.value : [],
      interfaces: interfaces.status === 'fulfilled' ? interfaces.value : [],
    });
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v2/analytics/system
 * Process and memory telemetry
 */
router.get('/analytics/system', (req, res) => {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  ok(res, {
    uptime: process.uptime(),
    pid: process.pid,
    version: process.version,
    memory: {
      rss: _mb(mem.rss),
      heap: _mb(mem.heapUsed),
      heapTotal: _mb(mem.heapTotal),
      external: _mb(mem.external),
    },
    cpu: {
      user: `${(cpu.user / 1e6).toFixed(2)}s`,
      system: `${(cpu.system / 1e6).toFixed(2)}s`,
    },
    env: process.env.NODE_ENV || 'production',
  });
});

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/sessions
 * List active AI sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    if (!global.memoryManager) return ok(res, []);
    const sessions = (await global.memoryManager.listSessions?.()) || [];
    ok(res, sessions, { count: sessions.length });
  } catch (e) {
    err(res, e);
  }
});

/**
 * DELETE /api/v2/sessions/:id
 * Expire/clear a session
 */
router.delete('/sessions/:id', async (req, res) => {
  try {
    if (!global.memoryManager) return notReady(res, 'MemoryManager');
    await global.memoryManager.clearSession?.(req.params.id);
    ok(res, { cleared: req.params.id });
  } catch (e) {
    err(res, e);
  }
});

// ── Mesh Nodes ────────────────────────────────────────────────────────────────

/**
 * GET /api/v2/nodes
 */
router.get('/nodes', (req, res) => {
  const nodes = global.nodeRegistry?.getAll?.() || [];
  ok(res, nodes, { count: nodes.length });
});

/**
 * POST /api/v2/nodes/:name/command
 * Run a raw RouterOS command on a specific mesh node
 */
router.post('/nodes/:name/command', async (req, res) => {
  try {
    if (!global.nodeRegistry) return notReady(res, 'NodeRegistry');
    const node = global.nodeRegistry.get(req.params.name);
    if (!node)
      return res.status(404).json({ ok: false, error: `Node '${req.params.name}' not found` });
    const { command, args = {} } = req.body;
    if (!command) return res.status(400).json({ ok: false, error: 'command required' });
    const result = await node.executeCommand(command, args);
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v2/nodes/fanout
 * Execute a tool on ALL connected nodes
 * Body: { tool, params }
 */
router.post('/nodes/fanout', async (req, res) => {
  try {
    if (!global.nodeRegistry) return notReady(res, 'NodeRegistry');
    const { tool, params = {} } = req.body;
    if (!tool) return res.status(400).json({ ok: false, error: 'tool required' });
    const results = (await global.nodeRegistry.fanOut?.(tool, params)) || {};
    ok(res, results);
  } catch (e) {
    err(res, e);
  }
});

// ── Internal helpers ──────────────────────────────────────────────────────────
function _mb(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

async function _vouchersByPlan() {
  if (!global.database) return {};
  try {
    const all = await global.database.getVouchers({ limit: 10000 });
    const byPlan = {};
    for (const v of all) {
      const p = v.plan || 'unknown';
      byPlan[p] = (byPlan[p] || 0) + 1;
    }
    return byPlan;
  } catch {
    return {};
  }
}

async function _vouchersByDay(days = 7) {
  if (!global.database) return [];
  try {
    const all = await global.database.getVouchers({ limit: 10000 });
    const now = Date.now();
    const map = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
      map[d] = 0;
    }
    for (const v of all) {
      const d = (v.createdAt || '').slice(0, 10);
      if (map[d] !== undefined) map[d]++;
    }
    return Object.entries(map).map(([date, count]) => ({ date, count }));
  } catch {
    return [];
  }
}

module.exports = router;
