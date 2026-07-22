/* ==========================================================
   06.firebase.js — Firebase init, auth/db/storage handles,
                    offline persistence, DataStore queries
   Depends on: Firebase SDK (loaded in index.html)
   ========================================================== */

const firebaseConfig = {
    apiKey:            'AIzaSyANPQZKsAV9VsW9vKZJ3ghhrpnkxuLfdP8',
    authDomain:        'br3eze-africa-312df.firebaseapp.com',
    databaseURL:       'https://br3eze-africa-312df-default-rtdb.firebaseio.com',
    projectId:         'br3eze-africa-312df',
    storageBucket:     'br3eze-africa-312df.firebasestorage.app',
    messagingSenderId: '123902078923',
    appId:             '1:123902078923:web:1153a45add9fe25208504e',
    measurementId:     'G-Y6YS53B86S'
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth    = firebase.auth();
const db      = firebase.firestore();
const storage = firebase.storage();

// Enable offline persistence (Firestore)
db.enablePersistence({ synchronizeTabs: true })
    .catch(err => console.warn('[Firebase] Persistence:', err.code));

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
