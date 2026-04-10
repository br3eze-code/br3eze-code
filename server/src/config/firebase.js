/**
 * Firebase Admin SDK Configuration
 */

const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

// Initialize Firebase Admin
const initializeFirebase = () => {
    try {
        // Check if already initialized
        if (admin.apps.length > 0) {
            return { admin, auth: admin.auth(), db: admin.firestore() };
        }

        // Load service account
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
            || path.join(__dirname, '../../serviceAccountKey.json');

        const serviceAccount = require(serviceAccountPath);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL,
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