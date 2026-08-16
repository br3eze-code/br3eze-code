import express from 'express';
import * as shop from '../../core/shop.js';
import { generateOrderPdf } from '../../core/invoice-pdf.js';
import { logger } from '../../core/logger.js';
import { getProductQueryService } from '../../core/product-query-service-bridge.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/**
 * API Routes — Shop
 * Product catalog, per-channel cart, checkout, and order lookups.
 * Mounted at /api/v1/shop by gateway-engine.js.
 * @module api/routes/shop
 */

const router = express.Router();

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, e, status = 400) => res.status(status).json({ ok: false, error: e.message });
const requestOrderScope = (req) => {
  const user = req.firebaseUser || {};
  const claims = user.customClaims || {};
  return {
    tenantId: user.tenantId || claims.tenantId || null,
    siteId: user.siteId || claims.siteId || null,
    domain: user.domain || user.domainId || claims.domain || claims.domainId || null,
  };
};
const canViewOrder = (req, order) => {
  const isOwner = req.firebaseUser?.uid && order.userId === req.firebaseUser.uid;
  const isAdmin = req.firebaseUser?.role === 'admin';
  return isOwner || isAdmin;
};
const requestProductScope = (req) => {
  const user = req.firebaseUser || {};
  const claims = user.customClaims || {};
  return {
    userId: user.uid || null,
    tenantId: user.tenantId || claims.tenantId || null,
    siteId: user.siteId || claims.siteId || null,
    domain: user.domain || user.domainId || claims.domain || claims.domainId || null,
    role: user.role || claims.role || 'user',
    tier: user.influenceTier || claims.influenceTier || 'standard',
  };
};

router.get('/products/query', async (req, res) => {
  const scope = requestProductScope(req);
  if (!scope.userId) return res.status(401).json({ ok: false, error: 'Firebase identity required' });
  if (!scope.tenantId) return res.status(403).json({ ok: false, error: 'Tenant scope required' });
  try {
    const service = await getProductQueryService();
    if (!service) return res.status(503).json({ ok: false, error: 'Product query service is not built' });
    const include = String(req.query.include || 'name,brand,tier,category,description,price,availability')
      .split(',').map((field) => field.trim()).filter(Boolean);
    const result = await service.search({
      scope,
      filters: {
        name: req.query.name || req.query.search,
        brand: req.query.brand,
        tier: req.query.tier,
        category: req.query.category,
        sku: req.query.sku,
        availability: req.query.availability,
        limit: req.query.limit,
      },
      include,
      source: req.query.source || 'auto',
      viewerRole: scope.role,
      viewerTier: scope.tier,
      purpose: 'product_inquiry',
    });
    return ok(res, result);
  } catch (e) {
    return fail(res, e, e.status || 500);
  }
});

router.get('/products', async (req, res) => {
  try {
    const items = await shop.listProducts({ category: req.query.category, search: req.query.search });
    ok(res, items);
  } catch (e) { fail(res, e, 500); }
});

router.get('/products/:id', async (req, res) => {
  try {
    const product = await shop.getProduct(req.params.id);
    if (!product) return res.status(404).json({ ok: false, error: 'Product not found' });
    ok(res, product);
  } catch (e) { fail(res, e, 500); }
});

router.get('/cart', async (req, res) => {
  try {
    const { platform, channelId } = req.query;
    if (!platform || !channelId) return res.status(400).json({ ok: false, error: 'platform and channelId required' });
    ok(res, await shop.getCart(platform, channelId));
  } catch (e) { fail(res, e, 500); }
});

router.post('/cart/add', async (req, res) => {
  try {
    const { platform, channelId, productRef, size, qty } = req.body || {};
    if (!platform || !channelId || !productRef) return res.status(400).json({ ok: false, error: 'platform, channelId, productRef required' });
    ok(res, await shop.addToCart(platform, channelId, productRef, { size, qty }));
  } catch (e) { fail(res, e); }
});

router.post('/cart/remove', async (req, res) => {
  try {
    const { platform, channelId, keyOrProductId } = req.body || {};
    if (!platform || !channelId || !keyOrProductId) return res.status(400).json({ ok: false, error: 'platform, channelId, keyOrProductId required' });
    ok(res, await shop.removeFromCart(platform, channelId, keyOrProductId));
  } catch (e) { fail(res, e); }
});

router.post('/checkout', async (req, res) => {
  try {
    const { platform, channelId, address, payMethod } = req.body || {};
    if (!platform || !channelId) return res.status(400).json({ ok: false, error: 'platform and channelId required' });
    // Never trust a client-supplied uid for a balance charge — always the authenticated caller.
    const uid = req.firebaseUser?.uid || null;
    const result = await shop.checkout(platform, channelId, { uid, address, payMethod });
    logger.info(`[Shop API] checkout ${platform}:${channelId} uid=${uid} order=${result.orderId}`);
    ok(res, result);
  } catch (e) { fail(res, e); }
});

router.get('/orders', async (req, res) => {
  try {
    if (!req.firebaseUser?.uid) return res.status(401).json({ ok: false, error: 'Sign in to view your orders' });
    ok(res, await shop.getOrdersByUser(req.firebaseUser.uid));
  } catch (e) { fail(res, e, 500); }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const order = await shop.getOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (!canViewOrder(req, order)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    ok(res, order);
  } catch (e) { fail(res, e, 500); }
});

router.get('/orders/:id/pdf', async (req, res) => {
  try {
    const order = await shop.getOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (!canViewOrder(req, order)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    const pdf = await generateOrderPdf({ ...order, orderId: order.id });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${order.invoiceNumber || order.id}.pdf"`);
    res.send(pdf);
  } catch (e) {
    logger.error(`[Shop API] PDF generation failed: ${e.message}`);
    fail(res, e, 500);
  }
});

router.get('/couriers', (req, res) => {
  const { getCourierGateway } = require('../../core/courier-gateway');
  ok(res, getCourierGateway().getAvailableProviders());
});

router.post('/orders/:id/ship', async (req, res) => {
  try {
    if (req.firebaseUser && req.firebaseUser.role !== 'admin') return res.status(403).json({ ok: false, error: 'Admin role required' });
    const { provider } = req.body || {};
    if (!provider) return res.status(400).json({ ok: false, error: 'provider required' });
    ok(res, await shop.createShipment(req.params.id, provider, requestOrderScope(req)));
  } catch (e) { fail(res, e, 500); }
});

router.get('/orders/:id/track', async (req, res) => {
  try {
    const order = await shop.getOrder(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });
    if (!canViewOrder(req, order)) return res.status(403).json({ ok: false, error: 'Forbidden' });
    ok(res, await shop.trackShipment(req.params.id, requestOrderScope(req)));
  } catch (e) { fail(res, e, 500); }
});

export default router;
