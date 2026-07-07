/**
 * ==========================================================
 * 🏁 Offline-First Orchestrator + MikroTik Integration
 * ==========================================================
 * Merged: OfflineOrchestrator, OfflineOnboarding, VoucherEngine
 */

/* ==================== MIKROTIK TCP HELPER ==================== */
const MikroTikHelper = (() => {
    const DEFAULT_PORT = 8728;

    // ── Low-level TCP helpers ──────────────────────────────────────
    function tcpCreate() {
        return new Promise((resolve, reject) => {
            if (!window.chrome?.sockets?.tcp) return reject('TCP plugin not available');
            chrome.sockets.tcp.create({}, info => resolve(info.socketId));
        });
    }

    function tcpConnect(socketId, ip, port) {
        return new Promise((resolve, reject) => {
            chrome.sockets.tcp.connect(socketId, ip, port, result =>
                result < 0 ? reject(`TCP connect failed (${result})`) : resolve()
            );
        });
    }

    function tcpSend(socketId, buffer) {
        return new Promise((resolve, reject) => {
            chrome.sockets.tcp.send(socketId, buffer, info =>
                info.resultCode < 0 ? reject('Send failed') : resolve()
            );
        });
    }

    /** Read one complete RouterOS API response (accumulates until !done or !trap) */
    function tcpRead(socketId, timeoutMs = 5000) {
        return new Promise((resolve) => {
            let chunks = [];
            const timer = setTimeout(() => {
                chrome.sockets.tcp.onReceive.removeListener(handler);
                resolve(chunks.join(''));
            }, timeoutMs);

            function handler(info) {
                if (info.socketId !== socketId) return;
                const text = new TextDecoder().decode(info.data);
                chunks.push(text);
                if (text.includes('!done') || text.includes('!trap') || text.includes('!fatal')) {
                    clearTimeout(timer);
                    chrome.sockets.tcp.onReceive.removeListener(handler);
                    resolve(chunks.join(''));
                }
            }
            chrome.sockets.tcp.onReceive.addListener(handler);
        });
    }

    // ── RouterOS API binary sentence encoder ──────────────────────
    function encodeWord(word) {
        const encoded = new TextEncoder().encode(word);
        const len = encoded.length;
        let prefix;
        if (len < 0x80)        prefix = new Uint8Array([len]);
        else if (len < 0x4000) prefix = new Uint8Array([(len >> 8) | 0x80, len & 0xFF]);
        else                   prefix = new Uint8Array([(len >> 16) | 0xC0, (len >> 8) & 0xFF, len & 0xFF]);
        const out = new Uint8Array(prefix.length + encoded.length);
        out.set(prefix); out.set(encoded, prefix.length);
        return out;
    }

    function encodeSentence(words) {
        const parts = words.map(encodeWord);
        const total = parts.reduce((s, p) => s + p.length, 0) + 1; // +1 for null terminator
        const buf = new Uint8Array(total);
        let offset = 0;
        for (const p of parts) { buf.set(p, offset); offset += p.length; }
        buf[offset] = 0; // end of sentence
        return buf.buffer;
    }

    // ── MD5 via SubtleCrypto for RouterOS challenge-response login ─
    async function md5Hex(data) {
        const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const hash = await crypto.subtle.digest('MD5', buf);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        return bytes;
    }

    // ── RouterOS API Login (MD5 challenge-response) ────────────────
    async function apiLogin(socketId, username, password) {
        // Step 1: request challenge
        await tcpSend(socketId, encodeSentence(['/login']));
        const resp1 = await tcpRead(socketId);

        const match = resp1.match(/=ret=([0-9a-fA-F]+)/);
        if (!match) throw new Error('[MikroTik] No login challenge received');
        const challenge = match[1];

        // Step 2: MD5(0x00 + password_bytes + challenge_bytes)
        const passBytes      = new TextEncoder().encode(password);
        const challengeBytes = hexToBytes(challenge);
        const toHash = new Uint8Array(1 + passBytes.length + challengeBytes.length);
        toHash[0] = 0x00;
        toHash.set(passBytes, 1);
        toHash.set(challengeBytes, 1 + passBytes.length);
        const hashedPass = await md5Hex(toHash);

        // Step 3: authenticate
        await tcpSend(socketId, encodeSentence([
            '/login',
            `=name=${username}`,
            `=response=00${hashedPass}`
        ]));
        const resp2 = await tcpRead(socketId);

        if (resp2.includes('!trap') || resp2.includes('!fatal')) {
            throw new Error('[MikroTik] Authentication failed — check credentials');
        }
        console.log('[MikroTik] Authenticated successfully');
    }

    async function openSession(routerIP, username = 'admin', password = '') {
        const socketId = await tcpCreate();
        await tcpConnect(socketId, routerIP, DEFAULT_PORT);
        await apiLogin(socketId, username, password);
        return socketId;
    }

    // ── Public command dispatcher ──────────────────────────────────
    async function sendCommand(action, args) {
        const [targetIP, ...cmdArgs] = args;
        if (!targetIP) throw new Error('[MikroTik] No Router IP provided');

        // Pull credentials from OfflineOrchestrator state
        const st   = window.OfflineOrchestrator?.getState?.() || {};
        const user = st.mikrotikUser || 'admin';
        const pass = st.mikrotikPass || '';

        let socketId;
        try {
            socketId = await openSession(targetIP, user, pass);
            let sentence = null;

            // ── Hotspot User Management ──
            if (action === 'addUser') {
                sentence = ['/ip/hotspot/user/add',
                    `=name=${cmdArgs[0]}`, `=password=${cmdArgs[1]}`, `=profile=${cmdArgs[2]}`];
            } else if (action === 'removeUser') {
                sentence = ['/ip/hotspot/user/remove', `=.id=[find name=${cmdArgs[0]}]`];
            }

            // ── IP-IP Tunnel Management ──
            else if (action === 'addTunnel') {
                const [tunnelName, localAddress, remoteAddress] = cmdArgs;
                sentence = ['/interface/ipip/add',
                    `=name=${tunnelName}`, `=local-address=${localAddress}`, `=remote-address=${remoteAddress}`];
            } else if (action === 'removeTunnel') {
                sentence = ['/interface/ipip/remove', `=.id=[find name=${cmdArgs[0]}]`];
            } else if (action === 'enableTunnel') {
                sentence = ['/interface/enable', `=.id=[find name=${cmdArgs[0]}]`];
            }

            // ── IP Address / Route Management ──
            else if (action === 'addTunnelIP') {
                const [tunnelName, ipAddress, prefix] = cmdArgs;
                sentence = ['/ip/address/add', `=address=${ipAddress}/${prefix}`, `=interface=${tunnelName}`];
            } else if (action === 'addRoute') {
                sentence = ['/ip/route/add', `=dst-address=${cmdArgs[0]}`, `=gateway=${cmdArgs[1]}`];
            } else if (action === 'removeRoute') {
                sentence = ['/ip/route/remove', `=.id=[find dst-address=${cmdArgs[0]}]`];
            }

            // ── Real per-user traffic query (replaces VBB random numbers) ──
            else if (action === 'getUsageBytes') {
                const targetUser = cmdArgs[0];
                await tcpSend(socketId, encodeSentence(
                    ['/ip/hotspot/active/print', `?user=${targetUser}`]
                ));
                const resp = await tcpRead(socketId);
                const bytesIn  = parseInt((resp.match(/=bytes-in=(\d+)/)  || [])[1] || '0');
                const bytesOut = parseInt((resp.match(/=bytes-out=(\d+)/) || [])[1] || '0');
                return { bytesIn, bytesOut, totalMB: (bytesIn + bytesOut) / (1024 * 1024) };
            }

            if (sentence) {
                await tcpSend(socketId, encodeSentence(sentence));
                const resp = await tcpRead(socketId);
                if (resp.includes('!trap')) console.warn(`[MikroTik] ${action} trap:`, resp);
                else console.log(`[MikroTik] ${action} OK`);
            }

        } catch (e) {
            console.error(`[MikroTik] ${action} failed:`, e);
            throw e;
        } finally {
            if (socketId !== undefined) {
                try { chrome.sockets.tcp.close(socketId); } catch (_) {}
            }
        }
    }

    return { sendCommand };
})();

