/**
 * ==========================================================
 * 🌉 RouterBridge — Dual-Mode MikroTik Integration
 * ==========================================================
 * Ported from AgentOS (br3eze-code) patterns:
 *   - REST API client (RouterOS v7+)  → simple fetch()
 *   - TCP binary API (RouterOS v6)    → delegates to MikroTikHelper
 *   - Circuit breaker for resilience
 *   - Per-user traffic stats for VBB
 *
 * Usage:
 *   await RouterBridge.connect();
 *   const stats = await RouterBridge.getUserStats('john');
 *   // → { bytesIn: 123456, bytesOut: 654321, totalMB: 0.74 }
 */

const RouterBridge = (() => {
    // ── State ─────────────────────────────────────────────────────────────
    const state = {
        mode:        null,    // 'rest' | 'tcp' | null
        host:        null,    // e.g. '192.168.88.1'
        port:        8728,
        restBaseURL: null,    // e.g. 'https://192.168.88.1/rest'
        username:    'admin',
        password:    '',
        isConnected: false,
        lastError:   null,
        lastCheck:   0
    };

    // ── Simple in-memory cache (mirrors AgentOS NodeCache pattern) ─────
    const _cache = new Map();
    const CACHE_TTL = 30_000; // 30 seconds

    function cacheGet(key) {
        const entry = _cache.get(key);
        if (!entry) return null;
        if (Date.now() - entry.ts > CACHE_TTL) { _cache.delete(key); return null; }
        return entry.value;
    }

    function cacheSet(key, value) {
        _cache.set(key, { value, ts: Date.now() });
    }

    function cacheInvalidate(pattern) {
        for (const k of _cache.keys()) {
            if (k.includes(pattern)) _cache.delete(k);
        }
    }

    // ── Circuit Breaker (ported from AgentOS src/core/mikrotik.js) ──────
    const breaker = {
        failures:    0,
        threshold:   5,
        timeout:     60_000,
        state:       'CLOSED',   // CLOSED | OPEN | HALF_OPEN
        nextAttempt: 0,

        async execute(fn) {
            if (this.state === 'OPEN') {
                if (Date.now() < this.nextAttempt) {
                    throw new Error('[RouterBridge] Circuit breaker OPEN — refusing request');
                }
                this.state = 'HALF_OPEN';
                console.log('[RouterBridge] Circuit breaker HALF_OPEN — testing');
            }
            try {
                const result = await fn();
                this.failures = 0;
                this.state = 'CLOSED';
                return result;
            } catch (err) {
                this.failures++;
                if (this.failures >= this.threshold) {
                    this.state = 'OPEN';
                    this.nextAttempt = Date.now() + this.timeout;
                    console.warn(`[RouterBridge] Circuit breaker OPEN — retries in ${this.timeout / 1000}s`);
                }
                throw err;
            }
        },

        reset() {
            this.failures = 0;
            this.state = 'CLOSED';
            this.nextAttempt = 0;
        }
    };

    // ── REST API helpers (RouterOS v7+) ─────────────────────────────────
    function _restHeaders() {
        return {
            'Authorization': 'Basic ' + btoa(`${state.username}:${state.password}`),
            'Content-Type':  'application/json'
        };
    }

    async function _restGet(path) {
        const resp = await fetch(`${state.restBaseURL}${path}`, {
            method: 'GET',
            headers: _restHeaders()
        });
        if (!resp.ok) throw new Error(`REST ${resp.status}: ${resp.statusText}`);
        return resp.json();
    }

    async function _restPut(path, body) {
        const resp = await fetch(`${state.restBaseURL}${path}`, {
            method: 'PUT',
            headers: _restHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`REST PUT ${resp.status}: ${resp.statusText}`);
        return resp.json();
    }

    async function _restPatch(path, body) {
        const resp = await fetch(`${state.restBaseURL}${path}`, {
            method: 'PATCH',
            headers: _restHeaders(),
            body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error(`REST PATCH ${resp.status}: ${resp.statusText}`);
        return resp.json();
    }

    async function _restDelete(path) {
        const resp = await fetch(`${state.restBaseURL}${path}`, {
            method: 'DELETE',
            headers: _restHeaders()
        });
        if (!resp.ok) throw new Error(`REST DELETE ${resp.status}: ${resp.statusText}`);
        return true;
    }

    // ── Connection / Detection ──────────────────────────────────────────

    /**
     * Configure and connect to a MikroTik router.
     * Tries REST API first (v7+), falls back to TCP (v6).
     */
    async function connect(options = {}) {
        // Pull credentials from orchestrator state or options
        const orchState = window.OfflineOrchestrator?.getState?.() || {};
        state.host     = options.host     || orchState.gatewayIP    || '192.168.88.1';
        state.username = options.username || orchState.mikrotikUser || 'admin';
        state.password = options.password || orchState.mikrotikPass || '';
        state.port     = options.port     || 8728;

        // Build REST base URL (RouterOS v7 serves REST on port 443 or 80)
        const restPort = options.restPort || 443;
        const protocol = restPort === 443 ? 'https' : 'http';
        state.restBaseURL = `${protocol}://${state.host}/rest`;

        breaker.reset();

        // Try REST API first (v7+)
        try {
            const data = await _restGet('/system/resource');
            state.mode = 'rest';
            state.isConnected = true;
            state.lastError = null;
            state.lastCheck = Date.now();
            console.log(`[RouterBridge] ✅ Connected via REST API — RouterOS ${data[0]?.version || data?.version || 'v7+'}`);
            return { mode: 'rest', version: data[0]?.version || data?.version };
        } catch (restErr) {
            console.warn('[RouterBridge] REST API unavailable, trying TCP...', restErr.message);
        }

        // Fallback: TCP binary API (v6)
        try {
            if (window.MikroTikHelper) {
                // Test connection by sending a harmless command
                await MikroTikHelper.sendCommand('getUsageBytes', [state.host, '__ping__']);
            }
            state.mode = 'tcp';
            state.isConnected = true;
            state.lastError = null;
            state.lastCheck = Date.now();
            console.log('[RouterBridge] ✅ Connected via TCP API (v6 mode)');
            return { mode: 'tcp' };
        } catch (tcpErr) {
            state.mode = null;
            state.isConnected = false;
            state.lastError = tcpErr.message;
            console.error('[RouterBridge] ❌ Both REST and TCP failed:', tcpErr.message);
            throw new Error(`Cannot reach MikroTik at ${state.host}`);
        }
    }

    /**
     * Test a connection with specific credentials (used by Partners/Admins).
     */
    async function testConnection(host, username, password) {
        try {
            const result = await connect({ host, username, password });
            return { success: true, ...result };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // ── Hotspot User Management (ported from services/mikrotikAPI.js) ───

    /**
     * Create or update a hotspot user.
     * Maps Firebase user → MikroTik hotspot user.
     */
    async function createUser(username, password, profile = 'default', attributes = {}) {
        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                // Check if user exists
                const existing = await _restGet(`/ip/hotspot/user?name=${username}`);
                const payload = {
                    name: username,
                    password: password,
                    profile: profile,
                    comment: attributes.comment || `Firebase-${attributes.email || ''}`,
                    'shared-users': String(attributes.sharedUsers || 1)
                };

                if (existing && existing.length > 0) {
                    await _restPatch(`/ip/hotspot/user/${existing[0]['.id']}`, payload);
                    console.log(`[RouterBridge] User '${username}' updated`);
                    return { action: 'updated', username, profile };
                } else {
                    await _restPut('/ip/hotspot/user', payload);
                    console.log(`[RouterBridge] User '${username}' created`);
                    return { action: 'created', username, profile };
                }

            } else if (state.mode === 'tcp') {
                await MikroTikHelper.sendCommand('addUser', [state.host, username, password, profile]);
                return { action: 'created', username, profile };
            }

            throw new Error('[RouterBridge] Not connected');
        });
    }

    /**
     * Remove a hotspot user.
     */
    async function removeUser(username) {
        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                const users = await _restGet(`/ip/hotspot/user?name=${username}`);
                if (users.length === 0) throw new Error(`User '${username}' not found`);
                await _restDelete(`/ip/hotspot/user/${users[0]['.id']}`);
                return { action: 'removed', username };

            } else if (state.mode === 'tcp') {
                await MikroTikHelper.sendCommand('removeUser', [state.host, username]);
                return { action: 'removed', username };
            }

            throw new Error('[RouterBridge] Not connected');
        });
    }

    /**
     * Disconnect (kick) an active hotspot user.
     */
    async function disconnectUser(username) {
        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                const sessions = await _restGet('/ip/hotspot/active');
                const session = sessions.find(s => s.user === username);
                if (!session) return { kicked: false, username, reason: 'Not active' };

                await _restDelete(`/ip/hotspot/active/${session['.id']}`);
                console.log(`[RouterBridge] Kicked '${username}'`);
                return { kicked: true, username, address: session.address };

            } else if (state.mode === 'tcp') {
                // TCP mode doesn't have a direct kick — remove and re-add
                console.warn('[RouterBridge] TCP kick not natively supported');
                return { kicked: false, username, reason: 'TCP mode limitation' };
            }

            throw new Error('[RouterBridge] Not connected');
        });
    }

    // ── Traffic / Usage Stats ───────────────────────────────────────────

    /**
     * Get real per-user traffic stats from MikroTik.
     * Returns { bytesIn, bytesOut, totalMB, uptime, isActive }
     * This is what VBB should call instead of Math.random().
     */
    async function getUserStats(username) {
        const cacheKey = `user_stats_${username}`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        return breaker.execute(async () => {
            let result;

            if (state.mode === 'rest') {
                // Query active sessions for this user
                const active = await _restGet(`/ip/hotspot/active?user=${username}`);

                if (active && active.length > 0) {
                    const session = active[0];
                    const bytesIn  = parseInt(session['bytes-in']  || '0');
                    const bytesOut = parseInt(session['bytes-out'] || '0');
                    result = {
                        isActive: true,
                        bytesIn,
                        bytesOut,
                        totalMB:  (bytesIn + bytesOut) / (1024 * 1024),
                        uptime:   session.uptime || '0s',
                        address:  session.address,
                        macAddr:  session['mac-address']
                    };
                } else {
                    result = { isActive: false, bytesIn: 0, bytesOut: 0, totalMB: 0, username };
                }

            } else if (state.mode === 'tcp') {
                // Delegate to MikroTikHelper's getUsageBytes
                const usage = await MikroTikHelper.sendCommand('getUsageBytes', [state.host, username]);
                result = {
                    isActive: (usage && usage.totalMB > 0),
                    bytesIn:  usage?.bytesIn  || 0,
                    bytesOut: usage?.bytesOut || 0,
                    totalMB:  usage?.totalMB  || 0
                };

            } else {
                throw new Error('[RouterBridge] Not connected');
            }

            cacheSet(cacheKey, result);
            return result;
        });
    }

    /**
     * Get all active hotspot sessions.
     */
    async function getActiveSessions() {
        const cached = cacheGet('active_sessions');
        if (cached) return cached;

        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                const sessions = await _restGet('/ip/hotspot/active');
                cacheSet('active_sessions', sessions);
                return sessions;
            }
            // TCP mode: not easily supported for bulk queries
            return [];
        });
    }

    /**
     * Get system resource stats (CPU, memory, uptime).
     * Mirrors AgentOS getSystemStats().
     */
    async function getSystemStats(force = false) {
        if (!force) {
            const cached = cacheGet('system_stats');
            if (cached) return cached;
        }

        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                const raw = await _restGet('/system/resource');
                const data = Array.isArray(raw) ? raw[0] : raw;

                const totalMem = parseInt(data['total-memory'] || 0);
                const freeMem  = parseInt(data['free-memory']  || 0);

                const stats = {
                    cpuLoad:      parseInt(data['cpu-load'] || 0),
                    cpuCount:     parseInt(data['cpu-count'] || 1),
                    cpuFrequency: parseInt(data['cpu-frequency'] || 0),
                    totalMemoryMB: Math.round(totalMem / (1024 * 1024)),
                    freeMemoryMB:  Math.round(freeMem / (1024 * 1024)),
                    memoryUsage:   totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
                    uptime:        data.uptime || 'unknown',
                    version:       data.version || 'unknown',
                    boardName:     data['board-name'] || 'MikroTik',
                    architecture:  data['architecture-name'] || 'unknown'
                };

                cacheSet('system_stats', stats);
                return stats;
            }

            return null; // TCP mode doesn't support system stats easily
        });
    }

    // ── DHCP / Network Discovery ────────────────────────────────────────

    async function getDhcpLeases() {
        return breaker.execute(async () => {
            if (state.mode === 'rest') return _restGet('/ip/dhcp-server/lease');
            return [];
        });
    }

    async function getInterfaces() {
        return breaker.execute(async () => {
            if (state.mode === 'rest') return _restGet('/interface');
            return [];
        });
    }

    // ── Firewall ────────────────────────────────────────────────────────

    async function blockAddress(target, list = 'blocked', comment = 'Blocked via App') {
        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                await _restPut('/ip/firewall/address-list', {
                    list, address: target, comment, disabled: 'no'
                });
                return { action: 'blocked', target, list };
            }
            throw new Error('Firewall control requires REST mode');
        });
    }

    async function unblockAddress(target, list = 'blocked') {
        return breaker.execute(async () => {
            if (state.mode === 'rest') {
                const items = await _restGet(`/ip/firewall/address-list?list=${list}&address=${target}`);
                for (const item of items) {
                    await _restDelete(`/ip/firewall/address-list/${item['.id']}`);
                }
                return { action: 'unblocked', target, count: items.length };
            }
            throw new Error('Firewall control requires REST mode');
        });
    }

    // ── Seamless Auto-Login ─────────────────────────────────────────────
    /**
     * Invisible background HTTP POST to captive portal login page.
     * Works "with or without" MikroTik: fails silently if no router.
     */
    async function autoLogin(username, password) {
        if (!username) return;
        const ip = state.host || window.OfflineOrchestrator?.getState?.()?.gatewayIP || '192.168.88.1';
        try {
            console.log(`[RouterBridge] Attempting captive portal auto-login for ${username}...`);
            const formData = new URLSearchParams();
            formData.append('username', username);
            if (password) formData.append('password', password);
            formData.append('dst', ''); // prevents browser redirect

            await fetch(`http://${ip}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString()
            });
            console.log(`[RouterBridge] Auto-login request sent successfully.`);
        } catch (e) {
            // Fail silently. This means they are on a regular network, not a captive portal.
            console.log(`[RouterBridge] Auto-login skipped (not a captive portal or unreachable).`);
        }
    }

    // ── Health & Usage (AgentOS Patterns) ───────────────────────────────

    async function getUsageBytes(username) {
        return await breaker.execute(async () => {
            const cached = cacheGet(`usage_${username}`);
            if (cached) return cached;

            if (state.mode === 'rest') {
                const path = `/ip/hotspot/active?user=${username}`;
                const items = await _restGet(path);
                if (!items || items.length === 0) return { bytesIn: 0, bytesOut: 0, totalMB: 0 };
                
                const active = items[0];
                const stats = {
                    bytesIn:  parseInt(active['bytes-in']  || 0),
                    bytesOut: parseInt(active['bytes-out'] || 0),
                    totalMB: (parseInt(active['bytes-in'] || 0) + parseInt(active['bytes-out'] || 0)) / (1024 * 1024)
                };
                cacheSet(`usage_${username}`, stats);
                return stats;
            }
            return { bytesIn: 0, bytesOut: 0, totalMB: 0 };
        });
    }

    async function getHealthReport() {
        return await breaker.execute(async () => {
            const cached = cacheGet('system_health');
            if (cached) return cached;

            let health = { cpu: 0, memory: 0, users: 0, uptime: 'unknown' };

            if (state.mode === 'rest') {
                const [resources, users] = await Promise.all([
                    _restGet('/system/resource'),
                    _restGet('/ip/hotspot/active')
                ]);

                if (resources) {
                    health.cpu = parseInt(resources['cpu-load'] || 0);
                    health.memory = 100 - Math.round((parseInt(resources['free-memory'] || 0) / parseInt(resources['total-memory'] || 1)) * 100);
                    health.uptime = resources['uptime'];
                }
                if (users) health.users = users.length;
            }
            cacheSet('system_health', health);
            return health;
        });
    }

    // ── Public API ──────────────────────────────────────────────────────
    return {
        connect,
        // User management
        createUser,
        removeUser,
        disconnectUser,
        autoLogin,
        // Traffic stats (for VBB)
        getUserStats,
        getUsageBytes,
        getActiveSessions,
        // System
        testConnection,
        getSystemStats,
        getHealthReport,
        getDhcpLeases,
        getInterfaces,
        // Firewall
        blockAddress,
        unblockAddress,
        // Cache control
        invalidateCache: cacheInvalidate,
        // State inspection
        getState()   { return { ...state }; },
        getMode()    { return state.mode; },
        isConnected(){ return state.isConnected; },
        // UI legacy compat
        initLogin:  async function() {
            if (!state.host) {
                const orchState = window.OfflineOrchestrator?.getState?.() || {};
                state.host = orchState.gatewayIP;
            }
            if (!state.host) {
                const loginForm = document.getElementById('loginForm');
                const addRouterBtn = document.getElementById('addRouterBtn');
                if (loginForm) loginForm.style.display = 'none';
                if (addRouterBtn) addRouterBtn.style.display = 'block';
                return;
            }
            try {
                await connect();
                const loginForm = document.getElementById('loginForm');
                const statusContainer = document.getElementById('statusContainer');
                if (loginForm) loginForm.style.display = 'none';
                if (statusContainer) statusContainer.style.display = 'block';
            } catch (e) {
                console.warn('[RouterBridge] initLogin failed:', e.message);
            }
        },
        addRouter: async function() {
            if (window.showToast) showToast('🔍 Searching for router...', 'info');
            try {
                const result = await connect();
                if (window.showToast) showToast(`✅ Router connected (${result.mode} mode)`, 'success');
            } catch (e) {
                if (window.showToast) showToast('❌ No MikroTik detected', 'error');
            }
        }
    };
})();

window.RouterBridge = RouterBridge;
