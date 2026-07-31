// =============================================================================
// MERGED: DECENTRALIZED BILLING & GOSSIP ENGINE
// =============================================================================
const MeshBilling = {
    // Track usage since app start
    sessionInitialBytes: 0,

    async initialize() {
        // Initialize TrafficStats (Assuming Cordova Plugin)
        const stats = window.TrafficStats || window.NativeTrafficStats;
        if (stats) {
            try {
                // Initialize sessionInitialBytes from storage to keep consistency across restarts
                const storedInitial = localStorage.getItem('bill_session_initial');
                const currentTotal = await (stats.getAppBytes ? stats.getAppBytes() : (stats.getTotalWifiBytes ? stats.getTotalWifiBytes() : 0));

                if (storedInitial) {
                    this.sessionInitialBytes = parseFloat(storedInitial);
                } else {
                    this.sessionInitialBytes = currentTotal;
                    localStorage.setItem('bill_session_initial', this.sessionInitialBytes);
                }
            } catch (e) {
                console.warn("[Bill] TrafficStats init failed", e);
            }
        }
        this.startMeterLoop();
    },

    // 1. THE UPDATE LOOP (Runs every 10s)
    startMeterLoop() {
        if (this.meterInterval) clearInterval(this.meterInterval);

        this.meterInterval = setInterval(async () => {
            if (!window.DataStore || !DataStore.getCurrentUserId) return;

            const userId = DataStore.getCurrentUserId();
            // Assuming DataStore.getFirewallBlockSync exists or we skip it for now if not
            const blocked = DataStore.getFirewallBlockSync ? DataStore.getFirewallBlockSync() : false;

            if (!userId || blocked) return;

            // Get current usage delta
            const stats = window.TrafficStats || window.NativeTrafficStats;
            if (!stats) return;

            try {
                const currentTotal = await stats.getAppBytes ? stats.getAppBytes() : (stats.getTotalWifiBytes ? stats.getTotalWifiBytes() : 0);
                const deltaMB = (currentTotal - this.sessionInitialBytes) / (1024 * 1024);

                if (deltaMB > 0.05) { // Only update if > 50KB used
                    await this.applyUpdate(userId, deltaMB);
                    this.sessionInitialBytes = currentTotal;
                    localStorage.setItem('bill_session_initial', this.sessionInitialBytes);
                }
            } catch (e) {
                // Ignore transient stat errors
                console.warn("[Bill] Stat read error", e);
            }
        }, 10000);
    },

    stopMeterLoop() {
        if (this.meterInterval) {
            clearInterval(this.meterInterval);
            this.meterInterval = null;
        }
    },

    // 2. THE MERGE LOGIC (Local DB + RTDB + Gossip)
    async applyUpdate(userId, consumedMB) {
        const timestamp = Date.now();
        const shardId = `shard_${Math.floor(parseInt(userId.replace(/\D/g, '')) / 20)}`; // Shard every 20 users

        // A. Update Local DataStore (Immediate UI feedback)
        let localData = await DataStore.get(`user_balance_${userId}`) || { balance: 0, seq: 0 };

        // Don't deduct balance for admin/family, but still log the "usage" event if needed
        const whitelist = ['admin', 'family', 'partner'];
        const role = (window.currentUser && currentUser.role) ? currentUser.role : 'user';

        if (!whitelist.includes(role)) {
            localData.balance -= consumedMB;
        }

        localData.seq += 1;
        localData.last_update = timestamp;

        await DataStore.set(`user_balance_${userId}`, localData);

        // B. Update Firebase RTDB (Background Sync)
        // Firebase handles the "Offline Queue" automatically
        const rtdbRef = firebase.database().ref(`billing/${shardId}/${userId}`);
        rtdbRef.update({
            balance: localData.balance,
            seq: localData.seq,
            last_update: timestamp
        });

        // C. Trigger Gossip (Broadcast to Mesh)
        if (window.GossipService) {
            window.GossipService.broadcastBalanceSync(userId, localData);
        }
    },

    // 3. CONFLICT RESOLUTION (Gossip Received)
    async handleIncomingGossip(incoming) {
        if (!window.DataStore) return;

        const local = await DataStore.get(`user_balance_${incoming.userId}`);

        // Use Vector Clock (seq) + AI Core to resolve
        if (!local || incoming.data.seq > local.seq) {
            console.log(`[Bill] Applying newer gossip for ${incoming.userId}`);
            await DataStore.set(`user_balance_${incoming.userId}`, incoming.data);

            // Mirror to RTDB to help sync the rest of the mesh
            if (window.firebase) {
                firebase.database().ref(`billing/active/${incoming.userId}`).set(incoming.data);
            }
        }
    }
};

window.MeshBilling = MeshBilling;