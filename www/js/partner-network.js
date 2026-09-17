/* ==========================================================
   partner-network.js — Partner-provided hotspot networks
   ========================================================== */
'use strict';

const COMMISSION_RATE = 0.30;
const PartnerNetwork = {
    async load() {
        if (!currentUser) return;
        try {
            const doc = await db.collection('partners').doc(currentUser.id).get();
            const data = doc.exists ? doc.data() : { ssid: '', password: '', active: false };
            const ssidEl = document.getElementById('partnerNetworkSsid'); const passEl = document.getElementById('partnerNetworkPassword'); const rateEl = document.getElementById('partnerCommissionRate'); const statusEl = document.getElementById('partnerNetworkStatus');
            if (ssidEl) ssidEl.value = data.ssid || ''; if (passEl) passEl.value = data.password || ''; if (rateEl) rateEl.textContent = `${Math.round((data.commissionRate ?? COMMISSION_RATE) * 100)}%`; if (statusEl) statusEl.textContent = data.active ? 'Active' : 'Not published yet';
        } catch (e) { console.error('[PartnerNetwork] load failed:', e); }
    },
    async save(e) {
        if (e) e.preventDefault(); if (!currentUser) return;
        const ssid = document.getElementById('partnerNetworkSsid').value.trim(); const password = document.getElementById('partnerNetworkPassword').value;
        if (!ssid) { showToast('Enter your network SSID.', 'error'); return; }
        try { await db.collection('partners').doc(currentUser.id).set({ ssid, password, ownerUid: currentUser.id, ownerName: currentUser.fullname || currentUser.email, commissionRate: COMMISSION_RATE, active: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); showToast('Network settings saved.', 'success'); this.load(); }
        catch (e2) { showToast(`Error saving network: ${e2.message}`, 'error'); }
    },
    async suggestNearby() {
        const snap = await db.collection('partners').where('active', '==', true).get();
        const partners = snap.docs.map(d => ({ id: d.id, ssid: d.data().ssid, commissionRate: d.data().commissionRate ?? COMMISSION_RATE })).filter(p => p.id !== currentUser?.id);
        if (typeof WifiWizard2 === 'undefined' || !WifiWizard2.scan) return partners.map(p => ({ ...p, inRange: 'unknown' }));
        try { const visible = await WifiWizard2.scan(); const visibleSsids = new Set((visible || []).map(n => n.SSID)); return partners.filter(p => visibleSsids.has(p.ssid)).map(p => ({ ...p, inRange: true })); }
        catch (e) { console.warn('[PartnerNetwork] scan failed, falling back to full list:', e); return partners.map(p => ({ ...p, inRange: 'unknown' })); }
    },
    async renderSuggestions() {
        const container = document.getElementById('partnerNetworksList'); if (!container) return;
        container.replaceChildren(); container.appendChild(Object.assign(document.createElement('p'), { textContent: 'Looking for nearby partner networks...', className: 'text-medium' }));
        try {
            const suggestions = await this.suggestNearby();
            if (!suggestions.length) { container.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'No partner networks available right now.', className: 'text-medium' })); return; }
            const fragment = document.createDocumentFragment();
            suggestions.forEach(p => {
                const card = document.createElement('div'); card.className = 'card'; card.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
                const info = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = p.ssid || ''; info.appendChild(strong);
                const meta = document.createElement('div'); meta.className = 'text-medium'; meta.style.cssText = 'font-size:.8rem;'; meta.textContent = `${p.inRange === true ? 'In range' : 'Suggested'} · Partner earns ${Math.round(p.commissionRate * 100)}% on your purchase`; info.appendChild(meta);
                const button = document.createElement('button'); button.className = 'btn btn-sm btn-primary'; button.textContent = 'Connect'; button.addEventListener('click', () => this.connect(p.id));
                card.append(info, button); fragment.appendChild(card);
            });
            container.replaceChildren(fragment);
        } catch (e) { container.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Failed to load partner networks.', className: 'text-medium' })); console.error('[PartnerNetwork] renderSuggestions failed:', e); }
    },
    async connect(partnerId) {
        try {
            const doc = await db.collection('partners').doc(partnerId).get(); if (!doc.exists || !doc.data().active) throw new Error('Network no longer available.'); const { ssid, password } = doc.data();
            await db.collection('users').doc(currentUser.id).update({ referredByPartner: partnerId }); currentUser.referredByPartner = partnerId;
            if (typeof WifiWizard2 !== 'undefined' && typeof cordova !== 'undefined' && cordova.platformId === 'android') { await WifiWizard2.addNetwork({ ssid, password, algorithm: 'WPA' }); await WifiWizard2.connectNetwork(ssid, true); showToast(`Connected to partner network "${ssid}".`, 'success'); }
            else showToast(`Connect manually: SSID "${ssid}", password "${password}".`, 'info');
        } catch (e) { showToast(`Could not connect: ${e.message}`, 'error'); }
    },
    async creditCommission(buyerId, saleAmount) {
        try { const buyerDoc = await db.collection('users').doc(buyerId).get(); const partnerId = buyerDoc.exists ? buyerDoc.data().referredByPartner : null; if (!partnerId) return; const partnerNetDoc = await db.collection('partners').doc(partnerId).get(); if (!partnerNetDoc.exists) return; const rate = partnerNetDoc.data().commissionRate ?? COMMISSION_RATE; const commission = Math.round(saleAmount * rate * 100) / 100; if (commission <= 0) return; const batch = db.batch(); batch.update(db.collection('users').doc(partnerId), { credits: firebase.firestore.FieldValue.increment(commission) }); batch.set(db.collection('commission_ledger').doc(), { partnerId, buyerId, saleAmount, commission, rate, createdAt: firebase.firestore.FieldValue.serverTimestamp() }); await batch.commit(); }
        catch (e) { console.error('[PartnerNetwork] creditCommission failed:', e); }
    }
};
window.PartnerNetwork = PartnerNetwork;
window.savePartnerNetwork = (e) => PartnerNetwork.save(e);