/* ==================== ORCHESTRATOR CORE ==================== */
const OfflineOrchestrator = (() => {
    const state = {
        mode: navigator.onLine ? 'online' : 'offline',
        pendingOperations: []
    };

    function initialize() {
        console.log('🏁 Initializing Offline Orchestrator...');
        loadPendingOperations();
        detectNetworkMode();

        window.addEventListener('online', () => {
            state.mode = 'online';
            showToast('Back Online. Syncing...', 'info');
            syncPendingOperations();
        });
        window.addEventListener('offline', () => {
            state.mode = 'offline';
            showToast('Offline Mode Active', 'warning');
        });
    }
    function queueOperation(op) {
        state.pendingOperations.push(op);
        savePendingOperations();
        console.log(`[Offline] Operation Queued: ${op.type}`);

        // Try immediate sync if we happen to be online
        if (navigator.onLine) syncPendingOperations();
    }
    function savePendingOperations() {
        localStorage.setItem('pending_ops', JSON.stringify(state.pendingOperations));
    }

    function loadPendingOperations() {
        try {
            const s = localStorage.getItem('pending_ops');
            if (s) state.pendingOperations = JSON.parse(s);
        } catch (e) { }
    }

    async function syncPendingOperations() {
        if (!navigator.onLine || state.pendingOperations.length === 0) return;

        const operations = [...state.pendingOperations]; // Copy queue
        const remainingOps = [];

        console.log(`[Sync] Processing ${operations.length} items...`);


        // PROCESS QUEUE SEQUENTIALLY
        for (const op of operations) {
            try {
                if (typeof db === 'undefined') throw new Error("DB not ready");

                // --- ROUTER FOR ACTIONS ---
                switch (op.type) {
                    case 'UPDATE_CREDITS':
                        await db.collection('users').doc(op.uid).update({
                            credits: firebase.firestore.FieldValue.increment(op.amount)
                        });
                        break;

                    case 'PURCHASE_PLAN':
                        const batch = db.batch();
                        const userRef = db.collection('users').doc(op.uid);

                        // Register Subscription
                        batch.update(userRef, {
                            credits: firebase.firestore.FieldValue.increment(- (op.details.price || 0)), // Ensure price matches backend logic
                            subscriptions: firebase.firestore.FieldValue.arrayUnion(op.details)
                        });

                        // Register Transaction Log
                        const txRef = db.collection('transactions').doc();
                        batch.set(txRef, {
                            userId: op.uid,
                            type: 'purchase',
                            planId: op.planId,
                            timestamp: firebase.firestore.FieldValue.serverTimestamp()
                        });

                        await batch.commit();

                        // Sync to MikroTik Hardware
                        try {
                            const userSnap = await db.collection('users').doc(op.uid).get();
                            if (userSnap.exists) {
                                const userData = userSnap.data();
                                await window.RouterBridge.createUser(
                                    userData.username || op.uid,
                                    userData.hotspotPass || userData.uid || op.uid,
                                    op.planId
                                );
                                console.log(`[MikroTik] Synced plan purchase for ${userData.username}`);
                                
                                // Attempt instant auto-login now that plan is provisioned
                                window.RouterBridge.autoLogin(
                                    userData.username || op.uid,
                                    userData.hotspotPass || userData.uid || op.uid
                                ).catch(()=>{});
                            }
                        } catch (e) {
                            console.warn("[MikroTik] Hardware sync failed for purchase", e);
                        }
                        break;

                    case 'SIGNUP':
                        await db.collection('users').doc(op.data.id).set(op.data);
                        
                        // Sync to MikroTik Hardware
                        try {
                            await window.RouterBridge.createUser(
                                op.data.username || op.data.id,
                                op.data.hotspotPass || op.data.uid || op.data.id,
                                'default'
                            );
                            console.log(`[MikroTik] Synced signup for ${op.data.username}`);
                        } catch (e) {
                            console.warn("[MikroTik] Hardware sync failed for signup", e);
                        }
                        break;
                }

                console.log(`[Sync] ✅ ${op.type} Success`);

            } catch (e) {
                console.error(`[Sync] ❌ ${op.type} Failed`, e);
                // Keep in queue only if it's a network error, discard if logic error
                if (!navigator.onLine) remainingOps.push(op);
            }
        }

        // Save whatever failed
        state.pendingOperations = remainingOps;
        savePendingOperations();

        if (remainingOps.length === 0) showToast('Sync Complete', 'success');
    }
    async function detectNetworkMode() {
        // Set default MikroTik Gateway for Mesh/Tunnel logic
        state.gatewayIP = '192.168.88.1';
        state.mikrotikUser = 'admin';
        state.mikrotikPass = '';

        try {
            if (typeof DataStore !== 'undefined') {
                const uid = window.currentUser ? window.currentUser.id : null;
                const netCfg = await DataStore.getNetworkSettings(uid).catch(() => null);
                if (netCfg && netCfg.mikrotikIp) {
                    state.gatewayIP = netCfg.mikrotikIp;
                    state.mikrotikUser = netCfg.mikrotikUser || 'admin';
                    state.mikrotikPass = netCfg.mikrotikPass || '';
                    console.log(`[OfflineOrchestrator] MikroTik hardware link loaded: ${state.gatewayIP}`);
                }
            }
            
            // Connect and detect API mode (REST v7+ or TCP v6 fallback)
            if (window.RouterBridge) {
                try {
                    const result = await window.RouterBridge.connect({
                        host: state.gatewayIP,
                        username: state.mikrotikUser,
                        password: state.mikrotikPass
                    });
                    state.mikrotikApiMode = result.mode;
                    console.log(`[OfflineOrchestrator] MikroTik API Mode detected: ${state.mikrotikApiMode}`);
                } catch (bridgeErr) {
                    console.warn('[OfflineOrchestrator] RouterBridge connect failed:', bridgeErr);
                }
            }
        } catch (e) {
            console.warn("Could not fetch explicit MikroTik settings, falling back to auto-detect.");
        }

        // Use NetworkTools to identify gateway if available and not explicitly set
        if (typeof WifiWizard2 !== 'undefined' && state.gatewayIP === '192.168.88.1') {
            WifiWizard2.getWifiRouterIP().then(ip => {
                if (ip) {
                    state.gatewayIP = ip;
                    console.log(`[OfflineOrchestrator] Dynamic Gateway IP Discovered: ${ip}`);
                }
            }).catch(() => { });
        }

        // Initialize Local Storage Mesh cache
        const raw = localStorage.getItem('mesh_cache');
    }

    // Pause/resume hooks for background mode integration
    function pause() {
        console.log('[OfflineOrchestrator] Paused (background mode).');
    }

    function resume() {
        console.log('[OfflineOrchestrator] Resumed (foreground).');
        if (navigator.onLine) syncPendingOperations();
    }

    // --- PUBLIC ACTIONS ---

    async function registerUser(name) {
        const profile = {
            id: `OFFLINE-${Date.now()}`,
            uid: `OFFLINE-${Date.now()}`, // compatibility with uid
            username: name.toLowerCase().replace(/\s+/g, '_'),
            fullname: name,
            credits: 0,
            role: 'user',
            isOffline: true,
            createdAt: Date.now()
        };

        window.currentUser = profile;
        localStorage.setItem('user_profile', JSON.stringify(profile));

        queueOperation({ type: 'SIGNUP', data: profile, ts: Date.now() });

        return profile;
    }

    // --- MESH TUNNEL MANAGEMENT ---

    async function createMeshTunnel(peerIP, localIP) {
        const tunnelName = `mesh-${peerIP.replace(/\./g, '-')}`;

        try {
            await MikroTikHelper.sendCommand('addTunnel', [
                state.gatewayIP,
                tunnelName,
                localIP,
                peerIP
            ]);

            await MikroTikHelper.sendCommand('addTunnelIP', [
                state.gatewayIP,
                tunnelName,
                `10.255.${Math.floor(Math.random() * 255)}.1`,
                '30'
            ]);

            await MikroTikHelper.sendCommand('enableTunnel', [
                state.gatewayIP,
                tunnelName
            ]);

            console.log(`[Tunnel] Created ${tunnelName} to ${peerIP}`);
            return tunnelName;
        } catch (e) {
            console.error('[Tunnel] Creation failed:', e);
            throw e;
        }
    }

    async function removeMeshTunnel(peerIP) {
        const tunnelName = `mesh-${peerIP.replace(/\./g, '-')}`;
        try {
            await MikroTikHelper.sendCommand('removeTunnel', [state.gatewayIP, tunnelName]);
            console.log(`[Tunnel] Removed ${tunnelName}`);
        } catch (e) {
            console.warn('[Tunnel] Removal command failed:', e);
        }
    }

    return {
        initialize,
        registerUser,
        queueOperation,
        createMeshTunnel,
        removeMeshTunnel,
        syncPendingOperations,
        pause,
        resume,
        getState() { return state; }
    };
})();

