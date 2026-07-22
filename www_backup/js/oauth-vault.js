/**
 * OAuth Vault — Secure Token Storage & Management
 * AgentOS Omni-Agent Component
 * Version: 2026.5.1
 *
 * Changes from 2026.5.0:
 *  - Firebase Google sign-in integration (popup + fallback redirect)
 *  - Captive-portal-safe: falls back to localStorage when secure storage is unavailable
 *  - Audit log capped at 200 entries to prevent unbounded memory growth
 *  - AbortSignal.timeout() guards on all fetch() calls
 *  - getStatus() exposes token health (expired / expiring / ok)
 *  - clearAll() for logout flows
 */

class OAuthVault {
    constructor() {
        this.version      = '2026.5.1';
        this.initialized  = false;
        this.services     = new Map();
        this.tokens       = new Map();
        this.refreshQueue = new Map();
        this.auditLog     = [];

        this._MAX_AUDIT   = 200;
        this._FETCH_TIMEOUT_MS = 8000;
    }

    // ─── §1  Lifecycle ────────────────────────────────────────────────────────

    async initialize() {
        if (this.initialized) return;
        console.log('[OAuthVault] Initializing secure vault…');
        await this.loadTokens();
        this.initialized = true;
        console.log('[OAuthVault] Vault initialized — version', this.version);
    }

    // ─── §2  Service Registration ─────────────────────────────────────────────

    registerService(serviceId, config = {}) {
        const service = {
            id:            serviceId,
            name:          config.name          || serviceId,
            authUrl:       config.authUrl        || '',
            tokenUrl:      config.tokenUrl       || '',
            scopes:        config.scopes         || [],
            clientId:      config.clientId       || '',
            redirectUri:   config.redirectUri    || '',
            refreshBefore: config.refreshBefore  || 300_000, // 5 min before expiry
            createdAt:     Date.now(),
            lastUsed:      null
        };
        this.services.set(serviceId, service);
        console.log(`[OAuthVault] Service registered: ${serviceId}`);
        return service;
    }

    // ─── §3  Token Storage ────────────────────────────────────────────────────

    storeToken(serviceId, tokenData) {
        const expiresIn = tokenData.expiresIn
            ? tokenData.expiresIn * 1000
            : 3_600_000; // default 1 h

        const token = {
            accessToken:  tokenData.accessToken  || null,
            refreshToken: tokenData.refreshToken || null,
            idToken:      tokenData.idToken       || null,
            tokenType:    tokenData.tokenType     || 'Bearer',
            expiresAt:    tokenData.expiresAt     || Date.now() + expiresIn,
            scope:        tokenData.scope         || '',
            createdAt:    Date.now(),
            usedAt:       null
        };

        this.tokens.set(serviceId, token);

        const svc = this.services.get(serviceId);
        if (svc) svc.lastUsed = Date.now();

        this._audit('token.store', serviceId);

        // Persist refresh token immediately so it survives page reload
        this.saveTokens().catch(e =>
            console.warn('[OAuthVault] Auto-save after store failed:', e.message)
        );

        console.log(`[OAuthVault] Token stored for ${serviceId}`);
        return token;
    }

    // ─── §4  Token Retrieval with Auto-Refresh ────────────────────────────────

    async getToken(serviceId, forceRefresh = false) {
        const token   = this.tokens.get(serviceId);
        const service = this.services.get(serviceId);

        if (!token) throw new Error(`No token found for service: ${serviceId}`);

        const timeLeft = token.expiresAt - Date.now();
        const needsRefresh = forceRefresh
            || timeLeft <= 0
            || (service && timeLeft < service.refreshBefore);

        if (needsRefresh && token.refreshToken) {
            console.log(`[OAuthVault] Auto-refreshing token for ${serviceId}…`);
            return this.refreshToken(serviceId);
        }

        token.usedAt = Date.now();
        return token;
    }

    // ─── §5  Token Refresh ────────────────────────────────────────────────────

