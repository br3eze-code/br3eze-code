/**
 * ==========================================================
 * 🌉 RouterBridge (MikroTik Edge integration)
 * ==========================================================
 */

const RouterBridge = {
    socketId: null,

    async initLogin() {
        const state = window.OfflineOrchestrator ? window.OfflineOrchestrator.getState() : {};
        console.log("[RouterBridge] Init Login - Gateway IP:", state.gatewayIP);

        if (!state.gatewayIP) {
            const loginForm = document.getElementById('loginForm');
            const addRouterBtn = document.getElementById('addRouterBtn');
            if (loginForm) loginForm.style.display = 'none';
            if (addRouterBtn) addRouterBtn.style.display = 'block';
            return;
        }

        try {
            const res = await fetch(`http://${state.gatewayIP}/api/router/status/current`);
            const routerStatus = await res.json();

            const loginForm = document.getElementById('loginForm');
            const statusContainer = document.getElementById('statusContainer');

            if (routerStatus.provisioning) {
                if (loginForm) loginForm.style.display = 'none';
                if (statusContainer) statusContainer.style.display = 'block';
            } else {
                if (loginForm) loginForm.style.display = 'block';
                if (statusContainer) statusContainer.style.display = 'none';
            }
        } catch (e) {
            console.warn("[RouterBridge] Router status check failed:", e);
        }
    },

    async addRouter() {
        showToast('🔍 Searching for router...', 'info');
        const state = window.OfflineOrchestrator ? window.OfflineOrchestrator.getState() : {};
        const gateway = state.gatewayIP;

        if (!gateway) {
            showToast('❌ No MikroTik detected', 'error');
            return;
        }

        showToast('⚙️ Claiming router...', 'info');

        try {
            const res = await fetch(`http://${gateway}/api/router/claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nodeId: window.currentUser?.uid || 'local-node',
                    meshRole: 'EDGE',
                    location: 'auto'
                })
            });

            const result = await res.json();
            if (result.success) {
                showToast('✅ Router ready for mesh', 'success');
                this.initLogin();
            } else {
                showToast(`❌ ${result.message}`, 'error');
            }
        } catch (e) {
            showToast('❌ Request failed: Network error', 'error');
        }
    },

    // --- Native Socket Helpers (Chrome Socket API for Android) ---
    connectToMikrotik(routerIP, routerPort = 8728) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.sockets || !chrome.sockets.tcp) {
                return reject('Chrome Sockets API not available');
            }
            chrome.sockets.tcp.create({}, (createInfo) => {
                const socketId = createInfo.socketId;
                chrome.sockets.tcp.connect(socketId, routerIP, routerPort, (result) => {
                    if (result < 0) return reject('TCP connection failed');
                    this.socketId = socketId;
                    resolve(socketId);
                });
            });
        });
    },

    sendCommand(socketId, command) {
        return new Promise((resolve, reject) => {
            const encoder = new TextEncoder();
            const data = encoder.encode(command + '\n');
            chrome.sockets.tcp.send(socketId, data.buffer, (sendInfo) => {
                if (sendInfo.resultCode < 0) return reject('Send failed');
                resolve(sendInfo);
            });
        });
    },

    closeConnection(socketId) {
        if (typeof chrome !== 'undefined' && chrome.sockets && chrome.sockets.tcp) {
            chrome.sockets.tcp.close(socketId);
            this.socketId = null;
        }
    }
};

window.RouterBridge = RouterBridge;
