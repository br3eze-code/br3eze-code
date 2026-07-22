/**
 * Auth Module
 * Handles Firebase Authentication, Signup, Login/Logout, and
 * MikroTik hotspot provisioning via BackendBridge.
 * Version: 2026.5.1
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTH_NETWORK_CODES = new Set([
    'auth/internal-error',
    'auth/network-request-failed',
    'auth/timeout'
]);

// ─── Auth object ──────────────────────────────────────────────────────────────

const Auth = {

    // §1  Email / Username / Voucher Login
    async login(loginIdentifier, password) {
        try {
            Loading.show('Logging in…');
            let email = loginIdentifier.trim();

            // ── Username → email resolution ────────────────────────────────
            if (!email.includes('@')) {
                const userByName = await DataStore.getUserByUsername(email).catch(() => null);
                if (userByName?.email) {
                    email = userByName.email;
                } else {
                    // ── Voucher-code path ──────────────────────────────────
                    return await Auth._loginWithVoucher(email);
                }
            }

            // ── Standard Firebase email/password ──────────────────────────
            const { user } = await firebase.auth().signInWithEmailAndPassword(email, password);

            // Ensure Firestore profile exists and sync to MikroTik
            await Auth._ensureProfile(user, password);

            // Notify backend for WiFi provisioning
            Auth._bridge('user_login', { uid: user.uid, email: user.email });

            showToast('Login successful!', 'success');
            return true;

        } catch (error) {
            console.error('[Auth] Login error:', error.code, error.message);
            Auth._handleError(error);
            return false;
        } finally {
            Loading.hide();
        }
    },

    // §2  Voucher-Only Login (Firebase optional)
    async _loginWithVoucher(code) {
        const voucher = await DataStore.getVoucher(code).catch(() => null);

        if (!voucher) {
            // username === password direct MikroTik pass-through
            showToast('Attempting direct connection…', 'info');
            return true;
        }

        try {
            // Anonymous Firebase session to track the guest
            const { user } = await firebase.auth().signInAnonymously();
            const existing = await DataStore.getUser(user.uid).catch(() => null);
            if (!existing) {
                await DataStore.users.doc(user.uid).set({
                    role:        'voucher_guest',
                    voucherCode: voucher.code,
                    credits:     voucher.value || 0,
                    createdAt:   firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            Auth._bridge('redeem_voucher', { code: voucher.code, uid: user.uid });

        } catch (fbError) {
            // Firebase unreachable (captive-portal / walled garden) — fall through to gateway
            const isNetErr = AUTH_NETWORK_CODES.has(fbError.code);
            console.warn('[Auth] Firebase offline during voucher redeem:', fbError.code);
            if (isNetErr) {
                await Auth._gatewayRedeemFallback(voucher.code);
            }
        }

        showToast('Logged in with voucher!', 'success');
        return true;
    },

    // §3  Sign Up
    async signup(email, password, fullname, username, confirmPassword) {
        if (password !== confirmPassword) {
            showToast('Passwords do not match.', 'error');
            return false;
        }

        // Basic username validation
        if (!/^[a-z0-9_]{3,32}$/i.test(username)) {
            showToast('Username must be 3–32 alphanumeric characters.', 'error');
            return false;
        }

        try {
            Loading.show('Creating account…');
            const { user } = await firebase.auth().createUserWithEmailAndPassword(email.trim(), password);

            await DataStore.users.doc(user.uid).set({
                email:     email.trim().toLowerCase(),
                fullname:  fullname.trim(),
                username:  username.trim().toLowerCase(),
                role:      'user',
                credits:   0,
                plan:      'trial',
                trialActive: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            Auth._bridge('user_signup', { uid: user.uid, email: user.email });

            // Sync trial user to gateway
            const baseUrl = window.ENV?.GATEWAY_URL || `http://${window.location.hostname || '127.0.0.1'}:${window.ENV?.GATEWAY_PORT || '3000'}`;
            const token = window.ENV?.GATEWAY_TOKEN || '';
            try {
                await fetch(`${baseUrl}/api/v1/users/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-gateway-token': token },
                    body: JSON.stringify({ 
                        user: email.trim().toLowerCase(), 
                        password: password,
                        planId: 'trial' 
                    }),
                    signal: AbortSignal.timeout(5000)
                });
            } catch (syncErr) {
                console.warn('[Auth] Trial user sync failed (non-fatal):', syncErr.message);
            }

            showToast('Account created successfully!', 'success');
            return true;

        } catch (error) {
            if (error.code === 'auth/email-already-in-use') {
                console.log('[Auth] Email already in use, attempting login...');
                Loading.hide(); // Hide before attempting login so we don't stack loaders
                showToast('Email exists. Attempting login...', 'info');
                return await Auth.login(email.trim(), password);
            }
            console.error('[Auth] Signup error:', error.code, error.message);
            Auth._handleError(error);
            return false;
        } finally {
            Loading.hide();
        }
    },

    // §4  Logout
    async logout() {
        try {
            Loading.show('Logging out…');

            // Clear OAuthVault tokens if available
            if (window.oauthVault) window.oauthVault.clearAll();

            await firebase.auth().signOut();
            showToast('Logged out successfully.', 'info');
            // Brief delay so the toast is visible before reload
            setTimeout(() => location.reload(), 800);

        } catch (error) {
            console.error('[Auth] Logout error:', error);
            showToast('Error logging out.', 'error');
        } finally {
            Loading.hide();
        }
    },

    // §5  Google Sign-In (redirect — safe for captive portals / WebViews)
    async loginWithGoogle() {
        const ua = navigator.userAgent || '';
        const isCaptive = ua.includes('CaptiveNetworkSupport');
        const isWebView = /Android.*wv\b/.test(ua) || /\bwv\b/.test(ua);

        if (isCaptive || isWebView) {
            showToast('Google Sign-in may be blocked here. Try Email/Voucher if it fails.', 'warning');
        }

        if (!navigator.onLine) {
            showToast('Internet required for Google Sign-in.', 'error');
            return;
        }

        try {
            Loading.show('Redirecting to Google…');
            const provider = new firebase.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            // signInWithRedirect is the most compatible path across mini-browsers
            await firebase.auth().signInWithRedirect(provider);
            // Page reloads — result handled in onAuthStateChanged / getRedirectResult

        } catch (error) {
            console.error('[Auth] Google auth error:', error.code, error.message);
            Loading.hide();
            if (error.code === 'auth/unauthorized-domain') {
                showToast('Unauthorized domain for Google Sign-in. Use Email/Password or Voucher.', 'error');
            } else {
                Auth._handleError(error);
            }
        }
    },

    // ─── Internal helpers ────────────────────────────────────────────────────

    /** Ensure a Firestore user profile exists for a Firebase Auth user, and sync to MikroTik. */
    async _ensureProfile(user, plainPassword = null) {
        let existing = await DataStore.getUser(user.uid).catch(() => null);
        let justCreated = false;

        if (!existing) {
            const base = user.email?.split('@')[0] || 'user';
            const username = base.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || 'user';
            existing = {
                email:     user.email || '',
                fullname:  user.displayName || 'User',
                username,
                role:      'user',
                credits:   0,
                plan:      'trial',
                trialActive: true,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await DataStore.users.doc(user.uid).set(existing);
            justCreated = true;
        }

        // Determine plan to sync: If they have a real active plan, sync that. Otherwise, trial.
        // User requested: if their account is !hasPlanActive -> trial
        const hasPlanActive = existing.planActive === true || (existing.plan && existing.plan !== 'trial');
        const planToSync = hasPlanActive ? existing.plan : 'trial';

        // Provision to MikroTik (Sync trial or active plan to gateway)
        const baseUrl = window.ENV?.GATEWAY_URL || `http://${window.location.hostname || '127.0.0.1'}:${window.ENV?.GATEWAY_PORT || '3000'}`;
        const token = window.ENV?.GATEWAY_TOKEN || '';
        try {
            await fetch(`${baseUrl}/api/v1/users/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-gateway-token': token },
                body: JSON.stringify({ 
                    user: (existing.email || user.email).trim().toLowerCase(), 
                    password: plainPassword || user.uid,
                    planId: planToSync 
                }),
                signal: AbortSignal.timeout(5000)
            });
        } catch (syncErr) {
            console.warn('[Auth] Gateway sync failed (non-fatal):', syncErr.message);
        }

        return existing;
    },

    /** Notify BackendBridge (Cordova plugin) for WiFi telemetry / router provisioning. */
    _bridge(intent, payload = {}) {
        try {
            if (window.BackendBridge?.sendIntent) {
                window.BackendBridge.sendIntent(intent, payload);
            }
        } catch (e) {
            console.warn('[Auth] BackendBridge error (non-fatal):', e.message);
        }
    },

    /**
     * Fallback: when Firebase is unreachable, redeem directly on the gateway.
     * This handles the walled-garden / captive-portal scenario.
     */
    async _gatewayRedeemFallback(code) {
        const baseUrl = window.ENV?.GATEWAY_URL || `http://${window.location.hostname || '127.0.0.1'}:${window.ENV?.GATEWAY_PORT || '3000'}`;
        try {
            await fetch(`${baseUrl}/api/v1/vouchers/redeem`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ code, user: code }),
                signal:  AbortSignal.timeout(6000)
            });
        } catch (gErr) {
            console.warn('[Auth] Gateway redeem fallback failed (non-fatal):', gErr.message);
        }
    },

    /** Map Firebase error codes to user-friendly messages. */
    _handleError(error) {
        if (AUTH_NETWORK_CODES.has(error.code)) {
            showToast('Network error or captive portal blocking Firebase. Try a voucher code.', 'error');
        } else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            showToast('Invalid credentials. Check your username and password.', 'error');
        } else if (error.code === 'auth/email-already-in-use') {
            showToast('Email is already registered. Please login instead.', 'error');
        } else if (error.code === 'auth/weak-password') {
            showToast('Password must be at least 6 characters.', 'error');
        } else if (error.code === 'auth/too-many-requests') {
            showToast('Too many failed attempts. Please wait before trying again.', 'error');
        } else {
            showToast(error.message || 'Authentication error.', 'error');
        }
    }
};

