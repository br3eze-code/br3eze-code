/**
 * Firebase Admin SDK Configuration
 */

import fs from 'fs';
import admin from 'firebase-admin';
import logger from '../utils/logger.js';

// Initialize Firebase Admin.
// Use env vars, never load a JSON key file in production.
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
        ? admin.credential.cert(JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')))
        : null
);

let _admin = null, db = null, auth = null, storage = null, messaging = null;

if (!credential) {
    logger.warn('Firebase credentials not configured; db/auth/storage will be null. Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL.');
} else {
    try {
        admin.initializeApp({
            credential,
            databaseURL:   process.env.FIREBASE_DATABASE_URL,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });

        db = admin.firestore();
        db.settings({
            ignoreUndefinedProperties: true,
            timestampsInSnapshots: true
        });

        auth = admin.auth();
        storage = admin.storage();
        messaging = admin.messaging();
        _admin = admin;

        logger.info('Firebase Admin SDK initialized successfully');
    } catch (error) {
        logger.error('Firebase initialization error:', error);
        throw error;
    }
}

export { _admin as admin, auth, db, storage, messaging };
