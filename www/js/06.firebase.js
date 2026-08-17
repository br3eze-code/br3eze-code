/* ==========================================================
   06.firebase.js — Firebase init, auth/db/storage handles,
                    offline persistence, DataStore queries
   Depends on: Firebase SDK (loaded in index.html)
   ========================================================== */

const runtime = window.ENV || {};
const firebaseConfig = {
    apiKey: runtime.FIREBASE_WEB_API_KEY || runtime.FIREBASE_API_KEY || '',
    authDomain: runtime.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: runtime.FIREBASE_DATABASE_URL || '',
    projectId: runtime.FIREBASE_PROJECT_ID || '',
    storageBucket: runtime.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: runtime.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: runtime.FIREBASE_APP_ID || '',
    measurementId: runtime.FIREBASE_MEASUREMENT_ID || ''
};

const firebaseConfigured = Object.values(firebaseConfig).filter(Boolean).length >= 3;
if (typeof firebase !== 'undefined' && firebaseConfigured && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebaseConfigured && typeof firebase !== 'undefined' ? firebase.auth() : null;
const db = firebaseConfigured && typeof firebase !== 'undefined' ? firebase.firestore() : null;
const storage = firebaseConfigured && typeof firebase !== 'undefined' ? firebase.storage() : null;

// Enable offline persistence (Firestore)
if (db) {
    db.enablePersistence({ synchronizeTabs: true })
        .catch(err => console.warn('[Firebase] Persistence:', err.code));
}

// ── Global state ────────────────────────────────────────────
window.currentUser = null;

// ── DataStore — Firestore queries ───────────────────────────
window.DataStore = {

    async getUser(uid) {
        const doc = await db.collection('users').doc(uid).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async getAllUsers() {
        const snap = await db.collection('users').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getPlans() {
        const snap = await db.collection('plans').orderBy('price').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getTickets() {
        let q = db.collection('tickets').orderBy('lastUpdate', 'desc');
        if (window.currentUser?.role !== 'admin') {
            q = q.where('userId', '==', window.currentUser.id);
        }
        const snap = await q.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getTicketReplies(tid) {
        const snap = await db.collection('tickets').doc(tid)
            .collection('replies').orderBy('timestamp').get();
        return snap.docs.map(d => d.data());
    },

    async getNetworkSettings() {
        const doc = await db.collection('settings').doc('network').get();
        return doc.exists ? doc.data() : { ssid: '', password: '' };
    }
};