    async refreshToken(serviceId) {
        // Deduplicate concurrent refresh attempts
        if (this.refreshQueue.has(serviceId)) {
            console.log(`[OAuthVault] Refresh already in-flight for ${serviceId}`);
            return this.refreshQueue.get(serviceId);
        }

        const token   = this.tokens.get(serviceId);
        const service = this.services.get(serviceId);

        if (!token || !token.refreshToken || !service) {
            throw new Error(`Cannot refresh: missing token or service for ${serviceId}`);
        }

        const promise = this._doRefresh(serviceId, token.refreshToken, service)
            .finally(() => this.refreshQueue.delete(serviceId));

        this.refreshQueue.set(serviceId, promise);
        return promise;
    }

    async _doRefresh(serviceId, refreshToken, service) {
        const params = new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: refreshToken,
            client_id:     service.clientId
        });

        let response;
        try {
            response = await fetch(service.tokenUrl, {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept':        'application/json'
                },
                body:   params.toString(),
                signal: AbortSignal.timeout(this._FETCH_TIMEOUT_MS)
            });
        } catch (netErr) {
            throw new Error(`Network error during token refresh: ${netErr.message}`);
        }

        if (!response.ok) {
            let errBody = {};
            try { errBody = await response.json(); } catch (_) { /**/ }
            throw new Error(`Token refresh failed (${response.status}): ${errBody.error_description || errBody.error || response.statusText}`);
        }

        const td       = await response.json();
        const oldToken = this.tokens.get(serviceId) || {};
        const newToken = {
            accessToken:  td.access_token,
            refreshToken: td.refresh_token || refreshToken, // preserve if not rotated
            idToken:      td.id_token      || oldToken.idToken || null,
            tokenType:    td.token_type    || 'Bearer',
            expiresAt:    Date.now() + ((td.expires_in || 3600) * 1000),
            scope:        td.scope         || oldToken.scope || '',
            createdAt:    Date.now(),
            usedAt:       null
        };

        this.tokens.set(serviceId, newToken);
        this._audit('token.refresh', serviceId);
        console.log(`[OAuthVault] Token refreshed for ${serviceId}`);
        return newToken;
    }

    // ─── §6  Firebase Google Sign-In ──────────────────────────────────────────

    /**
     * Sign in with Google via Firebase popup (with redirect fallback for
     * captive-portal / restricted environments).
     */
    async loginWithGoogle(serviceId = 'firebase-google') {
        if (!window.firebase?.auth) {
            throw new Error('[OAuthVault] Firebase auth not available');
        }

        const auth     = firebase.auth();
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');

        let userCredential;
        try {
            userCredential = await auth.signInWithPopup(provider);
        } catch (popupErr) {
            // Popup blocked (common in captive portals) — fall back to redirect
            if (popupErr.code === 'auth/popup-blocked' ||
                popupErr.code === 'auth/popup-closed-by-user') {
                console.warn('[OAuthVault] Popup blocked — switching to redirect flow');
                await auth.signInWithRedirect(provider);
                return null; // result handled by checkRedirectResult()
            }
            throw popupErr;
        }

        const cred = userCredential.credential;
        if (cred) {
            this.storeToken(serviceId, {
                accessToken:  cred.accessToken,
                idToken:      cred.idToken       || null,
                tokenType:    'Bearer',
                expiresAt:    Date.now() + 3_600_000
            });
        }

        this._audit('oauth.google.login', serviceId);
        return userCredential.user;
    }

    /**
     * Handle the redirect result after signInWithRedirect().
     * Call once on page load (e.g. from auth.js or app.js).
     */
    async checkRedirectResult(serviceId = 'firebase-google') {
        if (!window.firebase?.auth) return null;
        try {
            const result = await firebase.auth().getRedirectResult();
            if (result?.user && result?.credential) {
                this.storeToken(serviceId, {
                    accessToken: result.credential.accessToken,
                    idToken:     result.credential.idToken || null,
                    tokenType:   'Bearer',
                    expiresAt:   Date.now() + 3_600_000
                });
                this._audit('oauth.google.redirect', serviceId);
                return result.user;
            }
        } catch (e) {
            console.error('[OAuthVault] checkRedirectResult error:', e.message);
        }
        return null;
    }

    // ─── §7  Standard OAuth 2.0 Authorization-Code Flow ──────────────────────

    async initiateOAuthFlow(serviceId) {
        const service = this.services.get(serviceId);
        if (!service) throw new Error(`Service not registered: ${serviceId}`);

        const stateStr = this.generateState(serviceId);
        const params   = new URLSearchParams({
            client_id:     service.clientId,
            redirect_uri:  service.redirectUri,
            scope:         service.scopes.join(' '),
            response_type: 'code',
            state:         stateStr
        });

        const authUrl = `${service.authUrl}?${params}`;
        this._audit('oauth.initiate', serviceId, { url: service.authUrl });
        return { authUrl, state: stateStr };
    }

    async handleOAuthCallback(serviceId, code, state) {
        const service = this.services.get(serviceId);
        if (!service) throw new Error(`Service not registered: ${serviceId}`);

        if (!this.validateState(state, serviceId)) {
            throw new Error('Invalid OAuth state — possible CSRF attack');
        }

        const params = new URLSearchParams({
            grant_type:   'authorization_code',
            code,
            redirect_uri: service.redirectUri,
            client_id:    service.clientId
        });

        let response;
        try {
            response = await fetch(service.tokenUrl, {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept':        'application/json'
                },
                body:   params.toString(),
                signal: AbortSignal.timeout(this._FETCH_TIMEOUT_MS)
            });
        } catch (netErr) {
            throw new Error(`Network error during token exchange: ${netErr.message}`);
        }

        if (!response.ok) {
            let errBody = {};
            try { errBody = await response.json(); } catch (_) { /**/ }
            throw new Error(`Token exchange failed (${response.status}): ${errBody.error_description || errBody.error}`);
        }

        const td = await response.json();
        return this.storeToken(serviceId, {
            accessToken:  td.access_token,
            refreshToken: td.refresh_token,
            tokenType:    td.token_type || 'Bearer',
            expiresIn:    td.expires_in,
            scope:        td.scope
        });
    }

    // ─── §8  CSRF State Management ────────────────────────────────────────────

    generateState(serviceId) {
        const state = {
            service:   serviceId,
            nonce:     this._nonce(),
            timestamp: Date.now()
        };
        const encoded = btoa(JSON.stringify(state));
        // Use sessionStorage when available (cleaner); fall back to localStorage
        try {
            sessionStorage.setItem(`oauth_state_${encoded}`, '1');
        } catch (_) {
            localStorage.setItem(`oauth_state_${encoded}`, '1');
        }
        return encoded;
    }

    validateState(encoded, serviceId) {
        try {
            const state = JSON.parse(atob(encoded));
            if (state.service !== serviceId)         return false;
            if (Date.now() - state.timestamp > 600_000) return false; // 10 min
            try { sessionStorage.removeItem(`oauth_state_${encoded}`); } catch (_) {/**/ }
            localStorage.removeItem(`oauth_state_${encoded}`);
            return true;
        } catch {
            return false;
        }
    }

    _nonce() {
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    }

    // ─── §9  Service-Specific: GitHub API ────────────────────────────────────

    async githubRequest(serviceId, endpoint, options = {}) {
        const token = await this.getToken(serviceId);

        const doRequest = async (tok) =>
            fetch(`https://api.github.com${endpoint}`, {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `${tok.tokenType} ${tok.accessToken}`,
                    'Accept':        'application/vnd.github.v3+json'
                },
                signal: AbortSignal.timeout(this._FETCH_TIMEOUT_MS)
            });

        let res = await doRequest(token);

        if (res.status === 401) {
            // Expired — force refresh and retry once
            const refreshed = await this.getToken(serviceId, true);
            res = await doRequest(refreshed);
        }

        return res;
    }

    // ─── §10  Token Revocation ────────────────────────────────────────────────

    async revokeToken(serviceId) {
        const token   = this.tokens.get(serviceId);
        const service = this.services.get(serviceId);

        if (token?.accessToken && service?.tokenUrl) {
            try {
                await fetch(`${service.tokenUrl}/revoke`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body:    new URLSearchParams({ token: token.accessToken }).toString(),
                    signal:  AbortSignal.timeout(this._FETCH_TIMEOUT_MS)
                });
            } catch (err) {
                console.warn(`[OAuthVault] Revocation warning for ${serviceId}:`, err.message);
            }
        }

        this.tokens.delete(serviceId);
        this._audit('token.revoke', serviceId);
        console.log(`[OAuthVault] Token revoked for ${serviceId}`);
    }

    /**
     * Clear ALL tokens and audit log (call on user logout).
     */
    clearAll() {
        this.tokens.clear();
        this.refreshQueue.clear();
        this.auditLog = [];
        try { localStorage.removeItem('oauth_vault'); } catch (_) { /**/ }
        console.log('[OAuthVault] Vault cleared');
    }

    // ─── §11  Persistence ─────────────────────────────────────────────────────

    async saveTokens() {
        // Only persist refresh tokens + expiry — never access tokens
        const safeTokens = Array.from(this.tokens.entries()).map(([key, tok]) => [
            key,
            { refreshToken: tok.refreshToken, expiresAt: tok.expiresAt, scope: tok.scope }
        ]);

        const payload = JSON.stringify({
            services: Array.from(this.services.entries()),
            tokens:   safeTokens,
            savedAt:  Date.now()
        });

        try {
            if (window.storage?.setSecure) {
                await window.storage.setSecure('oauth_vault', payload);
            } else {
                localStorage.setItem('oauth_vault', payload);
            }
            console.log('[OAuthVault] Tokens saved');
        } catch (e) {
            console.warn('[OAuthVault] saveTokens error:', e.message);
        }
    }

    async loadTokens() {
        try {
            let raw = null;
            if (window.storage?.getSecure) {
                raw = await window.storage.getSecure('oauth_vault');
            } else {
                raw = localStorage.getItem('oauth_vault');
            }
            if (!raw) return;

            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.services)) {
                this.services = new Map(parsed.services);
            }
            if (Array.isArray(parsed.tokens)) {
                for (const [id, tok] of parsed.tokens) {
                    this.tokens.set(id, {
                        accessToken:  null, // never persisted
                        refreshToken: tok.refreshToken || null,
                        idToken:      null,
                        tokenType:    'Bearer',
                        expiresAt:    tok.expiresAt   || 0,
                        scope:        tok.scope        || '',
                        createdAt:    Date.now(),
                        usedAt:       null
                    });
                }
            }
            console.log('[OAuthVault] Tokens loaded from storage');
        } catch (e) {
            console.error('[OAuthVault] Failed to load tokens:', e.message);
        }
    }

    // ─── §12  Status & Audit ──────────────────────────────────────────────────

    getStatus() {
        const now      = Date.now();
        const services = [];

        this.services.forEach((svc, id) => {
            const tok = this.tokens.get(id);
            let health = 'disconnected';
            if (tok) {
                const left = tok.expiresAt - now;
                if (left <= 0)                 health = 'expired';
                else if (left < svc.refreshBefore) health = 'expiring';
                else                           health = 'ok';
            }
            services.push({
                id,
                name:      svc.name,
                connected: !!tok,
                health,
                expiresAt: tok?.expiresAt || null,
                lastUsed:  svc.lastUsed
            });
        });

        return {
            version:      this.version,
            serviceCount: services.length,
            services,
            connected:    services.filter(s => s.connected).map(s => s.id),
            auditEntries: this.auditLog.length
        };
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    _audit(action, serviceId, extra = {}) {
        this.auditLog.push({ action, service: serviceId, timestamp: Date.now(), ...extra });
        // Cap log size
        if (this.auditLog.length > this._MAX_AUDIT) {
            this.auditLog.splice(0, this.auditLog.length - this._MAX_AUDIT);
        }
    }

    /**
     * Return a copy of the audit log (safe to expose to CI dashboard).
     * @param {number} limit  Max entries to return (default: all)
     */
    getAuditLog(limit = this._MAX_AUDIT) {
        return this.auditLog.slice(-limit).map(e => ({ ...e }));
    }
}

// ─── Global Instance ──────────────────────────────────────────────────────────
const oauthVault = new OAuthVault();

if (typeof window !== 'undefined') {
    window.OAuthVault  = OAuthVault;
    window.oauthVault  = oauthVault;

    // Auto-initialize once DOM / Firebase is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => oauthVault.initialize().catch(console.error));
    } else {
        oauthVault.initialize().catch(console.error);
    }
}
