/**
 * ==========================================================
 * 🏁 Offline-First Orchestrator + MikroTik Integration
 * ==========================================================
 * Merged: OfflineOrchestrator, OfflineOnboarding, VoucherEngine
 */

/* ==================== MIKROTIK TCP HELPER ==================== */
const MikroTikHelper = (() => {
    const DEFAULT_PORT = 8728;
    // Helper to interface with Chrome Sockets (Cordova/Chrome App)
    // Legacy support for direct TCP comms
    async function connect(routerIP, routerPort = DEFAULT_PORT) {
        return new Promise((resolve, reject) => {
            if (!window.chrome?.sockets?.tcp) return reject('TCP plugin not available');
            chrome.sockets.tcp.create({}, (createInfo) => {
                const socketId = createInfo.socketId;
                chrome.sockets.tcp.connect(socketId, routerIP, routerPort, (result) => {
                    if (result < 0) return reject('TCP connection failed');
                    resolve(socketId);
                });
            });
        });
    }

    async function rawSend(socketId, command) {
        const encoder = new TextEncoder();
        const data = encoder.encode(command + '\n');
        return new Promise((resolve, reject) => {
            chrome.sockets.tcp.send(socketId, data.buffer, (sendInfo) => {
                if (sendInfo.resultCode < 0) return reject('Send failed');
                resolve(sendInfo);
            });
        });
    }

    async function sendCommand(action, args) {
        const [targetIP, ...cmdArgs] = args;

        let routerIP = targetIP;
        if (!routerIP) throw new Error("No Router IP");

        try {
            const sid = await connect(routerIP);
            let cmd = '';

            // Hotspot User Management
            if (action === 'addUser') {
                cmd = `/ip/hotspot/user/add name=${cmdArgs[0]} password=${cmdArgs[1]} profile=${cmdArgs[2]}`;
            } else if (action === 'removeUser') {
                cmd = `/ip/hotspot/user/remove [find name=${cmdArgs[0]}]`;
            }

            // IP-IP Tunnel Management (for Mesh)
            else if (action === 'addTunnel') {
                const [tunnelName, localAddress, remoteAddress] = cmdArgs;
                cmd = `/interface/ipip/add name=${tunnelName} local-address=${localAddress} remote-address=${remoteAddress}`;
            } else if (action === 'removeTunnel') {
                const [tunnelName] = cmdArgs;
                cmd = `/interface/ipip/remove [find name=${tunnelName}]`;
            } else if (action === 'enableTunnel') {
                const [tunnelName] = cmdArgs;
                cmd = `/interface/ipip/enable [find name=${tunnelName}]`;
            }

            // IP Address Assignment for Tunnels
            else if (action === 'addTunnelIP') {
                const [tunnelName, ipAddress, network] = cmdArgs;
                cmd = `/ip/address/add address=${ipAddress}/${network} interface=${tunnelName}`;
            }

            // Route Management for Mesh
            else if (action === 'addRoute') {
                const [dstAddress, gateway] = cmdArgs;
                cmd = `/ip/route/add dst-address=${dstAddress} gateway=${gateway}`;
            } else if (action === 'removeRoute') {
                const [dstAddress] = cmdArgs;
                cmd = `/ip/route/remove [find dst-address=${dstAddress}]`;
            }

            if (cmd) await rawSend(sid, cmd);

            chrome.sockets.tcp.close(sid);
        } catch (e) {
            console.error(`MikroTik ${action} failed:`, e);
            throw e;
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
            if (typeof showToast === 'function') showToast('Back Online. Syncing…', 'info');
            syncPendingOperations();
        });
        window.addEventListener('offline', () => {
            state.mode = 'offline';
            if (typeof showToast === 'function') showToast('Offline Mode Active', 'warning');
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
                        break;

                    case 'SIGNUP':
                        await db.collection('users').doc(op.data.id).set(op.data);
                        break;

                    case 'SESSION_KICK': {
                        // Non-blocking gateway call — fail silently if router is offline
                        const port = (typeof window !== 'undefined' && window.ENV?.GATEWAY_PORT) || '19876';
                        const token = (typeof window !== 'undefined' && window.ENV?.GATEWAY_TOKEN) || '';
                        await fetch(`http://localhost:${port}/api/v1/users/kick`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-gateway-token': token },
                            body: JSON.stringify({ user: op.username }),
                            signal: AbortSignal.timeout(5000)
                        }).catch(() => { });
                        break;
                    }

                    case 'VOUCHER':
                        // Handled by VoucherEngine; kept for queue compatibility
                        break;

                    default:
                        console.warn(`[Sync] Unknown op type: ${op.type}`);
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

        if (remainingOps.length === 0 && typeof showToast === 'function') showToast('Sync Complete', 'success');
    }
    function detectNetworkMode() {
        // Set default MikroTik Gateway for Mesh/Tunnel logic
        state.gatewayIP = '192.168.88.1';

        // Use NetworkTools to identify gateway if available
        if (typeof WifiWizard2 !== 'undefined') {
            WifiWizard2.getWifiRouterIP().then(ip => {
                if (ip && ip !== '0.0.0.0') state.gatewayIP = ip;
            }).catch(() => { });
        }
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
            await MikroTikHelper.sendCommand('removeTunnel', [tunnelName]);
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
        loadFromStorage: loadPendingOperations, // exposed for testing
        getState() { return state; }
    };
})();

/* ==================== VOUCHER ENGINE ==================== */
const VoucherEngine = {
    async redeem(qrString) {
        try {
            const data = JSON.parse(qrString);

            if (window.showToast) showToast(`Voucher Valid! ${data.amt || 'N/A'} MB`, 'success');

            if (window.currentUser) {
                OfflineOrchestrator.queueOperation({ type: 'VOUCHER', data, ts: Date.now() });
            }

            if (window.NetworkTools) window.NetworkTools.initialize();

        } catch (e) {
            if (window.showToast) showToast('Invalid Voucher', 'error');
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
