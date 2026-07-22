'use strict';
/**
 * AgentOS Database
 * Collections: vouchers, users, transactions, plans, wallets, audit_log, mikrotik
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { logger } = require('./logger');
const { STATE_PATH } = require('./config');


// ── Default Plans (mirrors agentos-sentinel.rsc profiles) ────────────────────
// Schema: name, description, deviceLimit, durationUnit, durationValue, imageUrl
//         + price

const DEFAULT_PLANS = {
    '1Hour': {
        dataLimit: '1GB',
        description: 'Perfect for a quick browsing session.',
        deviceLimit: 1,
        durationUnit: 'hours',
        durationValue: 1,
        imageUrl: '',
        name: '1 Hour',
        price: 0.50,
    },
    '1Day': {
        dataLimit: '5GB',
        description: 'Full-day unlimited access for work or entertainment.',
        deviceLimit: 1,
        durationDays: 1,
        durationUnit: 'days',
        durationValue: 1,
        imageUrl: '',
        name: '1 Day',
        price: 1.00,
    },
    '7Day': {
        dataLimit: '30GB',
        description: 'A full week of high-speed connectivity.',
        deviceLimit: 1,
        durationDays: 7,
        durationUnit: 'days',
        durationValue: 7,
        imageUrl: '',
        name: '7 Days',
        price: 3.00,

    },
    '30Day': {
        dataLimit: '120GB',
        description: 'Monthly plan — best value for regular users.',
        deviceLimit: 3,
        durationDays: 30,
        durationUnit: 'days',
        durationValue: 30,
        imageUrl: '',
        name: '30 Days',
        price: 5.00,
    },
    'default': {
        dataLimit: '1GB',
        description: 'Standard access — no time restriction.',
        deviceLimit: 1,
        durationDays: 0,
        durationUnit: null,
        durationValue: null,
        imageUrl: '',
        name: 'Default',
        price: 100.00,
    },
};

// ── Database Class ────────────────────────────────────────────────────────────

class Database {
    constructor() {
        this.db = null;

        // Local in-memory fallbacks
        this._vouchers = new Map();
        this._users = new Map();
        this._wallets = new Map();
        this._plans = new Map();
        this._transactions = [];
        this._auditLog = [];
        this._mikrotik = new Map();

        // File paths
        this._paths = {
            vouchers: path.join(STATE_PATH, 'vouchers.json'),
            users: path.join(STATE_PATH, 'users.json'),
            wallets: path.join(STATE_PATH, 'wallets.json'),
            plans: path.join(STATE_PATH, 'plans.json'),
            transactions: path.join(STATE_PATH, 'transactions.json'),
            audit: path.join(STATE_PATH, 'audits.json'),
            mikrotik: path.join(STATE_PATH, 'mikrotik.json'),
        };

        this._init();
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    _init() {
        try {
            // Always initialize SQLite as the persistent local state
            const { getSQLite } = require('./sqlite-db');
            this.sqlite = await getSQLite();
            logger.info('Database: SQLite initialized');

            if (process.env.FIREBASE_PROJECT_ID) {
                if (!admin.apps.length) {
                    let credential;

                    if (process.env.FIREBASE_SERVICE_ACCOUNT && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT)) {
                        credential = admin.credential.cert(require(path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT)));
                        logger.info(`Firebase: loaded service account from ${process.env.FIREBASE_SERVICE_ACCOUNT}`);

                    } else if (process.env.FIREBASE_PRIVATE_KEY) {
                        let pk = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
                        if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);
                        if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
                            pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;
                        }
                        credential = admin.credential.cert({
                            projectId: process.env.FIREBASE_PROJECT_ID,
                            privateKey: pk,
                            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                        });
                    }

                    if (credential) {
                        admin.initializeApp({ credential, databaseURL: process.env.FIREBASE_DATABASE_URL });
                    }
                }

                this.db = admin.firestore();
                this.db.settings({ ignoreUndefinedProperties: true });
                logger.info('Firebase: Firestore connected');
                this._seedPlans().catch(e => logger.warn('Plan seed error:', e.message));
                return;
            }
        } catch (err) {
            logger.error(`Firebase init failed: ${err.message}`);
        }

        logger.info('Database: using local file storage');
        this._loadLocal();
        this._seedPlansLocal();
    }

    // ── Local Storage ─────────────────────────────────────────────────────────

    _loadLocal() {
        const loadMap = (filePath, map) => {
            if (fs.existsSync(filePath)) {
                try {
                    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    Object.entries(obj).forEach(([k, v]) => map.set(k, v));
                } catch (e) { logger.warn(`Load error ${filePath}: ${e.message}`); }
            }
        };
        const loadArr = (filePath, arr) => {
            if (fs.existsSync(filePath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (Array.isArray(data)) arr.push(...data);
                } catch (e) { logger.warn(`Load error ${filePath}: ${e.message}`); }
            }
        };
        loadMap(this._paths.vouchers, this._vouchers);
        loadMap(this._paths.users, this._users);
        loadMap(this._paths.wallets, this._wallets);
        loadMap(this._paths.plans, this._plans);
        loadMap(this._paths.mikrotik, this._mikrotik);
        loadArr(this._paths.transactions, this._transactions);
        loadArr(this._paths.audit, this._auditLog);
        logger.info(`Local DB: ${this._vouchers.size} vouchers, ${this._users.size} users, ${this._plans.size} plans`);
    }

    _saveLocal(key) {
        if (this.db) return;
        try {
            if (key === 'transactions') {
                fs.writeFileSync(this._paths.transactions, JSON.stringify(this._transactions, null, 2));
            } else if (key === 'audit') {
                fs.writeFileSync(this._paths.audit, JSON.stringify(this._auditLog, null, 2));
            } else {
                const map = this[`_${key}`];
                fs.writeFileSync(this._paths[key], JSON.stringify(Object.fromEntries(map), null, 2));
            }
        } catch (e) { logger.error(`Save error (${key}): ${e.message}`); }
    }

    _ts() {
        return this.db ? admin.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
    }

    _toDate(val) {
        if (!val) return new Date(0);
        if (typeof val === 'object' && val.toDate && typeof val.toDate === 'function') return val.toDate();
        if (typeof val === 'object' && val._seconds != null) return new Date(val._seconds * 1000);
        return new Date(val);
    }

    hashPlanId(name) {
        if (!name) return null;
        const fullHash = crypto.createHash('sha256').update(name.trim()).digest('hex');
        const shortHash = fullHash.substring(0, 16);
        logger.debug(`[PlanHash] name="${name}" -> full=${fullHash.substring(0, 8)}... short=${shortHash}`);
        return shortHash;
    }

    // ── Plans ─────────────────────────────────────────────────────────────────

    async _seedPlans() {
        for (const [planId, plan] of Object.entries(DEFAULT_PLANS)) {
            const ref = this.db.collection('plans').doc(planId);
            const doc = await ref.get();
            if (!doc.exists) {
                await ref.set({ ...plan, createdAt: this._ts() });
                logger.info(`Seeded plan: ${planId}`);
            }
        }
    }

    _seedPlansLocal() {
        for (const [planId, plan] of Object.entries(DEFAULT_PLANS)) {
            if (!this._plans.has(planId)) {
                this._plans.set(planId, { ...plan, createdAt: this._ts() });
            }
        }
        this._saveLocal('plans');
    }

    async getPlan(planId) {
        if (!planId) return null;

        logger.debug(`[Database] getPlan lookup: "${planId}"`);

        // 1. Try direct match (ID or Hash)
        if (this.db) {
            const doc = await this.db.collection('plans').doc(planId).get();
            if (doc.exists) return { id: doc.id, ...doc.data() };
        } else {
            const p = this._plans.get(planId);
            if (p) return { id: planId, ...p };
        }

        // 2. Try hashed match (if planId is a name)
        const hashedId = this.hashPlanId(planId);
        if (hashedId && hashedId !== planId) {
            if (this.db) {
                const hDoc = await this.db.collection('plans').doc(hashedId).get();
                if (hDoc.exists) return { id: hDoc.id, ...hDoc.data() };
            } else {
                const hp = this._plans.get(hashedId);
                if (hp) return { id: hashedId, ...hp };
            }
        }

        // 3. Try case-insensitive match from all plans
        const plans = await this.getPlans(false);
        const lowerId = planId.toLowerCase();

        // Match by ID/Key
        let found = plans.find(p => p.id && p.id.toLowerCase() === lowerId);
        if (found) return found;

        // Match by Name
        found = plans.find(p => p.name && p.name.toLowerCase() === lowerId);
        if (found) return found;

        // Match by MikroTik Profile alias mapping
        const aliasMap = {
            '1h': '1 Hour', '1hour': '1 Hour',
            '1d': '1 Day', '1day': '1 Day',
            '7d': '7 Days', '7day': '7 Days', '1w': '7 Days', '1week': '7 Days',
            '30d': '30 Days', '30day': '30 Days', '30days': '30 Days', '1m': '30 Days', '1month': '30 Days'
        };
        const mappedName = aliasMap[lowerId];
        if (mappedName) {
            const hashed = this.hashPlanId(mappedName);
            return this.getPlan(hashed);
        }

        return null;
    }

    async getPlans(activeOnly = true) {
        if (this.db) {
            let q = this.db.collection('plans');
            if (activeOnly) q = q.where('active', '==', true);
            const snap = await q.get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        return Array.from(this._plans.entries())
            .filter(([, v]) => !activeOnly || v.active)
            .map(([id, data]) => ({ id, ...data }));
    }

    async createPlan(planId, data) {
        const doc = { ...data, createdAt: this._ts(), active: data.active !== false };
        if (this.db) await this.db.collection('plans').doc(planId).set(doc);
        else { this._plans.set(planId, doc); this._saveLocal('plans'); }
        return { planId, ...doc };
    }

    async updatePlan(planId, updates) {
        if (this.db) { await this.db.collection('plans').doc(planId).update(updates); }
        else {
            const existing = this._plans.get(planId) || {};
            this._plans.set(planId, { ...existing, ...updates });
            this._saveLocal('plans');
        }
    }

    async deletePlan(planId) {
        if (this.db) await this.db.collection('plans').doc(planId).delete();
        else { this._plans.delete(planId); this._saveLocal('plans'); }
    }

    // ── Vouchers ──────────────────────────────────────────────────────────────

    async getVoucher(code) {
        if (this.db) {
            const doc = await this.db.collection('vouchers').doc(code).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        }
        const v = this._vouchers.get(code);
        return v ? { id: code, ...v } : null;
    }

    async createVoucher(code, data = {}) {
        if (!data.plan && (!data.durationUnit || data.durationValue == null)) {
            throw new Error('Voucher must have a plan or duration specified.');
        }

        const now = this._ts();
        const doc = {
            code,
            // ── Status ───────────────────────────────────────────────────────
            status: data.status || 'unused',   // unused | used | expired | revoked
            used: data.used || false,
            usedAt: data.usedAt || null,
            usedBy: data.usedBy || null,
            redeemedByUsername: data.redeemedByUsername || data.uid || null,
            // ── Plan / Duration ──────────────────────────────────────────────
            plan: data.plan || null,
            planName: data.planName || null,
            durationUnit: data.durationUnit || null,
            durationValue: data.durationValue != null ? Number(data.durationValue) : null,
            deviceLimit: data.deviceLimit != null ? Number(data.deviceLimit) : 1,
            // ── Financials ───────────────────────────────────────────────────
            value: data.value != null ? Number(data.value) : (data.amount != null ? Number(data.amount) : 0),
            currency: data.currency || 'USD',
            // ── Meta ─────────────────────────────────────────────────────────
            loginUrl: data.loginUrl || null,
            expiresAt: data.expiresAt || null,
            createdBy: data.createdBy || 'system',


            // ── New Redemption Object (compat with UniversalBilling) ─────────
            redemption: data.redemption || {
                used: data.used || false,
                usedAt: data.usedAt || null,
                usedBy: data.usedBy || null,
                remainingValue: data.value != null ? Number(data.value) : (data.amount != null ? Number(data.amount) : 0)
            }
        };
        if (this.db) await this.db.collection('vouchers').doc(code).set(doc, { merge: true });
        else { this._vouchers.set(code, doc); this._saveLocal('vouchers'); }
        return doc;
    }

    async updateVoucher(code, updates) {
        if (this.db) {
            await this.db.collection('vouchers').doc(code).update(updates);
        } else {
            const existing = this._vouchers.get(code) || {};
            this._vouchers.set(code, { ...existing, ...updates });
            this._saveLocal('vouchers');
        }
    }

    async saveVoucher(voucher) {
        // Alias for createVoucher used by UniversalBilling
        return this.createVoucher(voucher.code, voucher);
    }

    async redeemVoucher(code, userData = {}) {
        // userData: { userId, username, ip, mac, device, platform, deviceModel }
        const id = String(userData.userId || userData.uid || userData.username);
        let voucher;

        if (this.db) {
            const voucherRef = this.db.collection('vouchers').doc(code);
            const userRef = this.db.collection('users').doc(id);
            const walletRef = this.db.collection('wallets').doc(id);

            await this.db.runTransaction(async (t) => {
                const vDoc = await t.get(voucherRef);
                if (!vDoc.exists) throw new Error('Voucher not found');
                voucher = { id: vDoc.id, ...vDoc.data() };

                if (voucher.used || voucher.status === 'used') throw new Error('Voucher already used');
                if (voucher.expiresAt && new Date() > new Date(voucher.expiresAt)) throw new Error('Voucher expired');

                const val = Number(voucher.value || 0);
                const uDoc = await t.get(userRef);
                const wDoc = await t.get(walletRef);

                const currentBalance = wDoc.exists ? (wDoc.data().balance || 0) : (uDoc.exists ? (uDoc.data().credits || 0) : 0);
                const newBalance = currentBalance + val;

                const vUpdate = {
                    used: true,
                    usedAt: this._ts(),
                    usedBy: id,
                    status: 'used',
                    redeemedByUsername: userData.username || null,
                    redemption: {
                        used: true,
                        usedAt: this._ts(),
                        usedBy: id,
                        remainingValue: 0
                    }
                };

                const uUpdate = {
                    credits: newBalance,
                    lastSeen: this._ts(),
                    vouchersUsed: admin.firestore.FieldValue.arrayUnion(code),
                    ...(userData.platform && { platform: userData.platform }),
                    ...(userData.deviceModel && { deviceModel: userData.deviceModel }),
                    ...(userData.ip && { lastIP: userData.ip }),
                };

                const wUpdate = {
                    balance: newBalance,
                    currency: voucher.currency || 'USD',
                    lastUpdated: this._ts()
                };

                t.update(voucherRef, vUpdate);
                t.set(userRef, uUpdate, { merge: true });
                t.set(walletRef, wUpdate, { merge: true });

                // Create transaction record atomically
                const txId = `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                const txDoc = {
                    id: txId,
                    type: 'voucher_redeem',
                    voucherCode: code,
                    userId: id,
                    amount: val,
                    currency: voucher.currency || 'USD',
                    status: 'completed',
                    description: `Voucher ${code} redeemed for ${val} credits`,
                    timestamp: this._ts(),
                    createdAt: this._ts()
                };
                t.set(this.db.collection('transactions').doc(txId), txDoc);

                // Attach updated data to return object
                voucher = { ...voucher, ...vUpdate };
            });
        } else {
            voucher = await this.getVoucher(code);
            if (!voucher || voucher.used || voucher.status === 'used') throw new Error('Voucher is invalid or already used.');

            const val = Number(voucher.value || 0);
            const update = {
                used: true,
                usedAt: this._ts(),
                usedBy: id,
                status: 'used',
                redeemedByUsername: userData.username || null,
                redemption: {
                    used: true,
                    usedAt: this._ts(),
                    usedBy: id,
                    remainingValue: 0
                }
            };
            this._vouchers.set(code, { ...voucher, ...update });
            voucher = { ...voucher, ...update };

            const wallet = await this.getWallet(id);
            const newBalance = (wallet.balance || 0) + val;
            this._wallets.set(id, { ...wallet, balance: newBalance, lastUpdated: new Date().toISOString() });

            const u = this._users.get(id) || {};
            this._users.set(id, {
                ...u,
                credits: newBalance,
                lastSeen: this._ts(),
                vouchersUsed: [...(u.vouchersUsed || []), code],
                ...(userData.platform && { platform: userData.platform }),
                ...(userData.deviceModel && { deviceModel: userData.deviceModel }),
                ...(userData.ip && { lastIP: userData.ip }),
            });

            this._saveLocal('vouchers');
            this._saveLocal('wallets');
            this._saveLocal('users');

            await this.createTransaction({
                type: 'voucher_redeem',
                voucherCode: code,
                userId: id,
                amount: val,
                status: 'completed',
                description: `Voucher ${code} redeemed for ${val} credits`,
            });
        }

        await this.logAudit('voucher.redeem', id, { code, amount: voucher.value });
        return { success: true, value: voucher.value, voucher };
    }

    async revokeVoucher(code, reason = '') {
        const update = { status: 'revoked', revokedAt: new Date().toISOString(), revokeReason: reason };
        if (this.db) await this.db.collection('vouchers').doc(code).update(update);
        else {
            const v = this._vouchers.get(code);
            if (v) { this._vouchers.set(code, { ...v, ...update }); this._saveLocal('vouchers'); }
        }
    }

    async expireVoucher(code) {
        const update = { status: 'expired', expiredAt: new Date().toISOString() };
        if (this.db) await this.db.collection('vouchers').doc(code).update(update);
        else {
            const v = this._vouchers.get(code);
            if (v) { this._vouchers.set(code, { ...v, ...update }); this._saveLocal('vouchers'); }
        }

    async createVoucher(code, data = {}) {
            if (!data.plan && (!data.durationUnit || data.durationValue == null)) {
                throw new Error('Voucher must have a plan or value specified.');
            }

            const now = this._ts();
            const doc = {
                code,
                // ── Status ───────────────────────────────────────────────────────
                status: data.status || 'unused',   // unused | used | expired | revoked
                used: data.used || false,
                usedAt: data.usedAt || null,
                usedBy: data.usedBy || null,
                redeemedByUsername: data.redeemedByUsername || data.uid || null,
                // ── Plan / Duration ──────────────────────────────────────────────
                plan: data.plan || null,
                planName: data.planName || null,
                durationUnit: data.durationUnit || null,
                durationValue: data.durationValue != null ? Number(data.durationValue) : null,
                deviceLimit: data.deviceLimit != null ? Number(data.deviceLimit) : 1,
                // ── Financials ───────────────────────────────────────────────────
                value: data.value != null ? Number(data.value) : (data.amount != null ? Number(data.amount) : 0),
                currency: data.currency || 'USD',
                // ── Meta ─────────────────────────────────────────────────────────
                loginUrl: data.loginUrl || null,
                expiresAt: data.expiresAt || null,
                createdBy: data.createdBy || 'system',


                // ── New Redemption Object (compat with UniversalBilling) ─────────
                redemption: data.redemption || {
                    used: data.used || false,
                    usedAt: data.usedAt || null,
                    usedBy: data.usedBy || null,
                    remainingValue: data.value != null ? Number(data.value) : (data.amount != null ? Number(data.amount) : 0)
                }
            };
            if (this.db) await this.db.collection('vouchers').doc(code).set(doc, { merge: true });
            else {
                const { SQLiteDB } = require('./sqlite-db');
                this.sqlite.prepare('INSERT OR REPLACE INTO vouchers (code, status, used, usedAt, usedBy, redeemedByUsername, plan, planName, durationUnit, durationValue, deviceLimit, value, currency, loginUrl, expiresAt, createdBy, redemption, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(doc.code, doc.status, doc.used ? 1 : 0, doc.usedAt, doc.usedBy, doc.redeemedByUsername, doc.plan, doc.planName, doc.durationUnit, doc.durationValue, doc.deviceLimit, doc.value, doc.currency, doc.loginUrl, doc.expiresAt, doc.createdBy, SQLiteDB.toDB(doc.redemption), doc.createdAt || now);
            }
            return doc;
        }

    async updateVoucher(code, updates) {
            if (this.db) {
                await this.db.collection('vouchers').doc(code).update(updates);
            } else {
                const existing = await this.getVoucher(code);
                if (!existing) return;
                const updated = { ...existing, ...updates };
                const { SQLiteDB } = require('./sqlite-db');
                this.sqlite.prepare('INSERT OR REPLACE INTO vouchers (code, status, used, usedAt, usedBy, redeemedByUsername, plan, planName, durationUnit, durationValue, deviceLimit, value, currency, loginUrl, expiresAt, createdBy, redemption, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                    .run(updated.code, updated.status, updated.used ? 1 : 0, updated.usedAt, updated.usedBy, updated.redeemedByUsername, updated.plan, updated.planName, updated.durationUnit, updated.durationValue, updated.deviceLimit, updated.value, updated.currency, updated.loginUrl, updated.expiresAt, updated.createdBy, SQLiteDB.toDB(updated.redemption), updated.createdAt);
            }
    }

    async saveVoucher(voucher) {
                // Alias for createVoucher used by UniversalBilling
                return this.createVoucher(voucher.code, voucher);
            }

    async redeemVoucher(code, userData = {}) {
                // userData: { userId, username, ip, mac, device, platform, deviceModel }
                const id = String(userData.userId || userData.uid || userData.username);
                let voucher;

                if (this.db) {
                    const voucherRef = this.db.collection('vouchers').doc(code);
                    const userRef = this.db.collection('users').doc(id);
                    const walletRef = this.db.collection('wallets').doc(id);

                    await this.db.runTransaction(async (t) => {
                        const vDoc = await t.get(voucherRef);
                        if (!vDoc.exists) throw new Error('Voucher not found');
                        voucher = { id: vDoc.id, ...vDoc.data() };

                        if (voucher.used || voucher.status === 'used') throw new Error('Voucher already used');
                        if (voucher.expiresAt && new Date() > new Date(voucher.expiresAt)) throw new Error('Voucher expired');

                        const val = Number(voucher.value || 0);
                        const uDoc = await t.get(userRef);
                        const wDoc = await t.get(walletRef);

                        const currentBalance = wDoc.exists ? (wDoc.data().balance || 0) : (uDoc.exists ? (uDoc.data().credits || 0) : 0);
                        const newBalance = currentBalance + val;

                        const vUpdate = {
                            used: true,
                            usedAt: this._ts(),
                            usedBy: id,
                            status: 'used',
                            redeemedByUsername: userData.username || null,
                            redemption: {
                                used: true,
                                usedAt: this._ts(),
                                usedBy: id,
                                remainingValue: 0
                            }
                        };

                        const uUpdate = {
                            credits: newBalance,
                            lastSeen: this._ts(),
                            vouchersUsed: admin.firestore.FieldValue.arrayUnion(code),
                            ...(userData.platform && { platform: userData.platform }),
                            ...(userData.deviceModel && { deviceModel: userData.deviceModel }),
                            ...(userData.ip && { lastIP: userData.ip }),
                        };

                        const wUpdate = {
                            balance: newBalance,
                            currency: voucher.currency || 'USD',
                            lastUpdated: this._ts()
                        };

                        t.update(voucherRef, vUpdate);
                        t.set(userRef, uUpdate, { merge: true });
                        t.set(walletRef, wUpdate, { merge: true });

                        // Create transaction record atomically
                        const txId = `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                        const txDoc = {
                            id: txId,
                            type: 'voucher_redeem',
                            voucherCode: code,
                            userId: id,
                            amount: val,
                            currency: voucher.currency || 'USD',
                            status: 'completed',
                            description: `Voucher ${code} redeemed for ${val} credits`,
                            timestamp: this._ts(),
                            createdAt: this._ts()
                        };
                        t.set(this.db.collection('transactions').doc(txId), txDoc);

                        // Attach updated data to return object
                        voucher = { ...voucher, ...vUpdate };
                    });
                } else {
                    const { SQLiteDB } = require('./sqlite-db');

                    this.sqlite.transaction(() => {
                        voucher = this.sqlite.prepare('SELECT * FROM vouchers WHERE code = ?').get(code);
                        if (voucher) voucher = SQLiteDB.fromDB(voucher);

                        if (!voucher || voucher.used || voucher.status === 'used') throw new Error('Voucher is invalid or already used.');
                        if (voucher.expiresAt && new Date() > new Date(voucher.expiresAt)) throw new Error('Voucher expired');

                        const val = Number(voucher.value || 0);

                        // Update Voucher
                        const vUpdate = {
                            used: 1,
                            usedAt: this._ts(),
                            usedBy: id,
                            status: 'used',
                            redeemedByUsername: userData.username || null,
                            redemption: SQLiteDB.toDB({
                                used: true,
                                usedAt: this._ts(),
                                usedBy: id,
                                remainingValue: 0
                            })
                        };
                        this.sqlite.prepare('UPDATE vouchers SET used = ?, usedAt = ?, usedBy = ?, status = ?, redeemedByUsername = ?, redemption = ? WHERE code = ?')
                            .run(vUpdate.used, vUpdate.usedAt, vUpdate.usedBy, vUpdate.status, vUpdate.redeemedByUsername, vUpdate.redemption, code);

                        // Update Wallet
                        let wallet = this.sqlite.prepare('SELECT * FROM wallets WHERE id = ?').get(id);
                        if (wallet) wallet = SQLiteDB.fromDB(wallet);
                        const currentBalance = wallet ? (wallet.balance || 0) : 0;
                        const newBalance = currentBalance + val;

                        this.sqlite.prepare('INSERT OR REPLACE INTO wallets (id, balance, currency, lastUpdated) VALUES (?, ?, ?, ?)')
                            .run(id, newBalance, voucher.currency || 'USD', this._ts());

                        // Update User
                        let user = this.sqlite.prepare('SELECT * FROM users WHERE uid = ?').get(id);
                        if (user) user = SQLiteDB.fromDB(user);

                        const vouchersUsed = [...(user?.vouchersUsed || []), code];
                        this.sqlite.prepare('UPDATE users SET credits = ?, lastSeen = ?, vouchersUsed = ?, platform = COALESCE(?, platform), deviceModel = COALESCE(?, deviceModel), lastIP = COALESCE(?, lastIP) WHERE uid = ?')
                            .run(newBalance, this._ts(), SQLiteDB.toDB(vouchersUsed), userData.platform || null, userData.deviceModel || null, userData.ip || null, id);

                        // Create Transaction
                        const txId = `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                        this.sqlite.prepare('INSERT INTO transactions (id, type, userId, amount, currency, status, description, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
                            .run(txId, 'voucher_redeem', id, val, voucher.currency || 'USD', 'completed', `Voucher ${code} redeemed for ${val} credits`, SQLiteDB.toDB({ voucherCode: code }), this._ts());

                        voucher = { ...voucher, ...vUpdate, redemption: JSON.parse(vUpdate.redemption) };
                    })();
                }

                await this.logAudit('voucher.redeem', id, { code, amount: voucher.value });
                return { success: true, value: voucher.value, voucher };
            }

    async revokeVoucher(code, reason = '') {
                const update = { status: 'revoked', revokedAt: new Date().toISOString(), revokeReason: reason };
                if (this.db) await this.db.collection('vouchers').doc(code).update(update);
                else {
                    const v = this._vouchers.get(code);
                    if (v) { this._vouchers.set(code, { ...v, ...update }); this._saveLocal('vouchers'); }
                }
            }

    async expireVoucher(code) {
                const update = { status: 'expired', expiredAt: new Date().toISOString() };
                if (this.db) await this.db.collection('vouchers').doc(code).update(update);
                else {
                    const v = this._vouchers.get(code);
                    if (v) { this._vouchers.set(code, { ...v, ...update }); this._saveLocal('vouchers'); }
                }
            }

    async deleteVoucher(code) {
        if (this.db) await this.db.collection('vouchers').doc(code).delete();
        else { this._vouchers.delete(code); this._saveLocal('vouchers'); }
    }

    async getRecentVouchers(limit = 10) {
                if (this.db) {
                    // Avoid orderBy composite index requirement — fetch latest batch and sort in memory
                    const snap = await this.db.collection('vouchers').limit(limit * 3).get();
                    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    return all
                        .sort((a, b) => this._toDate(b.createdAt || 0) - this._toDate(a.createdAt || 0))
                        .slice(0, limit);
                }
                return Array.from(this._vouchers.entries())
                    .sort((a, b) => new Date(b[1].createdAt || 0) - new Date(a[1].createdAt || 0))
                    .slice(0, limit)
                    .map(([id, data]) => ({ id, ...data }));
            }

    /**
     * Filtered voucher listing for admin/reseller dashboards.
     * filters: { status, plan, createdBy, usedBy, limit }
     */
    async getVouchers(filters = {}) {
                const limit = filters.limit || 20;
                if (this.db) {
                    let q = this.db.collection('vouchers');
                    if (filters.status) q = q.where('status', '==', filters.status);
                    if (filters.plan) q = q.where('plan', '==', filters.plan);
                    if (filters.createdBy) q = q.where('createdBy', '==', String(filters.createdBy));
                    if (filters.usedBy) q = q.where('usedBy', '==', String(filters.usedBy));
                    const snap = await q.limit(limit * 2).get();
                    return snap.docs
                        .map(d => ({ id: d.id, ...d.data() }))
                        .sort((a, b) => this._toDate(b.createdAt || 0) - this._toDate(a.createdAt || 0))
                        .slice(0, limit);
                }
                let all = Array.from(this._vouchers.entries()).map(([id, data]) => ({ id, ...data }));
                if (filters.status) all = all.filter(v => v.status === filters.status);
                if (filters.plan) all = all.filter(v => v.plan === filters.plan);
                if (filters.createdBy) all = all.filter(v => String(v.createdBy) === String(filters.createdBy));
                if (filters.usedBy) all = all.filter(v => String(v.usedBy) === String(filters.usedBy));
                return all
                    .sort((a, b) => this._toDate(b.createdAt || 0) - this._toDate(a.createdAt || 0))
                    .slice(0, limit);
            }

    async getVouchersByStatus(status) {
                if (this.db) {
                    const snap = await this.db.collection('vouchers').where('status', '==', status).get();
                    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
                }
                return Array.from(this._vouchers.entries())
                    .filter(([, v]) => v.status === status)
                    .map(([id, data]) => ({ id, ...data }));
            }

    async getStats() {
                if (this.db) {
                    // Use count() aggregator if available, otherwise limited fetch
                    try {
                        const coll = this.db.collection('vouchers');
                        const total = (await coll.count().get()).data().count;
                        const used = (await coll.where('used', '==', true).count().get()).data().count;
                        const expired = (await coll.where('status', '==', 'expired').count().get()).data().count;
                        const revoked = (await coll.where('status', '==', 'revoked').count().get()).data().count;

                        return {
                            total,
                            used,
                            active: total - used - expired - revoked,
                            unused: total - used - expired - revoked,
                            expired,
                            revoked
                        };
                    } catch (e) {
                        logger.warn('Firestore count() failed, falling back to limited fetch:', e.message);
                        const snap = await this.db.collection('vouchers').limit(1000).get();
                        const all = snap.docs.map(d => d.data());
                        return this._calculateStats(all);
                    }
                }
                return this._calculateStats(Array.from(this._vouchers.values()));
            }

            _calculateStats(all) {
                return {
                    total: all.length,
                    used: all.filter(v => v.used || v.status === 'used' || v.redemption?.used).length,
                    active: all.filter(v => v.status === 'active').length,
                    unused: all.filter(v => !v.used && v.status !== 'expired' && v.status !== 'revoked').length,
                    expired: all.filter(v => v.status === 'expired').length,
                    revoked: all.filter(v => v.status === 'revoked').length,
                };
            }

    async countVouchers(filters = {}) {
                const all = await this.getVouchers({ ...filters, limit: 1000 });
                return all.length;
            }

    // ── Users ─────────────────────────────────────────────────────────────────
    //         deviceModel, role, credits, lastIP, lastSeen, createdAt,
    //         subscriptions [{ planId, planName, purchasedAt, expiresAt }],
    //         pendingNotification { code, message, title, type }

    async getUser(userId) {
        const id = String(userId);
        if (this.db) {
            // Avoid orderBy composite index requirement — fetch latest batch and sort in memory
            const snap = await this.db.collection('vouchers').limit(limit * 3).get();
            const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            return all
                .sort((a, b) => this._toDate(b.createdAt || 0) - this._toDate(a.createdAt || 0))
                .slice(0, limit);
        }
        return Array.from(this._vouchers.entries())
            .sort((a, b) => new Date(b[1].createdAt || 0) - new Date(a[1].createdAt || 0))
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));
    }

    /**
     * Filtered voucher listing for admin/reseller dashboards.
     * filters: { status, plan, createdBy, usedBy, limit }
     */
    async getVouchers(filters = {}) {
        const limit = filters.limit || 20;
        if (this.db) {
            let q = this.db.collection('vouchers');
            if (filters.status) q = q.where('status', '==', filters.status);
            if (filters.plan) q = q.where('plan', '==', filters.plan);
            if (filters.createdBy) q = q.where('createdBy', '==', String(filters.createdBy));
            if (filters.usedBy) q = q.where('usedBy', '==', String(filters.usedBy));
            const snap = await q.limit(limit * 2).get();
            return snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => this._toDate(b.createdAt || 0) - this._toDate(a.createdAt || 0))
                .slice(0, limit);
        }
        let all = Array.from(this._vouchers.entries()).map(([id, data]) => ({ id, ...data }));
        if (filters.status) all = all.filter(v => v.status === filters.status);
        if (filters.plan) all = all.filter(v => v.plan === filters.plan);
        if (filters.createdBy) all = all.filter(v => String(v.createdBy) === String(filters.createdBy));
        if (filters.usedBy) all = all.filter(v => String(v.usedBy) === String(filters.usedBy));
        return all
            .sort((a, b) => this._toDate(b.createdAt || 0) - this._toDate(a.createdAt || 0))
            .slice(0, limit);
    }

    async getVouchersByStatus(status) {
        if (this.db) {
            const snap = await this.db.collection('vouchers').where('status', '==', status).get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        return Array.from(this._vouchers.entries())
            .filter(([, v]) => v.status === status)
            .map(([id, data]) => ({ id, ...data }));
    }

    async getStats() {
        if (this.db) {
            // Use count() aggregator if available, otherwise limited fetch
            try {
                const coll = this.db.collection('vouchers');
                const total = (await coll.count().get()).data().count;
                const used = (await coll.where('used', '==', true).count().get()).data().count;
                const expired = (await coll.where('status', '==', 'expired').count().get()).data().count;
                const revoked = (await coll.where('status', '==', 'revoked').count().get()).data().count;

                return {
                    total,
                    used,
                    active: total - used - expired - revoked,
                    unused: total - used - expired - revoked,
                    expired,
                    revoked
                };
            } catch (e) {
                logger.warn('Firestore count() failed, falling back to limited fetch:', e.message);
                const snap = await this.db.collection('vouchers').limit(1000).get();
                const all = snap.docs.map(d => d.data());
                return this._calculateStats(all);
            }
        }
        return this._calculateStats(Array.from(this._vouchers.values()));
    }

    _calculateStats(all) {
        return {
            total: all.length,
            used: all.filter(v => v.used || v.status === 'used' || v.redemption?.used).length,
            active: all.filter(v => v.status === 'active').length,
            unused: all.filter(v => !v.used && v.status !== 'expired' && v.status !== 'revoked').length,
            expired: all.filter(v => v.status === 'expired').length,
            revoked: all.filter(v => v.status === 'revoked').length,
        };
    }

    async countVouchers(filters = {}) {
        const all = await this.getVouchers({ ...filters, limit: 1000 });
        return all.length;
    }

    // ── Users ─────────────────────────────────────────────────────────────────
    //         deviceModel, role, credits, lastIP, lastSeen, createdAt,
    //         subscriptions [{ planId, planName, purchasedAt, expiresAt }],
    //         pendingNotification { code, message, title, type }

    async getUser(userId) {
        const id = String(userId);
        if (this.db) {
            const doc = await this.db.collection('users').doc(id).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        }
        const u = this._users.get(id);
        return u ? { id, ...u } : null;
    }

    getUserDoc(userId) {
        const id = String(userId);
        if (this.db) {
            return this.db.collection('users').doc(id);
        }
        const self = this;
        return {
            id,
            path: `users/${id}`,
            get: async () => {
                const u = self._users.get(id);
                return {
                    id,
                    exists: !!u,
                    data: () => u || null,
                    ref: this
                };
            },
            set: async (data, options) => {
                const existing = self._users.get(id) || {};
                const merged = options?.merge ? { ...existing, ...data } : data;
                self._users.set(id, merged);
                self._saveLocal('users');
                return { id };
            },
            update: async (data) => {
                const existing = self._users.get(id);
                if (!existing) throw new Error('Document not found');
                self._users.set(id, { ...existing, ...data });
                self._saveLocal('users');
                return { id };
            },
            delete: async () => {
                self._users.delete(id);
                self._saveLocal('users');
                return { id };
            }
        };
    }

    async createUser(userId, data = {}) {
        const id = String(userId);
        const now = this._ts();
        const doc = {
            // ── Identity ─────────────────────────────────────────────────────
            uid: data.uid || id,
            username: data.username || null,
            fullname: data.fullname || data.firstName
                ? `${data.firstName || ''} ${data.lastName || ''}`.trim()
                : null,
            email: data.email || null,
            phoneNumber: data.phoneNumber || null,
            address: data.address || null,
            // ── Device / platform ────────────────────────────────────────────
            platform: data.platform || data.channel || 'unknown',  // telegram | whatsapp | web | app
            deviceModel: data.deviceModel || null,
            lastIP: data.lastIP || null,
            // ── Access control ───────────────────────────────────────────────
            role: data.role || 'user',   // user | admin | reseller
            credits: data.credits || 0,
            // ── Subscriptions ────────────────────────────────────────────────
            subscriptions: data.subscriptions || [],
            // ── Notifications ────────────────────────────────────────────────
            pendingNotification: {
                code: data.pendingNotification?.code || null,
                message: data.pendingNotification?.message || null,
                title: data.pendingNotification?.title || null,
                type: data.pendingNotification?.type || null,
            },
            // ── Timestamps ───────────────────────────────────────────────────
            createdAt: now,
            lastSeen: now,
        };
        if (this.db) await this.db.collection('users').doc(id).set(doc, { merge: true });
        else { this._users.set(id, doc); this._saveLocal('users'); }
        return doc;
    }

    async updateUser(userId, updates) {
        const id = String(userId);
        const safeUpdates = { ...updates, lastSeen: this._ts() };
        if (this.db) await this.db.collection('users').doc(id).set(safeUpdates, { merge: true });
        else {
            const existing = this._users.get(id) || {};
            this._users.set(id, { ...existing, ...safeUpdates });
            this._saveLocal('users');
        }
    }

    async getUserByUsername(username) {
        if (!username) return null;
        if (this.db) {
            const snap = await this.db.collection('users').where('username', '==', username).limit(1).get();
            return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
        return Array.from(this._users.values()).find(u => u.username === username) || null;
    }

    async getUserByPhone(phone) {
        if (!phone) return null;
        const cleanPhone = phone.trim();
        if (this.db) {
            const snap = await this.db.collection('users').where('phoneNumber', '==', cleanPhone).limit(1).get();
            return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
        return Array.from(this._users.values()).find(u => u.phoneNumber === cleanPhone) || null;
    }

    async getUserByEmail(email) {
        if (!email) return null;
        const cleanEmail = email.toLowerCase().trim();
        if (this.db) {
            const snap = await this.db.collection('users').where('email', '==', cleanEmail).limit(1).get();
            return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
        return Array.from(this._users.values()).find(u => u.email && u.email.toLowerCase().trim() === cleanEmail) || null;
    }

    async getUserByChannel(channel, channelId) {
        if (!channel || !channelId) return null;
        const idStr = String(channelId);
        if (this.db) {
            const snap = await this.db.collection('users').where(`channels.${channel}`, '==', idStr).limit(1).get();
            return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
        }
        return Array.from(this._users.values()).find(u => u.channels && String(u.channels[channel]) === idStr) || null;
    }

    async linkChannel(userId, channel, channelId) {
        if (!userId || !channel || !channelId) return false;
        const id = String(userId);
        const idStr = String(channelId);
        const update = { [`channels.${channel}`]: idStr };
        if (this.db) {
            await this.db.collection('users').doc(id).update(update);
        } else {
            const user = this._users.get(id);
            if (user) {
                user.channels = user.channels || {};
                user.channels[channel] = idStr;
                this._users.set(id, user);
                this._saveLocal('users');
            }
        }
        return true;
    }

    async resolveFirebaseUser(identifier, opts = {}) {
        if (!this.db || !identifier) return null;
        const id = String(identifier);

        let authRecord = null;
        try {
            if (id.includes('@')) {
                authRecord = await admin.auth().getUserByEmail(id);
            } else if (id.startsWith('+') || /^\d{7,15}$/.test(id)) {
                const phone = id.startsWith('+') ? id : `+${id}`;
                authRecord = await admin.auth().getUserByPhoneNumber(phone);
            } else if (/^[A-Za-z0-9]{20,}$/.test(id)) {
                authRecord = await admin.auth().getUser(id);
            } else {
                return null;
            }
        } catch (e) {
            if (e.code !== 'auth/user-not-found') {
                logger.debug(`[DB] resolveFirebaseUser(${id}): ${e.message}`);
            }
            return null;
        }

        if (!authRecord) return null;
        const uid = authRecord.uid;

        let firestoreUser = await this.getUser(uid);
        if (!firestoreUser) {
            firestoreUser = await this.createUser(uid, {
                uid,
                email:       authRecord.email       || null,
                phoneNumber: authRecord.phoneNumber  || null,
                fullname:    authRecord.displayName  || null,
                platform:    opts.channel            || 'firebase',
            });
            logger.info(`[DB] Created Firestore doc for Firebase uid:${uid}`);
        }

        if (opts.channel && opts.channelId && !firestoreUser.channels?.[opts.channel]) {
            await this.linkChannel(uid, opts.channel, opts.channelId);
            logger.info(`[DB] Linked ${opts.channel}:${opts.channelId} → uid:${uid}`);
        }

        return { ...firestoreUser, uid };
    }

    async getUsersByStatus(status) {
        const statuses = Array.isArray(status) ? status : [status];
        if (statuses.length === 0) return [];

        if (this.db) {
            const snapshot = await this.db.collection('users').where('status', 'in', statuses).get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        return Array.from(this._users.entries())
            .filter(([id, data]) => statuses.includes(data.status))
            .map(([id, data]) => ({ id, ...data }));
    }

    async resolveUser(identifier) {
        if (!identifier) return null;
        // 1. Try direct ID
        const byId = await this.getUser(identifier);
        if (byId) return byId;
        // 2. Try username
        const byUser = await this.getUserByUsername(identifier);
        if (byUser) return byUser;
        // 3. Try phone
        const byPhone = await this.getUserByPhone(identifier);
        if (byPhone) return byPhone;
        // 4. Try email
        const byEmail = await this.getUserByEmail(identifier);
        if (byEmail) return byEmail;

        // 5. Try all known channels for numeric chatIds
        if (/^\d+$/.test(identifier)) {
            const telegramUser = await this.getUserByChannel('telegram', identifier);
            if (telegramUser) return telegramUser;
            const whatsappUser = await this.getUserByChannel('whatsapp', identifier);
            if (whatsappUser) return whatsappUser;
        }

        // 6. Try Firebase Auth
        const byAuth = await this.resolveFirebaseUser(identifier);
        if (byAuth) return byAuth;

        return null;
    }

    async upsertUser(userId, data) {
        const existing = await this.getUser(userId);
        if (existing) { await this.updateUser(userId, data); return { ...existing, ...data }; }
        return this.createUser(userId, data);
    }

    /**
     * Update the subscriptions array for a user.
     * @param {string} userId
     * @param {{ planId, planName, purchasedAt?, expiresAt? }} sub
     */
    async updateSubscription(userId, sub = {}) {
        const id = String(userId);
        const now = this._ts();
        const newSubscription = {
            planId: sub.planId || null,
            planName: sub.planName || null,
            purchasedAt: sub.purchasedAt || now,
            expiresAt: sub.expiresAt || null,
        };
        if (this.db) {
            await this.db.collection('users').doc(id).set(
                {
                    subscriptions: admin.firestore.FieldValue.arrayUnion(newSubscription),
                    lastSeen: now
                },
                { merge: true }
            );
        } else {
            const u = this._users.get(id) || {};
            const subs = u.subscriptions || [];
            subs.push(newSubscription);
            this._users.set(id, { ...u, subscriptions: subs, lastSeen: now });
            this._saveLocal('users');
        }
        return newSubscription;
    }

    /**
     * Set a pending push notification on a user document.
     * @param {string} userId
     * @param {{ code, message, title, type }} notification
     */
    async setPendingNotification(userId, notification = {}) {
        const id = String(userId);
        const pendingNotification = {
            code: notification.code || null,
            message: notification.message || null,
            title: notification.title || null,
            type: notification.type || 'info',
        };
        if (this.db) {
            await this.db.collection('users').doc(id).set(
                { pendingNotification },
                { merge: true }
            );
        } else {
            const u = this._users.get(id) || {};
            this._users.set(id, { ...u, pendingNotification });
            this._saveLocal('users');
        }
        return pendingNotification;
    }

    /** Clear the pending notification after it has been delivered. */
    async clearPendingNotification(userId) {
        return this.setPendingNotification(userId, {});
    }

    async recordUserVoucher(userId, voucherCode) {
        const id = String(userId);
        if (this.db) {
            await this.db.collection('users').doc(id).set(
                { vouchersUsed: admin.firestore.FieldValue.arrayUnion(voucherCode), lastSeen: this._ts() },
                { merge: true }
            );
        } else {
            const u = this._users.get(id);
            if (u) {
                u.vouchersUsed = [...(u.vouchersUsed || []), voucherCode];
                this._users.set(id, u);
                this._saveLocal('users');
            }
        }
    }

    async getUsers(limit = 50) {
        if (this.db) {
            const snap = await this.db.collection('users').orderBy('lastSeen', 'desc').limit(limit).get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        return Array.from(this._users.entries()).slice(0, limit).map(([id, data]) => ({ id, ...data }));
    }

    // ── Transactions ──────────────────────────────────────────────────────────

    async createTransaction(data = {}) {
        const id = `tx_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
        const doc = {
            id,
            // ── Core schema ───────────────────────────────────────────────────
            amount: data.amount || 0,
            description: data.description || data.notes || '',
            planId: data.planId || data.plan || null,
            planName: data.planName || null,
            timestamp: this._ts(),
            type: data.type || 'voucher_purchase', // voucher_purchase | voucher_redeem | wallet_topup | refund
            userId: data.userId || data.usedBy || null,

            // ── Operational / Extra fields ────────────────────────────────────
            voucherCode: data.voucherCode || null,
            currency: data.currency || 'USD',
            status: data.status || 'pending',  // pending | completed | failed | refunded
            paymentRef: data.paymentRef || null,
            provider: data.provider || null,
            redeemedBy: data.redeemedBy || null,       // { ip, mac, device } if redemption
            createdBy: data.createdBy || 'system',
            createdAt: this._ts(),                     // Legacy compat
        };
        if (this.db) await this.db.collection('transactions').doc(id).set(doc);
        else { this._transactions.push(doc); this._saveLocal('transactions'); }
        return doc;
    }

    async updateTransaction(txId, updates) {
        if (this.db) await this.db.collection('transactions').doc(txId).update(updates);
        else {
            const idx = this._transactions.findIndex(t => t.id === txId);
            if (idx !== -1) { this._transactions[idx] = { ...this._transactions[idx], ...updates }; this._saveLocal('transactions'); }
        }
    }

    async getTransactions(limit = 50, filters = {}) {
        if (this.db) {
            let q = this.db.collection('transactions');
            if (filters.userId) q = q.where('userId', '==', String(filters.userId));
            if (filters.status) q = q.where('status', '==', filters.status);
            if (filters.type) q = q.where('type', '==', filters.type);

            const snap = await q.limit(limit * 2).get(); // Fetch more to ensure we have recent ones after sort
            const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            return results
                .sort((a, b) => this._toDate(b.createdAt || b.timestamp || 0) - this._toDate(a.createdAt || a.timestamp || 0))
                .slice(0, limit);
        }
        let txs = [...this._transactions];
        if (filters.userId) txs = txs.filter(t => String(t.userId) === String(filters.userId));
        if (filters.status) txs = txs.filter(t => t.status === filters.status);
        if (filters.type) txs = txs.filter(t => t.type === filters.type);
        return txs.sort((a, b) => this._toDate(b.createdAt || b.timestamp || 0) - this._toDate(a.createdAt || a.timestamp || 0)).slice(0, limit);
    }

    async getRevenue(period = 'daily') {
        const now = new Date();
        let start = new Date();

        if (period === 'daily') start.setHours(0, 0, 0, 0);
        else if (period === 'weekly') {
            const day = start.getDay();
            const diff = start.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            start.setDate(diff);
            start.setHours(0, 0, 0, 0);
        } else if (period === 'monthly') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
        }

        const startISO = start.toISOString();

        if (this.db) {
            const snap = await this.db.collection('transactions')
                .where('status', '==', 'completed')
                .where('createdAt', '>=', startISO)
                .get();

            let total = 0;
            snap.docs.forEach(d => {
                const data = d.data();
                const amount = Number(data.amount || 0);
                // Only count positive "money-in" transactions (Topups or Direct Purchases)
                // Internal wallet debits are negative and should be ignored for Gross Revenue
                if (amount > 0 && (data.type === 'wallet_topup' || data.type === 'voucher_purchase')) {
                    total += amount;
                }
            });
            return { total, count: snap.docs.filter(d => d.data().amount > 0).length, period };
        }

        const txs = this._transactions.filter(t =>
            t.status === 'completed' &&
            t.createdAt >= startISO &&
            t.amount > 0 &&
            (t.type === 'wallet_topup' || t.type === 'voucher_purchase')
        );

        const total = txs.reduce((acc, t) => acc + Number(t.amount || 0), 0);
        return { total, count: txs.length, period };
    }

    // ── Wallets ───────────────────────────────────────────────────────────────

    async getWallet(userId) {
        const id = String(userId);
        if (this.db) {
            const doc = await this.db.collection('wallets').doc(id).get();
            if (doc.exists) return { id: doc.id, ...doc.data() };
            // Fallback: check if user exists and has credits
            const user = await this.getUser(id);
            return { id, balance: user?.credits || 0, currency: 'USD' };
        }
        const w = this._wallets.get(id);
        return w ? { id, ...w } : { id, balance: 0, currency: 'USD' };
    }

    async updateWallet(userId, amount, currency = 'USD', reason = '', skipTransaction = false) {
        const id = String(userId);
        let updatedWallet;

        if (this.db) {
            const walletRef = this.db.collection('wallets').doc(id);
            const userRef = this.db.collection('users').doc(id);

            await this.db.runTransaction(async (t) => {
                const wDoc = await t.get(walletRef);
                const uDoc = await t.get(userRef);

                // Fallback: check legacy credits on user object if wallet is missing
                const currentBalance = wDoc.exists
                    ? (wDoc.data().balance || 0)
                    : (uDoc.exists ? (uDoc.data().credits || 0) : 0);

                const newBalance = currentBalance + amount;

                updatedWallet = {
                    balance: newBalance,
                    currency,
                    lastUpdated: this._ts()
                };

                t.set(walletRef, updatedWallet, { merge: true });
                t.set(userRef, { credits: newBalance, lastSeen: this._ts() }, { merge: true });

                // Create transaction record atomically within the same transaction
                if (!skipTransaction) {
                    const txId = `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                    const txDoc = {
                        id: txId,
                        type: amount >= 0 ? 'wallet_topup' : 'wallet_debit',
                        userId: id,
                        amount,
                        currency,
                        status: 'completed',
                        description: reason,
                        timestamp: this._ts(),
                        createdAt: this._ts()
                    };
                    t.set(this.db.collection('transactions').doc(txId), txDoc);
                }
            });
        } else {
            const wallet = this._wallets.get(id) || { balance: 0, currency: 'USD' };
            const newBalance = (wallet.balance || 0) + amount;
            updatedWallet = { balance: newBalance, currency, lastUpdated: new Date().toISOString() };
            this._wallets.set(id, updatedWallet);

            const u = this._users.get(id) || {};
            this._users.set(id, { ...u, credits: newBalance, lastSeen: this._ts() });

            this._saveLocal('wallets');
            this._saveLocal('users');

            if (!skipTransaction) {
                await this.createTransaction({
                    type: amount >= 0 ? 'wallet_topup' : 'wallet_debit',
                    userId: id,
                    amount,
                    currency,
                    status: 'completed',
                    description: reason
                });
            }
        }

        await this.logAudit(amount >= 0 ? 'wallet.update' : 'wallet.deduct', id, { amount, reason });
        return updatedWallet;
    }

    async deductCredits(userId, amount, reason = 'Voucher Purchase') {
        const id = String(userId);
        let newBalance;

        if (this.db) {
            const walletRef = this.db.collection('wallets').doc(id);
            const userRef = this.db.collection('users').doc(id);

            await this.db.runTransaction(async (t) => {
                const wDoc = await t.get(walletRef);
                const uDoc = await t.get(userRef);

                // Fallback: check legacy credits on user object if wallet is missing
                const currentBalance = wDoc.exists
                    ? (wDoc.data().balance || 0)
                    : (uDoc.exists ? (uDoc.data().credits || 0) : 0);

                if (currentBalance < amount) {
                    throw new Error(`Insufficient credits. Balance: ${currentBalance}, Required: ${amount}`);
                }

                newBalance = currentBalance - amount;
                const update = { balance: newBalance, lastUpdated: this._ts() };

                t.set(walletRef, update, { merge: true });
                t.set(userRef, { credits: newBalance }, { merge: true });

                // Create transaction record atomically
                const txId = `TX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                const txDoc = {
                    id: txId,
                    type: 'voucher_purchase',
                    userId: id,
                    amount: -amount,
                    status: 'completed',
                    description: reason,
                    timestamp: this._ts(),
                    createdAt: this._ts()
                };
                t.set(this.db.collection('transactions').doc(txId), txDoc);
            });
        } else {
            const wallet = await this.getWallet(id);
            const currentBalance = wallet.balance || 0;

            if (currentBalance < amount) {
                throw new Error(`Insufficient credits. Balance: ${currentBalance}, Required: ${amount}`);
            }

            newBalance = currentBalance - amount;
            const update = { balance: newBalance, lastUpdated: this._ts() };

            this._wallets.set(id, update);
            const u = this._users.get(id) || {};
            this._users.set(id, { ...u, credits: newBalance });
            this._saveLocal('wallets');
            this._saveLocal('users');

            await this.createTransaction({
                type: 'voucher_purchase',
                userId: id,
                amount: -amount,
                status: 'completed',
                description: reason
            });
        }

        await this.logAudit('wallet.deduct', id, { amount, newBalance, reason });
        return { success: true, newBalance };
    }

    async p2pTransfer(fromUserId, toUserId, amount, currency = 'USD', reason = 'P2P Transfer') {
        if (amount <= 0) throw new Error('Transfer amount must be positive');
        const fromId = String(fromUserId);
        const toId = String(toUserId);

        if (fromId === toId) throw new Error('Cannot transfer to self');

        // Execute as a single Firestore transaction for atomicity
        if (this.db) {
            const fromRef = this.db.collection('wallets').doc(fromId);
            const toRef = this.db.collection('wallets').doc(toId);
            const fromUserRef = this.db.collection('users').doc(fromId);
            const toUserRef = this.db.collection('users').doc(toId);

            await this.db.runTransaction(async (t) => {
                const fromDoc = await t.get(fromRef);
                const toDoc = await t.get(toRef);

                const fromBalance = fromDoc.exists ? (fromDoc.data().balance || 0) : 0;
                const toBalance = toDoc.exists ? (toDoc.data().balance || 0) : 0;

                if (fromBalance < amount) throw new Error('Insufficient balance for transfer');

                t.set(fromRef, { balance: fromBalance - amount, lastUpdated: this._ts() }, { merge: true });
                t.set(toRef, { balance: toBalance + amount, lastUpdated: this._ts() }, { merge: true });
                t.set(fromUserRef, { credits: fromBalance - amount }, { merge: true });
                t.set(toUserRef, { credits: toBalance + amount }, { merge: true });
            });
        } else {
            const fromWallet = this._wallets.get(fromId) || { balance: 0 };
            const toWallet = this._wallets.get(toId) || { balance: 0 };

            if ((fromWallet.balance || 0) < amount) throw new Error('Insufficient balance');

            this._wallets.set(fromId, { ...fromWallet, balance: fromWallet.balance - amount });
            this._wallets.set(toId, { ...toWallet, balance: toWallet.balance + amount });

            const fu = this._users.get(fromId) || {};
            const tu = this._users.get(toId) || {};
            this._users.set(fromId, { ...fu, credits: fromWallet.balance - amount });
            this._users.set(toId, { ...tu, credits: toWallet.balance + amount });

            this._saveLocal('wallets');
            this._saveLocal('users');
        }

        await this.logAudit('wallet.transfer', fromId, { toUserId: toId, amount, reason });

        await this.createTransaction({
            type: 'p2p_transfer',
            userId: fromId,
            toUserId: toId,
            amount: amount,
            currency: currency,
            status: 'completed',
            description: reason
        });

        return { success: true, fromUserId, toUserId, amount };
    }

    // ── Audit Log ─────────────────────────────────────────────────────────────

    async logAudit(eventType, actor, payload = {}) {
        const timestamp = new Date().toISOString();
        const hash = crypto.createHash('sha256')
            .update(JSON.stringify({ eventType, actor, payload, timestamp }))
            .digest('hex');
        const entry = { eventType, actor, payload, hash, timestamp };
        if (this.db) await this.db.collection('audit_log').add(entry);
        else { this._auditLog.push(entry); this._saveLocal('audit'); }
        return hash;
    }

    async getAuditLog(limit = 50) {
        if (this.db) {
            const snap = await this.db.collection('audit_log').orderBy('timestamp', 'desc').limit(limit).get();
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        return [...this._auditLog]
            .sort((a, b) => this._toDate(b.timestamp) - this._toDate(a.timestamp))
            .slice(0, limit);
    }

    // ── MikroTik ──────────────────────────────────────────────────────────────

    async getMikrotikState(id = 'default') {
        if (this.db) {
            const doc = await this.db.collection('mikrotik').doc(id).get();
            return doc.exists ? { id: doc.id, ...doc.data() } : null;
        }
        const state = this._mikrotik.get(id);
        return state ? { id, ...state } : null;
    }

    async updateMikrotikState(id, state) {
        const doc = {
            ...state,
            updatedAt: this._ts(),
            lastUpdate: this._ts() // parity with frontend
        };
        if (this.db) {
            await this.db.collection('mikrotik').doc(id).set(doc, { merge: true });
        } else {
            const existing = this._mikrotik.get(id) || {};
            this._mikrotik.set(id, { ...existing, ...doc });
            this._saveLocal('mikrotik');
        }
        return { id, ...doc };
    }

    async getHotspotUsers(limit = 100) {
        if (this.db) {
            const snapshot = await this.db.collection('users').where('isHotspotUser', '==', true).orderBy('createdAt', 'desc').limit(limit).get();
            if (snapshot.empty) return this.getUsers(limit);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }
        return Array.from(this._users.entries())
            .filter(([id, data]) => data.isHotspotUser)
            .sort((a, b) => this._toDate(b[1].createdAt || 0) - this._toDate(a[1].createdAt || 0))
            .slice(0, limit)
            .map(([id, data]) => ({ id, ...data }));
    }

    async close() {
        try {
            if (admin.apps && admin.apps.length > 0) {
                await Promise.all(admin.apps.map(app => app ? app.delete() : Promise.resolve()));
            }
            this.db = null;
            this.isInitialized = false;
            instance = null;
            initPromise = null;
            logger.info('Database: Connections closed');
        } catch (err) {
            logger.error(`Database close error: ${err.message}`);
        }
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let instance = null;
let initPromise = null;

async function getDatabase() {
    if (instance) return instance;
    if (!initPromise) {
        initPromise = Promise.resolve().then(() => {
            instance = new Database();
            return instance;
        });
    }
    return initPromise;
}

module.exports = { getDatabase, DEFAULT_PLANS };
