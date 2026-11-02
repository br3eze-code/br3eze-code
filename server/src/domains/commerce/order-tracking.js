import { getCourierGateway } from '../../../../src/adapters/commerce/courier-gateway.js';

const PRIVILEGED_ROLES = new Set(['admin', 'owner', 'merchant', 'logistics', 'fulfillment', 'support']);

function principal(req) {
  const user = req.user || {};
  return {
    uid: String(user.uid || user.userId || user.id || user.sub || ''),
    tenantId: user.tenantId || user.tenant_id || null,
    role: String(user.role || (Array.isArray(user.roles) ? user.roles[0] : '') || '').toLowerCase()
  };
}

function safeTracking(order) {
  const courier = order.courier || {};
  return {
    orderId: order.orderId || order.id,
    invoiceNumber: order.invoiceNumber || null,
    status: order.status || 'unknown',
    fulfillmentStatus: order.fulfillmentStatus || 'unfulfilled',
    shipment: courier.trackingId ? {
      provider: courier.provider || null,
      trackingId: courier.trackingId,
      status: courier.status || order.fulfillmentStatus || 'unknown',
      trackingUrl: courier.trackingUrl || null,
      updatedAt: courier.updatedAt || courier.createdAt || null
    } : null,
    updatedAt: order.updatedAt || order.createdAt || null
  };
}

function canRead(order, actor) {
  if (actor.role && PRIVILEGED_ROLES.has(actor.role)) {
    return !actor.tenantId || !order.tenantId || actor.tenantId === order.tenantId;
  }
  return Boolean(actor.uid && order.userId && actor.uid === order.userId &&
    (!actor.tenantId || !order.tenantId || actor.tenantId === order.tenantId));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function sendTrackingEmail({ order, tracking, logger }) {
  if (process.env.EMAIL_ENABLED !== 'true' || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !order.email) return { sent: false, reason: 'email_not_configured_or_missing_recipient' };
  const status = escapeHtml(tracking.fulfillmentStatus || tracking.shipment?.status || 'updated');
  const trackingUrl = process.env.ORDER_TRACKING_BASE_URL || process.env.PUBLIC_URL || 'https://br3eze.africa';
  const url = `${trackingUrl.replace(/\/$/, '')}/order/${encodeURIComponent(order.orderId || order.id)}`;
  const payload = {
    from: process.env.EMAIL_FROM,
    to: [order.email],
    ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
    subject: `Order ${order.invoiceNumber || order.orderId || order.id}: delivery update`,
    html: `<p>Your Br3eze order <strong>${escapeHtml(order.invoiceNumber || order.orderId || order.id)}</strong> has a delivery update.</p><p>Current status: <strong>${status}</strong></p><p><a href="${escapeHtml(url)}">View order tracking</a></p>`,
    text: `Your Br3eze order ${order.invoiceNumber || order.orderId || order.id} has a delivery update. Status: ${tracking.fulfillmentStatus || tracking.shipment?.status || 'updated'}. Track: ${url}`
  };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `order-tracking:${order.orderId || order.id}:${tracking.fulfillmentStatus || tracking.shipment?.status || 'updated'}`
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger?.warn?.('Resend order tracking email failed', { status: response.status, detail: detail.slice(0, 300) });
    throw new Error('Tracking notification delivery failed');
  }
  return { sent: true, provider: 'resend' };
}

export function registerOrderTrackingRoutes({ app, db, authMiddleware, logger = console, courierGateway = getCourierGateway() }) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function') throw new TypeError('Express app is required');
  if (!db || typeof db.collection !== 'function') throw new TypeError('Firestore database is required');
  if (typeof authMiddleware !== 'function') throw new TypeError('Authentication middleware is required');

  app.get('/api/v1/orders/:orderId/tracking', authMiddleware, async (req, res) => {
    try {
      const id = String(req.params.orderId || '').trim();
      if (!id || id.length > 128) return res.status(400).json({ error: 'Invalid order ID' });
      const snap = await db.collection('orders').doc(id).get();
      if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
      const order = { id: snap.id, ...snap.data() };
      if (!canRead(order, principal(req))) return res.status(404).json({ error: 'Order not found' });
      return res.json({ success: true, tracking: safeTracking(order) });
    } catch (error) {
      logger.error?.('Order tracking read failed', { message: error.message });
      return res.status(500).json({ error: 'Unable to retrieve order tracking' });
    }
  });

  app.post('/api/v1/orders/:orderId/tracking/refresh', authMiddleware, async (req, res) => {
    try {
      const actor = principal(req);
      if (!PRIVILEGED_ROLES.has(actor.role)) return res.status(403).json({ error: 'Logistics permission required' });
      const id = String(req.params.orderId || '').trim();
      if (!id || id.length > 128) return res.status(400).json({ error: 'Invalid order ID' });
      const ref = db.collection('orders').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Order not found' });
      const order = { id: snap.id, ...snap.data() };
      if (actor.tenantId && order.tenantId && actor.tenantId !== order.tenantId) return res.status(404).json({ error: 'Order not found' });
      if (!order.courier?.provider || !order.courier?.trackingId) return res.status(409).json({ error: 'No shipment is attached to this order' });
      const result = await courierGateway.trackShipment(order.courier.provider, order.courier.trackingId, { userId: actor.uid, tenantId: order.tenantId || actor.tenantId, role: actor.role });
      const nextStatus = String(result?.status || result?.state || order.fulfillmentStatus || 'in_transit');
      const previousStatus = String(order.fulfillmentStatus || order.courier.status || '');
      const updatedAt = new Date().toISOString();
      const patch = {
        'courier.status': nextStatus,
        'courier.updatedAt': updatedAt,
        fulfillmentStatus: nextStatus,
        updatedAt
      };
      if (Array.isArray(result?.events)) patch['courier.events'] = result.events.slice(-100);
      await ref.update(patch);
      const updated = { ...order, courier: { ...order.courier, status: nextStatus, updatedAt, ...(Array.isArray(result?.events) ? { events: result.events.slice(-100) } : {}) }, fulfillmentStatus: nextStatus, updatedAt };
      let notification = { sent: false, reason: 'status_unchanged' };
      if (nextStatus !== previousStatus) {
        try {
          if (!updated.email && updated.userId) {
            const userSnap = await db.collection('users').doc(String(updated.userId)).get();
            if (userSnap.exists) updated.email = userSnap.data()?.email || null;
          }
          notification = await sendTrackingEmail({ order: updated, tracking: safeTracking(updated), logger });
        }
        catch (error) { notification = { sent: false, reason: 'delivery_failed' }; }
      }
      return res.json({ success: true, tracking: safeTracking(updated), notification });
    } catch (error) {
      logger.error?.('Order tracking refresh failed', { message: error.message });
      return res.status(502).json({ error: 'Courier tracking refresh failed' });
    }
  });
}
