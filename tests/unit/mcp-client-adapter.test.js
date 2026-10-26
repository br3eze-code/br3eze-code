import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { MCPClientAdapter } from '../../src/adapters/mcp-client.js';

function createSdk({ tools = [{ name: 'catalog.search', description: 'Search catalog', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }], result = { structuredContent: { items: [] } } } = {}) {
  const calls = { connect: 0, listTools: 0, callTool: [], close: 0, transport: null };
  class Client {
    constructor(info) { calls.clientInfo = info; }
    async connect(transport) { calls.connect += 1; calls.transport = transport; }
    async listTools() { calls.listTools += 1; return { tools }; }
    async callTool(input) { calls.callTool.push(input); return result; }
    async close() { calls.close += 1; }
  }
  class StdioClientTransport {
    constructor(config) { this.config = config; }
  }
  class StreamableHTTPClientTransport {
    constructor(url, options) { this.url = url; this.options = options; }
  }
  class SSEClientTransport {
    constructor(url, options) { this.url = url; this.options = options; }
  }
  return { sdk: { Client, StdioClientTransport, StreamableHTTPClientTransport, SSEClientTransport }, calls };
}

describe('MCPClientAdapter', () => {
  test('connects over stdio and exposes tenant-authorized namespaced tools', async () => {
    const { sdk, calls } = createSdk();
    const authorize = jest.fn(async ({ tenantId }) => tenantId === 'tenant-a');
    const adapter = new MCPClientAdapter({ name: 'inventory service', command: 'node', args: ['server.js'] }, { sdk, authorize });
    const tools = await adapter.connect({ tenantId: 'tenant-a', userId: 'user-a' });

    expect(calls.connect).toBe(1);
    expect(calls.transport.config).toEqual({ command: 'node', args: ['server.js'], env: undefined });
    expect(tools[0].name).toBe('mcp.inventory-service.catalog.search');
    expect(tools[0].passContext).toBe(true);
    expect(tools[0].schema.parameters.required).toEqual(['query']);

    const result = await tools[0].execute({ query: 'tea' }, { tenantId: 'tenant-a', userId: 'user-a' });
    expect(result).toEqual({ items: [] });
    expect(calls.callTool).toEqual([{ name: 'catalog.search', arguments: { query: 'tea' } }]);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ capability: 'mcp.tools.call', tenantId: 'tenant-a', userId: 'user-a' }));
    await adapter.close();
    expect(calls.close).toBe(1);
  });

  test('refuses to list or execute tools without tenant-scoped authorization', async () => {
    const { sdk } = createSdk();
    const adapter = new MCPClientAdapter({ transport: 'stdio', command: 'node', args: [] }, { sdk });
    await expect(adapter.connect()).rejects.toThrow('TENANT_SCOPE_REQUIRED');
  });

  test('refuses tool calls when the authorizer denies access', async () => {
    const { sdk } = createSdk();
    const adapter = new MCPClientAdapter({ transport: 'stdio', command: 'node', args: [] }, { sdk, authorize: async () => false });
    await expect(adapter.connect({ tenantId: 'tenant-a' })).rejects.toThrow('CAPABILITY_FORBIDDEN');
  });

  test('surfaces MCP tool errors without treating them as successful content', async () => {
    const { sdk } = createSdk({ result: { isError: true, content: [{ type: 'text', text: 'denied' }] } });
    const adapter = new MCPClientAdapter({ transport: 'stdio', command: 'node', args: [] }, { sdk, authorize: async () => true });
    await adapter.connect({ tenantId: 'tenant-a' });
    await expect(adapter.callTool('catalog.search', {}, { tenantId: 'tenant-a' })).rejects.toMatchObject({
      code: 'MCP_TOOL_EXECUTION_FAILED',
      content: [{ type: 'text', text: 'denied' }],
    });
    await adapter.close();
  });

  test('uses Streamable HTTP transport when configured', async () => {
    const { sdk, calls } = createSdk({ tools: [] });
    const adapter = new MCPClientAdapter({ transport: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: 'Bearer example' } }, { sdk, authorize: async () => true });
    await adapter.connect({ tenantId: 'tenant-a' });
    expect(calls.transport.url.href).toBe('https://mcp.example.test/mcp');
    expect(calls.transport.options.requestInit.headers.Authorization).toBe('Bearer example');
    await adapter.close();
  });
});
