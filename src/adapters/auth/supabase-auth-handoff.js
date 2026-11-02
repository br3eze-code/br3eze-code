import crypto from 'node:crypto';
import { AuthHandoffStore } from '../../core/auth/authHandoff.js';

function getConfig() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

async function request(path, { method = 'GET', body, prefer } = {}) {
  const { url, serviceKey } = getConfig();
  if (!url || !serviceKey) throw new Error('Supabase auth handoff requires server-side Supabase configuration');
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.message || detail.hint || 'Supabase auth handoff persistence failed');
    error.code = detail.code || `SUPABASE_HTTP_${response.status}`;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
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
    await request('auth_handoffs', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        id,
        nonce_hash: hashToken(requireString(nonce, 'nonce')),
        client_id: requireString(clientId, 'clientId'),
        action: requireString(action, 'action'),
        code_challenge: requireString(codeChallenge, 'codeChallenge'),
        created_at: new Date(createdAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        user_payload: { metadata: clone(metadata) },
      },
    });
    return { id, nonce, clientId, action, createdAt, expiresAt, status: 'pending' };
  }

  async get(nonce) {
    const params = new URLSearchParams({
      select: 'id,client_id,action,created_at,expires_at,status,consumed_at',
      nonce_hash: `eq.${hashToken(requireString(nonce, 'nonce'))}`,
      limit: '1',
    });
    const rows = await request(`auth_handoffs?${params.toString()}`);
    const data = Array.isArray(rows) ? rows[0] : null;
    if (!data || new Date(data.expires_at).getTime() <= Date.now()) return null;
    return {
      id: data.id,
      clientId: data.client_id,
      action: data.action,
      createdAt: new Date(data.created_at).getTime(),
      expiresAt: new Date(data.expires_at).getTime(),
      status: data.status,
      consumedAt: data.consumed_at ? new Date(data.consumed_at).getTime() : null,
    };
  }

  async complete({ nonce, user }) {
    const rows = await request('rpc/complete_auth_handoff', {
      method: 'POST',
      body: {
        p_nonce_hash: hashToken(requireString(nonce, 'nonce')),
        p_user_payload: clone(user),
      },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Invalid, expired, or already completed auth handoff');
    return {
      id: row.id,
      clientId: row.client_id,
      action: row.action,
      status: 'completed',
      expiresAt: new Date(row.expires_at).getTime(),
    };
  }

  async exchange({ nonce, codeVerifier }) {
    const verifier = requireString(codeVerifier, 'codeVerifier');
    const expectedChallenge = `S256:${crypto.createHash('sha256').update(verifier).digest('base64url')}`;
    const rows = await request('rpc/exchange_auth_handoff', {
      method: 'POST',
      body: {
        p_nonce_hash: hashToken(requireString(nonce, 'nonce')),
        p_code_challenge: expectedChallenge,
      },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Invalid, not-ready, expired, or already exchanged auth handoff');
    return {
      id: row.id,
      clientId: row.client_id,
      action: row.action,
      user: row.user_payload,
      exchangedAt: Date.now(),
    };
  }
}

export default SupabaseAuthHandoffStore;
