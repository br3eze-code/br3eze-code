import { getAuth } from './firebase.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

/**
 * Verify a Firebase ID token and resolve it to the trusted application
 * identity used by API route authorization.
 */
async function verifyFirebaseIdToken(idToken) {
  try {
    const auth = getAuth();
    if (!auth || !idToken) return null;
    const decoded = await auth.verifyIdToken(idToken);
    const db = await getDatabase();
    const userDoc = await db.resolveFirebaseUser(decoded.uid, {});
    const profile = userDoc || {};
    return {
      uid: decoded.uid,
      email: decoded.email || profile.email || null,
      role: decoded.role || profile.role || 'user',
      tenantId: decoded.tenantId || profile.tenantId || null,
      siteId: decoded.siteId || profile.siteId || null,
      domain: decoded.domain || decoded.domainId || profile.domain || profile.domainId || null,
      influenceTier: decoded.influenceTier || profile.influenceTier || 'standard',
      customClaims: decoded,
    };
  } catch (e) {
    logger.debug(`[firebase-auth] verifyIdToken failed: ${e.message}`);
    return null;
  }
}

export { verifyFirebaseIdToken };
