import sdk from '../plugin-sdk/index.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

<<<<<<< HEAD
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
=======
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
>>>>>>> origin/main
}

export { verifyFirebaseIdToken };
