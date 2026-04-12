/**
 * Firebase Admin Initialization
 * @module core/firebase
 */

const admin = require('firebase-admin');
const { logger } = require('./logger');
const { getConfig } = require('./config');

let firebaseApp = null;
let db = null;

function initializeFirebase() {
  if (firebaseApp) {
    return { app: firebaseApp, db };
  }

  try {
    // Check for service account credentials
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccountPath && require('fs').existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      
      logger.info('Firebase initialized with service account');
    } else if (process.env.FIREBASE_API_KEY) {
      // Use application default credentials or API key
      firebaseApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
      
      logger.info('Firebase initialized with application credentials');
    } else {
      logger.warn('Firebase credentials not found. Database features disabled.');
      return { app: null, db: null };
    }

    db = admin.firestore();
    
    // Enable offline persistence for Firestore
    db.settings({
      cacheSizeBytes: admin.firestore.CACHE_SIZE_UNLIMITED
    });

    return { app: firebaseApp, db };
  } catch (error) {
    logger.error('Firebase initialization failed:', error.message);
    return { app: null, db: null };
  }
}

function getFirestore() {
  if (!db) {
    initializeFirebase();
  }
  return db;
}

function getFirebaseApp() {
  if (!firebaseApp) {
    initializeFirebase();
  }
  return firebaseApp;
}

module.exports = {
  initializeFirebase,
  getFirestore,
  getFirebaseApp,
  admin
};
