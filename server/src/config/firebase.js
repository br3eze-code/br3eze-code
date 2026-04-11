/**
 * Firebase Admin SDK Configuration
 */

const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

// Initialize Firebase Admin
// Use env vars — never load a JSON key file in production
const credential = (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL
) ? admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
}) : (
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        ? admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH))
        : null
);

if (!credential) throw new Error('Firebase credentials not configured — set FIREBASE_PROJECT_ID / PRIVATE_KEY / CLIENT_EMAIL');

admin.initializeApp({
    credential,
    databaseURL:   process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
});

        // Enable Firestore offline persistence (for server)
        const db = admin.firestore();
        db.settings({
            ignoreUndefinedProperties: true,
            timestampsInSnapshots: true
        });

        logger.info('✅ Firebase Admin SDK initialized successfully');

        return {
            admin,
            auth: admin.auth(),
            db,
            storage: admin.storage(),
            messaging: admin.messaging()
        };

    } catch (error) {
        logger.error('❌ Firebase initialization error:', error);
        throw error;
    }
};

const { auth, db, storage, messaging } = initializeFirebase();

module.exports = {
    admin,
    auth,
    db,
    storage,
    messaging
};
