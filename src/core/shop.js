import { getDatabase } from './database.js';
import { logger } from './logger.js';
import { PaymentGateway } from '../payments/payment-gateway.js';
import { getCourierGateway } from './courier-gateway.js';
import { notifyNewOrder } from './order-notifier.js';

/**
 * Backend shop — lets a channel agent (WhatsApp/Telegram/etc.) browse products,
 * hold a per-chat cart, and CLOSE a sale (order + invoice + stock decrement).
 *
 * Runs with Firebase Admin (bypasses Firestore rules), so it can do the full
 * atomic checkout the web client does. Carts persist in Firestore `carts/{key}`
 * keyed by `${platform}:${channelId}` so they survive bot restarts.
 *
 * Shares the `products` / `orders` / `invoices` collections with the web shop,
 * so a sale closed over WhatsApp shows up in the same admin inventory/orders.
 */


const SHIPPING_FLAT = 5;
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://br3eze.africa';

function productUrl(id) { return `${PUBLIC_URL}/product/${id}`; }
function orderUrl(id) { return `${PUBLIC_URL}/order/${id}`; }

async function _fs() {
    const db = await getDatabase();
    if (!db.db) throw new Error('Shop requires the Firebase backend, which is not configured on this node.');
    return { db, fs: db.db };
}

function normalizeScope(scope = {}) {
    return { tenantId: scope.tenantId || null, domain: scope.domain || null, siteId: scope.siteId || null };
}

function scopeMatches(record, scope = {}) {
    const requested = normalizeScope(scope);
    return ['tenantId', 'domain', 'siteId'].every((key) => !requested[key] || !record[key] || record[key] === requested[key]);
}

function cartKey(platform, channelId, scope = {}) {
    const { tenantId, domain, siteId } = normalizeScope(scope);
    const suffix = [tenantId, domain, siteId].filter(Boolean).join(':');
    return `${platform}:${channelId}${suffix ? `:${suffix}` : ''}`;
}

async function listProducts({ category, search, scope = {} } = {}) {
    const { fs } = await _fs();
    let q = fs.collection('products').where('active', '==', true);
    const snap = await q.get();
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => scopeMatches(p, scope));
    if (category && category !== 'all') items = items.filter((p) => p.category === category);
    if (search) {
        const s = String(search).toLowerCase();
        items = items.filter((p) => `${p.name} ${p.description || ''} ${p.category} ${p.brand || ''}`.toLowerCase().includes(s));
    }
    return items;
}

async function relatedProducts(product, limit = 3, scope = {}) {
    const items = await listProducts({ category: product.category, scope });
    return items.filter((p) => p.id !== product.id).slice(0, limit);
}

async function getProduct(idOrName, scope = {}) {
    const { fs } = await _fs();
    const byId = await fs.collection('products').doc(String(idOrName)).get();
    if (byId.exists) {
        const product = { id: byId.id, ...byId.data() };
        return scopeMatches(product, scope) ? product : null;
    }
    // fall back to a case-insensitive name/slug match
    const all = await listProducts({ scope });
    const s = String(idOrName).toLowerCase();
    return all.find((p) => p.id.toLowerCase() === s || p.name.toLowerCase() === s || p.name.toLowerCase().includes(s)) || null;
}

async function getCart(platform, channelId, scope = {}) {
    const { fs } = await _fs();
    const doc = await fs.collection('carts').doc(cartKey(platform, channelId, scope)).get();
    return doc.exists ? (doc.data().items || []) : [];
}

async function _saveCart(platform, channelId, items, scope = {}) {
    const { fs } = await _fs();
    await fs.collection('carts').doc(cartKey(platform, channelId, scope)).set({ ...normalizeScope(scope), items, updatedAt: new Date().toISOString() });
}

function subtotal(items) { return items.reduce((s, i) => s + i.price * i.qty, 0); }

async function addToCart(platform, channelId, productRef, { size = null, qty = 1, scope = {} } = {}) {
    const p = await getProduct(productRef, scope);
    if (!p) throw new Error(`Product "${productRef}" not found. Send "shop" to see the catalog.`);
    if ((p.stock || 0) < 1) throw new Error(`${p.name} is sold out.`);
    if (Array.isArray(p.sizes) && p.sizes.length && !size) {
        // pick nothing — caller must supply a size
        throw new Error(`${p.name} needs a size (${p.sizes.join(', ')}). e.g. "buy ${p.id} M".`);
    }
    const items = await getCart(platform, channelId, scope);
    const key = p.id + (size ? '|' + size : '');
    const existing = items.find((i) => i.key === key);
    const have = existing ? existing.qty : 0;
    if (have + qty > (p.stock || 0)) throw new Error(`Only ${p.stock} of ${p.name} in stock.`);
    if (existing) existing.qty += qty;
    else items.push({ key, productId: p.id, name: p.name, price: Number(p.price), size, qty, category: p.category });
    await _saveCart(platform, channelId, items, scope);
    return { product: p, size, cart: items };
}

