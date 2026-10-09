/* ==========================================================
   12.modals.js — Modal open/close, voucher redeem,
                  admin stubs (voucher gen, plan CRUD, network)
   Depends on: 01.ui.utils.js, 06.firebase.js
   ========================================================== */

window.openModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
};
window.closeModal = function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
};

document.addEventListener('click', e => {
    if (e.target.classList.contains('modal')) e.target.classList.remove('active');
});

window.openRedeemVoucher = function () { window.openModal('redeemVoucherModal'); };

window._handleRedeemVoucher = async function (e) {
    e.preventDefault();
    const code = document.getElementById('voucherCodeInput').value.trim().toUpperCase();
    Loading.show('Verifying voucher...');
    try {
        const snap = await db.collection('vouchers')
            .where('code', '==', code)
            .where('used', '==', false)
            .get();

        if (snap.empty) throw new Error('Invalid or already used code.');

        const voucher = snap.docs[0];
        const val = voucher.data().value;
        const batch = db.batch();
        batch.update(voucher.ref, { used: true, usedBy: window.currentUser.id, usedAt: firebase.firestore.FieldValue.serverTimestamp() });
        batch.update(db.collection('users').doc(window.currentUser.id), {
            credits: firebase.firestore.FieldValue.increment(val)
        });

        await batch.commit();
        window.currentUser = await window.DataStore.getUser(window.currentUser.id);
        updateDashboard();
        showToast(`✅ $${val} added to your credits!`, 'success');
        window.closeModal('redeemVoucherModal');
        document.getElementById('voucherCodeInput').value = '';
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};

window.openGenerateVoucherModal = () => window.openModal('generateVoucherModal');

window._handleGenerateVoucher = async function (e) {
    e.preventDefault();
    const value = parseFloat(document.getElementById('voucherValue').value);
    const qty = parseInt(document.getElementById('voucherQuantity').value);
    Loading.show('Generating...');
    try {
        const batch = db.batch();
        const codes = [];
        for (let i = 0; i < qty; i++) {
            const code = 'BR3-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            codes.push(code);
            const ref = db.collection('vouchers').doc();
            batch.set(ref, { code, value, used: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        await batch.commit();
        showToast(`Generated ${qty} voucher(s). Codes: ${codes.join(', ')}`, 'success');

        if (window.HardwarePrinter && window.HardwarePrinter.currentInterface !== 'none') {
            // Escape generated/user-visible values before putting them into the printer's HTML input.
            const safeValue = typeof window.escapeHtml === 'function' ? window.escapeHtml(value.toFixed(2)) : String(value.toFixed(2));
            const printContent = codes.map(c => {
                const safeCode = typeof window.escapeHtml === 'function' ? window.escapeHtml(c) : String(c);
                return `
                <div style="border-bottom: 1px dashed #ccc; padding: 20px 0; text-align: center;">
                    <h2>br3eze.africa Voucher</h2>
                    <p style="font-size: 1.5em; font-weight: bold; margin: 10px 0;">${safeCode}</p>
                    <p>Value: $${safeValue}</p>
                    <p>Redeem at br3eze.africa</p>
                </div>`;
            }).join('');
            await window.HardwarePrinter.printReceipt(printContent, 'br3eze.africa Vouchers');
        }

        window.closeModal('generateVoucherModal');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};

window.openAdminPlanModal = (planId = null) => {
    document.getElementById('adminPlanId').value = planId || '';
    document.getElementById('deletePlanBtn').classList.toggle('hidden', !planId);
    window.openModal('adminPlanModal');
};

window._handleAdminPlan = async function (e) {
    e.preventDefault();
    Loading.show('Saving...');
    try {
        const planId = document.getElementById('adminPlanId').value;
        const data = {
            name: document.getElementById('adminPlanName').value,
            price: parseFloat(document.getElementById('adminPlanPrice').value),
            durationValue: parseInt(document.getElementById('adminPlanDuration').value),
            durationUnit: document.getElementById('adminPlanDurationUnit').value,
            maxDevices: parseInt(document.getElementById('adminPlanDevices').value) || 1,
            imageUrl: document.getElementById('adminPlanImageUrl').value || '',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (planId) {
            await db.collection('plans').doc(planId).update(data);
            showToast('Plan updated.', 'success');
        } else {
            data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            await db.collection('plans').add(data);
            showToast('Plan created.', 'success');
        }
        window.closeModal('adminPlanModal');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};

window.deletePlan = async function () {
    const planId = document.getElementById('adminPlanId').value;
    if (!planId || !confirm('Delete this plan?')) return;
    Loading.show('Deleting...');
    try {
        await db.collection('plans').doc(planId).delete();
        showToast('Plan deleted.', 'success');
        window.closeModal('adminPlanModal');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};

window.openEditNetworkModal = async function () {
    window.openModal('adminNetworkModal');
    try {
        const net = await window.DataStore.getNetworkSettings();
        document.getElementById('adminNetworkSsid').value = net.ssid || '';
        document.getElementById('adminNetworkPassword').value = net.password || '';
    } catch (e) {}
};

window._handleAdminNetwork = async function (e) {
    e.preventDefault();
    Loading.show('Saving...');
    try {
        await db.collection('settings').doc('network').set({
            ssid: document.getElementById('adminNetworkSsid').value,
            password: document.getElementById('adminNetworkPassword').value,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        showToast('Network settings saved.', 'success');
        window.closeModal('adminNetworkModal');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        Loading.hide();
    }
};

window.renderVoucherList = async function () {
    const container = document.getElementById('voucherListContainer');
    if (!container) return;
    try {
        const snap = await db.collection('vouchers').orderBy('createdAt', 'desc').limit(50).get();
        container.textContent = '';

        const heading = document.createElement('h3');
        heading.textContent = 'Vouchers';
        container.appendChild(heading);

        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;font-size:.85rem';
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        ['Code', 'Value', 'Status'].forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        snap.docs.forEach(d => {
            const v = d.data();
            const row = document.createElement('tr');
            [String(v.code || ''), `$${String(v.value ?? '')}`, v.used ? '✅ Used' : '⬜ Available'].forEach(text => {
                const td = document.createElement('td');
                td.textContent = text;
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    } catch (e) {
        container.textContent = 'Failed to load vouchers.';
    }
};
