/**
 * Network plan sales domain service.
 *
 * Owns plan discovery and subscription purchase semantics. Persistence is
 * supplied through the domain-neutral database port and router provisioning
 * is supplied by a network adapter; the domain never imports a concrete
 * network provider.
 */

import { getDatabase } from '../../core/ports/database.js';
import { logger as defaultLogger } from '../../core/logger.js';

const DURATION_MS = {
  minute: 60_000,
  minutes: 60_000,
  hour: 3_600_000,
  hours: 3_600_000,
  day: 86_400_000,
  days: 86_400_000,
  week: 604_800_000,
  weeks: 604_800_000,
  month: 2_592_000_000,
  months: 2_592_000_000
};

function expiry(plan, from = new Date()) {
  const value = Number(plan.durationValue || plan.durationDays || 1);
  const unit = String(plan.durationUnit || 'days').toLowerCase();
  return new Date(from.getTime() + value * (DURATION_MS[unit] || DURATION_MS.days));
}

async function firestore(database) {
  const db = await database();
  if (!db?.db) throw new Error('Plan sales require the configured database backend.');
  return db.db;
}

export function createPlanSales({ database = getDatabase, provisioner = null, log = defaultLogger } = {}) {
  async function listPlans() {
    const fs = await firestore(database);
    const snap = await fs.collection('plans').get();
    return snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((plan) => plan.active !== false)
      .sort((a, b) => (a.price || 0) - (b.price || 0));
  }

  async function getPlan(idOrName) {
    const fs = await firestore(database);
    const ref = String(idOrName);
    const byId = await fs.collection('plans').doc(ref).get();
    if (byId.exists) return { id: byId.id, ...byId.data() };
    const normalized = ref.toLowerCase();
    return (await listPlans()).find((plan) =>
      plan.id.toLowerCase() === normalized ||
      String(plan.name || '').toLowerCase() === normalized ||
      String(plan.name || '').toLowerCase().includes(normalized)
    ) || null;
  }

  async function buyPlan(uid, planRef) {
    if (!uid) throw new Error('Link your account (/link) to buy a plan.');
    const fs = await firestore(database);
    const plan = await getPlan(planRef);
    if (!plan) throw new Error(`Plan "${planRef}" not found. Send "plans" to see the list.`);

    const price = Number(plan.price || 0);
    const expiresAt = expiry(plan);
    const userRef = fs.collection('users').doc(uid);

    const result = await fs.runTransaction(async (tx) => {
      const snapshot = await tx.get(userRef);
      if (!snapshot.exists) throw new Error('Your account was not found.');
      const user = snapshot.data();
      const nonBilling = user.role === 'admin' || user.role === 'family';
      const balance = Number(user.credits || 0);
      if (!nonBilling && balance < price) {
        throw new Error(`Insufficient balance ($${balance.toFixed(2)}). ${plan.name} costs $${price.toFixed(2)} — redeem a voucher first.`);
      }

      const subscription = {
        planId: plan.id,
        planName: plan.name,
        price,
        purchasedAt: new Date(),
        expiresAt,
        deviceLimit: plan.deviceLimit || 1,
        dataLimit: plan.dataLimit || 0,
        dataConsumed: 0
      };
      tx.update(userRef, {
        subscriptions: [...(user.subscriptions || []), subscription],
        ...(!nonBilling && price > 0 ? { credits: balance - price } : {})
      });
      return {
        hotspotPass: user.hotspotPass || null,
        username: user.username || uid,
        paid: !nonBilling && price > 0
      };
    });

    let provisioned = false;
    if (provisioner?.provisionPlanAccess && result.username) {
      try {
        await provisioner.provisionPlanAccess({
          username: result.username,
          password: result.hotspotPass || result.username,
          profile: plan.id,
          sharedUsers: plan.deviceLimit || 1,
          plan
        });
        provisioned = true;
      } catch (error) {
        log.warn?.(`[PlanSales] provision failed: ${error.message}`);
      }
    }

    log.info?.(`[PlanSales] ${uid} bought ${plan.name} ($${price}) — provisioned=${provisioned}`);
    return { planName: plan.name, price, expiresAt, paid: result.paid, provisioned };
  }

  return { listPlans, getPlan, buyPlan };
}

const defaultPlanSales = createPlanSales();
export const { listPlans, getPlan, buyPlan } = defaultPlanSales;
export { expiry as planExpiry };
