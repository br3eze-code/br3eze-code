import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function getConfig() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  };
}
let adminClient;

function loadCreateClient() {
  try {
    const sdk = require('@supabase/supabase-js');
    if (typeof sdk.createClient !== 'function') throw new TypeError('createClient export unavailable');
    return sdk.createClient;
  } catch (cause) {
    const error = new Error(
      'SUPABASE_ADAPTER_DEPENDENCY_MISSING: install @supabase/supabase-js to enable Supabase persistence'
    );
    error.code = 'SUPABASE_ADAPTER_DEPENDENCY_MISSING';
    error.cause = cause;
    throw error;
  }
}

/** Server-only Supabase service client for persistence adapters. */
function getSupabaseAdmin() {
  const { url, serviceKey } = getConfig();
  if (!url || !serviceKey) return null;
  if (!adminClient) {
    const createClient = loadCreateClient();
    adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

/**
 * The one shared human-token verifier for API handlers and the Functions
 * server. It validates the bearer token with Supabase Auth, then reads the
 * caller's own RLS-protected profile. It never accepts Firebase/local JWTs.
 */
async function verifySupabaseAccessToken(accessToken) {
  const { url, publishableKey } = getConfig();
  if (!url || !publishableKey || typeof accessToken !== 'string' || !accessToken.trim()) return null;

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (!user?.id) return null;

    const profileResponse = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,tenant_id,site_id,domain,full_name,username`,
      {
        headers: {
          apikey: publishableKey,
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    const profiles = profileResponse.ok ? await profileResponse.json() : [];
    const profile = Array.isArray(profiles) ? profiles[0] || {} : {};
    const metadata = user.app_metadata || {};

    const profileRole = profile.role ? String(profile.role).toLowerCase() : null;
    const trustedRoles = profileRole
      ? [profileRole]
      : (Array.isArray(metadata.roles) ? metadata.roles.map((role) => String(role).toLowerCase()) : undefined);

    return Object.freeze({
      id: user.id,
      uid: user.id,
      sub: user.id,
      email: user.email || null,
      name: profile.full_name || user.user_metadata?.full_name || user.user_metadata?.name || user.email || null,
      role: profileRole || String(metadata.role || 'user').toLowerCase(),
      roles: trustedRoles,
      tenantId: profile.tenant_id || metadata.tenant_id || null,
      siteId: profile.site_id || metadata.site_id || null,
      domainId: profile.domain || metadata.domain_id || metadata.domain || null,
      username: profile.username || null,
      authProvider: 'supabase',
      emailVerified: Boolean(user.email_confirmed_at),
      appMetadata: metadata,
    });
  } catch {
    return null;
  }
}

export { getSupabaseAdmin, verifySupabaseAccessToken };
