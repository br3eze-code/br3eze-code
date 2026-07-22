// src/core/memory/MemoryManager.js
class MemoryManager {
  constructor(adapter = 'memory') {
    this.adapter = this.createAdapter(adapter);
  }

  createAdapter(type) {
    switch (type) {
      case 'memory':
        return new (require('./adapters/MemoryAdapter'))();
      case 'firebase':
        return new (require('./adapters/FirebaseAdapter'))();
      case 'redis':
        return new (require('./adapters/RedisAdapter'))();
      case 'sqlite':
        return new (require('./adapters/SQLiteAdapter'))();
      case 'obsidian':
        return new (require('./adapters/ObsidianAdapter'))();
      default:
        throw new Error(`Unknown memory adapter: ${type}`);
    }
  }

  async initialize() {
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

  async delete(key) {
    if (typeof this.adapter.delete === 'function') {
      return this.adapter.delete(key);
    }
    return false;
  }

  async list(prefix = '') {
    if (typeof this.adapter.list === 'function') {
      return this.adapter.list(prefix);
    }
    return [];
  }

  async close() {
    return this.adapter.close();
  }


  getStatus() {
    return this.adapter.getStatus();
  }
}

module.exports = MemoryManager;
