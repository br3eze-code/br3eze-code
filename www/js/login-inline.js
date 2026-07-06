/**
 * login.html — page-specific glue.
 *
 * Wires the visible username/voucher form to MikroTik's hidden RouterOS
 * login form (the actual hotspot authentication), adds QR-code scanning
 * for voucher codes, and lets a Br3eze Africa account holder sign in/up
 * or continue with Google before their identifier is used to complete
 * the hotspot login.
 */
'use strict';

const firebaseConfig = {
    apiKey: 'AIzaSyANPQZKsAV9VsW9vKZJ3ghhrpnkxuLfdP8',
    authDomain: 'br3eze-africa-312df.firebaseapp.com',
    projectId: 'br3eze-africa-312df',
    storageBucket: 'br3eze-africa-312df.firebasestorage.app',
    messagingSenderId: '123902078923',
    appId: '1:123902078923:web:1153a45add9fe25208504e'
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function toggleAuthForm() {
    document.getElementById('loginForm').classList.toggle('hidden');
    document.getElementById('signupForm').classList.toggle('hidden');
}

// Matches the #toast/#toastIcon/#toastMessage markup this page actually has
// (ui.js's UI.toast() targets a different #toast-root structure this page
// doesn't include, so it can't be reused here).
let toastTimeout;
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !iconEl || !msgEl) {
        console.log(`[${type}] ${message}`);
        return;
    }
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const colors = { success: 'var(--color-success)', error: 'var(--color-danger)', info: 'var(--color-info)' };
    toast.style.backgroundColor = colors[type] || colors.info;
    toast.style.color = 'var(--color-text-light)';
    iconEl.textContent = icons[type] || icons.info;
    msgEl.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ── Hotspot login: submit the visible identifier/password into RouterOS's
//    hidden login form ──────────────────────────────────────────────────
function submitHotspotLogin(identifier, password) {
    document.getElementById('mk-username').value = identifier;
    document.getElementById('mk-password').value = password || '';
    document.getElementById('mikrotik-form').submit();
}

document.getElementById('loginFormElement').addEventListener('submit', (e) => {
    e.preventDefault();
    const identifier = document.getElementById('loginIdentifier').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!identifier) {
        showToast('Enter your username or voucher code.', 'error');
        return;
    }
    submitHotspotLogin(identifier, password);
});

// ── Optional Br3eze Africa account (email/password + Google) ────────────
document.getElementById('signupFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;
    const fullname = document.getElementById('signupFullname').value;

    if (password !== confirmPassword) {
        showToast('Passwords do not match.', 'error');
        return;
    }
    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await db.collection('users').doc(userCredential.user.uid).set({
            uid: userCredential.user.uid,
            email,
            fullname,
            role: 'user',
            credits: 10.00, // Welcome bonus
            subscriptions: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showToast('Account created! Please sign in.', 'success');
        toggleAuthForm();
        document.getElementById('loginIdentifier').value = email;
    } catch (err) {
        showToast(err.message, 'error');
    }
});

window.Auth = {
    async loginWithGoogle() {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const { user } = await auth.signInWithPopup(provider);
            const existing = await db.collection('users').doc(user.uid).get();
            if (!existing.exists) {
                await db.collection('users').doc(user.uid).set({
                    uid: user.uid,
                    email: user.email,
                    fullname: user.displayName || user.email,
                    role: 'user',
                    credits: 10.00,
                    subscriptions: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            // Use the account email as the hotspot identifier so the operator
            // can reconcile Firebase-authenticated users with the voucher DB.
            submitHotspotLogin(user.email, '');
        } catch (e) {
            if (e.code !== 'auth/popup-closed-by-user') showToast(e.message, 'error');
        }
    }
};

// ── QR code voucher scan ──────────────────────────────────────────────────
let qrScanner = null;

function stopQRScan() {
    const reader = document.getElementById('qr-reader');
    if (qrScanner) {
        qrScanner.stop().catch(() => {}).finally(() => { qrScanner.clear(); qrScanner = null; });
    }
    reader.style.display = 'none';
}

function scanQRCode() {
    const reader = document.getElementById('qr-reader');

    if (typeof Html5Qrcode === 'undefined') {
        showToast('QR scanner unavailable.', 'error');
        return;
    }

    reader.style.display = 'block';
    qrScanner = new Html5Qrcode('qr-reader');
    qrScanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => {
            document.getElementById('loginIdentifier').value = decodedText.trim();
            stopQRScan();
            showToast('Voucher code scanned.', 'success');
        },
        () => {} // ignore per-frame scan misses
    ).catch((err) => {
        showToast('Camera access denied or unavailable.', 'error');
        reader.style.display = 'none';
        console.error('[QR] start failed:', err);
    });
}
