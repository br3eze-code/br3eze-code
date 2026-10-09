import assert from 'node:assert/strict';
import { NetworkAdapter, NetworkAdapterError, WIFI_OPERATIONS, WIFI_OPERATION_SCHEMAS, createToolDescriptors } from '../packages/agentos-network-adapter/src/index.mjs';

const calls = [];
const adapter = new NetworkAdapter({
  id: 'test',
  platform: 'test',
  capabilities: ['scan', 'status', 'getConnectionInfo'],
  transport: async (op, args) => { calls.push({ op, args }); return { op, args }; }
});

assert.ok(WIFI_OPERATIONS.includes('getConnectionInfo'));
assert.deepEqual(await adapter.execute('scan', { x: 1 }), { op: 'scan', args: { x: 1 } });
assert.deepEqual(await adapter.execute('getConnectionInfo'), { op: 'getConnectionInfo', args: {} });
assert.deepEqual(adapter.describe().capabilities, ['getConnectionInfo', 'scan', 'status']);
assert.equal(createToolDescriptors(adapter).length, 3);
assert.deepEqual(createToolDescriptors(adapter).find(t => t.name.endsWith('getConnectionInfo')).input, WIFI_OPERATION_SCHEMAS.getConnectionInfo);
await assert.rejects(() => adapter.execute('connect'), e => e.code === 'UNSUPPORTED_CAPABILITY');
await assert.rejects(() => adapter.execute('not-an-operation'), e => e instanceof NetworkAdapterError && e.code === 'UNKNOWN_OPERATION');
await assert.rejects(() => adapter.execute('scan', null), e => e.code === 'INVALID_ARGUMENTS');
assert.deepEqual(calls.length, 2);

console.log('AgentOS network adapter contract: OK');
