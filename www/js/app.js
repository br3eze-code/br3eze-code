
/* ==========================================================
   FILE: app.js
   DESCRIPTION: Main Logic, Firebase, Offline Caching
   ========================================================== */

// Normally provided by chat.js (loaded first); fallback so chat rendering
// never dies on a missing sanitizer.
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function (text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
}

/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.
 */


let connectionInterval = null;
let timerInterval = null;
window.authCheckComplete = false;

/*  =====  AI INTEGRATION BRIDGE  =====  */
const AIBridge = {
    async getRecommendation(context) {
        if (!window.aiOrchestrator) return null;
        const prompt = `User context: ${JSON.stringify(context)}. Recommend next action.`;
        return await window.aiOrchestrator.generateText(prompt);
    },

    async analyzeUsage(stats) {
        if (!window.aiOrchestrator) return null;
        const prompt = `Usage: ${stats.consumed}MB of ${stats.total}MB. Suggest optimization.`;
        return await window.aiOrchestrator.generateText(prompt);
    },

    async shouldUpgrade(userProfile) {
        if (!window.ContextManager || !window.NanoAI) return false;
        const vector = await window.ContextManager.getNeuralVector();
        const decision = await window.NanoAI.decide(vector);
        return decision === 'ONBOARD_USER' || decision === 'ACTIVATE_VOUCHER';
    },

    async executeAIAdvise() {
        if (window.aiOrchestrator && window.aiOrchestrator.executeDecision) {
            await window.aiOrchestrator.executeDecision();
        }
    }
};
window.AIBridge = AIBridge;

/*  =====  GLOBAL UTILITIES  =====  */
window.openModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.classList.add('active');
};

window.closeModal = function (id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove('active');
};

window.escapeHtml = function (text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

const Subscriptions = {
    user: null,
    plans: null,
    tickets: null,
    ticketsAdmin: null,
    transactions: null,
    allUsers: null,
    allTransactions: null,
    allVouchers: null,
    partnerNetworks: null,
    networkSettings: null,

    unsubscribeAll() {
        if (this.user) { this.user(); this.user = null; }
        if (this.plans) { this.plans(); this.plans = null; }
        if (this.tickets) { this.tickets(); this.tickets = null; }
        if (this.ticketsAdmin) { this.ticketsAdmin(); this.ticketsAdmin = null; }
        if (this.transactions) { this.transactions(); this.transactions = null; }
        if (this.allUsers) { this.allUsers(); this.allUsers = null; }
        if (this.allTransactions) { this.allTransactions(); this.allTransactions = null; }
        if (this.allVouchers) { this.allVouchers(); this.allVouchers = null; }
        if (this.partnerNetworks) { this.partnerNetworks(); this.partnerNetworks = null; }
        if (this.networkSettings) { this.networkSettings(); this.networkSettings = null; }
    }
};

const AppData = {
    plans: [],
    transactions: [], // Personal
    allTransactions: [], // Admin
    tickets: [],
    users: [],
    vouchers: [],
    partnerNetworks: []
};

/*  =====  SHARED LOGIC  =====  */
function checkSubscriptionStatus(sub, user = null, enforceBinding = false) {
    if (!sub) return false;
    const now = Date.now();

    // 1. Time Check
    // Handle both Firestore Timestamp (seconds) and direct integers if optimized later
    const expiresMs = sub.expiresAt && sub.expiresAt.seconds ? sub.expiresAt.seconds * 1000 : 0;
    if (expiresMs <= now) return false;

    // 2. Data Check
    if (sub.dataLimit > 0) {
        const consumed = sub.dataConsumed || 0;
        if (consumed >= sub.dataLimit) return false;
    }

    // 3. Device Binding Check (Optional)
    if (enforceBinding && user && sub.deviceLimit > 0) {
        let currentDeviceId = 'Unknown';
        // Try to get device ID from global scope or Cordova plugin
        if (typeof device !== 'undefined') currentDeviceId = device.uuid;

        if (user.deviceId && user.deviceId !== 'Unknown' && user.deviceId !== currentDeviceId && user.role === 'user') {
            console.warn(`[Binding] Device mismatch: Plan Owner ${user.deviceId} vs Current ${currentDeviceId}`);
            // Verification failed
            return false;
        }
    }

    return true;
}

/*  =====  ONE-PLAN GUARD  =====  */
function hasActivePlanNow() {
    if (!currentUser) return false;

    // Bypass for Staff/Family: Always treat as having an active plan for UI purposes
    if (currentUser.role === 'admin' || currentUser.role === 'family') return true;

    if (!currentUser.subscriptions) return false;
    // We do NOT strictly enforce binding here for simple UI checks to avoid flickering, 
    // but the backend/gatekeeper will enforce it.

    return currentUser.subscriptions.some(s => checkSubscriptionStatus(s));
}

/*  =====  PLAN CALCULATORS  =====  */
function calcExpiresAt(unit, amount) {
    const now = new Date();
    const result = new Date(now);

    switch (unit) {
        case 'minutes': return new Date(now.getTime() + amount * 60 * 1000);
        case 'hours': return new Date(now.getTime() + amount * 60 * 60 * 1000);
        case 'days': return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
        case 'weeks': return new Date(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
        case 'months': {
            result.setMonth(result.getMonth() + amount);
            if (result.getDate() !== now.getDate()) {
                result.setDate(0);
            }
            return result;
        }
        default: return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
    }
}

/* ===== TIME FORMATTER (With Seconds) ===== */
function formatTimeLeft(ms) {
    if (ms <= 0) return 'Expired';

    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((ms % (1000 * 60)) / 1000);

    let str = '';
    if (days > 0) str += `${days}d `;
    str += `${String(hours).padStart(2, '0')}h `;
    str += `${String(minutes).padStart(2, '0')}m `;
    str += `${String(seconds).padStart(2, '0')}s`;

    return str;
}

/*  =====  TIMER & PROGRESS BAR LOGIC  =====  */
async function startPlanTimer() {
    stopPlanTimer();
    updateTimerUI(); // Run immediately
    timerInterval = setInterval(updateTimerUI, 1000);
}

function updateTimerUI(subArg = null, overrideStatus = null) {
    const sub = subArg || getActiveSubscription();
    const statusEl = document.getElementById('dashUptime');
    const barEl = document.getElementById('planProgressBar');
    const startLabel = document.getElementById('planStartLabel');
    const endLabel = document.getElementById('planEndLabel');

    // 0. Override / Unlimited Status (Admin/Family)
    if (overrideStatus) {
        if (statusEl) statusEl.innerHTML = `<span class="status-active-indicator" style="color:var(--color-success-text); font-weight:bold;">●</span> ${overrideStatus}`;
        if (barEl) {
            barEl.style.width = '100%';
            barEl.style.backgroundColor = 'var(--color-success)';
        }
        if (startLabel) startLabel.textContent = '∞';
        if (endLabel) endLabel.textContent = '∞';

        // Ensure timer is stopped since we have a static status
        stopPlanTimer();
        return;
    }

    // 1. No Active Plan
    if (!sub) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger-text)">Inactive</span>`;
        if (barEl) barEl.style.width = '0%';
        if (startLabel) startLabel.textContent = '--';
        if (endLabel) endLabel.textContent = '--';
        stopPlanTimer();
        return;
    }

    const now = Date.now();
    const end = sub.expiresAt.seconds * 1000;
    const start = sub.purchasedAt ? sub.purchasedAt.seconds * 1000 : (end - (24 * 60 * 60 * 1000));

    const totalDuration = end - start;
    const timeLeft = end - now;

    // 2. Expired Plan
    if (timeLeft <= 0) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-danger-text)">Expired</span>`;
        if (barEl) barEl.style.width = '0%';
        stopPlanTimer();

        // Trigger generic disconnect check safely
        if (window.NetworkTools && window.NetworkTools.guardHotspot) {
            window.NetworkTools.guardHotspot();
        }
        return;
    }

    // 3. Active Plan
    if (statusEl) {
        // Check if we have Wifi Info from NetworkTools
        const wifiName = window.NetworkTools && window.NetworkTools.lastKnownSSID
            ? `(${window.NetworkTools.lastKnownSSID})`
            : '';

        let dataInfo = '';
        if (sub.dataLimit > 0) {
            const consumed = sub.dataConsumed || 0;
            dataInfo = ` &bull; Data: ${consumed.toFixed(2)}/${sub.dataLimit}GB`;
        }

        statusEl.innerHTML = `<span class="status-active-indicator" style="color:var(--color-success-text); font-weight:bold;">●</span> Online ${wifiName} &bull; ${formatTimeLeft(timeLeft)}${dataInfo}`;

        // TRIGGER SMART ALERTS
        if (typeof SmartNotification !== 'undefined') {
            SmartNotification.checkPlanHealth(sub, timeLeft);
        }

        // AI INSIGHTS TRIGGER
        const nowMs = Date.now();
        if (window.AIBridge && Math.random() < 0.1) {
            const lastHint = window.lastAIHintTime || 0;
            if (nowMs - lastHint > 1800000) { // 30 minutes
                AIBridge.analyzeUsage({
                    consumed: sub.dataConsumed || 0,
                    total: sub.dataLimit || 0
                }).then(suggestion => {
                    if (suggestion && suggestion.length > 5 && !suggestion.includes("limited AI")) {
                        window.lastAIHintTime = Date.now();
                        if (window.showToast) showToast(`💡 AI Insight: ${suggestion}`, 'info');
                    }
                });
            }
        }
    }

    // Progress Bar
    const timePercentage = Math.max(0, Math.min(100, (timeLeft / totalDuration) * 100));
    let dataPercentage = 100;
    if (sub.dataLimit > 0) {
        const consumed = sub.dataConsumed || 0;
        dataPercentage = Math.max(0, Math.min(100, ((sub.dataLimit - consumed) / sub.dataLimit) * 100));
    }

    const percentage = Math.min(timePercentage, dataPercentage);

    if (barEl) {
        barEl.style.width = `${percentage}%`;

        // Color Logic
        if (percentage < 10) barEl.style.backgroundColor = 'var(--color-danger)';
        else if (percentage < 30) barEl.style.backgroundColor = '#ffaa00'; // Orange
        else barEl.style.backgroundColor = 'var(--color-success)';
    }

    // Date Labels
    if (startLabel) startLabel.textContent = new Date(start).toLocaleDateString();
    if (endLabel) endLabel.textContent = new Date(end).toLocaleDateString();
}

const SmartNotification = {
    history: {
        lastDataWarning: 0,
        lastExpiryWarning: 0,
        lastTicketId: null
    },

    checkPlanHealth(sub, timeLeftMs) {
        if (!sub) return;

        // 1. Expiration Warning (1 Hour remain)
        if (timeLeftMs > 0 && timeLeftMs < 60 * 60 * 1000) {
            this.trigger('EXPIRY_WARN', '⏳ Plan Expiring Soon', 'You have less than 1 hour of internet time left.');
        }

        // 2. Data Low Warning (80% used)
        if (sub.dataLimit > 0) {
            const consumed = sub.dataConsumed || 0;
            const percentageUsed = (consumed / sub.dataLimit) * 100;

            if (percentageUsed >= 80 && percentageUsed < 100) {
                this.trigger('DATA_WARN', '📊 Data Running Low', `You have used ${percentageUsed.toFixed(0)}% of your data plan.`);
            }
        }
    },

    trigger(type, title, text) {
        const now = Date.now();
        const COOLDOWN = 12 * 60 * 60 * 1000; // 12 hours cooldown for warnings

        if (type === 'EXPIRY_WARN') {
            if (now - this.history.lastExpiryWarning < COOLDOWN) return;
            this.history.lastExpiryWarning = now;
        }

        if (type === 'DATA_WARN') {
            if (now - this.history.lastDataWarning < COOLDOWN) return;
            this.history.lastDataWarning = now;
        }

        // Use global wrapper from index.js
        if (typeof sendNotification === 'function') {
            sendNotification(title, text, 101);
            showToast(title, 'info'); // Also show toast if app is open
        }
    }
};

function stopPlanTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function getActiveSubscription() {
    if (!currentUser || !currentUser.subscriptions) return null;
    return currentUser.subscriptions.find(s => checkSubscriptionStatus(s));
}

