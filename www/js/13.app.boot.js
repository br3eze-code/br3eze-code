/* ==========================================================
   13.app.boot.js — DOMContentLoaded: Supabase auth state, form wiring
   Depends on: ALL prior modules (01–12)
   ========================================================== */

document.addEventListener('DOMContentLoaded', () => {

    Auth.onAuthStateChanged(async session => {
        if (session?.access_token) {
            Loading.show('Loading profile...');
            try {
                const user = await window.SupabaseAuth.getUser();
                const profile = await window.SupabaseAuth.getProfile(user);
                if (user && profile) {
                    window.currentUser = {
                        id: user.id,
                        uid: user.id,
                        email: user.email || profile.email || null,
                        fullname: profile.full_name || '',
                        username: profile.username || '',
                        phoneNumber: profile.phone || '',
                        role: profile.role || 'user',
                        tenantId: profile.tenant_id || null,
                        siteId: profile.site_id || null,
                        domain: profile.domain || null
                    };
                    initApp();
                } else {
                    showToast('Profile not found. Logging out.', 'error');
                    await Auth.logout();
                }
            } catch (e) {
                Loading.hide();
                showToast('Failed to load profile.', 'error');
                console.error('[Boot] Supabase auth error:', e);
            }
        } else {
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
            document.getElementById('mainHeader').style.display = 'none';
            Loading.hide();
        }
    });

    document.getElementById('loginFormElement')?.addEventListener('submit', e => {
        e.preventDefault();
        Auth.login(document.getElementById('loginIdentifier').value, document.getElementById('loginPassword').value);
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

    document.getElementById('forgotPasswordFormElement')?.addEventListener('submit', e => {
        e.preventDefault();
        Auth.requestPasswordReset(document.getElementById('forgotPasswordEmail').value);
    });

    document.getElementById('unifiedChatForm')?.addEventListener('submit', e => {
        e.preventDefault();
        const input = document.getElementById('unifiedChatInput');
        const msg = input.value.trim();
        if (!msg) return;
        const box = document.getElementById('chatLog');
        if (box) {
            box.innerHTML += `<div class="chat-message user"><div class="bubble">${escapeHtml(msg)}</div></div>`;
            box.scrollTop = box.scrollHeight;
        }
        input.value = '';
    });

    document.getElementById('aiChatForm')?.addEventListener('submit', e => {
        e.preventDefault();
        window.sendChatMessage();
    });

    document.getElementById('updateProfileForm')?.addEventListener('submit', async e => {
        e.preventDefault();
        Loading.show('Saving profile...');
        try {
            const session = window.SupabaseAuth.getSession();
            const response = await fetch(`${String((window.ENV || {}).SUPABASE_URL || '').replace(/\/$/, '')}/rest/v1/profiles?id=eq.${encodeURIComponent(window.currentUser.id)}`, {
                method: 'PATCH',
                headers: {
                    apikey: (window.ENV || {}).SUPABASE_PUBLISHABLE_KEY || (window.ENV || {}).SUPABASE_ANON_KEY || '',
                    Authorization: `Bearer ${session?.access_token || ''}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify({
                    full_name: document.getElementById('settingsFullname').value,
                    phone: document.getElementById('settingsPhoneNumber').value,
                    updated_at: new Date().toISOString()
                })
            });
            if (!response.ok) throw new Error('Profile update failed.');
            const user = await window.SupabaseAuth.getUser();
            const profile = await window.SupabaseAuth.getProfile(user);
            window.currentUser.fullname = profile?.full_name || '';
            window.currentUser.phoneNumber = profile?.phone || '';
            updateNavbar();
            showToast('Profile updated!', 'success');
        } catch (e) {
            showToast(e.message, 'error');
        } finally {
            Loading.hide();
        }
    });

    document.getElementById('newTicketForm')?.addEventListener('submit', window._handleNewTicket);
    document.getElementById('ticketReplyForm')?.addEventListener('submit', window._handleTicketReply);
    document.getElementById('redeemVoucherForm')?.addEventListener('submit', window._handleRedeemVoucher);
    document.getElementById('generateVoucherForm')?.addEventListener('submit', window._handleGenerateVoucher);
    document.getElementById('adminPlanForm')?.addEventListener('submit', window._handleAdminPlan);
    document.getElementById('adminNetworkForm')?.addEventListener('submit', window._handleAdminNetwork);
    document.getElementById('deletePlanBtn')?.addEventListener('click', window.deletePlan);

    document.querySelector('.sidebar li[data-section="settings"]')?.addEventListener('click', () => {
        if (!window.currentUser) return;
        document.getElementById('settingsFullname').value = window.currentUser.fullname || '';
        document.getElementById('settingsUsername').value = window.currentUser.username || '';
        document.getElementById('settingsPhoneNumber').value = window.currentUser.phoneNumber || '';
        document.getElementById('settingsAddress').value = window.currentUser.address || '';
    });
});
