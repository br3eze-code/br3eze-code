/**
 * Optional Model Context Protocol client adapter.
 *
 * This module is dynamically imported so the AgentOS core can run without the
 * MCP SDK installed. MCP servers are trusted integrations: stdio commands must
 * be configured by an operator, never derived from user prompts.
 */
export class MCPClientAdapter {
  constructor(serverConfig = {}) {
    if (!serverConfig || typeof serverConfig !== 'object') throw new TypeError('serverConfig must be an object');
    this.config = serverConfig;
    this.client = null;
    this.transport = null;
    this.connected = false;
    this.tools = [];
    this.serverName = String(serverConfig.name || 'mcp-server');
  }

  async connect() {
    if (this.connected) return this.tools;
    const [{ Client }, transports] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      this.#loadTransport(),
    ]);
    this.client = new Client({ name: 'AgentOS', version: '1.0.0' }, { capabilities: {} });
    this.transport = transports;
    await this.client.connect(this.transport);
    const listed = await this.client.listTools();
    this.tools = (listed.tools || []).map((tool) => ({
      name: `mcp.${this.serverName}.${tool.name}`,
      description: tool.description || `MCP tool ${tool.name} from ${this.serverName}`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
      capability: { source: 'mcp', server: this.serverName, externalToolName: tool.name },
      execute: async (args = {}, context = {}) => {
        if (!this.connected) throw new Error(`MCP server ${this.serverName} is not connected`);
        if (context.signal?.aborted) throw new Error('MCP tool call aborted');
        const result = await this.client.callTool({ name: tool.name, arguments: args });
        if (result?.isError) throw new Error(`MCP tool ${tool.name} returned an error`);
        return result;
      },
    }));
    this.connected = true;
    return [...this.tools];
  }

  async #loadTransport() {
    const transport = String(this.config.transport || 'stdio').toLowerCase();
    if (transport === 'stdio') {
      if (!this.config.command || !Array.isArray(this.config.args || [])) {
        throw new TypeError('stdio MCP config requires an operator-configured command and args array');
      }
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args || [],
        env: this.config.env,
        cwd: this.config.cwd,
      });
    }
    if (transport === 'sse') {
      if (!this.config.url || !/^https?:\/\//i.test(this.config.url)) throw new TypeError('SSE MCP config requires an http(s) URL');
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
      return new SSEClientTransport(new URL(this.config.url), {
        eventSourceInit: this.config.eventSourceInit,
        requestInit: this.config.requestInit,
      });
    }
    if (transport === 'streamable-http') {
      if (!this.config.url || !/^https?:\/\//i.test(this.config.url)) throw new TypeError('Streamable HTTP MCP config requires an http(s) URL');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      return new StreamableHTTPClientTransport(new URL(this.config.url), {
        requestInit: this.config.requestInit,
      });
    }
    throw new TypeError(`Unsupported MCP transport: ${transport}`);
  }

  async close() {
    this.connected = false;
    this.tools = [];
    if (this.client) await this.client.close();
    else if (this.transport?.close) await this.transport.close();
    this.client = null;
    this.transport = null;
  }
}
export default MCPClientAdapter;