/*  =====  HELPERS & CALCULATORS  =====  */
//const Firebasekeys = import.meta.env.FIREBASE_API_KEY;
/*  =====  FIREBASE CONFIG  =====  */
const firebaseConfig = {
    apiKey: window.ENV.FIREBASE_API_KEY,
    authDomain: "br3eze-africa-312df.firebaseapp.com",
    databaseURL: "https://br3eze-africa-312df-default-rtdb.firebaseio.com",
    projectId: "br3eze-africa-312df",
    storageBucket: "br3eze-africa-312df.firebasestorage.app",
    messagingSenderId: "123902078923",
    appId: "1:123902078923:web:1153a45add9fe25208504e",
    measurementId: "G-Y6YS53B86S"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = typeof firebase !== 'undefined' ? firebase.auth() : null;
const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;
const storage = typeof firebase !== 'undefined' ? firebase.storage() : null;
window.currentUser = null;


// --- ENABLE OFFLINE PERSISTENCE ---
// synchronizeTabs lets multiple open tabs share one IndexedDB persistence
// layer instead of the second tab failing with 'failed-precondition' and
// silently dropping to memory-only cache.
if (db) {
    db.enablePersistence({ synchronizeTabs: true })
        .catch((err) => {
            if (err.code == 'failed-precondition') {
                console.warn('[Firestore] Persistence unavailable (another tab owns it) — using memory cache.');
            } else if (err.code == 'unimplemented') {
                console.warn('[Firestore] Persistence not supported by this browser — using memory cache.');
            }
        });
}

/*  =====  AUTH ACTIONS  =====  */
const Auth = {
    async login(loginIdentifier, password) {
        if (!navigator.onLine) showToast('Offline. Trying local cache...', 'warning');
        window.Loading.show('Logging in...');
        try {
            let email = loginIdentifier.toLowerCase();
            if (!loginIdentifier.includes('@')) {
                try {
                    const resolved = await DataStore.resolveLoginEmail(loginIdentifier);
                    if (resolved && resolved.email) email = resolved.email;
                    else throw new Error("User not found. Try logging in with your email.");
                }
                catch (e) {
                    // If username lookup failed offline, we can't proceed
                    if (!navigator.onLine) throw new Error("Offline: Please login with Email.");
                    throw e;
                }
            }
            await auth.signInWithEmailAndPassword(email, password);
        } catch (e) {
            window.Loading.hide();
            showToast(e.message, 'error');
        }
    },
    async signup(email, password, fullname, username, confirmPassword, phoneNumber) {
        if (password !== confirmPassword) return showToast('Passwords do not match', 'error');
        const normalizedPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';

        // Capture device ID
        let deviceId = 'Unknown';
        if (typeof device !== 'undefined') deviceId = device.uuid;
        else if (window.crypto && window.crypto.randomUUID) deviceId = 'WEB-' + crypto.randomUUID().substring(0, 8);

        if (!navigator.onLine) {
            // OFFLINE SIGNUP: Create Mesh Profile
            window.Loading.show('Creating Mesh Profile...');
            const meshUser = {
                uid: 'MESH-' + (await CryptoUtils.hash(username + Date.now())).substring(0, 8),
                email,
                fullname,
                username,
                phoneNumber: normalizedPhone,
                role: 'user',
                credits: 0.00,
                subscriptions: [],
                deviceId: deviceId,
                isMesh: true,
                passwordHash: await CryptoUtils.hash(password), // Store hashed locally
                createdAt: Date.now()
            };
            meshUser.id = meshUser.uid; // Ensure compatibility with id-based checks

            localStorage.setItem('mesh_profile', JSON.stringify(meshUser));
            if (typeof GossipService !== 'undefined') {
                GossipService.queueMeshSignup(meshUser);
            }

            showToast('Mesh Profile created! Relaying to cloud...', 'success');
            // Auto-login locally as mesh user
            window.currentUser = meshUser;
            window.Loading.hide();
            showMainApp();
            return;
        }

        window.Loading.show('Creating account...');
        try {
            const normalizedUsername = username.toLowerCase();
            const existingLookup = await db.collection('lookups').doc('username:' + normalizedUsername).get();
            if (existingLookup.exists) return showToast('Username is already taken.', 'error');
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            const newUserProfile = {
                uid: user.uid,
                email: user.email,
                fullname,
                username: username.toLowerCase(),
                phoneNumber: normalizedPhone,
                hotspotPass: password, // Save for MikroTik captive portal sync
                role: 'user',
                credits: 0.00,
                subscriptions: [],
                deviceId: deviceId,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            await db.collection('users').doc(user.uid).set(newUserProfile);
            await DataStore.writeLoginLookups(newUserProfile).catch(e => console.warn('Lookup write failed:', e));
            window.Loading.hide();
            showToast('Account created!', 'success');
        } catch (e) {
            window.Loading.hide();
            showToast(e.message, 'error');
        }
    },
    async logout() {
        window.Loading.show('Signing out...');
        if (window.GossipService) window.GossipService.stop();
        if (window.NetworkTools) {
            window.NetworkTools.stopConnectionMonitoring();
            window.NetworkTools.stopTrafficAccounting();
        }
        await auth.signOut();
        Subscriptions.unsubscribeAll();
        // Reset AppData
        AppData.plans = [];
        AppData.transactions = [];
        AppData.tickets = [];
        AppData.users = [];

        window.Loading.hide();
        showToast('Logged out', 'info');
        window.authCheckComplete = true;
        if (window.NetworkTools && window.NetworkTools.cleanup) window.NetworkTools.cleanup();
    },
    async loginWithGoogle() {
        window.Loading.show('Signing in with Google...');
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            const { user } = await auth.signInWithPopup(provider);
            const existing = await db.collection('users').doc(user.uid).get();
            if (!existing.exists) {
                const newProfile = {
                    uid: user.uid,
                    email: user.email,
                    fullname: user.displayName || user.email,
                    username: (user.email || user.uid).split('@')[0].toLowerCase(),
                    photoURL: user.photoURL || '',
                    role: 'user',
                    credits: 10.00, // Welcome bonus
                    subscriptions: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection('users').doc(user.uid).set(newProfile);
                await DataStore.writeLoginLookups(newProfile).catch(e => console.warn('Lookup write failed:', e));
            } else if (user.photoURL && existing.data().photoURL !== user.photoURL) {
                // Keep the profile photo in sync with the Google account.
                await db.collection('users').doc(user.uid).update({ photoURL: user.photoURL });
            }
        } catch (e) {
            window.Loading.hide();
            if (e.code !== 'auth/popup-closed-by-user') showToast(e.message, 'error');
        }
    }
};

/*  =====  DATA STORE  =====  */
const DataStore = {
    getCurrentUserId() {
        return (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
    },
    getFirewallBlockSync() {
        // Placeholder for real firewall status check
        return false;
    },
    async get(key) {
        try {
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : null;
        } catch (e) { return null; }
    },
    async set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { console.error("DataStore Set Error", e); }
    },
    async getUser(uid) {
        const doc = await db.collection('users').doc(uid).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },
    subscribeToUser(uid, callback) {
        return db.collection('users').doc(uid).onSnapshot(doc => {
            const data = doc.exists ? { id: doc.id, ...doc.data() } : null;
            callback(data);
        }, error => console.error("User Sub Error:", error));
    },
    async findUser(identifier) {
        if (!identifier) return null;
        const id = identifier.trim();

        // 1. Try by exact ID
        const doc = await db.collection('users').doc(id).get();
        if (doc.exists) return { id: doc.id, ...doc.data() };

        // 2. Try by Email
        const emailSnap = await db.collection('users').where('email', '==', id).limit(1).get();
        if (!emailSnap.empty) return { id: emailSnap.docs[0].id, ...emailSnap.docs[0].data() };

        // 3. Try by Username
        const userSnap = await db.collection('users').where('username', '==', id.toLowerCase()).limit(1).get();
        if (!userSnap.empty) return { id: userSnap.docs[0].id, ...userSnap.docs[0].data() };

        // 4. Try by Phone Number (digits-only, matches how phoneNumber is stored)
        const digits = id.replace(/\D/g, '');
        if (digits.length >= 7) {
            const phoneUser = await this.getUserByPhone(digits);
            if (phoneUser) return phoneUser;
        }

        return null;
    },
    async getUserByUsername(username) {
        const snap = await db.collection('users').where('username', '==', username.toLowerCase()).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },
    // Pre-auth login resolution via the public-get 'lookups' collection --
    // querying 'users' before sign-in is (correctly) denied by the rules.
    async resolveLoginEmail(identifier) {
        const id = identifier.trim().toLowerCase();
        const keys = ['username:' + id];
        const digits = id.replace(/\D/g, '');
        if (digits.length >= 7) keys.push('phone:' + digits);
        for (const key of keys) {
            const doc = await db.collection('lookups').doc(key).get();
            if (doc.exists && doc.data().email) return doc.data();
        }
        return null;
    },
    async writeLoginLookups(profile) {
        if (!profile || !profile.uid || !profile.email) return;
        const data = { uid: profile.uid, email: profile.email };
        if (profile.username) data.username = profile.username.toLowerCase();
        const batch = db.batch();
        if (profile.username) batch.set(db.collection('lookups').doc('username:' + profile.username.toLowerCase()), data);
        batch.set(db.collection('lookups').doc('email:' + profile.email.toLowerCase()), data);
        const digits = (profile.phoneNumber || '').replace(/\D/g, '');
        if (digits.length >= 7) batch.set(db.collection('lookups').doc('phone:' + digits), data);
        await batch.commit();
    },
    // Resolve another account (P2P transfers etc.) without querying 'users',
    // which the rules only allow admins to search.
    async resolveRecipient(identifier) {
        const id = identifier.trim().toLowerCase();
        const keys = [];
        if (id.includes('@')) keys.push('email:' + id);
        else {
            keys.push('username:' + id);
            const digits = id.replace(/\D/g, '');
            if (digits.length >= 7) keys.push('phone:' + digits);
        }
        for (const key of keys) {
            const doc = await db.collection('lookups').doc(key).get();
            if (doc.exists && doc.data().uid) {
                const d = doc.data();
                return { id: d.uid, uid: d.uid, username: d.username || identifier, email: d.email };
            }
        }
        // Admins can still search the users collection directly.
        try { return await this.findUser(identifier); } catch (e) { return null; }
    },
    async getUserByPhone(phoneNumber) {
        if (!phoneNumber) return null;
        const normalized = phoneNumber.replace(/\D/g, ''); // Remove non-digits
        const snap = await db.collection('users').where('phoneNumber', '==', normalized).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },
    async getAllUsers() {
        const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    subscribeToAllUsers(callback) {
        return db.collection('users').orderBy('createdAt', 'desc').onSnapshot(snap => {
            const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            callback(users);
        }, error => console.error("All Users Sub Error:", error));
    },
    async updateUser(uid, data) {
        await db.collection('users').doc(uid).update(data);
    },
    async getPlans() {
        try {
            const snap = await db.collection('plans').orderBy('price').get();
            const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (plans.length > 0) localStorage.setItem('cached_plans', JSON.stringify(plans));
            return plans;
        } catch (e) {
            console.warn("Using LocalStorage Plans Fallback");
            const cached = localStorage.getItem('cached_plans');
            return cached ? JSON.parse(cached) : [];
        }
    },
    subscribeToPlans(callback) {
        return db.collection('plans').orderBy('price').onSnapshot(snap => {
            const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            if (plans.length > 0) localStorage.setItem('cached_plans', JSON.stringify(plans));
            callback(plans);
        }, error => console.error("Plans Sub Error:", error));
    },
    async savePlan(planId, data) {
        planId
            ? await db.collection('plans').doc(planId).set(data, { merge: true })
            : await db.collection('plans').add(data);
    },
    async deletePlan(planId) {
        await db.collection('plans').doc(planId).delete();
    },
    async getTickets() {
        let q = db.collection('tickets');
        if (currentUser && currentUser.role !== 'admin') {
            q = q.where('userId', '==', currentUser.id);
        } else {
            q = q.orderBy('lastUpdate', 'desc');
        }
        const snap = await q.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    subscribeToTickets(callback) {
        let q = db.collection('tickets');
        if (currentUser && currentUser.role !== 'admin') {
            q = q.where('userId', '==', currentUser.id);
        }
        return q.onSnapshot(snap => {
            const tickets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Always sort client-side to avoid index requirements for mixed queries
            tickets.sort((a, b) => (b.lastUpdate?.seconds || 0) - (a.lastUpdate?.seconds || 0));
            callback(tickets);
        }, error => {
            console.error("Tickets Sub Error:", error);
        });
    },
    async addTicket(ticketData) {
        const ref = await db.collection('tickets').add(ticketData);
        return ref.id;
    },
    async getTicketReplies(ticketId) {
        const snap = await db.collection('tickets').doc(ticketId)
            .collection('replies')
            .orderBy('timestamp', 'asc')
            .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async sendTicketReply(ticketId, messageData) {
        const batch = db.batch();
        const replyRef = db.collection('tickets').doc(ticketId).collection('replies').doc();
        batch.set(replyRef, {
            ...messageData,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        const ticketRef = db.collection('tickets').doc(ticketId);
        batch.update(ticketRef, {
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
    },
    async updateTicketStatus(ticketId, status) {
        await db.collection('tickets').doc(ticketId).update({
            status,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        });
    },
    async hasActivePlan(uid) {
        if (!uid) return false;
        try {
            const user = await this.getUser(uid);
            if (!user || !user.subscriptions) return false;
            return user.subscriptions.some(s => checkSubscriptionStatus(s, user, true));
        } catch (e) {
            console.warn("hasActivePlan error:", e);
            return false;
        }
    },
    async getNetworkSettings(uid = null) {
        let masterConfig;
        let partnerNetworks = [];

        try {
            const fetchPromise = db.collection('settings').doc('network').get();
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));

            const d = await Promise.race([fetchPromise, timeoutPromise]);

            if (d.exists) {
                masterConfig = d.data();
                localStorage.setItem('cached_wifi_ssid', masterConfig.ssid);
                localStorage.setItem('cached_wifi_pass', masterConfig.password);
            } else {
                throw new Error("No config");
            }

            // Fetch Partner WiFi Networks (Roaming Bucket)
            const partnerSnap = await db.collection('partnerNetworks').where('active', '==', true).get();
            partnerNetworks = partnerSnap.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            localStorage.setItem('cached_partner_networks', JSON.stringify(partnerNetworks));

        } catch (e) {
            console.warn("Offline/DB Error, using LocalStorage fallback for Wi-Fi");
            const ssid = localStorage.getItem('cached_wifi_ssid') || 'Power-HotSpot';
            const pass = localStorage.getItem('cached_wifi_pass') || 'PowerHotspotPass';
            masterConfig = { ssid: ssid, password: pass };

            // Try cached partner networks
            try {
                partnerNetworks = JSON.parse(localStorage.getItem('cached_partner_networks') || '[]');
            } catch { partnerNetworks = []; }
        }

        if (!uid && typeof currentUser !== 'undefined' && currentUser) uid = currentUser.id;
        if (!uid) {
            return {
                ssid: masterConfig.ssid,
                password: masterConfig.password,
                accessGranted: false,
                partnerNetworks: []
            };
        }

        const planActive = await this.hasActivePlan(uid).catch(() => false);
        const isAdmin = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'admin');
        const isPartner = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'partner');
        const isFamily = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === 'family');

        // 🔥 EDGE GUARD POLICY: guardhotspot = edgepolicy & hasplan
        // Admins and Partners bypass policy for management. 
        // Regular users must have an active plan AND pass EdgePolicy enforcement.
        const policyPassed = await window.EdgePolicy?.enforce(uid).catch(() => true) ?? true;

        if ((planActive && policyPassed) || isAdmin || isPartner || isFamily) {
            return {
                ...masterConfig,
                accessGranted: true,
                partnerNetworks: partnerNetworks // Return freshly fetched partner networks
            };
        } else {
            // No plan or failed policy -> Deny
            return {
                ssid: masterConfig.ssid,
                password: "EXP_" + Date.now(),
                accessGranted: false,
                reason: !planActive ? "No active plan" : "Edge Policy restriction",
                partnerNetworks: []
            };
        }
    },

    // Partner WiFi Management
    async addPartnerNetwork(data) {
        return await db.collection('partnerNetworks').add({
            ...data,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            active: true
        });
    },

    async getPartnerNetworks(partnerId = null) {
        let query = db.collection('partnerNetworks');
        if (partnerId) {
            query = query.where('partnerId', '==', partnerId);
        }
        const snap = await query.get();
        const networks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Sort client-side to avoid index requirement for composite query
        networks.sort((a, b) => {
            const dateA = a.createdAt?.seconds || 0;
            const dateB = b.createdAt?.seconds || 0;
            return dateB - dateA;
        });
        
        return networks;
    },

    async updatePartnerNetwork(networkId, data) {
        await db.collection('partnerNetworks').doc(networkId).update(data);
    },

    async deletePartnerNetwork(networkId) {
        await db.collection('partnerNetworks').doc(networkId).delete();
    },

    // Partner Usage Logging & Stats
    async logConnection(networkId, partnerId, userId) {
        try {
            await db.collection('usageLogs').add({
                networkId,
                partnerId,
                userId,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            console.error('Error logging connection:', e);
        }
    },

    async getPartnerUsageStats(partnerId) {
        const snap = await db.collection('usageLogs')
            .where('partnerId', '==', partnerId)
            .get();
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        // Sort client-side to avoid manual composite index requirement
        logs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
        
        return logs;
    },

    subscribeToPartnerNetworks(callback) {
        return db.collection('partnerNetworks').where('active', '==', true).onSnapshot(snap => {
            const networks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            callback(networks);
        }, error => console.error("Partner Networks Sync Error:", error));
    },

    async updateNetworkSettings(data) {
        await db.collection('settings').doc('network').set(data, { merge: true });
        localStorage.setItem('cached_wifi_ssid', data.ssid);
        localStorage.setItem('cached_wifi_pass', data.password);
    },
    async addTransaction(data) {
        await db.collection('transactions').add({ ...data, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
    },
    async getTransactionsForUser(userId) {
        const snap = await db.collection('transactions').where('userId', '==', userId).get();
        const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        txs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
        return txs;
    },
    subscribeToTransactions(userId, callback) {
        return db.collection('transactions').where('userId', '==', userId).onSnapshot(snap => {
            const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            txs.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
            callback(txs);
        }, error => console.error("Transactions Sub Error:", error));
    },
    async getAllTransactions() {
        const snap = await db.collection('transactions').orderBy('timestamp', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    subscribeToAllTransactions(callback) {
        return db.collection('transactions').orderBy('timestamp', 'desc').onSnapshot(snap => {
            const txs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            callback(txs);
        }, error => console.error("All Trans Sub Error:", error));
    },
    async getVoucher(code) {
        const snap = await db.collection('vouchers').where('code', '==', code.toUpperCase()).limit(1).get();
        return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
    },
    async getAllVouchers() {
        const snap = await db.collection('vouchers').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    subscribeToAllVouchers(callback) {
        return db.collection('vouchers').orderBy('createdAt', 'desc').onSnapshot(snap => {
            const vouchers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            callback(vouchers);
        }, error => console.error("All Vouchers Sub Error:", error));
    },
    async sendSystemMessage(userId, subject, body, senderName = null) {
        if (!senderName) senderName = currentUser?.fullname || 'System Support';

        // Unified Communication Hub Integration
        if (window.CommunicationHub && userId === currentUser?.id) {
            window.CommunicationHub.addSystemNotification(subject, body);
        }

        try {
            // Keep legacy ticket for server-side persistence if online
            if (navigator.onLine) {
                const ticketData = {
                    userId,
                    userEmail: senderName,
                    subject: subject,
                    body: body,
                    status: 'Archived',
                    isSystemMessage: true,
                    lastUpdate: firebase.firestore.FieldValue.serverTimestamp(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                await db.collection('tickets').add(ticketData);
            }
        } catch (e) {
            console.error("System message error:", e);
        }
    },

    subscribeToNetworkSettings(callback) {
        return db.collection('settings').doc('network').onSnapshot((doc) => {
            if (doc.exists) {
                callback(doc.data());
            }
        }, (err) => {
            console.error("Network settings subscription error:", err);
        });
    },
    async getAdminStats() {
        // Aggregate high-level stats for Chatbot Intelligence
        try {
            // Parallel fetches for speed
            const usersP = db.collection('users').get();
            const plansP = db.collection('plans').get();
            const vouchersP = db.collection('vouchers').where('used', '==', true).get();

            const [usersSnap, plansSnap, usedVouchersSnap] = await Promise.all([usersP, plansP, vouchersP]);

            const totalUsers = usersSnap.size;
            const totalPlans = plansSnap.size;
            const totalRedeemed = usedVouchersSnap.size;

            // Calculate approximate revenue (client-side sum is expensive, doing simple estimate)
            let revenueEstimate = 0;
            usedVouchersSnap.forEach(doc => {
                revenueEstimate += (doc.data().value || 0);
            });

            return {
                totalUsers,
                totalPlans,
                totalRedeemed,
                revenueEstimate: revenueEstimate.toFixed(2)
            };
        } catch (e) {
            console.error('Stats Error:', e);
            return { error: 'Stats unavailable' };
        }
    },

    async getPendingOperations() {
        console.log("[DataStore] Fetching pending operations...");
        const meshSignups = await this.get('mesh_signup_queue') || [];
        const transactions = await this.get('offline_transactions') || [];

        return [
            ...meshSignups.map(s => ({ type: 'USER_SIGNUP', payload: s })),
            ...transactions.map(t => ({ type: 'TRANSACTION', payload: t }))
        ];
    },

    async performSync(ops) {
        for (const op of ops) {
            try {
                if (op.type === 'USER_SIGNUP') {
                    await db.collection('users').doc(op.payload.uid).set(op.payload, { merge: true });
                    // Remove from queue
                    const queue = await this.get('mesh_signup_queue') || [];
                    const filtered = queue.filter(u => u.uid !== op.payload.uid);
                    await this.set('mesh_signup_queue', filtered);
                } else if (op.type === 'TRANSACTION') {
                    await db.collection('transactions').add({
                        ...op.payload,
                        syncedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    // Remove from queue
                    const txs = await this.get('offline_transactions') || [];
                    const filtered = txs.filter(t => t.id !== op.payload.id);
                    await this.set('offline_transactions', filtered);
                }
                console.log(`✅ [Sync] Successfully synced ${op.type}`);
            } catch (e) {
                console.error(`❌ [Sync] Failed to sync ${op.type}:`, e);
            }
        }
    },
    async setUserNotification(uid, data) {
        await db.collection('users').doc(uid).update({ pendingNotification: data });
    },
    async shareCredit(recipientIdx, amount) {
        console.log(`Attempting to share ${amount} credits with ${recipientIdx}`);
        if (!currentUser) throw new Error("Not logged in");
        if (amount <= 0) throw new Error("Invalid amount");
        if (currentUser.credits < amount) throw new Error("Insufficient funds");

        // 1. Find Recipient (Flexible: Email, Username, or Phone via lookups)
        let recipient = await this.resolveRecipient(recipientIdx);
        if (!recipient) {
            throw new Error("Recipient not found. Please check the username or email.");
        }
        if (recipient.id === currentUser.id || recipient.uid === currentUser.uid) {
            throw new Error("Cannot send credits to yourself.");
        }

        // 2. Transaction
        const batch = db.batch();

        // Decrement Sender
        batch.update(db.collection('users').doc(currentUser.id), {
            credits: firebase.firestore.FieldValue.increment(-amount)
        });

        // Increment Recipient
        batch.update(db.collection('users').doc(recipient.id), {
            credits: firebase.firestore.FieldValue.increment(amount)
        });

        // Create Transaction Records
        const now = firebase.firestore.FieldValue.serverTimestamp();

        // Record for Sender
        const txSender = db.collection('transactions').doc();
        batch.set(txSender, {
            userId: currentUser.id,
            type: 'transfer_out',
            description: `Sent to ${recipient.username}`,
            amount: -amount,
            timestamp: now
        });

        // Record for Recipient
        const txRecipient = db.collection('transactions').doc();
        batch.set(txRecipient, {
            userId: recipient.id,
            type: 'transfer_in',
            description: `Received from ${currentUser.username}`,
            amount: amount,
            timestamp: now
        });

        if (!navigator.onLine && typeof OfflineOrchestrator !== 'undefined') {
            console.log("Offline Mode: Queuing credit share and broadcasting to mesh.");
            OfflineOrchestrator.queueOperation({
                type: 'UPDATE_CREDITS',
                uid: currentUser.id,
                amount: -amount
            });
            OfflineOrchestrator.queueOperation({
                type: 'UPDATE_CREDITS',
                uid: recipient.id,
                amount: amount
            });
            
            // Adjust local state immediately for UX
            currentUser.credits -= amount;
        } else {
            // Online: Commit batch to Firebase
            await batch.commit();
        }

        // Notify recipient AFTER the money has moved -- these writes target the
        // recipient's ticket/user doc, which the rules may deny us, so they are
        // best-effort and must never abort a committed transfer.
        try {
            await this.sendSystemMessage(recipient.id, `Transfer Received`, `You received $${amount.toFixed(2)} from ${currentUser.fullname || currentUser.username}.`, currentUser.fullname || currentUser.username);
            await this.setUserNotification(recipient.id, {
                type: 'voucher',
                title: 'Credits Received',
                message: `You received $${amount.toFixed(2)} from ${currentUser.username}`,
                code: 'TRANSFER'
            });
        } catch (e) {
            console.warn('Transfer succeeded but recipient notification failed:', e);
        }

        // Broadcast to Mesh for offline recipient
        if (typeof GossipService !== 'undefined') {
            GossipService.broadcastCreditSync(recipient.id, amount);
        }

        return recipient;
    }
};

async function needsDisconnect() {
    if (!currentUser) return false;

    // Bypass for Staff/Family: Never disconnect them
    if (currentUser.role === 'admin' || currentUser.role === 'family') return false;

    // Use the comprehensive hasActivePlanNow logic
    const hasActive = hasActivePlanNow();
    return (currentUser.credits <= 0 && !hasActive);
}

function toggleAuthForm() {
    document.getElementById('loginForm').classList.toggle('hidden');
    document.getElementById('signupForm').classList.toggle('hidden');
}

function toggleDropdown(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.toggle('active'); // Assuming CSS handles .active display:block
        // Fallback for simple display toggle if no CSS class
        if (!el.classList.contains('user-dropdown')) { // Safety check
            el.style.display = el.style.display === 'block' ? 'none' : 'block';
        }
    }
}
window.toggleDropdown = toggleDropdown;
window.Auth = Auth;

function showAuthScreen() {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('mainHeader').style.display = 'none';
    if (typeof Loading !== 'undefined') window.Loading.hide();
}

async function showMainApp() {
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    document.getElementById('mainHeader').style.display = 'flex';

    // Initialize standard views
    showSection('home');
    updateNavbar();
    updateDashboard();

    if (typeof Loading !== 'undefined') window.Loading.hide();
}

/*  =====  APP INIT  =====  */
document.addEventListener('DOMContentLoaded', () => {
    const authElem = document.getElementById('authScreen');
    const appElem = document.getElementById('mainApp');

    // Ensure hidden initially (though CSS does this)
    if (authElem) authElem.style.display = 'none';
    if (appElem) appElem.style.display = 'none';

    // Safety fallback: If nothing happens in 5 seconds, show Auth screen
    setTimeout(() => {
        if (authElem.style.display === 'none' && appElem.style.display === 'none') {
            console.warn("App initialization timeout. Forcing Auth Screen.");
            if (typeof Loading !== 'undefined') window.Loading.hide();
            authElem.style.display = 'flex';
        }
    }, 5000);

    if (typeof auth === 'undefined') {
        console.error("Firebase 'auth' not defined. Scripts may have failed to load.");
        if (authElem) authElem.style.display = 'flex';
        if (typeof showToast === 'function') showToast("Core Unavailable: Firebase missing", "error");
        return;
    }

    if (typeof Loading !== 'undefined') window.Loading.show('Starting up...');

    if (auth) {
        auth.onAuthStateChanged(async user => {
            if (user) {
                try {
                    currentUser = await DataStore.getUser(user.uid);

                    if (!currentUser) {
                        console.log('Profile not found yet, waiting for DB creation...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        currentUser = await DataStore.getUser(user.uid);
                    }

                    if (currentUser) {
                        // Self-heal login lookups so this account can sign in
                        // by username/phone next time (see DataStore.writeLoginLookups).
                        DataStore.writeLoginLookups(currentUser).catch(() => {});
                        await showMainApp();
                        setTimeout(() => maybePromptNotificationPermission(), 3000);
                        setTimeout(() => maybePromptLocationPermission(), 9000);
                        setTimeout(() => {
                            if (typeof window.captureLocalDeviceInfo === 'function') {
                                window.captureLocalDeviceInfo();
                            }
                        }, 2000);
                    } else {
                        if (navigator.onLine) Auth.logout();
                        else showToast("Offline: Profile unavailable.", "warning");
                        window.Loading.hide();
                    }
                } catch (e) {
                    console.error("Profile Load Error", e);
                    window.Loading.hide();
                    if (!navigator.onLine) showToast("Offline Mode Active", "info");
                }
            } else {
                currentUser = null;
                window.Loading.hide();
                showAuthScreen();
            }
            window.authCheckComplete = true;
        });
    }

    // Form Listeners
    if (document.getElementById('loginFormElement')) {
        document.getElementById('loginFormElement').addEventListener('submit', e => {
            e.preventDefault();
            Auth.login(document.getElementById('loginIdentifier').value, document.getElementById('loginPassword').value);
        });
    }
    if (document.getElementById('signupFormElement')) {
        document.getElementById('signupFormElement').addEventListener('submit', e => {
            e.preventDefault();
            Auth.signup(
                document.getElementById('signupEmail').value,
                document.getElementById('signupPassword').value,
                document.getElementById('signupFullname').value,
                document.getElementById('signupUsername').value,
                document.getElementById('signupConfirmPassword').value,
                document.getElementById('signupPhoneNumber')?.value
            );
        });
    }

    document.getElementById('newTicketForm')?.addEventListener('submit', submitNewTicket);
    document.getElementById('adminUserForm')?.addEventListener('submit', saveAdminUser);
    document.getElementById('adminPlanForm')?.addEventListener('submit', saveAdminPlan);
    document.getElementById('adminNetworkForm')?.addEventListener('submit', saveNetworkSettings);
    document.getElementById('redeemVoucherForm')?.addEventListener('submit', redeemVoucher);
    document.getElementById('generateVoucherForm')?.addEventListener('submit', generateVouchers);
    document.getElementById('updateProfileForm')?.addEventListener('submit', handleUpdateProfile);
    document.getElementById('changePasswordForm')?.addEventListener('submit', handleChangePassword);
    document.getElementById('shareCreditForm')?.addEventListener('submit', async e => {
        e.preventDefault();
        const ident = document.getElementById('shareRecipientIdentifier').value.trim();
        const amt = parseFloat(document.getElementById('shareAmount').value);

        if (!ident || amt <= 0) return showToast("Invalid input", 'error');

        window.Loading.show('Sending credits...');
        try {
            const recipient = await DataStore.shareCredit(ident, amt);
            closeModal('shareCreditModal');
            showToast(`Sent $${amt.toFixed(2)} to ${recipient.fullname || recipient.username}`, 'success');
            // UI updates automatically via listener
        } catch (err) {
            console.error("Share Credit Failure:", err);
            showToast(err.message, 'error');
        } finally {
            window.Loading.hide();
        }
    });
    document.getElementById('sendVoucherForm')?.addEventListener('submit', sendVoucherToUser);

    // File Attachment Logic
    document.getElementById('chatFileInput')?.addEventListener('change', function (e) {
        if (this.files && this.files.length > 0) {
            const count = this.files.length;
            const names = Array.from(this.files).map(f => f.name).join(', ');
            showToast(`${count} file(s) attached: ${names}`, 'info');
            // Logic to include in next message
            window.attachedFiles = Array.from(this.files);
        }
    });
});

const chatInput = document.getElementById('chatInput');
const actionBtn = document.getElementById('chatActionBtn');
const chatForm = document.getElementById('chatForm');

if (chatInput && actionBtn) {
    const icon = actionBtn.querySelector('i');

    // 1. Monitor Input for changes
    const updateButtonState = () => {
        const hasText = chatInput.value.trim().length > 0;

        if (hasText) {
            // Switch to Send Arrow
            if (actionBtn.classList.contains('mode-mic')) {
                actionBtn.classList.remove('mode-mic');
                actionBtn.classList.add('mode-send');
                icon.className = 'fas fa-arrow-up'; // or fa-arrow-up
                actionBtn.setAttribute('type', 'submit'); // Allows Enter key to work
            }
        } else {
            // Switch to Microphone
            if (actionBtn.classList.contains('mode-send')) {
                actionBtn.classList.remove('mode-send');
                actionBtn.classList.add('mode-mic');
                icon.className = 'fas fa-microphone';
                actionBtn.setAttribute('type', 'button'); // Prevents empty submit
            }
        }
    };

    chatInput.addEventListener('input', updateButtonState);
    chatInput.addEventListener('keyup', updateButtonState); // Catch backspaces

    // 2. Handle Button Click
    actionBtn.addEventListener('click', (e) => {
        if (actionBtn.classList.contains('mode-mic')) {
            e.preventDefault();
            // --- PLACEHOLDER FOR VOICE LOGIC ---
            // For now, we just animate or show a toast
            if (typeof showToast === 'function') showToast("Hold to record (Feature coming soon)", "info");
            console.log("Mic clicked - Start Recording Logic");
        } else {
            // It is in 'mode-send', allow form submit or call function manually
            // The form submit handler below will take care of sending
        }
    });

    // 3. Handle Form Submit (Enter key or Send Click)
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (chatInput.value.trim().length > 0) {
                sendChatMessage();
                // Reset button to mic after sending
                chatInput.value = '';
                updateButtonState();
            }
        });
    }
}
/*  =====  UI HELPERS  =====  */
function showAuthScreen() {

    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('mainHeader').style.display = 'none';
}

async function showMainApp() {
    // 1. Switch UI
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainApp').style.display = 'flex';
    document.getElementById('mainHeader').style.display = 'flex';

    try {
        // 2. Admin Setup (Safe Guarded)
        if (currentUser.role === 'admin') {
            document.getElementById('adminToolsContainer').classList.remove('hidden');
            if (typeof renderUserManagement === 'function') renderUserManagement();
            if (typeof renderPlanManagementAdmin === 'function') renderPlanManagementAdmin();
            if (typeof renderVoucherList === 'function') renderVoucherList();
            if (typeof renderNetworkSettings === 'function') renderNetworkSettings();
            if (window.HardwarePrinter) window.HardwarePrinter.initialize();
        } else {
            document.getElementById('adminToolsContainer').classList.add('hidden');
        }

        configureSidebarForUser();
        await updateUI();
        // 4. Update Data (Await, but catch errors internally so we don't block navigation)
        try {
            await updateUI();
        } catch (uiErr) {
            console.warn("UI Update partial failure:", uiErr);
        }
        showSection('home');

        // 5. Offline Decision Engine (NanoAI)
        if (!navigator.onLine && typeof NanoAI !== 'undefined') {
            console.log("[App] Offline Mode Detected. Consult NanoAI...");
            NanoAI.decide().then(decision => {
                if (decision) showToast(`Offline AI Action: ${decision}`, 'info');
            });
        }

        // 6. Handle Notifications
        if (currentUser.pendingNotification) {
            const n = currentUser.pendingNotification;
            if (n.type === 'voucher') showVoucherNotification(n.title, n.message, n.code);
            if (navigator.onLine && typeof db !== 'undefined') {
                db.collection('users').doc(currentUser.id).update({
                    pendingNotification: firebase.firestore.FieldValue.delete()
                }).catch(e => console.log(e));
            }
        }
        // 7. Initialize Background Services (Safe)
        setTimeout(async () => {
            if (window.NetworkTools && window.NetworkTools.isPluginAvailable()) {
                await window.NetworkTools.initialize().catch(e => console.warn(e));
                window.NetworkTools.startTrafficAccounting();

                if (await needsDisconnect()) {
                    DataStore.getNetworkSettings().then(cfg => {
                        showToast("Access expired: Disconnecting...", 'info');
                        window.NetworkTools.disconnect(cfg.ssid);
                    }).catch(e => console.warn(e));
                }
            }
        }, 2000);

        // Start periodic notification checks
        startNotificationScheduler();

        // Initialize Offline AI & P2P Gossip
        if (window.AIService) window.AIService.initialize();
        if (window.GossipService) window.GossipService.initialize().catch(e => console.warn("Gossip init failed", e));
        if (window.MeshBilling) window.MeshBilling.initialize().catch(e => console.warn("Billing init failed", e));

        // Initialize Real-time Network Sync
        if (!Subscriptions.networkSettings) {
            let lastSsid = localStorage.getItem('cached_wifi_ssid');
            let lastPass = localStorage.getItem('cached_wifi_pass');

            Subscriptions.networkSettings = DataStore.subscribeToNetworkSettings(async (settings) => {
                console.log("[Sync] Network settings update received.");

                if (currentUser.role === 'admin') {
                    renderNetworkSettings();
                }

                // Only auto-connect if something actually changed
                const changed = (settings.ssid !== lastSsid || settings.password !== lastPass);
                if (!changed) return;

                lastSsid = settings.ssid;
                lastPass = settings.password;

                if (window.NetworkTools && window.NetworkTools.isPluginAvailable()) {
                    const currentSSID = await window.NetworkTools.getCleanSSID();
                    if (settings.ssid && currentSSID !== settings.ssid) {
                        console.log("[Sync] SSID Change Detected. Triggering auto-reconnect...");
                        window.NetworkTools.autoConnectToConfiguredWifi(settings).catch(e => console.warn("Auto-reconnect failed:", e));
                    }
                }
            });
        }

        // Check for app review prompt
        checkAppReviewPrompt();

    } catch (criticalError) {
        console.error("Critical Error in showMainApp:", criticalError);
        showToast("Error loading dashboard. Please restart.", "error");
        // Force home section just in case
        showSection('home');
    } finally {
        window.Loading.hide();
    }
}
/* ===== NOTIFICATION SCHEDULER ===== */
let notificationInterval = null;

function startNotificationScheduler() {
    // Clear existing if any
    if (notificationInterval) clearInterval(notificationInterval);

    // Check every 5 minutes for pending items
    notificationInterval = setInterval(checkPendingNotifications, 5 * 60 * 1000);

    // Also check immediately
    setTimeout(checkPendingNotifications, 10000);
}

async function checkPendingNotifications() {
    if (!currentUser) return;

    try {
        // 1. Check for open tickets with no recent activity
        const tickets = AppData.tickets || [];
        const openTickets = tickets.filter(t => t.status === 'Open');

        if (openTickets.length > 0) {
            // Check if any ticket has been waiting for support response (last reply was user)
            for (const ticket of openTickets) {
                const replies = await DataStore.getTicketReplies(ticket.id);
                if (replies.length > 0) {
                    const lastReply = replies[replies.length - 1];
                    const hoursSinceReply = (Date.now() - lastReply.timestamp.toDate().getTime()) / (1000 * 60 * 60);

                    // If it's been more than 2 hours since the last message and user sent last
                    if (hoursSinceReply > 2 && lastReply.senderId === currentUser.id) {
                        showPendingTicketReminder(ticket, Math.floor(hoursSinceReply));
                        break; // Only show one reminder at a time
                    }
                }
            }
        }

        // 2. Check for expiring plans
        if (currentUser.subscriptions) {
            const now = Date.now();
            currentUser.subscriptions.forEach(sub => {
                const planName = sub.planName || 'Your plan';

                // Time Check
                if (sub.expiresAt) {
                    const expiresMs = sub.expiresAt.seconds * 1000;
                    const hoursLeft = (expiresMs - now) / (1000 * 60 * 60);

                    // Warn if plan expires within 24 hours
                    if (hoursLeft > 0 && hoursLeft <= 24) {
                        showPlanExpiryWarning(planName, Math.floor(hoursLeft));
                    }
                }

                // Data Check
                if (sub.dataLimit > 0) {
                    const consumed = sub.dataConsumed || 0;
                    const remaining = sub.dataLimit - consumed;
                    if (remaining > 0 && remaining <= 0.5) { // 500MB or less
                        showDataLowWarning(planName, remaining);
                    }
                }
            });
        }

    } catch (e) {
        console.error('Notification scheduler error:', e);
    }
}

function showPendingTicketReminder(ticket, hours) {
    const key = `ticket_reminder_${ticket.id}`;
    const lastShown = localStorage.getItem(key);

    // Don't spam - only show once per hour
    if (lastShown && (Date.now() - parseInt(lastShown)) < 60 * 60 * 1000) return;

    const title = '📋 Ticket Update';
    const message = `Your ticket "${ticket.subject.substring(0, 25)}..." has been waiting for ${hours}h.`;

    scheduleLocalNotification(101, title, message, { ticketId: ticket.id });
    localStorage.setItem(key, Date.now().toString());
}

function showPlanExpiryWarning(planName, hoursLeft) {
    const key = `plan_expiry_warning`;
    const lastShown = localStorage.getItem(key);

    // Only show once per 6 hours
    if (lastShown && (Date.now() - parseInt(lastShown)) < 6 * 60 * 60 * 1000) return;

    const title = '⏰ Plan Expiring Soon';
    const message = `${planName} expires in ${hoursLeft} hours! Renew now.`;

    scheduleLocalNotification(102, title, message, { action: 'openPlans' });
    localStorage.setItem(key, Date.now().toString());
}

function showDataLowWarning(planName, remainingGB) {
    const key = `data_low_warning`;
    const lastShown = localStorage.getItem(key);

    // Only show once per 12 hours
    if (lastShown && (Date.now() - parseInt(lastShown)) < 12 * 60 * 60 * 1000) return;

    const title = '📡 Data Running Low';
    const message = `Only ${remainingGB.toFixed(2)}GB left on your ${planName} plan! Top up soon.`;

    scheduleLocalNotification(103, title, message, { action: 'openPlans' });
    localStorage.setItem(key, Date.now().toString());
}

/* ===== LOCAL NOTIFICATION HELPER ===== */
function scheduleLocalNotification(id, title, message, data = {}) {
    // Try Cordova Local Notification Plugin first
    if (window.cordova && cordova.plugins && cordova.plugins.notification && cordova.plugins.notification.local) {
        cordova.plugins.notification.local.schedule({
            id: id,
            title: title,
            text: message,
            foreground: true,
            sound: true,
            vibrate: true,
            icon: 'res://icon',
            smallIcon: 'res://ic_stat_notify',
            data: data,
            trigger: { at: new Date(Date.now() + 1000) } // 1 second delay
        });

        // Handle notification clicks
        cordova.plugins.notification.local.on('click', function (notification) {
            handleNotificationClick(notification.data);
        });
    } else {
        // Fallback to in-app toast
        showToast(`${title}: ${message}`, 'info');
    }
}

function handleNotificationClick(data) {
    if (!data) return;

    if (data.ticketId) {
        openTicketDetail(data.ticketId);
    } else if (data.action === 'openPlans') {
        showSection('subscriptions');
    } else if (data.action === 'openChat') {
        openChatBotModal();
    }
}

/* ===== APP REVIEW PROMPT ===== */
function checkAppReviewPrompt() {
    // Track usage sessions
    let sessions = parseInt(localStorage.getItem('app_sessions') || '0');
    sessions++;
    localStorage.setItem('app_sessions', sessions.toString());

    // Check if already reviewed or dismissed
    const reviewed = localStorage.getItem('app_reviewed');
    const dismissed = localStorage.getItem('app_review_dismissed');

    if (reviewed || dismissed) return;

    // Show review prompt after 5 sessions
    if (sessions >= 5) {
        setTimeout(() => {
            showAppReviewModal();
        }, 30000); // Wait 30 seconds after app load
    }
}

function showAppReviewModal() {
    // Create review modal if it doesn't exist
    let modal = document.getElementById('appReviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'appReviewModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px; text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 15px;">⭐</div>
                <h3 style="margin-bottom: 10px;">Enjoying Br3eze?</h3>
                <p class="text-medium" style="margin-bottom: 20px;">
                    If you're finding our service helpful, please take a moment to rate us! 
                    Your feedback helps us improve.
                </p>
                <div style="display: flex; justify-content: center; gap: 10px; margin-bottom: 15px;">
                    <button class="btn btn-primary" onclick="submitAppReview(5)">
                        <i class="fas fa-star"></i> Love it!
                    </button>
                    <button class="btn" onclick="submitAppReview(3)">
                        It's okay
                    </button>
                </div>
                <button class="btn btn-sm" onclick="dismissAppReview()" style="opacity: 0.7;">
                    Maybe later
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.classList.add('active');
}

window.submitAppReview = function (rating) {
    localStorage.setItem('app_reviewed', 'true');
    closeModal('appReviewModal');

    if (rating >= 4) {
        // For high ratings, try to open app store (Cordova)
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.market) {
            // cordova.plugins.market.open('com.br3eze.hotspot'); // Replace with actual package
            showToast('Thank you so much! 🎉 Your support means everything!', 'success');
        } else {
            showToast('Thank you for the amazing feedback! 🎉', 'success');
        }
    } else {
        // For lower ratings, offer to open support
        showToast('Thanks for your feedback. We\'d love to hear how we can improve!', 'info');
        setTimeout(() => {
            openChatBotModal();
        }, 2000);
    }
};

window.dismissAppReview = function () {
    localStorage.setItem('app_review_dismissed', Date.now().toString());
    closeModal('appReviewModal');
};

function configureSidebarForUser() {
    const plansLink = document.getElementById('sidebarPlansLink');
    if (!plansLink) return;

    if (currentUser.role === 'admin') {
        plansLink.innerHTML = `<i class="fas fa-chart-line"></i> <span class="nav-text">Statistics</span>`;
        plansLink.setAttribute('onclick', "showSection('admin-stats')");
        plansLink.setAttribute('data-section', 'admin-stats');
    } else if (currentUser.role === 'partner') {
        // Partner sees their WiFi management
        plansLink.innerHTML = `<i class="fas fa-broadcast-tower"></i> <span class="nav-text">My Networks</span>`;
        plansLink.setAttribute('onclick', "showSection('partner-networks')");
        plansLink.setAttribute('data-section', 'partner-networks');

        // Show partner tools container
        const partnerContainer = document.getElementById('partnerToolsContainer');
        if (partnerContainer) partnerContainer.classList.remove('hidden');
    } else {
        plansLink.innerHTML = `<i class="fas fa-box"></i> <span class="nav-text">Plans</span>`;
        plansLink.setAttribute('onclick', "showSection('subscriptions')");
        plansLink.setAttribute('data-section', 'subscriptions');
    }

    const partnershipContainer = document.getElementById('partnershipRequestContainer');
    if (partnershipContainer) {
        if (currentUser.role === 'admin' || currentUser.role === 'partner') {
            partnershipContainer.classList.add('hidden');
        } else {
            partnershipContainer.classList.remove('hidden');
        }
    }
}

function toggleDropdown(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const isVisible = dropdown.style.display === 'block';
    document.querySelectorAll('.user-dropdown, .header-dropdown-nav').forEach(d => d.style.display = 'none');
    dropdown.style.display = isVisible ? 'none' : 'block';
}

function showSection(sectionId) {
    document.querySelectorAll('.dashboard-section').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));

    const targetSection = document.getElementById(`${sectionId}-section`);
    const targetLi = document.querySelector(`.sidebar li[data-section="${sectionId}"]`);

    if (targetSection) targetSection.classList.remove('hidden');
    if (targetLi) targetLi.classList.add('active');

    switch (sectionId) {
        case 'messages': renderMessagesSection(); break;
        case 'orders': updateTransactionHistory(); break;
        case 'subscriptions': updatePlans(); break;
        case 'shop': if (window.Shop) Shop.render(); break;
        case 'settings': populateUserSettings(); break;
        case 'admin-stats': renderAdminStats(); break;
        case 'partner-networks': renderPartnerNetworks(); break;
        case 'roaming': renderRoamingSection(); break;
    }
    document.getElementById('userDropdown').style.display = 'none';
}

/*  =====  RENDERERS  =====  */
async function updateUI() {
    if (!currentUser) return;

    // 1. User Profile Subscription
    if (!Subscriptions.user) {
        Subscriptions.user = DataStore.subscribeToUser(currentUser.id, async u => {
            if (!u) return;

            // Background Notification for Received Funds
            if (window.isAppPaused && u.credits > (currentUser.credits || 0)) {
                const diff = (u.credits - currentUser.credits).toFixed(2);
                if (typeof sendNotification === 'function') {
                    sendNotification("Funds Received", `$${diff} has been added to your balance.`, 999);
                }
            }

            currentUser = u;
            updateNavbar();
            updateDashboard(); // Updates credits, active plans count
            if (typeof populateUserSettings === 'function') populateUserSettings();

            // Check network access
            if (window.NetworkTools && await needsDisconnect()) {
                DataStore.getNetworkSettings().then(cfg => {
                    showToast("Access expired: Disconnecting...", 'info');
                    window.NetworkTools.disconnect(cfg.ssid);
                });
            }
        });
    }

    // 1.5 Partner Networks Subscription
    if (!Subscriptions.partnerNetworks) {
        Subscriptions.partnerNetworks = DataStore.subscribeToPartnerNetworks(networks => {
            AppData.partnerNetworks = networks;
            localStorage.setItem('cached_partner_networks', JSON.stringify(networks));
            if (document.getElementById('partnerNetworksList')) renderPartnerNetworks();
            if (document.getElementById('roamingSection')) renderRoamingSection();
        });
    }

    // 2. Plans Subscription
    if (!Subscriptions.plans) {
        Subscriptions.plans = DataStore.subscribeToPlans(plans => {
            AppData.plans = plans;
            if (document.getElementById('plansList')) updatePlans();
            if (document.getElementById('planListAdminContainer')) renderPlanManagementAdmin();
            if (document.getElementById('admin-stats-section')) renderAdminStats();
        });
    }

    // 3. Transactions Subscription (Personal)
    if (!Subscriptions.transactions) {
        Subscriptions.transactions = DataStore.subscribeToTransactions(currentUser.id, txs => {
            // No longer updating AppData.transactions here to avoid confusion with admin data
            // Personal history uses its own listener flow
            if (document.getElementById('transactionHistoryContainer')) updateTransactionHistory(txs);
        });
    }

    // 4. Tickets Subscription
    if (!Subscriptions.tickets) {
        Subscriptions.tickets = DataStore.subscribeToTickets(tickets => {
            AppData.tickets = tickets;
            if (document.getElementById('ticketListContainer')) renderMessagesSection();
            if (document.getElementById('admin-stats-section')) renderAdminStats();
        });
    }

    // 5. Admin Subscriptions
    if (currentUser.role === 'admin') {
        if (!Subscriptions.allUsers) {
            Subscriptions.allUsers = DataStore.subscribeToAllUsers(users => {
                AppData.users = users;
                if (document.getElementById('userListContainer')) renderUserManagement();
                if (document.getElementById('admin-stats-section')) renderAdminStats();
            });
        }
        if (!Subscriptions.allTransactions) {
            Subscriptions.allTransactions = DataStore.subscribeToAllTransactions(txs => {
                AppData.allTransactions = txs; // New AppData field to separate from personal
                if (document.getElementById('admin-stats-section')) renderAdminStats();
            });
        }
        if (!Subscriptions.allVouchers) {
            Subscriptions.allVouchers = DataStore.subscribeToAllVouchers(vouchers => {
                AppData.vouchers = vouchers;
                if (document.getElementById('voucherListContainer')) renderVoucherList();
            });
        }

        // Load specific admin settings once
        renderNetworkSettings();
    }

    updateNavbar();
    updateDashboard();

    if (window.NetworkTools && window.NetworkTools.isPluginAvailable()) {
        window.NetworkTools.initialize();
        window.NetworkTools.displayConnectionInfo();
    }
}

function updateNavbar() {
    document.getElementById('navUsername').textContent = currentUser.fullname || currentUser.username;
    const nameToUse = currentUser.fullname || currentUser.username || 'User';
    const nameParts = nameToUse.trim().split(/\s+/);
    let initials = nameParts[0].charAt(0).toUpperCase();
    if (nameParts.length > 1) {
        initials += nameParts[1].charAt(0).toUpperCase();
    }
    const avatarEl = document.getElementById('navUsernameShort');
    if (currentUser.photoURL) {
        // Google sign-in profile photo
        avatarEl.textContent = '';
        avatarEl.style.backgroundImage = `url('${currentUser.photoURL}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
    } else {
        avatarEl.style.backgroundImage = '';
        avatarEl.textContent = initials;
    }
    document.getElementById('dropdownFullname').textContent = nameToUse;

    let roleLabel = '';
    if (currentUser.role === 'admin') roleLabel = ' (Admin)';
    else if (currentUser.role === 'family') roleLabel = ' (Family)';
    else if (currentUser.role === 'partner') roleLabel = ' (Partner)';

    document.getElementById('dropdownEmail').textContent = currentUser.email + roleLabel;
    
    // Sidebar Conditional Links
    const partnerLink = document.getElementById('sidebarPartnerLink');
    const adminLink = document.getElementById('sidebarAdminLink');
    if (partnerLink) partnerLink.classList.toggle('hidden', currentUser.role !== 'partner');
    if (adminLink) adminLink.classList.toggle('hidden', currentUser.role !== 'admin');
}

function updateDashboard() {
    const isNonBilling = currentUser.role === 'admin' || currentUser.role === 'family';

    // Always show numeric credits so they can share/voucher
    document.getElementById('dashCredits').textContent = (currentUser.credits || 0).toFixed(2);

    if (isNonBilling) {
        document.getElementById('dashPlans').textContent = 'Unlimited';
        document.getElementById('dashDevices').textContent = 'Unlimited';
    } else {
        // Use the robust hasActivePlanNow logic for accurate counts
        const activeSubscriptions = (currentUser.subscriptions || []).filter(s => checkSubscriptionStatus(s));
        document.getElementById('dashPlans').textContent = activeSubscriptions.length;
        document.getElementById('dashDevices').textContent = activeSubscriptions.length > 0 ? 1 : 0;
    }

    const activeSub = getActiveSubscription();
    if (activeSub || isNonBilling) {
        if (isNonBilling) {
            // Force status to Unlimited for staff/family
            updateTimerUI(null, "Unlimited Access");
        } else {
            startPlanTimer();
        }
    } else {
        updateTimerUI(); // Reset to Inactive state
    }
}

/*  =====  PLANS  =====  */
async function updatePlans() {
    const plans = AppData.plans;
    const container = document.getElementById('plansList');

    if (!plans.length) {
        container.innerHTML = `<p class="text-medium">No plans are available at the moment. Please check back later.</p>`;
        return;
    }
    const active = hasActivePlanNow();

    container.innerHTML = plans.map(plan => {
        const imageBlock = plan.imageUrl
            ? `<img src="${plan.imageUrl}" alt="${plan.name}" loading="lazy">`
            : `<span class="shop-card-emoji"><i class="fas fa-wifi"></i></span>`;

        const isNonBilling = currentUser.role === 'admin' || currentUser.role === 'family';
        const duration = `${plan.durationValue || plan.durationDays} ${plan.durationUnit || 'DAY'}${(plan.durationValue || plan.durationDays) > 1 ? 'S' : ''}`;
        const data = plan.dataLimit > 0 ? `${plan.dataLimit} GB` : 'Unlimited';

        const btnText = isNonBilling ? 'Activate (Free)' : 'Purchase';
        const btnDisabled = active && !isNonBilling;
        const btnLabel = (active && isNonBilling) ? 'Plan Active' : (active ? 'Plan running' : btnText);

        // Same structure/classes as the shop product card.
        return `
            <div class="shop-card">
                <div class="shop-card-img">${imageBlock}${active ? '<span class="shop-badge" style="background:var(--color-success);">Active</span>' : ''}</div>
                <div class="shop-card-body">
                    <span class="shop-card-cat">${duration.toUpperCase()} · ${data}</span>
                    <h3 class="shop-card-name">${plan.name}</h3>
                    <p class="text-medium" style="font-size:0.82rem;">${plan.deviceLimit} device${plan.deviceLimit > 1 ? 's' : ''} · ${plan.description || 'Hotspot access'}</p>
                    <div class="shop-card-foot">
                        <span class="shop-card-price">$${plan.price.toFixed(2)}</span>
                    </div>
                    <button class="btn btn-primary btn-block shop-add" ${btnDisabled ? 'disabled' : ''} onclick="purchasePlan('${plan.id}')">${btnLabel}</button>
                </div>
            </div>`;
    }).join('');
}

async function purchasePlan(planId) {
    if (!navigator.onLine) return showToast("Must be online to purchase.", "error");

    const isNonBilling = currentUser.role === 'admin' || currentUser.role === 'family';

    if (hasActivePlanNow() && !isNonBilling) {
        showToast('You already have an active plan. Wait until it expires.', 'error');
        return;
    }
    const plans = await DataStore.getPlans();
    const plan = plans.find(p => p.id === planId);
    if (!plan) return showToast('Plan not found.', 'error');

    if (currentUser.credits < plan.price && !isNonBilling) {
        return showToast('Insufficient credits.', 'error');
    }

    const confirmMsg = isNonBilling
        ? `Activate "${plan.name}" (Staff/Family Free Activate)?`
        : `Buy “${plan.name}” for $${plan.price.toFixed(2)}?`;

    if (!confirm(confirmMsg)) return;

    window.Loading.show(isNonBilling ? 'Activating access...' : 'Processing purchase...');
    try {
        try {
            const modal = document.querySelector('#planDetailModal .modal-content');
            if (modal) {
                const overlay = document.createElement('div');
                overlay.className = 'processing-overlay';
                overlay.innerHTML = `<div class="spinner-glow"></div><p style="margin-top:15px; font-weight:bold;">Authenticating...</p>`;
                modal.appendChild(overlay);

                // Immediate commit for production snappy feel
            }

            const batch = db.batch();
            const userRef = db.collection('users').doc(currentUser.id);

            const expires = calcExpiresAt(plan.durationUnit || 'days', plan.durationValue || plan.durationDays);
            const newSubscription = {
                planId: plan.id,
                planName: plan.name,
                price: plan.price,
                // Timestamp.now(), NOT FieldValue.serverTimestamp() — sentinel
                // values are illegal inside arrayUnion() and made every
                // purchase throw "Purchase failed: … arrayUnion() called with
                // invalid data".
                purchasedAt: firebase.firestore.Timestamp.now(),
                expiresAt: firebase.firestore.Timestamp.fromDate(expires),
                deviceLimit: plan.deviceLimit || 1,
                dataLimit: plan.dataLimit || 0,
                dataConsumed: 0
            };

            const priceToDeduct = isNonBilling ? 0 : plan.price;

            batch.update(userRef, {
                credits: firebase.firestore.FieldValue.increment(-priceToDeduct),
                subscriptions: firebase.firestore.FieldValue.arrayUnion(newSubscription)
            });

            const txRef = db.collection('transactions').doc();
            batch.set(txRef, {
                userId: currentUser.id,
                type: 'purchase',
                planId: plan.id,
                status: 'pending', // Required by new security rules
                description: `Plan Purchase: ${plan.name}`,
                amount: priceToDeduct, // Must be >= 0 for security rules (Family is 0, others > 0)
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            await batch.commit();

            // Step 2: Final Success State
            const overlay = document.querySelector('.processing-overlay');
            if (overlay) {
                overlay.remove();
            }

            showToast('Plan purchased successfully!', 'success');

            // Persistent System Message Notification
            await DataStore.sendSystemMessage(currentUser.id, "[PLAN ACTIVATED]", `Plan: ${plan.name}. Access expires on ${expires.toLocaleString()}. Cost: ${isNonBilling ? '$0.00 (Staff)' : '$' + plan.price.toFixed(2)}`, "Breeze System");

            if (isNonBilling) {
                showToast('Staff Activation: Account Balance Unchanged.', 'info');
            }

            await refreshCurrentUser();
            updateUI();
            startPlanTimer();
            closeModal('planDetailModal');

            // 4. Initialize Network Tools (WifiWizard, etc)
            if (window.NetworkTools) {
                NetworkTools.initialize({
                    DataStore: window.DataStore,
                    currentUser: window.currentUser
                });
            }

            // 5. Refresh UI
            updateUI();
        } catch (e) {
            document.querySelector('.processing-overlay')?.remove();
            throw e; // Re-throw to be caught by outer catch if needed, or just handle here. 
            // Original code had a specific catch here which showed toast.
            // But there was also an outer catch.
            // I'll keep the inner catch implementation but adapt it.
        }
    } catch (e) {
        showToast(`Purchase failed: ${e.message}`, 'error');
    } finally {
        window.Loading.hide();
    }
}

async function refreshCurrentUser() {
    if (auth.currentUser) {
        currentUser = await DataStore.getUser(auth.currentUser.uid);
    }
}


/*  =====  VOUCHERS  =====  */
async function redeemVoucherLogic(code) {
    if (!navigator.onLine) throw new Error("Must be online to redeem.");

    // 1. Get Voucher
    const voucher = await DataStore.getVoucher(code);
    if (!voucher || voucher.used) {
        throw new Error("Invalid or already used voucher code.");
    }

    // 2. Prepare Batch
    const batch = db.batch();
    const userRef = db.collection('users').doc(currentUser.id);
    batch.update(userRef, { credits: firebase.firestore.FieldValue.increment(voucher.value) });

    const txRef = db.collection('transactions').doc();
    batch.set(txRef, {
        userId: currentUser.id,
        type: 'redeem',
        description: `Voucher Redeemed: ${voucher.code}`,
        amount: voucher.value,
        voucherCode: voucher.code,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    const voucherRef = db.collection('vouchers').doc(voucher.id);
    batch.update(voucherRef, {
        used: true,
        usedBy: currentUser.id,
        redeemedByUsername: currentUser.fullname || currentUser.username,
        usedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
    return voucher.value;
}

/* Peak-moment celebration (mobile-app-ui-design skill: success states should
   feel rewarding). Full-screen checkmark + amount + sparkles, tap/auto dismiss. */
window.showSuccessCelebration = function ({ title = 'Success!', amount = null, subtitle = '' } = {}) {
    document.getElementById('celebrateOverlay')?.remove();
    const el = document.createElement('div');
    el.className = 'celebrate-overlay';
    el.id = 'celebrateOverlay';
    const amountHtml = amount != null ? `<div class="celebrate-amount">+$${Number(amount).toFixed(2)}</div>` : '';
    el.innerHTML = `
        <div class="celebrate-check"><i class="fas fa-check"></i></div>
        <div class="celebrate-title">${window.escapeHtml(title)}</div>
        ${amountHtml}
        ${subtitle ? `<div class="celebrate-sub">${window.escapeHtml(subtitle)}</div>` : ''}`;
    ['✨', '🎉', '⭐', '✨', '🎊'].forEach((s, i) => {
        const sp = document.createElement('div');
        sp.className = 'celebrate-spark';
        sp.textContent = s;
        sp.style.left = (28 + i * 12) + '%';
        sp.style.top = '40%';
        sp.style.animationDelay = (i * 0.08) + 's';
        el.appendChild(sp);
    });
    document.body.appendChild(el);
    const dismiss = () => el.remove();
    el.addEventListener('click', dismiss);
    setTimeout(dismiss, 2600);
};

/*  =====  VOUCHERS UI  =====  */
function openRedeemVoucher() {
    document.getElementById('redeemVoucherForm').reset();
    openModal('redeemVoucherModal');
}

async function redeemVoucher(event) {
    event.preventDefault();
    const code = document.getElementById('voucherCodeInput').value.trim();
    if (!code) return;

    // UI Gamification Overlay
    const modalContent = document.querySelector('#redeemVoucherModal .modal-content');
    const overlay = document.createElement('div');
    overlay.className = 'processing-overlay';
    overlay.innerHTML = `<div class="spinner-glow"></div><p style="margin-top:15px; font-weight:bold;">Verifying Code...</p>`;
    if (modalContent) modalContent.appendChild(overlay);

    if (!navigator.onLine) {
        if (typeof GossipService !== 'undefined') {
            GossipService.queueOfflineVoucher(code, currentUser.id);
            overlay.remove();
            closeModal('redeemVoucherModal');
            showToast("Offline. Voucher queued for P2P relay.", "info");
            return;
        }
        overlay.remove();
        return showToast("Must be online to redeem (or enable P2P sync).", "error");
    }

    try {
        const voucher = await DataStore.getVoucher(code);
        if (!voucher || voucher.used) {
            overlay.remove();
            return showToast('Invalid or already used voucher code.', 'error');
        }

        // Animated Steps
        // Direct validation and injection

        const batch = db.batch();
        const userRef = db.collection('users').doc(currentUser.id);
        batch.update(userRef, { credits: firebase.firestore.FieldValue.increment(voucher.value) });

        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
            userId: currentUser.id,
            type: 'redeem',
            description: `Voucher Redeemed: ${voucher.code}`,
            amount: voucher.value,
            voucherCode: voucher.code,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const voucherRef = db.collection('vouchers').doc(voucher.id);
        batch.update(voucherRef, {
            used: true,
            usedBy: currentUser.id,
            redeemedByUsername: currentUser.fullname,
            usedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();

        // Success Animation
        overlay.innerHTML = `<i class="fas fa-gift" style="font-size:3rem; color:var(--color-success-text);"></i><h3 style="margin-top:15px;">+$${voucher.value.toFixed(2)} Loaded!</h3>`;
        triggerConfetti();

        // Delay for visual effect
        setTimeout(async () => {
            overlay.remove();
            closeModal('redeemVoucherModal');
            await refreshCurrentUser(); // Fetch fresh credits
            updateUI();
            // Peak moment — celebrate the top-up (the "notice/reward" moment).
            showSuccessCelebration({
                title: 'Voucher Redeemed!',
                amount: voucher.value,
                subtitle: 'Your balance is topped up. Enjoy your connection! 🚀'
            });
        }, 1500);

    } catch (e) {
        overlay.remove();
        showToast(e.message, 'error');
    }
}

function openShareCredit() {
    document.getElementById('shareCreditForm').reset();
    openModal('shareCreditModal');
}

// Pick a contact from the device's address book (cordova-plugin-contacts)
// and use their phone number to fill the P2P recipient field.
function pickContactForShare() {
    if (typeof navigator === 'undefined' || !navigator.contacts || typeof navigator.contacts.pickContact !== 'function') {
        return showToast('Contacts are only available in the mobile app.', 'info');
    }
    navigator.contacts.pickContact((contact) => {
        const phone = contact?.phoneNumbers?.[0]?.value;
        if (!phone) return showToast('That contact has no phone number.', 'warning');
        document.getElementById('shareRecipientIdentifier').value = phone.replace(/\D/g, '');
    }, (err) => {
        console.warn('[Contacts] pickContact failed/cancelled:', err);
    });
}
window.pickContactForShare = pickContactForShare;

/*  =====  SETTINGS & PROFILE  =====  */
function populateUserSettings() {
    if (!currentUser) return;
    if (window.PermissionCenter) PermissionCenter.render();
    document.getElementById('settingsFullname').value = currentUser.fullname || '';
    document.getElementById('settingsUsername').value = currentUser.username || '';
    document.getElementById('settingsPhoneNumber').value = currentUser.phoneNumber || '';
    document.getElementById('settingsAddress').value = currentUser.address || '';
    document.getElementById('settingsEmail').value = currentUser.email || '';

    // Partnership visibility
    const partnershipCard = document.getElementById('partnershipRequestContainer');
    if (partnershipCard) partnershipCard.classList.toggle('hidden', currentUser.role === 'partner');

    // Profile card (avatar/name/role) + backoffice link, folded into Settings
    const avatarEl = document.getElementById('profileAvatarLarge');
    const nameToUse = currentUser.fullname || currentUser.username || 'User';
    if (currentUser.photoURL) {
        avatarEl.textContent = '';
        avatarEl.style.backgroundImage = `url('${currentUser.photoURL}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
    } else {
        avatarEl.style.backgroundImage = '';
        const parts = nameToUse.trim().split(/\s+/);
        avatarEl.textContent = parts.length > 1 ? (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase() : parts[0].charAt(0).toUpperCase();
    }
    document.getElementById('profileDisplayName').textContent = nameToUse;
    document.getElementById('profileDisplayEmail').textContent = currentUser.email || '';

    const roleBadge = document.getElementById('profileRoleBadge');
    const roleClasses = { admin: 'tag-req', partner: 'tag-opt', user: 'tag-auto' };
    roleBadge.textContent = (currentUser.role || 'user').toUpperCase() + (currentUser.isFamily ? ' · FAMILY' : '');
    roleBadge.className = 'tag ' + (roleClasses[currentUser.role] || 'tag-auto');

    document.getElementById('backofficeLink').classList.toggle('hidden', currentUser.role !== 'admin');

    renderPermissionsList();
}

async function handleChangePassword(e) {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmNewPassword) return showToast('New passwords do not match.', 'error');
    if (!auth.currentUser) return showToast('Not signed in.', 'error');

    window.Loading.show('Updating password...');
    try {
        const credential = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
        await auth.currentUser.reauthenticateWithCredential(credential);
        await auth.currentUser.updatePassword(newPassword);
        document.getElementById('changePasswordForm').reset();
        window.Loading.hide();
        showToast('Password updated.', 'success');
    } catch (e2) {
        window.Loading.hide();
        showToast(e2.message, 'error');
    }
}

// Permission radio list -- data/status come from PermissionsHelper (js/index.js),
// which owns the group definitions (kept in sync with config.xml) and the
// actual cordova.plugins.permissions calls. This just renders + wires clicks.
async function renderPermissionsList() {
    const container = document.getElementById('permissionsList');
    if (!container) return;

    if (typeof PermissionsHelper === 'undefined' || typeof cordova === 'undefined' || !cordova.plugins?.permissions) {
        container.innerHTML = '<p class="text-medium">Available in the mobile app.</p>';
        return;
    }

    const groups = PermissionsHelper.GROUPS.filter(g => PermissionsHelper.groupApplies(g));
    const statuses = await Promise.all(groups.map(g => PermissionsHelper.checkGroup(g.id)));

    container.innerHTML = groups.map((g, i) => {
        const granted = statuses[i] === 'granted';
        return `
            <div class="form-group">
                <label>${g.label}</label>
                <p class="text-medium" style="font-size:0.8rem;margin-bottom:6px;">${g.desc}</p>
                <div style="display:flex;gap:16px;">
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;">
                        <input type="radio" name="perm-${g.id}" ${granted ? 'checked' : ''} disabled> Allowed
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-weight:normal;cursor:pointer;">
                        <input type="radio" name="perm-${g.id}" ${granted ? '' : 'checked'} onclick="requestPermissionGroup('${g.id}')"> Not allowed
                    </label>
                </div>
            </div>`;
    }).join('');
}
window.renderPermissionsList = renderPermissionsList;

async function requestPermissionGroup(groupId) {
    const granted = await PermissionsHelper.requestGroup(groupId);
    showToast(granted ? 'Permission granted!' : 'Permission denied.', granted ? 'success' : 'warning');
    renderPermissionsList();
}
window.requestPermissionGroup = requestPermissionGroup;

async function handleUpdateProfile(e) {
    e.preventDefault();
    window.Loading.show('Updating profile...');

    // Safely get values, defaulting to empty string if element missing
    const getVal = (id) => document.getElementById(id) ? document.getElementById(id).value.trim() : '';

    const updates = {
        fullname: getVal('settingsFullname'),
        username: getVal('settingsUsername'),
        phoneNumber: getVal('settingsPhoneNumber'),
        address: getVal('settingsAddress'),
    };
    try {
        await db.collection('users').doc(currentUser.id).update(updates);
        currentUser = { ...currentUser, ...updates };
        window.Loading.hide();
        showToast('Profile updated!', 'success');
        updateUI();
    } catch (err) {
        window.Loading.hide();
        showToast('Update failed: ' + err.message, 'error');
    }
}

/*  =====  TICKETS  =====  */
let ticketReplyListener = null;
let lastKnownReplyCount = 0;

// Notification Sound (base64 encoded short beep)
const notificationSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQAG2e79BAGA//8B');

async function openTicketDetail(ticketId) {
    window.Loading.show('Loading conversation...');

    // Clean up previous listener
    if (ticketReplyListener) {
        ticketReplyListener();
        ticketReplyListener = null;
    }

    try {
        const tickets = await DataStore.getTickets();
        const ticket = tickets.find(t => t.id === ticketId);
        if (!ticket) throw new Error("Ticket not found");

        // Header Updates
        document.getElementById('ticketModalTitle').textContent = ticket.subject;

        // Status & Last Seen
        const statusEl = document.getElementById('ticketModalSubtitle');
        statusEl.style.display = 'block';

        if (ticket.status === 'Closed') {
            statusEl.innerHTML = `<span style="color: var(--color-text-medium);">Ticket Closed</span>`;
        } else {
            statusEl.innerHTML = `<span style="color: var(--color-success);">Online</span>`;
        }

        // Link to profile
        const userLink = document.createElement('div');
        userLink.innerHTML = `<small class="text-medium" style="cursor:pointer; text-decoration:underline;" onclick="openUnifiedProfile('${ticket.userId}')">View User Profile</small>`;
        statusEl.appendChild(userLink);

        document.getElementById('currentTicketId').value = ticketId;
        document.getElementById('ticketModalStatus').className = `ticket-status-badge status-${ticket.status.toLowerCase()}`;
        document.getElementById('ticketModalStatus').textContent = ticket.status;

        // Admin Actions
        const actionsContainer = document.getElementById('ticketModalActions');
        actionsContainer.innerHTML = '';
        if (currentUser.role === 'admin' && ticket.status !== 'Closed') {
            actionsContainer.innerHTML = `<button class="btn btn-sm btn-danger" onclick="closeTicket('${ticket.id}')" title="Close Ticket"><i class="fas fa-ban"></i></button>`;
        }

        const container = document.getElementById('ticketRepliesContainer');

        // Function to render messages
        function renderMessages(replies) {
            container.innerHTML = '';

            const allMessages = [
                {
                    id: 'original',
                    senderId: ticket.userId,
                    senderName: ticket.userEmail,
                    role: 'user',
                    message: ticket.body,
                    timestamp: ticket.createdAt,
                    isOriginal: true
                },
                ...replies
            ];

            let lastDateStr = '';

            allMessages.forEach(msg => {
                const isMe = (msg.senderId === currentUser.id);
                const isAssistant = (msg.role === 'assistant' || msg.senderId === 'AI_SUPPORT');
                const isAdmin = (msg.role === 'admin' || msg.role === 'system' || isAssistant);

                const dateObj = msg.timestamp ? msg.timestamp.toDate() : new Date();
                const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                const isToday = new Date().toDateString() === dateObj.toDateString();
                const dateStr = isToday ? 'Today' : dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

                if (dateStr !== lastDateStr) {
                    container.innerHTML += `<div class="chat-date-separator"><span>${dateStr}</span></div>`;
                    lastDateStr = dateStr;
                }

                const alignClass = isMe ? 'reply-me' : 'reply-other';

                let statusIcon = '';
                if (isMe) {
                    const isRead = (Date.now() - dateObj.getTime()) > 5 * 60 * 1000;
                    statusIcon = isRead
                        ? '<i class="fas fa-check-double status-read" title="Read"></i>'
                        : '<i class="fas fa-check-double status-delivered" title="Delivered"></i>';
                }

                const adminLabel = isAssistant
                    ? `<span class="badge-admin"><i class="fas fa-robot" style="margin-right:3px;"></i>ASSISTANT</span>`
                    : (isAdmin ? `<span class="badge-admin">SUPPORT <i class="fas fa-check-circle" style="color: #fff; margin-left: 2px;" title="Verified"></i></span>` : '');
                const senderLabel = isAssistant ? 'Br3eze Assistant' : 'Support';

                container.innerHTML += `
                    <div class="ticket-message ${alignClass} ${isAdmin ? 'is-admin' : ''}">
                        ${isAdmin ? `<div class="meta" style="margin-bottom:2px;">${adminLabel} <strong>${senderLabel}</strong></div>` : ''}
                        <div class="body">${msg.message}</div>
                        <div class="message-meta-footer">
                            <span class="message-time">${timeStr}</span>
                            ${isMe ? `<span class="message-status-icon">${statusIcon}</span>` : ''}
                        </div>
                    </div>
                `;
            });

            setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
        }

        // Initial load
        const initialReplies = await DataStore.getTicketReplies(ticketId);
        lastKnownReplyCount = initialReplies.length;
        renderMessages(initialReplies);

        openModal('ticketDetailModal');

        // Set up REAL-TIME listener for new messages
        ticketReplyListener = db.collection('tickets').doc(ticketId)
            .collection('replies')
            .orderBy('timestamp', 'asc')
            .onSnapshot((snapshot) => {
                const replies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // Check for NEW messages (not from initial load)
                if (replies.length > lastKnownReplyCount) {
                    const newMsg = replies[replies.length - 1];

                    // Only notify if it's NOT from current user
                    if (newMsg.senderId !== currentUser.id) {
                        // Play notification sound
                        notificationSound.play().catch(e => console.log('Audio play blocked:', e));

                        // Show toast notification
                        showToast(`📩 New message from Support!`, 'info');

                        // Update typing indicator briefly
                        statusEl.innerHTML = `<span style="color: var(--color-primary);">New message!</span>`;
                        setTimeout(() => {
                            statusEl.innerHTML = `<span style="color: var(--color-success);">Online</span>`;
                        }, 3000);
                    }

                    lastKnownReplyCount = replies.length;
                }

                // Re-render messages
                renderMessages(replies);
            }, (error) => {
                console.error('Reply listener error:', error);
            });

        // Typing simulation for demo
        const lastMsg = initialReplies[initialReplies.length - 1];
        if (ticket.status !== 'Closed' && lastMsg && lastMsg.senderId === currentUser.id) {
            setTimeout(() => {
                statusEl.innerHTML = `<span style="color: var(--color-success);">Typing...</span>`;
            }, 2000);
            setTimeout(() => {
                statusEl.innerHTML = `<span style="color: var(--color-success);">Online</span>`;
            }, 5000);
        }

    } catch (e) {
        console.error(e);
        showToast(e.message, 'error');
    } finally {
        window.Loading.hide();
    }
}

document.getElementById('ticketReplyForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ticketId = document.getElementById('currentTicketId').value;
    const message = document.getElementById('ticketReplyInput').value.trim();
    if (!message) return;

    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        await DataStore.sendTicketReply(ticketId, {
            senderId: currentUser.id,
            senderName: currentUser.fullname || currentUser.username,
            role: currentUser.role,
            message: message
        });
        document.getElementById('ticketReplyInput').value = '';
        showToast('Reply sent', 'success');
        await openTicketDetail(ticketId);
        // Let the AI assistant answer follow-ups too, unless a human admin is
        // already on the thread or the replier is staff themselves.
        if (currentUser.role !== 'admin') {
            TicketAI.respond(ticketId, message).catch(e => console.warn('[TicketAI] follow-up failed:', e));
        }
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

async function closeTicket(ticketId) {
    if (!confirm(`Mark ticket as CLOSED? Users cannot reply to closed tickets.`)) return;
    try {
        await DataStore.updateTicketStatus(ticketId, 'Closed');
        await DataStore.sendTicketReply(ticketId, {
            senderId: 'SYSTEM',
            senderName: 'System',
            role: 'system',
            message: 'Ticket has been marked as Closed.'
        });
        closeModal('ticketDetailModal');
        showToast('Ticket Closed.', 'success');
        renderMessagesSection();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

function openSubmitTicketModal() {
    document.getElementById('newTicketForm').reset();
    openModal('submitTicketModal');
}

async function submitNewTicket(event) {
    event.preventDefault();
    const subject = document.getElementById('newTicketSubject').value;
    const body = document.getElementById('newTicketBody').value;
    const newTicket = {
        userId: currentUser.id,
        userEmail: currentUser.email,
        subject,
        body,
        status: 'Open',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        const ticketId = await DataStore.addTicket(newTicket);
        closeModal('submitTicketModal');
        showToast('Ticket submitted — our assistant is replying…', 'success');
        renderMessagesSection();
        // First-line AI support: the assistant answers as a participant in the
        // thread (see TicketAI). A human admin can still take over anytime.
        TicketAI.respond(ticketId, `${subject}\n\n${body}`).catch(e => console.warn('[TicketAI] first reply failed:', e));
    } catch (e) {
        showToast(`Error submitting ticket: ${e.message}`, 'error');
    }
}

/* ===================================================================
   TICKET AI — first-line support agent that participates in the ticket
   thread as a "user" (senderId AI_SUPPORT, role 'assistant'). Mirrors the
   backend ask-engine.js support role; on the web it runs via AIService.
   =================================================================== */
const TicketAI = {
    SENDER_ID: 'AI_SUPPORT',
    SENDER_NAME: 'Br3eze Assistant',

    // Don't jump in if a human admin has already replied to this ticket.
    _adminHasReplied(replies) {
        return replies.some(r => r.role === 'admin' || r.senderId === 'SYSTEM' && r.role === 'system');
    },

    async _buildSupportContext() {
        const base = typeof window.getSystemContext === 'function'
            ? await window.getSystemContext()
            : `You are Br3eze Assistant for Br3eze Hotspot.`;
        return base + `

=== SUPPORT TICKET MODE ===
You are the FIRST-LINE SUPPORT AGENT answering a customer's support ticket.
- Be concise, warm, and solve the problem directly.
- Use the knowledge base and the customer's account details above.
- If you resolve it, say so. If it needs a human (billing disputes, refunds,
  hardware RMA, anything you're unsure of), say a team member will follow up
  and keep it brief.
- Never invent account data. Do not use [ACTION:*] tags here — this is a ticket
  thread, not the in-app chat.`;
    },

    async respond(ticketId, userText) {
        if (!ticketId || typeof window.AIService === 'undefined') return;
        try {
            // Guard: skip if an admin already handled it.
            const replies = await DataStore.getTicketReplies(ticketId).catch(() => []);
            if (this._adminHasReplied(replies)) return;

            const sysContext = await this._buildSupportContext();
            const reply = await window.AIService.generate(
                `Customer ticket message:\n${userText}\n\nWrite your support reply:`,
                sysContext
            );

            await DataStore.sendTicketReply(ticketId, {
                senderId: this.SENDER_ID,
                senderName: this.SENDER_NAME,
                role: 'assistant',
                message: reply
            });
        } catch (e) {
            console.warn('[TicketAI] respond failed:', e);
        }
    }
};
window.TicketAI = TicketAI;

/*  =====  ADMIN STATS & CHARTS  =====  */
let adminChartDataCache = {};

async function renderAdminStats() {
    const filterValue = document.getElementById('statsTimeFilter')?.value || '30';

    const users = AppData.users;
    const transactions = AppData.allTransactions;
    const tickets = AppData.tickets;
    const plans = AppData.plans;

    // If data isn't loaded yet, don't show "Analyzing" indefinitely if we're just updating
    if (users.length === 0 && transactions.length === 0) {
        // Only show loader if it's the very first load
        // window.Loading.show('Analyzing...'); 
    }

    // --- ENHANCED DATE LOGIC ---
    const now = new Date();
    let startDate = new Date();
    let prevStartDate = new Date();
    let labelInterval = 'day';
    let rangeDays = 30;

    if (filterValue === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        rangeDays = Math.ceil((now - startDate) / (1000 * 60 * 60 * 24)) + 1;
        prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        labelInterval = 'day';
    } else if (filterValue === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        rangeDays = 365; // Fixed for chart logic
        prevStartDate = new Date(now.getFullYear() - 1, 0, 1);
        labelInterval = 'month';
    } else {
        rangeDays = parseInt(filterValue);
        startDate.setDate(now.getDate() - rangeDays);
        prevStartDate.setDate(startDate.getDate() - rangeDays);
        labelInterval = rangeDays > 60 ? 'month' : 'day';
    }

    // --- DATA FILTERING ---
    const currentTx = transactions.filter(t => t.timestamp && t.timestamp.toDate() >= startDate);
    const prevTx = transactions.filter(t => {
        const d = t.timestamp ? t.timestamp.toDate() : new Date(0);
        return d >= prevStartDate && d < startDate;
    });

    // --- KPI CALCULATIONS ---
    const revenue = currentTx
        .filter(t => t.type === 'purchase')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const prevRevenue = prevTx
        .filter(t => t.type === 'purchase')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    // Calculate Growth %
    let growthPct = 0;
    if (prevRevenue > 0) growthPct = ((revenue - prevRevenue) / prevRevenue) * 100;
    else if (revenue > 0) growthPct = 100;

    const growthHtml = growthPct >= 0
        ? `<small style="color:var(--color-success-text); font-size:0.7rem;">(+${growthPct.toFixed(1)}%)</small>`
        : `<small style="color:var(--color-danger-text); font-size:0.7rem;">(${growthPct.toFixed(1)}%)</small>`;

    const activePlansCount = users.reduce((cnt, u) => {
        const subs = u.subscriptions || [];
        const activeUserSubs = subs.filter(s => s.expiresAt && new Date(s.expiresAt.seconds * 1000) > new Date()).length;
        return cnt + activeUserSubs;
    }, 0);

    const arpu = users.length > 0 ? (revenue / users.length) : 0;

    document.getElementById('statsTotalRevenue').innerHTML = `${revenue.toFixed(2)} ${growthHtml}`;
    document.getElementById('statsTotalUsers').textContent = users.length;
    document.getElementById('statsActivePlans').textContent = activePlansCount;
    document.getElementById('statsOpenTickets').textContent = tickets.filter(t => t.status === 'Open').length;

    /* --- CHART 1: REVENUE TREND --- */
    const revChartContainer = document.getElementById('revenueChart');
    let buckets = [];
    const isYearMode = (labelInterval === 'month');

    let bucketCount = 10;
    if (isYearMode) {
        bucketCount = 12;
    } else {
        if (rangeDays <= 7) bucketCount = 7;
        else if (rangeDays <= 31) bucketCount = rangeDays;
        else bucketCount = 15; // 90 days usually weekly, but 15 samples works for sparkline feel
    }

    for (let i = 0; i < bucketCount; i++) {
        const d = new Date(now);
        if (isYearMode) {
            d.setDate(1); // Set to 1st to avoid month skipping at end of months
            d.setMonth(now.getMonth() - i);
        } else {
            d.setDate(now.getDate() - i);
        }

        const key = isYearMode
            ? `${d.getFullYear()}-${d.getMonth()}`
            : d.toISOString().split('T')[0];

        const label = isYearMode
            ? d.toLocaleDateString('en-US', { month: 'short' })
            : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

        buckets.push({ key, label, amount: 0 });
    }
    buckets.reverse();

    currentTx.forEach(tx => {
        if (tx.type === 'purchase' && tx.timestamp) {
            const d = tx.timestamp.toDate();
            const key = isYearMode
                ? `${d.getFullYear()}-${d.getMonth()}`
                : d.toISOString().split('T')[0];
            const bucket = buckets.find(b => b.key === key);
            if (bucket) bucket.amount += Math.abs(tx.amount);
        }
    });

    const maxRev = Math.max(...buckets.map(d => d.amount), 1);
    const avgRev = revenue / Math.max(bucketCount, 1);

    revChartContainer.innerHTML = buckets.map(day => {
        const height = (day.amount / maxRev) * 100;
        let barClass = 'chart-bar';
        if (day.amount === maxRev && maxRev > 0) barClass += ' is-peak';
        else if (day.amount < (avgRev * 0.5)) barClass += ' is-low';

        return `
        <div class="chart-bar-wrapper" style="cursor:help;">
            <div class="${barClass}" 
                 style="height: ${height}%;" 
                 data-tooltip="${day.label}: $${day.amount.toFixed(2)}">
                ${day.amount > 0 && height > 15 ? `<span class="value">$${day.amount.toFixed(0)}</span>` : ''}
            </div>
            <div class="chart-label">${day.label}</div>
        </div>`;
    }).join('');

    /* --- CHART 2: PLAN CONVERSION --- */
    const popChartContainer = document.getElementById('popularityChart');

    const planStats = plans.map(plan => {
        const salesInPeriod = currentTx.filter(t => t.type === 'purchase' && t.planId === plan.id).length;
        const activeNow = users.filter(u =>
            u.subscriptions?.some(s => s.planId === plan.id && s.expiresAt.seconds * 1000 > Date.now())
        ).length;
        let expired = Math.max(0, salesInPeriod - activeNow);

        return {
            name: plan.name,
            sales: salesInPeriod,
            active: activeNow,
            expired: expired,
            conversion: salesInPeriod > 0 ? Math.round((activeNow / (salesInPeriod || 1)) * 100) : 0
        };
    }).sort((a, b) => b.sales - a.sales);

    if (planStats.every(p => p.sales === 0 && p.active === 0)) {
        popChartContainer.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%;"><p class="text-medium">No plan activity in this period.</p></div>';
    } else {
        popChartContainer.innerHTML = planStats.map(stat => {
            const totalBar = stat.active + stat.expired;
            const activePct = totalBar > 0 ? (stat.active / totalBar) * 100 : 0;
            const expPct = totalBar > 0 ? (stat.expired / totalBar) * 100 : 0;

            let retentionClass = 'text-medium';
            if (stat.conversion >= 50) retentionClass = 'text-success';
            else if (stat.conversion >= 25) retentionClass = 'text-warning';
            else if (stat.conversion > 0) retentionClass = 'text-danger';

            return `
    <div class="plan-stat-row">
        <div class="plan-stat-header">
            <strong>${stat.name}</strong>
            <span>Rate: <span style="color:var(--color-info-text)">${stat.conversion}%</span> retention</span>
        </div>
        <div class="multi-progress-track">
            <div class="prog-bar-segment prog-active" style="width: ${activePct}%">
                ${activePct > 15 ? stat.active : ''}
            </div>
            <div class="prog-bar-segment prog-expired" style="width: ${expPct}%">
                ${expPct > 15 ? stat.expired : ''}
            </div>
        </div>
        <div style="font-size: 0.75rem; color: var(--color-text-medium); margin-top: 4px; display:flex; justify-content:space-between;">
            <span>Active: ${stat.active} / Expired: ${stat.expired}</span>
            <span>Total Sales: ${stat.sales}</span>
        </div>
    </div>`;
        }).join('');
    }

    adminChartDataCache = {
        period: rangeDays + ' days',
        revenue: revenue,
        prevRevenue: prevRevenue,
        growth: growthPct.toFixed(1) + '%',
        arpu: arpu.toFixed(2),
        revenueTrend: buckets.map(b => b.amount),
        peakDay: buckets.reduce((a, b) => a.amount > b.amount ? a : b).label,
        planStats: planStats,
        totalUsers: users.length,
        activeUsers: activePlansCount
    };

    // --- ENTERPRISE INSIGHTS INTEGRATION ---
    if (window.EnterpriseLogic) {
        const roi = await EnterpriseLogic.getROIStats();
        const history = await EnterpriseLogic.getProcurementHistory();

        const demandEl = document.getElementById('enterpriseDemandStatus');
        const strategyEl = document.getElementById('enterpriseStrategy');
        const bufferEl = document.getElementById('enterpriseBuffer');
        const risksEl = document.getElementById('enterpriseNodeRisks');

        if (demandEl) {
            demandEl.textContent = "STABLE"; // Default view
            demandEl.style.color = 'var(--color-success-text)';
        }

        if (strategyEl) {
            strategyEl.innerHTML = `<i class="fas fa-money-bill-wave"></i> ROI: ${roi.roiPeriod}<br><small>Bulk Saved: ${roi.bulkSavings}</small>`;
        }

        if (bufferEl) {
            bufferEl.innerHTML = `<i class="fas fa-database"></i> ${roi.costPerGB}/GB<br><small>Uptime: ${roi.uptime}</small>`;
        }

        if (risksEl) {
            risksEl.innerHTML = history.map(p => `
                <div style="display:flex; justify-content:space-between; padding: 10px; border-bottom: 1px solid var(--color-border); align-items: center;">
                    <div>
                        <strong>${p.nodeId}</strong> - ${p.item} (x${p.qty})<br>
                        <small class="text-medium">$${p.totalCost.toFixed(2)}</small>
                    </div>
                    <div>
                        <span class="badge" style="background:${p.status === 'DELIVERED' ? 'var(--color-success)' : 'var(--color-warning)'}">
                            ${p.status}
                        </span>
                    </div>
                </div>
            `).join('');
        }
    }

    window.Loading.hide();
}

/* --- ACTIVE CONNECTIONS MODAL --- */
async function openActiveConnectionsModal() {
    const container = document.getElementById('activeConnectionsContainer');
    container.innerHTML = '<p class="text-medium">Scanning active sessions...</p>';
    openModal('activeConnectionsModal');

    renderActiveConnectionsTable();
    if (window.connectionInterval) clearInterval(window.connectionInterval);
    window.connectionInterval = setInterval(renderActiveConnectionsTable, 2000);
}

function filterConnectionsTable() {
    renderActiveConnectionsTable();
}
window.filterConnectionsTable = filterConnectionsTable;

function renderActiveConnectionsTable() {
    const container = document.getElementById('activeConnectionsContainer');
    if (!container) return;

    // Check if modal is still open, otherwise kill interval
    if (!document.getElementById('activeConnectionsModal')?.classList.contains('active')) {
        if (window.connectionInterval) clearInterval(window.connectionInterval);
        return;
    }

    const now = Date.now();
    const searchTerm = (document.getElementById('connectionSearch')?.value || '').toUpperCase();

    // Use reactive AppData for live IP/Status updates
    const allUsers = AppData.users || [];
    const filteredUsers = allUsers.filter(u => {
        const sub = (u.subscriptions || []).find(s => s.expiresAt && s.expiresAt.seconds * 1000 > now);
        if (!sub) return false;

        if (!searchTerm) return true;
        const searchStr = `${u.fullname || ''} ${u.lastIP || ''} ${u.deviceModel || ''} ${u.platform || ''} ${u.deviceId || ''}`.toUpperCase();
        return searchStr.includes(searchTerm);
    });

    if (filteredUsers.length === 0) {
        container.innerHTML = `<p class="text-medium" style="padding:20px;">No matching active connections.</p>`;
        return;
    }

    let html = `<table class="admin-table" id="connectionsTable">
                <thead>
                    <tr>
                        <th>User / Device</th>
                        <th>IP Address</th>
                        <th>Time Remaining</th>
                    </tr>
                </thead>
                <tbody>`;

    filteredUsers.forEach(u => {
        const sub = u.subscriptions.find(s => s.expiresAt.seconds * 1000 > now);
        const end = sub.expiresAt.seconds * 1000;
        const timeLeft = end - now;
        const timeString = formatTimeLeft(timeLeft);
        const timeColor = timeLeft < 3600000 ? 'var(--color-danger-text)' : 'var(--color-success-text)';

        const deviceName = u.deviceModel || '<span class="text-medium" style="font-size:0.8em">Unknown Device</span>';
        const ipAddress = u.lastIP || '<span class="text-medium" style="font-size:0.8em">--</span>';

        let icon = '<i class="fas fa-mobile-alt"></i>';
        if (u.platform === 'iOS') icon = '<i class="fab fa-apple"></i>';
        else if (u.platform === 'Android') icon = '<i class="fab fa-android"></i>';
        else if (!u.platform || u.platform === 'Web') icon = '<i class="fas fa-globe"></i>';

        const deviceIdDisplay = u.deviceId ? `<br><small class="text-medium" style="font-size:0.7em">ID: ${u.deviceId.substring(0, 12)}...</small>` : '';

        html += `<tr>
                    <td>
                        <strong>${u.fullname}</strong>${deviceIdDisplay}<br>
                        <small class="text-medium">${icon} ${deviceName}</small>
                    </td>
                    <td>
                        <span style="font-family:monospace; color:var(--color-info-text);">${ipAddress}</span>
                    </td>
                    <td style="font-weight:bold; color:${timeColor}">
                        ${timeString}
                    </td>
                </tr>`;
    });

    html += `</tbody></table>`;
    if (container) container.innerHTML = html;
}

function closeActiveConnectionsModal() {
    if (window.connectionInterval) {
        clearInterval(window.connectionInterval);
        window.connectionInterval = null;
    }
    closeModal('activeConnectionsModal');
}
window.closeActiveConnectionsModal = closeActiveConnectionsModal;


/* --- ADMIN AI INTELLIGENCE --- */
async function openAdminAI() {
    window.openChatBotModal();
    const log = document.getElementById('chatLog');
    const d = adminChartDataCache;

    if (!d || !d.revenueTrend) {
        window.sendChatMessage();
        return;
    }

    const analysisPrompt = `
    ACT AS A BUSINESS INTELLIGENCE ANALYST for 'Power Connect' ISP.
    
    Here is the data for the last ${d.period}:
    1. FINANCIALS:
       - Total Revenue: $${d.revenue.toFixed(2)} (Growth: ${d.growth} vs previous period)
       - ARPU: $${d.arpu}
       - Peak Sales Day: ${d.peakDay}
    
    2. NETWORK HEALTH:
       - Total Registered Users: ${d.totalUsers}
       - Active Users: ${d.activeUsers}
    
    3. PRODUCT PERFORMANCE:
       ${d.planStats.map(p => `- ${p.name}: Sold ${p.sales}, Active ${p.active}, Retention ${p.conversion}%`).join('\n')}

    TASK:
    Provide a bullet-point report.
    - **Trend Analysis**: Is the growth positive?
    - **Product Insight**: Which plan has the best retention?
    - **Actionable Advice**: One specific marketing move.
    `;

    const loadingId = 'admin-loading-' + Date.now();
    const div = document.createElement('div');
    div.className = 'chat-message bot';
    div.innerHTML = `<div class="bot-avatar"><i class="fas fa-brain"></i></div><div class="bubble bot" id="${loadingId}">Analyzing growth rates and user retention...</div>`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;

    try {
        const reply = await AIService.generate(analysisPrompt);

        const bubble = document.getElementById(loadingId);
        const formattedReply = reply
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br/>');

        if (bubble) bubble.innerHTML = `<strong>📈 Intelligence Report:</strong><br/><br/>${formattedReply}`;

    } catch (e) {
        const bubble = document.getElementById(loadingId);
        if (bubble) bubble.innerHTML = "⚠️ AI Connection Error.";
    }
}

async function renderUserManagement() {
    const container = document.getElementById('userListContainer');
    const allUsers = AppData.users;

    if (allUsers.length === 0) {
        container.innerHTML = `<p class="text-medium">Loading users...</p>`;
        return;
    }

    const { data, totalPages } = window.Pagination.getPageData(allUsers, 'users');

    let html = `<table class="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Credits</th><th>Role</th><th></th></tr></thead><tbody>`;
    data.forEach(user => {
        html += `<tr><td>${user.fullname}</td><td>${user.email}</td><td>$${(user.credits || 0).toFixed(2)}</td><td>${user.role}</td><td style="text-align: right;"><button class="btn btn-sm" onclick="openAdminUserModal('${user.id}')">Edit</button></td></tr>`;
    });
    html += `</tbody></table>`;
    html += window.Pagination.renderControls('users', totalPages, 'renderUserManagement');
    container.innerHTML = html;
}

async function openAdminUserModal(uid) {
    openUnifiedProfile(uid);
}

async function openUnifiedProfile(uid) {
    let user = AppData.users.find(u => u.id === uid);
    if (!user) {
        window.Loading.show('Fetching profile...');
        try {
            user = await DataStore.getUser(uid);
        } catch (e) {
            window.Loading.hide();
            return showToast('User profile not found', 'error');
        }
        window.Loading.hide();
    }

    if (!user) return showToast('User not found', 'error');

    document.getElementById('adminUserModalTitle').textContent = `User Profile: ${user.fullname || user.username}`;
    document.getElementById('adminUserId').value = user.id;
    document.getElementById('adminUserFullname').value = user.fullname || '';
    document.getElementById('adminUserEmail').value = user.email || '';
    document.getElementById('adminUserCredits').value = user.credits || 0;
    document.getElementById('adminUserRole').value = user.role || 'user';

    // Add extra info if available
    const extraInfo = document.getElementById('adminUserExtraInfo') || document.createElement('div');
    extraInfo.id = 'adminUserExtraInfo';
    extraInfo.innerHTML = `
        <div style="margin-top:15px; padding:10px; background:var(--color-sidebar); border-radius:8px; font-size:0.85rem;">
            <p><strong>Username:</strong> ${user.username}</p>
            <p><strong>Device ID:</strong> ${user.deviceId || 'Unknown'}</p>
            <p><strong>Created:</strong> ${user.createdAt ? (user.createdAt.toDate ? user.createdAt.toDate().toLocaleString() : new Date(user.createdAt).toLocaleString()) : 'N/A'}</p>
            <p><strong>Active Plans:</strong> ${(user.subscriptions || []).filter(s => checkSubscriptionStatus(s)).length}</p>
        </div>
    `;

    const form = document.getElementById('adminUserForm');
    if (form && !document.getElementById('adminUserExtraInfo')) {
        form.insertBefore(extraInfo, form.querySelector('.modal-actions'));
    } else if (document.getElementById('adminUserExtraInfo')) {
        document.getElementById('adminUserExtraInfo').replaceWith(extraInfo);
    }

    openModal('adminUserModal');
}

async function saveAdminUser(event) {
    event.preventDefault();
    const userId = document.getElementById('adminUserId').value;
    const data = {
        fullname: document.getElementById('adminUserFullname').value,
        credits: parseFloat(document.getElementById('adminUserCredits').value),
        role: document.getElementById('adminUserRole').value
    };
    try {
        await DataStore.updateUser(userId, data);
        closeModal('adminUserModal');
        showToast('User updated successfully!', 'success');
        renderUserManagement();
    } catch (e) {
        showToast(`Error updating user: ${e.message}`, 'error');
    }
}

async function renderPlanManagementAdmin() {
    const container = document.getElementById('planListAdminContainer');
    if (!container) return;

    const plans = AppData.plans;
    if (!plans || plans.length === 0) {
        container.innerHTML = `<p class="text-medium">Loading plans...</p>`;
        return;
    }

    let html = `<table class="admin-table"><thead><tr><th>Image</th><th>Name</th><th>Price</th><th>Duration</th><th>Devices</th><th>Quota</th><th></th></tr></thead><tbody>`;
    plans.forEach(plan => {
        const imageThumb = plan.imageUrl
            ? `<img src="${plan.imageUrl}" alt="Plan image" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">`
            : `<span class="text-medium">No Image</span>`;
        const dataDisplay = plan.dataLimit > 0 ? `${plan.dataLimit} GB` : 'Unlim.';
        html += `<tr><td>${imageThumb}</td><td>${plan.name}</td><td>$${plan.price.toFixed(2)}</td><td>${plan.durationValue || plan.durationDays} ${plan.durationUnit || 'day'}${plan.durationValue > 1 ? 's' : ''}</td><td>${plan.deviceLimit}</td><td>${dataDisplay}</td><td style="text-align: right;"><button class="btn btn-sm" onclick="openAdminPlanModal('${plan.id}')">Edit</button></td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

async function openAdminPlanModal(planId = null) {
    // Null-safe DOM helpers — a missing field (e.g. a cache mismatch between a
    // stale index.html and fresh app.js) must never throw and leave the modal
    // unopened. Better to open with the fields that exist.
    const $id = (id) => document.getElementById(id);
    const setVal = (id, v) => { const el = $id(id); if (el) el.value = v; };
    const setText = (id, t) => { const el = $id(id); if (el) el.textContent = t; };

    $id('adminPlanForm')?.reset();
    $id('deletePlanBtn')?.classList.add('hidden');
    const preview = $id('adminPlanImagePreview');
    if (preview) { preview.src = ''; preview.classList.remove('visible'); }
    const placeholder = $id('imageUploadPlaceholder');
    if (placeholder) placeholder.style.display = 'block';

    if (planId) {
        const plans = AppData.plans || [];
        const plan = plans.find(p => p.id === planId);
        if (plan) {
            setText('adminPlanModalTitle', 'Edit Plan');
            setVal('adminPlanId', plan.id);
            setVal('adminPlanName', plan.name);
            setVal('adminPlanDesc', plan.description);
            setVal('adminPlanPrice', plan.price);
            setVal('adminPlanDuration', plan.durationValue || plan.durationDays);
            if (plan.durationUnit) setVal('adminPlanDurationUnit', plan.durationUnit);
            setVal('adminPlanDevices', plan.deviceLimit);
            setVal('adminPlanDataLimit', plan.dataLimit || 0);
            setVal('adminPlanImageUrl', plan.imageUrl || '');
            if (plan.imageUrl && preview) {
                preview.src = plan.imageUrl;
                preview.classList.add('visible');
                if (placeholder) placeholder.style.display = 'none';
            }
            const delBtn = $id('deletePlanBtn');
            if (delBtn) { delBtn.classList.remove('hidden'); delBtn.onclick = () => deleteAdminPlan(planId); }
        } else {
            showToast('Plan not found — it may still be loading. Try again.', 'warning');
            return;
        }
    } else {
        setText('adminPlanModalTitle', 'Add New Plan');
    }
    const uploadBtn = $id('uploadPlanImageBtn');
    if (uploadBtn) uploadBtn.onclick = handlePlanImageSelection;
    openModal('adminPlanModal');
}

async function handlePlanImageSelection() {
    // Check for Camera AND if the Camera constant is defined to prevent ReferenceError in browser/unsupported envs
    if (navigator.camera && typeof Camera !== 'undefined') {
        const options = {
            quality: 75,
            destinationType: Camera.DestinationType.DATA_URL,
            sourceType: Camera.PictureSourceType.PHOTOLIBRARY,
            mediaType: Camera.MediaType.PICTURE,
            encodingType: Camera.EncodingType.JPEG,
            allowEdit: true,
            targetWidth: 600,
            targetHeight: 600
        };
        navigator.camera.getPicture(
            (imageData) => uploadImageToFirebase("data:image/jpeg;base64," + imageData),
            (err) => {
                if (err !== "Selection cancelled." && err !== "No image selected.") {
                    showToast("Camera error, trying file browser...", "info");
                    triggerBrowserUpload();
                }
            },
            options
        );
    } else {
        triggerBrowserUpload();
    }
}

function triggerBrowserUpload() {
    const fileInput = document.getElementById('browserFileInput');
    if (!fileInput) return;
    fileInput.value = '';
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            uploadImageToFirebase(event.target.result);
        };
        reader.readAsDataURL(file);
    };
    fileInput.click();
}

async function uploadImageToFirebase(dataUrl) {
    const preview = document.getElementById('adminPlanImagePreview');
    const placeholder = document.getElementById('imageUploadPlaceholder');
    preview.src = dataUrl;
    preview.classList.add('visible');
    if (placeholder) placeholder.style.display = 'none';

    window.Loading.show('Uploading image...');
    try {
        const fileName = `plans/img_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
        const storageRef = storage.ref().child(fileName);
        const uploadTask = await storageRef.putString(dataUrl, 'data_url');
        const downloadURL = await uploadTask.ref.getDownloadURL();
        document.getElementById('adminPlanImageUrl').value = downloadURL;
        showToast('Image uploaded successfully!', 'success');
    } catch (e) {
        console.error('Upload failed:', e);
        showToast(`Upload failed: ${e.message}`, 'error');
    } finally {
        window.Loading.hide();
    }
}

async function saveAdminPlan(event) {
    event.preventDefault();
    window.Loading.show('Saving plan...');
    const planId = document.getElementById('adminPlanId').value || null;
    const data = {
        name: document.getElementById('adminPlanName').value,
        description: document.getElementById('adminPlanDesc').value,
        price: parseFloat(document.getElementById('adminPlanPrice').value),
        durationUnit: document.getElementById('adminPlanDurationUnit')?.value || 'days',
        durationValue: parseInt(document.getElementById('adminPlanDuration').value),
        deviceLimit: parseInt(document.getElementById('adminPlanDevices').value),
        dataLimit: parseFloat(document.getElementById('adminPlanDataLimit').value) || 0,
        imageUrl: document.getElementById('adminPlanImageUrl').value.trim()
    };
    try {
        await DataStore.savePlan(planId, data);
        window.Loading.hide();
        closeModal('adminPlanModal');
        showToast('Plan saved successfully!', 'success');
        renderPlanManagementAdmin();
        updatePlans();
    } catch (e) {
        window.Loading.hide();
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function deleteAdminPlan(planId) {
    if (!confirm('Are you sure you want to delete this plan? This cannot be undone.')) return;
    try {
        await DataStore.deletePlan(planId);
        closeModal('adminPlanModal');
        showToast('Plan deleted successfully', 'success');
        renderPlanManagementAdmin();
        updatePlans();
    } catch (e) {
        showToast(`Error deleting plan: ${e.message}`, 'error');
    }
}

/*  =====  VOUCHER ADMIN  =====  */
function openGenerateVoucherModal() {
    document.getElementById('generateVoucherForm').reset();
    openModal('generateVoucherModal');
}

async function generateVouchersLogic(value, quantity) {
    const batch = db.batch();
    const codes = [];
    for (let i = 0; i < quantity; i++) {
        const code = 'STAR-' + Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
        codes.push(code);
        const docRef = db.collection('vouchers').doc();
        batch.set(docRef, {
            code: code,
            value: value,
            used: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    await batch.commit();
    return codes;
}

function buildVoucherReceiptHTML(codes, value) {
    return codes.map(code => `
        <div style="border-bottom: 1px dashed #ccc; padding: 16px 0; text-align: center;">
            <h2>Power Connect Voucher</h2>
            <p style="font-size: 1.4em; font-weight: bold; margin: 8px 0; letter-spacing: 2px;">${code}</p>
            <p>Value: $${value.toFixed(2)}</p>
            <p style="font-size: 0.85em;">Redeem in the app under "Redeem Code"</p>
        </div>
    `).join('');
}

async function generateVouchers(event) {
    event.preventDefault();
    const value = parseFloat(document.getElementById('voucherValue').value);
    const quantity = parseInt(document.getElementById('voucherQuantity').value);

    window.Loading.show('Generating...');
    try {
        const codes = await generateVouchersLogic(value, quantity);
        window.Loading.hide();
        closeModal('generateVoucherModal');
        showToast(`${quantity} vouchers generated!`, 'success');
        renderVoucherList();

        if (window.HardwarePrinter && window.HardwarePrinter.currentInterface !== 'none' && confirm(`Print ${quantity} voucher receipt(s) now?`)) {
            await window.HardwarePrinter.printReceipt(buildVoucherReceiptHTML(codes, value), 'Power Connect Vouchers');
        }
    } catch (e) {
        window.Loading.hide();
        showToast('Error: ' + e.message, 'error');
    }
}

function printVoucher(code, value) {
    if (!window.HardwarePrinter) return showToast('Printer module not loaded.', 'error');
    window.HardwarePrinter.printReceipt(buildVoucherReceiptHTML([code], value), 'Power Connect Voucher');
}
window.printVoucher = printVoucher;

async function renderVoucherList() {
    const container = document.getElementById('voucherListContainer');
    const allVouchers = AppData.vouchers || [];

    if (allVouchers.length === 0) {
        container.innerHTML = `<p class="text-medium">Loading vouchers...</p>`;
        return;
    }

    const { data, totalPages } = window.Pagination.getPageData(allVouchers, 'vouchers');

    let html = `<table class="admin-table"><thead><tr><th>Code</th><th>Value</th><th>Status</th><th>Used By</th><th></th></tr></thead><tbody>`;
    data.forEach(v => {
        const isExpired = v.expiresAt && v.expiresAt.seconds * 1000 < Date.now();
        let status, actions;
        if (v.used) {
            status = `<span style="color: var(--color-danger-text);">Used</span>`;
            actions = '';
        } else if (isExpired) {
            status = `<span style="color: var(--color-text-medium);">Expired</span>`;
            actions = `<button class="btn btn-sm btn-danger" onclick="deleteVoucher('${v.id}')">Delete</button>`;
        } else {
            status = `<span style="color: var(--color-success-text);">Active</span>`;
            actions = `
                <div class="btn-group">
                    <button class="btn btn-sm" onclick="printVoucher('${v.code}', ${v.value})"><i class="fas fa-print"></i></button>
                    <button class="btn btn-sm btn-info" onclick="openSendVoucherModal('${v.id}', '${v.code}', ${v.value})">Send</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteVoucher('${v.id}')">Delete</button>
                </div>`;
        }
        const usedBy = v.used && v.redeemedByUsername ? v.redeemedByUsername : '—';
        html += `<tr><td>${v.code}</td><td>$${v.value.toFixed(2)}</td><td>${status}</td><td class="text-medium">${usedBy}</td><td style="text-align:right;">${actions}</td></tr>`;
    });
    html += `</tbody></table>`;
    html += window.Pagination.renderControls('vouchers', totalPages, 'renderVoucherList');
    container.innerHTML = html;
}

async function deleteVoucher(voucherId) {
    if (!confirm('Are you sure you want to delete this voucher?')) return;
    try {
        await db.collection('vouchers').doc(voucherId).delete();
        showToast('Voucher deleted.', 'success');
        renderVoucherList();
    } catch (e) {
        showToast(`Error deleting voucher: ${e.message}`, 'error');
    }
}

async function openSendVoucherModal(voucherId, voucherCode, voucherValue) {
    const modal = document.getElementById('sendVoucherModal');
    modal.dataset.voucherId = voucherId;
    modal.dataset.voucherCode = voucherCode;
    modal.dataset.voucherValue = voucherValue;
    const userSelect = document.getElementById('voucherRecipient');
    userSelect.innerHTML = '<option>Loading users...</option>';
    try {
        const users = AppData.users;
        userSelect.innerHTML = users
            .filter(u => u.role !== 'admin')
            .map(user => `<option value="${user.id}">${user.fullname} (${user.email})</option>`)
            .join('');
    } catch (e) {
        userSelect.innerHTML = '<option>Could not load users.</option>';
    }
    openModal('sendVoucherModal');
}

async function sendVoucherToUser(event) {
    event.preventDefault();
    const modal = document.getElementById('sendVoucherModal');
    const recipientId = document.getElementById('voucherRecipient').value;
    if (!recipientId) return showToast('Please select a user.', 'error');
    const { voucherId, voucherCode, voucherValue } = modal.dataset;
    const recipientUser = await DataStore.getUser(recipientId);
    if (!confirm(`Send voucher ${voucherCode} to ${recipientUser.fullname}?`)) return;
    try {
        const batch = db.batch();
        const voucherRef = db.collection('vouchers').doc(voucherId);
        batch.update(voucherRef, {
            used: true,
            usedBy: recipientId,
            redeemedByUsername: `Sent by ${currentUser.fullname ? ` (${currentUser.fullname})` : ''} to ${recipientUser.fullname}`,
            usedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        const userRef = db.collection('users').doc(recipientId);
        batch.update(userRef, { credits: firebase.firestore.FieldValue.increment(parseFloat(voucherValue)) });
        const txRef = db.collection('transactions').doc();
        batch.set(txRef, {
            userId: recipientId,
            type: 'admin_grant',
            description: `Voucher received from ${currentUser.fullname}: ${voucherCode}`,
            amount: parseFloat(voucherValue),
            voucherCode,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        await batch.commit();
        await DataStore.sendSystemMessage(recipientId, `${recipientUser.fullname}`, `Hello ${recipientUser.fullname},\n\nWe've added a voucher worth $${parseFloat(voucherValue).toFixed(2)} to your account.\n\nYour code is: ${voucherCode}\n\nThe credit has already been applied to your balance.\n\nEnjoy!`);
        await DataStore.setUserNotification(recipientId, {
            type: 'voucher',
            title: 'Credit Added!',
            message: `You received a $${parseFloat(voucherValue).toFixed(2)} voucher! Code: ${voucherCode}`,
            code: voucherCode
        });
        showToast(`Voucher sent successfully to ${recipientUser.fullname}.`, 'success');
        closeModal('sendVoucherModal');
        renderVoucherList();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

/*  =====  NETWORK ADMIN  =====  */
async function renderNetworkSettings() {
    const network = await DataStore.getNetworkSettings();
    document.getElementById('networkSettingsDisplay').innerHTML = `<p><strong>SSID:</strong> ${network.ssid}</p><p><strong>Password:</strong> <em class="text-medium">••••••••</em> <button class="btn btn-sm" onclick="revealPassword(event, '${network.password}')">Show</button></p>`;
    document.getElementById('adminNetworkSsid').value = network.ssid;
    document.getElementById('adminNetworkPassword').value = network.password;
}

function revealPassword(event, pwd) {
    if (currentUser.role !== 'admin') return showToast('Unauthorized', 'error');
    const btn = event.target;
    const passwordElement = btn.previousElementSibling;
    if (btn.textContent === 'Show') {
        passwordElement.textContent = pwd;
        btn.textContent = 'Hide';
    } else {
        passwordElement.textContent = '••••••••';
        btn.textContent = 'Show';
    }
}

function openEditNetworkModal() {
    openModal('adminNetworkModal');
}

async function saveNetworkSettings(event) {
    event.preventDefault();
    const ssid = document.getElementById('adminNetworkSsid').value;
    const password = document.getElementById('adminNetworkPassword').value;
    const isHiddenSSID = document.getElementById('adminNetworkHidden')?.checked || false;
    
    const mikrotikIp = document.getElementById('adminMikrotikIp')?.value || '';
    const mikrotikUser = document.getElementById('adminMikrotikUser')?.value || '';
    const mikrotikPass = document.getElementById('adminMikrotikPass')?.value || '';

    const data = { 
        ssid, 
        password, 
        isHiddenSSID,
        mikrotikIp,
        mikrotikUser,
        mikrotikPass
    };

    try {
        window.Loading.show('Updating network settings...');
        await DataStore.updateNetworkSettings(data);
        closeModal('adminNetworkModal');
        showToast('Network settings updated!', 'success');
        await renderNetworkSettings();

        if (window.NetworkTools && window.NetworkTools.isPluginAvailable()) {
            setTimeout(async () => {
                showToast('Attempting to connect to new network...', 'info');
                await window.NetworkTools.autoConnectToConfiguredWifi(data);
            }, 500);
        }
    } catch (e) {
        showToast(`Error updating network: ${e.message}`, 'error');
    } finally {
        window.Loading.hide();
    }
}

/* ===== PARTNER NETWORK MANAGEMENT ===== */
async function renderPartnerNetworks() {
    const container = document.getElementById('partnerNetworksList');
    if (!container) return;

    container.innerHTML = '<p class="text-medium">Loading your networks...</p>';

    try {
        const networks = await DataStore.getPartnerNetworks(currentUser.id);

        if (networks.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 30px;">
                    <i class="fas fa-broadcast-tower" style="font-size: 3rem; color: var(--color-text-medium); margin-bottom: 15px;"></i>
                    <p class="text-medium">You haven't added any WiFi networks yet.</p>
                    <p class="text-medium">Add your hotspot to let users roam to your location!</p>
                </div>
            `;
            // Still render stats (will be 0)
            renderPartnerStats();
            return;
        }

        container.innerHTML = networks.map(net => {
            const hasHardware = !!net.mikrotikIp;
            const statusColor = net.active ? 'var(--color-success)' : 'var(--color-text-medium)';
            const hardwareIcon = hasHardware ? '<i class="fas fa-microchip" style="margin-left:5px; font-size:0.8rem; color:var(--color-info);"></i>' : '';
            
            return `
            <div class="partner-network-item">
                <div>
                    <h4 style="margin: 0;">
                        <i class="fas fa-wifi" style="color:${statusColor};"></i> ${net.ssid}
                        ${hardwareIcon}
                    </h4>
                    <p class="text-medium" style="margin: 5px 0 0 0;">
                        <i class="fas fa-map-marker-alt" style="font-size:0.8rem;"></i> ${net.locationName || 'No location set'} 
                        <span class="badge ${net.active ? 'badge-success' : 'badge-secondary'}" style="margin-left:8px;">${net.active ? 'Active' : 'Inactive'}</span>
                    </p>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${hasHardware ? `<div class="status-dot" title="Hardware linked" style="background:var(--color-info);"></div>` : ''}
                    <button class="btn btn-sm btn-ghost" onclick="editPartnerNetwork('${net.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deletePartnerNetwork('${net.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;}).join('');

        // Refresh stats
        renderPartnerStats();

    } catch (e) {
        container.innerHTML = `<p class="text-danger">Error loading networks: ${e.message}</p>`;
    }
}

async function renderPartnerStats() {
    const logContainer = document.getElementById('partnerUsageLogs');
    const totalConnsEl = document.getElementById('partnerTotalConnections');
    const uniqueUsersEl = document.getElementById('partnerUniqueUsers');
    const totalEarningsEl = document.getElementById('partnerTotalEarnings');

    if (!logContainer || !totalConnsEl || !uniqueUsersEl) return;

    try {
        const logs = await DataStore.getPartnerUsageStats(currentUser.id);
        const estRate = 0.05;

        // Stats Calculation
        totalConnsEl.textContent = logs.length;
        if (totalEarningsEl) totalEarningsEl.textContent = `$${(logs.length * estRate).toFixed(2)}`;

        // Unique Users
        const uniqueUsers = new Set(logs.map(l => l.userId));
        uniqueUsersEl.textContent = uniqueUsers.size;

        if (logs.length === 0) {
            logContainer.innerHTML = '<p class="text-medium" style="padding: 10px;">No connection events logged yet.</p>';
            return;
        }

        logContainer.innerHTML = `
            <table class="admin-table" style="font-size: 0.85rem;">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Network</th>
                        <th>User ID</th>
                        <th>Comm.</th>
                    </tr>
                </thead>
                <tbody>
                    ${logs.slice(0, 20).map(log => {
            const date = log.timestamp ? log.timestamp.toDate() : new Date();
            const timeStr = date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const estComm = 0.05; // Placeholder rate per connection
            return `
                            <tr>
                                <td>${timeStr}</td>
                                <td>${log.networkId.substring(0, 8)}...</td>
                                <td>${log.userId.substring(0, 8)}...</td>
                                <td style="color:var(--color-success-text); font-weight:bold;">$${estComm.toFixed(2)}</td>
                            </tr>
                        `;
        }).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        console.error('Partner stats error:', e);
        logContainer.innerHTML = '<p class="text-danger">Failed to load stats.</p>';
    }
}

function openAddPartnerNetworkModal() {
    document.getElementById('partnerNetworkForm').reset();
    document.getElementById('partnerNetworkId').value = '';
    document.getElementById('partnerNetworkModalTitle').textContent = 'Add WiFi Network';
    openModal('partnerNetworkModal');
}

async function editPartnerNetwork(networkId) {
    try {
        const networks = await DataStore.getPartnerNetworks(currentUser.id);
        const network = networks.find(n => n.id === networkId);
        if (!network) return showToast('Network not found', 'error');

        document.getElementById('partnerNetworkId').value = networkId;
        document.getElementById('partnerNetworkSsid').value = network.ssid;
        document.getElementById('partnerNetworkPassword').value = network.password;
        document.getElementById('partnerNetworkLocation').value = network.locationName || '';
        document.getElementById('partnerNetworkActive').checked = network.active;
        if (document.getElementById('partnerNetworkHidden')) {
            document.getElementById('partnerNetworkHidden').checked = network.isHiddenSSID || false;
        }
        document.getElementById('partnerMikrotikIp').value = network.mikrotikIp || '';
        document.getElementById('partnerMikrotikUser').value = network.mikrotikUser || '';
        document.getElementById('partnerMikrotikPass').value = network.mikrotikPass || '';
        document.getElementById('partnerNetworkModalTitle').textContent = 'Edit WiFi Network';

        openModal('partnerNetworkModal');
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

async function savePartnerNetworkLogic(networkId, data) {
    if (networkId) {
        await DataStore.updatePartnerNetwork(networkId, data);
        return 'Network updated!';
    } else {
        await DataStore.addPartnerNetwork(data);
        return 'Network added to roaming pool!';
    }
}

async function testPartnerHardware() {
    const ip = document.getElementById('partnerMikrotikIp').value.trim();
    const user = document.getElementById('partnerMikrotikUser').value.trim();
    const pass = document.getElementById('partnerMikrotikPass').value;
    const statusContainer = document.getElementById('partnerHardwareStatus');
    const statusText = document.getElementById('partnerHardwareStatusText');

    if (!ip) {
        showToast("Enter a Router IP address first", 'warning');
        return;
    }

    if (!window.RouterBridge) {
        showToast("RouterBridge plugin not available", 'error');
        return;
    }

    statusContainer.style.display = 'block';
    statusText.textContent = "Testing connection...";
    statusText.style.color = "var(--color-text-medium)";

    try {
        const result = await window.RouterBridge.testConnection(ip, user, pass);
        if (result.success) {
            statusText.textContent = `✅ Hardware Verified: MikroTik ${result.version || ''}`;
            statusText.style.color = "var(--color-success-text)";
            showToast("Hardware link successful!", 'success');
        } else {
            throw new Error(result.error || "Connection failed");
        }
    } catch (e) {
        statusText.textContent = `❌ ${e.message}`;
        statusText.style.color = "var(--color-danger-text)";
        showToast(`Hardware Test Failed: ${e.message}`, 'error');
    }
}

window.testPartnerHardware = testPartnerHardware;

async function savePartnerNetwork(event) {
    event.preventDefault();
    window.Loading.show('Saving network...');

    const networkId = document.getElementById('partnerNetworkId').value;
    const data = {
        partnerId: currentUser.id,
        partnerName: currentUser.fullname || currentUser.username,
        ssid: document.getElementById('partnerNetworkSsid').value.trim(),
        password: document.getElementById('partnerNetworkPassword').value,
        locationName: document.getElementById('partnerNetworkLocation').value.trim(),
        active: document.getElementById('partnerNetworkActive').checked,
        isHiddenSSID: document.getElementById('partnerNetworkHidden')?.checked || false,
        mikrotikIp: document.getElementById('partnerMikrotikIp')?.value.trim() || '',
        mikrotikUser: document.getElementById('partnerMikrotikUser')?.value.trim() || '',
        mikrotikPass: document.getElementById('partnerMikrotikPass')?.value || '',
        lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        const msg = await savePartnerNetworkLogic(networkId, data);
        showToast(msg, 'success');
        closeModal('partnerNetworkModal');
        await renderPartnerNetworks();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    } finally {
        window.Loading.hide();
    }
}

async function deletePartnerNetwork(networkId) {
    if (!confirm('Delete this network? Users will no longer be able to connect to it.')) return;

    try {
        await DataStore.deletePartnerNetwork(networkId);
        showToast('Network removed from roaming pool.', 'success');
        await renderPartnerNetworks();
    } catch (e) {
        showToast(`Error: ${e.message}`, 'error');
    }
}

/* ===== ROAMING LOGIC ===== */
async function renderRoamingSection() {
    const container = document.getElementById('roamingNetworksList');
    if (!container) return;

    container.innerHTML = '<p class="text-medium">Scanning for roaming hotspots...</p>';

    try {
        const settings = await DataStore.getNetworkSettings();
        const networks = settings.partnerNetworks || [];
        const hasPlan = hasActivePlanNow();

        const introHtml = `
            <div class="card" style="grid-column: 1 / -1; background: rgba(var(--color-primary-rgb), 0.1); border-left: 4px solid var(--color-primary); margin-bottom: 10px;">
                <p class="text-medium" style="margin: 0; padding: 10px;">
                    <i class="fas fa-magic"></i> <strong>Magic Roaming:</strong> On supported Android devices, your phone will automatically suggest and connect to these networks!
                </p>
            </div>
        `;

        if (networks.length === 0) {
            container.innerHTML = '<p class="text-medium" style="grid-column: 1 / -1; text-align: center; padding: 20px;">No partner networks found in your area yet.</p>';
            return;
        }

        container.innerHTML = introHtml + networks.map(net => `
            <div class="card" style="padding: 15px;">
                <div style="font-size: 1.5rem; color: var(--color-primary); margin-bottom: 5px;"><i class="fas fa-wifi"></i></div>
                <h4 style="margin: 0;">${net.ssid}</h4>
                <p class="text-medium" style="font-size: 0.8rem; margin: 4px 0 12px 0;"><i class="fas fa-map-marker-alt"></i> ${net.locationName || 'Roaming Zone'}</p>
                ${hasPlan
                ? `<button class="btn btn-sm btn-block btn-primary" onclick="connectToRoamingNetwork('${net.id}', '${net.partnerId}', '${net.ssid}', '${net.password}')">Connect Now</button>`
                : `<button class="btn btn-sm btn-block" disabled title="Active plan required">Locked</button>`}
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = `<p class="text-danger">Failed to scan: ${e.message}</p>`;
    }
}

async function connectToRoamingNetwork(networkId, partnerId, ssid, password) {
    if (!confirm(`Connect to "${ssid}" roaming hotspot?`)) return;

    // 1. Log the connection event for the partner
    await DataStore.logConnection(networkId, partnerId, currentUser.id);

    // 2. Attempt physical connection if on mobile/Cordova
    if (window.NetworkTools && window.NetworkTools.isPluginAvailable()) {
        showToast(`Connecting to ${ssid}...`, 'info');
        try {
            await window.NetworkTools.autoConnectToConfiguredWifi({ ssid, password });
            showToast(`Successfully connected to ${ssid}!`, 'success');

            // Trigger device info update to capture new IP
            if (typeof window.captureLocalDeviceInfo === 'function') {
                window.captureLocalDeviceInfo().catch(() => { });
            }
        } catch (e) {
            showToast(`Auto-connect unavailable — suggesting network instead.`, 'info');
            // Hand the network to the OS (native suggestConnection or Wi-Fi QR)
            await WifiHandoff.suggest(ssid, password);
        }
    } else {
        // Browser/desktop/PWA: suggest the network to the OS via Wi-Fi QR.
        showToast("Roaming access granted — scan to connect.", "success");
        await WifiHandoff.suggest(ssid, password);
    }
}

/* ===================================================================
   WI-FI HANDOFF — "give the PWA hands like suggestConnection"
   Native Android has WifiWizard2.suggestConnection() to push an SSID+
   password into the OS. The web platform has NO such API, so on the web
   we hand the credentials to the OS the only way a browser can: a standard
   Wi-Fi QR (WIFI:T:WPA;S:..;P:..;;) that the phone camera turns into a real
   "Join network?" OS prompt, plus Web Share and clipboard.
   =================================================================== */
const WifiHandoff = {
    // Escape per the Wi-Fi QR spec: backslash, semicolon, comma, colon, quote.
    _esc(v) { return String(v == null ? '' : v).replace(/([\\;,:"])/g, '\\$1'); },

    buildPayload(ssid, password, security = 'WPA', hidden = false) {
        const t = password ? security : 'nopass';
        return `WIFI:T:${t};S:${this._esc(ssid)};${password ? `P:${this._esc(password)};` : ''}${hidden ? 'H:true;' : ''};`;
    },

    // Unified entry point — same name/shape as the native path.
    async suggest(ssid, password, opts = {}) {
        const security = opts.security || 'WPA';
        const hidden = !!opts.hidden;

        // 1. Native: real OS suggestion via the Cordova plugin.
        if (typeof WifiWizard2 !== 'undefined' && typeof WifiWizard2.suggestConnection === 'function') {
            try {
                await WifiWizard2.suggestConnection(ssid, password, security, hidden);
                showToast(`Suggested "${ssid}" to your device. Approve it in the Wi-Fi prompt.`, 'success');
                return { method: 'native' };
            } catch (e) {
                console.warn('[WifiHandoff] native suggestConnection failed, showing QR:', e);
            }
        }

        // 2. Web: Wi-Fi QR + share + copy (the OS reads the QR and offers to join).
        window._wifiSuggestState = { ssid, password, payload: this.buildPayload(ssid, password, security, hidden) };
        document.getElementById('wifiSuggestSsid').innerText = ssid;
        document.getElementById('wifiSuggestSsid2').innerText = ssid;
        document.getElementById('wifiSuggestPass').innerText = password || '(open network)';
        document.getElementById('wifiShareBtn').style.display = navigator.share ? '' : 'none';

        const container = document.getElementById('wifiQrContainer');
        container.innerHTML = '';
        try {
            if (typeof window.QRCode === 'undefined') throw new Error('QR library not loaded');
            const dataUrl = await window.QRCode.toDataURL(window._wifiSuggestState.payload, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
            const img = document.createElement('img');
            img.src = dataUrl;
            img.alt = `Wi-Fi QR for ${ssid}`;
            img.style.cssText = 'width:240px;height:240px;max-width:100%;';
            container.appendChild(img);
        } catch (e) {
            container.innerHTML = `<p style="color:#900;padding:20px;">Could not render QR. Use the credentials below.</p>`;
            console.warn('[WifiHandoff] QR render failed:', e);
        }
        openModal('wifiSuggestModal');
        return { method: 'qr' };
    }
};
window.WifiHandoff = WifiHandoff;

// Expose a suggestConnection() on the web too, so callers can use one name.
window.suggestConnection = (ssid, password, opts) => WifiHandoff.suggest(ssid, password, opts);

window.copyWifiPassword = async function () {
    const pass = window._wifiSuggestState?.password;
    if (!pass) return showToast('This is an open network — no password.', 'info');
    try {
        await navigator.clipboard.writeText(pass);
        showToast('Password copied. 📋', 'success');
    } catch (e) {
        showToast('Copy failed — long-press the password to copy.', 'warning');
    }
};

window.shareWifiCredentials = async function () {
    const s = window._wifiSuggestState;
    if (!s) return;
    const text = `Join Wi-Fi "${s.ssid}"${s.password ? ` — password: ${s.password}` : ' (open network)'}`;
    try {
        if (navigator.share) await navigator.share({ title: 'Wi-Fi Access', text });
        else { await navigator.clipboard.writeText(text); showToast('Credentials copied.', 'success'); }
    } catch (e) { /* user cancelled share */ }
};

window.openWifiSettingsHint = function () {
    if (window.NetworkTools?.openWifiSettings) window.NetworkTools.openWifiSettings();
    else showToast('Open your device Settings → Wi-Fi to connect.', 'info');
};

window.renderRoamingSection = renderRoamingSection;
window.connectToRoamingNetwork = connectToRoamingNetwork;

// Export partner functions
window.renderPartnerNetworks = renderPartnerNetworks;
window.openAddPartnerNetworkModal = openAddPartnerNetworkModal;
window.editPartnerNetwork = editPartnerNetwork;
window.savePartnerNetwork = savePartnerNetwork;
window.deletePartnerNetwork = deletePartnerNetwork;

/*  =====  MISC  =====  */
function openModal(modalId) {
    document.getElementById(modalId)?.classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove('active');
    // If closing connections modal, clear interval
    if (modalId === 'activeConnectionsModal' && connectionInterval) {
        clearInterval(connectionInterval);
        connectionInterval = null;
    }
    // If closing ticket detail, clean up reply listener
    if (modalId === 'ticketDetailModal' && ticketReplyListener) {
        ticketReplyListener();
        ticketReplyListener = null;
        lastKnownReplyCount = 0;
    }
}

function showVoucherNotification(title, message, codeToCopy) {
    const toast = document.getElementById('toast');
    const iconEl = document.getElementById('toastIcon');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !iconEl || !msgEl) return;
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Code';
    copyButton.className = 'btn btn-sm';
    copyButton.style.marginLeft = '15px';
    copyButton.style.color = 'var(--color-background)';
    copyButton.style.backgroundColor = 'var(--color-text-light)';
    copyButton.onclick = () => {
        navigator.clipboard.writeText(codeToCopy).then(() => showToast('Code copied!', 'success')).catch(() => showToast('Failed to copy.', 'error'));
    };
    toast.style.backgroundColor = 'var(--color-info)';
    toast.style.color = 'var(--color-text-light)';
    iconEl.textContent = '🎁';
    msgEl.textContent = message;
    msgEl.innerHTML = '';
    msgEl.appendChild(document.createTextNode(message));
    msgEl.appendChild(copyButton);
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
        msgEl.innerHTML = '';
    }, 10000);
}

function triggerConfetti() {
    if (typeof confetti === 'function') {
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#00E5FF', '#1DE9B6', '#FFFFFF']
        });
    }
}

async function openMissionsModal() {
    const container = document.getElementById('missionsListContainer');
    if (!container) return;

    // Check actual progress
    const hasActive = hasActivePlanNow();
    const hasCredits = (currentUser.credits || 0) > 0;
    const isBound = !!(currentUser.deviceId);

    // Define missions
    const missions = [
        { id: 1, title: 'Network Pioneer', desc: 'Secure an active high-speed link.', icon: 'fa-broadcast-tower', completed: hasActive },
        { id: 2, title: 'Credit King', desc: 'Top up your account with credits.', icon: 'fa-gift', completed: hasCredits },
        { id: 3, title: 'Bound for Glory', desc: 'Bind your Hardware ID (UUID).', icon: 'fa-link', completed: isBound },
        { id: 4, title: 'Power Sharer', desc: 'Send credits to a friend via Chat.', icon: 'fa-paper-plane', completed: false }
    ];

    container.innerHTML = missions.map(m => `
        <div class="card" style="display: flex; align-items: center; gap: 15px; margin-bottom: 10px; padding: 12px; border-left: 4px solid ${m.completed ? 'var(--color-success-text)' : 'var(--color-border)'};">
            <div style="font-size: 1.5rem; color: ${m.completed ? 'var(--color-success-text)' : 'var(--color-text-medium)'};"><i class="fas ${m.icon}"></i></div>
            <div style="flex: 1;">
                <h4 style="margin: 0; font-size: 0.95rem;">${m.title}</h4>
                <p class="text-medium" style="margin: 3px 0 0 0; font-size: 0.8rem;">${m.desc}</p>
            </div>
            ${m.completed ? '<i class="fas fa-check-circle" style="font-size: 1.2rem; color: var(--color-success-text);"></i>' : '<button class="btn btn-sm btn-outline" style="font-size: 0.7rem; padding: 4px 8px;" onclick="closeModal(\'missionsModal\'); window.openChatBotModal();">Go!</button>'}
        </div>
    `).join('');

    openModal('missionsModal');
}

window.openMissionsModal = openMissionsModal;
window.triggerConfetti = triggerConfetti;

async function updateTransactionHistory() {
    const container = document.getElementById('transactionHistoryContainer');
    container.innerHTML = `<p class="text-medium" style="padding: 25px;">Loading...</p>`;
    try {
        const allTransactions = await DataStore.getTransactionsForUser(currentUser.id);
        if (!allTransactions.length) {
            container.innerHTML = `<p class="text-medium" style="padding: 25px;">No transactions found.</p>`;
            return;
        }
        const { data, totalPages } = window.Pagination.getPageData(allTransactions, 'transactions');
        let html = `<table class="admin-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>`;
        data.forEach(tx => {
            const amountColor = tx.amount < 0 ? 'var(--color-danger-text)' : 'var(--color-success-text)';
            const sign = tx.amount > 0 ? '+' : '';
            const dateStr = tx.timestamp ? tx.timestamp.toDate().toLocaleString() : 'N/A';
            html += `
                <tr>
                    <td class="text-medium">${dateStr}</td>
                    <td>${tx.description}</td>
                    <td style="color: ${amountColor}; font-weight: 600;">${sign}$${Math.abs(tx.amount).toFixed(2)}</td>
                </tr>`;
        });
        html += `</tbody></table>`;
        html += window.Pagination.renderControls('transactions', totalPages, 'updateTransactionHistory');
        container.innerHTML = html;
    } catch (err) {
        console.error("[History] Error loading transaction history:", err);
        container.innerHTML = `<p class="text-medium" style="padding: 25px;">Error loading history: ${err.message || 'Unknown error'}</p>`;
    }
}

function renderMessagesSection() {
    const container = document.getElementById('ticketListContainer');
    const tickets = AppData.tickets;
    if (!tickets.length) {
        container.innerHTML = `<p class="text-medium" style="padding: 25px;">No conversations yet.</p>`;
        return;
    }
    const { data, totalPages } = window.Pagination.getPageData(tickets, 'tickets');

    let html = `<div class="chat-list">`;
    data.forEach(ticket => {
        const name = ticket.userEmail || 'Unknown';
        const initials = name.trim().charAt(0).toUpperCase();
        const isOpen = (ticket.status || '').toLowerCase() === 'open';
        const dateObj = ticket.lastUpdate ? ticket.lastUpdate.toDate() : (ticket.createdAt ? ticket.createdAt.toDate() : new Date());
        const isToday = new Date().toDateString() === dateObj.toDateString();
        const timeStr = isToday
            ? dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });

        html += `
            <div class="chat-list-item" onclick="openTicketDetail('${ticket.id}')">
                <div class="chat-avatar">${initials}</div>
                <div class="chat-list-body">
                    <div class="chat-list-top">
                        <span class="chat-list-name">${ticket.subject}</span>
                        <span class="chat-list-time">${timeStr}</span>
                    </div>
                    <div class="chat-list-preview">
                        <span class="chat-list-snippet" onclick="event.stopPropagation(); openUnifiedProfile('${ticket.userId}')" style="text-decoration:underline; cursor:pointer;">${name}</span>
                        ${isOpen ? '<span class="chat-unread-dot"></span>' : `<span class="ticket-status-badge status-${ticket.status.toLowerCase()}">${ticket.status}</span>`}
                    </div>
                </div>
            </div>`;
    });
    html += `</div>`;
    html += window.Pagination.renderControls('tickets', totalPages, 'renderMessagesSection');
    container.innerHTML = html;
}


let emojiPickerInstance = null;

function toggleEmojiPicker() {
    const container = document.getElementById('emojiPicker');
    if (!container) return;

    if (!emojiPickerInstance) {
        // Initialize Emoji-Mart Picker
        const pickerOptions = {
            onEmojiSelect: (emoji) => {
                insertEmoji(emoji.native);
                container.classList.remove('active');
            },
            theme: 'dark',
            set: 'native',
            skinTonePosition: 'none',
            previewPosition: 'none'
        };

        if (typeof EmojiMart === 'undefined') {
            showToast("Emoji library window.Loading...", "info");
            return;
        }
        emojiPickerInstance = new EmojiMart.Picker(pickerOptions);
        container.appendChild(emojiPickerInstance);
    }

    container.classList.toggle('active');
}

function insertEmoji(char) {
    const input = document.getElementById('chatInput');
    if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const text = input.value;
        input.value = text.substring(0, start) + char + text.substring(end);

        // Restore cursor position
        const newPos = start + char.length;
        input.setSelectionRange(newPos, newPos);
        input.focus();

        // Trigger input event to update char icons
        input.dispatchEvent(new Event('input'));
    }
}

// Close emoji picker when clicking outside
document.addEventListener('click', (e) => {
    const picker = document.getElementById('emojiPicker');
    if (!picker || !picker.classList.contains('active')) return;

    // Check if click is outside picker and toggle button
    const toggleBtn = document.querySelector('button[onclick="toggleEmojiPicker()"]');
    if (!picker.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
        picker.classList.remove('active');
    }
});

/* ===================================================================
   WEB/PWA PERMISSIONS
   Cordova builds request runtime permissions via PermissionsHelper
   (index.js); on the web nothing ever asked. Browsers require a user
   gesture for Notification.requestPermission, so we show a banner with
   a button instead of requesting on load.
   =================================================================== */
window.requestWebNotifications = async function () {
    try {
        if (!('Notification' in window)) return showToast('Notifications are not supported in this browser.', 'warning');
        if (Notification.permission === 'granted') return showToast('Notifications are already enabled. ✅', 'success');
        if (Notification.permission === 'denied') {
            return showToast('Notifications are blocked — enable them for this site in your browser settings.', 'warning');
        }
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
            showToast('Notifications enabled! 🔔', 'success');
            try { new Notification('Power Connect', { body: 'You will now get plan expiry and credit alerts.', icon: 'img/logo.png' }); } catch (e) { }
        } else {
            showToast('Notifications not enabled.', 'info');
        }
    } catch (e) {
        console.warn('[Perms] Notification request failed:', e);
    } finally {
        document.getElementById('notifPermBanner')?.remove();
    }
};

window.requestWebLocation = async function () {
    try {
        if (!('geolocation' in navigator)) return showToast('Location is not supported in this browser.', 'warning');
        showToast('Requesting location…', 'info');
        const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }));
        const loc = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturedAt: Date.now()
        };
        window._lastKnownLocation = loc;
        if (window.currentUser && typeof db !== 'undefined' && auth?.currentUser) {
            await db.collection('users').doc(window.currentUser.id).update({
                lastLocation: loc,
                lastSeen: firebase.firestore.FieldValue.serverTimestamp()
            }).catch(e => console.warn('[Location] save failed:', e));
        }
        showToast('Location enabled. 📍', 'success');
        return loc;
    } catch (e) {
        // code 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        if (e && e.code === 1) showToast('Location blocked — enable it for this site in your browser settings.', 'warning');
        else showToast('Could not get your location. Please try again.', 'error');
        console.warn('[Location] request failed:', e);
        return null;
    } finally {
        document.getElementById('locPermBanner')?.remove();
    }
};

/* ── Permission Center (Settings) — live status for every permission ── */
const PermissionCenter = {
    async statuses() {
        const q = async (name) => {
            try { return (await navigator.permissions.query({ name })).state; } catch { return null; }
        };
        const notif = ('Notification' in window) ? Notification.permission : 'unsupported';
        const geo = navigator.permissions ? (await q('geolocation')) : ('geolocation' in navigator ? 'prompt' : 'unsupported');
        const cam = navigator.permissions ? (await q('camera')) : (navigator.mediaDevices ? 'prompt' : 'unsupported');
        let persisted = 'unsupported';
        if (navigator.storage?.persisted) persisted = (await navigator.storage.persisted()) ? 'granted' : 'prompt';
        return [
            { id: 'notifications', icon: '🔔', label: 'Notifications', desc: 'Plan expiry & credit alerts', state: notif === 'default' ? 'prompt' : notif, action: 'requestWebNotifications' },
            { id: 'location', icon: '📍', label: 'Location', desc: 'Find nearby hotspots', state: geo, action: 'requestWebLocation' },
            { id: 'camera', icon: '📷', label: 'Camera', desc: 'Scan voucher / Wi-Fi QR codes', state: cam, action: 'requestWebCamera' },
            { id: 'storage', icon: '💾', label: 'Offline Storage', desc: 'Keep you logged in & working offline', state: persisted, action: 'requestPersistentStorage' }
        ];
    },
    async render() {
        const host = document.getElementById('permissionCenter');
        if (!host) return;
        const rows = await this.statuses();
        const badge = (s) => {
            const map = {
                granted: ['✓ Enabled', 'var(--color-success-text,#2ecc71)'],
                denied: ['Blocked', 'var(--color-danger-text,#e74c3c)'],
                prompt: ['Enable', 'var(--color-info-text,#3498db)'],
                unsupported: ['N/A', 'var(--color-text-medium,#888)']
            };
            return map[s] || map.unsupported;
        };
        host.innerHTML = rows.map(r => {
            const [txt, color] = badge(r.state);
            const clickable = r.state === 'prompt' || r.state === 'denied';
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--color-border,#2a2a2a);">
                <span style="font-size:1.4rem;">${r.icon}</span>
                <div style="flex:1;"><div style="font-weight:600;">${r.label}</div><div class="text-medium" style="font-size:0.82rem;">${r.desc}</div></div>
                <button class="btn btn-sm" ${clickable ? `onclick="(async()=>{await ${r.action}();PermissionCenter.render();})()"` : 'disabled'} style="color:${color};border-color:${color};white-space:nowrap;">${txt}</button>
            </div>`;
        }).join('');
    }
};
window.PermissionCenter = PermissionCenter;

window.requestWebCamera = async function () {
    try {
        if (!navigator.mediaDevices?.getUserMedia) return showToast('Camera not supported in this browser.', 'warning');
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(t => t.stop()); // we only wanted the grant
        showToast('Camera enabled. 📷', 'success');
    } catch (e) {
        if (e.name === 'NotAllowedError') showToast('Camera blocked — enable it for this site in browser settings.', 'warning');
        else showToast('Could not access the camera.', 'error');
    }
};

window.requestPersistentStorage = async function () {
    try {
        if (!navigator.storage?.persist) return showToast('Persistent storage not supported.', 'warning');
        const granted = await navigator.storage.persist();
        showToast(granted ? 'Offline storage secured. 💾' : 'Storage may be cleared under low disk space.', granted ? 'success' : 'info');
    } catch (e) { showToast('Storage request failed.', 'error'); }
};

function maybePromptLocationPermission() {
    if (typeof cordova !== 'undefined') return;                  // Cordova handles its own perms
    if (!('geolocation' in navigator)) return;
    if (localStorage.getItem('loc_prompt_dismissed')) return;
    if (document.getElementById('locPermBanner')) return;

    // If the Permissions API says it's already granted/denied, skip the banner.
    const show = () => {
        if (document.getElementById('locPermBanner') || document.getElementById('notifPermBanner')) return;
        const banner = document.createElement('div');
        banner.id = 'locPermBanner';
        // left/right + margin:auto (NOT left:50%+translate — a fixed element
        // shrink-wraps against the 50% offset and can never exceed half the
        // viewport, which crushed the text). Bottom clears the mobile nav bar.
        banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(76px + env(safe-area-inset-bottom,0px));margin:0 auto;width:max-content;max-width:calc(100vw - 32px);z-index:9000;background:var(--color-sidebar,#121212);border:1px solid var(--color-border,#333);border-radius:12px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;box-shadow:0 4px 24px rgba(0,0,0,0.5);';
        banner.innerHTML = `
            <span style="font-size:1.3rem;">📍</span>
            <span style="font-size:0.9rem;flex:1;min-width:140px;">Share your location to find nearby hotspots.</span>
            <button class="btn btn-primary btn-sm" onclick="requestWebLocation()">Allow</button>
            <button class="btn btn-sm" onclick="localStorage.setItem('loc_prompt_dismissed','1');document.getElementById('locPermBanner').remove();">✕</button>`;
        document.body.appendChild(banner);
    };
    if (navigator.permissions?.query) {
        navigator.permissions.query({ name: 'geolocation' })
            .then(st => { if (st.state === 'prompt') show(); })
            .catch(show);
    } else {
        show();
    }
}

function maybePromptNotificationPermission() {
    if (typeof cordova !== 'undefined') return;                     // Cordova has its own flow
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'default') return;               // already decided
    if (localStorage.getItem('notif_prompt_dismissed')) return;
    if (document.getElementById('notifPermBanner')) return;

    const banner = document.createElement('div');
    banner.id = 'notifPermBanner';
    // Same fixed-position pattern as locPermBanner (see comment there).
    banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:calc(76px + env(safe-area-inset-bottom,0px));margin:0 auto;width:max-content;max-width:calc(100vw - 32px);z-index:9000;background:var(--color-sidebar,#121212);border:1px solid var(--color-border,#333);border-radius:12px;padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;box-shadow:0 4px 24px rgba(0,0,0,0.5);';
    banner.innerHTML = `
        <span style="font-size:1.3rem;">🔔</span>
        <span style="font-size:0.9rem;flex:1;min-width:140px;">Get alerts for plan expiry and received credits.</span>
        <button class="btn btn-primary btn-sm" onclick="requestWebNotifications()">Enable</button>
        <button class="btn btn-sm" onclick="localStorage.setItem('notif_prompt_dismissed','1');document.getElementById('notifPermBanner').remove();">✕</button>`;
    document.body.appendChild(banner);
}

/* ===================================================================
   CHAT ACCOUNT LINKING (Telegram / WhatsApp bots)
   =================================================================== */
let _linkCodeTimer = null;
window.generateLinkCode = async function () {
    if (!currentUser || !auth?.currentUser) return showToast('Please log in first.', 'error');
    const btn = document.getElementById('generateLinkCodeBtn');
    if (btn) btn.disabled = true;
    try {
        let code = null;
        for (let attempt = 0; attempt < 5 && !code; attempt++) {
            const candidate = String(Math.floor(100000 + Math.random() * 900000));
            try {
                // Rules allow create but deny update, so colliding with a live
                // code throws and we retry with a fresh one.
                await db.collection('linkCodes').doc(candidate).set({
                    uid: auth.currentUser.uid,
                    used: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    expiresAt: firebase.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
                });
                code = candidate;
            } catch (e) { /* collision — retry */ }
        }
        if (!code) throw new Error('Could not generate a code. Please try again.');

        document.getElementById('linkCodeValue').innerText = code;
        document.getElementById('linkCodeInline').innerText = code;
        document.getElementById('linkCodeDisplay').classList.remove('hidden');

        let remaining = 10 * 60;
        clearInterval(_linkCodeTimer);
        _linkCodeTimer = setInterval(() => {
            remaining--;
            const el = document.getElementById('linkCodeCountdown');
            if (!el || remaining <= 0) {
                clearInterval(_linkCodeTimer);
                if (el) document.getElementById('linkCodeDisplay').classList.add('hidden');
                return;
            }
            el.innerText = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
        }, 1000);
        showToast('Link code generated — send it to the bot within 10 minutes.', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

/* ===================================================================
   BR3EZE NANO AI CHATBOT
   =================================================================== */
const HELP_DOCS = {
    "Getting Started": "Download the app, signup, and buy credits via voucher. Connect to the 'Power-HotSpot' SSID.",
    "Device Binding": "Br3eze uses Hardware ID (UUID) binding. Your account is locked to the first device you use. Contact support to reset.",
    "Data Quotas": "Plans now include bandwidth limits. Check your 'Usage' tab to see remaining GBs.",
    "Roaming": "Partner hotspots allow you to stay connected outside our main zones. Look for the '🌐' icon in the scan list.",
    "Missions": "Complete daily tasks to unlock connectivity perks and badges."
};

(() => {
    const GEMINI_API_KEY = window.ENV.GEMINI_API_KEY;
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    let chatHistory = [];
    window.chatHistory = chatHistory; // shared with the legacy sendGeminiMessage path

    // Single Gemini entry point for the chat modal (sendChatMessage expects
    // window.AIService.generate). Keeps its own rolling history.
    window.AIService = {
        // Legacy callers (showMainApp, old sendGeminiMessage) expect an init hook.
        async initialize() { return true; },
        async generate(prompt, systemContext) {
            const contents = [
                ...(systemContext ? [{ role: 'user', parts: [{ text: systemContext }] }] : []),
                ...chatHistory,
                { role: 'user', parts: [{ text: prompt }] }
            ];
            const response = await fetch(GEMINI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: contents,
                    generationConfig: { temperature: 0.7, maxOutputTokens: 400 }
                })
            });
            const data = await response.json();
            if (data.error) throw new Error(data.error.message || 'AI request failed');
            const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I didn't catch that.";
            chatHistory.push({ role: 'user', parts: [{ text: prompt }] });
            chatHistory.push({ role: 'model', parts: [{ text: reply }] });
            if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);
            return reply;
        }
    };

    async function getSystemContext() {
        const now = new Date();
        const dateStr = now.toLocaleString();
        const activePlan = getActiveSubscription();
        const planStatus = activePlan ? `${activePlan.planName || 'Active Plan'} (expires ${new Date(activePlan.expiresAt.seconds * 1000).toLocaleDateString()})` : 'No active plan';

        // Calculate Active Plans
        let activePlansStr = "None";
        if (currentUser && currentUser.subscriptions && currentUser.subscriptions.length > 0) {
            const valid = currentUser.subscriptions.filter(s => {
                const exp = s.expiresAt && s.expiresAt.seconds ? s.expiresAt.toDate() : new Date(0);
                return exp > now;
            });
            if (valid.length > 0) {
                activePlansStr = valid.map(s => {
                    const exp = s.expiresAt.toDate().toLocaleDateString();
                    return `${s.planName || 'Unlimited'} (Expires: ${exp})`;
                }).join(', ');
            }
        }

        // Collect Telemetry
        const deviceInfo = (typeof device !== 'undefined')
            ? `${device.platform} ${device.version} (${device.uuid})`
            : `Browser (${navigator.userAgent.substring(0, 50)}...)`;

        const netInfo = (window.NetworkTools && window.NetworkTools.lastKnownSSID)
            ? `Connected to: ${window.NetworkTools.lastKnownSSID}`
            : 'Network State: Unknown/Offline';

        const lastError = window.lastAppError || "None"; // Assuming we might track this globally later

        let context = `
You are 'Br3eze', an intelligent AI assistant for "Br3eze Hotspot" internet service. 
You serve THREE PRIMARY ROLES:
1. **Librarian**: You are the keeper of the Knowledge Base. You know every plan, rule, and the "User Journey" (Registration -> Plan Purchase -> Hardware Binding -> Renewal).
2. **Task Manager**: You help users navigate their "Power Missions" and daily connectivity tasks.
3. **Partner Gatekeeper (Bouncer & PM)**: You manage new partner applications. 
   - **The Bouncer**: When a user wants to join as a partner, you MUST vet them. 
     - Interview them: Ask about their Location, Internet Speed, and Power Backup availability.
     - BE STRICT: If they have bad internet or no backup, politely REJECT them.
   - **The Project Manager**: If their setup is good, guide them to submit an application.
     - USE: [PROPOSE_TICKET:New Partner Application: {Summary of their setup}] to finalize.
- Help users buy plans, redeem vouchers, check status
- Guide partners through network setup
- Assist admins with system tools
- Be helpful, concise, and use emojis sparingly 😊

AVAILABLE ACTIONS (use these tags):
[ACTION:OPEN_PLANS] • [ACTION:OPEN_VOUCHER] • [ACTION:OPEN_SHARE_CREDIT]
[ACTION:OPEN_MESSAGES] • [ACTION:OPEN_ROAMING] • [ACTION:OPEN_MISSIONS]
[ACTION:NAV_HOME] • [ACTION:OPEN_PROFILE] • [ACTION:LOGOUT]

=== HELP LIBRARY (Librarian Context) ===
${Object.entries(HELP_DOCS).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}

=== GAMIFICATION (Task Manager) ===
- Users can view their daily tasks via the "Power Missions" dashboard.
- Common tasks: "Redeem your first voucher", "Connect to a Roaming Spot", "Set a profile photo".

=== DIAGNOSTIC TELEMETRY (Internal Analysis) ===
- **Device**: ${deviceInfo}
- **Network**: ${netInfo}
- **Last Error**: ${lastError}
- **User Role**: ${currentUser ? currentUser.role : 'Guest'}
- **User ID**: ${currentUser ? currentUser.uid : 'N/A'}
- Use this data to diagnose issues. If a user complains about connection, check their Network status.

`;
        // Admin BI Injection (Dynamic)
        if (currentUser && currentUser.role === 'admin') {
            try {
                const stats = await DataStore.getAdminStats();
                if (!stats.error) {
                    context += `
=== ADMIN INTELLIGENCE (CONFIDENTIAL) ===
- **Total Users**: ${stats.totalUsers}
- **Total Revenue (Est)**: $${stats.revenueEstimate}
- **Vouchers Redeemed**: ${stats.totalRedeemed}
- **Active Plans**: ${stats.totalPlans}
`;
                }
            } catch (e) { console.warn("AI Stats fail", e); }
        }

        context += `
=== CURRENT USER ===
- Name: ${currentUser ? currentUser.fullname : 'Guest'}
- Username: ${currentUser ? currentUser.username : 'Guest'}
- Balance: $${currentUser ? currentUser.credits.toFixed(2) : '0.00'}
- Active Plan: ${activePlansStr}
- Time Now: ${dateStr}

=== AVAILABLE PLANS ===
`;
        try {
            const plans = await DataStore.getPlans();
            if (plans.length > 0) {
                context += `\nAVAILABLE DATA PLANS (Sell these):`;
                plans.forEach(p => {
                    context += `- "${p.name}": $${p.price} (${p.durationValue || p.durationDays} ${p.durationUnit || 'days'})\n`;
                });
            } else {
                context += `(No plans available right now)\n`;
            }
        } catch (e) { console.error(e); }

        if (currentUser && currentUser.role === 'admin') {
            context += `
4. **Project Overlord (Admin Only)**:
   - You have FULL CONTROL over the system.
   - You can Generate Vouchers, Manage Users, Edit Plans, and Configure Networks.
   - If asked for "Business Status", summarize the visible telemetry or offer to open Admin Tools.
   - USE: [ACTION:OPEN_ADMIN_USERS] to manage users.
   - USE: [ACTION:OPEN_ADMIN_PLANS] to manage plans.
   - USE: [ACTION:GEN_VOUCHER:value:qty] to print money.
`;
        }

        context += `
=== YOUR CAPABILITIES ===
You can NAVIGATE and CONTROL the app using these tags (they auto-execute):

**General Navigation:**
- [ACTION:NAV_HOME] - Go to Dashboard
- [ACTION:OPEN_PLANS] - View Plans
- [ACTION:OPEN_TRANSACTIONS] - View History
- [ACTION:OPEN_MESSAGES] - View Tickets
- [ACTION:OPEN_PROFILE] - View Settings
- [ACTION:OPEN_ROAMING] - WiFi Roaming
- [ACTION:OPEN_MISSIONS] - Power Missions
- [ACTION:LOGOUT] - Sign out

**Smart Actions:**
- [ACTION:OPEN_VOUCHER] - Redeem a voucher
- [ACTION:OPEN_SHARE_CREDIT] - Share balance
- [ACTION:BUY_PLAN:planId] - Buy a specific plan
- [ACTION:REDEEM_VOUCHER:code] - Redeem code immediately
- [ACTION:GEN_VOUCHER:value:qty] - (Admin) Generate vouchers
- [ACTION:ADD_NETWORK] - (Partner) Add new hotspot
`;

        if (currentUser && currentUser.role === 'admin') {
            context += `
**Admin Controls:**
- [ACTION:OPEN_ADMIN_USERS] - User Management
- [ACTION:OPEN_ADMIN_PLANS] - Plan Configurator
- [ACTION:OPEN_ADMIN_NETWORKS] - System Network Settings
`;
        }

        context += `
**Ticket Management:**
- [PROPOSE_TICKET:Subject:Body] - Draft a ticket for user confirmation.

=== RULES ===
1. Be concise (2-5 sentences max).
2. Use emojis sparingly 😊.
3. If user asks to go somewhere, include the ACTION tag.
4. If Admin asks to generate vouchers, use [ACTION:GEN_VOUCHER:10:5] (e.g. $10 x 5).
5. If user has a voucher code, use [ACTION:REDEEM_VOUCHER:code].
`;
        return context;
    }


    /* ==========================================================
       💬 COMMUNICATION UTILITIES & CHATBOT CORE
       ========================================================== */

    /**
     * Core Voucher Redemption Logic (Shared by UI and Chatbot)
     */
    window.redeemVoucherLogic = async (code) => {
        code = code ? code.trim() : "";
        if (!code) throw new Error("Code required");
        if (!navigator.onLine && typeof OfflineOrchestrator !== 'undefined') {
            OfflineOrchestrator.queueOperation({ type: 'VOUCHER_REDEMPTION', data: { voucherCode: code, username: currentUser.id } });
            return { success: true, offline: true, message: "Offline: Voucher queued for sync." };
        }
        const snap = await db.collection('vouchers').where('code', '==', code).limit(1).get();
        if (snap.empty) throw new Error("Invalid voucher code.");
        const voucherDoc = snap.docs[0];
        const voucher = voucherDoc.data();
        if (voucher.used) throw new Error("Voucher already used.");
        const batch = db.batch();
        batch.update(db.collection('users').doc(currentUser.id), { credits: firebase.firestore.FieldValue.increment(voucher.value) });
        batch.update(voucherDoc.ref, { used: true, usedBy: currentUser.id, usedAt: firebase.firestore.FieldValue.serverTimestamp() });
        await batch.commit();
        await refreshCurrentUser();
        return { success: true, amount: voucher.value, message: `Successfully redeemed $${voucher.value.toFixed(2)}!` };
    };

    window.speakText = function (text) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.0;
            window.speechSynthesis.speak(u);
        } else {
            showToast("TTS not supported", "error");
        }
    };

    const VoiceInputHelper = {
        mediaRecorder: null, audioChunks: [], isRecording: false,
        toggle() { this.isRecording ? this.stopRecording() : this.startRecording(); },
        async startRecording() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];
                this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);
                this.mediaRecorder.onstop = () => {
                    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                    window.addMessage("🎤 Voice note sent.", 'user');
                    stream.getTracks().forEach(t => t.stop());
                };
                this.mediaRecorder.start();
                this.isRecording = true;
                this.updateUI(true);
            } catch (e) { showToast("Mic access failed", "error"); }
        },
        stopRecording() { if (this.mediaRecorder) { this.mediaRecorder.stop(); this.isRecording = false; this.updateUI(false); } },
        updateUI(rec) {
            const btn = document.getElementById('chatActionBtn');
            if (btn) btn.innerHTML = rec ? '<i class="fas fa-stop"></i>' : '<i class="fas fa-microphone"></i>';
        }
    };

    window.handleChatAction = function () {
        const input = document.getElementById('chatInput');
        if (input?.value.trim()) window.sendChatMessage();
        else VoiceInputHelper.toggle();
    };

    // Expose the rich prompt builder for the chat pipeline (sendChatMessage)
    // and the legacy top-level sendGeminiMessage.
    window.getSystemContext = getSystemContext;

    // Unified Chat Modal & Messaging logic has been moved to chat.js
})();

function addMessage(text, sender, animate = false) {
    const box = document.getElementById('chatLog');
    if (!box) return;

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.className = `chat-message ${sender}`;

    // Sanitize User Input to prevent XSS
    if (sender === 'user') {
        text = escapeHtml(text);
    }

    // User Message: Status Indicators
    let statusHtml = '';
    if (sender === 'user') {
        statusHtml = `<div class="message-meta-footer" style="justify-content: flex-end; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 2px;">
                <span class="message-time" style="font-size: 0.7em; margin-right: 5px;">${timestamp}</span>
                <i class="fas fa-check-double status-read" style="color: #68FFD1;" title="Read"></i>
            </div>`;
    }

    // Bot Message: TTS Button
    let botAction = '';
    if (sender === 'bot') {
        const safeText = text.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, ' ');
        botAction = `<button onclick="speakText('${safeText}')" class="btn-tts" title="Read Aloud"><i class="fas fa-volume-up"></i></button>`;
    }

    const bubbleClass = sender === 'user' ? 'bubble user' : 'bubble bot';

    if (sender === 'bot' && animate) {
        div.innerHTML = `<div class="bot-avatar"><i class="fas fa-robot"></i></div>
                              <div class="${bubbleClass}" style="position: relative;"></div>
                              ${botAction}`;
        box.appendChild(div);

        // Typewriter Effect
        const bubble = div.querySelector('.bubble');

        // If text contains HTML tags (from Markdown parsing), render as HTML
        // Otherwise render as text to be safe
        if (text.includes('<') && text.includes('>')) {
            bubble.innerHTML = text; // Trusted Bot HTML
        } else {
            // For simple text, we can use textContent but we want to allow <br> if needed
            // For now, if no tags, we treat as clean text
            bubble.innerText = text;
        }
        box.scrollTop = box.scrollHeight;
    } else {
        // Static render
        const content = sender === 'bot'
            ? `<div class="bot-avatar"><i class="fas fa-robot"></i></div><div class="${bubbleClass}">${text}</div>${botAction}`
            : `<div class="${bubbleClass}">${text}${statusHtml}</div>`;
        div.innerHTML = content;
        box.appendChild(div);
    }

    box.scrollTop = box.scrollHeight;
}

// Pending ticket for user confirmation
let pendingTicket = null;

async function sendGeminiMessage() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;

    // Auto-close emoji picker on send
    const picker = document.getElementById('emojiPicker');
    if (picker && picker.classList.contains('active')) {
        picker.classList.remove('active');
    }

    input.value = '';
    addMessage(msg, 'user');

    const box = document.getElementById('chatLog');
    const typingId = 'typing-' + Date.now();
    const typingDiv = document.createElement('div');
    typingDiv.id = typingId;
    typingDiv.className = 'chat-message bot';
    typingDiv.innerHTML = `<div class="bot-avatar loading"><i class="fas fa-robot"></i></div><div class="bubble bot"><i class="fas fa-circle-notch fa-spin"></i> Thinking...</div>`;
    box.appendChild(typingDiv);
    box.scrollTop = box.scrollHeight;

    try {
        const systemInstruction = await getSystemContext();
        const contents = [
            { role: "user", parts: [{ text: systemInstruction }] },
            ...chatHistory,
            { role: "user", parts: [{ text: msg }] }
        ];
        const response = await fetch(GEMINI_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: contents,
                generationConfig: { temperature: 0.7, maxOutputTokens: 400 }
            })
        });
        const data = await response.json();
        const tEl = document.getElementById(typingId);
        if (tEl) tEl.remove();

        if (data.error) {
            console.error("Gemini Error:", data.error);
            addMessage("⚠️ System overload. Please try again.", 'bot');
            return;
        }
        let reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Pole, I didn't catch that.";

        // Parse and execute actions
        reply = parseAndExecuteActions(reply);

        // animate = true for bot reply
        addMessage(reply, 'bot', true);

        chatHistory.push({ role: "user", parts: [{ text: msg }] });
        chatHistory.push({ role: "model", parts: [{ text: reply }] });

    } catch (error) {
        document.getElementById(typingId)?.remove();
        console.error("Network Error:", error);
        addMessage("Check your internet connection.", 'bot');
    }
}

function parseAndExecuteActions(text) {
    // Define button labels and their actions
    const buttonMap = {
        'OPEN_PLANS': { label: '📦 View Plans', icon: 'fas fa-box' },
        'OPEN_VOUCHER': { label: '🎁 Redeem Voucher', icon: 'fas fa-gift' },
        'OPEN_SHARE_CREDIT': { label: '💸 Share Credit', icon: 'fas fa-share' },
        'OPEN_TRANSACTIONS': { label: '📊 Transaction History', icon: 'fas fa-history' },
        'OPEN_MESSAGES': { label: '📩 Support Tickets', icon: 'fas fa-envelope' },
        'OPEN_ROAMING': { label: '🌐 WiFi Roaming', icon: 'fas fa-broadcast-tower' },
        'OPEN_PARTNER': { label: '🛰️ My Networks', icon: 'fas fa-wifi' },
        'OPEN_MISSIONS': { label: '🎯 Power Missions', icon: 'fas fa-tasks' },
        'OPEN_PROFILE': { label: '👤 Edit Profile', icon: 'fas fa-user-circle' },
        'OPEN_LIFECYCLE': { label: '📖 User Journey', icon: 'fas fa-book-reader' },
        'BUY_PLAN': { label: '🛒 Buy Now', icon: 'fas fa-shopping-cart' },
        'NAV_HOME': { label: '🏠 Dashboard', icon: 'fas fa-home' },
        'LOGOUT': { label: '🚪 Sign Out', icon: 'fas fa-sign-out-alt' },
        'ADD_NETWORK': { label: '➕ Add Network', icon: 'fas fa-plus-circle' },
        'GEN_VOUCHER': { label: '🖨️ Generate Vouchers', icon: 'fas fa-print' }, // Admin
        'REDEEM_VOUCHER': { label: '🎟️ Redeem Code', icon: 'fas fa-ticket-alt' }, // Direct
        'OPEN_ADMIN_USERS': { label: '👥 Manage Users', icon: 'fas fa-users-cog' },
        'OPEN_ADMIN_PLANS': { label: '📝 Manage Plans', icon: 'fas fa-tasks' },
        'OPEN_ADMIN_NETWORKS': { label: '📡 System Networks', icon: 'fas fa-network-wired' }
    };

    let buttonsToAdd = [];

    // Check for action commands and collect buttons
    for (const [action, config] of Object.entries(buttonMap)) {
        // Updated regex to support multiple params: [ACTION:GEN_VOUCHER:10:5]
        const regex = new RegExp(`\\[ACTION:\\s*${action}(?::([^\\]]+))?\\]`, 'gi');
        let match;
        while ((match = regex.exec(text)) !== null) {
            const param = match[1] || '';
            buttonsToAdd.push({ action, param, ...config });
            text = text.replace(match[0], '');
        }
    }

    // Check for ticket creation proposal
    const ticketMatch = text.match(/\[PROPOSE_TICKET:(.+?):(.+?)\]/i);
    if (ticketMatch) {
        const subject = ticketMatch[1].trim();
        const body = ticketMatch[2].trim();
        pendingTicket = { subject, body };
        text = text.replace(ticketMatch[0], '');
        text += `\n\n📝 **Ticket Draft:**\n*Subject:* ${subject}\n*Details:* ${body}`;
        buttonsToAdd.push({ action: 'SUBMIT_TICKET', label: '✅ Submit Ticket', icon: 'fas fa-check' });
        buttonsToAdd.push({ action: 'CANCEL_TICKET', label: '❌ Cancel', icon: 'fas fa-times' });
    }

    // If there are buttons, schedule them to be added after message renders
    if (buttonsToAdd.length > 0) {
        setTimeout(() => addChatActionButtons(buttonsToAdd), 150);
    }

    return text.trim();
}

function addChatActionButtons(buttons) {
    const box = document.getElementById('chatLog');
    if (!box) return;

    const btnDiv = document.createElement('div');
    btnDiv.className = 'chat-action-buttons';

    buttons.forEach(btn => {
        const button = document.createElement('button');
        button.className = 'btn btn-sm chat-inline-btn';
        button.innerHTML = `<i class="${btn.icon}"></i> ${btn.label}`;
        button.onclick = () => executeChatAction(btn.action, btn.param);
        btnDiv.appendChild(button);
    });

    box.appendChild(btnDiv);
    box.scrollTop = box.scrollHeight;
}

// Execute action WITHOUT closing chat
window.executeChatAction = function (action, param) {
    // Identify section container for manual toggling if needed
    const adminSection = document.getElementById('settings-section');
    const adminTools = document.getElementById('adminToolsContainer');

    // Helper for Admin Check
    const requireAdmin = () => {
        if (!currentUser || currentUser.role !== 'admin') {
            addMessage("⛔ Access Denied. Admin privileges required.", 'bot');
            return false;
        }
        return true;
    };

    switch (action) {
        case 'OPEN_ADMIN_USERS':
            if (!requireAdmin()) break;
            closeModal('chatBoxModal');
            showSection('settings');
            if (adminTools) adminTools.classList.remove('hidden');
            if (typeof renderUserManagement === 'function') renderUserManagement();
            break;
        case 'OPEN_ADMIN_PLANS':
            if (!requireAdmin()) break;
            closeModal('chatBoxModal');
            showSection('settings');
            if (adminTools) adminTools.classList.remove('hidden');
            if (typeof renderPlanManagementAdmin === 'function') renderPlanManagementAdmin();
            break;
        case 'OPEN_ADMIN_NETWORKS':
            if (!requireAdmin()) break;
            closeModal('chatBoxModal');
            showSection('settings');
            if (adminTools) adminTools.classList.remove('hidden');
            if (typeof renderNetworkSettings === 'function') renderNetworkSettings();
            break;
        case 'NAV_HOME':
            closeModal('chatBoxModal');
            showSection('home');
            break;
        case 'LOGOUT':
            closeModal('chatBoxModal');
            Auth.logout();
            break;
        case 'ADD_NETWORK':
            closeModal('chatBoxModal');
            setTimeout(() => openModal('partnerNetworkModal'), 300);
            break;
        case 'GEN_VOUCHER':
            if (!requireAdmin()) break;
            // param expected: value:qty e.g. "10:5"
            if (param && param.includes(':')) {
                const [val, qty] = param.split(':');
                generateVouchersLogic(parseFloat(val), parseInt(qty))
                    .then(() => addMessage(`✅ Generated ${qty} vouchers of $${val} !`, 'bot'))
                    .catch(e => addMessage(`❌ Error: ${e.message} `, 'bot'));
            } else {
                openGenerateVoucherModal();
            }
            break;
        case 'REDEEM_VOUCHER':
            if (param) {
                addMessage(`🔄 Redeeming ${param}...`, 'bot');
                redeemVoucherLogic(param)
                    .then(val => {
                        addMessage(`✅ Success! Added $${val.toFixed(2)} to your account.`, 'bot');
                        updateUI();
                    })
                    .catch(e => addMessage(`❌ Redemption Failed: ${e.message} `, 'bot'));
            } else {
                showVoucherFormInChat();
            }
            break;
        case 'OPEN_PLANS':
            showPlansInChat();
            break;
        case 'OPEN_VOUCHER':
            showVoucherFormInChat();
            break;
        case 'OPEN_SHARE_CREDIT':
            showShareCreditInChat();
            break;
        case 'OPEN_TRANSACTIONS':
            showTransactionsInChat();
            break;
        case 'OPEN_MESSAGES':
            showTicketsInChat();
            break;
        case 'OPEN_ROAMING':
            closeModal('chatBoxModal');
            showSection('roaming');
            break;
        case 'OPEN_PARTNER':
            closeModal('chatBoxModal');
            showSection('partner-networks');
            break;
        case 'OPEN_MISSIONS':
            openMissionsModal();
            break;
        case 'OPEN_PROFILE':
            closeModal('chatBoxModal');
            showSection('settings');
            break;
        case 'OPEN_LIFECYCLE':
            openModal('lifecycleModal');
            break;
        case 'BUY_PLAN':
            if (param) purchasePlanFromChat(param);
            break;
        case 'SUBMIT_TICKET':
            confirmPendingTicket();
            break;
        case 'CANCEL_TICKET':
            cancelPendingTicket();
            break;
    }
    return null; // By default actions don't return text
};

// Global helper to extract action from AI response
window.executeChatActionFromResponse = async function (response) {
    if (!response) return null;

    // Check for [ACTION:PARAM] pattern
    const match = response.match(/\[([A-Z_]+)(?::([^\]]+))?\]/);
    if (match) {
        const action = match[1];
        const param = match[2] || null;
        const msg = await window.executeChatAction(action, param);
        // Remove the [TAG] from the message
        let cleaned = response.replace(match[0], '').trim();
        if (msg) cleaned += "\n\n" + msg;
        return cleaned;
    }
    return response;
};

// In-chat mini-views
function showPlansInChat() {
    const plans = AppData.plans || [];
    if (plans.length === 0) {
        addMessage("No plans available right now. Check back later! 📦", 'bot');
        return;
    }

    let html = "**Available Plans:**\n";
    plans.forEach(p => {
        const dataLimit = p.dataLimit > 0 ? `${p.dataLimit} GB` : 'Unlimited';
        html += `\n• ** ${p.name}** - $${p.price} (${p.durationValue} ${p.durationUnit}, ${dataLimit} Data)`;
    });
    addMessage(html, 'bot');

    // Add buy buttons
    setTimeout(() => {
        const btns = plans.map(p => ({
            action: 'BUY_PLAN',
            param: p.id,
            label: `Buy ${p.name} - $${p.price} `,
            icon: 'fas fa-shopping-cart'
        }));
        addChatActionButtons(btns);
    }, 200);
}

function showVoucherFormInChat() {
    addMessage("Enter your voucher code below and tap Send! 🎁", 'bot');
    document.getElementById('chatInput').placeholder = 'Enter voucher code...';
    document.getElementById('chatInput').dataset.mode = 'voucher';
}

function showShareCreditInChat() {
    addMessage("To share credit, type the **username** and **amount** like this:\n`share @username $5`\n\nExample: `share @john 2.50`", 'bot');
    document.getElementById('chatInput').dataset.mode = 'share';
}

function showTransactionsInChat() {
    const txs = AppData.transactions || [];
    if (txs.length === 0) {
        addMessage("No transactions yet! 📊", 'bot');
        return;
    }

    let html = "**Recent Transactions:**\n";
    txs.slice(0, 5).forEach(tx => {
        const sign = tx.amount > 0 ? '+' : '';
        const date = tx.timestamp ? tx.timestamp.toDate().toLocaleDateString() : 'N/A';
        html += `\n• ${date}: ${tx.description} (${sign}$${Math.abs(tx.amount).toFixed(2)})`;
    });
    addMessage(html, 'bot');
}

function showTicketsInChat() {
    const tickets = AppData.tickets || [];
    const openTickets = tickets.filter(t => t.status === 'Open');

    if (openTickets.length === 0) {
        addMessage("You have no open support tickets! 🎉\nNeed help? Just describe your issue and I'll create one for you.", 'bot');
        return;
    }

    let html = `** Your Open Tickets(${openTickets.length}):**\n`;
    openTickets.forEach(t => {
        html += `\n• ** ${t.subject}** - ${t.status} `;
    });
    addMessage(html, 'bot');
}

async function purchasePlanFromChat(planId) {
    const plan = AppData.plans.find(p => p.id === planId);
    if (!plan) {
        addMessage("Plan not found! Try again. 😕", 'bot');
        return;
    }

    const isNonBilling = currentUser.role === 'admin' || currentUser.role === 'family';

    // Check if user already has an active plan
    if (hasActivePlanNow() && !isNonBilling) {
        const activeSub = getActiveSubscription();
        const expiryDate = activeSub?.expiresAt ? activeSub.expiresAt.toDate().toLocaleDateString() : 'soon';
        addMessage(`⚠️ You already have an active plan!\n\n ** Current Plan:** ${activeSub?.planName || 'Active'} \n ** Expires:** ${expiryDate} \n\nPlease wait for your current plan to expire before purchasing a new one.`, 'bot');
        return;
    }

    if (currentUser.credits < plan.price && !isNonBilling) {
        addMessage(`Insufficient balance! You need $${plan.price} but have $${currentUser.credits.toFixed(2)}. 💰\n\nRedeem a voucher to add credit!`, 'bot');
        setTimeout(() => addChatActionButtons([{ action: 'OPEN_VOUCHER', label: '🎁 Redeem Voucher', icon: 'fas fa-gift' }]), 200);
        return;
    }

    const actionText = isNonBilling ? 'activating free access' : `processing purchase of ** ${plan.name}** for $${plan.price}`;
    addMessage(`Processing ${actionText}...`, 'bot');

    try {
        await purchasePlan(planId);
        const successMsg = isNonBilling
            ? `✅ Success! Your ** ${plan.name}** access is now active! Enjoy your staff / family benefit! 🚀`
            : `✅ Success! You've purchased **${plan.name}**! Enjoy your internet! 🎉`;
        addMessage(successMsg, 'bot');
    } catch (e) {
        addMessage(`❌ Action failed: ${e.message}`, 'bot');
    }
}

function addTicketConfirmationButtons() {
    const box = document.getElementById('chatLog');
    if (!box || !pendingTicket) return;

    const btnDiv = document.createElement('div');
    btnDiv.className = 'chat-action-buttons';
    btnDiv.innerHTML = `
            <button class="btn btn-sm btn-primary" onclick="confirmPendingTicket()">
                <i class="fas fa-check"></i> Submit Ticket
            </button>
            <button class="btn btn-sm" onclick="cancelPendingTicket()" style="margin-left: 8px;">
                <i class="fas fa-times"></i> Cancel
            </button>
        `;
    box.appendChild(btnDiv);
    box.scrollTop = box.scrollHeight;
}

window.confirmPendingTicket = async function () {
    if (!pendingTicket) return;
    try {
        await DataStore.submitTicket(currentUser.uid, currentUser.email, pendingTicket.subject, pendingTicket.body);
        addMessage("✅ Your support ticket has been submitted! Our team will respond soon.", 'bot');
        showToast("Ticket submitted successfully!", "success");
    } catch (e) {
        addMessage("❌ Failed to submit ticket. Please try again.", 'bot');
    }
    pendingTicket = null;
    removeActionButtons();
};

window.cancelPendingTicket = function () {
    addMessage("Okay, I've cancelled the ticket. Let me know if you need anything else! 😊", 'bot');
    pendingTicket = null;
    removeActionButtons();
};

function removeActionButtons() {
    const btns = document.querySelectorAll('.chat-action-buttons');
    btns.forEach(b => b.remove());
}

// Basic modal exports handled in chat.js

// Ticket Menu Logic
window.toggleTicketMenu = function () {
    const menu = document.getElementById('ticketHeaderMenu');
    if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};

window.showTicketActivity = function () {
    window.toggleTicketMenu();
    showToast("Activity Log: No recent changes", "info");
};

// Voice Note Helper (Audio Recording)
const VoiceInputHelper = {
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,

    toggle() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.checkPermissionsAndStart();
        }
    },

    checkPermissionsAndStart() {
        // Cordova Permission Check
        if (window.cordova && cordova.plugins && cordova.plugins.permissions) {
            const permissions = cordova.plugins.permissions;
            const permission = permissions.RECORD_AUDIO;

            permissions.checkPermission(permission, (status) => {
                if (status.hasPermission) {
                    this.startRecording();
                } else {
                    permissions.requestPermission(permission, (status) => {
                        if (status.hasPermission) {
                            this.startRecording();
                        } else {
                            showToast('Microphone permission denied.', 'error');
                        }
                    }, () => showToast('Permission error.', 'error'));
                }
            });
        } else {
            // Browser detection / Fallback
            this.startRecording();
        }
    },

    async startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(stream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = event => {
                this.audioChunks.push(event.data);
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);
                this.sendVoiceNote(audioUrl);

                // Stop all tracks to release microphone
                stream.getTracks().forEach(track => track.stop());
            };

            this.mediaRecorder.start();
            this.isRecording = true;
            this.updateUI(true);
            showToast('Recording... Tap to send.', 'info');

        } catch (err) {
            console.error("Mic Error:", err);
            showToast("Could not access microphone. " + err.message, 'error');
        }
    },

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop(); // Triggers onstop -> sendVoiceNote
            this.isRecording = false;
            this.updateUI(false);
        }
    },

    sendVoiceNote(url) {
        const box = document.getElementById('chatLog');
        if (!box) return;

        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const div = document.createElement('div');
        div.className = 'chat-message user';
        div.innerHTML = `
                <div class="bubble user" style="min-width: 220px; padding: 10px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px; opacity:0.8; font-size:0.85rem;">
                        <i class="fas fa-microphone-alt"></i> Voice Note
                    </div>
                    <audio controls src="${url}" style="width: 100%; height: 35px; border-radius: 20px;"></audio>
                    <div class="message-meta-footer" style="justify-content: flex-end; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 2px;">
                        <span class="message-time" style="font-size: 0.7em; margin-right: 5px;">${timestamp}</span>
                        <i class="fas fa-check-double status-read" style="color: #68FFD1;"></i>
                    </div>
                </div>`;
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;

        // Simulate Bot Acknowledgement
        setTimeout(() => {
            addMessage("🎤 Voice note received. I will analyze the audio payload and respond shortly.", 'bot');
        }, 1000);
    },

    updateUI(recording) {
        const btn = document.getElementById('chatActionBtn');
        if (!btn) return;
        if (recording) {
            btn.classList.add('recording-pulse');
            btn.innerHTML = '<i class="fas fa-paper-plane"></i>'; // Send icon when recording? Or stop? User said "send voice note". Usually tap to stop & send.
            btn.style.color = 'var(--color-danger)';
        } else {
            btn.classList.remove('recording-pulse');
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.style.color = '';
        }
    }
};

window.handleChatAction = function () {
    const input = document.getElementById('chatInput');
    // If input has text, Send. If empty, Toggle Record.
    if (input && input.value.trim().length > 0) {
        window.sendChatMessage();
    } else {
        VoiceInputHelper.toggle();
    }
};

// Update button icon based on input content
document.getElementById('chatInput')?.addEventListener('input', (e) => {
    const btn = document.getElementById('chatActionBtn');
    if (!btn) return;
    if (e.target.value.trim().length > 0) {
        btn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        btn.classList.remove('mode-mic');
        btn.classList.add('mode-send');
    } else {
        if (!VoiceInputHelper.isRecording) {
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.classList.add('mode-mic');
            btn.classList.remove('mode-send');
        }
    }
});


/*  =====  GLOBAL EXPORTS  =====  */
window.showSection = showSection;
window.openModal = openModal;
window.closeModal = closeModal;
window.Auth = Auth;
window.toggleAuthForm = toggleAuthForm;
window.openRedeemVoucher = openRedeemVoucher;
window.openShareCredit = openShareCredit;
window.openSubmitTicketModal = openSubmitTicketModal;
window.openAdminPlanModal = openAdminPlanModal;
window.openAdminUserModal = openAdminUserModal;
window.openGenerateVoucherModal = openGenerateVoucherModal;
window.openEditNetworkModal = openEditNetworkModal;
window.openSendVoucherModal = openSendVoucherModal;
window.purchasePlan = purchasePlan;
window.deleteVoucher = deleteVoucher;
window.deleteAdminPlan = deleteAdminPlan;
window.closeTicket = closeTicket;
window.revealPassword = revealPassword;
window.openTicketDetail = openTicketDetail;
window.renderUserManagement = renderUserManagement;
window.renderVoucherList = renderVoucherList;
window.updateTransactionHistory = updateTransactionHistory;
window.openActiveConnectionsModal = openActiveConnectionsModal;
window.filterConnectionsTable = filterConnectionsTable;
window.openAdminAI = openAdminAI;
window.toggleEmojiPicker = toggleEmojiPicker;
window.renderPlanManagementAdmin = renderPlanManagementAdmin;
window.renderNetworkSettings = renderNetworkSettings;

/*  =====  PARTNERSHIP REQUEST  =====  */
async function requestPartnership() {
    if (!currentUser) return showToast("Please log in first", "error");

    // Open Chatbot and trigger the Partner Flow
    window.openChatBotModal();

    setTimeout(() => {
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = "I am interested in becoming a partner.";
            input.dispatchEvent(new Event('input')); // Trigger UI updates

            // Trigger send if the handleChatAction is available
            if (typeof window.handleChatAction === 'function') {
                window.handleChatAction();
            }
        }
    }, 600); // Wait for modal animation
}
window.requestPartnership = requestPartnership;
window.insertEmoji = insertEmoji;

/* ==========================================================
   RESTORED CHATBOT & SHARED LOGIC
   ========================================================== */

/**
 * Core Voucher Redemption Logic (Shared by UI and Chatbot)
 * @param {string} code 
 * @returns {Promise<{success: boolean, amount: number, message: string}>}
 */
window.redeemVoucherLogic = async (code) => {
    code = code ? code.trim() : "";
    if (!code) throw new Error("Code required");

    // 1. Offline / Mesh Check
    if (!navigator.onLine) {
        if (typeof GossipService !== 'undefined') {
            await GossipService.queueOfflineVoucher(code, currentUser.id);
            return { success: true, offline: true, message: "Offline: Voucher queued for P2P relay." };
        }
        throw new Error("Offline and Mesh unavailable.");
    }

    // 2. Database Verification
    const snap = await db.collection('vouchers').where('code', '==', code).limit(1).get();
    if (snap.empty) throw new Error("Invalid voucher code.");

    const voucherDoc = snap.docs[0];
    const voucher = voucherDoc.data();

    if (voucher.used) throw new Error("Voucher already used.");

    // 3. Execute Transaction
    const batch = db.batch();
    const userRef = db.collection('users').doc(currentUser.id);

    batch.update(userRef, { credits: firebase.firestore.FieldValue.increment(voucher.value) });
    batch.update(voucherDoc.ref, {
        used: true,
        usedBy: currentUser.id,
        redeemedByUsername: currentUser.fullname || 'ChatUser',
        usedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const txRef = db.collection('transactions').doc();
    batch.set(txRef, {
        userId: currentUser.id,
        type: 'redeem',
        description: `Voucher Redeemed via Chat: ${voucher.code}`,
        amount: voucher.value,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    await batch.commit();
    await refreshCurrentUser();

    return { success: true, amount: voucher.value, message: `Successfully redeemed $${voucher.value.toFixed(2)}!` };
};

/* --- Chatbot UI Helpers --- */

window.escapeHtml = function (text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

window.addMessage = function (text, sender) {
    const log = document.getElementById('chatLog');
    if (!log) return;

    // Sync with Hub
    if (window.CommunicationHub) {
        CommunicationHub.onMessageReceived({
            senderId: sender === 'bot' ? 'SYSTEM' : (currentUser ? currentUser.id : 'ANONYMOUS'),
            senderName: sender === 'bot' ? 'Br3eze AI' : (currentUser?.fullname || 'User'),
            text: text,
            timestamp: Date.now(),
            sender: sender,
            rendered: true, // this function draws the bubble itself
            targetId: window.currentChatContext?.targetId || 'SYSTEM',
            ticketId: window.currentChatContext?.type === 'ticket' ? window.currentChatContext.id : null
        });
    }

    // Sync with Ticket in Firestore if linked
    if (window.currentChatContext?.type === 'ticket' && sender === 'user') {
        DataStore.sendTicketReply(window.currentChatContext.id, {
            message: text,
            senderName: currentUser?.fullname || 'User',
            timestamp: Date.now()
        }).catch(err => console.warn("Ticket Sync failed:", err));
    }

    const div = document.createElement('div');
    div.className = `chat-message ${sender}`;
    const content = sender === 'bot' ? text : window.escapeHtml(text);

    div.innerHTML = `
            ${sender === 'bot' ? '<div class="bot-avatar"><i class="fas fa-robot"></i></div>' : ''}
            <div class="bubble ${sender}">${content}</div>
        `;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
};

/* --- Main Gemini Handler --- */

window.sendGeminiMessage = async () => {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;

    input.value = '';
    // Reset button state
    const btn = document.getElementById('chatActionBtn');
    if (btn) { btn.innerHTML = '<i class="fas fa-microphone"></i>'; btn.classList.add('mode-mic'); }

    addMessage(msg, 'user');
    addMessage('Thinking...', 'bot'); // Temporary placeholder

    try {

        // Handle Attachments
        let attachmentInfo = "";
        if (window.attachedFiles && window.attachedFiles.length > 0) {
            const fileNames = window.attachedFiles.map(f => f.name).join(', ');
            attachmentInfo = `\n[User attached ${window.attachedFiles.length} file(s): ${fileNames}]`;
            // Clear attachments after sending
            window.attachedFiles = [];
            document.getElementById('chatFileInput').value = '';
        }

        // Prepare Prompt
        const activeSub = getActiveSubscription();
        const planStr = activeSub ? activeSub.planName : "None";
        const ctx = `User: ${currentUser.fullname}, Balance: $${currentUser.credits.toFixed(2)}, Plan: ${planStr}.
If user wants to redeem a code, output[REDEEM_VOUCHER:THE_CODE].
If user wants to buy a plan, output[OPEN_PLANS].
If user wants to see partners, output[OPEN_ROAMING].
Otherwise be helpful and concise.`;

        const prompt = `${ctx} \n\nUser Question: ${msg}${attachmentInfo} `;

        // Call AI Service
        let response = "";
        if (typeof AIService !== 'undefined') {
            await AIService.initialize();
            response = await AIService.generate(prompt);
        } else {
            response = "AI Service unavailable.";
        }

        // Remove "Thinking..."
        const bubbles = document.querySelectorAll('.chat-message.bot .bubble');
        if (bubbles.length > 0) {
            const last = bubbles[bubbles.length - 1];
            if (last.textContent === 'Thinking...') {
                last.closest('.chat-message').remove();
            }
        }

        // Process Actions
        const finalMsg = await window.executeChatActionFromResponse(response);
        if (finalMsg) {
            addMessage(finalMsg, 'bot');
        }

    } catch (e) {
        console.error("Chat error:", e);
        addMessage("⚠️ Sorry, I encountered an error.", 'bot');
    }
};


// CommunicationHub is defined in chat.js


/* ==========================================================
   ?? REAL-TIME WEBSOCKET & VOIP ENGINE
   ========================================================== */

const SocketService = {
    socket: null,
    status: 'DISCONNECTED',
    serverUrl: 'wss://br3eze-socket.platform.net',

    init() {
        if (!currentUser) return;
        this.connect();
    },

    connect() {
        try {
            this.socket = new WebSocket(`${this.serverUrl}?uid=${currentUser.id}&token=${currentUser.role}`);

            this.socket.onopen = () => {
                this.status = 'CONNECTED';
                console.log("[Socket] Connected to real-time bridge.");
            };

            this.socket.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleIncoming(data);
            };

            this.socket.onclose = () => {
                this.status = 'DISCONNECTED';
                console.log("[Socket] Connection closed. Retrying...");
                setTimeout(() => this.connect(), 5000);
            };

            this.socket.onerror = (err) => {
                console.error("[Socket] Error:", err);
            };

        } catch (e) {
            console.error("[Socket] Init failed:", e);
        }
    },

    send(type, payload) {
        if (this.status !== 'CONNECTED') return false;
        this.socket.send(JSON.stringify({ type, payload, senderId: currentUser.id, timestamp: Date.now() }));
        return true;
    },

    handleIncoming(data) {
        if (data.type === 'CHAT') {
            if (window.CommunicationHub) {
                CommunicationHub.onMessageReceived({
                    ...data.payload,
                    sender: 'peer'
                });
            }
        } else if (data.type === 'VOIP_SIGNAL') {
            VoIPManager.handleSignal(data.payload);
        }
    }
};

const VoIPManager = {
    peerConnection: null,
    localStream: null,
    remoteStream: null,
    isCalling: false,

    async initCall(mediaType = 'audio', targetId = 'SUPPORT') {
        if (this.isCalling) return;

        // Check Interaction Permission (User Request)
        // Only allow calls if users have shared contacts, exchanged text, or shared files.
        const canCall = await this.checkInteractionPermission(targetId);
        if (!canCall) {
            showToast("You must interact (chat/share) with this user before calling.", "warning");
            return;
        }

        this.isCalling = true;
        showToast(`Initiating ${mediaType} Call to ${targetId}...`, "info");

        try {
            const constraints = { audio: true, video: mediaType === 'video' };
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.setupPeerConnection(targetId);

            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            SocketService.send('VOIP_SIGNAL', {
                type: 'OFFER',
                mediaType: mediaType,
                offer: offer,
                targetId: targetId
            });

        } catch (e) {
            console.error("[VoIP] Setup failed:", e);
            showToast("Camera/Mic access denied.", "error");
            this.endCall();
        }
    },

    setupPeerConnection(targetId) {
        const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.peerConnection = new RTCPeerConnection(config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                SocketService.send('VOIP_SIGNAL', {
                    type: 'CANDIDATE',
                    candidate: event.candidate,
                    targetId: targetId
                });
            }
        };

        this.peerConnection.ontrack = (event) => {
            this.remoteStream = event.streams[0];
            this.playRemoteStream();
        };
    },

    async handleSignal(signal) {
        if (signal.type === 'OFFER') {
            const accept = await this.showIncomingCallUI(signal.senderId, signal.mediaType);
            if (accept) {
                await this.acceptCall(signal);
            } else {
                SocketService.send('VOIP_SIGNAL', { type: 'REJECT', targetId: signal.senderId });
            }
        } else if (signal.type === 'ANSWER') {
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.answer));
        } else if (signal.type === 'CANDIDATE') {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        } else if (signal.type === 'REJECT') {
            showToast("Call rejected.", "warning");
            this.endCall();
        }
    },

    async acceptCall(signal) {
        this.isCalling = true;
        const constraints = { audio: true, video: signal.mediaType === 'video' };
        this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        this.setupPeerConnection(signal.senderId);

        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });

        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.offer));
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);

        SocketService.send('VOIP_SIGNAL', {
            type: 'ANSWER',
            answer: answer,
            targetId: signal.senderId
        });
    },

    showIncomingCallUI(senderName, mediaType = 'audio') {
        return new Promise(resolve => {
            const confirmed = confirm(`Incoming ${mediaType.toUpperCase()} Call from ${senderName || 'Peer'}. Accept?`);
            resolve(confirmed);
        });
    },

    playRemoteStream() {
        const audio = document.getElementById('remoteVoIPAudio') || new Audio();
        audio.id = 'remoteVoIPAudio';
        audio.srcObject = this.remoteStream;
        audio.play();

        // Handle Video if exists
        const videoTrack = this.remoteStream.getVideoTracks()[0];
        if (videoTrack) {
            this.showVideoOverlay();
        }
    },

    async checkInteractionPermission(targetId) {
        if (targetId === 'SUPPORT' || targetId === 'SYSTEM') return true;

        // check chat history
        if (window.CommunicationHub) {
            const history = CommunicationHub.getHistory();
            const hasInteracted = history.some(msg =>
                (msg.senderId === targetId || msg.recipientId === targetId) &&
                (msg.type === 'chat' || msg.type === 'file' || msg.type === 'contact')
            );
            if (hasInteracted) return true;
        }

        // check contact list
        if (window.Contacts && Contacts.list[targetId]) return true;

        return false;
    },

    showVideoOverlay() {
        let overlay = document.getElementById('voipVideoOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'voipVideoOverlay';
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.9); z-index: 10000;
                display: flex; flex-direction: column; align-items: center; justify-content: center;
            `;
            overlay.innerHTML = `
                <video id="voipRemoteVideo" autoplay playsinline style="max-width: 90%; max-height: 80%; border-radius: 12px; border: 2px solid var(--color-primary);"></video>
                <div style="margin-top: 20px; display: flex; gap: 20px;">
                    <button class="btn btn-danger" onclick="VoIPManager.endCall(); document.getElementById('voipVideoOverlay').remove();">
                        <i class="fas fa-phone-slash"></i> End Call
                    </button>
                </div>
            `;
            document.body.appendChild(overlay);
        }
        document.getElementById('voipRemoteVideo').srcObject = this.remoteStream;
    },

    endCall() {
        if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
        if (this.peerConnection) this.peerConnection.close();
        this.isCalling = false;
        this.peerConnection = null;
        this.localStream = null;
    }
};

window.SocketService = SocketService;
window.VoIPManager = VoIPManager;

// Init Socket on Auth
if (typeof auth !== 'undefined') {
    auth.onAuthStateChanged(user => {
        if (user) SocketService.init();
    });
}

// --- Unified Communication Hub UI ---
window.renderConsolidatedChat = function () {
    const log = document.getElementById('chatLog');
    if (!log) return;

    log.innerHTML = '';
    const history = CommunicationHub.getHistory();

    history.forEach(msg => {
        const sender = msg.sender || (msg.senderId === 'SYSTEM' ? 'bot' : (msg.senderId === currentUser?.id ? 'user' : 'peer'));
        const content = msg.text;

        const div = document.createElement('div');
        div.className = `chat-message ${sender}`;

        const avatar = sender === 'bot' ? '<div class="bot-avatar"><i class="fas fa-robot"></i></div>' :
            (sender === 'peer' ? `<div class="peer-avatar"><i class="fas fa-user"></i></div>` : '');

        div.innerHTML = `
            ${avatar}
            <div class="bubble ${sender}">${content}</div>
        `;
        log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
};

// Initial Render if chat is open
document.getElementById('chatBoxModal')?.addEventListener('transitionend', () => {
    if (document.getElementById('chatBoxModal').classList.contains('active')) {
        renderConsolidatedChat();
    }
});
// --- Unified Chat Context Management ---
window.currentChatContext = { type: 'AI', targetId: 'SYSTEM' };


window.sendChatMessage = async function () {
    const input = document.getElementById('chatInput');
    const text = input?.value.trim();
    if (!text) return;

    // 1. UI Update & Local Linkage
    window.addMessage(text, 'user');
    input.value = '';

    // 2. Logic based on Context
    const context = window.currentChatContext || { type: 'AI' };

    if (context.type === 'AI') {
        // Typing indicator
        const log = document.getElementById('chatLog');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-message bot typing';
        typingDiv.innerHTML = '<div class="bot-avatar"><i class="fas fa-robot"></i></div><div class="bubble bot">Typing...</div>';
        log.appendChild(typingDiv);
        log.scrollTop = log.scrollHeight;

        try {
            // Rich system prompt (knowledge base, plans, telemetry, admin BI)
            const sysContext = typeof window.getSystemContext === 'function'
                ? await window.getSystemContext()
                : `Role: Assistant for Br3eze Hotspot. User: ${window.currentUser?.fullname || 'Guest'}.`;

            const reply = await window.AIService.generate(text, sysContext);
            typingDiv.remove();

            // Strip [ACTION:*] tags, execute them, and render inline buttons
            const cleanReply = typeof parseAndExecuteActions === 'function'
                ? parseAndExecuteActions(reply)
                : reply;

            window.addMessage(cleanReply, 'bot');
        } catch (e) {
            typingDiv.remove();
            console.error('[Chat] AI error:', e);
            window.addMessage("I'm sorry, I encountered an error. Please try again.", 'bot');
        }
    } else if (context.type === 'peer') {
        // Send via WebSocket
        if (window.SocketService && window.SocketService.connected) {
            window.SocketService.send('CHAT_MESSAGE', {
                targetId: context.targetId,
                text: text
            });
        } else {
            window.addMessage("System: Connection lost. Reconnecting...", 'bot');
        }
    }
    // Note: 'ticket' context is already handled by sync logic in addMessage
};


window.renderConsolidatedChat = function () {
    const log = document.getElementById('chatLog');
    if (!log) return;

    const history = window.CommunicationHub ? CommunicationHub.getHistory() : [];
    const context = window.currentChatContext || { type: 'AI' };

    // Filter history based on context
    const filteredHistory = history.filter(msg => {
        if (context.type === 'AI') return msg.targetId === 'SYSTEM';
        if (context.type === 'ticket') return msg.ticketId === context.id;
        if (context.type === 'peer') return msg.targetId === context.targetId || msg.senderId === context.targetId;
        return true;
    });

    log.innerHTML = '';

    // --- Render Messages ---
    filteredHistory.forEach(msg => {
        const div = document.createElement('div');
        div.className = `chat-message ${msg.sender}`;
        const content = msg.sender === 'bot' ? msg.text : window.escapeHtml(msg.text);

        // Format Timestamp
        const date = new Date(msg.timestamp || Date.now());
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Avatar Action
        const isPeer = msg.sender === 'peer';
        const avatarAction = isPeer ? `onclick="openPeerProfile('${msg.senderId}', '${msg.senderName}')"` : '';
        const cursorStyle = isPeer ? 'style="cursor:pointer;"' : '';

        const avatar = msg.sender === 'bot' ? '<div class="bot-avatar"><i class="fas fa-robot"></i></div>' :
            (msg.sender === 'peer' ? `<div class="peer-avatar" ${avatarAction} ${cursorStyle}><i class="fas fa-user"></i></div>` : '');

        div.innerHTML = `
            ${avatar}
            <div class="bubble ${msg.sender}">
                ${content}
                <div class="chat-timestamp">${timeStr}</div>
            </div>
        `;
        log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
};

// --- Contact List & Peer Profiles ---

window.Contacts = {
    list: JSON.parse(localStorage.getItem('saved_contacts') || '[]'),

    add(contact) {
        if (!this.list.find(c => c.id === contact.id)) {
            this.list.push(contact);
            this.save();
            showToast(`${contact.name} added to contacts!`, 'success');
            window.renderContactList();
        }
    },

    remove(id) {
        this.list = this.list.filter(c => c.id !== id);
        this.save();
        showToast('Contact removed.', 'info');
        window.renderContactList();
        window.openPeerProfile(id); // Re-render modal to update button state
    },

    isSaved(id) {
        return !!this.list.find(c => c.id === id);
    },

    save() {
        localStorage.setItem('saved_contacts', JSON.stringify(this.list));
    }
};

window.openPeerProfile = function (peerId, peerName = 'Unknown') {
    const modal = document.getElementById('peerProfileModal');
    if (!modal) return;

    // Attempt to get realtime stats
    const peerData = window.GossipService ? window.GossipService.getPeer(peerId) : null;
    const lastSeen = peerData ? new Date(peerData.lastSeen).toLocaleTimeString() : 'Unknown';
    const status = peerData && (!peerData.status || peerData.status === 'online') ? 'Online' : 'Offline';

    document.getElementById('profileModalName').innerText = peerName;
    document.getElementById('profileModalId').innerText = `ID: ${peerId.substring(0, 8)}...`;
    document.getElementById('profileModalStatus').innerText = status;
    document.getElementById('profileModalLastSeen').innerText = `Last Seen: ${lastSeen}`;

    // Contact Button Logic
    const actionContainer = document.getElementById('profileContactAction');
    if (window.Contacts.isSaved(peerId)) {
        actionContainer.innerHTML = `<button class="btn btn-danger btn-block" onclick="Contacts.remove('${peerId}')"><i class="fas fa-user-minus"></i> Remove Contact</button>`;
    } else {
        actionContainer.innerHTML = `<button class="btn btn-primary btn-block" onclick="Contacts.add({id: '${peerId}', name: '${peerName}'})"><i class="fas fa-user-plus"></i> Add to Contacts</button>`;
    }

    // Call Actions
    document.getElementById('profileCallAudio').onclick = () => { closeModal('peerProfileModal'); VoIPManager.initCall('audio', peerId); };
    document.getElementById('profileCallVideo').onclick = () => { closeModal('peerProfileModal'); VoIPManager.initCall('video', peerId); };
    document.getElementById('profileMessage').onclick = () => {
        closeModal('peerProfileModal');
        openChatBotModal({ type: 'peer', targetId: peerId, name: peerName });
    };

    modal.classList.add('active');
};

window.renderContactList = function () {
    const container = document.getElementById('contactListContainer');
    if (!container) return;

    container.innerHTML = '';
    const contacts = window.Contacts.list;

    if (contacts.length === 0) {
        container.innerHTML = '<p class="text-medium" style="text-align:center; padding:20px;">No contacts saved yet.</p>';
        return;
    }

    contacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'chat-hub-item';
        div.onclick = () => openPeerProfile(c.id, c.name);
        div.innerHTML = `
            <div class="chat-hub-avatar"><i class="fas fa-user"></i></div>
            <div class="chat-hub-info">
                <div class="chat-hub-name">${c.name}</div>
                <div class="chat-hub-preview" style="font-size:0.75rem;">ID: ${c.id.substring(0, 6)}...</div>
            </div>
            <button class="btn-icon" style="color:var(--color-primary);"><i class="fas fa-comment"></i></button>
        `;
        container.appendChild(div);
    });
};

window.openChatBotModal = async function (context = { type: 'AI', targetId: 'nano-ai' }) {
    window.currentChatContext = context;
    window.currentChatTargetId = context.targetId;
    // Suppress unread badges/toasts for the conversation being viewed
    if (window.CommunicationHub) window.CommunicationHub.activeConversationId = context.targetId;

    const modal = document.getElementById('chatBoxModal');
    if (!modal) return;

    modal.classList.add('active');

    const nameEl = document.getElementById('chatTargetName');
    const avatarEl = document.getElementById('chatTargetAvatar');
    const headerActions = document.getElementById('chatHeaderActions');

    if (headerActions) headerActions.style.display = (context.type === 'peer' || context.type === 'ticket') ? 'flex' : 'none';

    if (context.type === 'AI') {
        if (nameEl) nameEl.innerText = "Br3eze AI";
        if (avatarEl) avatarEl.innerHTML = '<i class="fas fa-robot"></i>';
    } else {
        const targetName = context.name || (context.type === 'ticket' ? `Support #${context.id.substring(0, 6)}` : "Peer");
        if (nameEl) nameEl.innerText = targetName;
        if (avatarEl) avatarEl.innerHTML = '<i class="fas fa-user-circle"></i>';
    }

    if (window.CommunicationHub && typeof window.CommunicationHub.renderConversation === 'function') {
        window.CommunicationHub.renderConversation(context.targetId);
    }

    const log = document.getElementById('chatLog');
    if (log && log.innerHTML.trim() === '') {
        const greeting = context.type === 'AI'
            ? `Hello ${currentUser?.fullname?.split(' ')[0] || 'there'}! 👋 I'm Br3eze AI. How can I help?`
            : `System: Conversation started regarding ${context.name || 'Support Request'}.`;
        window.addMessage(greeting, 'bot');
    }
};


// --- Enterprise Procurement Monitoring ---
window.renderScheduleCard = function (data) {
    const container = document.getElementById('procurementScheduleContainer');
    if (!container) return;

    // Clear placeholder on first real item
    if (container.querySelector('.text-medium')) container.innerHTML = '';

    const div = document.createElement('div');
    div.className = 'card stat-card';
    div.style.borderLeft = '4px solid var(--color-info)';

    div.innerHTML = `
        <div style="font-weight:bold; color:var(--color-text-light);">${data.item}</div>
        <div style="font-size:0.85rem; margin-top:5px;">
            <span>Node: <strong>${data.node}</strong></span> | 
            <span>Qty: <strong>${data.qty}</strong></span>
        </div>
        <div style="font-size:0.8rem; color:var(--color-primary); margin-top:5px;">
            <i class="fas fa-calendar-alt"></i> Order Date: ${data.orderDate}
        </div>
        <div style="font-size:0.75rem; opacity:0.7; margin-top:5px;">
            Vendor: ${data.vendor} | Buffer: ${data.buffer} days
        </div>
    `;
    container.appendChild(div);

    // Update Counter
    const countEl = document.getElementById('procurementCount');
    if (countEl) {
        const currentText = countEl.innerText || "0 Planned";
        const current = parseInt(currentText) || 0;
        countEl.innerText = `${current + 1} Planned`;
    }
};

function initProcurementListener() {
    if (typeof db === 'undefined' || !db) return;
    console.log("[Enterprise] Initializing Procurement Sync...");

    let query = db.collection("procurementSchedule").where("status", "==", "PLANNED");

    // ROLE FILTER: Partners only see their own assigned procurement
    if (window.currentUser?.role === 'partner') {
        query = query.where("partnerId", "==", window.currentUser.id);
    }

    query.onSnapshot(snapshot => {
        const container = document.getElementById('procurementScheduleContainer');
        if (container) container.innerHTML = ''; // Reset for fresh snapshot

        const countEl = document.getElementById('procurementCount');
        let count = 0;

        snapshot.forEach(doc => {
            const p = doc.data();
            count++;
            window.renderScheduleCard({
                node: p.nodeId,
                item: p.item,
                qty: p.qty,
                orderDate: p.orderDate,
                vendor: p.vendorId,
                bulkDiscount: p.bulkDiscountApplied,
                buffer: p.bufferDays
            });
        });

        if (countEl) countEl.innerText = `${count} Planned`;
    }, err => {
        if (err.code === 'permission-denied') {
            console.warn("[Procurement] Access denied. Roles 'admin' or special 'partner' required.");
        } else {
            console.error("Procurement Sync Error:", err);
        }
    });
}

// Call listener on boot
setTimeout(() => {
    const role = window.currentUser?.role;
    if (role === 'admin' || role === 'partner') initProcurementListener();
}, 5000);

async function updatePlan(planId, updatedData) {
    console.log(`[PlanManager] Updating plan: ${planId}`);

    // 1. Update Firestore / DataStore
    if (typeof DataStore === 'undefined' || !DataStore.updatePlan) {
        console.warn("DataStore.updatePlan not found, falling back to manual update");
    }

    const plan = await (DataStore?.updatePlan ? DataStore.updatePlan(planId, updatedData) : Promise.resolve({ ...updatedData, planId }));

    // 2. Update local cache
    if (window.AppData && AppData.plans) {
        const index = AppData.plans.findIndex(p => p.planId === planId);
        if (index !== -1) AppData.plans[index] = plan;
    }

    // 3. Queue sync to MikroTik
    if (window.OfflineOrchestrator) {
        OfflineOrchestrator.queueOperation({
            type: 'PLAN_UPDATE',
            data: plan,
            timestamp: Date.now()
        });
    }

    if (typeof showToast === 'function') {
        showToast(`Plan ${plan.name || planId} updated! Mirroring to MikroTik...`, 'info');
    }

    // 4. Attempt immediate sync if online
    if (window.OfflineOrchestrator) {
        const state = OfflineOrchestrator.getState();
        if (state.mode !== 'mesh') {
            await OfflineOrchestrator.syncPendingOperations();
        }
    }

    return plan;
}

window.updatePlan = updatePlan;

async function deletePlan(planId) {
    console.log(`[PlanManager] Deleting plan: ${planId}`);

    // 1. Get Plan Data for queueing
    const plan = window.AppData?.plans?.find(p => p.planId === planId) || { planId };

    // 2. Update Firestore / DataStore
    if (typeof DataStore !== 'undefined' && DataStore.deletePlan) {
        await DataStore.deletePlan(planId);
    }

    // 3. Update local cache
    if (window.AppData && AppData.plans) {
        AppData.plans = AppData.plans.filter(p => p.planId !== planId);
    }

    // 4. Queue sync to MikroTik
    if (window.OfflineOrchestrator) {
        OfflineOrchestrator.queueOperation({
            type: 'PLAN_DELETE',
            data: plan,
            timestamp: Date.now()
        });
    }

    if (typeof showToast === 'function') {
        showToast(`Plan ${plan.name || planId} deleted! Mirroring to MikroTik...`, 'warning');
    }

    // 5. Attempt immediate sync if online
    if (window.OfflineOrchestrator) {
        const state = OfflineOrchestrator.getState();
        if (state.mode !== 'mesh') {
            await OfflineOrchestrator.syncPendingOperations();
        }
    }

    return { success: true };
}

window.deletePlan = deletePlan;
