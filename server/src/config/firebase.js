/**
 * Firebase Admin SDK Configuration
 */

const admin = require('firebase-admin');
const path = require('path');
const logger = require('../utils/logger');

// Initialize Firebase Admin
// Use env vars — never load a JSON key file in production
const credential =
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_CLIENT_EMAIL
    ? admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      })
    : process.env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH))
      : null;

if (!credential) {
  logger.warn(
    '⚠️  Firebase credentials not configured — db/auth/storage will be null. Set FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / FIREBASE_CLIENT_EMAIL.'
  );
  module.exports = { admin: null, auth: null, db: null, storage: null, messaging: null };
  return;
}

let db, auth, storage, messaging;

try {
  admin.initializeApp({
    credential,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  // Enable Firestore offline persistence (for server)
  db = admin.firestore();
  db.settings({
    ignoreUndefinedProperties: true,
    timestampsInSnapshots: true,
  });

  auth = admin.auth();
  storage = admin.storage();
  messaging = admin.messaging();

  logger.info('✅ Firebase Admin SDK initialized successfully');
} catch (error) {
  logger.error('❌ Firebase initialization error:', error);
  throw error;
}

module.exports = { admin, auth, db, storage, messaging };
