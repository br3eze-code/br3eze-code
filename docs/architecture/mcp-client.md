# Optional MCP client integration

AgentOS can connect to external Model Context Protocol (MCP) servers through the optional `MCPClientAdapter` in `src/adapters/mcp-client.js`.

## Enable it

Install the official MCP SDK in the deployment that needs MCP:

```sh
npm install @modelcontextprotocol/sdk
```

The SDK is intentionally loaded only when an MCP adapter connects. Generic AgentOS installations therefore do not load an MCP transport or spawn an MCP process unless configured to do so.

Supported transports:

- `stdio`: a configured local command and argument array.
- `http`: MCP Streamable HTTP endpoint.
- `sse`: legacy MCP SSE endpoint, when the installed SDK version still provides that transport.

Example:

```js
import { MCPClientAdapter } from '../src/adapters/mcp-client.js';

const adapter = new MCPClientAdapter({
  name: 'inventory',
  transport: 'stdio',
  command: 'node',
  args: ['./mcp-inventory-server.js'],
}, {
  // Connect this callback to the deployment's real tenant/RBAC policy.
  authorize: async ({ capability, tenantId, userId, resource }) =>
    Boolean(tenantId && userId && await policy.allows({ capability, tenantId, userId, resource })),
});

const tools = await adapter.connect({ tenantId, userId });
// Register only after reviewing the server trust boundary and tool schemas.
for (const tool of tools) toolRegistry.register(tool.name, tool);
```

## Security requirements

- A tenant ID is required for discovery and execution.
- An explicit authorizer is required; absence of an authorizer denies access.
- Tool names are namespaced as `mcp.<server>.<tool>` to reduce collisions.
- The adapter preserves input schemas and marks destructive/open-world annotated tools as requiring approval. Approval still has to be enforced by the canonical AgentRuntime/ToolRegistry execution path.
- Do not connect to an untrusted server or pass broad environment secrets to a stdio process. The SDK's stdio transport may inherit the parent process environment; passing `config.env` alone is not a sandbox or a guarantee that other process variables are hidden. Run untrusted stdio servers in a separate worker/container with a scrubbed environment and least-privilege credentials.
- MCP tool descriptions and returned content are untrusted data. Do not treat them as system instructions.
- A process transport is code execution: restrict executable/arguments to deployment-controlled configuration. Do not accept arbitrary transport commands from end-user requests.
- Tenant authorization at the client adapter is not a substitute for tenant scoping inside the MCP server or the underlying data source.

## Current scope

The adapter is a transport/client boundary, not a full MCP marketplace. It does not automatically install servers, trust community tools, expose hidden model reasoning, or create a sandbox. Production deployment should add allowlisted server configuration, connection lifecycle management, audit events, timeouts, output limits, and an OS/container sandbox for untrusted server processes.
