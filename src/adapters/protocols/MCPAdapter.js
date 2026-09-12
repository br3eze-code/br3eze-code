export class MCPAdapter {
  constructor({ client, authorize = null } = {}) {
    if (!client) throw new TypeError('MCP_CLIENT_REQUIRED');
    this.client = client;
    this.authorize = authorize;
  }

  async listTools(context = {}) {
    await this._authorize('mcp.tools.list', context);
    return this.client.listTools();
  }

  async callTool(name, arguments_, context = {}) {
    await this._authorize('mcp.tools.call', context, { name });
    if (!name) throw new TypeError('MCP_TOOL_NAME_REQUIRED');
    return this.client.callTool({ name, arguments: arguments_ ?? {} });
  }

  async _authorize(capability, context, resource = {}) {
    if (!context.tenantId) throw new Error('TENANT_SCOPE_REQUIRED');
    if (this.authorize) {
      const allowed = await this.authorize({ capability, tenantId: context.tenantId, userId: context.userId, resource });
      if (!allowed) throw new Error('CAPABILITY_FORBIDDEN');
    }
  }
}
