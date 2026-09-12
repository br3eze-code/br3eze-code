import assert from 'node:assert/strict';
import { NetworkAdapter, createToolDescriptors } from '../packages/agentos-network-adapter/src/index.mjs';
const adapter = new NetworkAdapter({ id:'test', platform:'test', capabilities:['scan','status'], transport: async (op,args)=>({op,args}) });
assert.deepEqual(await adapter.execute('scan',{x:1}), {op:'scan',args:{x:1}});
assert.equal(createToolDescriptors(adapter).length, 2);
await assert.rejects(() => adapter.execute('connect'), e => e.code === 'UNSUPPORTED_CAPABILITY');
console.log('AgentOS network adapter contract: OK');
