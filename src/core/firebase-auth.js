import sdk from '../plugin-sdk/index.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

/** Compatibility entry point. Identity verification is supplied by a registered provider. */
async function verifyFirebaseIdToken(idToken, { identityProvider = null } = {}) {
  if (!idToken) return null;
  const provider = identityProvider || (sdk.hasProvider('identity') ? sdk.getProvider('identity') : null);
  if (!provider?.verifyToken) return null;
  try {
    const decoded = await provider.verifyToken(idToken);
    if (!decoded?.uid) return null;
    const db = await getDatabase();
    const userDoc = await db.resolveFirebaseUser(decoded.uid, {});
    return { uid: decoded.uid, email: decoded.email || userDoc?.email || null, role: userDoc?.role || 'user' };
  } catch (error) { logger.debug(`Identity token verification failed: ${error.message}`); return null; }
}

export { verifyFirebaseIdToken };
