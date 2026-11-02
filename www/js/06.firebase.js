/* ==========================================================
   06.firebase.js — Firebase legacy data adapter only,
                    offline persistence, DataStore queries
   Depends on: Firebase SDK (loaded in index.html)
   ========================================================== */

const firebaseDataRuntime = window.ENV || {};
const firebaseDataConfig = {
    apiKey: firebaseDataRuntime.FIREBASE_WEB_API_KEY || firebaseDataRuntime.FIREBASE_API_KEY || '',
    authDomain: firebaseDataRuntime.FIREBASE_AUTH_DOMAIN || '',
    databaseURL: firebaseDataRuntime.FIREBASE_DATABASE_URL || '',
    projectId: firebaseDataRuntime.FIREBASE_PROJECT_ID || '',
    storageBucket: firebaseDataRuntime.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: firebaseDataRuntime.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: firebaseDataRuntime.FIREBASE_APP_ID || '',
    measurementId: firebaseDataRuntime.FIREBASE_MEASUREMENT_ID || ''
};

const firebaseDataConfigured = Object.values(firebaseDataConfig).filter(Boolean).length >= 3;
if (typeof firebase !== 'undefined' && firebaseDataConfigured && !firebase.apps.length) {
    firebase.initializeApp(firebaseDataConfig);
}

const firebaseDataDb = firebaseDataConfigured && typeof firebase !== 'undefined' ? firebase.firestore() : null;
const firebaseDataStorage = firebaseDataConfigured && typeof firebase !== 'undefined' ? firebase.storage() : null;

// Human identity is Supabase. Firebase Auth is only a downstream Firestore
// session established from a verified Supabase token by the server.

// Enable offline persistence (Firestore)
if (firebaseDataDb) {
    firebaseDataDb.enablePersistence({ synchronizeTabs: true })
        .catch(err => console.warn('[Firebase] Persistence:', err.code));
}

// ── Global state ────────────────────────────────────────────
window.currentUser = null;

// ── DataStore — Firestore queries ───────────────────────────
const firebaseApiData = async (resource, options = {}) => {
    if (!window.ApiClient) return null;
    const query = new URLSearchParams({ resource, ...(options.id ? { id: options.id } : {}) });
    return window.ApiClient.fetch(`/data_api.php?${query}`, options.request || {}).then(result => result.data || []);
};

const firebaseDataAdapter = {

    async getUser(uid) {
        const remote = await firebaseApiData('users', { id: uid });
        if (remote) return remote[0] || null;
        const doc = await firebaseDataDb.collection('users').doc(uid).get();
        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    },

    async getAllUsers() {
        const remote = await firebaseApiData('users');
        if (remote) return remote;
        const snap = await firebaseDataDb.collection('users').orderBy('createdAt', 'desc').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getProducts() {
        const remote = await firebaseApiData('products');
        if (remote) return remote;
        const snap = await firebaseDataDb.collection('products').where('active', '==', true).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getPlans() {
        const remote = await firebaseApiData('plans');
        if (remote) return remote;
        const snap = await firebaseDataDb.collection('plans').orderBy('price').get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getTickets() {
        const remote = await firebaseApiData('tickets');
        if (remote) return remote;
        let q = firebaseDataDb.collection('tickets').orderBy('lastUpdate', 'desc');
        if (window.currentUser?.role !== 'admin') {
            q = q.where('userId', '==', window.currentUser.id);
        }
        const snap = await q.get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async getTicketReplies(tid) {
        const snap = await firebaseDataDb.collection('tickets').doc(tid)
            .collection('replies').orderBy('timestamp').get();
        return snap.docs.map(d => d.data());
    },

    async getNetworkSettings() {
        const doc = await firebaseDataDb.collection('settings').doc('network').get();
        return doc.exists ? doc.data() : { ssid: '', password: '' };
    }
};

window.AgentOSProviders?.registerData(firebaseDataAdapter);
window.DataStore = firebaseDataAdapter;
