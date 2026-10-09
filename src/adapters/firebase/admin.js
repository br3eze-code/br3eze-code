import admin from 'firebase-admin';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../core/logger.js';
import { getConfig } from '../../core/config.js';
import { getDatabase as getDatabaseFromDatabase } from '../../core/database.js';

let firebaseApp = null;
let db = null;

export function initializeFirebase() {
  if (firebaseApp) return { app: firebaseApp, db };
  if (admin.apps.length > 0) { firebaseApp = admin.app(); db = admin.firestore(); return { app: firebaseApp, db }; }
  try {
    let serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountPath) {
      try {
        const cfg = getConfig();
        if (cfg?.firebase?.enabled && cfg.firebase.type === 'serviceAccount' && cfg.firebase.serviceAccount) serviceAccountPath = cfg.firebase.serviceAccount;
      } catch (_) { /* optional configuration */ }
    }
    if (serviceAccountPath) {
      if (!path.isAbsolute(serviceAccountPath)) serviceAccountPath = path.resolve(process.cwd(), serviceAccountPath);
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: process.env.FIREBASE_DATABASE_URL });
      }
    }
    if (!firebaseApp && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.length > 32) {
      let pk = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);
      firebaseApp = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, privateKey: pk, clientEmail: process.env.FIREBASE_CLIENT_EMAIL }), databaseURL: process.env.FIREBASE_DATABASE_URL });
    }
    if (!firebaseApp) return { app: null, db: null };
    db = admin.firestore(); db.settings({ ignoreUndefinedProperties: true });
    return { app: firebaseApp, db };
  } catch (error) { logger.error(`Firebase adapter initialization failed: ${error.message}`); return { app: null, db: null }; }
}

export function getFirestore() { if (!db) initializeFirebase(); return db; }
export function getFirebaseApp() { if (!firebaseApp) initializeFirebase(); return firebaseApp; }
export async function getDatabase() { return getDatabaseFromDatabase(); }
export function getAuth() { const app = getFirebaseApp(); return app ? admin.auth(app) : null; }
export async function createAuthUser(identifier, opts = {}) {
  const auth = getAuth(); if (!auth) return null;
  const id = String(identifier).trim();
  try {
    const payload = { disabled: false };
    if (id.includes('@')) { payload.email = id; payload.emailVerified = false; } else payload.phoneNumber = id.startsWith('+') ? id : `+${id}`;
    if (opts.displayName) payload.displayName = opts.displayName;
    return await auth.createUser(payload);
  } catch (error) {
    if (error.code === 'auth/email-already-exists' || error.code === 'auth/phone-number-already-exists') return null;
    logger.error(`Firebase auth provisioning failed: ${error.message}`); return null;
  }
}

export { admin };
export default { initializeFirebase, getFirestore, getFirebaseApp, getAuth, getDatabase, createAuthUser, admin };
