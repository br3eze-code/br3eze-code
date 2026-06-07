/**
 * Subscriptions Module
 * Handles plan purchases, subscription tracking, and MikroTik provisioning.
 * Version: 2026.5.1
 */

const Subscriptions = {

    // ─── §1  Purchase a Plan ──────────────────────────────────────────────────

    async purchasePlan(planId) {
        if (!window.currentUser) {
            showToast('Please login to purchase a plan.', 'error');
            return;
        }

        const plans = await DataStore.getPlans();
        const plan = plans.find(p => p.id === planId);
        if (!plan) {
            showToast('Invalid plan selected.', 'error');
            return;
        }

        const isAdmin = window.currentUser.role === 'admin';
        if (!isAdmin && (window.currentUser.credits ?? 0) < plan.price) {
            showToast('Insufficient credits. Please redeem a voucher.', 'error');
            return;
        }

        if (!confirm(`Purchase ${plan.name} for $${plan.price}?`)) return;

        try {
            Loading.show();
            const batch = db.batch();
            const userRef = DataStore.users.doc(window.currentUser.id);

            // 1. Deduct credits (skip for admin)
            if (!isAdmin) {
                batch.update(userRef, {
                    credits: firebase.firestore.FieldValue.increment(-plan.price)
                });
            }

            // 2. Compute expiry
            const startDate  = new Date();
            const expiryDate = Subscriptions._calcExpiry(startDate, plan);

            // 3. Create subscription record
            const subRef = db.collection('subscriptions').doc();
            batch.set(subRef, {
                userId:    window.currentUser.id,
                planId,
                planName:  plan.name,
                price:     plan.price,
                startDate: firebase.firestore.FieldValue.serverTimestamp(),
                expiryDate: firebase.firestore.Timestamp.fromDate(expiryDate),
                status:    'active',
                autoRenew: plan.autoRenew ?? false,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            // 4. Log transaction
            const txRef = DataStore.transactions.doc();
            batch.set(txRef, {
                userId:      window.currentUser.id,
                type:        'purchase',
                description: `Purchased ${plan.name}`,
                amount:      -plan.price,
                planId,
                timestamp:   firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();

            // 5. Provision on MikroTik via Gateway
            await Subscriptions._syncGateway(window.currentUser.id, planId, expiryDate);

            showToast(`✅ Plan ${plan.name} activated!`, 'success');

            // 6. Reload user data to reflect new balance
            const updatedUser = await DataStore.getUser(window.currentUser.id);
            window.currentUser = updatedUser;
            if (window.AppData) window.AppData.currentUser = updatedUser;

            // 7. Refresh UI
            if (window.updateUI)    window.updateUI();
            if (window.showSection) window.showSection('home');

        } catch (e) {
            console.error('[Subscriptions] Purchase Error:', e);
            showToast('Failed to purchase plan: ' + (e.message || e), 'error');
        } finally {
            Loading.hide();
        }
    },

    // ─── §2  Active Subscription Query ───────────────────────────────────────

    /**
     * Fetch the user's most recently activated subscription that is still active.
     * Returns null if none found.
     */
    async getActivePlan(userId) {
        try {
            const now = firebase.firestore.Timestamp.now();
            const snap = await db.collection('subscriptions')
                .where('userId',     '==', userId)
                .where('status',     '==', 'active')
                .where('expiryDate', '>',  now)
                .orderBy('expiryDate', 'desc')
                .limit(1)
                .get();
            if (snap.empty) return null;
            const doc = snap.docs[0];
            return { id: doc.id, ...doc.data() };
        } catch (e) {
            console.warn('[Subscriptions] getActivePlan error:', e.message);
            return null;
        }
    },

    /**
     * Fetch the last N subscriptions for a user (for history display).
     */
    async getHistory(userId, limit = 20) {
        try {
            const snap = await db.collection('subscriptions')
                .where('userId', '==', userId)
                .orderBy('createdAt', 'desc')
                .limit(limit)
                .get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e) {
            console.warn('[Subscriptions] getHistory error:', e.message);
            return [];
        }
    },

    // ─── §3  Expiry / Auto-Renewal ────────────────────────────────────────────

    /**
     * Mark expired subscriptions as 'expired' and kick sessions on MikroTik.
     * Called by the guardHotspot reaper (or manually by admin).
     */
    async expireStale() {
        try {
            const now   = firebase.firestore.Timestamp.now();
            const snap  = await db.collection('subscriptions')
                .where('status', '==', 'active')
                .where('expiryDate', '<=', now)
                .get();

            const batch = db.batch();
            const toKick = [];

            snap.docs.forEach(doc => {
                batch.update(doc.ref, { status: 'expired' });
                toKick.push(doc.data().userId);
            });

            if (!snap.empty) {
                await batch.commit();
                console.log(`[Subscriptions] Expired ${snap.size} subscription(s).`);

                // Kick sessions (non-fatal)
                for (const uid of toKick) {
                    await Subscriptions._kickSession(uid);
                }
            }
        } catch (e) {
            console.error('[Subscriptions] expireStale error:', e.message);
        }
    },

    // ─── §4  Internal Helpers ─────────────────────────────────────────────────

    /**
     * Calculate expiry date from plan duration fields.
     * Supports: durationDays, durationValue + durationUnit (minutes/hours/days/weeks/months).
     */
    _calcExpiry(from, plan) {
        const d = new Date(from);

        if (plan.durationDays) {
            d.setDate(d.getDate() + plan.durationDays);
            return d;
        }

        const value = parseInt(plan.durationValue || 1, 10);
        switch ((plan.durationUnit || 'days').toLowerCase()) {
            case 'minutes': d.setMinutes(d.getMinutes() + value); break;
            case 'hours':   d.setHours(d.getHours()     + value); break;
            case 'weeks':   d.setDate(d.getDate()        + value * 7); break;
            case 'months':  d.setMonth(d.getMonth()      + value); break;
            default:        d.setDate(d.getDate()        + value); break; // days
        }
        return d;
    },

    /**
     * POST to the MikroTik Gateway to sync a user's plan.
     * Non-fatal — gateway may be unavailable in captive-portal environments.
     */
    async _syncGateway(userId, planId, expiryDate) {
        const port = window.ENV?.GATEWAY_PORT || 3000;
        const host = window.ENV?.GATEWAY_HOST || location.hostname;
        const url  = `http://${host}:${port}/api/v1/users/sync`;

        try {
            const res = await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    user:   userId,
                    planId,
                    expiry: expiryDate.toISOString()
                }),
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) {
                console.warn(`[Subscriptions] Gateway sync returned ${res.status}`);
            }
        } catch (err) {
            console.warn('[Subscriptions] Gateway sync failed (non-fatal):', err.message);
        }
    },

    /**
     * Ask the Gateway to kick the MikroTik session for a given userId.
     * Non-fatal — session may already be terminated.
     */
    async _kickSession(userId) {
        const port = window.ENV?.GATEWAY_PORT || 3000;
        const host = window.ENV?.GATEWAY_HOST || location.hostname;
        const url  = `http://${host}:${port}/api/v1/users/kick`;

        try {
            await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ user: userId }),
                signal:  AbortSignal.timeout(5000)
            });
        } catch (err) {
            console.warn('[Subscriptions] Session kick failed (non-fatal):', err.message);
        }
    }
};

// ─── Exports ──────────────────────────────────────────────────────────────────
window.Subscriptions = Subscriptions;
// Backward-compat shim
window.purchasePlan = (planId) => Subscriptions.purchasePlan(planId);
