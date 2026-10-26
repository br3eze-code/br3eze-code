/**
 * Optional native MCP client adapter.
 *
 * The MCP SDK is loaded only when this adapter is connected, so the generic
 * AgentOS runtime does not require MCP or any transport package at boot.
 * Install @modelcontextprotocol/sdk in deployments that enable MCP.
 */
const SUPPORTED_TRANSPORTS = new Set(['stdio', 'http', 'sse']);

export class MCPClientAdapter {
  constructor(serverConfig = {}, options = {}) {
    if (!serverConfig || typeof serverConfig !== 'object') throw new TypeError('MCP_SERVER_CONFIG_REQUIRED');
    this.serverConfig = serverConfig;
    this.namespace = String(serverConfig.namespace || serverConfig.name || 'server').replace(/[^a-zA-Z0-9_-]/g, '-');
    this.authorize = options.authorize || null;
    this.sdk = options.sdk || null;
    this.client = null;
    this.transport = null;
    this.connected = false;
  }

  async connect(context = {}) {
    if (this.connected) return this.listTools(context);
    const config = this.serverConfig;
    const transportType = config.transport || (config.command ? 'stdio' : 'http');
    if (!SUPPORTED_TRANSPORTS.has(transportType)) throw new Error('MCP_TRANSPORT_UNSUPPORTED');
    if (transportType === 'stdio' && (!config.command || !Array.isArray(config.args || []))) {
      throw new TypeError('MCP_STDIO_COMMAND_REQUIRED');
    }
    if (transportType !== 'stdio' && !config.url) throw new TypeError('MCP_TRANSPORT_URL_REQUIRED');

    const sdk = this.sdk || await this._loadSdk(transportType);
    const Client = sdk.Client;
    if (typeof Client !== 'function') throw new TypeError('MCP_SDK_CLIENT_UNAVAILABLE');
    this.client = new Client({
      name: String(config.clientName || 'AgentOS'),
      version: String(config.clientVersion || '1.0.0'),
    }, { capabilities: {} });

    if (transportType === 'stdio') {
      if (typeof sdk.StdioClientTransport !== 'function') throw new Error('MCP_STDIO_TRANSPORT_UNAVAILABLE');
      this.transport = new sdk.StdioClientTransport({ command: config.command, args: config.args || [], env: config.env });
    } else if (transportType === 'sse') {
      if (typeof sdk.SSEClientTransport !== 'function') throw new Error('MCP_SSE_TRANSPORT_UNAVAILABLE');
      this.transport = new sdk.SSEClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    } else {
      if (typeof sdk.StreamableHTTPClientTransport !== 'function') throw new Error('MCP_HTTP_TRANSPORT_UNAVAILABLE');
      this.transport = new sdk.StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
    }

    try {
      await this.client.connect(this.transport);
      this.connected = true;
      return await this.listTools(context);
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    }
  }

  async listTools(context = {}) {
    await this._authorize('mcp.tools.list', context);
    if (!this.connected || !this.client) throw new Error('MCP_CLIENT_NOT_CONNECTED');
    const response = await this.client.listTools();
    return (response?.tools || []).map((tool) => {
      const originalName = String(tool.name || '');
      if (!originalName) throw new TypeError('MCP_TOOL_NAME_REQUIRED');
      const name = `mcp.${this.namespace}.${originalName}`;
      return {
        name,
        description: String(tool.description || ''),
        schema: {
          description: String(tool.description || ''),
          parameters: tool.inputSchema || { type: 'object', properties: {} },
          risk: tool.annotations?.destructiveHint ? 'high' : 'medium',
          requiresApproval: Boolean(tool.annotations?.destructiveHint || tool.annotations?.openWorldHint),
        },
        parameters: tool.inputSchema || { type: 'object', properties: {} },
        source: 'mcp',
        server: this.namespace,
        passContext: true,
        execute: async (args = {}, callContext = {}) => this.callTool(originalName, args, callContext),
      };
    });
  }

  async callTool(name, arguments_ = {}, context = {}) {
    if (!name) throw new TypeError('MCP_TOOL_NAME_REQUIRED');
    await this._authorize('mcp.tools.call', context, { name });
    if (!this.connected || !this.client) throw new Error('MCP_CLIENT_NOT_CONNECTED');
    const result = await this.client.callTool({ name, arguments: arguments_ ?? {} });
    if (result?.isError) {
      const error = new Error('MCP_TOOL_EXECUTION_FAILED');
      error.code = 'MCP_TOOL_EXECUTION_FAILED';
      error.content = result.content || [];
      throw error;
    }
    return result?.structuredContent ?? result?.content ?? result;
  }

  async close() {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.connected = false;
    if (client && typeof client.close === 'function') await client.close();
    else if (transport && typeof transport.close === 'function') await transport.close();
  }

  async _authorize(capability, context, resource = {}) {
    if (!context.tenantId) throw new Error('TENANT_SCOPE_REQUIRED');
    if (!this.authorize) throw new Error('MCP_AUTHORIZER_REQUIRED');
    const allowed = await this.authorize({
      capability,
      tenantId: context.tenantId,
      userId: context.userId,
      resource,
      server: this.namespace,
    });
    if (!allowed) throw new Error('CAPABILITY_FORBIDDEN');
  }

  async _loadSdk(transportType) {
    try {
      const [clientModule, transportModule] = await Promise.all([
        import('@modelcontextprotocol/sdk/client/index.js'),
        import(transportType === 'stdio'
          ? '@modelcontextprotocol/sdk/client/stdio.js'
          : transportType === 'sse'
            ? '@modelcontextprotocol/sdk/client/sse.js'
            : '@modelcontextprotocol/sdk/client/streamableHttp.js'),
      ]);
      const transportName = transportType === 'stdio'
        ? 'StdioClientTransport'
        : transportType === 'sse'
          ? 'SSEClientTransport'
          : 'StreamableHTTPClientTransport';
      return { Client: clientModule.Client, [transportName]: transportModule[transportName] };
    } catch (cause) {
      const error = new Error('MCP_SDK_NOT_INSTALLED: install @modelcontextprotocol/sdk to enable MCP transports');
      error.cause = cause;
      throw error;
    }
  }
}

export default MCPClientAdapter;
