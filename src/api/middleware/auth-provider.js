import { verifySupabaseAccessToken } from '../../adapters/auth/supabase.js';

// All interactive identity providers (Google, GitHub, Azure/Microsoft, Apple,
// Facebook, etc.) terminate at Supabase Auth. The API accepts only the resulting
// Supabase access token; Firebase remains a data adapter, not an identity issuer.
const AUTH_PROVIDER = 'supabase';
const VALID_PROVIDERS = new Set(['supabase']);

function extractBearer(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\\s+(.+)$/i);
  return match?.[1] || null;
}

async function resolveUser(req) {
  const token = extractBearer(req);
  if (!token) return null;
  try {
    const user = await verifySupabaseAccessToken(token);
    return user ? { ...user, authProvider: 'supabase' } : null;
  } catch {
    return null;
  }
}

async function requireUser(req, res, next) {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ error: 'Valid Supabase Bearer token required' });
  req.user = user;
  req.supabaseUser = user;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient role' });
    return next();
  };
}

export { AUTH_PROVIDER, VALID_PROVIDERS, extractBearer, resolveUser, requireUser, requireRole };
