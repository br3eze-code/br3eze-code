import admin from 'firebase-admin';
import path from 'node:path';
import fs from 'node:fs';

let firebaseApp = null;
let db = null;

export function initializeFirebase() {
  if (firebaseApp) return { app: firebaseApp, db };
  if (admin.apps.length > 0) { firebaseApp = admin.app(); db = admin.firestore(); return { app: firebaseApp, db }; }
  try {
    let serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountPath && !path.isAbsolute(serviceAccountPath)) serviceAccountPath = path.resolve(process.cwd(), serviceAccountPath);
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: process.env.FIREBASE_DATABASE_URL });
    } else if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      firebaseApp = admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, privateKey, clientEmail: process.env.FIREBASE_CLIENT_EMAIL }), databaseURL: process.env.FIREBASE_DATABASE_URL });
    }
    if (!firebaseApp) return { app: null, db: null };
    db = admin.firestore(); db.settings({ ignoreUndefinedProperties: true });
    return { app: firebaseApp, db };
  } catch { return { app: null, db: null }; }
}
export function getFirestore() { if (!db) initializeFirebase(); return db; }
export function getFirebaseApp() { if (!firebaseApp) initializeFirebase(); return firebaseApp; }
export function getAuth() { const app = getFirebaseApp(); return app ? admin.auth(app) : null; }
export async function createAuthUser(identifier, opts = {}) {
  const auth = getAuth(); if (!auth) return null;
  const id = String(identifier).trim(); const payload = { disabled: false };
  if (id.includes('@')) { payload.email = id; payload.emailVerified = false; } else payload.phoneNumber = id.startsWith('+') ? id : `+${id}`;
  if (opts.displayName) payload.displayName = opts.displayName;
  try { return await auth.createUser(payload); } catch (error) { if (error.code === 'auth/email-already-exists' || error.code === 'auth/phone-number-already-exists') return null; throw error; }
}
export const adminSdk = admin;
export default { initializeFirebase, getFirestore, getFirebaseApp, getAuth, createAuthUser, admin: adminSdk };
