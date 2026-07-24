/* ==========================================================
   16.api.client.js — thin fetch wrapper for the gateway's
                      /api/v1/* REST routes (Firebase-auth aware)
   Depends on: 06.firebase.js (bare `auth`), js/env.js (window.ENV)
   ========================================================== */

window.ApiClient = {
    async _authHeaders(extra = {}) {
        const headers = { ...extra };
        if (typeof auth !== 'undefined' && auth.currentUser) {
            const idToken = await auth.currentUser.getIdToken();
            headers['Authorization'] = `Bearer ${idToken}`;
        } else if (window.ENV?.GATEWAY_TOKEN) {
            headers['Authorization'] = `Bearer ${window.ENV.GATEWAY_TOKEN}`;
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

    // For binary responses (e.g. PDFs) — returns a Blob instead of parsing JSON.
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
