/**
 * Firebase Admin SDK Configuration.
 * Human identity is Supabase; Admin SDK is used only for legacy Firestore data
 * and server-minted Firebase data-session tokens.
 */
import fs from 'fs';
import admin from 'firebase-admin';
import logger from '../utils/logger.js';

const explicitCredential = (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL
) ? admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
}) : (
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        ? admin.credential.cert(JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8')))
        : null
);
const useApplicationDefault = Boolean(
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_CONFIG ||
    process.env.K_SERVICE ||
    process.env.FUNCTIONS_EMULATOR
);
const credential = explicitCredential || (useApplicationDefault ? admin.credential.applicationDefault() : null);

let _admin = null, db = null, auth = null, storage = null, messaging = null;

if (!credential) {
    logger.warn('Firebase Admin data adapter is not configured; set service-account credentials or deploy with Google Application Default Credentials.');
} else {
    try {
        admin.initializeApp({
            credential,
            databaseURL: process.env.FIREBASE_DATABASE_URL,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
        });

        db = admin.firestore();
        db.settings({ ignoreUndefinedProperties: true });
        auth = admin.auth();
        storage = admin.storage();
        messaging = admin.messaging();
        _admin = admin;

        logger.info('Firebase Admin data adapter initialized');
    } catch (error) {
        logger.error('Firebase initialization error:', error);
        throw error;
    }
}

export { _admin as admin, auth, db, storage, messaging };
