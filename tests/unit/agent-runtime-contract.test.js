import { describe, expect, test } from '@jest/globals';
import { AgentRuntime } from '../../src/core/agent-runtime.js';
import { AGENT_RUNTIME_CONTRACT_VERSION } from '../../src/core/agentKernel.js';

function runtime() {
  return new AgentRuntime({
    toolRegistry: {
      getManifest: () => ({ tools: [] }),
      getToolsForLLM: () => [],
      getTool: () => null,
      execute: async () => ({ ok: true }),
    },
    sessionManager: {
      getSessionId: (frame) => frame.sessionId || 'session-contract',
      load: async () => [],
      save: async () => {},
    },
    memoryStore: { append: async () => {} },
    providerManager: {
      execute: async () => ({ content: 'done', toolCalls: [] }),
    },
    safetyEnvelope: { checkToolExecution: () => true },
    maxIterations: 2,
  });
}

describe('AgentRuntime contract', () => {
  test('implements the canonical executeTurn contract', async () => {
    const r = runtime();
    expect(typeof r.executeTurn).toBe('function');

    const result = await r.executeTurn({
      sessionId: 'session-1',
      input: 'hello',
      context: { domain: 'general', channel: 'test' },
      capabilities: [],
    });

    expect(result.contractVersion).toBe(AGENT_RUNTIME_CONTRACT_VERSION);
    expect(result.runtimeId).toBe('agent-runtime');
    expect(result.sessionId).toBe('session-1');
    expect(result.result.response).toBe('done');
    expect(result.checkpoint.completedAt).toEqual(expect.any(Number));
  });

  test('rejects malformed runtime requests', async () => {
    const r = runtime();
    await expect(r.executeTurn({ input: 'missing session' }))
      .rejects.toThrow('sessionId is required');
  });
});
