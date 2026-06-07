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

  // Check if already initialized by another module (e.g. database.js)
  if (admin.apps.length > 0) {
    firebaseApp = admin.app();
    db = admin.firestore();
    logger.debug('Firebase: reusing existing initialization');
    return { app: firebaseApp, db };
  }

  try {
    const path = require('path');
    const fs = require('fs');
    let serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    if (serviceAccountPath) {
      if (!path.isAbsolute(serviceAccountPath)) {
        serviceAccountPath = path.resolve(process.cwd(), serviceAccountPath);
      }
      
      if (fs.existsSync(serviceAccountPath)) {
        try {
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
          });
          logger.info('Firebase initialized with service account');
        } catch (e) {
          logger.error(`Firebase: Service account init failed: ${e.message}`);
        }
      }
    }
    
    if (!firebaseApp && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.length > 32) {
      try {
        // Use private key components from env
        let pk = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);
        
        let body = pk;
        if (pk.includes('-----BEGIN PRIVATE KEY-----')) {
            body = pk.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '');
        }
        body = body.replace(/\s+/g, '');
        let chunks = [];
        for (let i = 0; i < body.length; i += 64) {
            chunks.push(body.substring(i, i + 64));
        }
        pk = `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----`;
        
        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: pk,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          }),
          databaseURL: process.env.FIREBASE_DATABASE_URL
        });
        logger.info('Firebase initialized with private key from env');
      } catch (e) {
        logger.error(`Firebase: Private key init failed: ${e.message}`);
      }
    } 
    
    if (!firebaseApp) {
      logger.warn('Firebase credentials not found or invalid. Database features disabled.');
      return { app: null, db: null };
    }

    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });

    return { app: firebaseApp, db };
  } catch (error) {
    logger.error(`Firebase initialization failed: ${error.message}`);
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

/**
 * Returns the high-level Database instance.
 * @returns {Promise<any>}
 */
async function getDatabase() {
  return require('./database').getDatabase();
}

/**
 * Returns the Firebase Auth instance bound to the initialized app.
 * Always use this instead of admin.auth() directly to ensure the app
 * is initialized before accessing Auth.
 * @returns {admin.auth.Auth | null}
 */
function getAuth() {
  const app = getFirebaseApp();
  if (!app) return null;
  return admin.auth(app);
}

/**
 * Provision a new Firebase Auth user for an SMS/USSD/Email channel identifier
 * that doesn't already have an Auth record.
 *
 * @param {string} identifier  Phone number (E.164) or email address
 * @param {{ channel: string, displayName?: string }} [opts]
 * @returns {Promise<admin.auth.UserRecord | null>}
 */
async function createAuthUser(identifier, opts = {}) {
  const auth = getAuth();
  if (!auth) return null;

  const id = String(identifier).trim();

  try {
    const payload = { disabled: false };

    if (id.includes('@')) {
      payload.email = id;
      payload.emailVerified = false;
    } else {
      // Normalize to E.164 — add + if missing
      payload.phoneNumber = id.startsWith('+') ? id : `+${id}`;
    }

    if (opts.displayName) payload.displayName = opts.displayName;

    const record = await auth.createUser(payload);
    logger.info(`[Firebase] createAuthUser: provisioned uid:${record.uid} for ${id} via ${opts.channel || 'unknown'}`);
    return record;
  } catch (err) {
    // auth/email-already-exists / auth/phone-number-already-exists — safe to ignore, caller should retry getUserBy*
    if (err.code === 'auth/email-already-exists' || err.code === 'auth/phone-number-already-exists') {
      logger.debug(`[Firebase] createAuthUser: identifier already exists (${err.code}) — skipping`);
      return null;
    }
    logger.error(`[Firebase] createAuthUser failed for ${id}: ${err.message}`);
    return null;
  }
}

module.exports = {
  initializeFirebase,
  getFirestore,
  getFirebaseApp,
  getAuth,
  getDatabase,
  createAuthUser,
  admin
};
