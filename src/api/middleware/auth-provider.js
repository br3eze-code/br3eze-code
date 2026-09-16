import { verifyFirebaseIdToken } from '../../core/firebase-auth.js';
import { verifySupabaseAccessToken } from '../../adapters/auth/supabase.js';

const AUTH_PROVIDER = String(process.env.AUTH_PROVIDER || 'auto').trim().toLowerCase();

function extractBearer(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function verifyWithProvider(provider, token) {
  if (provider === 'supabase') return verifySupabaseAccessToken(token);
  if (provider === 'firebase') return verifyFirebaseIdToken(token);
  return null;
}

async function resolveUser(req) {
  const token = extractBearer(req);
  if (!token) return null;

  if (AUTH_PROVIDER === 'supabase' || AUTH_PROVIDER === 'firebase') {
    const user = await verifyWithProvider(AUTH_PROVIDER, token);
    return user ? { ...user, authProvider: AUTH_PROVIDER } : null;
  }

  // auto: accept either provider, but normalize to one req.user contract.
  const supabaseUser = await verifyWithProvider('supabase', token);
  if (supabaseUser) return supabaseUser;
  const firebaseUser = await verifyWithProvider('firebase', token);
  return firebaseUser || null;
}

async function requireUser(req, res, next) {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ error: 'Valid Bearer token required' });
  req.user = user;
  if (user.authProvider === 'supabase') req.supabaseUser = user;
  if (user.authProvider === 'firebase') req.firebaseUser = user;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient role' });
    return next();
  };
}

export { AUTH_PROVIDER, extractBearer, resolveUser, requireUser, requireRole };