/* ==================== VOUCHER ENGINE ==================== */
const VoucherEngine = {
    async redeem(qrString) {
        try {
            let code = qrString;
            try {
                const data = JSON.parse(qrString);
                if (data.code) code = data.code;
            } catch (e) {
                // Not JSON, assume raw string is the code
            }

            if (!window.currentUser) {
                if (window.showToast) showToast('Please log in first', 'error');
                return;
            }

            if (typeof redeemVoucherLogic === 'function') {
                const value = await redeemVoucherLogic(code);
                if (window.showToast) showToast(`Voucher Valid! Added $${value}`, 'success');
            } else {
                throw new Error("redeemVoucherLogic not found");
            }
        } catch (e) {
            console.error(e);
            if (window.showToast) showToast(e.message || 'Invalid Voucher', 'error');
        }
    }
};

/* ==================== UI HELPERS ==================== */
const OfflineUI = {
    showOnboarding() {
        const container = document.getElementById('appContainer');
        if (!container) return;
        container.innerHTML = `
            <div class="offline-onboarding" style="padding:20px; text-align:center;">
                <h2>🌍 Offline Setup</h2>
                <p>Create a local account to start.</p>
                <input type="text" id="offlineName" placeholder="Your Name" class="form-input" style="margin:10px 0; width:100%;">
                <button class="btn btn-primary btn-block" onclick="OfflineUI.handleRegister()">Create Profile</button>
            </div>`;
    },

    handleRegister() {
        const name = document.getElementById('offlineName').value;
        if (!name) return showToast('Name required', 'error');

        OfflineOrchestrator.registerUser(name).then(() => {
            if (window.showToast) showToast('Welcome Offline!', 'success');
            if (window.NanoAI) NanoAI.decide();
        });
    },

    showVoucherScanner() {
        if (!window.cordova?.plugins?.barcodeScanner) {
            return showToast('Scanner not available', 'warning');
        }
        cordova.plugins.barcodeScanner.scan(
            (result) => {
                if (!result.cancelled) VoucherEngine.redeem(result.text);
            },
            (err) => showToast('Scan failed: ' + err, 'error')
        );
    }
};

window.OfflineOrchestrator = OfflineOrchestrator;
window.OfflineUI = OfflineUI;
window.VoucherEngine = VoucherEngine;

// Auto Init
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => OfflineOrchestrator.initialize(), 1000);
});
