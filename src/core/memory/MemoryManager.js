// src/core/memory/MemoryManager.js
class MemoryManager {
  constructor(adapter = 'memory') {
    this._adapterType = adapter;
    this.adapter = null;
  }

  async createAdapter(type) {
    let AdapterClass;
    switch (type) {
      case 'memory':
        AdapterClass = (await import('./adapters/MemoryAdapter.js')).default;
        break;
      case 'firebase':
        AdapterClass = (await import('./adapters/FirebaseAdapter.js')).default;
        break;
      case 'redis':
        AdapterClass = (await import('./adapters/RedisAdapter.js')).default;
        break;
      case 'sqlite':
        AdapterClass = (await import('./adapters/SQLiteAdapter.js')).default;
        break;
      default:
        throw new Error(`Unknown memory adapter: ${type}`);
    }
    return new AdapterClass();
  }

  async initialize() {
    this.adapter = await this.createAdapter(this._adapterType);
    return this.adapter.initialize();
  }

  async getUserContext(userId) {
    return this.adapter.get(`user:${userId}:context`) || {};
  }

  async storeInteraction(interactionId, data) {
    // Store in user history
    const userId = data.context.userId;
    await this.adapter.push(`user:${userId}:history`, {
      id: interactionId,
      timestamp: data.timestamp,
      skill: data.result?.skill,
      input: data.input.text || data.input.action
    });
    
    // Keep only last 100 interactions
    await this.adapter.trim(`user:${userId}:history`, -100);
    
    // Store full interaction
    await this.adapter.set(`interaction:${interactionId}`, data, 86400); // 24h TTL
  }

  async getSession(sessionId) {
    if (!sessionId) return null;
    return this.adapter.get(`session:${sessionId}`);
  }

  async createSession(userId, data = {}) {
    const sessionId = crypto.randomUUID();
    await this.adapter.set(`session:${sessionId}`, {
      userId,
      createdAt: Date.now(),
      data
    }, 3600); // 1h TTL
    return sessionId;
  }

  async getPermissions(userId) {
    const perms = await this.adapter.get(`user:${userId}:permissions`);
    return perms || ['user:read'];
  }

  async setPermissions(userId, permissions) {
    return this.adapter.set(`user:${userId}:permissions`, permissions);
  }

  async close() {
    return this.adapter.close();
  }

  getStatus() {
    return this.adapter.getStatus();
  }

  // ── Low-level KV passthrough ──────────────────────────────────────────
  // Skills (e.g. tasks/index.js) are written against a direct get/set/push
  // store interface, not the higher-level session/user methods above.
  async get(key) {
    return this.adapter.get(key);
  }

  async set(key, value, ttlSeconds = null) {
    return this.adapter.set(key, value, ttlSeconds);
  }

  async push(key, value) {
    return this.adapter.push(key, value);
  }
}

export default MemoryManager;
