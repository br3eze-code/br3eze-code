/* ==========================================================
   09.plans.js — Render plans list, purchase plan
   Depends on: 01.ui.utils.js, 06.firebase.js, 08.ui.sections.js
   ========================================================== */
'use strict';

function planText(value) { return value == null ? '' : String(value); }
function planNode(tag, text, className) { const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = planText(text); return el; }

async function renderPlans() {
    try {
        const plans = await window.DataStore.getPlans();
        const container = document.getElementById('plansList');
        if (!container) return;
        if (!plans.length) { const p = planNode('p', 'No plans available.'); p.style.cssText = 'text-align:center;opacity:.6'; container.replaceChildren(p); return; }
        const fragment = document.createDocumentFragment();
        plans.forEach(p => {
            const card = planNode('div', null, 'card');
            card.appendChild(planNode('h3', p.name));
            card.appendChild(planNode('p', p.description || ''));
            card.appendChild(planNode('div', '$' + parseFloat(p.price).toFixed(2), 'price'));
            const duration = planNode('p', `${p.durationValue || 1} ${p.durationUnit || 'day(s)'}`); duration.style.cssText = 'font-size:.85rem;opacity:.7'; card.appendChild(duration);
            const button = planNode('button', 'Buy Plan', 'btn btn-primary btn-block');
            button.addEventListener('click', () => window.purchasePlan(p.id));
            card.appendChild(button); fragment.appendChild(card);
        });
        container.replaceChildren(fragment);
    } catch (e) { console.error('[Plans] renderPlans error:', e); showToast('Failed to load plans.', 'error'); }
}

window.purchasePlan = async function (planId) {
    if (!confirm('Purchase this plan?')) return;
    Loading.show('Processing...');
    try {
        const plans = await window.DataStore.getPlans(); const plan = plans.find(p => p.id === planId); if (!plan) throw new Error('Plan not found.');
        const u = window.currentUser; if ((u.credits || 0) < plan.price) throw new Error('Insufficient credits.');
        const now = new Date(); const mult = plan.durationUnit === 'hours' ? 3600000 : 86400000; const expiry = new Date(now.getTime() + (plan.durationValue || 1) * mult);
        const batch = db.batch(); const userRef = db.collection('users').doc(u.id);
        batch.update(userRef, { credits: firebase.firestore.FieldValue.increment(-plan.price), subscriptions: firebase.firestore.FieldValue.arrayUnion({ planId, purchasedAt: firebase.firestore.Timestamp.fromDate(now), expiresAt: firebase.firestore.Timestamp.fromDate(expiry) }) });
        await batch.commit();
        window.currentUser = await window.DataStore.getUser(u.id); updateDashboard(); checkPlanStatus();
        const net = await window.DataStore.getNetworkSettings(); if (window.NetworkTools && net.ssid) window.NetworkTools.connectToWifi(net);
        showToast('Plan activated!', 'success');
    } catch (e) { showToast(e.message, 'error'); } finally { Loading.hide(); }
};
