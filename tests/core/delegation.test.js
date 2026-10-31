import { describe, expect, jest, test } from '@jest/globals';
import { createDelegationTool } from '../../src/core/delegation.js';
import { AgentRuntime } from '../../src/core/agentRuntime.js';
import { ToolRegistry } from '../../src/core/tool-registry.js';

describe('domain-neutral delegation', () => {
  test('exposes only the declared allowlist and carries scope/depth to AgentRuntime', async () => {
    const registered = [
      { fullName: 'docs.search', description: 'Search approved docs', schema: { parameters: { type: 'object', properties: { query: { type: 'string' } } } } },
      { fullName: 'shell.execute', description: 'Run a shell command', schema: { parameters: { type: 'object', properties: {} } } },
    ];
    const runtime = {
      listTools: () => registered.map((tool) => tool.fullName),
      toolRegistry: { getAllTools: () => registered },
      execute: jest.fn(async () => ({ response: 'Grounded summary', toolsUsed: ['docs.search'] })),
    };
    const delegate = createDelegationTool({
      name: 'research-specialist',
      runtime,
      allowedTools: ['docs.search'],
      systemInstruction: 'Use cited sources only.',
    });

    await expect(delegate.execute({ subTaskPrompt: 'Summarize the approved documents.' }, {
      tenantId: 'tenant-a', userId: 'user-a', delegationDepth: 0,
    })).resolves.toEqual({ agent: 'research-specialist', summary: 'Grounded summary', toolsUsed: ['docs.search'] });

    expect(runtime.execute).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Summarize the approved documents.',
      tools: [{ name: 'docs.search', description: 'Search approved docs', parameters: { type: 'object', properties: { query: { type: 'string' } } } }],
      context: expect.objectContaining({
        tenantId: 'tenant-a', userId: 'user-a', delegatedBy: 'user-a',
        delegationDepth: 1, allowedToolNames: ['docs.search'], systemPrompt: 'Use cited sources only.',
      }),
      maxTurns: 4,
    }));
  });

  test('rejects unknown tools and excessive delegation depth', async () => {
    const runtime = { listTools: () => ['docs.search'], toolRegistry: { getAllTools: () => [] }, execute: jest.fn() };
    const missing = createDelegationTool({ name: 'missing-tool-agent', runtime, allowedTools: ['shell.execute'] });
    await expect(missing.execute({ subTaskPrompt: 'run' }, { userId: 'u1' })).rejects.toThrow(/unregistered tools/i);

    const known = createDelegationTool({
      name: 'bounded-agent',
      runtime: {
        listTools: () => ['docs.search'],
        toolRegistry: { getAllTools: () => [{ fullName: 'docs.search' }] },
        execute: jest.fn(),
      },
      allowedTools: ['docs.search'],
      maxDepth: 2,
    });
    await expect(known.execute({ subTaskPrompt: 'run' }, { delegationDepth: 2 })).rejects.toThrow(/Maximum delegation depth/i);
  });

  test('AgentRuntime enforces the delegated allowlist at execution, not only in model declarations', async () => {
    const registry = new ToolRegistry({ logger: { info() {}, warn() {}, error() {} } });
    const runtime = new AgentRuntime({ toolRegistry: registry });
    const dangerous = jest.fn(async () => ({ changed: true }));
    runtime.registerTool({ name: 'shell.execute', execute: dangerous, schema: { parameters: { type: 'object', properties: {} } } });

    await expect(runtime.execute({
      content: 'try an unapproved tool',
      context: { tenantId: 'tenant-a', userId: 'user-a', allowedToolNames: ['docs.search'] },
      toolCalls: [{ name: 'shell.execute', arguments: {} }],
    })).rejects.toThrow(/outside the delegated allowlist/i);
    expect(dangerous).not.toHaveBeenCalled();
  });
});
