import express from 'express';

async function resolveFirebaseDataUser(auth, user, { createIfMissing = true } = {}) {
  const email = String(user?.email || '').trim().toLowerCase();
  const emailVerified = user?.emailVerified === true || user?.metadata?.emailVerified === true;
  if (!auth || !email || !emailVerified) return null;

  let firebaseUser;
  try {
    firebaseUser = await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code !== 'auth/user-not-found' || !createIfMissing) return null;
    firebaseUser = await auth.createUser({
      uid: String(user.id || user.uid),
      email,
      displayName: user.name || user.fullName || email,
      emailVerified: true,
      disabled: false,
    });
  }

  return firebaseUser?.disabled ? null : firebaseUser || null;
}

function createFirebaseDataSessionRouter({ requireUser, getFirebaseAuth } = {}) {
  if (typeof requireUser !== 'function' || typeof getFirebaseAuth !== 'function') {
    throw new TypeError('requireUser and getFirebaseAuth are required');
  }

  const router = express.Router();
  router.post('/', requireUser, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = req.user || {};
    if (!user.email || !(user.emailVerified === true || user.metadata?.emailVerified === true)) {
      return res.status(403).json({ error: 'A verified Supabase email is required' });
    }

    try {
      const auth = getFirebaseAuth();
      if (!auth) return res.status(503).json({ error: 'Legacy Firebase data bridge is not configured' });
      const firebaseUser = await resolveFirebaseDataUser(auth, user);
      if (!firebaseUser) return res.status(403).json({ error: 'Account is not eligible for the legacy data session' });

      const claims = {
        supabase_uid: String(user.id || user.uid),
        auth_provider: 'supabase',
        role: String(user.role || 'user').toLowerCase(),
        tenant_id: user.tenantId || null,
        site_id: user.siteId || null,
        domain_id: user.domainId || user.domain || null,
      };
      await auth.setCustomUserClaims(firebaseUser.uid, claims);
      const customToken = await auth.createCustomToken(firebaseUser.uid, claims);

      return res.json({
        token: customToken,
        uid: firebaseUser.uid,
        provider: 'supabase',
        role: claims.role,
        supabaseUid: claims.supabase_uid
      });
    } catch (error) {
      console.error('[auth] Firebase data-session bridge failed:', error?.code || 'unknown');
      return res.status(503).json({ error: 'Could not establish the legacy data session' });
    }
  });

  return router;
}

export { createFirebaseDataSessionRouter, resolveFirebaseDataUser };
export default createFirebaseDataSessionRouter;