async function removeFromCart(platform, channelId, keyOrProductId, scope = {}) {
    let items = await getCart(platform, channelId, scope);
    items = items.filter((i) => i.key !== keyOrProductId && i.productId !== keyOrProductId);
    await _saveCart(platform, channelId, items, scope);
    return items;
}

async function clearCart(platform, channelId, scope = {}) { await _saveCart(platform, channelId, [], scope); }

async function getOrder(orderId, scope = {}) {
    const { fs } = await _fs();
    const doc = await fs.collection('orders').doc(String(orderId)).get();
    if (!doc.exists) return null;
    const order = { id: doc.id, ...doc.data() };
    return Object.keys(normalizeScope(scope)).some((key) => scope[key]) && !scopeMatches(order, scope) ? null : order;
}

async function getOrdersByUser(uid) {
    const { fs } = await _fs();
    const snap = await fs.collection('orders').where('userId', '==', uid).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Submit a 1-5 star review for a product. Restricted to a user who has an
 * order containing that product (any status — cod orders are real sales too),
 * one review per order+product to prevent spam re-review of the same purchase.
 */
async function submitReview(productId, uid, { rating, comment = '' } = {}) {
    if (!uid) throw new Error('Link your account (/link) to leave a review.');
    rating = Number(rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Rating must be a whole number from 1 to 5.');

    const orders = await getOrdersByUser(uid);
    const order = orders.find((o) => (o.items || []).some((i) => i.productId === productId));
    if (!order) throw new Error("You can only review products you've ordered.");

    const { fs } = await _fs();
    const reviewId = `${order.id}_${productId}`;
    const reviewRef = fs.collection('reviews').doc(reviewId);
    const productRef = fs.collection('products').doc(productId);

    await fs.runTransaction(async (tx) => {
        const existing = await tx.get(reviewRef);
        if (existing.exists) throw new Error("You've already reviewed this product for that order.");
        const pDoc = await tx.get(productRef);
        if (!pDoc.exists) throw new Error('Product no longer exists.');
        const p = pDoc.data();
        const oldCount = p.reviewCount || 0;
        const oldAvg = p.rating || 0;
        const newCount = oldCount + 1;
        const newAvg = (oldAvg * oldCount + rating) / newCount;
        tx.set(reviewRef, {
            productId, orderId: order.id, userId: uid, rating,
            comment: String(comment).slice(0, 500), createdAt: new Date().toISOString(),
        });
        tx.update(productRef, { rating: newAvg, reviewCount: newCount });
    });

    return { productId, rating, comment };
}

async function getReviews(productId, limit = 5) {
    const { fs } = await _fs();
    const snap = await fs.collection('reviews').where('productId', '==', productId).orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Books a real shipment with a courier provider (see src/core/courier-gateway.js) and records it on the order. */
async function createShipment(orderId, providerId, scope = {}) {
    const order = await getOrder(orderId, scope);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    const shipment = await getCourierGateway().createShipment(providerId, order);
    const { fs } = await _fs();
    const courier = { provider: providerId, trackingId: shipment.trackingId, status: 'created', createdAt: new Date().toISOString() };
    await fs.collection('orders').doc(orderId).update({ courier });
    logger.info(`[Shop] Shipment created for order ${orderId} via ${providerId}: ${shipment.trackingId}`);
    return { ...courier, raw: shipment.raw };
}

/** Pulls live tracking status for an order's already-created shipment. */
async function trackShipment(orderId, scope = {}) {
    const order = await getOrder(orderId, scope);
    if (!order) throw new Error(`Order ${orderId} not found.`);
    if (!order.courier?.trackingId) throw new Error('No shipment has been created for this order yet.');
    return getCourierGateway().trackShipment(order.courier.provider, order.courier.trackingId);
}

// card/cash are recorded as already-settled at time of sale (POS-style — payment
// was collected outside this system), same as credits but without touching any
// balance ledger. Only 'cod' leaves the order pending_payment.
const SETTLED_METHODS = new Set(['credits', 'card', 'cash']);

/**
 * Return payment methods usable by the current caller and configured gateway.
 * COD and credits are local methods; provider methods are discovered from the
 * shared payment gateway so channels never need to hard-code provider names.
 */
function getPaymentMethods({ country = null, device = 'unknown', uid = null, config = {} } = {}) {
    const methods = [
        { id: 'cod', name: 'Cash on delivery', type: 'offline', description: 'Pay when your order arrives.' },
    ];
    if (uid) methods.push({ id: 'credits', name: 'Account credits', type: 'balance', description: 'Pay from your linked AgentOS balance.' });
    try {
        const gateway = new PaymentGateway(config);
        methods.push(...gateway.getAvailableMethods({ country, device }));
    } catch (error) {
        logger.warn(`[Shop] Payment discovery unavailable: ${error.message}`);
    }
    return methods;
}

/**
 * Close the sale: atomic stock decrement + (optional) balance charge + order +
 * invoice. `uid` links the sale to a Power Connect account (for balance pay and
 * order history); omit for a guest cash-on-delivery sale.
 */
async function checkout(platform, channelId, { uid = null, address = {}, payMethod = 'cod', scope = {} } = {}) {
    const { fs } = await _fs();
    const items = await getCart(platform, channelId, scope);
    if (!items.length) throw new Error('Your cart is empty. Add something with "buy <product>".');

    const sub = subtotal(items);
    const shipping = SHIPPING_FLAT;
    const total = sub + shipping;
    const number = 'INV-' + Date.now().toString(36).toUpperCase();
    const orderRef = fs.collection('orders').doc();
    const invoiceRef = fs.collection('invoices').doc();

    await fs.runTransaction(async (tx) => {
        const prod = {};
        for (const it of items) {
            const ref = fs.collection('products').doc(it.productId);
            const s = await tx.get(ref);
            if (!s.exists) throw new Error(`${it.name} is no longer available.`);
            prod[it.productId] = { ref, stock: s.data().stock || 0 };
        }
        let bal = 0, userRef = null;
        if (payMethod === 'credits' && uid) {
            userRef = fs.collection('users').doc(uid);
            const us = await tx.get(userRef);
            bal = (us.exists && us.data().credits) || 0;
        }
        const need = {};
        for (const it of items) need[it.productId] = (need[it.productId] || 0) + it.qty;
        for (const pid in need) if (prod[pid].stock < need[pid]) throw new Error('Not enough stock for one of your items.');
        if (payMethod === 'credits') {
            if (!uid) throw new Error('Link your account (/link) to pay with balance.');
            if (bal < total) throw new Error(`Insufficient balance ($${bal.toFixed(2)}). Total is $${total.toFixed(2)}.`);
        }
        for (const pid in need) tx.update(prod[pid].ref, { stock: prod[pid].stock - need[pid], salesCount: (prod[pid].salesCount || 0) + need[pid] });
        if (payMethod === 'credits' && total > 0) tx.update(userRef, { credits: bal - total });

        const status = SETTLED_METHODS.has(payMethod) ? 'paid' : 'pending_payment';
        tx.set(orderRef, {
            userId: uid || null, channel: platform, channelId: String(channelId), ...normalizeScope(scope),
            items, subtotal: sub, shipping, total, currency: 'USD', status, payMethod,
            shippingAddress: address, billingAddress: address,
            invoiceId: invoiceRef.id, invoiceNumber: number, createdAt: new Date().toISOString(),
        });
        tx.set(invoiceRef, {
            userId: uid || null, orderId: orderRef.id, ...normalizeScope(scope), number,
            lineItems: items.map((i) => ({ description: `${i.name}${i.size ? ' (' + i.size + ')' : ''}`, qty: i.qty, unitPrice: i.price, amount: +(i.price * i.qty).toFixed(2) })),
            subtotal: sub, shipping, total, currency: 'USD',
            billingAddress: address, status: SETTLED_METHODS.has(payMethod) ? 'paid' : 'unpaid',
            createdAt: new Date().toISOString(),
        });
    });

    await clearCart(platform, channelId, scope);
    logger.info(`[Shop] Sale closed via ${platform}: order ${orderRef.id} (${number}), $${total}, ${payMethod}`);

    const order = { orderId: orderRef.id, invoiceNumber: number, subtotal: sub, shipping, total, payMethod, items, status: SETTLED_METHODS.has(payMethod) ? 'paid' : 'pending_payment', platform, channelId, uid };
    try {
        await notifyNewOrder(order);
    } catch (e) {
        logger.warn(`[Shop] order notification failed: ${e.message}`);
    }
    return order;
}

export { SHIPPING_FLAT, cartKey, normalizeScope, scopeMatches, listProducts, getProduct, getCart, addToCart, removeFromCart, clearCart, checkout, subtotal, getOrder, getOrdersByUser, getPaymentMethods, productUrl, orderUrl, createShipment, trackShipment, relatedProducts, submitReview, getReviews };
