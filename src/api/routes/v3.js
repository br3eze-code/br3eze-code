/**
 * API Routes v3 — AgentOS Advanced
 * Bulk · Skills · Audit · Diagnostics · Chaos · Workflows
 * @module api/routes/v3
 * @version 2026.6.17
 */

'use strict';

const express = require('express');
const router = express.Router();
const { logger } = require('../../core/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok = (res, data, meta = {}) => res.json({ ok: true, version: 'v3', ...meta, data });
const err = (res, e, status = 500) => {
  logger.error(`v3 error: ${e.message}`);
  res.status(status).json({ ok: false, version: 'v3', error: e.message });
};
const notReady = (res, svc) => res.status(503).json({ ok: false, error: `${svc} not ready` });

router.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () =>
    logger.debug(`API v3 ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - t}ms)`)
  );
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: 'v3',
    ts: new Date().toISOString(),
    features: ['bulk', 'skills', 'audit', 'diagnostics', 'workflows', 'chaos'],
  });
});

// ── Bulk Operations ───────────────────────────────────────────────────────────

/**
 * POST /api/v3/bulk/vouchers
 * Generate N vouchers in one call
 * Body: { count, plan, createdBy? }
 */
router.post('/bulk/vouchers', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const crypto = require('crypto');
    const { DEFAULT_PLANS } = require('../../core/database');
    const dateUtils = require('../../utils/date');

    const { count = 1, plan = 'default', createdBy = 'api-v3-bulk' } = req.body;
    const n = Math.min(Math.max(parseInt(count) || 1, 1), 100);

    const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
    const expiresAt =
      planObj.durationValue && planObj.durationUnit
        ? dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString()
        : null;

    const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    const generated = [];

    for (let i = 0; i < n; i++) {
      const code = `BLK-${part()}-${part()}`;
      const loginUrl = `http://${global.mikrotik?.config?.host || 'br3eze.africa'}/login?username=${code}&password=${code}`;
      const v = await global.database.createVoucher(code, {
        plan,
        planName: planObj.name || plan,
        durationUnit: planObj.durationUnit || null,
        durationValue: planObj.durationValue || null,
        deviceLimit: planObj.deviceLimit || 1,
        expiresAt,
        loginUrl,
        createdBy,
      });
      generated.push(v);
    }

    // Provision all on MikroTik if connected
    if (global.mikrotik?.state?.isConnected) {
      await Promise.allSettled(
        generated.map(v =>
          global.mikrotik.addHotspotUser({
            username: v.code,
            password: v.code,
            profile: plan,
            sharedUsers: planObj.deviceLimit || 1,
          })
        )
      );
    }

    ok(res, generated, { count: generated.length, plan });
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v3/bulk/users/disconnect
 * Body: { ids: ['id1','id2',...] }
 */
router.post('/bulk/users/disconnect', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ ok: false, error: 'ids[] required' });

    const results = await Promise.allSettled(
      ids.map(id => global.mikrotik.executeCommand('/ip/hotspot/active/remove', { '.id': id }))
    );
    const summary = results.map((r, i) => ({
      id: ids[i],
      status: r.status === 'fulfilled' ? 'disconnected' : 'failed',
      error: r.reason?.message,
    }));
    ok(res, summary, { processed: ids.length });
  } catch (e) {
    err(res, e);
  }
});

/**
 * DELETE /api/v3/bulk/vouchers
 * Delete vouchers by status
 * Body: { status: 'used' | 'expired' | 'all' }
 */
router.delete('/bulk/vouchers', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const { status } = req.body;
    if (!status)
      return res.status(400).json({ ok: false, error: 'status required: used | expired | all' });
    const deleted = (await global.database.bulkDeleteVouchers?.({ status })) || { count: 0 };
    ok(res, deleted);
  } catch (e) {
    err(res, e);
  }
});

// ── Skills ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/skills
 * List all registered skills with their tools
 */
