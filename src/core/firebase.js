'use strict';
/**
 * src/core/firebase.js
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for Firebase Admin SDK initialization.
 *
 * Previously this repo had FOUR independent init paths (src/core/
 * database.js, server/src/config/firebase.js, src/core/firebase.js,
 * config/firebase.js), each with different env-var expectations and
 * most missing an admin.apps.length guard — so loading more than one
 * of them in the same process threw "the default Firebase app
 * already exists", and setting FIREBASE_SERVICE_ACCOUNT correctly
 * for one silently broke another (one file treated it as a file
 * path, another as an inline JSON string). This module is now the
 * only place that calls admin.initializeApp(); everything else
 * requires this file.
 *
 * Credential resolution priority (first match wins):
 *   1. GOOGLE_APPLICATION_CREDENTIALS   — file path (GCP standard)
 *   2. FIREBASE_SERVICE_ACCOUNT_PATH    — explicit file path
 *   3. FIREBASE_SERVICE_ACCOUNT         — file path OR inline JSON
 *                                          (auto-detected)
 *   4. FIREBASE_PROJECT_ID + FIREBASE_PRIVATE_KEY + FIREBASE_CLIENT_EMAIL
 *   5. ./serviceAccountKey.json next to repo root (local dev)
 *   6. Application Default Credentials  — Cloud Run / GCE / Cloud Shell
 *
 * Safe to require() from any number of modules — init() is
 * idempotent (checked via admin.apps.length, not a local variable,
 * so it's correct even across multiple require() cache entries in
 * edge cases like symlinked paths).
 * ─────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { logger } = require('./logger');

let _db = null;
let _auth = null;
let _storage = null;
let _messaging = null;
let _initError = null;

function _normalizePrivateKey(raw) {
  let pk = raw.replace(/\\n/g, '\n');
  if (pk.startsWith('"') && pk.endsWith('"')) pk = pk.slice(1, -1);
  if (!pk.includes('-----BEGIN PRIVATE KEY-----')) {
    pk = `-----BEGIN PRIVATE KEY-----\n${pk}\n-----END PRIVATE KEY-----`;
  }
  return pk;
}

function _resolveCredential() {
  // 1. GOOGLE_APPLICATION_CREDENTIALS (file path)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const p = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (fs.existsSync(p)) {
      logger.info(`[Firebase] credential source: GOOGLE_APPLICATION_CREDENTIALS (${p})`);
      return admin.credential.cert(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
    logger.warn(`[Firebase] GOOGLE_APPLICATION_CREDENTIALS set but file not found: ${p}`);
  }

  // 2. FIREBASE_SERVICE_ACCOUNT_PATH (explicit file path)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const p = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (fs.existsSync(p)) {
      logger.info(`[Firebase] credential source: FIREBASE_SERVICE_ACCOUNT_PATH (${p})`);
      return admin.credential.cert(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
    logger.warn(`[Firebase] FIREBASE_SERVICE_ACCOUNT_PATH set but file not found: ${p}`);
  }

  // 3. FIREBASE_SERVICE_ACCOUNT — could be a file path OR an inline JSON
  //    string. Auto-detect: try JSON.parse first (Cloud Run secrets are
  //    usually injected as raw JSON), fall back to treating it as a path.
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const val = process.env.FIREBASE_SERVICE_ACCOUNT;
    try {
      const parsed = JSON.parse(val);
      logger.info('[Firebase] credential source: FIREBASE_SERVICE_ACCOUNT (inline JSON)');
      return admin.credential.cert(parsed);
    } catch (_) {
      const p = path.isAbsolute(val) ? val : path.resolve(process.cwd(), val);
      if (fs.existsSync(p)) {
        logger.info(`[Firebase] credential source: FIREBASE_SERVICE_ACCOUNT (path: ${p})`);
        return admin.credential.cert(JSON.parse(fs.readFileSync(p, 'utf8')));
      }
      logger.warn(
        '[Firebase] FIREBASE_SERVICE_ACCOUNT is neither valid JSON nor an existing file path'
      );
    }
  }

  // 4. Individual fields
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL
  ) {
    logger.info('[Firebase] credential source: FIREBASE_PROJECT_ID/PRIVATE_KEY/CLIENT_EMAIL');
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: _normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    });
  }

  // 5. Local serviceAccountKey.json next to repo root (dev convenience)
  const localKey = path.join(__dirname, '../../serviceAccountKey.json');
  if (fs.existsSync(localKey)) {
    logger.info(`[Firebase] credential source: local ${localKey}`);
    // eslint-disable-next-line global-require -- dynamic path, only reached in local dev
    return admin.credential.cert(require(localKey));
  }

  // 6. Application Default Credentials (Cloud Run / GCE / Cloud Shell)
  try {
    logger.info('[Firebase] credential source: Application Default Credentials');
    return admin.credential.applicationDefault();
  } catch (_) {
    return null;
  }
}

function init() {
  if (admin.apps.length > 0) {
    if (!_db) _hydrateHandles();
    return { admin, db: _db, auth: _auth, storage: _storage, messaging: _messaging };
  }
  if (_initError) {
    // Already tried and failed this process — don't retry-storm on every require()
    return { admin, db: null, auth: null, storage: null, messaging: null };
  }

  const credential = _resolveCredential();
  if (!credential) {
    logger.warn(
      '[Firebase] no credentials found — db/auth/storage/messaging will be null. ' +
        'Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT(_PATH), or ' +
        'FIREBASE_PROJECT_ID/FIREBASE_PRIVATE_KEY/FIREBASE_CLIENT_EMAIL.'
    );
    return { admin, db: null, auth: null, storage: null, messaging: null };
  }

  try {
    admin.initializeApp({
      credential,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    _hydrateHandles();
    logger.info('[Firebase] ✅ initialized');
  } catch (err) {
    _initError = err;
    logger.error(`[Firebase] ❌ init failed: ${err.message}`);
    // Don't throw — callers must handle null db/auth gracefully. A single
    // misconfigured credential should degrade the app, not crash the process.
  }

  return { admin, db: _db, auth: _auth, storage: _storage, messaging: _messaging };
}

function _hydrateHandles() {
  _db = admin.firestore();
  _db.settings({ ignoreUndefinedProperties: true });
  _auth = admin.auth();
  try {
    _storage = admin.storage();
  } catch (_) {
    _storage = null;
  }
  try {
    _messaging = admin.messaging();
  } catch (_) {
    _messaging = null;
  }
}

// Eager init on first require() — safe because init() itself is idempotent
// and never throws.
const handles = init();

module.exports = {
  admin,
  db: handles.db,
  auth: handles.auth,
  storage: handles.storage,
  messaging: handles.messaging,
  init,
  // Lazy getters — useful for callers that require() this module before
  // env vars are set (e.g. dotenv loaded later in boot order).
  getDb: () => (admin.apps.length ? (_db ?? init().db) : init().db),
  getAuth: () => (admin.apps.length ? (_auth ?? init().auth) : init().auth),
  // Back-compat shim for callers written against the old { app, db }
  // shape (scripts/reconcile-users.js, scripts/debug-users.js).
  initializeFirebase: () => {
    const result = init();
    return { app: admin.apps.length ? admin.app() : null, db: result.db };
  },
};
