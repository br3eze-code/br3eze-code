/* ==========================================================
   partner-network.js — Partner-provided hotspot networks
   Depends on: roles.js, firebase (auth/db/currentUser from app.js)

   Data model: `partners/{partnerUid}` = { ssid, password, ownerUid,
   ownerName, commissionRate, active, updatedAt }

   Flow:
     1. Admin promotes a user to role "partner" (Admin Users modal).
     2. The partner signs in, dashboard shows ONLY a "Network Settings"
        card (see showMainApp's role gating in app.js) where they set
        their own hotspot SSID/password via savePartnerNetwork().
     3. Regular users see a "Nearby Partner Networks" card built from
        PartnerNetwork.suggestNearby() ("suggest network" API) and can
        tap Connect -> PartnerNetwork.connect(partnerId).
     4. When that user's plan purchase / voucher redemption completes,
        the app calls PartnerNetwork.creditCommission(partnerId, amount)
        which pays the partner COMMISSION_RATE (30%) of the sale.
   ========================================================== */
'use strict';

const COMMISSION_RATE = 0.30;

const PartnerNetwork = {
    async load() {
        if (!currentUser) return;
        try {
            const doc = await db.collection('partners').doc(currentUser.id).get();
            const data = doc.exists ? doc.data() : { ssid: '', password: '', active: false };
            const ssidEl = document.getElementById('partnerNetworkSsid');
            const passEl = document.getElementById('partnerNetworkPassword');
            const rateEl = document.getElementById('partnerCommissionRate');
            const statusEl = document.getElementById('partnerNetworkStatus');
            if (ssidEl) ssidEl.value = data.ssid || '';
            if (passEl) passEl.value = data.password || '';
            if (rateEl) rateEl.textContent = `${Math.round((data.commissionRate ?? COMMISSION_RATE) * 100)}%`;
            if (statusEl) statusEl.textContent = data.active ? 'Active' : 'Not published yet';
        } catch (e) {
            console.error('[PartnerNetwork] load failed:', e);
        }
    },

    // Bound to #partnerNetworkForm's submit (see index.html). Kept as a
    // standalone function -- and NOT assigned before this point -- so
    // partner.js's onboarding wizard can monkey-patch it for the QA step
    // without us needing to know about that wizard here.
    async save(e) {
        if (e) e.preventDefault();
        if (!currentUser) return;
        const ssid = document.getElementById('partnerNetworkSsid').value.trim();
        const password = document.getElementById('partnerNetworkPassword').value;
        if (!ssid) { showToast('Enter your network SSID.', 'error'); return; }

        try {
            await db.collection('partners').doc(currentUser.id).set({
                ssid,
                password,
                ownerUid: currentUser.id,
                ownerName: currentUser.fullname || currentUser.email,
                commissionRate: COMMISSION_RATE,
                active: true,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            showToast('Network settings saved.', 'success');
            this.load();
        } catch (e2) {
            showToast(`Error saving network: ${e2.message}`, 'error');
        }
    },

    // "Suggest network" API: returns active partner networks a user could
    // connect through. On Cordova with WifiWizard2 available we scan for
    // visible SSIDs first and only suggest partners that are actually in
    // radio range; in a plain browser/PWA (no scan API) we fall back to
    // listing all active partners as a best-effort suggestion.
    async suggestNearby() {
        const snap = await db.collection('partners').where('active', '==', true).get();
        const partners = snap.docs
            .map(d => ({ id: d.id, ssid: d.data().ssid, commissionRate: d.data().commissionRate ?? COMMISSION_RATE }))
            .filter(p => p.id !== currentUser?.id);

        if (typeof WifiWizard2 === 'undefined' || !WifiWizard2.scan) {
            return partners.map(p => ({ ...p, inRange: 'unknown' }));
        }

        try {
            const visible = await WifiWizard2.scan();
            const visibleSsids = new Set((visible || []).map(n => n.SSID));
            return partners
                .filter(p => visibleSsids.has(p.ssid))
                .map(p => ({ ...p, inRange: true }));
        } catch (e) {
            console.warn('[PartnerNetwork] scan failed, falling back to full list:', e);
            return partners.map(p => ({ ...p, inRange: 'unknown' }));
        }
    },

    async renderSuggestions() {
        const container = document.getElementById('partnerNetworksList');
        if (!container) return;
        container.innerHTML = '<p class="text-medium">Looking for nearby partner networks...</p>';
        try {
            const suggestions = await this.suggestNearby();
            if (!suggestions.length) {
                container.innerHTML = '<p class="text-medium">No partner networks available right now.</p>';
                return;
            }
            container.innerHTML = suggestions.map(p => `
                <div class="card" style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <strong>${p.ssid}</strong>
                        <div class="text-medium" style="font-size:.8rem;">
                            ${p.inRange === true ? 'In range' : 'Suggested'} · Partner earns ${Math.round(p.commissionRate * 100)}% on your purchase
                        </div>
                    </div>
                    <button class="btn btn-sm btn-primary" onclick="PartnerNetwork.connect('${p.id}')">Connect</button>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<p class="text-medium">Failed to load partner networks.</p>';
            console.error('[PartnerNetwork] renderSuggestions failed:', e);
        }
    },

    // User taps "Connect" on a suggested partner network: fetch the real
    // credentials, remember which partner referred this user (so their
    // next purchase pays that partner's commission), and join the Wi-Fi.
    async connect(partnerId) {
        try {
            const doc = await db.collection('partners').doc(partnerId).get();
            if (!doc.exists || !doc.data().active) throw new Error('Network no longer available.');
            const { ssid, password } = doc.data();

            await db.collection('users').doc(currentUser.id).update({ referredByPartner: partnerId });
            currentUser.referredByPartner = partnerId;

            if (typeof WifiWizard2 !== 'undefined' && typeof cordova !== 'undefined' && cordova.platformId === 'android') {
                await WifiWizard2.addNetwork({ ssid, password, algorithm: 'WPA' });
                await WifiWizard2.connectNetwork(ssid, true);
                showToast(`Connected to partner network "${ssid}".`, 'success');
            } else {
                showToast(`Connect manually: SSID "${ssid}", password "${password}".`, 'info');
            }
        } catch (e) {
            showToast(`Could not connect: ${e.message}`, 'error');
        }
    },

    // Called after a plan purchase / voucher redemption completes. Pays
    // the referring partner their commission and logs it, no-op if the
    // buyer wasn't referred by a partner.
    async creditCommission(buyerId, saleAmount) {
        try {
            const buyerDoc = await db.collection('users').doc(buyerId).get();
            const partnerId = buyerDoc.exists ? buyerDoc.data().referredByPartner : null;
            if (!partnerId) return;

            const partnerNetDoc = await db.collection('partners').doc(partnerId).get();
            if (!partnerNetDoc.exists) return;
            const rate = partnerNetDoc.data().commissionRate ?? COMMISSION_RATE;
            const commission = Math.round(saleAmount * rate * 100) / 100;
            if (commission <= 0) return;

            const batch = db.batch();
            batch.update(db.collection('users').doc(partnerId), {
                credits: firebase.firestore.FieldValue.increment(commission)
            });
            batch.set(db.collection('commission_ledger').doc(), {
                partnerId,
                buyerId,
                saleAmount,
                commission,
                rate,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            await batch.commit();
        } catch (e) {
            console.error('[PartnerNetwork] creditCommission failed:', e);
        }
    }
};

window.PartnerNetwork = PartnerNetwork;
window.savePartnerNetwork = (e) => PartnerNetwork.save(e);
