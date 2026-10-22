import sdk from '../plugin-sdk/index.js';
import { logger } from './logger.js';
import { getDatabase } from './database.js';

/**
 * Compatibility adapter for Firebase-style identity tokens.
 * Verification is delegated to the registered identity provider so Core does
 * not import a concrete identity vendor. Trusted profile fields are resolved
 * server-side; client-provided roles are never accepted as authority.
 */
async function verifyFirebaseIdToken(idToken, { identityProvider = null } = {}) {
  if (!idToken) return null;
  const provider = identityProvider || (sdk.hasProvider('identity') ? sdk.getProvider('identity') : null);
  if (!provider || typeof provider.verifyToken !== 'function') return null;

  try {
    const decoded = await provider.verifyToken(idToken);
    if (!decoded?.uid) return null;

    const db = await getDatabase();
    const profile = (await db.resolveFirebaseUser(decoded.uid, {})) || {};
    return {
      uid: decoded.uid,
      email: decoded.email || profile.email || null,
      role: profile.role || 'user',
      tenantId: profile.tenantId || null,
      siteId: profile.siteId || null,
      domain: profile.domain || profile.domainId || null,
      influenceTier: profile.influenceTier || 'standard',
      customClaims: decoded,
    };
  } catch (error) {
    logger.debug(`Identity token verification failed: ${error.message}`);
    return null;
  }
}

export { verifyFirebaseIdToken };
