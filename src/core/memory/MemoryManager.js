import crypto from 'node:crypto';
import MemoryAdapter from './adapters/MemoryAdapter.js';

// src/core/memory/MemoryManager.js
class MemoryManager {
  constructor(adapter = 'memory') {
    this.adapter = this.createAdapter(adapter);
  }

  createAdapter(type) {
    switch (type) {
      case 'memory':
        return new MemoryAdapter();
      case 'firebase':
      case 'redis':
      case 'sqlite':
        throw new Error(`Memory adapter "${type}" is not installed in this build`);
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
    const userId = data.context.userId;
    await this.adapter.push(`user:${userId}:history`, {
      id: interactionId,
      timestamp: data.timestamp,
      skill: data.result?.skill,
      input: data.input.text || data.input.action,
    });

    await this.adapter.trim(`user:${userId}:history`, -100);
    await this.adapter.set(`interaction:${interactionId}`, data, 86400);
  }

  async getSession(sessionId) {
    if (!sessionId) return null;
    return this.adapter.get(`session:${sessionId}`);
  }

  async createSession(userId, data = {}) {
    const sessionId = crypto.randomUUID();
    await this.adapter.set(
      `session:${sessionId}`,
      { userId, createdAt: Date.now(), data },
      3600,
    );
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
}

export default MemoryManager;
