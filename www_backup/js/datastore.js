/**
 * DataStore.js — Unified Frontend Database Interface for AgentOS
 * Synchronized with src/core/database.js and src/core/firebase.js patterns.
 */

// Global accessors to harmonize with backend patterns
window.getFirestore = () => {
    if (typeof firebase === 'undefined') return null;
    if (!window.db) window.db = firebase.firestore();
    return window.db;
};

window.getDatabase = () => {
    return window.DataStore;
};

window.getDatastore = () => {
    return window.DataStore;
};

const DataStore = {
    // Collection shortcuts
    get users() { return getFirestore().collection('users'); },
    get plans() { return getFirestore().collection('plans'); },
    get vouchers() { return getFirestore().collection('vouchers'); },
    get transactions() { return getFirestore().collection('transactions'); },
    get tickets() { return getFirestore().collection('tickets'); },
    get settings() { return getFirestore().collection('settings'); },
    get mikrotik() { return getFirestore().collection('mikrotik'); },

    // ── User Management ──────────────────────────────────────────────────────

    async getUser(uid) {
        const doc = await this.users.doc(uid).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async getUserByUsername(username) {
        if (!username) return null;
        const snap = await this.users.where('username', '==', username).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    /** Mirrors backend database.js getUserByEmail() */
    async getUserByEmail(email) {
        if (!email) return null;
        const lowerEmail = email.toLowerCase().trim();
        const snap = await this.users.where('email', '==', lowerEmail).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    /** Mirrors backend database.js getUserByPhone() */
    async getUserByPhone(phone) {
        if (!phone) return null;
        const snap = await this.users.where('phoneNumber', '==', phone).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    /**
     * Mirrors backend database.js getUserByChannel().
     * Resolves a user by their registered channel identifier
     * (e.g. channel='telegram', channelId='123456789').
     */
    async getUserByChannel(channel, channelId) {
        if (!channel || !channelId) return null;
        const idStr = String(channelId);
        const snap = await this.users.where(`channels.${channel}`, '==', idStr).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },

    /**
     * Mirrors backend database.js linkChannel().
     * Writes channels.<channel>=channelId on an existing user document.
     */
    async linkChannel(userId, channel, channelId) {
        if (!userId || !channel || !channelId) return false;
        const update = { [`channels.${channel}`]: String(channelId) };
        await this.users.doc(String(userId)).update(update);
        return true;
    },

    async getAllUsers() {
        const snap = await this.users.orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async updateUser(uid, data) {
        await this.users.doc(uid).update(data);
    },

    // ── Plans & Subscriptions ────────────────────────────────────────────────

    async getPlans() {
        try {
            const snap = await this.plans.orderBy('price').get();
            const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (plans.length > 0) localStorage.setItem('cached_plans', JSON.stringify(plans));
            return plans;
        } catch (e) {
            console.warn("DataStore: Using LocalStorage Plans Fallback");
            const cached = localStorage.getItem('cached_plans');
            return cached ? JSON.parse(cached) : [];
        }
    },

    async savePlan(planId, data) {
        if (planId) {
            await this.plans.doc(planId).set(data, { merge: true });
        } else {
            await this.plans.add(data);
        }
    },

    async deletePlan(planId) {
        await this.plans.doc(planId).delete();
    },

    async hasActivePlan(uid) {
        const user = await this.getUser(uid);
        if (!user || !user.subscriptions) return false;
        const now = Date.now();
        // Handle both JS Date and Firestore Timestamp
        return user.subscriptions.some(s => {
            const expiry = s.expiresAt?.seconds ? s.expiresAt.seconds * 1000 : new Date(s.expiresAt).getTime();
            const isActive = s.status === 'active' || s.status === 'unused';
            return isActive && expiry > now;
        });
    },

    // ── Vouchers ─────────────────────────────────────────────────────────────

    async getVoucher(code) {
        if (!code) return null;
        const cleanCode = code.toUpperCase().trim();

        // 1. Try local gateway API first for instant offline capability
        try {
            const gatewayPort = (window.ENV && window.ENV.GATEWAY_PORT) || '3000';
            const gatewayUrl = `${window.location.protocol}//${window.location.hostname}:${gatewayPort}`;
            const res = await fetch(`${gatewayUrl}/api/v1/vouchers/${cleanCode}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.voucher) {
                    console.log('DataStore: Voucher retrieved from local gateway:', cleanCode);
                    return data.voucher;
                }
            }
        } catch (err) {
            console.warn('DataStore: Local gateway voucher fetch failed, trying Firestore...', err);
        }

        // 2. Fallback to Firestore
        if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
            try {
                const snap = await this.vouchers.where('code', '==', cleanCode).limit(1).get();
                return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
            } catch (e) {
                console.error('DataStore: Firestore voucher fetch failed:', e);
            }
        }
        return null;
    },

    /** Alias kept in sync with backend database.js */
    async getVoucherByCode(code) {
        return this.getVoucher(code);
    },

    async getAllVouchers() {
        const snap = await this.vouchers.orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async createVoucher(planId, price, metadata = {}) {
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        const voucher = {
            code,
            planId,
            price,
            used: false,
            status: 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...metadata
        };
        const ref = await this.vouchers.add(voucher);
        return { id: ref.id, ...voucher };
    },

    async redeemVoucher(uid, code) {
        const voucher = await this.getVoucher(code);
        if (!voucher) throw new Error('Invalid voucher code');
        if (voucher.used) throw new Error('Voucher already used');

        const batch = getFirestore().batch();
        batch.update(this.vouchers.doc(voucher.id), { 
            used: true, 
            usedBy: uid, 
            usedAt: firebase.firestore.FieldValue.serverTimestamp() 
        });
        
        // Logical update of user status would happen here or via backend trigger
        await batch.commit();
        return voucher;
    },

    // ── Transactions ─────────────────────────────────────────────────────────

    async addTransaction(data) {
        await this.transactions.add({ 
            ...data, 
            timestamp: firebase.firestore.FieldValue.serverTimestamp() 
        });
    },

    async getTransactionsForUser(userId) {
        const snap = await this.transactions.where('userId', '==', userId).orderBy('timestamp', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getAllTransactions() {
        const snap = await this.transactions.orderBy('timestamp', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    // ── Tickets & Communication ──────────────────────────────────────────────

    async getTickets(uid = null) {
        let q = this.tickets.orderBy('lastUpdate', 'desc');
        if (uid) q = q.where('userId', '==', uid);
        const snap = await q.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async addTicket(ticketData) {
        return await this.tickets.add({
            ...ticketData,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async submitTicket(uid, subject, body, meta = {}) {
        return this.addTicket({
            userId: uid,
            subject,
            body,
            status: 'Open',
            ...meta
        });
    },

    async getTicketReplies(ticketId) {
        const snap = await this.tickets.doc(ticketId)
            .collection('replies')
            .orderBy('timestamp', 'asc')
            .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async sendTicketReply(ticketId, messageData) {
        const batch = getFirestore().batch();
        const replyRef = this.tickets.doc(ticketId).collection('replies').doc();
        batch.set(replyRef, {
            ...messageData,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        batch.update(this.tickets.doc(ticketId), {
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
    },

    async updateTicketStatus(ticketId, status) {
        await this.tickets.doc(ticketId).update({
            status,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
    },

    async sendSystemMessage(uid, title, body) {
        await this.addTicket({
            userId: uid,
            userEmail: 'System',
            subject: title,
            body,
            status: 'Archived',
            isSystemMessage: true
        });
    },

    async setUserNotification(uid, data) {
        await this.users.doc(uid).update({ pendingNotification: data });
    },

    // ── Settings ─────────────────────────────────────────────────────────────

    async getNetworkSettings(uid = null) {
        let masterConfig;
        try {
            const fetchPromise = this.settings.doc('network').get();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
            const d = await Promise.race([fetchPromise, timeoutPromise]);

            if (d.exists) {
                masterConfig = d.data();
                localStorage.setItem('cached_wifi_ssid', masterConfig.ssid);
                localStorage.setItem('cached_wifi_pass', masterConfig.password);
            } else {
                throw new Error("No config");
            }
        } catch (e) {
            console.warn("DataStore: Offline/DB Error, using fallback Wi-Fi");
            masterConfig = { 
                ssid: localStorage.getItem('cached_wifi_ssid') || 'Power-HotSpot', 
                password: localStorage.getItem('cached_wifi_pass') || 'PowerHotspotPass' 
            };
        }

        if (!uid && typeof currentUser !== 'undefined' && currentUser) uid = currentUser.id;
        if (!uid) return { ...masterConfig, accessGranted: false };

        const planActive = await this.hasActivePlan(uid).catch(() => false);
        const isAdmin = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');

        if (planActive || isAdmin) {
            return { ...masterConfig, accessGranted: true };
        } else {
            return {
                ssid: masterConfig.ssid,
                password: "EXP_" + Date.now(),
                accessGranted: false
            };
        }
    },

    async updateNetworkSettings(data) {
        await this.settings.doc('network').set(data, { merge: true });
        localStorage.setItem('cached_wifi_ssid', data.ssid);
        localStorage.setItem('cached_wifi_pass', data.password);
    },

    // ── MikroTik Integration ─────────────────────────────────────────────────

    async getMikrotikState(id = 'default') {
        const doc = await this.mikrotik.doc(id).get();
        return doc.exists ? doc.data() : null;
    },

    async updateMikrotikState(id, state) {
        await this.mikrotik.doc(id).set({
            ...state,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
};

window.DataStore = DataStore;
