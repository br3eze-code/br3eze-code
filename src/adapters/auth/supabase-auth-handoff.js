import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { AuthHandoffStore } from '../../core/auth/authHandoff.js';

const url = process.env.SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let client;

function getClient() {
  if (!url || !serviceKey) throw new Error('Supabase auth handoff requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  if (!client) client = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

const hashToken = value => crypto.createHash('sha256').update(value).digest('base64url');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const requireString = (value, field) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

export class SupabaseAuthHandoffStore extends AuthHandoffStore {
  async create({ clientId, action = 'signIn', codeChallenge, ttlMs = 5 * 60 * 1000, metadata = {} }) {
    const nonce = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = createdAt + ttlMs;
    const { error } = await getClient().from('auth_handoffs').insert({
      id,
      nonce_hash: hashToken(requireString(nonce, 'nonce')),
      client_id: requireString(clientId, 'clientId'),
      action: requireString(action, 'action'),
      code_challenge: requireString(codeChallenge, 'codeChallenge'),
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      user_payload: { metadata: clone(metadata) }
    });
    if (error) throw error;
    return { id, nonce, clientId, action, createdAt, expiresAt, status: 'pending' };
  }

  async get(nonce) {
    const { data, error } = await getClient().from('auth_handoffs')
      .select('id,client_id,action,created_at,expires_at,status,consumed_at')
      .eq('nonce_hash', hashToken(requireString(nonce, 'nonce')))
      .maybeSingle();
    if (error) throw error;
    if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
    return { id: data.id, clientId: data.client_id, action: data.action, createdAt: new Date(data.created_at).getTime(), expiresAt: new Date(data.expires_at).getTime(), status: data.status, consumedAt: data.consumed_at ? new Date(data.consumed_at).getTime() : null };
  }

  async complete({ nonce, user }) {
    const { data, error } = await getClient().rpc('complete_auth_handoff', {
      p_nonce_hash: hashToken(requireString(nonce, 'nonce')),
      p_user_payload: clone(user)
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error('Invalid, expired, or already completed auth handoff');
    return { id: row.id, clientId: row.client_id, action: row.action, status: 'completed', expiresAt: new Date(row.expires_at).getTime() };
  }

  async exchange({ nonce, codeVerifier }) {
    const verifier = requireString(codeVerifier, 'codeVerifier');
    const expectedChallenge = `S256:${crypto.createHash('sha256').update(verifier).digest('base64url')}`;
    const { data, error } = await getClient().rpc('exchange_auth_handoff', {
      p_nonce_hash: hashToken(requireString(nonce, 'nonce')),
      p_code_challenge: expectedChallenge
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error('Invalid, not-ready, expired, or already exchanged auth handoff');
    return { id: row.id, clientId: row.client_id, action: row.action, user: row.user_payload, exchangedAt: Date.now() };
  }
}

export default SupabaseAuthHandoffStore;
