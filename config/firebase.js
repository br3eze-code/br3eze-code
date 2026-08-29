'use strict';
/**
 * Firebase Admin SDK initializer
 * Supports multiple credential strategies (priority order):
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var (file path)
 *   2. FIREBASE_SERVICE_ACCOUNT env var (JSON string)
 *   3. Application Default Credentials (Cloud Run / GCE)
 */

import admin from 'firebase-admin';
import fs from 'fs';

let _db   = null;
let _auth = null;
let _initialized = false;

function getCredential() {
  // 1. File path via env
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fs.existsSync(p)) {
      return admin.credential.cert(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  }

  // 2. JSON string via env (Cloud Run secret)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
    } catch {
      console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT JSON parse failed');
    }
  }

  // 3. ADC (Cloud Run, GCE, Cloud Shell). No repository-local fallback is allowed.
  return admin.credential.applicationDefault();
}

function init() {
  if (_initialized || admin.apps.length > 0) return;

  try {
    admin.initializeApp({
      credential: getCredential(),
      projectId:  process.env.FIREBASE_PROJECT_ID || undefined,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    _initialized = true;

    const db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });

    _db   = db;
    _auth = admin.auth();
    console.log('[firebase] ✅ Initialized');
  } catch (err) {
    console.error('[firebase] ❌ Init failed:', err.message);
    // Don't throw — let callers handle null db gracefully
  }
}

// Lazy init on first access
const firebaseProxy = {
  get db()   { if (!_db)   init(); return _db;   },
  get auth() { if (!_auth) init(); return _auth; },
  get admin(){ return admin; },
  init,
};

export default firebaseProxy;
