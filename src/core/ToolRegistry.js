// src/core/ToolRegistry.js
class ToolRegistry {
  constructor() {
    this.tools = new Map();   // 'domain.tool.name' → { execute, schema, description, domain }
    this.domains = new Set();
  }

  registerDomain(domainName, tools) {
    this.domains.add(domainName);
    tools.forEach(tool => {
      const fullName = `${domainName}.${tool.name}`;
      this.tools.set(fullName, {
        ...tool,
        domain: domainName,
        fullName
      });
    });
    logger.info(`Registered domain: ${domainName} with ${tools.length} tools`);
  }

  getAllTools() {
    return Array.from(this.tools.values());
  }

  async execute(fullToolName, params = [], context = {}) {
    const tool = this.tools.get(fullToolName);
    if (!tool) throw new Error(`Tool ${fullToolName} not found`);

    // Permission + hooks (move your existing ones here)
    const perm = permissionPolicy.check(fullToolName);
    if (!perm.allowed) throw new Error(perm.reason);

    await hooks.runBefore(fullToolName, params);
    const result = await tool.execute(...params, context);
    await hooks.runAfter(fullToolName, params, result);

    return result;
  }

  getToolsForDomain(domain) {
    return Array.from(this.tools.values()).filter(t => t.domain === domain);
  }
}

module.exports = new ToolRegistry();
