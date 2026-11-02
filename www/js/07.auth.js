/* ==========================================================
   07.auth.js — Provider-neutral Supabase Auth boundary
   www is a client boundary: no provider secrets or domain rules.
   ========================================================== */

const supabaseRuntime = window.ENV || {};
const SUPABASE_URL = String(supabaseRuntime.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = supabaseRuntime.SUPABASE_PUBLISHABLE_KEY || supabaseRuntime.SUPABASE_ANON_KEY || '';
const SUPABASE_OAUTH_REDIRECT = String(supabaseRuntime.SUPABASE_OAUTH_REDIRECT || '').trim();
const SUPABASE_SESSION_KEY = 'agentos_supabase_session';
const SUPABASE_PROFILE_KEY = 'agentos_supabase_profile';
const PKCE_VERIFIER_KEY = 'agentos_oauth_pkce_verifier';
const OAUTH_STATE_KEY = 'agentos_oauth_state';
const OAUTH_RETURN_TO_KEY = 'agentos_oauth_return_to';
const SUPPORTED_OAUTH_PROVIDERS = new Set(['google', 'github', 'azure', 'apple', 'facebook']);

function showAuthLoading(message) { window.Loading?.show?.(message); }
function hideAuthLoading() { window.Loading?.hide?.(); }

function supabaseHeaders(accessToken = '') {
    const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
}

async function supabaseRequest(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase Auth is not configured.');
    const { accessToken, ...requestOptions } = options;
    const response = await fetch(`${SUPABASE_URL}${path}`, {
        ...requestOptions,
        headers: { ...supabaseHeaders(accessToken), ...(requestOptions.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.msg || body.message || body.error_description || body.error || 'Supabase request failed.');
    return body;
}

function getSession() {
    try { return JSON.parse(localStorage.getItem(SUPABASE_SESSION_KEY) || 'null'); } catch { return null; }
}

function setSession(session) {
    if (session) localStorage.setItem(SUPABASE_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SUPABASE_SESSION_KEY);
    window.Auth?._emit(session);
    if (session?.access_token && window.SupabaseAuth?.establishFirebaseSession) {
        window.SupabaseAuth.establishFirebaseSession(session).catch(error => {
            console.warn('[Auth] Legacy data session unavailable:', error?.message || 'unknown error');
            if (typeof window.showToast === 'function') window.showToast('Your account is signed in, but the legacy data session is unavailable. Please retry shortly.', 'error');
        });
    }
}

let refreshPromise = null;
async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    const session = getSession();
    if (!session?.refresh_token) return null;
    refreshPromise = (async () => {
        try {
            const next = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', {
                method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token })
            });
            setSession(next);
            return next;
        } catch {
            setSession(null);
            return null;
        } finally { refreshPromise = null; }
    })();
    return refreshPromise;
}

