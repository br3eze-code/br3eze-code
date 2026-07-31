/* ==========================================================
   FILE: nearby.js
   DESCRIPTION: Full Mesh Mesh Protocol (Signup, Vouchers, Credits)
   ========================================================== */

const GossipService = {
    plugin: null,
    peers: new Map(),
    relayQueue: [],
    processedIds: new Set(),
    peerHistory: {}, // Persisted history of peers
    advertising: false,
    SERVICE_ID: "com.platform.net.internal_network", // Unique service ID for your app

    async initialize() {
        if (typeof cordova !== 'undefined' && cordova.plugins && cordova.plugins.NearbyConnectionsPlugin) {
            this.plugin = cordova.plugins.NearbyConnectionsPlugin;
            this.loadQueue();
            this.loadHistory();
            this.startGossip();

            if (this.maintenanceInterval) clearInterval(this.maintenanceInterval);
            this.maintenanceInterval = setInterval(() => this.maintenance(), 30000);
      console.log("[Mesh] intitialized")
        } else {
            console.warn("[Mesh] Plugin not available (Browser Mode). Mesh features disabled.");
            // Simulate for AI Context in dev
            if (window.ContextManager) window.ContextManager.updateMeshPeers({ peerCount: 0, peers: [] });
        }
    },

    async startGossip() {
        if (!this.plugin) return;
        try {
            const name = window.currentUser ? window.currentUser.fullname || "Peer" : "RelayNode";
            const strategy = "P2P_CLUSTER"; // String constant as per plugin API

            // startAdvertising(advertisingMessage, strategy, callback)
            this.plugin.startAdvertising(
                name,                          // Local endpoint name
                this.SERVICE_ID,               // Required service ID
                strategy,
                (data) => this.dispatch(data), // Unified callback for logs, connections, payloads
                (error) => console.error("[Mesh] Advertising error:", error)
            );

            // Also start discovery to form full mesh
            this.plugin.startDiscovery(
                this.SERVICE_ID,
                strategy,
                (data) => this.dispatch(data),
                (error) => console.error("[Mesh] Discovery error:", error)
            );

            this.advertising = true;
            console.log("[Mesh] Advertising & Discovery started (P2P_CLUSTER mesh)");
        } catch (e) {
            console.error("[Mesh] Failed to start gossip:", e);
        }
    },

    stop() {
        if (!this.plugin) return;
        try {
            if (this.advertising) {
                this.plugin.stopAdvertising(() => { }, () => { });
                this.plugin.stopBrowsing(() => { }, () => { });
            }
            this.peers.clear();
            this.processedIds.clear();
            this.advertising = false;
            console.log("[Mesh] Service stopped successfully.");
        } catch (e) {
            console.warn("[Mesh] Error stopping service:", e);
        }
    },

    dispatch(data) {
        if (!data) return;
        if (data.messageType === 'log' && data.message) {
            if (data.message.includes("Connected to")) {
                const id = data.message.split("Connected to ")[1];
                if (id) {
                    this.peers.set(id, { connectedAt: Date.now(), lastSeen: Date.now() });
                    this.updatePeerHistory(id, { status: 'online', lastSeen: Date.now() });
                    this.syncWithPeer(id);
                }
            } else if (data.message.includes("Disconnected from")) {
                const id = data.message.split("Disconnected from ")[1]?.trim();
                if (id) {
                    this.peers.delete(id);
                    this.updatePeerHistory(id, { status: 'offline', lastSeen: Date.now() });
                }
            }
        }
        if (data.messageType === 'payload') this.handleIncoming(data);
    },
    saveProcessedIds() {
        localStorage.setItem('mesh_processed', JSON.stringify([...this.processedIds]));
    },
    async handleIncoming(data) {
        try {
            const raw = data.object?.payloadData;
            if (!raw) return;
            const item = await CryptoUtils.decryptPayload(raw);
            if (!item || !item.id || !item.type || this.processedIds.has(item.id)) return;

            // Update Last Seen if sender is known/direct
            if (item.payload && item.payload.senderId) {
                const pid = item.payload.senderId;
                this.updatePeerHistory(pid, { lastSeen: Date.now() });
                if (this.peers.has(pid)) {
                    const p = this.peers.get(pid);
                    p.lastSeen = Date.now();
                    this.peers.set(pid, p);
                }
            }

            this.processedIds.add(item.id);
            this.saveProcessedIds();

            // Validate item structure
            if (typeof item.payload !== 'object' || Object.keys(item.payload).length === 0) {
                console.warn("[Mesh] Invalid payload structure");
                return;
            }
            console.log("[Mesh] Received:", item.type);
            this.processedIds.add(item.id);

            // PROCESS TYPES
            if (item.type === 'USER_SIGNUP') await this.handleSignupRelay(item);
            if (item.type === 'CREDIT_SYNC') this.handleCreditSync(item);
            if (item.type === 'VOUCHER_REDEMPTION') await this.handleVoucherGossip(item);
            if (item.type === 'CHAT_MESSAGE') this.handleChatIncoming(item);
            if (item.type === 'BALANCE_SYNC') this.handleBalanceSync(item);

            this.addToQueue(item);
        } catch (e) { }
    },

    handleChatIncoming(item) {
        // If I am the recipient, update conversation history
        if (window.currentUser && window.currentUser.id === item.payload.recipientId) {
            console.log("[Mesh] Chat Received from:", item.payload.senderName);
            if (window.CommunicationHub) {
                window.CommunicationHub.onMessageReceived(item.payload);
            }
            showToast(`📩 Message from ${item.payload.senderName}`, 'info');
        }
    },

    async sendChatMessage(recipientId, text) {
        if (!window.currentUser) return;
        const item = {
            id: await CryptoUtils.hash(window.currentUser.id + recipientId + text + Date.now()),
            type: 'CHAT_MESSAGE',
            payload: {
                senderId: window.currentUser.id,
                senderName: window.currentUser.fullname || window.currentUser.username,
                recipientId: recipientId,
                text: text,
                timestamp: Date.now(),
                isMesh: true
            }
        };
        this.addToQueue(item);
        return item.payload;
    },

    handleBalanceSync(item) {
        if (window.MeshBilling) {
            window.MeshBilling.handleIncomingGossip({
                userId: item.payload.userId,
                data: item.payload.data
            });
        }
    },

    async broadcastBalanceSync(userId, data) {
        const item = {
            id: await CryptoUtils.hash(userId + data.seq + Date.now()),
            type: 'BALANCE_SYNC',
            payload: { userId, data }
        };
        this.addToQueue(item);
    },

    async handleSignupRelay(item) {
        if (navigator.onLine && typeof auth !== 'undefined') {
            try {
                // Check if user exists first
                const exists = await DataStore.getUserByUsername(item.payload.username);
                if (!exists) {
                    console.log("[Mesh] Provisioning offline user:", item.payload.username);
                    // Provision in Firestore (using placeholder password or special hash)
                    await db.collection('users').doc(item.payload.uid).set({
                        ...item.payload,
                        isMeshGraduated: false, // Flag for when they finally go online
                        provisionedVia: 'mesh'
                    });
                }
            } catch (e) { }
        }
    },

    handleCreditSync(item) {
        // If I am the recipient, I can update my local UI immediately
        if (window.currentUser && window.currentUser.uid === item.payload.targetUid) {
            console.log("[Mesh] Credits Received via Mesh! +", item.payload.amount);
            window.currentUser.credits += item.payload.amount;
            if (typeof updateUI === 'function') updateUI();
            showToast(`Received $${item.payload.amount} via P2P!`, 'success');
        }
    },

    async handleVoucherGossip(item) {
        if (navigator.onLine) {
            try {
                const voucherSnap = await db.collection('vouchers').where('code', '==', item.payload.code).get();
                if (!voucherSnap.empty && !voucherSnap.docs[0].data().used) {
                    const v = voucherSnap.docs[0];
                    const batch = db.batch();
                    batch.update(db.collection('users').doc(item.payload.uid), { credits: firebase.firestore.FieldValue.increment(v.data().value) });
                    batch.update(v.ref, { used: true, usedBy: item.payload.uid, mesh: true });
                    await batch.commit();
                }
            } catch (e) { }
        }
    },

    addToQueue(item) {
        if (!this.relayQueue.find(i => i.id === item.id)) {
            this.relayQueue.push({ ...item, expires: Date.now() + 86400000 });
            this.saveQueue();
            this.peers.forEach((_, id) => this.deliverItem(id, item));
        }
    },

    async syncWithPeer(id) {
        for (const item of this.relayQueue) await this.deliverItem(id, item);
    },

    async deliverItem(targetId, item) {
        const enc = await CryptoUtils.encryptPayload(item);
        if (!enc) { console.warn('[Mesh] Encryption failed'); return; }
        const msg = JSON.stringify({ messageType: "mesh", message: item.type, destination: targetId });
        this.plugin.transferData(msg, enc, () => { }, (e) => { });
    },

    async queueMeshSignup(user) {
        const item = {
            id: await CryptoUtils.hash(user.username + user.createdAt),
            type: 'USER_SIGNUP',
            payload: user
        };
        this.addToQueue(item);
    },

    async broadcastCreditSync(targetUid, amount) {
        const item = {
            id: await CryptoUtils.hash(targetUid + amount + Date.now()),
            type: 'CREDIT_SYNC',
            payload: { targetUid, amount }
        };
        this.addToQueue(item);
    },

    // Maintenance etc (omitted for brevity but assume present)
    maintenance() {
        const now = Date.now();
        this.relayQueue = this.relayQueue.filter(i => i.expires > now);
        this.saveQueue();

        // Feed mesh state to AI
        if (window.ContextManager && window.ContextManager.updateMeshPeers) {
            const peerData = {
                peers: Array.from(this.peers.values()),
                peerCount: this.peers.size
            };
            window.ContextManager.updateMeshPeers(peerData);
        }
    },
    saveQueue() { localStorage.setItem('mesh_q', JSON.stringify(this.relayQueue)); },
    loadQueue() {
        try { this.relayQueue = JSON.parse(localStorage.getItem('mesh_q') || '[]'); } catch { this.relayQueue = []; }
    },

    saveHistory() { localStorage.setItem('mesh_peer_history', JSON.stringify(this.peerHistory)); },
    loadHistory() {
        try { this.peerHistory = JSON.parse(localStorage.getItem('mesh_peer_history') || '{}'); } catch { this.peerHistory = {}; }
    },

    updatePeerHistory(id, data) {
        if (!this.peerHistory[id]) this.peerHistory[id] = {};
        this.peerHistory[id] = { ...this.peerHistory[id], ...data };
        this.saveHistory();
    },

    getPeer(id) {
        return this.peers.get(id) || this.peerHistory[id];
    }
};

window.GossipService = GossipService;
