import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let adminClient;

function getSupabaseAdmin() {
  if (!url || !serviceKey) return null;
  if (!adminClient) adminClient = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return adminClient;
}

async function verifySupabaseAccessToken(accessToken) {
  const client = getSupabaseAdmin();
  if (!client || !accessToken) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  const user = data.user;
  const { data: profile } = await client.from('profiles').select('id,email,full_name,username,phone,role,tenant_id,site_id,domain').eq('id', user.id).maybeSingle();
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
    customClaims: user.app_metadata || {}
  };
}

export { getSupabaseAdmin, verifySupabaseAccessToken };