async function getProfile(user) {
    if (!user?.id || !getSession()?.access_token) return null;
    try {
        const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,username,phone,role,tenant_id,site_id,domain,address`, {
            method: 'GET', accessToken: getSession().access_token
        });
        const profile = rows?.[0] || null;
        if (profile) localStorage.setItem(SUPABASE_PROFILE_KEY, JSON.stringify(profile));
        return profile;
    } catch { return null; }
}

function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function base64Url(bytes) {
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createPkce() {
    const verifier = base64Url(randomBytes(32));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    localStorage.setItem(PKCE_VERIFIER_KEY, verifier);
    return base64Url(new Uint8Array(digest));
}

async function loginWithProvider(provider) {
    provider = String(provider || '').trim().toLowerCase();
    if (!SUPPORTED_OAUTH_PROVIDERS.has(provider)) throw new Error('Unsupported OAuth provider. Enable Google, GitHub, Azure, Apple, or Facebook in Supabase Auth first.');
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase Auth is not configured.');

    const redirect = SUPABASE_OAUTH_REDIRECT ||
        ((window.location.protocol === 'http:' || window.location.protocol === 'https:')
            ? `${window.location.origin}/auth/callback` : '');
    if (!redirect) throw new Error('OAuth login needs SUPABASE_OAUTH_REDIRECT for this native build.');

    const state = base64Url(randomBytes(24));
    const challenge = await createPkce();
    localStorage.setItem(OAUTH_RETURN_TO_KEY, window.location.pathname + window.location.search + window.location.hash);
    localStorage.setItem(OAUTH_STATE_KEY, state);
    const params = new URLSearchParams({
        provider,
        redirect_to: redirect,
        code_challenge: challenge,
        code_challenge_method: 's256',
        state
    });
    window.location.assign(`${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`);
}

  window.AgentOSProviders?.registerAuth({
    provider: 'supabase',
    getSession,
    getUser: async () => window.SupabaseAuth?.getUser?.()
  });

  window.SupabaseAuth = {
    getSession,
    getUser: async function () {
        let session = getSession();
        if (!session?.access_token) return null;
        try { return await supabaseRequest('/auth/v1/user', { method: 'GET', accessToken: session.access_token }); }
        catch {
            session = await refreshSession();
            if (!session?.access_token) return null;
            try { return await supabaseRequest('/auth/v1/user', { method: 'GET', accessToken: session.access_token }); }
            catch { setSession(null); return null; }
        }
    },
    getProfile,
    establishFirebaseSession: async function (session = getSession()) {
        if (!session?.access_token || typeof window.firebase?.auth !== 'function') return null;
        const apiBase = String(supabaseRuntime.AGENTOS_API_BASE_URL || supabaseRuntime.API_BASE_URL || supabaseRuntime.GATEWAY_URL || '').replace(/\/$/, '');
        const response = await fetch(`${apiBase}/api/auth/firebase-session`, {
            method: 'POST',
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
            body: '{}',
            cache: 'no-store'
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'Legacy data session could not be established.');
        const firebaseAuth = window.firebase.auth();
        let credential;
        if (firebaseAuth.currentUser?.uid === body.uid) {
            // The server refreshes the Firebase custom claims from the trusted
            // Supabase profile on every session establishment.
            await firebaseAuth.currentUser.getIdToken(true);
            credential = { user: firebaseAuth.currentUser };
        } else {
            credential = await firebaseAuth.signInWithCustomToken(body.token);
        }
        if (typeof window.firebase.firestore === 'function') {
            const firestore = window.firebase.firestore();
            const userRef = firestore.collection('users').doc(body.uid);
            const existing = await userRef.get();
            if (!existing.exists) {
                const supabaseUser = await this.getUser();
                const profile = supabaseUser ? await this.getProfile(supabaseUser) : null;
                await userRef.set({
                    uid: body.uid,
                    email: supabaseUser?.email || null,
                    fullname: profile?.full_name || supabaseUser?.user_metadata?.full_name || supabaseUser?.email || '',
                    username: profile?.username || '',
                    phoneNumber: profile?.phone || '',
                    role: body.role || 'user',
                    credits: 0,
                    subscriptions: [],
                    createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        }
        return credential.user;
    },
    loginWithProvider,
    apiFetch: async function (url, options = {}) {
        let session = getSession();
        let headers = { ...(options.headers || {}) };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const responseOptions = { ...options, headers };
        let response = await fetch(url, responseOptions);
        if (response.status === 401 && session?.refresh_token) {
            session = await refreshSession();
            if (session?.access_token) {
                headers = { ...(options.headers || {}), Authorization: `Bearer ${session.access_token}` };
                response = await fetch(url, { ...options, headers });
            }
        }
        return response;
    }
};

window.Auth = {
    _listeners: [],
    _emit(session) { this._listeners.slice().forEach(fn => { try { fn(session); } catch (e) { console.error('[Auth]', e); } }); },
    onAuthStateChanged(fn) {
        this._listeners.push(fn);
        return () => { this._listeners = this._listeners.filter(x => x !== fn); };
    },
    async login(identifier, password) {
        showAuthLoading('Logging in...');
        try {
            if (!String(identifier).includes('@')) throw new Error('Use the email address for this account.');
            const session = await supabaseRequest('/auth/v1/token?grant_type=password', {
                method: 'POST', body: JSON.stringify({ email: identifier.trim(), password })
            });
            setSession(session); showToast('Logged in!', 'success');
        } catch (e) { showToast(e.message, 'error'); }
        finally { hideAuthLoading(); }
    },
    async signup(email, password, fullname, username, confirm, phone = '') {
        if (password !== confirm) return showToast('Passwords do not match.', 'error');
        showAuthLoading('Creating account...');
        try {
            const session = await supabaseRequest('/auth/v1/signup', {
                method: 'POST', body: JSON.stringify({ email: email.trim(), password, data: { full_name: fullname?.trim() || '', username: username?.trim() || '', phone: String(phone || '').trim() } })
            });
            if (session?.access_token) setSession(session);
            showToast(session?.access_token ? 'Account created!' : 'Account created. Check your email to confirm.', 'success');
            return session;
        } catch (e) { showToast(e.message, 'error'); }
        finally { hideAuthLoading(); }
    },
    async requestEmailOtp(email) {
        email = String(email || '').trim().toLowerCase();
        if (!email) throw new Error('Enter your email address.');
        showAuthLoading('Sending verification code...');
        try {
            await supabaseRequest('/auth/v1/otp', {
                method: 'POST',
                body: JSON.stringify({ email, create_user: false })
            });
            showToast('Verification code sent. Check your email.', 'success');
            return { email };
        } finally {
            hideAuthLoading();
        }
    },
    async verifyEmailOtp(email, token) {
        email = String(email || '').trim().toLowerCase();
        token = String(token || '').trim();
        if (!email || !/^[0-9]{6}$/.test(token)) throw new Error('Enter the 6-digit verification code.');
        showAuthLoading('Verifying code...');
        try {
            const session = await supabaseRequest('/auth/v1/verify', {
                method: 'POST',
                body: JSON.stringify({ email, token, type: 'email' })
            });
            if (!session?.access_token) throw new Error('Verification succeeded but no session was returned.');
            setSession(session);
            showToast('Logged in!', 'success');
            return session;
        } catch (e) {
            showToast(e.message, 'error');
            throw e;
        } finally {
            hideAuthLoading();
        }
    },
    async loginWithOtp(email) {
        return this.requestEmailOtp(email);
    },
    async logout() {
        const session = getSession();
        try { if (session?.access_token) await supabaseRequest('/auth/v1/logout', { method: 'POST', accessToken: session.access_token }); } catch {}
        try { if (typeof window.firebase?.auth === 'function') await window.firebase.auth().signOut(); } catch {}
        setSession(null); localStorage.removeItem(SUPABASE_PROFILE_KEY); window.location.reload();
    },
    async updatePassword(currentPassword, newPassword) {
        const user = await window.SupabaseAuth.getUser();
        if (!user?.email) throw new Error('Sign in before changing your password.');
        let session = getSession();
        if (currentPassword) {
            session = await supabaseRequest('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: JSON.stringify({ email: user.email, password: currentPassword })
            });
            setSession(session);
        }
        if (!session?.access_token) throw new Error('Your session has expired. Sign in again.');
        return supabaseRequest('/auth/v1/user', {
            method: 'PUT',
            accessToken: session.access_token,
            body: JSON.stringify({ password: newPassword })
        });
    },
    async requestPasswordReset(email) {
        if (!email) return showToast('Enter your email first.', 'error');
        showAuthLoading('Sending reset link...');
        try {
            await supabaseRequest('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
            showToast('If that email has an account, a reset link is on its way.', 'success'); toggleForgotPassword();
        } catch (e) { showToast(e.message, 'error'); }
        finally { hideAuthLoading(); }
    },
    async loginWithGoogle() {
        try { await loginWithProvider('google'); } catch (e) { showToast(e.message, 'error'); }
    },
    async loginWithGitHub() {
        try { await loginWithProvider('github'); } catch (e) { showToast(e.message, 'error'); }
    },
    async loginWithMicrosoft() {
        try { await loginWithProvider('azure'); } catch (e) { showToast(e.message, 'error'); }
    },
    async loginWithApple() {
        try { await loginWithProvider('apple'); } catch (e) { showToast(e.message, 'error'); }
    },
    async loginWithFacebook() {
        try { await loginWithProvider('facebook'); } catch (e) { showToast(e.message, 'error'); }
    },
    loginWithProvider
};

(async () => {
    let session = getSession();
    let user = null;
    if (session?.access_token) {
        user = await window.SupabaseAuth.getUser();
        if (!user) {
            setSession(null);
            session = null;
        }
    }
    if (user && session) {
        await window.SupabaseAuth.establishFirebaseSession(session).catch(error => {
            console.warn('[Auth] Legacy data session unavailable:', error?.message || 'unknown error');
            if (typeof window.showToast === 'function') window.showToast('Your account is signed in, but the legacy data session is unavailable. Please retry shortly.', 'error');
        });
    }
    window.authCheckComplete = true;
    window.Auth._emit(getSession());
})();
