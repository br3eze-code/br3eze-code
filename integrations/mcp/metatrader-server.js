/**
 * Read-only MCP adapter for a user-operated MetaTrader bridge.
 * This server does not connect to MetaTrader terminals directly and has no trade tools.
 * The bridge must bind to loopback and enforce its own authentication/permissions.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const baseUrl = process.env.MT_BRIDGE_URL || 'http://127.0.0.1:8787';
const timeoutMs = Math.min(Math.max(Number(process.env.MT_BRIDGE_TIMEOUT_MS || 5000), 500), 15000);
const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
let bridge;
try {
  bridge = new URL(baseUrl);
  if (bridge.protocol !== 'http:' && bridge.protocol !== 'https:') throw new Error();
  if (!allowedHosts.has(bridge.hostname)) throw new Error();
  if (bridge.username || bridge.password) throw new Error();
} catch {
  console.error('MT_BRIDGE_URL must be a loopback URL, e.g. http://127.0.0.1:8787');
  process.exit(1);
}
const routes = {
  mt_status: '/health',
  mt_account_summary: '/account',
  mt_open_positions: '/positions',
  mt_symbols: '/symbols',
  mt_latest_rates: '/rates'
};
async function readBridge(toolName, args = {}) {
  const path = routes[toolName];
  if (!path) throw new Error('UNKNOWN_TOOL');
  const url = new URL(path, bridge);
  if (toolName === 'mt_latest_rates') {
    if (typeof args.symbol !== 'string' || !/^[A-Za-z0-9._-]{1,32}$/.test(args.symbol)) throw new Error('INVALID_SYMBOL');
    url.searchParams.set('symbol', args.symbol);
    const limit = Math.max(1, Math.min(500, Number(args.limit) || 100));
    url.searchParams.set('limit', String(limit));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' }, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`MT_BRIDGE_HTTP_${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) throw new Error('MT_BRIDGE_EXPECTED_JSON');
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error('MT_BRIDGE_RESPONSE_TOO_LARGE');
    return JSON.stringify(JSON.parse(body));
  } finally {
    clearTimeout(timer);
  }
}
const server = new Server({ name: 'agentos-metatrader-readonly', version: '1.0.0' }, { capabilities: { tools: {} } });
const tools = [
  { name: 'mt_status', description: 'Check local MetaTrader bridge health.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'mt_account_summary', description: 'Read account summary from the local bridge. Treat balance/equity as sensitive.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'mt_open_positions', description: 'Read currently open positions; does not modify orders.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'mt_symbols', description: 'List symbols exposed by the local MetaTrader bridge.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'mt_latest_rates', description: 'Read latest rates from the local bridge for a symbol.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', minLength: 1, maxLength: 32 }, limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } }, required: ['symbol'], additionalProperties: false } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const text = await readBridge(params.name, params.arguments || {});
    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: String(err?.message || 'MT_BRIDGE_FAILED') }] };
  }
});
await server.connect(new StdioServerTransport());
