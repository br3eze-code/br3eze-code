class ToolRegistry {
  constructor() {
    this.tools = new Map();        // toolName → { execute, schema, description, domain }
    this.domains = new Map();      // domainName → array of tool names
  }

  registerDomain(domainName, toolsArray) {
    this.domains.set(domainName, []);
    toolsArray.forEach(tool => {
      this.tools.set(tool.name, {
        ...tool,
        domain: domainName
      });
      this.domains.get(domainName).push(tool.name);
    });
  }

  getToolsForDomain(domain) {
    return this.domains.get(domain) || [];
  }

  getAllTools() {
    return Array.from(this.tools.values());
  }

  async execute(toolName, params, context) {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);
    return tool.execute(params, context);
  }
}

module.exports = new ToolRegistry();
