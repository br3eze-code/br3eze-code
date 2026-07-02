/**
 * API Routes v1 — AgentOS Enhanced
 * MikroTik · Vouchers · Users · Tools · Hotspot
 * @module api/routes/v1
 * @version 2026.6.17
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getManager } = require('../../core/mikrotik');
const { getDatabase } = require('../../core/database');
const { logger } = require('../../core/logger');

// ── Request logging ───────────────────────────────────────────────────────────
router.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.debug(`API v1 ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok = (res, data, meta = {}) => res.json({ ok: true, ...meta, data });
const err = (res, e, status = 500) => {
  logger.error(`v1 error: ${e.message}`);
  res.status(status).json({ ok: false, error: e.message });
};
const notReady = (res, svc) => res.status(503).json({ ok: false, error: `${svc} not ready` });

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: 'v1',
    ts: new Date().toISOString(),
    services: {
      mikrotik: !!global.mikrotik?.state?.isConnected,
      database: !!global.database,
      financial: !!global.financial,
      billing: !!global.billing,
    },
  });
});

// ── MikroTik — System ─────────────────────────────────────────────────────────
router.get('/system/stats', async (req, res) => {
  try {
    const mt = getManager();
    const stats = await mt.executeTool('system.stats', {});
    ok(res, stats);
  } catch (e) {
    err(res, e);
  }
});

router.get('/system/resources', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const data = await global.mikrotik.executeCommand('/system/resource/print');
    ok(res, data);
  } catch (e) {
    err(res, e);
  }
});

router.get('/system/identity', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const data = await global.mikrotik.executeCommand('/system/identity/print');
    ok(res, data);
  } catch (e) {
    err(res, e);
  }
});

router.post('/system/ping', async (req, res) => {
  try {
    const { host, count = 4 } = req.body;
    if (!host) return res.status(400).json({ ok: false, error: 'host required' });
    const mt = getManager();
    const result = await mt.executeTool('ping', { host, count });
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

router.post('/system/reboot', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    await global.mikrotik.executeCommand('/system/reboot');
    ok(res, { scheduled: true, message: 'Router rebooting in ~3s' });
  } catch (e) {
    err(res, e);
  }
});

// ── MikroTik — Hotspot Users ──────────────────────────────────────────────────
router.get('/users/active', async (req, res) => {
  try {
    const mt = getManager();
    const users = await mt.executeTool('users.active', {});
    ok(res, users, { count: Array.isArray(users) ? users.length : undefined });
  } catch (e) {
    err(res, e);
  }
});

router.get('/users/all', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const users = await global.mikrotik.executeCommand('/ip/hotspot/user/print');
    ok(res, users, { count: Array.isArray(users) ? users.length : undefined });
  } catch (e) {
    err(res, e);
  }
});

router.post('/users/add', async (req, res) => {
  try {
    const { username, password, profile = 'default', limitUptime } = req.body;
    if (!username || !password)
      return res.status(400).json({ ok: false, error: 'username and password required' });
    const mt = getManager();
    const result = await mt.executeTool('user.add', { username, password, profile, limitUptime });
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

router.delete('/users/:username', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    await global.mikrotik.executeCommand('/ip/hotspot/user/remove', { '.id': req.params.username });
    ok(res, { removed: req.params.username });
  } catch (e) {
    err(res, e);
  }
});

router.post('/users/:id/disconnect', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    await global.mikrotik.executeCommand('/ip/hotspot/active/remove', { '.id': req.params.id });
    ok(res, { disconnected: req.params.id });
  } catch (e) {
    err(res, e);
  }
});

router.get('/users/:id/memory', async (req, res) => {
  try {
    if (!global.memoryManager) return notReady(res, 'MemoryManager');
    const history = (await global.memoryManager.adapter.get(`user:${req.params.id}:history`)) || [];
    const context = await global.memoryManager.getUserContext(req.params.id);
    ok(res, { history, context });
  } catch (e) {
    err(res, e);
  }
});

router.post('/users/:id/permissions', async (req, res) => {
  try {
    if (!global.memoryManager) return notReady(res, 'MemoryManager');
    const { permissions } = req.body;
    if (!Array.isArray(permissions))
      return res.status(400).json({ ok: false, error: 'permissions must be an array' });
    await global.memoryManager.setPermissions(req.params.id, permissions);
    ok(res, { permissions });
  } catch (e) {
    err(res, e);
  }
});

router.post('/users/sync', async (req, res) => {
  try {
    const { user, planId } = req.body;
    if (!user || !planId)
      return res.status(400).json({ ok: false, error: 'user and planId required' });
    if (global.mikrotik?.state?.isConnected) {
      await global.mikrotik.addHotspotUser(user, user, planId);
    }
    ok(res, { synced: true });
  } catch (e) {
    err(res, e);
  }
});

// ── Vouchers ──────────────────────────────────────────────────────────────────
router.get('/vouchers/stats', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    ok(res, await global.database.getStats());
  } catch (e) {
    err(res, e);
  }
});

router.get('/vouchers', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const { status, plan, limit = 50, offset = 0 } = req.query;
    const filters = { limit: Number(limit), offset: Number(offset) };
    if (status) filters.status = status;
    if (plan) filters.plan = plan;
    const vouchers = await global.database.getVouchers(filters);
    ok(res, vouchers, { count: vouchers.length });
  } catch (e) {
    err(res, e);
  }
});

router.post('/vouchers', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const crypto = require('crypto');
    const { DEFAULT_PLANS } = require('../../core/database');
    const dateUtils = require('../../utils/date');

    const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    const code = `STAR-${part()}-${part()}`;
    const plan = req.body.plan || 'default';
    const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
    const mt = global.mikrotik;

    const expiresAt =
      planObj.durationValue && planObj.durationUnit
        ? dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString()
        : null;
    const loginUrl = `http://${mt?.config?.host || 'br3eze.africa'}/login?username=${code}&password=${code}`;

    const vData = {
      ...req.body,
      plan,
      planName: req.body.planName || planObj.name || plan,
      durationUnit: req.body.durationUnit || planObj.durationUnit || null,
      durationValue: req.body.durationValue || planObj.durationValue || null,
      deviceLimit: req.body.deviceLimit || planObj.deviceLimit || 1,
      expiresAt: req.body.expiresAt || expiresAt,
      loginUrl: req.body.loginUrl || loginUrl,
      createdBy: req.body.createdBy || 'api-v1',
    };

    const voucher = await global.database.createVoucher(code, vData);

    if (mt?.state?.isConnected) {
      const dur = _mikrotikDuration(vData);
      await mt
        .addHotspotUser({
          username: code,
          password: code,
          profile: plan,
          sharedUsers: vData.deviceLimit,
          ...(dur && { limitUptime: dur }),
        })
        .catch(e2 => logger.warn(`MT voucher provision warn: ${e2.message}`));
    }

    ok(res, voucher);
  } catch (e) {
    err(res, e);
  }
});

router.get('/vouchers/:code', async (req, res) => {
  try {
    if (!global.database) return notReady(res, 'Database');
    const v = await global.database.getVoucher(req.params.code);
    if (!v) return res.status(404).json({ ok: false, error: 'Voucher not found' });
    ok(res, v);
  } catch (e) {
    err(res, e);
  }
});

router.get('/vouchers/:code/qr', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    if (!global.database) return notReady(res, 'Database');
    const v = await global.database.getVoucher(req.params.code);
    if (!v) return res.status(404).json({ ok: false, error: 'Voucher not found' });
    const url = `${req.protocol}://${req.get('host')}/login.html?code=${req.params.code}`;
    const qr = await QRCode.toDataURL(JSON.stringify({ code: req.params.code, plan: v.plan, url }));
    ok(res, { qr, code: req.params.code, plan: v.plan, url });
  } catch (e) {
    err(res, e);
  }
});

router.post('/vouchers/redeem', async (req, res) => {
  try {
    const { code, user } = req.body;
    if (!code || !user) return res.status(400).json({ ok: false, error: 'code and user required' });
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const v = await global.database?.getVoucher(code);
    if (!v) return res.status(404).json({ ok: false, error: 'Voucher not found' });
    if (v.used) return res.status(400).json({ ok: false, error: 'Voucher already used' });
    await global.mikrotik.addHotspotUser(user, user, v.planId || v.plan);
    await global.database.redeemVoucher(code, { username: user, ip: req.ip });
    ok(res, { status: 'activated', plan: v.planId || v.plan });
  } catch (e) {
    err(res, e);
  }
});

router.post('/vouchers/pay', async (req, res) => {
  try {
    const { plan, amount, method } = req.body;
    if (!plan || !amount)
      return res.status(400).json({ ok: false, error: 'plan and amount required' });
    const crypto = require('crypto');
    const { DEFAULT_PLANS } = require('../../core/database');
    const dateUtils = require('../../utils/date');
    const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
    const expiresAt =
      planObj.durationValue && planObj.durationUnit
        ? dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString()
        : null;
    const code = `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const loginUrl = `http://${global.mikrotik?.config?.host || 'br3eze.africa'}/login?username=${code}&password=${code}`;

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
        createdBy: 'api-pay-v1',
      });
      if (global.mikrotik?.state?.isConnected) {
        await global.mikrotik
          .addHotspotUser({
            username: code,
            password: code,
            profile: plan,
            sharedUsers: planObj.deviceLimit || 1,
            ...(expiresAt && { limitUptime: _mikrotikDuration(planObj) }),
          })
          .catch(() => {});
      }
    }
    ok(res, { code, status: 'paid' });
  } catch (e) {
    err(res, e);
  }
});

// ── Plans ─────────────────────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
  try {
    const { DEFAULT_PLANS } = require('../../core/database');
    ok(res, DEFAULT_PLANS);
  } catch (e) {
    err(res, e);
  }
});

// ── Hotspot Profiles ──────────────────────────────────────────────────────────
router.get('/hotspot/profiles', async (req, res) => {
  try {
    if (!global.mikrotik?.state?.isConnected) return notReady(res, 'MikroTik');
    const profiles = await global.mikrotik.executeCommand('/ip/hotspot/user/profile/print');
    ok(res, profiles);
  } catch (e) {
    err(res, e);
  }
});

router.patch('/hotspot/profiles/:name', async (req, res) => {
  try {
    const mt = getManager();
    const result = await mt.executeTool('hotspot.profile.update', {
      name: req.params.name,
      ...req.body,
    });
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Tools ─────────────────────────────────────────────────────────────────────
router.get('/tools', (req, res) => {
  const tools = global.mikrotik?.getAvailableTools?.() || [];
  ok(res, tools, { count: tools.length });
});

router.post('/tools/:tool', async (req, res) => {
  try {
    if (!global.mikrotik) return notReady(res, 'MikroTik');
    const result = await global.mikrotik.executeTool(req.params.tool, req.body);
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

router.post('/execute', async (req, res) => {
  try {
    const { tool, params } = req.body;
    if (!tool) return res.status(400).json({ ok: false, error: 'tool required' });
    const mt = getManager();
    const result = await mt.executeTool(tool, params || {});
    ok(res, result);
  } catch (e) {
    err(res, e);
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────
router.get('/sessions/:id', async (req, res) => {
  try {
    if (!global.memoryManager) return notReady(res, 'MemoryManager');
    const s = await global.memoryManager.getSession(req.params.id);
    if (!s) return res.status(404).json({ ok: false, error: 'Session not found' });
    ok(res, s);
  } catch (e) {
    err(res, e);
  }
});

// ── Mesh Nodes ────────────────────────────────────────────────────────────────
router.get('/nodes', (req, res) => {
  const nodes = global.nodeRegistry?.getAll?.() || [];
  ok(res, nodes, { count: nodes.length });
});

router.post('/nodes', async (req, res) => {
  try {
    if (!global.nodeRegistry) return notReady(res, 'NodeRegistry');
    const { name, ip, user, pass, port = 8728 } = req.body;
    if (!name || !ip) return res.status(400).json({ ok: false, error: 'name and ip required' });
    const node = global.nodeRegistry.add(name, ip, user, pass, port);
    await node.connect();
    ok(res, { name, status: 'connected' });
  } catch (e) {
    err(res, e);
  }
});

router.delete('/nodes/:name', (req, res) => {
  try {
    if (!global.nodeRegistry) return notReady(res, 'NodeRegistry');
    global.nodeRegistry.remove?.(req.params.name);
    ok(res, { removed: req.params.name });
  } catch (e) {
    err(res, e);
  }
});

// ── Webhooks ──────────────────────────────────────────────────────────────────
router.post('/webhooks/email', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const emailChannel = global.channelManager?.channels?.get?.('email');
    if (!emailChannel) return notReady(res, 'Email channel');
    const { sender, from, subject = '', text = '' } = req.body;
    const raw = sender || from || req.body.envelope?.from;
    if (!raw) return res.status(400).json({ ok: false, error: 'Sender address missing' });
    const emailAddr = (raw.match(/<(.+)>/) || [])[1] || raw;
    await emailChannel.adapter.handleIncomingEmail(emailAddr, subject, text, req.body);
    res.status(200).send('OK');
  } catch (e) {
    err(res, e);
  }
});

// ── Diagnostics ───────────────────────────────────────────────────────────────
router.get('/diagnostics', async (req, res) => {
  try {
    const mem = process.memoryUsage();
    ok(res, {
      uptime: process.uptime(),
      memory: { rss: _mb(mem.rss), heap: _mb(mem.heapUsed), heapTotal: _mb(mem.heapTotal) },
      mikrotik: global.mikrotik?.state || { isConnected: false },
      database: !!global.database,
      nodeCount: global.nodeRegistry?.getAll?.()?.length || 0,
    });
  } catch (e) {
    err(res, e);
  }
});

// ── Internal helpers ──────────────────────────────────────────────────────────
function _mikrotikDuration(p) {
  if (!p?.durationValue || !p?.durationUnit) return null;
  const v = p.durationValue;
  switch (p.durationUnit) {
    case 'weeks':
      return `${v}w`;
    case 'days':
      return `${v}d`;
    case 'hours':
      return `${String(v).padStart(2, '0')}:00:00`;
    case 'minutes':
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
    default:
      return null;
  }
}

function _mb(bytes) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

module.exports = router;
