import express from 'express';
import { createAuthHandoffStore } from '../../core/auth/index.js';
import { SupabaseAuthHandoffStore } from '../../adapters/auth/supabase-auth-handoff.js';
import { requireUser } from '../middleware/auth-provider.js';

const router = express.Router();

function createStore() {
  const provider = String(process.env.AUTH_HANDOFF_STORE || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'memory')).trim().toLowerCase();
  if (provider === 'supabase') return new SupabaseAuthHandoffStore();
  if (provider === 'memory') return createAuthHandoffStore();
  throw new Error(`Unsupported AUTH_HANDOFF_STORE: ${provider}`);
}

const store = createStore();
const CLIENTS = new Set(['device', 'web', 'native', 'cli']);

function normalizeClient(value) {
  const client = String(value || '').trim().toLowerCase();
  return CLIENTS.has(client) ? client : null;
}
function normalizeAction(value) {
  return String(value || '').trim() === 'signIn' ? 'signIn' : null;
}
function noReferrer(res) {
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
}

router.post('/', async (req, res) => {
  noReferrer(res);
  try {
    const clientId = normalizeClient(req.body?.client || req.body?.from);
    const action = normalizeAction(req.body?.action || req.body?.type);
    const codeChallenge = String(req.body?.codeChallenge || '').trim();
    if (!clientId) return res.status(400).json({ error: 'Unsupported auth handoff client' });
    if (!action) return res.status(400).json({ error: 'Unsupported auth handoff action' });
    const handoff = await store.create({ clientId, action, codeChallenge });
    return res.status(201).json({ id: handoff.id, client: handoff.clientId, action: handoff.action, nonce: handoff.nonce, expiresAt: handoff.expiresAt });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/:nonce', async (req, res) => {
  noReferrer(res);
  try {
    const handoff = await store.get(req.params.nonce);
    if (!handoff) return res.status(404).json({ error: 'Invalid or expired auth handoff' });
    return res.json({ id: handoff.id, client: handoff.clientId, action: handoff.action, status: handoff.status, expiresAt: handoff.expiresAt });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post('/:nonce/complete', requireUser, async (req, res) => {
  noReferrer(res);
  try {
    const result = await store.complete({
      nonce: req.params.nonce,
      user: { id: req.user.id || req.user.sub, sub: req.user.sub || req.user.id, email: req.user.email || null, authProvider: req.user.authProvider || null },
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

// Device/native/CLI clients poll with the nonce + their original PKCE verifier.
// The browser never receives or transports an exchange secret.
router.post('/:nonce/exchange', async (req, res) => {
  noReferrer(res);
  try {
    const result = await store.exchange({ nonce: req.params.nonce, codeVerifier: req.body?.codeVerifier });
    return res.json(result);
  } catch (error) {
    const message = error.message || 'Auth handoff exchange failed';
    const status = /not ready/i.test(message) ? 409 : 400;
    return res.status(status).json({ error: message });
  }
});

export default router;
