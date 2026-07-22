/**
 * Plan sales — lets a channel agent (WhatsApp/Telegram/…) sell and activate a
 * hotspot PLAN in-chat, alongside the merch shop (src/core/shop.js).
 *
 * Runs with Firebase Admin (bypasses rules). A plan purchase deducts the
 * buyer's balance, appends a subscription to their account, and — if the router
 * is reachable — provisions the hotspot user so access is immediate.
 *
 * Shares the `plans` collection + users.subscriptions with the web app, so a
 * plan bought over WhatsApp behaves exactly like one bought in the PWA.
 */
'use strict';

import { getDatabase } from './database.js';
import { logger } from './logger.js';

async function _fs() {
    const db = await getDatabase();
    if (!db.db) throw new Error('Plan sales require the Firebase backend, which is not configured on this node.');
    return { db, fs: db.db };
}

/** Compute an expiry Date from a plan's duration. */
function _expiry(plan, from = new Date()) {
    const value = Number(plan.durationValue || plan.durationDays || 1);
    const unit = String(plan.durationUnit || 'days').toLowerCase();
    const ms = { minute: 6e4, minutes: 6e4, hour: 36e5, hours: 36e5, day: 864e5, days: 864e5, week: 6048e5, weeks: 6048e5, month: 2592e6, months: 2592e6 }[unit] || 864e5;
    return new Date(from.getTime() + value * ms);
}

async function listPlans() {
    const { fs } = await _fs();
    const snap = await fs.collection('plans').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.active !== false)
        .sort((a, b) => (a.price || 0) - (b.price || 0));
}

async function getPlan(idOrName) {
    const { fs } = await _fs();
    const byId = await fs.collection('plans').doc(String(idOrName)).get();
    if (byId.exists) return { id: byId.id, ...byId.data() };
    const all = await listPlans();
    const s = String(idOrName).toLowerCase();
    return all.find((p) => p.id.toLowerCase() === s || (p.name || '').toLowerCase() === s || (p.name || '').toLowerCase().includes(s)) || null;
}

/**
 * Buy + activate a plan for a linked account.
 * @param {string} uid   the buyer's Firebase uid (must be linked)
 * @param {string} planRef  plan id or name
 * @returns {{ planName, price, expiresAt, paid, provisioned }}
 */
async function buyPlan(uid, planRef) {
    if (!uid) throw new Error('Link your account (/link) to buy a plan.');
    const { fs } = await _fs();
    const plan = await getPlan(planRef);
    if (!plan) throw new Error(`Plan "${planRef}" not found. Send "plans" to see the list.`);

    const price = Number(plan.price || 0);
    const expiresAt = _expiry(plan);
    const userRef = fs.collection('users').doc(uid);

    const result = await fs.runTransaction(async (tx) => {
        const us = await tx.get(userRef);
        if (!us.exists) throw new Error('Your account was not found.');
        const u = us.data();
        const nonBilling = u.role === 'admin' || u.role === 'family';
        const bal = u.credits || 0;
        if (!nonBilling && bal < price) throw new Error(`Insufficient balance ($${bal.toFixed(2)}). ${plan.name} costs $${price.toFixed(2)} — redeem a voucher first.`);

        const subscription = {
            planId: plan.id,
            planName: plan.name,
            price,
            purchasedAt: new Date(),
            expiresAt,
            deviceLimit: plan.deviceLimit || 1,
            dataLimit: plan.dataLimit || 0,
            dataConsumed: 0,
        };
        const subscriptions = [...(u.subscriptions || []), subscription];
        const update = { subscriptions };
        if (!nonBilling && price > 0) update.credits = bal - price;
        tx.update(userRef, update);
        return { hotspotPass: u.hotspotPass || null, username: u.username || uid, paid: !nonBilling && price > 0 };
    });

    // Best-effort MikroTik provisioning so access works immediately.
    let provisioned = false;
    try {
        const mt = global.mikrotik;
        if (mt && mt.state && mt.state.isConnected && result.username) {
            await mt.addHotspotUser({ username: result.username, password: result.hotspotPass || result.username, profile: plan.id, sharedUsers: plan.deviceLimit || 1 });
            provisioned = true;
        }
    } catch (e) { logger.warn(`[PlanSales] provision failed: ${e.message}`); }

    logger.info(`[PlanSales] ${uid} bought ${plan.name} ($${price}) — provisioned=${provisioned}`);
    return { planName: plan.name, price, expiresAt, paid: result.paid, provisioned };
}

export { listPlans, getPlan, buyPlan };
