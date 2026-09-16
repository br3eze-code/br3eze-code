import { verifySupabaseAccessToken } from '../../adapters/auth/supabase.js';

async function resolveSupabaseUser(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return verifySupabaseAccessToken(match[1]);
}

async function requireSupabaseUser(req, res, next) {
  const user = await resolveSupabaseUser(req);
  if (!user) return res.status(401).json({ error: 'Invalid or expired Supabase token' });
  req.user = user;
  req.supabaseUser = user;
  return next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.supabaseUser) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.supabaseUser.role)) return res.status(403).json({ error: 'Insufficient role' });
    return next();
  };
}

export { requireSupabaseUser, requireRole, resolveSupabaseUser };
