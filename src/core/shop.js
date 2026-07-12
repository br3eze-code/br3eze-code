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
'use strict';

const { getDatabase } = require('./database');
const logger = require('./logger').logger || require('./logger');

const SHIPPING_FLAT = 5;

async function _fs() {
    const db = await getDatabase();
    if (!db.db) throw new Error('Shop requires the Firebase backend, which is not configured on this node.');
    return { db, fs: db.db };
}

function cartKey(platform, channelId) { return `${platform}:${channelId}`; }

async function listProducts({ category, search } = {}) {
    const { fs } = await _fs();
    let q = fs.collection('products').where('active', '==', true);
    const snap = await q.get();
    let items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (category && category !== 'all') items = items.filter((p) => p.category === category);
    if (search) {
        const s = String(search).toLowerCase();
        items = items.filter((p) => `${p.name} ${p.description || ''} ${p.category}`.toLowerCase().includes(s));
    }
    return items;
}

async function getProduct(idOrName) {
    const { fs } = await _fs();
    const byId = await fs.collection('products').doc(String(idOrName)).get();
    if (byId.exists) return { id: byId.id, ...byId.data() };
    // fall back to a case-insensitive name/slug match
    const all = await listProducts();
    const s = String(idOrName).toLowerCase();
    return all.find((p) => p.id.toLowerCase() === s || p.name.toLowerCase() === s || p.name.toLowerCase().includes(s)) || null;
}

async function getCart(platform, channelId) {
    const { fs } = await _fs();
    const doc = await fs.collection('carts').doc(cartKey(platform, channelId)).get();
    return doc.exists ? (doc.data().items || []) : [];
}

async function _saveCart(platform, channelId, items) {
    const { fs } = await _fs();
    await fs.collection('carts').doc(cartKey(platform, channelId)).set({ items, updatedAt: new Date().toISOString() });
}

function subtotal(items) { return items.reduce((s, i) => s + i.price * i.qty, 0); }

async function addToCart(platform, channelId, productRef, { size = null, qty = 1 } = {}) {
    const p = await getProduct(productRef);
    if (!p) throw new Error(`Product "${productRef}" not found. Send "shop" to see the catalog.`);
    if ((p.stock || 0) < 1) throw new Error(`${p.name} is sold out.`);
    if (Array.isArray(p.sizes) && p.sizes.length && !size) {
        // pick nothing — caller must supply a size
        throw new Error(`${p.name} needs a size (${p.sizes.join(', ')}). e.g. "buy ${p.id} M".`);
    }
    const items = await getCart(platform, channelId);
    const key = p.id + (size ? '|' + size : '');
    const existing = items.find((i) => i.key === key);
    const have = existing ? existing.qty : 0;
    if (have + qty > (p.stock || 0)) throw new Error(`Only ${p.stock} of ${p.name} in stock.`);
    if (existing) existing.qty += qty;
    else items.push({ key, productId: p.id, name: p.name, price: Number(p.price), size, qty, category: p.category });
    await _saveCart(platform, channelId, items);
    return { product: p, size, cart: items };
}

async function removeFromCart(platform, channelId, keyOrProductId) {
    let items = await getCart(platform, channelId);
    items = items.filter((i) => i.key !== keyOrProductId && i.productId !== keyOrProductId);
    await _saveCart(platform, channelId, items);
    return items;
}

async function clearCart(platform, channelId) { await _saveCart(platform, channelId, []); }

/**
 * Close the sale: atomic stock decrement + (optional) balance charge + order +
 * invoice. `uid` links the sale to a Power Connect account (for balance pay and
 * order history); omit for a guest cash-on-delivery sale.
 */
async function checkout(platform, channelId, { uid = null, address = {}, payMethod = 'cod' } = {}) {
    const { fs } = await _fs();
    const items = await getCart(platform, channelId);
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
        for (const pid in need) tx.update(prod[pid].ref, { stock: prod[pid].stock - need[pid] });
        if (payMethod === 'credits' && total > 0) tx.update(userRef, { credits: bal - total });

        const status = payMethod === 'credits' ? 'paid' : 'pending_payment';
        tx.set(orderRef, {
            userId: uid || null, channel: platform, channelId: String(channelId),
            items, subtotal: sub, shipping, total, currency: 'USD', status, payMethod,
            shippingAddress: address, billingAddress: address,
            invoiceId: invoiceRef.id, invoiceNumber: number, createdAt: new Date().toISOString(),
        });
        tx.set(invoiceRef, {
            userId: uid || null, orderId: orderRef.id, number,
            lineItems: items.map((i) => ({ description: `${i.name}${i.size ? ' (' + i.size + ')' : ''}`, qty: i.qty, unitPrice: i.price, amount: +(i.price * i.qty).toFixed(2) })),
            subtotal: sub, shipping, total, currency: 'USD',
            billingAddress: address, status: payMethod === 'credits' ? 'paid' : 'unpaid',
            createdAt: new Date().toISOString(),
        });
    });

    await clearCart(platform, channelId);
    logger.info(`[Shop] Sale closed via ${platform}: order ${orderRef.id} (${number}), $${total}, ${payMethod}`);
    return { orderId: orderRef.id, invoiceNumber: number, subtotal: sub, shipping, total, payMethod, items };
}

export default {
    SHIPPING_FLAT, cartKey, listProducts, getProduct, getCart, addToCart,
    removeFromCart, clearCart, checkout, subtotal,
};
