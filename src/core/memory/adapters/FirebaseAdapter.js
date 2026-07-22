// src/core/memory/adapters/FirebaseAdapter.js
class FirebaseAdapter {
  constructor() {
    this.db = null;
    this.collection = null;
  }

  async initialize() {
    const { getDatabase } = require('../../database');
    const dbInstance = await getDatabase();
    if (!dbInstance || !dbInstance.db) {
      throw new Error('Firebase database not available');
    }
    this.db = dbInstance.db;
    this.collection = this.db.collection('agentos_memory');
  }

  async get(key) {
    if (!this.collection) return null;
    try {
      const doc = await this.collection.doc(key.replace(/[:\/\\.]/g, '_')).get();
      if (!doc.exists) return null;
      return doc.data().value;
    } catch (e) {
      return null;
    }
  }

  async set(key, value, ttlSeconds = null) {
    if (!this.collection) return;
    try {
      const data = { value, updatedAt: Date.now() };
      if (ttlSeconds) {
        data.expiresAt = Date.now() + (ttlSeconds * 1000);
      }
      await this.collection.doc(key.replace(/[:\/\\.]/g, '_')).set(data);
    } catch (e) {
      // Ignored
    }
  }

  async push(key, value) {
    const arr = (await this.get(key)) || [];
    arr.push(value);
    await this.set(key, arr);
  }

  async trim(key, count) {
    const arr = (await this.get(key)) || [];
    if (count < 0) {
      await this.set(key, arr.slice(count));
    } else {
      await this.set(key, arr.slice(0, count));
    }
  }

  async close() {
    // Firebase connection is managed globally
  }

  getStatus() {
    return {
      type: 'firebase',
      ready: !!this.collection
    };
  }
}

module.exports = FirebaseAdapter;
