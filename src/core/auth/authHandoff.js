import crypto from 'node:crypto';

export const AUTH_HANDOFF_ACTIONS = Object.freeze(new Set(['signIn']));
export const AUTH_HANDOFF_CLIENTS = Object.freeze(new Set(['device', 'web', 'native', 'cli']));

function requireString(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function now() {
  return Date.now();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class AuthHandoffStore {
  async create() { throw new Error('AuthHandoffStore.create() is not implemented'); }
  async get() { throw new Error('AuthHandoffStore.get() is not implemented'); }
  async complete() { throw new Error('AuthHandoffStore.complete() is not implemented'); }
  async exchange() { throw new Error('AuthHandoffStore.exchange() is not implemented'); }
}

export class MemoryAuthHandoffStore extends AuthHandoffStore {
  constructor({ clock = now } = {}) {
    super();
    this.clock = clock;
    this.records = new Map();
  }

  async create({ clientId, action = 'signIn', codeChallenge, ttlMs = 5 * 60 * 1000, metadata = {} }) {
    clientId = requireString(clientId, 'clientId');
    action = requireString(action, 'action');
    codeChallenge = requireString(codeChallenge, 'codeChallenge');

    if (!AUTH_HANDOFF_CLIENTS.has(clientId)) throw new Error('Unsupported auth handoff client');
    if (!AUTH_HANDOFF_ACTIONS.has(action)) throw new Error('Unsupported auth handoff action');
    if (!/^S256:[A-Za-z0-9_-]{20,}$/.test(codeChallenge)) {
      throw new Error('codeChallenge must use S256:<base64url> format');
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > 10 * 60 * 1000) {
      throw new Error('ttlMs must be between 30 seconds and 10 minutes');
    }

    const nonce = randomToken();
    const id = crypto.randomUUID();
    const createdAt = this.clock();
    const expiresAt = createdAt + ttlMs;

    this.records.set(hashToken(nonce), {
      id,
      clientId,
      action,
      codeChallenge,
      createdAt,
      expiresAt,
      status: 'pending',
      consumedAt: null,
      user: null,
      exchangeCodeHash: null,
      exchangeCodeExpiresAt: null,
      metadata: clone(metadata),
    });

    return { id, nonce, clientId, action, createdAt, expiresAt, status: 'pending' };
  }

  async get(nonce) {
    const record = this.records.get(hashToken(requireString(nonce, 'nonce')));
    if (!record) return null;
    if (record.expiresAt <= this.clock()) {
      record.status = 'expired';
      return null;
    }
    return clone({
      id: record.id,
      clientId: record.clientId,
      action: record.action,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      status: record.status,
      consumedAt: record.consumedAt,
    });
  }

  async complete({ nonce, user }) {
    const record = this.records.get(hashToken(requireString(nonce, 'nonce')));
    if (!record) throw new Error('Invalid or expired auth handoff');
    if (record.expiresAt <= this.clock()) throw new Error('Auth handoff expired');
    if (record.status !== 'pending') throw new Error('Auth handoff already completed');
    if (!user || typeof user !== 'object' || !String(user.id || user.sub || '').trim()) {
      throw new Error('Authenticated user is required');
    }

    const exchangeCode = randomToken(32);
    record.exchangeCodeHash = hashToken(exchangeCode);
    record.exchangeCodeExpiresAt = Math.min(record.expiresAt, this.clock() + 60_000);
    record.user = clone(user);
    record.status = 'completed';
    record.consumedAt = this.clock();

    return {
      id: record.id,
      clientId: record.clientId,
      action: record.action,
      status: record.status,
      expiresAt: record.expiresAt,
      exchangeCode,
    };
  }

  async exchange({ nonce, code, codeVerifier }) {
    const record = this.records.get(hashToken(requireString(nonce, 'nonce')));
    if (!record) throw new Error('Invalid or expired auth handoff');
    if (record.expiresAt <= this.clock() || record.exchangeCodeExpiresAt <= this.clock()) {
      throw new Error('Auth handoff exchange expired');
    }
    if (record.status !== 'completed' || !record.exchangeCodeHash || !record.user) {
      throw new Error('Auth handoff is not ready');
    }

    const expectedChallenge = `S256:${crypto.createHash('sha256').update(requireString(codeVerifier, 'codeVerifier')).digest('base64url')}`;
    if (!timingSafeEqual(expectedChallenge, record.codeChallenge)) {
      throw new Error('PKCE verification failed');
    }
    if (!timingSafeEqual(hashToken(requireString(code, 'code')), record.exchangeCodeHash)) {
      throw new Error('Invalid auth handoff exchange code');
    }

    const user = clone(record.user);
    this.records.delete(hashToken(nonce));
    return { id: record.id, clientId: record.clientId, action: record.action, user, exchangedAt: this.clock() };
  }
}

export function createS256CodeChallenge(verifier) {
  verifier = requireString(verifier, 'verifier');
  return `S256:${crypto.createHash('sha256').update(verifier).digest('base64url')}`;
}

export function createPkceVerifier() {
  return randomToken(32);
}

export function createAuthHandoffStore(options) {
  return new MemoryAuthHandoffStore(options);
}

export default {
  AuthHandoffStore,
  MemoryAuthHandoffStore,
  createAuthHandoffStore,
  createPkceVerifier,
  createS256CodeChallenge,
};
