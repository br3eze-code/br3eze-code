// src/domains/mikrotik/index.js
const { RouterOSClient } = require('routeros-client');
const registry = require('../../core/ToolRegistry');

const TOOLS = { /* Move your entire TOOLS object here */ };

class MikroTikDomain {
  constructor(config) {
    this.client = new MikroTikManager(config); // Your existing class, moved here
  }

  getSkills() {
    return Object.entries(TOOLS).map(([name, fn]) => ({
      name,
      description: `MikroTik: ${name}`,
      execute: async (...args) => fn(this.client.conn, ...args),
      schema: { /* define OpenAI-style schema if needed for function calling */ }
    }));
  }
}

module.exports = {
  register(registry, config) {
    const domain = new MikroTikDomain(config);
    registry.registerDomain('mikrotik', domain.getSkills());
    return domain.client; // Return instance for backward compat
  }
};
