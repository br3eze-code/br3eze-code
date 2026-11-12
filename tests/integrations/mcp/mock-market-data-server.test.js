import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverPath = fileURLToPath(new URL('../../../integrations/mcp/mock-market-data-server.js', import.meta.url));

function runMessages(messages) {
  const input = messages.map((message) => JSON.stringify(message)).join('\n') + '\n';
  const child = spawnSync(process.execPath, [serverPath.pathname], {
    input,
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, NODE_OPTIONS: '' }
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  return child.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('mock MCP server initializes and advertises only synthetic-data tools', () => {
  const [initialized, listed] = runMessages([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' }
  ]);
  assert.equal(initialized.result.serverInfo.name, 'br3eze-agentos-mock-market-data');
  assert.ok(listed.result.tools.some((tool) => tool.name === 'mock_market_snapshot'));
  assert.ok(listed.result.tools.some((tool) => tool.name === 'mock_market_history'));
  assert.ok(listed.result.tools.every((tool) => tool.name.startsWith('mock_')));
});

test('snapshot returns deterministic synthetic data and labels it non-live', () => {
  const [response] = runMessages([
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'mock_market_snapshot', arguments: { symbol: 'DEMO-1' } } }
  ]);
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.live, false);
  assert.equal(result.source, 'synthetic-fixture');
  assert.equal(result.symbol, 'DEMO-1');
  assert.equal(result.bid, 100.25);
});

test('history count is bounded and invalid inputs fail closed', () => {
  const [valid, invalid] = runMessages([
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'mock_market_history', arguments: { symbol: 'DEMO', count: 3 } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'mock_market_history', arguments: { symbol: 'DEMO', count: 21 } } }
  ]);
  assert.equal(JSON.parse(valid.result.content[0].text).points.length, 3);
  assert.equal(invalid.result.isError, true);
  assert.equal(JSON.parse(invalid.result.content[0].text).error, 'INVALID_ARGUMENTS');
});

test('unknown tools and methods return protocol errors without crashing', () => {
  const [tool, method] = runMessages([
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'live_trade', arguments: {} } },
    { jsonrpc: '2.0', id: 7, method: 'not/a/method' }
  ]);
  assert.equal(tool.result.isError, true);
  assert.equal(JSON.parse(tool.result.content[0].text).error, 'UNKNOWN_TOOL');
  assert.equal(method.error.code, -32601);
});