window.Auth = Auth;

// ─── UI Helper ────────────────────────────────────────────────────────────────

function toggleAuthForm() {
    const login  = document.getElementById('loginForm');
    const signup = document.getElementById('signupForm');
    if (login)  login.classList.toggle('hidden');
    if (signup) signup.classList.toggle('hidden');
}
window.toggleAuthForm = toggleAuthForm;

// ─── Form Event Listeners ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const loginFormEl  = document.getElementById('loginFormElement');
    const signupFormEl = document.getElementById('signupFormElement');
    const mkForm       = document.getElementById('mikrotik-form');

    // ── Login form ─────────────────────────────────────────────────────────────
    if (loginFormEl) {
        loginFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('loginIdentifier')?.value.trim() || '';
            const password   = document.getElementById('loginPassword')?.value.trim()   || '';

            // Voucher-only: single field filled (code used for both user + pass)
            const isSingleField = (identifier && !password) || (!identifier && password);
            if (isSingleField) {
                const code = identifier || password;
                if (mkForm) {
                    const linkLoginOnly = new URLSearchParams(location.search).get('link-login-only');
                    if (linkLoginOnly) mkForm.action = linkLoginOnly;
                    Auth._bridge('redeem_voucher', { code });
                    document.getElementById('mk-username').value = code;
                    document.getElementById('mk-password').value = code;
                    mkForm.submit();
                    return;
                }
                return Auth.login(code, code);
            }

            if (!identifier || !password) {
                return showToast('Please enter your username/email and password.', 'error');
            }

            const success = await Auth.login(identifier, password);
            if (success) {
                let actionUrl = new URLSearchParams(location.search).get('link-login-only');
                if (!actionUrl && mkForm && !mkForm.action.includes('$(link-login-only)')) {
                    actionUrl = mkForm.action;
                }
                
                if (mkForm && actionUrl) {
                    mkForm.action = actionUrl;
                    document.getElementById('mk-username').value = identifier;
                    document.getElementById('mk-password').value = password;
                    mkForm.submit();
                } else {
                    window.location.href = 'index.html';
                }
            }
        });
    }

    // ── Signup form ────────────────────────────────────────────────────────────
    if (signupFormEl) {
        signupFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email           = document.getElementById('signupEmail')?.value.trim()           || '';
            const password        = document.getElementById('signupPassword')?.value                || '';
            const fullname        = document.getElementById('signupFullname')?.value.trim()        || '';
            const username        = document.getElementById('signupUsername')?.value.trim()        || '';
            const confirmPassword = document.getElementById('signupConfirmPassword')?.value        || '';

            const ok = await Auth.signup(email, password, fullname, username, confirmPassword);
            if (ok) {
                let actionUrl = new URLSearchParams(location.search).get('link-login-only');
                if (!actionUrl && mkForm && !mkForm.action.includes('$(link-login-only)')) {
                    actionUrl = mkForm.action;
                }
                
                if (mkForm && actionUrl) {
                    mkForm.action = actionUrl;
                    document.getElementById('mk-username').value = email;
                    document.getElementById('mk-password').value = password;
                    mkForm.submit();
                } else {
                    window.location.href = 'index.html';
                }
            }
        });
    }
});

