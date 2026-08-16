import crypto from 'crypto';

const PROVIDERS = new Set(['google', 'github', 'facebook', 'openai', 'chatgpt', 'telegram', 'whatsapp', 'discord', 'slack', 'email']);

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

export class IdentityLinkingService {
  constructor({ db = null, ttlMs = 10 * 60 * 1000, now = () => Date.now() } = {}) {
    this.db = db;
    this.ttlMs = ttlMs;
    this.now = now;
    this.tokens = new Map();
    this.memory = new Map();
  }

  normalize({ provider, subject, channel = provider, tenantId = null } = {}) {
    const normalizedProvider = clean(provider, 40).toLowerCase();
    const normalizedSubject = clean(subject, 240);
    if (!PROVIDERS.has(normalizedProvider)) throw new Error('Unsupported identity provider');
    if (!normalizedSubject) throw new Error('Identity subject is required');
    return {
      provider: normalizedProvider,
      subject: normalizedSubject,
      channel: clean(channel, 40).toLowerCase() || normalizedProvider,
      tenantId: tenantId ? clean(tenantId, 120) : null,
      key: `${normalizedProvider}:${normalizedSubject}`,
    };
  }

  async issueLinkToken({ userId, identity, requestedBy = userId } = {}) {
    const uid = clean(userId, 160);
    if (!uid) throw new Error('Authenticated user is required');
    const normalized = this.normalize(identity);
    const token = crypto.randomBytes(32).toString('base64url');
    this.tokens.set(token, { userId: uid, identity: normalized, requestedBy: clean(requestedBy, 160), expiresAt: this.now() + this.ttlMs });
    return { token, expiresAt: new Date(this.now() + this.ttlMs).toISOString(), identity: normalized };
  }

  async consumeLinkToken(token, { userId, tenantId = null } = {}) {
    const record = this.tokens.get(String(token || ''));
    if (!record || record.expiresAt <= this.now()) throw new Error('Link token is invalid or expired');
    if (userId && record.userId !== clean(userId, 160)) throw new Error('Link token belongs to another user');
    if (tenantId && record.identity.tenantId && record.identity.tenantId !== clean(tenantId, 120)) throw new Error('Link token belongs to another tenant');
    this.tokens.delete(token);
    return this.link({ userId: record.userId, identity: record.identity });
  }

  async link({ userId, identity } = {}) {
    const uid = clean(userId, 160);
    if (!uid) throw new Error('Authenticated user is required');
    const normalized = this.normalize(identity);
    const existing = await this.findByIdentity(normalized);
    if (existing && existing !== uid) throw new Error('Identity is already linked to another account');
    const record = { ...normalized, userId: uid, linkedAt: new Date(this.now()).toISOString() };
    if (this.db?.linkIdentity) await this.db.linkIdentity(uid, record);
    else if (this.db?.linkChannel) await this.db.linkChannel(uid, normalized.channel, normalized.subject);
    else if (this.db?.db) await this.db.db.collection('identities').doc(normalized.key).set(record);
    else this.memory.set(normalized.key, record);
    return record;
  }

  async findByIdentity(identity) {
    const normalized = this.normalize(identity);
    if (this.db?.findIdentity) return this.db.findIdentity(normalized);
    if (this.db?.getUserByChannel) {
      const user = await this.db.getUserByChannel(normalized.channel, normalized.subject);
      return user?.uid || user?.id || null;
    }
    if (this.db?.db) {
      const doc = await this.db.db.collection('identities').doc(normalized.key).get();
      return doc.exists ? doc.data().userId : null;
    }
    return this.memory.get(normalized.key)?.userId || null;
  }

  async unlink({ userId, identity } = {}) {
    const normalized = this.normalize(identity);
    const existing = await this.findByIdentity(normalized);
    if (!existing) return false;
    if (existing !== clean(userId, 160)) throw new Error('Identity is linked to another account');
    if (this.db?.unlinkIdentity) await this.db.unlinkIdentity(existing, normalized);
    else if (this.db?.db) await this.db.db.collection('identities').doc(normalized.key).delete();
    else this.memory.delete(normalized.key);
    return true;
  }

  cleanup() {
    const now = this.now();
    for (const [token, record] of this.tokens) if (record.expiresAt <= now) this.tokens.delete(token);
  }
}

export default IdentityLinkingService;
