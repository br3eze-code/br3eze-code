import { verifySupabaseAccessToken } from '../../adapters/auth/supabase.js';

// Google and other configured identity providers are federated by Supabase.
// This middleware accepts only Supabase-issued human access tokens.
const AUTH_PROVIDER = 'supabase';
const VALID_PROVIDERS = new Set(['supabase']);

function extractBearer(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

async function resolveUser(req) {
  const token = extractBearer(req);
  if (!token) return null;
  const user = await verifySupabaseAccessToken(token);
  return user ? { ...user, authProvider: AUTH_PROVIDER } : null;
}

async function requireUser(req, res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: 'Valid Supabase Bearer token required' });
    req.user = user;
    req.supabaseUser = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Valid Supabase Bearer token required' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.map((role) => String(role).toLowerCase()).includes(String(req.user.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    return next();
  };
}

export { AUTH_PROVIDER, VALID_PROVIDERS, extractBearer, resolveUser, requireUser, requireRole };
