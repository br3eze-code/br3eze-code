import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let adminClient;

function loadCreateClient() {
  try {
    const sdk = require('@supabase/supabase-js');
    if (typeof sdk.createClient !== 'function') throw new TypeError('createClient export unavailable');
    return sdk.createClient;
  } catch (cause) {
    const error = new Error(
      'SUPABASE_ADAPTER_DEPENDENCY_MISSING: install @supabase/supabase-js to enable the Supabase auth adapter'
    );
    error.code = 'SUPABASE_ADAPTER_DEPENDENCY_MISSING';
    error.cause = cause;
    throw error;
  }
}

/**
 * Optional Supabase adapter. Importing AgentOS does not require the Supabase
 * SDK; only a configured Supabase deployment loads that provider dependency.
 */
function getSupabaseAdmin() {
  if (!url || !serviceKey) return null;
  if (!adminClient) {
    const createClient = loadCreateClient();
    adminClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return adminClient;
}

async function verifySupabaseAccessToken(accessToken) {
  const client = getSupabaseAdmin();
  if (!client || !accessToken) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  const user = data.user;
  const { data: profile } = await client
    .from('profiles')
    .select('id,email,full_name,username,phone,role,tenant_id,site_id,domain')
    .eq('id', user.id)
    .maybeSingle();
  return {
    uid: user.id,
    email: user.email || profile?.email || null,
    role: profile?.role || 'user',
    tenantId: profile?.tenant_id || null,
    siteId: profile?.site_id || null,
    domain: profile?.domain || null,
    fullName: profile?.full_name || null,
    username: profile?.username || null,
    authProvider: 'supabase',
    customClaims: user.app_metadata || {},
  };
}

export { getSupabaseAdmin, verifySupabaseAccessToken };
