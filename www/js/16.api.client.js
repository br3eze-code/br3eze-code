/* ==========================================================
   16.api.client.js — canonical authenticated API client
   Human API requests carry Supabase access tokens only.
   Firebase custom tokens are confined to the Firestore data SDK.
   ========================================================== */

window.ApiClient = {
    async _authHeaders(extra = {}) {
        const headers = { 'X-AgentOS-Client': 'pwa', ...extra };
        const session = window.SupabaseAuth?.getSession?.();
        if (session?.access_token) {
            headers.Authorization = `Bearer ${session.access_token}`;
        }
        return headers;
    },

    async fetch(path, opts = {}) {
        const headers = await this._authHeaders({ 'Content-Type': 'application/json', ...(opts.headers || {}) });
        const base = window.ENV?.AGENTOS_API_BASE_URL || window.ENV?.API_BASE_URL || '';
        const response = await fetch(`${base}${path}`, { ...opts, headers });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
        return body;
    },

    async fetchBlob(path, opts = {}) {
        const headers = await this._authHeaders(opts.headers || {});
        const base = window.ENV?.AGENTOS_API_BASE_URL || window.ENV?.API_BASE_URL || '';
        const response = await fetch(`${base}${path}`, { ...opts, headers });
        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || `Request failed (${response.status})`);
        }
        return response.blob();
    }
};
