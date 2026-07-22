/* ==========================================================
   09.plans.js — Render plans list, purchase plan
   Depends on: 01.ui.utils.js, 06.firebase.js, 08.ui.sections.js
   ========================================================== */

async function renderPlans() {
    try {
        const plans     = await window.DataStore.getPlans();
        const container = document.getElementById('plansList');
        if (!container) return;

        if (!plans.length) {
            container.innerHTML = '<p style="text-align:center;opacity:.6">No plans available.</p>';
            return;
        }

        container.innerHTML = plans.map(p => `
            <div class="card">
                <h3>${p.name}</h3>
                <p>${p.description || ''}</p>
                <div class="price">$${parseFloat(p.price).toFixed(2)}</div>
                <p style="font-size:.85rem;opacity:.7">${p.durationValue || 1} ${p.durationUnit || 'day(s)'}</p>
                <button class="btn btn-primary btn-block" onclick="purchasePlan('${p.id}')">Buy Plan</button>
            </div>
        `).join('');
    } catch (e) {
        console.error('[Plans] renderPlans error:', e);
        showToast('Failed to load plans.', 'error');
    }
}

window.purchasePlan = async function (planId) {
    if (!confirm('Purchase this plan?')) return;
    Loading.show('Processing...');
    try {
        const plans = await window.DataStore.getPlans();
        const plan  = plans.find(p => p.id === planId);
        if (!plan) throw new Error('Plan not found.');

        const u = window.currentUser;
        if ((u.credits || 0) < plan.price) throw new Error('Insufficient credits.');

        const now    = new Date();
        const mult   = plan.durationUnit === 'hours' ? 3600000 : 86400000;
        const expiry = new Date(now.getTime() + (plan.durationValue || 1) * mult);

        const batch   = db.batch();
        const userRef = db.collection('users').doc(u.id);

        batch.update(userRef, {
            credits:       firebase.firestore.FieldValue.increment(-plan.price),
            subscriptions: firebase.firestore.FieldValue.arrayUnion({
                planId,
                purchasedAt: firebase.firestore.Timestamp.fromDate(now),
                expiresAt:   firebase.firestore.Timestamp.fromDate(expiry)
            })
        });

        await batch.commit();

        // Refresh local user state
        window.currentUser = await window.DataStore.getUser(u.id);
        updateDashboard();
        checkPlanStatus();

        // Auto-connect to hotspot after purchase
        const net = await window.DataStore.getNetworkSettings();
        if (window.NetworkTools && net.ssid) {
            window.NetworkTools.connectToWifi(net);
        }

        showToast('Plan activated!', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};
