import crypto from 'node:crypto';
import MemoryAdapter from './adapters/MemoryAdapter.js';
import { SessionStore } from '../session/SessionStore.js';

class MemoryManager {
  constructor(adapter = 'memory', options = {}) {
    this.adapter = this.createAdapter(adapter);
    this.sessionStore = options.sessionStore || new SessionStore();
  }

  createAdapter(type) {
    switch (type) {
      case 'memory':
        return new MemoryAdapter();
      case 'firebase':
      case 'redis':
      case 'sqlite':
        throw new Error('Memory adapter "' + type + '" is not installed in this build');
      default:
        throw new Error('Unknown memory adapter: ' + type);
    }
  }

  async initialize() { return this.adapter.initialize(); }

  async getUserContext(userId) {
    return this.adapter.get('user:' + userId + ':context') || {};
  }

  async storeInteraction(interactionId, data) {
    const userId = data.context?.userId;
    await this.adapter.push('user:' + userId + ':history', {
      id: interactionId,
      timestamp: data.timestamp,
      skill: data.result?.skill,
      input: data.input?.text || data.input?.action,
    });
    await this.adapter.trim('user:' + userId + ':history', -100);
    await this.adapter.set('interaction:' + interactionId, data, 86400);

    if (data.context?.sessionId) {
      await this.sessionStore.append(data.context.sessionId, 'interaction/completed', {
        interactionId,
        userId,
        skill: data.result?.skill,
        input: data.input?.text || data.input?.action,
        result: data.result?.output,
        duration: data.duration,
      }, { source: 'agentos.memory' });
    }
  }

  async getSession(sessionId) {
    if (!sessionId) return null;
    const legacy = await this.adapter.get('session:' + sessionId);
    if (legacy) return legacy;
    const events = await this.sessionStore.read(sessionId);
    const created = [...events].reverse().find((event) => event.type === 'session/created');
    if (!created) return null;
    return {
      id: sessionId,
      userId: created.data.userId,
      createdAt: created.data.createdAt,
      data: created.data.data || {},
      eventCount: events.length,
    };
  }

  async createSession(userId, data = {}) {
    const sessionId = crypto.randomUUID();
    const createdAt = Date.now();
    await this.sessionStore.append(sessionId, 'session/created', {
      userId, createdAt, data,
    }, { source: 'agentos.memory' });
    return sessionId;
  }

  async getSessionEvents(sessionId, options) {
    if (!sessionId) return [];
    return this.sessionStore.read(sessionId, options);
  }

  async getLastSessionEvent(sessionId) {
    if (!sessionId) return null;
    return this.sessionStore.getLast(sessionId);
  }

  async getPermissions(userId) {
    const perms = await this.adapter.get('user:' + userId + ':permissions');
    return perms || ['user:read'];
  }

  async setPermissions(userId, permissions) {
    return this.adapter.set('user:' + userId + ':permissions', permissions);
  }

  async close() {
    await this.sessionStore.close();
    return this.adapter.close();
  }

  getStatus() { return this.adapter.getStatus(); }
}

export default MemoryManager;
