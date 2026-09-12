import { getAuth } from '../adapters/firebase/admin.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

/** Compatibility auth entry point; provider implementation lives in adapters. */
async function verifyFirebaseIdToken(idToken) {
  const auth = getAuth();
  if (!auth || !idToken) return null;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    const db = await getDatabase();
    const userDoc = await db.resolveFirebaseUser(decoded.uid, {});
    return { uid: decoded.uid, email: decoded.email || userDoc?.email || null, role: userDoc?.role || 'user' };
  } catch (error) { logger.debug(`Identity token verification failed: ${error.message}`); return null; }
}

export { verifyFirebaseIdToken };
