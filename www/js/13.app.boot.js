/* ==========================================================
   13.app.boot.js — DOMContentLoaded: auth state, form wiring
   Depends on: ALL prior modules (01–12)
   ========================================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ── Auth state listener ─────────────────────────────────
    auth.onAuthStateChanged(async user => {
        if (user) {
            Loading.show('Loading profile...');
            try {
                window.currentUser = await window.DataStore.getUser(user.uid);
                if (window.currentUser) {
                    initApp();
                } else {
                    showToast('Profile not found. Logging out.', 'error');
                    Auth.logout();
                }
            } catch (e) {
                Loading.hide();
                showToast('Failed to load profile.', 'error');
                console.error('[Boot] onAuthStateChanged error:', e);
            }
        } else {
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('mainApp').style.display    = 'none';
            document.getElementById('mainHeader').style.display = 'none';
            Loading.hide();
        }
    });

    // ── Auth forms ──────────────────────────────────────────
    document.getElementById('loginFormElement')?.addEventListener('submit', e => {
        e.preventDefault();
        Auth.login(
            document.getElementById('loginIdentifier').value,
            document.getElementById('loginPassword').value
        );
    });

    document.getElementById('signupFormElement')?.addEventListener('submit', e => {
        e.preventDefault();
        Auth.signup(
            document.getElementById('signupEmail').value,
            document.getElementById('signupPassword').value,
            document.getElementById('signupFullname').value,
            document.getElementById('signupUsername').value,
            document.getElementById('signupConfirmPassword').value
        );
    });

    // ── P2P chat send ───────────────────────────────────────
    document.getElementById('unifiedChatForm')?.addEventListener('submit', e => {
        e.preventDefault();
        const input = document.getElementById('unifiedChatInput');
        const msg   = input.value.trim();
        if (!msg) return;
        const box = document.getElementById('chatLog');
        if (box) {
            box.innerHTML += `<div class="chat-message user"><div class="bubble">${msg}</div></div>`;
            box.scrollTop = box.scrollHeight;
        }
        input.value = '';
    });

    // ── AI chat send ────────────────────────────────────────
    document.getElementById('aiChatForm')?.addEventListener('submit', e => {
        e.preventDefault();
        window.sendChatMessage();
    });

    // ── Profile update ──────────────────────────────────────
    document.getElementById('updateProfileForm')?.addEventListener('submit', async e => {
        e.preventDefault();
        Loading.show('Saving profile...');
        try {
            await db.collection('users').doc(window.currentUser.id).update({
                fullname:    document.getElementById('settingsFullname').value,
                phoneNumber: document.getElementById('settingsPhoneNumber').value,
                address:     document.getElementById('settingsAddress').value,
                updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
            });
            window.currentUser = await window.DataStore.getUser(window.currentUser.id);
            updateNavbar();
            showToast('Profile updated!', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            Loading.hide();
        }
    });

    // ── Ticket forms ────────────────────────────────────────
    document.getElementById('newTicketForm')?.addEventListener('submit', window._handleNewTicket);
    document.getElementById('ticketReplyForm')?.addEventListener('submit', window._handleTicketReply);

    // ── Voucher form ────────────────────────────────────────
    document.getElementById('redeemVoucherForm')?.addEventListener('submit', window._handleRedeemVoucher);

    // ── Admin forms ─────────────────────────────────────────
    document.getElementById('generateVoucherForm')?.addEventListener('submit', window._handleGenerateVoucher);
    document.getElementById('adminPlanForm')?.addEventListener('submit', window._handleAdminPlan);
    document.getElementById('adminNetworkForm')?.addEventListener('submit', window._handleAdminNetwork);
    document.getElementById('deletePlanBtn')?.addEventListener('click', window.deletePlan);

    // ── Settings: populate fields on show ───────────────────
    document.querySelector('.sidebar li[data-section="settings"]')
        ?.addEventListener('click', () => {
            if (!window.currentUser) return;
            document.getElementById('settingsFullname').value    = window.currentUser.fullname    || '';
            document.getElementById('settingsUsername').value    = window.currentUser.username    || '';
            document.getElementById('settingsPhoneNumber').value = window.currentUser.phoneNumber || '';
            document.getElementById('settingsAddress').value     = window.currentUser.address     || '';
        });
});