// ─── Firebase Auth State ──────────────────────────────────────────────────────

if (typeof firebase !== 'undefined') {

    // Handle Google redirect result — skip on file:// and environments that don't
    // support redirects (captive-portal WebViews, desktop browser test via file:)
    const _supportsRedirect = ['http:', 'https:', 'chrome-extension:'].includes(window.location.protocol);
    if (_supportsRedirect) {
        firebase.auth().getRedirectResult().then(async (result) => {
            if (!result?.user) return;
            const user = result.user;
            console.log('[Auth] Google redirect result:', user.email);

            await Auth._ensureProfile(user);

            // Store credential in OAuthVault
            if (window.oauthVault && result.credential) {
                window.oauthVault.storeToken('firebase-google', {
                    accessToken: result.credential.accessToken,
                    idToken:     result.credential.idToken || null,
                    expiresAt:   Date.now() + 3_600_000
                });
            }

            Auth._bridge('user_login', { uid: user.uid, email: user.email });
            showToast('Google login successful!', 'success');

            // MikroTik form auto-submit if on the captive-portal login page
            const mkForm = document.getElementById('mikrotik-form');
            if (mkForm) {
                document.getElementById('mk-username').value = user.email;
                document.getElementById('mk-password').value = user.uid;
                mkForm.submit();
            }

        }).catch((error) => {
            // Suppress known unsupported-environment error (file:// context)
            if (error.code === 'auth/operation-not-supported-in-this-environment') return;
            if (error.code && error.code !== 'auth/popup-closed-by-user') {
                console.error('[Auth] Redirect result error:', error.code, error.message);
                Auth._handleError(error);
            }
            Loading.hide();
        });
    }

    // Auth state observer — single source of truth for session
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            console.log('[Auth] Session established:', user.email || user.uid);
            const userData = await DataStore.getUser(user.uid).catch(() => null);
            window.currentUser = userData || {
                id:    user.uid,
                uid:   user.uid,
                email: user.email,
                role:  'user'
            };

            // Link Firebase UID to WebSocket channel for backend identity resolution
            if (typeof wsClient !== 'undefined') wsClient.setFirebaseUser(user);

            // Sync gossip / presence service
            if (window.GossipService) window.GossipService.initialize();

            // Hand off to app shell (index.html context)
            if (typeof showMainApp === 'function') {
                await showMainApp(window.currentUser);
            }
        } else {
            console.log('[Auth] No active session.');
            window.currentUser = null;

            if (typeof wsClient !== 'undefined') wsClient.setFirebaseUser(null);

            if (typeof showAuthScreen === 'function') {
                showAuthScreen();
            }
        }
    });
}
