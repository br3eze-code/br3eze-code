import { getAuth } from './firebase.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

/**
 * Verifies a Firebase ID token and resolves it to {uid, email, role}.
 * Never throws — returns null on any failure so callers can fall through
 * to their existing auth path instead of erroring.
 */
async function verifyFirebaseIdToken(idToken) {
  const auth = getAuth();
  if (!auth || !idToken) return null;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    const db = await getDatabase();
    const userDoc = await db.resolveFirebaseUser(decoded.uid, {});
    return {
      uid: decoded.uid,
      email: decoded.email || userDoc?.email || null,
      role: userDoc?.role || 'user',
    };
  } catch (e) {
    logger.debug(`[firebase-auth] verifyIdToken failed: ${e.message}`);
    return null;
  }
}

export { verifyFirebaseIdToken };
