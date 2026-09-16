import { requireUser, requireRole, resolveUser } from './auth-provider.js';

async function resolveSupabaseUser(req) {
  const user = await resolveUser(req);
  return user?.authProvider === 'supabase' ? user : null;
}

async function requireSupabaseUser(req, res, next) {
  return requireUser(req, res, next);
}

export { requireSupabaseUser, requireRole, resolveSupabaseUser };
