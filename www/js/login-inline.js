/**
 * Captive-portal UI glue.
 * RouterOS hotspot credentials are network admission, not Br3eze account auth.
 * Br3eze account identity and OAuth are owned by Supabase Auth.
 */
'use strict';

const AUTH_HANDOFF_API = String(window.ENV?.AUTH_HANDOFF_API || '/api/auth/handoff').replace(/\/$/, '');
const authHandoffContext = (() => {
    const params = new URLSearchParams(window.location.search);
    const client = String(params.get('client') || params.get('from') || '').trim().toLowerCase();
    const action = String(params.get('action') || params.get('type') || '').trim();
    const nonce = String(params.get('nonce') || '').trim();
    if (!nonce || !new Set(['device', 'web', 'native', 'cli']).has(client) || action !== 'signIn') return null;
    history.replaceState(null, '', window.location.pathname + window.location.hash);
    return Object.freeze({ client, action, nonce });
})();

async function completeAuthHandoff() {
    if (!authHandoffContext) return null;
    const session = window.SupabaseAuth?.getSession?.();
    if (!session?.access_token) return null;
    try {
        const response = await fetch(AUTH_HANDOFF_API + '/' + encodeURIComponent(authHandoffContext.nonce) + '/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
            credentials: 'same-origin',
            cache: 'no-store'
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Authentication handoff failed.');
        return body;
    } catch (error) {
        showToast(error.message || 'Authentication handoff failed.', 'error');
        return null;
    }
}

function toggleAuthForm() {
    document.getElementById('loginForm')?.classList.toggle('hidden');
    document.getElementById('signupForm')?.classList.toggle('hidden');
}

let toastTimeout;
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !iconEl || !msgEl) {
        console.log(`[${type}] ${message}`);
        return;
    }
    const icons = { success: '✓', error: '×', info: 'i' };
    const colors = { success: 'var(--color-success)', error: 'var(--color-danger)', info: 'var(--color-info)' };
    toast.style.backgroundColor = colors[type] || colors.info;
    toast.style.color = 'var(--color-text-light)';
    iconEl.textContent = icons[type] || icons.info;
    msgEl.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 4000);
}
window.showToast = window.showToast || showToast;

function submitHotspotLogin(identifier, password) {
    document.getElementById('mk-username').value = identifier;
    document.getElementById('mk-password').value = password || '';
    document.getElementById('mikrotik-form').submit();
}

document.getElementById('loginFormElement')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!identifier) return showToast('Enter your username or voucher code.', 'error');
    const button = document.getElementById('login-submit-btn');
    button?.classList.add('is-loading');
    if (button) button.textContent = 'Connecting…';
    submitHotspotLogin(identifier, password);
});

function togglePasswordVisibility() {
    const input = document.getElementById('loginPassword');
    const button = document.getElementById('togglePasswordBtn');
    if (!input || !button) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
    button.title = show ? 'Hide password' : 'Show password';
    button.setAttribute('aria-label', button.title);
}
window.togglePasswordVisibility = togglePasswordVisibility;
window.toggleAuthForm = toggleAuthForm;

(function prefillFromQuery() {
    const params = new URLSearchParams(location.search);
    const username = params.get('username') || params.get('user');
    const password = params.get('password') || params.get('pass');
    if (!username && !password) return;
    if (username) document.getElementById('loginIdentifier').value = username;
    if (password) document.getElementById('loginPassword').value = password;
    if (username) {
        document.getElementById('login-submit-btn').textContent = `Connect as ${username}`;
        document.getElementById('loginForm').classList.add('is-prefilled');
    }
    ['username', 'user', 'password', 'pass'].forEach(key => params.delete(key));
    const query = params.toString();
    history.replaceState(null, '', location.pathname + (query ? `?${query}` : '') + location.hash);
})();

document.getElementById('signupFormElement')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    const fullname = document.getElementById('signupFullname').value.trim();
    const username = document.getElementById('signupUsername').value.trim();
    try {
        await window.Auth.signup(email, password, fullname, username, confirmPassword);
        document.getElementById('loginIdentifier').value = email;
        if (window.Auth.getSession?.()?.access_token) toggleAuthForm();
    } catch (error) {
        showToast(error.message || 'Account creation failed.', 'error');
    }
});

(async () => {
    try {
        const user = await window.SupabaseAuth?.getUser?.();
        if (user) {
            const handoff = await completeAuthHandoff();
            document.getElementById('loginIdentifier').value = user.email || '';
            if (!handoff) showToast('Br3eze account signed in. Enter your Wi-Fi voucher or hotspot credentials to connect.', 'success');
        }
    } catch (error) {
        console.warn('[login] Supabase session check failed:', error?.message || 'unknown error');
    }
})();

let qrScanner = null;
function stopQRScan() {
    const reader = document.getElementById('qr-reader');
    if (qrScanner) {
        qrScanner.stop().catch(() => {}).finally(() => { qrScanner.clear(); qrScanner = null; });
    }
    if (reader) reader.style.display = 'none';
}
function scanQRCode() {
    const reader = document.getElementById('qr-reader');
    if (typeof Html5Qrcode === 'undefined' || !reader) return showToast('QR scanner unavailable.', 'error');
    reader.style.display = 'block';
    qrScanner = new Html5Qrcode('qr-reader');
    qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        decodedText => {
            document.getElementById('loginIdentifier').value = decodedText.trim();
            stopQRScan();
            showToast('Voucher code scanned.', 'success');
        },
        () => {}
    ).catch(error => {
        showToast('Camera access denied or unavailable.', 'error');
        reader.style.display = 'none';
        console.error('[QR] start failed:', error);
    });
}
window.scanQRCode = scanQRCode;
window.stopQRScan = stopQRScan;
