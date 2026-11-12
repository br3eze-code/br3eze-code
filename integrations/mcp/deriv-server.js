/**
 * Read-only Deriv market-data MCP server.
 * Requires DERIV_APP_ID and @modelcontextprotocol/sdk. No trading tools are exposed.
 * Keep API tokens out of config unless a future, separately reviewed feature needs them.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

const appId = process.env.DERIV_APP_ID;
if (!appId || !/^\d+$/.test(appId)) {
  console.error('DERIV_APP_ID must be set to a numeric Deriv application ID.');
  process.exit(1);
}
const endpoint = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
const timeoutMs = Math.min(Math.max(Number(process.env.DERIV_TIMEOUT_MS || 12000), 1000), 30000);

function derivRequest(payload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      err ? reject(err) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('DERIV_REQUEST_TIMEOUT')), timeoutMs);
    ws.once('error', (err) => finish(new Error(`DERIV_CONNECTION_FAILED: ${err.message}`)));
    ws.once('open', () => ws.send(JSON.stringify(payload)));
    ws.on('message', (raw) => {
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return finish(new Error('DERIV_INVALID_JSON')); }
      if (data.error) return finish(new Error(`DERIV_API_ERROR: ${data.error.code || 'unknown'}: ${data.error.message || 'request failed'}`));
      if (data.msg_type) finish(null, data);
    });
  });
}

const server = new Server({ name: 'agentos-deriv-market-data', version: '1.0.0' }, { capabilities: { tools: {} } });
const tools = [
  { name: 'deriv_server_time', description: 'Get the current Deriv server time.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'deriv_active_symbols', description: 'List active symbols/markets available on Deriv (public market metadata).', inputSchema: { type: 'object', properties: { product_type: { type: 'string', enum: ['basic', 'full'], default: 'basic' } }, additionalProperties: false } },
  { name: 'deriv_ticks_history', description: 'Read historical tick data for a symbol. Read-only; does not place trades.', inputSchema: { type: 'object', properties: { symbol: { type: 'string', minLength: 1, maxLength: 32 }, count: { type: 'integer', minimum: 1, maximum: 5000, default: 100 }, end: { type: 'string', enum: ['latest'], default: 'latest' } }, required: ['symbol'], additionalProperties: false } }
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    let data;
    switch (params.name) {
      case 'deriv_server_time':
        data = await derivRequest({ time: 1 });
        return { content: [{ type: 'text', text: JSON.stringify({ epoch: data.time, iso: new Date(data.time * 1000).toISOString() }) }] };
      case 'deriv_active_symbols': {
        const productType = params.arguments?.product_type || 'basic';
        data = await derivRequest({ active_symbols: productType, product_type: 'basic' });
        return { content: [{ type: 'text', text: JSON.stringify(data.active_symbols || []) }] };
      }
      case 'deriv_ticks_history': {
        const { symbol, count = 100, end = 'latest' } = params.arguments || {};
        if (typeof symbol !== 'string' || !/^[A-Za-z0-9_./-]{1,32}$/.test(symbol)) throw new Error('INVALID_SYMBOL');
        data = await derivRequest({ ticks_history: symbol, count: Math.max(1, Math.min(5000, Number(count) || 100)), end, style: 'ticks' });
        return { content: [{ type: 'text', text: JSON.stringify({ echo_req: data.echo_req, history: data.history }) }] };
      }
      default: throw new Error('UNKNOWN_TOOL');
    }
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: String(err?.message || 'DERIV_TOOL_FAILED') }] };
  }
});
await server.connect(new StdioServerTransport());
