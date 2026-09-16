/* ==========================================================
   07.auth.js — Supabase Auth for Cordova/Web
   Uses Supabase Auth REST so the mobile bundle stays dependency-light.
   Firebase remains available to legacy DataStore modules during migration.
   ========================================================== */

const supabaseRuntime = window.ENV || {};
const SUPABASE_URL = String(supabaseRuntime.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = supabaseRuntime.SUPABASE_PUBLISHABLE_KEY || supabaseRuntime.SUPABASE_ANON_KEY || '';
const SUPABASE_SESSION_KEY = 'agentos_supabase_session';
const SUPABASE_PROFILE_KEY = 'agentos_supabase_profile';

function supabaseHeaders(accessToken = '') {
    const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return headers;
}

async function supabaseRequest(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase Auth is not configured.');
    const response = await fetch(`${SUPABASE_URL}${path}`, {
        ...options,
        headers: { ...supabaseHeaders(options.accessToken), ...(options.headers || {}) }
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
    window.Auth._emit(session);
}

async function refreshSession() {
    const session = getSession();
    if (!session?.refresh_token) return null;
    try {
        const next = await supabaseRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) });
        setSession(next);
        return next;
    } catch { setSession(null); return null; }
}

async function getProfile(user) {
    if (!user?.id) return null;
    try {
        const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,full_name,username,phone,role,tenant_id,site_id,domain`, { method: 'GET', accessToken: getSession()?.access_token });
        const profile = rows?.[0] || null;
        if (profile) localStorage.setItem(SUPABASE_PROFILE_KEY, JSON.stringify(profile));
        return profile;
    } catch { return null; }
}

window.SupabaseAuth = {
    getSession,
    async getUser() {
        const session = getSession();
        if (!session?.access_token) return null;
        try { return await supabaseRequest('/auth/v1/user', { method: 'GET', accessToken: session.access_token }); }
        catch { return (await refreshSession()) ? this.getUser() : null; }
    },
    getProfile,
    async apiFetch(url, options = {}) {
        const session = getSession();
        const headers = { ...(options.headers || {}) };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        return fetch(url, { ...options, headers });
    }
};

window.Auth = {
    _listeners: [],
    _emit(session) { this._listeners.forEach(fn => { try { fn(session); } catch (e) { console.error('[Supabase Auth]', e); } }); },
    onAuthStateChanged(fn) { this._listeners.push(fn); return () => { this._listeners = this._listeners.filter(x => x !== fn); }; },

    async login(identifier, password) {
        Loading.show('Logging in...');
        try {
            if (!String(identifier).includes('@')) throw new Error('Supabase login requires an email address.');
            const session = await supabaseRequest('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: identifier, password }) });
            setSession(session);
            showToast('Logged in!', 'success');
        } catch (e) { showToast(e.message, 'error'); }
        finally { Loading.hide(); }
    },

    async signup(email, password, fullname, username, confirm) {
        if (password !== confirm) return showToast('Passwords do not match.', 'error');
        Loading.show('Creating account...');
        try {
            const session = await supabaseRequest('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: { full_name: fullname, username } }) });
            if (session?.access_token) setSession(session);
            showToast(session?.access_token ? 'Account created!' : 'Account created. Check your email to confirm.', 'success');
        } catch (e) { showToast(e.message, 'error'); }
        finally { Loading.hide(); }
    },

    async logout() {
        const session = getSession();
        try { if (session?.access_token) await supabaseRequest('/auth/v1/logout', { method: 'POST', accessToken: session.access_token }); } catch {}
        setSession(null);
        localStorage.removeItem(SUPABASE_PROFILE_KEY);
        window.location.reload();
    },

    async requestPasswordReset(email) {
        if (!email) return showToast('Enter your email first.', 'error');
        Loading.show('Sending reset link...');
        try {
            await supabaseRequest('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email }) });
            showToast('If that email has an account, a reset link is on its way.', 'success');
            toggleForgotPassword();
        } catch (e) { showToast(e.message, 'error'); }
        finally { Loading.hide(); }
    },

    async loginWithGoogle() {
        if (!SUPABASE_URL || !SUPABASE_KEY) return showToast('Supabase Auth is not configured.', 'error');
        const redirect = encodeURIComponent(window.location.origin + '/auth/callback');
        window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirect}`;
    }
};

(async () => {
    const session = getSession();
    if (session?.access_token) {
        const user = await window.SupabaseAuth.getUser();
        if (!user) setSession(null);
    }
    window.authCheckComplete = true;
    window.Auth._emit(getSession());
})();
