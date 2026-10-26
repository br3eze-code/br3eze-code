import { jest } from '@jest/globals';
import { createDelegationTool } from '../../src/core/delegation.js';

describe('createDelegationTool', () => {
  test('passes only allowlisted registered tool declarations into the canonical runtime', async () => {
    const execute = jest.fn(async (frame) => ({ response: 'done', toolsUsed: ['inventory.lookup'] }));
    const runtime = {
      listTools: () => ['inventory.lookup', 'billing.refund'],
      toolRegistry: {
        getToolsForLLM: () => [
          { type: 'function', function: { name: 'inventory__lookup', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'billing__refund', parameters: { type: 'object', properties: {} } } },
        ],
      },
      execute,
    };
    const delegate = createDelegationTool({
      name: 'inventory-agent',
      runtime,
      allowedTools: ['inventory.lookup'],
    });
    const result = await delegate.execute({ subTaskPrompt: 'Find stock' }, { tenantId: 't1', userId: 'u1' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Find stock',
      tools: [{ type: 'function', function: { name: 'inventory__lookup', parameters: { type: 'object', properties: {} } } }],
      context: expect.objectContaining({ tenantId: 't1', userId: 'u1', delegationDepth: 1, delegatedBy: 'u1' }),
    }));
    expect(result).toMatchObject({ agent: 'inventory-agent', summary: 'done', toolsUsed: ['inventory.lookup'] });
  });

  test('fails closed when the allowlist contains an unregistered tool', async () => {
    const runtime = { listTools: () => ['inventory.lookup'], execute: jest.fn() };
    const delegate = createDelegationTool({ name: 'delegate', runtime, allowedTools: ['billing.refund'] });
    await expect(delegate.execute({ subTaskPrompt: 'Refund' }, { tenantId: 't1', userId: 'u1' }))
      .rejects.toThrow(/unregistered tools/);
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  test('enforces a maximum delegation depth', async () => {
    const runtime = { listTools: () => ['inventory.lookup'], execute: jest.fn() };
    const delegate = createDelegationTool({ name: 'delegate', runtime, allowedTools: ['inventory.lookup'], maxDepth: 2 });
    await expect(delegate.execute({ subTaskPrompt: 'nested' }, { delegationDepth: 2 }))
      .rejects.toThrow(/Maximum delegation depth/);
  });
});