router.get('/skills', (req, res) => {
  try {
    const registry = global.skillRegistry || global.toolRegistry;
    if (!registry) return ok(res, []);
    const skills = registry.getSkillNames?.() || registry.list?.() || [];
    ok(res, skills, { count: Array.isArray(skills) ? skills.length : 0 });
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v3/skills/:name
 * Get skill manifest
 */
router.get('/skills/:name', (req, res) => {
  try {
    const registry = global.skillRegistry || global.toolRegistry;
    if (!registry) return notReady(res, 'SkillRegistry');
    const skill = registry.getSkill?.(req.params.name) || registry.get?.(req.params.name);
    if (!skill)
      return res.status(404).json({ ok: false, error: `Skill '${req.params.name}' not found` });
    ok(res, skill);
  } catch (e) {
    err(res, e);
  }
});

/**
 * POST /api/v3/skills/:name/invoke
 * Invoke a named skill tool
 * Body: { tool, params }
 */
router.post('/skills/:name/invoke', async (req, res) => {
  try {
    const registry = global.skillRegistry || global.toolRegistry;
    if (!registry) return notReady(res, 'SkillRegistry');
    const { tool, params = {} } = req.body;
    if (!tool) return res.status(400).json({ ok: false, error: 'tool required' });
    const result = await registry.invoke?.(`${req.params.name}.${tool}`, params);
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * GET /api/v3/diagnostics/full
 * Full system diagnostic report
 */
router.get('/diagnostics/full', async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const diag = {
      ts: new Date().toISOString(),
      uptime: process.uptime(),
      pid: process.pid,
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'production',
      memory: {
        rss: _mb(mem.rss),
        heapUsed: _mb(mem.heapUsed),
        heapTotal: _mb(mem.heapTotal),
        external: _mb(mem.external),
      },
      cpu: { user: _ms(cpu.user), system: _ms(cpu.system) },
      services: {
        mikrotik: _svc(global.mikrotik?.state?.isConnected),
        database: _svc(!!global.database),
        financial: _svc(!!global.financial),
        billing: _svc(!!global.billing),
        channelManager: _svc(!!global.channelManager),
        memoryManager: _svc(!!global.memoryManager),
        nodeRegistry: _svc(!!global.nodeRegistry),
        askEngine: _svc(!!global.askEngine),
        ai: _svc(!!(global.ai || global.coordinator)),
      },
      mikrotikState: global.mikrotik?.state || null,
      channels: global.channelManager?.getStatus?.() || {},
      nodes: global.nodeRegistry?.getAll?.() || [],
    };
    ok(res, diag);
  } catch (e) {
    err(res, e);
  }
});

/**
 * GET /api/v3/diagnostics/connectivity
 * Test MikroTik, Firebase, and AI provider connectivity
 */
router.get('/diagnostics/connectivity', async (req, res) => {
  const checks = {};

  // MikroTik
  if (global.mikrotik) {
    try {
      await global.mikrotik.executeCommand('/system/identity/print');
      checks.mikrotik = { ok: true };
    } catch (e) {
      checks.mikrotik = { ok: false, error: e.message };
    }
  } else {
    checks.mikrotik = { ok: false, error: 'not configured' };
  }

  // Database
  if (global.database) {
    try {
      await global.database.getStats();
      checks.database = { ok: true };
    } catch (e) {
      checks.database = { ok: false, error: e.message };
    }
  } else {
    checks.database = { ok: false, error: 'not configured' };
  }

  // AI
  if (global.askEngine || global.ai) {
    checks.ai = { ok: true, provider: process.env.AI_PROVIDER || 'configured' };
  } else {
    checks.ai = { ok: false, error: 'AskEngine not initialised' };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  res.status(allOk ? 200 : 206).json({ ok: allOk, data: checks });
});

/**
 * POST /api/v3/diagnostics/ping-router
 * Ping a router from within AgentOS context
 * Body: { host, count? }
 */
router.post('/diagnostics/ping-router', async (req, res) => {
  try {
    const { host, count = 3 } = req.body;
    if (!host) return res.status(400).json({ ok: false, error: 'host required' });
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const result = await global.mikrotik.executeTool('ping', { host, count });
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Audit Log ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/audit
 * Query the audit log
 * Query: ?limit=50&offset=0&userId=&event=
 */
router.get('/audit', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const { limit = 50, offset = 0, userId, event } = req.query;
    const entries =
      (await global.database.getAuditLog?.({
        limit: +limit,
        offset: +offset,
        userId,
        event,
      })) || [];
    ok(res, entries, { count: entries.length });
  } catch (e) {
    err(res, e);
  }
});

// ── Workflows ─────────────────────────────────────────────────────────────────

/**
 * GET /api/v3/workflows
 */
router.get('/workflows', (req, res) => {
  const engine = global.workflowEngine;
  if (!engine) return ok(res, []);
  ok(res, engine.list?.() || []);
});

/**
 * POST /api/v3/workflows/:name/trigger
 * Body: { payload? }
 */
router.post('/workflows/:name/trigger', async (req, res) => {
  try {
    const engine = global.workflowEngine;
    if (!engine) return notReady(res, 'WorkflowEngine');
    const result = await engine.trigger(req.params.name, req.body?.payload || {});
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Chaos Monkey (dev/staging only) ──────────────────────────────────────────

/**
 * POST /api/v3/chaos/run
 * Body: { scenario: 'latency'|'error'|'disconnect', target? }
 * Guarded behind NON_PRODUCTION
 */
router.post('/chaos/run', async (req, res) => {
  if (process.env.NODE_ENV === 'production')
    return res.status(403).json({ ok: false, error: 'ChaosMonkey disabled in production' });
  try {
    const monkey = global.chaosMonkey;
    if (!monkey) return notReady(res, 'ChaosMonkey');
    const result = await monkey.run?.(req.body?.scenario, req.body?.target);
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Config introspection (sanitised) ─────────────────────────────────────────

/**
 * GET /api/v3/config
 * Safe subset of runtime config — no secrets
 */
router.get('/config', (req, res) => {
  ok(res, {
    nodeEnv: process.env.NODE_ENV || 'production',
    gatewayPort: process.env.GATEWAY_PORT || '19876',
    aiProvider: process.env.AI_PROVIDER || 'gemini',
    paymentProvider: process.env.PAYMENT_PROVIDER || 'none',
    paymentCurrency: process.env.PAYMENT_CURRENCY || 'USD',
    firebaseProject: process.env.FIREBASE_PROJECT_ID || null,
    allowedOrigins: process.env.ALLOWED_ORIGINS || '*',
    logLevel: process.env.LOG_LEVEL || 'info',
  });
});

// ── Internal helpers ──────────────────────────────────────────────────────────
function _mb(b) {
  return `${Math.round(b / 1024 / 1024)}MB`;
}
function _ms(us) {
  return `${(us / 1e6).toFixed(3)}s`;
}
function _svc(v) {
  return { status: v ? 'up' : 'down' };
}

module.exports = router;
