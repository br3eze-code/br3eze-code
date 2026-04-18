// src/domains/mikrotik/index.js
'use strict';

const { RouterOSClient } = require('routeros-client');
const tools = require('../../tools');

class MikroTikDomain {
  constructor(config = {}) {
    this.config = config;
    this.client = null;
  }

  async connect() {
    this.client = new RouterOSClient({
      host: this.config.host || process.env.MIKROTIK_HOST || '192.168.88.1',
      user: this.config.user || process.env.MIKROTIK_USER || 'admin',
      password: this.config.password || process.env.MIKROTIK_PASSWORD,
      port: this.config.port || 8728,
      timeout: this.config.timeout || 10000
    });
    this.conn = await this.client.connect();
    return this.conn;
  }

  getSkills() {
    return Object.entries(tools).map(([name, fn]) => ({
      name,
      description: `MikroTik: ${name}`,
      execute: async (params, context) => {
        if (!this.conn) await this.connect();
        return fn(this.conn, ...(Array.isArray(params) ? params : [params]));
      },
      schema: { type: 'object', additionalProperties: true }
    }));
  }

  async healthCheck() {
    try {
      if (!this.conn) await this.connect();
      const res = await this.conn.menu('/system/resource').get();
      return { status: 'ok', version: res[0]?.version, uptime: res[0]?.uptime };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  async disconnect() {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
  }
}

module.exports = {
  register(registry, config) {
    const domain = new MikroTikDomain(config);
    registry.registerDomain('mikrotik', domain.getSkills());
    return domain;
  },
  MikroTikDomain
};
