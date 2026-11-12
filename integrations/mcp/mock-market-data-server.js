/**
 * Offline-only MCP test server for Claude Code / AgentOS integration checks.
 * Uses Node.js built-ins only. No network, accounts, credentials, or transactions.
 * MCP stdio protocol: newline-delimited JSON-RPC messages.
 */
import readline from 'node:readline';

const SERVER_INFO = { name: 'br3eze-agentos-mock-market-data', version: '1.0.0' };
const TOOLS = [
  {
    name: 'mock_market_snapshot',
    description: 'Return deterministic synthetic market data for MCP protocol testing. Not live data.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', minLength: 1, maxLength: 16, default: 'DEMO' } },
      additionalProperties: false
    }
  },
  {
    name: 'mock_market_history',
    description: 'Return deterministic synthetic history for schema, output, and error-path testing. Not live data.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', minLength: 1, maxLength: 16, default: 'DEMO' },
        count: { type: 'integer', minimum: 1, maximum: 20, default: 5 }
      },
      additionalProperties: false
    }
  }
];

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}
function validSymbol(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,16}$/.test(value);
}

function callTool(name, args = {}) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return textResult({ error: 'INVALID_ARGUMENTS' }, true);
  }
  if (name === 'mock_market_snapshot') {
    const symbol = args.symbol ?? 'DEMO';
    if (!validSymbol(symbol) || Object.keys(args).some((key) => key !== 'symbol')) {
      return textResult({ error: 'INVALID_ARGUMENTS', expected: { symbol: '1-16 letters, digits, dot, underscore, or hyphen' } }, true);
    }
    return textResult({
      source: 'synthetic-fixture',
      live: false,
      symbol,
      bid: 100.25,
      ask: 100.5,
      timestamp: '2026-01-01T00:00:00.000Z'
    });
  }
  if (name === 'mock_market_history') {
    const symbol = args.symbol ?? 'DEMO';
    const count = args.count ?? 5;
    if (!validSymbol(symbol) || !Number.isInteger(count) || count < 1 || count > 20 ||
        Object.keys(args).some((key) => !['symbol', 'count'].includes(key))) {
      return textResult({ error: 'INVALID_ARGUMENTS', expected: { symbol: '1-16 valid characters', count: 'integer from 1 to 20' } }, true);
    }
    const points = Array.from({ length: count }, (_, index) => ({
      sequence: index + 1,
      value: Number((100 + index * 0.25).toFixed(2))
    }));
    return textResult({ source: 'synthetic-fixture', live: false, symbol, points });
  }
  return textResult({ error: 'UNKNOWN_TOOL' }, true);
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return message?.id === undefined ? null : rpcError(message.id, -32600, 'Invalid Request');
  }
  const id = message.id;
  switch (message.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: message.params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = message.params?.name;
      if (typeof name !== 'string') return rpcError(id, -32602, 'Missing tool name');
      return rpcResult(id, callTool(name, message.params?.arguments ?? {}));
    }
    default:
      return id === undefined ? null : rpcError(id, -32601, 'Method not found');
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write('mock MCP server received invalid JSON-RPC input\n');
    continue;
  }
  try {
    const response = await handle(message);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  } catch {
    if (message?.id !== undefined) {
      process.stdout.write(JSON.stringify(rpcError(message.id, -32603, 'Internal error')) + '\n');
    }
  }
}
