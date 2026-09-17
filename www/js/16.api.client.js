/* ==========================================================
   16.api.client.js — canonical authenticated gateway client
   Supabase is the primary PWA identity; Firebase token remains
   compatibility fallback during migration.
   ========================================================== */

window.ApiClient = {
    async _authHeaders(extra = {}) {
        const headers = { 'X-AgentOS-Client': 'pwa', ...extra };
        if (window.SupabaseAuth?.getSession) {
            const session = window.SupabaseAuth.getSession();
            if (session?.access_token) {
                headers.Authorization = `Bearer ${session.access_token}`;
                return headers;
            }
        }
        if (typeof auth !== 'undefined' && auth.currentUser) {
            const idToken = await auth.currentUser.getIdToken();
            headers.Authorization = `Bearer ${idToken}`;
        } else if (window.ENV?.GATEWAY_TOKEN) {
            headers.Authorization = `Bearer ${window.ENV.GATEWAY_TOKEN}`;
        }
        return headers;
    },

    async fetch(path, opts = {}) {
        const headers = await this._authHeaders({ 'Content-Type': 'application/json', ...(opts.headers || {}) });
        const base = window.ENV?.GATEWAY_URL || '';
        const res = await fetch(`${base}${path}`, { ...opts, headers });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
        return body;
    },

    async fetchBlob(path, opts = {}) {
        const headers = await this._authHeaders(opts.headers || {});
        const base = window.ENV?.GATEWAY_URL || '';
        const res = await fetch(`${base}${path}`, { ...opts, headers });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(body?.error || `Request failed (${res.status})`);
        }
        return res.blob();
    }
};