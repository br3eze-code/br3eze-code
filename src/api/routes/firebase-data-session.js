import express from 'express';

function createFirebaseDataSessionRouter({ requireUser, getFirebaseAuth } = {}) {
  if (typeof requireUser !== 'function' || typeof getFirebaseAuth !== 'function') {
    throw new TypeError('requireUser and getFirebaseAuth are required');
  }

  const router = express.Router();
  router.post('/', requireUser, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const user = req.user || {};
    const email = String(user.email || '').trim().toLowerCase();
    const emailVerified = user.emailVerified === true || user.metadata?.emailVerified === true;

    if (!email || !emailVerified) {
      return res.status(403).json({ error: 'A verified Supabase email is required' });
    }

    try {
      const auth = getFirebaseAuth();
      if (!auth) return res.status(503).json({ error: 'Legacy Firebase data bridge is not configured' });

      let firebaseUser;
      try {
        firebaseUser = await auth.getUserByEmail(email);
      } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error;
        firebaseUser = await auth.createUser({
          uid: String(user.id || user.uid),
          email,
          displayName: user.name || user.fullName || email,
          emailVerified: true,
          disabled: false,
        });
      }

      if (firebaseUser.disabled) return res.status(403).json({ error: 'Account is disabled' });

      const customToken = await auth.createCustomToken(firebaseUser.uid, {
        supabase_uid: String(user.id || user.uid),
        auth_provider: 'supabase',
        role: String(user.role || 'user').toLowerCase(),
        tenant_id: user.tenantId || null,
        site_id: user.siteId || null,
        domain_id: user.domainId || user.domain || null,
      });

      return res.json({ token: customToken, uid: firebaseUser.uid, provider: 'supabase', role: String(user.role || 'user').toLowerCase() });
    } catch (error) {
      console.error('[auth] Firebase data-session bridge failed:', error?.code || 'unknown');
      return res.status(503).json({ error: 'Could not establish the legacy data session' });
    }
  });

  return router;
}

export { createFirebaseDataSessionRouter };
export default createFirebaseDataSessionRouter;
